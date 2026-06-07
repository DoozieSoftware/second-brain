# Contributing to Second Brain

Thank you for contributing. This guide covers everything you need to get started.

## Development Setup

```bash
git clone https://github.com/your-org/second-brain.git
cd second-brain
npm install
cp .env.example .env
# Add at minimum: OPENROUTER_API_KEY
```

Run tests:
```bash
npm test              # run all tests once
npm run test:watch    # watch mode
npx tsc --noEmit      # type-check only
```

## How to Add a Connector

A connector fetches data from an external source and returns `MemoryDocument[]`. Here's the pattern:

**1. Create the connector** at `src/connectors/your-connector.ts`:

```typescript
import type { MemoryDocument } from '../core/memory.js';

export class YourConnector {
  async fetch(): Promise<MemoryDocument[]> {
    // Fetch data from your source
    return [
      {
        id: 'unique-stable-id',
        text: 'The text content to be embedded and searched',
        metadata: {
          source: 'your-source-name',   // e.g. 'notion', 'linear'
          type: 'document',             // e.g. 'issue', 'page', 'event'
          url: 'https://link-to-original',
          date: '2026-01-01',
        },
      },
    ];
  }
}
```

**2. Create the operator** at `src/operators/your-operator.ts`:

```typescript
import { Operator } from '../core/operator.js';
import type { ReasoningEngine } from '../core/reasoning.js';
import type { Memory } from '../core/memory.js';
import { YourConnector } from '../connectors/your-connector.js';

export class YourOperator extends Operator {
  constructor(reasoning: ReasoningEngine, memory: Memory) {
    super('your-source', reasoning, memory);
  }

  async sync(): Promise<number> {
    const connector = new YourConnector();
    const docs = await connector.fetch();
    for (const doc of docs) {
      await this.memory.upsert(doc);
    }
    return docs.length;
  }
}
```

**3. Register in supervisor** at `src/core/supervisor.ts`:

```typescript
import { YourOperator } from '../operators/your-operator.js';

// In the SupervisorOperator constructor, alongside the existing operators:
this.operators.set('your-source', new YourOperator(this.reasoning, this.memory));
```

**4. Add tests** at `src/__tests__/your-connector.test.ts`.

**5. Document env vars** in `.env.example` (see the grouped format already there).

## Architecture

The system is built on the **Operator Pattern** — reasoning agents that follow a Think → Plan → Act → Observe → Respond loop. See `src/core/operator.ts` for the core loop.

Key components:
- `src/core/memory.ts` — vector store with local embeddings and cosine similarity search
- `src/core/search.ts` — SearchEngine: score threshold filtering and metadata filters on top of Memory
- `src/core/reasoning.ts` — OpenRouter LLM client (with fallback parsing for free models)
- `src/core/supervisor.ts` — routes questions across all operators, manages conversation history
- `src/core/linker.ts` — CrossSourceLinker: finds entity connections across data sources
- `src/proactive/savings-scanner.ts` — proactive analysis for duplicate work, stalled items, meeting waste

## Pull Request Process

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Write tests first — the test should fail before your implementation
3. Implement the minimal code to make it pass
4. Ensure tests pass: `npm test`
5. Ensure types are clean: `npx tsc --noEmit`
6. Open a PR with a clear description of what and why

## Commit Style

```
feat: add Notion connector
fix: handle empty calendar response
docs: add connector guide to CONTRIBUTING
test: add CrossSourceLinker entity extraction tests
chore: bump version to 1.0.1
```

## Code Style

- TypeScript strict mode (see `tsconfig.json`)
- ES modules only (`import`/`export`, not `require`)
- No `any` where avoidable — use proper types
- Keep files focused — one clear responsibility per file

## Questions?

Open a GitHub Discussion. We respond to every one.
