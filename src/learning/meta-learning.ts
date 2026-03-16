import { SystemModelManager, type LearnedPattern, type EvolutionEntry } from '../core/system-model.js';
import { Memory } from '../core/memory.js';
import type { OperatorResponse, ReasoningStep } from '../core/operator.js';
import type { FeedbackSignal } from './profile-updater.js';

export interface QueryObservation {
  query: string;
  domain: string;
  confidence: number;
  loops: number;
  searchCount: number;
  successfulSearches: number;
  isFallback: boolean;
  timestamp: string;
}

export interface Improvement {
  type: 'search_strategy' | 'reasoning_heuristic' | 'confidence_calibration' | 'domain_routing';
  domain?: string;
  description: string;
  implementation: string;
  expectedImprovement: number;
}

export interface AnalysisReport {
  period: string;
  totalQueries: number;
  avgConfidence: number;
  avgLoops: number;
  searchSuccessRate: number;
  weakDomains: Array<{ domain: string; confidence: number; queries: number }>;
  strongDomains: Array<{ domain: string; confidence: number; queries: number }>;
  improvements: Improvement[];
  confidenceTrend: 'improving' | 'stable' | 'declining';
}

const MIN_QUERIES_FOR_ANALYSIS = 5;
const IMPROVEMENT_THRESHOLD = 0.1; // 10% improvement to log as evolution

export class MetaLearningEngine {
  private systemModel: SystemModelManager;
  private memory: Memory;
  private observations: QueryObservation[] = [];
  private feedbackSignals: FeedbackSignal[] = [];
  private lastAnalysisTime: number = 0;

  constructor(systemModel: SystemModelManager, memory: Memory) {
    this.systemModel = systemModel;
    this.memory = memory;
  }

  async observeQuery(
    query: string,
    domain: string,
    result: OperatorResponse,
    steps: ReasoningStep[],
    searches: number,
    successfulSearches: number
  ): Promise<void> {
    const observation: QueryObservation = {
      query,
      domain,
      confidence: result.confidence,
      loops: steps.length,
      searchCount: searches,
      successfulSearches,
      isFallback: result.confidence < 0.2,
      timestamp: new Date().toISOString(),
    };

    this.observations.push(observation);

    // Record in system model
    this.systemModel.recordQuery(
      domain,
      result.confidence,
      steps.length,
      searches,
      successfulSearches,
      result.confidence < 0.2
    );

    // Real-time analysis: check for immediate improvements
    await this.analyzeObservation(observation, steps);
  }

  async observeFeedback(feedback: FeedbackSignal): Promise<void> {
    this.feedbackSignals.push(feedback);

    // Check if feedback suggests a pattern
    if (feedback.type === 'explicit' && feedback.quality === 'bad') {
      // Bad explicit feedback is a strong signal
      const domain = this.detectDomainFromQuery(feedback.query);
      this.systemModel.addLearnedPattern({
        type: 'reasoning_improvement',
        domain,
        pattern: `User corrected answer about ${domain}`,
        success_rate: 0,
        adopted: true,
        improvement: -0.1,
      });
    }
  }

  private async analyzeObservation(obs: QueryObservation, steps: ReasoningStep[]): Promise<void> {
    // 1. Analyze search efficiency
    if (obs.searchCount > 0) {
      const searchSuccessRate = obs.successfulSearches / obs.searchCount;
      if (searchSuccessRate < 0.3 && obs.searchCount >= 3) {
        // Low search success - try different query strategies
        this.systemModel.addLearnedPattern({
          type: 'effective_query',
          domain: obs.domain,
          pattern: `Broad queries work better than specific ones for ${obs.domain}`,
          success_rate: searchSuccessRate,
          adopted: true,
          improvement: 0,
        });
      }
    }

    // 2. Analyze loop efficiency
    if (obs.loops > 5) {
      // Too many loops - could add early stopping heuristic
      this.systemModel.addLearnedPattern({
        type: 'reasoning_improvement',
        domain: obs.domain,
        pattern: `${obs.domain} questions often need >5 loops - consider domain-specific heuristics`,
        success_rate: 0.5,
        adopted: true,
        improvement: 0,
      });

      this.systemModel.logEvolution(
        `Identified ${obs.domain} needs optimization`,
        `${obs.loops} reasoning loops for a single query`,
        'Flagged for early-stopping heuristic development'
      );
    }

    // 3. Detect successful patterns
    if (obs.confidence > 0.7 && obs.loops <= 3) {
      // Efficient high-confidence answer
      const searchTerms = this.extractSearchTerms(steps);
      if (searchTerms.length > 0) {
        this.systemModel.addLearnedPattern({
          type: 'effective_query',
          domain: obs.domain,
          pattern: `Queries "${searchTerms.join(', ')}" work well for ${obs.domain}`,
          success_rate: obs.confidence,
          adopted: true,
          improvement: 0.1,
        });
      }
    }
  }

  async analyzePerformanceWindow(windowDays: number = 7): Promise<AnalysisReport> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const recentObservations = this.observations.filter(
      o => new Date(o.timestamp).getTime() > cutoff
    );

    if (recentObservations.length < MIN_QUERIES_FOR_ANALYSIS) {
      return this.createEmptyReport(windowDays);
    }

    const analysis = this.systemModel.analyzePerformance();

    // Calculate averages for recent window
    const avgConfidence = recentObservations.reduce((s, o) => s + o.confidence, 0) / recentObservations.length;
    const avgLoops = recentObservations.reduce((s, o) => s + o.loops, 0) / recentObservations.length;
    const totalSearches = recentObservations.reduce((s, o) => s + o.searchCount, 0);
    const totalSuccessful = recentObservations.reduce((s, o) => s + o.successfulSearches, 0);
    const searchSuccessRate = totalSearches > 0 ? totalSuccessful / totalSearches : 0;

