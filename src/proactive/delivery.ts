import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SavingsAlert, SavingsReport } from './savings-scanner.js';

// Resolved at call time so tests can change DATA_DIR between calls. Using a
// top-level `const` froze the value at module load and broke tests that set
// `process.env.DATA_DIR` after import.
function getDataDir(): string {
  return process.env.DATA_DIR ?? './data';
}
const ALERTS_FILE = 'alerts.json';
const DIGEST_FILE = 'digest.md';

export interface StoredAlert extends SavingsAlert {
  id: string;
  timestamp: string;
  dismissed: boolean;
}

export interface AlertStore {
  lastScan: string | null;
  alerts: StoredAlert[];
  history: { date: string; count: number; totalHours: number }[];
}

function getStorePath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, ALERTS_FILE);
}

function getDigestPath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, DIGEST_FILE);
}

export function loadAlerts(): AlertStore {
  const path = getStorePath();
  if (!existsSync(path)) {
    return { lastScan: null, alerts: [], history: [] };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { lastScan: null, alerts: [], history: [] };
  }
}

export function saveAlerts(store: AlertStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2));
}

export function storeScanResults(report: SavingsReport): StoredAlert[] {
  const store = loadAlerts();
  const now = new Date().toISOString();

  // Step 1: dedup newly-scanned alerts against prior un-dismissed alerts by
  // (type, sources[0], title). A scan that re-detects the same issue should
  // refresh the existing alert's timestamp, not spawn a new one with a new id.
  // Otherwise the operator loses the prior alert's acknowledged state.
  const priorActive = store.alerts.filter((a) => !a.dismissed);
  const dedupKey = (a: { type: string; sources?: string[]; title: string }) =>
    `${a.type}|${a.sources?.[0] ?? ''}|${a.title}`;

  const priorByKey = new Map<string, StoredAlert>();
  for (const a of priorActive) priorByKey.set(dedupKey(a), a);

  const newAlerts: StoredAlert[] = report.alerts.map((alert, i) => {
    const key = dedupKey(alert);
    const prior = priorByKey.get(key);
    if (prior) {
      // Reuse the prior id and preserve acknowledged state; just bump the
      // timestamp so the UI shows it as fresh.
      return { ...alert, id: prior.id, timestamp: now, dismissed: false };
    }
    return {
      ...alert,
      id: `alert_${Date.now()}_${i}`,
      timestamp: now,
      dismissed: false,
    };
  });

  // Mark keys that were re-detected this scan so we can drop prior duplicates.
  const seenKeys = new Set(newAlerts.map((a) => dedupKey(a)));
  const dedupedPriorActive = priorActive.filter(
    (a) => !seenKeys.has(dedupKey(a))
  );

  // Keep recent dismissed alerts (last 30 days) so the operator can still see
  // a history of what they've triaged.
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const oldDismissed = store.alerts.filter(
    (a) => a.dismissed && new Date(a.timestamp).getTime() > thirtyDaysAgo
  );

  // Merge: re-detected alerts (re-stamped), prior un-dismissed alerts that
  // this scan didn't re-emit (preserved so the operator doesn't lose context),
  // recent dismissed alerts (history), then any brand-new alerts.
  store.alerts = [...newAlerts, ...dedupedPriorActive, ...oldDismissed];
  store.lastScan = now;

  // Add to history
  store.history.push({
    date: now,
    count: report.totalAlerts,
    totalHours: report.totalEstimatedHours,
  });

  // Keep last 90 days of history
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  store.history = store.history.filter(
    (h) => new Date(h.date).getTime() > ninetyDaysAgo
  );

  saveAlerts(store);

  // Also generate digest file
  generateDigest(report);

  return newAlerts;
}

export function dismissAlert(alertId: string): boolean {
  const store = loadAlerts();
  const alert = store.alerts.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.dismissed = true;
  saveAlerts(store);
  return true;
}

export function getActiveAlerts(): StoredAlert[] {
  const store = loadAlerts();
  return store.alerts.filter((a) => !a.dismissed);
}

export function getSavingsTrend(): { trend: 'improving' | 'stable' | 'worsening'; weeklyAvg: number } {
  const store = loadAlerts();
  if (store.history.length < 2) return { trend: 'stable', weeklyAvg: 0 };

  const recent = store.history.slice(-7);
  const older = store.history.slice(-14, -7);

  const recentAvg = recent.reduce((s, h) => s + h.totalHours, 0) / recent.length;
  const olderAvg = older.length > 0
    ? older.reduce((s, h) => s + h.totalHours, 0) / older.length
    : recentAvg;

  let trend: 'improving' | 'stable' | 'worsening';
  if (recentAvg < olderAvg * 0.8) trend = 'improving';
  else if (recentAvg > olderAvg * 1.2) trend = 'worsening';
  else trend = 'stable';

  return { trend, weeklyAvg: recentAvg };
}

