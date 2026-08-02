import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface ConfluencePage {
  id: string;
  title?: string;
  body?: { view?: { value?: string } } | { storage?: { value?: string } };
  _links?: { webui?: string; self?: string };
  created_date?: string;
  modified_date?: string;
  status?: string;
}

interface ConfluenceResponse {
  results?: ConfluencePage[];
  _links?: { next?: string };
  size?: number;
}

/**
 * Confluence adapter — pages from a space via the CQL search API.
 *
 * Config (env):
 *  - CONFLUENCE_URL:   base URL, e.g. https://yourco.atlassian.net/wiki
 *  - CONFLUENCE_EMAIL: account email (basic auth username)
 *  - CONFLUENCE_API_TOKEN: Atlassian API token
 *  - CONFLUENCE_SPACE: optional space key filter
 */
export class ConfluenceAdapter extends BaseApiConnector {
  readonly name = 'confluence';
  readonly kind = 'sync' as const;
  readonly description = 'Confluence pages (CQL search)';

  private email: string | undefined;
  private token: string | undefined;
  private space: string | undefined;

  constructor() {
    super();
    this.email = process.env.CONFLUENCE_EMAIL;
    this.token = process.env.CONFLUENCE_API_TOKEN;
    this.space = process.env.CONFLUENCE_SPACE;
  }

  get requiredConfig(): string[] {
    return ['CONFLUENCE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!process.env.CONFLUENCE_URL) missing.push('CONFLUENCE_URL');
    if (!this.email) missing.push('CONFLUENCE_EMAIL');
    if (!this.token) missing.push('CONFLUENCE_API_TOKEN');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return `${process.env.CONFLUENCE_URL || 'https://missing.atlassian.net/wiki'}/rest/api`;
  }

  protected authHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.get<{ name?: string }>('/user/current');
      return { ok: true, message: 'Connected to Confluence API' };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'CONFLUENCE_API_TOKEN').message };
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.email || !this.token) throw this.mapError('CONFLUENCE credentials not set', 'CONFLUENCE_API_TOKEN');

    const cql = this.space ? `space = "${this.space}"` : 'type = page';
    const since = options?.since ? ` AND modified >= "${options.since}"` : '';
    const docs: MemoryDocument[] = [];
    let start = 0;
    const pageSize = 100;

    for (let guard = 0; guard < 50; guard++) {
      const path = `/content/search?cql=${encodeURIComponent(cql + since)}&limit=${pageSize}&start=${start}&expand=body.storage,version`;
      const res = await this.get<ConfluenceResponse>(path);
      const pages = res.results ?? [];
      for (const page of pages) {
        const bodyValue = (page.body as any)?.storage?.value ?? (page.body as any)?.view?.value ?? '';
        const plain = this.stripHtml(bodyValue).slice(0, 4000);
        const webui = page._links?.webui ?? page._links?.self ?? '';
        docs.push(makeDoc('confluence', page.id,
          `Confluence page: ${page.title ?? 'Untitled'}\n\n${plain}`,
          {
            type: 'page',
            title: page.title ?? 'Untitled',
            url: `${process.env.CONFLUENCE_URL || ''}${webui}`,
            date: page.created_date ?? '',
            updated: page.modified_date ?? '',
            status: page.status ?? '',
          }
        ));
      }
      if (pages.length < pageSize || (options?.limit && docs.length >= options.limit)) break;
      start += pageSize;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
