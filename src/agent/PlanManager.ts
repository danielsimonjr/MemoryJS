/**
 * Plan / Goal-Stack Manager (Phase 2 Sprint 5)
 *
 * The forward-looking goal-tree memory type. Per the Agentic Memory
 * Library catalog (Type 6), plans pair structurally with the
 * just-shipped prospective memory: prospective is single
 * intention-to-act, plan is hierarchical decomposition + sub-tasks +
 * acceptance criteria. Both are forward-looking; plans are mutable,
 * prospective is append-only-until-fired.
 *
 * Design decisions (pre-implementation type-design review):
 * - **`GoalNodeLifecycle` discriminated union** — mirrors
 *   `PlanLifecycle` / `ProspectiveLifecycle` / `FailureLifecycle`.
 * - **Branded `PlanId` / `GoalNodeId`** — minted only here via UUID;
 *   prevents id-type confusion at compile time.
 * - **Unified `transitionNode(planId, nodeId, transition)`** with
 *   discriminated `GoalNodeTransition` payload; `pushSubGoal` stays
 *   separate (structural, not a transition).
 * - **Read returns are `Readonly`** — all mutations flow through
 *   manager methods so `lastModified` / `history` stay coherent.
 * - **`validatePlanInvariants` after every mutation** — unique ids,
 *   `currentNodeId ∈ tree`, no cycles.
 *
 * @module agent/PlanManager
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  GoalNode,
  GoalNodeId,
  GoalNodeLifecycle,
  GoalNodeTransition,
  MarkResolvedResult,
  PlanEntity,
  PlanId,
  PlanLifecycle,
  PlanRecord,
} from '../types/agent-memory.js';
import { isPlanMemory, toIsoDateTime } from '../types/agent-memory.js';
import { validateNonEmpty } from '../utils/validationUtils.js';

/** Configuration for `PlanManager`. */
export interface PlanManagerConfig {
  /**
   * Run `validatePlanInvariants` after every mutation. Default `true`.
   * Disable in hot-path production scenarios where the O(n) invariant
   * check shows up in profiles.
   */
  validateInvariants?: boolean;
}

/** Options for `createPlan`. */
export interface CreatePlanOptions {
  sessionId?: string;
  agentId?: string;
  importance?: number;
}

/** Options for `pushSubGoal`. */
export interface PushSubGoalOptions {
  acceptanceCriteria?: string;
}

/** Filter for `listPlans`. */
export interface ListPlansOptions {
  sessionId?: string;
  status?: PlanLifecycle['status'];
  agentId?: string;
}

/**
 * Manages plan / goal-stack records.
 *
 * @example
 * ```typescript
 * const pm = ctx.plan;
 * const plan = await pm.createPlan('Ship the auth feature', { sessionId: 's' });
 * const setup = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'Set up password hashing');
 * const integ = await pm.pushSubGoal(plan.id, plan.rootGoal.id, 'Integrate with login flow');
 *
 * await pm.transitionNode(plan.id, setup.id, { to: 'active' });
 * // ...work happens...
 * await pm.transitionNode(plan.id, setup.id, { to: 'complete', note: 'argon2id, salt rounds=10' });
 *
 * const path = await pm.getCurrentPath(plan.id);
 * console.log(path.map((n) => n.description).join(' → '));
 * ```
 */
export class PlanManager {
  private readonly storage: IGraphStorage;
  private readonly validateInvariants: boolean;

  constructor(storage: IGraphStorage, config: PlanManagerConfig = {}) {
    this.storage = storage;
    this.validateInvariants = config.validateInvariants ?? true;
  }

  // ==================== Create ====================

