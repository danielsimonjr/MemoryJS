/**
 * Entity Manager
 *
 * Handles CRUD operations for entities in the knowledge graph.
 * Focused on core entity and tag operations only (Phase 4: Consolidate God Objects).
 *
 * @module core/EntityManager
 */

import { randomUUID } from 'node:crypto';
import type { Entity, LongRunningOperationOptions, AccessContext } from '../types/index.js';
import type { GraphStorage } from './GraphStorage.js';
import type { AccessTracker } from '../agent/AccessTracker.js';
import {
  EntityNotFoundError,
  InvalidImportanceError,
  ValidationError,
  VersionConflictError,
} from '../utils/errors.js';
import type { RefIndex, RefEntry } from './RefIndex.js';
import { EntityStateMachine } from './EntityStateMachine.js';
import { GovernanceError, type GovernancePolicy } from '../features/GovernanceManager.js';
import { logger } from '../utils/logger.js';

// Stateless validator — hoisted to a singleton so updateEntity doesn't
// allocate one per call.
const ENTITY_STATE_MACHINE = new EntityStateMachine();

/**
 * Options for constructing an EntityManager.
 */
export interface EntityManagerOptions {
  /** Default projectId to stamp on new entities without an explicit projectId. */
  defaultProjectId?: string;
}

/**
 * Audit event emitted by governance hooks after a successful mutation.
 * Mirrors the `AuditLog.append` shape minus id/timestamp/status.
 */
export interface GovernanceAuditEvent {
  operation: 'create' | 'update' | 'delete';
  entityName: string;
  /** Entity snapshot before the mutation (absent for creates). */
  before?: object;
  /** Entity snapshot after the mutation (absent for deletes). */
  after?: object;
}

/**
 * Governance enforcement hooks (Sec1 chokepoint).
 *
 * Reuses the {@link GovernancePolicy} shape for the `canCreate` /
 * `canUpdate` / `canDelete` checks — do NOT define a parallel policy
 * type. `ManagerContext` wires these from its `GovernanceManager` when
 * `MEMORY_GOVERNANCE_ENABLED=true` (strict literal); manual callers can
 * inject their own via {@link EntityManager.setGovernanceHooks}.
 *
 * **Audit contract:** `audit` is invoked fire-and-forget after each
 * successful mutation. Failures are swallowed and logged as warnings —
 * an audit-sink outage must never fail (or roll back) a write that
 * already succeeded. Callers needing hard audit guarantees should route
 * writes through `GovernanceManager.withTransaction` instead, which
 * awaits its audit appends.
 */
export interface GovernanceHooks extends GovernancePolicy {
  /** Fire-and-forget audit sink. See the interface JSDoc for the contract. */
  audit?: (event: GovernanceAuditEvent) => void | Promise<unknown>;
}

/**
 * Options for entity retrieval with access tracking support.
 */
export interface GetEntityOptions {
  /** Enable access tracking for retrieved entity */
  trackAccess?: boolean;
  /** Session ID for access context */
  sessionId?: string;
  /** Task ID for access context */
  taskId?: string;
}
import {
  BatchCreateEntitiesSchema,
  UpdateEntitySchema,
  EntityNamesSchema,
  checkCancellation,
  createProgressReporter,
  createProgress,
} from '../utils/index.js';
import { GRAPH_LIMITS } from '../utils/constants.js';

/**
 * Minimum importance value (least important).
 * Note: Use IMPORTANCE_RANGE from constants.ts for external access.
 */
const MIN_IMPORTANCE = 0;

/**
 * Maximum importance value (most important).
 * Note: Use IMPORTANCE_RANGE from constants.ts for external access.
 */
const MAX_IMPORTANCE = 10;

/**
 * Manages entity operations with automatic timestamp handling.
 */
export class EntityManager {
  private accessTracker?: AccessTracker;
  private refIndex?: RefIndex;
  private defaultProjectId?: string;
  private governanceHooks?: GovernanceHooks;

  constructor(
    private storage: GraphStorage,
    options?: EntityManagerOptions
  ) {
    this.defaultProjectId = options?.defaultProjectId;
  }

  /**
   * Set the AccessTracker for optional access tracking.
   * When set, getEntity can track access to retrieved entities.
   *
   * @param tracker - AccessTracker instance
   */
  setAccessTracker(tracker: AccessTracker): void {
    this.accessTracker = tracker;
  }

  // ==================== S2 delta-primitive compat shims ====================
  //
  // Both first-party backends (GraphStorage, SQLiteStorage) implement the
  // batch delta primitives. Third-party / test IGraphStorage
  // implementations may predate them, so each shim falls back to the
  // universally available single-item primitives (or the legacy
  // full-graph save for deletes) when the batch method is absent.

  /** Append a batch of entities, preferring the storage's batch primitive. */
  private async appendEntitiesCompat(entities: Entity[]): Promise<void> {
    if (typeof (this.storage as Partial<GraphStorage>).appendEntities === 'function') {
      await this.storage.appendEntities(entities);
      return;
    }
    for (const entity of entities) {
      await this.storage.appendEntity(entity);
    }
  }

  /** Update a batch of entities, preferring the storage's batch primitive. */
  private async updateEntitiesCompat(
    batch: Array<{ name: string; updates: Partial<Entity> }>,
    options?: { timestamp?: string },
  ): Promise<Entity[]> {
    if (typeof (this.storage as Partial<GraphStorage>).updateEntities === 'function') {
      return this.storage.updateEntities(batch, options);
    }
    // Fallback: validate all names first (all-or-nothing parity), then
    // apply one by one via the legacy single-entity primitive.
    for (const { name } of batch) {
      if (!this.storage.hasEntity(name)) {
        throw new EntityNotFoundError(name);
      }
    }
    const updated: Entity[] = [];
    for (const { name, updates: entityUpdates } of batch) {
      const found = await this.storage.updateEntity(name, entityUpdates);
      if (!found) throw new EntityNotFoundError(name);
      const live = this.storage.getEntityByName(name);
      if (live) updated.push(live);
    }
    return updated;
  }

