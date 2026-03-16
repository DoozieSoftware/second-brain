import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = './data';
const USER_MODEL_FILE = 'user-model.json';

export interface UserDimension {
  value: number;      // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0 - how sure we are
  samples: number;    // how many data points contributed
}

export interface DecisionDomain {
  weights: Record<string, number>;
  confidence: number;
  examples: string[];   // IDs of reasoning corpus documents
}

export interface Gap {
  domain: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
}

export interface UserModel {
  version: number;
  last_updated: string;
  dimensions: {
    risk_tolerance: UserDimension;
    speed_vs_thoroughness: UserDimension;
    delegation_comfort: UserDimension;
    collaboration_preference: UserDimension;
    detail_orientation: UserDimension;
  };
  decision_domains: Record<string, DecisionDomain>;
  values: string[];
  communication: {
    verbosity: UserDimension;
    formality: UserDimension;
    directness: UserDimension;
  };
  gaps: Gap[];
}

function createDefaultDimension(): UserDimension {
  return { value: 0.5, confidence: 0.0, samples: 0 };
}

function createDefaultModel(): UserModel {
  return {
    version: 1,
    last_updated: new Date().toISOString(),
    dimensions: {
      risk_tolerance: createDefaultDimension(),
      speed_vs_thoroughness: createDefaultDimension(),
      delegation_comfort: createDefaultDimension(),
      collaboration_preference: createDefaultDimension(),
      detail_orientation: createDefaultDimension(),
    },
    decision_domains: {},
    values: [],
    communication: {
      verbosity: createDefaultDimension(),
      formality: createDefaultDimension(),
      directness: createDefaultDimension(),
    },
    gaps: [
      { domain: 'hiring', confidence: 0.0, priority: 'high' },
      { domain: 'architecture', confidence: 0.0, priority: 'high' },
      { domain: 'product_prioritization', confidence: 0.0, priority: 'high' },
      { domain: 'conflict_resolution', confidence: 0.0, priority: 'medium' },
      { domain: 'budget_decisions', confidence: 0.0, priority: 'medium' },
    ],
  };
}

export class UserModelManager {
  private model: UserModel;
  private dataPath: string;

  constructor() {
    this.dataPath = join(DATA_DIR, USER_MODEL_FILE);
    this.model = this.load();
  }

