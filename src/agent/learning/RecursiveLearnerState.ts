/**
 * State, persistence and child-result helpers of the recursive learner (Recursa RS-21).
 *
 * The run record is JSON in the same chunked `[leaf-state i/n]` observations as the leaf learner,
 * written through `LearningTrace.writeState` with the same `stateRev` compare-and-swap. Tasks are
 * written once as `[leaf-tasks i/n]`. Schema 2 keeps a recursive record from being read as a leaf one.
 *
 * @module agent/learning/RecursiveLearnerState
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type {
  Diagnosis,
  EvalMetrics,
  Feedback,
  LearnStopReason,
  LearningBudget,
  SplitStrategyName,
  TaskRecord,
  TokenTotals,
} from '../../types/learning.js';
import type { KnowledgeRevisionRecord } from '../../types/skills.js';
import type { IsoDateTime } from '../../types/agent-memory.js';
import type { LearningTrace } from './LearningTrace.js';
import type { AccountantState } from './LearningAccountant.js';
import type { LeafPhase } from './types.js';
import { loadRun, summarize } from './LeafLearnerStore.js';

/** Default maximum number of nested recursion levels below the root. */
export const DEFAULT_MAX_DEPTH = 2;
/** Default subset size at or below which a child is a leaf learner. */
export const DEFAULT_LEAF_THRESHOLD = 4;

/** Phases of the recursive state machine. `merge` is persisted while a merge runs. */
export type RecursivePhase = 'plan' | 'children' | 'merge' | 'reflect' | 'done';

/** One subset of a round's split, as stored in the state. */
export interface SubsetRecord {
  /** Subset label, unique within the round. */
  label: string;
  /** Task ids of the subset. */
  taskIds: string[];
  /** Why the tasks were grouped. */
  rationale: string;
  /** Run the child as a leaf regardless of size (every strategy gave one subset, spec §3.7 S2). */
  forceLeaf?: boolean;
}

/** Diagnoses and feedback of the previous round's children, handed to the next split. */
export interface SplitEvidence {
  /** Latest diagnosis per task id. */
  diagnoses: Record<string, Diagnosis>;
  /** Latest feedback per task id. */
  feedback: Record<string, Feedback>;
}

/** Outcome of one child learner, recorded when the parent is told the child completed. */
export interface ChildSummary {
  /** Child trace id. */
  traceId: string;
  /** Subset label. */
  label: string;
  /** Kind of child learner. */
  learnerKind: 'leaf' | 'recursive';
  /** Error text when the child threw; the child then counts as not improved. */
  failure?: string;
  /** Pass per task at the start of the child's run. */
  beforePass: Record<string, boolean>;
  /** Pass per task at the end of the child's run. */
  afterPass: Record<string, boolean>;
  /** Tasks failing before and passing after. */
  fixed: string[];
  /** Tasks passing before and failing after. */
  regressed: string[];
  /** True when `fixed` is non-empty. */
  improved: boolean;
  /** Stop reason of the child, when it stopped. */
  stop?: LearnStopReason;
  /** Tokens the child spent, summed over phases. */
  tokens: TokenTotals;
}

/** Budget and split settings captured at start. */
export interface RecursiveOptions {
  /** Resource limits (`maxChildren` caps subsets per round). */
  budget: LearningBudget;
  /** Previously passing tasks sampled for validation. */
  validationSampleSize: number;
  /** Repeats per validated task. */
  validationRepeats: number;
  /** Parallel child runs. */
  concurrency: number;
  /** Split strategy used every round. */
  split: SplitStrategyName;
  /** Subset size at or below which a child is a leaf. */
  leafThreshold: number;
  /** Hard cap on recursion depth (root is depth 0). */
  maxDepth: number;
}

/** Outcome of the latest merge. */
export interface MergeRecord {
  /** Whether the merged revision was applied. */
  applied: boolean;
  /** Validation verdict; `none` when there was no revision to validate. */
  verdict: 'accept' | 'reject' | 'none';
  /** Tasks the merged revision fixed on the validation plan. */
  fixed: string[];
  /** Tasks it regressed. */
  regressed: string[];
  /** Merge and validation notes. */
  notes: string[];
  /** Pass per task at the start of the round (union of the children's `beforePass`). */
  roundBefore?: Record<string, boolean>;
  /** Pass per task from one evaluation of all tasks against live `K` after an applied merge. */
  evaluation?: Record<string, boolean>;
  /** True when the accepted revision lost the OCC race (`apply-conflict`): the next round rebases. */
  conflict?: boolean;
}

