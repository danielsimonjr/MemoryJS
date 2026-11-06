/**
 * In-process driving of the recursive learner (Recursa RS-21): the plan / children / merge /
 * reflect loop, the parallel child runner, and helpers the learner shares. Children run in
 * parallel; a child that throws is recorded as failed and does not stop its siblings.
 *
 * @module agent/learning/RecursiveDrive
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { LearnResult, LearnStopReason, LearningBudget, TaskRecord } from '../../types/learning.js';
import { resolveOptions } from './LeafLearnerOptions.js';
import { LearningAccountant } from './LearningAccountant.js';
import { DEFAULT_LEAF_THRESHOLD, DEFAULT_MAX_DEPTH } from './RecursiveLearnerState.js';
import { AbortError, runAll, runAllWithStats } from '../harness/ConcurrencyLimiter.js';
import { describeError } from './llmJson.js';
import { LeafLearner } from './LeafLearner.js';
import type { LearningTrace } from './LearningTrace.js';
import type { SubsetRecord, ChildSummary, CriteriaMap, RecursiveState, RecursiveOptions } from './RecursiveLearnerState.js';
import { childResultOf, pick } from './RecursiveLearnerState.js';
import { loadRecursive } from './RecursiveLearnerState.js';
import { loadRun } from './LeafLearnerStore.js';
import { childPhaseBudgetStop } from './RecursivePlan.js';
import type { LearningDeps } from './types.js';
import type { MergeDeps, RecursiveLearner, RecursiveStartOptions } from './RecursiveLearner.js';

/**
 * Drive a run to completion: plan, run children, merge, reflect, until done.
 *
 * @param learner - Learner that owns the run.
 * @param traces - Trace store of the run.
 * @param traceId - Run trace id.
 * @param deps - Solver, judge, optional subagent runner and abort signal.
 * @returns The result.
 * @throws Error when `deps.judge` is missing or a child is still incomplete after its batch.
 */
export async function driveRun(
  learner: RecursiveLearner,
  traces: LearningTrace,
  traceId: string,
  deps: LearningDeps,
): Promise<LearnResult> {
  if (!deps.judge) throw new Error('RecursiveLearner.learn: deps.judge is required');
  for (;;) {
    if (deps.signal?.aborted) await learner.abort(traceId);
    const { state } = await loadRecursive(traces, traceId);
    if (state.phase === 'done') return learner.result(traceId);
    if (state.phase === 'plan') {
      await learner.plan(traceId);
    } else if (state.phase === 'children') {
      const pending = state.childTraceIds.filter((id) => !state.completedChildIds.includes(id));
      if (pending.length > 0) await runChildren(learner, traces, traceId, pending, state.options.concurrency, deps);
      else await learner.merge(traceId, mergeDepsOf(deps));
    } else if (state.phase === 'merge') {
      await learner.merge(traceId, mergeDepsOf(deps));
    } else {
      await learner.reflect(traceId);
    }
  }
}

/**
 * Run pending children in parallel, through the subagent runner when supplied, else in-process.
 * Each child is recorded via `submitChild` when it completes, or with its error when it throws.
 *
 * @param learner - Learner that owns the run.
 * @param traces - Trace store of the run.
 * @param traceId - Run trace id.
 * @param pending - Child trace ids not yet complete.
 * @param concurrency - Maximum children in flight.
 * @param deps - Solver, judge, runner and abort signal.
 * @throws Error when a child is still incomplete after the batch (and the run was not aborted).
 */
