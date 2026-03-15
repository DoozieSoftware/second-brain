# Second Brain for Companies

AI-powered organizational memory. Connect your data sources, ask questions, find savings.

## What It Does

Second Brain connects to your organization's tools — GitHub, email, calendar, documents — and builds a searchable memory. Then it does two things:

1. **Answers questions** — Ask "Why did we build feature X?" and get an answer with citations from PRs, meetings, emails, and docs.

2. **Finds savings** — Automatically scans for duplicate work across repos, stalled PRs/issues, and wasteful recurring meetings.

## Quick Start

```bash
# Install
npm install

# Configure (only OPENROUTER_API_KEY is required)
cp .env.example .env
# Edit .env with your API keys

# Sync your data sources into memory
npx tsx src/cli.ts sync --sources docs

# Ask questions
npx tsx src/cli.ts ask "What projects are we working on?"

# Interactive chat
npx tsx src/cli.ts chat

# Find savings opportunities
npx tsx src/cli.ts scan
```

## Architecture

Built on the **Operator Pattern** — reasoning agents that follow a Think → Plan → Act → Observe → Respond loop:

```
src/
├── core/
│   ├── operator.ts        # Base operator — the reasoning loop
│   ├── supervisor.ts      # Routes queries, manages conversation
│   ├── reasoning.ts       # OpenRouter LLM client
│   ├── memory.ts          # Vector store with embeddings
│   └── tools.ts           # Tool registry for function calling
├── operators/             # Domain operators (GitHub, docs, email, calendar)
├── connectors/            # Data fetching from external APIs
├── proactive/
│   └── savings-scanner.ts # Duplicate/stalled/waste detection
├── cli.ts                 # CLI entry point
├── repl.ts                # Interactive chat mode
└── api.ts                 # HTTP API server
```

## Data Sources

| Source | What it ingests | Config needed |
|--------|----------------|---------------|
| GitHub | Repos, issues, PRs, READMEs | `GITHUB_TOKEN` |
| Docs | Markdown, text, YAML files | None (local) |
| Email | Inbox messages via IMAP | `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` |
| Calendar | Google Calendar events | `GOOGLE_CALENDAR_API_KEY` |

## Commands

```bash
# Ask a question
npx tsx src/cli.ts ask "Why did we choose PostgreSQL?"

# Interactive chat session
npx tsx src/cli.ts chat

# Verbose mode (shows reasoning steps)
npx tsx src/cli.ts ask "..." --verbose

# Sync specific sources
npx tsx src/cli.ts sync --sources github,docs

# Scan for savings
npx tsx src/cli.ts scan

# Check status
npx tsx src/cli.ts status

# Run HTTP API
npx tsx src/api.ts
# POST /ask {"question": "..."}
# POST /sync
# GET /alerts
# GET /status
```

## AI Model

Uses [OpenRouter](https://openrouter.ai) with free models by default. Set `OPENROUTER_API_KEY` in `.env`. Override the model with `DEFAULT_MODEL` env var.

## Memory

All ingested data is stored locally in `data/memory.json` using local embeddings (`all-MiniLM-L6-v2`). No data leaves your machine except LLM API calls to OpenRouter.

## Adding a Connector

1. Create `src/connectors/your-connector.ts` that returns `MemoryDocument[]`
2. Create `src/operators/your-operator.ts` extending `Operator`
3. Register in `src/core/supervisor.ts`

## License

MIT
