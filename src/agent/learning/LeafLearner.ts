/**
 * Leaf learner (Recursa RS-18): Algorithm 1 lines 2-7 as a resumable state machine.
 *
 * Phases: `solve` -> `judge` -> (all pass: done) -> `diagnose` -> `edit` -> `validate` ->
 * `apply` -> next round, or done. The state lives in the `learning_trace` entity (decision Q3),
 * so a harness can drive `start` / `next` / `submit` one tool call at a time. `learn` is the
 * in-process loop over the same API.
 *
 * `next` returns a `solve` or `judge` request when external work is needed, and `done` when the
 * run has stopped. Diagnose, edit, validate and apply run inside `next`. Solver and judge
 * failures are recorded as failing tasks, not thrown.
 *
 * @module agent/learning/LeafLearner
 * @experimental Spec RS-18. The step API may gain fields.
 */

import type { CriterionResult, LearnResult, LeafState, SolveResult, TaskRecord } from '../../types/learning.js';
import { runAllWithStats } from '../harness/ConcurrencyLimiter.js';
import { EMPTY_METRICS, taskRecordsJson } from './LeafLearnerStore.js';
import {
  type Ctx,
  type LeafEnv,
  beginRound,
  copyState,
  knowledgeFor,
  loadCtx,
  pendingTasks,
  resultOf,
  saveCtx,
  stopRun,
} from './LeafLearnerContext.js';
import { inValidationStage, submitValidationJudge, submitValidationSolve, validateStep } from './LeafValidation.js';
import { applyStep } from './LeafApply.js';
import { AbortError } from '../harness/ConcurrencyLimiter.js';
import {
  type FullAnswers,
  diagnoseRound,
  editRound,
  pendingJudgeAnswers,
  submitRoundJudge,
  submitRoundSolve,
} from './LeafRound.js';
import { LearningAccountant, type LearningReport } from './LearningAccountant.js';
import type { LearningDeps, StepRequest } from './types.js';
import { type LeafLearnerOptions, type LeafStartOptions, assertPayload, resolveOptions } from './LeafLearnerOptions.js';

export type { DiagnoserLike, KnowledgeEditorLike, LeafCallContext, LeafLearnerOptions, LeafStartOptions } from './LeafLearnerOptions.js';


/**
 * Resumable leaf learner. Each public call loads the run from its trace, advances it, and saves
 * it, so a reopened storage continues where it stopped.
 *
 * Single-driver semantics: one run is meant to be driven by one caller at a time. Every save is a
 * compare-and-swap on the run's `stateRev`; when two learners step the same trace, the slower
 * save fails with `LeafLearner: stale state (expected rev N)` and nothing it computed is stored,
 * so the caller reloads (`state` / `next`) and retries. No submit is silently lost.
 *
 * A round that accepts no edit stops the run with `no-progress`; the learner does not retry it.
 * Solver answers are not persisted whole: see `LeafLearnerStore` for the size bound.
 *
 * @example
 * ```ts
 * const learner = new LeafLearner({ repository, traces, diagnoser, editor });
 * const result = await learner.learn({ taskIds, budget, tasks }, { solver, judge });
 * ```
 */
export class LeafLearner {
  private readonly env: LeafEnv;
  private readonly publishFn: ((snapshotId: string) => Promise<void>) | undefined;
  private readonly opts: LeafLearnerOptions;
  /** Full answer text of runs in this process, by trace id (never persisted). */
  private readonly fullAnswers = new Map<string, FullAnswers>();

  /**
   * Create the instance.
   *
   * @param opts - Repository, trace store, diagnoser, editor and optional publisher.
   */
  constructor(opts: LeafLearnerOptions) {
    this.opts = opts;
    this.env = {
      repository: opts.repository,
      traces: opts.traces,
      role: opts.role ?? 'solver',
      includeTraceAddrs: opts.includeTraceAddrs ?? false,
    };
    const publisher = opts.publisher;
    const dir = opts.publishDir;
    this.publishFn =
      publisher && dir !== undefined
        ? async (snapshotId: string) => {
            await publisher.publish(dir, { snapshotId });
          }
        : undefined;
  }

