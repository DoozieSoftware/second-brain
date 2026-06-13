# Second Brain for Companies — Roadmap

**Last updated:** 2026-06-13
**Current version:** v1.0.0
**Horizon:** 18 months (through Dec 2027)

This roadmap is the synthesis of a market analysis, a moat audit, and a developer-experience audit. Every item is rated on three axes:

- **Value** — what the user sees
- **Moat** — how much it raises defensibility (0-10)
- **Cost** — build effort (S = 1-2 weeks, M = 3-6 weeks, L = 6-12 weeks)

The principle: **every shipped feature should make the next user's experience strictly better, and ideally make the same user's experience 30 days later strictly better.** Features that fail this test are demoted regardless of how clever they are.

---

## North star (T+18mo)

**The MCP-native organizational memory layer that every agent in your company writes to and reads from — runs entirely inside your VPC, ships your CFO a quarterly dollar-denominated savings ledger, and gets sharper every week because each user's accepted answers calibrate retrieval for the next user.**

The pitch to the eng-ops-aware Series A CTO: *"You're running Claude Code, Cursor, an internal LangGraph agent, and three Zapier-style workflow bots. They all re-embed your wiki nightly. They all re-fetch the same GitHub context. None of them remember what the others did. Plug them into us via MCP."*

---

## Releases

### v1.0.1 — Patch: stability and DX cleanup (2-3 weeks, July 2026)

**Theme:** Pay down the v1.0.0 tech-debt and the small papercuts the audit surfaced. Zero new surface area.

| Item | Why | Moat | Cost |
|---|---|---|---|
| Wire `core/logger.ts` into supervisor, reasoning, memory, and all connectors | Audit showed logger is built but bypassed in 12+ modules | 0 | S |
| Add `redactKeys: ['password','token','apiKey','authorization','cookie']` to logger | OpenRouter keys + IMAP passwords currently print verbatim on error | 0 | S |
| Pass `progress_callback` to `@xenova/transformers.pipeline()` and pipe to a CLI spinner | First-run 80MB model download is the #1 trust-killer | 0 | S |
| `npx second-brain init` wizard (resumable, fail-soft) | The 30-90min install tax must become <10min | 2 | M |
| Move cold-start health check to `/health/ready`; dashboard splash on first run | Today `/ask` 502s while model downloads | 0 | S |
| Distinguish "sync failed" from "sync empty" in CLI output | `github: 0 documents` is currently indistinguishable from `github: ❌ failed` | 0 | S |
| Three web-UI tokens consolidation: extract `public/tokens.css` | The 3 pages each use a different palette | 0 | S |
| Settings UI: move Test button next to Save (not just on list) | Currently 90s to configure a connector | 1 | S |
| Fix web UI silent-401 when `API_KEY` is set in `.env` | The HTML pages don't send the auth header | 0 | S |
| Cache `npx second-brain profile`/`evolution`/`analyze` to disk in `meta-learning.ts` | Audit showed `analyzePerformance` data lost on every restart | 3 | S |

**Exit criteria:** time-to-first-aha on a fresh box < 10 min for GitHub + docs only.

---

### v1.1 — Compounding value: visible personalization + daily digest (6-8 weeks, Aug-Sep 2026)

**Theme:** Stop adding connectors. Light up the learning loop so users see the system *adapting*.

| # | Feature | Value | Moat | Cost |
|---|---|---|---|---|
| 1 | **Daily Digest** — `node-cron` inside the existing API process, output: overnight changes + top 3 alerts + 1 sentence the system now knows about you | Habit formation. First thing read = hardest thing to leave. | 6 | S |
| 2 | **Visible Personalization** — every `ask` response ends with a 1-line "Here's what I used" footer citing the dimensions applied (terse / code-first / etc.). New `second-brain profile` command shows live dimension values. New `second-brain correct <dim> <up\|down>` for one-keystroke override. | The user model is invisible. The moment users *see* the system learning, retention 2-3x's. | 8 | S |
| 3 | **MCP Server (read-only)** — first-class `@modelcontextprotocol/sdk` server exposing `search_memory`, `ask`, `recent_activity` to Claude Desktop, Cursor, and any MCP client. Stdio + streamable HTTP transports. | The 2026 wedge. Every agent becomes a distribution channel. | 9 | M |
| 4 | **Feedback-to-Memory Loop** — `POST /api/feedback` and CLI `ask --rate=up\|down`; signals become `MemoryDocument`s with `kind: feedback`; cosine boost for top-rated answers on repeat questions. | Usage becomes a flywheel. Each user's thumbs becomes a private re-ranker. | 7 | S |
| 5 | **Smart Connector Auto-Setup** — `second-brain doctor` scans env (`~/.config/gh/hosts.yml`, `~/.aws/credentials`, etc.) and proposes connectors with copy-pasteable setup hints. | Activation lever. More connectors → more memory → better answers. | 4 | S |
| 6 | **Hosted Demo** — `demo.second-brain.dev`, Vercel-hosted, pre-loaded with 6 months of public OSS data, rate-limited. | Zero-install evaluation for skeptical readers (HN, X). | 5 | M |

