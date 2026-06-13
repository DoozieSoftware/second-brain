# Changelog

All notable changes to Second Brain for Companies are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`BREAKING:` marks changes that require user action on upgrade.

---

## [1.0.0] - 2026-06-13

The first stable release. After a year of iteration, the system is ready for production self-hosted use.

### Security (severity 1)

- **Fixed:** `POST /alerts/:id/acknowledge` no longer accessible without auth. Previously, the route was declared before the `authMiddleware` mount, so anyone could dismiss any alert. Moved the route below the auth gate.
- **Fixed (SSRF):** `POST /import/url` no longer accepts arbitrary URLs. The endpoint now enforces:
  - https-only (no `http://`, no `file://`, no `data:`)
  - DNS resolution + private-IP rejection (refuses `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`)
  - 10-second `AbortSignal.timeout()` deadline
  - 50MB body cap
  - Distinguishes 4xx (client error: bad URL, private IP, etc.) from 5xx (server error) in the response

### Data loss (severity 1)

- **Fixed:** `UserModelManager` mutations now persist. Previously, `updateDimension`, `addDomainExample`, `updateDomainWeights`, and `updateGap` updated the in-memory model but never wrote to disk, so every dimension update was lost on restart.
- **Fixed:** `storeScanResults` no longer drops un-dismissed alerts on re-scan. Previously, a re-scan that didn't re-emit a prior alert would silently delete it. Now the function dedups by `(type, source, title)`, reuses prior IDs, preserves acknowledged state, and keeps prior un-dismissed alerts that the new scan didn't re-emit.
- **Fixed:** `Memory` now exposes `getRecent(limit)` and `getAllRange(offset, limit)`. Previously, `Supervisor.sync()` extracted from a 1000-doc slice via `getAll()`, so after a sync of 5000 docs, only the first 1000 were analyzed. Now sync uses `getRecent(count)` (just-ingested docs) and the savings scanner pages through the entire store.

### Functional (severity 2)

- **Fixed:** Replaced the non-greedy JSON regex `\{[\s\S]*?\}/` (which truncated on the first nested `}`) with a shared `extractJsonObject()` helper (`src/core/json-extract.ts`). Handles nested objects, code-fence wrappers, and prose-wrapped JSON. Used by `operator.ts`, `extraction-engine.ts`, and `question-generator.ts`.
- **Fixed:** `low_confidence` alert now requires `recentQueries >= 5` before firing. Previously, a fresh install with no queries would trigger a low-confidence alert on the first ask.

### Cleanup (severity 3)

- **Fixed:** Restored `extractCitationsFromText` fallback in `parseFinalAnswer`. The free OpenRouter models we default to don't reliably emit JSON, so when the documented `CITATIONS: [...]` array fails to parse, the system now regex-recovers citations from prose ("from PR #42", "[1] such-and-such", "issue #7").
- **Fixed:** `email-connector` now handles `AddressObject[]` (distribution lists) for the `to` field. Previously, the field was silently dropped on multi-recipient emails.

### Testing

- **Added:** `src/__tests__/json-extract.test.ts` — 6 tests covering nested JSON, code fences, prose wrappers, the v1.0.0 regression case.
- **Added:** `src/__tests__/user-model-persistence.test.ts` — 4 tests using `mkdtempSync` + `process.env.DATA_DIR` for isolation.
- **Added:** `src/__tests__/alert-merge.test.ts` — 3 tests for dedup, preservation of un-dismissed, no within-merge duplication.
- **Added:** `src/__tests__/memory-recent.test.ts` — 2 tests for `getRecent` and `getAllRange`.
- **Added:** `src/__tests__/ssrf-guard.test.ts` — 9 tests for SSRF protections.
- **Added:** `src/__tests__/alerting-idle-guard.test.ts` — 2 tests for the `recentQueries >= 5` guard.

**Test totals:** 87 tests across 14 files, all passing.

### Documentation

- **Added:** `docs/strategy/ARCHITECTURE.md` — full architecture document for engineers.
- **Added:** `docs/strategy/ROADMAP.md` — 18-month roadmap through Q2 2027.
- **Added:** `docs/strategy/MARKET-ANALYSIS.md` — market + 10-competitor analysis.
- **Added:** `docs/strategy/MOAT-ANALYSIS.md` — defensibility audit + 8-feature compounding roadmap.
- **Added:** `docs/strategy/DX-ANALYSIS.md` — DX audit + 10-min-to-aha design.
- **Added:** `docs/strategy/GTM-MEMO.md` — license + GTM founder memo.
- **Added:** `docs/operations/USER-GUIDE.md` — end-user guide.
- **Added:** `docs/operations/OPERATIONS.md` — self-hosting/ops guide.
- **Added:** `docs/reference/API.md` — full API reference.
- **Added:** `docs/reference/FAQ.md` — 30+ questions answered.
- **Added:** `docs/contributing/ADDING-A-CONNECTOR.md` — connector SDK deep-dive.
- **Added:** `docs/README.md` — docs index.

---

## Pre-1.0 history

Pre-1.0 development was iterative, with no formal changelog. The codebase went through ~50 commits from initial scaffolding to v1.0.0, adding:

- **v0.1** — Initial scaffolding, OpenRouter integration, basic memory store.
- **v0.2** — Operator pattern + supervisor routing.
- **v0.3** — GitHub + docs connectors.
- **v0.4** — IMAP email connector + multi-mailbox support.
- **v0.5** — Google Calendar + Drive + Dropbox connectors.
- **v0.6** — Savings scanner + delivery (Slack/email).
- **v0.7** — Web UI (dashboard + settings + monitor).
- **v0.8** — User model + meta-learning + extraction engine.
- **v0.9** — File import connector (PDF/DOCX/URL/chat dumps) + SSRF guard.
- **v0.9.5** — Verification pass, self-critique loop, JSON extraction helpers.
- **v1.0.0** — Stability + 10 production-blocking fixes. First formal release.

---

## Upgrade notes

### From 0.9.x to 1.0.0

- **No data migration required.** `data/memory.json`, `data/user-model.json`, and `data/alerts.json` from 0.9.x are forward-compatible.
- **Action recommended:** back up `data/` before upgrading.
- **Action recommended:** if you were relying on `user-model.json` mutations persisting immediately, they now do. To migrate any 0.9.x in-memory state to disk, restart the server.
- **Behavior change:** `low_confidence` alerts now require `recentQueries >= 5`. If you have an alerting integration that fires on the first low-confidence answer, you'll need to wait for 5 queries.
- **Behavior change:** alerts are now deduped across scans by `(type, source, title)`. The same alert re-detected on subsequent scans will preserve its ID and acknowledged state, not create a new one.

### From 1.0.0 to 1.0.1 (planned)

No breaking changes. Stability, DX, and logger hardening. Watch the v1.0.1 release notes for the env-var rename of any deprecated vars.

---

## Conventions

- **Major version (X.0.0):** Breaking changes to the API, data formats, or operator interface. Migration guide included.
- **Minor version (0.X.0):** New features, new connectors, new API endpoints. Backwards-compatible.
- **Patch version (0.0.X):** Bug fixes, perf improvements, internal refactors. No new surface area.
