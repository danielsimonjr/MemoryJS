/**
 * Validation and application of a recursive round's merged revision (Recursa RS-21, §5.2).
 *
 * The merged revision is validated on a stratified sample with {@link RevisionValidator} and, when
 * accepted, applied to the repository with OCC on the round base. Apply conflicts and rejected ops
 * are recorded as notes; nothing here throws for them.
 *
 * @module agent/learning/RecursiveMerge
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { KnowledgeRevisionRecord } from '../../types/skills.js';
import type { LearnStopReason, TaskRecord } from '../../types/learning.js';
import { fixedBetween } from './RecursiveEvaluate.js';
import type { IGraphStorage } from '../../types/types.js';
import type { ReflectChild } from './LearningReflector.js';
import type { ChildOutcome } from './RevisionMerger.js';
import { toIsoDateTime } from '../../types/agent-memory.js';
import { combineRevisions, feedbackOf, metricsOf, type CriteriaMap, type RecursiveState } from './RecursiveLearnerState.js';
import { readChildRevisions } from './ChildKnowledgeOverlay.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import type { LearningTrace } from './LearningTrace.js';
import type { RevisionValidator } from './RevisionValidator.js';
import type { MergeRecord } from './RecursiveLearnerState.js';
import type { MergeDeps, MergeOutcome } from './RecursiveLearner.js';

/** Inputs of {@link validateAndApplyMerge}. */
export interface ValidateAndApplyArgs {
  /** Trace store (the applied revision id is recorded on the run's trace). */
  traces: LearningTrace;
  /** Repository the revision is validated against and applied to. */
  repository: KnowledgeRepository;
  /** Validator. */
  validator: RevisionValidator;
  /** Run record (base snapshot, options, and the run's trace id). */
  state: RecursiveState;
  /** Tasks of the run. */
  tasks: TaskRecord[];
  /** Merged revision to validate. */
  revision: KnowledgeRevisionRecord;
  /** Pass per task at the start of the round. */
  roundBefore: Record<string, boolean>;
  /** Judged criteria per task at the start of the round (the validator's prior feedback). */
  roundBeforeCriteria?: CriteriaMap;
  /** Solver and judge for the validation calls, and an optional abort signal. */
  deps: MergeDeps;
  /** Merge record so far (its notes are kept). */
  record: MergeRecord;
}

/**
 * Validate the merged revision and apply it when accepted. Updates `state.snapshotId` and
 * `state.mergedRevisionId` when applied; the caller saves the state.
 *
 * @param args - See {@link ValidateAndApplyArgs}.
 * @returns The merge record with verdict, fixed, regressed, applied and notes.
 * @throws Error when validation is needed and the solver or judge is missing.
 */