  /**
   * Create a run: a trace, its one-time task records, the round-0 snapshot, and a state in the
   * `solve` phase.
   *
   * @param opts - Learning options with the tasks.
   * @returns The persisted state.
   * @throws RangeError for invalid options or an unknown task id.
   */
  async start(opts: LeafStartOptions): Promise<LeafState> {
    const { options, taskIds } = resolveOptions(opts);
    const byId = new Map(opts.tasks.map((t) => [t.id, t] as const));
    const tasks = taskIds.map((id) => {
      const task = byId.get(id);
      if (!task) throw new RangeError(`LeafLearner: unknown task id ${id}`);
      return task;
    });
    // The trace does not exist yet, so its id cannot scope the batch: create it first, then
    // coalesce the task records and the run's first state into one write.
    const traceId = await this.opts.traces.create({
      learnerKind: 'leaf',
      round: 0,
      subsetLabel: opts.subsetLabel ?? 'all',
      actions: [],
      revisionIds: [],
      metrics: EMPTY_METRICS,
      ...(opts.parentTraceId !== undefined ? { parentTraceId: opts.parentTraceId } : {}),
    });
    return this.opts.traces.batch(traceId, async () => {
      await this.opts.traces.writeTasks(traceId, taskRecordsJson(tasks));
      const run: Ctx['run'] = {
        schema: 1,
        stateRev: 0,
        ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
        startedAtMs: Date.now(),
        state: { traceId, round: 0, phase: 'solve', pending: [], results: {}, feedback: {} },
        options,
        taskIds,
        tasks,
        roundSnapshotId: '',
        snapshotId: '',
        diagnoses: [],
        accounting: new LearningAccountant().toState(),
        revisionCount: 0,
        appliedRevisionIds: [],
        recordedFailures: {},
        answers: {},
      };
      const ctx: Ctx = { run, acct: LearningAccountant.fromState(run.accounting) };
      await beginRound(this.env, ctx, 0);
      return copyState(run.state);
    });
  }

  /**
   * Current persisted state of a run.
   *
   * @param traceId - Root trace id.
   * @returns A copy of the state.
   * @throws Error when the trace has no leaf-learner state.
   */
  async state(traceId: string): Promise<LeafState> {
    return copyState((await loadCtx(this.env, traceId)).run.state);
  }

  /**
   * Learning report (spec RS-23) of a run: rework, signal, stalls, tokens and phase timing.
   *
   * @param traceId - Root trace id.
   * @returns The report.
   */
  async report(traceId: string): Promise<LearningReport> {
    return resultOf((await loadCtx(this.env, traceId)).run).report!;
  }

  /**
   * Advance the run until external work is needed or the run stops. Apply conflicts, rejected
   * ops and publish failures are recorded on the trace, never thrown. An abort of `opts.signal`
   * (also during diagnose or edit) stops the run with `aborted`.
   *
   * @param traceId - Root trace id.
   * @param opts - Optional abort signal.
   * @returns A `solve` or `judge` request, or `done` with the result.
   * @throws Error when the state is inconsistent or another driver saved first (stale state).
   */
  async next(traceId: string, opts: { signal?: AbortSignal } = {}): Promise<StepRequest> {
    // One durable checkpoint per returned step: the phases a single call runs (diagnose, edit,
    // validate, apply) each save the run, append an action and sometimes set metrics, and those
    // writes are coalesced into one per trace. Resumability is unchanged — the state is committed
    // before this returns, exactly as before.
    return this.opts.traces.batch(traceId, async () => this.advance(await loadCtx(this.env, traceId), opts.signal));
  }

  /**
   * Store the results of a `solve` or `judge` request and advance the phase when every pending
   * task has a result. A `null` result means the call failed, and that task fails. Judged answers
   * are dropped from the persisted run.
   *
   * @param traceId - Root trace id.
   * @param kind - Which request is answered.
   * @param payload - Results keyed by task id.
   * @returns The updated state.
   * @throws TypeError for an empty payload or a malformed result.
   * @throws Error when no such request is pending or an id is not pending.
   */
  async submit(traceId: string, kind: 'solve', payload: Record<string, SolveResult | null>): Promise<LeafState>;
  async submit(traceId: string, kind: 'judge', payload: Record<string, CriterionResult[] | null>): Promise<LeafState>;
  async submit(traceId: string, kind: 'solve' | 'judge', payload: Record<string, unknown>): Promise<LeafState> {
    assertPayload(kind, payload);
    return this.opts.traces.batch(traceId, () => this.submitUnbatched(traceId, kind, payload));
  }

