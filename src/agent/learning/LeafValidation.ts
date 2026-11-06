/**
 * Validation and apply phases of the leaf learner (Recursa RS-17 driven by RS-18).
 *
 * The validation phase repeats `solve` then `judge` over the planned tasks, once per repeat,
 * and decides with {@link decideValidation}. The plan is computed once and persisted on the run;
 * a live `K` that moves mid-validation rejects the revision. Accepted revisions are applied by
 * `LeafApply`. Solver and judge calls are requested from the caller, never made here.
 *
 * @module agent/learning/LeafValidation
 * @experimental Spec RS-17/RS-18. Internal to the leaf learner.
 */

import type { CriterionResult, SolveResult, TaskRecord } from '../../types/learning.js';
import { passesRubric, decideValidation, planValidation, type ValidationPlan } from './RevisionValidator.js';
import type { StepRequest } from './types.js';
import { type LeafRun, type PersistedPlan, capAnswer } from './LeafLearnerStore.js';
import { type FullAnswers, judgeInput } from './LeafRound.js';
import {
  type Ctx,
  type LeafEnv,
  enterPhase,
  planOptions,
  recordAction,
  saveCtx,
  stopRun,
  tokenTimeStop,
} from './LeafLearnerContext.js';

/**
 * Planned tasks of a persisted plan, in run order.
 *
 * @param run - Run record.
 * @param plan - Persisted plan.
 * @returns Tasks.
 */
function planTasks(run: LeafRun, plan: PersistedPlan): TaskRecord[] {
  const ids = new Set(plan.taskIds);
  return run.tasks.filter((t) => ids.has(t.id));
}

/**
 * Rebuild a {@link ValidationPlan} from its persisted form, for the verdict.
 *
 * @param run - Run record.
 * @param plan - Persisted plan.
 * @returns The plan.
 */
function planOf(run: LeafRun, plan: PersistedPlan): ValidationPlan {
  return { affected: plan.affected, sample: plan.sample, tasks: planTasks(run, plan), knowledge: plan.knowledge };
}

/**
 * Reject the revision when live `K` changed since the plan was made: the scratch copy no longer
 * derives from the knowledge the revision would be applied to. Records `validation-stale` and
 * stops the run as `no-progress`.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run with a validation in progress.
 * @returns True when the run was stopped.
 */
async function stopIfStale(env: LeafEnv, ctx: Ctx): Promise<boolean> {
  const live = await env.repository.liveDigest();
  if (live === ctx.run.validation!.plan.liveDigest) return false;
  await recordAction(env, ctx, 'validate', [], 'validation-stale: live K changed during validation');
  await stopRun(env, ctx, 'no-progress');
  return true;
}

/**
 * One step of validation. On first entry the plan is computed once from live `K` and persisted
 * with the live digest (a plan that does not apply stops the run); later steps reuse the
 * persisted plan and never recompute it. A live digest that moved rejects the revision
 * (`validation-stale`).
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run in the `validate` phase.
 * @param full - Full answer text held by this process.
 * @returns A request, or `undefined` when the run stopped or the phase moved on.
 */
export async function validateStep(env: LeafEnv, ctx: Ctx, full: FullAnswers): Promise<StepRequest | undefined> {
  const { run } = ctx;
  if (!run.validation) {
    const liveDigest = await env.repository.liveDigest();
    const planned = await planValidation(run.revision!, planOptions(env, run));
    if (!planned.ok) {
      await recordAction(env, ctx, 'validate', [], `reject: ${planned.reason}`);
      await stopRun(env, ctx, 'no-progress');
      return undefined;
    }
    const { plan } = planned;
    run.validation = {
      revision: run.revision!,
      plan: { affected: plan.affected, sample: plan.sample, taskIds: plan.tasks.map((t) => t.id), knowledge: plan.knowledge, liveDigest },
      repeat: 0,
      stage: 'solve',
      passes: Object.fromEntries(plan.tasks.map((t) => [t.id, true])),
      answers: {},
    };
    run.state.pending = plan.tasks.map((t) => t.id);
    await saveCtx(env, ctx);
  } else if (await stopIfStale(env, ctx)) {
    return undefined;
  }
  const v = run.validation!;
  const pending = planTasks(run, v.plan).filter((t) => run.state.pending.includes(t.id));
  if (v.stage === 'solve') {
    return { kind: 'solve', tasks: pending.map((task) => ({ task, knowledge: v.plan.knowledge[task.id]! })) };
  }
  return {
    kind: 'judge',
    answers: pending.map((task) => ({ task, ...judgeInput(full, task.id, v.answers[task.id]) })),
  };
}

