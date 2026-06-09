import nodemailer from 'nodemailer';
import type { SmtpConfig } from './email-connector.js';

export interface EmailMessage {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export class SmtpConnector {
  private configs: Map<string, SmtpConfig> = new Map();

  addAccount(name: string, config: SmtpConfig): void {
    this.configs.set(name, config);
  }

  getAccountNames(): string[] {
    return Array.from(this.configs.keys());
  }

  async send(accountName: string, message: EmailMessage): Promise<{ messageId: string }> {
    const config = this.configs.get(accountName);
    if (!config) {
      throw new Error(`No SMTP config for account "${accountName}". Available: ${this.getAccountNames().join(', ')}`);
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });

    const info = await transporter.sendMail({
      from: message.from || config.user,
      to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      cc: message.cc,
      bcc: message.bcc,
    });

    return { messageId: info.messageId };
  }
}
