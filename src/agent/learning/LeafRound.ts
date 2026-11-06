/**
 * Round phases of the leaf learner (Recursa RS-18): recording solver results, judging, closing a
 * round's evaluation, diagnosing and editing. Validation lives in `LeafValidation`.
 *
 * Solver answer text never goes into the persisted run whole. Before judging, the capped copy is
 * kept in `run.answers`; the full text lives in a process-local {@link FullAnswers} map that the
 * learner owns, and is dropped once the round's edit phase has used it.
 *
 * @module agent/learning/LeafRound
 * @internal
 */

import type { CriterionResult, Diagnosis, EvalMetrics, SolveResult } from '../../types/learning.js';
import type { KnowledgeRevisionRecord } from '../../types/skills.js';
import { sha256Hex } from '../knowledge/knowledgeDigest.js';
import type { DiagnoserLike, KnowledgeEditorLike, LeafCallContext } from './LeafLearner.js';
import type { FailureDedupStore } from './Diagnoser.js';
import {
  type CappedAnswer,
  type LeafRun,
  capAnswer,
  feedbackFromCriteria,
  failedFeedback,
  summarize,
} from './LeafLearnerStore.js';
import {
  type Ctx,
  type LeafEnv,
  enterPhase,
  failedTasks,
  knowledgeFor,
  knowledgeForTasks,
  recordAction,
  saveCtx,
  stopRun,
  tokenTimeStop,
} from './LeafLearnerContext.js';
import type { JudgeAnswer } from './types.js';

/** Full solver answer text of the current round (and of the validation repeat), by task id. Process-local. */
export type FullAnswers = Map<string, string>;

/**
 * Solver results with answer text where this process still has it, else the capped copy, else
 * empty text (a reopened run has dropped the answers it judged).
 *
 * @param run - Run record.
 * @param full - Full answer text held by this process.
 * @returns Results keyed by task id.
 */
export function resultsFor(run: LeafRun, full: FullAnswers): Record<string, SolveResult> {
  return Object.fromEntries(
    Object.entries(run.state.results).map(([id, r]) => [id, { ...r, answer: full.get(id) ?? run.answers?.[id]?.answer ?? '' }]),
  );
}

/**
 * Durable failure-record dedup over the run: ids live in `run.recordedFailures` and each `set`
 * saves the run at once, so a resumed or rebuilt diagnoser sees the record.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @returns The dedup store.
 */
export function runDedup(env: LeafEnv, ctx: Ctx): FailureDedupStore {
  return {
    get: (key) => ctx.run.recordedFailures[key],
    set: async (key, id) => {
      ctx.run.recordedFailures[key] = id;
      await saveCtx(env, ctx);
    },
  };
}

/**
 * Context handed to the diagnoser and editor adapters for one call.
 *
 * @param run - Run record.
 * @param full - Full answer text held by this process.
 * @param dedup - Failure-record dedup store of the run.
 * @returns The round context.
 */
export function callContextOf(run: LeafRun, full: FullAnswers, dedup?: FailureDedupStore): LeafCallContext {
  return {
    traceId: run.state.traceId,
    ...(dedup ? { dedup } : {}),
    round: run.state.round,
    baseSnapshotId: run.roundSnapshotId,
    tasks: Object.fromEntries(run.tasks.map((t) => [t.id, t])),
    results: resultsFor(run, full),
    feedback: { ...run.state.feedback },
  };
}

/**
 * Answer text for a judge request: the full text when this process holds it, else the capped copy
 * (flagged `truncated`).
 *
 * @param full - Full answer text held by this process.
 * @param taskId - Task id.
 * @param capped - Persisted capped answer, if any.
 * @returns The answer fields of a {@link JudgeAnswer}.
 */
export function judgeInput(full: FullAnswers, taskId: string, capped: CappedAnswer | null | undefined): Pick<JudgeAnswer, 'answer' | 'truncated'> {
  const text = full.get(taskId);
  if (text !== undefined) return { answer: text };
  return capped?.truncated ? { answer: capped.answer, truncated: true } : { answer: capped?.answer ?? '' };
}

