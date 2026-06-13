# Second Brain — Architecture

**Status:** v1.0.0 | **Last updated:** 2026-06-13

This document is for engineers who want to understand how Second Brain is put together. It is complementary to `CLAUDE.md` (which is tuned for AI assistants) and `CONTRIBUTING.md` (which is for new contributors).

---

## The Operator Pattern

The system is built around **Operators** — reasoning agents that follow a **Think → Plan → Act → Observe → Respond** loop:

```
Question
   ↓
SupervisorOperator.ask(question)
   ↓
Operator.reason()  ←──┐
   ↓                  │
   ├─ think (LLM)     │ max 8 iterations
   ├─ plan tools       │
   ├─ act (call tool)  │
   ├─ observe result   │
   └─ reflect ─────────┘
       ↓
   parseFinalAnswer (extracts citations)
       ↓
   answer with confidence + citations
```

The same loop runs for every source. The base class lives at `src/core/operator.ts`. Domain operators (GitHub, Email, Calendar, Drive, Dropbox, docs) extend the base and add a `sync()` method that pulls from their source and writes to memory.

---

## Module map

```
src/
├── core/                    # Foundation
│   ├── operator.ts          # Base Operator class — the reasoning loop
│   ├── supervisor.ts        # SupervisorOperator — routes queries across operators
│   ├── reasoning.ts         # OpenRouter LLM client + fallback parser
│   ├── memory.ts            # Vector store: embeddings + cosine similarity
│   ├── search.ts            # SearchEngine — score threshold + metadata filtering
│   ├── linker.ts            # CrossSourceLinker — entity extraction + cross-source joins
│   ├── tools.ts             # Tool registry for LLM function calling
│   ├── json-extract.ts      # Robust JSON object extraction from LLM responses
│   ├── alerting.ts          # Alert rules + health metrics
│   ├── metrics.ts           # Query performance + error rate counters
│   ├── logger.ts            # Structured logger (JSON or pretty)
│   ├── user-model.ts        # Per-user Bayesian preference model
│   ├── system-model.ts      # Cross-session learned patterns
│   ├── connector-config-store.ts  # Per-connector config persistence
│   └── email-config-store.ts      # Email account config persistence
│
├── operators/               # Domain operators (one per source)
│   ├── github-operator.ts
│   ├── docs-operator.ts
│   ├── email-operator.ts
│   ├── calendar-operator.ts
│   ├── gdrive-operator.ts
│   └── dropbox-operator.ts
│
├── connectors/              # Data fetching from external APIs
│   ├── github-connector.ts
│   ├── docs-connector.ts
│   ├── email-connector.ts
│   ├── calendar-connector.ts
│   ├── gdrive-connector.ts
│   ├── dropbox-connector.ts
│   ├── smtp-connector.ts
│   └── file-import-connector.ts  # URL/URL-list/URL-file/folder/file imports
│
├── proactive/               # Push (no question required)
│   ├── savings-scanner.ts   # Duplicate work, stalled PRs, meeting waste
│   └── delivery.ts          # Alert storage, Slack + email formatting
│
├── learning/                # Self-improving user model + meta-learning
│   ├── meta-learning.ts     # 7-day analysis window, weak/strong domains
│   ├── extraction-engine.ts # Extracts decision patterns from synced docs
│   ├── question-generator.ts # Daily questions to fill knowledge gaps
│   └── profile-updater.ts   # Explicit + implicit feedback → user model
│
├── middleware/
│   └── auth.ts              # Bearer token auth (optional via API_KEY env)
│
├── cli.ts                   # CLI entry point
├── repl.ts                  # Interactive chat REPL
├── api.ts                   # Express API + dashboard server
└── public/                  # Static web assets
    ├── index.html           # Dashboard
    ├── settings.html        # Connector config
    └── monitor/             # Real-time ops dashboard
```

---

## Data flow

### A question gets answered

