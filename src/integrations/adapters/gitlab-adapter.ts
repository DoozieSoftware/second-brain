import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface GitLabIssue {
  iid: number;
  title: string;
  description: string;
  state: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  author?: { username?: string };
}

interface GitLabMergeRequest {
  iid: number;
  title: string;
  description: string;
  state: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  author?: { username?: string };
}

/**
 * GitLab adapter — issues + merge requests for a configured project/group.
 *
 * Config (env):
 *  - GITLAB_TOKEN: personal/group access token
 *  - GITLAB_URL:   optional instance URL (default https://gitlab.com/api/v4)
 *  - GITLAB_PROJECT: optional project path, e.g. "group/repo". When unset the
 *    adapter enumerates the authenticated user's projects.
 */
export class GitLabAdapter extends BaseApiConnector {
  readonly name = 'gitlab';
  readonly kind = 'sync' as const;
  readonly description = 'GitLab issues and merge requests';

  private token: string | undefined;
  private project: string | undefined;

  constructor() {
    super();
    this.token = process.env.GITLAB_TOKEN;
    this.project = process.env.GITLAB_PROJECT;
  }

  get requiredConfig(): string[] {
    return ['GITLAB_TOKEN'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.token) missing.push('GITLAB_TOKEN');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return process.env.GITLAB_URL || 'https://gitlab.com/api/v4';
  }

  protected authHeaders(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.token ?? '' };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.get<{ id: number }>('/user');
      return { ok: true, message: 'Connected to GitLab API' };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'GITLAB_TOKEN').message };
    }
  }

  /** Load a paginated collection of `T` using GitLab's page=X param. */
  private async getCollection<T>(path: string, mapItem: (raw: T) => MemoryDocument, opts?: SyncOptions): Promise<MemoryDocument[]> {
    const pageSize = 100;
    const since = opts?.since ? `&updated_after=${encodeURIComponent(opts.since)}` : '';
    const docs: MemoryDocument[] = [];
    let page = 1;

    // Loop until an empty page or the safety cap (avoid infinite loops).
    for (let guard = 0; guard < 50; guard++) {
      const items = await this.get<T[]>(`${path}${since}&per_page=${pageSize}&page=${page}`);
      if (!Array.isArray(items) || items.length === 0) break;
      docs.push(...items.map(mapItem));
      if (items.length < pageSize || (opts?.limit && docs.length >= opts.limit)) break;
      page++;
    }
    return docs.slice(0, opts?.limit ?? docs.length);
  }

  private encodeProject(p: string): string {
    return encodeURIComponent(p);
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token) throw this.mapError('GITLAB_TOKEN not set', 'GITLAB_TOKEN');

    const projects = this.project
      ? [this.project]
      : (await this.get<Array<{ path_with_namespace: string }>>('/projects?membership=true&per_page=100&simple=true'))
          .map(p => p.path_with_namespace);

    const docs: MemoryDocument[] = [];
    for (const project of projects) {
      const enc = this.encodeProject(project);
      const base = `/projects/${enc}/issues?state=all`;
      const mrBase = `/projects/${enc}/merge_requests?state=all`;
      const issues = await this.getCollection<GitLabIssue>(base, issue =>
        makeDoc('gitlab', `issue:${project}:${issue.iid}`, `Issue #${issue.iid}: ${issue.title}\n\n${issue.description}`,
          { type: 'issue', title: issue.title, state: issue.state, author: issue.author?.username ?? 'unknown', url: issue.web_url, date: issue.created_at, updated: issue.updated_at }),
        options
      );
      const mrs = await this.getCollection<GitLabMergeRequest>(mrBase, mr =>
        makeDoc('gitlab', `mr:${project}:${mr.iid}`, `MR #${mr.iid}: ${mr.title}\n\n${mr.description}`,
          { type: 'pr', title: mr.title, state: mr.state, author: mr.author?.username ?? 'unknown', url: mr.web_url, date: mr.created_at, updated: mr.updated_at }),
        options
      );
      docs.push(...issues, ...mrs);
    }
    return docs;
  }
}
