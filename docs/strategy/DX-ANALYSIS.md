# Second Brain — Developer Experience Audit

**Date:** 2026-06-13
**Author:** Strategy team
**Inputs:** Full read of `README.md`, `.env.example`, `package.json`, `src/cli.ts`, `src/repl.ts`, `src/api.ts`, all `public/*.html`; skim of all connectors

---

## Time-to-aha verdict (one sentence)

**Today: 30-45 min for a confident aha, 90 min to "this is useful," 4 hours to "this is dialed in." The advertised "10 minutes to first aha" is aspirational, not achievable on a fresh box.**

---

## Per-step install path audit

### Step 1: `git clone && npm install`

- **Cold-start wall time:** ~90-180s on a clean machine (network-bound npm install + first-run model download). On a warm cache: ~10s.
- **What the user sees:** 19 production deps (octokit, imapflow, googleapis, dropbox SDK, @xenova/transformers, openai, multer, express, cheerio, mammoth, pdf-parse, etc.) plus 12 devDeps. `node_modules` resolves to **~718MB**.
- **First-run gotchas:**
  1. The `@xenova/transformers` package downloads the all-MiniLM-L6-v2 embedding model (~80MB) silently on first run of any command that instantiates the memory store. The user thinks the CLI is hung.
  2. TypeScript is run via `tsx` at startup (~1.5s cold) on every command.
  3. README's Docker quickstart references `https://github.com/your-org/second-brain.git` — placeholder, will 404.
- **Failure modes:** Missing Node 22, no internet for model download, README points to non-existent repo URL.
- **Top papercut:** **The 80MB embedding model download is invisible.** First `ask` or `sync` stalls for 30-90s with no progress bar.

### Step 2: Configure OpenRouter API key

- **Manual actions:** 3 (copy .env.example → .env, edit file, save). User must know how to obtain an OpenRouter key and that free tier exists.
- **Failure modes:** Free-tier key that hits rate limits silently rotates through 4 other free models, which is opaque.
- **Top papercut:** **No `npx second-brain init` wizard.** User must read .env.example, understand env vars, and edit a dotfile manually.

### Step 3: Configure a source (GitHub)

- **Manual actions:** 4+ (open GitHub in browser, generate token, choose scopes, paste into .env).
- **No UI for this.** Only Email, Google Drive, and Dropbox have `/settings` pages with web forms. GitHub is env-var-only.
- **Top papercut:** **No settings UI for the most common connector (GitHub).** Users must hand-edit `.env`. Email, GDrive, and Dropbox all have nice web forms; GitHub doesn't, which is inconsistent and surprising.

### Step 4: `npm run sync -- --sources github`

- **Per-repo time:** ~5-15s per repo. With 5-20 repos typical for a dev, full sync is **2-8 minutes**.
- **What the user sees:** Banner "🔄 Syncing sources: github", then... silence. Final output: clean table: `github: 247 documents`. No per-repo breakdown, no "this took 4m12s".
- **Hidden cost:** The extraction engine silently runs an LLM pass on every new doc to extract decision patterns, which is *another* 30-120s of LLM calls you didn't ask for, billed against your free OpenRouter quota.
- **Top papercut:** **No progress indicator and a hidden 80MB model download + LLM extraction pass on first run.** A user runs `sync`, gets a silent 2-8 minute wait, and has no idea whether the CLI is alive.

### Step 5: `npm run ask "Why did we build X?"`

- **Wall time:** 5-30s for first ask (embeddings + LLM cold), 3-10s for warm asks on small memory.
- **Quality:** Mixed. Free OpenRouter models (Nemotron-9b, Llama-3.2-3b) are weak at citation faithfulness.
- **Top papercut:** **The 5-30s first-ask latency is invisible.** No "loading model..." indicator, no streaming of the answer text.

### Step 6: `npm run scan`

- **Time:** 30s-5min depending on memory size and LLM rate limits.
- **Quality:** Actionable. Detects duplicate work, stalled PRs, meeting waste, orphaned issues. Each alert has an `action` field.
- **Top papercut:** **Scans are heavyweight and offer no preview/dry-run.** A user with 5000 docs waits 3 minutes and may get 30 generic alerts they didn't ask for.

