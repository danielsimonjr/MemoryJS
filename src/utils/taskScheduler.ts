/**
 * Task Scheduler
 *
 * Advanced task scheduling utilities using workerpool.
 * Phase 8 Sprint 4: Priority queues, concurrency control, progress tracking.
 *
 * **SECURITY WARNING:** TaskQueue uses `new Function()` internally for worker serialization.
 * Task functions MUST be real function objects, never user-provided strings.
 * Runtime validation ensures only function objects are accepted.
 *
 * @module utils/taskScheduler
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

// ==================== Types ====================

/**
 * Task priority levels.
 * Higher priority tasks are executed first.
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Task status in the queue.
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Task definition for the queue.
 */
export interface Task<T = unknown, R = unknown> {
  /** Unique task identifier */
  id: string;
  /** Task priority */
  priority: TaskPriority;
  /** Function to execute (must be serializable) */
  fn: (input: T) => R;
  /** Input data for the function */
  input: T;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Optional task metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task result after execution.
 */
export interface TaskResult<R = unknown> {
  /** Task identifier */
  id: string;
  /** Task status */
  status: TaskStatus;
  /** Result if successful */
  result?: R;
  /** Error if failed */
  error?: Error;
  /** Execution duration in milliseconds */
  duration: number;
  /** Start timestamp */
  startedAt: number;
  /** End timestamp */
  completedAt: number;
}

/**
 * Progress callback for batch operations.
 */
export type ProgressCallback = (progress: {
  completed: number;
  total: number;
  percentage: number;
  currentTaskId?: string;
}) => void;

/**
 * Batch processing options.
 */
export interface TaskBatchOptions {
  /** Maximum concurrent tasks (default: CPU count - 1) */
  concurrency?: number;
  /** Task timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Progress callback */
  onProgress?: ProgressCallback;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
}

/**
 * Task queue statistics.
 */
export interface QueueStats {
  /** Number of pending tasks */
  pending: number;
  /** Number of running tasks */
  running: number;
  /** Number of completed tasks */
  completed: number;
  /** Number of failed tasks */
  failed: number;
  /** Average execution time in milliseconds */
  averageExecutionTime: number;
  /** Total tasks processed */
  totalProcessed: number;
}

// ==================== Task Queue Implementation ====================

/**
 * Internal task wrapper with tracking information.
 */
interface QueuedTask<T = unknown, R = unknown> extends Task<T, R> {
  status: TaskStatus;
  addedAt: number;
  resolve: (result: TaskResult<R>) => void;
  reject: (error: Error) => void;
}

/**
 * Priority Task Queue with advanced scheduling.
 *
 * Features:
 * - Priority-based execution (CRITICAL > HIGH > NORMAL > LOW)
 * - Configurable concurrency limits
 * - Progress tracking
 * - Graceful error handling
 * - Task cancellation
 *
 * @example
 * ```typescript
 * const queue = new TaskQueue({ concurrency: 4 });
 *
 * // Add tasks with different priorities
 * queue.enqueue({
 *   id: 'task1',
 *   priority: TaskPriority.HIGH,
 *   fn: (x: number) => x * 2,
 *   input: 5,
 * });
 *
 * // Process all tasks
 * const results = await queue.processAll();
 * ```
 */
export class TaskQueue {
  private queue: QueuedTask[] = [];
  private running: Map<string, QueuedTask> = new Map();
  private completed: TaskResult[] = [];
  private pool: workerpool.Pool | null = null;
  private concurrency: number;
  private defaultTimeout: number;
  private isProcessing = false;
  private totalExecutionTime = 0;
  private totalProcessed = 0;
  private useWorkerPool: boolean;

  constructor(options: { concurrency?: number; timeout?: number; useWorkerPool?: boolean } = {}) {
    this.concurrency = options.concurrency ?? Math.max(1, workerpool.cpus - 1);
    this.defaultTimeout = options.timeout ?? 30000;
    this.useWorkerPool = options.useWorkerPool ?? true;
  }

  /**
   * Get or create the worker pool.
   */
  private getPool(): workerpool.Pool {
    if (!this.pool) {
      this.pool = workerpool.pool({
        maxWorkers: this.concurrency,
        workerType: 'thread',
      });
    }
    return this.pool;
  }

