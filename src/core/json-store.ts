import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = process.env.DATA_DIR ?? './data';

/**
 * Minimal, dependency-free JSON-backed store. Each store gets its own file
 * under DATA_DIR and owns a single top-level array of records.
 *
 * This is intentionally small: it exists to give the domain engines (strategy,
 * decisions, identity, analytics) a consistent persistence primitive without
 * pulling in a database. For the v1.0 deployment (single-node, local-first)
 * this is the right trade-off — swap this class for a real DB later without
 * touching callers.
 */
export class JsonStore<T extends { id: string }> {
  private records: T[] = [];
  private initialized = false;
  private dataPath: string;
  private storeDir: string;

  constructor(private fileName: string, dataDir?: string) {
    this.storeDir = dataDir ?? DATA_DIR;
    this.dataPath = join(this.storeDir, fileName);
  }

  private ensureDataDir(): void {
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
  }

  init(): void {
    if (this.initialized) return;
    this.ensureDataDir();
    if (existsSync(this.dataPath)) {
      try {
        const raw = readFileSync(this.dataPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.records = Array.isArray(parsed) ? parsed : [];
      } catch {
        this.records = [];
      }
    }
    this.initialized = true;
  }

  private persist(): void {
    this.ensureDataDir();
    writeFileSync(this.dataPath, JSON.stringify(this.records, null, 2));
  }

  all(): T[] {
    this.init();
    return [...this.records];
  }

  getById(id: string): T | undefined {
    this.init();
    return this.records.find(r => r.id === id);
  }

  upsert(record: T): T {
    this.init();
    const idx = this.records.findIndex(r => r.id === record.id);
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
    this.persist();
    return record;
  }

  /** Insert a batch of records, replacing any with matching ids. */
  upsertMany(records: T[]): number {
    if (records.length === 0) return 0;
    this.init();
    const byId = new Map(this.records.map(r => [r.id, r]));
    for (const record of records) byId.set(record.id, record);
    this.records = Array.from(byId.values());
    this.persist();
    return records.length;
  }

  delete(id: string): boolean {
    this.init();
    const before = this.records.length;
    this.records = this.records.filter(r => r.id !== id);
    if (this.records.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  clear(): void {
    this.init();
    this.records = [];
    this.persist();
  }

  get count(): number {
    this.init();
    return this.records.length;
  }
}