  /**
   * Create a new plan with a single-node tree at the root.
   *
   * @throws {Error} if `description` is empty / whitespace
   */
  async createPlan(rootDescription: string, options: CreatePlanOptions = {}): Promise<PlanRecord> {
    validateNonEmpty(rootDescription, 'description', 'PlanManager');

    const now = new Date();
    const nowIso = toIsoDateTime(now);
    const planId = mintPlanId();
    const rootId = mintGoalNodeId();

    const rootGoal: GoalNode = {
      id: rootId,
      description: rootDescription,
      lifecycle: { status: 'pending' },
      children: [],
      createdAt: nowIso,
    };

    const planRecord: PlanRecord = {
      id: planId,
      rootGoal,
      currentNodeId: rootId,
      lifecycle: { status: 'active' },
      createdAt: nowIso,
      lastModified: nowIso,
      history: [
        {
          timestamp: nowIso,
          goalId: rootId,
          fromStatus: 'pending',
          toStatus: 'pending',
          note: 'plan created',
        },
      ],
      sessionId: options.sessionId,
      agentId: options.agentId,
    };

    const entity: PlanEntity = {
      name: planId,
      entityType: 'plan',
      observations: [`[plan] ${rootDescription}`],
      createdAt: nowIso,
      lastModified: nowIso,
      importance: options.importance ?? 6,
      memoryType: 'plan',
      sessionId: options.sessionId,
      agentId: options.agentId,
      visibility: 'private',
      accessCount: 0,
      confidence: 1.0,
      confirmationCount: 0,
      planRecord,
    };

    this.runInvariantCheck(planRecord);

    try {
      await this.storage.appendEntity(entity as unknown as Entity);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`PlanManager.createPlan: failed to persist plan '${planId}': ${cause}`);
    }
    return planRecord;
  }

  // ==================== Structural — pushSubGoal ====================

  /**
   * Append a child goal under the named parent node. Returns the
   * created child.
   *
   * @throws {Error} if plan not found / parent not found / description empty
   */
  async pushSubGoal(
    planId: PlanId | string,
    parentNodeId: GoalNodeId | string,
    description: string,
    options: PushSubGoalOptions = {}
  ): Promise<GoalNode> {
    validateNonEmpty(description, 'description', 'PlanManager');

    const plan = this.loadPlanMutable(planId);
    if (!plan) throw new Error(`PlanManager.pushSubGoal: plan '${planId}' not found`);

    const parent = findNodeInTree(plan.rootGoal, parentNodeId as GoalNodeId);
    if (!parent) {
      throw new Error(
        `PlanManager.pushSubGoal: parent node '${parentNodeId}' not found in plan '${planId}'`
      );
    }

    const nowIso = toIsoDateTime(new Date());
    const child: GoalNode = {
      id: mintGoalNodeId(),
      description,
      lifecycle: { status: 'pending' },
      acceptanceCriteria: options.acceptanceCriteria,
      children: [],
      createdAt: nowIso,
    };
    parent.children.push(child);
    plan.lastModified = nowIso;
    plan.history.push({
      timestamp: nowIso,
      goalId: child.id,
      fromStatus: 'pending',
      toStatus: 'pending',
      note: `sub-goal pushed under ${parent.id}`,
    });

    this.runInvariantCheck(plan);
    const ok = await this.persistPlan(plan);
    if (!ok) {
      throw new Error(
        `PlanManager.pushSubGoal: plan '${planId}' vanished mid-update (concurrent delete / storage rollback). Sub-goal was not persisted.`
      );
    }
    return child;
  }

  // ==================== Transition (state machine) ====================

  /**
   * Transition a node through the `GoalNodeLifecycle` state machine.
   * The unified entry point — per type-design review, one method per
   * transition would force TypeScript to re-prove the same invariants
   * four times.
   *
   * @throws {Error} if plan / node not found
   */
  async transitionNode(
    planId: PlanId | string,
    nodeId: GoalNodeId | string,
    transition: GoalNodeTransition
  ): Promise<void> {
    const plan = this.loadPlanMutable(planId);
    if (!plan) throw new Error(`PlanManager.transitionNode: plan '${planId}' not found`);

    const node = findNodeInTree(plan.rootGoal, nodeId as GoalNodeId);
    if (!node) {
      throw new Error(
        `PlanManager.transitionNode: node '${nodeId}' not found in plan '${planId}'`
      );
    }

    const nowIso = toIsoDateTime(new Date());
    const fromStatus = node.lifecycle.status;
    let newLifecycle: GoalNodeLifecycle;
    switch (transition.to) {
      case 'pending':
        newLifecycle = { status: 'pending' };
        break;
      case 'active':
        newLifecycle = { status: 'active', activatedAt: nowIso };
        // Update currentNodeId so getCurrentPath reflects the focus
        plan.currentNodeId = node.id;
        break;
      case 'complete':
        newLifecycle = transition.note
          ? { status: 'complete', completedAt: nowIso, completionNote: transition.note }
          : { status: 'complete', completedAt: nowIso };
        break;
      case 'blocked':
        validateNonEmpty(transition.reason, 'reason', 'PlanManager');
        newLifecycle = { status: 'blocked', blockedAt: nowIso, blockedReason: transition.reason };
        break;
    }
    node.lifecycle = newLifecycle;
    plan.lastModified = nowIso;
    plan.history.push({
      timestamp: nowIso,
      goalId: node.id,
      fromStatus,
      toStatus: newLifecycle.status,
      note: transition.to === 'complete' ? transition.note : undefined,
    });

    this.runInvariantCheck(plan);
    const ok = await this.persistPlan(plan);
    if (!ok) {
      throw new Error(
        `PlanManager.transitionNode: plan '${planId}' vanished mid-update (concurrent delete / storage rollback). Transition was not persisted.`
      );
    }
  }

  // ==================== Plan-level lifecycle ====================

  async markPlanComplete(
    planId: PlanId | string,
    note?: string
  ): Promise<MarkResolvedResult> {
    const plan = this.loadPlanMutable(planId);
    if (!plan) return 'not-found';
    if (plan.lifecycle.status === 'complete') return 'already-resolved';
    const nowIso = toIsoDateTime(new Date());
    plan.lifecycle = note
      ? { status: 'complete', completedAt: nowIso, completionNote: note }
      : { status: 'complete', completedAt: nowIso };
    plan.lastModified = nowIso;
    this.runInvariantCheck(plan);
    const ok = await this.persistPlan(plan);
    return ok ? 'resolved' : 'vanished-mid-update';
  }

  async abandonPlan(
    planId: PlanId | string,
    reason?: string
  ): Promise<MarkResolvedResult> {
    const plan = this.loadPlanMutable(planId);
    if (!plan) return 'not-found';
    if (plan.lifecycle.status === 'abandoned') return 'already-resolved';
    const nowIso = toIsoDateTime(new Date());
    plan.lifecycle = reason
      ? { status: 'abandoned', abandonedAt: nowIso, abandonedReason: reason }
      : { status: 'abandoned', abandonedAt: nowIso };
    plan.lastModified = nowIso;
    this.runInvariantCheck(plan);
    const ok = await this.persistPlan(plan);
    return ok ? 'resolved' : 'vanished-mid-update';
  }

  // ==================== Read ====================

  /** Find a plan by id. Returns a deep-readonly view. */
  async findPlan(planId: PlanId | string): Promise<Readonly<PlanRecord> | null> {
    return this.loadPlanReadonly(planId);
  }

  /** Find a node within a plan. Returns a readonly view. */
  async findNode(
    planId: PlanId | string,
    nodeId: GoalNodeId | string
  ): Promise<Readonly<GoalNode> | null> {
    const plan = this.loadPlanReadonly(planId);
    if (!plan) return null;
    return findNodeInTree(plan.rootGoal as GoalNode, nodeId as GoalNodeId);
  }

  /** Return the root → currentNode path. */
  async getCurrentPath(planId: PlanId | string): Promise<Readonly<GoalNode>[]> {
    const plan = this.loadPlanReadonly(planId);
    if (!plan) return [];
    const path: GoalNode[] = [];
    findPathToNode(plan.rootGoal as GoalNode, plan.currentNodeId, path);
    return path;
  }

  /**
   * Most-recent active plan for a session, or null. "Most recent" is
   * by `lastModified` descending.
   */
  async getActivePlan(sessionId: string): Promise<Readonly<PlanRecord> | null> {
    const all = await this.loadAllPlanRecords();
    // Tiebreak when multiple plans share the same lastModified ms:
    // reverse insertion order, then sort. ECMA2019+ mandates stable
    // sort, so equal keys keep their reversed order — the most-recently
    // inserted plan wins. (Tested on Node 18+; do not rely on this
    // pattern in environments without stable Array.prototype.sort.)
    const active = [...all]
      .reverse()
      .filter((p) => p.sessionId === sessionId && p.lifecycle.status === 'active')
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    return active[0] ?? null;
  }

  /** List plans with optional filters. */
  async listPlans(options: ListPlansOptions = {}): Promise<Readonly<PlanRecord>[]> {
    const all = await this.loadAllPlanRecords();
    return all.filter((p) => {
      if (options.sessionId !== undefined && p.sessionId !== options.sessionId) return false;
      if (options.agentId !== undefined && p.agentId !== options.agentId) return false;
      if (options.status !== undefined && p.lifecycle.status !== options.status) return false;
      return true;
    });
  }

  // ==================== Internal ====================

  private loadPlanMutable(planId: PlanId | string): PlanRecord | null {
    const entity = this.storage.getEntityByName(planId);
    if (!entity || !isPlanMemory(entity)) return null;
    // Deep clone so callers can mutate locally then we persist back —
    // protects against accidental shared-state mutation across calls.
    return structuredClone(entity.planRecord);
  }

  /**
   * Read-only fetch — returns the cached entity's `planRecord` directly.
   * `Readonly<>` is a compile-time-only assertion, so we don't pay the
   * `structuredClone` cost here. Mutating callers MUST use
   * `loadPlanMutable`.
   */
  private loadPlanReadonly(planId: PlanId | string): Readonly<PlanRecord> | null {
    const entity = this.storage.getEntityByName(planId);
    if (!entity || !isPlanMemory(entity)) return null;
    return entity.planRecord;
  }

  /**
   * Read-only list — same clone-free contract as `loadPlanReadonly`.
   * Consumers (`listPlans`, `getActivePlan`) only read.
   */
  private async loadAllPlanRecords(): Promise<Readonly<PlanRecord>[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isPlanMemory).map((e) => e.planRecord);
  }

  private async persistPlan(plan: PlanRecord): Promise<boolean> {
    return this.storage.updateEntity(plan.id, {
      planRecord: plan,
      lastModified: plan.lastModified,
    } as unknown as Partial<Entity>);
  }

  /**
   * Validate-after-mutate, before-persist. Order is deliberate:
   * mutations happen on a deep-cloned `PlanRecord` (via `loadPlanMutable`),
   * so an invariant failure throws without ever touching storage. The
   * clone is the rollback. If the clone is removed, this order must
   * invert (validate-before-mutate).
   */
  private runInvariantCheck(plan: PlanRecord): void {
    if (!this.validateInvariants) return;
    validatePlanInvariants(plan);
  }
}

