/**
 * Recursive learner (Recursa RS-21): Algorithm 1 lines 9-16 as a resumable state machine.
 *
 * A round is `plan` (split, one child trace per subset) → `children` (each learns its subset over a
 * {@link ChildKnowledgeOverlay}) → `merge` (combine, validate on a sample, apply with OCC) →
 * `reflect` (one learning reflection, then stop or continue). The state lives in the `learning_trace`
 * entity (decision Q3). Leaves take subsets of at most `leafThreshold` tasks or sit at `maxDepth`.
 *
 * @module agent/learning/RecursiveLearner
 * @experimental Spec RS-21. The step API may gain fields.
 */

import type { LearnOptions, LearnResult, LearnStopReason, TaskRecord } from '../../types/learning.js';
import type { IGraphStorage } from '../../types/types.js';
import { toIsoDateTime } from '../../types/agent-memory.js';
import type { EntityManager } from '../../core/EntityManager.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import type { RubricJudge } from '../evaluation/DeterministicJudge.js';
import { ChildKnowledgeOverlay } from './ChildKnowledgeOverlay.js';
import type { LeafLearner } from './LeafLearner.js';
import type { DiagnoserLike, KnowledgeEditorLike } from './LeafLearnerOptions.js';
import { EMPTY_METRICS, taskRecordsJson } from './LeafLearnerStore.js';
import { LearningAccountant } from './LearningAccountant.js';
import type { LearningReflector } from './LearningReflector.js';
import type { LearningTrace } from './LearningTrace.js';
import { RevisionValidator } from './RevisionValidator.js';
import { RevisionMerger } from './RevisionMerger.js';
import { split as defaultSplit } from './SplitStrategies.js';
import { absorbEvidence, childBudgetOf, planSubsets } from './RecursivePlan.js';
import type { LearningDeps, LearningSolver } from './types.js';
import { type MergeRecord, type RecursiveState, type SubsetRecord, absorbChildCriteria } from './RecursiveLearnerState.js';
import { childResultOf, copyRecursive, loadRecursive, metricsOf, saveRecursive } from './RecursiveLearnerState.js';
import { KeyedMutex, checkStartOptions, resetForNextRound, summarizeChild, assertChildDone } from './RecursiveDrive.js';
import { driveRun, failedSummary, initialRecursiveState, wallClockStop } from './RecursiveDrive.js';
import { buildChildOutcomes, mergeOutcomeOf, publishAccepted, reflectChildrenOf, settleRound, validateAndApplyMerge } from './RecursiveMerge.js';
import { evaluateLive } from './RecursiveEvaluate.js';
import { type ChildFactoryContext, createChildRun, leafOver, recursiveOver } from './RecursiveChildren.js';

/** Split function used for each round (the 5A strategies by default). */
export type SplitFn = typeof defaultSplit;

/** Dependencies and settings of a {@link RecursiveLearner}. */
export interface RecursiveLearnerOptions {
  /** Repository `K` the run reads and revises (live, or a parent's overlay when nested). */
  repository: KnowledgeRepository;
  /** Trace store. */
  traces: LearningTrace;
  /** Storage holding the traces (child revisions are persisted on them). */
  storage: IGraphStorage;
  /** Write path for trace entities. */
  entityManager: EntityManager;
  /** Diagnoser used by leaf children. */
  diagnoser: DiagnoserLike;
  /** Editor used by leaf children. */
  editor: KnowledgeEditorLike;
  /** Reflector that writes one reflection per round. */
  reflector: LearningReflector;
  /** Split function (default: the 5A {@link defaultSplit}). */
  split?: SplitFn;
  /** Revision merger (default: `new RevisionMerger()`). */
  merger?: Pick<RevisionMerger, 'merge'>;
  /** Revision validator (default: `new RevisionValidator()`). */
  validator?: RevisionValidator;
  /** Keep solver trace addresses on leaf trace actions. */
  includeTraceAddrs?: boolean;
  /**
   * Publisher called with the new snapshot after every accepted revision of the root run. Children
   * never publish (their overlays are not the live repository). Failures are noted, never thrown.
   */
  publisher?: { publish(dir: string, options?: { snapshotId?: string }): Promise<unknown> };
  /** Directory the publisher writes to (publishing is skipped when unset). */
  publishDir?: string;
}

