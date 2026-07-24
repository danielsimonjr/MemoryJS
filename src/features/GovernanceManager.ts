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
import { AuditLog, type AuditEntry, type AuditOperation } from './AuditLog.js';
import { KnowledgeGraphError } from '../utils/errors.js';
import { sanitizeObject } from '../utils/entityUtils.js';
import { PiiRedactor } from '../security/PiiRedactor.js';

// ==================== Errors ====================

/**
 * Thrown when a {@link GovernancePolicy} blocks an operation.
 *
 * Raised both by {@link GovernanceTransaction} operations and by
 * `EntityManager` mutations when governance hooks are wired (Sec1
 * enforcement chokepoint — `MEMORY_GOVERNANCE_ENABLED=true`).
 * Always carries code `'POLICY_VIOLATION'` and names the denied entity.
 */
export class GovernanceError extends KnowledgeGraphError {
  constructor(
    /** Which operation was denied. */
    public readonly operation: 'create' | 'update' | 'delete',
    /** The entity the policy denied. */
    public readonly entityName: string,
    message?: string,
  ) {
    super(
      message ??
        `Governance policy blocked ${operation} of entity "${entityName}"`,
      'POLICY_VIOLATION',
    );
    this.name = 'GovernanceError';
  }
}

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
  /**
   * Return false to block update of this entity.
   *
   * Receives the **pre-merge** entity plus (when the caller provides it)
   * the proposed `updates` patch, so policies can veto on the fields
   * being written — not just on the current state. Policies written
   * against the original single-parameter signature keep working
   * unchanged (extra arguments are ignored by shorter functions).
   */
  canUpdate?: (entity: Entity, updates?: Partial<Entity>) => boolean;
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
    private readonly defaultAgentId?: string,
    /**
     * When set, before/after snapshots are PII-redacted before being
     * appended to the audit log (Sec6 — opt-in via the
     * `redactAuditSnapshots` GovernanceManager option). The live graph
     * is never touched; only the audit copies are redacted.
     */
    private readonly snapshotRedactor?: PiiRedactor,
  ) {}

  /** Apply snapshot redaction when configured; identity otherwise. */
  private redactSnapshot(snapshot: object | undefined): object | undefined {
    if (!snapshot || !this.snapshotRedactor) return snapshot;
    return redactObjectStrings(snapshot, this.snapshotRedactor);
  }

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
      throw new GovernanceError(
        'create',
        entity.name,
        `Governance policy blocked creation of entity "${entity.name}"`,
      );
    }

    // Apply the operation
    const graph = await this.storage.getGraphForMutation();
    const timestamp = new Date().toISOString();

    if (graph.entities.some(e => e.name === entity.name)) {
      throw new KnowledgeGraphError(`Entity "${entity.name}" already exists`, 'DUPLICATE_ENTITY');
    }

    // Prototype-pollution guard (Sec4): same sanitization EntityManager applies.
    const sanitized = sanitizeObject(
      entity as unknown as Record<string, unknown>
    ) as unknown as Omit<Entity, 'createdAt' | 'lastModified'>;
    const created: Entity = { ...sanitized, createdAt: timestamp, lastModified: timestamp };
    graph.entities.push(created);
    await this.storage.saveGraph(graph);

    // Audit
    const entry = await this.auditLog.append({
      operation: 'create',
      entityName: entity.name,
      agentId: options?.agentId ?? this.defaultAgentId,
      before: undefined,
      after: this.redactSnapshot(created as unknown as object),
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

    // Policy check against current state (and the proposed patch, so
    // policies can veto on injected fields — see GovernancePolicy.canUpdate)
    if (this.policy.canUpdate && !this.policy.canUpdate(existing, updates)) {
      throw new GovernanceError('update', name);
    }

    const before = { ...existing } as unknown as object;
    const timestamp = new Date().toISOString();
    // Prototype-pollution guard (Sec4): same sanitization EntityManager applies
    // (`EntityManager.updateEntity` / `batchUpdate` parity).
    Object.assign(existing, sanitizeObject(updates as Record<string, unknown>));
    existing.lastModified = timestamp;
    await this.storage.saveGraph(graph);

    // Audit
    const entry = await this.auditLog.append({
      operation: 'update',
      entityName: name,
      agentId: options?.agentId ?? this.defaultAgentId,
      before: this.redactSnapshot(before),
      after: this.redactSnapshot(existing as unknown as object),
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
      throw new GovernanceError(
        'delete',
        name,
        `Governance policy blocked deletion of entity "${name}"`,
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
      before: this.redactSnapshot(before),
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
      before: this.redactSnapshot(before),
      after: this.redactSnapshot(after),
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
      before: this.redactSnapshot(before),
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
export interface GovernanceManagerOptions {
  /**
   * Sec6 (opt-in): apply {@link PiiRedactor} to before/after entity
   * snapshots before they are written to the audit log. The live graph
   * is never mutated — only the audit copies are redacted. Default: false
   * (byte-identical audit behavior to previous releases).
   */
  redactAuditSnapshots?: boolean;
  /**
   * Custom redactor for `redactAuditSnapshots`. Defaults to a
   * `new PiiRedactor()` with the standard pattern bank.
   */
  redactor?: PiiRedactor;
}

export class GovernanceManager {
  private policy: GovernancePolicy = {};
  private readonly snapshotRedactor?: PiiRedactor;

  constructor(
    private readonly storage: GraphStorage,
    /**
     * The audit log this manager appends to. Public so integration
     * layers (e.g. `ManagerContext`'s Sec1 enforcement wiring and
     * `verifyChain` health checks) can reach the same log — but prefer
     * {@link appendAudit} for writes so snapshot redaction is applied.
     */
    public readonly auditLog: AuditLog,
    options?: GovernanceManagerOptions,
  ) {
    if (options?.redactAuditSnapshots) {
      this.snapshotRedactor = options.redactor ?? new PiiRedactor();
    }
  }

  /**
   * Append an audit entry through this manager's redaction policy.
   *
   * Applies `redactAuditSnapshots` (when enabled) to the `before` /
   * `after` snapshots, then appends to {@link auditLog}. This is the
   * write path `ManagerContext` wires into `EntityManager`'s governance
   * hooks so hook-driven audits honor the same redaction as
   * transaction-driven ones.
   */
  async appendAudit(entry: {
    operation: AuditOperation;
    entityName: string;
    agentId?: string;
    before?: object;
    after?: object;
    status?: 'committed' | 'rolled_back';
  }): Promise<AuditEntry> {
    const redact = (snapshot: object | undefined): object | undefined =>
      snapshot && this.snapshotRedactor
        ? redactObjectStrings(snapshot, this.snapshotRedactor)
        : snapshot;
    return this.auditLog.append({
      operation: entry.operation,
      entityName: entry.entityName,
      agentId: entry.agentId,
      before: redact(entry.before),
      after: redact(entry.after),
      status: entry.status ?? 'committed',
    });
  }

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
    const tx = new GovernanceTransaction(
      this.storage,
      this.auditLog,
      this.policy,
      agentId,
      this.snapshotRedactor,
    );

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
          graph.entities.push(restoreEntityFromSnapshot(target.before, target.entityName, timestamp));
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
        const restored = restoreEntityFromSnapshot(target.before, target.entityName, timestamp);
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
 * Structurally redact every string value in an object tree (Sec6).
 *
 * Deep-clones the input, applying {@link PiiRedactor.redact} to each
 * string leaf (array elements included). Object keys are left untouched.
 * Structural (rather than JSON-roundtrip) redaction guarantees custom
 * pattern replacements can never corrupt the serialized shape.
 * Non-plain values (functions, class instances) are passed through by
 * reference — audit snapshots are plain `{ ...entity }` spreads, so in
 * practice everything is JSON-shaped.
 */
function redactObjectStrings<T>(value: T, redactor: PiiRedactor): T {
  if (typeof value === 'string') {
    return redactor.redact(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => redactObjectStrings(v, redactor)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactObjectStrings(v, redactor);
      }
      return out as unknown as T;
    }
  }
  return value;
}

/**
 * Build a restorable {@link Entity} from an unvalidated audit snapshot.
 *
 * Constructed **exclusively** from the {@link pickEntityFields} whitelist —
 * the raw snapshot is never spread onto the result, so extra/malicious fields
 * planted in a (writable) audit file cannot reach the live graph (Sec4/Sec1
 * related bug: the previous `{...(before as Entity), ...pickEntityFields(before)}`
 * shape let every raw snapshot field through, defeating the whitelist).
 *
 * Required Entity identity fields are defaulted defensively when the snapshot
 * lacks them: `name` falls back to the audit entry's `entityName`, `entityType`
 * to `'unknown'`, `observations` to `[]`. Whitelisted snapshot values win over
 * these defaults when present.
 */
function restoreEntityFromSnapshot(snapshot: object, entityName: string, timestamp: string): Entity {
  const safe = pickEntityFields(snapshot);
  return {
    name: entityName,
    entityType: 'unknown',
    observations: [],
    ...safe,
    lastModified: timestamp,
  };
}

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