// ==================== Helpers ====================

function mintPlanId(): PlanId {
  return `plan-${randomUUID()}` as PlanId;
}

function mintGoalNodeId(): GoalNodeId {
  return `node-${randomUUID()}` as GoalNodeId;
}

/**
 * DFS for a node by id. Cycle-protected via a visited set — defense
 * against corrupted on-disk plans where `validatePlanInvariants` has
 * not yet run (this function is called *during* mutation, before the
 * invariant check). The default `visited` set is constructed on the
 * top-level call; recursive calls pass their parent's set explicitly.
 */
function findNodeInTree(
  node: GoalNode,
  id: GoalNodeId | string,
  visited: Set<string> = new Set()
): GoalNode | null {
  if (visited.has(node.id)) return null;
  visited.add(node.id);
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNodeInTree(child, id, visited);
    if (found) return found;
  }
  return null;
}

/**
 * Find the root → target path, appending to `acc` if found. Same
 * cycle-protection rationale as `findNodeInTree`.
 */
function findPathToNode(
  node: GoalNode,
  targetId: GoalNodeId | string,
  acc: GoalNode[],
  visited: Set<string> = new Set()
): boolean {
  if (visited.has(node.id)) return false;
  visited.add(node.id);
  acc.push(node);
  if (node.id === targetId) return true;
  for (const child of node.children) {
    if (findPathToNode(child, targetId, acc, visited)) return true;
  }
  acc.pop();
  return false;
}

/**
 * Verify plan-tree invariants: unique node ids, `currentNodeId` ∈
 * tree, no cycles (no node appears under itself). Cheap O(n) walk.
 *
 * @throws {Error} on any invariant violation
 */
function validatePlanInvariants(plan: PlanRecord): void {
  const seen = new Set<string>();
  walk(plan.rootGoal, new Set<string>());
  if (!seen.has(plan.currentNodeId)) {
    throw new Error(
      `PlanManager invariant: currentNodeId '${plan.currentNodeId}' not found in tree of plan '${plan.id}'`
    );
  }

  function walk(node: GoalNode, ancestors: Set<string>): void {
    if (seen.has(node.id)) {
      throw new Error(`PlanManager invariant: duplicate node id '${node.id}' in plan '${plan.id}'`);
    }
    if (ancestors.has(node.id)) {
      throw new Error(`PlanManager invariant: cycle detected at node '${node.id}' in plan '${plan.id}'`);
    }
    seen.add(node.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.id);
    for (const child of node.children) {
      walk(child, nextAncestors);
    }
  }
}
