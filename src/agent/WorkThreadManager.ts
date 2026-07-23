/**
 * Work Thread Manager
 *
 * Manages work threads for coordinating tasks across agents. Threads are
 * persisted as real graph structure instead of JSON blobs, so thread
 * content is queryable and traversable:
 *
 * - Each thread is an `entityType: 'work_thread'` entity (name =
 *   `thread.id`). Its observations carry human-readable scalar lines
 *   (`[title]: Ship feature X`, `[status]: active`, `[owner]: agent_1`,
 *   `[priority]: 8`, `[created-at]: …`, `[updated-at]: …`) plus the
 *   free-text description as a plain observation.
 * - Custom metadata encodes one `[meta]: <JSON-key>=<JSON-value>` line per
 *   entry — key and value are JSON-encoded separately so arbitrary strings
 *   (equals signs, newlines, unicode) roundtrip.
 * - Cross-thread references are real relations, not payload fields:
 *   thread —`child_of`→ parent thread, and thread —`blocked_by`→ each
 *   blocker thread. `load()` rehydrates `parentId` / `blockedBy` from
 *   those relations.
 *
 * Legacy single-JSON-observation threads (the pre-decomposition shape)
 * remain decodable via `decodeLegacyWorkThread` and are auto-migrated to
 * the decomposed shape on `load()`; use `migrateLegacyWorkThreads` for
 * bulk migration.
 *
 * @module agent/WorkThreadManager
 */

import { randomBytes } from 'crypto';
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
export const CHILD_OF_RELATION = 'child_of';

/** Relation type for blocking relationships */
export const BLOCKED_BY_RELATION = 'blocked_by';

/** Entity type for work thread entities */
export const WORK_THREAD_ENTITY_TYPE = 'work_thread';

/** Scalar observation prefixes on the thread entity. */
const TITLE_PREFIX = '[title]: ';
const STATUS_PREFIX = '[status]: ';
const OWNER_PREFIX = '[owner]: ';
const PRIORITY_PREFIX = '[priority]: ';
const CREATED_AT_PREFIX = '[created-at]: ';
const UPDATED_AT_PREFIX = '[updated-at]: ';
const META_PREFIX = '[meta]: ';

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
   * Load existing work threads from storage into memory.
   *
   * Scans the graph for entities with entityType 'work_thread' and
   * rehydrates the in-memory Map from their scalar observation lines,
   * deriving `parentId` / `blockedBy` from `child_of` / `blocked_by`
   * relations. Must be called after construction to restore state from a
   * previous session.
   *
   * **Side effect (auto-migration):** threads still stored in the legacy
   * single-JSON-observation shape are decoded with the legacy decoder and
   * rewritten in place to the decomposed shape (scalar lines + relations)
   * before returning.
   *
   * @returns Number of threads loaded
   */
  async load(): Promise<number> {
    const graph = await this.storage.loadGraph();

    // Index relations once: parent + blockers per thread entity, plus a
    // presence set so legacy migration can append only missing relations.
    const threadNames = new Set<string>();
    for (const entity of graph.entities) {
      if (entity.entityType === WORK_THREAD_ENTITY_TYPE) threadNames.add(entity.name);
    }
    const parentOf = new Map<string, string>();
    const blockersOf = new Map<string, string[]>();
    const existingRelations = new Set<string>();
    for (const relation of graph.relations) {
      existingRelations.add(relationKey(relation));
      if (!threadNames.has(relation.from)) continue;
      if (relation.relationType === CHILD_OF_RELATION) {
        if (!parentOf.has(relation.from)) parentOf.set(relation.from, relation.to);
      } else if (relation.relationType === BLOCKED_BY_RELATION) {
        const blockers = blockersOf.get(relation.from) ?? [];
        blockers.push(relation.to);
        blockersOf.set(relation.from, blockers);
      }
    }

    let loaded = 0;
    const legacyThreads: WorkThread[] = [];

    for (const entity of graph.entities) {
      if (entity.entityType !== WORK_THREAD_ENTITY_TYPE) continue;
      if (!entity.observations || entity.observations.length === 0) continue;

      let thread: WorkThread | null;
      if (isLegacyWorkThreadEncoding(entity.observations)) {
        thread = decodeLegacyWorkThread(entity.name, entity.observations);
        if (thread) legacyThreads.push(thread);
      } else {
        thread = decodeThreadObservations(
          entity,
          parentOf.get(entity.name),
          blockersOf.get(entity.name)
        );
      }

      if (!thread) continue; // Skip entities with malformed observation data
      this.threads.set(entity.name, thread);
      loaded++;
    }

    // Auto-migrate legacy blobs in place: rewrite observations to the
    // decomposed shape and ensure the relations the payload implied exist
    // (they normally already do — the old code also created them).
    for (const thread of legacyThreads) {
      await this.persistThread(thread);
      const implied: Relation[] = [];
      if (thread.parentId !== undefined) {
        implied.push({ from: thread.id, to: thread.parentId, relationType: CHILD_OF_RELATION });
      }
      for (const blockerId of thread.blockedBy ?? []) {
        implied.push({ from: thread.id, to: blockerId, relationType: BLOCKED_BY_RELATION });
      }
      for (const relation of implied) {
        const key = relationKey(relation);
        if (!existingRelations.has(key)) {
          await this.storage.appendRelation(relation);
          existingRelations.add(key);
        }
      }
    }

    return loaded;
  }

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
    const id = `thread_${Date.now()}_${randomBytes(4).toString('hex')}`;

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
      observations: encodeThreadObservations(thread),
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

    // Remove blocked_by relations via loadGraph (read-only) + targeted save
    const graph = await this.storage.loadGraph();
    const relationsToRemove = graph.relations.filter(
      (r) => r.from === threadId && r.relationType === BLOCKED_BY_RELATION
    );
    if (relationsToRemove.length > 0) {
      const mutableGraph = await this.storage.getGraphForMutation();
      const removeSet = new Set(relationsToRemove.map(relationKey));
      mutableGraph.relations = mutableGraph.relations.filter(
        (r) => !removeSet.has(relationKey(r))
      );
      await this.storage.saveGraph(mutableGraph);
    }

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
   * Persist a thread's state to storage by rewriting its scalar
   * observation lines. Relations (`child_of` / `blocked_by`) are managed
   * by `create` / `block` / `unblock`, not here.
   */
  private async persistThread(thread: WorkThread): Promise<void> {
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked by callers; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
    await this.storage.updateEntity(thread.id, {
      observations: encodeThreadObservations(thread),
      lastModified: thread.updatedAt,
    });
  }
}

