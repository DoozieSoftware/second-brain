import { readFileSync, existsSync } from 'fs';
import { google } from 'googleapis';
import type { MemoryDocument } from '../core/memory.js';

export interface GDriveConfig {
  serviceAccountKeyPath?: string;
  serviceAccountKey?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folderId?: string;
  includeSharedDrives?: boolean;
}

const EXPORTABLE_MIMES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

const DOWNLOADABLE_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
]);

export class GDriveConnector {
  private config: GDriveConfig;
  private auth: any = null;

  constructor(config: GDriveConfig) {
    this.config = config;
  }

  private getAuth(): any {
    if (this.auth) return this.auth;

    if (this.config.serviceAccountKey) {
      const key = typeof this.config.serviceAccountKey === 'string'
        ? JSON.parse(this.config.serviceAccountKey)
        : this.config.serviceAccountKey;
      this.auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
    } else if (this.config.serviceAccountKeyPath) {
      if (!existsSync(this.config.serviceAccountKeyPath)) {
        throw new Error(`Service account key file not found: ${this.config.serviceAccountKeyPath}`);
      }
      const key = JSON.parse(readFileSync(this.config.serviceAccountKeyPath, 'utf-8'));
      this.auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });
    } else if (this.config.clientId && this.config.clientSecret && this.config.refreshToken) {
      this.auth = new google.auth.OAuth2(this.config.clientId, this.config.clientSecret);
      this.auth.setCredentials({ refresh_token: this.config.refreshToken });
    } else {
      throw new Error('Google Drive requires either service account key or OAuth2 credentials');
    }

    return this.auth;
  }

  async fetchFiles(): Promise<MemoryDocument[]> {
    const auth = this.getAuth();
    const drive = google.drive({ version: 'v3', auth });

    const query = this.config.folderId
      ? `'${this.config.folderId}' in parents and trashed = false`
      : 'trashed = false';

    const docs: MemoryDocument[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: query,
        pageToken,
        pageSize: 100,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)',
        includeItemsFromAllDrives: this.config.includeSharedDrives ?? true,
        supportsAllDrives: true,
      });

      for (const file of response.data.files || []) {
        try {
          const doc = await this.processFile(drive, file);
          if (doc) docs.push(doc);
        } catch (error) {
          console.error(`[GDrive] Failed to process ${file.name}:`, error instanceof Error ? error.message : error);
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    console.log(`[GDrive] Fetched ${docs.length} files.`);
    return docs;
  }

  private async processFile(drive: any, file: any): Promise<MemoryDocument | null> {
    const mimeType = file.mimeType || '';
    let text = '';

    if (EXPORTABLE_MIMES[mimeType]) {
      // Google Workspace file — export as text
      const exportMime = EXPORTABLE_MIMES[mimeType];
      const response = await drive.files.export({
        fileId: file.id,
        mimeType: exportMime,
      });
      text = response.data;
    } else if (DOWNLOADABLE_MIMES.has(mimeType)) {
      // Downloadable file
      const response = await drive.files.get({
        fileId: file.id,
        alt: 'media',
      }, { responseType: 'arraybuffer' });

      const buffer = Buffer.from(response.data as ArrayBuffer);
      text = buffer.toString('utf-8');
    } else {
      // Skip unsupported file types
      return null;
    }

    if (!text || text.trim().length === 0) return null;

    return {
      id: `gdrive:${file.id}`,
      text: `${file.name}\n\n${text.slice(0, 50000)}`,
      metadata: {
        source: 'gdrive',
        type: 'document',
        filename: file.name,
        mimeType,
        modifiedDate: file.modifiedTime || '',
        size: file.size || 0,
        url: file.webViewLink || '',
        date: file.modifiedTime || new Date().toISOString(),
      },
    };
  }
}
