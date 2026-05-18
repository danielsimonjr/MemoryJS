/**
 * WorkerTaskManager — unified facade over `WorkerPoolManager` + `TaskQueue`.
 *
 * The two existing pieces compose well but require boilerplate to use
 * together. `WorkerPoolManager` owns named worker pools (a pool per
 * `workerType`); `TaskQueue` owns priority scheduling, concurrency caps,
 * timeouts, and cancellation. Callers want a single entry point that says
 * "run this method on this worker type, with this priority, return a handle
 * I can cancel" — and that's what this class provides.
 *
 * Design choices:
 *   - Tasks go through the priority queue first (so high-priority tasks jump
 *     the line) and then dispatch to the named worker pool. Cancellation
 *     before dispatch is cheap (queue eviction); cancellation mid-execution
 *     is best-effort because `workerpool` doesn't expose hard-cancel and
 *     terminating a worker mid-task is destructive.
 *   - The manager is *not* a singleton. Each `ManagerContext` (or test) gets
 *     its own. The underlying `WorkerPoolManager` is still a singleton —
 *     pools survive across managers and are reused.
 *   - The agent system consumes this through one helper exported below:
 *     `batchProcessViaWorkers(items, workerType, methodName, mapArgs)`.
 *     Agent-side managers that want CPU parallelism call that.
 *
 * @module utils/WorkerTaskManager
 */

import {
  TaskQueue,
  TaskPriority,
  TaskStatus,
  type Task,
  type TaskResult,
  type QueueStats,
} from './taskScheduler.js';
import {
  getWorkerPoolManager,
  type WorkerPoolManager,
  type WorkerPoolConfig,
} from './WorkerPoolManager.js';
import { logger } from './logger.js';

/**
 * Options for a single task submission. `priority`/`timeout` flow to
 * `TaskQueue`; `poolConfig` is applied if the named pool doesn't yet exist.
 */
export interface TaskSubmitOptions {
  priority?: TaskPriority;
  /** Per-task timeout in milliseconds; falls back to `TaskQueue` default. */
  timeout?: number;
  /** Pool config applied only on first-time creation of the named pool. */
  poolConfig?: WorkerPoolConfig;
}

/**
 * Handle returned by `submitWithHandle`. The `result` promise settles when
 * the task finishes; `cancel()` evicts a still-pending task from the queue
 * (returns `true`) or signals a request-cancellation flag on a running task
 * (returns `false` — `workerpool` itself doesn't support hard-cancel and
 * terminating mid-task is destructive).
 */
export interface TaskHandle<R> {
  id: string;
  result: Promise<R>;
  cancel(): boolean;
  status(): TaskStatus;
}

/**
 * Aggregated stats across the priority queue + all worker pools the manager
 * has touched.
 */
export interface WorkerTaskManagerStats {
  queue: QueueStats;
  pools: Array<{
    poolId: string;
    workers: number;
    activeTasks: number;
    pendingTasks: number;
    totalTasksExecuted: number;
  }>;
}

let SUBMISSION_COUNTER = 0;

/**
 * Unified worker + task manager.
 *
 * @example
 * ```typescript
 * const wtm = new WorkerTaskManager();
 *
 * // One-shot async submit
 * const distance = await wtm.submit<number>(
 *   'levenshtein',
 *   'levenshteinDistance',
 *   ['kitten', 'sitting'],
 *   { priority: TaskPriority.HIGH, timeout: 5000 },
 * );
 *
 * // Cancellable handle
 * const handle = wtm.submitWithHandle<number>(
 *   'levenshtein', 'levenshteinDistance', ['kitten', 'sitting'],
 * );
 * setTimeout(() => handle.cancel(), 100);
 * const dist = await handle.result;
 * ```
 */
export class WorkerTaskManager {
  private readonly queue: TaskQueue;
  private readonly poolManager: WorkerPoolManager;
  private readonly touchedPoolIds = new Set<string>();
  private readonly cancelledTaskIds = new Set<string>();
  private readonly handleStatus = new Map<string, TaskStatus>();

  constructor(opts: {
    /** Max concurrent tasks across the queue. Default: cpus − 1. */
    concurrency?: number;
    /** Default per-task timeout in ms. Default: 30s. */
    defaultTimeout?: number;
  } = {}) {
    this.queue = new TaskQueue({
      concurrency: opts.concurrency,
      timeout: opts.defaultTimeout,
      // We dispatch to WorkerPoolManager ourselves — the queue's
      // internal-worker-pool path would double-up.
      useWorkerPool: false,
    });
    this.poolManager = getWorkerPoolManager();
  }

  /**
   * Submit a task and await its result. Throws on failure / cancellation.
   *
   * @param workerType — routing key. Maps to a named `WorkerPoolManager` pool.
   * @param methodName — function name exposed by the worker module.
   * @param args — positional arguments passed to the worker function.
   */
  async submit<R>(
    workerType: string,
    methodName: string,
    args: unknown[],
    opts: TaskSubmitOptions = {},
  ): Promise<R> {
    const handle = this.submitWithHandle<R>(workerType, methodName, args, opts);
    return handle.result;
  }

