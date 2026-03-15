import { ReasoningEngine } from '../core/reasoning.js';
import { Memory } from '../core/memory.js';
import type { MemoryDocument } from '../core/memory.js';

export interface SavingsAlert {
  type: 'duplicate' | 'stalled' | 'meeting-waste' | 'context-switch' | 'orphaned';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  sources: string[];
  items: string[]; // IDs of related documents
  estimatedHours: number;
  estimatedDollars: number;
  action: string; // What to do about it
}

export interface SavingsReport {
  totalAlerts: number;
  highPriority: number;
  totalEstimatedHours: number;
  totalEstimatedDollars: number;
  alerts: SavingsAlert[];
  summary: string;
  weeklyDigest?: WeeklyDigest;
}

interface WeeklyDigest {
  thisWeek: number;
  lastWeek: number;
  trend: 'improving' | 'stable' | 'worsening';
}

const HOURLY_RATE = 75; // Average knowledge worker cost

export class SavingsScanner {
  private reasoning: ReasoningEngine;
  private memory: Memory;

  constructor(reasoning: ReasoningEngine, memory: Memory) {
    this.reasoning = reasoning;
    this.memory = memory;
  }

  async scan(): Promise<string> {
    console.log('\n[Proactive Scan] Analyzing organizational memory...\n');

    const allDocs = await this.memory.getAll();
    if (allDocs.length === 0) {
      return 'No data in memory. Run `sync` first to ingest data from your sources.';
    }

    const alerts: SavingsAlert[] = [];

    // Run all analyzers in parallel
    const [duplicates, stalled, meetingWaste, orphaned] = await Promise.all([
      this.findCrossSourceDuplicates(allDocs),
      this.findStalledWork(allDocs),
      this.analyzeMeetingOutputCorrelation(allDocs),
      this.findOrphanedWork(allDocs),
    ]);

    alerts.push(...duplicates, ...stalled, ...meetingWaste, ...orphaned);

    // Sort by estimated impact (hours saved)
    alerts.sort((a, b) => b.estimatedHours - a.estimatedHours);

    const report: SavingsReport = {
      totalAlerts: alerts.length,
      highPriority: alerts.filter((a) => a.severity === 'high').length,
      totalEstimatedHours: alerts.reduce((sum, a) => sum + a.estimatedHours, 0),
      totalEstimatedDollars: alerts.reduce((sum, a) => sum + a.estimatedDollars, 0),
      alerts,
      summary: '',
    };

    // Generate LLM summary of the findings
    report.summary = await this.generateSummary(report);

    return this.formatReport(report);
  }

  /**
   * Cross-source duplicate detection using semantic similarity.
   * Finds issues, emails, and meetings discussing the same problem.
   */
  private async findCrossSourceDuplicates(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const workItems = docs.filter(
      (d) => ['issue', 'pr', 'email', 'event'].includes(d.metadata.type as string)
    );

    if (workItems.length < 2) return alerts;

    // For each work item, search for semantically similar items in OTHER sources
    const checked = new Set<string>();

    for (const item of workItems) {
      const itemId = item.id;
      const itemSource = (item.metadata.source as string) || '';
      const itemTitle = (item.metadata.title as string) || item.text.slice(0, 100);

      if (checked.has(itemId)) continue;
      checked.add(itemId);

      // Search for similar content using embeddings
      const similar = await this.memory.search(itemTitle, 5);

      // Filter to different sources (cross-source = potential duplicate/confusion)
      const crossSource = similar.filter((s) => {
        if (s.id === itemId) return false;
        if (s.score < 0.5) return false; // Not similar enough
        const sSource = (s.metadata.source as string) || '';
        return sSource !== itemSource;
      });

      for (const match of crossSource) {
        const matchKey = [itemId, match.id].sort().join(':');
        if (checked.has(matchKey)) continue;
        checked.add(matchKey);

        const sources = [
          item.metadata.type as string,
          match.metadata.type as string,
        ];
        const uniqueSources = [...new Set(sources)];

        // Higher severity if it's active work across repos
        const isActive =
          item.metadata.state === 'open' &&
          match.metadata.state === 'open';

        alerts.push({
          type: 'duplicate',
          severity: isActive ? 'high' : 'medium',
          title: `Same problem discussed in ${uniqueSources.join(' + ')}: "${itemTitle.slice(0, 60)}..."`,
          description: `Found ${match.metadata.type} with ${(match.score * 100).toFixed(0)}% similarity in ${match.metadata.source}. ${
            isActive
              ? 'Both are still OPEN — this is likely duplicate work.'
              : 'Consider linking these for future reference.'
          }`,
          sources: [itemSource, match.metadata.source as string],
          items: [itemId, match.id],
          estimatedHours: isActive ? 4 : 1,
          estimatedDollars: isActive ? 4 * HOURLY_RATE : HOURLY_RATE,
          action: isActive
            ? 'Close one and link to the other'
            : 'Add cross-reference comment',
        });
      }
    }

    return alerts;
  }

