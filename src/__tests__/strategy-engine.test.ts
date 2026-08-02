import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { StrategyEngine } from '../strategy/strategy-engine.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let DATA_DIR: string;
let engine: StrategyEngine;

describe('StrategyEngine', () => {
  beforeEach(() => {
    DATA_DIR = mkdtempSync(join(tmpdir(), 'strategy-'));
    engine = new StrategyEngine(DATA_DIR);
  });

  afterAll(() => {
    if (DATA_DIR) rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('creates and lists goals', () => {
    const goal = engine.createGoal({
      title: 'Reduce infra spend',
      quarter: '2026-Q3',
      description: 'Cut cloud costs by 20%',
      owner: 'cto',
      tags: ['cost', 'infra'],
    });

    expect(goal.id).toMatch(/^goal_/);
    expect(goal.progress).toBe(0);
    expect(goal.status).toBe('proposed');

    const goals = engine.listGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe('Reduce infra spend');
  });

  it('updates and deletes goals with cascade', () => {
    const goal = engine.createGoal({ title: 'A', quarter: '2026-Q3' });
    const init = engine.createInitiative({ goalId: goal.id, title: 'I1', priority: 'p1' })!;
    engine.createMilestone({ initiativeId: init.id, title: 'M1' });

    const updated = engine.updateGoal(goal.id, { status: 'active' });
    expect(updated!.status).toBe('active');

    expect(engine.deleteGoal(goal.id)).toBe(true);
    expect(engine.listGoals()).toHaveLength(0);
    expect(engine.listInitiatives()).toHaveLength(0);
    expect(engine.listMilestones()).toHaveLength(0);
  });

  it('rejects initiative with missing goal', () => {
    expect(() => engine.createInitiative({ goalId: 'nope', title: 'I', priority: 'p1' }))
      .toThrow(/does not exist/);
  });

  it('sorts initiatives by priority', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    engine.createInitiative({ goalId: goal.id, title: 'low', priority: 'p3' });
    engine.createInitiative({ goalId: goal.id, title: 'high', priority: 'p0' });
    engine.createInitiative({ goalId: goal.id, title: 'mid', priority: 'p1' });

    const inits = engine.listInitiatives(goal.id);
    expect(inits.map(i => i.priority)).toEqual(['p0', 'p1', 'p3']);
  });

  it('marks milestones done with timestamps', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    const init = engine.createInitiative({ goalId: goal.id, title: 'I', priority: 'p1' })!;
    const ms = engine.createMilestone({ initiativeId: init.id, title: 'M1' })!;

    expect(ms.status).toBe('pending');
    expect(ms.completedAt).toBeUndefined();

    const done = engine.updateMilestone(ms.id, { status: 'done' })!;
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeDefined();
  });

  it('rolls up initiative progress from milestones', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    const init = engine.createInitiative({ goalId: goal.id, title: 'I', priority: 'p1' })!;
    engine.createMilestone({ initiativeId: init.id, title: 'M1' });
    engine.createMilestone({ initiativeId: init.id, title: 'M2', status: 'done' });

    const detail = engine.initiativeDetail(init.id);
    expect(detail.progress).toBe(50);
  });

  it('rolls up goal progress from completed initiatives', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    engine.createInitiative({ goalId: goal.id, title: 'done1', priority: 'p1', status: 'completed' });
    engine.createInitiative({ goalId: goal.id, title: 'done2', priority: 'p1', status: 'completed' });
    engine.createInitiative({ goalId: goal.id, title: 'active', priority: 'p1', status: 'active' });

    const rolled = engine.goalProgress(goal.id);
    expect(rolled.progress).toBe(67);
    expect(rolled.atRisk).toHaveLength(0);
  });

  it('flags at-risk initiatives', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    engine.createInitiative({ goalId: goal.id, title: 'risk', priority: 'p0', status: 'at_risk' });

    const rolled = engine.goalProgress(goal.id);
    expect(rolled.atRisk).toHaveLength(1);
    expect(rolled.atRisk[0].title).toBe('risk');
  });

  it('builds quarterly view', () => {
    const g1 = engine.createGoal({ title: 'Q3 goal', quarter: '2026-Q3' });
    const g2 = engine.createGoal({ title: 'Q4 goal', quarter: '2026-Q4' });
    engine.createInitiative({ goalId: g1.id, title: 'I', priority: 'p1' });

    const q3 = engine.quarterlyView('2026-Q3');
    expect(q3).toHaveLength(1);
    expect(q3[0].goal.id).toBe(g1.id);
    expect(q3[0].initiatives).toHaveLength(1);
  });

  it('manages roadmaps with resolved initiatives', () => {
    const goal = engine.createGoal({ title: 'G', quarter: '2026-Q3' });
    const i1 = engine.createInitiative({ goalId: goal.id, title: 'I1', priority: 'p1' })!;
    const i2 = engine.createInitiative({ goalId: goal.id, title: 'I2', priority: 'p1' })!;

    const roadmap = engine.createRoadmap({
      title: 'Q3 plan',
      quarters: ['2026-Q3'],
      initiativeIds: [i1.id, i2.id, 'missing-id'],
    });

    const detail = engine.roadmapDetail(roadmap.id);
    expect(detail.initiatives).toHaveLength(2);
    expect(detail.initiatives.map(i => i.title)).toEqual(['I1', 'I2']);
  });

  it('persists across engine instances', () => {
    const goal = engine.createGoal({ title: 'Persist', quarter: '2026-Q3' });
    expect(goal.id).toBeDefined();

    const reloaded = new StrategyEngine(DATA_DIR);
    expect(reloaded.listGoals()).toHaveLength(1);
    expect(reloaded.getGoal(goal.id)!.title).toBe('Persist');
  });
});
