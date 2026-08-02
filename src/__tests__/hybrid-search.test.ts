import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Memory } from '../core/memory.js';
import { SearchEngine } from '../core/search.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'hybrid-search-'));
process.env.DATA_DIR = DATA_DIR;

describe('Memory full-text (BM25) search', () => {
  let memory: Memory;

  beforeEach(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
  });

  it('finds exact keyword matches without embeddings', async () => {
    await memory.store({
      id: 'd1',
      text: 'Authentication implementation for the login flow using JWT tokens',
      metadata: { source: 'docs', type: 'doc' },
    });
    await memory.store({
      id: 'd2',
      text: 'Meeting notes about team velocity and sprint planning',
      metadata: { source: 'calendar', type: 'event' },
    });

    const results = await memory.searchText('authentication jwt');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('d1');
  });

  it('returns empty when no terms match', async () => {
    await memory.store({
      id: 'd1',
      text: 'infrastructure costs',
      metadata: { source: 'docs', type: 'doc' },
    });
    const results = await memory.searchText('nonexistentzzz');
    expect(results).toHaveLength(0);
  });

  it('normalizes scores to [0, 1] with the top result at 1', async () => {
    await memory.store({ id: 'a', text: 'database migration plan', metadata: { source: 'docs', type: 'doc' } });
    await memory.store({ id: 'b', text: 'pizza toppings discussion', metadata: { source: 'docs', type: 'doc' } });

    const results = await memory.searchText('database');
    expect(results[0].score).toBe(1);
    expect(results.every(r => r.score >= 0 && r.score <= 1)).toBe(true);
  });
});

describe('Memory hybrid search', () => {
  let memory: Memory;

  beforeEach(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
  });

  it('merges keyword and semantic signals', async () => {
    await memory.store({
      id: 'k1',
      text: 'The CI pipeline deploys to production on merge to main',
      metadata: { source: 'github', type: 'pr' },
    });
    await memory.store({
      id: 'k2',
      text: 'Release process for the mobile app every Friday',
      metadata: { source: 'docs', type: 'doc' },
    });

    const results = await memory.searchHybrid('CI deployment pipeline', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('k1');
  });

  it('returns full-text results when embedding model is unavailable', async () => {
    await memory.store({
      id: 't1',
      text: 'incident report root cause analysis for the outage',
      metadata: { source: 'docs', type: 'incident' },
    });
    await memory.store({
      id: 't2',
      text: 'board game night planning',
      metadata: { source: 'calendar', type: 'event' },
    });

    // Simulate model failure by monkey-patching the vector search path.
    const original = memory.search.bind(memory);
    memory.search = async () => { throw new Error('model unavailable'); };

    const results = await memory.searchHybrid('incident report outage', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('t1');

    memory.search = original;
  });
});

describe('SearchEngine modes', () => {
  let memory: Memory;
  let engine: SearchEngine;

  beforeEach(async () => {
    memory = new Memory();
    await memory.init();
    await memory.clear();
    engine = new SearchEngine(memory);
  });

  it('defaults to vector mode for backward compatibility', async () => {
    await memory.store({ id: 'v1', text: 'semantic memory document', metadata: { source: 'docs', type: 'doc' } });
    const results = await engine.search('semantic memory', { minScore: 0 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('supports explicit text mode', async () => {
    await memory.store({
      id: 't1',
      text: 'kubernetes cluster autoscaling configuration',
      metadata: { source: 'docs', type: 'doc' },
    });
    const results = await engine.search('kubernetes autoscaling', { mode: 'text', topK: 5 });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('t1');
  });

  it('supports explicit hybrid mode', async () => {
    await memory.store({
      id: 'h1',
      text: 'rate limiting middleware for the public API gateway',
      metadata: { source: 'docs', type: 'doc' },
    });
    const results = await engine.search('rate limit api', { mode: 'hybrid', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('applies filters in text mode', async () => {
    await memory.store({
      id: 'f1',
      text: 'onboarding checklist for new engineers',
      metadata: { source: 'docs', type: 'doc' },
    });
    await memory.store({
      id: 'f2',
      text: 'onboarding checklist for new engineers',
      metadata: { source: 'github', type: 'pr' },
    });

    const results = await engine.search('onboarding checklist', { mode: 'text', source: 'docs' });
    expect(results).toHaveLength(1);
    expect(results[0].metadata.source).toBe('docs');
  });
});

afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));
