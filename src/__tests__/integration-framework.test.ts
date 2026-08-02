import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectorRegistry } from '../integrations/connector-registry.js';
import { GitLabAdapter } from '../integrations/adapters/gitlab-adapter.js';
import { InternalApiAdapter } from '../integrations/adapters/internal-api-adapter.js';
import { SlackAdapter } from '../integrations/adapters/slack-adapter.js';
import { NotionAdapter } from '../integrations/adapters/notion-adapter.js';
import { registerAllConnectors } from '../integrations/index.js';

describe('ConnectorRegistry', () => {
  it('registers and lists connectors', () => {
    const registry = new ConnectorRegistry();
    registry.register(new GitLabAdapter());
    expect(registry.has('gitlab')).toBe(true);
    expect(registry.get('gitlab')?.name).toBe('gitlab');
    expect(registry.list().length).toBe(1);
  });

  it('returns undefined for unknown connectors', () => {
    const registry = new ConnectorRegistry();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.validate('nope')).toBeUndefined();
  });

  it('reports validation status per connector', () => {
    const registry = new ConnectorRegistry();
    registry.register(new GitLabAdapter());
    const statuses = registry.statuses();
    expect(statuses[0].name).toBe('gitlab');
    expect(statuses[0].requiredConfig).toContain('GITLAB_TOKEN');
    expect(statuses[0].configured).toBe(false);
  });

  it('registerAllConnectors registers the full adapter set', () => {
    const registry = registerAllConnectors(new ConnectorRegistry());
    const names = registry.list().map(c => c.name);
    expect(names).toContain('gitlab');
    expect(names).toContain('jira');
    expect(names).toContain('linear');
    expect(names).toContain('slack');
    expect(names).toContain('discord');
    expect(names).toContain('notion');
    expect(names).toContain('confluence');
    expect(names).toContain('crm');
    expect(names).toContain('gworkspace');
    expect(names).toContain('internal');
  });
});

describe('GitLabAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GITLAB_TOKEN = 'glpat-test';
    process.env.GITLAB_PROJECT = 'acme/api';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('is configured when token is present', () => {
    const adapter = new GitLabAdapter();
    expect(adapter.isConfigured()).toBe(true);
    expect(adapter.validateConfig().missing).toEqual([]);
  });

  it('reports missing config', () => {
    delete process.env.GITLAB_TOKEN;
    const adapter = new GitLabAdapter();
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.validateConfig().missing).toContain('GITLAB_TOKEN');
  });

  it('fetches issues and merge requests into MemoryDocuments', async () => {
    const adapter = new GitLabAdapter();
    const mock = vi.spyOn(adapter as any, 'get').mockImplementation((...args: unknown[]): Promise<any> => {
      const path = String(args[0]);
      if (path.includes('/issues')) {
        return Promise.resolve([{
          iid: 1, title: 'Fix auth', description: 'details', state: 'opened',
          web_url: 'https://gitlab.com/acme/api/-/issues/1', created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z', author: { username: 'alice' },
        }]);
      }
      if (path.includes('/merge_requests')) {
        return Promise.resolve([{
          iid: 9, title: 'Add search', description: 'details', state: 'merged',
          web_url: 'https://gitlab.com/acme/api/-/merge_requests/9', created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z', author: { username: 'bob' },
        }]);
      }
      return Promise.resolve([]);
    });

    const docs = await adapter.fetch();
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe('gitlab:issue:acme/api:1');
    expect(docs[0].metadata.source).toBe('gitlab');
    expect(docs[0].metadata.type).toBe('issue');
    expect(docs[0].text).toContain('Fix auth');
    expect(docs[1].metadata.type).toBe('pr');
  });

  it('throws when token missing', async () => {
    delete process.env.GITLAB_TOKEN;
    const adapter = new GitLabAdapter();
    await expect(adapter.fetch()).rejects.toThrow(/GITLAB_TOKEN/);
  });
});

describe('InternalApiAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes { items: [...] } responses', async () => {
    process.env.INTERNAL_API_URL = 'https://internal.corp/api/items';
    const adapter = new InternalApiAdapter();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 'a1', title: 'Project Alpha', description: 'The alpha project', url: 'https://internal.corp/a1', updatedAt: '2026-03-01' },
          { id: 'a2', title: 'Project Beta', description: 'The beta project' },
        ],
      }),
    } as any);

    const docs = await adapter.fetch();
    expect(docs).toHaveLength(2);
    expect(docs[0].id).toBe('internal:a1');
    expect(docs[0].metadata.source).toBe('internal');
    expect(docs[0].metadata.title).toBe('Project Alpha');
    expect(docs[1].metadata.type).toBe('item');
  });

  it('normalizes bare arrays', async () => {
    process.env.INTERNAL_API_URL = 'https://internal.corp/raw';
    const adapter = new InternalApiAdapter();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 7, title: 'Raw item', body: 'Some content' }],
    } as any);

    const docs = await adapter.fetch();
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('internal:7');
    expect(docs[0].text).toContain('Some content');
  });

  it('surfaces auth errors', async () => {
    process.env.INTERNAL_API_URL = 'https://internal.corp/items';
    const adapter = new InternalApiAdapter();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as any);
    await expect(adapter.fetch()).rejects.toThrow(/Internal API error 500/);
  });
});

describe('SlackAdapter', () => {
  it('requires a token', () => {
    delete process.env.SLACK_TOKEN;
    const adapter = new SlackAdapter();
    expect(adapter.validateConfig().missing).toContain('SLACK_TOKEN');
  });
});

describe('NotionAdapter', () => {
  it('requires a token', () => {
    delete process.env.NOTION_API_KEY;
    const adapter = new NotionAdapter();
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.requiredConfig).toEqual(['NOTION_API_KEY']);
  });
});