/** Persisted run record of a recursive learner. */
export interface RecursiveState {
  /** Format version (2 for the recursive learner). */
  schema: 2;
  /** Discriminator. */
  kind: 'recursive';
  /** Compare-and-swap counter (see {@link saveRecursive}). */
  stateRev: number;
  /** Trace id of this run. */
  traceId: string;
  /** Parent trace id, when nested. */
  parentTraceId?: string;
  /** Optional session id (recorded only). */
  sessionId?: string;
  /** Depth of this run (root is 0). */
  depth: number;
  /** Current round, 0-based. */
  round: number;
  /** Current phase. */
  phase: RecursivePhase;
  /** Task ids of the whole run, in order. */
  taskIds: string[];
  /** Subsets of the current round. */
  subsets: SubsetRecord[];
  /** Child trace ids of the current round, parallel to `subsets`. */
  childTraceIds: string[];
  /** Children that completed (succeeded or failed) in the current round. */
  completedChildIds: string[];
  /** Outcome per completed child. */
  children: Record<string, ChildSummary>;
  /** Snapshot id the round started from (the OCC base of the merge). */
  baseSnapshotId: string;
  /** Snapshot id of the knowledge after the latest applied merge. */
  snapshotId: string;
  /** Id of the revision applied by the latest merge, if any. */
  mergedRevisionId?: string;
  /** Outcome of the latest merge. */
  lastMerge?: MergeRecord;
  /** Insights of the latest reflection, passed to the next split. */
  keyInsights: string[];
  /** Pass per task at the start of the first round. */
  baseline: Record<string, boolean>;
  /** Pass per task after the latest completed child that covered it. */
  current: Record<string, boolean>;
  /** Options captured at start. */
  options: RecursiveOptions;
  /** Accountant state (rounds, token spend, phase timing). */
  accounting: AccountantState;
  /** Epoch milliseconds at start (wall-clock budget). */
  startedAtMs: number;
  /** Stop reason, once done. */
  stop?: LearnStopReason;
  /** Evidence from the children for the next split. */
  evidence?: SplitEvidence;
  /** Concrete strategy (or `leaf`) the latest plan used. */
  lastStrategy?: string;
}

/** A recursive run loaded with its task records. */
export interface LoadedRecursive {
  /** Run record. */
  state: RecursiveState;
  /** Tasks of the run, in `taskIds` order. */
  tasks: TaskRecord[];
}

/** Result of one child, read from its trace. */
export interface ChildResult {
  /** Kind of child learner. */
  learnerKind: 'leaf' | 'recursive';
  /** Pass per task before the child's run. */
  beforePass: Record<string, boolean>;
  /** Pass per task after the child's run. */
  afterPass: Record<string, boolean>;
  /** Stop reason, when the child stopped. */
  stop?: LearnStopReason;
  /** Tokens spent, summed over phases. */
  tokens: TokenTotals;
  /** Diagnoses and feedback the child produced. */
  evidence: SplitEvidence;
}

/**
 * Load a recursive run and its tasks from its trace.
 *
 * @param traces - Trace store.
 * @param traceId - Trace id.
 * @returns The run record and its tasks.
 * @throws Error when the trace has no recursive state or task records.
 */
export async function loadRecursive(traces: LearningTrace, traceId: string): Promise<LoadedRecursive> {
  const json = await traces.readState(traceId);
  if (json === undefined) throw new Error(`RecursiveLearner: trace "${traceId}" has no recursive state`);
  const state = JSON.parse(json) as RecursiveState;
  if (state.kind !== 'recursive' || state.schema !== 2) {
    throw new Error(`RecursiveLearner: trace "${traceId}" is not a recursive run`);
  }
  const tasksJson = await traces.readTasks(traceId);
  if (tasksJson === undefined) throw new Error(`RecursiveLearner: trace "${traceId}" has no task records`);
  const byId = new Map((JSON.parse(tasksJson) as TaskRecord[]).map((t) => [t.id, t] as const));
  const tasks = state.taskIds.map((id) => {
    const task = byId.get(id);
    if (!task) throw new Error(`RecursiveLearner: trace "${traceId}" lacks task ${id}`);
    return task;
  });
  return { state, tasks };
}

/**
 * Persist a run with compare-and-swap on `stateRev`: the save fails when the stored run carries a
 * different revision than this process loaded. On failure the in-memory `stateRev` is restored.
 *
 * @param traces - Trace store.
 * @param state - Run to save; its `stateRev` is advanced on success.
 * @throws Error `RecursiveLearner: stale state (expected rev N)` when another driver saved first.
 */
