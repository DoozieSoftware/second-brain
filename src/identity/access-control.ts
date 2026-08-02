import type { Role } from './identity-store.js';

/** Minimal principal shape — what the auth middleware attaches to req.user. */
export interface Principal {
  id: string;
  email: string;
  name: string;
  role: string;
  teamIds: string[];
  disabled?: boolean;
}

/**
 * Permission model. Resources: knowledge (documents/memory), strategy, decisions,
 * connectors (config + sync), alerts, admin (user/team management).
 *
 * Actions: read, write, admin.
 */
export type Resource = 'knowledge' | 'strategy' | 'decisions' | 'connectors' | 'alerts' | 'admin';
export type Action = 'read' | 'write' | 'admin';

export const PERMISSIONS: Record<Action, Resource[]> = {
  read: ['knowledge', 'strategy', 'decisions', 'alerts'],
  write: ['knowledge', 'strategy', 'decisions', 'connectors', 'alerts'],
  admin: ['admin'],
};

// Role -> which (action, resource) pairs are allowed. Admin implicitly has all.
const ROLE_MATRIX: Record<Role, Array<[Action, Resource]>> = {
  admin: [['admin', 'admin']], // wildcard via can()
  editor: [
    ['read', 'knowledge'], ['write', 'knowledge'],
    ['read', 'strategy'], ['write', 'strategy'],
    ['read', 'decisions'], ['write', 'decisions'],
    ['read', 'connectors'], ['write', 'connectors'],
    ['read', 'alerts'],
  ],
  viewer: [
    ['read', 'knowledge'],
    ['read', 'strategy'],
    ['read', 'decisions'],
    ['read', 'alerts'],
  ],
};

export class AccessControl {
  /** Can a user perform `action` on `resource`? */
  can(user: Principal | undefined, action: Action, resource: Resource): boolean {
    if (!user || user.disabled) return false;
    if (user.role === 'admin') return true;
    const allowed = ROLE_MATRIX[user.role as Role] ?? [];
    return allowed.some(([a, r]) => a === action && r === resource);
  }

  /** Read permission is a superset check used by GET endpoints. */
  canRead(user: Principal | undefined, resource: Resource): boolean {
    return this.can(user, 'read', resource);
  }

  /** Write permission used by POST/PATCH/DELETE endpoints. */
  canWrite(user: Principal | undefined, resource: Resource): boolean {
    return this.can(user, 'write', resource);
  }

  hasRole(user: Principal | undefined, role: Role): boolean {
    return !!user && user.role === role;
  }
}

export const accessControl = new AccessControl();