/**
 * Record solve results: text kept in process memory, capped copy persisted, result metadata kept,
 * and the accountant told (rework counting). Failed solves are left pending-cleared.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param payload - Solver results keyed by task id (`null`: the call failed).
 * @param full - Full answer text held by this process.
 */
async function recordSolves(env: LeafEnv, ctx: Ctx, payload: Record<string, SolveResult | null>, full: FullAnswers): Promise<void> {
  const { run, acct } = ctx;
  run.answers ??= {};
  for (const [id, result] of Object.entries(payload)) {
    run.state.pending = run.state.pending.filter((p) => p !== id);
    if (result === null) continue;
    full.set(id, result.answer);
    run.answers[id] = capAnswer(result.answer);
    run.state.results[id] = { answer: '', traceAddrs: result.traceAddrs, ...(result.tokens ? { tokens: result.tokens } : {}) };
    const task = run.tasks.find((t) => t.id === id)!;
    const knowledge = await knowledgeFor(env, task.input, [task.id]);
    acct.recordSolve(id, sha256Hex(knowledge.markdown), result.tokens);
  }
}

/**
 * Record solve results. Failed tasks get failing feedback at once. When nothing is pending, the
 * judge phase starts for the answered tasks, or the evaluation closes when none answered.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param payload - Solver results keyed by task id.
 * @param full - Full answer text held by this process.
 */
export async function submitRoundSolve(env: LeafEnv, ctx: Ctx, payload: Record<string, SolveResult | null>, full: FullAnswers): Promise<void> {
  const { run } = ctx;
  await recordSolves(env, ctx, payload, full);
  if (run.state.pending.length > 0) {
    await saveCtx(env, ctx);
    return;
  }
  for (const task of run.tasks) {
    if (!run.state.results[task.id]) run.state.feedback[task.id] = failedFeedback(task, 'solver failed');
  }
  const answered = run.tasks.filter((t) => run.state.results[t.id] !== undefined).map((t) => t.id);
  if (answered.length === 0) {
    await completeEvaluation(env, ctx);
    return;
  }
  const stop = tokenTimeStop(ctx);
  if (stop) {
    await stopRun(env, ctx, stop);
    return;
  }
  run.state.pending = answered;
  enterPhase(ctx, 'judge');
  await saveCtx(env, ctx);
}

/**
 * Record judge results and drop the judged answers from the persisted run. When nothing is
 * pending, the round's evaluation is complete.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param payload - Criterion results keyed by task id (`null`: the judge failed).
 */
export async function submitRoundJudge(env: LeafEnv, ctx: Ctx, payload: Record<string, CriterionResult[] | null>): Promise<void> {
  const { run } = ctx;
  for (const [id, criteria] of Object.entries(payload)) {
    run.state.pending = run.state.pending.filter((p) => p !== id);
    const task = run.tasks.find((t) => t.id === id)!;
    run.state.feedback[id] = feedbackFromCriteria(task, criteria);
    if (run.answers) delete run.answers[id];
  }
  if (run.state.pending.length > 0) {
    await saveCtx(env, ctx);
    return;
  }
  await completeEvaluation(env, ctx);
}

/**
 * Close a round's evaluation: metrics, the trace action, then either an all-pass stop or the
 * diagnose phase.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 */
