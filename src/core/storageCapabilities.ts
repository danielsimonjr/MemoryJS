/**
 * Storage capability guards (DES-1).
 *
 * `IGraphStorage` declares the batch delta primitives and `graphMutex` as
 * OPTIONAL members so third-party / test implementations stay valid. These
 * helpers let managers narrow an `IGraphStorage` to the capability they need
 * without casting to the concrete `GraphStorage` class.
 *
 * @module core/storageCapabilities
 * @internal
 */

import type { IGraphStorage } from '../types/index.js';

/** Storage whose five batch delta primitives are all present. */
export type DeltaCapableStorage = IGraphStorage &
  Required<
    Pick<
      IGraphStorage,
      'appendEntities' | 'appendRelations' | 'updateEntities' | 'deleteEntities' | 'deleteRelations'
    >
  >;

/** Storage that exposes a manager-level write lock. */
export type WriteLockableStorage = IGraphStorage & {
  graphMutex: NonNullable<IGraphStorage['graphMutex']>;
};

const DELTA_METHODS = [
  'appendEntities',
  'appendRelations',
  'updateEntities',
  'deleteEntities',
  'deleteRelations',
] as const;

/**
 * True when the storage implements all five batch delta primitives.
 * Both first-party backends do; minimal fakes typically do not.
 */
export function hasDeltaPrimitives(storage: IGraphStorage): storage is DeltaCapableStorage {
  return DELTA_METHODS.every(name => typeof storage[name] === 'function');
}

/** True when the storage exposes a `graphMutex` with an `acquire` method. */
export function hasWriteLock(storage: IGraphStorage): storage is WriteLockableStorage {
  const mutex = storage.graphMutex;
  return mutex !== undefined && mutex !== null && typeof mutex.acquire === 'function';
}

/**
 * Run `fn` while holding the storage's manager-level write lock. Storages
 * without `graphMutex` run `fn` directly. The lock is released in `finally`
 * even when `fn` throws.
 */
export async function withStorageWriteLock<T>(
  storage: IGraphStorage,
  fn: () => Promise<T>,
): Promise<T> {
  if (!hasWriteLock(storage)) return fn();
  const release = await storage.graphMutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
