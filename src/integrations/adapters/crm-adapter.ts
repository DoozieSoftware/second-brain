import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface CrmObject {
  id: string;
  properties?: Record<string, string | number | boolean | null>;
  createdAt?: string;
  updatedAt?: string;
}

interface CrmResponse {
  results?: CrmObject[];
  paging?: { next?: { after?: string } };
  total?: number;
}

/**
 * CRM adapter — generic object sync against HubSpot-compatible REST APIs.
 *
 * HubSpot is the reference shape (crm/v3/objects/{objectType} with
 * "after" cursor pagination). Any CRM that exposes the same shape (Salesforce
 * via a translation layer, Pipedrive, custom internal CRM) can reuse this
 * adapter by changing the object type and env vars.
 *
 * Config (env):
 *  - CRM_API_URL:  base URL, e.g. https://api.hubapi.com/crm/v3
 *  - CRM_API_TOKEN: bearer token
 *  - CRM_OBJECT:   object type, e.g. "companies" or "contacts"
 *  - CRM_FIELDS:   comma-separated property names to pull
 */
export class CrmAdapter extends BaseApiConnector {
  readonly name = 'crm';
  readonly kind = 'sync' as const;
  readonly description = 'CRM objects (HubSpot-compatible REST)';

  private token: string | undefined;
  private object: string;
  private fields: string[];

  constructor() {
    super();
    this.token = process.env.CRM_API_TOKEN;
    this.object = process.env.CRM_OBJECT || 'companies';
    this.fields = (process.env.CRM_FIELDS ?? 'name,domain,description,annualrevenue')
      .split(',').map(f => f.trim()).filter(Boolean);
  }

  get requiredConfig(): string[] {
    return ['CRM_API_URL', 'CRM_API_TOKEN'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!process.env.CRM_API_URL) missing.push('CRM_API_URL');
    if (!this.token) missing.push('CRM_API_TOKEN');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return process.env.CRM_API_URL || 'https://api.hubapi.com/crm/v3';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token ?? ''}` };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.get<CrmResponse>(`/objects/${this.object}?limit=1`);
      return { ok: true, message: `Connected to CRM (object: ${this.object})` };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'CRM_API_TOKEN').message };
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.token) throw this.mapError('CRM_API_TOKEN not set', 'CRM_API_TOKEN');

    const props = this.fields.join(',');
    const docs: MemoryDocument[] = [];
    let after: string | undefined;

    for (let guard = 0; guard < 50; guard++) {
      const params = new URLSearchParams({
        limit: '100',
        properties: props,
        archived: 'false',
      });
      if (after) params.set('after', after);
      const res = await this.get<CrmResponse>(`/objects/${this.object}?${params}`);
      const results = res.results ?? [];
      for (const obj of results) {
        const props = obj.properties ?? {};
        const name = String(props.name ?? props.title ?? `${this.object.slice(0, -1)} ${obj.id}`);
        const summary = Object.entries(props)
          .filter(([k]) => !['name', 'title'].includes(k))
          .map(([k, v]) => `${k}: ${v ?? ''}`)
          .join('\n');
        docs.push(makeDoc('crm', `${this.object}:${obj.id}`,
          `${this.object.slice(0, -1)}: ${name}\n\n${summary}`,
          {
            type: 'crm_object',
            title: name,
            objectType: this.object.slice(0, -1),
            url: `${this.baseUrl()}/objects/${this.object}/${obj.id}`,
            date: obj.createdAt ?? '',
            updated: obj.updatedAt ?? '',
          }
        ));
      }
      after = res.paging?.next?.after;
      if (!after || results.length === 0 || (options?.limit && docs.length >= options.limit)) break;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }
}
