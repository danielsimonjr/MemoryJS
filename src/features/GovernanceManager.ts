/**
 * Governance Manager
 *
 * Wraps knowledge graph operations with audit logging, policy enforcement,
 * and rollback capabilities as part of the Dynamic Memory Governance foundation.
 *
 * Every operation executed through a GovernanceTransaction is:
 * 1. Policy-checked before execution
 * 2. Logged to the AuditLog (before + after snapshots)
 * 3. Reversible via rollback(auditEntryId)
 *
 * @module features/GovernanceManager
 */

import type { Entity } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { AuditLog, type AuditEntry } from './AuditLog.js';
import { KnowledgeGraphError } from '../utils/errors.js';

// ==================== Policy ====================

/**
 * Governance policy that controls which operations are permitted.
 *
 * All methods are optional. When a method is not provided, the
 * corresponding operation is permitted by default.
 *
 * @example
 * ```typescript
 * const policy: GovernancePolicy = {
 *   canCreate: (entity) => entity.entityType !== 'restricted',
 *   canDelete: (entity) => (entity.importance ?? 0) < 8,
 * };
 * ```
 */
export interface GovernancePolicy {
  /** Return false to block creation of this entity */
  canCreate?: (entity: Omit<Entity, 'createdAt' | 'lastModified'>) => boolean;
  /** Return false to block update of this entity */
  canUpdate?: (entity: Entity) => boolean;
  /** Return false to block deletion of this entity */
  canDelete?: (entity: Entity) => boolean;
}

// ==================== GovernanceTransaction ====================

/**
 * Options for operations performed within a governance transaction.
 */
export interface GovernanceOperationOptions {
  /** Optional agent/user identifier for audit log attribution */
  agentId?: string;
}

/**
 * A governance-wrapped transaction providing audited, policy-checked operations.
 *
 * Created by {@link GovernanceManager.withTransaction}. Operations called on
 * this object record before/after snapshots in the audit log.
 */
export class GovernanceTransaction {
  private readonly auditEntries: AuditEntry[] = [];

  constructor(
    private readonly storage: GraphStorage,
    private readonly auditLog: AuditLog,
    private readonly policy: GovernancePolicy,
    private readonly defaultAgentId?: string
  ) {}

  /**
   * Get all audit entries recorded in this transaction.
   */
  getAuditEntries(): ReadonlyArray<AuditEntry> {
    return this.auditEntries;
  }

  // ==================== Entity Operations ====================

  /**
   * Create a new entity with policy enforcement and audit logging.
   *
   * @param entity - Entity to create (without timestamps)
   * @param options - Optional operation metadata
   * @throws {KnowledgeGraphError} If policy blocks the create operation
   */
  async createEntity(
    entity: Omit<Entity, 'createdAt' | 'lastModified'>,
    options?: GovernanceOperationOptions
  ): Promise<Entity> {
    // Policy check
    if (this.policy.canCreate && !this.policy.canCreate(entity)) {
      throw new KnowledgeGraphError(
        `Governance policy blocked creation of entity "${entity.name}"`,
        'POLICY_VIOLATION'
      );
    }

    // Apply the operation
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();

    if (graph.entities.some(e => e.name === entity.name)) {
      throw new KnowledgeGraphError(`Entity "${entity.name}" already exists`, 'DUPLICATE_ENTITY');
    }

    const created: Entity = { ...entity, createdAt: timestamp, lastModified: timestamp };
    graph.entities.push(created);
    await this.storage.saveGraph(graph);

    // Audit
    const entry = await this.auditLog.append({
      operation: 'create',
      entityName: entity.name,
      agentId: options?.agentId ?? this.defaultAgentId,
      before: undefined,
      after: created as unknown as object,
      status: 'committed',
    });
    this.auditEntries.push(entry);

    return created;
  }

  /**
   * Update an existing entity with policy enforcement and audit logging.
   *
   * @param name - Name of entity to update
   * @param updates - Partial entity updates
   * @param options - Optional operation metadata
   * @throws {KnowledgeGraphError} If policy blocks the update or entity not found
   */
  async updateEntity(
    name: string,
    updates: Partial<Entity>,
    options?: GovernanceOperationOptions
  ): Promise<Entity> {
    const graph = await this.storage.getGraphForMutation();
    const existing = graph.entities.find(e => e.name === name);
    if (!existing) {
      throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
    }

    // Policy check against current state
    if (this.policy.canUpdate && !this.policy.canUpdate(existing)) {
      throw new KnowledgeGraphError(
        `Governance policy blocked update of entity "${name}"`,
        'POLICY_VIOLATION'
      );
    }

    const before = { ...existing } as unknown as object;
    const timestamp = new Date().toISOString();
    Object.assign(existing, updates);
    existing.lastModified = timestamp;
    await this.storage.saveGraph(graph);

    // Audit
    const entry = await this.auditLog.append({
      operation: 'update',
      entityName: name,
      agentId: options?.agentId ?? this.defaultAgentId,
      before,
      after: existing as unknown as object,
      status: 'committed',
    });
    this.auditEntries.push(entry);

    return existing;
  }