---

## Time-to-aha paths

### Path A: Pure local (no API keys except OpenRouter)
1. `git clone && npm install` — 2 min
2. `cp .env.example .env`, paste OpenRouter key — 2 min
3. Open browser → openrouter.ai → sign up → create key — 5 min
4. `npm run ask "What is this project?"` — 2 min (waits for model download ~60s + LLM 5s)

**At ~11 min: a working CLI that answers questions from docs. Aha is partial.**

### Path B: With GitHub connected
1. Steps 1-3 above — 9 min
2. Browser → github.com/settings/tokens → create PAT with `repo` scope — 4 min
3. Edit `.env`, paste token — 1 min
4. `npm run sync -- --sources github` — 5 min (wait 2-5 min for sync)
5. `npm run ask "What are we working on?"` — 2 min

**At ~21 min: GitHub-grounded answers. Aha is real.**

### The dashboard win
The dashboard at `http://localhost:3000` is the biggest unused win: the README pushes users to `npm run ask` on the CLI, but a chat UI with a sync button and a settings link is right there at `/`. New users are routed past it. If the README quickstart started with `npm run api` and `open http://localhost:3000`, the perceived time-to-aha would drop to ~7 min (model download + first ask via the web UI).

---

## UX audit summary

| Surface | Score | Top-3 issues |
|---|---|---|
| **CLI / REPL** | 5/10 | 1. No history, no tab completion, no spinner (`repl.ts:28-98`). 2. No `npx second-brain init` / `setup` subcommand. 3. Failure vs empty is indistinguishable (`supervisor.ts:155` silently logs and continues). |
| **Web UI** | 4/10 | 1. 3 pages with 3 different palettes, no shared design system. 2. No real-time updates (only `monitor/index.html` polls). 3. Auth silently 401s when `API_KEY` is set in `.env` because HTML pages don't send the header. |
| **Error story** | 4/10 | 1. Logger (`src/core/logger.ts`) is built but bypassed in 12+ modules. 2. No progress bar for the 80MB embedding download. 3. No redaction of secrets in error messages. |

---

## 10-min-to-aha design (the new first-run flow)

| Time | What the user sees | What the system does |
|------|-------------------|----------------------|
| **0:00** | Terminal opens with a single ANSI banner: `🧠 Second Brain — 10 minutes to aha`. A spinner: "Checking environment… Node ✓ npm ✓" | Detects Node version, OS, GPU (embedding model). Sets a 9-min total budget, displayed as `▓▓▓▓░░░░░░ 0:00 / 10:00` |
| **0:15** | One prompt: `OpenRouter API key (free at openrouter.ai): ****` — pasted, masked. Optional `[Enter to skip — we'll use a built-in key for the demo]`. | Validates key against OpenRouter in <2s. Falls back to bundled key for `--demo`. |
| **0:45** | A "First Run" menu: `1) Use demo data (recommended)  2) Connect GitHub  3) Connect docs folder  4) Skip — just show me`. Default highlighted: **1**. | Pre-selects demo if running in CI/sandbox. |
| **1:00** | Banner: "Loading 1,000 synthetic docs from Acme Co. (a fake 40-person startup)…" Spinner, 80MB embedding model download shows `12MB / 80MB ▓▓░░░░░░░░ 15%`. | Streams model + docs in parallel. |
| **1:45** | `Embedding 1,000 docs…` with a live counter: `847 / 1000` | Runs embeddings in batches of 50, persists to `data/memory.json` |
| **2:30** | Three pre-built "aha" questions appear in a picklist: `> What's blocking the Q2 launch?` `  How did we decide on Postgres over Dynamo?` `  Who's the decision-maker for billing?` User picks one. | Index built, supervisor ready. |
| **3:00** | First answer streams in, 2-3 sentences with **3 inline citations** (one GitHub issue, one email, one doc). | Confidence 0.87. |
| **5:00** | "Now try your own:" prompt. Free-text. | Live search across demo data. |
| **7:00** | "Run it on your real data:" panel — three big buttons: **GitHub**, **Docs folder**, **Email**. | Onboard wizard starts here. |
| **10:00** | A green checkmark + "You just asked one question and got a cited answer from 3 sources. Welcome to Second Brain." | Persists session, opens browser to localhost:3000 dashboard. |

