import { UserModelManager, type Gap } from '../core/user-model.js';
import { SystemModelManager } from '../core/system-model.js';
import { ReasoningEngine } from '../core/reasoning.js';

export interface Question {
  id: string;
  type: 'scenario' | 'tradeoff' | 'preference' | 'validation' | 'style';
  domain: string;
  question: string;
  options?: string[];  // For multiple choice
  generatedAt: string;
  answered: boolean;
  answer?: string;
  answeredAt?: string;
}

export interface AnswerAnalysis {
  extractedValues: string[];
  extractedWeights: Record<string, number>;
  confidence: number;
  reasoning: string;
}

const QUESTION_TEMPLATES: Record<string, Array<{ type: Question['type']; template: string }>> = {
  hiring: [
    { type: 'scenario', template: 'Two candidates for a senior role: Candidate A has 10 years at FAANG companies with strong system design skills. Candidate B has 5 years at startups with full-stack ownership and shipped products end-to-end. All else equal, who would you lean toward and why?' },
    { type: 'tradeoff', template: 'In hiring, what matters more to you: deep expertise in one area, or broad skills across the stack?' },
    { type: 'preference', template: 'Rate these factors in hiring (1-5): Technical depth, Communication skills, Culture fit, Speed of learning, Past shipping experience' },
  ],
  architecture: [
    { type: 'scenario', template: 'You need to add real-time notifications. Option A: Simple polling (quick to build, higher server cost). Option B: WebSockets (complex setup, efficient). Which do you choose and why?' },
    { type: 'tradeoff', template: 'When choosing between a well-known technology and a newer one with better DX but smaller community, what do you typically prefer?' },
    { type: 'preference', template: 'Rate these architecture values (1-5): Simplicity, Scalability, Performance, Maintainability, Speed of development' },
  ],
  product_prioritization: [
    { type: 'scenario', template: 'You can either: A) Ship a requested feature that 3 big customers want, or B) Refactor tech debt that slows the whole team. How do you think about this tradeoff?' },
    { type: 'tradeoff', template: 'Do you tend to prioritize user-requested features or your own product vision?' },
  ],
  conflict_resolution: [
    { type: 'scenario', template: 'Two senior engineers disagree on an architecture approach. Both have valid points. How would you typically handle this?' },
    { type: 'preference', template: 'Rate these approaches (1-5): Let data decide, Let the most experienced decide, Discuss until consensus, Make a call and move on' },
  ],
  budget_decisions: [
    { type: 'scenario', template: 'You have budget for one: A) A senior hire who\'s expensive but experienced, or B) Two junior hires who need mentorship but cost the same total. What factors do you weigh?' },
    { type: 'tradeoff', template: 'When spending on tools/services, do you lean toward "best available" or "good enough and cheap"?' },
  ],
};

export class QuestionGenerator {
  private userModel: UserModelManager;
  private systemModel: SystemModelManager;
  private history: Question[] = [];
  private reasoning: ReasoningEngine;

  constructor(userModel: UserModelManager, systemModel: SystemModelManager, reasoning: ReasoningEngine) {
    this.userModel = userModel;
    this.systemModel = systemModel;
    this.reasoning = reasoning;
  }

  async generateDailyQuestions(count: number = 5): Promise<Question[]> {
    const gaps = this.userModel.getGapsByPriority();
    const weakDomains = this.systemModel.getWeakDomains();

    // Combine gaps and weak domains, prioritize gaps
    const domainsToQuery = new Set<string>();
    for (const gap of gaps) {
      domainsToQuery.add(gap.domain);
      if (domainsToQuery.size >= count) break;
    }
    // Add weak domains if we have room
    for (const domain of weakDomains) {
      if (domainsToQuery.size >= count) break;
      domainsToQuery.add(domain);
    }

    // If we still need more, add from known domains
    if (domainsToQuery.size < count) {
      const allDomains = Object.keys(QUESTION_TEMPLATES);
      for (const domain of allDomains) {
        if (domainsToQuery.size >= count) break;
        domainsToQuery.add(domain);
      }
    }

    const questions: Question[] = [];
    let questionIndex = 0;

    for (const domain of domainsToQuery) {
      if (questions.length >= count) break;

      const templates = QUESTION_TEMPLATES[domain] || QUESTION_TEMPLATES['architecture'];
      const templateIndex = questionIndex % templates.length;
      const template = templates[templateIndex];

      const question: Question = {
        id: `q-${Date.now()}-${questionIndex}`,
        type: template.type,
        domain,
        question: template.template,
        generatedAt: new Date().toISOString(),
        answered: false,
      };

      questions.push(question);
      this.history.push(question);
      questionIndex++;
    }

    return questions;
  }

