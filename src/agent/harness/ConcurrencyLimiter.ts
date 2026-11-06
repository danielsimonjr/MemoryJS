/**
 * Bounded-concurrency runner with per-item error isolation, abort, and stall accounting.
 *
 * `runAll` never rejects because one item failed: each item yields `{ ok, value }` or
 * `{ ok: false, error }`. Items not yet started when the signal aborts resolve as
 * `AbortError` immediately. `runAllWithStats` also reports `queuedMs`, the time items spent
 * waiting for a slot, which RS-23 uses to detect stalls.
 *
 * The module also defines the subagent seam (`SubagentTask`, `SubagentRunner`) and an
 * in-process runner that dispatches to a handler map.
 *
 * @module agent/harness/ConcurrencyLimiter
 * @experimental Part of the Recursa harness (spec RS-9).
 */

import { ErrorCode, KnowledgeGraphError } from '../../utils/errors.js';
import type { LearningBudget } from '../../types/learning.js';

/** Error for work cancelled by an abort signal. */
export class AbortError extends KnowledgeGraphError {
  /**
   * Create an abort error.
   *
   * @param message - Human-readable reason
   */
  constructor(message: string = 'Operation aborted') {
    super(message, ErrorCode.OPERATION_CANCELLED);
    this.name = 'AbortError';
  }
}

/** Per-item outcome of `runAll`. */
export type RunResult<R> = { ok: true; value: R } | { ok: false; error: unknown };

/** Counters from one `runAllWithStats` call. */
export interface ConcurrencyStats {
  /** Items whose function was invoked. */
  started: number;
  /** Items with a final result (success, failure or abort). */
  settled: number;
  /** Items whose function threw or rejected. */
  failed: number;
  /** Items cancelled by the abort signal: queued items, plus in-flight items still running at abort. */
  aborted: number;
  /** Sum over started items of the milliseconds each waited before starting. */
  queuedMs: number;
}

/** Options for `runAll` and `runAllWithStats`. */
export interface RunAllOptions {
  /** Maximum number of items in flight. Must be a positive safe integer. */
  concurrency: number;
  /**
   * Cancels queued items at once. In-flight items receive it too; any still running at abort
   * resolve as `AbortError` immediately and their late results are ignored.
   */
  signal?: AbortSignal;
}

/** Work unit handed to a subagent runner. */
export interface SubagentTask {
  /** Kind of subagent work. */
  kind: 'learn' | 'map' | 'practice';
  /** Task input. Opaque to the runner. */
  input: unknown;
  /** Optional resource limits for the task. */
  budget?: LearningBudget;
}

/** Runs subagent tasks, possibly in another process. */
export interface SubagentRunner {
  /**
   * Run one task.
   *
   * @param task - Task to run
   * @param signal - Optional cancellation signal
   * @returns The task result
   */
  run<T>(task: SubagentTask, signal?: AbortSignal): Promise<T>;
}

/** Handler for one subagent kind, used by `InProcessSubagentRunner`. */
export type SubagentHandler = (task: SubagentTask, signal?: AbortSignal) => Promise<unknown>;

/** Runs subagent tasks by calling a handler map in the current process. */
export class InProcessSubagentRunner implements SubagentRunner {
  private readonly handlers: Partial<Record<SubagentTask['kind'], SubagentHandler>>;

  /**
   * Create a runner over a handler map.
   *
   * @param handlers - Handler per task kind. A kind without a handler is rejected at run time.
   */
  constructor(handlers: Partial<Record<SubagentTask['kind'], SubagentHandler>>) {
    this.handlers = { ...handlers };
  }

