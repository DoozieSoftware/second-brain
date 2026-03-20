# Second Brain for Companies — v1.0 Release & GTM Design

**Date:** 2026-03-20
**Status:** Approved

---

## Problem

The codebase is at v0.1.0 with a working implementation of all core features (Q&A, savings scanner, self-improving user model, 4 connectors, web dashboard). However it is not ready for public OSS release because:

1. Core reasoning loop has known quality gaps — search noise, no cross-source linking, no answer verification, context degrades across loops
2. No API authentication — any public deployment is open to abuse
3. npm binary is broken for consumers (`bin` points to `.ts` file)
4. No Docker or easy setup story
5. No README, CONTRIBUTING, or OSS hygiene
6. No defined open core tier structure

## Goals

- Ship a v1.0 OSS release that earns GitHub stars and HN front page
- Establish the open core product structure for future cloud and enterprise monetization
- Target: founders/solo operators (early adopters) and SMB CTOs/VPs (monetization path)
- Distribution: OSS-first, organic traction before any paid plans

## Non-Goals (deferred to v1.1+)

- Multi-user / team accounts
- Managed cloud hosting and billing
- SSO / SAML
- Scheduled auto-sync
- Paid plan enforcement
- Enterprise sales motion

---

## Design

### Approach: Parallel Tracks

Two independent tracks run simultaneously. Launch when both are complete.

**Track 1 — Technical completion:** Finish the in-flight reasoning quality work (existing plan `2026-03-18-core-reasoning-quality.md`) plus launch-blocker fixes.

**Track 2 — OSS launch prep:** Everything that makes the repo discoverable, runnable, and trustworthy to a new visitor. Most of Track 2 is fully independent of Track 1 (Docker, OSS hygiene, issue templates, `.env.example`, CI). Exception: the README demo GIF and YouTube video require Track 1A reasoning quality to be complete first — do not record demos until the reasoning loop is producing good output.

---

### Track 1A: Reasoning Quality Completion

Full details in `docs/superpowers/plans/2026-03-18-core-reasoning-quality.md`. Summary of remaining work:

| Component | File | Status |
|---|---|---|
| SearchEngine integration into Operator | `src/core/operator.ts` | Not wired yet |
| CrossSourceLinker | `src/core/linker.ts` | Not started |
| Operator: new tools (search_across_sources, find_connections) | `src/core/operator.ts` | Not started |
| Finding accumulator + context management | `src/core/operator.ts` | Not started |
| Answer verification phase | `src/core/operator.ts` | Not started |
| Supervisor: pass SearchEngine to Operators | `src/core/supervisor.ts` | Not started |
| Tests: SearchEngine, CrossSourceLinker, verification | `src/__tests__/` | Partial |

The SearchEngine class (`src/core/search.ts`) exists and is correct. The gap is wiring it into the rest of the system.

**Track 1A acceptance criteria (release gate):** Track 1A is complete when: (1) the Operator uses SearchEngine on every query with score threshold filtering, (2) at least one cross-source link is returned when available, and (3) the verification phase blocks answers with unsupported citations. All existing tests pass and `npx tsc --noEmit` reports zero errors.

### Track 1B: Launch Blockers

| Task | File | Detail |
|---|---|---|
| API authentication | `src/api.ts` | Bearer token middleware, reads `API_KEY` from env. Return 401 if missing/wrong. Skip auth if `API_KEY` not set (dev mode). |
| Fix npm binary | `package.json` | Add `#!/usr/bin/env tsx` shebang to `src/cli.ts`, or add a compiled JS wrapper. `bin` should work with `npx`. |
| Health check endpoint | `src/api.ts` | `GET /health` returns `{ status: "ok", version: "1.0.0" }` — needed for Docker healthcheck |
| Data directory hygiene | `data/.gitkeep` | Ensure `data/memory.json` is in `.gitignore`, `data/alerts.json` is in `.gitignore`, directory exists via `.gitkeep` |
| GitHub Actions CI | `.github/workflows/ci.yml` | Run `npm test` and `npx tsc --noEmit` on every push and PR |