  /**
   * Delete an entity with policy enforcement and audit logging.
   *
   * @param name - Name of entity to delete
   * @param options - Optional operation metadata
   * @throws {KnowledgeGraphError} If policy blocks the delete or entity not found
   */
  async deleteEntity(name: string, options?: GovernanceOperationOptions): Promise<void> {
    const graph = await this.storage.getGraphForMutation();
    const index = graph.entities.findIndex(e => e.name === name);
    if (index === -1) {
      throw new KnowledgeGraphError(`Entity "${name}" not found`, 'ENTITY_NOT_FOUND');
    }

    const existing = graph.entities[index];

    // Policy check
    if (this.policy.canDelete && !this.policy.canDelete(existing)) {
      throw new KnowledgeGraphError(
        `Governance policy blocked deletion of entity "${name}"`,
        'POLICY_VIOLATION'
      );
    }

    const before = { ...existing } as unknown as object;
    graph.entities.splice(index, 1);
    graph.relations = graph.relations.filter(r => r.from !== name && r.to !== name);
    await this.storage.saveGraph(graph);

    // Audit
    const entry = await this.auditLog.append({
      operation: 'delete',
      entityName: name,
      agentId: options?.agentId ?? this.defaultAgentId,
      before,
      after: undefined,
      status: 'committed',
    });
    this.auditEntries.push(entry);
  }

  /**
   * Record a merge operation in the audit log.
   *
   * The actual merge logic is performed by the caller; this records
   * the audit trail with before/after snapshots.
   *
   * @param entityName - Name of the surviving entity
   * @param before - State before merge
   * @param after - State after merge
   * @param options - Optional operation metadata
   */
  async recordMerge(
    entityName: string,
    before: object,
    after: object,
    options?: GovernanceOperationOptions
  ): Promise<AuditEntry> {
    const entry = await this.auditLog.append({
      operation: 'merge',
      entityName,
      agentId: options?.agentId ?? this.defaultAgentId,
      before,
      after,
      status: 'committed',
    });
    this.auditEntries.push(entry);
    return entry;
  }

  /**
   * Record an archive operation in the audit log.
   *
   * @param entityName - Name of the archived entity
   * @param before - State before archiving
   * @param options - Optional operation metadata
   */
  async recordArchive(
    entityName: string,
    before: object,
    options?: GovernanceOperationOptions
  ): Promise<AuditEntry> {
    const entry = await this.auditLog.append({
      operation: 'archive',
      entityName,
      agentId: options?.agentId ?? this.defaultAgentId,
      before,
      after: undefined,
      status: 'committed',
    });
    this.auditEntries.push(entry);
    return entry;
  }

  /**
   * Mark all audit entries in this transaction as rolled back.
   *
   * Called internally when the transaction is being reversed.
   *
   * @internal
   */
  async markRolledBack(): Promise<void> {
    // We append a new rolled_back entry for each committed entry
    // (appending is idempotent-safe; we never mutate existing JSONL lines)
    for (const committed of this.auditEntries) {
      await this.auditLog.append({
        operation: committed.operation,
        entityName: committed.entityName,
        agentId: committed.agentId,
        before: committed.after, // reversed: after becomes before in the rollback record
        after: committed.before, // and before becomes after
        status: 'rolled_back',
      });
    }
  }
}

// ==================== GovernanceManager ====================

/**
 * Manages policy enforcement, audit logging, and operation rollback
 * for the Dynamic Memory Governance system.
 *
 * @example
 * ```typescript
 * const governance = new GovernanceManager(storage, auditLog);
 *
 * // Set a policy
 * governance.setPolicy({
 *   canDelete: (entity) => (entity.importance ?? 0) < 9,
 * });
 *
 * // Execute governed operations
 * const result = await governance.withTransaction(async (tx) => {
 *   const entity = await tx.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
 *   return entity;
 * });
 *
 * // Rollback a specific operation
 * await governance.rollback(auditEntryId);
 * ```
 */
export class GovernanceManager {
  private policy: GovernancePolicy = {};

  constructor(
    private readonly storage: GraphStorage,
    private readonly auditLog: AuditLog
  ) {}

  /**
   * Set the active governance policy.
   *
   * The policy is applied to all subsequent operations. Passing an
   * empty object `{}` (or calling with no argument) effectively clears
   * all restrictions.
   *
   * @param policy - Policy defining which operations are permitted
   */
  setPolicy(policy: GovernancePolicy): void {
    this.policy = policy;
  }

  /**
   * Get the current governance policy.
   */
  getPolicy(): GovernancePolicy {
    return this.policy;
  }

