/**
 * Evaluation runner and deterministic stratified train/test split.
 *
 * `Evaluator.evaluate` runs a solver over tasks (bounded concurrency via `runAll`), judges each
 * answer, and aggregates metrics. A solver or judge failure marks the task as failing every
 * criterion with a note; `evaluate` never throws because of one task.
 *
 * `stratifiedSplit` partitions tasks reproducibly for a seed, stratified by difficulty or by
 * prior pass/fail.
 *
 * @module agent/evaluation/Evaluator
 * @experimental Part of the Recursa evaluation layer (spec RS-25).
 */

import type {
  CriterionResult,
  EvalMetrics,
  Feedback,
  TaskRecord,
} from '../../types/learning.js';
import { runAll } from '../harness/ConcurrencyLimiter.js';
import type { RubricJudge } from './DeterministicJudge.js';

/** Solver: produces an answer for one task. */
export type Solver = (
  task: TaskRecord,
  context: { knowledge?: string; signal?: AbortSignal },
) => Promise<string>;

/** Options for {@link Evaluator.evaluate}. */
export interface EvaluateOptions {
  /** Knowledge text passed to every solver call. */
  knowledge?: string;
  /** Maximum parallel tasks. Defaults to 4. */
  concurrency?: number;
  /** Abort signal; unstarted tasks are failed with an abort note. */
  signal?: AbortSignal;
}

/** Result of {@link Evaluator.evaluate}. */
export interface EvaluateResult {
  /** Aggregate metrics. */
  metrics: EvalMetrics;
  /** Per-task feedback, in input order. */
  feedback: Feedback[];
}

/** Options for {@link stratifiedSplit}. */
export interface StratifiedSplitOptions {
  /** Fraction of each stratum assigned to the test side, in [0, 1]. */
  testFraction: number;
  /** Stratify by `difficulty`, or by prior pass/fail. */
  by: 'difficulty' | 'priorPassRate';
  /** Seed for the deterministic shuffle. */
  seed: number;
  /**
   * Prior outcome, required for `priorPassRate`. A record gives each task's prior pass/fail.
   * An `EvalMetrics` value only has aggregates, so each task is bucketed by its category's
   * `allPass` rate (at least 0.5 is `pass-heavy`, otherwise `fail-heavy`).
   */
  prior?: EvalMetrics | Record<string, boolean>;
}

/** Result of {@link stratifiedSplit}. */
export interface StratifiedSplitResult {
  /** Tasks on the training side, in input order. */
  train: TaskRecord[];
  /** Tasks on the test side, in input order. */
  test: TaskRecord[];
}

/** Category key used when a task has none. */
const UNCATEGORIZED = 'uncategorized';

/** Per-task aggregate of judged criteria. */
interface TaskScore {
  allPass: boolean;
  fraction: number;
}

/**
 * Fail every criterion of a task with the same note.
 *
 * @param task - Task that failed
 * @param note - Explanation recorded on each criterion
 * @returns Feedback in which every criterion fails
 */
function failAll(task: TaskRecord, note: string): Feedback {
  return {
    taskId: task.id,
    criteria: task.rubric.map((c) => ({ criterionId: c.id, pass: false, note })),
    allPass: false,
    source: 'judge',
  };
}

/** Describe an unknown thrown value. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Turn judge output into feedback in rubric order. Criteria with no result fail.
 *
 * @param task - Task that was judged
 * @param results - Judge output
 * @returns Feedback for the task
 */
function toFeedback(task: TaskRecord, results: CriterionResult[]): Feedback {
  const byId = new Map(results.map((r) => [r.criterionId, r]));
  const criteria = task.rubric.map(
    (c): CriterionResult =>
      byId.get(c.id) ?? { criterionId: c.id, pass: false, note: 'no judge result' },
  );
  return {
    taskId: task.id,
    criteria,
    allPass: task.rubric.length > 0 && criteria.every((c) => c.pass),
    source: 'judge',
  };
}

/**
 * Effective weight of a criterion: `weight` when finite and >= 0, else 1.
 * A zero weight is kept: the criterion still counts toward `allPass` but adds
 * nothing to `meanCriteria`.
 *
 * @param weight - Declared weight
 * @returns Weight to use and whether the declared value was rejected
 */
function effectiveWeight(weight: number | undefined): { weight: number; invalid: boolean } {
  if (weight === undefined) return { weight: 1, invalid: false };
  if (Number.isFinite(weight) && weight >= 0) return { weight, invalid: false };
  return { weight: 1, invalid: true };
}

