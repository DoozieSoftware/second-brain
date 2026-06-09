import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { DropboxConnector } from '../connectors/dropbox-connector.js';
import { ConnectorConfigStore } from '../core/connector-config-store.js';

export class DropboxOperator extends Operator {
  private connector: DropboxConnector | null = null;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('dropbox', reasoning, memory, tools);
    this.initConnector();
  }

  private initConnector(): void {
    // 1. Check config store (settings page)
    const stored = new ConnectorConfigStore().getDropbox();
    if (stored) {
      try {
        this.connector = new DropboxConnector({
          accessToken: stored.accessToken,
          appKey: stored.appKey,
          appSecret: stored.appSecret,
          refreshToken: stored.refreshToken,
          paths: stored.paths?.length ? stored.paths : undefined,
        });
        return;
      } catch {
        // Fall through to env vars
      }
    }

    // 2. Fall back to env vars
    const accessToken = process.env.DROPBOX_ACCESS_TOKEN;
    const appKey = process.env.DROPBOX_APP_KEY;
    const appSecret = process.env.DROPBOX_APP_SECRET;
    const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

    if (accessToken) {
      this.connector = new DropboxConnector({
        accessToken,
        paths: process.env.DROPBOX_PATHS?.split(',').map(p => p.trim()) || undefined,
      });
    } else if (appKey && refreshToken) {
      this.connector = new DropboxConnector({
        appKey,
        appSecret,
        refreshToken,
        paths: process.env.DROPBOX_PATHS?.split(',').map(p => p.trim()) || undefined,
      });
    }
  }

  async sync(): Promise<number> {
    if (!this.connector) {
      console.log('[Dropbox] No credentials configured. Skipping.');
      return 0;
    }
    console.log('[Dropbox] Starting sync...');
    const docs = await this.connector.fetchFiles();
    return this.memory.ingest(docs);
  }
}