  /**
   * Add a task to the queue.
   *
   * @param task - Task to add
   * @returns Promise that resolves when the task completes
   */
  enqueue<T, R>(task: Task<T, R>): Promise<TaskResult<R>> {
    // Security: Validate that task.fn is a real function, not a user-provided string
    validateFunction(task.fn, 'task.fn');

    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask<T, R> = {
        ...task,
        status: TaskStatus.PENDING,
        addedAt: Date.now(),
        resolve: resolve as (result: TaskResult<unknown>) => void,
        reject,
      };

      // Insert based on priority (higher priority first)
      const insertIndex = this.queue.findIndex(t => t.priority < task.priority);
      if (insertIndex === -1) {
        this.queue.push(queuedTask as QueuedTask);
      } else {
        this.queue.splice(insertIndex, 0, queuedTask as QueuedTask);
      }

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processNext();
      }
    });
  }

  /**
   * Process the next task in the queue.
   */
  private async processNext(): Promise<void> {
    if (this.running.size >= this.concurrency || this.queue.length === 0) {
      if (this.running.size === 0 && this.queue.length === 0) {
        this.isProcessing = false;
      }
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) return;

    task.status = TaskStatus.RUNNING;
    this.running.set(task.id, task);

    const startTime = Date.now();

    try {
      // Execute task - try worker pool first, fall back to direct execution
      let result: unknown;

      if (this.useWorkerPool) {
        try {
          const pool = this.getPool();
          const fnString = task.fn.toString();
          const timeout = task.timeout ?? this.defaultTimeout;

          result = await pool
            .exec(
              (input: unknown, fnStr: string) => {
                // eslint-disable-next-line no-new-func
                const fn = new Function('return ' + fnStr)();
                return fn(input);
              },
              [task.input, fnString]
            )
            .timeout(timeout);
        } catch {
          // Fall back to direct execution
          result = await Promise.resolve(task.fn(task.input));
        }
      } else {
        // Direct execution without worker pool
        result = await Promise.resolve(task.fn(task.input));
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      const taskResult: TaskResult = {
        id: task.id,
        status: TaskStatus.COMPLETED,
        result,
        duration,
        startedAt: startTime,
        completedAt: endTime,
      };

      this.totalExecutionTime += duration;
      this.totalProcessed++;
      this.completed.push(taskResult);
      this.running.delete(task.id);
      task.resolve(taskResult);
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      const taskResult: TaskResult = {
        id: task.id,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
        duration,
        startedAt: startTime,
        completedAt: endTime,
      };

      this.totalProcessed++;
      this.completed.push(taskResult);
      this.running.delete(task.id);
      task.resolve(taskResult);
    }

    // Process next task
    this.processNext();
  }

  /**
   * Cancel a pending task.
   *
   * @param taskId - ID of the task to cancel
   * @returns True if task was cancelled, false if not found or already running
   */
  cancel(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index === -1) return false;

    const task = this.queue.splice(index, 1)[0];
    task.status = TaskStatus.CANCELLED;

    const result: TaskResult = {
      id: task.id,
      status: TaskStatus.CANCELLED,
      duration: 0,
      startedAt: Date.now(),
      completedAt: Date.now(),
    };

    task.resolve(result);
    return true;
  }

  /**
   * Wait for all tasks to complete.
   *
   * @returns Array of all task results
   */
  async drain(): Promise<TaskResult[]> {
    // Wait for queue to empty and all running tasks to complete
    while (this.queue.length > 0 || this.running.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return [...this.completed];
  }

  /**
   * Get queue statistics.
   */
  getStats(): QueueStats {
    return {
      pending: this.queue.length,
      running: this.running.size,
      completed: this.completed.filter(r => r.status === TaskStatus.COMPLETED).length,
      failed: this.completed.filter(r => r.status === TaskStatus.FAILED).length,
      averageExecutionTime:
        this.totalProcessed > 0 ? this.totalExecutionTime / this.totalProcessed : 0,
      totalProcessed: this.totalProcessed,
    };
  }

  /**
   * Clear all completed results.
   */
  clearCompleted(): void {
    this.completed = [];
  }

  /**
   * Shutdown the task queue and release resources.
   */
  async shutdown(): Promise<void> {
    // Cancel all pending tasks
    for (const task of this.queue) {
      task.status = TaskStatus.CANCELLED;
      task.resolve({
        id: task.id,
        status: TaskStatus.CANCELLED,
        duration: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
    }
    this.queue = [];

    // Terminate worker pool
    if (this.pool) {
      await this.pool.terminate();
      this.pool = null;
    }

    this.isProcessing = false;
  }
}

// ==================== Batch Processing Utilities ====================

/**
 * Process items in parallel batches with progress tracking.
 *
 * Unlike parallelMap, this provides:
 * - Progress callbacks
 * - Configurable concurrency
 * - Error handling options
 * - Task-level timeouts
 *
 * @template T - Input item type
 * @template R - Output item type
 * @param items - Array of items to process
 * @param fn - Processing function (must be serializable)
 * @param options - Batch processing options
 * @returns Array of results (or errors if stopOnError is false)
 *
 * @example
 * ```typescript
 * const results = await batchProcess(
 *   urls,
 *   (url: string) => fetch(url).then(r => r.json()),
 *   {
 *     concurrency: 5,
 *     timeout: 10000,
 *     onProgress: ({ completed, total, percentage }) => {
 *       console.log(`Progress: ${percentage.toFixed(1)}%`);
 *     },
 *   }
 * );
 * ```
 */
export async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => R | Promise<R>,
  options: TaskBatchOptions = {}
): Promise<Array<{ success: true; result: R } | { success: false; error: Error }>> {
  const {
    concurrency = Math.max(1, workerpool.cpus - 1),
    timeout = 30000,
    onProgress,
    stopOnError = false,
  } = options;

  const results: Array<{ success: true; result: R } | { success: false; error: Error }> = [];
  let completed = 0;
  const total = items.length;

  // Process in batches respecting concurrency
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);

    const batchPromises = batch.map(async (item, batchIndex) => {
      const itemIndex = i + batchIndex;

      try {
        // Execute with timeout
        const result = await Promise.race([
          Promise.resolve(fn(item)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Task timeout')), timeout)
          ),
        ]);

        results[itemIndex] = { success: true, result };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        results[itemIndex] = { success: false, error: err };

        if (stopOnError) {
          throw err;
        }
      } finally {
        completed++;
        if (onProgress) {
          onProgress({
            completed,
            total,
            percentage: (completed / total) * 100,
            currentTaskId: `item-${itemIndex}`,
          });
        }
      }
    });

    await Promise.all(batchPromises);
  }

  return results;
}

