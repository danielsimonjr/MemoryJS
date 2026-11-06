/**
 * Persisted run record and pure helpers for {@link LeafLearner} (Recursa RS-18).
 *
 * The run record is serialized as JSON into the `[leaf-state i/n]` observations of the
 * `learning_trace` entity (see `LearningTrace.writeState`; split into chunks because entity
 * observations are capped at 5000 characters). `LeafState` (the spec's contract)
 * is nested inside it as `state`; the other fields are what a resumed learner needs that
 * `LeafState` has no slot for: options, task ids, snapshot ids, diagnoses, the pending revision
 * and its validation progress, and the budget spend.
 *
 * Size bound. The persisted state never holds task bodies or solver answers after judging:
 * - Tasks are written once, at start, as `[leaf-tasks i/n]` observations
 *   (see `LearningTrace.writeTasks`). The state keeps only `taskIds`; `loadRun` re-hydrates
 *   `tasks` from the tasks observation.
 * - Solver answers are never stored in `state.results` (they carry an empty `answer` there,
 *   with trace addresses and tokens). Before judging, a copy capped at {@link ANSWER_CAP_BYTES}
 *   bytes is kept in `answers` with `truncated: true` when cut. The copy is removed once the
 *   answer is judged. Validation answers (`validation.answers`) are kept until the validation ends.
 * - The full answer text lives only in process memory for the round (see `LeafRound`).
 * - Feedback, diagnoses and the revision are kept whole. Each is small per task (per criterion
 *   notes, one summary per diagnosis, one revision), so they are not capped.
 *
 * After a judge step, a run of N tasks costs O(N) small feedback records, independent of the
 * answer sizes.
 *
 * Bookkeeping kept for resume and safety: `stateRev` (compare-and-swap counter of every save),
 * `appliedRevisionIds` (idempotent apply), `recordedFailures` (durable diagnoser dedup), the
 * persisted validation plan (`validation.plan`) and the accountant state (`accounting`).
 *
 * @module agent/learning/LeafLearnerStore
 * @experimental Spec RS-18. Storage layout may change.
 */

import type {
  CriterionResult,
  Diagnosis,
  EvalMetrics,
  Feedback,
  LearningBudget,
  LeafState,
  TaskRecord,
} from '../../types/learning.js';
import type { KnowledgeRevisionRecord } from '../../types/skills.js';
import type { IsoDateTime } from '../../types/agent-memory.js';
import type { LearningTrace } from './LearningTrace.js';
import { LearningAccountant, type AccountantState } from './LearningAccountant.js';
import type { LoadedKnowledge } from './types.js';

/** Options captured at `start`, used on every later step. */
export interface LeafRunOptions {
  /** Resource limits. */
  budget: LearningBudget;
  /** Previously passing tasks sampled for validation. */
  validationSampleSize: number;
  /** Repeats per validated task. */
  validationRepeats: number;
  /** Maximum parallel solver and judge calls. */
  concurrency: number;
}

/** Byte cap on a solver answer kept in the persisted run before it is judged. */
export const ANSWER_CAP_BYTES = 4096;

/** A solver answer as persisted before judging: capped, and flagged when cut. */
export interface CappedAnswer {
  /** Answer text, at most {@link ANSWER_CAP_BYTES} bytes. */
  answer: string;
  /** `true` when the full answer was longer than the cap. */
  truncated?: true;
}

/**
 * Cap a solver answer for persistence.
 *
 * @param answer - Full answer text.
 * @returns The answer, cut to {@link ANSWER_CAP_BYTES} UTF-8 bytes when longer, with `truncated`.
 */
export function capAnswer(answer: string): CappedAnswer {
  const bytes = Buffer.from(answer, 'utf8');
  if (bytes.byteLength <= ANSWER_CAP_BYTES) return { answer };
  return { answer: bytes.subarray(0, ANSWER_CAP_BYTES).toString('utf8'), truncated: true };
}

/**
 * Validation plan as persisted when validation starts. Every later validation step reuses it and
 * never recomputes it from live `K`.
 */
export interface PersistedPlan {
  /** Affected task ids, in run order. */
  affected: string[];
  /** Sampled task ids, in run order. */
  sample: string[];
  /** Planned task ids (affected and sampled), in run order. */
  taskIds: string[];
  /** Scratch knowledge per planned task id. */
  knowledge: Record<string, LoadedKnowledge>;
  /** Digest of live `K` when the plan was made; a different live digest makes the plan stale. */
  liveDigest: string;
}

