import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alertManager } from '../core/alerting.js';
import { metricsCollector } from '../core/metrics.js';

describe('alerting — low_confidence idle guard', () => {
  beforeEach(() => {
    // Reset state
    (alertManager as any).alerts = [];
    (alertManager as any).lastTriggered = new Map();
  });

  it('does NOT fire low_confidence when there are fewer than 5 recent queries', () => {
    // Simulate an idle server: 2 recent queries, all confidence 0.
    // avgConfidence = 0, so the bare `m.avgConfidence < 0.5` condition would fire.
    // The new guard requires recentQueries >= 5.
    const fakeHealth = {
      status: 'healthy' as const,
      uptime: 1000,
      errorRate: 0,
      avgResponseTime: 0,
      avgConfidence: 0,
      totalQueries: 2,
      totalErrors: 0,
      recentQueries: 2,
      recentErrors: 0,
    };
    vi.spyOn(metricsCollector, 'getHealthStatus').mockReturnValue(fakeHealth as any);
    (alertManager as any).config.enabled = true;

    (alertManager as any).check();

    const lowConfAlerts = (alertManager as any).alerts.filter(
      (a: any) => a.rule === 'low_confidence'
    );
    expect(lowConfAlerts).toHaveLength(0);
  });

  it('DOES fire low_confidence when there are >= 5 recent queries and avgConfidence < 0.5', () => {
    const fakeHealth = {
      status: 'healthy' as const,
      uptime: 1000,
      errorRate: 0,
      avgResponseTime: 0,
      avgConfidence: 0.3,
      totalQueries: 10,
      totalErrors: 0,
      recentQueries: 10,
      recentErrors: 0,
    };
    vi.spyOn(metricsCollector, 'getHealthStatus').mockReturnValue(fakeHealth as any);
    (alertManager as any).config.enabled = true;

    (alertManager as any).check();

    const lowConfAlerts = (alertManager as any).alerts.filter(
      (a: any) => a.rule === 'low_confidence'
    );
    expect(lowConfAlerts.length).toBeGreaterThan(0);
  });
});
