import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Memory } from '../core/memory.js';
import { SearchEngine } from '../core/search.js';
import { CrossSourceLinker } from '../core/linker.js';
import { DreamEngine } from '../dreaming/dream-engine.js';
import { DreamScheduler } from '../dreaming/dream-scheduler.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'dream-'));
process.env.DATA_DIR = DATA_DIR;

describe('DreamEngine: dedup', () => {
  let memory: Memory;
  let engine: DreamEngine;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
    engine = new DreamEngine(memory, new SearchEngine(memory), new CrossSourceLinker(new SearchEngine(memory)), DATA_DIR);
  });

  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('marks exact duplicates, keeping the original', async () => {
    const text = 'The authentication service uses JWT tokens and refresh rotation for the login flow.';
    await memory.store({ id: 'd1', text, metadata: { source: 'docs', type: 'doc' } });
    await memory.store({ id: 'd2', text, metadata: { source: 'docs', type: 'doc' } });

    const report = await engine.dream();
    expect(report.deduplicated.total).toBe(1);
    expect(report.deduplicated.examples[0].duplicateId).toBe('d2');
    expect(report.deduplicated.examples[0].keepId).toBe('d1');
    expect(report.deduplicated.examples[0].similarity).toBe(1);

    // The duplicate is marked but the original is untouched.
    const d2 = await memory.getById('d2');
    expect(d2!.metadata.duplicate_of).toBe('d1');
    const d1 = await memory.getById('d1');
    expect(d1!.metadata.duplicate_of).toBeUndefined();
  });

  it('does not re-flag docs already marked as duplicates', async () => {
    await memory.store({ id: 'd3', text: 'Unique content about billing and invoices', metadata: { source: 'docs' } });
    // Simulate a prior dream marking d3 as a duplicate.
    await memory.updateMetadata('d3', { duplicate_of: 'something' });

    const report = await engine.dream();
    const touched = report.deduplicated.examples.find(e => e.duplicateId === 'd3');
    expect(touched).toBeUndefined();
  });

  it('reports zero duplicates for distinct docs', async () => {
    await memory.store({ id: 'e1', text: 'Infrastructure cost optimization strategy for Q3 cloud spend.', metadata: { source: 'docs' } });
    await memory.store({ id: 'e2', text: 'Hiring plan for the platform engineering team next quarter.', metadata: { source: 'docs' } });

    const report = await engine.dream();
    expect(report.deduplicated.total).toBe(0);
  });
});

describe('DreamEngine: association mining', () => {
  let memory: Memory;
  let engine: DreamEngine;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
    engine = new DreamEngine(memory, new SearchEngine(memory), new CrossSourceLinker(new SearchEngine(memory)), DATA_DIR);
  });

  it('mines cross-source links for entities mentioned in multiple sources', async () => {
    await memory.clear();
    await memory.store({
      id: 'a1',
      text: 'PR #421 refactors the checkout flow. sarah@example.com is reviewing.',
      metadata: { source: 'github', type: 'pr' },
    });
    await memory.store({
      id: 'a2',
      text: 'Meeting about PR #421 with sarah@example.com tomorrow at 10am.',
      metadata: { source: 'calendar', type: 'event' },
    });
    await memory.store({
      id: 'a3',
      text: 'Checkout refactor timeline discussion. Unrelated to the above.',
      metadata: { source: 'docs', type: 'doc' },
    });

    const report = await engine.dream();
    // PR #421 spans github + calendar (2 sources) → link kept.
    expect(report.associations.totalLinks).toBeGreaterThan(0);
    const prLink = report.associations.sample.find(s => s.entity === '421');
    expect(prLink).toBeDefined();
    expect(prLink!.sources).toContain('github');
    expect(prLink!.sources).toContain('calendar');
  });

  it('ignores entities mentioned in only one source', async () => {
    await memory.clear();
    await memory.store({
      id: 'b1',
      text: 'Alice project update: alice@example.com shared the roadmap in github issues #10.',
      metadata: { source: 'github', type: 'doc' },
    });
    const report = await engine.dream();
    // alice@example.com appears in one source only → no cross-source link.
    expect(report.associations.newLinks).toBe(0);
  });
});

