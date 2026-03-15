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
    res.status(404).send('Dashboard not found. Run `mkdir -p public && touch public/index.html`');
  }
});

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
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

app.post('/sync', async (req: Request, res: Response) => {
  try {
    const { sources } = req.body;
    const results = await supervisor.sync(sources);
    res.json({ results });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

app.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const report = await supervisor.scan();
    res.json({ report });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

app.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await supervisor.getStatus();
    res.json({ status });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

const PORT = parseInt(process.env.PORT || '3000');
app.listen(PORT, () => {
  console.log(`\n🧠 Second Brain running on http://localhost:${PORT}\n`);
  console.log('Dashboard:  http://localhost:' + PORT);
  console.log('API:        http://localhost:' + PORT + '/ask');
  console.log('            http://localhost:' + PORT + '/sync');
  console.log('            http://localhost:' + PORT + '/alerts');
  console.log('            http://localhost:' + PORT + '/status');
});