**Exit criteria:** ≥40% of activated installs open the digest ≥3x/week. ≥10 community PRs adding new MCP clients by month 6.

**What we cut from v1.1:** Slack/Teams bot (let community build it on top of MCP), fine-tuned embedding model (free MiniLM is good enough), cross-user shared namespace (too big for v1.1).

---

### v1.2 — Cross-source intelligence: the moat (8-12 weeks, Oct-Dec 2026)

**Theme:** The unique value vs. every single-source competitor (Notion AI, Slack AI, Glean). Connect the dots, not just the docs.

| # | Feature | Value | Moat | Cost |
|---|---|---|---|---|
| 1 | **Cross-Source Reasoner** — `ask --mode connect` requires N sources before responding; tool `link_topics(entities, depth=2)` returns the join subgraph; `--show-joins` prints the path: "GitHub PR #421 ← mentioned in email Aug 4 ← blocking calendar block Tue 10am" | The unique value. Cannot be replicated by a vector store on one silo. | 9 | M |
| 2 | **Web UI Overhaul** — single-page dashboard at `localhost:3000`: 4 panels (Activity, Digest, Alerts, Profile), settings page, live updates via SSE | DX compounds. Every feature ships visibly. | 5 | M |
| 3 | **Savings Ledger** — convert the scanner from "we found duplicates" to a signed, append-only ledger of *avoided actions*. Each row: (a) what was about to happen, (b) what we surfaced, (c) what the user did instead, (d) estimated cost delta in hours and dollars. Quarterly PDF buyers can show their CFO. | The only feature that makes the product un-cuttable in a budget review. Nothing else gets a renewal in 2027's macro. | 8 | M |
| 4 | **MCP Server (write-path)** — `record_observation`, `cite_source`, `create_memory`. Agent identity model: every write tagged with `agent_id`, `agent_session_id`, `human_principal_id`. | Memory that agents can *append to and learn from* is a knowledge substrate — compounds in a way pure retrieval never does. | 10 | M |
| 5 | **Cross-User Retrieval (per-tenant v0)** — shared index per tenant + per-user query rewriter/reranker. When user A marks an answer "good" *and* it cites a document, that (query → document) pair becomes a positive signal for user B's reranker. | The "for Companies" unlock. Network effects. | 10 | L |

**Exit criteria:** ≥30% of `--mode connect` answers cite ≥3 sources. First CFO-pitchable savings ledger PDF in the wild.

---

### v2.0 — The agentic-era product (12-18 weeks, Q1-Q2 2027)

**Theme:** Become the shared memory plane beneath every agent. Ship the moat's full shape.

| # | Feature | Value | Moat | Cost |
|---|---|---|---|---|
| 1 | **Team Memory (multi-tenant)** — `second-brain team init` creates a shared namespace; each user pushes anonymized embeddings + summaries; raw text stays local. `ask` consults local + team namespaces; results tagged `[you]`, `[team]`, `[team, anonymized]`. | The "for Companies" wedge. Once installed team-wide, replacement cost is enormous. | 10 | L |
| 2 | **A2A Discovery** — publish a `/.well-known/agent` manifest so other agents can discover *this is the org-memory agent for this tenant*. | Future-proofing. Makes us discoverable to agent-to-agent protocols. | 3 | S |
| 3 | **Workflow Integrations (5 bi-directional touchpoints)** — (1) Slack slash command `/sb` + threaded summarizer, (2) GitHub PR bot, (3) VS Code / Cursor extension via MCP, (4) Calendar pre-meeting brief, (5) Weekly ops digest email. | Workflow network effects. Removing the product means *five distinct workflow regressions* that other humans will notice. | 9 | L |
| 4 | **Entity-Resolved Graph** — PR #423 ↔ Notion "Auth v2" ↔ Slack thread #xyz ↔ Sarah-as-author, built from observed co-occurrence in your tenant. Not in any other product. Rebuilding takes 3-6 months of usage. | The good kind of switching cost. | 8 | L |
| 5 | **Hosted Cloud (commercial)** — multi-tenant control plane, team/org SSO + RBAC, audit logs, scheduled cloud sync, Slack/email delivery of proactive insights, SLA, support, per-seat analytics, billing. The wedge that funds the team. | Revenue. The thing that lets us hire eng #1. | 8 | L |