  /**
   * Smarter stalled work detection with context awareness.
   */
  private async findStalledWork(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const now = new Date();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;

    const openWork = docs.filter(
      (d) =>
        (d.metadata.type === 'pr' || d.metadata.type === 'issue') &&
        d.metadata.state === 'open' &&
        !d.metadata.merged
    );

    for (const item of openWork) {
      const updated = new Date(item.metadata.updated as string);
      const age = now.getTime() - updated.getTime();

      if (age < twoWeeks) continue;

      const daysStale = Math.floor(age / (24 * 60 * 60 * 1000));
      const title = (item.metadata.title as string) || 'Untitled';
      const source = item.metadata.source as string;

      // Check if there are similar open items (this one might be superseded)
      const similar = await this.memory.search(title, 3);
      const superseding = similar.filter(
        (s) =>
          s.id !== item.id &&
          s.metadata.state === 'open' &&
          new Date(s.metadata.updated as string) > updated &&
          s.score > 0.6
      );

      let severity: 'high' | 'medium' | 'low';
      let description: string;
      let estimatedHours: number;
      let action: string;

      if (superseding.length > 0) {
        severity = 'high';
        description = `Likely superseded by newer work: "${(superseding[0].metadata.title as string).slice(0, 50)}". This is probably dead work.`;
        estimatedHours = daysStale > 60 ? 1 : 0.5; // Just close it
        action = 'Close this — it appears to be superseded';
      } else if (age > oneMonth) {
        severity = 'high';
        description = `No activity for ${daysStale} days. Stale work creates mental overhead and blocks planning.`;
        estimatedHours = daysStale * 0.02; // 1-2 min/day of mental overhead
        action = 'Decide: close it, break into smaller pieces, or assign an owner';
      } else {
        severity = 'medium';
        description = `No activity for ${daysStale} days. Check if this is still relevant.`;
        estimatedHours = daysStale * 0.01;
        action = 'Check in with the assignee or close if no longer needed';
      }

      alerts.push({
        type: 'stalled',
        severity,
        title: `Stalled ${item.metadata.type}: "${title.slice(0, 60)}"`,
        description,
        sources: [source],
        items: [item.id],
        estimatedHours,
        estimatedDollars: estimatedHours * HOURLY_RATE,
        action,
      });
    }

    return alerts;
  }

  /**
   * Meeting-to-output correlation: Do meetings about topics
   * actually produce code/PRs? If not, they might be wasteful.
   */
  private async analyzeMeetingOutputCorrelation(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];
    const events = docs.filter((d) => d.metadata.type === 'event');
    const prs = docs.filter((d) => d.metadata.type === 'pr');
    const issues = docs.filter((d) => d.metadata.type === 'issue');

    if (events.length === 0) return alerts;

    const now = new Date();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const fourWeeksAgo = new Date(now.getTime() - weekMs * 4);

    // Group meetings by topic cluster (using title keywords)
    const topicMeetings = new Map<string, MemoryDocument[]>();

    for (const event of events) {
      const date = new Date(event.metadata.date as string);
      if (date < fourWeeksAgo) continue;

      const title = ((event.metadata.title as string) || '').toLowerCase();

      // Extract topic keywords
      const keywords = this.extractTopicKeywords(title);
      if (keywords.length === 0) continue;

      const topicKey = keywords.sort().join('-');
      if (!topicMeetings.has(topicKey)) topicMeetings.set(topicKey, []);
      topicMeetings.get(topicKey)!.push(event);
    }

