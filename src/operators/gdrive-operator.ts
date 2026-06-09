import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { GDriveConnector } from '../connectors/gdrive-connector.js';

export class GDriveOperator extends Operator {
  private connector: GDriveConnector | null = null;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('gdrive', reasoning, memory, tools);
    this.initConnector();
  }

  private initConnector(): void {
    const keyPath = process.env.GDRIVE_SERVICE_ACCOUNT_KEY;
    const clientId = process.env.GDRIVE_CLIENT_ID;
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
    const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;

    if (keyPath) {
      this.connector = new GDriveConnector({
        serviceAccountKeyPath: keyPath,
        folderId: process.env.GDRIVE_FOLDER_ID || undefined,
        includeSharedDrives: true,
      });
    } else if (clientId && clientSecret && refreshToken) {
      this.connector = new GDriveConnector({
        clientId,
        clientSecret,
        refreshToken,
        folderId: process.env.GDRIVE_FOLDER_ID || undefined,
        includeSharedDrives: true,
      });
    }
  }

  async sync(): Promise<number> {
    if (!this.connector) {
      console.log('[GDrive] No credentials configured. Skipping.');
      return 0;
    }
    console.log('[GDrive] Starting sync...');
    const docs = await this.connector.fetchFiles();
    return this.memory.ingest(docs);
  }
}