### The two demo paths

**`--demo` mode (ship Week 1):**
- Flag: `npx second-brain --demo` (also triggered automatically if no `OPENROUTER_API_KEY` and no connectors)
- Corpus: "Acme Co." — 40-person SaaS startup
  - 1,000 docs total
  - **GitHub:** 120 issues, 80 PRs, 25 READMEs (across 6 repos: `web`, `api`, `mobile`, `infra`, `ml`, `docs`)
  - **Email:** 400 messages across 12 threads (launch decisions, hiring, customer escalations, vendor negotiations)
  - **Docs:** 60 markdown files (strategy, RFCs, post-mortems, runbooks)
  - **Calendar:** 315 events
- Generated by a deterministic seed so every user gets identical results.
- 5 pre-baked questions with known good answers and citation graphs (used in CI).

**Hosted public demo (ship Week 3):**
- `https://demo.second-brain.dev` — a web UI with a read-only slice of the Acme corpus, no signup, rate-limited.
- Used in the README hero image, in tweets, and in the `--help` output of the CLI itself.

### `npx second-brain onboard` — the wizard

A guided, resumable, fail-soft setup. Eight steps, each skippable:

1. **Welcome + value framing** (10s). "Connect GitHub and we can answer questions about PRs, issues, and decisions."
2. **GitHub** — prompts for a PAT, hits `/user` to validate, asks "which orgs/repos?" via checkbox list.
3. **Docs folder** — defaults to `./docs`, lets user pick or drag a folder.
4. **Email** — hidden behind `--with-email` flag in v1.0.
5. **Calendar** — same as email: opt-in flag.
6. **Slack/email delivery** for proactive scans — opt-in, OAuth flow.
7. **Embeddings model** — auto-detects. "We need to download an 80MB model. Skip? [Y/n]"
8. **First real question** — guided walkthrough. Pre-fills: `"What did the team ship last week?"` because it works on almost any corpus.

### `npx second-brain wow` — the instant insight

One command, one surprising, cross-source insight, under 30 seconds.

```
$ npx second-brain wow

🔍 Scanning your last 30 days of connected data…

  ✓ 47 GitHub issues
  ✓ 312 emails
  ✓ 1,204 docs
  ✓ 89 calendar events

┌──────────────────────────────────────────────────────────────┐
│ 💡 You spent 23 hours in 4 meetings about "Q2 planning" this │
│    week. The same topic as the doc `Q2-strategy.md` that 3  │
│    people have edited in the last 6 days. Two of those      │
│    people weren't in any of the meetings.                    │
│                                                              │
│    → Open the doc  |  → See the meetings  |  → Mute          │
└──────────────────────────────────────────────────────────────┘
```

Five detectors running in parallel:
1. Meeting-vs-doc convergence (calendar topic clusters near edited doc titles)
2. Stakeholder shadows (people editing docs who never appear in related meetings)
3. Decision latency (decisions made in email but not propagated to docs within 14 days)
4. Email-loop detection (threads >6 replies with no doc/reference)
5. Sleeper decisions (resolved PRs whose conclusions never made it to a doc)

---

## Ranked DX improvements

