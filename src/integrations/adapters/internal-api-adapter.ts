import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface InternalItem {
  id: string | number;
  title?: string;
  text?: string;
  body?: string;
  content?: string;
  description?: string;
  url?: string;
  date?: string;
  updatedAt?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Internal API adapter — pulls documents from an internal service exposing a
 * conventional JSON list shape. This is the escape hatch for "internal APIs"
 * that don't fit a public product: point it at any endpoint that returns
 * `{ items: [...] }` (or a bare array) and map the fields.
 *
 * Config (env):
 *  - INTERNAL_API_URL:     full endpoint URL, e.g. https://internal.corp/api/items
 *  - INTERNAL_API_TOKEN:   optional bearer token
 *  - INTERNAL_ITEMS_PATH:  optional JSON pointer-ish key for the item array
 *    (default "items"; set "body" for `{ body: [...] }`)
 */
export class InternalApiAdapter extends BaseApiConnector {
  readonly name = 'internal';
  readonly kind = 'pull' as const;
  readonly description = 'Internal REST API (custom JSON shape)';

  private token: string | undefined;
  private itemsKey: string;

  constructor() {
    super();
    this.token = process.env.INTERNAL_API_TOKEN;
    this.itemsKey = process.env.INTERNAL_ITEMS_PATH || 'items';
  }

  get requiredConfig(): string[] {
    return ['INTERNAL_API_URL'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!process.env.INTERNAL_API_URL) missing.push('INTERNAL_API_URL');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return process.env.INTERNAL_API_URL || 'https://missing.internal';
  }

  protected authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(this.baseUrl(), { headers: this.authHeaders(), signal: AbortSignal.timeout(15000) });
      if (res.status === 401 || res.status === 403) return { ok: false, message: 'Authentication failed' };
      return { ok: true, message: `Reachable (HTTP ${res.status})` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    const url = options?.since && this.baseUrl().includes('?')
      ? `${this.baseUrl()}&updatedAfter=${encodeURIComponent(options.since)}`
      : options?.since
        ? `${this.baseUrl()}?updatedAfter=${encodeURIComponent(options.since)}`
        : this.baseUrl();

    const res = await fetch(url, { headers: this.authHeaders(), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Internal API error ${res.status}: ${res.statusText}`);

    const data = (await res.json()) as Record<string, unknown> | unknown[];
    let items: unknown[];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object' && this.itemsKey in data) {
      items = (data as Record<string, unknown>)[this.itemsKey] as unknown[];
    } else {
      items = [];
    }

    const limit = options?.limit ?? 1000;
    const docs: MemoryDocument[] = [];
    for (const raw of items.slice(0, limit)) {
      const item = raw as InternalItem;
      const id = String(item.id);
      if (!id) continue;
      const title = String(item.title ?? id);
      const body = String(item.body ?? item.content ?? item.text ?? item.description ?? '').trim();
      const text = (body ? `${title}\n\n${body}` : title).slice(0, 4000);
      if (!text.trim()) continue;
      docs.push(makeDoc('internal', id, text, {
        type: item.type ?? 'item',
        title,
        url: String(item.url ?? ''),
        date: String(item.date ?? item.updatedAt ?? ''),
      }));
    }
    return docs;
  }
}
