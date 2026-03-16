import 'dotenv/config';
import express, { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { SupervisorOperator } from './core/supervisor.js';

const app = express();
app.use(express.json());

const supervisor = new SupervisorOperator();

// Dashboard
app.get('/', async (_req: Request, res: Response) => {
  try {
    const html = await readFile(join(process.cwd(), 'public', 'index.html'), 'utf-8');
    res.type('html').send(html);
  } catch {
    res.status(404).send('Dashboard not found.');
  }
});

// ─── Core API ───

app.post('/ask', async (req: Request, res: Response) => {
  try {
    const { question } = req.body;
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    const result = await supervisor.ask(question);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/sync', async (req: Request, res: Response) => {
  try {
    const { sources } = req.body;
    const results = await supervisor.sync(sources);
    res.json({ results });
  } catch (error) {
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
    const report = await supervisor.scanAndStore();
    res.json({ report });
  } catch (error) {
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
app.listen(PORT, () => {
  console.log(`\n🧠 Second Brain running on http://localhost:${PORT}\n`);
  console.log('Dashboard:   http://localhost:' + PORT);
  console.log('Ask:         POST /ask');
  console.log('Sync:        POST /sync');
  console.log('Scan:        POST /scan        (run + persist)');
  console.log('Alerts:      GET  /alerts       (persisted)');
  console.log('Dismiss:     POST /alerts/:id/dismiss');
  console.log('Slack:       GET  /deliver/slack (payload)');
  console.log('             POST /deliver/slack (send to webhook)');
  console.log('Email:       GET  /deliver/email (digest)');
  console.log('Digest:      GET  /deliver/digest (markdown)');
});
