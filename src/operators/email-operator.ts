import { Operator } from '../core/operator.js';
import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import { ToolRegistry } from '../core/tools.js';
import { EmailConnector } from '../connectors/email-connector.js';
import type { EmailAccount } from '../connectors/email-connector.js';
import { SmtpConnector } from '../connectors/smtp-connector.js';
import { EmailConfigStore } from '../core/email-config-store.js';

export class EmailOperator extends Operator {
  private emailConnector: EmailConnector | null = null;
  private smtpConnector: SmtpConnector | null = null;
  private accounts: EmailAccount[] = [];
  private configStore: EmailConfigStore;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    const tools = new ToolRegistry();
    super('email', reasoning, memory, tools);
    this.configStore = new EmailConfigStore();
    this.parseAccounts();
    this.registerTools();
  }

  private parseAccounts(): void {
    // 1. Read from config store (settings page)
    const storedAccounts = this.configStore.getAll();
    if (storedAccounts.length > 0) {
      this.accounts = storedAccounts;
    }

    // 2. Fall back to EMAIL_ACCOUNTS env var
    if (this.accounts.length === 0) {
      const accountsJson = process.env.EMAIL_ACCOUNTS;
      if (accountsJson) {
        try {
          this.accounts = JSON.parse(accountsJson);
        } catch {
          console.error('[Email] Failed to parse EMAIL_ACCOUNTS JSON');
        }
      }
    }

    // 3. Fall back to single-account IMAP_* vars
    if (this.accounts.length === 0 && process.env.IMAP_USER && process.env.IMAP_PASSWORD) {
      this.accounts = [{
        name: 'default',
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: parseInt(process.env.IMAP_PORT || '993'),
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        folders: ['INBOX'],
      }];
    }

    if (this.accounts.length > 0) {
      this.emailConnector = new EmailConnector(this.accounts);

      // Set up SMTP for accounts that have smtp config
      this.smtpConnector = new SmtpConnector();
      for (const account of this.accounts) {
        if (account.smtp) {
          this.smtpConnector.addAccount(account.name, account.smtp);
        }
      }
    }
  }

  private registerTools(): void {
    if (!this.smtpConnector) return;

    this.tools.register({
      name: 'send_email',
      description: 'Send an email from a configured account',
      parameters: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Account name to send from' },
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body text' },
        },
        required: ['account', 'to', 'subject', 'body'],
      },
      handler: async (args) => {
        try {
          const result = await this.smtpConnector!.send(args.account as string, {
            from: '',
            to: args.to as string,
            subject: args.subject as string,
            text: args.body as string,
          });
          return `Email sent. Message ID: ${result.messageId}`;
        } catch (error) {
          return `Failed to send email: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });
  }

  async sync(since?: Date): Promise<number> {
    if (!this.emailConnector) {
      console.log('[Email] No email accounts configured. Skipping.');
      return 0;
    }
    console.log(`[Email] Starting sync (${this.accounts.length} account(s))...`);
    const docs = await this.emailConnector.fetchEmails(since);
    return this.memory.ingest(docs);
  }
}
