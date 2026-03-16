import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SavingsAlert, SavingsReport } from './savings-scanner.js';

const DATA_DIR = './data';
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
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  return join(DATA_DIR, ALERTS_FILE);
}

function getDigestPath(): string {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  return join(DATA_DIR, DIGEST_FILE);
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

  // Mark old alerts as potentially stale (keep for history)
  const newAlerts: StoredAlert[] = report.alerts.map((alert, i) => ({
    ...alert,
    id: `alert_${Date.now()}_${i}`,
    timestamp: now,
    dismissed: false,
  }));

  // Merge: keep dismissed alerts from previous scan, add new ones
  const dismissedIds = new Set(
    store.alerts.filter((a) => a.dismissed).map((a) => a.id)
  );

  // Keep recent dismissed alerts (last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const oldDismissed = store.alerts.filter(
    (a) => a.dismissed && new Date(a.timestamp).getTime() > thirtyDaysAgo
  );

  store.alerts = [...oldDismissed, ...newAlerts];
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