  /** Delete entities (cascading relations), preferring the storage's delta primitive. */
  private async deleteEntitiesCompat(entityNames: string[]): Promise<void> {
    if (typeof (this.storage as Partial<GraphStorage>).deleteEntities === 'function') {
      await this.storage.deleteEntities(entityNames);
      return;
    }
    // Legacy fallback: full-graph rewrite.
    const graph = await this.storage.getGraphForMutation();
    const namesToDelete = new Set(entityNames);
    graph.entities = graph.entities.filter(e => !namesToDelete.has(e.name));
    graph.relations = graph.relations.filter(
      r => !namesToDelete.has(r.from) && !namesToDelete.has(r.to)
    );
    await this.storage.saveGraph(graph);
  }

  /**
   * Set the RefIndex for stable alias dereferencing.
   *
   * @param index - RefIndex instance
   */
  setRefIndex(index: RefIndex): void {
    this.refIndex = index;
  }

  /**
   * Inject governance enforcement hooks (Sec1 chokepoint).
   *
   * When set, every mutation on this manager consults the corresponding
   * policy check first (`createEntities` → `canCreate` per entity,
   * `updateEntity` / `batchUpdate` → `canUpdate(existing, updates)`,
   * `deleteEntities` → `canDelete`, `renameEntity` → `canUpdate`) and
   * throws {@link GovernanceError} naming the denied entity when a check
   * returns false. After each successful mutation the `audit` hook is
   * invoked fire-and-forget (failures swallowed + warned — see
   * {@link GovernanceHooks}).
   *
   * Default (never called / called with `undefined`): zero behavioral
   * change and zero overhead — no hook object means no checks and no
   * audit calls on any path.
   *
   * @param hooks - Hooks to install, or `undefined` to remove
   */
  setGovernanceHooks(hooks: GovernanceHooks | undefined): void {
    this.governanceHooks = hooks;
  }

  /**
   * Invoke the audit hook fire-and-forget. Synchronous throws and async
   * rejections are both swallowed (warn-logged) so audit failures never
   * fail the write that already succeeded.
   */
  private fireAudit(event: GovernanceAuditEvent): void {
    const audit = this.governanceHooks?.audit;
    if (!audit) return;
    const warn = (err: unknown): void => {
      logger.warn(
        `[EntityManager] governance audit hook failed for ${event.operation} "${event.entityName}" ` +
          `(the write itself succeeded): ${err instanceof Error ? err.message : String(err)}`,
      );
    };
    try {
      void Promise.resolve(audit(event)).catch(warn);
    } catch (err) {
      warn(err);
    }
  }

  /**
   * Resolve a stable alias (ref) to the full entity it points to.
   *
   * @param ref - The alias to resolve
   * @returns The entity, or null if the alias is unknown or entity no longer exists
   * @throws {ValidationError} If no RefIndex is configured
   */
  async resolveRef(ref: string): Promise<Entity | null> {
    if (!this.refIndex) {
      throw new ValidationError('RefIndex not configured', [
        'Call setRefIndex() before using resolveRef()',
      ]);
    }
    const entityName = await this.refIndex.resolve(ref);
    if (entityName === null) return null;
    return this.getEntity(entityName);
  }

  /**
   * Register a stable alias pointing to an entity.
   *
   * @param ref - The alias string
   * @param entityName - Entity name the alias points to
   * @param description - Optional human-readable description
   * @returns The created RefEntry
   * @throws {ValidationError} If no RefIndex is configured
   * @throws {RefConflictError} If the alias is already registered
   */
  async registerRef(ref: string, entityName: string, description?: string): Promise<RefEntry> {
    if (!this.refIndex) {
      throw new ValidationError('RefIndex not configured', [
        'Call setRefIndex() before using registerRef()',
      ]);
    }
    return this.refIndex.register(ref, entityName, description);
  }

  /**
   * Remove a stable alias.
   *
   * @param ref - The alias to remove
   * @throws {ValidationError} If no RefIndex is configured
   */
  async deregisterRef(ref: string): Promise<void> {
    if (!this.refIndex) {
      throw new ValidationError('RefIndex not configured', [
        'Call setRefIndex() before using deregisterRef()',
      ]);
    }
    return this.refIndex.deregister(ref);
  }

  /**
   * List all registered aliases, optionally filtered to one entity.
   *
   * @param entityName - When given, only aliases pointing at this entity
   * @returns Array of RefEntry objects
   * @throws {ValidationError} If no RefIndex is configured
   */
  async listRefs(entityName?: string): Promise<RefEntry[]> {
    if (!this.refIndex) {
      throw new ValidationError('RefIndex not configured', [
        'Call setRefIndex() before using listRefs()',
      ]);
    }
    return this.refIndex.listRefs(entityName);
  }

  /**
   * Create multiple entities in a single batch operation.
   *
   * This method performs the following operations:
   * - Filters out entities that already exist (duplicate names)
   * - Automatically adds createdAt and lastModified timestamps
   * - Normalizes all tags to lowercase for consistent searching
   * - Validates importance values (must be between 0-10)
   *
   * Phase 9B: Supports progress tracking and cancellation via LongRunningOperationOptions.
   *
   * @param entities - Array of entities to create. Each entity must have a unique name.
   * @param options - Optional progress/cancellation options (Phase 9B)
   * @returns Promise resolving to array of newly created entities (excludes duplicates)
   * @throws {InvalidImportanceError} If any entity has importance outside the valid range [0-10]
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Create single entity
   * const results = await manager.createEntities([{
   *   name: 'Alice',
   *   entityType: 'person',
   *   observations: ['Works as engineer', 'Lives in Seattle'],
   *   importance: 7,
   *   tags: ['Team', 'Engineering']
   * }]);
   *
   * // Create multiple entities at once
   * const users = await manager.createEntities([
   *   { name: 'Bob', entityType: 'person', observations: [] },
   *   { name: 'Charlie', entityType: 'person', observations: [] }
   * ]);
   *
   * // With progress tracking and cancellation (Phase 9B)
   * const controller = new AbortController();
   * const results = await manager.createEntities(largeEntityArray, {
   *   signal: controller.signal,
   *   onProgress: (p) => console.log(`${p.percentage}% complete`),
   * });
   * ```
   */
  async createEntities(
    entities: Entity[],
    options?: LongRunningOperationOptions
  ): Promise<Entity[]> {
    // Check for early cancellation
    checkCancellation(options?.signal, 'createEntities');

    // Validate input
    const validation = BatchCreateEntitiesSchema.safeParse(entities);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid entity data', errors);
    }

