/**
 * Versioned Write Failure
 *
 * Maps the error of a write that carried an expected version to a lifecycle
 * result tag.
 *
 * @module agent/versionedWriteFailure
 */

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