  load(): UserModel {
    if (existsSync(this.dataPath)) {
      try {
        const raw = readFileSync(this.dataPath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        console.warn('User model file corrupted, creating new one');
      }
    }
    return createDefaultModel();
  }

  save(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    this.model.last_updated = new Date().toISOString();
    writeFileSync(this.dataPath, JSON.stringify(this.model, null, 2));
  }

  getModel(): UserModel {
    return this.model;
  }

  updateDimension(
    category: 'dimensions' | 'communication',
    name: string,
    newValue: number,
    source: string
  ): void {
    const dim = (this.model[category] as any)[name] as UserDimension;
    if (!dim) return;

    // Bayesian-style update: weight new evidence by existing confidence
    const newWeight = 1 / (1 + dim.samples);
    const oldWeight = 1 - newWeight;
    dim.value = oldWeight * dim.value + newWeight * newValue;
    dim.samples += 1;
    // Confidence increases with more consistent samples
    dim.confidence = Math.min(1.0, dim.confidence + 0.1);
  }

  setValues(values: string[]): void {
    this.model.values = values;
    this.save();
  }

  addDomainExample(domain: string, docId: string): void {
    if (!this.model.decision_domains[domain]) {
      this.model.decision_domains[domain] = {
        weights: {},
        confidence: 0.1,
        examples: [],
      };
    }
    const d = this.model.decision_domains[domain];
    if (!d.examples.includes(docId)) {
      d.examples.push(docId);
      d.confidence = Math.min(1.0, d.confidence + 0.05);
    }
  }

  updateDomainWeights(domain: string, weights: Record<string, number>): void {
    if (!this.model.decision_domains[domain]) {
      this.model.decision_domains[domain] = {
        weights: {},
        confidence: 0.1,
        examples: [],
      };
    }
    const d = this.model.decision_domains[domain];
    // Bayesian update for each weight
    for (const [key, value] of Object.entries(weights)) {
      if (d.weights[key] !== undefined) {
        const newWeight = 1 / (1 + Object.keys(d.weights).length);
        d.weights[key] = (1 - newWeight) * d.weights[key] + newWeight * value;
      } else {
        d.weights[key] = value;
      }
    }
    d.confidence = Math.min(1.0, d.confidence + 0.15);
  }

  getGapsByPriority(): Gap[] {
    return [...this.model.gaps].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  updateGap(domain: string, newConfidence: number): void {
    const gap = this.model.gaps.find(g => g.domain === domain);
    if (gap) {
      gap.confidence = newConfidence;
      // Remove gap if confidence is high enough
      if (gap.confidence >= 0.8) {
        this.model.gaps = this.model.gaps.filter(g => g.domain !== domain);
      }
    } else if (newConfidence < 0.8) {
      // Add new gap if domain has low confidence
      this.model.gaps.push({ domain, confidence: newConfidence, priority: 'medium' });
    }
  }

  getContextForQuestion(question: string): string {
    const sections: string[] = [];

    // Add dimension summaries
    sections.push('## User Decision Profile');
    for (const [name, dim] of Object.entries(this.model.dimensions)) {
      if (dim.confidence > 0.2) {
        const label = name.replace(/_/g, ' ');
        const level = dim.value > 0.7 ? 'high' : dim.value > 0.3 ? 'moderate' : 'low';
        sections.push(`- ${label}: ${level} (${(dim.confidence * 100).toFixed(0)}% confident)`);
      }
    }

    // Add values
    if (this.model.values.length > 0) {
      sections.push(`\n## Core Values\n- ${this.model.values.join(', ')}`);
    }

    // Add communication style
    sections.push('\n## Communication Style');
    const comm = this.model.communication;
    if (comm.directness.confidence > 0.2) {
      sections.push(`- Directness: ${comm.directness.value > 0.6 ? 'very direct' : 'balanced'}`);
    }
    if (comm.verbosity.confidence > 0.2) {
      sections.push(`- Verbosity: ${comm.verbosity.value > 0.6 ? 'detailed' : 'concise'}`);
    }

    // Add relevant domain patterns
    const questionLower = question.toLowerCase();
    for (const [domain, data] of Object.entries(this.model.decision_domains)) {
      if (data.confidence > 0.2 && questionLower.includes(domain.replace(/_/g, ' '))) {
        sections.push(`\n## ${domain.replace(/_/g, ' ')} Patterns (confidence: ${(data.confidence * 100).toFixed(0)}%)`);
        const topWeights = Object.entries(data.weights)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3);
        for (const [factor, weight] of topWeights) {
          sections.push(`- ${factor}: ${(weight * 100).toFixed(0)}% weight`);
        }
      }
    }

    return sections.join('\n');
  }

  getProfileSummary(): string {
    const sections: string[] = [];
    sections.push('🧠 User Profile Summary');
    sections.push('━'.repeat(45));

    // Overall confidence
    const allDims = Object.values(this.model.dimensions);
    const avgConfidence = allDims.reduce((s, d) => s + d.confidence, 0) / allDims.length;
    sections.push(`\n📊 Overall Profile Confidence: ${(avgConfidence * 100).toFixed(0)}%`);
    sections.push(`   Total data points: ${allDims.reduce((s, d) => s + d.samples, 0)}`);

    // Dimensions
    sections.push('\n📐 Decision Dimensions:');
    for (const [name, dim] of Object.entries(this.model.dimensions)) {
      const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const bar = '█'.repeat(Math.round(dim.value * 10)) + '░'.repeat(10 - Math.round(dim.value * 10));
      const conf = dim.confidence > 0.3 ? `${(dim.confidence * 100).toFixed(0)}%` : 'learning';
      sections.push(`   ${label}: [${bar}] ${conf}`);
    }

    // Values
    if (this.model.values.length > 0) {
      sections.push(`\n💎 Core Values: ${this.model.values.join(' • ')}`);
    }

    // Domains
    const domains = Object.entries(this.model.decision_domains);
    if (domains.length > 0) {
      sections.push('\n🎯 Decision Domains:');
      for (const [domain, data] of domains.sort(([, a], [, b]) => b.confidence - a.confidence)) {
        const label = domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        sections.push(`   ${label}: ${(data.confidence * 100).toFixed(0)}% confident, ${data.examples.length} examples`);
      }
    }

    // Gaps
    if (this.model.gaps.length > 0) {
      sections.push('\n⚠️ Learning Gaps:');
      for (const gap of this.model.gaps.sort((a, b) => {
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      })) {
        const label = gap.domain.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const pri = gap.priority === 'high' ? '🔴' : gap.priority === 'medium' ? '🟡' : '🟢';
        sections.push(`   ${pri} ${label}: ${(gap.confidence * 100).toFixed(0)}%`);
      }
    }

    return sections.join('\n');
  }
}
