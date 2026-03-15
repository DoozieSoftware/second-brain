import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { EmailConnector } from '../connectors/email-connector.js';

export class EmailOperator extends Operator {
  private connector: EmailConnector | null = null;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('email', reasoning, memory, tools);
  }

  private getConnector(): EmailConnector {
    if (!this.connector) {
      this.connector = new EmailConnector({
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: parseInt(process.env.IMAP_PORT || '993'),
        user: process.env.IMAP_USER || '',
        password: process.env.IMAP_PASSWORD || '',
      });
    }
    return this.connector;
  }

  async sync(since?: Date): Promise<number> {
    if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      console.log('[Email] No IMAP credentials configured. Skipping.');
      return 0;
    }
    console.log('[Email] Starting sync...');
    const docs = await this.getConnector().fetchEmails(since);
    return this.memory.ingest(docs);
  }
}
