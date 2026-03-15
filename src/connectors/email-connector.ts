import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MemoryDocument } from '../core/memory.js';

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
}

export class EmailConnector {
  private config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  async fetchEmails(since?: Date, limit = 100): Promise<MemoryDocument[]> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure ?? true,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: false,
    });

    const docs: MemoryDocument[] = [];

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Search for emails since the given date
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
            const date = parsed.date?.toISOString() || 'unknown';
            const body = (parsed.text || '').slice(0, 3000);

            docs.push({
              id: `email:${message.uid}`,
              text: `Email from ${from} on ${date}\nSubject: ${subject}\n\n${body}`,
              metadata: {
                source: 'email',
                type: 'email',
                subject,
                from,
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
      console.error('Email fetch error:', error instanceof Error ? error.message : error);
    }

    console.log(`Fetched ${docs.length} emails.`);
    return docs;
  }
}