/** Input of {@link RecursiveLearner.start} and {@link RecursiveLearner.learn}. */
export type RecursiveStartOptions = LearnOptions & {
  /** Task records of the run. */
  tasks: TaskRecord[];
  /** Optional session id (recorded only). */
  sessionId?: string;
  /** Recursion depth of this run (root is 0). */
  depth?: number;
  /** Parent trace id when nested. */
  parentTraceId?: string;
  /** Subset label when nested. */
  subsetLabel?: string;
};

/** Solver and judge used to validate a merged revision (and to drive leaf children in-process). */
export interface MergeDeps {
  /** Solver for the validation solve calls. */
  solver?: LearningSolver;
  /** Judge for the validation judge calls. */
  judge?: RubricJudge;
  /** Abort signal. */
  signal?: AbortSignal;
}

/** Outcome of {@link RecursiveLearner.merge}. */
export interface MergeOutcome {
  /** Validation verdict (`none` when there was no revision). */
  verdict: MergeRecord['verdict'];
  /** Whether the merged revision was applied to the repository. */
  applied: boolean;
  /** Tasks the merged revision fixed. */
  fixed: string[];
  /** Tasks the merged revision regressed. */
  regressed: string[];
  /** Merge notes. */
  notes: string[];
  /** Id of the applied revision, when applied. */
  revisionId?: string;
}

/** Outcome of {@link RecursiveLearner.reflect}. */
export interface ReflectDecision {
  /** Whether the run continues with another round or is done. */
  decision: 'continue' | 'done';
  /** Stop reason, when done. */
  stop?: LearnStopReason;
  /** Reflection written for the round. */
  reflectionId: string;
  /** Insights passed to the next round. */
  keyInsights: string[];
  /** Share of children that improved. */
  improvedShare: number;
}

/**
 * Resumable recursive learner. Each public call loads the run from its trace, advances it, and
 * saves it under a per-trace lock, so calls for one run never interleave in this process. Across
 * processes, the `stateRev` compare-and-swap rejects a stale driver.
 *
 * @example
 * ```ts
 * const learner = new RecursiveLearner({ repository, traces, storage, entityManager, diagnoser, editor, reflector });
 * const result = await learner.learn({ taskIds, tasks, budget: { maxRounds: 3 }, maxDepth: 2 }, { solver, judge });
 * ```
 */
export class RecursiveLearner {
  private readonly opts: RecursiveLearnerOptions;
  private readonly split: SplitFn;
  private readonly merger: Pick<RevisionMerger, 'merge'>;
  private readonly validator: RevisionValidator;
  private readonly drivers = new Map<string, LeafLearner | RecursiveLearner>();
  private readonly mutex = new KeyedMutex();

  /**
   * Create the instance.
   *
   * @param opts - Repository, stores, leaf callbacks, reflector and optional split, merger and validator.
   */
  constructor(opts: RecursiveLearnerOptions) {
    this.opts = opts;
    this.split = opts.split ?? defaultSplit;
    this.merger = opts.merger ?? new RevisionMerger();
    this.validator = opts.validator ?? new RevisionValidator();
  }

  /**
   * Create a run: a trace, its task records and a state in the `plan` phase.
   *
   * @param opts - Learning options with the tasks.
   * @returns The persisted state.
   * @throws RangeError for invalid options, unknown task ids or invalid knobs.
   */
  async start(opts: RecursiveStartOptions): Promise<RecursiveState> {
    const checked = checkStartOptions(opts);
    const traceId = await this.opts.traces.create({
      learnerKind: 'recursive',
      round: 0,
      subsetLabel: opts.subsetLabel ?? 'all',
      actions: [],
      revisionIds: [],
      metrics: EMPTY_METRICS,
      ...(opts.parentTraceId !== undefined ? { parentTraceId: opts.parentTraceId } : {}),
    });
    await this.opts.traces.writeTasks(traceId, taskRecordsJson(checked.tasks));
    const state = initialRecursiveState(traceId, opts, checked);
    await saveRecursive(this.opts.traces, state);
    return copyRecursive(state);
  }

  /** Current persisted state of a run (a copy). */
  async state(traceId: string): Promise<RecursiveState> {
    return copyRecursive((await loadRecursive(this.opts.traces, traceId)).state);
  }