  /**
   * Execute a function within a governed transaction.
   *
   * The callback receives a {@link GovernanceTransaction} with audited,
   * policy-checked operations. If the callback throws, all audit entries
   * recorded during the transaction are marked as `rolled_back` and the
   * error is re-thrown.
   *
   * Note: Physical graph rollback (restoring data) is performed via
   * {@link rollback} using an audit entry id. This method only handles
   * the audit trail marking on error.
   *
   * @param fn - Callback receiving the governance transaction
   * @param agentId - Optional agent identifier applied to all operations
   * @returns Promise resolving to the callback's return value
   * @throws Re-throws any error from the callback after marking entries rolled back
   */
  async withTransaction<T>(
    fn: (tx: GovernanceTransaction) => Promise<T>,
    agentId?: string
  ): Promise<T> {
    const tx = new GovernanceTransaction(this.storage, this.auditLog, this.policy, agentId);

    try {
      const result = await fn(tx);
      return result;
    } catch (error) {
      // Mark all entries created in this transaction as rolled back.
      // Swallow any error from markRolledBack so the original error is preserved.
      try {
        await tx.markRolledBack();
      } catch {
        // Intentionally ignored — audit log failure must not obscure the original error
      }
      throw error;
    }
  }

  /**
   * Reverse a specific committed operation using its audit entry id.
   *
   * Looks up the audit entry to find the `before` snapshot, then
   * restores the entity to that state:
   * - For `create`: deletes the entity (no `before` means it didn't exist)
   * - For `delete`: recreates the entity from the `before` snapshot
   * - For `update` / `merge` / `archive`: restores entity to `before` state
   *
   * A new audit entry with `status: 'rolled_back'` is appended to the log.
   *
   * @param auditEntryId - ID of the audit entry to reverse
   * @throws {KnowledgeGraphError} If the entry is not found or has no snapshot data
   */
  async rollback(auditEntryId: string): Promise<void> {
    const entries = await this.auditLog.loadAll();
    const target = entries.find(e => e.id === auditEntryId);

    if (!target) {
      throw new KnowledgeGraphError(
        `Audit entry "${auditEntryId}" not found`,
        'AUDIT_ENTRY_NOT_FOUND'
      );
    }

    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();

    switch (target.operation) {
      case 'create': {
        // Reverse a create by deleting the entity
        const idx = graph.entities.findIndex(e => e.name === target.entityName);
        if (idx !== -1) {
          graph.entities.splice(idx, 1);
          graph.relations = graph.relations.filter(
            r => r.from !== target.entityName && r.to !== target.entityName
          );
        }
        break;
      }

      case 'delete': {
        // Reverse a delete by recreating the entity from the before snapshot
        if (!target.before) {
          throw new KnowledgeGraphError(
            `Cannot rollback delete for "${target.entityName}": no before snapshot`,
            'MISSING_SNAPSHOT'
          );
        }
        // Only recreate if it doesn't already exist
        if (!graph.entities.some(e => e.name === target.entityName)) {
          const restored: Entity = {
            ...(target.before as Entity),
            ...pickEntityFields(target.before),
            lastModified: timestamp,
          };
          graph.entities.push(restored);
        }
        break;
      }

      case 'update':
      case 'merge':
      case 'archive': {
        // Reverse by restoring to before snapshot
        if (!target.before) {
          throw new KnowledgeGraphError(
            `Cannot rollback ${target.operation} for "${target.entityName}": no before snapshot`,
            'MISSING_SNAPSHOT'
          );
        }
        const entityIdx = graph.entities.findIndex(e => e.name === target.entityName);
        const safeSnapshot = pickEntityFields(target.before);
        const restored: Entity = {
          ...(target.before as Entity),
          ...safeSnapshot,
          lastModified: timestamp,
        };
        if (entityIdx !== -1) {
          // Replace the entity entirely from the snapshot to avoid stale fields
          graph.entities[entityIdx] = restored;
        } else {
          // Entity was removed after the update — recreate from before snapshot
          graph.entities.push(restored);
        }
        break;
      }
    }

    await this.storage.saveGraph(graph);

    // Record the rollback in the audit log
    await this.auditLog.append({
      operation: target.operation,
      entityName: target.entityName,
      agentId: target.agentId,
      before: target.after,
      after: target.before,
      status: 'rolled_back',
    });
  }
}

// ==================== Helpers ====================

/**
 * Safe field whitelist for audit snapshot restoration.
 *
 * Copies only known Entity fields from an unvalidated audit snapshot to prevent
 * prototype pollution (e.g., `__proto__`, `constructor`) from being spread
 * onto live graph entities.
 */
function pickEntityFields(snapshot: object): Partial<Entity> {
  const src = snapshot as Record<string, unknown>;
  const safe: Partial<Entity> = {};

  // Scalar primitive fields
  const scalarFields = [
    'name', 'entityType', 'parentId', 'importance',
    'createdAt', 'lastModified', 'ttl', 'confidence', 'freshnessScore',
    'expiresAt', 'visibility',
  ] as const;

  for (const field of scalarFields) {
    if (Object.prototype.hasOwnProperty.call(src, field)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (safe as any)[field] = src[field];
    }
  }

  // Array fields — only accept plain arrays
  if (Array.isArray(src['observations'])) {
    safe.observations = (src['observations'] as unknown[])
      .filter((o): o is string => typeof o === 'string');
  }
  if (Array.isArray(src['tags'])) {
    safe.tags = (src['tags'] as unknown[])
      .filter((t): t is string => typeof t === 'string');
  }

  return safe;
}
