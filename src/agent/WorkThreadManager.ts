/**
 * Work Thread Manager
 *
 * Manages work threads for coordinating tasks across agents.
 * Threads are stored as entities with entityType 'work_thread',
 * using relations for parent-child and blocking relationships.
 *
 * @module agent/WorkThreadManager
 */

import type { IGraphStorage, Entity, Relation } from '../types/types.js';

// ==================== Types ====================

/**
 * Valid statuses for a work thread.
 * - open: Available for claiming
 * - active: Currently being worked on
 * - blocked: Waiting on other threads
 * - done: Completed (terminal)
 * - cancelled: Cancelled (terminal)
 */
export type WorkThreadStatus = 'open' | 'active' | 'blocked' | 'done' | 'cancelled';

/**
 * Represents a unit of work that can be assigned, tracked, and coordinated.
 */
export interface WorkThread {
  /** Unique thread identifier (thread_{timestamp}_{random}) */
  id: string;
  /** Short title describing the work */
  title: string;
  /** Optional longer description */
  description?: string;
  /** Current status */
  status: WorkThreadStatus;
  /** Agent ID currently working on this thread */
  owner?: string;
  /** Parent thread ID for decomposition */
  parentId?: string;
  /** IDs of threads blocking this one */
  blockedBy?: string[];
  /** Priority level (0-10, higher = more important) */
  priority?: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Filter criteria for listing work threads.
 */
export interface WorkThreadFilter {
  /** Filter by status (single or multiple) */
  status?: WorkThreadStatus | WorkThreadStatus[];
  /** Filter by owner agent ID */
  owner?: string;
  /** Filter by parent thread ID */
  parentId?: string;
}

/**
 * Options for creating a work thread.
 */
export interface CreateWorkThreadOptions {
  /** Optional description */
  description?: string;
  /** Parent thread ID for decomposition */
  parentId?: string;
  /** Priority level (0-10) */
  priority?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// ==================== Constants ====================

/** Valid state transitions for work threads */
const VALID_TRANSITIONS: Record<WorkThreadStatus, WorkThreadStatus[]> = {
  'open': ['active', 'cancelled'],
  'active': ['blocked', 'done', 'cancelled', 'open'],
  'blocked': ['active', 'cancelled'],
  'done': [],
  'cancelled': [],
};

/** Relation type for parent-child thread relationships */
const CHILD_OF_RELATION = 'child_of';

/** Relation type for blocking relationships */
const BLOCKED_BY_RELATION = 'blocked_by';

/** Entity type for work thread entities */
const WORK_THREAD_ENTITY_TYPE = 'work_thread';

// ==================== Manager ====================

/**
 * Manages work thread lifecycle and coordination.
 *
 * Work threads are persisted as entities in the knowledge graph with
 * relations representing parent-child and blocking dependencies.
 *
 * @example
 * ```typescript
 * const manager = new WorkThreadManager(storage);
 *
 * // Create and claim a thread
 * const thread = await manager.create('Implement feature X');
 * const claimed = await manager.claim(thread.id, 'agent_1');
 *
 * // Complete the thread
 * await manager.complete(thread.id);
 * ```
 */
export class WorkThreadManager {
  private threads: Map<string, WorkThread> = new Map();

  constructor(private storage: IGraphStorage) {}

  /**
   * Create a new work thread.
   *
   * @param title - Short title describing the work
   * @param options - Optional creation parameters
   * @returns The created work thread
   * @throws Error if parentId references a non-existent thread
   */
  async create(title: string, options?: CreateWorkThreadOptions): Promise<WorkThread> {
    // Validate parent exists if specified
    if (options?.parentId && !this.threads.has(options.parentId)) {
      throw new Error(`Parent thread not found: ${options.parentId}`);
    }

    // Validate priority range
    if (options?.priority !== undefined && (options.priority < 0 || options.priority > 10)) {
      throw new Error(`Priority must be between 0 and 10, got ${options.priority}`);
    }

    const now = new Date().toISOString();
    const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const thread: WorkThread = {
      id,
      title,
      description: options?.description,
      status: 'open',
      parentId: options?.parentId,
      priority: options?.priority,
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata,
    };

    // Store in memory
    this.threads.set(id, thread);

    // Persist as entity
    const entity: Entity = {
      name: id,
      entityType: WORK_THREAD_ENTITY_TYPE,
      observations: [JSON.stringify(this.serializeThread(thread))],
      createdAt: now,
      lastModified: now,
    };
    await this.storage.appendEntity(entity);

    // Create parent-child relation if applicable
    if (options?.parentId) {
      const relation: Relation = {
        from: id,
        to: options.parentId,
        relationType: CHILD_OF_RELATION,
      };
      await this.storage.appendRelation(relation);
    }

    return { ...thread };
  }

