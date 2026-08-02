import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

export interface MemoryDocument {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean>;
  /** Lowercase tags attached via the knowledge API. */
  tags?: string[];
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: Record<string, string | number | boolean>;
  score: number;
}

/** A historical snapshot of a document's content. */
export interface DocumentVersion {
  version: number;
  /** Content hash (SHA-1 of text) — unchanged content produces no new version. */
  hash: string;
  text: string;
  updatedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? './data';
const MEMORY_FILE = 'memory.json';
const VERSION_FILE = 'memory-versions.json';

/** Version history keyed by document id, persisted separately so the main
 *  memory file stays small and embeddings stay fast to load. */
interface VersionStore {
  [docId: string]: DocumentVersion[];
}

/** Simple synchronous SHA-1 content hash (no crypto dependency beyond node). */
function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

interface StoredDoc extends MemoryDocument {
  embedding: number[];
  version?: number;
  tags?: string[];
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

/** Lowercase, strip punctuation, keep word-like tokens (incl. # and _ for
 *  PR#42, snake_case). Ignores very short tokens that add noise. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_+#-]+/g) || []).filter(t => t.length > 1);
}

// BM25 parameters. k1 controls term-frequency saturation, b controls
// document-length normalization.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export class Memory {
  private docs: StoredDoc[] = [];
  private extractor: FeatureExtractionPipeline | null = null;
  private dataPath: string;
  private versionsPath: string;
  private initialized = false;
  // Full-text inverted index: term -> Map(docIndex -> termFrequency).
  // Rebuilt lazily after any mutation (null means "needs rebuild").
  private textIndex: Map<string, Map<number, number>> | null = null;
  private docLengths: number[] = [];
  private versions: VersionStore = {};

  constructor(dataDir?: string) {
    this.dataPath = join(dataDir ?? DATA_DIR, MEMORY_FILE);
    this.versionsPath = join(dataDir ?? DATA_DIR, VERSION_FILE);
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

    // Load version history
    if (existsSync(this.versionsPath)) {
      try {
        this.versions = JSON.parse(readFileSync(this.versionsPath, 'utf-8'));
      } catch {
        this.versions = {};
      }
    }

    this.textIndex = null;
    this.initialized = true;
  }

  /** (Re)build the full-text inverted index from the current doc set. */
  private buildTextIndex(): void {
    this.textIndex = new Map();
    this.docLengths = new Array(this.docs.length).fill(0);

    for (let i = 0; i < this.docs.length; i++) {
      const terms = tokenize(this.docs[i].text);
      this.docLengths[i] = terms.length;
      const freqs = new Map<string, number>();
      for (const term of terms) {
        freqs.set(term, (freqs.get(term) || 0) + 1);
      }
      for (const [term, tf] of freqs) {
        let postings = this.textIndex.get(term);
        if (!postings) {
          postings = new Map();
          this.textIndex.set(term, postings);
        }
        postings.set(i, tf);
      }
    }
  }

  private ensureTextIndex(): void {
    if (!this.textIndex) this.buildTextIndex();
  }