  async processAnswer(questionId: string, answer: string): Promise<AnswerAnalysis> {
    const question = this.history.find(q => q.id === questionId);
    if (!question) {
      throw new Error(`Question ${questionId} not found`);
    }

    question.answered = true;
    question.answer = answer;
    question.answeredAt = new Date().toISOString();

    // Use LLM to analyze the answer
    const analysis = await this.analyzeAnswer(question, answer);

    // Update user model based on analysis
    this.applyAnalysisToModel(question, analysis);

    return analysis;
  }

  private async analyzeAnswer(question: Question, answer: string): Promise<AnswerAnalysis> {
    const prompt = `Analyze this answer to a question about decision-making and extract the user's values, preferences, and weights.

Question (${question.type} in ${question.domain}):
${question.question}

User's Answer:
${answer}

Extract:
1. What values does this answer demonstrate? (e.g., speed, quality, simplicity, ownership, collaboration)
2. What weights does this suggest for different factors? (0.0 to 1.0)
3. How confident should we be in this extraction? (0.0 to 1.0)
4. What reasoning pattern does this demonstrate?

Respond with this exact JSON format:
{
  "extractedValues": ["value1", "value2"],
  "extractedWeights": {"factor1": 0.8, "factor2": 0.3},
  "confidence": 0.7,
  "reasoning": "brief explanation of what was extracted"
}`;

    try {
      const result = await this.reasoning.chat(
        [
          { role: 'system', content: 'You analyze decision-making answers to extract values and patterns. Be precise and conservative.' },
          { role: 'user', content: prompt },
        ],
        [],
        { temperature: 0.2, maxTokens: 500 }
      );

      const jsonMatch = result.content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.warn('Answer analysis failed:', error);
    }

    // Fallback analysis
    return {
      extractedValues: [],
      extractedWeights: {},
      confidence: 0.3,
      reasoning: 'Analysis failed, using conservative defaults',
    };
  }

  private applyAnalysisToModel(question: Question, analysis: AnswerAnalysis): void {
    // Update dimensions based on extracted values
    const valueToDimension: Record<string, { category: 'dimensions' | 'communication'; name: string; value: number }> = {
      'speed': { category: 'dimensions', name: 'speed_vs_thoroughness', value: 0.8 },
      'simplicity': { category: 'dimensions', name: 'speed_vs_thoroughness', value: 0.7 },
      'quality': { category: 'dimensions', name: 'detail_orientation', value: 0.8 },
      'thoroughness': { category: 'dimensions', name: 'detail_orientation', value: 0.8 },
      'ownership': { category: 'dimensions', name: 'delegation_comfort', value: 0.3 },
      'collaboration': { category: 'dimensions', name: 'collaboration_preference', value: 0.8 },
      'directness': { category: 'communication', name: 'directness', value: 0.9 },
      'risk-taking': { category: 'dimensions', name: 'risk_tolerance', value: 0.8 },
      'caution': { category: 'dimensions', name: 'risk_tolerance', value: 0.3 },
      'detail': { category: 'dimensions', name: 'detail_orientation', value: 0.8 },
    };

    for (const value of analysis.extractedValues) {
      const dim = valueToDimension[value.toLowerCase()];
      if (dim) {
        this.userModel.updateDimension(dim.category, dim.name, dim.value, 'active_question');
      }
    }

    // Update domain weights
    if (Object.keys(analysis.extractedWeights).length > 0) {
      this.userModel.updateDomainWeights(question.domain, analysis.extractedWeights);
    }

    // Update gap confidence
    const gap = this.userModel.getGapsByPriority().find(g => g.domain === question.domain);
    if (gap) {
      const newConfidence = Math.min(1.0, gap.confidence + 0.2 * analysis.confidence);
      this.userModel.updateGap(question.domain, newConfidence);
    }

    // Record to system model
    this.systemModel.recordQuery(
      question.domain,
      analysis.confidence,
      1, // single loop for question processing
      1, // one "search" (the question)
      analysis.extractedValues.length > 0 ? 1 : 0, // success if we extracted values
      false // not a fallback
    );
  }

  getQuestionHistory(): Question[] {
    return this.history;
  }

  getUnansweredQuestions(): Question[] {
    return this.history.filter(q => !q.answered);
  }
}
