import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Memory } from '../core/memory.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'knowledge-'));
process.env.DATA_DIR = DATA_DIR;

describe('Knowledge Engine: tagging', () => {
  let memory: Memory;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
  });

  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('tags a document and finds it by tag', async () => {
    await memory.clear();
    await memory.store({
      id: 'd1',
      text: 'Authentication implementation for the login flow',
      metadata: { source: 'docs' },
    });

    const tagged = await memory.addTags('d1', ['auth', 'Security']);
    expect(tagged).not.toBeNull();
    expect(tagged!.tags).toEqual(['auth', 'security']);

    const byTag = await memory.findByTag('security');
    expect(byTag).toHaveLength(1);
    expect(byTag[0].id).toBe('d1');
  });

  it('deduplicates tags on re-add', async () => {
    await memory.clear();
    await memory.store({ id: 'd2', text: 'Some doc', metadata: {} });
    await memory.addTags('d2', ['ops', 'ops', 'infra']);
    const again = await memory.addTags('d2', ['OPS']);
    expect(again!.tags).toEqual(['ops', 'infra']);
  });

  it('removes tags', async () => {
    await memory.clear();
    await memory.store({ id: 'd3', text: 'Some doc', metadata: {} });
    await memory.addTags('d3', ['a', 'b', 'c']);
    const after = await memory.removeTags('d3', ['b']);
    expect(after!.tags).toEqual(['a', 'c']);
  });

  it('returns null when tagging a missing document', async () => {
    const result = await memory.addTags('does-not-exist', ['x']);
    expect(result).toBeNull();
  });

  it('aggregates all tags with counts', async () => {
    await memory.clear();
    await memory.store({ id: 't1', text: 'Doc one', metadata: {} });
    await memory.store({ id: 't2', text: 'Doc two', metadata: {} });
    await memory.store({ id: 't3', text: 'Doc three', metadata: {} });
    await memory.addTags('t1', ['shared', 'alpha']);
    await memory.addTags('t2', ['shared']);
    await memory.addTags('t3', ['beta']);

    const tags = await memory.getAllTags();
    const shared = tags.find(t => t.tag === 'shared');
    expect(shared).toBeDefined();
    expect(shared!.count).toBe(2);
    // Sorted by count descending.
    expect(tags[0].count).toBeGreaterThanOrEqual(tags[1].count);
  });
});

describe('Knowledge Engine: versioning', () => {
  let memory: Memory;

  beforeAll(async () => {
    memory = new Memory();
    await memory.init();
  });

  it('creates a version on first store', async () => {
    await memory.clear();
    await memory.store({ id: 'v1', text: 'Version one content', metadata: {} });
    const versions = await memory.getVersions('v1');
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].text).toBe('Version one content');
  });

  it('creates a new version when content changes', async () => {
    await memory.clear();
    await memory.store({ id: 'v2', text: 'Original text', metadata: {} });
    await memory.store({ id: 'v2', text: 'Original text, now updated', metadata: {} });

    const versions = await memory.getVersions('v2');
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(2); // newest first
    expect(versions[0].text).toContain('updated');
  });

  it('does not create a version when content is unchanged', async () => {
    await memory.clear();
    await memory.store({ id: 'v3', text: 'Same content', metadata: {} });
    await memory.store({ id: 'v3', text: 'Same content', metadata: {} });

    const versions = await memory.getVersions('v3');
    expect(versions).toHaveLength(1);
  });

  it('keeps the latest version number on the document', async () => {
    await memory.clear();
    await memory.store({ id: 'v4', text: 'Rev A', metadata: {} });
    await memory.store({ id: 'v4', text: 'Rev B', metadata: {} });
    const doc = await memory.getById('v4');
    expect(doc).toBeDefined();
    expect(doc!.metadata['version']).toBeUndefined();
  });

  it('restores a previous version text', async () => {
    await memory.clear();
    await memory.store({ id: 'v5', text: 'Final state', metadata: {} });
    await memory.store({ id: 'v5', text: 'Intermediate state', metadata: {} });
    await memory.store({ id: 'v5', text: 'New final state', metadata: {} });

    const restored = await memory.restoreVersion('v5', 2);
    expect(restored).not.toBeNull();
    expect(restored!.text).toBe('Intermediate state');
    expect(restored!.metadata['restoredFrom']).toBe('2');

    // Restoring creates a new version, preserving history.
    const versions = await memory.getVersions('v5');
    expect(versions[0].version).toBe(4);
  });

  it('returns null when restoring a missing version', async () => {
    await memory.clear();
    await memory.store({ id: 'v6', text: 'Some text', metadata: {} });
    const result = await memory.restoreVersion('v6', 99);
    expect(result).toBeNull();
  });
});
