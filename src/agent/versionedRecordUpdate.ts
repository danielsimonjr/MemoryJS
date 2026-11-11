/**
 * Versioned Record Update
 *
 * The read → type-guard → already-done → timestamped patch → OCC write sequence shared by
 * `AgentReflectionManager.archive` and `FailureManager.markResolved`.
 *
 * `updateEntity` carries `expectedVersion: entity.version ?? 1`, so a concurrent writer turns the
 * write into `'conflict'` and a concurrent delete into `'vanished-mid-update'` (mapped by
 * {@link versionedWriteFailure}). Record shapes stay with the callers: they pass `patch`.
 *
 * @module agent/versionedRecordUpdate
 * @internal
 */

import type { Entity } from '../types/types.js';
import type { EntityManager } from '../core/EntityManager.js';
import { toIsoDateTime } from '../types/agent-memory.js';
import { versionedWriteFailure } from './versionedWriteFailure.js';

/** Result tags shared by every versioned lifecycle patch. */
export type VersionedPatchFailure = 'not-found' | 'conflict' | 'vanished-mid-update';

/** Arguments for {@link patchVersionedRecord}. */
export interface PatchVersionedRecordOptions<E extends Entity, R> {
  /** Storage consulted for the current entity (a synchronous in-memory lookup). */
  storage: { getEntityByName(name: string): Entity | undefined };
  /** Manager that performs the versioned write. */
  entityManager: EntityManager;
  /** Entity name to patch. */
  id: string;
  /** Type guard for the record kind this lifecycle owns. */
  asTarget: (entity: Entity) => entity is E;
  /** Returns the result to settle with when the transition already happened, else `undefined`. */
  already: (entity: E) => R | undefined;
  /** Builds the entity patch and the success result from the entity and the write timestamp. */
  patch: (entity: E, now: string) => { updates: Partial<Entity>; result: R };
}

/**
 * Apply a versioned lifecycle transition to one entity.
 *
 * Returns `'not-found'` when the entity is absent or of the wrong kind, the caller's
 * already-done result when the transition is a no-op, the caller's success result after a
 * successful write, and `'conflict'` / `'vanished-mid-update'` when the versioned write lost a
 * race. Any other write error is rethrown unchanged.
 *
 * @param options - Lookup, guard, patch and write collaborators.
 * @returns The success result or a failure tag.
 */
export async function patchVersionedRecord<E extends Entity, R>(
  options: PatchVersionedRecordOptions<E, R>,
): Promise<R | VersionedPatchFailure> {
  const entity = options.storage.getEntityByName(options.id);
  if (!entity || !options.asTarget(entity)) return 'not-found';
  const done = options.already(entity);
  if (done !== undefined) return done;

  const now = toIsoDateTime(new Date());
  const { updates, result } = options.patch(entity, now);
  try {
    await options.entityManager.updateEntity(options.id, updates, { expectedVersion: entity.version ?? 1 });
    return result;
  } catch (err) {
    return versionedWriteFailure(err);
  }
}
