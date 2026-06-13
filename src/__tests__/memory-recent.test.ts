import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
    const dir = mkdtempSync(join(tmpdir(), 'mem-recent-'));
    const mem = new Memory(dir);
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
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Memory.getAllRange', () => {
  it('pages through the entire store without the 1000-doc cap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-range-'));
    const mem = new Memory(dir);
    try {
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
      const ours = collected.filter((id) => id.startsWith(prefix));
      expect(ours).toHaveLength(25);
      expect(new Set(ours).size).toBe(25);
      expect(mem.count).toBe(before + 25);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

