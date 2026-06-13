import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { UserModelManager } from '../core/user-model.js';

const DATA_DIR = './data';
const FILE = join(DATA_DIR, 'user-model.json');
const BACKUP = join(DATA_DIR, 'user-model.test-backup.json');

describe('UserModelManager persistence', () => {
  beforeAll(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(FILE) && !existsSync(BACKUP)) {
      readFileSync(FILE);
      writeFileSync(BACKUP, readFileSync(FILE));
    }
  });

  afterAll(() => {
    if (existsSync(BACKUP)) {
      writeFileSync(FILE, readFileSync(BACKUP));
      rmSync(BACKUP, { force: true });
    }
  });

  it('persists updateDimension across restarts', () => {
    const a = new UserModelManager();
    const dimName = 'risk_tolerance' as const;
    const before = a.getModel().dimensions[dimName]!.value;
    a.updateDimension('dimensions', dimName, before + 0.1, 'test');
    expect(existsSync(FILE)).toBe(true);

    const b = new UserModelManager();
    expect(b.getModel().dimensions[dimName]!.value).toBeCloseTo(before + 0.1, 5);
  });

  it('persists updateGap across restarts', () => {
    const a = new UserModelManager();
    a.updateGap('test-domain-' + Date.now(), 0.5);
    const b = new UserModelManager();
    // Find the gap we just added (other tests may add gaps too)
    const gap = b.getModel().gaps.find((g) => g.domain.startsWith('test-domain-'));
    expect(gap).toBeDefined();
  });

  it('persists addDomainExample across restarts', () => {
    const a = new UserModelManager();
    const domain = 'hiring-test-' + Date.now();
    a.addDomainExample(domain, 'doc-42');
    const b = new UserModelManager();
    expect(b.getModel().decision_domains[domain]?.examples).toContain('doc-42');
  });

  it('persists updateDomainWeights across restarts', () => {
    const a = new UserModelManager();
    const domain = 'architecture-test-' + Date.now();
    a.updateDomainWeights(domain, { speed: 0.9, simplicity: 0.7 });
    const b = new UserModelManager();
    expect(b.getModel().decision_domains[domain]?.weights.speed).toBe(0.9);
  });
});