/**
 * Execute tasks with rate limiting.
 *
 * Ensures tasks don't exceed a specified rate (tasks per second).
 *
 * @template T - Input item type
 * @template R - Output item type
 * @param items - Items to process
 * @param fn - Processing function
 * @param rateLimit - Maximum tasks per second
 * @returns Array of results
 *
 * @example
 * ```typescript
 * // Process max 10 items per second
 * const results = await rateLimitedProcess(
 *   items,
 *   (item) => processItem(item),
 *   10
 * );
 * ```
 */
export async function rateLimitedProcess<T, R>(
  items: T[],
  fn: (item: T) => R | Promise<R>,
  rateLimit: number
): Promise<R[]> {
  const results: R[] = [];
  const minInterval = 1000 / rateLimit;
  let lastExecutionTime = 0;

  for (const item of items) {
    // Calculate wait time
    const now = Date.now();
    const timeSinceLast = now - lastExecutionTime;
    if (timeSinceLast < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLast));
    }

    lastExecutionTime = Date.now();
    const result = await fn(item);
    results.push(result);
  }

  return results;
}

/**
 * Retry a function with exponential backoff.
 *
 * @template T - Return type
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(),
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => T | Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        if (onRetry) {
          onRetry(lastError, attempt + 1);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Create a debounced version of a function.
 *
 * @template T - Function arguments type
 * @template R - Return type
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends unknown[], R>(
  fn: (...args: T) => R,
  delay: number
): (...args: T) => Promise<R> {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingResolve: ((value: R) => void) | null = null;

  return (...args: T): Promise<R> => {
    return new Promise(resolve => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      pendingResolve = resolve;

      timeoutId = setTimeout(() => {
        const result = fn(...args);
        if (pendingResolve) {
          pendingResolve(result);
        }
        timeoutId = null;
        pendingResolve = null;
      }, delay);
    });
  };
}

/**
 * Create a throttled version of a function.
 *
 * @template T - Function arguments type
 * @template R - Return type
 * @param fn - Function to throttle
 * @param limit - Minimum time between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends unknown[], R>(
  fn: (...args: T) => R,
  limit: number
): (...args: T) => R | undefined {
  let lastCall = 0;

  return (...args: T): R | undefined => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn(...args);
    }
    return undefined;
  };
}