async function runChildren(
  learner: RecursiveLearner,
  traces: LearningTrace,
  traceId: string,
  pending: string[],
  concurrency: number,
  deps: LearningDeps,
): Promise<void> {
  const local = new AbortController();
  const onAbort = (): void => local.abort();
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  if (deps.signal?.aborted) local.abort();
  const childDeps: LearningDeps = { ...deps, signal: local.signal };
  let budgetStop: 'budget-tokens' | 'budget-time' | null = null;
  try {
    await runAll(
      pending,
      async (childId) => {
        try {
          if (deps.subagentRunner) {
            await deps.subagentRunner.run({ kind: 'learn', input: { childTraceId: childId } }, local.signal);
          } else {
            await driveChild(learner, childId, childDeps, concurrency);
          }
        } catch (err) {
          if (local.signal.aborted) return;
          await learner.submitChild(traceId, childId, describeError(err));
          return;
        }
        if (local.signal.aborted) return;
        const after = await learner.submitChild(traceId, childId);
        budgetStop ??= childPhaseBudgetStop(after);
        if (budgetStop) local.abort();
      },
      { concurrency, signal: local.signal },
    );
  } catch (err) {
    if (!(err instanceof AbortError)) throw err;
  } finally {
    deps.signal?.removeEventListener('abort', onAbort);
  }
  if (budgetStop && !deps.signal?.aborted) {
    await stopChildrenForBudget(learner, traces, traceId, budgetStop);
    return;
  }
  if (deps.signal?.aborted) return;
  const { state } = await loadRecursive(traces, traceId);
  const still = state.childTraceIds.filter((id) => !state.completedChildIds.includes(id));
  if (still.length > 0) throw new Error(`RecursiveLearner: children did not complete: ${still.join(', ')}`);
}

/**
 * Stop a run between child completions because its token or time budget is spent: the children
 * still running are aborted and the run is stopped with the budget reason (see
 * {@link RecursiveLearner.abort}).
 *
 * @param learner - Learner that owns the run.
 * @param traces - Trace store of the run.
 * @param traceId - Run trace id.
 * @param reason - Budget stop reason.
 */
async function stopChildrenForBudget(
  learner: RecursiveLearner,
  traces: LearningTrace,
  traceId: string,
  reason: 'budget-tokens' | 'budget-time',
): Promise<void> {
  const { state } = await loadRecursive(traces, traceId);
  for (const childId of state.childTraceIds.filter((id) => !state.completedChildIds.includes(id))) {
    await (await learner.childDriver(childId)).abort(childId);
  }
  await learner.abort(traceId, reason);
}

/**
 * Throw unless a child run is in the `done` phase (spec §3.7 S3).
 *
 * @param traces - Trace store.
 * @param childTraceId - Child trace id.
 * @throws Error naming the child's phase when it is not done.
 */
export async function assertChildDone(traces: LearningTrace, childTraceId: string): Promise<void> {
  const record = await traces.get(childTraceId);
  if (!record) throw new Error(`RecursiveLearner: unknown child trace ${childTraceId}`);
  const phase = record.learnerKind === 'leaf' ? (await loadRun(traces, childTraceId)).state.phase : (await loadRecursive(traces, childTraceId)).state.phase;
  if (phase !== 'done') throw new Error(`RecursiveLearner: child ${childTraceId} is in phase ${phase}, not done`);
}

/**
 * Drive one child to completion in this process.
 *
 * @param learner - Parent learner (provides the child drivers).
 * @param childId - Child trace id.
 * @param deps - Solver, judge and signal.
 * @param concurrency - Parallel solver and judge calls for a leaf child.
 */
async function driveChild(learner: RecursiveLearner, childId: string, deps: LearningDeps, concurrency: number): Promise<void> {
  const driver = await learner.childDriver(childId);
  if (driver instanceof LeafLearner) {
    await runLeafTrace(driver, childId, deps, concurrency);
    return;
  }
  await driver.drive(childId, deps);
}

/**
 * Drive an existing leaf run to completion: answer each `solve` and `judge` request with the
 * injected solver and judge, through the concurrency limiter, until the run is done.
 *
 * @param learner - Leaf learner that owns the run.
 * @param traceId - Leaf run trace id.
 * @param deps - Solver and judge (the judge is required) and an optional abort signal.
 * @param concurrency - Maximum parallel calls.
 * @throws Error when `deps.judge` is missing.
 */