// ==================== Bulk Migration ====================

/**
 * Scan every `entityType: 'work_thread'` entity and migrate any that
 * still use the legacy single-JSON-observation encoding to the
 * decomposed shape (scalar observation lines + `child_of` / `blocked_by`
 * relations). Mirrors `migrateLegacyProcedures`.
 *
 * @returns Number of threads migrated.
 */
export async function migrateLegacyWorkThreads(storage: IGraphStorage): Promise<number> {
  const graph = await storage.loadGraph();
  const legacyCount = graph.entities.filter(
    (e) =>
      e.entityType === WORK_THREAD_ENTITY_TYPE &&
      e.observations !== undefined &&
      e.observations.length > 0 &&
      isLegacyWorkThreadEncoding(e.observations)
  ).length;

  if (legacyCount > 0) {
    // load() auto-migrates legacy entities in place.
    await new WorkThreadManager(storage).load();
  }
  return legacyCount;
}

// ==================== Encoding / Decoding ====================

/** Composite identity key for a relation (used for dedup / removal). */
function relationKey(relation: Relation): string {
  return `${relation.from}\0${relation.to}\0${relation.relationType}`;
}

/** True when the thread status string is one of the known statuses. */
function isWorkThreadStatus(value: string): value is WorkThreadStatus {
  return value in VALID_TRANSITIONS;
}

/**
 * True when the observation list still uses the legacy shape: a single
 * JSON-object blob and no decomposed `[status]:` scalar line.
 */
