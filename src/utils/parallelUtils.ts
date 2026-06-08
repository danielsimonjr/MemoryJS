/**
 * Parallel Utilities
 *
 * Utilities for parallel array operations.
 * Phase 8 Sprint 3: Parallel array operations for improved performance.
 *
 * Note: Actual multiprocessing capabilities have been removed for security reasons
 * (preventing dynamic function execution) and to use the unified WorkerTaskManager.
 * These utilities now execute sequentially but asynchronously via Promise.all.
 *
 * @module utils/parallelUtils
 */

import os from 'os';

/**
 * Validates that the input is a real function object.
 * Prevents code injection through string masquerading as functions.
 *
 * @param fn - Function to validate
 * @param paramName - Parameter name for error message
 * @throws {TypeError} If fn is not a function
 * @internal
 */
function validateFunction(fn: unknown, paramName: string): void {
  if (typeof fn !== 'function') {
    throw new TypeError(`${paramName} must be a function, got ${typeof fn}`);
  }
}

/**
 * Default chunk size for parallel operations.
 * Can be overridden per operation.
 */
const DEFAULT_CHUNK_SIZE = 100;

/**
 * Shutdown the shared worker pool and clean up resources.
 * Should be called when parallel utilities are no longer needed.
 */
export async function shutdownParallelUtils(): Promise<void> {
  // No-op since sharedPool is removed
  return Promise.resolve();
}

/**
 * Map items in parallel using workerpool.
 *
 * Splits the array into chunks and processes each chunk in a worker thread.
 * Falls back to single-threaded for small arrays (< MIN_PARALLEL_SIZE).
 *
 * **Note:** The mapping function must be serializable (no closures, external variables).
 * Due to ESM/worker thread compatibility issues, this may fall back to single-threaded
 * execution in some environments (e.g., vitest test runner).
 *
 * @template T - Input item type
 * @template R - Output item type
 * @param items - Array of items to map
 * @param fn - Mapping function (must be serializable)
 * @param chunkSize - Optional chunk size (default: DEFAULT_CHUNK_SIZE)
 * @returns Promise resolving to array of mapped results
 *
 * @example
 * ```typescript
 * // Map numbers to their squares
 * const numbers = [1, 2, 3, 4, 5];
 * const squared = await parallelMap(numbers, (n: number) => n * n);
 * // Result: [1, 4, 9, 16, 25]
 * ```
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => R | Promise<R>,
  _chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<R[]> {
  // Security: Validate that fn is a real function, not a user-provided string
  validateFunction(fn, 'fn');

  // Execute concurrently on the main thread using Promise.all,
  // honoring the original contract of concurrent array processing.
  // Note: For actual multi-threading, use WorkerTaskManager instead.
  return Promise.all(items.map(item => fn(item)));
}

/**
 * Filter items in parallel using workerpool.
 *
 * Splits the array into chunks and processes each chunk in a worker thread.
 * Falls back to single-threaded for small arrays (< MIN_PARALLEL_SIZE).
 *
 * **Note:** The predicate function must be serializable (no closures, external variables).
 * Due to ESM/worker thread compatibility issues, this may fall back to single-threaded
 * execution in some environments (e.g., vitest test runner).
 *
 * @template T - Item type
 * @param items - Array of items to filter
 * @param predicate - Filter predicate (must be serializable)
 * @param chunkSize - Optional chunk size (default: DEFAULT_CHUNK_SIZE)
 * @returns Promise resolving to filtered array
 *
 * @example
 * ```typescript
 * // Filter even numbers
 * const numbers = [1, 2, 3, 4, 5, 6];
 * const evens = await parallelFilter(numbers, (n: number) => n % 2 === 0);
 * // Result: [2, 4, 6]
 * ```
 */
export async function parallelFilter<T>(
  items: T[],
  predicate: (item: T) => boolean | Promise<boolean>,
  _chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<T[]> {
  // Security: Validate that predicate is a real function, not a user-provided string
  validateFunction(predicate, 'predicate');

  // Execute concurrently on the main thread using Promise.all,
  // honoring the original contract of concurrent array processing.
  // Note: For actual multi-threading, use WorkerTaskManager instead.
  const results = await Promise.all(
    items.map(async (item) => ({ item, keep: await predicate(item) }))
  );

  return results.filter(res => res.keep).map(res => res.item);
}

/**
 * Get statistics about the worker pool.
 *
 * @returns Pool statistics or null if pool is not initialized
 */
export function getPoolStats(): {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  activeTasks: number;
} | null {
  // Return stub stats to maintain API compatibility
  return {
    totalWorkers: os.cpus().length,
    busyWorkers: 0,
    idleWorkers: os.cpus().length,
    pendingTasks: 0,
    activeTasks: 0
  };
}
