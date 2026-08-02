import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { DecisionEngine } from '../decisions/decision-engine.js';
import { Memory } from '../core/memory.js';
import { SearchEngine } from '../core/search.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let DATA_DIR: string;
let engine: DecisionEngine;

function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    title: 'ADR-0001: Choose Postgres over MySQL',
    status: 'accepted',
    context: 'We need a relational store for the billing service.',
    decision: 'Use PostgreSQL 16 with RDS.',
    rationale: 'Postgres has better JSON support and a stronger extension ecosystem.',
    options: [
      { label: 'Postgres', pros: ['JSONB'], cons: ['ops overhead'], score: 1 },
      { label: 'MySQL', pros: ['familiar'], cons: ['weaker JSON'], score: 2 },
    ],
    owners: ['cto'],
    keywords: ['postgres', 'database', 'billing'],
    relatedDocIds: [],
    supersedes: [],
    supersededBy: [],
    ...overrides,
  };
}

describe('DecisionEngine', () => {
  beforeEach(() => {
    DATA_DIR = mkdtempSync(join(tmpdir(), 'decisions-'));
    engine = new DecisionEngine(undefined, DATA_DIR);
  });

  afterAll(() => {
    if (DATA_DIR) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('records a decision with generated id and timestamps', () => {
    const rec = engine.record(baseDecision() as any);
    expect(rec.id).toMatch(/^adr_/);
    expect(rec.createdAt).toBeDefined();
    expect(rec.decidedAt).toBeDefined(); // accepted => decided
  });

  it('lists decisions newest-first', () => {
    engine.record(baseDecision({ title: 'A' }) as any);
    engine.record(baseDecision({ title: 'B' }) as any);
    const list = engine.list();
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('B');
  });

  it('filters by status', () => {
    engine.record(baseDecision({ title: 'A', status: 'proposed' }) as any);
    engine.record(baseDecision({ title: 'B' }) as any);
    const accepted = engine.list('accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].title).toBe('B');
  });

  it('updates a decision', () => {
    const rec = engine.record(baseDecision() as any);
    const updated = engine.update(rec.id, { status: 'implemented' })!;
    expect(updated.status).toBe('implemented');
    expect(updated.decidedAt).toBeDefined();
  });

  it('maintains supersedes backlinks', () => {
    const first = engine.record(baseDecision({ title: 'ADR-0001: Choose MySQL' }) as any);
    const second = engine.record(baseDecision({
      title: 'ADR-0002: Migrate to Postgres',
      supersedes: [first.id],
    }) as any);

    const chrono = engine.chronology(second.id);
    expect(chrono.ancestors).toHaveLength(1);
    expect(chrono.ancestors[0].id).toBe(first.id);

    const firstReloaded = engine.get(first.id)!;
    expect(firstReloaded.supersededBy).toContain(second.id);
  });

  it('searches by keyword', () => {
    engine.record(baseDecision({ keywords: ['postgres', 'database'] }) as any);
    engine.record(baseDecision({ title: 'F: choose redis', keywords: ['cache', 'redis'], decision: 'Use Redis', context: 'caching layer' }) as any);

    expect(engine.searchByKeyword('postgres')).toHaveLength(1);
    expect(engine.searchByKeyword('choose redis')).toHaveLength(1);
  });

  it('deletes a decision', () => {
    const rec = engine.record(baseDecision() as any);
    expect(engine.delete(rec.id)).toBe(true);
    expect(engine.get(rec.id)).toBeUndefined();
  });

  it('persists across engine instances', () => {
    const rec = engine.record(baseDecision() as any);
    const reloaded = new DecisionEngine(undefined, DATA_DIR);
    expect(reloaded.get(rec.id)!.title).toBe('ADR-0001: Choose Postgres over MySQL');
  });
});

describe('DecisionEngine impact analysis', () => {
  let memory: Memory;
  let searchEngine: SearchEngine;

  beforeEach(async () => {
    DATA_DIR = mkdtempSync(join(tmpdir(), 'decisions-impact-'));
    memory = new Memory();
    await memory.init();
    await memory.clear();
    searchEngine = new SearchEngine(memory);
    engine = new DecisionEngine(searchEngine, DATA_DIR);
  });

  afterAll(() => {
    if (DATA_DIR) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('finds related memory documents', async () => {
    await memory.store({
      id: 'doc:billing',
      text: 'The billing service schema lives in Postgres. We chose it because JSONB fits our event shapes.',
      metadata: { source: 'docs', type: 'doc' },
    });

    const rec = engine.record(baseDecision() as any);
    const impact = await engine.analyzeImpact(rec.id);
    expect(impact.relatedDocs.length).toBeGreaterThan(0);
  });

  it('finds chained decisions via keyword overlap', async () => {
    const first = engine.record(baseDecision({ title: 'A: Postgres' }) as any);
    engine.record(baseDecision({ title: 'B: Postgres partitioning', keywords: ['postgres', 'partitioning'] }) as any);

    const impact = await engine.analyzeImpact(first.id);
    expect(impact.chainedDecisions.length).toBeGreaterThan(0);
  });

  it('throws for unknown decision', async () => {
    await expect(engine.analyzeImpact('missing')).rejects.toThrow(/not found/);
  });

  it('builds a human-readable summary', async () => {
    const rec = engine.record(baseDecision({ supersedes: ['adr_old'] }) as any);
    const impact = await engine.analyzeImpact(rec.id);
    expect(impact.summary).toContain('Supersedes');
  });

  it('degrades gracefully without a search engine', async () => {
    const bare = new DecisionEngine(undefined, DATA_DIR);
    const rec = bare.record(baseDecision() as any);
    const impact = await bare.analyzeImpact(rec.id);
    expect(impact.relatedDocs).toEqual([]);
  });
});
