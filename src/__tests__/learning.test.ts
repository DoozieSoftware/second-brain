import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

import { UserModelManager } from '../core/user-model.js';
import { SystemModelManager } from '../core/system-model.js';

const TEST_DATA_DIR = './data/test-learning';

describe('UserModelManager', () => {
  let userModel: UserModelManager;

  beforeEach(() => {
    // Clean up the default data directory to ensure fresh state
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
    mkdirSync('./data', { recursive: true });
  });

  afterEach(() => {
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
  });

  it('should create a default model with expected structure', () => {
    userModel = new UserModelManager();
    const model = userModel.getModel();

    expect(model.version).toBe(1);
    expect(model.dimensions).toBeDefined();
    expect(model.dimensions.risk_tolerance).toBeDefined();
    expect(model.dimensions.risk_tolerance.value).toBe(0.5);
    expect(model.dimensions.risk_tolerance.confidence).toBe(0);
    expect(model.values).toEqual([]);
    expect(model.gaps.length).toBeGreaterThan(0);
  });

  it('should update dimension values with Bayesian-style updates', () => {
    userModel = new UserModelManager();

    // Initial state
    expect(userModel.getModel().dimensions.risk_tolerance.value).toBe(0.5);
    expect(userModel.getModel().dimensions.risk_tolerance.samples).toBe(0);

    // First update
    userModel.updateDimension('dimensions', 'risk_tolerance', 0.8, 'test');
    expect(userModel.getModel().dimensions.risk_tolerance.samples).toBe(1);
    expect(userModel.getModel().dimensions.risk_tolerance.confidence).toBeCloseTo(0.1);

    // Multiple updates should converge
    for (let i = 0; i < 10; i++) {
      userModel.updateDimension('dimensions', 'risk_tolerance', 0.8, 'test');
    }
    expect(userModel.getModel().dimensions.risk_tolerance.value).toBeGreaterThan(0.6);
    expect(userModel.getModel().dimensions.risk_tolerance.samples).toBe(11);
  });

  it('should add and update domain examples', () => {
    userModel = new UserModelManager();

    userModel.addDomainExample('hiring', 'doc-1');
    expect(userModel.getModel().decision_domains.hiring).toBeDefined();
    expect(userModel.getModel().decision_domains.hiring.examples).toContain('doc-1');
    // Initial confidence is 0.1, plus 0.05 on add
    expect(userModel.getModel().decision_domains.hiring.confidence).toBeCloseTo(0.15);

    // Adding same example shouldn't duplicate
    userModel.addDomainExample('hiring', 'doc-1');
    expect(userModel.getModel().decision_domains.hiring.examples.length).toBe(1);
  });

  it('should update domain weights', () => {
    userModel = new UserModelManager();

    userModel.updateDomainWeights('hiring', { technical_skill: 0.8, communication: 0.6 });
    expect(userModel.getModel().decision_domains.hiring.weights.technical_skill).toBe(0.8);
    expect(userModel.getModel().decision_domains.hiring.weights.communication).toBe(0.6);
    expect(userModel.getModel().decision_domains.hiring.confidence).toBeGreaterThan(0);
  });

  it('should manage gaps correctly', () => {
    userModel = new UserModelManager();

    // Initial gaps
    const initialGaps = userModel.getGapsByPriority();
    expect(initialGaps.length).toBeGreaterThan(0);

    // Update a gap - high confidence should remove it
    userModel.updateGap('hiring', 0.9);
    const updatedGaps = userModel.getGapsByPriority();
    expect(updatedGaps.find(g => g.domain === 'hiring')).toBeUndefined();

    // Adding a new low-confidence domain should create a gap
    userModel.updateGap('new_domain', 0.2);
    const finalGaps = userModel.getGapsByPriority();
    expect(finalGaps.find(g => g.domain === 'new_domain')).toBeDefined();
  });

  it('should generate context for questions', () => {
    userModel = new UserModelManager();

    // Update some dimensions
    userModel.updateDimension('dimensions', 'risk_tolerance', 0.8, 'test');
    userModel.updateDimension('dimensions', 'risk_tolerance', 0.7, 'test');
    userModel.setValues(['speed', 'simplicity']);

    const context = userModel.getContextForQuestion('Should we hire this candidate?');
    expect(context).toContain('User Decision Profile');
    expect(context).toContain('Core Values');
  });

  it('should produce a readable profile summary', () => {
    userModel = new UserModelManager();
    userModel.updateDimension('dimensions', 'risk_tolerance', 0.8, 'test');
    userModel.setValues(['speed', 'ownership']);

    const summary = userModel.getProfileSummary();
    expect(summary).toContain('User Profile Summary');
    expect(summary).toContain('Decision Dimensions');
    expect(summary).toContain('Core Values');
    expect(summary).toContain('Learning Gaps');
  });
});

