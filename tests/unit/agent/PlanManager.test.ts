/**
 * PlanManager Unit Tests
 *
 * Tests for plan / goal-stack memory — Phase 2 Sprint 5 of the
 * memory-types expansion (`docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md`
 * §4 Priority 1 / Type 6).
 *
 * Design decisions enforced by these tests (per pre-implementation
 * type-design review):
 *
 *   1. GoalNodeLifecycle discriminated union (mirrors PlanLifecycle /
 *      ProspectiveLifecycle / FailureLifecycle).
 *   2. Branded PlanId and GoalNodeId — minted only inside the manager
 *      via factories to prevent collisions and id-type confusion.
 *   3. Unified transitionNode(planId, nodeId, transition) — single
 *      discriminated dispatch; pushSubGoal stays separate (structural,
 *      not a transition).
 *   4. Query returns are deeply readonly — mutations only through the
 *      manager's surface so lastModified / history stay coherent.
 *   5. validatePlanInvariants runs after every mutation: unique node
 *      ids, currentNodeId ∈ tree, no cycles.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanManager } from '../../../src/agent/PlanManager.js';
import type { IGraphStorage, Entity } from '../../../src/types/types.js';
import type { PlanRecord, PlanEntity } from '../../../src/types/agent-memory.js';
import { isPlanMemory } from '../../../src/types/agent-memory.js';

function createMockStorage(initialEntities: Entity[] = []): IGraphStorage {
  const entities: Entity[] = [...initialEntities];
  return {
    appendEntity: vi.fn(async (entity: Entity) => {
      entities.push(entity);
    }),
    loadGraph: vi.fn(async () => ({ entities, relations: [] })),
    getEntityByName: vi.fn((name: string) => entities.find((e) => e.name === name)),
    updateEntity: vi.fn(async (name: string, updates: Partial<Entity>) => {
      const idx = entities.findIndex((e) => e.name === name);
      if (idx === -1) return false;
      entities[idx] = { ...entities[idx], ...updates };
      return true;
    }),
  } as unknown as IGraphStorage;
}

describe('PlanManager', () => {
  let storage: IGraphStorage;
  let pm: PlanManager;

  beforeEach(() => {
    storage = createMockStorage();
    pm = new PlanManager(storage);
  });

  // ==================== createPlan ====================

  describe('createPlan', () => {
    it('creates a plan with a single-node tree at the root', async () => {
      const plan = await pm.createPlan('Ship the feature');
      expect(plan.rootGoal.description).toBe('Ship the feature');
      expect(plan.rootGoal.children).toEqual([]);
      expect(plan.rootGoal.lifecycle.status).toBe('pending');
      expect(plan.lifecycle.status).toBe('active');
    });

    it('points currentNodeId at the root by default', async () => {
      const plan = await pm.createPlan('root');
      expect(plan.currentNodeId).toBe(plan.rootGoal.id);
    });

    it('persists the plan as a PlanEntity (memoryType === "plan")', async () => {
      const plan = await pm.createPlan('persisted-plan');
      const stored = await storage.getEntityByName(plan.id);
      expect(stored).toBeDefined();
      expect((stored as PlanEntity).memoryType).toBe('plan');
      expect((stored as PlanEntity).planRecord.id).toBe(plan.id);
    });

    it('rejects empty root description', async () => {
      await expect(pm.createPlan('')).rejects.toThrow(/description/i);
    });

    it('rejects whitespace-only root description', async () => {
      await expect(pm.createPlan('   ')).rejects.toThrow(/description/i);
    });

    it('accepts session/agent options', async () => {
      const plan = await pm.createPlan('s-plan', { sessionId: 's1', agentId: 'a1' });
      expect(plan.sessionId).toBe('s1');
      expect(plan.agentId).toBe('a1');
    });

    it('mints branded plan and root-node ids with the expected prefix shape', async () => {
      const plan = await pm.createPlan('id-shape');
      expect(plan.id).toMatch(/^plan-/);
      expect(plan.rootGoal.id).toMatch(/^node-/);
    });

    it('records an initial GoalEvent for plan creation', async () => {
      const plan = await pm.createPlan('with-history');
      expect(plan.history.length).toBeGreaterThanOrEqual(1);
      expect(plan.history[0].goalId).toBe(plan.rootGoal.id);
    });
  });

  // ==================== pushSubGoal ====================

  describe('pushSubGoal', () => {
    it('appends a child node under the named parent', async () => {
      const plan = await pm.createPlan('parent');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'first step');
      expect(child.description).toBe('first step');
      expect(child.lifecycle.status).toBe('pending');
      expect(child.children).toEqual([]);
      const reloaded = await pm.findNode(plan.id, plan.rootGoal.id);
      expect(reloaded?.children).toHaveLength(1);
      expect(reloaded?.children[0].id).toBe(child.id);
    });

    it('supports acceptanceCriteria on sub-goals', async () => {
      const plan = await pm.createPlan('with-criteria');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'step', {
        acceptanceCriteria: 'tests green',
      });
      expect(child.acceptanceCriteria).toBe('tests green');
    });

    it('rejects pushing under a non-existent parent', async () => {
      const plan = await pm.createPlan('p');
      await expect(
        pm.pushSubGoal(plan.id, 'node-does-not-exist', 'orphan')
      ).rejects.toThrow(/parent/i);
    });

    it('rejects pushing under a non-existent plan', async () => {
      await expect(
        pm.pushSubGoal('plan-nope', 'node-x', 'orphan')
      ).rejects.toThrow(/plan/i);
    });

    it('supports nested sub-goals (recursive tree)', async () => {
      const plan = await pm.createPlan('deep');
      const a = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'A');
      const b = await pm.pushSubGoal(plan.id, a.id, 'B');
      const c = await pm.pushSubGoal(plan.id, b.id, 'C');
      const path = await pm.getCurrentPath(plan.id);
      // currentNodeId still at root after pushing; manually set to c via transitionNode if needed
      void c;
      expect(path).toHaveLength(1);
      expect(path[0].description).toBe('deep');
    });
  });

  // ==================== transitionNode ====================

  describe('transitionNode', () => {
    it('transitions pending → active and records the activatedAt timestamp', async () => {
      const plan = await pm.createPlan('p');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'do thing');
      await pm.transitionNode(plan.id, child.id, { to: 'active' });
      const node = await pm.findNode(plan.id, child.id);
      expect(node?.lifecycle.status).toBe('active');
      if (node?.lifecycle.status === 'active') {
        expect(node.lifecycle.activatedAt).toBeDefined();
      }
    });

    it('transitions active → complete with optional note', async () => {
      const plan = await pm.createPlan('p');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'do thing');
      await pm.transitionNode(plan.id, child.id, { to: 'active' });
      await pm.transitionNode(plan.id, child.id, { to: 'complete', note: 'fixed in abc123' });
      const node = await pm.findNode(plan.id, child.id);
      expect(node?.lifecycle.status).toBe('complete');
      if (node?.lifecycle.status === 'complete') {
        expect(node.lifecycle.completedAt).toBeDefined();
        expect(node.lifecycle.completionNote).toBe('fixed in abc123');
      }
    });

    it('transitions to blocked with required reason', async () => {
      const plan = await pm.createPlan('p');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'do thing');
      await pm.transitionNode(plan.id, child.id, { to: 'blocked', reason: 'waiting on upstream' });
      const node = await pm.findNode(plan.id, child.id);
      expect(node?.lifecycle.status).toBe('blocked');
      if (node?.lifecycle.status === 'blocked') {
        expect(node.lifecycle.blockedReason).toBe('waiting on upstream');
      }
    });

    it('records a GoalEvent for each transition', async () => {
      const plan = await pm.createPlan('with-history');
      const child = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'step');
      const before = (await pm.findPlan(plan.id))!.history.length;
      await pm.transitionNode(plan.id, child.id, { to: 'active' });
      await pm.transitionNode(plan.id, child.id, { to: 'complete' });
      const after = (await pm.findPlan(plan.id))!.history.length;
      expect(after - before).toBe(2);
    });

    it('rejects transition on non-existent node', async () => {
      const plan = await pm.createPlan('p');
      await expect(
        pm.transitionNode(plan.id, 'node-fake', { to: 'active' })
      ).rejects.toThrow(/node/i);
    });

    it('updates currentNodeId when transitioning to active', async () => {
      const plan = await pm.createPlan('p');
      const a = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'A');
      await pm.transitionNode(plan.id, a.id, { to: 'active' });
      const reloaded = (await pm.findPlan(plan.id))!;
      expect(reloaded.currentNodeId).toBe(a.id);
    });
  });

  // ==================== getCurrentPath ====================

  describe('getCurrentPath', () => {
    it('returns root → ... → currentNode path', async () => {
      const plan = await pm.createPlan('R');
      const a = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'A');
      const b = await pm.pushSubGoal(plan.id, a.id, 'B');
      await pm.transitionNode(plan.id, b.id, { to: 'active' });
      const path = await pm.getCurrentPath(plan.id);
      expect(path.map((n) => n.description)).toEqual(['R', 'A', 'B']);
    });

    it('returns just the root when currentNodeId === rootGoal.id', async () => {
      const plan = await pm.createPlan('only-root');
      const path = await pm.getCurrentPath(plan.id);
      expect(path).toHaveLength(1);
      expect(path[0].id).toBe(plan.rootGoal.id);
    });
  });

  // ==================== markPlanComplete / abandonPlan ====================

  describe('plan lifecycle (complete / abandon)', () => {
    it('markPlanComplete transitions PlanLifecycle to complete', async () => {
      const plan = await pm.createPlan('to-complete');
      const result = await pm.markPlanComplete(plan.id);
      expect(result).toBe('resolved');
      const reloaded = (await pm.findPlan(plan.id))!;
      expect(reloaded.lifecycle.status).toBe('complete');
      if (reloaded.lifecycle.status === 'complete') {
        expect(reloaded.lifecycle.completedAt).toBeDefined();
      }
    });

    it('markPlanComplete returns already-resolved on second call', async () => {
      const plan = await pm.createPlan('twice');
      await pm.markPlanComplete(plan.id);
      expect(await pm.markPlanComplete(plan.id)).toBe('already-resolved');
    });

    it('markPlanComplete returns not-found for unknown id', async () => {
      expect(await pm.markPlanComplete('plan-nope')).toBe('not-found');
    });

    it('abandonPlan transitions to abandoned with optional reason', async () => {
      const plan = await pm.createPlan('to-abandon');
      const result = await pm.abandonPlan(plan.id, 'pivoted');
      expect(result).toBe('resolved');
      const reloaded = (await pm.findPlan(plan.id))!;
      expect(reloaded.lifecycle.status).toBe('abandoned');
      if (reloaded.lifecycle.status === 'abandoned') {
        expect(reloaded.lifecycle.abandonedReason).toBe('pivoted');
      }
    });
  });

  // ==================== findNode / findPlan ====================

  describe('findNode / findPlan', () => {
    it('findNode returns the node for a valid id', async () => {
      const plan = await pm.createPlan('p');
      const a = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'A');
      const found = await pm.findNode(plan.id, a.id);
      expect(found?.id).toBe(a.id);
    });

    it('findNode returns null for an unknown id', async () => {
      const plan = await pm.createPlan('p');
      expect(await pm.findNode(plan.id, 'node-nope')).toBeNull();
    });

    it('findPlan returns null for unknown plan id', async () => {
      expect(await pm.findPlan('plan-nope')).toBeNull();
    });
  });

  // ==================== getActivePlan / listPlans ====================

  describe('getActivePlan / listPlans', () => {
    it('getActivePlan returns the most-recent active plan for a session', async () => {
      const p1 = await pm.createPlan('first', { sessionId: 's' });
      const p2 = await pm.createPlan('second', { sessionId: 's' });
      const active = await pm.getActivePlan('s');
      expect(active).toBeDefined();
      expect(active?.id).toBe(p2.id);
      void p1;
    });

    it('getActivePlan returns null when no active plan for session', async () => {
      expect(await pm.getActivePlan('nobody')).toBeNull();
    });

    it('getActivePlan ignores complete/abandoned plans', async () => {
      const p1 = await pm.createPlan('done', { sessionId: 's' });
      await pm.markPlanComplete(p1.id);
      expect(await pm.getActivePlan('s')).toBeNull();
    });

    it('listPlans filters by sessionId', async () => {
      await pm.createPlan('a', { sessionId: 'X' });
      await pm.createPlan('b', { sessionId: 'Y' });
      const xPlans = await pm.listPlans({ sessionId: 'X' });
      expect(xPlans).toHaveLength(1);
    });

    it('listPlans filters by status', async () => {
      const p1 = await pm.createPlan('p1');
      const p2 = await pm.createPlan('p2');
      await pm.markPlanComplete(p2.id);
      const complete = await pm.listPlans({ status: 'complete' });
      expect(complete.map((p) => p.id)).toEqual([p2.id]);
      void p1;
    });
  });

  // ==================== invariant validation ====================

  describe('plan invariants', () => {
    it('mints unique node ids across sub-goals', async () => {
      const plan = await pm.createPlan('p');
      const a = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'A');
      const b = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'B');
      const c = await pm.pushSubGoal(plan.id, a.id, 'C');
      const ids = new Set([plan.rootGoal.id, a.id, b.id, c.id]);
      expect(ids.size).toBe(4);
    });
  });

  // ==================== type guard ====================

  describe('isPlanMemory type guard', () => {
    it('returns true for a persisted PlanEntity', async () => {
      const plan = await pm.createPlan('check');
      const stored = await storage.getEntityByName(plan.id);
      expect(isPlanMemory(stored)).toBe(true);
    });

    it('returns false for non-plan entities', () => {
      expect(isPlanMemory({ memoryType: 'episodic' })).toBe(false);
      expect(isPlanMemory(null)).toBe(false);
      expect(isPlanMemory(undefined)).toBe(false);
    });
  });
});
