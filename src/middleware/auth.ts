import type { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header. Use: Authorization: Bearer <key>' });
    return;
  }
  const token = authHeader.slice(7);
  if (token !== apiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
}
