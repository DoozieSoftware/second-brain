import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DocsConnector } from '../connectors/docs-connector.js';

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), 'docs-conn-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub', 'a.md'), 'a');
  writeFileSync(join(root, 'sub', 'b.md'), 'b');
  writeFileSync(join(root, 'sub', 'c.txt'), 'c');
  writeFileSync(join(root, 'sub', 'skip.json'), '{}');
  return root;
}

describe('DocsConnector.discoverFiles', () => {
  const dirs: string[] = [];
  function freshTree() {
    const d = makeTree();
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('finds files when given a single extension (regression: glob brace no-op)', async () => {
    const root = freshTree();
    const c = new DocsConnector({ paths: [root], extensions: ['.md'] });
    const files = await c.discoverFiles();
    expect(files.sort()).toEqual([join(root, 'sub', 'a.md'), join(root, 'sub', 'b.md')].sort());
  });

  it('finds files when given multiple extensions', async () => {
    const root = freshTree();
    const c = new DocsConnector({ paths: [root], extensions: ['.md', '.txt'] });
    const files = await c.discoverFiles();
    expect(files.sort()).toEqual(
      [join(root, 'sub', 'a.md'), join(root, 'sub', 'b.md'), join(root, 'sub', 'c.txt')].sort()
    );
  });

  it('returns the file as-is when given a direct file path', async () => {
    const root = freshTree();
    const c = new DocsConnector({ paths: [join(root, 'sub', 'a.md')], extensions: ['.md'] });
    const files = await c.discoverFiles();
    expect(files).toEqual([join(root, 'sub', 'a.md')]);
  });
});
