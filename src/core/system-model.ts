import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = './data';
const SYSTEM_MODEL_FILE = 'system-model.json';

export interface DomainPerformance {
  query_count: number;
  avg_confidence: number;
  avg_loops: number;
  search_success_rate: number;
  fallback_rate: number;
  total_confidence: number;
  total_loops: number;
  successful_searches: number;
  total_searches: number;
  fallbacks: number;
}

export interface LearnedPattern {
  type: 'effective_query' | 'reasoning_improvement' | 'routing_rule';
  domain?: string;
  pattern: string;
  success_rate: number;
  adopted: boolean;
  improvement: number;
  uses: number;
}

export interface EvolutionEntry {
  date: string;
  change: string;
  trigger: string;
  result: string;
}

export interface SystemModel {
  version: number;
  total_queries: number;
  performance: {
    avg_confidence: number;
    by_domain: Record<string, DomainPerformance>;
  };
  learned_patterns: LearnedPattern[];
  weak_domains: string[];
  evolution_log: EvolutionEntry[];
}

function createDefaultDomainPerformance(): DomainPerformance {
  return {
    query_count: 0,
    avg_confidence: 0,
    avg_loops: 0,
    search_success_rate: 0,
    fallback_rate: 0,
    total_confidence: 0,
    total_loops: 0,
    successful_searches: 0,
    total_searches: 0,
    fallbacks: 0,
  };
}

function createDefaultModel(): SystemModel {
  return {
    version: 1,
    total_queries: 0,
    performance: {
      avg_confidence: 0,
      by_domain: {},
    },
    learned_patterns: [],
    weak_domains: [],
    evolution_log: [],
  };
}

export class SystemModelManager {
  private model: SystemModel;
  private dataPath: string;

  constructor() {
    this.dataPath = join(DATA_DIR, SYSTEM_MODEL_FILE);
    this.model = this.load();
  }

  load(): SystemModel {
    if (existsSync(this.dataPath)) {
      try {
        const raw = readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        console.warn('System model file corrupted, creating new one');
      }
    }
    return createDefaultModel();
  }

  save(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(this.dataPath, JSON.stringify(this.model, null, 2));
  }

  getModel(): SystemModel {
    return this.model;
  }

  recordQuery(
    domain: string,
    confidence: number,
    loops: number,
    searches: number,
    successfulSearches: number,
    isFallback: boolean
  ): void {
    this.model.total_queries += 1;

    // Update global average confidence
    const n = this.model.total_queries;
    this.model.performance.avg_confidence =
      ((n - 1) * this.model.performance.avg_confidence + confidence) / n;

    // Update domain performance
    if (!this.model.performance.by_domain[domain]) {
      this.model.performance.by_domain[domain] = createDefaultDomainPerformance();
    }
    const dp = this.model.performance.by_domain[domain];
    dp.query_count += 1;
    dp.total_confidence += confidence;
    dp.total_loops += loops;
    dp.total_searches += searches;
    dp.successful_searches += successfulSearches;
    if (isFallback) dp.fallbacks += 1;

    dp.avg_confidence = dp.total_confidence / dp.query_count;
    dp.avg_loops = dp.total_loops / dp.query_count;
    dp.search_success_rate = dp.total_searches > 0
      ? dp.successful_searches / dp.total_searches
      : 0;
    dp.fallback_rate = dp.fallbacks / dp.query_count;

    // Update weak domains
    this.updateWeakDomains();

    this.save();
  }

  private updateWeakDomains(): void {
    const weak: string[] = [];
    for (const [domain, dp] of Object.entries(this.model.performance.by_domain)) {
      if (dp.query_count >= 5 && dp.avg_confidence < 0.5) {
        weak.push(domain);
      }
    }
    this.model.weak_domains = weak;
  }

  addLearnedPattern(pattern: Omit<LearnedPattern, 'uses'>): void {
    // Check if similar pattern exists
    const existing = this.model.learned_patterns.find(
      p => p.pattern === pattern.pattern && p.type === pattern.type
    );
    if (existing) {
      existing.success_rate = pattern.success_rate;
      existing.improvement = pattern.improvement;
      existing.adopted = pattern.adopted;
    } else {
      this.model.learned_patterns.push({ ...pattern, uses: 0 });
    }
    this.save();
  }

  incrementPatternUse(patternStr: string): void {
    const pattern = this.model.learned_patterns.find(p => p.pattern === patternStr);
    if (pattern) {
      pattern.uses += 1;
      this.save();
    }
  }

