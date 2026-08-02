import { JsonStore } from '../core/json-store.js';
import type { MetricsSummary, HealthStatus, QueryMetric, ErrorMetric } from '../core/metrics.js';
import type { Memory } from '../core/memory.js';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  title: string;
  detail: string;
  severity: InsightSeverity;
  /** Category: usage | quality | coverage | ops | strategy | decisions */
  category: string;
  /** Suggested action. */
  recommendation?: string;
  createdAt: string;
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface Trend {
  key: string;
  title: string;
  points: TrendPoint[];
  /** 'improving' | 'stable' | 'worsening' */
  direction: 'improving' | 'stable' | 'worsening';
  delta: number;
}

export interface AnalyticsSnapshot {
  id: string;
  timestamp: string;
  /** Monotonic sequence for stable ordering (same-millisecond-safe). */
  _seq?: number;
  insights: Insight[];
  trends: Trend[];
  summary: {
    totalQueries: number;
    totalErrors: number;
    errorRate: number;
    avgConfidence: number;
    documents: number;
    decisionCount: number;
    goals: number;
    health: string;
  };
}

export interface AnalyticsInputs {
  metrics?: {
    summary?: MetricsSummary;
    health?: HealthStatus;
    queries?: QueryMetric[];
    errors?: ErrorMetric[];
  };
  memory?: Memory;
  decisionCount?: number;
  goalCount?: number;
}

