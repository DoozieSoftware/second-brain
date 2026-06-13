import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MemoryDocument } from '../core/memory.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

export interface EmailAccount {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
  folders?: string[];
  smtp?: SmtpConfig;
}

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

export class EmailConnector {
  private accounts: EmailAccount[];

  constructor(config: EmailConfig | EmailAccount[]) {
    if (Array.isArray(config)) {
      this.accounts = config;
    } else {
      this.accounts = [{
        name: 'default',
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        secure: config.secure,
        folders: ['INBOX'],
      }];
    }
  }

  getAccounts(): EmailAccount[] {
    return this.accounts;
  }

  async fetchEmails(since?: Date, limit = 100): Promise<MemoryDocument[]> {
    const allDocs: MemoryDocument[] = [];

    for (const account of this.accounts) {
      const folders = account.folders || ['INBOX'];
      for (const folder of folders) {
        const docs = await this.fetchFromFolder(account, folder, since, limit);
        allDocs.push(...docs);
      }
    }

    console.log(`[Email] Fetched ${allDocs.length} emails from ${this.accounts.length} account(s).`);
    return allDocs;
  }

  private async fetchFromFolder(
    account: EmailAccount,
    folder: string,
    since?: Date,
    limit = 100
  ): Promise<MemoryDocument[]> {
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure ?? true,
      auth: {
        user: account.user,
        pass: account.password,
      },
      logger: false,
    });

    const docs: MemoryDocument[] = [];

    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);

      try {
        const searchCriteria: Record<string, unknown> = {};
        if (since) {
          searchCriteria.since = since;
        }

        let count = 0;
        for await (const message of client.fetch(searchCriteria, {
          source: true,
          envelope: true,
        })) {
          if (count >= limit) break;
          count++;

          try {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source as Buffer);
            const subject = parsed.subject || '(no subject)';
            const from = parsed.from?.text || 'unknown';
            // mailparser returns `to` as an `AddressObject` for a single
            // recipient or an array of `AddressObject` for distribution
            // lists. The old guard silently dropped the array case, which
            // meant every multi-recipient email lost its recipient list and
            // the linker couldn't extract any person entities for those
            // recipients.
            const to = parsed.to
              ? (Array.isArray(parsed.to)
                  ? parsed.to.map((a: any) => a?.text ?? '').filter(Boolean).join(', ')
                  : (parsed.to as any).text ?? '')
              : '';
            const date = parsed.date?.toISOString() || 'unknown';
            const body = (parsed.text || '').slice(0, 3000);

            const accountId = `${account.name}:${folder}`;
            docs.push({
              id: `email:${accountId}:${message.uid}`,
              text: `Email from ${from} to ${to} on ${date}\nSubject: ${subject}\n\n${body}`,
              metadata: {
                source: 'email',
                type: 'email',
                account: account.name,
                folder,
                subject,
                from,
                to,
                date,
                uid: message.uid,
              },
            });
          } catch {
            // Skip unparseable messages
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error) {
      console.error(`[Email] Fetch error (${account.name}/${folder}):`, error instanceof Error ? error.message : error);
    }

    return docs;
  }
}
