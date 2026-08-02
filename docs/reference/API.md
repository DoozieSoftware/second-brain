# Second Brain — API Reference

**Base URL:** `http://localhost:3000` (default)

**Auth — three modes:**
1. **Identity mode (recommended).** Create users via `POST /admin/users` (admin-only) or the `user:create` CLI command; each returns a personal API key. Send `Authorization: Bearer <key>`. Roles: `admin` (everything), `editor` (read/write knowledge/strategy/decisions/connectors + read alerts), `viewer` (read-only).
2. **Legacy mode.** Set `API_KEY` in `.env`, then send `Authorization: Bearer <key>` on every request.
3. **Open mode.** Neither configured — every endpoint is open (fine for local dev).

All endpoints return JSON unless noted. Errors return `{ "error": "<message>" }` with the appropriate HTTP status code.

---

## Health & monitoring

These endpoints are **always open** (no auth required) so probes and load balancers can hit them.

### `GET /health`

Overall health snapshot. Returns `200` if healthy or degraded, `503` if unhealthy.

```json
{
  "status": "healthy",
  "uptime": 3600000,
  "errorRate": 0.02,
  "avgResponseTime": 1500,
  "avgConfidence": 0.85,
  "totalQueries": 150,
  "totalErrors": 3,
  "recentQueries": 25,
  "recentErrors": 1
}
```

### `GET /health/live`

Liveness probe. Always `200` if the process is alive.

```json
{ "status": "alive", "timestamp": "2026-06-13T10:00:00.000Z" }
```

### `GET /health/ready`

Readiness probe. Returns `200` only when at least one source is configured; `503` otherwise.

```json
{ "status": "ready", "sources": [...] }
```

Use this as your k8s `readinessProbe`. Don't route `/ask` traffic until it's `200`.

### `GET /metrics`

Aggregate query performance counters.

```json
{
  "queries": { "total": 150, "byDomain": { "general": 150 } },
  "errors": { "total": 3, "byType": { "api_error": 3 } },
  "syncs": { "total": 5 },
  "scans": { "total": 2 },
  "averages": { "responseTime": 1500, "confidence": 0.85, "searchCount": 2.3 }
}
```

### `GET /metrics/performance`

Per-iteration performance stats (useful for tuning the LLM loop).

```json
{
  "avgIterationsPerQuery": 3.2,
  "avgSearchesPerQuery": 2.1,
  "avgToolCallsPerQuery": 4.5,
  "iterationsHistogram": { "1": 30, "2": 60, "3": 40, "4": 15, "5": 5 }
}
```

### `GET /alerts/active`

All currently-active (non-dismissed) alerts.

```json
{ "alerts": [{ "id": "alert_...", "type": "stalled", "severity": "high", "title": "...", ... }] }
```

### `GET /alerts/all`

All alerts including dismissed (last 30 days).

---

## Core

### `POST /ask`

Ask a question. Returns a cited answer.

**Request:**
```json
{ "question": "Why did we switch databases?" }
```

**Response:**
```json
{
  "answer": "We switched from MySQL to Postgres in March because...",
  "citations": [
    { "type": "github", "source": "org/repo#142", "text": "PR #142: Migrate orders service to Postgres" },
    { "type": "email", "source": "msg-abc123", "text": "Sarah: I think we should..." }
  ],
  "confidence": 0.87,
  "searchCount": 2,
  "reasoningSteps": ["search_memory: 'database migration'", "found 3 candidates", "..."]
}
```

| Status | Meaning |
|---|---|
| `200` | Answer returned (may have low confidence; check the score) |
| `400` | `question` field missing |
| `500` | Internal error (LLM down, embedding model crashed, etc.) |

### `POST /sync`

Trigger a sync of one or more sources.

**Request:**
```json
{ "sources": ["github", "docs"] }
```

Omit `sources` to sync all configured sources.

**Response:**
```json
{
  "results": [
    { "source": "github", "count": 247, "status": "ok" },
    { "source": "docs", "count": 18, "status": "ok" }
  ]
}
```

`status` is one of `ok` (ingested ≥1 doc), `empty` (no new docs), or `error` (connector failed; `error` field included).