/**
 * Record validation solve answers. A failed solve fails its task now. When nothing is pending,
 * the judge stage starts for the answered tasks, or the repeat ends when none answered.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run in the validation solve stage.
 * @param payload - Solver answers keyed by task id (`null`: the solver failed).
 * @param full - Full answer text held by this process (filled here for the judge stage).
 */
export async function submitValidationSolve(
  env: LeafEnv,
  ctx: Ctx,
  payload: Record<string, SolveResult | null>,
  full: FullAnswers,
): Promise<void> {
  const { run } = ctx;
  const v = run.validation!;
  for (const [id, result] of Object.entries(payload)) {
    run.state.pending = run.state.pending.filter((p) => p !== id);
    v.answers[id] = result === null ? null : capAnswer(result.answer);
    if (result !== null) full.set(id, result.answer);
    if (result === null) v.passes[id] = false;
  }
  if (run.state.pending.length > 0) {
    await saveCtx(env, ctx);
    return;
  }
  const stop = tokenTimeStop(ctx);
  if (stop) {
    await stopRun(env, ctx, stop);
    return;
  }
  const answered = Object.keys(v.passes).filter((id) => v.answers[id]);
  if (answered.length === 0) {
    await finishRepeat(env, ctx);
    return;
  }
  v.stage = 'judge';
  run.state.pending = answered;
  await saveCtx(env, ctx);
}

/**
 * Record validation judge results. A task keeps passing only if every repeat passes.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run in the validation judge stage.
 * @param payload - Criterion results keyed by task id (`null`: the judge failed).
 */
export async function submitValidationJudge(
  env: LeafEnv,
  ctx: Ctx,
  payload: Record<string, CriterionResult[] | null>,
): Promise<void> {
  const { run } = ctx;
  const v = run.validation!;
  for (const [id, criteria] of Object.entries(payload)) {
    run.state.pending = run.state.pending.filter((p) => p !== id);
    const task = run.tasks.find((t) => t.id === id)!;
    v.passes[id] = (v.passes[id] ?? false) && passesRubric(task, criteria);
  }
  if (run.state.pending.length > 0) {
    await saveCtx(env, ctx);
    return;
  }
  const stop = tokenTimeStop(ctx);
  if (stop) {
    await stopRun(env, ctx, stop);
    return;
  }
  await finishRepeat(env, ctx);
}

/**
 * End a validation repeat. More repeats restart the solve stage over every planned task. The last
 * repeat decides: accept moves to `apply`, reject stops the run as `no-progress`.
 *
 * @param env - Learner dependencies.
 * @param ctx - Loaded run.
 */
async function finishRepeat(env: LeafEnv, ctx: Ctx): Promise<void> {
  const { run } = ctx;
  const v = run.validation!;
  v.repeat += 1;
  if (v.repeat < run.options.validationRepeats) {
    v.stage = 'solve';
    v.answers = {};
    run.state.pending = Object.keys(v.passes);
    await saveCtx(env, ctx);
    return;
  }
  if (await stopIfStale(env, ctx)) return;
  const verdict = decideValidation(planOf(run, v.plan), v.passes);
  ctx.acct.recordLearnerSignal(v.plan.taskIds.length);
  await recordAction(env, ctx, 'validate', [], `${verdict.verdict}: fixed=${verdict.fixed.length} regressed=${verdict.regressed.length}`);
  run.validation = undefined;
  run.state.pending = [];
  if (verdict.verdict === 'accept') {
    run.state.revisionId = v.revision.id;
    enterPhase(ctx, 'apply');
    await saveCtx(env, ctx);
    return;
  }
  await stopRun(env, ctx, 'no-progress');
}

/**
 * Whether a run is currently in the validation phase with the given stage.
 *
 * @param run - Run record.
 * @param stage - Stage to test.
 * @returns True when the run awaits results of that validation stage.
 */
export function inValidationStage(run: LeafRun, stage: 'solve' | 'judge'): boolean {
  return run.state.phase === 'validate' && run.validation?.stage === stage;
}
