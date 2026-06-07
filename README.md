# Second Brain for Companies

Your organization's memory. Ask anything. Surface what's wasting time and money. Gets smarter over time.

> Open source and self-hostable. No data sent to third parties except LLM API calls.

---

## What It Does

**1. Ask anything across all your tools**
> "Why did we switch databases?" — cited answer drawn from the PR, the email thread, and the design doc that discussed it.

**2. Surface wasted time and money automatically**
> Finds duplicate work across repos, stalled PRs sitting unreviewed, and recurring meetings with low signal. Estimates the dollar cost.

**3. Gets smarter about how your team thinks**
> Learns decision-making patterns from your data. Adapts answers to match how your team reasons.

---

## Quick Start (Docker)

```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY (free at https://openrouter.ai)
docker compose up
```

Open http://localhost:3000 — the dashboard is live.

**First sync (pick your sources):**
```bash
# From the dashboard, or via curl:
curl -X POST http://localhost:3000/sync \
  -H "Content-Type: application/json" \
  -d '{"sources": ["docs", "github"]}'
```

Then ask a question:
```bash
npx tsx src/cli.ts ask "What are we currently building?"
```

## Setup Without Docker

```bash
npm install
cp .env.example .env
# Add OPENROUTER_API_KEY to .env
npx tsx src/cli.ts sync --sources docs
npx tsx src/cli.ts ask "What projects are we working on?"
```

---

## Connectors

Connect the tools your team actually uses. All connectors are optional — use only what you have.

| Source | What gets ingested | Setup |
|---|---|---|
| **GitHub** | Repos, PRs, issues, READMEs | Add `GITHUB_TOKEN` to `.env` — [get a PAT](https://github.com/settings/tokens) |
| **Docs** | Markdown, text, YAML files | No setup — scans `./docs` by default |
| **Email** | Inbox messages via IMAP | Add `IMAP_*` vars — works with Gmail, Outlook |
| **Google Calendar** | Meeting events and attendees | Add `GOOGLE_CALENDAR_API_KEY` |

Sync sources:
```bash
npx tsx src/cli.ts sync              # all configured sources
npx tsx src/cli.ts sync --sources github,docs
```

---

## CLI Reference

```bash
npx tsx src/cli.ts ask "Why did we build feature X?"    # ask a question
npx tsx src/cli.ts ask "..." --verbose                  # show reasoning steps
npx tsx src/cli.ts chat                                 # interactive REPL
npx tsx src/cli.ts sync                                 # sync all sources
npx tsx src/cli.ts sync --sources github                # sync one source
npx tsx src/cli.ts scan                                 # find savings opportunities
npx tsx src/cli.ts status                               # show connector status
```

## API Reference

```bash
# Start the API server
npx tsx src/api.ts

# Core
POST /ask                  {"question": "..."}           -> answer with citations
POST /sync                 {"sources": ["github"]}       -> sync data sources
GET  /status                                             -> connector status
GET  /health                                             -> health check (no auth)

# Proactive savings
POST /scan                                               -> run savings scan + persist
GET  /alerts                                             -> get active alerts
POST /alerts/:id/dismiss                                 -> dismiss an alert

# Delivery
GET  /deliver/slack                                      -> Slack webhook payload
POST /deliver/slack        {"webhookUrl": "..."}         -> post to Slack webhook
GET  /deliver/email                                      -> email digest (HTML + text)
GET  /deliver/digest                                     -> markdown digest file

# Auth (optional): set API_KEY in .env, then include header:
# Authorization: Bearer your-key
```

---

## Architecture

Built on the **Operator Pattern** — reasoning agents that follow a Think -> Plan -> Act -> Observe -> Respond loop:

```
src/
├── core/
│   ├── operator.ts        # Base operator — the reasoning loop
│   ├── supervisor.ts      # Routes queries, manages conversation history
│   ├── reasoning.ts       # OpenRouter LLM client with fallback parsing
│   ├── memory.ts          # Vector store (local embeddings + cosine search)
│   ├── search.ts          # SearchEngine — score threshold + metadata filtering
│   ├── linker.ts          # CrossSourceLinker — finds connections across sources
│   └── tools.ts           # Tool registry for LLM function calling
├── middleware/
│   └── auth.ts            # Bearer token auth middleware
├── operators/             # Domain operators (GitHub, docs, email, calendar)
├── connectors/            # Data fetching from external APIs
├── proactive/
│   ├── savings-scanner.ts # Duplicate / stalled / meeting waste detection
│   └── delivery.ts        # Alert storage, Slack + email formatting
├── learning/              # Self-improving user model + meta-learning
├── cli.ts                 # CLI entry point
├── api.ts                 # Express API + dashboard server
└── public/index.html      # Web dashboard
```

**How a question gets answered:**
1. `supervisor.ask(question)` creates an Operator with conversation history
2. Operator's `reason()` loop: LLM thinks -> calls `search_memory` / `search_across_sources` / `find_connections` -> reflects on results -> repeats until confident
3. Answer verification: LLM fact-checks its own answer against source evidence
4. Returns answer with citations, confidence score, and reasoning steps

---

## Open Core

Second Brain is open source (MIT) and self-hostable forever. Cloud hosting and enterprise licenses are coming — the core product will always be free to run yourself.

| Feature | Open Source | Cloud (coming) | Enterprise License (coming) |
|---|---|---|---|
| Q&A with cited answers | Free | Included | Included |
| All 4 connectors | Free | Included | Included |
| Savings scanner | Free | Included | Included |
| Self-improving user model | Free | Included | Included |
| Unlimited memory | Free | Included | Included |
| Scheduled auto-sync | — | Yes | Yes |
| Multi-user / teams | — | Yes | Yes |
| Auto Slack/email delivery | — | Yes | Yes |
| SSO / SAML | — | — | Yes |
| Audit logs | — | — | Yes |

**No telemetry.** OSS installs never phone home.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — adding a new connector takes about 30 minutes.

## License

[MIT](LICENSE)