```
1. CLI/API receives question
2. supervisor.ask(question, history?)
   - Creates new Operator (or reuses)
   - Passes conversation history (last 20 messages)
3. Operator.reason() loop (max 8 iterations):
   a. THINK: LLM is prompted with question, memory context, tool definitions
   b. PLAN: LLM emits either:
      - TOOL_CALL: search_memory({"query": "...", "k": 5})
      - TOOL_CALL: search_across_sources({"query": "...", "sources": [...]})
      - TOOL_CALL: find_connections({"doc_id": "...", "depth": 2})
      - CITATIONS: [ { type, source, text }, ... ]  ← final answer
   c. ACT: Execute the tool, get result
   d. OBSERVE: Append result to LLM context
   e. REFLECT: Did the result advance the answer? If not, search again.
4. parseFinalAnswer(text)
   - Try JSON.parse of { answer, citations, confidence }
   - On fail, fall back to extractCitationsFromText (regex-based)
5. If confidence > 0.3 with citations: run verification pass
   - Separate LLM call asks "is this answer supported by the cited evidence?"
   - If verification < 0.5: revise with "Your answer needs revision"
6. Return { answer, citations, confidence, reasoningSteps, verified }
```

The free OpenRouter models we default to don't reliably emit function-calling JSON, so the reasoning engine also parses `TOOL_CALL: name({json})` from plain text. The fallback parser at `src/core/reasoning.ts:200-280` uses progressive strategies: code-fence strip, greedy match, lazy match, first-brace-to-last-brace. See `src/core/json-extract.ts` for the shared helper.

### A sync runs

```
1. supervisor.sync(sources?)
2. For each enabled source:
   a. Operator.sync() — pulls from API, returns MemoryDocument[]
   b. For each doc: memory.upsert(doc) — embed + persist
   c. Persist
3. Return { source: count, ... }
```

A source's `sync()` method calls its connector's `fetch()`, normalizes the response into `MemoryDocument[]` (id, text, metadata), and embeds + stores them. New docs flow through `extraction-engine.ts:65-100` which asks the LLM to extract decision patterns — but only when the doc contains keyword signals (e.g. "decided", "chose", "agreed").

### A scan runs

```
1. supervisor.scan()
2. For each chunk of memory (getAllRange, 1000 docs/page):
   a. Find duplicates via LLM pairwise comparison
   b. Find stalled items (issues/PRs >30d no activity)
   c. Find meeting waste (recurring events with low attendance/short duration)
   d. Find orphaned (PRs with no assignee >7d)
   e. Find context-switch (person mentioned >5 sources/day)
3. Deduplicate against prior alerts by (type, source, title)
4. Persist as dismissible alerts
5. Generate digest (markdown + Slack payload + email HTML)
```

The savings scanner is the proactive layer — it answers "what should I act on today?" without the user having to ask.

---

## Key abstractions

### `MemoryDocument` (`src/core/memory.ts:5-9`)

The unit of indexing. Every piece of data — a GitHub issue, an email, a doc, a calendar event — becomes a `MemoryDocument` with:
- `id`: stable string (e.g. `github:org/repo#42`)
- `text`: the embedded content (typically title + body, truncated to 2000 chars)
- `metadata`: `{ source, type, url, date, ... }` — flat string/number/boolean only

### `Operator` (`src/core/operator.ts`)

The reasoning base class. Every domain operator extends it. The key methods:
- `reason(question, history?)` — the Think-Plan-Act-Observe loop
- `sync()` — domain-specific data fetch
- `getStatus()` — health for `/status` and `/health`

### `SearchEngine` (`src/core/search.ts`)

Sits on top of `Memory`. Adds:
- Score threshold filtering (drop results below 0.3 cosine)
- Metadata filters (source, type, date range)
- Top-k with diversity (avoid returning 5 near-duplicates)

### `CrossSourceLinker` (`src/core/linker.ts`)

Extracts people-entities (emails, @mentions) and uses them to find connections across documents. The "linker" is what makes the system "cross-source" rather than "multi-source." Without it, we have parallel indexes; with it, we have a graph.

---

## Persistence

All state is local file storage under `data/`:

```
data/
├── memory.json          # Vector store: all MemoryDocuments + embeddings
├── user-model.json      # Per-user Bayesian preference model
├── system-model.json    # Cross-session learned patterns
├── alerts.json          # Active + dismissed savings alerts
├── digest.md            # Latest markdown savings digest
├── email-config.json    # Per-mailbox IMAP config (sensitive — gitignore)
├── connector-config.json # Per-connector config (sensitive — gitignore)
└── demo/                # (planned v1.0.1) Acme Co. demo corpus
```

The `data/` directory is gitignored. Tests use `process.env.DATA_DIR` to redirect to a tmpdir.

### Why a single JSON file for memory?

The `memory.json` file is the source of truth for v1.0.0. It works because:
- It's `git diff`-able, `scp`-able, and survives without a backend
- It lets an org keep all memory on-prem with zero infra
- For a single-tenant self-hosted product, scale is bounded (10k-100k docs typical)

