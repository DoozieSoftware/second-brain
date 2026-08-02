import { ReasoningEngine } from './reasoning.js';
import { Memory, type SearchResult } from './memory.js';
import { Operator } from './operator.js';
import type { OperatorResponse } from './operator.js';
import { SearchEngine } from './search.js';
import { ToolRegistry } from './tools.js';
import { UserModelManager } from './user-model.js';
import { SystemModelManager } from './system-model.js';
import { GitHubOperator } from '../operators/github-operator.js';
import { DocsOperator } from '../operators/docs-operator.js';
import { EmailOperator } from '../operators/email-operator.js';
import { CalendarOperator } from '../operators/calendar-operator.js';
import { GDriveOperator } from '../operators/gdrive-operator.js';
import { DropboxOperator } from '../operators/dropbox-operator.js';
import { EmailConfigStore } from './email-config-store.js';
import { ConnectorConfigStore } from './connector-config-store.js';
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
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { DecisionEngine } from '../decisions/decision-engine.js';
import type { DecisionImpact } from '../decisions/decision-engine.js';
import { connectorRegistry, registerAllConnectors } from '../integrations/index.js';
import { AnalyticsEngine } from '../analytics/analytics-engine.js';
import type { AnalyticsSnapshot } from '../analytics/analytics-engine.js';
import { metricsCollector } from './metrics.js';
import { DreamEngine, type DreamReport } from '../dreaming/dream-engine.js';
import { CrossSourceLinker } from './linker.js';

export class SupervisorOperator {
  private reasoning: ReasoningEngine;
  private memory: Memory;
  private searchEngine: SearchEngine;
  private linker: CrossSourceLinker;
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

  // CTO Command Center engines
  private strategy: StrategyEngine;
  private decisions: DecisionEngine;
  private analytics: AnalyticsEngine;
  private dreamEngine: DreamEngine;

  constructor() {
    this.reasoning = new ReasoningEngine();
    this.memory = new Memory();
    this.searchEngine = new SearchEngine(this.memory);
    this.linker = new CrossSourceLinker(this.searchEngine);
    this.savingsScanner = new SavingsScanner(this.reasoning, this.memory);

    // Initialize learning components
    this.userModel = new UserModelManager();
    this.systemModel = new SystemModelManager();
    this.extractionEngine = new ExtractionEngine(this.reasoning, this.memory, this.userModel);
    this.questionGenerator = new QuestionGenerator(this.userModel, this.systemModel, this.reasoning);
    this.profileUpdater = new ProfileUpdater(this.userModel, this.systemModel, this.memory);
    this.metaLearning = new MetaLearningEngine(this.systemModel, this.memory);

    // CTO Command Center engines
    this.strategy = new StrategyEngine();
    this.decisions = new DecisionEngine(this.searchEngine);
    this.analytics = new AnalyticsEngine();
    this.dreamEngine = new DreamEngine(this.memory, this.searchEngine, this.linker);

    // Integration framework — registers GitLab/Jira/Linear/Slack/Discord/
    // Notion/Confluence/CRM/Workspace/Internal adapters.
    registerAllConnectors(connectorRegistry);

    // Initialize all operators
    this.operators.set('github', new GitHubOperator(this.reasoning, this.memory));
    this.operators.set('docs', new DocsOperator(this.reasoning, this.memory));
    this.operators.set('email', new EmailOperator(this.reasoning, this.memory));
    this.operators.set('calendar', new CalendarOperator(this.reasoning, this.memory));
    this.operators.set('gdrive', new GDriveOperator(this.reasoning, this.memory));
    this.operators.set('dropbox', new DropboxOperator(this.reasoning, this.memory));
  }