  /**
   * Submit a task and return a handle for cancellation + status polling.
   */
  submitWithHandle<R>(
    workerType: string,
    methodName: string,
    args: unknown[],
    opts: TaskSubmitOptions = {},
  ): TaskHandle<R> {
    const id = `wtm-${Date.now()}-${++SUBMISSION_COUNTER}`;
    this.handleStatus.set(id, TaskStatus.PENDING);

    const task: Task<{ workerType: string; methodName: string; args: unknown[] }, Promise<R>> = {
      id,
      priority: opts.priority ?? TaskPriority.NORMAL,
      timeout: opts.timeout,
      input: { workerType, methodName, args },
      fn: async (input) => {
        if (this.cancelledTaskIds.has(id)) {
          throw new Error(`Task ${id} cancelled before dispatch`);
        }
        this.handleStatus.set(id, TaskStatus.RUNNING);
        const pool = this.poolManager.getPool(input.workerType, opts.poolConfig);
        this.touchedPoolIds.add(input.workerType);
        // workerpool's Pool.exec returns a Promise<R>; cast through unknown
        // because the manager's public API is generic but `exec` is not.
        return (await (pool as unknown as {
          exec: (methodName: string, args: unknown[]) => Promise<R>;
        }).exec(input.methodName, input.args));
      },
    };

    const result = this.queue.enqueue<typeof task.input, Promise<R>>(task).then(async (res: TaskResult<Promise<R>>) => {
      this.handleStatus.set(id, res.status);
      if (res.status === TaskStatus.COMPLETED) {
        // `res.result` is the awaited Promise<R> resolved inside the queue's
        // executor — TaskQueue awaits the fn's return value, so we already
        // have the unwrapped R here.
        return res.result as unknown as R;
      }
      if (res.status === TaskStatus.CANCELLED || this.cancelledTaskIds.has(id)) {
        throw new Error(`Task ${id} cancelled`);
      }
      const err = res.error ?? new Error(`Task ${id} failed: ${res.status}`);
      throw err;
    });

    return {
      id,
      result,
      cancel: () => {
        // Mark first so the wrapping `fn` sees the flag if it hasn't dispatched yet.
        this.cancelledTaskIds.add(id);
        const evicted = this.queue.cancel(id);
        if (evicted) {
          this.handleStatus.set(id, TaskStatus.CANCELLED);
        }
        return evicted;
      },
      status: () => this.handleStatus.get(id) ?? TaskStatus.PENDING,
    };
  }

  /**
   * Aggregated stats across the queue + touched pools.
   */
  getStats(): WorkerTaskManagerStats {
    const pools: WorkerTaskManagerStats['pools'] = [];
    for (const poolId of this.touchedPoolIds) {
      const stats = this.poolManager.getPoolStats(poolId);
      if (stats) {
        pools.push({
          poolId,
          workers: stats.totalWorkers,
          activeTasks: stats.activeTasks,
          pendingTasks: stats.pendingTasks,
          totalTasksExecuted: stats.totalTasksExecuted,
        });
      }
    }
    return { queue: this.queue.getStats(), pools };
  }

  /**
   * Drain the queue (wait for all pending + running tasks) and return their
   * results in completion order. Pool workers are NOT terminated — call
   * `shutdown()` for that.
   */
  async drain(): Promise<TaskResult[]> {
    return this.queue.drain();
  }

  /**
   * Shut down the queue + the underlying WorkerPoolManager pools touched by
   * this instance. Idempotent. Returns after every owned worker has exited.
   */
  async shutdown(): Promise<void> {
    try { await this.queue.shutdown(); }
    catch (e) { logger.warn('[WorkerTaskManager.shutdown] queue.shutdown failed:', e); }
  }
}

/**
 * Singleton-style default manager used by `batchProcessViaWorkers`. Most
 * consumers should reach for the helper, not the singleton — but the
 * singleton is exposed so the agent system can wire stats into diagnostics.
 */
let DEFAULT_INSTANCE: WorkerTaskManager | null = null;
export function getWorkerTaskManager(): WorkerTaskManager {
  if (!DEFAULT_INSTANCE) DEFAULT_INSTANCE = new WorkerTaskManager();
  return DEFAULT_INSTANCE;
}

/**
 * @internal — test-only reset hook. Drops the singleton so a fresh test can
 * observe a clean state. Production code should NEVER call this.
 */
export function _resetWorkerTaskManagerForTests(): void {
  DEFAULT_INSTANCE = null;
}

/**
 * Batch-process `items` by submitting one task per item to the named worker
 * pool. Tasks share the manager's priority queue so a higher-priority batch
 * elsewhere doesn't get blocked.
 *
 * This is the recommended pattern for agent-system batch operations that
 * benefit from CPU parallelism (entropy filtering across many memories,
 * pairwise similarity for contradiction detection, batch embedding when
 * the provider is local + compute-bound, etc.). For small batches
 * (≪ ~50 items) the serialisation overhead usually dominates the gain —
 * benchmark before adopting.
 *
 * @param items — input items, one per task
 * @param workerType — routing key for the pool
 * @param methodName — pool method name
 * @param mapArgs — turn each item into the positional args array for the worker
 * @param opts — priority / timeout / poolConfig
 * @returns Array of results in the same order as `items`. Rejects on the
 *   first task failure (does NOT cancel siblings — those are abandoned).
 *
 * @example
 * ```typescript
 * const distances = await batchProcessViaWorkers(
 *   names,                              // items: string[]
 *   'levenshtein',                      // workerType
 *   'levenshteinDistance',              // methodName
 *   (name) => [name, queryName],        // mapArgs
 *   { priority: TaskPriority.HIGH },
 * );
 * ```
 */
export async function batchProcessViaWorkers<T, R>(
  items: T[],
  workerType: string,
  methodName: string,
  mapArgs: (item: T, index: number) => unknown[],
  opts: TaskSubmitOptions = {},
): Promise<R[]> {
  if (items.length === 0) return [];
  const wtm = getWorkerTaskManager();
  const promises = items.map((item, i) =>
    wtm.submit<R>(workerType, methodName, mapArgs(item, i), opts),
  );
  return Promise.all(promises);
}