    // Reserve the profile-* namespace for ProfileManager
    for (const e of validation.data) {
      if (e.name.startsWith('profile-') && e.entityType !== 'profile') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the profile system. ` +
          `Use entityType='profile' or choose a different name.`,
          []
        );
      }
      if (e.name.startsWith('diary-') && e.entityType !== 'diary') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the diary system. ` +
          `Use entityType='diary' or choose a different name.`,
          []
        );
      }
    }

    // Setup progress reporter
    const reportProgress = createProgressReporter(options?.onProgress);
    const total = entities.length;
    reportProgress?.(createProgress(0, total, 'createEntities'));

    // Acquire shared mutex to prevent TOCTOU race between validation and mutation
    const release = await this.storage.graphMutex.acquire();
    try {
      // Read-only snapshot for validation; persistence happens via the
      // delta primitive `appendEntities` (S2) — O(changed), not O(graph).
      const graph = await this.storage.loadGraph();
      const timestamp = new Date().toISOString();

      // Check graph size limits
      const existingNames = new Set(graph.entities.map(e => e.name));
      const entitiesToAdd = entities.filter(e => !existingNames.has(e.name));
      if (graph.entities.length + entitiesToAdd.length > GRAPH_LIMITS.MAX_ENTITIES) {
        throw new ValidationError(
          'Graph size limit exceeded',
          [`Adding ${entitiesToAdd.length} entities would exceed maximum of ${GRAPH_LIMITS.MAX_ENTITIES} entities`]
        );
      }

      // Check for cancellation before processing
      checkCancellation(options?.signal, 'createEntities');

      const newEntities: Entity[] = [];
      let processed = 0;

      for (const e of entitiesToAdd) {
        // Check for cancellation periodically
        checkCancellation(options?.signal, 'createEntities');

        const entity: Entity = {
          ...e,
          // Stable opaque identifier: assigned at creation, preserved
          // across renames. Caller-supplied ids win (import/replication
          // flows); absent ids get a fresh UUID.
          id: e.id ?? randomUUID(),
          createdAt: e.createdAt || timestamp,
          lastModified: e.lastModified || timestamp,
        };

        // Normalize tags to lowercase
        if (e.tags) {
          entity.tags = e.tags.map(tag => tag.toLowerCase());
        }

        // Validate importance
        if (e.importance !== undefined) {
          if (e.importance < MIN_IMPORTANCE || e.importance > MAX_IMPORTANCE) {
            throw new InvalidImportanceError(e.importance, MIN_IMPORTANCE, MAX_IMPORTANCE);
          }
          entity.importance = e.importance;
        }

        // Auto-stamp projectId from context default if not explicit
        if (entity.projectId === undefined && this.defaultProjectId !== undefined) {
          entity.projectId = this.defaultProjectId;
        }

        newEntities.push(entity);
        processed++;
        reportProgress?.(createProgress(processed, entitiesToAdd.length, 'createEntities'));
      }

      // Governance (Sec1): consult canCreate for every entity BEFORE the
      // batch write so a single denial blocks the whole batch atomically
      // (all-or-nothing, matching the delta write's semantics).
      if (this.governanceHooks?.canCreate) {
        for (const entity of newEntities) {
          if (!this.governanceHooks.canCreate(entity)) {
            throw new GovernanceError(
              'create',
              entity.name,
              `Governance policy blocked creation of entity "${entity.name}"`,
            );
          }
        }
      }

      // Save all new entities in a single delta write (one fsync /
      // one SQLite transaction; emits entity:created per entity)
      if (newEntities.length > 0) {
        await this.appendEntitiesCompat(newEntities);
        for (const entity of newEntities) {
          this.fireAudit({ operation: 'create', entityName: entity.name, after: { ...entity } });
        }
      }

      // Report completion
      reportProgress?.(createProgress(entitiesToAdd.length, entitiesToAdd.length, 'createEntities'));

      return newEntities;
    } finally {
      release();
    }
  }

  /**
   * Delete multiple entities by name in a single batch operation.
   *
   * This method performs cascading deletion:
   * - Removes all specified entities from the graph
   * - Automatically removes all relations where these entities are source or target
   * - Silently ignores entity names that don't exist (no error thrown)
   *
   * @param entityNames - Array of entity names to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Delete single entity
   * await manager.deleteEntities(['Alice']);
   *
   * // Delete multiple entities at once
   * await manager.deleteEntities(['Bob', 'Charlie', 'Dave']);
   *
   * // Safe to delete non-existent entities (no error)
   * await manager.deleteEntities(['NonExistent']); // No error thrown
   * ```
   */
  async deleteEntities(entityNames: string[]): Promise<void> {
    // Validate input
    const validation = EntityNamesSchema.safeParse(entityNames);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid entity names', errors);
    }

    const release = await this.storage.graphMutex.acquire();
    try {
      // Governance (Sec1): consult canDelete for every existing entity
      // BEFORE the batch delete — one denial blocks the whole batch.
      // Non-existent names keep their historical "silently ignored"
      // semantics (no policy check, no audit). Snapshots are captured
      // pre-delete so the audit hook receives the `before` state.
      let deletedSnapshots: Entity[] | undefined;
      if (this.governanceHooks) {
        await this.storage.ensureLoaded();
        deletedSnapshots = [];
        const seen = new Set<string>();
        for (const name of entityNames) {
          if (seen.has(name)) continue;
          seen.add(name);
          const existing = this.storage.getEntityByName(name);
          if (!existing) continue;
          if (this.governanceHooks.canDelete && !this.governanceHooks.canDelete(existing)) {
            throw new GovernanceError(
              'delete',
              name,
              `Governance policy blocked deletion of entity "${name}"`,
            );
          }
          deletedSnapshots.push({ ...existing });
        }
      }

      // S2: targeted storage-level delete (cascades relations, maintains
      // indexes incrementally, emits entity:deleted / relation:deleted
      // per item). On JSONL this internally rewrites the file once per
      // call (append-only format); on SQLite it is real targeted row
      // deletes.
      await this.deleteEntitiesCompat(entityNames);

      if (deletedSnapshots) {
        for (const snapshot of deletedSnapshots) {
          this.fireAudit({ operation: 'delete', entityName: snapshot.name, before: snapshot });
        }
      }

      // Purge all aliases for deleted entities from the ref index
      if (this.refIndex) {
        await this.refIndex.purgeEntities([...new Set(entityNames)]);
      }
    } finally {
      release();
    }
  }

  /**
   * Retrieve a single entity by its unique name.
   *
   * This is a read-only operation that does not modify the graph.
   * Entity names are case-sensitive.
   *
   * @param name - The unique name of the entity to retrieve
   * @returns Promise resolving to the Entity object if found, or null if not found
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Get an existing entity
   * const alice = await manager.getEntity('Alice');
   * if (alice) {
   *   console.log(alice.observations);
   *   console.log(alice.importance);
   * }
   *
   * // Handle non-existent entity
   * const missing = await manager.getEntity('NonExistent');
   * console.log(missing); // null
   *
   * // Get entity with access tracking
   * const tracked = await manager.getEntity('Bob', {
   *   trackAccess: true,
   *   sessionId: 'session_123'
   * });
   * ```
   */
  async getEntity(name: string, options?: GetEntityOptions): Promise<Entity | null> {
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === name) || null;

    // Track access if enabled
    if (entity && options?.trackAccess && this.accessTracker) {
      const context: AccessContext = {
        sessionId: options.sessionId,
        taskId: options.taskId,
        retrievalMethod: 'direct',
      };
      await this.accessTracker.recordAccess(name, context);
    }

    return entity;
  }

  /**
   * List all entities in the graph, optionally filtered by entity type.
   *
   * This is the public bulk-enumeration API — use it instead of reaching
   * into the storage layer (`entityManager['storage'].loadGraph()`).
   *
   * Performance: when an `entityType` filter is given, the storage layer's
   * TypeIndex fast path (`getEntitiesByType`) resolves matches in O(k) for
   * k matching entities. Without a filter the full graph is loaded — O(n)
   * in graph size — so avoid unfiltered calls in hot paths on large graphs.
   *
   * The returned array is always a fresh copy (safe to sort/mutate), but
   * the Entity objects inside are the storage layer's live references —
   * treat them as read-only, same as `getEntity` results.
   *
   * @param filter - Optional filter. `entityType` matches case-insensitively
   *   (TypeIndex semantics, same as `storage.getEntitiesByType`).
   * @returns Array of matching entities (empty when nothing matches)
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // All entities
   * const all = await manager.listEntities();
   *
   * // Only procedures (O(k) via TypeIndex)
   * const procedures = await manager.listEntities({ entityType: 'procedure' });
   * ```
   */
  async listEntities(filter?: { entityType?: string }): Promise<Entity[]> {
    if (filter?.entityType !== undefined) {
      // Fast path: TypeIndex + NameIndex lookup, no full-graph scan.
      await this.storage.ensureLoaded();
      return this.storage.getEntitiesByType(filter.entityType);
    }
    const graph = await this.storage.loadGraph();
    return [...graph.entities];
  }

  /**
   * List all distinct project IDs in the graph (excluding global entities).
   *
   * Scans all entities and collects unique projectId values, excluding
   * entities that lack a projectId (global/unscoped entities).
   *
   * @returns Sorted array of unique projectId values
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // List all projects
   * const projects = await manager.listProjects();
   * console.log(projects); // ['project-a', 'project-b', 'project-c']
   * ```
   */
  async listProjects(): Promise<string[]> {
    const graph = await this.storage.loadGraph();
    const projects = new Set<string>();
    for (const entity of graph.entities) {
      if (entity.projectId) {
        projects.add(entity.projectId);
      }
    }
    return Array.from(projects).sort();
  }

  /**
   * Return all entities in a version chain sorted by version ascending.
   * Accepts any entity in the chain; resolves to the root via rootEntityName.
   *
   * @param entityName - Name of any entity in the version chain
   * @returns Array of entities in the version chain, sorted by version
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Get full version chain from any entity in the chain
   * const chain = await manager.getVersionChain('alice-v2');
   * console.log(chain.map(e => e.name)); // ['alice', 'alice-v2', 'alice-v3']
   * ```
   */
  async getVersionChain(entityName: string): Promise<Entity[]> {
    // OPTIMIZED: O(1) NameIndex lookup instead of getEntity()'s loadGraph()+find();
    // the single loadGraph() below is the only graph load needed.
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) return [];

    const rootName = entity.rootEntityName ?? entity.name;
    const graph = await this.storage.loadGraph();
    const chain = graph.entities.filter(
      e => (e.rootEntityName ?? e.name) === rootName
    );
    chain.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    return chain;
  }

  /**
   * Return the latest version of an entity.
   *
   * @param entityName - Name of any entity in the version chain
   * @returns The latest version entity, or null if the entity doesn't exist
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * const latest = await manager.getLatestVersion('alice');
   * console.log(latest?.name); // 'alice-v3'
   * ```
   */
  async getLatestVersion(entityName: string): Promise<Entity | null> {
    const chain = await this.getVersionChain(entityName);
    if (chain.length === 0) return null;
    return chain.find(e => e.isLatest !== false) ?? chain[chain.length - 1];
  }

  /**
   * Update one or more fields of an existing entity.
   *
   * This method allows partial updates - only the fields specified in the updates
   * object will be changed. All other fields remain unchanged.
   * The lastModified timestamp is automatically updated.
   *
   * @param name - The unique name of the entity to update
   * @param updates - Partial entity object containing only the fields to update
   * @returns Promise resolving to the fully updated Entity object
   * @throws {EntityNotFoundError} If no entity with the given name exists
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Update importance only
   * const updated = await manager.updateEntity('Alice', {
   *   importance: 9
   * });
   *
   * // Update multiple fields
   * await manager.updateEntity('Bob', {
   *   entityType: 'senior_engineer',
   *   tags: ['leadership', 'architecture'],
   *   observations: ['Led project X', 'Designed system Y']
   * });
   *
   * // Add observations (requires reading existing entity first)
   * const entity = await manager.getEntity('Charlie');
   * if (entity) {
   *   await manager.updateEntity('Charlie', {
   *     observations: [...entity.observations, 'New observation']
   *   });
   * }
   * ```
   */
  /**
   * Update an entity with optional optimistic-concurrency-control (η.5.5.c).
   *
   * Pass `options.expectedVersion` to enforce OCC: the caller asserts the
   * live entity has a specific `version`. If it differs (because another
   * agent / consolidation pass / contradiction-resolution incremented it
   * since the caller fetched), `VersionConflictError` is thrown with the
   * expected and actual versions. Omit `expectedVersion` for legacy
   * last-write-wins semantics (the default — backwards-compat).
   *
   * On a successful OCC-guarded write, `version` is auto-incremented:
   * `(entity.version ?? 1) + 1`. This makes OCC composable with the
   * existing v1.8.0 supersession-driven version increments.
   *
   * **Caveat**: a `ConsolidationScheduler` running in the background can
   * increment `version` between caller fetch and update, producing
   * spurious conflicts. Don't cache `expectedVersion` across scheduler
   * cycles — fetch immediately before writing.
   */
  async updateEntity(
    name: string,
    updates: Partial<Entity>,
    options?: { expectedVersion?: number },
  ): Promise<Entity> {
    // Validate input. Sec7: from here on the PARSED data is used, not the
    // raw input — UpdateEntitySchema is `.strip()`, so unknown keys
    // (mass-assignment junk like `isAdmin`) are dropped before they can
    // reach the storage layer.
    const validation = UpdateEntitySchema.safeParse(updates);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid update data', errors);
    }
    const sanitizedUpdates = validation.data as Partial<Entity>;

    const release = await this.storage.graphMutex.acquire();
    try {
      await this.storage.ensureLoaded();
      const entity = this.storage.getEntityByName(name);

      if (!entity) {
        throw new EntityNotFoundError(name);
      }

      // Governance (Sec1): consult canUpdate with (existing, updates) so
      // policies can veto on the proposed patch, not just current state.
      if (
        this.governanceHooks?.canUpdate &&
        !this.governanceHooks.canUpdate(entity, sanitizedUpdates)
      ) {
        throw new GovernanceError('update', name);
      }

      // η.5.5.c: optimistic concurrency check. Treat absent `version` as
      // version 1 — both for the live entity and for callers asserting
      // against legacy entities that pre-date supersession tracking.
      if (options?.expectedVersion !== undefined) {
        const liveVersion = entity.version ?? 1;
        if (liveVersion !== options.expectedVersion) {
          throw new VersionConflictError(name, options.expectedVersion, liveVersion);
        }
      }

      // Validate the lifecycle-status transition before assignment.
      // Throws IllegalStatusTransitionError if illegal.
      if (
        sanitizedUpdates.lifecycleStatus !== undefined &&
        sanitizedUpdates.lifecycleStatus !== entity.lifecycleStatus
      ) {
        ENTITY_STATE_MACHINE.transition(
          entity.lifecycleStatus,
          sanitizedUpdates.lifecycleStatus,
          name,
        );
      }

      // OCC writes auto-increment version so subsequent OCC writes can detect
      // their predecessor. Non-OCC writes leave version untouched (legacy).
      const effectiveUpdates: Partial<Entity> =
        options?.expectedVersion !== undefined
          ? { ...sanitizedUpdates, version: (entity.version ?? 1) + 1 }
          : sanitizedUpdates;

      // Snapshot the pre-mutation state for the audit hook (the storage
      // primitive mutates the live entity object in place).
      const before = this.governanceHooks?.audit ? { ...entity } : undefined;

      // S2: delta write via the storage primitive (sanitizes updates,
      // bumps lastModified, emits entity:updated) — O(changed) instead of
      // the previous full-graph rewrite.
      const found = await this.storage.updateEntity(name, effectiveUpdates);
      if (!found) {
        // Unreachable under graphMutex (existence checked above); kept as
        // a defensive guard for third-party storage implementations.
        throw new EntityNotFoundError(name);
      }
      const updated = this.storage.getEntityByName(name)!;
      if (before) {
        this.fireAudit({ operation: 'update', entityName: name, before, after: { ...updated } });
      }
      return updated;
    } finally {
      release();
    }
  }

  /**
   * Rename an entity, atomically rewriting every core-graph reference to
   * the old name.
   *
   * Delegates to the storage-level `renameEntity` primitive (implemented
   * by both `GraphStorage` and `SQLiteStorage`), which rewrites:
   * - `Relation.from` / `Relation.to`
   * - other entities' `parentId`
   * - version-chain fields (`parentEntityName`, `rootEntityName`,
   *   `supersededBy`)
   *
   * The entity's `id`, `createdAt`, and all other fields are preserved;
   * `lastModified` is bumped. Registered `RefIndex` aliases pointing at
   * the old name are remapped to the new name (when a RefIndex is
   * configured via `setRefIndex` — `ManagerContext` wires this
   * automatically).
   *
   * **Events**: on backends with an event emitter (JSONL `GraphStorage`),
   * emits a typed `entity:renamed` event, followed by `entity:deleted`
   * (old name) and `entity:created` (renamed entity) so create/delete-only
   * derived views (TF-IDF event sync, rank priors, embedding caches) stay
   * consistent without learning the new event type. Listeners therefore
   * observe: `entity:renamed`, `entity:deleted`, `entity:created`.
   * Both first-party backends expose an emitter (`storage.events`), so
   * this sequence fires on JSONL and SQLite alike; the guard below only
   * protects third-party storage implementations without one.
   *
   * **Known limitations (intentionally out of scope)**:
   * - Archived snapshots (`ArchiveManager` compressed archives) keep the
   *   old name — they are point-in-time exports, not live references.
   * - The audit log is immutable by design; historical records keep the
   *   old name.
   * - Agent-memory soft references stored inside `agentMetadata` blobs or
   *   observation text (e.g. `promotedFrom`, `previousSessionId`,
   *   free-text mentions) are not rewritten.
   * - JSONL-backend vector-store sidecars are not rewritten; the emitted
   *   delete+create events let embedding caches re-index the new name.
   *
   * @param oldName - Current entity name (must exist)
   * @param newName - New entity name (must not exist; must pass the same
   *   validation as `createEntities`, including the reserved `profile-` /
   *   `diary-` namespace rules)
   * @returns The renamed entity
   * @throws {ValidationError} If `newName` fails name validation or
   *   violates a reserved namespace
   * @throws {EntityNotFoundError} If `oldName` does not exist
   * @throws {DuplicateEntityError} If `newName` already exists
   */
  async renameEntity(oldName: string, newName: string): Promise<Entity> {
    // New name must pass the same schema checks as createEntities names.
    const validation = EntityNamesSchema.safeParse([newName]);
    if (!validation.success) {
      const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      throw new ValidationError('Invalid new entity name', errors);
    }

    await this.storage.ensureLoaded();
    const existing = this.storage.getEntityByName(oldName);
    if (!existing) {
      throw new EntityNotFoundError(oldName);
    }

    // Reserved namespaces — same rules as createEntities.
    if (newName.startsWith('profile-') && existing.entityType !== 'profile') {
      throw new ValidationError(
        `Entity name '${newName}' is reserved for the profile system. ` +
        `Use entityType='profile' or choose a different name.`,
        []
      );
    }
    if (newName.startsWith('diary-') && existing.entityType !== 'diary') {
      throw new ValidationError(
        `Entity name '${newName}' is reserved for the diary system. ` +
        `Use entityType='diary' or choose a different name.`,
        []
      );
    }

    // Governance (Sec1): a rename is an update of the entity's identity —
    // consult canUpdate with the proposed name patch so policies can veto.
    if (
      this.governanceHooks?.canUpdate &&
      !this.governanceHooks.canUpdate(existing, { name: newName } as Partial<Entity>)
    ) {
      throw new GovernanceError('update', oldName);
    }
    const beforeRename = this.governanceHooks?.audit ? { ...existing } : undefined;

    // Storage primitive re-validates existence/uniqueness under its own
    // mutex (closes the TOCTOU gap) and performs the atomic rewrite.
    const renamed = await this.storage.renameEntity(oldName, newName);

    if (beforeRename) {
      this.fireAudit({
        operation: 'update',
        entityName: oldName,
        before: beforeRename,
        after: { ...renamed },
      });
    }

    // Remap stable aliases so refs survive the rename.
    if (this.refIndex) {
      await this.refIndex.renameEntity(oldName, newName);
    }

    // Emit events on backends that have an emitter (both first-party
    // backends do; the guard covers third-party storage without one).
    const events = (this.storage as Partial<Pick<GraphStorage, 'events'>>).events;
    if (events) {
      events.emitEntityRenamed(oldName, newName, renamed);
      events.emitEntityDeleted(oldName);
      events.emitEntityCreated(renamed);
    }

    return renamed;
  }

  /**
   * Update multiple entities in a single batch operation.
   *
   * This method is more efficient than calling updateEntity multiple times
   * as it loads and saves the graph only once. All updates are applied atomically.
   * The lastModified timestamp is automatically updated for all entities.
   *
   * @param updates - Array of updates, each containing entity name and changes
   * @returns Promise resolving to array of updated entities
   * @throws {EntityNotFoundError} If any entity is not found
   * @throws {ValidationError} If any update data is invalid
   *
   * @example
   * ```typescript
   * const manager = new EntityManager(storage);
   *
   * // Update multiple entities at once
   * const updated = await manager.batchUpdate([
   *   { name: 'Alice', updates: { importance: 9 } },
   *   { name: 'Bob', updates: { importance: 8, tags: ['senior'] } },
   *   { name: 'Charlie', updates: { entityType: 'lead_engineer' } }
   * ]);
   *
   * console.log(`Updated ${updated.length} entities`);
   *
   * // Efficiently update many entities (single graph load/save)
   * const massUpdate = employees.map(name => ({
   *   name,
   *   updates: { tags: ['team-2024'] }
   * }));
   * await manager.batchUpdate(massUpdate);
   * ```
   */
  async batchUpdate(
    updates: Array<{ name: string; updates: Partial<Entity> }>
  ): Promise<Entity[]> {
    // Validate all updates first. Sec7: the PARSED (stripped) data is
    // what gets applied — unknown keys are dropped, not passed through.
    const sanitizedBatch: Array<{ name: string; updates: Partial<Entity> }> = [];
    for (const { name, updates: updateData } of updates) {
      const validation = UpdateEntitySchema.safeParse(updateData);
      if (!validation.success) {
        const errors = validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
        throw new ValidationError('Invalid update data', errors);
      }
      sanitizedBatch.push({ name, updates: validation.data as Partial<Entity> });
    }

    const release = await this.storage.graphMutex.acquire();
    try {
      // Governance (Sec1): consult canUpdate(existing, updates) for every
      // item BEFORE the batch write — one denial blocks the whole batch
      // (matching the delta write's all-or-nothing semantics). Missing
      // entities are left for the storage primitive to reject with
      // EntityNotFoundError, preserving pre-hook error behavior.
      let befores: Map<string, Entity> | undefined;
      if (this.governanceHooks) {
        await this.storage.ensureLoaded();
        befores = new Map();
        for (const { name, updates: entityUpdates } of sanitizedBatch) {
          const existing = this.storage.getEntityByName(name);
          if (!existing) continue;
          if (
            this.governanceHooks.canUpdate &&
            !this.governanceHooks.canUpdate(existing, entityUpdates)
          ) {
            throw new GovernanceError('update', name);
          }
          if (!befores.has(name)) befores.set(name, { ...existing });
        }
      }

      // S2: single delta write (one fsync / one SQLite transaction).
      // The storage primitive validates all names first (throws
      // EntityNotFoundError before mutating anything — same all-or-
      // nothing semantics as the previous full-graph save), sanitizes
      // each update, stamps the shared timestamp, and emits
      // entity:updated per entity.
      const timestamp = new Date().toISOString();
      const results = await this.updateEntitiesCompat(sanitizedBatch, { timestamp });

      if (befores) {
        for (const updated of results) {
          this.fireAudit({
            operation: 'update',
            entityName: updated.name,
            before: befores.get(updated.name),
            after: { ...updated },
          });
        }
      }

      return results;
    } finally {
      release();
    }
  }

  // ============================================================
  // TAG OPERATIONS
  // ============================================================

  /**
   * Add tags to an entity.
   *
   * Tags are normalized to lowercase and duplicates are filtered out.
   *
   * @param entityName - Name of the entity
   * @param tags - Tags to add
   * @returns Result with entity name and added tags
   * @throws {EntityNotFoundError} If entity is not found
   */
  async addTags(entityName: string, tags: string[]): Promise<{ entityName: string; addedTags: string[] }> {
    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    // Initialize tags array if it doesn't exist
    const existingTags = entity.tags || [];

    // Normalize tags to lowercase and filter out duplicates
    const normalizedTags = tags.map(tag => tag.toLowerCase());
    const newTags = normalizedTags.filter(tag => !existingTags.includes(tag));

    if (newTags.length > 0) {
      // OPTIMIZED: Use updateEntity for in-place update + append
      // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
      await this.storage.updateEntity(entityName, { tags: [...existingTags, ...newTags] });
    }

    return { entityName, addedTags: newTags };
  }

  /**
   * Remove tags from an entity.
   *
   * @param entityName - Name of the entity
   * @param tags - Tags to remove
   * @returns Result with entity name and removed tags
   * @throws {EntityNotFoundError} If entity is not found
   */
  async removeTags(entityName: string, tags: string[]): Promise<{ entityName: string; removedTags: string[] }> {
    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    if (!entity.tags) {
      return { entityName, removedTags: [] };
    }

    // Normalize tags to lowercase
    const normalizedTags = tags.map(tag => tag.toLowerCase());
    const originalLength = entity.tags.length;

    // Capture existing tags (lowercase) BEFORE filtering to accurately track removals
    const existingTagsLower = entity.tags.map(t => t.toLowerCase());

    // Filter out the tags to remove
    const newTags = entity.tags.filter(tag => !normalizedTags.includes(tag.toLowerCase()));

    // A tag was removed if it existed in the original tags
    const removedTags = normalizedTags.filter(tag => existingTagsLower.includes(tag));

    // Update entity via storage if tags were removed
    if (newTags.length < originalLength) {
      // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
      await this.storage.updateEntity(entityName, { tags: newTags });
    }

    return { entityName, removedTags };
  }

  /**
   * Set importance level for an entity.
   *
   * @param entityName - Name of the entity
   * @param importance - Importance level (0-10)
   * @returns Result with entity name and importance
   * @throws {EntityNotFoundError} If entity is not found
   * @throws {Error} If importance is out of range
   */
  async setImportance(entityName: string, importance: number): Promise<{ entityName: string; importance: number }> {
    // Validate importance range (0-10)
    if (importance < 0 || importance > 10) {
      throw new Error(`Importance must be between 0 and 10, got ${importance}`);
    }

    // OPTIMIZED: Use O(1) NameIndex lookup instead of loadGraph() + O(n) find()
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new EntityNotFoundError(entityName);
    }

    // Use updateEntity for in-place update + append
    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
    await this.storage.updateEntity(entityName, { importance });

    return { entityName, importance };
  }

  /**
   * Add tags to multiple entities in a single operation.
   *
   * OPTIMIZED: Uses Map for O(1) entity lookups instead of O(n) find() per entity.
   *
   * @param entityNames - Names of entities to tag
   * @param tags - Tags to add to each entity
   * @returns Array of results showing which tags were added to each entity
   */
  async addTagsToMultipleEntities(entityNames: string[], tags: string[]): Promise<{ entityName: string; addedTags: string[] }[]> {
    const release = await this.storage.graphMutex.acquire();
    try {
      await this.storage.ensureLoaded();
      const timestamp = new Date().toISOString();
      const normalizedTags = tags.map(tag => tag.toLowerCase());
      const results: { entityName: string; addedTags: string[] }[] = [];
      const batch: Array<{ name: string; updates: Partial<Entity> }> = [];

      for (const entityName of entityNames) {
        // O(1) NameIndex lookup against the live (read-only) entity
        const entity = this.storage.getEntityByName(entityName);
        if (!entity) {
          continue; // Skip non-existent entities
        }

        const existingTags = entity.tags ?? [];

        // Filter out duplicates
        const newTags = normalizedTags.filter(tag => !existingTags.includes(tag));

        if (newTags.length > 0) {
          batch.push({
            name: entityName,
            updates: { tags: [...existingTags, ...newTags] },
          });
        } else if (entity.tags === undefined) {
          // Historical behavior: entities without a tags field get an
          // empty tags array persisted even when no new tags were added —
          // WITHOUT bumping lastModified (the previous full-graph save
          // wrote the untouched timestamp back).
          batch.push({
            name: entityName,
            updates: { tags: [], lastModified: entity.lastModified },
          });
        }

        results.push({ entityName, addedTags: newTags });
      }

      // S2: single delta write for all touched entities (per-entity
      // entity:updated events; untouched entities are not rewritten)
      await this.updateEntitiesCompat(batch, { timestamp });
      return results;
    } finally {
      release();
    }
  }

  /**
   * Replace a tag with a new tag across all entities (rename tag).
   *
   * @param oldTag - Tag to replace
   * @param newTag - New tag value
   * @returns Result with affected entities and count
   */
  async replaceTag(oldTag: string, newTag: string): Promise<{ affectedEntities: string[]; count: number }> {
    const release = await this.storage.graphMutex.acquire();
    try {
      const graph = await this.storage.loadGraph();
      const timestamp = new Date().toISOString();
      const normalizedOldTag = oldTag.toLowerCase();
      const normalizedNewTag = newTag.toLowerCase();
      const affectedEntities: string[] = [];
      const batch: Array<{ name: string; updates: Partial<Entity> }> = [];

      for (const entity of graph.entities) {
        if (!entity.tags || !entity.tags.includes(normalizedOldTag)) {
          continue;
        }

        let newTags: string[];
        if (entity.tags.includes(normalizedNewTag)) {
          // New tag already present — just remove old tag
          newTags = entity.tags.filter(tag => tag !== normalizedOldTag);
        } else {
          newTags = [...entity.tags];
          newTags[newTags.indexOf(normalizedOldTag)] = normalizedNewTag;
        }
        batch.push({ name: entity.name, updates: { tags: newTags } });
        affectedEntities.push(entity.name);
      }

      // S2: single delta write for affected entities only
      await this.updateEntitiesCompat(batch, { timestamp });
      return { affectedEntities, count: affectedEntities.length };
    } finally {
      release();
    }
  }

  /**
   * Merge two tags into one target tag across all entities.
   *
   * Combines tag1 and tag2 into targetTag. Any entity with either tag1 or tag2
   * will have both removed and targetTag added (if not already present).
   *
   * @param tag1 - First tag to merge
   * @param tag2 - Second tag to merge
   * @param targetTag - Target tag to merge into
   * @returns Object with affected entity names and count
   */
  async mergeTags(tag1: string, tag2: string, targetTag: string): Promise<{ affectedEntities: string[]; count: number }> {
    const release = await this.storage.graphMutex.acquire();
    try {
      const graph = await this.storage.loadGraph();
      const timestamp = new Date().toISOString();
      const normalizedTag1 = tag1.toLowerCase();
      const normalizedTag2 = tag2.toLowerCase();
      const normalizedTargetTag = targetTag.toLowerCase();
      const affectedEntities: string[] = [];
      const batch: Array<{ name: string; updates: Partial<Entity> }> = [];

      for (const entity of graph.entities) {
        if (!entity.tags) {
          continue;
        }

        const hasTag1 = entity.tags.includes(normalizedTag1);
        const hasTag2 = entity.tags.includes(normalizedTag2);

        if (!hasTag1 && !hasTag2) {
          continue;
        }

        // Remove both tags
        const newTags = entity.tags.filter(tag => tag !== normalizedTag1 && tag !== normalizedTag2);

        // Add target tag if not already present
        if (!newTags.includes(normalizedTargetTag)) {
          newTags.push(normalizedTargetTag);
        }

        batch.push({ name: entity.name, updates: { tags: newTags } });
        affectedEntities.push(entity.name);
      }

      // S2: single delta write for affected entities only
      await this.updateEntitiesCompat(batch, { timestamp });
      return { affectedEntities, count: affectedEntities.length };
    } finally {
      release();
    }
  }

  // ==================== η.4.4: Temporal Versioning ====================
  //
  // Mirrors the v1.9.0 RelationManager surface (invalidateRelation /
  // queryAsOf / timeline) for entities. Orthogonal to v1.8.0 supersession
  // (`version`/`supersededBy`): supersession answers "which version is
  // current?", temporal validity answers "was the entity true at time T?".
  // An entity may be superseded but still valid at a past asOf date, and
  // vice versa.

  /**
   * Mark an entity as no longer valid by setting `validUntil`. Idempotent:
   * a second call updates the existing `validUntil`. Does not delete the
   * entity — `entityAsOf` still returns it for past asOf timestamps.
   *
   * @param name - The entity to invalidate
   * @param ended - ISO 8601 timestamp; defaults to current time
   * @throws {EntityNotFoundError} If no entity exists with the given name
   */
  async invalidateEntity(name: string, ended?: string): Promise<void> {
    const release = await this.storage.graphMutex.acquire();
    try {
      await this.storage.ensureLoaded();
      if (!this.storage.hasEntity(name)) throw new EntityNotFoundError(name);
      // S2: delta write (storage primitive bumps lastModified and emits
      // entity:updated)
      // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked at entry under graphMutex
      await this.storage.updateEntity(name, {
        validUntil: ended ?? new Date().toISOString(),
      });
    } finally {
      release();
    }
  }

  /**
   * Return the entity at a given point in time, or null if it didn't exist
   * (or was already invalidated) then. An entity is valid at `asOf` when:
   * - `validFrom` is undefined OR `validFrom` <= asOf
   * - `validUntil` is undefined OR `validUntil` >= asOf
   *
   * @param name - The entity name
   * @param asOf - ISO 8601 date string
   * @throws {ValidationError} If `asOf` is not an ISO 8601 date string
   */
  async entityAsOf(name: string, asOf: string): Promise<Entity | null> {
    if (!/^\d{4}-\d{2}-\d{2}/.test(asOf)) {
      throw new ValidationError(`asOf must be an ISO 8601 date string, got: '${asOf}'`, []);
    }
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === name);
    if (!entity) return null;
    const vf = entity.validFrom;
    const vu = entity.validUntil;
    if (vf && vf > asOf) return null;
    if (vu && vu < asOf) return null;
    return entity;
  }

  /**
   * Return all temporal versions of an entity in chronological order
   * (by `validFrom`, with unbounded entities last). When `name` matches
   * a member of a v1.8.0 supersession chain, returns the full chain
   * sorted by `validFrom`. Otherwise returns just the named entity (or []).
   *
   * @param name - Any entity name in the chain
   */
  async entityTimeline(name: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === name);
    if (!entity) return [];
    const rootName = entity.rootEntityName ?? entity.name;
    const chain = graph.entities.filter(
      e => (e.rootEntityName ?? e.name) === rootName,
    );
    chain.sort((a, b) => {
      const aFrom = a.validFrom ?? '';
      const bFrom = b.validFrom ?? '';
      if (!aFrom && !bFrom) return 0;
      if (!aFrom) return 1;
      if (!bFrom) return -1;
      return aFrom.localeCompare(bFrom);
    });
    return chain;
  }
}