  /**
   * Run one task with the handler registered for its kind.
   *
   * @param task - Task to run
   * @param signal - Optional cancellation signal; checked first, before the handler lookup
   * @returns The handler's result
   * @throws AbortError when the signal is already aborted
   * @throws KnowledgeGraphError when no handler is registered for the task kind
   */
  async run<T>(task: SubagentTask, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new AbortError();
    // Own properties only, so `constructor` / `toString` are unknown kinds.
    const handler = Object.hasOwn(this.handlers, task.kind) ? this.handlers[task.kind] : undefined;
    if (typeof handler !== 'function') {
      throw new KnowledgeGraphError(
        `No in-process handler for subagent kind '${task.kind}'`,
        ErrorCode.UNSUPPORTED_FEATURE,
      );
    }
    return (await handler(task, signal)) as T;
  }
}

function validateConcurrency(concurrency: number): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new KnowledgeGraphError(
      `concurrency must be a positive safe integer (got ${String(concurrency)})`,
      ErrorCode.INVALID_FIELD_VALUE,
    );
  }
}

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight.
 *
 * Results keep the input order. An item error is captured in its result and never rejects
 * the call. On abort, queued and in-flight items resolve as `AbortError` at once, so the returned
 * promise settles even when `fn` ignores the signal. Late results of abandoned items are ignored.
 *
 * @param items - Inputs to process
 * @param fn - Work for one item. Receives the item, its index and the abort signal.
 * @param options - Concurrency limit and optional abort signal
 * @returns One result per item, in input order
 * @throws KnowledgeGraphError (as a rejection) when `concurrency` is not a positive safe integer
 */
export async function runAll<T, R>(
  items: T[],
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options: RunAllOptions,
): Promise<Array<RunResult<R>>> {
  const { results } = await runAllWithStats(items, fn, options);
  return results;
}

/**
 * Same as `runAll`, also returning the run's counters.
 *
 * @param items - Inputs to process
 * @param fn - Work for one item
 * @param options - Concurrency limit and optional abort signal
 * @returns Results in input order, plus `ConcurrencyStats` for the run
 * @throws KnowledgeGraphError (as a rejection) when `concurrency` is not a positive safe integer
 */
export async function runAllWithStats<T, R>(
  items: T[],
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options: RunAllOptions,
): Promise<{ results: Array<RunResult<R>>; stats: ConcurrencyStats }> {
  validateConcurrency(options.concurrency);

  const stats: ConcurrencyStats = { started: 0, settled: 0, failed: 0, aborted: 0, queuedMs: 0 };
  const results: Array<RunResult<R>> = new Array(items.length);
  const signal = options.signal ?? new AbortController().signal;
  const t0 = Date.now();
  let next = 0;

  const abortQueued = (): void => {
    for (; next < items.length; next++) {
      results[next] = { ok: false, error: new AbortError() };
      stats.aborted++;
      stats.settled++;
    }
  };

  if (signal.aborted) {
    abortQueued();
  } else {
    signal.addEventListener('abort', abortQueued, { once: true });
  }

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      stats.queuedMs += Date.now() - t0;
      stats.started++;
      const outcome = await raceAbort(fn, items[i], i, signal);
      if (outcome === ABORTED) {
        results[i] = { ok: false, error: new AbortError() };
        stats.aborted++;
      } else {
        results[i] = outcome;
        if (!outcome.ok) stats.failed++;
      }
      stats.settled++;
    }
  };

  const workerCount = Math.min(options.concurrency, items.length);
  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    signal.removeEventListener('abort', abortQueued);
  }
  return { results, stats };
}

const ABORTED: unique symbol = Symbol('aborted');

/**
 * Run one item, settling early with `ABORTED` when the signal fires first.
 *
 * @param fn - Work function
 * @param item - Item
 * @param index - Item index
 * @param signal - Abort signal
 * @returns The item's result, or `ABORTED`
 */
function raceAbort<T, R>(
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  item: T,
  index: number,
  signal: AbortSignal,
): Promise<RunResult<R> | typeof ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(ABORTED);
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    const done = (r: RunResult<R>): void => {
      signal.removeEventListener('abort', onAbort);
      resolve(r);
    };
    try {
      Promise.resolve(fn(item, index, signal)).then((value) => done({ ok: true, value }), (error: unknown) => done({ ok: false, error }));
    } catch (error) {
      done({ ok: false, error });
    }
  });
}