  /**
   * Split the round's tasks and create one child per subset. Idempotent once the children exist:
   * a call in the `children` phase returns the same subsets and children.
   *
   * @param traceId - Run trace id.
   * @returns The subsets and the child trace ids (parallel arrays).
   * @throws RangeError when the split does not partition the tasks.
   * @throws Error when the run is not in the `plan` phase.
   */
  async plan(traceId: string): Promise<{ subsets: SubsetRecord[]; childTraceIds: string[] }> {
    return this.mutex.run(traceId, async () => {
      const { state, tasks } = await loadRecursive(this.opts.traces, traceId);
      if (state.phase === 'children') {
        return { subsets: copyRecursive(state).subsets, childTraceIds: [...state.childTraceIds] };
      }
      if (state.phase !== 'plan') throw new Error(`RecursiveLearner: plan is not expected in phase ${state.phase}`);
      const acct = LearningAccountant.fromState(state.accounting);
      acct.recordRound();
      const base = await this.opts.repository.snapshot(`recursive-${traceId}-round-${state.round}`);
      const { subsets, strategy } = await planSubsets(this.split, state, tasks, this.opts.repository);
      const byId = new Map(tasks.map((t) => [t.id, t] as const));
      const childTraceIds: string[] = [];
      const childBudget = childBudgetOf(state, subsets.length);
      for (const subset of subsets) {
        const child = await createChildRun(this.childContext(), state, byId, subset, RecursiveLearner, childBudget);
        this.drivers.set(child.traceId, child.driver);
        childTraceIds.push(child.traceId);
      }
      const now = toIsoDateTime(new Date());
      await this.opts.traces.appendAction(traceId, {
        kind: 'split',
        startedAt: now,
        endedAt: now,
        addrs: [],
        outcome: `split by ${strategy} into ${subsets.length} subsets`,
      });
      state.accounting = acct.toState();
      state.lastStrategy = strategy;
      state.baseSnapshotId = base.id;
      state.subsets = subsets;
      state.childTraceIds = childTraceIds;
      state.completedChildIds = [];
      state.children = {};
      state.lastMerge = undefined;
      state.mergedRevisionId = undefined;
      state.phase = 'children';
      await saveRecursive(this.opts.traces, state);
      return { subsets: copyRecursive(state).subsets, childTraceIds };
    });
  }

  /**
   * Driver for one child (a leaf or nested recursive learner over its overlay).
   *
   * @param childTraceId - Child trace id.
   * @returns The learner for that child.
   */
  async childDriver(childTraceId: string): Promise<LeafLearner | RecursiveLearner> {
    const cached = this.drivers.get(childTraceId);
    if (cached) return cached;
    const record = await this.opts.traces.get(childTraceId);
    if (!record) throw new Error(`RecursiveLearner: unknown child trace ${childTraceId}`);
    const overlay = await ChildKnowledgeOverlay.open(this.opts.repository, this.opts.storage, this.opts.entityManager, childTraceId);
    const driver = record.learnerKind === 'leaf' ? leafOver(this.childContext(), overlay) : recursiveOver(this.childContext(), overlay, RecursiveLearner);
    this.drivers.set(childTraceId, driver);
    return driver;
  }

  /**
   * Mark a child complete and record its outcome. Idempotent for a child already complete.
   *
   * @param traceId - Run trace id.
   * @param childTraceId - Child trace id of the current round.
   * @param failure - Error text when the child threw; the child then counts as not improved.
   * @returns The updated state.
   * @throws Error for an unknown child id or when the run is not waiting for children.
   */
  async submitChild(traceId: string, childTraceId: string, failure?: string): Promise<RecursiveState> {
    return this.mutex.run(traceId, async () => {
      const { state } = await loadRecursive(this.opts.traces, traceId);
      if (state.phase !== 'children') throw new Error(`RecursiveLearner: submitChild is not expected in phase ${state.phase}`);
      const index = state.childTraceIds.indexOf(childTraceId);
      if (index < 0) throw new Error(`RecursiveLearner: ${childTraceId} is not a child of ${traceId}`);
      if (state.completedChildIds.includes(childTraceId)) return copyRecursive(state);
      if (failure === undefined) await assertChildDone(this.opts.traces, childTraceId);
      const subset = state.subsets[index]!;
      const acct = LearningAccountant.fromState(state.accounting);
      if (failure !== undefined) {
        const kind = (await this.opts.traces.get(childTraceId))?.learnerKind ?? 'leaf';
        state.children[childTraceId] = failedSummary(childTraceId, subset.label, kind, failure);
      } else {
        const childResult = await childResultOf(this.opts.traces, childTraceId);
        absorbEvidence(state, childResult);
        const summary = summarizeChild(childTraceId, subset, childResult);
        state.children[childTraceId] = summary;
        absorbChildCriteria(state, subset.taskIds, summary);
        acct.addTokens('solve', summary.tokens.input, summary.tokens.output);
        for (const id of subset.taskIds) {
          state.baseline[id] ??= summary.beforePass[id] === true;
          state.current[id] = summary.afterPass[id] === true;
        }
      }
      state.completedChildIds.push(childTraceId);
      state.accounting = acct.toState();
      await saveRecursive(this.opts.traces, state);
      return copyRecursive(state);
    });
  }

