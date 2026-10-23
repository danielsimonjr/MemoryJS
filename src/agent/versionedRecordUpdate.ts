/**
 * Versioned Record Update
 *
 * Writes one record with an expected version and maps the write errors
 * to lifecycle result tags.
 *
 * @module agent/versionedRecordUpdate
 */

import type { Entity } from '../types/types.js';
import type { EntityManager } from '../core/EntityManager.js';
import { VersionConflictError, EntityNotFoundError } from '../utils/errors.js';

/**
 * Updates an entity with an expected version (optimistic concurrency control).
 * Returns `success` when the update completes.
 * Returns 'conflict' when the update throws VersionConflictError.
 * Returns 'vanished-mid-update' when the update throws EntityNotFoundError.
 * Rethrows any other error.
 */
export async function updateRecordVersioned<S extends string>(
  entityManager: EntityManager,
  id: string,
  patch: Record<string, unknown>,
  expectedVersion: number,
  success: S
): Promise<S | 'conflict' | 'vanished-mid-update'> {
  try {
    await entityManager.updateEntity(id, patch as unknown as Partial<Entity>, { expectedVersion });
    return success;
  } catch (err) {
    if (err instanceof VersionConflictError) return 'conflict';
    if (err instanceof EntityNotFoundError) return 'vanished-mid-update';
    throw err;
  }
}
