import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface JiraFields {
  summary?: string;
  description?: string | null;
  status?: { name?: string };
  created?: string;
  updated?: string;
  assignee?: { displayName?: string; emailAddress?: string };
  issuetype?: { name?: string };
}

interface JiraIssue {
  id: string;
  key: string;
  fields?: JiraFields;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  startAt?: number;
  total?: number;
}

/**
 * Jira adapter — issues via the Jira Cloud REST search API.
 *
 * Config (env):
 *  - JIRA_EMAIL:  account email (basic auth username)
 *  - JIRA_API_TOKEN: Atlassian API token
 *  - JIRA_URL:    instance base URL, e.g. https://myorg.atlassian.net
 *  - JIRA_JQL:    optional JQL filter (default: all non-epic issues)
 */
export class JiraAdapter extends BaseApiConnector {
  readonly name = 'jira';
  readonly kind = 'sync' as const;
  readonly description = 'Jira issues and epics via JQL search';

  private email: string | undefined;
  private token: string | undefined;
  private jql: string;

  constructor() {
    super();
    this.email = process.env.JIRA_EMAIL;
    this.token = process.env.JIRA_API_TOKEN;
    this.jql = process.env.JIRA_JQL || 'type != Epic ORDER BY updated DESC';
  }

  get requiredConfig(): string[] {
    return ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_URL'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.email) missing.push('JIRA_EMAIL');
    if (!this.token) missing.push('JIRA_API_TOKEN');
    if (!process.env.JIRA_URL) missing.push('JIRA_URL');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return process.env.JIRA_URL || 'https://missing.atlassian.net';
  }

  protected authHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.get<{ active: boolean }>('/rest/api/3/myself');
      return { ok: true, message: 'Connected to Jira API' };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'JIRA_API_TOKEN').message };
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.email || !this.token) throw this.mapError('JIRA_EMAIL/JIRA_API_TOKEN not set', 'JIRA_API_TOKEN');

    const pageSize = 100;
    const fields = 'summary,description,status,created,updated,assignee,issuetype';
    const docs: MemoryDocument[] = [];
    let startAt = 0;

    for (let guard = 0; guard < 50; guard++) {
      const body: Record<string, unknown> = {
        jql: this.jql,
        maxResults: pageSize,
        startAt,
        fields,
      };
      const res = await this.post<JiraSearchResponse>('/rest/api/3/search', body);
      const issues = res.issues ?? [];
      for (const issue of issues) {
        const f = issue.fields ?? {};
        const type = f.issuetype?.name?.toLowerCase() ?? 'issue';
        const author = f.assignee?.emailAddress ?? f.assignee?.displayName ?? 'unassigned';
        docs.push(makeDoc('jira', issue.key,
          `${f.issuetype?.name ?? 'Issue'} ${issue.key}: ${f.summary ?? ''}\n\n${f.description ?? ''}`,
          {
            type: type === 'epic' ? 'epic' : 'issue',
            title: f.summary ?? issue.key,
            state: f.status?.name ?? 'unknown',
            author,
            url: `${this.baseUrl()}/browse/${issue.key}`,
            date: f.created ?? '',
            updated: f.updated ?? '',
          }
        ));
      }
      if (issues.length < pageSize || (options?.limit && docs.length >= options.limit)) break;
      startAt += issues.length;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Jira API error ${res.status}: ${res.statusText}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
