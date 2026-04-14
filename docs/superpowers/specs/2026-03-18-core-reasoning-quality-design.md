# Core Reasoning Quality — v1.0 Design

## Problem

The current reasoning pipeline produces unreliable answers because:

1. **Search returns noise** — no score threshold means low-relevance documents flood the LLM's context
2. **Sources are isolated** — no mechanism to find relationships between GitHub PRs, emails, calendar events, and docs
3. **No answer verification** — the LLM's final answer is trusted without checking if claims are supported by evidence
4. **Context degrades over loops** — raw search results accumulate, drowning out signal

## Design

### Architecture

```
src/core/
├── search.ts       (NEW) SearchEngine — relevance layer on Memory
├── linker.ts       (NEW) CrossSourceLinker — cross-source relationship discovery
├── operator.ts     (MODIFY) Verification phase + context management
├── memory.ts       (unchanged)
├── reasoning.ts    (unchanged)
└── tools.ts        (unchanged)
```

### Component 1: SearchEngine (`src/core/search.ts`)

Wraps `Memory` with relevance improvements.

```typescript
export interface SearchOptions {
  topK?: number;
  minScore?: number;      // default 0.25 — filter noise
  source?: string;        // filter by source: 'github', 'email', etc.
  type?: string;          // filter by type: 'pr', 'issue', 'commit', etc.
  dateAfter?: string;     // ISO date string — filter older docs
}

export class SearchEngine {
  constructor(memory: Memory)

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  // Runs memory.search(), filters by minScore, applies metadata filters
  // Deduplicates by document ID (memory already upserts by ID)

  getSearchHistory(): string[]  // queries used this session
  clearHistory(): void
}
```

**Changes to operator.ts:**
- Replace direct `this.memory.search()` calls with `this.searchEngine.search()`
- Add `source`, `type`, `min_score` parameters to `search_memory` tool
- Track search queries to avoid near-duplicate searches (improved fuzzy matching)

**Changes to search_memory tool description:**
```
Search the knowledge base. Use specific terms.
Parameters:
- query: search terms (1-5 words, specific)
- top_k: number of results (3-10)
- source: filter by source ('github', 'email', 'calendar', 'docs')
- type: filter by type ('pr', 'issue', 'commit', 'document', 'email', 'event')
- min_score: minimum relevance 0-1 (default 0.25, raise to 0.5 for precision)
```

### Component 2: CrossSourceLinker (`src/core/linker.ts`)

Finds relationships across data sources using cheap pattern matching.

```typescript
export interface Entity {
  type: 'person' | 'project' | 'pr_number' | 'issue_number' | 'date' | 'url';
  value: string;
  source: string;  // which document mentioned it
}

export interface Connection {
  entity: Entity;
  relatedDocs: SearchResult[];
  sources: string[];  // e.g., ['github', 'email']
}

export class CrossSourceLinker {
  constructor(searchEngine: SearchEngine)

  extractEntities(text: string, source: string): Entity[]
  // Regex-based extraction:
  // - PR #123, PR#123, pull request 123
  // - Issue #456
  // - @mentions / email-like patterns for people
  // - Date patterns
  // - URLs (github.com/..., docs.google.com/...)

  async findConnections(doc: SearchResult): Promise<Connection[]>
  // Extract entities from doc, search for each across all sources

  async findAcrossSources(entity: string, sources?: string[]): Promise<SearchResult[]>
  // Direct cross-source search for a specific entity

  async detectConflicts(docs: SearchResult[]): Promise<{ topic: string; docs: SearchResult[] }[]>
  // Find docs with opposing signals: approved/rejected, open/closed, etc.
}
```

**New tools registered by operator:**

1. `search_across_sources({ entity, sources? })` — find all mentions of a person/project/PR across sources
2. `find_connections({ document_id })` — given a search result, find related docs from other sources

### Component 3: Answer Verification (`operator.ts` modification)

LLM-based verification of final answers before returning.

