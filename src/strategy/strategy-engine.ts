import { JsonStore } from '../core/json-store.js';

export type GoalStatus = 'proposed' | 'active' | 'at_risk' | 'completed' | 'cancelled';
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';

export interface Goal {
  id: string;
  title: string;
  description?: string;
  /** The quarter this goal is tracked against, e.g. "2026-Q3". */
  quarter: string;
  status: GoalStatus;
  owner?: string;
  /** Progress 0-100. Can be updated directly or rolled up from milestones. */
  progress: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Initiative {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: GoalStatus;
  priority: Priority;
  owner?: string;
  startDate?: string;
  targetDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  initiativeId: string;
  title: string;
  dueDate?: string;
  status: 'pending' | 'in_progress' | 'done';
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Roadmap {
  id: string;
  title: string;
  /** Quarter(s) the roadmap spans, e.g. "2026-Q3". */
  quarters: string[];
  description?: string;
  /** Initiative ids included in the roadmap, in display order. */
  initiativeIds: string[];
  createdAt: string;
  updatedAt: string;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Strategy Engine — goals, initiatives, milestones, and roadmaps.
 *
 * Provides goal decomposition (goal → initiatives → milestones), progress
 * rollup, and roadmap assembly. Data is persisted via JsonStore. The engine is
 * deliberately pure of HTTP/CLI concerns so it can back both the REST API and
 * the CLI, and later an agent tool.
 */
export class StrategyEngine {
  private goals: JsonStore<Goal>;
  private initiatives: JsonStore<Initiative>;
  private milestones: JsonStore<Milestone>;
  private roadmaps: JsonStore<Roadmap>;

  constructor(dataDir?: string) {
    this.goals = new JsonStore<Goal>('strategy-goals.json', dataDir);
    this.initiatives = new JsonStore<Initiative>('strategy-initiatives.json', dataDir);
    this.milestones = new JsonStore<Milestone>('strategy-milestones.json', dataDir);
    this.roadmaps = new JsonStore<Roadmap>('strategy-roadmaps.json', dataDir);
  }

  // ─── Goals ───

  createGoal(input: {
    title: string;
    description?: string;
    quarter: string;
    status?: GoalStatus;
    owner?: string;
    progress?: number;
    tags?: string[];
  }): Goal {
    const goal: Goal = {
      ...input,
      status: input.status ?? 'proposed',
      id: newId('goal'),
      progress: input.progress ?? 0,
      tags: input.tags ?? [],
      createdAt: now(),
      updatedAt: now(),
    };
    return this.goals.upsert(goal);
  }

  listGoals(): Goal[] {
    return this.goals.all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getGoal(id: string): Goal | undefined {
    return this.goals.getById(id);
  }

  updateGoal(id: string, patch: Partial<Omit<Goal, 'id' | 'createdAt'>>): Goal | undefined {
    const goal = this.goals.getById(id);
    if (!goal) return undefined;
    const updated: Goal = { ...goal, ...patch, id, updatedAt: now() };
    return this.goals.upsert(updated);
  }

  deleteGoal(id: string): boolean {
    const removed = this.goals.delete(id);
    if (removed) {
      // Cascade: remove dependent initiatives and their milestones.
      for (const init of this.initiatives.all().filter(i => i.goalId === id)) {
        this.deleteInitiative(init.id);
      }
    }
    return removed;
  }

  // ─── Initiatives ───

  createInitiative(input: {
    goalId: string;
    title: string;
    description?: string;
    status?: GoalStatus;
    priority: Priority;
    owner?: string;
    startDate?: string;
    targetDate?: string;
    tags?: string[];
  }): Initiative | undefined {
    if (!this.goals.getById(input.goalId)) {
      throw new Error(`Cannot create initiative: goal "${input.goalId}" does not exist`);
    }
    const initiative: Initiative = {
      ...input,
      status: input.status ?? 'proposed',
      id: newId('init'),
      tags: input.tags ?? [],
      createdAt: now(),
      updatedAt: now(),
    };
    return this.initiatives.upsert(initiative);
  }

  listInitiatives(goalId?: string): Initiative[] {
    let all = this.initiatives.all();
    if (goalId) all = all.filter(i => i.goalId === goalId);
    return all.sort((a, b) => {
      const prio = { p0: 0, p1: 1, p2: 2, p3: 3 };
      return (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9);
    });
  }

  getInitiative(id: string): Initiative | undefined {
    return this.initiatives.getById(id);
  }

  updateInitiative(id: string, patch: Partial<Omit<Initiative, 'id' | 'createdAt'>>): Initiative | undefined {
    const init = this.initiatives.getById(id);
    if (!init) return undefined;
    const updated: Initiative = { ...init, ...patch, id, updatedAt: now() };
    return this.initiatives.upsert(updated);
  }

  deleteInitiative(id: string): boolean {
    const removed = this.initiatives.delete(id);
    if (removed) {
      for (const m of this.milestones.all().filter(m => m.initiativeId === id)) {
        this.milestones.delete(m.id);
      }
    }
    return removed;
  }

  // ─── Milestones ───

  createMilestone(input: {
    initiativeId: string;
    title: string;
    dueDate?: string;
    status?: Milestone['status'];
  }): Milestone | undefined {
    if (!this.initiatives.getById(input.initiativeId)) {
      throw new Error(`Cannot create milestone: initiative "${input.initiativeId}" does not exist`);
    }
    const milestone: Milestone = {
      ...input,
      status: input.status ?? 'pending',
      completedAt: input.status === 'done' ? now() : undefined,
      id: newId('ms'),
      createdAt: now(),
      updatedAt: now(),
    };
    return this.milestones.upsert(milestone);
  }

  listMilestones(initiativeId?: string): Milestone[] {
    let all = this.milestones.all();
    if (initiativeId) all = all.filter(m => m.initiativeId === initiativeId);
    return all.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }

  getMilestone(id: string): Milestone | undefined {
    return this.milestones.getById(id);
  }

  updateMilestone(id: string, patch: Partial<Omit<Milestone, 'id' | 'createdAt'>>): Milestone | undefined {
    const ms = this.milestones.getById(id);
    if (!ms) return undefined;
    let completedAt = ms.completedAt;
    if (patch.status !== undefined) {
      completedAt = patch.status === 'done' ? now() : undefined;
    }
    const updated: Milestone = { ...ms, ...patch, id, completedAt, updatedAt: now() };
    return this.milestones.upsert(updated);
  }

  deleteMilestone(id: string): boolean {
    return this.milestones.delete(id);
  }

  // ─── Roadmaps ───

  createRoadmap(input: {
    title: string;
    quarters: string[];
    description?: string;
    initiativeIds?: string[];
  }): Roadmap {
    const roadmap: Roadmap = {
      ...input,
      initiativeIds: input.initiativeIds ?? [],
      id: newId('roadmap'),
      createdAt: now(),
      updatedAt: now(),
    };
    return this.roadmaps.upsert(roadmap);
  }

  listRoadmaps(): Roadmap[] {
    return this.roadmaps.all().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getRoadmap(id: string): Roadmap | undefined {
    return this.roadmaps.getById(id);
  }

  updateRoadmap(id: string, patch: Partial<Omit<Roadmap, 'id' | 'createdAt'>>): Roadmap | undefined {
    const roadmap = this.roadmaps.getById(id);
    if (!roadmap) return undefined;
    const updated: Roadmap = { ...roadmap, ...patch, id, updatedAt: now() };
    return this.roadmaps.upsert(updated);
  }

  deleteRoadmap(id: string): boolean {
    return this.roadmaps.delete(id);
  }

  // ─── Rollup & views ───

  /** Progress of a goal rolled up from its initiatives (weighted equally). */
  goalProgress(goalId: string): { goal: Goal | undefined; initiatives: Initiative[]; progress: number; atRisk: Initiative[] } {
    const goal = this.goals.getById(goalId);
    const initiatives = this.listInitiatives(goalId);
    const completed = initiatives.filter(i => i.status === 'completed').length;
    const atRisk = initiatives.filter(i => i.status === 'at_risk');
    const progress = initiatives.length === 0
      ? goal?.progress ?? 0
      : Math.round((completed / initiatives.length) * 100);
    return { goal, initiatives, progress, atRisk };
  }

  /** Initiative detail with its milestones and rolled-up milestone progress. */
  initiativeDetail(initiativeId: string): { initiative: Initiative | undefined; milestones: Milestone[]; progress: number } {
    const initiative = this.initiatives.getById(initiativeId);
    const milestones = this.listMilestones(initiativeId);
    const done = milestones.filter(m => m.status === 'done').length;
    const progress = milestones.length === 0 ? 0 : Math.round((done / milestones.length) * 100);
    return { initiative, milestones, progress };
  }

  /** Full quarterly view: goals with their initiative trees. */
  quarterlyView(quarter?: string): Array<{
    goal: Goal;
    initiatives: Array<{
      initiative: Initiative;
      milestones: Milestone[];
      progress: number;
    }>;
    progress: number;
  }> {
    let goals = this.listGoals();
    if (quarter) goals = goals.filter(g => g.quarter === quarter);
    return goals.map(g => {
      const initiatives = this.listInitiatives(g.id).map(i => {
        const detail = this.initiativeDetail(i.id);
        return { initiative: i, milestones: detail.milestones, progress: detail.progress };
      });
      const completed = initiatives.filter(i => i.initiative.status === 'completed').length;
      const progress = initiatives.length === 0 ? g.progress : Math.round((completed / initiatives.length) * 100);
      return { goal: g, initiatives, progress };
    });
  }

  /** Roadmap with resolved initiatives (missing ones are omitted). */
  roadmapDetail(id: string): { roadmap: Roadmap | undefined; initiatives: Initiative[] } {
    const roadmap = this.roadmaps.getById(id);
    if (!roadmap) return { roadmap, initiatives: [] };
    const initiatives = roadmap.initiativeIds
      .map(iid => this.initiatives.getById(iid))
      .filter((i): i is Initiative => !!i);
    return { roadmap, initiatives };
  }
}