/** Validation progress of the revision produced in the current round. */
export interface ValidationRun {
  /** Revision under validation. */
  revision: KnowledgeRevisionRecord;
  /** Plan computed once at the start of validation. */
  plan: PersistedPlan;
  /** Current repeat, 0-based. */
  repeat: number;
  /** Which external call is awaited in this repeat. */
  stage: 'solve' | 'judge';
  /** Pass per task id, ANDed over the repeats completed so far. */
  passes: Record<string, boolean>;
  /** Capped solver answers of the current repeat (`null` when the solver failed). */
  answers: Record<string, CappedAnswer | null>;
}

/**
 * Full persisted state of one leaf-learner run. `tasks` is in memory only: it is written once
 * as the `[leaf-tasks]` observation and re-hydrated by {@link loadRun}. See the module JSDoc for
 * the size bound.
 */
export interface LeafRun {
  /** Format version. */
  schema: 1;
  /**
   * Compare-and-swap counter: every save writes `stateRev + 1` and fails when the stored run no
   * longer carries the `stateRev` this process loaded (another driver saved in between).
   */
  stateRev: number;
  /** Optional session id supplied at start. Recorded only. */
  sessionId?: string;
  /** Epoch milliseconds at start; wall-clock budgets are measured from here. */
  startedAtMs: number;
  /** Spec contract state. */
  state: LeafState;
  /** Options captured at start. */
  options: LeafRunOptions;
  /** Ordered task ids of the run. */
  taskIds: string[];
  /** Tasks of the run, in `taskIds` order (in memory; persisted once as `[leaf-tasks]`). */
  tasks: TaskRecord[];
  /** Capped solver answers of the current round, kept until judged. */
  answers?: Record<string, CappedAnswer>;
  /** Snapshot taken at the start of the current round (OCC base for apply). */
  roundSnapshotId: string;
  /** Snapshot id of the knowledge the run currently reflects. */
  snapshotId: string;
  /** Per-task pass of the first full evaluation (the baseline the recursive learner compares against). */
  beforePass?: Record<string, boolean>;
  /** Per-task judged criteria of the first full evaluation (parallel to `beforePass`). */
  beforeCriteria?: Record<string, CriterionResult[]>;
  /** Metrics of the first full evaluation. */
  before?: EvalMetrics;
  /** Metrics of the most recent full evaluation. */
  after?: EvalMetrics;
  /** Diagnoses of the current round. */
  diagnoses: Diagnosis[];
  /** Revision produced in the current round, if any. */
  revision?: KnowledgeRevisionRecord;
  /** Validation progress, when the current round is validating. */
  validation?: ValidationRun;
  /** Accountant state (spend, rework digests, diagnosed failures, phase timing), restored on resume. */
  accounting: AccountantState;
  /** Number of revisions applied to live `K` by this run. */
  revisionCount: number;
  /** Ids of the revisions applied to live `K`; an id here is never applied again. */
  appliedRevisionIds: string[];
  /** Failure-record ids written by the diagnoser, keyed by `traceId + taskId + round`. */
  recordedFailures: Record<string, string>;
  /** Start of the current phase, for the trace action that closes it. */
  phaseStartedAt?: IsoDateTime;
}

/** Metrics of an empty evaluation. */
export const EMPTY_METRICS: EvalMetrics = { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} };

/**
 * Feedback for one task from judge results. Criteria missing from `criteria` fail with
 * `no judge result`; `null` (judge failed) fails every criterion.
 *
 * @param task - Task that was judged.
 * @param criteria - Judge results, or `null` when the judge failed.
 * @returns Feedback in rubric order.
 */
export function feedbackFromCriteria(task: TaskRecord, criteria: readonly CriterionResult[] | null): Feedback {
  const criteriaOut = task.rubric.map((c): CriterionResult => {
    if (criteria === null) return { criterionId: c.id, pass: false, note: 'judge failed' };
    return criteria.find((r) => r.criterionId === c.id) ?? { criterionId: c.id, pass: false, note: 'no judge result' };
  });
  return {
    taskId: task.id,
    criteria: criteriaOut,
    allPass: task.rubric.length > 0 && criteriaOut.every((c) => c.pass),
    source: 'judge',
  };
}

/**
 * Feedback for a task whose solver call failed: every criterion fails with `note`.
 *
 * @param task - Task that failed.
 * @param note - Explanation recorded on each criterion.
 * @returns Failing feedback.
 */
export function failedFeedback(task: TaskRecord, note: string): Feedback {
  return {
    taskId: task.id,
    criteria: task.rubric.map((c) => ({ criterionId: c.id, pass: false, note })),
    allPass: false,
    source: 'judge',
  };
}

/**
 * Effective criterion weight, matching `Evaluator`: finite and non-negative, otherwise 1.
 *
 * @param weight - Declared weight.
 * @returns Weight to use.
 */
