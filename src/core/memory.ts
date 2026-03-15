import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface MemoryDocument {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean>;
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean>;
  score: number;
}

const DATA_DIR = './data';
const MEMORY_FILE = 'memory.json';

interface StoredDoc extends MemoryDocument {
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class Memory {
  private docs: StoredDoc[] = [];
  private extractor: FeatureExtractionPipeline | null = null;
  private dataPath: string;
  private initialized = false;

  constructor() {
    this.dataPath = join(DATA_DIR, MEMORY_FILE);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('Loading embedding model (first run downloads ~80MB)...');
    this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Embedding model loaded.');

    // Load persisted memory
    if (existsSync(this.dataPath)) {
      try {
        const raw = readFileSync(this.dataPath, 'utf-8');
        this.docs = JSON.parse(raw);
        console.log(`Loaded ${this.docs.length} documents from memory.`);
      } catch {
        this.docs = [];
      }
    }

    this.initialized = true;
  }

  private async embed(text: string): Promise<number[]> {
    if (!this.extractor) await this.init();
    const output = await this.extractor!(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  private persist(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(this.dataPath, JSON.stringify(this.docs));
  }

  async store(doc: MemoryDocument): Promise<void> {
    if (!this.initialized) await this.init();

    const embedding = await this.embed(doc.text);
    const existing = this.docs.findIndex((d) => d.id === doc.id);

    const stored: StoredDoc = { ...doc, embedding };

    if (existing >= 0) {
      this.docs[existing] = stored;
    } else {
      this.docs.push(stored);
    }

    this.persist();
  }

  async ingest(docs: MemoryDocument[]): Promise<number> {
    if (!this.initialized) await this.init();
    if (docs.length === 0) return 0;

    console.log(`Ingesting ${docs.length} documents...`);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const embedding = await this.embed(doc.text);
      const existing = this.docs.findIndex((d) => d.id === doc.id);
      const stored: StoredDoc = { ...doc, embedding };

      if (existing >= 0) {
        this.docs[existing] = stored;
      } else {
        this.docs.push(stored);
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  Embedded ${i + 1}/${docs.length}`);
      }
    }

    this.persist();
    console.log(`Ingested ${docs.length} documents. Total: ${this.docs.length}`);
    return docs.length;
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    if (!this.initialized) await this.init();
    if (this.docs.length === 0) return [];

    const queryEmbedding = await this.embed(query);

    const scored = this.docs.map((doc) => ({
      id: doc.id,
      text: doc.text,
      metadata: doc.metadata,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async getAll(limit = 1000): Promise<MemoryDocument[]> {
    if (!this.initialized) await this.init();
    return this.docs.slice(0, limit).map(({ embedding, ...doc }) => doc);
  }

  async clear(): Promise<void> {
    this.docs = [];
    this.persist();
  }

  get count(): number {
    return this.docs.length;
  }
}