describe('SystemModelManager', () => {
  let systemModel: SystemModelManager;

  beforeEach(() => {
    // Clean up the default data directory to ensure fresh state
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
    mkdirSync('./data', { recursive: true });
  });

  afterEach(() => {
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
  });

  it('should create a default model', () => {
    systemModel = new SystemModelManager();
    const model = systemModel.getModel();

    expect(model.version).toBe(1);
    expect(model.total_queries).toBe(0);
    expect(model.performance.avg_confidence).toBe(0);
    expect(model.learned_patterns).toEqual([]);
  });

  it('should record queries and update performance', () => {
    systemModel = new SystemModelManager();

    systemModel.recordQuery('hiring', 0.7, 3, 5, 3, false);
    expect(systemModel.getModel().total_queries).toBe(1);
    expect(systemModel.getModel().performance.avg_confidence).toBeCloseTo(0.7);

    const hiringPerf = systemModel.getModel().performance.by_domain.hiring;
    expect(hiringPerf.query_count).toBe(1);
    expect(hiringPerf.avg_confidence).toBeCloseTo(0.7);
    expect(hiringPerf.search_success_rate).toBeCloseTo(0.6);
  });

  it('should accumulate performance across multiple queries', () => {
    systemModel = new SystemModelManager();

    systemModel.recordQuery('hiring', 0.8, 2, 3, 2, false);
    systemModel.recordQuery('hiring', 0.6, 4, 5, 2, false);
    systemModel.recordQuery('architecture', 0.9, 1, 2, 2, false);

    expect(systemModel.getModel().total_queries).toBe(3);
    expect(systemModel.getModel().performance.by_domain.hiring.query_count).toBe(2);
    expect(systemModel.getModel().performance.by_domain.hiring.avg_confidence).toBeCloseTo(0.7);
    expect(systemModel.getModel().performance.by_domain.architecture.query_count).toBe(1);
  });

  it('should identify weak domains', () => {
    systemModel = new SystemModelManager();

    // Add several low-confidence queries for a domain
    for (let i = 0; i < 5; i++) {
      systemModel.recordQuery('hiring', 0.3, 5, 4, 1, true);
    }

    const weakDomains = systemModel.getWeakDomains();
    expect(weakDomains).toContain('hiring');
  });

  it('should add and track learned patterns', () => {
    systemModel = new SystemModelManager();

    systemModel.addLearnedPattern({
      type: 'effective_query',
      domain: 'hiring',
      pattern: 'Use broad queries for hiring',
      success_rate: 0.8,
      adopted: true,
      improvement: 0.15,
    });

    const patterns = systemModel.getModel().learned_patterns;
    expect(patterns.length).toBe(1);
    expect(patterns[0].pattern).toBe('Use broad queries for hiring');
    expect(patterns[0].improvement).toBe(0.15);
  });

  it('should log evolution events', () => {
    systemModel = new SystemModelManager();

    systemModel.logEvolution(
      'Added early-stopping heuristic',
      'High loop count detected',
      'Reduced avg loops by 1.5'
    );

    const evolutions = systemModel.getModel().evolution_log;
    expect(evolutions.length).toBe(1);
    expect(evolutions[0].change).toBe('Added early-stopping heuristic');
    expect(evolutions[0].date).toBeDefined();
  });

  it('should generate a readable evolution report', () => {
    systemModel = new SystemModelManager();

    systemModel.recordQuery('hiring', 0.7, 3, 4, 2, false);
    systemModel.recordQuery('architecture', 0.85, 2, 3, 3, false);
    systemModel.logEvolution('Test evolution', 'Test trigger', 'Test result');

    const report = systemModel.getEvolutionReport();
    expect(report).toContain('System Evolution Report');
    expect(report).toContain('Overall Performance');
    expect(report).toContain('Recent Evolution Events');
  });

  it('should analyze performance correctly', () => {
    systemModel = new SystemModelManager();

    // Add data for multiple domains
    for (let i = 0; i < 5; i++) {
      systemModel.recordQuery('hiring', 0.8, 2, 3, 2, false);
      systemModel.recordQuery('budget', 0.3, 5, 4, 1, true);
    }

    const analysis = systemModel.analyzePerformance();
    expect(analysis.total_queries).toBe(10);
    expect(analysis.strongest_domains.length).toBeGreaterThan(0);
    expect(analysis.strongest_domains[0].domain).toBe('hiring');
  });
});

describe('Integration: User Model + System Model', () => {
  beforeEach(() => {
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
    mkdirSync('./data', { recursive: true });
  });

  afterEach(() => {
    if (existsSync('./data')) {
      rmSync('./data', { recursive: true });
    }
  });

  it('should work together in a learning scenario', () => {
    const userModel = new UserModelManager();
    const systemModel = new SystemModelManager();

    // Simulate answering a hiring question
    userModel.updateDimension('dimensions', 'risk_tolerance', 0.7, 'question_answer');
    userModel.addDomainExample('hiring', 'reasoning:q1');
    userModel.updateDomainWeights('hiring', { technical_skill: 0.9, culture_fit: 0.6 });

    // Record the query in system model
    systemModel.recordQuery('hiring', 0.75, 1, 1, 1, false);

    // Check user model state
    const userContext = userModel.getContextForQuestion('Should we hire this candidate?');
    expect(userContext).toContain('Decision Profile');

    // Check system model state
    expect(systemModel.getModel().total_queries).toBe(1);
    expect(systemModel.getModel().performance.by_domain.hiring).toBeDefined();

    // Both models should persist independently
    expect(userModel.getModel().decision_domains.hiring).toBeDefined();
    expect(userModel.getModel().decision_domains.hiring.weights.technical_skill).toBe(0.9);
  });
});
