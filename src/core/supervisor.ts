import { ReasoningEngine } from './reasoning.js';
import { Memory } from './memory.js';
import { Operator } from './operator.js';
import type { OperatorResponse } from './operator.js';
import { UserModelManager } from './user-model.js';
import { SystemModelManager } from './system-model.js';
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
import { ExtractionEngine } from '../learning/extraction-engine.js';
import { QuestionGenerator } from '../learning/question-generator.js';
import type { Question, AnswerAnalysis } from '../learning/question-generator.js';
import { ProfileUpdater } from '../learning/profile-updater.js';
import { MetaLearningEngine } from '../learning/meta-learning.js';
import type { AnalysisReport } from '../learning/meta-learning.js';

export class SupervisorOperator {
  private reasoning: ReasoningEngine;
  private memory: Memory;
  private operators: Map<string, Operator> = new Map();
  private savingsScanner: SavingsScanner;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  // Learning components
  private userModel: UserModelManager;
  private systemModel: SystemModelManager;
  private extractionEngine: ExtractionEngine;
  private questionGenerator: QuestionGenerator;
  private profileUpdater: ProfileUpdater;
  private metaLearning: MetaLearningEngine;

  constructor() {
    this.reasoning = new ReasoningEngine();
    this.memory = new Memory();
    this.savingsScanner = new SavingsScanner(this.reasoning, this.memory);

    // Initialize learning components
    this.userModel = new UserModelManager();
    this.systemModel = new SystemModelManager();
    this.extractionEngine = new ExtractionEngine(this.reasoning, this.memory, this.userModel);
    this.questionGenerator = new QuestionGenerator(this.userModel, this.systemModel, this.reasoning);
    this.profileUpdater = new ProfileUpdater(this.userModel, this.systemModel, this.memory);
    this.metaLearning = new MetaLearningEngine(this.systemModel, this.memory);

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

    // Get user context for this question
    const userContext = this.userModel.getContextForQuestion(question);

    const result = await mainOperator.reason(question, context, userContext, verbose);

    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content: result.answer });

    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    // Meta-learning: observe the query
    const domain = this.detectDomain(question);
    await this.metaLearning.observeQuery(
      question,
      domain,
      result,
      result.steps,
      result.searchCount,
      result.successfulSearches
    );

    // Check if user followed up (implicit feedback)
    if (this.conversationHistory.length >= 4) {
      const prevUser = this.conversationHistory[this.conversationHistory.length - 4];
      if (prevUser && prevUser.role === 'user') {
        // This is a follow-up
        await this.profileUpdater.processImplicitSignal(
          prevUser.content,
          result.confidence,
          true, // user followed up
          this.countRecentFollowUps()
        );
      }
    }

    return result;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  async sync(sources?: string[]): Promise<{ source: string; count: number }[]> {
    const results: { source: string; count: number }[] = [];
    const toSync = sources || Array.from(this.operators.keys());
    const allNewDocs: any[] = [];

    for (const sourceName of toSync) {
      const op = this.operators.get(sourceName);
      if (!op) {
        console.warn(`Unknown source: ${sourceName}`);
        continue;
      }

      try {
        const count = await (op as any).sync();
        results.push({ source: sourceName, count });

        // Get documents that were just synced for extraction
        if (count > 0) {
          const docs = await this.memory.getAll(count);
          const newDocs = docs.filter(d => (d.metadata.source as string) === sourceName);
          allNewDocs.push(...newDocs);
        }
      } catch (error) {
        console.error(`Sync failed for ${sourceName}:`, error);
        results.push({ source: sourceName, count: 0 });
      }
    }

    // Extract reasoning patterns from new documents
    if (allNewDocs.length > 0) {
      console.log('\n🔍 Extracting decision patterns from new data...');
      const extraction = await this.extractionEngine.extractFromDocuments(allNewDocs);
      if (extraction.extracted > 0) {
        console.log(`   Found ${extraction.extracted} decision signals`);
        this.systemModel.logEvolution(
          `Extracted ${extraction.extracted} decision patterns from sync`,
          `Sync processed ${extraction.processed} documents`,
          `User model updated with new reasoning patterns`
        );
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

  // ========== Learning Methods ==========

  async getDailyQuestions(count: number = 5): Promise<Question[]> {
    return this.questionGenerator.generateDailyQuestions(count);
  }

  async submitAnswer(questionId: string, answer: string): Promise<AnswerAnalysis> {
    const analysis = await this.questionGenerator.processAnswer(questionId, answer);

    // Check for evolution opportunities
    const analysisReport = await this.metaLearning.analyzePerformanceWindow(1);
    if (analysisReport.improvements.length > 0) {
      console.log('\n🧠 System is learning from your answer...');
    }

    return analysis;
  }

  async giveFeedback(query: string, feedback: 'good' | 'partial' | 'bad', correction?: string): Promise<void> {
    await this.profileUpdater.processDirectFeedback(query, feedback, correction);
    await this.metaLearning.observeFeedback({
      type: 'explicit',
      quality: feedback,
      correction,
      query,
      answerConfidence: 0.5,
      timestamp: new Date().toISOString(),
    });
  }

  getProfile(): string {
    return this.userModel.getProfileSummary();
  }

  getEvolution(): string {
    return this.systemModel.getEvolutionReport();
  }

  async getAnalysis(windowDays: number = 7): Promise<AnalysisReport> {
    return this.metaLearning.analyzePerformanceWindow(windowDays);
  }

  // ========== Internal Helpers ==========

  private detectDomain(question: string): string {
    const questionLower = question.toLowerCase();
    const domainKeywords: Record<string, string[]> = {
      github: ['github', 'pr', 'pull request', 'repo', 'commit', 'code', 'merge', 'branch'],
      docs: ['document', 'doc', 'readme', 'wiki', 'design doc', 'rfc'],
      email: ['email', 'inbox', 'message', 'thread', 'sender'],
      calendar: ['meeting', 'calendar', 'event', 'schedule', 'standup', 'call'],
      hiring: ['hire', 'candidate', 'interview', 'recruit', 'job', 'resume'],
      architecture: ['architecture', 'design', 'system', 'scale', 'infrastructure'],
      product: ['feature', 'product', 'priorit', 'roadmap', 'ship'],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(kw => questionLower.includes(kw))) {
        return domain;
      }
    }
    return 'general';
  }

  private countRecentFollowUps(): number {
    let count = 0;
    for (let i = this.conversationHistory.length - 1; i >= 0; i -= 2) {
      if (this.conversationHistory[i]?.role === 'assistant') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }
}