  /**
   * Claim a thread by setting its owner and transitioning to active.
   *
   * @param threadId - Thread to claim
   * @param agentId - Agent claiming the thread
   * @returns Updated work thread
   * @throws Error if thread not found, already owned, or invalid transition
   */
  async claim(threadId: string, agentId: string): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.owner) {
      throw new Error(`Thread ${threadId} is already owned by ${thread.owner}`);
    }

    if (!this.canTransition(threadId, 'active')) {
      throw new Error(`Cannot transition thread ${threadId} from '${thread.status}' to 'active'`);
    }

    thread.owner = agentId;
    thread.status = 'active';
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);
    return { ...thread };
  }

  /**
   * Release a thread by removing its owner and transitioning back to open.
   *
   * @param threadId - Thread to release
   * @returns Updated work thread
   * @throws Error if thread not found or not active
   */
  async release(threadId: string): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (!this.canTransition(threadId, 'open')) {
      throw new Error(`Cannot release thread ${threadId} from '${thread.status}' status`);
    }

    thread.owner = undefined;
    thread.status = 'open';
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);
    return { ...thread };
  }

  /**
   * Complete a thread (terminal state).
   *
   * @param threadId - Thread to complete
   * @returns Updated work thread
   * @throws Error if thread not found or invalid transition
   */
  async complete(threadId: string): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (!this.canTransition(threadId, 'done')) {
      throw new Error(`Cannot complete thread ${threadId} from '${thread.status}' status`);
    }

    thread.status = 'done';
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);
    return { ...thread };
  }

  /**
   * Cancel a thread (terminal state).
   *
   * @param threadId - Thread to cancel
   * @returns Updated work thread
   * @throws Error if thread not found or invalid transition
   */
  async cancel(threadId: string): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (!this.canTransition(threadId, 'cancelled')) {
      throw new Error(`Cannot cancel thread ${threadId} from '${thread.status}' status`);
    }

    thread.status = 'cancelled';
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);
    return { ...thread };
  }

  /**
   * Block a thread with dependencies on other threads.
   *
   * @param threadId - Thread to block
   * @param blockedBy - IDs of threads that are blocking this one
   * @returns Updated work thread
   * @throws Error if thread not found, invalid transition, or cycle detected
   */
  async block(threadId: string, blockedBy: string[]): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Validate all blocker threads exist
    for (const blockerId of blockedBy) {
      if (!this.threads.has(blockerId)) {
        throw new Error(`Blocker thread not found: ${blockerId}`);
      }
    }

    if (!this.canTransition(threadId, 'blocked')) {
      throw new Error(`Cannot block thread ${threadId} from '${thread.status}' status`);
    }

    // Check for cycles
    if (this.detectCycles(threadId, blockedBy)) {
      throw new Error(`Blocking would create a circular dependency`);
    }

    thread.status = 'blocked';
    thread.blockedBy = [...blockedBy];
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);

    // Create blocked_by relations
    for (const blockerId of blockedBy) {
      const relation: Relation = {
        from: threadId,
        to: blockerId,
        relationType: BLOCKED_BY_RELATION,
      };
      await this.storage.appendRelation(relation);
    }

    return { ...thread };
  }

  /**
   * Unblock a thread if all blocking threads are resolved.
   *
   * Transitions to 'active' if the thread has an owner, or 'open' if not.
   *
   * @param threadId - Thread to unblock
   * @returns Updated work thread
   * @throws Error if thread not found, not blocked, or blockers still pending
   */
  async unblock(threadId: string): Promise<WorkThread> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.status !== 'blocked') {
      throw new Error(`Thread ${threadId} is not blocked (status: '${thread.status}')`);
    }

    // Check if all blockers are resolved
    const unresolvedBlockers: string[] = [];
    if (thread.blockedBy) {
      for (const blockerId of thread.blockedBy) {
        const blocker = this.threads.get(blockerId);
        if (blocker && blocker.status !== 'done' && blocker.status !== 'cancelled') {
          unresolvedBlockers.push(blockerId);
        }
      }
    }

    if (unresolvedBlockers.length > 0) {
      throw new Error(
        `Thread ${threadId} still blocked by unresolved threads: ${unresolvedBlockers.join(', ')}`
      );
    }

    // Transition based on whether thread has an owner
    thread.status = thread.owner ? 'active' : 'open';
    thread.blockedBy = undefined;
    thread.updatedAt = new Date().toISOString();

    await this.persistThread(thread);

    // Remove blocked_by relations
    const graph = await this.storage.getGraphForMutation();
    graph.relations = graph.relations.filter(
      (r) => !(r.from === threadId && r.relationType === BLOCKED_BY_RELATION)
    );
    await this.storage.saveGraph(graph);

    return { ...thread };
  }

  /**
   * Get a thread by ID.
   *
   * @param threadId - Thread identifier
   * @returns Work thread or undefined if not found
   */
  get(threadId: string): WorkThread | undefined {
    const thread = this.threads.get(threadId);
    return thread ? { ...thread } : undefined;
  }

  /**
   * List threads with optional filters.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching work threads
   */
  list(filter?: WorkThreadFilter): WorkThread[] {
    let results = Array.from(this.threads.values());

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((t) => statuses.includes(t.status));
    }

    if (filter?.owner !== undefined) {
      results = results.filter((t) => t.owner === filter.owner);
    }

    if (filter?.parentId !== undefined) {
      results = results.filter((t) => t.parentId === filter.parentId);
    }

    return results.map((t) => ({ ...t }));
  }

  /**
   * Get child threads of a parent thread.
   *
   * @param parentId - Parent thread ID
   * @returns Array of child work threads
   */
  getChildren(parentId: string): WorkThread[] {
    return this.list({ parentId });
  }

  /**
   * Check if a thread can transition to a new status.
   *
   * @param threadId - Thread to check
   * @param newStatus - Target status
   * @returns True if transition is valid
   */
  canTransition(threadId: string, newStatus: WorkThreadStatus): boolean {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return false;
    }
    return VALID_TRANSITIONS[thread.status].includes(newStatus);
  }

  // ==================== Private Methods ====================

  /**
   * Detect cycles in blocker dependencies using BFS.
   *
   * @param threadId - The thread being blocked
   * @param blockedBy - Proposed blocker thread IDs
   * @returns True if adding these blockers would create a cycle
   */
  private detectCycles(threadId: string, blockedBy: string[]): boolean {
    // BFS from each blocker, following their blockedBy chains
    const visited = new Set<string>();
    const queue = [...blockedBy];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === threadId) {
        return true; // Cycle detected
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const currentThread = this.threads.get(current);
      if (currentThread?.blockedBy) {
        for (const dep of currentThread.blockedBy) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    return false;
  }

  /**
   * Persist a thread's state to storage by updating its entity observation.
   */
  private async persistThread(thread: WorkThread): Promise<void> {
    await this.storage.updateEntity(thread.id, {
      observations: [JSON.stringify(this.serializeThread(thread))],
      lastModified: thread.updatedAt,
    });
  }

  /**
   * Serialize a thread to a plain object for JSON storage.
   */
  private serializeThread(thread: WorkThread): Record<string, unknown> {
    const data: Record<string, unknown> = {
      title: thread.title,
      status: thread.status,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };

    if (thread.description !== undefined) data.description = thread.description;
    if (thread.owner !== undefined) data.owner = thread.owner;
    if (thread.parentId !== undefined) data.parentId = thread.parentId;
    if (thread.blockedBy !== undefined) data.blockedBy = thread.blockedBy;
    if (thread.priority !== undefined) data.priority = thread.priority;
    if (thread.metadata !== undefined) data.metadata = thread.metadata;

    return data;
  }
}
