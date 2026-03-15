# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Second Brain for Companies" — proactive AI operators that connect to organizational data sources (GitHub, email, calendar, docs), build searchable memory, answer questions with citations, and surface savings opportunities (duplicate work, stalled projects, meeting waste).

Core principle: Reason like a human would. Imperfect but functional beats perfect but absent.

## Tech Stack

- **Runtime:** Node.js + TypeScript (ES modules)
- **AI:** OpenRouter API (free models) via `openai` SDK
- **Embeddings:** `@xenova/transformers` (local, `all-MiniLM-L6-v2`)
- **Memory:** In-memory vector store with cosine similarity (persisted to `data/memory.json`)
- **CLI:** `commander`
- **API:** Express

## Commands

```bash
# Install dependencies
npm install

# TypeScript type-check
npx tsc --noEmit

# Run tests
npm test

# Run CLI commands
npx tsx src/cli.ts ask "Why did we build feature X?"  # Single question
npx tsx src/cli.ts ask "..." --verbose                # Show reasoning steps
npx tsx src/cli.ts chat                               # Interactive REPL mode
npx tsx src/cli.ts sync                               # Sync all configured sources
npx tsx src/cli.ts sync --sources github              # Sync specific source
npx tsx src/cli.ts scan                               # Proactive savings scan
npx tsx src/cli.ts status                             # Show configured sources

# Run API server
npx tsx src/api.ts
```

## Architecture: The Operator Pattern

The system is built around **Operators** — reasoning agents that follow a Think → Plan → Act → Observe → Respond loop:

```
src/
├── core/
│   ├── operator.ts        # Base Operator class — the reasoning loop lives here
│   ├── supervisor.ts      # SupervisorOperator — routes queries across operators
│   ├── reasoning.ts       # OpenRouter LLM wrapper
│   ├── memory.ts          # Vector store (embeddings + cosine search)
│   └── tools.ts           # Tool registry for LLM function calling
├── operators/             # Domain-specific operators (extend base Operator)
│   ├── github-operator.ts
│   ├── docs-operator.ts
│   ├── email-operator.ts
│   └── calendar-operator.ts
├── connectors/            # Data fetching from external sources
│   ├── github-connector.ts
│   ├── docs-connector.ts
│   ├── email-connector.ts
│   └── calendar-connector.ts
├── proactive/
│   └── savings-scanner.ts # Proactive analysis for savings opportunities
├── cli.ts                 # CLI entry point
├── repl.ts                # Interactive chat REPL
└── api.ts                 # Express API entry point
```

### Key flow
1. `supervisor.ask(question)` → creates Operator, passes conversation history for follow-up context
2. Operator's `reason()` loop: LLM thinks aloud → calls `search_memory`/`search_related`/`list_sources` → reflects on results → searches again or synthesizes final answer with citations
3. **Fallback mode:** Free OpenRouter models don't support function calling. The reasoning engine auto-detects this and parses `TOOL_CALL: tool_name({"json": "args"})` from plain text instead.
4. `supervisor.sync()` → connectors fetch data → ingested into memory with embeddings
5. `supervisor.scan()` → savings-scanner analyzes memory for duplicates, stalled items, meeting waste
6. REPL mode (`chat` command) → maintains conversation history for natural follow-ups

### Adding a new connector/operator
1. Create connector in `src/connectors/` that returns `MemoryDocument[]`
2. Create operator in `src/operators/` extending `Operator`, add `.sync()` method
3. Register in `src/core/supervisor.ts`

## Configuration

Copy `.env.example` to `.env` and set API keys for desired sources. All sources are optional — only `OPENROUTER_API_KEY` is required for the AI to work.

## Data

All ingested data is stored in `data/memory.json` (gitignored). First run of embeddings downloads ~80MB model to `node_modules`.