  /**
   * Body of {@link LeafLearner.submit}: one coalesced write batch per submitted step.
   *
   * @param traceId - Root trace id.
   * @param kind - Which request is answered.
   * @param payload - Results keyed by task id.
   * @returns The updated state.
   */
  private async submitUnbatched(traceId: string, kind: 'solve' | 'judge', payload: Record<string, unknown>): Promise<LeafState> {
    const ctx = await loadCtx(this.env, traceId);
    const { run } = ctx;
    if (run.state.phase === 'done') throw new Error(`LeafLearner: run ${traceId} is done`);
    for (const id of Object.keys(payload)) {
      if (!run.state.pending.includes(id)) throw new Error(`LeafLearner: task ${id} is not pending for ${kind}`);
      if (kind === 'judge') assertKnownCriteria(run.tasks.find((t) => t.id === id), payload[id] as CriterionResult[] | null);
    }
    const full = this.answersOf(traceId);
    if (kind === 'solve' && run.state.phase === 'solve') {
      await submitRoundSolve(this.env, ctx, payload as Record<string, SolveResult | null>, full);
    } else if (kind === 'judge' && run.state.phase === 'judge') {
      await submitRoundJudge(this.env, ctx, payload as Record<string, CriterionResult[] | null>);
    } else if (kind === 'solve' && inValidationStage(run, 'solve')) {
      await submitValidationSolve(this.env, ctx, payload as Record<string, SolveResult | null>, full);
    } else if (kind === 'judge' && inValidationStage(run, 'judge')) {
      await submitValidationJudge(this.env, ctx, payload as Record<string, CriterionResult[] | null>);
    } else {
      throw new Error(`LeafLearner: ${kind} results are not expected in phase ${run.state.phase}`);
    }
    return copyState(run.state);
  }

  /**
   * Stop a run with reason `aborted`. A finished run is returned unchanged.
   *
   * @param traceId - Root trace id.
   * @returns The state.
   */
  async abort(traceId: string): Promise<LeafState> {
    return this.opts.traces.batch(traceId, async () => {
      const ctx = await loadCtx(this.env, traceId);
      if (ctx.run.state.phase !== 'done') await stopRun(this.env, ctx, 'aborted');
      this.fullAnswers.delete(traceId);
      return copyState(ctx.run.state);
    });
  }

  /**
   * In-process loop: answers each `solve` and `judge` request with the injected solver and judge,
   * through the concurrency limiter, until the run is done.
   *
   * @param opts - Learning options with the tasks.
   * @param deps - Solver and judge (the judge is required) and an optional abort signal.
   * @returns The result.
   * @throws Error when `deps.judge` is missing.
   */
  async learn(opts: LeafStartOptions, deps: LearningDeps): Promise<LearnResult> {
    if (!deps.judge) throw new Error('LeafLearner.learn: deps.judge is required');
    const judge = deps.judge;
    const { options } = resolveOptions(opts);
    const { traceId } = await this.start(opts);
    const signal = deps.signal;
    const limits = { concurrency: options.concurrency, ...(signal ? { signal } : {}) };
    for (;;) {
      if (signal?.aborted) await this.abort(traceId);
      const step = await this.next(traceId, signal ? { signal } : {});
      if (step.kind === 'done') return step.result;
      if (step.kind === 'solve') {
        const { results, stats } = await runAllWithStats(step.tasks, (entry, _i, s) => deps.solver.solve(entry.task, entry.knowledge, s), limits);
        await this.recordStall(traceId, stats.queuedMs);
        if (signal?.aborted) continue;
        const payload: Record<string, SolveResult | null> = {};
        step.tasks.forEach((entry, i) => {
          const r = results[i]!;
          payload[entry.task.id] = r.ok ? r.value : null;
        });
        await this.submit(traceId, 'solve', payload);
      } else {
        const { results, stats } = await runAllWithStats(step.answers, (entry, _i, s) => judge.judge(entry.task, entry.answer, s), limits);
        await this.recordStall(traceId, stats.queuedMs);
        if (signal?.aborted) continue;
        const payload: Record<string, CriterionResult[] | null> = {};
        step.answers.forEach((entry, i) => {
          const r = results[i]!;
          payload[entry.task.id] = r.ok ? r.value : null;
        });
        await this.submit(traceId, 'judge', payload);
      }
    }
  }

