import { JsonStore } from '../core/json-store.js';
import type { SearchEngine } from '../core/search.js';

export type DecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'implemented';

export interface DecisionOption {
  label: string;
  pros: string[];
  cons: string[];
  /** Ranked by the decision maker (lower = more preferred). */
  score?: number;
}

export interface DecisionRecord {
  id: string;
  /** Title in ADR form: "ADR-0001: Choose Postgres over MySQL". */
  title: string;
  status: DecisionStatus;
  /** The question being decided. */
  context: string;
  /** One-line statement of what was decided. */
  decision: string;
  /** Why this decision was made — the rationale. */
  rationale: string;
  options: DecisionOption[];
  /** People involved. */
  owners: string[];
  /** Comma-separated keywords for cross-doc matching. */
  keywords: string[];
  /** Ids of memory documents that informed or resulted from the decision. */
  relatedDocIds: string[];
  /** Ids of decisions this one supersedes. */
  supersedes: string[];
  /** Ids of decisions that were superseded by this one. */
  supersededBy: string[];
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
}

export interface ImpactFinding {
  docId: string;
  source: string;
  type: string;
  excerpt: string;
  score: number;
}

export interface DecisionImpact {
  decision: DecisionRecord;
  /** Memory documents that reference the decision's keywords. */
  relatedDocs: ImpactFinding[];
  /** Decisions that chain from this one (superseded or referencing keywords). */
  chainedDecisions: DecisionRecord[];
  /** Simple consequence summary. */
  summary: string;
}

let seq = 0;
function newId(): string {
  seq += 1;
  return `adr_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Decision Engine — records architecture and business decisions with full
 * traceability: options considered, rationale, owners, and links to both the
 * memory documents that motivated them and the decisions they supersede.
 */
export class DecisionEngine {
  private store: JsonStore<DecisionRecord>;
  private searchEngine?: SearchEngine;

  constructor(searchEngine?: SearchEngine, dataDir?: string) {
    this.store = new JsonStore<DecisionRecord>('decisions.json', dataDir);
    this.searchEngine = searchEngine;
  }

  record(input: Omit<DecisionRecord, 'id' | 'createdAt' | 'updatedAt'>): DecisionRecord {
    const record: DecisionRecord = {
      ...input,
      id: newId(),
      createdAt: now(),
      updatedAt: now(),
      decidedAt: input.decidedAt ?? (input.status === 'accepted' || input.status === 'implemented' ? now() : undefined),
    };

    // Maintain the supersedes/supersededBy backlink.
    for (const supersededId of record.supersedes) {
      const target = this.store.getById(supersededId);
      if (target) {
        this.store.upsert({ ...target, supersededBy: [...target.supersededBy, record.id], updatedAt: now() });
      }
    }

    return this.store.upsert(record);
  }

  list(status?: DecisionStatus): DecisionRecord[] {
    let records = this.store.all();
    if (status) records = records.filter(r => r.status === status);
    // Sort by decided/created time, tie-broken by id (ids embed an insertion
    // sequence so same-millisecond records still order deterministically).
    return records.sort((a, b) => {
      const byTime = (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt);
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    });
  }

  get(id: string): DecisionRecord | undefined {
    return this.store.getById(id);
  }

  update(id: string, patch: Partial<Omit<DecisionRecord, 'id' | 'createdAt'>>): DecisionRecord | undefined {
    const record = this.store.getById(id);
    if (!record) return undefined;
    const updated: DecisionRecord = { ...record, ...patch, id, updatedAt: now() };
    if (patch.status === 'accepted' || patch.status === 'implemented') {
      updated.decidedAt = updated.decidedAt ?? now();
    }
    return this.store.upsert(updated);
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }

  searchByKeyword(keyword: string): DecisionRecord[] {
    const q = keyword.toLowerCase();
    return this.store.all().filter(r =>
      r.keywords.some(k => k.toLowerCase().includes(q)) ||
      r.title.toLowerCase().includes(q) ||
      r.context.toLowerCase().includes(q) ||
      r.decision.toLowerCase().includes(q)
    );
  }

  /** Chronology of a decision: what it supersedes and what came after. */
  chronology(id: string): { record: DecisionRecord | undefined; ancestors: DecisionRecord[]; descendants: DecisionRecord[] } {
    const record = this.store.getById(id);
    if (!record) return { record, ancestors: [], descendants: [] };
    const ancestors = record.supersedes
      .map(sid => this.store.getById(sid))
      .filter((r): r is DecisionRecord => !!r);
    const descendants = record.supersededBy
      .map(sid => this.store.getById(sid))
      .filter((r): r is DecisionRecord => !!r);
    return { record, ancestors, descendants };
  }

  /**
   * Impact analysis: finds memory docs that reference the decision and the
   * decisions that chain from it. Requires a SearchEngine; without one it
   * returns an empty relatedDocs list.
   */
  async analyzeImpact(id: string): Promise<DecisionImpact> {
    const decision = this.store.getById(id);
    if (!decision) throw new Error(`Decision "${id}" not found`);

    const relatedDocs: ImpactFinding[] = [];
    if (this.searchEngine) {
      const query = decision.keywords.join(' ') || decision.decision;
      try {
        const results = await this.searchEngine.search(query, { topK: 8, mode: 'hybrid', minScore: 0.1 });
        for (const r of results) {
          if (decision.relatedDocIds.includes(r.id)) continue;
          relatedDocs.push({
            docId: r.id,
            source: (r.metadata.source as string) || 'unknown',
            type: (r.metadata.type as string) || 'document',
            excerpt: r.text.slice(0, 200),
            score: r.score,
          });
        }
      } catch {
        // Search unavailable (e.g. no embedding model) — degrade gracefully.
      }
    }

    const chainedDecisions = this.store.all().filter(r => {
      if (r.id === decision.id) return false;
      const linked = r.supersedes.includes(decision.id) || decision.supersededBy.includes(r.id);
      if (linked) return true;
      return r.keywords.some(k =>
        decision.keywords.some(dk => dk.toLowerCase() === k.toLowerCase())
      ) && r.createdAt >= decision.createdAt;
    });

    return {
      decision,
      relatedDocs,
      chainedDecisions,
      summary: this.buildSummary(decision, relatedDocs, chainedDecisions),
    };
  }

  private buildSummary(decision: DecisionRecord, docs: ImpactFinding[], chained: DecisionRecord[]): string {
    const parts: string[] = [];
    parts.push(`Decision "${decision.title}" (${decision.status}).`);
    if (docs.length > 0) {
      const sources = [...new Set(docs.map(d => d.source))];
      parts.push(`Referenced by ${docs.length} documents across ${sources.join(', ')}.`);
    }
    if (chained.length > 0) {
      parts.push(`${chained.length} follow-up decision(s) build on this one.`);
    }
    if (decision.supersedes.length > 0) {
      parts.push(`Supersedes ${decision.supersedes.length} earlier decision(s).`);
    }
    return parts.join(' ');
  }
}
