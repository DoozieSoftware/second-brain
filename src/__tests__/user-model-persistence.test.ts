import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Use a stable per-file tempdir so multiple files in the same vitest run
// don't share state. The user-model.test.ts uses a different prefix.
const DATA_DIR = mkdtempSync(join(tmpdir(), 'um-persist-'));
process.env.DATA_DIR = DATA_DIR;

import { UserModelManager } from '../core/user-model.js';

describe('UserModelManager persistence', () => {
  afterAll(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('persists updateDimension across restarts', () => {
    const a = new UserModelManager();
    const dimName = 'risk_tolerance' as const;
    // The default dimension starts at value=0.5 with samples=0. A single
    // update applies a Bayesian update with weight 1/(1+0) = 1, so the value
    // is overwritten to the new value. We assert the persisted value equals
    // what we set, not "old + delta" — that's the actual contract.
    a.updateDimension('dimensions', dimName, 0.9, 'test');
    const b = new UserModelManager();
    expect(b.getModel().dimensions[dimName]!.value).toBeCloseTo(0.9, 5);
    expect(b.getModel().dimensions[dimName]!.samples).toBe(1);
  });

  it('persists updateGap across restarts', () => {
    const a = new UserModelManager();
    const domain = 'test-domain-' + Date.now();
    a.updateGap(domain, 0.5);
    const b = new UserModelManager();
    expect(b.getModel().gaps.find((g) => g.domain === domain)?.confidence).toBe(0.5);
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
