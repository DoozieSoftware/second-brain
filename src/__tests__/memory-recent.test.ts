import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'memory-test-'));
process.env.DATA_DIR = DATA_DIR;

import { Memory } from '../core/memory.js';

function makeDoc(id: string, source: string, text: string) {
  return {
    id,
    text,
    metadata: { source, type: 'note' },
  };
}

describe('Memory.getRecent', () => {
  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('returns the most-recently-ingested documents, newest first', async () => {
    const mem = new Memory();
    try {
      await mem.ingest([
        makeDoc('old-1', 'github', 'first commit'),
        makeDoc('old-2', 'github', 'second commit'),
        makeDoc('new-1', 'email', 'newest email'),
        makeDoc('new-2', 'email', 'second newest email'),
        makeDoc('new-3', 'email', 'third newest email'),
      ]);
      const recent = await mem.getRecent(3);
      expect(recent.map((d) => d.id)).toEqual(['new-3', 'new-2', 'new-1']);
    } finally {
      await mem.clear();
    }
  });
});

describe('Memory.getAllRange', () => {
  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('pages through the entire store without the 1000-doc cap', async () => {
    const mem = new Memory();
    try {
      // Tag every doc with a unique prefix and snapshot the count BEFORE
      // we ingest, so the assertion is robust to a non-empty starting
      // store (e.g., from a prior test that ran on the same DATA_DIR).
      const prefix = `mrange-${Date.now()}-`;
      const docs = Array.from({ length: 25 }, (_, i) =>
        makeDoc(`${prefix}${i}`, 'github', `doc ${i}`)
      );
      const before = mem.count;
      await mem.ingest(docs);
      const collected: string[] = [];
      for (let off = 0; off < mem.count; off += 10) {
        const page = await mem.getAllRange(off, 10);
        collected.push(...page.map((d) => d.id));
      }
      // We only care about the docs we ingested.
      const ours = collected.filter((id) => id.startsWith(prefix));
      expect(ours).toHaveLength(25);
      expect(new Set(ours).size).toBe(25);
      expect(mem.count).toBe(before + 25);
    } finally {
      await mem.clear();
    }
  });
});