export async function saveRecursive(traces: LearningTrace, state: RecursiveState): Promise<void> {
  const expected = state.stateRev;
  state.stateRev = expected + 1;
  try {
    await traces.writeState(state.traceId, JSON.stringify(state), (current) => {
      const stored = current === undefined ? 0 : (JSON.parse(current) as { stateRev?: number }).stateRev;
      if (stored !== expected) throw new Error(`RecursiveLearner: stale state (expected rev ${expected})`);
    });
  } catch (err) {
    state.stateRev = expected;
    throw err;
  }
}

/**
 * Evaluation metrics of a pass map over tasks.
 *
 * @param tasks - Tasks counted.
 * @param pass - Pass per task id; a missing id counts as failing.
 * @returns Metrics in the leaf learner's format.
 */
export function metricsOf(tasks: readonly TaskRecord[], pass: Readonly<Record<string, boolean>>): EvalMetrics {
  const feedback: Record<string, Feedback> = Object.fromEntries(
    tasks.map((t) => [t.id, { taskId: t.id, criteria: [], allPass: pass[t.id] === true, source: 'test' as const }]),
  );
  return summarize(tasks, feedback);
}

/**
 * Restrict a pass map to some task ids.
 *
 * @param pass - Pass map.
 * @param ids - Ids to keep.
 * @returns A new map with those ids that are present in `pass`.
 */
export function pick(pass: Readonly<Record<string, boolean>>, ids: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(ids.filter((id) => id in pass).map((id) => [id, pass[id] === true]));
}

/**
 * Sum of the token totals over all phases.
 *
 * @param phaseTokens - Per-phase totals.
 * @returns Input and output totals.
 */
export function sumTokens(phaseTokens: Record<LeafPhase, TokenTotals>): TokenTotals {
  return Object.values(phaseTokens).reduce<TokenTotals>(
    (acc, t) => ({ input: acc.input + t.input, output: acc.output + t.output }),
    { input: 0, output: 0 },
  );
}

/**
 * Read a child's pass maps, stop reason and tokens from its trace (leaf or recursive).
 *
 * @param traces - Trace store.
 * @param childTraceId - Child trace id.
 * @returns The child's result.
 * @throws Error when the child is unknown or has no learner state.
 */
export async function childResultOf(traces: LearningTrace, childTraceId: string): Promise<ChildResult> {
  const record = await traces.get(childTraceId);
  if (!record) throw new Error(`RecursiveLearner: unknown child trace ${childTraceId}`);
  if (record.learnerKind === 'leaf') {
    const run = await loadRun(traces, childTraceId);
    const afterPass = Object.fromEntries(run.tasks.map((t) => [t.id, run.state.feedback[t.id]?.allPass === true]));
    return {
      learnerKind: 'leaf',
      beforePass: run.beforePass ?? {},
      afterPass,
      ...(run.state.stop ? { stop: run.state.stop } : {}),
      tokens: sumTokens(run.accounting.phaseTokens),
      evidence: { diagnoses: Object.fromEntries(run.diagnoses.map((d) => [d.taskId, d])), feedback: { ...run.state.feedback } },
    };
  }
  const { state } = await loadRecursive(traces, childTraceId);
  return {
    learnerKind: 'recursive',
    beforePass: state.baseline,
    afterPass: state.current,
    ...(state.stop ? { stop: state.stop } : {}),
    tokens: sumTokens(state.accounting.phaseTokens),
    evidence: state.evidence ?? { diagnoses: {}, feedback: {} },
  };
}

/**
 * One revision that carries all of a child's applied ops, in order.
 *
 * @param childTraceId - Child trace id (the revision id is derived from it).
 * @param revisions - The child's applied revisions.
 * @param baseSnapshotId - Round base snapshot.
 * @param now - Creation timestamp.
 * @returns The combined revision (zero ops when the child changed nothing).
 */
export function combineRevisions(
  childTraceId: string,
  revisions: readonly KnowledgeRevisionRecord[],
  baseSnapshotId: string,
  now: IsoDateTime,
): KnowledgeRevisionRecord {
  return {
    id: `child-${childTraceId}`,
    baseSnapshotId,
    ops: revisions.flatMap((r) => r.ops),
    rationale: `combined ${revisions.length} revision(s) of child ${childTraceId}`,
    diagnosedFailureIds: [...new Set(revisions.flatMap((r) => r.diagnosedFailureIds))],
    producedBy: 'leaf',
    createdAt: now,
  };
}

/**
 * Deep copy of a run record, so callers cannot change the stored state.
 *
 * @param state - Record to copy.
 * @returns The copy.
 */
export function copyRecursive(state: RecursiveState): RecursiveState {
  return structuredClone(state);
}
