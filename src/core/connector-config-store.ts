import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_FILE = 'connector-config.json';

export interface GDriveSettings {
  authType: 'service_account' | 'oauth2';
  serviceAccountKey?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folderId?: string;
  includeSharedDrives: boolean;
}

export interface DropboxSettings {
  authType: 'access_token' | 'oauth2';
  accessToken?: string;
  appKey?: string;
  appSecret?: string;
  refreshToken?: string;
  paths: string[];
}

interface ConnectorStore {
  gdrive: GDriveSettings | null;
  dropbox: DropboxSettings | null;
  updatedAt: string;
}

export class ConnectorConfigStore {
  private path: string;
  private store: ConnectorStore;

  constructor() {
    this.path = join(DATA_DIR, CONFIG_FILE);
    this.store = this.load();
  }

  private load(): ConnectorStore {
    if (existsSync(this.path)) {
      try {
        return JSON.parse(readFileSync(this.path, 'utf-8'));
      } catch {
        // Corrupted
      }
    }
    return { gdrive: null, dropbox: null, updatedAt: new Date().toISOString() };
  }

  private persist(): void {
    this.store.updatedAt = new Date().toISOString();
    writeFileSync(this.path, JSON.stringify(this.store, null, 2));
  }

  // Google Drive
  getGDrive(): GDriveSettings | null {
    return this.store.gdrive;
  }

  setGDrive(settings: GDriveSettings): void {
    this.store.gdrive = settings;
    this.persist();
  }

  clearGDrive(): void {
    this.store.gdrive = null;
    this.persist();
  }

  getGDriveSafe(): Partial<GDriveSettings> | null {
    if (!this.store.gdrive) return null;
    const s = { ...this.store.gdrive };
    if (s.clientSecret) s.clientSecret = '••••••••';
    if (s.refreshToken) s.refreshToken = '••••••••';
    return s;
  }

  // Dropbox
  getDropbox(): DropboxSettings | null {
    return this.store.dropbox;
  }

  setDropbox(settings: DropboxSettings): void {
    this.store.dropbox = settings;
    this.persist();
  }

  clearDropbox(): void {
    this.store.dropbox = null;
    this.persist();
  }

  getDropboxSafe(): Partial<DropboxSettings> | null {
    if (!this.store.dropbox) return null;
    const s = { ...this.store.dropbox };
    if (s.accessToken) s.accessToken = '••••••••';
    if (s.appSecret) s.appSecret = '••••••••';
    if (s.refreshToken) s.refreshToken = '••••••••';
    return s;
  }
}