  async ask(question: string, verbose = false): Promise<OperatorResponse> {
    const tools = new ToolRegistry();
    this.registerStrategyTools(tools);
    this.registerDecisionTools(tools);
    const mainOperator = new Operator('supervisor', this.reasoning, this.memory, tools, this.searchEngine);

    let context = `You have access to organizational memory from multiple sources: GitHub (repos, PRs, issues), documents, emails, calendar events, Google Drive files, Dropbox documents, and imported chats (WhatsApp). Search across all of them to answer the question comprehensively. Connect related information across sources.

You also have access to the CTO Command Center: strategic goals/initiatives/roadmaps (get_strategy_overview) and a recorded decision log with impact analysis (get_decision_log, get_decision_impact). Use these when the question is about strategy, planning, or the history of technical decisions.`;

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

      // Fall through to the integration framework for sources not registered
      // as legacy operators (gitlab, jira, linear, slack, ...).
      if (!op && connectorRegistry.has(sourceName)) {
        try {
          const result = await this.syncIntegration(sourceName);
          results.push({ source: result.name, count: result.count });
        } catch (error) {
          console.error(`Sync failed for ${sourceName}:`, error);
          results.push({ source: sourceName, count: 0 });
        }
        continue;
      }

      if (!op) {
        console.warn(`Unknown source: ${sourceName}`);
        continue;
      }

      try {
        const count = await (op as any).sync();
        results.push({ source: sourceName, count });

        // Get documents that were just synced for extraction.
        // getAll(limit) returns the head of the docs array (oldest), so a
        // sync that ingests 50 new docs at the tail would otherwise pick up
        // 50 unrelated old docs. Use getRecent() to grab the just-synced
        // docs at the tail.
        if (count > 0) {
          const recent = await this.memory.getRecent(count);
          const newDocs = recent.filter(d => (d.metadata.source as string) === sourceName);
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

  /** Sync a source registered in the integration framework into memory. */
  async syncIntegration(name: string, options?: { since?: string; limit?: number }): Promise<{ name: string; count: number; configured: boolean }> {
    return connectorRegistry.sync(name, async docs => {
      const count = await this.memory.ingest(docs);
      return count;
    }, options);
  }

  /** Status of all integration-framework sources. */
  getIntegrationStatus() {
    return connectorRegistry.statuses();
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
      { source: 'email', configured: !!(process.env.IMAP_USER || process.env.EMAIL_ACCOUNTS || new EmailConfigStore().getAll().length > 0) },
      { source: 'calendar', configured: !!process.env.GOOGLE_CALENDAR_API_KEY },
      { source: 'gdrive', configured: !!(process.env.GDRIVE_SERVICE_ACCOUNT_KEY || process.env.GDRIVE_CLIENT_ID || new ConnectorConfigStore().getGDrive()) },
      { source: 'dropbox', configured: !!(process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_APP_KEY || new ConnectorConfigStore().getDropbox()) },
    ];
  }

  // ========== Strategy Methods ==========

  getStrategy(): StrategyEngine {
    return this.strategy;
  }

  // ========== Decision Methods ==========

  getDecisions(): DecisionEngine {
    return this.decisions;
  }

  async analyzeDecisionImpact(id: string): Promise<DecisionImpact> {
    return this.decisions.analyzeImpact(id);
  }

  // ========== Analytics Methods ==========

  async generateAnalytics(): Promise<AnalyticsSnapshot> {
    return this.analytics.generate({
      metrics: {
        summary: metricsCollector.getMetrics(),
        health: metricsCollector.getHealthStatus(),
        queries: metricsCollector.getQueries(),
        errors: metricsCollector.getErrors(),
      },
      memory: this.memory,
      decisionCount: this.decisions.list().length,
      goalCount: this.strategy.listGoals().length,
    });
  }

  getAnalyticsSnapshots(): AnalyticsSnapshot[] {
    return this.analytics.listSnapshots();
  }

  getAnalyticsDiff() {
    return this.analytics.diffLatest();
  }

  // ========== Dreaming (offline memory consolidation) ==========

  /** Run one consolidation cycle. Pass query metrics so gap detection has
   *  signal from real usage. */
  async dream(): Promise<DreamReport> {
    const report = await this.dreamEngine.dream({
      queries: metricsCollector.getQueries(),
    });
    metricsCollector.recordDream();
    console.log(`💤 Dream complete: deduped ${report.deduplicated.total}, mined ${report.associations.newLinks} new links, found ${report.gaps.length} gaps.`);
    return report;
  }

  // ========== Knowledge Methods (tagging & versioning) ==========

  getMemory(): Memory {
    return this.memory;
  }

  async search(query: string, topK = 10): Promise<SearchResult[]> {
    return this.searchEngine.search(query, { topK });
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

  // ========== Strategy / Decision Tools ==========

  private registerStrategyTools(tools: ToolRegistry): void {
    tools.register({
      name: 'get_strategy_overview',
      description: 'Get the current strategic overview: goals, initiatives, their status/progress, and at-risk work. Use for roadmap, planning, and strategy questions.',
      parameters: { type: 'object', properties: { quarter: { type: 'string', description: 'Optional quarter filter, e.g. "2026-Q3"' } } },
      handler: async (args) => {
        const quarter = args.quarter as string | undefined;
        const view = this.strategy.quarterlyView(quarter);
        if (view.length === 0) return 'No strategic goals recorded yet.';
        return view.map(v => {
          const lines = [
            `GOAL: ${v.goal.title} [${v.goal.status}] progress ${v.progress}% (quarter ${v.goal.quarter})`,
          ];
          for (const item of v.initiatives) {
            lines.push(`  • ${item.initiative.title} [${item.initiative.status}] prio=${item.initiative.priority} progress ${item.progress}%`);
            for (const m of item.milestones) {
              lines.push(`    - ${m.title} [${m.status}]${m.dueDate ? ` due ${m.dueDate}` : ''}`);
            }
          }
          return lines.join('\n');
        }).join('\n---\n');
      },
    });
  }

  private registerDecisionTools(tools: ToolRegistry): void {
    tools.register({
      name: 'get_decision_log',
      description: 'Search the recorded decision log (ADRs). Use to find past technical/architectural decisions, their rationale, and options considered.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Keyword to search decisions by, e.g. "database"' } } },
      handler: async (args) => {
        const query = (args.query as string) || '';
        const records = query ? this.decisions.searchByKeyword(query) : this.decisions.list();
        if (records.length === 0) return 'No decisions recorded yet.';
        return records.slice(0, 8).map(r => {
          return `ADR ${r.title}\n  status: ${r.status} | decided: ${r.decidedAt ?? 'n/a'}\n  decision: ${r.decision}\n  rationale: ${r.rationale}\n  owners: ${r.owners.join(', ') || 'n/a'}`;
        }).join('\n---\n');
      },
    });

    tools.register({
      name: 'get_decision_impact',
      description: 'Analyze the impact of a recorded decision: what documents reference it and what follow-up decisions build on it. Use when asked about consequences of past decisions.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'The decision id (adr_...) or keyword to find it first' } }, required: ['id'] },
      handler: async (args) => {
        const id = args.id as string;
        let decisionId = id;
        if (!id.startsWith('adr_')) {
          const matches = this.decisions.searchByKeyword(id);
          if (matches.length === 0) return `No decision found for "${id}".`;
          decisionId = matches[0].id;
        }
        try {
          const impact = await this.decisions.analyzeImpact(decisionId);
          const lines = [impact.summary];
          if (impact.relatedDocs.length > 0) {
            lines.push('Related documents:');
            for (const d of impact.relatedDocs.slice(0, 5)) {
              lines.push(`  • [${d.source}/${d.type}] ${d.excerpt.slice(0, 120)}`);
            }
          }
          if (impact.chainedDecisions.length > 0) {
            lines.push('Follow-up decisions:');
            for (const c of impact.chainedDecisions.slice(0, 5)) {
              lines.push(`  • ${c.title} [${c.status}]`);
            }
          }
          return lines.join('\n');
        } catch (error) {
          return `Error analyzing decision: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      },
    });
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
