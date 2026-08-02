import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { IdentityStore, hashApiKey } from '../identity/identity-store.js';
import { AccessControl } from '../identity/access-control.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let DATA_DIR: string;
let store: IdentityStore;

describe('IdentityStore', () => {
  beforeEach(() => {
    DATA_DIR = mkdtempSync(join(tmpdir(), 'identity-'));
    store = new IdentityStore(DATA_DIR);
  });

  afterAll(() => {
    if (DATA_DIR) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('creates a user with a generated API key', () => {
    const { user, apiKey } = store.createUser({ email: 'alice@corp.com', name: 'Alice', role: 'editor' });
    expect(user.id).toMatch(/^usr_/);
    expect(apiKey).toMatch(/^sb_/);
    expect(user.apiKeysCount).toBe(1);
    expect(user).not.toHaveProperty('apiKeys');
  });

  it('normalizes email and rejects duplicates', () => {
    store.createUser({ email: 'ALICE@corp.com', name: 'Alice' });
    expect(() => store.createUser({ email: 'alice@corp.com' })).toThrow(/already exists/);
  });

  it('resolves a user from an API key via hash', () => {
    const { user, apiKey } = store.createUser({ email: 'bob@corp.com', role: 'viewer' });
    const found = store.getUserByApiKey(apiKey);
    expect(found!.id).toBe(user.id);
    expect(store.getUserByApiKey('wrong-key')).toBeUndefined();
  });

  it('never stores plaintext keys', () => {
    store.createUser({ email: 'carol@corp.com' });
    const raw = require('fs').readFileSync(join(DATA_DIR, 'identity-users.json'), 'utf-8');
    expect(raw).not.toContain('sb_');
  });

  it('rotates keys (multiple active) and revokes by hash', () => {
    const { user, apiKey } = store.createUser({ email: 'dave@corp.com' });
    const rotated = store.rotateApiKey(user.id)!;
    expect(rotated.apiKey).toMatch(/^sb_/);
    expect(rotated.user.apiKeysCount).toBe(2);

    // Revoke the original key; the rotated one must still work.
    store.revokeApiKey(user.id, hashApiKey(apiKey));
    expect(store.getUserById(user.id)!.apiKeysCount).toBe(1);
    expect(store.getUserByApiKey(rotated.apiKey)).toBeDefined();
    expect(store.getUserByApiKey(apiKey)).toBeUndefined();
  });

  it('disables a user', () => {
    const { user } = store.createUser({ email: 'erin@corp.com' });
    const updated = store.updateUser(user.id, { disabled: true })!;
    expect(updated.disabled).toBe(true);
  });

  it('manages teams and membership', () => {
    const { user } = store.createUser({ email: 'frank@corp.com', teamIds: [] });
    const team = store.createTeam({ name: 'Platform', memberIds: [user.id] });
    expect(store.getTeam(team.id)!.memberIds).toContain(user.id);

    store.updateUser(user.id, { teamIds: [team.id] });
    expect(store.isUserInTeam(user.id, team.id)).toBe(true);
    expect(store.isUserInTeam('nobody', team.id)).toBe(false);

    expect(store.deleteTeam(team.id)).toBe(true);
  });

  it('persists across instances', () => {
    const { user } = store.createUser({ email: 'grace@corp.com' });
    const reloaded = new IdentityStore(DATA_DIR);
    expect(reloaded.getUserById(user.id)!.email).toBe('grace@corp.com');
  });
});

describe('AccessControl', () => {
  const ac = new AccessControl();

  it('admin can do anything', () => {
    expect(ac.can({ id: 'a', email: 'a@c.com', name: 'A', role: 'admin', teamIds: [] }, 'write', 'knowledge')).toBe(true);
    expect(ac.can({ id: 'a', email: 'a@c.com', name: 'A', role: 'admin', teamIds: [] }, 'admin', 'admin')).toBe(true);
  });

  it('editor can read and write strategy/decisions/knowledge', () => {
    const editor = { id: 'e', email: 'e@c.com', name: 'E', role: 'editor', teamIds: [] };
    expect(ac.can(editor, 'read', 'strategy')).toBe(true);
    expect(ac.can(editor, 'write', 'decisions')).toBe(true);
    expect(ac.can(editor, 'write', 'knowledge')).toBe(true);
    expect(ac.can(editor, 'read', 'alerts')).toBe(true);
    expect(ac.can(editor, 'admin', 'admin')).toBe(false);
  });

  it('viewer is read-only', () => {
    const viewer = { id: 'v', email: 'v@c.com', name: 'V', role: 'viewer', teamIds: [] };
    expect(ac.canRead(viewer, 'knowledge')).toBe(true);
    expect(ac.canWrite(viewer, 'strategy')).toBe(false);
    expect(ac.can(viewer, 'write', 'connectors')).toBe(false);
  });

  it('denies unknown roles and disabled users', () => {
    expect(ac.can({ id: 'x', email: 'x@c.com', name: 'X', role: 'banana', teamIds: [] }, 'read', 'knowledge')).toBe(false);
    expect(ac.can({ id: 'y', email: 'y@c.com', name: 'Y', role: 'admin', teamIds: [], disabled: true }, 'read', 'knowledge')).toBe(false);
    expect(ac.can(undefined, 'read', 'knowledge')).toBe(false);
  });
});
