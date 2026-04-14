import type { Memory } from './memory.js';
import type { SearchResult } from './memory.js';

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  source?: string;
  type?: string;
  dateAfter?: string;
}

export class SearchEngine {
  private memory: Memory;
  private searchHistory: string[] = [];
  private defaultMinScore = 0.25;

  constructor(memory: Memory) {
    this.memory = memory;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.topK ?? 10;
    const minScore = options?.minScore ?? this.defaultMinScore;

    // Delegate to memory for vector search
    const rawResults = await this.memory.search(query, topK);

    // Apply filters
    let results = rawResults;

    // Score threshold
    results = results.filter(r => r.score >= minScore);

    // Source filter
    if (options?.source) {
      results = results.filter(r => r.metadata.source === options.source);
    }

    // Type filter
    if (options?.type) {
      results = results.filter(r => r.metadata.type === options.type);
    }

    // Date filter
    if (options?.dateAfter) {
      results = results.filter(r =>
        r.metadata.date && r.metadata.date >= options.dateAfter!
      );
    }

    // Track this query
    this.searchHistory.push(query);

    return results;
  }

  getSearchHistory(): string[] {
    return [...this.searchHistory];
  }

  clearHistory(): void {
    this.searchHistory = [];
  }
}