  private invalidateTextIndex(): void {
    this.textIndex = null;
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

  private persistVersions(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(this.versionsPath, JSON.stringify(this.versions));
  }

  /** Record a new content version for a doc if its text actually changed. */
  private recordVersion(doc: MemoryDocument, prevHash: string | undefined, prevVersion?: number): number {
    const hash = contentHash(doc.text);
    if (prevHash === hash) {
      return prevVersion ?? (this.versions[doc.id] ?? []).length;
    }
    const history = this.versions[doc.id] ?? [];
    const version = history.length > 0 ? history[history.length - 1].version + 1 : 1;
    history.push({ version, hash, text: doc.text, updatedAt: new Date().toISOString() });
    if (history.length > 20) history.shift();
    this.versions[doc.id] = history;
    this.persistVersions();
    return version;
  }

  async store(doc: MemoryDocument): Promise<void> {
    if (!this.initialized) await this.init();

    const embedding = await this.embed(doc.text);
    const existing = this.docs.findIndex((d) => d.id === doc.id);

    const prev = existing >= 0 ? this.docs[existing] : undefined;
    const version = this.recordVersion(doc, prev ? contentHash(prev.text) : undefined, prev?.version);
    const tags = existing >= 0 ? this.docs[existing].tags ?? [] : [];
    const stored: StoredDoc = { ...doc, embedding, version, tags };

    if (existing >= 0) {
      this.docs[existing] = stored;
    } else {
      this.docs.push(stored);
    }

    this.invalidateTextIndex();
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
      const prev = existing >= 0 ? this.docs[existing] : undefined;
      const version = this.recordVersion(doc, prev ? contentHash(prev.text) : undefined, prev?.version);
      const tags = existing >= 0 ? this.docs[existing].tags ?? [] : [];
      const stored: StoredDoc = { ...doc, embedding, version, tags };

      if (existing >= 0) {
        this.docs[existing] = stored;
      } else {
        this.docs.push(stored);
      }

      if ((i + 1) % 50 === 0) {
        console.log(`  Embedded ${i + 1}/${docs.length}`);
      }
    }

    this.invalidateTextIndex();
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

  /** Return the most-recently-ingested documents, newest first. */
  async getRecent(limit = 100): Promise<MemoryDocument[]> {
    if (!this.initialized) await this.init();
    const end = this.docs.length;
    const start = Math.max(0, end - limit);
    return this.docs.slice(start, end).reverse().map(({ embedding, ...doc }) => doc);
  }

  /** Return a slice of the docs array. Used by callers that need to page
   *  through the entire store without the default 1000-doc cap. */
  async getAllRange(offset: number, limit: number): Promise<MemoryDocument[]> {
    if (!this.initialized) await this.init();
    return this.docs.slice(offset, offset + limit).map(({ embedding, ...doc }) => doc);
  }

  /** Fetch a single document by id. */
  async getById(id: string): Promise<MemoryDocument | undefined> {
    if (!this.initialized) await this.init();
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return undefined;
    const { embedding, ...rest } = doc;
    return rest;
  }

  // ─── Tagging ───

  /** Add tags to a document. Missing documents are ignored (returns null). */
  async addTags(id: string, tags: string[]): Promise<MemoryDocument | null> {
    if (!this.initialized) await this.init();
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const doc = this.docs[idx];
    const normalized = [...new Set([...(doc.tags ?? []), ...tags.map(t => t.toLowerCase())])];
    doc.tags = normalized;
    this.invalidateTextIndex();
    this.persist();
    const { embedding, ...rest } = doc;
    return rest;
  }

  /** Remove tags from a document. */
  async removeTags(id: string, tags: string[]): Promise<MemoryDocument | null> {
    if (!this.initialized) await this.init();
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const doc = this.docs[idx];
    const remove = new Set(tags.map(t => t.toLowerCase()));
    doc.tags = (doc.tags ?? []).filter(t => !remove.has(t));
    this.invalidateTextIndex();
    this.persist();
    const { embedding, ...rest } = doc;
    return rest;
  }

  /** All unique tags with the number of documents carrying each. */
  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    if (!this.initialized) await this.init();
    const counts = new Map<string, number>();
    for (const doc of this.docs) {
      for (const tag of doc.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Documents carrying the given tag. */
  async findByTag(tag: string): Promise<MemoryDocument[]> {
    if (!this.initialized) await this.init();
    const t = tag.toLowerCase();
    return this.docs
      .filter((d) => (d.tags ?? []).includes(t))
      .map(({ embedding, ...doc }) => doc);
  }

  // ─── Versioning ───

  /** Version history for a document, newest first. */
  async getVersions(id: string): Promise<DocumentVersion[]> {
    if (!this.initialized) await this.init();
    return [...(this.versions[id] ?? [])].sort((a, b) => b.version - a.version);
  }

  /** The version at the given number, or undefined. */
  async getVersion(id: string, version: number): Promise<DocumentVersion | undefined> {
    if (!this.initialized) await this.init();
    return (this.versions[id] ?? []).find(v => v.version === version);
  }

  /** Restore a doc to a previous version's text, creating a new version. */
  async restoreVersion(id: string, version: number): Promise<MemoryDocument | null> {
    if (!this.initialized) await this.init();
    const idx = this.docs.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    const target = (this.versions[id] ?? []).find(v => v.version === version);
    if (!target) return null;
    const doc = this.docs[idx];
    const restored: MemoryDocument = {
      ...doc,
      text: target.text,
      metadata: { ...doc.metadata, restoredFrom: String(version) },
    };
    await this.store(restored);
    return (await this.getById(id)) ?? null;
  }

  async clear(): Promise<void> {
    this.docs = [];
    this.versions = {};
    this.invalidateTextIndex();
    this.persist();
    this.persistVersions();
  }

  /**
   * Full-text BM25 search. Works without embeddings, so it also serves as a
   * fast pre-filter for hybrid search. Returns docs ranked by BM25 score
   * normalized to [0, 1].
   */
  async searchText(query: string, topK = 5): Promise<SearchResult[]> {
    if (!this.initialized) await this.init();
    if (this.docs.length === 0) return [];

    this.ensureTextIndex();
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) return [];

    const N = this.docs.length;
    const avgdl = this.docLengths.reduce((a, b) => a + b, 0) / N;
    const scores = new Map<number, number>();

    for (const term of queryTerms) {
      const postings = this.textIndex!.get(term);
      if (!postings) continue;
      const df = postings.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const [docIdx, tf] of postings) {
        const dl = this.docLengths[docIdx];
        const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
        const contribution = idf * ((tf * (BM25_K1 + 1)) / (denom || 1));
        scores.set(docIdx, (scores.get(docIdx) || 0) + contribution);
      }
    }

    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    const maxScore = ranked.length > 0 ? ranked[0][1] : 1;
    return ranked.map(([idx, score]) => ({
      id: this.docs[idx].id,
      text: this.docs[idx].text,
      metadata: this.docs[idx].metadata,
      score: maxScore > 0 ? score / maxScore : 0,
    }));
  }

  /**
   * Hybrid search: merges vector (semantic) and BM25 (keyword) rankings using
   * Reciprocal Rank Fusion. Robust when the embedding model is unavailable —
   * falls back to pure full-text search in that case.
   */
  async searchHybrid(query: string, topK = 5): Promise<SearchResult[]> {
    if (!this.initialized) await this.init();

    // Vector search requires the embedding model; run it but tolerate failure.
    let vectorResults: SearchResult[] = [];
    try {
      vectorResults = await this.search(query, topK * 2);
    } catch {
      vectorResults = [];
    }

    const textResults = await this.searchText(query, topK * 2);
    if (vectorResults.length === 0) {
      return textResults.slice(0, topK);
    }

    const K = 60; // RRF constant
    const rrfScores = new Map<string, { score: number; result: SearchResult }>();

    const addRanked = (results: SearchResult[]) => {
      results.forEach((r, i) => {
        const rank = i + 1;
        const existing = rrfScores.get(r.id);
        const contribution = 1 / (K + rank);
        if (existing) {
          existing.score += contribution;
        } else {
          rrfScores.set(r.id, { score: contribution, result: r });
        }
      });
    };

    addRanked(vectorResults);
    addRanked(textResults);

    return Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(entry => ({
        ...entry.result,
        score: entry.result.score || 0.5,
      }));
  }

  get count(): number {
    return this.docs.length;
  }
}
