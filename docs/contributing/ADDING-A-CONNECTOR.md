# Adding a Connector to Second Brain

This guide walks you through adding a new data source — Slack, Notion, Linear, Salesforce, whatever you want — so the system can ingest from it and answer questions about it.

A shallow connector (read-only, no incremental sync, no entity resolution) takes **~1 day**. A deep connector (webhooks, incremental sync, cross-source entity linking, bi-directional writes) takes **~6 weeks**.

Most new connectors should start shallow and deepen over time.

---

## The anatomy of a connector

Every connector in Second Brain has the same shape: **a class with a `fetch()` method that returns `MemoryDocument[]`**. The system handles embedding, persistence, and search.

```typescript
// src/connectors/your-connector.ts
import type { MemoryDocument } from '../core/memory.js';

export interface YourConnectorOptions {
  // Whatever config the connector needs (API key, org ID, etc.)
  apiKey: string;
  orgId?: string;
}

export class YourConnector {
  constructor(private options: YourConnectorOptions) {}

  async fetch(): Promise<MemoryDocument[]> {
    // 1. Hit your source's API
    const response = await fetch('https://api.yoursource.com/v1/items', {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    });
    const items = await response.json();

    // 2. Normalize into MemoryDocument[]
    return items.map((item) => ({
      id: `yoursource:${item.id}`,          // stable, namespaced
      text: `${item.title}\n\n${item.body}`,  // what gets embedded
      metadata: {
        source: 'yoursource',
        type: item.type ?? 'item',
        url: item.url,
        date: item.updated_at,
        author: item.author?.email,
      },
    }));
  }
}
```

The four required fields of a `MemoryDocument`:

- `id` — stable string used for dedup. Convention: `<source>:<source-id>`. If the same doc is re-ingested, it overwrites by id.
- `text` — the content to embed and search. Convention: title + body, truncated to ~2000 chars. Don't include metadata here (it goes in the metadata field and is filterable but not embedded).
- `metadata.source` — must be a short string. Used for source filtering and for the dedup key in the savings scanner.
- `metadata.type` — a sub-category (`issue`, `pr`, `page`, `event`, `message`, `doc`).

