# Second Brain — User Guide

This is for end users — engineers, ops leads, CTOs — who want to use Second Brain to answer questions about their organization's data and find savings opportunities.

If you want to *build* Second Brain (add a connector, deploy to your infra, contribute code), see `docs/strategy/ARCHITECTURE.md` and `docs/contributing/CONTRIBUTING.md` instead.

---

## What Second Brain does

Three things, in plain English:

1. **You ask questions about your team's work.** "Why did we switch databases?" "What's blocking the Q2 launch?" "Who owns billing decisions?" — and you get a cited answer drawn from your GitHub issues, emails, calendar events, and docs.

2. **It surfaces waste automatically.** Duplicate work happening in two repos. PRs sitting unreviewed for 30 days. Recurring meetings with low signal. Each finding has an estimated dollar cost.

3. **It gets smarter about how you ask.** After enough questions, it learns that you prefer terse answers, or code-first responses, or that you always ask about a specific domain. The next answer adapts.

All of this runs on your own infrastructure. Your data stays on your machine. Only LLM API calls (configurable; defaults to OpenRouter free models) leave the box.

---

## Quick start

```bash
# 1. Get the code
git clone https://github.com/your-org/second-brain.git
cd second-brain

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env — at minimum, add OPENROUTER_API_KEY (free at https://openrouter.ai)

# 4. (Optional) Add source credentials
# GITHUB_TOKEN=ghp_...  for GitHub issues/PRs
# IMAP_HOST=...         for email
# GOOGLE_CALENDAR_API_KEY=... for calendar

# 5. Start the dashboard
npm run api
# → open http://localhost:3000

# 6. Or use the CLI
npx tsx src/cli.ts ask "What are we currently building?"
npx tsx src/cli.ts sync --sources docs,github
npx tsx src/cli.ts scan
```

**The 30-second version:** install, add an OpenRouter key, sync your docs folder, ask a question. The first `ask` will pause to download an 80MB embedding model; subsequent runs are fast.

---

## Common commands

### `ask` — ask a question

```bash
# Quick answer
npx tsx src/cli.ts ask "What did we ship last week?"

# Show the reasoning steps (what the LLM searched, what it found, what it cited)
npx tsx src/cli.ts ask "Why did we pick Postgres?" --verbose

# Ask within a specific source
npx tsx src/cli.ts ask "What's the status of the auth PR?"
```

The answer is printed with:
- The answer text
- A list of **citations** (the source docs the LLM drew from)
- A **confidence score** (0-100%)
- Reasoning steps (if `--verbose`)

### `chat` — interactive REPL

```bash
npx tsx src/cli.ts chat
```

Starts a multi-turn session. The last 20 messages of context are passed to the LLM, so you can ask follow-up questions naturally. Type `exit` to leave.

### `sync` — pull new data

```bash
# All enabled sources
npx tsx src/cli.ts sync

# Specific sources
npx tsx src/cli.ts sync --sources github
npx tsx src/cli.ts sync --sources github,docs,email

# The first sync of a source takes longer (full backfill).
# Subsequent syncs pull only new/changed docs.
```

### `scan` — find savings

```bash
npx tsx src/cli.ts scan
```

Runs the savings scanner. Output is a markdown report (also saved to `data/digest.md`) listing:
- Duplicate work (e.g. "the same OAuth logic is in 3 repos")
- Stalled PRs/issues (open >30 days with no activity)
- Meeting waste (recurring events with low attendance or short duration)
- Orphaned items (no assignee for >7 days)
- Context-switch hotspots (a person mentioned in >5 sources/day)

Each alert has a `type`, `severity`, `description`, `sources`, and an `action` field. Dismiss noisy alerts; they stay archived for 30 days.

### `status` — show what's configured

```bash
npx tsx src/cli.ts status
```

Shows which sources have credentials configured and the current memory size. Useful when something's not syncing.

### `feedback` — teach the system

```bash
npx tsx src/cli.ts feedback good
npx tsx src/cli.ts feedback partial
npx tsx src/cli.ts feedback bad --reason "wrong citation"
```

Marks the last answer. The system uses this to update the user model. Over time, your answers will reflect your preferences.

### `learn` — fill knowledge gaps

```bash
npx tsx src/cli.ts learn
```

Asks you 5 questions about domains where the system has detected low confidence. Your answers become new memory and the user model adapts. Run weekly.

---

## What "good" looks like

### A good question

✅ "Why did we choose Postgres over Dynamo for the orders service?"
✅ "What did @sarah decide about the auth migration?"
✅ "What's blocking PR #423 from being merged?"

