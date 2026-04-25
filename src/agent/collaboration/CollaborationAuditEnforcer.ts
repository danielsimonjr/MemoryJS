/**
 * Collaboration Audit Enforcer (η.5.5.d)
 *
 * Thin proxy over `EntityManager` that forces every mutation to carry an
 * `agentId` and appends an `AuditLog` entry on success. Distinct from
 * `GovernanceManager`: this enforces *attribution only* — never blocks
 * writes on policy grounds.
 *
 * Use when you want a guarantee that the audit trail is never anonymous,
 * e.g. multi-agent / multi-user setups where "who did this?" must always
 * be answerable.
 *
 * @module agent/collaboration/CollaborationAuditEnforcer
 */

import type { Entity } from '../../types/index.js';
import type { EntityManager } from '../../core/EntityManager.js';
import type { AuditLog } from '../../features/AuditLog.js';
import { AttributionRequiredError } from '../../utils/errors.js';

/**
 * Mode controls whether missing agentId is rejected or auto-substituted.
 *
 * - `strict` — throw `AttributionRequiredError` on any mutation without `agentId`.
 * - `lenient` — accept calls without agentId (audit entries omit the field).
 *   Useful for back-compat wrapping around legacy callers.
 */
export type AttributionMode = 'strict' | 'lenient';

/** Constructor options. */
export interface CollaborationAuditEnforcerOptions {
  /**
   * `strict` (default) throws on missing agentId. Drive from
   * `MEMORY_AUDIT_ATTRIBUTION_REQUIRED` to flip behavior at construction
   * time.
   */
  mode?: AttributionMode;
}

export class CollaborationAuditEnforcer {
  private readonly mode: AttributionMode;

  constructor(
    private readonly entityManager: EntityManager,
    private readonly auditLog: AuditLog,
    options?: CollaborationAuditEnforcerOptions,
  ) {
    this.mode = options?.mode ?? 'strict';
  }

  /**
   * Create entities and append a `create` audit entry per entity.
   * In strict mode, an empty/undefined `agentId` throws.
   */
  async createEntities(
    entities: Array<Omit<Entity, 'createdAt' | 'lastModified'>>,
    agentId: string | undefined,
  ): Promise<Entity[]> {
    this.requireAttribution(agentId, 'createEntities');
    const created = await this.entityManager.createEntities(entities);
    for (const e of created) {
      await this.auditLog.append({
        operation: 'create',
        entityName: e.name,
        agentId,
        before: undefined,
        after: { ...e },
        status: 'committed',
      });
    }
    return created;
  }

  /**
   * Update one entity and append an `update` audit entry capturing
   * before/after state. Forwards optional `expectedVersion` (η.5.5.c) to
   * the underlying `updateEntity` for OCC composition.
   */
  async updateEntity(
    name: string,
    updates: Partial<Entity>,
    agentId: string | undefined,
    options?: { expectedVersion?: number },
  ): Promise<Entity> {
    this.requireAttribution(agentId, 'updateEntity');
    const before = await this.entityManager.getEntity(name);
    const after = await this.entityManager.updateEntity(name, updates, options);
    await this.auditLog.append({
      operation: 'update',
      entityName: name,
      agentId,
      before: before ? { ...before } : undefined,
      after: { ...after },
      status: 'committed',
    });
    return after;
  }

  /**
   * Delete entities and append a `delete` audit entry per entity. Reads
   * the pre-delete snapshot for each to populate `before`.
   */
  async deleteEntities(
    names: string[],
    agentId: string | undefined,
  ): Promise<void> {
    this.requireAttribution(agentId, 'deleteEntities');
    // Snapshot before delete so the audit trail captures the state.
    const snapshots = await Promise.all(
      names.map(n => this.entityManager.getEntity(n)),
    );
    await this.entityManager.deleteEntities(names);
    for (let i = 0; i < names.length; i++) {
      const snap = snapshots[i];
      // Skip audit for entities that didn't exist (deleteEntities is no-op
      // for missing names; matching that behavior in the audit trail).
      if (!snap) continue;
      await this.auditLog.append({
        operation: 'delete',
        entityName: names[i],
        agentId,
        before: { ...snap },
        after: undefined,
        status: 'committed',
      });
    }
  }

  private requireAttribution(agentId: string | undefined, operation: string): void {
    if (this.mode === 'strict' && (!agentId || agentId.trim() === '')) {
      throw new AttributionRequiredError(operation);
    }
  }
}
