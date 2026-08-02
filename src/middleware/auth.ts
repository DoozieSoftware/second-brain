import type { Request, Response, NextFunction } from 'express';
import { IdentityStore } from '../identity/identity-store.js';
import { AccessControl } from '../identity/access-control.js';
import type { Principal, Resource, Action } from '../identity/access-control.js';

const identityStore = new IdentityStore();

declare module 'express-serve-static-core' {
  interface Request {
    user?: Principal;
  }
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * Auth middleware.
 *
 * Two modes, in priority order:
 *  1. Identity mode (recommended): if any user exists in the identity store,
 *     a valid per-user API key is required. The resolved user is attached to
 *     `req.user` for downstream RBAC.
 *  2. Legacy mode: when no users are provisioned, falls back to the single
 *     `API_KEY` env var (kept for backward compatibility with v1.0).
 *
 * If neither API_KEY nor any identity user is configured, the API is open
 * (fine for local-only development; never deploy that way).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasUsers = identityStore.count > 0;
  const envApiKey = process.env.API_KEY;

  if (!hasUsers && !envApiKey) {
    next();
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header. Use: Authorization: Bearer <key>' });
    return;
  }

  // Identity mode: resolve against per-user keys.
  if (hasUsers) {
    const user = identityStore.getUserByApiKey(token);
    if (!user || user.disabled) {
      res.status(401).json({ error: 'Invalid or disabled API key' });
      return;
    }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      teamIds: user.teamIds,
    };
    next();
    return;
  }

  // Legacy mode: single env API key.
  if (token !== envApiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  req.user = { id: 'legacy-admin', email: 'admin@local', name: 'Legacy Admin', role: 'admin', teamIds: [] };
  next();
}

/**
 * RBAC middleware factory. Use after authMiddleware:
 *
 *   app.get('/strategy', authMiddleware, requireAccess('read', 'strategy'), ...)
 */
export function requireAccess(action: Action, resource: Resource) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ac = new AccessControl();
    if (!ac.can(req.user, action, resource)) {
      res.status(403).json({ error: `Forbidden: requires ${action}:${resource}` });
      return;
    }
    next();
  };
}

/** Convenience: only admins may call this route. */
export function requireAdmin() {
  return requireAccess('admin', 'admin');
}

export function getIdentityStore(): IdentityStore {
  return identityStore;
}