export async function runLeafTrace(
  learner: LeafLearner,
  traceId: string,
  deps: LearningDeps,
  concurrency: number,
): Promise<void> {
  if (!deps.judge) throw new Error('RecursiveLearner.learn: deps.judge is required');
  const judge = deps.judge;
  const signal = deps.signal;
  const limits = { concurrency, ...(signal ? { signal } : {}) };
  for (;;) {
    const step = await learner.next(traceId, signal ? { signal } : {});
    if (step.kind === 'done') return;
    if (step.kind === 'solve') {
      const { results } = await runAllWithStats(step.tasks, (entry, _i, s) => deps.solver.solve(entry.task, entry.knowledge, s), limits);
      const payload: Record<string, Awaited<ReturnType<typeof deps.solver.solve>> | null> = {};
      step.tasks.forEach((entry, i) => {
        const r = results[i]!;
        payload[entry.task.id] = r.ok ? r.value : null;
      });
      if (signal?.aborted) return;
      await learner.submit(traceId, 'solve', payload);
    } else {
      const { results } = await runAllWithStats(step.answers, (entry, _i, s) => judge.judge(entry.task, entry.answer, s), limits);
      const payload: Record<string, Awaited<ReturnType<typeof judge.judge>> | null> = {};
      step.answers.forEach((entry, i) => {
        const r = results[i]!;
        payload[entry.task.id] = r.ok ? r.value : null;
      });
      if (signal?.aborted) return;
      await learner.submit(traceId, 'judge', payload);
    }
    if (signal?.aborted) {
      await learner.abort(traceId);
      return;
    }
  }
}

/**
 * Deps for a merge inside the in-process loop.
 *
 * @param deps - Learning deps.
 * @returns Merge deps.
 */
export function mergeDepsOf(deps: LearningDeps): MergeDeps {
  return { solver: deps.solver, judge: deps.judge, ...(deps.signal ? { signal: deps.signal } : {}) };
}

/**
 * Summary of a child that threw.
 *
 * @param traceId - Child trace id.
 * @param label - Subset label.
 * @param learnerKind - Kind of child.
 * @param failure - Error text.
 * @returns The summary (not improved, no pass data).
 */
export function failedSummary(traceId: string, label: string, learnerKind: 'leaf' | 'recursive', failure: string): ChildSummary {
  return {
    traceId,
    label,
    learnerKind,
    failure,
    beforePass: {},
    afterPass: {},
    fixed: [],
    regressed: [],
    improved: false,
    tokens: { input: 0, output: 0 },
  };
}

/**
 * Stop reason when the wall-clock budget is spent.
 *
 * @param state - Run record (start time).
 * @param budget - Budget.
 * @returns `budget-time` or `null`.
 */
export function wallClockStop(state: RecursiveState, budget: LearningBudget): LearnStopReason | null {
  if (budget.maxWallClockMs !== undefined && Date.now() - state.startedAtMs >= budget.maxWallClockMs) return 'budget-time';
  return null;
}

/** Start options after validation. */
export interface CheckedStart {
  /** Budget and round settings. */
  options: ReturnType<typeof resolveOptions>['options'];
  /** Ordered task ids. */
  taskIds: string[];
  /** Task records in `taskIds` order. */
  tasks: TaskRecord[];
  /** Leaf threshold (default {@link DEFAULT_LEAF_THRESHOLD}). */
  leafThreshold: number;
  /** Maximum depth (default {@link DEFAULT_MAX_DEPTH}). */
  maxDepth: number;
  /** Depth of this run. */
  depth: number;
}

/**
 * Validate recursive start options.
 *
 * @param opts - Start options.
 * @returns The checked settings and task records.
 * @throws RangeError for invalid knobs, unknown task ids, or invalid budget values.
 */
export function checkStartOptions(opts: RecursiveStartOptions): CheckedStart {
  const { options, taskIds } = resolveOptions(opts);
  const leafThreshold = opts.leafThreshold ?? DEFAULT_LEAF_THRESHOLD;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const depth = opts.depth ?? 0;
  if (!Number.isInteger(leafThreshold) || leafThreshold < 0) throw new RangeError('RecursiveLearner: leafThreshold must be an integer >= 0');
  if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new RangeError('RecursiveLearner: maxDepth must be an integer >= 1');
  if (!Number.isInteger(depth) || depth < 0) throw new RangeError('RecursiveLearner: depth must be an integer >= 0');
  const maxChildren = opts.budget.maxChildren;
  if (maxChildren !== undefined && (!Number.isInteger(maxChildren) || maxChildren < 1)) {
    throw new RangeError('RecursiveLearner: budget.maxChildren must be an integer >= 1');
  }
  const byId = new Map(opts.tasks.map((t) => [t.id, t] as const));
  const tasks = taskIds.map((id) => {
    const task = byId.get(id);
    if (!task) throw new RangeError(`RecursiveLearner: unknown task id ${id}`);
    return task;
  });
  return { options, taskIds, tasks, leafThreshold, maxDepth, depth };
}