    // For each topic cluster, check if there was related output
    for (const [topic, meetings] of topicMeetings) {
      if (meetings.length < 3) continue; // Need recurring meetings to matter

      // Search for PRs/issues related to this topic
      const relatedWork = await this.memory.search(topic, 5);
      const recentWork = relatedWork.filter((w) => {
        if (w.metadata.type !== 'pr' && w.metadata.type !== 'issue') return false;
        const created = new Date(w.metadata.date as string);
        return created >= fourWeeksAgo;
      });

      // Calculate meeting hours
      const totalMinutes = meetings.length * 30; // Assume 30 min average
      const totalHours = totalMinutes / 60;

      if (recentWork.length === 0 && meetings.length >= 4) {
        // Meetings about this topic but NO output
        alerts.push({
          type: 'meeting-waste',
          severity: 'high',
          title: `${meetings.length} meetings about "${topic}" with zero output`,
          description: `You've spent ~${totalHours.toFixed(1)} hours in meetings about this topic in the last 4 weeks, but no PRs or issues were created. These meetings may be unproductive.`,
          sources: ['calendar'],
          items: meetings.map((m) => m.id),
          estimatedHours: totalHours * 0.5, // Could cut half
          estimatedDollars: totalHours * 0.5 * HOURLY_RATE,
          action: 'Review these meetings: can they be async updates or shorter?',
        });
      } else if (recentWork.length > 0 && meetings.length >= 4) {
        // Meetings with output — check ratio
        const ratio = totalHours / recentWork.length;
        if (ratio > 3) {
          alerts.push({
            type: 'meeting-waste',
            severity: 'medium',
            title: `High meeting-to-output ratio for "${topic}"`,
            description: `${totalHours.toFixed(1)} hours of meetings produced ${recentWork.length} work items (${ratio.toFixed(1)} hours per item). Could some meetings be shorter?`,
            sources: ['calendar'],
            items: meetings.map((m) => m.id),
            estimatedHours: totalHours * 0.25,
            estimatedDollars: totalHours * 0.25 * HOURLY_RATE,
            action: 'Try 25-minute meetings instead of 30, or make some async',
          });
        }
      }
    }

    // Check for meeting-heavy individuals (if attendee data exists)
    const meetingCount = events.filter((e) => {
      const date = new Date(e.metadata.date as string);
      return date >= fourWeeksAgo;
    }).length;

    if (meetingCount > 25) {
      const hoursInMeetings = meetingCount * 0.5; // 30 min average
      alerts.push({
        type: 'meeting-waste',
        severity: 'high',
        title: `${meetingCount} meetings in 4 weeks (${hoursInMeetings} hours)`,
        description: `The team is spending ${hoursInMeetings.toFixed(0)} hours/month in meetings. At ${hoursInMeetings} hours/month, that's ${(hoursInMeetings * 12).toFixed(0)} hours/year.`,
        sources: ['calendar'],
        items: events.slice(0, 5).map((e) => e.id),
        estimatedHours: hoursInMeetings * 0.3,
        estimatedDollars: hoursInMeetings * 0.3 * HOURLY_RATE,
        action: 'Audit recurring meetings: keep, shorten, or cancel',
      });
    }

