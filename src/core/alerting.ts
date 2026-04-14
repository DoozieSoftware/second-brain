import { metricsCollector } from './metrics.js';
import { logger } from './logger.js';

export interface AlertRule {
  name: string;
  description: string;
  condition: (metrics: AlertMetrics) => boolean;
  severity: 'info' | 'warning' | 'critical';
  cooldown: number;
}

export interface AlertMetrics {
  errorRate: number;
  avgResponseTime: number;
  avgConfidence: number;
  recentErrors: number;
  totalQueries: number;
}

export interface Alert {
  id: string;
  rule: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  metrics: AlertMetrics;
  acknowledged: boolean;
}

export interface AlertConfig {
  enabled: boolean;
  slackWebhook?: string;
  emailRecipients?: string[];
  checkIntervalMs: number;
}

class AlertManager {
  private alerts: Alert[] = [];
  private lastTriggered: Map<string, number> = new Map();
  private config: AlertConfig = {
    enabled: true,
    checkIntervalMs: 60000,
  };
  private checkInterval?: ReturnType<typeof setInterval>;

  private rules: AlertRule[] = [
    {
      name: 'high_error_rate',
      description: 'Error rate exceeds 10%',
      condition: (m) => m.errorRate > 0.1,
      severity: 'warning',
      cooldown: 300000,
    },
    {
      name: 'critical_error_rate',
      description: 'Error rate exceeds 30%',
      condition: (m) => m.errorRate > 0.3,
      severity: 'critical',
      cooldown: 180000,
    },
    {
      name: 'slow_responses',
      description: 'Average response time exceeds 10 seconds',
      condition: (m) => m.avgResponseTime > 10000,
      severity: 'warning',
      cooldown: 600000,
    },
    {
      name: 'very_slow_responses',
      description: 'Average response time exceeds 30 seconds',
      condition: (m) => m.avgResponseTime > 30000,
      severity: 'critical',
      cooldown: 300000,
    },
    {
      name: 'low_confidence',
      description: 'Average confidence below 0.5',
      condition: (m) => m.avgConfidence < 0.5,
      severity: 'info',
      cooldown: 900000,
    },
    {
      name: 'many_recent_errors',
      description: 'More than 10 errors in the last hour',
      condition: (m) => m.recentErrors > 10,
      severity: 'warning',
      cooldown: 300000,
    },
  ];

  configure(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
  }

  start(): void {
    if (this.checkInterval) return;
    
    logger.info('Starting alert manager', { intervalMs: this.config.checkIntervalMs });
    
    this.checkInterval = setInterval(() => {
      this.check();
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      logger.info('Alert manager stopped');
    }
  }

  private check(): void {
    if (!this.config.enabled) return;

    const health = metricsCollector.getHealthStatus();
    const metrics: AlertMetrics = {
      errorRate: health.errorRate,
      avgResponseTime: health.avgResponseTime,
      avgConfidence: health.avgConfidence,
      recentErrors: health.recentErrors,
      totalQueries: health.totalQueries,
    };

    for (const rule of this.rules) {
      const lastTrigger = this.lastTriggered.get(rule.name) || 0;
      const now = Date.now();

      if (now - lastTrigger < rule.cooldown) continue;

      if (rule.condition(metrics)) {
        this.triggerAlert(rule, metrics);
        this.lastTriggered.set(rule.name, now);
      }
    }
  }

  private triggerAlert(rule: AlertRule, metrics: AlertMetrics): void {
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rule: rule.name,
      severity: rule.severity,
      message: rule.description,
      timestamp: new Date().toISOString(),
      metrics,
      acknowledged: false,
    };

    this.alerts.push(alert);
    
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-50);
    }

    logger.warn(`Alert triggered: ${rule.name}`, {
      severity: rule.severity,
      message: rule.description,
      metrics,
    });

    if (this.config.slackWebhook && rule.severity === 'critical') {
      this.sendSlackNotification(alert);
    }
  }

  private async sendSlackNotification(alert: Alert): Promise<void> {
    if (!this.config.slackWebhook) return;

    try {
      const payload = {
        text: `🚨 Second Brain Alert: ${alert.rule}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🚨 ${alert.severity.toUpperCase()}: ${alert.message}`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Error Rate:* ${(alert.metrics.errorRate * 100).toFixed(1)}%` },
              { type: 'mrkdwn', text: `*Avg Response Time:* ${alert.metrics.avgResponseTime.toFixed(0)}ms` },
              { type: 'mrkdwn', text: `*Avg Confidence:* ${alert.metrics.avgConfidence.toFixed(2)}` },
              { type: 'mrkdwn', text: `*Recent Errors:* ${alert.metrics.recentErrors}` },
            ],
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `_${alert.timestamp}_` },
            ],
          },
        ],
      };

      await fetch(this.config.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      logger.info('Slack alert sent', { alertId: alert.id });
    } catch (error) {
      logger.error('Failed to send Slack alert', error);
    }
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.acknowledged);
  }

  getAllAlerts(limit: number = 20): Alert[] {
    return this.alerts.slice(-limit);
  }

  acknowledge(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info('Alert acknowledged', { alertId });
      return true;
    }
    return false;
  }

  clear(): void {
    this.alerts = [];
    this.lastTriggered.clear();
    logger.info('All alerts cleared');
  }
}

export const alertManager = new AlertManager();
export type { AlertManager };
