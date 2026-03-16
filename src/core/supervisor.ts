import { ReasoningEngine } from './reasoning.js';
import { Memory } from './memory.js';
import { Operator } from './operator.js';
import type { OperatorResponse } from './operator.js';
import { GitHubOperator } from '../operators/github-operator.js';
import { DocsOperator } from '../operators/docs-operator.js';
import { EmailOperator } from '../operators/email-operator.js';
import { CalendarOperator } from '../operators/calendar-operator.js';
import { SavingsScanner } from '../proactive/savings-scanner.js';
import type { SavingsReport } from '../proactive/savings-scanner.js';
import {
  storeScanResults,
  getActiveAlerts,
  dismissAlert,
  getSavingsTrend,
  formatSlackMessage,
  formatEmailDigest,
  loadAlerts,
} from '../proactive/delivery.js';
import type { StoredAlert } from '../proactive/delivery.js';

export class SupervisorOperator {
  private reasoning: ReasoningEngine;
  private memory: Memory;
  private operators: Map<string, Operator> = new Map();
  private savingsScanner: SavingsScanner;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  constructor() {
    this.reasoning = new ReasoningEngine();
    this.memory = new Memory();
    this.savingsScanner = new SavingsScanner(this.reasoning, this.memory);

    // Initialize all operators
    this.operators.set('github', new GitHubOperator(this.reasoning, this.memory));
    this.operators.set('docs', new DocsOperator(this.reasoning, this.memory));
    this.operators.set('email', new EmailOperator(this.reasoning, this.memory));
    this.operators.set('calendar', new CalendarOperator(this.reasoning, this.memory));
  }

  async ask(question: string, verbose = false): Promise<OperatorResponse> {
    const mainOperator = new Operator('supervisor', this.reasoning, this.memory);

    let context = `You have access to organizational memory from multiple sources: GitHub (repos, PRs, issues), documents, emails, and calendar events. Search across all of them to answer the question comprehensively. Connect related information across sources.`;

    if (this.conversationHistory.length > 0) {
      const recentHistory = this.conversationHistory.slice(-6);
      context += `\n\nPrevious conversation:\n${recentHistory.map(h => `${h.role}: ${h.content.slice(0, 200)}`).join('\n')}`;
    }

    const result = await mainOperator.reason(question, context, verbose);

    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: result.answer });

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    return result;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  async sync(sources?: string[]): Promise<{ source: string; count: number }[]> {
    const results: { source: string; count: number }[] = [];
    const toSync = sources || Array.from(this.operators.keys());

    for (const sourceName of toSync) {
      const op = this.operators.get(sourceName);
      if (!op) {
        console.warn(`Unknown source: ${sourceName}`);
        continue;
      }

      try {
        const count = await (op as any).sync();
        results.push({ source: sourceName, count });
      } catch (error) {
        console.error(`Sync failed for ${sourceName}:`, error);
        results.push({ source: sourceName, count: 0 });
      }
    }

    return results;
  }

  async scan(): Promise<string> {
    return this.savingsScanner.scan();
  }

  async scanAndStore(): Promise<SavingsReport | string> {
    const report = await this.savingsScanner.scanStructured();
    if (typeof report === 'string') return report;
    storeScanResults(report);
    return report;
  }

  getAlerts(): StoredAlert[] {
    return getActiveAlerts();
  }

  dismissAlertById(id: string): boolean {
    return dismissAlert(id);
  }

  getTrend(): { trend: 'improving' | 'stable' | 'worsening'; weeklyAvg: number } {
    return getSavingsTrend();
  }

  getSlackPayload(): object {
    const store = loadAlerts();
    // Reconstruct a minimal report from stored alerts
    const active = store.alerts.filter(a => !a.dismissed);
    return formatSlackMessage({
      totalAlerts: active.length,
      highPriority: active.filter(a => a.severity === 'high').length,
      totalEstimatedHours: active.reduce((s, a) => s + a.estimatedHours, 0),
      totalEstimatedDollars: active.reduce((s, a) => s + a.estimatedDollars, 0),
      alerts: active,
      summary: '',
    });
  }

  getEmailDigest(): { subject: string; html: string; text: string } {
    const store = loadAlerts();
    const active = store.alerts.filter(a => !a.dismissed);
    return formatEmailDigest({
      totalAlerts: active.length,
      highPriority: active.filter(a => a.severity === 'high').length,
      totalEstimatedHours: active.reduce((s, a) => s + a.estimatedHours, 0),
      totalEstimatedDollars: active.reduce((s, a) => s + a.estimatedDollars, 0),
      alerts: active,
      summary: '',
    });
  }

  async getStatus(): Promise<{ source: string; configured: boolean; docCount?: number }[]> {
    const docCount = this.memory.count;

    let githubConfigured = !!process.env.GITHUB_TOKEN;
    if (!githubConfigured) {
      try {
        const { execSync } = await import('child_process');
        execSync('gh auth status', { stdio: 'ignore' });
        githubConfigured = true;
      } catch {
        // gh not authenticated
      }
    }

    return [
      { source: 'github', configured: githubConfigured },
      { source: 'docs', configured: true, docCount },
      { source: 'email', configured: !!(process.env.IMAP_USER && process.env.IMAP_PASSWORD) },
      { source: 'calendar', configured: !!process.env.GOOGLE_CALENDAR_API_KEY },
    ];
  }
}