function weightOf(weight: number | undefined): number {
  return weight !== undefined && Number.isFinite(weight) && weight >= 0 ? weight : 1;
}

/**
 * Evaluation metrics over a set of tasks, from their feedback. A task without feedback counts
 * as failing. Criterion weights follow `Evaluator`: a finite non-negative weight, else 1.
 *
 * @param tasks - Tasks evaluated, with categories.
 * @param feedback - Feedback keyed by task id.
 * @returns Aggregate metrics, overall and per category.
 */
export function summarize(tasks: readonly TaskRecord[], feedback: Readonly<Record<string, Feedback>>): EvalMetrics {
  const groups = new Map<string, Array<{ allPass: boolean; fraction: number }>>();
  const scores = tasks.map((task) => {
    const fb = feedback[task.id];
    let total = 0;
    let passed = 0;
    for (const criterion of task.rubric) {
      const weight = weightOf(criterion.weight);
      total += weight;
      if (fb?.criteria.find((r) => r.criterionId === criterion.id)?.pass) passed += weight;
    }
    return { allPass: fb?.allPass === true, fraction: total > 0 ? passed / total : 0, category: task.category ?? 'uncategorized' };
  });
  for (const score of scores) {
    const bucket = groups.get(score.category) ?? [];
    bucket.push(score);
    groups.set(score.category, bucket);
  }
  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  const byCategory: EvalMetrics['byCategory'] = Object.fromEntries(
    [...groups].map(([key, bucket]) => [
      key,
      { tasks: bucket.length, allPass: bucket.filter((s) => s.allPass).length / bucket.length, meanCriteria: mean(bucket.map((s) => s.fraction)) },
    ]),
  );
  return {
    tasks: tasks.length,
    allPass: tasks.length === 0 ? 0 : scores.filter((s) => s.allPass).length / tasks.length,
    meanCriteria: mean(scores.map((s) => s.fraction)),
    byCategory,
  };
}

/**
 * Rebuild the accountant of a run from its persisted state.
 *
 * @param run - Run record.
 * @returns The accountant.
 */
export function accountantFrom(run: Pick<LeafRun, 'accounting'>): LearningAccountant {
  return LearningAccountant.fromState(run.accounting);
}

/**
 * Copy the accountant's state into the run record.
 *
 * @param run - Run to update in place.
 * @param accountant - Accountant to read.
 */
export function syncAccounting(run: LeafRun, accountant: LearningAccountant): void {
  run.accounting = accountant.toState();
}

/**
 * Serialize a run for the `[leaf-state]` observation. Task bodies are left out: they are
 * persisted once as `[leaf-tasks]` (see {@link taskRecordsJson}).
 *
 * @param run - Run record.
 * @returns One-line JSON without `tasks`.
 */
export function serializeRun(run: LeafRun): string {
  const persisted: Omit<LeafRun, 'tasks'> & { tasks?: undefined } = { ...run, tasks: undefined };
  return JSON.stringify(persisted);
}

/**
 * Serialize the tasks of a run for the one-time `[leaf-tasks]` observation.
 *
 * @param tasks - Tasks in run order.
 * @returns One-line JSON array.
 */
export function taskRecordsJson(tasks: readonly TaskRecord[]): string {
  return JSON.stringify(tasks);
}

/**
 * Read a run record from its trace, re-hydrating `tasks` from the `[leaf-tasks]` observation.
 *
 * @param traces - Trace manager.
 * @param traceId - Trace id.
 * @returns The run.
 * @throws Error when the trace has no leaf-learner state or tasks, or the state is not a supported version.
 */
export async function loadRun(traces: LearningTrace, traceId: string): Promise<LeafRun> {
  const json = await traces.readState(traceId);
  if (json === undefined) throw new Error(`LeafLearner: trace "${traceId}" has no leaf-learner state`);
  const stored = JSON.parse(json) as Omit<LeafRun, 'tasks'>;
  if (stored.schema !== 1 || typeof stored.stateRev !== 'number') throw new Error(`LeafLearner: unsupported state schema ${String(stored.schema)}`);
  const tasksJson = await traces.readTasks(traceId);
  if (tasksJson === undefined) throw new Error(`LeafLearner: trace "${traceId}" has no task records`);
  const byId = new Map((JSON.parse(tasksJson) as TaskRecord[]).map((t) => [t.id, t] as const));
  const tasks = stored.taskIds.map((id) => {
    const task = byId.get(id);
    if (!task) throw new Error(`LeafLearner: trace "${traceId}" lacks task ${id}`);
    return task;
  });
  return { ...stored, tasks };
}