export async function completeEvaluation(env: LeafEnv, ctx: Ctx): Promise<void> {
  const { run } = ctx;
  const metrics: EvalMetrics = summarize(run.tasks, run.state.feedback);
  run.beforePass ??= Object.fromEntries(run.tasks.map((t) => [t.id, run.state.feedback[t.id]?.allPass === true]));
  run.beforeCriteria ??= Object.fromEntries(run.tasks.map((t) => [t.id, [...(run.state.feedback[t.id]?.criteria ?? [])]]));
  run.before ??= metrics;
  run.after = metrics;
  await env.traces.setMetrics(run.state.traceId, metrics);
  const addrs = Object.values(run.state.results).flatMap((r) => r.traceAddrs);
  await recordAction(env, ctx, 'solve', addrs, `evaluated ${run.tasks.length} tasks, allPass=${metrics.allPass}`);
  if (run.tasks.every((t) => run.state.feedback[t.id]?.allPass === true)) {
    await stopRun(env, ctx, 'all-pass');
    return;
  }
  const stop = tokenTimeStop(ctx);
  if (stop) {
    await stopRun(env, ctx, stop);
    return;
  }
  enterPhase(ctx, 'diagnose');
  await saveCtx(env, ctx);
}

/**
 * Diagnose the failed tasks of the round. Feedback and evidence addresses handed to the diagnoser
 * count as solver-side signal.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param diagnoser - Diagnoser adapter.
 * @param full - Full answer text held by this process.
 * @param signal - Optional abort signal, passed to the diagnoser (an abort rejects with `AbortError`).
 */
export async function diagnoseRound(env: LeafEnv, ctx: Ctx, diagnoser: DiagnoserLike, full: FullAnswers, signal?: AbortSignal): Promise<void> {
  const { run, acct } = ctx;
  const failed = failedTasks(run);
  const knowledge = await knowledgeForTasks(env, failed);
  const results = resultsFor(run, full);
  const diagnoses: Diagnosis[] = await diagnoser.diagnose(
    failed.map((task) => ({
      task,
      feedback: run.state.feedback[task.id]!,
      ...(results[task.id] ? { answer: results[task.id] } : {}),
    })),
    knowledge,
    signal,
    callContextOf(run, full, runDedup(env, ctx)),
  );
  acct.recordSolverSignal(failed.length + failed.reduce((n, t) => n + (results[t.id]?.traceAddrs.length ?? 0), 0));
  for (const diagnosis of diagnoses) {
    if (diagnosis.relatedFailureId) acct.recordDiagnosis(diagnosis.relatedFailureId);
  }
  run.diagnoses = diagnoses;
  await recordAction(env, ctx, 'diagnose', diagnoses.flatMap((d) => d.evidenceAddrs), `${diagnoses.length} diagnoses`);
  enterPhase(ctx, 'edit');
  await saveCtx(env, ctx);
}

/**
 * Draft the round's revision. A revision with no ops stops the run as `no-progress`. Ends the
 * round's use of the full answer text, so it is dropped from memory here.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 * @param editor - Editor adapter.
 * @param full - Full answer text held by this process; cleared on return.
 * @param signal - Optional abort signal, passed to the editor.
 */
export async function editRound(env: LeafEnv, ctx: Ctx, editor: KnowledgeEditorLike, full: FullAnswers, signal?: AbortSignal): Promise<void> {
  const { run } = ctx;
  const knowledge = await knowledgeForTasks(env, failedTasks(run));
  const drafted: KnowledgeRevisionRecord = await editor.edit(run.diagnoses, knowledge, signal, callContextOf(run, full));
  full.clear();
  const revision: KnowledgeRevisionRecord = { ...drafted, baseSnapshotId: run.roundSnapshotId };
  run.revision = revision;
  await recordAction(env, ctx, 'edit', [], `proposed ${revision.ops.length} ops`);
  if (revision.ops.length === 0) {
    await stopRun(env, ctx, 'no-progress');
    return;
  }
  enterPhase(ctx, 'validate');
  await saveCtx(env, ctx);
}

/**
 * Tasks of the run awaiting a result, in run order, with judge input for each.
 *
 * @param run - Run record.
 * @param full - Full answer text held by this process.
 * @returns Judge answers for the pending tasks that have a result.
 */
export function pendingJudgeAnswers(run: LeafRun, full: FullAnswers): JudgeAnswer[] {
  return run.tasks
    .filter((t) => run.state.pending.includes(t.id))
    .map((task) => ({ task, ...judgeInput(full, task.id, run.answers?.[task.id]) }));
}