/** Note recorded on a criterion whose weight was rejected. */
const INVALID_WEIGHT_NOTE = 'invalid weight; using 1';

/**
 * Add {@link INVALID_WEIGHT_NOTE} to every criterion result whose weight is non-finite or negative.
 *
 * @param task - Task the feedback belongs to
 * @param feedback - Feedback to annotate (not mutated)
 * @returns Annotated feedback
 */
function noteInvalidWeights(task: TaskRecord, feedback: Feedback): Feedback {
  const invalid = new Set(task.rubric.filter((c) => effectiveWeight(c.weight).invalid).map((c) => c.id));
  if (invalid.size === 0) return feedback;
  const criteria = feedback.criteria.map((r) =>
    invalid.has(r.criterionId)
      ? { ...r, note: r.note ? `${r.note}; ${INVALID_WEIGHT_NOTE}` : INVALID_WEIGHT_NOTE }
      : r,
  );
  return { ...feedback, criteria };
}

/**
 * Throw when task ids repeat.
 *
 * @param tasks - Tasks to check
 * @param caller - Name used in the error message
 * @throws Error listing the duplicated ids
 */
function assertUniqueTaskIds(tasks: readonly TaskRecord[], caller: string): void {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) dups.add(task.id);
    seen.add(task.id);
  }
  if (dups.size > 0) {
    throw new Error(`${caller}: duplicate task ids: ${[...dups].join(', ')}`);
  }
}

/**
 * Weighted pass fraction of a feedback record. Weight defaults to 1 per criterion;
 * see {@link effectiveWeight} for invalid and zero weights.
 *
 * @param task - Task the feedback belongs to
 * @param feedback - Feedback to score
 * @returns Score in [0, 1]; 0 for an empty rubric or zero total weight
 */
function scoreTask(task: TaskRecord, feedback: Feedback): TaskScore {
  let total = 0;
  let passed = 0;
  for (const criterion of task.rubric) {
    const { weight } = effectiveWeight(criterion.weight);
    total += weight;
    const result = feedback.criteria.find((r) => r.criterionId === criterion.id);
    if (result?.pass) {
      passed += weight;
    }
  }
  return {
    allPass: feedback.allPass,
    fraction: total > 0 ? passed / total : 0,
  };
}

/** Mean of a list, 0 for an empty list. */
function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Aggregate per-task scores into {@link EvalMetrics}.
 *
 * @param tasks - Tasks evaluated, with their categories
 * @param scores - Score per task, aligned with `tasks`
 * @returns Metrics overall and per category
 */
function aggregate(
  tasks: TaskRecord[],
  scores: TaskScore[],
): EvalMetrics {
  const groups = new Map<string, TaskScore[]>();
  tasks.forEach((task, i) => {
    const key = task.category ?? UNCATEGORIZED;
    const bucket = groups.get(key) ?? [];
    bucket.push(scores[i]!);
    groups.set(key, bucket);
  });
  // Map entries keep `__proto__` / `constructor` categories as own properties.
  const byCategory: EvalMetrics['byCategory'] = Object.fromEntries(
    [...groups].map(([key, bucket]) => [
      key,
      {
        tasks: bucket.length,
        allPass: bucket.filter((s) => s.allPass).length / bucket.length,
        meanCriteria: mean(bucket.map((s) => s.fraction)),
      },
    ]),
  );
  return {
    tasks: tasks.length,
    allPass: tasks.length === 0 ? 0 : scores.filter((s) => s.allPass).length / tasks.length,
    meanCriteria: mean(scores.map((s) => s.fraction)),
    byCategory,
  };
}