    // Identify weak and strong domains
    const domainStats = new Map<string, { confidence: number; count: number }>();
    for (const obs of recentObservations) {
      const stats = domainStats.get(obs.domain) || { confidence: 0, count: 0 };
      stats.confidence = (stats.count * stats.confidence + obs.confidence) / (stats.count + 1);
      stats.count++;
      domainStats.set(obs.domain, stats);
    }

    const weakDomains = Array.from(domainStats.entries())
      .filter(([_, s]) => s.count >= 2 && s.confidence < 0.5)
      .map(([domain, s]) => ({ domain, confidence: s.confidence, queries: s.count }))
      .sort((a, b) => a.confidence - b.confidence);

    const strongDomains = Array.from(domainStats.entries())
      .filter(([_, s]) => s.count >= 2 && s.confidence >= 0.6)
      .map(([domain, s]) => ({ domain, confidence: s.confidence, queries: s.count }))
      .sort((a, b) => b.confidence - a.confidence);

    // Generate improvements
    const improvements = this.generateImprovements(recentObservations, weakDomains);

    // Determine trend
    const confidenceTrend = this.calculateTrend(recentObservations);

    const report: AnalysisReport = {
      period: `Last ${windowDays} days`,
      totalQueries: recentObservations.length,
      avgConfidence,
      avgLoops,
      searchSuccessRate,
      weakDomains,
      strongDomains,
      improvements,
      confidenceTrend,
    };

    // Log significant findings
    for (const improvement of improvements) {
      if (improvement.expectedImprovement >= IMPROVEMENT_THRESHOLD) {
        this.systemModel.logEvolution(
          improvement.description,
          `Performance analysis: ${improvement.type}`,
          `Expected improvement: ${(improvement.expectedImprovement * 100).toFixed(0)}%`
        );
      }
    }

    this.lastAnalysisTime = Date.now();
    return report;
  }

  private generateImprovements(
    observations: QueryObservation[],
    weakDomains: Array<{ domain: string; confidence: number; queries: number }>
  ): Improvement[] {
    const improvements: Improvement[] = [];

    // 1. Search strategy improvements for weak domains
    for (const weak of weakDomains) {
      improvements.push({
        type: 'search_strategy',
        domain: weak.domain,
        description: `Improve search strategy for ${weak.domain}`,
        implementation: `Use broader initial queries, then narrow down for ${weak.domain}`,
        expectedImprovement: 0.15,
      });
    }

    // 2. Loop reduction
    const highLoopDomains = new Set(
      observations.filter(o => o.loops > 4).map(o => o.domain)
    );
    for (const domain of highLoopDomains) {
      improvements.push({
        type: 'reasoning_heuristic',
        domain,
        description: `Add early-stopping heuristic for ${domain}`,
        implementation: `After 3 searches with <30% success rate, synthesize what we have`,
        expectedImprovement: 0.1,
      });
    }

    // 3. Confidence calibration
    const fallbackRate = observations.filter(o => o.isFallback).length / observations.length;
    if (fallbackRate > 0.2) {
      improvements.push({
        type: 'confidence_calibration',
        description: 'High fallback rate detected',
        implementation: 'Review confidence thresholds and answer quality',
        expectedImprovement: 0.1,
      });
    }

    return improvements.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
  }

  private calculateTrend(observations: QueryObservation[]): 'improving' | 'stable' | 'declining' {
    if (observations.length < 10) return 'stable';

    const half = Math.floor(observations.length / 2);
    const earlier = observations.slice(0, half);
    const later = observations.slice(half);

    const earlierAvg = earlier.reduce((s, o) => s + o.confidence, 0) / earlier.length;
    const laterAvg = later.reduce((s, o) => s + o.confidence, 0) / later.length;

    const diff = laterAvg - earlierAvg;
    if (diff > 0.05) return 'improving';
    if (diff < -0.05) return 'declining';
    return 'stable';
  }

  private extractSearchTerms(steps: ReasoningStep[]): string[] {
    const terms: string[] = [];
    for (const step of steps) {
      if (step.action && step.action.includes('search_memory')) {
        const match = step.action.match(/"query":\s*"([^"]+)"/);
        if (match) {
          terms.push(match[1]);
        }
      }
    }
    return terms;
  }

  private detectDomainFromQuery(query: string): string {
    const queryLower = query.toLowerCase();
    const domainKeywords: Record<string, string[]> = {
      hiring: ['hire', 'candidate', 'interview', 'recruit', 'job'],
      architecture: ['architecture', 'design', 'system', 'scale', 'infrastructure'],
      product: ['feature', 'product', 'priorit', 'roadmap'],
      code_review: ['review', 'pr', 'pull request', 'merge'],
      budget: ['budget', 'cost', 'spend'],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        return domain;
      }
    }
    return 'general';
  }

  private createEmptyReport(windowDays: number): AnalysisReport {
    return {
      period: `Last ${windowDays} days`,
      totalQueries: 0,
      avgConfidence: 0,
      avgLoops: 0,
      searchSuccessRate: 0,
      weakDomains: [],
      strongDomains: [],
      improvements: [],
      confidenceTrend: 'stable',
    };
  }

  getObservations(): QueryObservation[] {
    return this.observations;
  }

  getRecentObservations(count: number): QueryObservation[] {
    return this.observations.slice(-count);
  }
}
