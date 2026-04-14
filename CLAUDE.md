# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Second Brain for Companies** — Proactive AI operators that connect to organizational data sources (GitHub, email, calendar, docs), build searchable memory, answer questions with citations, and surface savings opportunities (duplicate work, stalled projects, meeting waste).

**Core Principle:** Reason like a human would. Imperfect but functional beats perfect but absent.

## Tech Stack

- **Runtime:** Node.js + TypeScript (ES modules)
- **AI:** OpenRouter API (free models) via `openai` SDK
- **Embeddings:** `@xenova/transformers` (local, `all-MiniLM-L6-v2`, ~80MB download on first run)
- **Memory:** In-memory vector store with cosine similarity (persisted to `data/memory.json`)
- **CLI:** `commander`
- **API:** Express
- **Testing:** Vitest

## Commands

```bash
# Install dependencies
npm install

# TypeScript type-check
npx tsc --noEmit

# Run tests
npm test

# Development (watch mode)
npx tsx watch src/cli.ts

# Start API server
npx tsx src/api.ts
# Access at http://localhost:3000

# Ask a single question
npx tsx src/cli.ts ask "Why did we build feature X?"

# Ask with verbose reasoning steps
npx tsx src/cli.ts ask "..." --verbose

# Interactive chat session
npx tsx src/cli.ts chat

# Sync data sources (github,docs,email,calendar)
npx tsx src/cli.ts sync
npx tsx src/cli.ts sync --sources github,docs

# Proactive savings scan
npx tsx src/cli.ts scan

# Check configured sources and memory stats
npx tsx src/cli.ts status

# Learn interactively (question-answer session)
npx tsx src/cli.ts learn
```

## Architecture: The Operator Pattern

The system is built around **Operators** — reasoning agents that follow a **Think → Plan → Act → Observe → Respond** loop:

```
src/
├── core/
│   ├── operator.ts          # Base Operator — reasoning loop lives here
│   ├── supervisor.ts        # SupervisorOperator — routes queries across operators
│   ├── reasoning.ts         # OpenRouter LLM wrapper
│   ├── memory.ts            # Vector store (embeddings + cosine search)
│   └── tools.ts             # Tool registry for LLM function calling
├── operators/               # Domain operators (extend base Operator)
│   ├── github-operator.ts
│   ├── docs-operator.ts
│   ├── email-operator.ts
│   └── calendar-operator.ts
├── connectors/              # Data fetching from external APIs
│   ├── github-connector.ts
│   ├── docs-connector.ts
│   ├── email-connector.ts
│   └── calendar-connector.ts
├── proactive/
│   └── savings-scanner.ts  # Duplicate/stalled/waste detection
├── cli.ts                   # CLI entry point
├── repl.ts                  # Interactive chat REPL
└── api.ts                   # Express API entry point
```

### Key Flow

1. `supervisor.ask(question)` → creates Operator, passes conversation history for follow-up context
2. Operator's `reason()` loop: LLM thinks aloud → calls `search_memory`/`search_related`/`list_sources` → reflects on results → searches again or synthesizes final answer with citations
3. **Fallback mode:** Free OpenRouter models don't support function calling. The reasoning engine auto-detects this and parses `TOOL_CALL: tool_name({"json": "args"})` from plain text instead.
4. `supervisor.sync()` → connectors fetch data → ingested into memory with embeddings
5. `supervisor.scan()` → savings-scanner analyzes memory for duplicates, stalled items, meeting waste
6. REPL mode (`chat` command) → maintains conversation history for natural follow-ups

### Adding a New Connector/Operator

1. Create connector in `src/connectors/` that returns `MemoryDocument[]`
2. Create operator in `src/operators/` extending `Operator`, add `.sync()` method
3. Register in `src/core/supervisor.ts`

## Configuration

Copy `.env.example` to `.env` and configure:
- **Required:** `OPENROUTER_API_KEY` (for LLM calls)
- **GitHub:** `GITHUB_TOKEN`
- **Email:** `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`
- **Calendar:** `GOOGLE_CALENDAR_API_KEY`

All data is stored locally in `data/memory.json` with embeddings. First run downloads ~80MB model to `node_modules`.

## Memory System

- Uses `all-MiniLM-L6-v2` embeddings (downloads ~80MB on first run)
- Documents indexed by source type and searchable across all domains
- Automatic deduplication based on semantic similarity
- Persisted to `data/memory.json` (gitignored)

## AI Model

- Defaults to OpenRouter free models (override with `DEFAULT_MODEL` env var)
- Uses function calling for tool integration
- Fallback parsing for environments without native function calling support

## Key Patterns

- All operators extend `Operator` base class with `reason()` method
- Tool calls use `search_memory` and `search_related` for knowledge retrieval
- Conversation history limited to last 20 messages for context
- User profiles and meta-learning adapt to individual reasoning patterns
- Max 8 reasoning loops per query to prevent infinite loops
- Search queries should be SHORT and SIMPLE (1-3 words): "authentication login" not "authentication implementation details for the login flow"

## Testing & Development

- Tests use Vitest with `npm test`
- Run specific test files: `npx vitest run src/__tests__/savings-scanner.test.ts`
- Type checking: `npx tsc --noEmit`
- Use `--verbose` flag with `ask` command to see reasoning steps

## Learning & Adaptation

- System uses meta-learning to adapt to individual reasoning patterns
- User profiles track decision preferences and domain expertise
- Implicit feedback from follow-up questions
- Explicit feedback via `feedback` command (good/partial/bad)
- Daily questions for active learning

## Proactive Analysis

The `savings-scanner` identifies:
- Duplicate work across repositories
- Stalled PRs and issues
- Wasteful recurring meetings
- Opportunities for automation

Results are stored and can be delivered via Slack or email.