function newId(): string {
  return `ins_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Analytics Engine — turns operational signals into human-readable insights
 * and trends. Pure of HTTP concerns; the API layer just calls `generate()`.
 *
 * Insight generation is rule-based (deterministic, no LLM dependency) so it
 * works offline and is unit-testable. The same snapshot can be persisted for
 * historical trend comparison.
 */
export class AnalyticsEngine {
  private snapshots: JsonStore<AnalyticsSnapshot>;
  private seq: number = 0;

  constructor(dataDir?: string) {
    this.snapshots = new JsonStore<AnalyticsSnapshot>('analytics-snapshots.json', dataDir);
    this.seq = this.snapshots.all().length;
  }

  generate(inputs: AnalyticsInputs): AnalyticsSnapshot {
    const insights = this.buildInsights(inputs);
    const trends = this.buildTrends(inputs);

    const summary = {
      totalQueries: inputs.metrics?.summary?.total.queries ?? 0,
      totalErrors: inputs.metrics?.summary?.total.errors ?? 0,
      errorRate: inputs.metrics?.health?.errorRate ?? 0,
      avgConfidence: inputs.metrics?.summary?.daily.avgConfidence ?? 0,
      documents: inputs.memory?.count ?? 0,
      decisionCount: inputs.decisionCount ?? 0,
      goals: inputs.goalCount ?? 0,
      health: inputs.metrics?.health?.status ?? 'unknown',
    };

    const timestamp = new Date().toISOString();
    const snapshot: AnalyticsSnapshot = {
      id: newId(),
      timestamp,
      _seq: ++this.seq,
      insights,
      trends,
      summary,
    };
    this.snapshots.upsert(snapshot);
    return snapshot;
  }

  listSnapshots(): AnalyticsSnapshot[] {
    return this.snapshots.all().sort((a, b) => {
      const t = b.timestamp.localeCompare(a.timestamp);
      if (t !== 0) return t;
      return (b._seq ?? 0) - (a._seq ?? 0);
    });
  }

  /** Compare the two most recent snapshots; returns null if < 2 exist. */
  diffLatest(): { older: AnalyticsSnapshot; newer: AnalyticsSnapshot; deltas: Record<string, number> } | null {
    const snaps = this.listSnapshots();
    if (snaps.length < 2) return null;
    const [newer, older] = snaps;
    const keys: Array<keyof AnalyticsSnapshot['summary']> = [
      'totalQueries', 'totalErrors', 'errorRate', 'avgConfidence', 'documents', 'decisionCount', 'goals',
    ];
    const deltas: Record<string, number> = {};
    for (const key of keys) {
      const n = older.summary[key];
      const v = newer.summary[key];
      if (typeof n === 'number' && typeof v === 'number') {
        deltas[key] = v - n;
      }
    }
    return { older, newer, deltas };
  }

  // ─── Insight builders ───

  private buildInsights(inputs: AnalyticsInputs): Insight[] {
    const insights: Insight[] = [];
    const summary = inputs.metrics?.summary;
    const health = inputs.metrics?.health;
    const queries = inputs.metrics?.queries ?? [];

    // 1. Health / error rate
    if (health) {
      if (health.status === 'unhealthy') {
        insights.push({
          id: newId(), category: 'ops', severity: 'critical',
          title: 'System is unhealthy',
          detail: `Error rate is ${(health.errorRate * 100).toFixed(0)}% and average response time is ${(health.avgResponseTime / 1000).toFixed(1)}s.`,
          recommendation: 'Check OpenRouter connectivity and embedding model health.',
          createdAt: new Date().toISOString(),
        });
      } else if (health.status === 'degraded') {
        insights.push({
          id: newId(), category: 'ops', severity: 'warning',
          title: 'System is degraded',
          detail: `Error rate ${(health.errorRate * 100).toFixed(0)}% or slow responses (${(health.avgResponseTime / 1000).toFixed(1)}s avg).`,
          recommendation: 'Review recent errors and response latency.',
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 2. Error rate trend
    const errorRate = health?.errorRate ?? 0;
    if (summary && errorRate > 0.05 && errorRate <= 0.3) {
      insights.push({
        id: newId(), category: 'ops', severity: 'warning',
        title: 'Elevated error rate',
        detail: `Error rate is ${(errorRate * 100).toFixed(0)}% over the last hour.`,
        recommendation: 'Check /metrics for error breakdown by type.',
        createdAt: new Date().toISOString(),
      });
    }

    // 3. Low confidence domains
    const byDomain = this.domainStats(queries);
    const lowConfidence = byDomain.filter(d => d.count >= 2 && d.avgConfidence < 0.4);
    if (lowConfidence.length > 0) {
      const worst = lowConfidence.sort((a, b) => a.avgConfidence - b.avgConfidence)[0];
      insights.push({
        id: newId(), category: 'quality', severity: 'warning',
        title: `Low answer confidence in "${worst.domain}"`,
        detail: `Average confidence ${(worst.avgConfidence * 100).toFixed(0)}% across ${worst.count} queries. The knowledge base likely lacks coverage for this domain.`,
        recommendation: `Sync more sources related to "${worst.domain}" or import relevant documents.`,
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Knowledge coverage
    if (inputs.memory && inputs.memory.count === 0) {
      insights.push({
        id: newId(), category: 'coverage', severity: 'critical',
        title: 'Knowledge base is empty',
        detail: 'No documents in memory. The assistant cannot answer anything useful yet.',
        recommendation: 'Run `sync` or import documents via the dashboard.',
        createdAt: new Date().toISOString(),
      });
    } else if (inputs.memory && inputs.memory.count < 10) {
      insights.push({
        id: newId(), category: 'coverage', severity: 'warning',
        title: 'Knowledge base is sparse',
        detail: `Only ${inputs.memory.count} documents indexed. Answer quality will be limited.`,
        recommendation: 'Connect more sources and run a full sync.',
        createdAt: new Date().toISOString(),
      });
    }

    // 5. Decisions exist? (governance health)
    const decisionCount = inputs.decisionCount ?? 0;
    if (decisionCount === 0) {
      insights.push({
        id: newId(), category: 'decisions', severity: 'info',
        title: 'No recorded decisions',
        detail: 'The decision log is empty. Architectural decisions are not traceable yet.',
        recommendation: 'Start recording ADRs via POST /decisions or the `decision:record` CLI command.',
        createdAt: new Date().toISOString(),
      });
    }

    // 6. Strategy coverage
    const goalCount = inputs.goalCount ?? 0;
    if (goalCount === 0) {
      insights.push({
        id: newId(), category: 'strategy', severity: 'info',
        title: 'No strategic goals tracked',
        detail: 'The strategy engine has no goals. Roadmap visibility is unavailable.',
        recommendation: 'Create a goal via the dashboard or `strategy:goal` CLI command.',
        createdAt: new Date().toISOString(),
      });
    }

    return insights;
  }

  private domainStats(queries: QueryMetric[]): Array<{ domain: string; count: number; avgConfidence: number }> {
    const byDomain = new Map<string, { count: number; totalConf: number }>();
    for (const q of queries) {
      const entry = byDomain.get(q.domain) ?? { count: 0, totalConf: 0 };
      entry.count++;
      entry.totalConf += q.confidence;
      byDomain.set(q.domain, entry);
    }
    return Array.from(byDomain.entries()).map(([domain, v]) => ({
      domain,
      count: v.count,
      avgConfidence: v.count > 0 ? v.totalConf / v.count : 0,
    }));
  }

  // ─── Trend builders ───

  private buildTrends(inputs: AnalyticsInputs): Trend[] {
    const trends: Trend[] = [];
    const queries = inputs.metrics?.queries ?? [];

    // Query volume by day (last 7 days if we have enough data).
    const byDay = new Map<string, number>();
    const byDayConf = new Map<string, { total: number; count: number }>();
    for (const q of queries) {
      const day = q.timestamp.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      const conf = byDayConf.get(day) ?? { total: 0, count: 0 };
      conf.total += q.confidence;
      conf.count++;
      byDayConf.set(day, conf);
    }

    const days = Array.from(byDay.keys()).sort();
    const volumePoints: TrendPoint[] = days.map(d => ({ label: d, value: byDay.get(d) ?? 0 }));
    if (volumePoints.length >= 2) {
      const delta = this.deltaFor(volumePoints.map(p => p.value));
      trends.push({
        key: 'query_volume',
        title: 'Daily query volume',
        points: volumePoints,
        direction: this.direction(delta),
        delta,
      });
    }

    const confPoints: TrendPoint[] = days.map(d => {
      const c = byDayConf.get(d);
      return { label: d, value: c && c.count > 0 ? Math.round((c.total / c.count) * 100) : 0 };
    });
    if (confPoints.length >= 2) {
      const delta = this.deltaFor(confPoints.map(p => p.value));
      trends.push({
        key: 'confidence',
        title: 'Average confidence (%)',
        points: confPoints,
        direction: this.direction(delta),
        delta,
      });
    }

    // Error count trend.
    const errors = inputs.metrics?.errors ?? [];
    const errByDay = new Map<string, number>();
    for (const e of errors) {
      const day = e.timestamp.slice(0, 10);
      errByDay.set(day, (errByDay.get(day) ?? 0) + 1);
    }
    const errDays = Array.from(errByDay.keys()).sort();
    const errPoints: TrendPoint[] = errDays.map(d => ({ label: d, value: errByDay.get(d) ?? 0 }));
    if (errPoints.length >= 2) {
      const delta = this.deltaFor(errPoints.map(p => p.value));
      // For errors, increasing is worsening.
      trends.push({
        key: 'errors',
        title: 'Daily errors',
        points: errPoints,
        direction: this.direction(delta) === 'improving' ? 'worsening' : this.direction(delta) === 'worsening' ? 'improving' : 'stable',
        delta,
      });
    }

    return trends;
  }

  private deltaFor(values: number[]): number {
    if (values.length < 2) return 0;
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondHalf = values.slice(half).reduce((a, b) => a + b, 0) / (values.length - half);
    return secondHalf - firstHalf;
  }

  private direction(delta: number): 'improving' | 'stable' | 'worsening' {
    if (delta > 0.01) return 'improving';
    if (delta < -0.01) return 'worsening';
    return 'stable';
  }
}