export async function validateAndApplyMerge(args: ValidateAndApplyArgs): Promise<MergeRecord> {
  const { traces, repository, validator, state, tasks, revision, roundBefore, deps, record } = args;
  const roundBeforeCriteria = args.roundBeforeCriteria ?? {};
  if (revision.ops.length === 0) return record;
  const affected = state.taskIds.filter((id) => roundBefore[id] !== true);
  if (affected.length === 0) return { ...record, verdict: 'reject', notes: [...record.notes, 'nothing to fix this round'] };
  if (!deps.solver || !deps.judge) throw new Error('RecursiveLearner.merge: validation needs deps.solver and deps.judge');
  const priorFeedback = feedbackOf(tasks, roundBefore, roundBeforeCriteria);
  const verdict = await validator.validate(revision, {
    repository,
    affectedTaskIds: affected,
    allTasks: tasks,
    priorFeedback,
    validationSampleSize: state.options.validationSampleSize,
    validationRepeats: state.options.validationRepeats,
    concurrency: state.options.concurrency,
    solver: deps.solver,
    judge: deps.judge,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const next: MergeRecord = {
    applied: false,
    verdict: verdict.verdict,
    fixed: verdict.fixed,
    regressed: verdict.regressed,
    notes: verdict.reason ? [...record.notes, `validation: ${verdict.reason}`] : record.notes,
  };
  if (verdict.verdict !== 'accept') return next;
  const applied = await repository.applyRevision(revision, { expectedSnapshotId: state.baseSnapshotId });
  if (applied.status === 'applied') {
    state.snapshotId = applied.snapshotId;
    state.mergedRevisionId = revision.id;
    await traces.addRevisionId(state.traceId, revision.id);
    return { ...next, applied: true };
  }
  if (applied.status === 'conflict') {
    return { ...next, conflict: true, notes: [...next.notes, `apply-conflict: live K is ${applied.currentSnapshotId}, round base was ${state.baseSnapshotId}`] };
  }
  return { ...next, notes: [...next.notes, `apply-rejected: failedOpIndex=${applied.failedOpIndex} ${applied.reason}`] };
}

/**
 * Child outcomes of a round for the merger: one combined revision per child that completed.
 * Failed children are noted and left out.
 *
 * @param storage - Storage holding the child traces (their persisted revisions are read).
 * @param state - Run record in the `children` phase with every child complete.
 * @param tasks - Tasks of the run.
 * @returns Notes, the outcomes, and the pass map and judged criteria at the start of the round.
 */
export async function buildChildOutcomes(
  storage: IGraphStorage,
  state: RecursiveState,
  tasks: TaskRecord[],
): Promise<{ notes: string[]; outcomes: ChildOutcome[]; roundBefore: Record<string, boolean>; roundBeforeCriteria: CriteriaMap }> {
  const notes: string[] = [];
  const outcomes: ChildOutcome[] = [];
  const roundBefore: Record<string, boolean> = {};
  const roundBeforeCriteria: CriteriaMap = {};
  const now = toIsoDateTime(new Date());
  for (const [index, childId] of state.childTraceIds.entries()) {
    const summary = state.children[childId]!;
    if (summary.failure !== undefined) {
      notes.push(`child ${summary.label} failed: ${summary.failure}`);
      continue;
    }
    Object.assign(roundBefore, summary.beforePass);
    Object.assign(roundBeforeCriteria, summary.beforeCriteria ?? {});
    const revisions = await readChildRevisions(storage, childId);
    const subset = state.subsets[index]!;
    const domains = [...new Set(tasks.filter((t) => subset.taskIds.includes(t.id)).map((t) => t.category ?? 'uncategorized'))];
    outcomes.push({
      label: summary.label,
      revision: combineRevisions(childId, revisions, state.baseSnapshotId, now),
      fixed: summary.fixed,
      regressed: summary.regressed,
      evidenceDomains: domains,
    });
  }
  return { notes, outcomes, roundBefore, roundBeforeCriteria };
}

/**
 * Reflector input for each child of the round.
 *
 * @param state - Run record in the `reflect` phase.
 * @param tasks - Tasks of the run.
 * @param mergeNotes - Merge notes of the round (conflicts are matched by label).
 * @returns One entry per child.
 */
export function reflectChildrenOf(state: RecursiveState, tasks: TaskRecord[], mergeNotes: readonly string[]): ReflectChild[] {
  return state.childTraceIds.map((childId, index) => {
    const summary = state.children[childId]!;
    const subsetTasks = tasks.filter((t) => state.subsets[index]!.taskIds.includes(t.id));
    return {
      traceId: childId,
      label: summary.label,
      improved: summary.improved,
      before: metricsOf(subsetTasks, summary.beforePass, summary.beforeCriteria),
      after: metricsOf(subsetTasks, summary.afterPass, summary.afterCriteria),
      conflicts: mergeNotes.filter((n) => /conflict/i.test(n) && n.includes(summary.label)),
    };
  });
}

/**
 * Publish the live snapshot after an accepted revision. Best effort: a failure is noted on the merge
 * record as `publish-failed` and never thrown. Without a publisher or directory the record is returned as is.
 *
 * @param publisher - Publisher called with the directory and the new snapshot id, when set.
 * @param publishDir - Directory the publisher writes to, when set.
 * @param record - Merge record with `applied: true`.
 * @param snapshotId - Snapshot id the revision produced.
 * @returns The record, with a note when publishing failed.
 */
export async function publishAccepted(
  publisher: { publish(dir: string, options?: { snapshotId?: string }): Promise<unknown> } | undefined,
  publishDir: string | undefined,
  record: MergeRecord,
  snapshotId: string,
): Promise<MergeRecord> {
  if (!publisher || publishDir === undefined) return record;
  try {
    await publisher.publish(publishDir, { snapshotId });
    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...record, notes: [...record.notes, `publish-failed: ${message}`] };
  }
}

/**
 * Settle a round from live `K` (spec §3.4 B1): `current` becomes the live evaluation when the merge
 * was applied, else the round's `before`. Stop rules: `all-pass` only when that pass map is all-pass;
 * an `apply-conflict` continues (the next round rebases on live `K`) unless the budget is spent;
 * an unapplied merge, or an applied one that fixed nothing live, is `no-progress`; else the budget.
 *
 * @param state - Run record (its `current` is updated in place).
 * @param merge - Merge record of the round.
 * @param budgetStop - Budget stop reason, or `null` while headroom remains.
 * @returns The stop reason, or `null` to continue.
 */
export function settleRound(state: RecursiveState, merge: MergeRecord, budgetStop: LearnStopReason | null): LearnStopReason | null {
  const before = merge.roundBefore ?? {};
  const live = merge.applied && merge.evaluation !== undefined;
  state.current = live ? { ...state.current, ...merge.evaluation } : { ...state.current, ...before };
  const criteria = (state.criteria ??= { baseline: {}, current: {} });
  criteria.current = { ...criteria.current, ...((live ? merge.evaluationCriteria : merge.roundBeforeCriteria) ?? {}) };
  if (state.taskIds.every((id) => state.current[id] === true)) return 'all-pass';
  if (merge.conflict) return budgetStop;
  const improved = merge.applied && fixedBetween(before, state.current, state.taskIds).length > 0;
  if (!improved) return 'no-progress';
  return budgetStop;
}

/**
 * Merge outcome from a stored record (copies, so callers cannot change the state).
 *
 * @param record - Stored merge record.
 * @param revisionId - Applied revision id, if any.
 * @returns The outcome.
 */
export function mergeOutcomeOf(record: MergeRecord, revisionId: string | undefined): MergeOutcome {
  return {
    verdict: record.verdict,
    applied: record.applied,
    fixed: [...record.fixed],
    regressed: [...record.regressed],
    notes: [...record.notes],
    ...(record.applied && revisionId ? { revisionId } : {}),
  };
}