**Exit criteria:** 50-80 paying teams, $3-8k MRR, 1-2k GitHub stars, decision to raise or stay bootstrapped. The product is the moat, not the model.

---

## What we are NOT building (and why)

| Cut | Why | When to revisit |
|---|---|---|
| Native mobile app | 1-2 engineers cannot ship iOS+Android+watch+notifications+offline+secure-storage well. Web UI + MCP server cover 90% of use cases at 5% of the cost. | If a partner offers to fund it |
| Fine-tuned custom embedding model | Free `all-MiniLM-L6-v2` is good enough at v1 scale. A custom model is a 6-month, 1-engineer-half-time project that buys maybe +3% recall. | When memory > 100k docs and we measure a recall gap |
| Slack/Teams bot as a primary surface | The Daily Digest already emails; the MCP server lets Slack-native agents query memory without us owning the integration. Building a bot is a 4-week project that becomes a maintenance sink. | After MCP is stable, as a community contribution |
| Enterprise SSO / SAML / SOC2 | We're a Series A-stage product. Enterprise sales cycles kill OSS adoption momentum. The market for "SOC2-compliant self-hosted RAG" is real but the buyers want to pay $100k+ for it, and we don't have a sales motion. | If a design partner pre-commits $50k+/yr |
| More connectors (Notion, Linear, Confluence, Jira, Salesforce, Teams) | Each shallow connector is a maintenance tax. Each deep connector is a 6-8 week build. The audit's recommendation: stop adding, deepen three. | After the Cross-Source Reasoner ships and proves the architecture. Notion is the first to revisit. |
| Vector DB (pgvector / Pinecone / LanceDB) | The `memory.json` file works fine for single-tenant self-hosted. Migration is needed *only* when memory > 100k docs per tenant or when team memory needs concurrency. | When Team Memory v2.0 ships, in the same sprint |

---

## Sequencing (12-week must-ship)

| Weeks | Ship | Why now |
|---|---|---|
| 1-3 | v1.0.1: init wizard + progress bar + logger wire-up | The cheapest, highest-trust moves. |
| 3-6 | v1.1: Visible Personalization + Feedback Loop | The model is invisible; one weekend of work flips the perceived intelligence 2x. |
| 5-9 | v1.1: MCP Server (read-only) | Bigger build but 2026 timing; positions us as the agent substrate before competitors notice. |
| 9-12 | v1.1: Smart Connectors + Daily Digest + Hosted Demo | Quick wins that compound installs and ranking quality. |

Weeks 13-26: Cross-Source Reasoner → Savings Ledger → Web UI Overhaul → MCP write-path.
Weeks 27-52: Team Memory → Workflow Integrations → Hosted Cloud.

---

## Metrics

The single number we move each release:

- **v1.0.1** — Time-to-first-aha on a fresh box: **10 min** (today: 30-90 min)
- **v1.1** — % of weekly-active users who run `second-brain profile` at least once: **≥25%**
- **v1.2** — % of `--mode connect` answers citing ≥3 sources: **≥30%**
- **v2.0** — MRR: **$3-8k**. GitHub stars: **1-2k**. Paying teams: **50-80**.

---

## How this roadmap was built

- **Market & competitive analysis** (`docs/strategy/MARKET-ANALYSIS.md`) — 4 sub-agents, June 2026
- **Moat & compounding-value audit** (`docs/strategy/MOAT-ANALYSIS.md`) — 3 sub-agents, June 2026
- **Developer experience audit** (`docs/strategy/DX-ANALYSIS.md`) — 3 sub-agents, June 2026
- **GTM & licensing recommendation** (`docs/strategy/GTM-MEMO.md`) — 1 sub-agent, June 2026
- **Synthesis** — this document

If you want to change a priority, change the underlying metric. If you want to change a feature, change the *user signal* it captures — the rest follows.