| # | Improvement | Build cost | Impact (1-5) |
|---|---|---|---|
| 1 | **Stream a progress bar + model-download indicator** during the first command | S | 5 |
| 2 | **Add `npx second-brain init`** that creates `.env`, validates the key, configures the first source | M | 5 |
| 3 | **Lead the quickstart with `npm run api`** and the web dashboard URL | S | 5 |
| 4 | **Wire `core/logger.ts` into supervisor, reasoning, memory, and all connectors** | S | 4 |
| 5 | **Add `redactKeys` to logger** so OpenRouter keys + IMAP passwords don't print | S | 4 |
| 6 | **`second-brain profile` shows live dimension values** (the user model, visible) | S | 4 |
| 7 | **Web UI tokens consolidation: extract `public/tokens.css`** (3 pages × 3 palettes) | S | 3 |
| 8 | **Settings UI: move Test button next to Save** (not just on list) | S | 3 |
| 9 | **Fix web UI silent-401 when `API_KEY` is set in `.env`** | S | 3 |
| 10 | **Readline history + tab completion + a progress-aware REPL** (`~/.second_brain_history`) | M | 3 |
| 11 | **Add `second-brain doctor` that scans env and proposes connectors** | S | 3 |
| 12 | **Distinguish "sync failed" from "sync empty" in CLI output** (use ✅/⚠️/❌) | S | 3 |
| 13 | **Cold-start: gate dashboard with "Downloading AI model (~80MB), this takes a few minutes…" splash** | S | 2 |
| 14 | **Stream `ask` response text** (LLM token streaming) | M | 4 |
| 15 | **Pre-baked "What did the team ship last week?" question everywhere** | S | 3 |

---

## 4-week implementation plan

### Week 1 — The 7-minute demo path
- **Ship:** `npx second-brain --demo` with the Acme Co. corpus + `--demo` mode that auto-loads it.
- **Acceptance:** Fresh `git clone` → cited answer in ≤7 min on a cold cache, ≤90s on a warm cache. CI test that the 5 pre-baked questions return answers with ≥0.7 confidence.
- **Owner:** 1 engineer. ~5 days of corpus generation + CLI plumbing.

### Week 2 — The wizard and `wow`
- **Ship:** `npx second-brain onboard` (GitHub + Docs only by default) and `npx second-brain wow`.
- **Acceptance:** A user with zero config can go `onboard → wow` in ≤4 minutes. `wow` returns an insight in ≤30s on warm cache.
- **Owner:** 1 engineer. Reuses existing connector code, adds `aha-finder.ts` and `onboard.ts`.

### Week 3 — Hosted demo + rewrite README
- **Ship:** `demo.second-brain.dev` (Vercel + a small Express app exposing a read-only `/ask` and `/wow` over the same Acme corpus, rate-limited to 10 req/min/IP).
- **Ship:** New README per the design above. Hero gif recorded from the Week 1 flow.
- **Acceptance:** README is ≤300 lines. Time-to-aha on a fresh visitor (hosted demo) ≤3 min.

### Week 4 — Polish, telemetry-free metrics, and the 4-week retrospective
- **Ship:** Progress bar in every command. `--resume` for `onboard`. Pre-baked "What did the team ship last week?" everywhere. Mute/dismiss for `wow` insights. The "first session" trail in the dashboard.
- **Acceptance:** A non-technical beta tester (PM friend) can complete the full flow without help.

---

## What to cut from the default path

| Cut from default | Move to | Rationale |
|------------------|---------|-----------|
| **Email connector** (IMAP, SMTP) | `--with-email` flag | Highest setup cost, lowest demo value |
| **Calendar connector** | `--with-calendar` flag | Privacy sensitivity. Only valuable after user trusts the tool |
| **Google Drive / Dropbox** | opt-in | Already gated by auth, just make it explicit |
| **`learn` command** | `second-brain learn` (not in `onboard`) | Powerful but distracting from aha |
| **`profile` / `evolution` / `analyze`** | `/dashboard` page | CLI clutter |
| **`/alerts` / `delivery` API endpoints** | `second-brain alerts` subcommand | Pro users only |
| **Docker compose path** | `docs/docker.md` | The default `npx` path covers 95% of users |
| **Open Core pricing table** | `CLOUD.md` (when cloud ships) | Speculative, distracts from the product |
| **`/api/*` reference in main README** | `docs/api.md` | The 6-page table is a wall that 99% of users never need on first read |
| **The 80MB model download warning** | silent, with a `--no-embeddings` flag | Real users want embeddings. Warning invites a 5-min deliberation that kills the aha |

**Result:** a default path that ships GitHub + Docs + LLM, plus a `--demo` mode that ships **zero configuration** and a one-command wizard. Everything else exists, but doesn't appear until the user is ready for it.
