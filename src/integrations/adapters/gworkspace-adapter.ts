import { BaseApiConnector, makeDoc, type ConfigValidation, type SyncOptions } from '../base-connector.js';
import type { MemoryDocument } from '../../core/memory.js';

interface GFile {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
}

interface GDriveListResponse {
  files?: GFile[];
  nextPageToken?: string;
}

/**
 * Google Workspace adapter — Drive files metadata via the Drive v3 API.
 *
 * Note: the existing GDriveConnector (src/connectors/gdrive-connector.ts)
 * already handles service-account + OAuth Drive sync with full content
 * download. This adapter exists to give the integration framework a uniform
 * Workspace entry point (Drive file listing) that can later grow Docs, Sheets,
 * and Calendar coverage without breaking the legacy connector.
 *
 * Config (env):
 *  - GDRIVE_API_KEY:  API key (public-data only) OR
 *  - GDRIVE_SERVICE_ACCOUNT_KEY / GDRIVE_CLIENT_ID + GDRIVE_REFRESH_TOKEN
 *    (prefer reusing the existing GDrive connector for authenticated sync)
 */
export class GWorkspaceAdapter extends BaseApiConnector {
  readonly name = 'gworkspace';
  readonly kind = 'sync' as const;
  readonly description = 'Google Workspace (Drive file listing)';

  private apiKey: string | undefined;

  constructor() {
    super();
    this.apiKey = process.env.GDRIVE_API_KEY || process.env.GOOGLE_DRIVE_API_KEY;
  }

  get requiredConfig(): string[] {
    return ['GDRIVE_API_KEY'];
  }

  validateConfig(): ConfigValidation {
    const missing: string[] = [];
    if (!this.apiKey) missing.push('GDRIVE_API_KEY');
    return { valid: missing.length === 0, missing };
  }

  protected baseUrl(): string {
    return 'https://www.googleapis.com/drive/v3';
  }

  protected authHeaders(): Record<string, string> {
    // API key goes in query string, not headers; return empty headers.
    return {};
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.get<GDriveListResponse>(`/files?key=${this.apiKey}&pageSize=1&fields=files(id,name)`);
      return { ok: true, message: `Connected to Drive (${(res.files ?? []).length}+ files)` };
    } catch (error) {
      return { ok: false, message: this.mapError(error, 'GDRIVE_API_KEY').message };
    }
  }

  async fetch(options?: SyncOptions): Promise<MemoryDocument[]> {
    if (!this.apiKey) throw this.mapError('GDRIVE_API_KEY not set', 'GDRIVE_API_KEY');
    const docs: MemoryDocument[] = [];
    let token: string | undefined;

    for (let guard = 0; guard < 50; guard++) {
      const params = new URLSearchParams({
        key: this.apiKey,
        pageSize: '100',
        fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime),nextPageToken',
        q: "trashed = false",
      });
      if (token) params.set('pageToken', token);
      const res = await this.get<GDriveListResponse>(`/files?${params}`);
      const files = res.files ?? [];
      for (const f of files) {
        docs.push(makeDoc('gworkspace', f.id,
          `Google Drive file: ${f.name ?? f.id} (${f.mimeType ?? 'unknown'})`,
          {
            type: 'drive_file',
            title: f.name ?? f.id,
            mimeType: f.mimeType ?? '',
            url: f.webViewLink ?? '',
            date: f.createdTime ?? '',
            updated: f.modifiedTime ?? '',
          }
        ));
      }
      token = res.nextPageToken;
      if (!token || (options?.limit && docs.length >= options.limit)) break;
    }
    return docs.slice(0, options?.limit ?? docs.length);
  }
}