**Flow:**
1. LLM produces `FINAL_ANSWER:` with citations
2. Parse answer into claims
3. Send verification prompt to LLM:

```
You are a fact-checker. Given a QUESTION, an ANSWER, and the SOURCE EVIDENCE,
check if each claim in the answer is supported by at least one source.

QUESTION: {original question}
ANSWER: {the proposed answer}
SOURCES: {all search results from this session}

For each claim in the answer:
- SUPPORTED: can point to a specific source
- PARTIALLY_SUPPORTED: source suggests it but doesn't directly state it
- UNSUPPORTED: no source backs this claim

Output JSON:
{
  "claims": [{"text": "...", "status": "SUPPORTED|PARTIALLY|UNSUPPORTED", "source": "..."}],
  "overall_score": 0.0-1.0,
  "issues": ["..."]
}
```

4. If `overall_score < 0.5`: append issues to messages, ask LLM to revise
5. If `overall_score >= 0.5` but has UNSUPPORTED claims: add uncertainty qualifiers
6. Include verification metadata in response:
   ```typescript
   interface OperatorResponse {
     // ... existing fields
     verification?: {
       score: number;
       issues: string[];
       checked: boolean;
     };
   }
   ```

**Cost control:**
- Verification uses a small/cheap model (can be different from main reasoning model)
- Only runs when there's a proposed final answer (not on every loop)
- Skips verification if no citations were provided (already low confidence)

### Component 4: Context Management (`operator.ts` modification)

Prevent context bloat across reasoning loops.

**Finding accumulator:**
```typescript
interface Finding {
  topic: string;
  content: string;
  source: string;
  confidence: number;
  turn: number;  // which reasoning loop found this
}

private findings: Map<string, Finding> = new Map();
```

**Changes to the reasoning loop:**
1. After each search, extract key facts → store as `Finding` objects keyed by topic
2. Before adding tool results to messages, compress: instead of raw text, pass structured findings
3. Check findings before searching: if topic already covered, skip or search differently
4. Limit total context: when findings exceed ~3000 chars, summarize older findings

**Modified `search_memory` tool handler:**
- After getting results, check for overlap with existing findings
- Merge overlapping findings rather than appending duplicates
- Return compressed format: `[{topic, key_facts, source}]` instead of raw text

**Modified nudge prompts:**
- Reference accumulated findings: "You've learned: X (from GitHub), Y (from email). What's still missing?"
- Suggest search directions based on what hasn't been covered

---

## Files Modified

| File | Change |
|------|--------|
| `src/core/search.ts` | **NEW** — SearchEngine class |
| `src/core/linker.ts` | **NEW** — CrossSourceLinker class |
| `src/core/operator.ts` | Add SearchEngine + CrossSourceLinker, verification phase, finding accumulator, new tools |
| `src/core/supervisor.ts` | Pass SearchEngine to operators |
| `src/__tests__/search.test.ts` | **NEW** — SearchEngine tests |
| `src/__tests__/linker.test.ts` | **NEW** — CrossSourceLinker tests |
| `src/__tests__/reasoning.test.ts` | Add verification tests |

## What This Does NOT Include (intentional scope control)

- No new LLM models or embedding changes
- No database migration (memory.json stays)
- No UI changes
- No new connectors/operators
- No caching layer (future optimization)

## Verification / Testing

1. **Unit tests** for SearchEngine: score threshold filtering, metadata filtering, dedup
2. **Unit tests** for CrossSourceLinker: entity extraction from various text formats
3. **Integration test**: mock reasoning with known documents, verify cross-source links found
4. **Verification test**: mock a hallucinated answer, verify the verifier catches it
5. **Manual test**: run `ask` with --verbose, observe improved search filtering and verification output

## Success Metrics

- Search results: fewer irrelevant results passed to LLM (measurable via `minScore` threshold)
- Cross-source: at least 2 new tools available to the operator
- Verification: answers with unsupported claims get flagged or revised
- Context: fewer reasoning loops needed for complex questions (target: 3-4 instead of 6-8)