describe('DreamEngine: gap detection', () => {
  let memory: Memory;
  let engine: DreamEngine;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
    engine = new DreamEngine(memory, new SearchEngine(memory), new CrossSourceLinker(new SearchEngine(memory)), DATA_DIR);
  });

  it('flags low-confidence domains with enough samples', async () => {
    const queries = [
      { domain: 'legacy', confidence: 0.2, timestamp: new Date().toISOString() },
      { domain: 'legacy', confidence: 0.3, timestamp: new Date().toISOString() },
      { domain: 'api', confidence: 0.85, timestamp: new Date().toISOString() },
    ];
    const report = await engine.dream({ queries });
    const gap = report.gaps.find(g => g.domain === 'legacy');
    expect(gap).toBeDefined();
    expect(gap!.queryCount).toBe(2);
    expect(gap!.avgConfidence).toBe(0.25);
    expect(gap!.suggestion).toContain('legacy');
    // 'api' has enough samples and high confidence → not a gap.
    expect(report.gaps.find(g => g.domain === 'api')).toBeUndefined();
  });

  it('returns no gaps without query history', async () => {
    const report = await engine.dream({ queries: [] });
    expect(report.gaps).toHaveLength(0);
  });

  it('requires at least two samples per domain', async () => {
    const report = await engine.dream({ queries: [{ domain: 'rare', confidence: 0.1, timestamp: new Date().toISOString() }] });
    expect(report.gaps.find(g => g.domain === 'rare')).toBeUndefined();
  });
});

describe('DreamEngine: report', () => {
  it('produces a well-formed report', async () => {
    const memory = new Memory();
    await memory.init();
    await memory.clear();
    const engine = new DreamEngine(memory, new SearchEngine(memory), new CrossSourceLinker(new SearchEngine(memory)), DATA_DIR);
    await memory.store({ id: 'r1', text: 'Daily standup notes for the team.', metadata: { source: 'docs' } });

    const report = await engine.dream();
    expect(report.id).toMatch(/^dream_/);
    expect(report.docsScanned).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.metrics.docsBefore).toBe(1);
    expect(report.metrics.docsAfter).toBe(1); // dedup marks, does not delete
    expect(Array.isArray(report.deduplicated.examples)).toBe(true);
  });
});

describe('DreamScheduler', () => {
  it('is disabled when DREAM_ENABLED=false', () => {
    const prev = process.env.DREAM_ENABLED;
    process.env.DREAM_ENABLED = 'false';
    const s = new DreamScheduler(async () => {}, { idleMinutes: 0 });
    expect(s.isEnabled).toBe(false);
    if (prev === undefined) delete process.env.DREAM_ENABLED;
    else process.env.DREAM_ENABLED = prev;
  });

  it('fires the dream function after being idle past the threshold', async () => {
    let dreamRuns = 0;
    const s = new DreamScheduler(async () => { dreamRuns++; }, {
      enabled: true,
      idleMinutes: 0, // idle threshold = 0ms → immediately idle
      cooldownMinutes: 0,
      logFn: () => {},
    });

    // Pretend the server has been idle for a while.
    // @ts-expect-error accessing private for test
    s.lastActivity = Date.now() - 1000;

    // Trigger a check directly (bypassing the timer interval).
    // @ts-expect-error accessing private for test
    await s.check();

    expect(dreamRuns).toBe(1);
    s.stop();
  });

  it('does not fire before the idle threshold', async () => {
    let dreamRuns = 0;
    const s = new DreamScheduler(async () => { dreamRuns++; }, {
      enabled: true,
      idleMinutes: 60,
      cooldownMinutes: 0,
      logFn: () => {},
    });

    // @ts-expect-error accessing private for test
    await s.check();
    expect(dreamRuns).toBe(0);
    s.stop();
  });
});
