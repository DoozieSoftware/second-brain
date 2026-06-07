import type { SearchEngine } from './search.js';
import type { SearchResult } from './memory.js';

export interface Entity {
  type: 'person' | 'project' | 'pr_number' | 'issue_number' | 'date' | 'url';
  value: string;
  source: string;
}

export interface Connection {
  entity: Entity;
  relatedDocs: SearchResult[];
  sources: string[];
}

export class CrossSourceLinker {
  private searchEngine: SearchEngine;

  constructor(searchEngine: SearchEngine) {
    this.searchEngine = searchEngine;
  }

  extractEntities(text: string, source: string): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    const addEntity = (type: Entity['type'], value: string) => {
      const key = `${type}:${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ type, value, source });
      }
    };

    const prPattern = /(?:PR|pull request)\s*#?\s*(\d+)/gi;
    let match;
    while ((match = prPattern.exec(text)) !== null) {
      addEntity('pr_number', match[1]);
    }

    const issuePattern = /issue\s*#?\s*(\d+)/gi;
    while ((match = issuePattern.exec(text)) !== null) {
      addEntity('issue_number', match[1]);
    }

    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    while ((match = emailPattern.exec(text)) !== null) {
      addEntity('person', match[0]);
    }

    const mentionPattern = /(?<![\w.])@(\w+)/g;
    while ((match = mentionPattern.exec(text)) !== null) {
      addEntity('person', match[0]);
    }

    const githubUrlPattern = /https:\/\/github\.com\/[\w/-]+/g;
    while ((match = githubUrlPattern.exec(text)) !== null) {
      addEntity('url', match[0]);
    }

    return entities;
  }

  async findConnections(doc: SearchResult): Promise<Connection[]> {
    const entities = this.extractEntities(doc.text, (doc.metadata.source as string) || 'unknown');
    const connections: Connection[] = [];

    for (const entity of entities) {
      const results = await this.searchEngine.search(entity.value, { topK: 5 });
      const related = results.filter(r => r.id !== doc.id);

      if (related.length > 0) {
        const sources = [...new Set(related.map(r => r.metadata.source as string).filter(Boolean))];
        connections.push({
          entity,
          relatedDocs: related,
          sources,
        });
      }
    }

    return connections;
  }

  async findAcrossSources(entity: string, sources?: string[]): Promise<SearchResult[]> {
    const allResults = await this.searchEngine.search(entity, { topK: 10 });

    if (sources && sources.length > 0) {
      return allResults.filter(r => sources.includes(r.metadata.source as string));
    }

    return allResults;
  }

  async detectConflicts(docs: SearchResult[]): Promise<{ topic: string; docs: SearchResult[] }[]> {
    const conflictPairs = [
      ['approved', 'rejected'],
      ['open', 'closed'],
      ['merged', 'reverted'],
      ['success', 'failure'],
      ['pass', 'fail'],
    ];

    const conflicts: { topic: string; docs: SearchResult[] }[] = [];

    for (const [term1, term2] of conflictPairs) {
      const docsWithTerm1 = docs.filter(d => d.text.toLowerCase().includes(term1));
      const docsWithTerm2 = docs.filter(d => d.text.toLowerCase().includes(term2));

      if (docsWithTerm1.length > 0 && docsWithTerm2.length > 0) {
        conflicts.push({
          topic: `${term1} vs ${term2}`,
          docs: [...docsWithTerm1, ...docsWithTerm2],
        });
      }
    }

    return conflicts;
  }
}