The optional `metadata` fields:
- `url` — link back to the source (rendered in the dashboard's Sources footer)
- `date` — ISO 8601 string. Used by the savings scanner to detect "stalled" items.
- Anything else you want — the metadata is flat string/number/boolean only.

---

## The three steps

### Step 1: Write the connector

Create `src/connectors/your-connector.ts` as shown above. **A few rules:**

1. **Namespace your IDs.** Every id must be globally unique across all sources. The convention `yoursource:item-id` makes this automatic.
2. **Truncate text.** `text` should be ≤ 2000 chars. Longer docs produce worse embeddings.
3. **Set `metadata.source` consistently.** Lowercase, no spaces. Used for the savings-scanner dedup key.
4. **Handle pagination.** Most APIs return paginated results. Loop until `next` is null.
5. **Handle rate limits.** Catch 429s and back off. Use exponential backoff: `1000 * 2^attempt` ms.
6. **Handle auth errors.** Catch 401/403, throw a clear error: `throw new Error('YourSource auth failed: check YOURSOURCE_API_KEY in .env')`.
7. **Don't crash the sync on a single bad doc.** Wrap per-item work in try/catch, log the error, continue.

### Step 2: Write the operator

Every connector pairs with an operator that extends the base `Operator` class. The operator's `sync()` method is what the supervisor calls.

```typescript
// src/operators/your-operator.ts
import { Operator } from '../core/operator.js';
import type { ReasoningEngine } from '../core/reasoning.js';
import type { Memory } from '../core/memory.js';
import { YourConnector } from '../connectors/your-connector.js';
import { getEnv } from '../core/env.js'; // or use process.env directly

export class YourOperator extends Operator {
  constructor(reasoning: ReasoningEngine, memory: Memory) {
    super('yoursource', reasoning, memory);
  }

  async sync(): Promise<number> {
    const apiKey = getEnv('YOURSOURCE_API_KEY');
    if (!apiKey) {
      throw new Error('YOURSOURCE_API_KEY is not set. Add it to .env to enable YourSource sync.');
    }

    const connector = new YourConnector({
      apiKey,
      orgId: getEnv('YOURSOURCE_ORG'),
    });
    const docs = await connector.fetch();
    await this.memory.ingest(docs);
    return docs.length;
  }

  async getStatus() {
    const configured = !!getEnv('YOURSOURCE_API_KEY');
    return { source: 'yoursource', configured, lastSync: this.lastSync };
  }
}
```

The supervisor calls `operator.sync()` and expects a number (the count of ingested docs). The base `Operator` class also provides `reason()` and the reasoning loop, but for a simple connector you don't need to override it — the default routes through the supervisor's tools (`search_memory`, etc.).

### Step 3: Register in the supervisor

Open `src/core/supervisor.ts` and add the operator to the constructor:

```typescript
import { YourOperator } from '../operators/your-operator.js';

// Inside the SupervisorOperator constructor:
this.operators.set('yoursource', new YourOperator(this.reasoning, this.memory));
```

That's it. The supervisor now routes `yoursource` to your operator, includes it in `sync()`, lists it in `/status`, and makes it available to the LLM via `search_across_sources` if it passes the right `sources` array.

### Step 4 (optional): Add env vars to `.env.example`

Use the grouped format:

```bash
# ─── Connector: YourSource ───────────────────────────────────────────────────
# Get an API key at https://yoursource.com/settings/api
# YOURSOURCE_API_KEY=your-key-here

# Optional: limit to a specific org/workspace
# YOURSOURCE_ORG=your-org-name
```

### Step 5 (optional): Add a settings UI page

If your connector has a non-trivial config (OAuth flow, multi-account, etc.), add a settings panel at `public/settings.html` and a `/settings/yoursource` set of endpoints. See `src/api.ts` lines 270-468 for the email/gdrive/dropbox patterns.

For a simple API-key connector, env vars are enough. The audit found that **GitHub is the only major source that lacks a settings UI** — fixing that is on the v1.0.1 roadmap.

### Step 6: Write tests

Tests live in `src/__tests__/`. Use `mkdtempSync` for filesystem isolation:

```typescript
// src/__tests__/your-connector.test.ts
import { describe, it, expect } from 'vitest';

import { YourConnector } from '../connectors/your-connector.js';

describe('YourConnector', () => {
  it('normalizes items into MemoryDocuments', async () => {
    const connector = new YourConnector({ apiKey: 'test' });
    // Mock the fetch
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => [{ id: '1', title: 'Foo', body: 'Bar', updated_at: '2026-06-13' }],
    });

    const docs = await connector.fetch();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('yoursource:1');
    expect(docs[0].metadata.source).toBe('yoursource');
  });
});
```

For tests that need filesystem isolation (testing the operator's sync path), use the same pattern as the existing test files:

```typescript
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'your-test-'));
process.env.DATA_DIR = DATA_DIR;

afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));
```

---

## Going deep: incremental sync

The shallow pattern re-fetches everything on every `sync()`. For sources with thousands of items, that's slow and wasteful. The deep pattern uses an "incremental sync" — only fetch items changed since the last sync.

The convention is to store a sync watermark in `data/sync-state.json`:

```typescript
// In your operator
async sync(): Promise<number> {
  const state = this.loadState();           // { lastSync: '2026-06-12T...' }
  const items = await this.connector.fetchUpdatedSince(state.lastSync);
  await this.memory.ingest(items);
  this.saveState({ lastSync: new Date().toISOString() });
  return items.length;
}
```

For really large sources, use webhooks to receive change notifications in real time (see `docs/strategy/ROADMAP.md` §v2.0).

---

## Going deeper: cross-source entity linking

If your connector introduces entities (people, projects, tickets) that other sources also know about, you should add them to the linker at `src/core/linker.ts`. The linker uses entity co-occurrence to build a cross-source graph that powers the "Why is this PR stalled" cross-source answers.

The most common entities:
- **People** — extract from `@mentions`, email addresses, author fields
- **Projects** — extract from titles, labels, tags
- **Tickets** — extract from `#123` references in text

The linker is currently a regex-based extractor. For a new entity type, add a pattern in `linker.ts:23-62`.

---

## Going deepest: bi-directional writes

The deepest pattern is bi-directional: Second Brain can post back to the source. The example: when the savings scanner finds a stalled PR, the system posts a comment on the PR reminding the author.

This requires:
- Webhook receiver in Second Brain (to receive reactions to its own posts)
- A "user identity" model — is Second Brain posting as a service account or as a specific user?
- A "rate limit" model — don't post the same thing twice
- A "kill switch" — every write must be undoable

This is v2.0 territory. Don't build it for v1 of a new connector.

---

## Checklist

- [ ] `src/connectors/your-connector.ts` with `fetch(): Promise<MemoryDocument[]>`
- [ ] `src/operators/your-operator.ts` extending `Operator` with `sync()`
- [ ] Registered in `src/core/supervisor.ts` constructor
- [ ] Env vars in `.env.example` (grouped)
- [ ] Tests in `src/__tests__/your-connector.test.ts`
- [ ] (Optional) Settings UI in `public/settings.html`
- [ ] (Optional) Settings endpoints in `src/api.ts`
- [ ] (Optional) Incremental sync via `data/sync-state.json`
- [ ] (Optional) Entity linking in `src/core/linker.ts`
- [ ] (Optional) Bi-directional write support

---

## Examples to copy

The simplest connector: `src/connectors/docs-connector.ts` — reads local files. No API, no auth.

A medium-complexity connector: `src/connectors/github-connector.ts` — paginated API, rate-limit handling, multiple item types (issues, PRs, comments, READMEs).

A high-complexity connector: `src/connectors/email-connector.ts` — IMAP protocol, multiple mailboxes, MIME parsing, distribution-list handling.

A very-high-complexity connector: `src/connectors/file-import-connector.ts` — handles 15+ file formats, SSRF protection, 50MB cap, 10s timeout.

---

## When to ask for help

Open a GitHub Discussion. We respond to every one. Before opening a PR, open a Discussion with:
- What source you're adding
- Why (use case, not feature)
- Whether you're targeting shallow or deep

We'll help with design questions and review your PR.
