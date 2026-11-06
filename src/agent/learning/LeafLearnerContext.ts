/**
 * Shared plumbing for the leaf learner's phases (Recursa RS-18): loading and saving the run
 * record, trace actions, phase transitions, round start, budget checks and knowledge rendering.
 *
 * @module agent/learning/LeafLearnerContext
 * @experimental Spec RS-18. Internal to the leaf learner.
 */

import type { LearnResult, LearnStopReason, LeafState, LearningBudget, TaskRecord } from '../../types/learning.js';
import type { InstructionSetRole } from '../../types/skills.js';
import { toIsoDateTime } from '../../types/agent-memory.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import { LearningAccountant } from './LearningAccountant.js';
import type { LearningTrace } from './LearningTrace.js';
import type { ValidationPlanOptions } from './RevisionValidator.js';
import type { LoadedKnowledge } from './types.js';
import { EMPTY_METRICS, accountantFrom, loadRun, serializeRun, syncAccounting, type LeafRun } from './LeafLearnerStore.js';

/** Dependencies shared by every phase of one learner. */
export interface LeafEnv {
  /** Repository `K`. */
  repository: KnowledgeRepository;
  /** Trace store holding the run state. */
  traces: LearningTrace;
  /** Role whose instructions the solver sees. */
  role: InstructionSetRole;
  /** Store interaction-log addresses on trace actions. */
  includeTraceAddrs: boolean;
}

/** A loaded run plus its accountant, used within one step. */
export interface Ctx {
  /** Run record. */
  run: LeafRun;
  /** Accountant rebuilt from the persisted spend. */
  acct: LearningAccountant;
}

/**
 * Copy of a state object, so callers cannot change the stored run.
 *
 * @param state - State to copy.
 * @returns A deep copy.
 */
export function copyState(state: LeafState): LeafState {
  return structuredClone(state);
}

/**
 * Result of a run from its persisted fields.
 *
 * @param run - Run record.
 * @returns The `LearnResult`.
 */
export function resultOf(run: LeafRun): LearnResult {
  return {
    snapshotId: run.snapshotId,
    traceId: run.state.traceId,
    before: run.before ?? EMPTY_METRICS,
    after: run.after ?? run.before ?? EMPTY_METRICS,
    stoppedBecause: run.state.stop ?? 'aborted',
    report: accountantFrom(run).report(),
  };
}

/**
 * Budget fields that {@link LearningAccountant.exceeded} checks. Wall-clock is checked separately.
 *
 * @param budget - Learning budget.
 * @returns Budget without the wall-clock limit.
 */
export function countBudget(budget: LearningBudget): LearningBudget {
  return { maxRounds: budget.maxRounds, maxTokens: budget.maxTokens };
}

/**
 * Load a run and rebuild its accountant.
 *
 * @param env - Learner dependencies.
 * @param traceId - Root trace id.
 * @returns The loaded context.
 */
export async function loadCtx(env: LeafEnv, traceId: string): Promise<Ctx> {
  const run = await loadRun(env.traces, traceId);
  return { run, acct: accountantFrom(run) };
}

/**
 * Persist the run with compare-and-swap on `stateRev`: the write succeeds only while the stored
 * run still carries the revision this process loaded (or no state exists yet, for the first save).
 * An entity-version conflict from another writer of the trace (actions, metrics) is retried by
 * `LearningTrace.writeState`; a moved `stateRev` is not.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @throws Error `LeafLearner: stale state (expected rev N)` when another driver saved first.
 */
export async function saveCtx(env: LeafEnv, ctx: Ctx): Promise<void> {
  const { run } = ctx;
  const expected = run.stateRev;
  syncAccounting(run, ctx.acct);
  run.stateRev = expected + 1;
  try {
    await env.traces.writeState(run.state.traceId, serializeRun(run), (current) => {
      const storedRev = current === undefined ? 0 : (JSON.parse(current) as { stateRev?: number }).stateRev;
      if (storedRev !== expected) throw new Error(`LeafLearner: stale state (expected rev ${expected})`);
    });
  } catch (err) {
    run.stateRev = expected;
    throw err;
  }
}

/**
 * Set the phase and the start time of the phase, closing the timing of the phase that ends and
 * opening the timing of the new one in the accountant.
 *
 * @param ctx - Loaded run.
 * @param phase - Phase to enter.
 */
export function enterPhase(ctx: Ctx, phase: LeafState['phase']): void {
  const { run, acct } = ctx;
  const previous = run.state.phase;
  if (acct.isPhaseOpen(previous)) acct.endPhase(previous);
  run.state.phase = phase;
  if (phase !== 'done') acct.startPhase(phase);
  run.phaseStartedAt = toIsoDateTime(new Date());
}

/**
 * Add a trace action for the phase that just ended. Addresses are kept only when
 * `includeTraceAddrs` is set, so no address is written without an InteractionLog.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param kind - Trace action kind.
 * @param addrs - Interaction-log addresses (never solver output).
 * @param outcome - Short description.
 */
