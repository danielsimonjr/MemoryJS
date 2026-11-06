/**
 * In-process handler for `kind: 'learn'` subagent tasks (Recursa RS-21).
 *
 * The recursive learner's children are resumable runs. A subagent runner (for example
 * `InProcessSubagentRunner` from the harness) can host them by calling this handler: it looks up the
 * child's driver and drives that child to completion with the injected solver and judge. The
 * parent then records the child with `submitChild`. This makes the runner one adapter over the
 * step API rather than a second learner.
 *
 * @module agent/learning/InProcessLearnHandler
 * @experimental Spec RS-21 (SubagentRunner is one adapter over the learner API).
 */

import type { SubagentHandler } from '../harness/ConcurrencyLimiter.js';
import type { LeafLearner } from './LeafLearner.js';
import { RecursiveLearner } from './RecursiveLearner.js';
import { runLeafTrace } from './RecursiveDrive.js';
import type { LearningDeps } from './types.js';

/** Concurrency used when a leaf child is driven by the handler (matches `MEMORY_LEARNING_CONCURRENCY`). */
export const DEFAULT_CHILD_CONCURRENCY = 4;

/** Anything that resolves a child trace id to its driver (the learning loop facade does). */
export interface ChildDriverSource {
  /**
   * Driver of one child run.
   *
   * @param childTraceId - Child trace id.
   * @returns The leaf or recursive learner that owns the child.
   */
  childDriver(childTraceId: string): Promise<LeafLearner | RecursiveLearner>;
}

/** Input of a `kind: 'learn'` task handled by {@link createInProcessLearnHandler}. */
export interface LearnTaskInput {
  /** Child trace to drive to completion. */
  childTraceId: string;
}

/**
 * Create a handler that drives a child run to completion in this process.
 *
 * @example
 * ```ts
 * const runner = new InProcessSubagentRunner({ learn: createInProcessLearnHandler(loop, deps) });
 * await runner.run({ kind: 'learn', input: { childTraceId } });
 * ```
 *
 * @param source - Learning loop (or any source of child drivers).
 * @param deps - Solver and judge the child calls use, plus an optional abort signal.
 * @returns A handler for the `learn` kind. It resolves to `{ childTraceId, done: true }`.
 * @throws TypeError (at call time) when the task input has no `childTraceId` string.
 */
export function createInProcessLearnHandler(source: ChildDriverSource, deps: LearningDeps): SubagentHandler {
  return async (task, signal) => {
    const input = task.input as Partial<LearnTaskInput> | null | undefined;
    if (typeof input?.childTraceId !== 'string') throw new TypeError('learn task input needs a childTraceId string');
    const childTraceId = input.childTraceId;
    const driver = await source.childDriver(childTraceId);
    const runDeps: LearningDeps = signal ? { ...deps, signal } : deps;
    if (driver instanceof RecursiveLearner) await driver.drive(childTraceId, runDeps);
    else await runLeafTrace(driver, childTraceId, runDeps, DEFAULT_CHILD_CONCURRENCY);
    return { childTraceId, done: true };
  };
}