/** Runs solvers and judges over tasks and aggregates the results. */
export class Evaluator {
  /**
   * Evaluate tasks: solve, judge, and aggregate.
   *
   * A task with an empty rubric counts as not all-passing with a weighted fraction of 0.
   * A non-finite or negative criterion weight is replaced by 1 and noted on that criterion.
   *
   * @param tasks - Tasks to evaluate
   * @param solver - Produces an answer for each task
   * @param judge - Judges each answer against the task's rubric
   * @param options - Knowledge text, concurrency (default 4) and abort signal
   * @returns Metrics and per-task feedback in input order
   * @throws Error when task ids repeat
   */
  async evaluate(
    tasks: TaskRecord[],
    solver: Solver,
    judge: RubricJudge,
    options: EvaluateOptions = {},
  ): Promise<EvaluateResult> {
    assertUniqueTaskIds(tasks, 'Evaluator.evaluate');
    const outcomes = await runAll(
      tasks,
      async (task, _index, signal): Promise<Feedback> => {
        let answer: string;
        try {
          answer = await solver(task, { knowledge: options.knowledge, signal });
        } catch (err) {
          return failAll(task, `solver failed: ${describe(err)}`);
        }
        try {
          return toFeedback(task, await judge.judge(task, answer, signal));
        } catch (err) {
          return failAll(task, `judge failed: ${describe(err)}`);
        }
      },
      { concurrency: options.concurrency ?? 4, signal: options.signal },
    );

    const feedback = outcomes.map((outcome, i): Feedback => {
      const task = tasks[i]!;
      const fb = outcome.ok ? outcome.value : failAll(task, `not completed: ${describe(outcome.error)}`);
      return noteInvalidWeights(task, fb);
    });
    const scores = feedback.map((fb, i) => scoreTask(tasks[i]!, fb));
    return { metrics: aggregate(tasks, scores), feedback };
  }
}

/**
 * Seeded PRNG (mulberry32). Returns floats in [0, 1).
 *
 * @param seed - Integer seed
 * @returns Generator function
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratum key for one task.
 *
 * @param task - Task to key
 * @param by - Stratification mode
 * @param prior - Prior outcome
 * @returns Stratum label
 */
function stratumOf(
  task: TaskRecord,
  by: StratifiedSplitOptions['by'],
  prior: StratifiedSplitOptions['prior'],
): string {
  if (by === 'difficulty') {
    return task.difficulty ?? 'unknown';
  }
  if (prior === undefined) {
    throw new Error('stratifiedSplit: by "priorPassRate" requires a prior');
  }
  if (isRecord(prior)) {
    const outcome = Object.hasOwn(prior, task.id) ? prior[task.id] : undefined;
    return outcome === undefined ? 'unknown' : outcome ? 'pass' : 'fail';
  }
  const key = task.category ?? UNCATEGORIZED;
  const category = Object.hasOwn(prior.byCategory, key) ? prior.byCategory[key] : undefined;
  if (!category) {
    return 'unknown';
  }
  return category.allPass >= 0.5 ? 'pass-heavy' : 'fail-heavy';
}

/** True when a prior is a per-task outcome record rather than EvalMetrics. */
function isRecord(prior: EvalMetrics | Record<string, boolean>): prior is Record<string, boolean> {
  const candidate = (prior as Partial<EvalMetrics>).byCategory;
  return typeof candidate !== 'object' || candidate === null;
}

/**
 * Split tasks into train and test sets, stratified and reproducible for a seed.
 *
 * Each stratum is shuffled with a seeded PRNG and about `testFraction` of it goes to test.
 * A stratum of two or more tasks always has at least one task on each side.
 *
 * @param tasks - Tasks to split
 * @param options - Fraction, stratification mode, seed and optional prior
 * @returns Train and test task lists, each in input order
 * @throws RangeError when `testFraction` is outside [0, 1]
 * @throws Error when `by` is `priorPassRate` and no prior is given
 * @throws Error when task ids repeat
 */
export function stratifiedSplit(
  tasks: TaskRecord[],
  options: StratifiedSplitOptions,
): StratifiedSplitResult {
  const { testFraction, by, seed, prior } = options;
  if (!(testFraction >= 0 && testFraction <= 1)) {
    throw new RangeError('stratifiedSplit: testFraction must be within [0, 1]');
  }
  assertUniqueTaskIds(tasks, 'stratifiedSplit');

  const strata = new Map<string, number[]>();
  tasks.forEach((task, index) => {
    const key = stratumOf(task, by, prior);
    const bucket = strata.get(key) ?? [];
    bucket.push(index);
    strata.set(key, bucket);
  });

  const random = mulberry32(seed);
  const testIndices = new Set<number>();
  for (const key of [...strata.keys()].sort()) {
    const indices = [...strata.get(key)!];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    const n = indices.length;
    let count = Math.round(n * testFraction);
    if (n >= 2) {
      count = Math.min(Math.max(count, 1), n - 1);
    }
    for (const index of indices.slice(0, count)) {
      testIndices.add(index);
    }
  }

  const train: TaskRecord[] = [];
  const test: TaskRecord[] = [];
  tasks.forEach((task, index) => {
    (testIndices.has(index) ? test : train).push(task);
  });
  return { train, test };
}
