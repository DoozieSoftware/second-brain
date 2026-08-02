import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';
import multer from 'multer';
import { SupervisorOperator } from './core/supervisor.js';

// Load .env with override:true so a stale shell-exported key can't shadow the .env one.
dotenv.config({ override: true });
import { metricsCollector } from './core/metrics.js';
import { alertManager } from './core/alerting.js';
import { logger } from './core/logger.js';
import { authMiddleware, requireAccess, requireAdmin, getIdentityStore } from './middleware/auth.js';
import { connectorRegistry } from './integrations/index.js';
import { FileImportConnector } from './connectors/file-import-connector.js';
import { EmailConfigStore } from './core/email-config-store.js';
import { ConnectorConfigStore } from './core/connector-config-store.js';
import { DreamScheduler } from './dreaming/dream-scheduler.js';

const app = express();
app.use(express.json());

const supervisor = new SupervisorOperator();

// Idle-triggered offline consolidation ("dreaming").
const dreamScheduler = new DreamScheduler(() => supervisor.dream());
app.use((_req: Request, _res: Response, next) => {
  dreamScheduler.touch();
  next();
});

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

// ─── Auth gates all routes below this line ───
app.use(authMiddleware);

// ─── Identity & Admin API ───

app.get('/admin/users', requireAdmin(), (req: Request, res: Response) => {
  try {
    res.json({ users: getIdentityStore().listUsers() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/admin/users', requireAdmin(), (req: Request, res: Response) => {
  try {
    const { email, name, role, teamIds } = req.body;
    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }
    const { user, apiKey } = getIdentityStore().createUser({ email, name, role, teamIds });
    res.status(201).json({ user, apiKey });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.patch('/admin/users/:id', requireAdmin(), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = getIdentityStore().updateUser(id, req.body);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/admin/users/:id', requireAdmin(), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = getIdentityStore().deleteUser(id);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/admin/users/:id/rotate-key', requireAdmin(), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = getIdentityStore().rotateApiKey(id);
    if (!result) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: result.user, apiKey: result.apiKey });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/admin/users/:id/revoke-key', requireAdmin(), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { keyHash } = req.body;
    if (!keyHash) {
      res.status(400).json({ error: 'keyHash is required' });
      return;
    }
    const ok = getIdentityStore().revokeApiKey(id, keyHash);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/admin/teams', requireAdmin(), (_req: Request, res: Response) => {
  try {
    res.json({ teams: getIdentityStore().listTeams() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/admin/teams', requireAdmin(), (req: Request, res: Response) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const team = getIdentityStore().createTeam({ name, description, memberIds });
    res.status(201).json({ team });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/admin/teams/:id', requireAdmin(), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = getIdentityStore().deleteTeam(id);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── RBAC-protected core routes ───

app.get('/me', (req: Request, res: Response) => {
  res.json({ user: req.user ?? null });
});

// Acknowledge an alert
app.post('/alerts/:id/acknowledge', requireAccess('write', 'alerts'), (req: Request, res: Response) => {
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

app.post('/sync', requireAccess('write', 'connectors'), async (req: Request, res: Response) => {
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

// ─── File Import ───

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const fileImportConnector = new FileImportConnector();
const emailConfigStore = new EmailConfigStore();
const connectorConfigStore = new ConnectorConfigStore();

app.post('/import', requireAccess('write', 'knowledge'), upload.array('files', 50), async (req: Request, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded. Use multipart/form-data with field "files".' });
      return;
    }

    const label = (req.body?.label as string) || 'import';
    const imports = files.map(f => ({
      path: '',
      buffer: f.buffer,
      originalName: f.originalname,
      mimeType: f.mimetype,
      size: f.size,
      label,
    }));

    const docs = await fileImportConnector.parseFiles(imports);
    // Access memory through supervisor for ingestion
    const memory = (supervisor as any).memory;
    const count = await memory.ingest(docs);

    res.json({
      imported: count,
      files: files.map(f => f.originalname),
      documentIds: docs.map(d => d.id),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/import/url', requireAccess('write', 'knowledge'), async (req: Request, res: Response) => {
  try {
    const { url, label } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const doc = await fileImportConnector.parseUrl(url, label);
    if (!doc) {
      res.status(400).json({ error: 'Could not extract content from URL' });
      return;
    }

    const memory = (supervisor as any).memory;
    await memory.ingest([doc]);

    res.json({ imported: 1, documentId: doc.id, url });
  } catch (error) {
    // SSRF guard / DNS / timeout errors come through here. Surface a 4xx so the
    // caller can tell the URL was rejected, and never expose internal details.
    const message = error instanceof Error ? error.message : 'Internal error';
    const isClientError = /Only https|Invalid URL|Direct IP|DNS|Refusing|too large|aborted/i.test(message);
    res.status(isClientError ? 400 : 500).json({ error: message });
  }
});

app.get('/sources', async (_req: Request, res: Response) => {
  try {
    const status = await supervisor.getStatus();
    res.json({
      sources: status.map(s => ({
        ...s,
        type: ['github', 'email', 'gdrive', 'dropbox'].includes(s.source) ? 'sync' : 'local',
      })),
      import: {
        endpoint: 'POST /import (multipart/form-data, field: "files", optional: "label")',
        urlImport: 'POST /import/url (JSON: { url, label })',
        supportedFormats: 'pdf, docx, xlsx, pptx, md, txt (incl. WhatsApp chat exports), csv, json, html, rtf, epub, and code files',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Email Settings ───

app.get('/settings', async (_req: Request, res: Response) => {
  try {
    const html = await readFile(join(process.cwd(), 'public', 'settings.html'), 'utf-8');
    res.type('html').send(html);
  } catch {
    res.status(404).send('Settings page not found.');
  }
});

app.get('/settings/email', (_req: Request, res: Response) => {
  res.json({ accounts: emailConfigStore.getAllSafe() });
});

app.post('/settings/email', requireAccess('write', 'connectors'), (req: Request, res: Response) => {
  try {
    const { name, host, port, user, password, folders, smtp } = req.body;
    if (!name || !host || !user || !password) {
      res.status(400).json({ error: 'name, host, user, and password are required' });
      return;
    }
    emailConfigStore.add({
      name,
      host,
      port: parseInt(port) || 993,
      user,
      password,
      folders: folders || ['INBOX'],
      smtp: smtp?.host ? {
        host: smtp.host,
        port: parseInt(smtp.port) || 587,
        user: smtp.user || user,
        password: smtp.password || password,
      } : undefined,
    });
    res.json({ success: true, accounts: emailConfigStore.getAllSafe() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/settings/email/:name', requireAccess('write', 'connectors'), (req: Request, res: Response) => {
  try {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const removed = emailConfigStore.remove(name);
    if (!removed) {
      res.status(404).json({ error: `Account "${name}" not found` });
      return;
    }
    res.json({ success: true, accounts: emailConfigStore.getAllSafe() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/settings/email/:name/test', async (req: Request, res: Response) => {
  try {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const account = emailConfigStore.getByName(name);
    if (!account) {
      res.status(404).json({ error: `Account "${name}" not found` });
      return;
    }

    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure ?? true,
      auth: { user: account.user, pass: account.password },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const messageCount = (lock as any).status?.messages ?? 'unknown';
    lock.release();
    await client.logout();

    res.json({
      success: true,
      message: `Connected to ${account.host}`,
      mailboxCount: messageCount,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    });
  }
});

// ─── Google Drive Settings ───

app.get('/settings/gdrive', (_req: Request, res: Response) => {
  res.json({ config: connectorConfigStore.getGDriveSafe() });
});

app.post('/settings/gdrive', requireAccess('write', 'connectors'), (req: Request, res: Response) => {
  try {
    const { authType, serviceAccountKey, clientId, clientSecret, refreshToken, folderId, includeSharedDrives } = req.body;
    if (authType === 'service_account' && !serviceAccountKey) {
      res.status(400).json({ error: 'serviceAccountKey is required for service account auth' });
      return;
    }
    if (authType === 'oauth2' && (!clientId || !clientSecret || !refreshToken)) {
      res.status(400).json({ error: 'clientId, clientSecret, and refreshToken are required for OAuth2' });
      return;
    }
    connectorConfigStore.setGDrive({
      authType,
      serviceAccountKey,
      clientId,
      clientSecret,
      refreshToken,
      folderId: folderId || undefined,
      includeSharedDrives: includeSharedDrives ?? true,
    });
    res.json({ success: true, config: connectorConfigStore.getGDriveSafe() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/settings/gdrive', requireAccess('write', 'connectors'), (_req: Request, res: Response) => {
  connectorConfigStore.clearGDrive();
  res.json({ success: true });
});

app.post('/settings/gdrive/test', async (_req: Request, res: Response) => {
  try {
    const config = connectorConfigStore.getGDrive();
    if (!config) {
      res.json({ success: false, error: 'No Google Drive config saved' });
      return;
    }
    const { google } = await import('googleapis');
    let auth: any;
    if (config.authType === 'service_account' && config.serviceAccountKey) {
      const key = JSON.parse(config.serviceAccountKey);
      auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    } else if (config.clientId && config.clientSecret && config.refreshToken) {
      auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
      auth.setCredentials({ refresh_token: config.refreshToken });
    }
    const drive = google.drive({ version: 'v3', auth });
    const result = await drive.files.list({ pageSize: 1, fields: 'files(id)' });
    res.json({ success: true, message: `Connected. Found ${result.data.files?.length ?? 0}+ files.` });
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : 'Connection failed' });
  }
});

// ─── Dropbox Settings ───

app.get('/settings/dropbox', (_req: Request, res: Response) => {
  res.json({ config: connectorConfigStore.getDropboxSafe() });
});

app.post('/settings/dropbox', requireAccess('write', 'connectors'), (req: Request, res: Response) => {
  try {
    const { authType, accessToken, appKey, appSecret, refreshToken, paths } = req.body;
    if (authType === 'access_token' && !accessToken) {
      res.status(400).json({ error: 'accessToken is required' });
      return;
    }
    if (authType === 'oauth2' && (!appKey || !refreshToken)) {
      res.status(400).json({ error: 'appKey and refreshToken are required for OAuth2' });
      return;
    }
    connectorConfigStore.setDropbox({
      authType,
      accessToken,
      appKey,
      appSecret,
      refreshToken,
      paths: paths || [],
    });
    res.json({ success: true, config: connectorConfigStore.getDropboxSafe() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/settings/dropbox', requireAccess('write', 'connectors'), (_req: Request, res: Response) => {
  connectorConfigStore.clearDropbox();
  res.json({ success: true });
});

app.post('/settings/dropbox/test', async (_req: Request, res: Response) => {
  try {
    const config = connectorConfigStore.getDropbox();
    if (!config) {
      res.json({ success: false, error: 'No Dropbox config saved' });
      return;
    }
    const { Dropbox } = await import('dropbox');
    let client: any;
    if (config.authType === 'access_token') {
      client = new Dropbox({ accessToken: config.accessToken });
    } else {
      client = new Dropbox({ clientId: config.appKey, clientSecret: config.appSecret, refreshToken: config.refreshToken });
    }
    const result = await client.filesListFolder({ path: '', recursive: false, limit: 1 });
    res.json({ success: true, message: `Connected. Folder has ${result.result.entries.length}+ items.` });
  } catch (error) {
    res.json({ success: false, error: error instanceof Error ? error.message : 'Connection failed' });
  }
});

// ─── Proactive Alerts API ───

// Run a new scan and persist results
app.post('/scan', requireAccess('write', 'connectors'), async (_req: Request, res: Response) => {
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
app.post('/alerts/:id/dismiss', requireAccess('write', 'alerts'), async (req: Request, res: Response) => {
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
app.post('/deliver/slack', requireAccess('write', 'connectors'), async (req: Request, res: Response) => {
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

// ─── Strategy Engine API ───

app.get('/strategy/overview', (req: Request, res: Response) => {
  try {
    const quarter = typeof req.query.quarter === 'string' ? req.query.quarter : undefined;
    res.json({ view: supervisor.getStrategy().quarterlyView(quarter) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/goals', (_req: Request, res: Response) => {
  try {
    res.json({ goals: supervisor.getStrategy().listGoals() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/strategy/goals', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const goal = supervisor.getStrategy().createGoal(req.body);
    res.status(201).json({ goal });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/goals/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rolled = supervisor.getStrategy().goalProgress(id);
    if (!rolled.goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }
    res.json(rolled);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.patch('/strategy/goals/:id', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const goal = supervisor.getStrategy().updateGoal(id, req.body);
    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }
    res.json({ goal });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/strategy/goals/:id', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = supervisor.getStrategy().deleteGoal(id);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/initiatives', (req: Request, res: Response) => {
  try {
    const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : undefined;
    res.json({ initiatives: supervisor.getStrategy().listInitiatives(goalId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/strategy/initiatives', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const initiative = supervisor.getStrategy().createInitiative(req.body);
    if (!initiative) {
      res.status(400).json({ error: 'Goal does not exist' });
      return;
    }
    res.status(201).json({ initiative });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.patch('/strategy/initiatives/:id', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const initiative = supervisor.getStrategy().updateInitiative(id, req.body);
    if (!initiative) {
      res.status(404).json({ error: 'Initiative not found' });
      return;
    }
    res.json({ initiative });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/initiatives/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const detail = supervisor.getStrategy().initiativeDetail(id);
    if (!detail.initiative) {
      res.status(404).json({ error: 'Initiative not found' });
      return;
    }
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/strategy/milestones', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const milestone = supervisor.getStrategy().createMilestone(req.body);
    if (!milestone) {
      res.status(400).json({ error: 'Initiative does not exist' });
      return;
    }
    res.status(201).json({ milestone });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.patch('/strategy/milestones/:id', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const milestone = supervisor.getStrategy().updateMilestone(id, req.body);
    if (!milestone) {
      res.status(404).json({ error: 'Milestone not found' });
      return;
    }
    res.json({ milestone });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/roadmaps', (_req: Request, res: Response) => {
  try {
    res.json({ roadmaps: supervisor.getStrategy().listRoadmaps() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/strategy/roadmaps', requireAccess('write', 'strategy'), (req: Request, res: Response) => {
  try {
    const roadmap = supervisor.getStrategy().createRoadmap(req.body);
    res.status(201).json({ roadmap });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/strategy/roadmaps/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const detail = supervisor.getStrategy().roadmapDetail(id);
    if (!detail.roadmap) {
      res.status(404).json({ error: 'Roadmap not found' });
      return;
    }
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Decision Engine API ───

app.get('/decisions', (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const decisions = query
      ? supervisor.getDecisions().searchByKeyword(query)
      : supervisor.getDecisions().list(status as any);
    res.json({ decisions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/decisions', requireAccess('write', 'decisions'), (req: Request, res: Response) => {
  try {
    const decision = supervisor.getDecisions().record(req.body);
    res.status(201).json({ decision });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/decisions/:id', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const decision = supervisor.getDecisions().get(id);
    if (!decision) {
      res.status(404).json({ error: 'Decision not found' });
      return;
    }
    res.json({ decision });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.patch('/decisions/:id', requireAccess('write', 'decisions'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const decision = supervisor.getDecisions().update(id, req.body);
    if (!decision) {
      res.status(404).json({ error: 'Decision not found' });
      return;
    }
    res.json({ decision });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/decisions/:id', requireAccess('write', 'decisions'), (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const ok = supervisor.getDecisions().delete(id);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Impact analysis for a decision
app.get('/decisions/:id/impact', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const impact = await supervisor.analyzeDecisionImpact(id);
    res.json({ impact });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Chronology (supersedes / superseded-by chain)
app.get('/decisions/:id/chronology', (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const chrono = supervisor.getDecisions().chronology(id);
    if (!chrono.record) {
      res.status(404).json({ error: 'Decision not found' });
      return;
    }
    res.json(chrono);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Integration Framework API ───

app.get('/integrations', (req: Request, res: Response) => {
  try {
    res.json({ integrations: supervisor.getIntegrationStatus() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/integrations/:name/test', async (req: Request, res: Response) => {
  try {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const connector = connectorRegistry.get(name);
    if (!connector) {
      res.status(404).json({ error: `Integration "${name}" not found` });
      return;
    }
    const result = await connector.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/integrations/:name/sync', requireAccess('write', 'connectors'), async (req: Request, res: Response) => {
  try {
    const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
    const since = typeof req.body?.since === 'string' ? req.body.since : undefined;
    const limit = typeof req.body?.limit === 'number' ? req.body.limit : undefined;
    const result = await supervisor.syncIntegration(name, { since, limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Analytics API ───

app.get('/analytics', async (_req: Request, res: Response) => {
  try {
    const snapshot = await supervisor.generateAnalytics();
    res.json({ snapshot });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/analytics/history', (_req: Request, res: Response) => {
  try {
    res.json({ snapshots: supervisor.getAnalyticsSnapshots() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/analytics/diff', (_req: Request, res: Response) => {
  try {
    res.json({ diff: supervisor.getAnalyticsDiff() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Dreaming API (offline memory consolidation) ───

app.post('/dream', requireAccess('write', 'knowledge'), async (_req: Request, res: Response) => {
  try {
    const report = await supervisor.dream();
    res.json({ report });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// ─── Knowledge API (tagging & versioning) ───

app.get('/knowledge/search', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const topK = Math.min(50, Number(req.query.limit ?? 10) || 10);
    if (!q) {
      res.status(400).json({ error: 'q query param is required' });
      return;
    }
    const results = await supervisor.search(q, topK);
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/knowledge/documents', async (req: Request, res: Response) => {
  try {
    const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
    const limit = Math.min(1000, Number(req.query.limit ?? 100) || 100);
    const docs = tag
      ? await supervisor.getMemory().findByTag(tag)
      : await supervisor.getMemory().getRecent(limit);
    res.json({ documents: docs });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/knowledge/documents/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const doc = await supervisor.getMemory().getById(id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/knowledge/documents/:id/tags', requireAccess('write', 'knowledge'), async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [];
    if (tags.length === 0) {
      res.status(400).json({ error: 'tags array is required' });
      return;
    }
    const doc = await supervisor.getMemory().addTags(id, tags);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.delete('/knowledge/documents/:id/tags', requireAccess('write', 'knowledge'), async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const tags = Array.isArray(req.query.tags) ? req.query.tags.map(String) : [];
    if (tags.length === 0) {
      res.status(400).json({ error: 'tags query param required (comma or repeated)' });
      return;
    }
    const doc = await supervisor.getMemory().removeTags(id, tags);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/knowledge/tags', async (_req: Request, res: Response) => {
  try {
    const tags = await supervisor.getMemory().getAllTags();
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.get('/knowledge/documents/:id/versions', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const versions = await supervisor.getMemory().getVersions(id);
    res.json({ versions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

app.post('/knowledge/documents/:id/versions/:version/restore', requireAccess('write', 'knowledge'), async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const version = Number(Array.isArray(req.params.version) ? req.params.version[0] : req.params.version);
    const doc = await supervisor.getMemory().restoreVersion(id, version);
    if (!doc) {
      res.status(404).json({ error: 'Document or version not found' });
      return;
    }
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
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
  dreamScheduler.start();
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  dreamScheduler.stop();
  alertManager.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  dreamScheduler.stop();
  alertManager.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
