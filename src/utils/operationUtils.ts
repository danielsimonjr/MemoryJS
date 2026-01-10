/**
 * Operation Utilities
 *
 * Phase 9B: Utilities for long-running operations with progress tracking
 * and cancellation support.
 *
 * @module utils/operationUtils
 */

import { OperationCancelledError } from './errors.js';
import type { ProgressCallback } from './taskScheduler.js';

/**
 * Check if an operation has been cancelled via AbortSignal.
 * Throws OperationCancelledError if the signal is aborted.
 *
 * @param signal - Optional AbortSignal to check
 * @param operation - Optional operation name for error message
 * @throws OperationCancelledError if signal is aborted
 *
 * @example
 * ```typescript
 * for (const item of items) {
 *   checkCancellation(options?.signal, 'batch processing');
 *   await processItem(item);
 * }
 * ```
 */
export function checkCancellation(signal?: AbortSignal, operation?: string): void {
  if (signal?.aborted) {
    throw new OperationCancelledError(operation);
  }
}

/**
 * Create a throttled progress reporter to avoid excessive callback invocations.
 * Returns undefined if no callback is provided.
 *
 * @param callback - Optional progress callback to throttle
 * @param throttleMs - Minimum time between callbacks (default: 100ms)
 * @returns Throttled callback or undefined
 *
 * @example
 * ```typescript
 * const reportProgress = createProgressReporter(options?.onProgress, 50);
 * for (let i = 0; i < total; i++) {
 *   reportProgress?.({ completed: i, total, percentage: (i / total) * 100 });
 * }
 * ```
 */
export function createProgressReporter(
  callback?: ProgressCallback,
  throttleMs: number = 100
): ProgressCallback | undefined {
  if (!callback) return undefined;

  let lastCallTime = 0;

  return (progress) => {
    const now = Date.now();
    // Always report 0% and 100%
    if (progress.percentage === 0 || progress.percentage >= 100 || now - lastCallTime >= throttleMs) {
      lastCallTime = now;
      callback(progress);
    }
  };
}

/**
 * Create a progress object for reporting.
 *
 * @param completed - Number of completed items
 * @param total - Total number of items
 * @param currentTaskId - Optional current task identifier
 * @returns Progress object suitable for ProgressCallback
 *
 * @example
 * ```typescript
 * reportProgress?.(createProgress(50, 100, 'processing entities'));
 * // { completed: 50, total: 100, percentage: 50, currentTaskId: 'processing entities' }
 * ```
 */
export function createProgress(
  completed: number,
  total: number,
  currentTaskId?: string
): { completed: number; total: number; percentage: number; currentTaskId?: string } {
  return {
    completed,
    total,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    currentTaskId,
  };
}

/**
 * Phase definition for executeWithPhases.
 */
export interface PhaseDefinition<T> {
  /** Phase name (used for progress reporting and cancellation error messages) */
  name: string;
  /** Weight of this phase relative to others (higher = more of total progress) */
  weight: number;
  /** Executor function that performs the phase work */
  execute: (phaseProgress: (pct: number) => void) => Promise<T>;
}

/**
 * Execute an operation with multiple distinct phases.
 * Useful when an operation has multiple distinct phases with different weights.
 *
 * @param phases - Array of phase definitions with weight and executor
 * @param onProgress - Optional progress callback
 * @param signal - Optional abort signal
 * @returns Array of results from each phase
 * @throws OperationCancelledError if cancelled during any phase
 *
 * @example
 * ```typescript
 * const [parseResult, processResult, saveResult] = await executeWithPhases([
 *   { name: 'parsing', weight: 20, execute: () => parseData() },
 *   { name: 'processing', weight: 60, execute: () => processEntities() },
 *   { name: 'saving', weight: 20, execute: () => saveResults() },
 * ], options?.onProgress, options?.signal);
 * ```
 */
export async function executeWithPhases<T>(
  phases: PhaseDefinition<T>[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<T[]> {
  const totalWeight = phases.reduce((sum, p) => sum + p.weight, 0);
  let completedWeight = 0;
  const results: T[] = [];

  for (const phase of phases) {
    checkCancellation(signal, phase.name);

    const phaseStartWeight = completedWeight;
    const phaseProgress = (phasePct: number) => {
      if (onProgress) {
        const overallPct = ((phaseStartWeight + (phase.weight * phasePct / 100)) / totalWeight) * 100;
        onProgress({
          completed: Math.round(overallPct),
          total: 100,
          percentage: Math.round(overallPct),
          currentTaskId: phase.name,
        });
      }
    };

    const result = await phase.execute(phaseProgress);
    results.push(result);
    completedWeight += phase.weight;
  }

  // Report 100% completion
  onProgress?.({
    completed: 100,
    total: 100,
    percentage: 100,
  });

  return results;
}

/**
 * Execute an operation in batches with progress tracking and cancellation support.
 *
 * @param items - Array of items to process
 * @param batchSize - Size of each batch
 * @param processBatch - Function to process each batch
 * @param onProgress - Optional progress callback
 * @param signal - Optional abort signal
 * @param operationName - Optional operation name for cancellation error
 * @returns Array of results from all batches
 *
 * @example
 * ```typescript
 * const results = await processBatchesWithProgress(
 *   entities,
 *   100,
 *   async (batch) => {
 *     for (const entity of batch) {
 *       await saveEntity(entity);
 *     }
 *     return batch.length;
 *   },
 *   options?.onProgress,
 *   options?.signal,
 *   'createEntities'
 * );
 * ```
 */
export async function processBatchesWithProgress<T, R>(
  items: T[],
  batchSize: number,
  processBatch: (batch: T[], batchIndex: number) => Promise<R>,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  operationName?: string
): Promise<R[]> {
  const results: R[] = [];
  const total = items.length;
  let processed = 0;

  const reportProgress = createProgressReporter(onProgress);
  reportProgress?.(createProgress(0, total, operationName));

  for (let i = 0; i < items.length; i += batchSize) {
    checkCancellation(signal, operationName);

    const batch = items.slice(i, i + batchSize);
    const result = await processBatch(batch, Math.floor(i / batchSize));
    results.push(result);

    processed += batch.length;
    reportProgress?.(createProgress(processed, total, operationName));
  }

  reportProgress?.(createProgress(total, total, operationName));
  return results;
}
