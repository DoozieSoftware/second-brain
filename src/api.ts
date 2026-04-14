import 'dotenv/config';
import express, { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { SupervisorOperator } from './core/supervisor.js';
import { metricsCollector } from './core/metrics.js';
import { alertManager } from './core/alerting.js';
import { logger } from './core/logger.js';

const app = express();
app.use(express.json());

const supervisor = new SupervisorOperator();

if (process.env.NODE_ENV === 'production') {
  alertManager.configure({
    enabled: true,
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    checkIntervalMs: 60000,
  });
  alertManager.start();
  logger.info('Production monitoring enabled');
}

app.use((req: Request, _res: Response, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
    metricsCollector.recordPerformance();
  }
  next();
});

// Dashboard
app.get('/', async (_req: Request, res: Response) => {
  try {
    const html = await readFile(join(process.cwd(), 'public', 'index.html'), 'utf-8');
    res.type('html').send(html);
  } catch {
    res.status(404).send('Dashboard not found.');
  }
});

app.get('/monitor', async (_req: Request, res: Response) => {
  try {
    const html = await readFile(join(process.cwd(), 'public', 'monitor', 'index.html'), 'utf-8');
    res.type('html').send(html);
  } catch {
    res.status(404).send('Monitor dashboard not found.');
  }
});

// ─── Health & Monitoring ───

app.get('/health', (_req: Request, res: Response) => {
  const health = metricsCollector.getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/health/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req: Request, res: Response) => {
  try {
    const status = await supervisor.getStatus();
    const hasData = status.some(s => s.configured);
    if (hasData) {
      res.status(200).json({ status: 'ready', sources: status });
    } else {
      res.status(503).json({ status: 'not_ready', reason: 'No sources configured' });
    }
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/metrics', (_req: Request, res: Response) => {
  const metrics = metricsCollector.getMetrics();
  res.json(metrics);
});

app.get('/metrics/performance', (_req: Request, res: Response) => {
  const perf = metricsCollector.getPerformanceStats();
  res.json(perf);
});

app.get('/alerts/active', (_req: Request, res: Response) => {
  const alerts = alertManager.getActiveAlerts();
  res.json({ alerts });
});

app.get('/alerts/all', (_req: Request, res: Response) => {
  const alerts = alertManager.getAllAlerts();
  res.json({ alerts });
});

app.post('/alerts/:id/acknowledge', (req: Request, res: Response) => {
  const alertId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = alertManager.acknowledge(alertId);
  res.json({ success: ok });
});

// ─── Core API ───

app.post('/ask', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { question } = req.body;
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    const result = await supervisor.ask(question);
    const responseTime = Date.now() - startTime;
    
    metricsCollector.recordQuery({
      question,
      domain: 'general',
      responseTime,
      confidence: result.confidence,
      searchCount: result.searchCount,
      sourcesUsed: result.citations.map(c => c.source),
      success: result.confidence > 0.3,
    });
    
    res.json(result);
  } catch (error) {
    const responseTime = Date.now() - startTime;
    metricsCollector.recordError({
      type: 'api_error',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      context: { endpoint: '/ask', responseTime },
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/sync', async (req: Request, res: Response) => {
  try {
    const { sources } = req.body;
    metricsCollector.recordSync();
    const results = await supervisor.sync(sources);
    res.json({ results });
  } catch (error) {
    metricsCollector.recordError({
      type: 'sync_error',
      message: error instanceof Error ? error.message : 'Unknown error',
      context: { endpoint: '/sync' },
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await supervisor.getStatus();
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Proactive Alerts API ───

// Run a new scan and persist results
app.post('/scan', async (_req: Request, res: Response) => {
  try {
    metricsCollector.recordScan();
    const report = await supervisor.scanAndStore();
    res.json({ report });
  } catch (error) {
    metricsCollector.recordError({
      type: 'scan_error',
      message: error instanceof Error ? error.message : 'Unknown error',
      context: { endpoint: '/scan' },
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Get persisted alerts (no new scan)
app.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const alerts = supervisor.getAlerts();
    const trend = supervisor.getTrend();
    res.json({ alerts, trend });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Dismiss an alert
app.post('/alerts/:id/dismiss', async (req: Request, res: Response) => {
  try {
    const alertId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = supervisor.dismissAlertById(alertId);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Delivery Endpoints ───

// Slack webhook payload (for external polling or direct POST)
app.get('/deliver/slack', async (_req: Request, res: Response) => {
  try {
    const payload = supervisor.getSlackPayload();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// POST to Slack webhook URL
app.post('/deliver/slack', async (req: Request, res: Response) => {
  try {
    const { webhookUrl } = req.body;
    if (!webhookUrl) {
      res.status(400).json({ error: 'webhookUrl is required' });
      return;
    }
    const payload = supervisor.getSlackPayload();
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.json({ success: response.ok, status: response.status });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Email digest (returns formatted content for external email service)
app.get('/deliver/email', async (_req: Request, res: Response) => {
  try {
    const digest = supervisor.getEmailDigest();
    res.json(digest);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Markdown digest file
app.get('/deliver/digest', async (_req: Request, res: Response) => {
  try {
    const content = await readFile(join(process.cwd(), 'data', 'digest.md'), 'utf-8');
    res.type('text/plain').send(content);
  } catch {
    res.status(404).json({ error: 'No digest yet. Run a scan first.' });
  }
});

// ─── Server ───

const PORT = parseInt(process.env.PORT || '3000');
const server = app.listen(PORT, () => {
  logger.info(`Second Brain running on http://localhost:${PORT}`);
  console.log(`\n🧠 Second Brain running on http://localhost:${PORT}\n`);
  console.log('Dashboard: http://localhost:' + PORT);
  console.log('Health:    http://localhost:' + PORT + '/health');
  console.log('Metrics:   http://localhost:' + PORT + '/metrics');
  console.log('Alerts:    http://localhost:' + PORT + '/alerts/active');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  alertManager.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  alertManager.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
