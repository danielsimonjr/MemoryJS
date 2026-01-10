/**
 * Parallel Utilities
 *
 * Utilities for parallel array operations using workerpool.
 * Phase 8 Sprint 3: Parallel array operations for improved performance.
 *
 * **SECURITY WARNING:** These functions use `new Function()` internally for worker serialization.
 * The `fn` parameter MUST be a real function object, never a user-provided string.
 * Runtime validation ensures only function objects are accepted.
 *
 * @module utils/parallelUtils
 */

import workerpool from '@danielsimonjr/workerpool';

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
 * Minimum array size to activate parallel processing.
 * For smaller arrays, single-threaded is more efficient due to worker overhead.
 */
const MIN_PARALLEL_SIZE = 200;

/**
 * Shared worker pool instance for all parallel utilities.
 * Initialized lazily on first use.
 */
let sharedPool: workerpool.Pool | null = null;

/**
 * Get or create the shared worker pool.
 * Uses inline worker execution (no separate worker file needed).
 *
 * @returns Worker pool instance
 */
function getPool(): workerpool.Pool {
  if (!sharedPool) {
    sharedPool = workerpool.pool({
      maxWorkers: Math.max(1, workerpool.cpus - 1),
      workerType: 'thread',
    });
  }
  return sharedPool;
}

/**
 * Shutdown the shared worker pool and clean up resources.
 * Should be called when parallel utilities are no longer needed.
 */
export async function shutdownParallelUtils(): Promise<void> {
  if (sharedPool) {
    await sharedPool.terminate();
    sharedPool = null;
  }
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
  fn: (item: T) => R,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<R[]> {
  // Security: Validate that fn is a real function, not a user-provided string
  validateFunction(fn, 'fn');

  // Fall back to single-threaded for small arrays
  if (items.length < MIN_PARALLEL_SIZE) {
    return items.map(fn);
  }

  try {
    const pool = getPool();

    // Split items into chunks
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    // Convert function to string for serialization
    const fnString = fn.toString();

    // Process chunks in parallel using inline function execution
    const results = await Promise.all(
      chunks.map(chunk =>
        pool.exec(
          (chunkData: T[], fnStr: string) => {
            // Reconstruct function from string
            // eslint-disable-next-line no-new-func
            const mapFn = new Function('return ' + fnStr)() as (item: T) => R;
            return chunkData.map(mapFn);
          },
          [chunk, fnString]
        ) as Promise<R[]>
      )
    );

    // Flatten results
    return results.flat();
  } catch (error) {
    // Fall back to single-threaded if worker execution fails
    // (e.g., in test environments with ESM/worker compatibility issues)
    return items.map(fn);
  }
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
  predicate: (item: T) => boolean,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<T[]> {
  // Security: Validate that predicate is a real function, not a user-provided string
  validateFunction(predicate, 'predicate');

  // Fall back to single-threaded for small arrays
  if (items.length < MIN_PARALLEL_SIZE) {
    return items.filter(predicate);
  }

  try {
    const pool = getPool();

    // Split items into chunks
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    // Convert function to string for serialization
    const predicateString = predicate.toString();

    // Process chunks in parallel using inline function execution
    const results = await Promise.all(
      chunks.map(chunk =>
        pool.exec(
          (chunkData: T[], predicateStr: string) => {
            // Reconstruct function from string
            // eslint-disable-next-line no-new-func
            const filterFn = new Function('return ' + predicateStr)() as (item: T) => boolean;
            return chunkData.filter(filterFn);
          },
          [chunk, predicateString]
        ) as Promise<T[]>
      )
    );

    // Flatten results
    return results.flat();
  } catch (error) {
    // Fall back to single-threaded if worker execution fails
    // (e.g., in test environments with ESM/worker compatibility issues)
    return items.filter(predicate);
  }
}

/**
 * Get statistics about the worker pool.
 *
 * @returns Pool statistics or null if pool is not initialized
 */
export function getPoolStats(): workerpool.PoolStats | null {
  if (!sharedPool) {
    return null;
  }
  return sharedPool.stats();
}
