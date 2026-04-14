export interface MetricValue {
  name: string;
  value: number;
  timestamp: string;
  tags?: Record<string, string>;
}

export interface MetricsStore {
  queries: QueryMetric[];
  errors: ErrorMetric[];
  performance: PerformanceMetric[];
  usage: UsageMetric[];
}

export interface QueryMetric {
  id: string;
  question: string;
  domain: string;
  timestamp: string;
  responseTime: number;
  confidence: number;
  searchCount: number;
  sourcesUsed: string[];
  success: boolean;
}

export interface ErrorMetric {
  id: string;
  type: string;
  message: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface PerformanceMetric {
  timestamp: string;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  activeConnections: number;
}

export interface UsageMetric {
  timestamp: string;
  totalQueries: number;
  totalSyncs: number;
  totalScans: number;
  activeUsers: number;
  documentsIndexed: number;
}

export class MetricsCollector {
  private store: MetricsStore = {
    queries: [],
    errors: [],
    performance: [],
    usage: [],
  };

  private startTime: number = Date.now();
  private queryCounter: number = 0;
  private syncCounter: number = 0;
  private scanCounter: number = 0;
  private activeConnections: number = 0;

  recordQuery(metric: Omit<QueryMetric, 'id' | 'timestamp'>): void {
    this.queryCounter++;
    this.store.queries.push({
      ...metric,
      id: `query-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
    });

    if (this.store.queries.length > 1000) {
      this.store.queries = this.store.queries.slice(-500);
    }
  }

  recordError(error: Omit<ErrorMetric, 'id' | 'timestamp'>): void {
    this.store.errors.push({
      ...error,
      id: `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
    });

    if (this.store.errors.length > 500) {
      this.store.errors = this.store.errors.slice(-250);
    }
  }

  recordSync(): void {
    this.syncCounter++;
  }

  recordScan(): void {
    this.scanCounter++;
  }

  incrementConnections(): void {
    this.activeConnections++;
  }

  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  getHealthStatus(): HealthStatus {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const recentQueries = this.store.queries.filter(q => 
      new Date(q.timestamp).getTime() > oneHourAgo
    );
    const recentErrors = this.store.errors.filter(e => 
      new Date(e.timestamp).getTime() > oneHourAgo
    );

    const errorRate = recentQueries.length > 0 
      ? recentErrors.length / recentQueries.length 
      : 0;

    const avgResponseTime = recentQueries.length > 0
      ? recentQueries.reduce((sum, q) => sum + q.responseTime, 0) / recentQueries.length
      : 0;

    const avgConfidence = recentQueries.length > 0
      ? recentQueries.reduce((sum, q) => sum + q.confidence, 0) / recentQueries.length
      : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (errorRate > 0.1 || avgResponseTime > 10000) {
      status = 'degraded';
    }
    if (errorRate > 0.3 || avgResponseTime > 30000 || recentErrors.length > 10) {
      status = 'unhealthy';
    }

    return {
      status,
      uptime: now - this.startTime,
      errorRate,
      avgResponseTime,
      avgConfidence,
      totalQueries: this.queryCounter,
      totalErrors: this.store.errors.length,
      recentQueries: recentQueries.length,
      recentErrors: recentErrors.length,
    };
  }

  getMetrics(): MetricsSummary {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const hourlyQueries = this.store.queries.filter(q => 
      new Date(q.timestamp).getTime() > oneHourAgo
    );
    const dailyQueries = this.store.queries.filter(q => 
      new Date(q.timestamp).getTime() > oneDayAgo
    );

    return {
      uptime: now - this.startTime,
      total: {
        queries: this.queryCounter,
        syncs: this.syncCounter,
        scans: this.scanCounter,
        errors: this.store.errors.length,
      },
      hourly: {
        queries: hourlyQueries.length,
        errors: this.store.errors.filter(e => 
          new Date(e.timestamp).getTime() > oneHourAgo
        ).length,
        avgResponseTime: hourlyQueries.length > 0
          ? hourlyQueries.reduce((sum, q) => sum + q.responseTime, 0) / hourlyQueries.length
          : 0,
        avgConfidence: hourlyQueries.length > 0
          ? hourlyQueries.reduce((sum, q) => sum + q.confidence, 0) / hourlyQueries.length
          : 0,
      },
      daily: {
        queries: dailyQueries.length,
        errors: this.store.errors.filter(e => 
          new Date(e.timestamp).getTime() > oneDayAgo
        ).length,
        avgResponseTime: dailyQueries.length > 0
          ? dailyQueries.reduce((sum, q) => sum + q.responseTime, 0) / dailyQueries.length
          : 0,
        avgConfidence: dailyQueries.length > 0
          ? dailyQueries.reduce((sum, q) => sum + q.confidence, 0) / dailyQueries.length
          : 0,
      },
      domains: this.getDomainBreakdown(),
      errors: this.store.errors.slice(-10).map(e => ({
        type: e.type,
        message: e.message,
        timestamp: e.timestamp,
      })),
    };
  }

  private getDomainBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const q of this.store.queries) {
      breakdown[q.domain] = (breakdown[q.domain] || 0) + 1;
    }
    return breakdown;
  }

  recordPerformance(): void {
    this.store.performance.push({
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      activeConnections: this.activeConnections,
    });

    if (this.store.performance.length > 500) {
      this.store.performance = this.store.performance.slice(-250);
    }
  }

  getPerformanceStats(): PerformanceStats {
    const recent = this.store.performance.slice(-60);
    if (recent.length === 0) {
      return {
        current: {
          memory: process.memoryUsage(),
          connections: this.activeConnections,
        },
        history: [],
      };
    }

    return {
      current: {
        memory: process.memoryUsage(),
        connections: this.activeConnections,
      },
      history: recent.map(p => ({
        timestamp: p.timestamp,
        heapUsed: p.memoryUsage.heapUsed,
        heapTotal: p.memoryUsage.heapTotal,
        connections: p.activeConnections,
      })),
    };
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  errorRate: number;
  avgResponseTime: number;
  avgConfidence: number;
  totalQueries: number;
  totalErrors: number;
  recentQueries: number;
  recentErrors: number;
}

export interface MetricsSummary {
  uptime: number;
  total: {
    queries: number;
    syncs: number;
    scans: number;
    errors: number;
  };
  hourly: {
    queries: number;
    errors: number;
    avgResponseTime: number;
    avgConfidence: number;
  };
  daily: {
    queries: number;
    errors: number;
    avgResponseTime: number;
    avgConfidence: number;
  };
  domains: Record<string, number>;
  errors: Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
}

export interface PerformanceStats {
  current: {
    memory: NodeJS.MemoryUsage;
    connections: number;
  };
  history: Array<{
    timestamp: string;
    heapUsed: number;
    heapTotal: number;
    connections: number;
  }>;
}

export const metricsCollector = new MetricsCollector();
