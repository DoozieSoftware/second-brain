import { createHash, randomBytes } from 'crypto';
import { JsonStore } from '../core/json-store.js';

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Per-user API keys. Stored as SHA-256 hashes; the plaintext is shown once. */
  apiKeys: string[];
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
  disabled?: boolean;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
}

/** Public projection of a user — never includes API key hashes. */
export type SafeUser = Omit<User, 'apiKeys'> & { apiKeysCount: number };

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** SHA-256 hash of an API key. We never persist plaintext keys. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Generate a cryptographically random API key. */
export function generateApiKey(): string {
  return `sb_${randomBytes(24).toString('base64url')}`;
}

/**
 * Identity store — users, roles, teams, and per-user API keys.
 *
 * Security model:
 *  - API keys are stored as SHA-256 hashes, never plaintext.
 *  - The full `apiKeys` field is only returned via `getUserByApiKey`; the
 *    safe projection strips hashes.
 *  - Users can be disabled without deletion (safe revocation).
 *
 * This is deliberately storage-agnostic (JsonStore) and free of HTTP concerns.
 */
export class IdentityStore {
  private users: JsonStore<User>;
  private teams: JsonStore<Team>;

  constructor(dataDir?: string) {
    this.users = new JsonStore<User>('identity-users.json', dataDir);
    this.teams = new JsonStore<Team>('identity-teams.json', dataDir);
  }

  // ─── Users ───

  createUser(input: { email: string; name?: string; role?: Role; teamIds?: string[] }): { user: SafeUser; apiKey: string } {
    const email = input.email.toLowerCase().trim();
    if (!email.includes('@')) throw new Error('Invalid email address');
    if (this.users.all().some(u => u.email === email)) {
      throw new Error(`User with email "${email}" already exists`);
    }
    const apiKey = generateApiKey();
    const nowIso = new Date().toISOString();
    const user: User = {
      id: newId('usr'),
      email,
      name: input.name || email,
      role: input.role ?? 'viewer',
      apiKeys: [hashApiKey(apiKey)],
      teamIds: input.teamIds ?? [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.users.upsert(user);
    return { user: this.safeUser(user), apiKey };
  }

  listUsers(): SafeUser[] {
    return this.users.all().map(u => this.safeUser(u));
  }

  getUserById(id: string): SafeUser | undefined {
    const u = this.users.getById(id);
    return u ? this.safeUser(u) : undefined;
  }

  /** Resolve a full user (with key hashes) from a raw API key. */
  getUserByApiKey(rawKey: string): User | undefined {
    const hash = hashApiKey(rawKey);
    return this.users.all().find(u => u.apiKeys.includes(hash));
  }

  /** Issue a fresh API key for a user. */
  rotateApiKey(userId: string): { user: SafeUser; apiKey: string } | undefined {
    const user = this.users.getById(userId);
    if (!user) return undefined;
    const apiKey = generateApiKey();
    const updated: User = { ...user, apiKeys: [...user.apiKeys, hashApiKey(apiKey)], updatedAt: new Date().toISOString() };
    this.users.upsert(updated);
    return { user: this.safeUser(updated), apiKey };
  }

  /** Revoke a specific API key by its hash. */
  revokeApiKey(userId: string, keyHash: string): boolean {
    const user = this.users.getById(userId);
    if (!user) return false;
    const updated: User = {
      ...user,
      apiKeys: user.apiKeys.filter(k => k !== keyHash),
      updatedAt: new Date().toISOString(),
    };
    this.users.upsert(updated);
    return true;
  }

  updateUser(id: string, patch: Partial<Pick<User, 'name' | 'role' | 'teamIds' | 'disabled'>>): SafeUser | undefined {
    const user = this.users.getById(id);
    if (!user) return undefined;
    const updated: User = { ...user, ...patch, updatedAt: new Date().toISOString() };
    this.users.upsert(updated);
    return this.safeUser(updated);
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }

  // ─── Teams ───

  createTeam(input: { name: string; description?: string; memberIds?: string[] }): Team {
    const team: Team = {
      id: newId('team'),
      name: input.name,
      description: input.description,
      memberIds: input.memberIds ?? [],
      createdAt: new Date().toISOString(),
    };
    return this.teams.upsert(team);
  }

  listTeams(): Team[] {
    return this.teams.all();
  }

  getTeam(id: string): Team | undefined {
    return this.teams.getById(id);
  }

  updateTeam(id: string, patch: Partial<Pick<Team, 'name' | 'description' | 'memberIds'>>): Team | undefined {
    const team = this.teams.getById(id);
    if (!team) return undefined;
    return this.teams.upsert({ ...team, ...patch });
  }

  deleteTeam(id: string): boolean {
    return this.teams.delete(id);
  }

  isUserInTeam(userId: string, teamId: string): boolean {
    const user = this.users.getById(userId);
    return !!user?.teamIds.includes(teamId);
  }

  // ─── Helpers ───

  /** Projection that never leaks API key hashes. */
  safeUser(user: User): Omit<User, 'apiKeys'> & { apiKeysCount: number } {
    const { apiKeys, ...rest } = user;
    return { ...rest, apiKeysCount: apiKeys.length };
  }

  get count(): number {
    return this.users.count;
  }
}