❌ "What is the meaning of life?" (no relevant memory exists)
❌ "Why did we do everything the way we did it?" (too broad; the LLM will hedge and cite nothing)

The system works best with **specific, factual questions** that have citable answers in your connected sources.

### A good answer

A good answer has:
- A direct response to the question
- 1-3 citations that point to specific docs
- A confidence score ≥ 70%

If you see a low confidence score, the system is admitting it doesn't have enough memory. The fix is usually: sync more sources, or ask a more specific question.

### A good alert

A good alert:
- Names the specific problem ("PR #423 stalled for 45 days")
- Estimates the cost ("~$1,200 in waiting review time")
- Suggests an action ("ping @sarah for review")

Alerts without a clear action are noise. Use `dismiss` to clean them up; the system learns from dismissal patterns.

---

## Source-specific notes

### GitHub

- Token: Personal Access Token from https://github.com/settings/tokens
- Required scope: `repo` (or `public_repo` for public repos only)
- Optional: `GITHUB_ORG=your-org-name` to limit scope to a single org
- Pulled: issues, PRs, comments, READMEs (per accessible repo)
- First sync: 5-15s per repo. Be patient if you have 20+ repos.

### Email (IMAP)

- Required: `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`
- For Gmail, you need an [App Password](https://support.google.com/accounts/answer/185833) (not your real account password)
- Multiple mailboxes supported — see the Email settings page
- Pulled: last 90 days of message subjects + bodies
- Connectors writes to `data/email-config.json` (encrypted at rest is a v1.1 roadmap item)

### Google Calendar

- Required: `GOOGLE_CALENDAR_API_KEY`
- Pulled: events for the last 30 days + next 30 days
- Each event becomes a `MemoryDocument` with attendees and meeting notes (if any)

### Google Drive

- Two auth modes: OAuth2 (interactive) or service-account JSON key
- Configured through the Settings page, not `.env`
- Pulled: Google Docs, Sheets, Slides in folders you specify

### Dropbox

- Auth: short-lived access token (or full OAuth flow in v1.1)
- Pulled: files in specified folders, parsed (PDF/DOCX/MD)

### Docs (local)

- No setup. Scans `./docs` by default, or any folder you point it at
- Parsed: `.md`, `.txt`, `.yaml`, `.json`
- This is the easiest first source to try

---

## Tips

- **Start with docs.** It requires no credentials and is the fastest way to see the system work.
- **Add GitHub second.** It's the most-cited source in real use; questions about PRs and decisions cluster there.
- **Email and calendar come third.** They're high-value but high-sensitivity. Add them when you trust the system.
- **Use `--verbose`** on important questions to see the reasoning. You'll learn what the system knows and where its blind spots are.
- **Run `scan` weekly.** It's the highest-leverage feature. The first time you see "duplicate work in 3 repos, est. $4,200/wk" you'll understand the value.
- **Run `feedback` honestly.** The system is a Bayesian model — every signal helps.

---

## When something goes wrong

### "No information"

The system couldn't find relevant memory. Either:
- The source isn't connected (check `status`)
- The question is too specific or too broad
- The data hasn't been synced yet (run `sync`)

### "Low confidence"

The system found partial evidence but isn't sure. Try:
- A more specific question
- Syncing more sources
- Reading the citations in the answer — they may already contain the answer

### "Model download stalled"

The first run downloads an 80MB embedding model. If it stalls:
- Check your internet connection
- Check `~/.cache/huggingface/` for partial downloads (delete and retry)
- Use `--no-embeddings` to disable embeddings (you'll lose search quality)

### "OpenRouter rate limit"

Free OpenRouter models have rate limits. The system silently rotates through 4 free models, but if all are exhausted:
- Wait a few minutes
- Get a paid OpenRouter key (much higher limits)
- Or set `DEFAULT_MODEL=` to a specific model you have access to

### "Sync failed for X"

A connector hit an error. The CLI prints `❌ github: failed — <message>`. Common causes:
- Expired token (regenerate and re-add)
- Rate limit (wait and retry)
- Repo permissions (the token doesn't have access to that repo)

For persistent failures, check the `data/` logs and the connector's README in the repo.

---

## What's next

- **Roadmap:** `docs/strategy/ROADMAP.md`
- **Architecture:** `docs/strategy/ARCHITECTURE.md`
- **FAQ:** `docs/reference/FAQ.md`
- **Adding a connector:** `docs/contributing/ADDING-A-CONNECTOR.md`
- **Contributing code:** `CONTRIBUTING.md`
