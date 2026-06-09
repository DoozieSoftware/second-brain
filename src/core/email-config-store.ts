import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { EmailAccount } from '../connectors/email-connector.js';

const DATA_DIR = './data';
const CONFIG_FILE = 'email-config.json';

interface EmailStore {
  accounts: EmailAccount[];
  updatedAt: string;
}

export class EmailConfigStore {
  private path: string;
  private store: EmailStore;

  constructor() {
    this.path = join(DATA_DIR, CONFIG_FILE);
    this.store = this.load();
  }

  private load(): EmailStore {
    if (existsSync(this.path)) {
      try {
        return JSON.parse(readFileSync(this.path, 'utf-8'));
      } catch {
        // Corrupted file, start fresh
      }
    }
    return { accounts: [], updatedAt: new Date().toISOString() };
  }

  private persist(): void {
    this.store.updatedAt = new Date().toISOString();
    writeFileSync(this.path, JSON.stringify(this.store, null, 2));
  }

  getAll(): EmailAccount[] {
    return this.store.accounts;
  }

  getByName(name: string): EmailAccount | undefined {
    return this.store.accounts.find(a => a.name === name);
  }

  add(account: EmailAccount): void {
    const existing = this.store.accounts.findIndex(a => a.name === account.name);
    if (existing >= 0) {
      this.store.accounts[existing] = account;
    } else {
      this.store.accounts.push(account);
    }
    this.persist();
  }

  remove(name: string): boolean {
    const idx = this.store.accounts.findIndex(a => a.name === name);
    if (idx < 0) return false;
    this.store.accounts.splice(idx, 1);
    this.persist();
    return true;
  }

  // Mask passwords for safe display
  getAllSafe(): Array<Omit<EmailAccount, 'password'> & { password: string; smtpPassword?: string }> {
    return this.store.accounts.map(a => ({
      ...a,
      password: '••••••••',
      smtpPassword: a.smtp ? '••••••••' : undefined,
    }));
  }
}
