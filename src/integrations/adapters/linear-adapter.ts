import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  state?: { name?: string };
  createdAt?: string;
  updatedAt?: string;
  assignee?: { email?: string; displayName?: string };
  url?: string;
  project?: { name?: string };
}

interface LinearResponse {
  data?: {
    issues?: {
      nodes?: LinearIssue[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string };
    };
    viewer?: { id?: string; name?: string };
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Linear adapter — issues via the GraphQL API.
 *
 * Config (env):
 *  - LINEAR_API_KEY: personal or admin API key (sk-...)
 *  - LINEAR_TEAM:    optional team id filter
 */
export class LinearAdapter extends BaseApiConnector {
  readonly name = 'linear';
  readonly kind = 'sync' as const;
  readonly description = 'Linear issues (GraphQL)';

  private token: string | undefined;
  private team: string | undefined;

  constructor() {
    super();
    this.token = process.env.LINEAR_API_KEY;
    this.team = process.env.LINEAR_TEAM;
  }

  get requiredConfig(): string[] {
    return ['LINEAR_API_KEY'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.token) missing.push('LINEAR_API_KEY');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return 'https://api.linear.app/graphql';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: this.token ?? '' };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.graphql('query { viewer { id name } }', {});
      return { ok: true, message: `Connected to Linear API as ${res.data?.viewer?.name ?? 'viewer'}` };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'LINEAR_API_KEY').message };
    }
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<LinearResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(this.baseUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Linear API error ${res.status}: ${res.statusText}`);
      const json = (await res.json()) as LinearResponse;
      if (json.errors?.length) {
        throw new Error(`Linear GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token) throw this.mapError('LINEAR_API_KEY not set', 'LINEAR_API_KEY');

    const teamFilter = this.team ? `, team: { id: "${this.team}" }` : '';
    const query = `
      query Issues($after: String, $updatedAfter: DateTime) {
        issues(first: 50, after: $after, filter: { updatedAt: { gte: $updatedAfter } }${teamFilter}) {
          nodes {
            id identifier title description
            state { name }
            createdAt updatedAt
            assignee { email displayName }
            url
            project { name }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const docs: MemoryDocument[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const res = await this.graphql(query, {
        after: cursor,
        updatedAfter: options?.since ? new Date(options.since).toISOString() : null,
      });
      const issues = res.data?.issues?.nodes ?? [];
      for (const issue of issues) {
        const author = issue.assignee?.email ?? issue.assignee?.displayName ?? 'unassigned';
        docs.push(makeDoc('linear', issue.identifier,
          `${issue.identifier}: ${issue.title}\n\n${issue.description ?? ''}`,
          {
            type: 'issue',
            title: issue.title,
            state: issue.state?.name ?? 'unknown',
            author,
            project: issue.project?.name ?? '',
            url: issue.url ?? `https://linear.app/issue/${issue.identifier}`,
            date: issue.createdAt ?? '',
            updated: issue.updatedAt ?? '',
          }
        ));
      }
      const pageInfo = res.data?.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || (options?.limit && docs.length >= options.limit)) break;
      cursor = pageInfo.endCursor ?? null;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }
}