### `GET /status`

Per-connector configuration and last-sync info.

```json
{
  "status": [
    { "source": "github", "configured": true, "lastSync": "2026-06-12T...", "docCount": 1247 },
    { "source": "email", "configured": false, "lastSync": null, "docCount": 0 },
    { "source": "docs", "configured": true, "lastSync": "2026-06-13T...", "docCount": 47 }
  ]
}
```

### `GET /sources`

Same as `/status` plus the import endpoint reference.

---

## Imports

### `POST /import`

Upload one or more files. `multipart/form-data` with field `files` (up to 50) and optional `label`.

**Supported formats:** pdf, docx, xlsx, pptx, md, txt, csv, json, html, rtf, epub, code files (.ts, .py, .go, .rs, etc.), and WhatsApp chat exports.

**Limits:** 100MB per file (configurable at `src/api.ts:175`).

**Response:**
```json
{
  "imported": 3,
  "files": ["auth-migration.pdf", "team-handbook.docx", "q2-launch.xlsx"],
  "documentIds": ["file:auth-migration", "file:team-handbook", "file:q2-launch"]
}
```

### `POST /import/url`

Import a doc from a URL. SSRF-guarded: https-only, DNS-validated, private-IP-rejected, 10s timeout, 50MB body cap.

**Request:**
```json
{ "url": "https://example.com/spec.pdf", "label": "spec" }
```

**Response:**
```json
{ "imported": 1, "documentId": "url:https://example.com/spec.pdf", "url": "https://example.com/spec.pdf" }
```

**Errors:**
- `400` — URL is invalid, not https, points to a private IP, DNS lookup fails, body is too large, or the request times out
- `500` — Unexpected server error

---

## Settings (connector configuration)

All settings endpoints persist to `data/connector-config.json` and `data/email-config.json`. These files are gitignored and **contain secrets** — back them up encrypted.

### Email

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/settings/email` | List all configured mailboxes (passwords redacted) |
| `POST` | `/settings/email` | Add a new mailbox |
| `DELETE` | `/settings/email/:name` | Remove a mailbox |
| `POST` | `/settings/email/:name/test` | Test IMAP connectivity |

**POST body:**
```json
{
  "name": "Work Gmail",
  "host": "imap.gmail.com",
  "port": 993,
  "user": "me@gmail.com",
  "password": "app-password-here",
  "folders": ["INBOX", "[Gmail]/Sent Mail"],
  "smtp": { "host": "smtp.gmail.com", "port": 587, "user": "me@gmail.com", "password": "..." }
}
```

### Google Drive

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/settings/gdrive` | Get current config (secrets redacted) |
| `POST` | `/settings/gdrive` | Set new config |
| `DELETE` | `/settings/gdrive` | Clear config |
| `POST` | `/settings/gdrive/test` | Test connectivity |

**POST body (service account):**
```json
{
  "authType": "service_account",
  "serviceAccountKey": "{...service account JSON as string...}",
  "folderId": "optional-folder-id",
  "includeSharedDrives": true
}
```

**POST body (OAuth2):**
```json
{
  "authType": "oauth2",
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "...",
  "folderId": "optional-folder-id"
}
```

