import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { storeScanResults, loadAlerts, saveAlerts } from '../proactive/delivery.js';
import type { SavingsReport } from '../proactive/savings-scanner.js';

const DATA_DIR = './data';
const ALERTS = join(DATA_DIR, 'alerts.json');
const BACKUP = join(DATA_DIR, 'alerts.test-backup.json');

function makeReport(alerts: SavingsReport['alerts']): SavingsReport {
  return {
    totalAlerts: alerts.length,
    highPriority: 0,
    totalEstimatedHours: 0,
    totalEstimatedDollars: 0,
    alerts,
    summary: '',
  };
}

describe('storeScanResults — alert merge', () => {
  beforeAll(() => {
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(ALERTS) && !existsSync(BACKUP)) {
      writeFileSync(BACKUP, readFileSync(ALERTS));
    }
  });

  afterAll(() => {
    if (existsSync(BACKUP)) {
      writeFileSync(ALERTS, readFileSync(BACKUP));
      rmSync(BACKUP, { force: true });
    } else {
      rmSync(ALERTS, { force: true });
    }
  });

  it('deduplicates re-detected alerts across scans (preserves id)', () => {
    saveAlerts({ lastScan: null, alerts: [], history: [] });
    const alert = {
      type: 'stalled' as const,
      severity: 'high' as const,
      title: 'Stalled PR #42 (test 1)',
      description: '...',
      sources: ['github:org/repo-1'],
      items: ['pr-42'],
      estimatedHours: 5,
      estimatedDollars: 500,
      action: 'ping owner',
    };
    const first = storeScanResults(makeReport([alert]));
    expect(first).toHaveLength(1);
    const firstId = first[0]!.id;

    const second = storeScanResults(makeReport([alert]));
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(firstId);
  });

  it('preserves un-dismissed prior alerts that the new scan does not re-emit', () => {
    saveAlerts({ lastScan: null, alerts: [], history: [] });
    const prior = {
      type: 'duplicate' as const,
      severity: 'high' as const,
      title: 'Duplicate work in two repos (test 2)',
      description: '...',
      sources: ['github:org/a-1', 'github:org/b-1'],
      items: ['a-1', 'b-1'],
      estimatedHours: 3,
      estimatedDollars: 300,
      action: 'merge',
    };
    const first = storeScanResults(makeReport([prior]));
    const priorId = first[0]!.id;

    const fresh = { ...prior, title: 'Newly found: orphan branch (test 2)', type: 'orphaned' as const };
    storeScanResults(makeReport([fresh]));

    const store = loadAlerts();
    const stillThere = store.alerts.find((a) => a.id === priorId);
    expect(stillThere).toBeDefined();
    expect(stillThere?.dismissed).toBe(false);
  });

  it('does not duplicate the same alert within a single merge', () => {
    saveAlerts({ lastScan: null, alerts: [], history: [] });
    const a = {
      type: 'stalled' as const,
      severity: 'medium' as const,
      title: 'Issue #7 still open (test 3)',
      description: '',
      sources: ['github:org/repo-3'],
      items: ['issue-7'],
      estimatedHours: 1,
      estimatedDollars: 50,
      action: 'close',
    };
    const r1 = storeScanResults(makeReport([a]));
    const r1Id = r1[0]!.id;
    const r2 = storeScanResults(makeReport([a]));
    expect(r2[0]!.id).toBe(r1Id);

    const store = loadAlerts();
    const matching = store.alerts.filter((x) => x.id === r1Id);
    expect(matching).toHaveLength(1);
  });
});