// ─── Digest Formats ───

function generateDigest(report: SavingsReport): void {
  const md = formatMarkdownDigest(report);
  writeFileSync(getDigestPath(), md);
}

export function formatMarkdownDigest(report: SavingsReport): string {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let md = `# Second Brain — Savings Digest\n`;
  md += `**${date}**\n\n`;
  md += `## Summary\n`;
  md += `- **${report.totalAlerts}** issues found\n`;
  md += `- **${report.highPriority}** high priority\n`;
  md += `- **${report.totalEstimatedHours.toFixed(0)} hours/month** estimated waste\n`;
  md += `- **$${report.totalEstimatedDollars.toFixed(0)}/month** estimated cost\n\n`;

  if (report.alerts.length > 0) {
    md += `## Top Issues\n\n`;
    for (let i = 0; i < Math.min(report.alerts.length, 5); i++) {
      const a = report.alerts[i];
      const icon = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢';
      md += `### ${icon} ${a.title}\n`;
      md += `${a.description}\n\n`;
      md += `**Action:** ${a.action}\n`;
      md += `**Est. savings:** ${a.estimatedHours.toFixed(1)}h ($${a.estimatedDollars.toFixed(0)})\n\n`;
    }
  }

  if (report.summary) {
    md += `## AI Summary\n${report.summary}\n`;
  }

  md += `\n---\n*Generated by Second Brain*\n`;
  return md;
}

export function formatSlackMessage(report: SavingsReport): object {
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `💰 Savings Report — ${report.totalAlerts} issues found` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${report.highPriority}* high priority\n*${report.totalEstimatedHours.toFixed(0)}h/month* estimated waste\n*$${report.totalEstimatedDollars.toFixed(0)}/month* estimated cost`,
      },
    },
    { type: 'divider' },
  ];

  for (const alert of report.alerts.slice(0, 3)) {
    const icon = alert.severity === 'high' ? ':red_circle:' : alert.severity === 'medium' ? ':yellow_circle:' : ':green_circle:';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${alert.title}*\n${alert.description}\n_💡 ${alert.action}_\n💵 ${alert.estimatedHours.toFixed(1)}h ($${alert.estimatedDollars.toFixed(0)})`,
      },
    });
  }

  if (report.summary) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Summary:* ${report.summary}` },
    });
  }

  return { blocks };
}

export function formatEmailDigest(report: SavingsReport): { subject: string; html: string; text: string } {
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const subject = `Second Brain: ${report.totalAlerts} savings opportunities ($${report.totalEstimatedDollars.toFixed(0)}/month waste)`;

  let html = `<h2>💰 Savings Report — ${date}</h2>`;
  html += `<p><strong>${report.totalAlerts}</strong> issues · <strong>${report.highPriority}</strong> high priority</p>`;
  html += `<p>Estimated waste: <strong>${report.totalEstimatedHours.toFixed(0)} hours/month</strong> = <strong>$${report.totalEstimatedDollars.toFixed(0)}/month</strong></p>`;
  html += `<hr>`;

  for (const a of report.alerts.slice(0, 5)) {
    const color = a.severity === 'high' ? '#f85149' : a.severity === 'medium' ? '#d29922' : '#3fb950';
    html += `<div style="border-left: 4px solid ${color}; padding-left: 12px; margin: 16px 0;">`;
    html += `<h3>${a.title}</h3>`;
    html += `<p>${a.description}</p>`;
    html += `<p><strong>Action:</strong> ${a.action}</p>`;
    html += `<p>💵 ${a.estimatedHours.toFixed(1)}h ($${a.estimatedDollars.toFixed(0)})</p>`;
    html += `</div>`;
  }

  if (report.summary) {
    html += `<hr><p><strong>Summary:</strong> ${report.summary}</p>`;
  }

  const text = `Savings Report — ${date}\n\n${report.totalAlerts} issues, ${report.highPriority} high priority\n${report.totalEstimatedHours.toFixed(0)} hours/month = $${report.totalEstimatedDollars.toFixed(0)}/month\n\n${report.summary || ''}`;

  return { subject, html, text };
}
