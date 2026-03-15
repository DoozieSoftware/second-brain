import 'dotenv/config';
import express, { Request, Response } from 'express';
import { SupervisorOperator } from './core/supervisor.js';

const app = express();
app.use(express.json());

const supervisor = new SupervisorOperator();

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
  console.log(`Second Brain API running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /ask     - Ask a question');
  console.log('  POST /sync    - Sync data sources');
  console.log('  GET  /alerts  - Get savings alerts');
  console.log('  GET  /status  - Check source status');
});