  /**
   * Add limiter queue time to the run's accountant and save it.
   *
   * @param traceId - Root trace id.
   * @param queuedMs - `stats.queuedMs` of one `runAllWithStats` call.
   */
  private async recordStall(traceId: string, queuedMs: number): Promise<void> {
    if (!(queuedMs > 0)) return;
    const ctx = await loadCtx(this.env, traceId);
    ctx.acct.recordStall(queuedMs);
    await saveCtx(this.env, ctx);
  }

  /**
   * Full answer map of a run in this process, created on first use.
   *
   * @param traceId - Root trace id.
   * @returns The map (mutated in place by the round phases).
   */
  private answersOf(traceId: string): FullAnswers {
    let full = this.fullAnswers.get(traceId);
    if (!full) {
      full = new Map();
      this.fullAnswers.set(traceId, full);
    }
    return full;
  }

  /**
   * Run internal phases until external work is needed or the run is done. Full answer text is
   * freed whenever a round ends (a new round begins or the run stops).
   *
   * @param ctx - Loaded run.
   * @param signal - Optional abort signal; an abort stops the run with `aborted`.
   * @returns The request or the done step.
   */
  private async advance(ctx: Ctx, signal?: AbortSignal): Promise<StepRequest> {
    const traceId = ctx.run.state.traceId;
    const full = this.answersOf(traceId);
    for (;;) {
      const { run } = ctx;
      if (signal?.aborted && run.state.phase !== 'done') await stopRun(this.env, ctx, 'aborted');
      const round = run.state.round;
      try {
        const request = await this.step(ctx, full, signal);
        if (request) return request;
      } catch (err) {
        if (!(err instanceof AbortError)) throw err;
        await stopRun(this.env, ctx, 'aborted');
      }
      if (ctx.run.state.round !== round || ctx.run.state.phase === 'done') full.clear();
    }
  }

  /**
   * Run one phase.
   *
   * @param ctx - Loaded run.
   * @param full - Full answer text held by this process.
   * @param signal - Optional abort signal for diagnose and edit.
   * @returns A request when external work is needed, else `undefined` (phase advanced).
   */
  private async step(ctx: Ctx, full: FullAnswers, signal: AbortSignal | undefined): Promise<StepRequest | undefined> {
    const { run } = ctx;
    switch (run.state.phase) {
      case 'done':
        this.fullAnswers.delete(run.state.traceId);
        return { kind: 'done', result: resultOf(run) };
      case 'solve': {
        const tasks = [];
        for (const task of pendingTasks(run)) tasks.push({ task, knowledge: await knowledgeFor(this.env, task.input, [task.id]) });
        return { kind: 'solve', tasks };
      }
      case 'judge':
        return { kind: 'judge', answers: pendingJudgeAnswers(run, full) };
      case 'diagnose':
        await diagnoseRound(this.env, ctx, this.opts.diagnoser, full, signal);
        return undefined;
      case 'edit':
        await editRound(this.env, ctx, this.opts.editor, full, signal);
        return undefined;
      case 'validate':
        return validateStep(this.env, ctx, full);
      case 'apply':
        await applyStep(this.env, ctx, this.publishFn);
        return undefined;
    }
  }
}

/**
 * Reject judge results naming a criterion that is not in the task's rubric.
 *
 * @param task - Task the results are for.
 * @param results - Submitted results (`null` = judge failed).
 * @throws RangeError for an unknown `criterionId`.
 */
function assertKnownCriteria(task: TaskRecord | undefined, results: CriterionResult[] | null): void {
  if (!task || results === null) return;
  const known = new Set(task.rubric.map((c) => c.id));
  const unknown = results.find((r) => !known.has(r.criterionId));
  if (unknown) throw new RangeError(`LeafLearner: unknown criterionId ${unknown.criterionId} for task ${task.id}`);
}
