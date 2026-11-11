/**
 * Versioned Write Failure
 *
 * Maps the error of a write that carried an expected version to a lifecycle
 * result tag, and runs the read → type-guard → already-done → timestamped patch
 * → OCC write sequence shared by the versioned lifecycle managers
 * (`AgentReflectionManager.archive`, `FailureManager.markResolved`).
 *
 * @module agent/versionedWriteFailure
 */

import type { Entity } from '../types/types.js';
import type { EntityManager } from '../core/EntityManager.js';
import { toIsoDateTime } from '../types/agent-memory.js';
import { VersionConflictError, EntityNotFoundError } from '../utils/errors.js';

/**
 * Maps the error of a versioned entity write.
 * Returns 'conflict' for a VersionConflictError.
 * Returns 'vanished-mid-update' for an EntityNotFoundError.
 * Rethrows any other error, unchanged.
 * This function runs synchronously. The caller keeps its own try and await,
 * so the caller settles in the same number of microtask turns as a method
 * that handles the error inline.
 */
export function versionedWriteFailure(err: unknown): 'conflict' | 'vanished-mid-update' {
  if (err instanceof VersionConflictError) return 'conflict';
  if (err instanceof EntityNotFoundError) return 'vanished-mid-update';
  throw err;
}

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
