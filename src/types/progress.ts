/**
 * Progress Types
 *
 * Type definitions for progress reporting.
 * Phase 1 Sprint 10: Progress Callbacks and Error Improvements.
 *
 * @module types/progress
 */

/**
 * Progress information for batch operations.
 */
export interface ProgressInfo {
  /** Current item index (0-based) */
  current: number;
  /** Total number of items */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Human-readable progress message */
  message: string;
  /** Current phase of operation (for multi-phase operations) */
  phase?: string;
  /** Name/identifier of current item being processed */
  currentItem?: string;
  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs?: number;
  /** Start time of operation (ISO 8601) */
  startedAt?: string;
  /** Whether operation can be cancelled */
  cancellable?: boolean;
}

/**
 * Callback for receiving detailed progress updates.
 * Uses ProgressInfo for rich progress information.
 * (Note: utils/taskScheduler.ts exports a simpler ProgressInfoCallback type)
 */
export type ProgressInfoCallback = (progress: ProgressInfo) => void;

/**
 * Options for operations that support progress reporting.
 */
export interface ProgressOptions {
  /** Callback to receive progress updates */
  onProgress?: ProgressInfoCallback;
  /** Minimum interval between progress callbacks (ms) */
  progressInterval?: number;
  /** Cancellation token */
  signal?: AbortSignal;
}

/**
 * Helper to create progress info.
 */
export function createProgressInfo(
  current: number,
  total: number,
  options?: {
    phase?: string;
    currentItem?: string;
    message?: string;
    startedAt?: Date;
    cancellable?: boolean;
  }
): ProgressInfo {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const message = options?.message ?? `Processing ${current}/${total} (${percentage}%)`;

  const progress: ProgressInfo = {
    current,
    total,
    percentage,
    message,
  };

  if (options?.phase) progress.phase = options.phase;
  if (options?.currentItem) progress.currentItem = options.currentItem;
  if (options?.cancellable !== undefined) progress.cancellable = options.cancellable;

  if (options?.startedAt) {
    const elapsedMs = Date.now() - options.startedAt.getTime();
    if (current > 0) {
      const msPerItem = elapsedMs / current;
      const remaining = total - current;
      progress.estimatedRemainingMs = Math.round(msPerItem * remaining);
    }
    progress.startedAt = options.startedAt.toISOString();
  }

  return progress;
}

/**
 * Throttle progress callbacks to avoid overwhelming consumers.
 */
export function createThrottledProgress(
  callback: ProgressInfoCallback,
  intervalMs: number = 100
): ProgressInfoCallback {
  let lastCall = 0;
  let pending: ProgressInfo | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (pending) {
      callback(pending);
      pending = null;
    }
  };

  return (progress: ProgressInfo): void => {
    const now = Date.now();

    // Always emit first (0) and last (100%) progress
    if (progress.current === 0 || progress.current === progress.total) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      callback(progress);
      lastCall = now;
      pending = null;
      return;
    }

    // Throttle intermediate updates
    if (now - lastCall >= intervalMs) {
      callback(progress);
      lastCall = now;
      pending = null;
    } else {
      pending = progress;
      // Schedule a final flush if no more updates come
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          flush();
          timeoutId = null;
        }, intervalMs);
      }
    }
  };
}

/**
 * Create a detailed progress reporter with automatic throttling.
 * Returns an object with report/complete/cancel methods.
 * (Note: utils/operationUtils.ts exports a simpler createProgressReporter function)
 */
export function createDetailedProgressReporter(
  total: number,
  callback?: ProgressInfoCallback,
  options?: {
    intervalMs?: number;
    phase?: string;
    cancellable?: boolean;
  }
): {
  report: (current: number, item?: string) => void;
  complete: () => void;
  cancel: () => void;
} {
  const startedAt = new Date();
  const throttled = callback ? createThrottledProgress(callback, options?.intervalMs ?? 100) : null;
  let cancelled = false;

  return {
    report: (current: number, item?: string): void => {
      if (cancelled || !throttled) return;

      throttled(
        createProgressInfo(current, total, {
          phase: options?.phase,
          currentItem: item,
          startedAt,
          cancellable: options?.cancellable,
        })
      );
    },
    complete: (): void => {
      if (cancelled || !throttled) return;

      throttled(
        createProgressInfo(total, total, {
          phase: options?.phase,
          message: 'Complete',
          startedAt,
        })
      );
    },
    cancel: (): void => {
      cancelled = true;
    },
  };
}
