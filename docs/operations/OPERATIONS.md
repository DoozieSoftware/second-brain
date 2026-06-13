# Second Brain — Operations Guide

This is for self-hosters — engineers running Second Brain in production (their own infra or a customer's). It covers deployment, backups, monitoring, scaling, and security hardening.

If you want to *use* Second Brain as an end user, see `docs/operations/USER-GUIDE.md` instead.

---

## Deployment topologies

### A. Local laptop (the default)

The simplest path. `npm install`, set `OPENROUTER_API_KEY`, run `npm run api`. The dashboard lives at `http://localhost:3000`. All data in `./data/`.

**Best for:** individual developer, dogfooding, evaluation.

### B. Docker (single host)

The provided `docker-compose.yml` starts the API on port 3000 with the data directory mounted as a volume.

```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain
cp .env.example .env
# Edit .env — add OPENROUTER_API_KEY, GITHUB_TOKEN, etc.
docker compose up -d
```

The container is a single Node.js process. Memory, embeddings, and the savings scanner all run inside it. The first `ask` or `sync` triggers the 80MB embedding model download into a volume (`huggingface-cache`).

**Best for:** small team, single-server home/office deployment.

### C. Kubernetes / cloud (multi-pod)

The Docker image works in k8s with a few caveats:

- **StatefulSet, not Deployment.** The `data/` directory must persist across pod restarts. Mount a PVC.
- **No HPA.** This is a CPU/IO-bound single-tenant app; horizontal scaling would require splitting memory across pods, which is a v2.0 feature.
- **Resource requests:** 500m CPU, 1Gi RAM baseline; up to 4Gi RAM during the 80MB embedding model load.
- **Readiness probe:** `/health/ready` returns 200 only when the embedding model is loaded. Don't route `/ask` traffic until then.

**Best for:** production deployment, 50+ users.

### D. Air-gapped / VPC-only

For compliance-bound teams (healthcare, finance, government), Second Brain can run entirely without internet access:

- Pre-bake the embedding model into the Docker image (see `docs/operations/AIRGAP.md`)
- Configure `OPENROUTER_BASE_URL` to point at an internal OpenRouter-compatible proxy (LiteLLM, Open WebUI, etc.)
- All other API calls (GitHub, IMAP, GDrive) use internal endpoints

**Best for:** EU AI Act compliance, regulated industries, defense/intel.

---

## Configuration reference

All config is via environment variables, loaded from `.env` at startup.

### Required

| Var | Purpose | Example |
|---|---|---|
| `OPENROUTER_API_KEY` | LLM API key (free at https://openrouter.ai) | `sk-or-v1-...` |

### LLM

| Var | Purpose | Default |
|---|---|---|
| `DEFAULT_MODEL` | Override the default model | best free model on OpenRouter |
| `QUERY_TIMEOUT_MS` | Max wait per ask | `90000` (90s) |
| `OPENROUTER_BASE_URL` | Custom OpenRouter-compatible endpoint | (none) |

### API security

| Var | Purpose | Default |
|---|---|---|
| `API_KEY` | If set, all `/api/*` endpoints require `Authorization: Bearer <key>` | (none = open) |
| `CORS_ORIGIN` | Comma-separated allowed origins for CORS | `*` |

### Connector credentials

See `.env.example` for the full list, grouped by connector. Common ones:

| Var | Connector |
|---|---|
| `GITHUB_TOKEN` | GitHub |
| `GITHUB_ORG` | GitHub (optional scope) |
| `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` | Email (IMAP) |
| `GOOGLE_CALENDAR_API_KEY` | Google Calendar |
| `GOOGLE_DRIVE_*` | Google Drive (or use the web settings page) |
| `DROPBOX_ACCESS_TOKEN` | Dropbox |

### Storage

| Var | Purpose | Default |
|---|---|---|
| `DATA_DIR` | Where to store memory, user model, alerts | `./data` |

In tests, set `DATA_DIR` to a `mkdtempSync` directory for isolation.

### Server

| Var | Purpose | Default |
|---|---|---|
| `PORT` | API server port | `3000` |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `LOG_FORMAT` | `json` \| `pretty` | `pretty` (dev), `json` (prod) |

---

## Backups

The system has no internal backup system. Back up `data/` yourself.

**What's in `data/`:**
- `memory.json` — the vector store (typically 1-100 MB; can be 1+ GB for large installs)
- `user-model.json` — the per-user Bayesian model
- `system-model.json` — the cross-session patterns
- `alerts.json` — savings scanner history
- `email-config.json` — IMAP credentials (sensitive; treat as secret)
- `connector-config.json` — OAuth tokens (sensitive; treat as secret)
- `digest.md` — latest markdown digest (regeneratable)

**Recommended schedule:**
- Daily: snapshot `data/` to object storage (S3, GCS, B2). The file is a single JSON blob, so `aws s3 cp` works fine.
- Hourly: incremental backup of `data/memory.json` (the only file that grows).

**Restore:**
```bash
# Stop the server
docker compose down

# Restore from backup
aws s3 cp s3://my-bucket/second-brain/2026-06-13/memory.json data/memory.json

# Start the server
docker compose up -d
```

**What's NOT backed up:**
- The 80MB embedding model (regenerates from `@xenova/transformers` cache; back up `~/.cache/huggingface/` if you want to skip the 30s reload)
- Conversation history (in-memory only; lost on restart)

---

## Monitoring

The API server exposes:

- `GET /health` — overall health (uptime, error rate, avg confidence, recent queries)
- `GET /health/ready` — readiness probe (returns 200 only when embedding model is loaded)
- `GET /metrics` — query performance counters (queries, errors, latency, confidence distribution)
- `GET /alerts/active` — current savings scanner alerts
- `GET /status` — per-connector status (configured, last sync, doc count)

The `/monitor` dashboard (at `http://localhost:3000/monitor`) visualizes all of the above in real-time (10s polling).

### Recommended alerts

| Alert | Threshold | Why |
|---|---|---|
| `error_rate_5m` | > 10% sustained | Something is broken (LLM down, connector auth, etc.) |
| `embedding_model_loaded` | false for > 5min | First-run failure; user thinks it's hung |
| `avg_confidence_1h` | < 0.5 | Memory is empty or stale; user sync isn't running |
| `sync_failed_count_24h` | > 3 | A connector is broken |
| `disk_free_pct` | < 20% | `data/memory.json` is growing; back up and prune |

A Grafana dashboard JSON is planned for v1.1 (see roadmap).

### Structured logs

The logger at `src/core/logger.ts` outputs JSON or pretty format. JSON format is line-delimited for log aggregators (Loki, Datadog, CloudWatch). Every log line includes:
- `timestamp`
- `level`
- `context` (the calling module/component)
- `message`
- structured fields (e.g. `{ source: 'github', count: 247 }`)
- error stack (if applicable)

**Note:** the v1.0.0 audit (`docs/strategy/DX-ANALYSIS.md`) found that the logger is built but bypassed in 12+ modules. Most console.log calls in supervisor, reasoning, memory, and connectors don't go through it. **Workaround for production:** pipe stdout/stderr to your log aggregator. **Proper fix:** see `docs/strategy/ROADMAP.md` §v1.0.1.

---

## Scaling

The current architecture is single-tenant and single-process. The bottlenecks are:

| Bottleneck | Threshold | Mitigation |
|---|---|---|
| `memory.json` write throughput | ~10k docs | Move to `pgvector` or `LanceDB` (v2.0) |
| LLM API rate limit | OpenRouter free tier | Rotate keys, upgrade to paid, or self-host (Ollama) |
| Embedding model load | 1 process at a time | Singleton lockfile in `data/` |
| `user-model.json` write | Per user, per feedback | Already fine (small file) |

The `data/memory.json` file is rewritten on every `sync` and every ingest. For 10k+ docs, this is slow. The migration to `pgvector` (v2.0) is the right answer; for now, use `--no-extract` to skip the LLM extraction pass and halve the write load.

---

## Security hardening

The minimum-viable security posture:

1. **Set `API_KEY` in `.env`.** Without it, every endpoint is open.
2. **Distribute the key via env var, not the dashboard.** The HTML pages don't currently send the auth header; v1.0.1 fixes this.
3. **Use HTTPS.** Put a reverse proxy (Caddy, nginx, Cloudflare) in front of port 3000.
4. **Back up `data/` to encrypted storage.** IMAP credentials and OAuth tokens are in plain JSON.
5. **Audit `/metrics` for unusual query patterns.** If you see a sudden spike, someone may be using your install as a free LLM proxy.

For enterprise/production:

6. **Container security:** run as non-root, drop capabilities, read-only root filesystem except for `data/`.
7. **Network isolation:** the API doesn't need outbound except to (a) OpenRouter, (b) connector APIs. Lock down egress.
8. **Secret rotation:** OpenRouter keys and connector tokens should rotate every 90 days. There is no built-in rotation; do it manually.
9. **Audit log:** the system does not yet have an append-only audit log of who asked what. This is a v1.2 roadmap item.
10. **SSRF protection:** the `/import/url` endpoint is SSRF-guarded (https-only, DNS-validated, private-IP-rejected, 10s timeout, 50MB cap). See `src/connectors/file-import-connector.ts`.

### Threat model (v1.0.0)

| Threat | Mitigation |
|---|---|
| Unauthenticated `/ask` access | Set `API_KEY` |
| LLM cost abuse (someone uses your install as a proxy) | Rate-limit at the reverse proxy; cap tokens in prompt |
| SSRF via `/import/url` | https-only + DNS resolution + private IP block |
| Secret leak in logs | `redactKeys` planned for v1.0.1; until then, pipe stdout through a redactor |
| Disk exhaustion via large memory.json | 50MB cap on `/import/file`; 50MB cap on `/import/url`; no cap on `sync` yet (v1.0.1) |
| Memory poisoning (an attacker injects docs that the LLM trusts) | Out of scope for v1.0.0. Vector similarity is by design "trust what you indexed." |
| Prompt injection in synced docs | Partially mitigated: the LLM is told to "only answer from cited evidence" and a verification pass runs on every answer. Not perfect. |
| Cross-user data leak in multi-tenant | Out of scope (no multi-tenant yet). v2.0 will add per-tenant isolation. |

---

## Updating

```bash
# Pull the latest
git pull

# Install new deps
npm install

# Rebuild
npm run build

# Restart
docker compose restart
# or, if running bare metal:
pm2 restart second-brain
```

Memory files are versioned; the loader at `src/core/memory.ts:46-65` handles old formats by falling back to empty state. The user-model and system-model have similar forward-compat shims.

If a breaking change is shipped, it will be in `CHANGELOG.md` with a `BREAKING:` prefix. v1.0.0 is the first such release.

---

## Troubleshooting

See `docs/reference/FAQ.md` for the most common questions. If you hit something not covered there:

- Open a GitHub issue
- Check `/monitor` for live diagnostics
- Read the relevant connector's source — they all log to `console.error` on failure

---

## See also

- `docs/strategy/ARCHITECTURE.md` — how the system is built
- `docs/strategy/ROADMAP.md` — what's coming next
- `docs/operations/USER-GUIDE.md` — for end users
- `docs/operations/AIRGAP.md` — for fully-offline deployments (planned)
- `docs/reference/API.md` — for API consumers