The trade-off: writes are full-file rewrites (slow past 10k docs) and there's no concurrent-write safety. The migration target for v2.0 (Team Memory) is `pgvector` or `LanceDB` for multi-tenant with concurrent writes. See `docs/strategy/ROADMAP.md` §v2.0.

---

## The learning loop

The system "learns" in three layers:

1. **Within-session (Operator.reason loop)** — the LLM sees the user's question and re-ranks results based on confidence. No persistence, no profile mutation.

2. **Across-sessions (UserModelManager)** — when a user marks feedback (`feedback good/partial/bad`) or follows up, `ProfileUpdater` calls `UserModelManager.updateDimension()`. Dimensions like `risk_tolerance`, `speed_vs_thoroughness`, `communication` shift via a Bayesian weighted mean. The next `ask` injects the user model into the system prompt — the answer adapts.

3. **Across-sources (SystemModel)** — the extraction engine finds decision patterns in synced docs and stores them as `learned_patterns`. The audit (`docs/strategy/MOAT-ANALYSIS.md`) found that **this layer is currently write-only**: patterns are stored but not read back at decision time. The v1.1 visible-personalization work is what turns this on.

---

## Tool surface (LLM function calling)

The supervisor exposes 4 tools to the LLM:

| Tool | Args | Purpose |
|---|---|---|
| `search_memory` | `{query, k?, source?}` | Cosine search over the vector store |
| `search_related` | `{doc_id, k?}` | Find documents related to a given doc |
| `search_across_sources` | `{query, sources}` | Multi-source parallel search |
| `find_connections` | `{doc_id, depth?}` | Cross-source entity link graph |

The free OpenRouter models we use don't reliably emit function-calling JSON, so the reasoning engine also accepts a `TOOL_CALL: name({"json": "args"})` plain-text format. The `parseToolCallsFromText` regex is at `src/core/reasoning.ts:200`.

---

## API surface

See `docs/reference/API.md` for the full list. Key endpoints:

- `POST /ask` — main question endpoint
- `POST /sync` — trigger a source sync
- `POST /scan` — run the savings scanner
- `GET /alerts` — active alerts
- `POST /alerts/:id/acknowledge` — dismiss an alert (auth-gated)
- `GET /health` — health probe
- `GET /metrics` — query performance counters
- `GET /status` — connector status
- `POST /import/url` — import a doc from a URL (SSRF-guarded)
- `POST /import/file` — upload a doc (PDF/DOCX/etc)
- `POST /deliver/slack` — post digest to Slack webhook
- `GET /deliver/email` — get HTML+text email digest

---

## Adding a new connector

See `docs/contributing/ADDING-A-CONNECTOR.md` for the full guide. The short version:

1. **Connector** at `src/connectors/your-connector.ts` — returns `MemoryDocument[]`
2. **Operator** at `src/operators/your-operator.ts` — extends `Operator`, adds `sync()`
3. **Register** in `src/core/supervisor.ts` alongside existing operators
4. **Env vars** in `.env.example` (use the grouped format already there)
5. **Settings UI** (if web-config is desired) at `public/settings.html`
6. **API endpoints** in `src/api.ts` for save/test/list
7. **Tests** at `src/__tests__/your-connector.test.ts` — use `mkdtempSync` + `process.env.DATA_DIR` for isolation

A shallow connector (list endpoints only) takes ~1 day. A deep connector with webhooks, incremental sync, entity resolution, and bi-directional writes takes ~6 weeks.

---

## What's intentionally NOT here (and why)

- **No web framework for the UI.** The web UI is vanilla HTML + CSS + JS, served by Express as static files. A SPA framework would add a build step and 200kB of JavaScript for a 4-page app. We chose the boring option deliberately.
- **No vector DB at v1.0.0.** The `memory.json` file works for single-tenant. Migration to `pgvector` or `LanceDB` is planned for v2.0 (Team Memory) when concurrent writes become a problem.
- **No background job system.** The savings scanner is on-demand (CLI or cron). A proper queue (BullMQ, Inngest) is planned for v1.1 Daily Digest.
- **No multi-tenant.** The system has no concept of "user" beyond the local `UserModelManager` singleton. Multi-tenancy is the v2.0 work.
- **No fine-tuned embedding model.** Free, fast `all-MiniLM-L6-v2` is good enough. A custom model is a 6-month, 1-engineer-half-time project that buys maybe +3% recall. See `docs/strategy/ROADMAP.md` §"What we are NOT building."
