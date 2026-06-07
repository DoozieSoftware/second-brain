import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';

function buildTestApp(apiKey?: string) {
  if (apiKey) {
    process.env.API_KEY = apiKey;
  } else {
    delete process.env.API_KEY;
  }
  const app = express();
  app.use(authMiddleware);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('authMiddleware', () => {
  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('allows all requests when API_KEY is not set (dev mode)', async () => {
    const app = buildTestApp(undefined);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 401 when API_KEY is set and no Authorization header provided', async () => {
    const app = buildTestApp('secret123');
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing Authorization/);
  });

  it('returns 401 when wrong token is provided', async () => {
    const app = buildTestApp('secret123');
    const res = await request(app).get('/test').set('Authorization', 'Bearer wrongtoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid API key/);
  });

  it('allows request when correct Bearer token is provided', async () => {
    const app = buildTestApp('secret123');
    const res = await request(app).get('/test').set('Authorization', 'Bearer secret123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
