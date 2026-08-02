import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface NotionPage {
  id: string;
  properties?: Record<string, unknown>;
  url?: string;
  last_edited_time?: string;
  created_time?: string;
  object?: string;
}

interface NotionSearchResponse {
  results?: NotionPage[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface TextPart {
  text?: { content?: string };
}

function extractText(value: unknown): string {
  const v = value as { title?: TextPart[]; rich_text?: TextPart[]; plain_text?: string };
  const title = v?.title ?? v?.rich_text;
  if (Array.isArray(title)) {
    return title.map(t => t.text?.content ?? '').join('').trim();
  }
  return v?.plain_text ?? '';
}

/**
 * Notion adapter — pages via the Notion Search API (must be enabled for the
 * integration in the Notion workspace).
 *
 * Config (env):
 *  - NOTION_API_KEY: integration token (secret_...)
 */
export class NotionAdapter extends BaseApiConnector {
  readonly name = 'notion';
  readonly kind = 'sync' as const;
  readonly description = 'Notion pages (search API)';

  private token: string | undefined;

  constructor() {
    super();
    this.token = process.env.NOTION_API_KEY;
  }

  get requiredConfig(): string[] {
    return ['NOTION_API_KEY'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.token) missing.push('NOTION_API_KEY');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return 'https://api.notion.com/v1';
  }

  protected authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token ?? ''}`,
      'Notion-Version': '2022-06-28',
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.get<NotionSearchResponse>('/search');
      return { ok: true, message: `Connected to Notion (${(res.results ?? []).length} results in search)` };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'NOTION_API_KEY').message };
    }
  }

  private async searchPages(cursor?: string): Promise<NotionSearchResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${this.baseUrl()}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor, filter: { value: 'page', property: 'object' } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Notion API error ${res.status}: ${res.statusText}`);
      return (await res.json()) as NotionSearchResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token) throw this.mapError('NOTION_API_KEY not set', 'NOTION_API_KEY');

    const docs: MemoryDocument[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const res = await this.searchPages(cursor ?? undefined);
      const pages = res.results ?? [];
      for (const page of pages) {
        const title = page.properties ? this.firstTitle(page.properties) : page.id;
        const text = `Notion page: ${title}\n\nURL: ${page.url ?? ''}`;
        docs.push(makeDoc('notion', page.id, text, {
          type: 'page',
          title,
          url: page.url ?? '',
          date: page.created_time ?? '',
          updated: page.last_edited_time ?? '',
        }));
      }
      if (!res.has_more || (options?.limit && docs.length >= options.limit)) break;
      cursor = res.next_cursor ?? null;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }

  private firstTitle(properties: Record<string, unknown>): string {
    for (const key of Object.keys(properties)) {
      const value = properties[key];
      const extracted = extractText(value);
      if (extracted) return extracted;
    }
    return 'Untitled';
  }
}
