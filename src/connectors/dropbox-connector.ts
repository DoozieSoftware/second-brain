import { Dropbox } from 'dropbox';
import type { MemoryDocument } from '../core/memory.js';

export interface DropboxConfig {
  accessToken?: string;
  appKey?: string;
  appSecret?: string;
  refreshToken?: string;
  paths?: string[];
}

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.json',
  '.xlsx', '.xls', '.pptx', '.html', '.htm', '.rtf',
  '.ts', '.js', '.py', '.go', '.rs', '.java', '.yaml', '.yml',
]);

export class DropboxConnector {
  private config: DropboxConfig;
  private client: Dropbox;

  constructor(config: DropboxConfig) {
    this.config = config;

    if (config.accessToken) {
      this.client = new Dropbox({ accessToken: config.accessToken });
    } else if (config.appKey && config.refreshToken) {
      this.client = new Dropbox({
        clientId: config.appKey,
        clientSecret: config.appSecret,
        refreshToken: config.refreshToken,
      });
    } else {
      throw new Error('Dropbox requires either accessToken or appKey + refreshToken');
    }
  }

  async fetchFiles(): Promise<MemoryDocument[]> {
    const paths = this.config.paths || [''];
    const docs: MemoryDocument[] = [];

    for (const path of paths) {
      try {
        const files = await this.listFolder(path);
        for (const file of files) {
          try {
            const doc = await this.downloadFile(file);
            if (doc) docs.push(doc);
          } catch (error) {
            console.error(`[Dropbox] Failed to download ${file.path_display}:`, error instanceof Error ? error.message : error);
          }
        }
      } catch (error) {
        console.error(`[Dropbox] Failed to list ${path || '/'}:`, error instanceof Error ? error.message : error);
      }
    }

    console.log(`[Dropbox] Fetched ${docs.length} files.`);
    return docs;
  }

  private async listFolder(path: string): Promise<any[]> {
    const files: any[] = [];
    let cursor: string | undefined;

    const response = await this.client.filesListFolder({
      path,
      recursive: true,
      include_deleted: false,
    });

    for (const entry of response.result.entries) {
      if (entry['.tag'] === 'file' && this.isSupportedFile(entry.name)) {
        files.push(entry);
      }
    }

    cursor = response.result.has_more ? response.result.cursor : undefined;

    while (cursor) {
      const continueResponse = await this.client.filesListFolderContinue({ cursor });
      for (const entry of continueResponse.result.entries) {
        if (entry['.tag'] === 'file' && this.isSupportedFile(entry.name)) {
          files.push(entry);
        }
      }
      cursor = continueResponse.result.has_more ? continueResponse.result.cursor : undefined;
    }

    return files;
  }

  private isSupportedFile(name: string): boolean {
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  private async downloadFile(file: any): Promise<MemoryDocument | null> {
    const response = await this.client.filesDownload({ path: file.path_lower || file.path_display });
    const buffer = Buffer.from((response.result as any).fileBinary || (response.result as any).content || []);
    const text = buffer.toString('utf-8');

    if (!text || text.trim().length === 0) return null;
    // Skip binary content
    if (text.includes('\0')) return null;

    return {
      id: `dropbox:${file.id}`,
      text: `${file.name}\n\n${text.slice(0, 50000)}`,
      metadata: {
        source: 'dropbox',
        type: 'document',
        filename: file.name,
        path: file.path_display || '',
        modifiedDate: file.server_modified || file.client_modified || '',
        size: file.size || 0,
        date: file.server_modified || file.client_modified || new Date().toISOString(),
      },
    };
  }
}