  /**
   * Merge the children's revisions, validate the merge on a stratified sample, and apply it with
   * OCC on the round base when it is accepted. Requires every child to be complete. A round with no
   * revision skips validation (verdict `none`).
   *
   * @param traceId - Run trace id.
   * @param deps - Solver and judge for the validation calls (required when a revision exists).
   * @returns The merge outcome.
   * @throws Error when children are still running, the run is not merging, or validation lacks a solver or judge.
   */
  async merge(traceId: string, deps: MergeDeps = {}): Promise<MergeOutcome> {
    return this.mutex.run(traceId, async () => {
      const { state, tasks } = await loadRecursive(this.opts.traces, traceId);
      if (state.phase === 'reflect' && state.lastMerge) return mergeOutcomeOf(state.lastMerge, state.mergedRevisionId);
      if (state.phase !== 'children' && state.phase !== 'merge') throw new Error(`RecursiveLearner: merge is not expected in phase ${state.phase}`);
      const pending = state.childTraceIds.length - state.completedChildIds.length;
      if (pending > 0) throw new Error(`RecursiveLearner: ${pending} child(ren) not complete`);
      state.phase = 'merge';
      await saveRecursive(this.opts.traces, state);

      const { notes, outcomes, roundBefore, roundBeforeCriteria } = await buildChildOutcomes(this.opts.storage, state, tasks);
      const now = toIsoDateTime(new Date());

      let record: MergeRecord = { applied: false, verdict: 'none', fixed: [], regressed: [], notes };
      if (outcomes.some((o) => o.revision.ops.length > 0)) {
        const merged = await this.merger.merge(outcomes, {
          baseSnapshotId: state.baseSnapshotId,
          reason: `round ${state.round}`,
          ...(deps.signal ? { signal: deps.signal } : {}),
        });
        record = await validateAndApplyMerge({
          traces: this.opts.traces,
          repository: this.opts.repository,
          validator: this.validator,
          state,
          tasks,
          revision: merged.revision,
          roundBefore,
          roundBeforeCriteria,
          deps,
          record: { ...record, notes: [...notes, ...merged.notes] },
        });
        if (record.applied) record = await publishAccepted(this.opts.publisher, this.opts.publishDir, record, state.snapshotId);
      }
      record = { ...record, roundBefore, roundBeforeCriteria };
      if (record.applied && deps.solver && deps.judge) {
        const live = await evaluateLive(this.opts.repository, tasks, { solver: deps.solver, judge: deps.judge, ...(deps.signal ? { signal: deps.signal } : {}) }, state.options.concurrency);
        record.evaluation = live.pass;
        record.evaluationCriteria = live.criteria;
        const acct = LearningAccountant.fromState(state.accounting);
        acct.addTokens('solve', live.tokens.input, live.tokens.output);
        state.accounting = acct.toState();
      }
      state.lastMerge = record;
      state.phase = 'reflect';
      const verdictText = `${record.conflict ? 'apply-conflict; ' : ''}${record.verdict}; fixed=${record.fixed.length} regressed=${record.regressed.length}; applied=${record.applied}`;
      await this.opts.traces.appendAction(traceId, {
        kind: 'merge',
        startedAt: now,
        endedAt: toIsoDateTime(new Date()),
        addrs: [],
        outcome: verdictText,
      });
      await saveRecursive(this.opts.traces, state);
      return mergeOutcomeOf(record, state.mergedRevisionId);
    });
  }

