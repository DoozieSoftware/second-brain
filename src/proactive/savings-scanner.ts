import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import type { MemoryDocument, SearchResult } from '../core/memory.js';

interface SavingsAlert {
  type: 'duplicate' | 'stalled' | 'waste';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  sources: string[];
  estimatedSavings: string;
}

export class SavingsScanner {
  private reasoning: ReasoningEngine;
  private memory: Memory;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    this.reasoning = reasoning;
    this.memory = memory;
  }

  async scan(): Promise<string> {
    console.log('\n[Proactive Scan] Analyzing organizational memory for savings opportunities...\n');

    const allDocs = await this.memory.getAll();
    if (allDocs.length === 0) {
      return 'No data in memory. Run `sync` first to ingest data from your sources.';
    }

    const alerts: SavingsAlert[] = [];

    // 1. Find duplicate work (similar PRs, issues, or docs)
    alerts.push(...(await this.findDuplicates(allDocs)));

    // 2. Find stalled items (PRs/issues with no recent activity)
    alerts.push(...(await this.findStalled(allDocs)));

    // 3. Analyze meeting productivity
    alerts.push(...(await this.analyzeMeetings(allDocs)));

    if (alerts.length === 0) {
      return 'No significant savings opportunities found. Your data looks clean!';
    }

    // Format alerts
    let report = `Found ${alerts.length} potential savings opportunity${alerts.length > 1 ? 'ies' : ''}:\n\n`;

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const icon = alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🟢';
      report += `${icon} ${i + 1}. [${alert.type.toUpperCase()}] ${alert.title}\n`;
      report += `   ${alert.description}\n`;
      report += `   Sources: ${alert.sources.join(', ')}\n`;
      report += `   Est. savings: ${alert.estimatedSavings}\n\n`;
    }

    // Use LLM to summarize the most impactful findings
    try {
      const summary = await this.reasoning.chat([
        {
          role: 'system',
          content: 'You are a business analyst. Summarize these savings opportunities in 2-3 sentences, focusing on the highest impact items and estimated time/money saved.',
        },
        {
          role: 'user',
          content: report,
        },
      ]);
      report += `\n💡 Summary: ${summary.content}\n`;
    } catch {
      // Skip summary if LLM fails
    }

    return report;
  }

  private async findDuplicates(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const itemsByType = new Map<string, MemoryDocument[]>();

    // Group by type
    for (const doc of docs) {
      const type = (doc.metadata.type as string) || 'unknown';
      if (!itemsByType.has(type)) itemsByType.set(type, []);
      itemsByType.get(type)!.push(doc);
    }

    // Check for similar issues/PRs across repos
    const issues = itemsByType.get('issue') || [];
    const prs = itemsByType.get('pr') || [];

    // Simple title similarity check for issues
    for (let i = 0; i < issues.length; i++) {
      for (let j = i + 1; j < issues.length; j++) {
        const a = issues[i];
        const b = issues[j];
        const titleA = (a.metadata.title as string) || '';
        const titleB = (b.metadata.title as string) || '';

        // Skip if same repo
        if (a.metadata.source === b.metadata.source) continue;

        // Simple word overlap check
        const wordsA = new Set(titleA.toLowerCase().split(/\s+/));
        const wordsB = new Set(titleB.toLowerCase().split(/\s+/));
        const overlap = [...wordsA].filter((w) => wordsB.has(w) && w.length > 3);

        if (overlap.length >= 3) {
          alerts.push({
            type: 'duplicate',
            severity: 'medium',
            title: `Similar issues: "${titleA}" and "${titleB}"`,
            description: `These issues in different repos share ${overlap.length} key words. They may be duplicate work or could be consolidated.`,
            sources: [a.metadata.source as string, b.metadata.source as string],
            estimatedSavings: '2-4 hours of duplicate investigation/fix',
          });
        }
      }
    }

    return alerts;
  }

  private async findStalled(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const now = new Date();
    const staleThreshold = 14 * 24 * 60 * 60 * 1000; // 14 days

    for (const doc of docs) {
      if (doc.metadata.type !== 'pr' && doc.metadata.type !== 'issue') continue;
      if (doc.metadata.state === 'closed' || doc.metadata.merged) continue;

      const updated = new Date(doc.metadata.updated as string);
      const age = now.getTime() - updated.getTime();

      if (age > staleThreshold) {
        const daysStale = Math.floor(age / (24 * 60 * 60 * 1000));
        alerts.push({
          type: 'stalled',
          severity: daysStale > 30 ? 'high' : 'medium',
          title: `Stalled ${doc.metadata.type}: "${doc.metadata.title}"`,
          description: `No activity for ${daysStale} days. Either close it, update it, or reassign.`,
          sources: [doc.metadata.source as string],
          estimatedSavings: `${Math.floor(daysStale * 0.5)} min/day of mental overhead`,
        });
      }
    }

    return alerts;
  }

  private async analyzeMeetings(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const events = docs.filter((d) => d.metadata.type === 'event');

    if (events.length === 0) return alerts;

    // Count meetings per week
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const recentEvents = events.filter((e) => {
      const date = new Date(e.metadata.date as string);
      return now.getTime() - date.getTime() < weekMs * 4; // Last 4 weeks
    });

    if (recentEvents.length > 20) {
      alerts.push({
        type: 'waste',
        severity: 'high',
        title: `High meeting volume: ${recentEvents.length} meetings in last 4 weeks`,
        description: 'Consider auditing meetings for necessity. Could some be async updates or emails?',
        sources: ['calendar'],
        estimatedSavings: `${(recentEvents.length * 0.5).toFixed(0)} hours/week if 25% are unnecessary`,
      });
    }

    // Check for recurring meetings with no corresponding output
    const recurringKeywords = ['standup', 'sync', 'weekly', 'daily', 'retro', 'review'];
    const recurring = recentEvents.filter((e) => {
      const title = ((e.metadata.title as string) || '').toLowerCase();
      return recurringKeywords.some((k) => title.includes(k));
    });

    if (recurring.length > 5) {
      alerts.push({
        type: 'waste',
        severity: 'medium',
        title: `${recurring.length} recurring meetings detected`,
        description: 'Recurring meetings can become stale. Consider if all are still needed.',
        sources: ['calendar'],
        estimatedSavings: 'Varies — audit each recurring meeting quarterly',
      });
    }

    return alerts;
  }
}
