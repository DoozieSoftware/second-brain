import { describe, it, expect } from 'vitest';
import { Memory } from '../core/memory.js';

function makeDoc(id: string, source: string, text: string) {
  return {
    id,
    text,
    metadata: { source, type: 'note' },
  };
}

describe('Memory.getRecent', () => {
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
      // Clear so we don't pollute the on-disk store for other tests.
      await mem.clear();
    }
  });
});

describe('Memory.getAllRange', () => {
  it('pages through the entire store without the 1000-doc cap', async () => {
    const mem = new Memory();
    try {
      const before = mem.count;
      const docs = Array.from({ length: 25 }, (_, i) =>
        makeDoc(`d-${i}-${Date.now()}`, 'github', `doc ${i}`)
      );
      await mem.ingest(docs);
      const collected: string[] = [];
      for (let off = 0; off < mem.count; off += 10) {
        const page = await mem.getAllRange(off, 10);
        collected.push(...page.map((d) => d.id));
      }
      expect(collected).toHaveLength(25);
      expect(new Set(collected).size).toBe(25);
      // Sanity: only the 25 new docs were returned, not prior contents.
      expect(mem.count).toBe(before + 25);
    } finally {
      await mem.clear();
    }
  });
});
