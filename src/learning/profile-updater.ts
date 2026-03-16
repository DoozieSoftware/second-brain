import { UserModelManager } from '../core/user-model.js';
import { SystemModelManager } from '../core/system-model.js';
import { Memory, type MemoryDocument } from '../core/memory.js';

export interface FeedbackSignal {
  type: 'explicit' | 'implicit';
  quality: 'good' | 'partial' | 'bad';
  correction?: string;
  query: string;
  answerConfidence: number;
  timestamp: string;
}

export class ProfileUpdater {
  private userModel: UserModelManager;
  private systemModel: SystemModelManager;
  private memory: Memory;
  private feedbackHistory: FeedbackSignal[] = [];

  constructor(userModel: UserModelManager, systemModel: SystemModelManager, memory: Memory) {
    this.userModel = userModel;
    this.systemModel = systemModel;
    this.memory = memory;
  }

  async processDirectFeedback(
    query: string,
    feedback: 'good' | 'partial' | 'bad',
    correction?: string
  ): Promise<void> {
    const signal: FeedbackSignal = {
      type: 'explicit',
      quality: feedback,
      correction,
      query,
      answerConfidence: 0.5, // We don't have the original confidence here
      timestamp: new Date().toISOString(),
    };

    this.feedbackHistory.push(signal);

    // Record in system model
    const domain = this.detectDomain(query);
    const isFallback = feedback === 'bad';
    this.systemModel.recordQuery(domain, feedback === 'good' ? 0.8 : feedback === 'partial' ? 0.5 : 0.2, 1, 1, feedback !== 'bad' ? 1 : 0, isFallback);

    // If there's a correction, extract it as a reasoning document
    if (correction) {
      await this.storeCorrection(query, correction, domain);
    }

    // Adjust confidence based on feedback
    this.adjustConfidenceFromFeedback(feedback, domain);

    // Check for improvement opportunities
    this.checkForImprovement(signal, domain);
  }

  async processImplicitSignal(
    query: string,
    answerConfidence: number,
    userFollowedUp: boolean,
    followUpCount: number = 0
  ): Promise<void> {
    const signal: FeedbackSignal = {
      type: 'implicit',
      quality: userFollowedUp ? 'partial' : 'good', // Follow-up suggests answer wasn't complete
      query,
      answerConfidence,
      timestamp: new Date().toISOString(),
    };

    this.feedbackHistory.push(signal);

    const domain = this.detectDomain(query);

    // A follow-up with high answer confidence suggests the answer was useful but incomplete
    // A follow-up with low answer confidence suggests the answer was off-target
    const quality = userFollowedUp
      ? (answerConfidence > 0.6 ? 'partial' : 'bad')
      : 'good';

    this.systemModel.recordQuery(
      domain,
      quality === 'good' ? answerConfidence : answerConfidence * 0.5,
      1,
      1,
      quality !== 'bad' ? 1 : 0,
      quality === 'bad'
    );

    // Log pattern if we see repeated follow-ups
    if (followUpCount > 2) {
      this.systemModel.addLearnedPattern({
        type: 'reasoning_improvement',
        domain,
        pattern: `Questions about ${domain} often need follow-ups`,
        success_rate: 0.3,
        adopted: true,
        improvement: 0.1,
      });
      this.systemModel.logEvolution(
        `Detected ${domain} needs deeper initial search`,
        `${followUpCount} follow-ups in a row`,
        'Added multi-angle search strategy'
      );
    }
  }

  async calibrateConfidence(
    query: string,
    predictedConfidence: number,
    actualQuality: number
  ): Promise<void> {
    const domain = this.detectDomain(query);

    // If we predicted high confidence but quality was low, we're overconfident
    // If we predicted low confidence but quality was high, we're underconfident
    const calibrationError = Math.abs(predictedConfidence - actualQuality);

    if (calibrationError > 0.3) {
      // Significant miscalibration
      this.systemModel.addLearnedPattern({
        type: 'reasoning_improvement',
        domain,
        pattern: predictedConfidence > actualQuality
          ? `Overconfident in ${domain} - reduce confidence estimation`
          : `Underconfident in ${domain} - increase confidence estimation`,
        success_rate: 1 - calibrationError,
        adopted: true,
        improvement: 0.05,
      });
    }
  }

  private async storeCorrection(query: string, correction: string, domain: string): Promise<void> {
    const doc: MemoryDocument = {
      id: `correction:${Date.now()}`,
      text: `Original question: ${query}\nUser correction: ${correction}\n\nThis correction shows how the user would actually respond in this situation.`,
      metadata: {
        type: 'user-reasoning',
        domain,
        source: 'user_correction',
        date: new Date().toISOString(),
      },
    };

    await this.memory.store(doc);

    // Add as domain example
    this.userModel.addDomainExample(domain, doc.id);
  }

  private adjustConfidenceFromFeedback(feedback: 'good' | 'partial' | 'bad', domain: string): void {
    // Update the gap confidence based on feedback
    const gap = this.userModel.getGapsByPriority().find(g => g.domain === domain);
    if (gap) {
      const adjustment = feedback === 'good' ? 0.1 : feedback === 'partial' ? 0.05 : -0.1;
      const newConfidence = Math.max(0, Math.min(1, gap.confidence + adjustment));
      this.userModel.updateGap(domain, newConfidence);
    }
  }

  private checkForImprovement(signal: FeedbackSignal, domain: string): void {
    // Count recent bad feedback in this domain
    const recentBadCount = this.feedbackHistory
      .filter(f => f.type === 'explicit' && f.quality === 'bad')
      .slice(-10)
      .length;

    if (recentBadCount >= 3) {
      this.systemModel.addLearnedPattern({
        type: 'reasoning_improvement',
        domain,
        pattern: `Multiple bad feedback on ${domain} - needs strategy review`,
        success_rate: 0.0,
        adopted: true,
        improvement: 0,
      });
      this.systemModel.logEvolution(
        `${domain} flagged for poor performance`,
        `${recentBadCount} bad feedback signals`,
        'Added to weak domains for focused learning'
      );
    }
  }

  private detectDomain(query: string): string {
    const queryLower = query.toLowerCase();
    const domainKeywords: Record<string, string[]> = {
      hiring: ['hire', 'candidate', 'interview', 'recruit', 'job', 'resume', 'employee'],
      architecture: ['architecture', 'design', 'system', 'scale', 'infrastructure', 'tech stack'],
      product_prioritization: ['feature', 'product', 'priorit', 'roadmap', 'ship', 'launch'],
      code_review: ['review', 'pr', 'pull request', 'merge', 'code quality'],
      conflict_resolution: ['conflict', 'disagree', 'resolution', 'dispute', 'debate'],
      budget_decisions: ['budget', 'cost', 'spend', 'hire', 'expensive', 'cheap'],
    };

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        return domain;
      }
    }

    return 'general';
  }

  getFeedbackHistory(): FeedbackSignal[] {
    return this.feedbackHistory;
  }

  getRecentFeedbackStats(): { good: number; partial: number; bad: number; total: number } {
    const recent = this.feedbackHistory.slice(-20);
    return {
      good: recent.filter(f => f.quality === 'good').length,
      partial: recent.filter(f => f.quality === 'partial').length,
      bad: recent.filter(f => f.quality === 'bad').length,
      total: recent.length,
    };
  }
}