---

### Track 2: OSS Launch Prep

#### README.md

Structure:
1. **Hero** — one-sentence pitch + demo GIF of dashboard answering a real question
2. **The three pillars** — Q&A with citations, savings scanner with dollar estimates, learns your style
3. **Quick start** — clone → `.env` → `docker compose up` → working in 5 minutes
4. **Connector setup** — per-source setup guide (GitHub PAT, IMAP, Google Calendar, local docs)
5. **Architecture** — the Operator pattern diagram, interesting to developers
6. **Open core** — what's free forever, what's coming in cloud
7. **Contributing** — link to CONTRIBUTING.md

The hook: lead with a real savings scanner output. Dollar numbers are visceral.

#### Docker

- `Dockerfile` — multi-stage build, Node.js 22 alpine, production-ready
- `docker-compose.yml` — mounts `./data` for persistence, exposes port 3000, `env_file: .env`
- Health check uses `GET /health`

#### OSS Hygiene

| File | Content |
|---|---|
| `LICENSE` | MIT |
| `CONTRIBUTING.md` | How to add a connector, run tests, PR process, code style |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Structured bug report |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Feature request with use case |
| `.github/ISSUE_TEMPLATE/connector_request.md` | New data source request |
| `.env.example` | Rewritten: grouped by connector, required vs optional marked, links to API key docs |

---

### Open Core Tier Structure

The OSS core is complete and genuinely useful forever. Paid tiers add scale and convenience, not capability gatekeeping.

**Guiding principle:** CLI delivery endpoints (`/deliver/slack`, `/deliver/email`) ship in OSS but require manual triggering. Cloud automates the scheduling. The value of automation is what's paid, not the feature itself.

| Feature | OSS (free, self-hosted) | Cloud (paid, v1.1+) | Enterprise (paid license, v1.1+) |
|---|---|---|---|
| Q&A with citations | Yes | Yes | Yes |
| All 4 connectors | Yes | Yes | Yes |
| Savings scanner | Yes | Yes | Yes |
| Learning / user model | Yes | Yes | Yes |
| CLI + API + Dashboard | Yes | Yes | Yes |
| Unlimited memory docs | Yes | Yes | Yes |
| Scheduled auto-sync | No | Yes | Yes |
| Multi-user / teams | No | Yes | Yes |
| Slack/email auto-delivery | No | Yes | Yes |
| Team usage dashboard (query volume, top users) | No | Yes | Yes |
| SSO / SAML | No | No | Yes |
| Audit logs | No | No | Yes |
| Air-gapped deployment | No | No | Yes |
| SLA + priority support | No | No | Yes |

**No telemetry:** OSS installs never send data home. Zero phone-home. This must be true and verifiable in the source code.

**Indicative pricing (to finalize at v1.1):**
- Cloud: $49-99/mo for founders, $299-599/mo for SMB teams
- Enterprise: annual contract from $10k/yr

---

### GTM Strategy

#### Positioning Statement

> "Second Brain for Companies — your organization's memory. Ask anything about your GitHub, email, docs, and calendar. Surface duplicate work and wasted meetings automatically. Gets smarter about your team over time. Open source and self-hostable."

#### Phase 1 — Launch Day

Goal: 200+ GitHub stars, HN front page.

| Channel | Action |
|---|---|
| Show HN | "Show HN: Second Brain for Companies — AI that connects GitHub, email, calendar, docs and surfaces wasted time/money." Post Tuesday or Wednesday morning. |
| Twitter/X thread | Founder thread: problem → demo GIF → how it works → repo link. Target founder + indie hacker audience. |
| Reddit | r/selfhosted (Docker angle), r/sideprojects, r/entrepreneur |
| Dev.to / Hashnode | "How we built an AI that reasons across your entire company's data" — explains the Operator pattern with code, links to repo |

