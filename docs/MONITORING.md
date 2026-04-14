# Monitoring Setup for Beta Testing

This document describes the monitoring infrastructure set up for Second Brain v1.0.0 beta testing phase.

## Overview

The monitoring system provides:

- **Health checks** - Kubernetes-style liveness and readiness probes
- **Metrics collection** - Query performance, error rates, confidence scores
- **Alerting** - Automatic alerts for error spikes, slow responses, low confidence
- **Structured logging** - JSON or pretty-formatted logs with context
- **Web dashboard** - Real-time monitoring visualization at `/monitor`

## Quick Start

```bash
# Start the server
npm run api

# Check health
curl http://localhost:3000/health

# View metrics
curl http://localhost:3000/metrics

# Open monitoring dashboard
open http://localhost:3000/monitor
```

## Health Check Endpoints

### `/health` - Overall Health

Returns comprehensive health status:

```json
{
  "status": "healthy",
  "uptime": 3600000,
  "errorRate": 0.02,
  "avgResponseTime": 1500,
  "avgConfidence": 0.85,
  "totalQueries": 150,
  "totalErrors": 3,
  "recentQueries": 25,
  "recentErrors": 1
}
```

Status values:
- `healthy` (200) - All systems normal
- `degraded` (200) - Minor issues, still functional
- `unhealthy` (503) - Major issues, service impacted

### `/health/live` - Liveness Probe

Lightweight check for Kubernetes:

```json
{
  "status": "alive",
  "timestamp": "2026-04-14T02:00:00.000Z"
}
```

### `/health/ready` - Readiness Probe

Checks if service can handle requests:

```json
{
  "status": "ready",
  "sources": [
    { "source": "github", "configured": true },
    { "source": "docs", "configured": true }
  ]
}
```

## Metrics Endpoints

### `/metrics` - Full Metrics

Returns aggregated metrics:

```json
{
  "uptime": 3600000,
  "total": {
    "queries": 150,
    "syncs": 5,
    "scans": 10,
    "errors": 3
  },
  "hourly": {
    "queries": 25,
    "errors": 1,
    "avgResponseTime": 1500,
    "avgConfidence": 0.85
  },
  "daily": {
    "queries": 150,
    "errors": 3,
    "avgResponseTime": 1800,
    "avgConfidence": 0.82
  },
  "domains": {
    "github": 45,
    "docs": 30,
    "general": 75
  },
  "errors": [...]
}
```

### `/metrics/performance` - Performance Stats

Returns memory and performance data:

```json
{
  "current": {
    "memory": {
      "heapUsed": 52428800,
      "heapTotal": 104857600,
      "external": 1048576
    },
    "connections": 2
  },
  "history": [...]
}
```

## Alerting System

### Alert Rules

| Rule | Condition | Severity | Cooldown |
|------|-----------|----------|----------|
| `high_error_rate` | Error rate > 10% | warning | 5 min |
| `critical_error_rate` | Error rate > 30% | critical | 3 min |
| `slow_responses` | Avg response > 10s | warning | 10 min |
| `very_slow_responses` | Avg response > 30s | critical | 5 min |
| `low_confidence` | Avg confidence < 0.5 | info | 15 min |
| `many_recent_errors` | > 10 errors/hour | warning | 5 min |

### Alert Endpoints

```bash
# Get active alerts
GET /alerts/active

# Get all alerts (last 20)
GET /alerts/all

# Acknowledge an alert
POST /alerts/:id/acknowledge
```

### Slack Integration

Configure Slack alerts for critical issues:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
NODE_ENV=production
```

Critical alerts automatically send to Slack with:
- Alert type and message
- Current metrics
- Timestamp

## Structured Logging

### Configuration

```env
LOG_LEVEL=info          # debug, info, warn, error, critical
LOG_FORMAT=json         # json or pretty
```

### Usage in Code

```typescript
import { logger } from './core/logger.js';

// Basic logging
logger.info('Operation completed', { duration: 150 });
logger.error('Operation failed', error, { userId: '123' });

// Timing
const done = logger.time('operation');
// ... do work ...
done(); // logs duration

// Child logger with context
const childLogger = logger.child({ requestId: 'abc' });
childLogger.info('Processing request');
```

### Log Format

JSON format:
```json
{
  "timestamp": "2026-04-14T02:00:00.000Z",
  "level": "info",
  "message": "Operation completed",
  "context": { "duration": 150 },
  "duration": 150
}
```

Pretty format:
```
02:00:00 INFO     Operation completed {"duration": 150} [150ms]
```

## Monitoring Dashboard

Access the real-time monitoring dashboard at:

```
http://localhost:3000/monitor
```

Features:
- System health status
- Query volume and trends
- Response quality metrics
- Memory usage visualization
- Domain distribution chart
- Active alerts display

Auto-refreshes every 10 seconds.

## Kubernetes Deployment

### Health Check Probes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5

startupProbe:
  httpGet:
    path: /health/live
    port: 3000
  failureThreshold: 30
  periodSeconds: 10
```

### Resource Monitoring

The `/metrics` endpoint can be scraped by Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'second-brain'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
```

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure `SLACK_WEBHOOK_URL` for critical alerts
- [ ] Set appropriate `LOG_LEVEL` (recommend: `info`)
- [ ] Configure log aggregation (JSON format)
- [ ] Set up Prometheus scraping
- [ ] Configure Kubernetes health probes
- [ ] Set up alert routing (PagerDuty, OpsGenie, etc.)
- [ ] Configure log retention policies

## Troubleshooting

### High Error Rate

1. Check `/metrics` for error details
2. Review logs for error patterns
3. Check API key validity
4. Verify data source connectivity

### Slow Responses

1. Check memory usage at `/metrics/performance`
2. Review query complexity
3. Check embedding model loaded
4. Verify network connectivity to data sources

### Low Confidence

1. Review recent queries and results
2. Check if data sources synced
3. Verify embedding model loaded correctly
4. Review user feedback patterns

### Alerts Not Sending

1. Verify `SLACK_WEBHOOK_URL` configured
2. Check `NODE_ENV=production`
3. Verify network access to Slack
4. Check logs for send failures