    return alerts;
  }

  /**
   * Find orphaned work: items assigned but forgotten, or dependencies
   * that are blocked by closed/merged items.
   */
  private async findOrphanedWork(docs: MemoryDocument[]): Promise<SavingsAlert[]> {
    const alerts: SavingsAlert[] = [];

    const openIssues = docs.filter(
      (d) => d.metadata.type === 'issue' && d.metadata.state === 'open'
    );

    for (const issue of openIssues) {
      const text = issue.text.toLowerCase();
      const title = (issue.metadata.title as string) || '';

      // Check for signs of orphaned work
      const orphanSignals = [
        { pattern: /blocked by|#\d+|waiting for/i, weight: 2 },
        { pattern: /help wanted|good first issue/i, weight: 1 },
        { pattern: /needs? (more )?info|cannot reproduce/i, weight: 2 },
      ];

      let orphanScore = 0;
      for (const signal of orphanSignals) {
        if (signal.pattern.test(text)) orphanScore += signal.weight;
      }

      if (orphanScore >= 2) {
        // This issue has signals of being orphaned
        const updated = new Date(issue.metadata.updated as string);
        const daysSinceUpdate = Math.floor(
          (Date.now() - updated.getTime()) / (24 * 60 * 60 * 1000)
        );

        if (daysSinceUpdate > 7) {
          alerts.push({
            type: 'orphaned',
            severity: daysSinceUpdate > 21 ? 'high' : 'medium',
            title: `Potentially orphaned: "${title.slice(0, 60)}"`,
            description: `This issue shows signs of being blocked or abandoned (${daysSinceUpdate} days). It may be waiting on something that will never come.`,
            sources: [issue.metadata.source as string],
            items: [issue.id],
            estimatedHours: 0.5,
            estimatedDollars: 0.5 * HOURLY_RATE,
            action: 'Triage: unblock it, reassign, or close it',
          });
        }
      }
    }

    return alerts;
  }

  private extractTopicKeywords(title: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been',
      'will', 'your', 'what', 'when', 'where', 'how', 'why', 'who', 'which',
      'standup', 'sync', 'weekly', 'daily', 'retro', 'review', 'meeting',
      'call', 'check', 'status', 'update', 'team',
    ]);

    return title
      .split(/[\s-_,.]+/)
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 3); // Top 3 keywords
  }

  private async generateSummary(report: SavingsReport): Promise<string> {
    if (report.totalAlerts === 0) return '';

    try {
      const result = await this.reasoning.chat([
        {
          role: 'system',
          content: `You are a business efficiency analyst. Summarize these savings findings in 2-3 sentences.
Focus on: what's the #1 thing to fix, and how much time/money could be saved.
Be specific and actionable. Use dollar amounts.`,
        },
        {
          role: 'user',
          content: `Found ${report.totalAlerts} issues:
- ${report.highPriority} high priority
- Total estimated waste: ${report.totalEstimatedHours.toFixed(0)} hours (${report.totalEstimatedDollars.toFixed(0)} dollars)
- Top issues:
${report.alerts.slice(0, 3).map((a) => `  • ${a.title} (${a.estimatedHours}h)`).join('\n')}`,
        },
      ]);
      return result.content;
    } catch {
      return '';
    }
  }

  private formatReport(report: SavingsReport): string {
    if (report.totalAlerts === 0) {
      return 'No savings opportunities found. Your data looks clean!';
    }

    let output = '';
    output += `┌─────────────────────────────────────────────────────────\n`;
    output += `│  💰 SAVINGS REPORT\n`;
    output += `├─────────────────────────────────────────────────────────\n`;
    output += `│  ${report.totalAlerts} issues found · ${report.highPriority} high priority\n`;
    output += `│  Estimated waste: ${report.totalEstimatedHours.toFixed(0)} hours/month = $${report.totalEstimatedDollars.toFixed(0)}/month\n`;
    output += `├─────────────────────────────────────────────────────────\n\n`;

    for (let i = 0; i < report.alerts.length; i++) {
      const alert = report.alerts[i];
      const icon =
        alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🟢';
      const typeLabel = alert.type.replace('-', ' ').toUpperCase();

      output += `${icon} ${i + 1}. [${typeLabel}] ${alert.title}\n`;
      output += `   ${alert.description}\n`;
      output += `   💡 Action: ${alert.action}\n`;
      output += `   💵 Est. savings: ${alert.estimatedHours.toFixed(1)}h ($${alert.estimatedDollars.toFixed(0)})\n`;
      output += `   📂 Sources: ${alert.sources.join(', ')}\n\n`;
    }

    if (report.summary) {
      output += `├─────────────────────────────────────────────────────────\n`;
      output += `│  💡 SUMMARY\n`;
      output += `├─────────────────────────────────────────────────────────\n`;
      output += `${report.summary}\n`;
    }

    output += `\n└─────────────────────────────────────────────────────────\n`;

    return output;
  }
}
