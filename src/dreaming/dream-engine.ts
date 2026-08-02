import type { Memory, MemoryDocument } from '../core/memory.js';
import type { SearchEngine } from '../core/search.js';
import { CrossSourceLinker, type Entity } from '../core/linker.js';
import { JsonStore } from '../core/json-store.js';

export interface DedupAction {
  keepId: string;
  duplicateId: string;
  /** Jaccard token overlap between the two documents (0-1). */
  similarity: number;
  source: string;
}

export interface GapFinding {
  domain: string;
  queryCount: number;
  avgConfidence: number;
  suggestion: string;
}

export interface AssociationLink {
  id: string;
  entity: string;
  type: Entity['type'];
  sources: string[];
  docIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DreamReport {
  id: string;
  startedAt: string;
  durationMs: number;
  docsScanned: number;
  deduplicated: {
    total: number;
    examples: DedupAction[];
  };
  associations: {
    totalLinks: number;
    newLinks: number;
    sample: Array<{ entity: string; sources: string[]; docCount: number }>;
  };
  gaps: GapFinding[];
  metrics: {
    docsBefore: number;
    docsAfter: number;
  };
}

export interface DreamOptions {
  /** Max docs to scan in one dream (safety cap). */
  scanLimit?: number;
  /** Jaccard similarity at or above which two docs are considered duplicates. */
  duplicateThreshold?: number;
  /** Only keep associations that span this many distinct sources. */
  minSourcesForLink?: number;
}

interface QueryMetricLike {
  domain: string;
  confidence: number;
  timestamp: string;
}

const DEFAULT_OPTIONS: Required<DreamOptions> = {
  scanLimit: 2000,
  duplicateThreshold: 0.7,
  minSourcesForLink: 2,
};

/** Normalize text for exact-duplicate detection: lowercase, collapse
 *  whitespace/punctuation, keep alphanumeric tokens. */
function normalizeText(text: string): string {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
}

/** Jaccard similarity over token sets — deterministic, embedding-free. */
function jaccard(a: string, b: string): number {
  const setA = new Set(normalizeText(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * DreamEngine — the offline memory-consolidation loop ("dreaming").
 *
 * Like sleep consolidation, a dream replays the day's memory while nobody is
 * asking questions and makes it sharper for the next retrieval:
 *
 *   1. Dedup pass — find near-duplicate docs (Jaccard over tokens, candidate
 *      discovery via hybrid search) and mark the newer one as `duplicate_of`.
 *   2. Association mining — extract entities (people, PRs, issues, URLs) and
 *      persist cross-source links, pre-warming the graph the Cross-Source
 *      Reasoner will query at ask-time.
 *   3. Gap detection — derive low-confidence domains from query metrics and
 *      emit "what the brain doesn't know yet" suggestions.
 *   4. Report — everything the dream did, persisted for the dream log.
 *
 * The engine is deterministic (no LLM dependency) so it is testable offline.
 */
export class DreamEngine {
  private memory: Memory;
  private searchEngine: SearchEngine;
  private linker: CrossSourceLinker;
  private links: JsonStore<AssociationLink>;
  private options: Required<DreamOptions>;

  constructor(
    memory: Memory,
    searchEngine: SearchEngine,
    linker: CrossSourceLinker,
    dataDir?: string,
    options: DreamOptions = {},
  ) {
    this.memory = memory;
    this.searchEngine = searchEngine;
    this.linker = linker;
    this.links = new JsonStore<AssociationLink>('associations.json', dataDir);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Run one consolidation cycle. Safe to call repeatedly. */
  async dream(opts: { queries?: QueryMetricLike[] } = {}): Promise<DreamReport> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const docsBefore = this.memory.count;

    const docs = await this.memory.getAll(this.options.scanLimit);
    const deduped = await this.deduplicate(docs);
    const associationResult = await this.mineAssociations(docs);
    const gaps = this.detectGaps(opts.queries ?? []);

    const report: DreamReport = {
      id: newId('dream'),
      startedAt,
      durationMs: Date.now() - startMs,
      docsScanned: docs.length,
      deduplicated: {
        total: deduped.actions.length,
        examples: deduped.actions.slice(0, 10),
      },
      associations: {
        totalLinks: associationResult.totalLinks,
        newLinks: associationResult.newLinks,
        sample: associationResult.sample,
      },
      gaps,
      metrics: {
        docsBefore,
        docsAfter: this.memory.count,
      },
    };

    return report;
  }

  // ─── Dedup pass ───

  private async deduplicate(docs: MemoryDocument[]): Promise<{ actions: DedupAction[] }> {
    const actions: DedupAction[] = [];
    const seenExact = new Map<string, string>(); // normalized text -> keepId
    const position = new Map(docs.map((d, i) => [d.id, i])); // docId -> array index

    for (const doc of docs) {
      // Skip docs already marked as duplicates by a previous dream.
      if (doc.metadata.duplicate_of) continue;

      const docIndex = position.get(doc.id) ?? 0;

      const exactKey = normalizeText(doc.text);
      const exactKeep = seenExact.get(exactKey);
      if (exactKeep && exactKeep !== doc.id) {
        actions.push({
          keepId: exactKeep,
          duplicateId: doc.id,
          similarity: 1,
          source: String(doc.metadata.source ?? 'unknown'),
        });
        await this.markDuplicate(doc.id, exactKeep, 1);
        continue;
      }
      seenExact.set(exactKey, doc.id);

      // Near-duplicate candidates via hybrid search (semantic + text recall).
      const candidates = await this.searchEngine.search(doc.text.slice(0, 300), { topK: 8 });
      for (const candidate of candidates) {
        if (candidate.id === doc.id) continue;
        if (candidate.metadata.duplicate_of) continue;
        // Only compare within the same source family to avoid flagging e.g. a
        // doc that legitimately quotes another.
        if (candidate.metadata.source !== doc.metadata.source) continue;
        // Keep the earlier doc; only the later one is marked as a duplicate.
        const candidateIndex = position.get(candidate.id);
        if (candidateIndex === undefined || candidateIndex > docIndex) continue;

        const sim = jaccard(doc.text, candidate.text);
        if (sim >= this.options.duplicateThreshold) {
          actions.push({
            keepId: candidate.id,
            duplicateId: doc.id,
            similarity: sim,
            source: String(doc.metadata.source ?? 'unknown'),
          });
          await this.markDuplicate(doc.id, candidate.id, sim);
          break;
        }
      }
    }

    return { actions };
  }

  /** Mark a doc as a duplicate without re-embedding it. */
  private async markDuplicate(duplicateId: string, keepId: string, similarity: number): Promise<void> {
    const doc = await this.memory.getById(duplicateId);
    if (!doc) return;
    await this.memory.updateMetadata(duplicateId, {
      duplicate_of: keepId,
      duplicate_similarity: Math.round(similarity * 100) / 100,
      dream_deduped_at: new Date().toISOString(),
    });
  }

  // ─── Association mining ───

  private async mineAssociations(docs: MemoryDocument[]): Promise<{
    totalLinks: number;
    newLinks: number;
    sample: Array<{ entity: string; sources: string[]; docCount: number }>;
  }> {
    const existing = this.links.all();
    const byEntity = new Map<string, AssociationLink>();
    for (const link of existing) byEntity.set(link.id, link);

    for (const doc of docs) {
      if (doc.metadata.duplicate_of) continue;
      const entities = this.linker.extractEntities(doc.text, String(doc.metadata.source ?? 'unknown'));
      const source = String(doc.metadata.source ?? 'unknown');

      for (const entity of entities) {
        const key = `${entity.type}:${entity.value}`;
        const link = byEntity.get(key) ?? {
          id: key,
          entity: entity.value,
          type: entity.type,
          sources: [],
          docIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (!link.docIds.includes(doc.id)) link.docIds.push(doc.id);
        if (!link.sources.includes(source)) link.sources.push(source);
        link.updatedAt = new Date().toISOString();
        byEntity.set(key, link);
      }
    }

    // Persist only cross-source links (the ones worth pre-warming a graph for).
    const beforeCount = existing.length;
    const crossSource = Array.from(byEntity.values())
      .filter(l => l.sources.length >= this.options.minSourcesForLink)
      .sort((a, b) => b.docIds.length - a.docIds.length);

    for (const link of crossSource) this.links.upsert(link);

    return {
      totalLinks: crossSource.length,
      newLinks: Math.max(0, crossSource.length - beforeCount),
      sample: crossSource.slice(0, 5).map(l => ({ entity: l.entity, sources: l.sources, docCount: l.docIds.length })),
    };
  }

  // ─── Gap detection ───

  private detectGaps(queries: QueryMetricLike[]): GapFinding[] {
    if (queries.length === 0) return [];

    const byDomain = new Map<string, { total: number; count: number }>();
    for (const q of queries) {
      const entry = byDomain.get(q.domain) ?? { total: 0, count: 0 };
      entry.total += q.confidence;
      entry.count++;
      byDomain.set(q.domain, entry);
    }

    const gaps: GapFinding[] = [];
    for (const [domain, stats] of byDomain) {
      if (stats.count < 2) continue; // need at least 2 samples to call it a gap
      const avgConfidence = stats.total / stats.count;
      if (avgConfidence >= 0.4) continue;
      gaps.push({
        domain,
        queryCount: stats.count,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        suggestion: `Low answer confidence (${Math.round(avgConfidence * 100)}%) across ${stats.count} queries in "${domain}". Sync more sources for this domain or import relevant documents.`,
      });
    }

    return gaps.sort((a, b) => a.avgConfidence - b.avgConfidence);
  }
}
