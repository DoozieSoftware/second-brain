import { ReasoningEngine } from './reasoning.js';
import { Memory } from './memory.js';
import { Operator } from './operator.js';
import type { OperatorResponse } from './operator.js';
import { GitHubOperator } from '../operators/github-operator.js';
import { DocsOperator } from '../operators/docs-operator.js';
import { EmailOperator } from '../operators/email-operator.js';
import { CalendarOperator } from '../operators/calendar-operator.js';
import { SavingsScanner } from '../proactive/savings-scanner.js';

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

    // Build context from conversation history
    let context = `You have access to organizational memory from multiple sources: GitHub (repos, PRs, issues), documents, emails, and calendar events. Search across all of them to answer the question comprehensively. Connect related information across sources.`;

    // Add conversation history for follow-up context
    if (this.conversationHistory.length > 0) {
      const recentHistory = this.conversationHistory.slice(-6); // Last 3 exchanges
      context += `\n\nPrevious conversation:\n${recentHistory.map(h => `${h.role}: ${h.content.slice(0, 200)}`).join('\n')}`;
    }

    const result = await mainOperator.reason(question, context, verbose);

    // Store in conversation history
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: result.answer });

    // Keep history manageable
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

  async getStatus(): Promise<{ source: string; configured: boolean; docCount?: number }[]> {
    const docCount = this.memory.count;
    return [
      { source: 'github', configured: !!process.env.GITHUB_TOKEN },
      { source: 'docs', configured: true, docCount },
      { source: 'email', configured: !!(process.env.IMAP_USER && process.env.IMAP_PASSWORD) },
      { source: 'calendar', configured: !!process.env.GOOGLE_CALENDAR_API_KEY },
    ];
  }
}