function isLegacyWorkThreadEncoding(observations: string[]): boolean {
  if (observations.some((obs) => obs.startsWith(STATUS_PREFIX))) return false;
  const first = observations[0];
  if (typeof first !== 'string' || !first.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(first);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Observation list for a thread entity: scalar `[key]: value` lines, the
 * free-text description as a plain observation, and one
 * `[meta]: <JSON-key>=<JSON-value>` line per metadata entry.
 *
 * Note: an empty-string description and metadata entries whose values
 * JSON cannot represent (`undefined`, functions, symbols) are omitted —
 * the legacy JSON blob dropped the latter too.
 */
function encodeThreadObservations(thread: WorkThread): string[] {
  const observations: string[] = [
    `${TITLE_PREFIX}${thread.title}`,
    `${STATUS_PREFIX}${thread.status}`,
  ];
  if (thread.description !== undefined && thread.description !== '') {
    observations.push(thread.description);
  }
  if (thread.owner !== undefined) {
    observations.push(`${OWNER_PREFIX}${thread.owner}`);
  }
  if (thread.priority !== undefined) {
    observations.push(`${PRIORITY_PREFIX}${thread.priority}`);
  }
  observations.push(`${CREATED_AT_PREFIX}${thread.createdAt}`);
  observations.push(`${UPDATED_AT_PREFIX}${thread.updatedAt}`);
  for (const [key, value] of Object.entries(thread.metadata ?? {})) {
    const encodedValue = JSON.stringify(value);
    if (encodedValue === undefined) continue;
    observations.push(`${META_PREFIX}${JSON.stringify(key)}=${encodedValue}`);
  }
  return observations;
}

/**
 * Inverse of `encodeThreadObservations`. `parentId` / `blockedBy` come
 * from the caller (derived from `child_of` / `blocked_by` relations).
 * Returns null when the entity has no valid `[status]:` line — the marker
 * of the decomposed shape.
 */
function decodeThreadObservations(
  entity: Entity,
  parentId: string | undefined,
  blockedBy: string[] | undefined
): WorkThread | null {
  let title = '';
  let status: WorkThreadStatus | undefined;
  let owner: string | undefined;
  let priority: number | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let metadata: Record<string, unknown> | undefined;
  const descriptionLines: string[] = [];

  for (const obs of entity.observations) {
    if (obs.startsWith(TITLE_PREFIX)) {
      title = obs.slice(TITLE_PREFIX.length);
    } else if (obs.startsWith(STATUS_PREFIX)) {
      const value = obs.slice(STATUS_PREFIX.length);
      if (isWorkThreadStatus(value)) status = value;
    } else if (obs.startsWith(OWNER_PREFIX)) {
      owner = obs.slice(OWNER_PREFIX.length);
    } else if (obs.startsWith(PRIORITY_PREFIX)) {
      const n = Number(obs.slice(PRIORITY_PREFIX.length));
      if (Number.isFinite(n)) priority = n;
    } else if (obs.startsWith(CREATED_AT_PREFIX)) {
      createdAt = obs.slice(CREATED_AT_PREFIX.length);
    } else if (obs.startsWith(UPDATED_AT_PREFIX)) {
      updatedAt = obs.slice(UPDATED_AT_PREFIX.length);
    } else if (obs.startsWith(META_PREFIX)) {
      const kv = decodeMetaLine(obs.slice(META_PREFIX.length));
      if (kv) (metadata ??= {})[kv[0]] = kv[1];
    } else {
      descriptionLines.push(obs);
    }
  }

  if (status === undefined) return null;

  const fallbackTimestamp = entity.createdAt ?? entity.lastModified ?? new Date().toISOString();
  return {
    id: entity.name,
    title,
    description: descriptionLines.length > 0 ? descriptionLines.join('\n') : undefined,
    status,
    owner,
    parentId,
    blockedBy: blockedBy && blockedBy.length > 0 ? [...blockedBy] : undefined,
    priority,
    createdAt: createdAt ?? fallbackTimestamp,
    updatedAt: updatedAt ?? entity.lastModified ?? createdAt ?? fallbackTimestamp,
    metadata,
  };
}

/**
 * Split `<JSON-string>=<JSON-value>` at the `=` separating the key from
 * the value (never inside the key — `"` inside a JSON string is escaped,
 * so a simple escape-aware scan finds the key's closing quote). Returns
 * null on malformed input.
 */
function decodeMetaLine(body: string): [string, unknown] | null {
  if (!body.startsWith('"')) return null;
  let i = 1;
  while (i < body.length && body[i] !== '"') {
    i += body[i] === '\\' ? 2 : 1;
  }
  if (i >= body.length || body[i + 1] !== '=') return null;
  try {
    const key: unknown = JSON.parse(body.slice(0, i + 1));
    const value: unknown = JSON.parse(body.slice(i + 2));
    if (typeof key !== 'string') return null;
    return [key, value];
  } catch {
    return null;
  }
}

/**
 * Pure decoder for the legacy single-JSON-observation thread shape
 * (`JSON.stringify({ title, status, … })` in `observations[0]`).
 *
 * @deprecated Legacy decoder — kept for reading pre-decomposition
 * entities. `WorkThreadManager.load()` auto-migrates such entities; new
 * code should go through `WorkThreadManager`.
 */
export function decodeLegacyWorkThread(
  id: string,
  observations: string[]
): WorkThread | null {
  if (observations.length === 0) return null;
  try {
    const data = JSON.parse(observations[0]) as Record<string, unknown>;
    if (typeof data !== 'object' || data === null) return null;
    return {
      id,
      title: data.title as string,
      description: data.description as string | undefined,
      status: data.status as WorkThreadStatus,
      owner: data.owner as string | undefined,
      parentId: data.parentId as string | undefined,
      blockedBy: data.blockedBy as string[] | undefined,
      priority: data.priority as number | undefined,
      createdAt: data.createdAt as string,
      updatedAt: data.updatedAt as string,
      metadata: data.metadata as Record<string, unknown> | undefined,
    };
  } catch {
    return null;
  }
}
