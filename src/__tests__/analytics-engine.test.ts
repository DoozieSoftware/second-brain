import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { AnalyticsEngine } from '../analytics/analytics-engine.js';
import type { Memory } from '../core/memory.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let DATA_DIR: string;
let engine: AnalyticsEngine;

function query(overrides: Partial<{ domain: string; confidence: number; responseTime: number; success: boolean; timestamp: string }> = {}) {
  return {
    id: 'q',
    question: 'What is X?',
    domain: overrides.domain ?? 'engineering',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    responseTime: overrides.responseTime ?? 500,
    confidence: overrides.confidence ?? 0.8,
    searchCount: 2,
    sourcesUsed: ['github'],
    success: overrides.success ?? true,
  };
}

function error(overrides: Partial<{ type: string; timestamp: string }> = {}) {
  return {
    id: 'e',
    type: overrides.type ?? 'llm',
    message: 'boom',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

const emptyMemory = { count: 0 } as unknown as Memory;

describe('AnalyticsEngine', () => {
  beforeEach(() => {
    DATA_DIR = mkdtempSync(join(tmpdir(), 'analytics-'));
    engine = new AnalyticsEngine(DATA_DIR);
  });

  afterAll(() => {
    if (DATA_DIR) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('flags empty knowledge base as critical', () => {
    const snap = engine.generate({ memory: emptyMemory });
    const critical = snap.insights.find(i => i.category === 'coverage');
    expect(critical).toBeDefined();
    expect(critical!.severity).toBe('critical');
    expect(critical!.title).toContain('empty');
  });

  it('warns on sparse knowledge base', () => {
    const memory = { count: 5 } as unknown as Memory;
    const snap = engine.generate({ memory });
    const coverage = snap.insights.find(i => i.category === 'coverage');
    expect(coverage).toBeDefined();
    expect(coverage!.severity).toBe('warning');
    expect(coverage!.title).toContain('sparse');
  });

  it('does not warn when knowledge base is healthy', () => {
    const memory = { count: 500 } as unknown as Memory;
    const snap = engine.generate({ memory });
    expect(snap.insights.some(i => i.category === 'coverage')).toBe(false);
  });

  it('detects unhealthy status', () => {
    const snap = engine.generate({
      metrics: {
        health: {
          status: 'unhealthy',
          uptime: 1000,
          errorRate: 0.5,
          avgResponseTime: 40000,
          avgConfidence: 0.2,
          totalQueries: 10,
          totalErrors: 10,
          recentQueries: 2,
          recentErrors: 10,
        },
        queries: [],
        errors: [],
      },
      memory: { count: 100 } as unknown as Memory,
    });
    const ops = snap.insights.find(i => i.category === 'ops');
    expect(ops).toBeDefined();
    expect(ops!.severity).toBe('critical');
  });

  it('flags low-confidence domains', () => {
    const snap = engine.generate({
      metrics: {
        queries: [
          query({ domain: 'legacy', confidence: 0.2, timestamp: new Date(Date.now() - 5000).toISOString() }),
          query({ domain: 'legacy', confidence: 0.3, timestamp: new Date(Date.now() - 4000).toISOString() }),
        ],
        errors: [],
      },
      memory: { count: 100 } as unknown as Memory,
    });
    const quality = snap.insights.find(i => i.category === 'quality');
    expect(quality).toBeDefined();
    expect(quality!.title).toContain('legacy');
  });

  it('reminds when no decisions are recorded', () => {
    const snap = engine.generate({ memory: { count: 100 } as unknown as Memory, decisionCount: 0 });
    expect(snap.insights.some(i => i.category === 'decisions')).toBe(true);
  });

  it('does not flag decisions when they exist', () => {
    const snap = engine.generate({ memory: { count: 100 } as unknown as Memory, decisionCount: 5 });
    expect(snap.insights.some(i => i.category === 'decisions')).toBe(false);
  });

  it('reminds when no goals are tracked', () => {
    const snap = engine.generate({ memory: { count: 100 } as unknown as Memory, goalCount: 0 });
    expect(snap.insights.some(i => i.category === 'strategy')).toBe(true);
  });

  it('builds volume trends and detects direction', () => {
    const day1 = '2026-07-30T10:00:00Z';
    const day2 = '2026-07-31T10:00:00Z';
    const snap = engine.generate({
      metrics: {
        queries: [
          query({ timestamp: day1 }), query({ timestamp: day1 }),
          query({ timestamp: day2 }), query({ timestamp: day2 }), query({ timestamp: day2 }),
        ],
        errors: [],
      },
      memory: { count: 100 } as unknown as Memory,
    });
    const trend = snap.trends.find(t => t.key === 'query_volume');
    expect(trend).toBeDefined();
    expect(trend!.points).toHaveLength(2);
    expect(trend!.direction).toBe('improving');
    expect(trend!.delta).toBeGreaterThan(0);
  });

  it('reverses direction for error trends (increasing errors = worsening)', () => {
    const day1 = '2026-07-30T10:00:00Z';
    const day2 = '2026-07-31T10:00:00Z';
    const snap = engine.generate({
      metrics: {
        queries: [query({ timestamp: day1 })],
        errors: [
          error({ timestamp: day1 }), error({ timestamp: day1 }),
          error({ timestamp: day2 }), error({ timestamp: day2 }), error({ timestamp: day2 }),
        ],
      },
      memory: { count: 100 } as unknown as Memory,
    });
    const trend = snap.trends.find(t => t.key === 'errors');
    expect(trend).toBeDefined();
    expect(trend!.direction).toBe('worsening');
  });

  it('computes summary totals', () => {
    const snap = engine.generate({
      metrics: {
        summary: {
          uptime: 1,
          total: { queries: 42, syncs: 3, scans: 1, errors: 5 },
          hourly: { queries: 10, errors: 1, avgResponseTime: 500, avgConfidence: 0.7 },
          daily: { queries: 42, errors: 5, avgResponseTime: 600, avgConfidence: 0.7 },
          domains: { engineering: 42 },
          errors: [],
        },
        queries: [],
        errors: [],
      },
      memory: { count: 100 } as unknown as Memory,
      decisionCount: 3,
      goalCount: 2,
    });
    expect(snap.summary.totalQueries).toBe(42);
    expect(snap.summary.totalErrors).toBe(5);
    expect(snap.summary.decisionCount).toBe(3);
    expect(snap.summary.goals).toBe(2);
    expect(snap.summary.documents).toBe(100);
  });

  it('persists snapshots and lists them newest-first', async () => {
    const a = engine.generate({ memory: { count: 10 } as unknown as Memory });
    const b = engine.generate({ memory: { count: 20 } as unknown as Memory });
    const list = engine.listSnapshots();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('diffs the two latest snapshots', async () => {
    engine.generate({ memory: { count: 10 } as unknown as Memory });
    engine.generate({ memory: { count: 25 } as unknown as Memory });
    const diff = engine.diffLatest();
    expect(diff).not.toBeNull();
    expect(diff!.deltas.documents).toBe(15);
  });

  it('returns null diff when fewer than two snapshots', () => {
    expect(engine.diffLatest()).toBeNull();
  });
});
