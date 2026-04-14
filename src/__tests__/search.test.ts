import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchEngine } from '../core/search.js';
import type { Memory } from '../core/memory.js';
import type { SearchResult } from '../core/memory.js';

// Mock Memory
const createMockMemory = (results: SearchResult[]): Memory => ({
  search: vi.fn().mockResolvedValue(results),
  getAll: vi.fn().mockResolvedValue([]),
  upsert: vi.fn().mockResolvedValue(undefined),
  count: results.length,
} as unknown as Memory);

describe('SearchEngine', () => {
  const sampleResults: SearchResult[] = [
    {
      id: '1',
      text: 'Authentication implementation in PR #42',
      score: 0.85,
      metadata: { source: 'github', type: 'pr', date: '2026-03-15' },
    },
    {
      id: '2',
      text: 'Meeting notes about auth',
      score: 0.45,
      metadata: { source: 'calendar', type: 'event', date: '2026-03-10' },
    },
    {
      id: '3',
      text: 'Low relevance document',
      score: 0.15,
      metadata: { source: 'docs', type: 'document', date: '2026-02-01' },
    },
  ];

  it('should filter results below minScore threshold', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication', { minScore: 0.3 });

    expect(results).toHaveLength(2);
    expect(results.every(r => r.score >= 0.3)).toBe(true);
  });

  it('should filter by source', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication', { source: 'github' });

    expect(results).toHaveLength(1);
    expect(results[0].metadata.source).toBe('github');
  });

  it('should filter by type', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication', { type: 'pr' });

    expect(results).toHaveLength(1);
    expect(results[0].metadata.type).toBe('pr');
  });

  it('should filter by dateAfter', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication', { dateAfter: '2026-03-01' });

    expect(results).toHaveLength(2);
    expect(results.every(r => r.metadata.date >= '2026-03-01')).toBe(true);
  });

  it('should track search history', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    await engine.search('auth');
    await engine.search('login');

    expect(engine.getSearchHistory()).toEqual(['auth', 'login']);
  });

  it('should default minScore to 0.25', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication');

    expect(results).toHaveLength(2);
    expect(results.every(r => r.score >= 0.25)).toBe(true);
  });

  it('should clear search history', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    await engine.search('auth');
    expect(engine.getSearchHistory()).toHaveLength(1);

    engine.clearHistory();
    expect(engine.getSearchHistory()).toHaveLength(0);
  });

  it('should combine multiple filters', async () => {
    const mockMemory = createMockMemory(sampleResults);
    const engine = new SearchEngine(mockMemory);

    const results = await engine.search('authentication', {
      minScore: 0.4,
      source: 'github',
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });
});