### Dropbox

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/settings/dropbox` | Get current config (secrets redacted) |
| `POST` | `/settings/dropbox` | Set new config |
| `DELETE` | `/settings/dropbox` | Clear config |
| `POST` | `/settings/dropbox/test` | Test connectivity |

**POST body (access token):**
```json
{
  "authType": "access_token",
  "accessToken": "sl. ...",
  "paths": ["/folder1", "/folder2"]
}
```

---

## Proactive savings

### `POST /scan`

Run the savings scanner and persist results.

**Response:**
```json
{
  "report": {
    "totalAlerts": 4,
    "highPriority": 2,
    "totalEstimatedHours": 12.5,
    "totalEstimatedDollars": 1875,
    "alerts": [...],
    "summary": "Found 2 stalled PRs and 1 duplicate-work cluster."
  }
}
```

### `GET /alerts`

All persisted alerts (active + recently dismissed) plus the trend.

**Response:**
```json
{
  "alerts": [...],
  "trend": { "trend": "improving", "weeklyAvg": 4.2 }
}
```

### `POST /alerts/:id/acknowledge`

Mark an alert as acknowledged (soft-dismissal; preserved in history).

**Response:** `{ "success": true }`

### `POST /alerts/:id/dismiss`

Dismiss an alert (won't re-appear for 30 days).

**Response:** `{ "success": true }`

---

## Delivery

### `GET /deliver/slack`

Return the formatted Slack webhook payload (for the latest scan).

**Response:** a Slack `blocks` payload.

### `POST /deliver/slack`

Post the latest scan directly to a Slack webhook.

**Request:**
```json
{ "webhookUrl": "https://hooks.slack.com/services/..." }
```

**Response:** `{ "success": true, "status": 200 }`

### `GET /deliver/email`

Return the formatted email digest for the latest scan.

**Response:**
```json
{
  "subject": "Second Brain: 4 savings opportunities ($1,875/month waste)",
  "html": "<h2>...</h2>",
  "text": "Savings Report — Jun 13\n\n..."
}
```

### `GET /deliver/digest`

Return the raw markdown digest file.

**Response:** `text/plain` (the contents of `data/digest.md`).

---

## CTO Command Center — Strategy

### `GET /strategy/overview`

Current goals, initiatives, and milestones with progress rollup.

```json
{
  "goals": [
    { "id": "goal_...", "title": "Reduce infra spend", "quarter": "2026-Q3", "progress": 0.4, "initiatives": [...] }
  ]
}
```

### `GET /strategy/goals`

List goals. Query: `?status=<draft|active|completed|archived>`.

### `POST /strategy/goals`

Create a goal. **Requires `write:strategy`** (editor or admin).

```json
{ "title": "Reduce infra spend", "quarter": "2026-Q3", "description": "Cut cloud costs by 20%", "owner": "cto", "tags": ["cost"] }
```

### `GET /strategy/goals/:id`, `PATCH /strategy/goals/:id/status`, `DELETE /strategy/goals/:id`

Read, transition, or archive a goal. Writes require `write:strategy`.

### `POST /strategy/initiatives`

Create an initiative under a goal.

```json
{ "goalId": "goal_...", "title": "Right-size EC2 instances", "quarter": "2026-Q3", "owner": "platform" }
```

### `GET /strategy/roadmaps`, `POST /strategy/roadmaps`, `GET /strategy/roadmaps/:id`

Quarterly roadmap views with milestone completion. Writes require `write:strategy`.

---

## CTO Command Center — Decisions

### `GET /decisions`

List decision records. Query: `?status=proposed|accepted|rejected|superseded` or `?q=<keyword>`.

### `POST /decisions`

Record an architectural decision. **Requires `write:decisions`**.

```json
{
  "title": "Adopt Postgres for the order service",
  "context": "MySQL is hitting scaling limits...",
  "decision": "Migrate orders service to Postgres",
  "status": "accepted",
  "options": [{ "title": "Stay on MySQL", "pros": [...], "cons": [...] }],
  "supersedes": "decision_id_optional"
}
```

### `GET /decisions/:id`

Full record with options and impact.

### `POST /decisions/:id/impact`

Analyze which memory documents a decision affects. **Requires `write:decisions`**. Uses hybrid search across the knowledge base.

```json
{ "decisionId": "..." }
```

---

## CTO Command Center — Analytics

### `GET /analytics`

Generate (and persist) a fresh analytics snapshot: rule-based insights + trends.

```json
{
  "snapshot": {
    "id": "ins_...",
    "timestamp": "2026-08-02T...",
    "summary": { "totalQueries": 42, "totalErrors": 2, "errorRate": 0.04, "documents": 1247, "decisionCount": 5, "goals": 3, "health": "healthy" },
    "insights": [{ "category": "quality", "severity": "warning", "title": "...", "detail": "...", "recommendation": "..." }],
    "trends": [{ "key": "query_volume", "title": "Daily query volume", "direction": "improving", "points": [...], "delta": 2 }]
  }
}
```

### `GET /analytics/history`

All persisted snapshots, newest first.

### `GET /analytics/diff`

Delta between the two most recent snapshots.

---

## CTO Command Center — Integrations

### `GET /integrations`

List all registered integration adapters and their config state.

```json
{
  "integrations": [
    { "name": "gitlab", "configured": false, "description": "..." },
    { "name": "jira", "configured": true, "description": "..." }
  ]
}
```

### `POST /integrations/:name/test`

Test connectivity for an adapter. **Requires `write:connectors`**.

**Response:** `{ "ok": true, "message": "..." }` or `{ "ok": false, "message": "..." }`.

Integration adapters also appear as sync sources: `POST /sync` with `{ "sources": ["gitlab", "jira"] }`.

---

## CTO Command Center — Identity & RBAC

### `GET /admin/users`

List users (safe projection — no keys). **Admin only.**

### `POST /admin/users`

Create a user. **Admin only.** Returns the API key **once**.

```json
{ "name": "Akshay", "email": "ak@company.com", "role": "editor", "teams": ["platform"] }
```

**Response:**
```json
{ "user": { "id": "...", "name": "Akshay", "email": "ak@company.com", "role": "editor" }, "apiKey": "sb_live_..." }
```

### `DELETE /admin/users/:id`, `POST /admin/users/:id/rotate-key`, `POST /admin/users/:id/revoke-key`

Manage users and keys. **Admin only.**

### `GET /admin/teams`, `POST /admin/teams`, `DELETE /admin/teams/:id`

Team management. **Admin only.**

### `GET /me`

The current caller's principal: `{ principal: { id, name, role, teams, permissions } }`.

---

## Knowledge (tagging & versioning)

### `GET /knowledge/search?q=<query>&limit=<n>`

Hybrid search across the knowledge base.

```json
{ "results": [{ "id": "github:org/repo#42", "text": "...", "metadata": { "source": "github" }, "score": 0.83 }] }
```

### `GET /knowledge/documents?tag=<t>&limit=<n>`

List documents, optionally filtered by tag (newest first).

### `GET /knowledge/documents/:id`

Fetch a single document.

### `POST /knowledge/documents/:id/tags`

Add tags. **Requires `write:knowledge`**. Tags are lowercased and deduplicated.

```json
{ "tags": ["auth", "Security"] }
```

### `DELETE /knowledge/documents/:id/tags?tags=auth&tags=security`

Remove tags. **Requires `write:knowledge`**.

### `GET /knowledge/tags`

All tags with document counts, sorted by count.

### `GET /knowledge/documents/:id/versions`

Version history, newest first. Versions are created only when content actually changes (content-hash based).

```json
{ "versions": [{ "version": 2, "hash": "...", "text": "...", "updatedAt": "..." }] }
```

### `POST /knowledge/documents/:id/versions/:version/restore`

Restore a document to a previous version's text (creates a new version). **Requires `write:knowledge`**.

---

## Dashboard & static

### `GET /`

Serve the dashboard (`public/index.html`).

### `GET /monitor`

Serve the real-time monitoring dashboard (`public/monitor/index.html`).

### `GET /settings`

Serve the settings page (`public/settings.html`).

---

## Webhooks (planned v1.1)

The following endpoints are planned for the v1.1 release and may not exist yet:

- `POST /webhooks/github` — receive GitHub events for incremental sync
- `POST /webhooks/gdrive` — receive Drive change notifications
- `GET /events` — Server-Sent Events stream for live dashboard updates

---

## Rate limits

The API itself has no rate limits. If you need to protect against abuse, put a reverse proxy (Caddy, nginx, Cloudflare) in front and rate-limit at that layer.

The LLM provider (OpenRouter) has its own rate limits, especially on the free tier. The system silently rotates through 4 free models. If all are exhausted, `/ask` will return `500` with the message "All free models rate-limited."

---

## Versioning

The API is at `v1` (implicit; no version prefix in URLs). Breaking changes will be announced in `CHANGELOG.md` with a `BREAKING:` prefix and a migration guide.

---

## CORS

CORS is open (`Access-Control-Allow-Origin: *`) by default. To restrict, set `CORS_ORIGIN=https://your-app.com` in `.env`.