/**
 * First state of a run (phase `plan`, round 0).
 *
 * @param traceId - Run trace id.
 * @param opts - Start options.
 * @param checked - Output of {@link checkStartOptions}.
 * @returns The state (not yet saved).
 */
export function initialRecursiveState(traceId: string, opts: RecursiveStartOptions, checked: CheckedStart): RecursiveState {
  const options: RecursiveOptions = {
    budget: { ...opts.budget },
    validationSampleSize: checked.options.validationSampleSize,
    validationRepeats: checked.options.validationRepeats,
    concurrency: checked.options.concurrency,
    split: opts.split ?? 'auto',
    leafThreshold: checked.leafThreshold,
    maxDepth: checked.maxDepth,
  };
  return {
    schema: 2,
    kind: 'recursive',
    stateRev: 0,
    traceId,
    ...(opts.parentTraceId !== undefined ? { parentTraceId: opts.parentTraceId } : {}),
    ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
    depth: checked.depth,
    round: 0,
    phase: 'plan',
    taskIds: [...checked.taskIds],
    subsets: [],
    childTraceIds: [],
    completedChildIds: [],
    children: {},
    baseSnapshotId: '',
    snapshotId: '',
    keyInsights: [],
    baseline: {},
    current: {},
    options,
    accounting: new LearningAccountant().toState(),
    startedAtMs: Date.now(),
  };
}

/**
 * Serializes async work per key: calls for one run never interleave within this process.
 *
 * @example
 * ```ts
 * const mutex = new KeyedMutex();
 * await mutex.run(traceId, async () => { ... });
 * ```
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * Run `fn` after every earlier call for the same key.
   *
   * @param key - Key (a run trace id).
   * @param fn - Work to run.
   * @returns What `fn` returns.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
    return run;
  }
}

/**
 * Summary of a child that completed, with its per-task pass maps restricted to its subset.
 *
 * @param childTraceId - Child trace id.
 * @param subset - The child's subset.
 * @param result - The child's result read from its trace.
 * @returns The summary.
 */
export function summarizeChild(
  childTraceId: string,
  subset: SubsetRecord,
  result: Awaited<ReturnType<typeof childResultOf>>,
): ChildSummary {
  const beforePass = pick(result.beforePass, subset.taskIds);
  const afterPass = pick(result.afterPass, subset.taskIds);
  const fixed = subset.taskIds.filter((id) => beforePass[id] !== true && afterPass[id] === true);
  const regressed = subset.taskIds.filter((id) => beforePass[id] === true && afterPass[id] !== true);
  return {
    traceId: childTraceId,
    label: subset.label,
    learnerKind: result.learnerKind,
    beforePass,
    afterPass,
    beforeCriteria: pickCriteria(result.beforeCriteria, subset.taskIds),
    afterCriteria: pickCriteria(result.afterCriteria, subset.taskIds),
    fixed,
    regressed,
    improved: fixed.length > 0,
    ...(result.stop ? { stop: result.stop } : {}),
    tokens: result.tokens,
  };
}

/**
 * Restrict a criteria map to some task ids.
 *
 * @param criteria - Criteria per task id.
 * @param ids - Ids to keep.
 * @returns The entries present for those ids.
 */
function pickCriteria(criteria: CriteriaMap, ids: readonly string[]): CriteriaMap {
  return Object.fromEntries(ids.filter((id) => criteria[id] !== undefined).map((id) => [id, criteria[id]!]));
}

/**
 * Clear the per-round fields so the run can plan the next round.
 *
 * @param state - Run record (mutated in place; the round number is advanced).
 */
export function resetForNextRound(state: RecursiveState): void {
  state.round += 1;
  state.phase = 'plan';
  state.subsets = [];
  state.childTraceIds = [];
  state.completedChildIds = [];
  state.children = {};
  state.lastMerge = undefined;
  state.mergedRevisionId = undefined;
}