**Hook:** Lead with the savings scanner dollar output. "Found $12,000/month in duplicate work on first scan" beats any feature description.

#### Phase 2 — Traction Building (200-1000 stars)

Goal: Community momentum, connector ecosystem growth, cloud waitlist.

| Channel | Action |
|---|---|
| GitHub Discussions | Enable discussions, respond personally to every early issue |
| Connector releases | Build new connectors (Notion, Linear, Jira) publicly, announce each — each is a new distribution moment |
| Indie Hackers | Milestone posts every 100 stars: "Here's what we learned from 500 self-hosters" |
| YouTube | 5-min demo: sync GitHub → ask "why did we build X?" → run savings scan → show dollar output |
| Cloud waitlist | "Get notified when cloud launches" banner in README and dashboard. Implementation: Loops or Typeform link embedded as a badge in README and surfaced in dashboard settings page. Set up before launch. |

#### Phase 3 — Monetization (1000+ stars or first enterprise inbound)

| Signal | Action |
|---|---|
| 1000 GitHub stars | Open cloud beta, invite waitlist, start charging at month 2 |
| Enterprise inbound (company 50+ people) | Close first self-hosted license deal, use as case study |
| 5+ community connector PRs | Announce "connector ecosystem" — positions product as a platform |

#### What NOT to do at v1.0

- No paid ads (CAC too high at this stage)
- No cold outreach (earn trust through OSS first)
- No enterprise sales motion (too complex, wrong stage)

---

## Files Changed

### Track 1A (Reasoning Quality — from existing plan)
| File | Change |
|---|---|
| `src/core/search.ts` | Already exists — integrate into Operator |
| `src/core/linker.ts` | New — CrossSourceLinker |
| `src/core/operator.ts` | Modify — wire SearchEngine + Linker, verification, finding accumulator |
| `src/core/supervisor.ts` | Modify — pass SearchEngine to Operators |
| `src/__tests__/search.test.ts` | New |
| `src/__tests__/linker.test.ts` | New |
| `src/__tests__/verification.test.ts` | New |

### Track 1B (Launch Blockers)
| File | Change |
|---|---|
| `src/api.ts` | Add bearer token auth middleware, health endpoint |
| `src/cli.ts` | Add tsx shebang |
| `package.json` | Fix bin entry |
| `data/.gitkeep` | New |
| `.gitignore` | Add `data/memory.json`, `data/alerts.json`, `data/digest.md` (`digest.md` is the proactive savings digest generated at runtime by the scan-and-store flow) |
| `.github/workflows/ci.yml` | New — test + typecheck |

### Track 2 (Launch Prep)
| File | Change |
|---|---|
| `README.md` | New — full launch README |
| `Dockerfile` | New |
| `docker-compose.yml` | New |
| `LICENSE` | New — MIT |
| `CONTRIBUTING.md` | New |
| `.env.example` | Rewrite — grouped, annotated |
| `.github/ISSUE_TEMPLATE/bug_report.md` | New |
| `.github/ISSUE_TEMPLATE/feature_request.md` | New |
| `.github/ISSUE_TEMPLATE/connector_request.md` | New |

---

## Success Criteria for v1.0

**Release gates (must be true before OSS launch):**
- `npm test` passes with zero failures
- `npx tsc --noEmit` passes with zero errors
- `docker compose up` produces a working instance in under 5 minutes on a fresh machine
- The savings scanner returns actionable output with dollar estimates on a synced repo
- A new visitor can understand the product in 60 seconds from the README
- Track 1A acceptance criteria met (see above)
- Cloud waitlist collection mechanism is live and tested before launch

**GTM scorecard (reviewed at Day 7 post-launch, not a release gate):**
- HN post reaches front page (top 30)
- 200+ GitHub stars in first week
- At least 3 community issues or questions filed
- At least 1 cloud waitlist signup