export async function recordAction(
  env: LeafEnv,
  ctx: Ctx,
  kind: 'solve' | 'diagnose' | 'edit' | 'validate',
  addrs: string[],
  outcome: string,
): Promise<void> {
  const { run } = ctx;
  const now = toIsoDateTime(new Date());
  await env.traces.appendAction(run.state.traceId, {
    kind,
    startedAt: run.phaseStartedAt ?? now,
    endedAt: now,
    addrs: env.includeTraceAddrs ? [...new Set(addrs)] : [],
    outcome,
  });
}

/**
 * Stop reason for starting another round: rounds and tokens from the accountant, wall-clock from
 * the run's persisted start time (so the budget survives a reopen).
 *
 * @param ctx - Loaded run.
 * @returns The stop reason, or `null` while headroom remains.
 */
export function budgetStopFor(ctx: Ctx): LearnStopReason | null {
  const { run, acct } = ctx;
  const reason = acct.exceeded(countBudget(run.options.budget));
  if (reason) return reason;
  const limit = run.options.budget.maxWallClockMs;
  if (limit !== undefined && Date.now() - run.startedAtMs >= limit) return 'budget-time';
  return null;
}

/**
 * Token or wall-clock stop reason, checked mid-round (after a solve or judge stage). Rounds are not
 * checked here: they are counted when a round begins.
 *
 * @param ctx - Loaded run.
 * @returns `budget-tokens`, `budget-time` or `null`.
 */
export function tokenTimeStop(ctx: Ctx): LearnStopReason | null {
  const reason = budgetStopFor(ctx);
  return reason === 'budget-rounds' ? null : reason;
}

/**
 * Stop the run: `done` phase with the reason. Final metrics were already set on the trace.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param reason - Stop reason.
 */
export async function stopRun(env: LeafEnv, ctx: Ctx, reason: LearnStopReason): Promise<void> {
  const { run } = ctx;
  enterPhase(ctx, 'done');
  run.state = { ...run.state, stop: reason, pending: [] };
  run.validation = undefined;
  await saveCtx(env, ctx);
}

/**
 * Begin a round: snapshot `K` as the OCC base, reset the round's fields, count the round.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param round - Round number.
 */
export async function beginRound(env: LeafEnv, ctx: Ctx, round: number): Promise<void> {
  const { run, acct } = ctx;
  const snapshot = await env.repository.snapshot(`leaf-round-${round}`);
  run.roundSnapshotId = snapshot.id;
  run.snapshotId = snapshot.id;
  enterPhase(ctx, 'solve');
  run.state = {
    traceId: run.state.traceId,
    round,
    phase: 'solve',
    pending: run.tasks.map((t) => t.id),
    results: {},
    feedback: {},
  };
  run.diagnoses = [];
  run.revision = undefined;
  run.validation = undefined;
  run.answers = {};
  acct.recordRound();
  await saveCtx(env, ctx);
}

/**
 * Tasks of the run whose feedback did not pass.
 *
 * @param run - Run record.
 * @returns Failed tasks in run order.
 */
export function failedTasks(run: LeafRun): TaskRecord[] {
  return run.tasks.filter((t) => run.state.feedback[t.id]?.allPass !== true);
}

/**
 * Pending tasks, in run order.
 *
 * @param run - Run record.
 * @returns Tasks awaiting a result.
 * @throws Error when no task is pending (the phase should already have advanced).
 */
export function pendingTasks(run: LeafRun): TaskRecord[] {
  const tasks = run.tasks.filter((t) => run.state.pending.includes(t.id));
  if (tasks.length === 0) throw new Error(`LeafLearner: no pending tasks in phase ${run.state.phase}`);
  return tasks;
}

/**
 * Knowledge for one solver call, rendered from live `K`.
 *
 * @param env - Learner dependencies.
 * @param taskHint - Task input.
 * @returns Loaded knowledge.
 */
export async function knowledgeFor(env: LeafEnv, taskHint: string): Promise<LoadedKnowledge> {
  return env.repository.loadForContext({ role: env.role, taskHint });
}

/**
 * Knowledge for a round-level call (diagnose or edit), hinted by the task inputs.
 *
 * @param env - Learner dependencies.
 * @param tasks - Tasks the call concerns.
 * @returns Loaded knowledge.
 */
export async function knowledgeForTasks(env: LeafEnv, tasks: readonly TaskRecord[]): Promise<LoadedKnowledge> {
  return knowledgeFor(env, tasks.map((t) => t.input).join('\n'));
}

/**
 * Validation plan options for the current round.
 *
 * @param env - Learner dependencies.
 * @param run - Run record.
 * @returns Options for {@link planValidation}.
 */
export function planOptions(env: LeafEnv, run: LeafRun): ValidationPlanOptions {
  return {
    repository: env.repository,
    affectedTaskIds: failedTasks(run).map((t) => t.id),
    allTasks: run.tasks,
    priorFeedback: run.state.feedback,
    validationSampleSize: run.options.validationSampleSize,
    role: env.role,
  };
}