  /**
   * Reflect on the round (one reflection), then stop or start the next round. Stops on `all-pass`,
   * `no-progress` (no child improved, or the merge was not applied) or a spent budget.
   *
   * @param traceId - Run trace id.
   * @returns The decision and the reflection written.
   * @throws Error when the run is not in the `reflect` phase.
   */
  async reflect(traceId: string): Promise<ReflectDecision> {
    return this.mutex.run(traceId, async () => {
      const { state, tasks } = await loadRecursive(this.opts.traces, traceId);
      if (state.phase !== 'reflect') throw new Error(`RecursiveLearner: reflect is not expected in phase ${state.phase}`);
      const merge = state.lastMerge ?? { applied: false, verdict: 'none' as const, fixed: [], regressed: [], notes: [] };
      const children = reflectChildrenOf(state, tasks, merge.notes);
      const reflector = await this.opts.reflector.reflect({
        traceId,
        round: state.round,
        children,
        mergeNotes: merge.notes,
        strategy: state.lastStrategy ?? state.options.split,
      });
      const now = toIsoDateTime(new Date());
      const outcome = `reflection ${reflector.reflectionId}; improvedShare=${reflector.improvedShare}`;
      await this.opts.traces.appendAction(traceId, { kind: 'reflect', startedAt: now, endedAt: now, addrs: [], outcome });
      state.keyInsights = reflector.keyInsights;
      const acct = LearningAccountant.fromState(state.accounting);
      const stop = settleRound(state, merge, acct.exceeded(state.options.budget) ?? wallClockStop(state, state.options.budget));
      if (stop) {
        state.phase = 'done';
        state.stop = stop;
      } else {
        resetForNextRound(state);
      }
      state.accounting = acct.toState();
      await saveRecursive(this.opts.traces, state);
      if (stop) await this.opts.traces.setMetrics(traceId, metricsOf(tasks, state.current, state.criteria?.current));
      return {
        decision: stop ? 'done' : 'continue',
        ...(stop ? { stop } : {}),
        reflectionId: reflector.reflectionId,
        keyInsights: [...reflector.keyInsights],
        improvedShare: reflector.improvedShare,
      };
    });
  }

  /**
   * Result of a run (`stoppedBecause` is `aborted` while it has none).
   *
   * @param traceId - Run trace id.
   * @returns The result.
   */
  async result(traceId: string): Promise<LearnResult> {
    const { state, tasks } = await loadRecursive(this.opts.traces, traceId);
    return {
      snapshotId: state.snapshotId || state.baseSnapshotId,
      traceId,
      before: metricsOf(tasks, state.baseline, state.criteria?.baseline),
      after: metricsOf(tasks, state.current, state.criteria?.current),
      stoppedBecause: state.stop ?? 'aborted',
      report: LearningAccountant.fromState(state.accounting).report(),
    };
  }

  /**
   * Stop a run (a finished run is unchanged). Children's unmerged results are discarded: `current`
   * returns to each completed child's `beforePass`.
   *
   * @param traceId - Run trace id.
   * @param reason - Stop reason (default `aborted`; the in-process loop passes a budget reason).
   * @returns The stopped state.
   */
  async abort(traceId: string, reason: LearnStopReason = 'aborted'): Promise<RecursiveState> {
    return this.mutex.run(traceId, async () => {
      const { state, tasks } = await loadRecursive(this.opts.traces, traceId);
      if (state.phase !== 'done') {
        for (const id of state.completedChildIds) {
          Object.assign(state.current, state.children[id]?.beforePass ?? {});
          if (state.criteria) Object.assign(state.criteria.current, state.children[id]?.beforeCriteria ?? {});
        }
        state.phase = 'done';
        state.stop = reason;
        await saveRecursive(this.opts.traces, state);
        await this.opts.traces.setMetrics(traceId, metricsOf(tasks, state.current, state.criteria?.current));
      }
      return copyRecursive(state);
    });
  }

  /**
   * In-process loop: plan, children, merge, reflect, until done.
   *
   * @param opts - Learning options with the tasks.
   * @param deps - Solver and judge (required), optional subagent runner and abort signal.
   * @returns The result.
   */
  async learn(opts: RecursiveStartOptions, deps: LearningDeps): Promise<LearnResult> {
    const state = await this.start(opts);
    return this.drive(state.traceId, deps);
  }

  /**
   * Advance a run to completion in this process (the loop behind {@link learn}; also used for nested children).
   *
   * @param traceId - Run trace id (created by `start`).
   * @param deps - Solver, judge, optional subagent runner and abort signal.
   * @returns The result.
   * @throws Error when `deps.judge` is missing or a child did not complete.
   */
  async drive(traceId: string, deps: LearningDeps): Promise<LearnResult> {
    return driveRun(this, this.opts.traces, traceId, deps);
  }

  /** Settings the child factories need. Children never publish, so the publisher is withheld. */
  private childContext(): ChildFactoryContext {
    const opts: RecursiveLearnerOptions = { ...this.opts, publisher: undefined, publishDir: undefined };
    return { opts, split: this.split, merger: this.merger, validator: this.validator };
  }
}