  logEvolution(change: string, trigger: string, result: string): void {
    this.model.evolution_log.push({
      date: new Date().toISOString(),
      change,
      trigger,
      result,
    });
    this.save();
  }

  getWeakDomains(): string[] {
    return this.model.weak_domains;
  }

  getEffectivePatterns(domain?: string): LearnedPattern[] {
    return this.model.learned_patterns
      .filter(p => p.adopted && (!domain || p.domain === domain))
      .sort((a, b) => b.success_rate - a.success_rate);
  }

  analyzePerformance(): PerformanceAnalysis {
    const domains = Object.entries(this.model.performance.by_domain);
    const sorted = domains.sort(([, a], [, b]) => b.avg_confidence - a.avg_confidence);

    const strongest = sorted.filter(([, dp]) => dp.query_count >= 3).slice(0, 3);
    const weakest = sorted.filter(([, dp]) => dp.query_count >= 3).slice(-3).reverse();

    // Calculate trends
    const recentEvolutions = this.model.evolution_log.slice(-10);
    const improvements = this.model.learned_patterns.filter(p => p.improvement > 0);

    return {
      total_queries: this.model.total_queries,
      avg_confidence: this.model.performance.avg_confidence,
      strongest_domains: strongest.map(([d, dp]) => ({
        domain: d,
        confidence: dp.avg_confidence,
        queries: dp.query_count,
      })),
      weakest_domains: weakest.map(([d, dp]) => ({
        domain: d,
        confidence: dp.avg_confidence,
        queries: dp.query_count,
      })),
      total_improvements: improvements.length,
      total_evolutions: this.model.evolution_log.length,
      recent_evolutions: recentEvolutions,
      adopted_patterns: this.model.learned_patterns.filter(p => p.adopted).length,
    };
  }

  getEvolutionReport(): string {
    const analysis = this.analyzePerformance();
    const sections: string[] = [];

    sections.push('🧠 System Evolution Report');
    sections.push('━'.repeat(50));

    // Overall stats
    sections.push(`\n📊 Overall Performance:`);
    sections.push(`   Total queries: ${analysis.total_queries}`);
    sections.push(`   Average confidence: ${(analysis.avg_confidence * 100).toFixed(0)}%`);
    sections.push(`   Improvements made: ${analysis.total_improvements}`);
    sections.push(`   Patterns learned: ${analysis.adopted_patterns}`);

    // Strongest domains
    if (analysis.strongest_domains.length > 0) {
      sections.push('\n📈 Strongest Domains:');
      for (const d of analysis.strongest_domains) {
        const label = d.domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        sections.push(`   • ${label}: ${(d.confidence * 100).toFixed(0)}% confidence (${d.queries} queries)`);
      }
    }

    // Weak domains
    if (analysis.weakest_domains.length > 0) {
      sections.push('\n⚠️ Domains Needing Improvement:');
      for (const d of analysis.weakest_domains) {
        const label = d.domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        sections.push(`   • ${label}: ${(d.confidence * 100).toFixed(0)}% confidence (${d.queries} queries)`);
      }
    }

    // Recent evolutions
    if (analysis.recent_evolutions.length > 0) {
      sections.push('\n🔄 Recent Evolution Events:');
      for (const e of analysis.recent_evolutions.slice(-5).reverse()) {
        const date = new Date(e.date).toLocaleDateString();
        sections.push(`   [${date}] ${e.change}`);
        sections.push(`      → ${e.result}`);
      }
    }

    // Top patterns
    const topPatterns = this.model.learned_patterns
      .filter(p => p.adopted)
      .sort((a, b) => b.improvement - a.improvement)
      .slice(0, 3);
    if (topPatterns.length > 0) {
      sections.push('\n🎯 Top Learned Patterns:');
      for (const p of topPatterns) {
        sections.push(`   • "${p.pattern}" → +${(p.improvement * 100).toFixed(0)}% improvement (${p.uses} uses)`);
      }
    }

    return sections.join('\n');
  }
}

export interface PerformanceAnalysis {
  total_queries: number;
  avg_confidence: number;
  strongest_domains: Array<{ domain: string; confidence: number; queries: number }>;
  weakest_domains: Array<{ domain: string; confidence: number; queries: number }>;
  total_improvements: number;
  total_evolutions: number;
  recent_evolutions: EvolutionEntry[];
  adopted_patterns: number;
}
