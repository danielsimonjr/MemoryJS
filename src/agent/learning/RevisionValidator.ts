/**
 * Revision validator (Recursa RS-17).
 *
 * A revision is applied to a scratch copy of `K` (`KnowledgeRepository.cloneForValidation`),
 * the affected failing tasks and a deterministic stratified sample of previously passing tasks
 * are solved and judged on that copy, and the revision is accepted only when it fixes at least
 * one affected task and regresses no sampled task. A task passes only when every repeat passes.
 * Solver and judge failures count as failing. Live `K` is never written here.
 *
 * The plan and the verdict are exposed as separate pure steps (`planValidation`,
 * `decideValidation`) so the step-wise {@link LeafLearner} can drive the solve and judge calls
 * itself.
 *
 * @module agent/learning/RevisionValidator
 * @experimental Spec RS-17. Sampling seed and default sample size may change.
 */

import type { InstructionSetRole, KnowledgeRevisionRecord } from '../../types/skills.js';
import type { CriterionResult, Feedback, TaskRecord } from '../../types/learning.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import { sha256Hex } from '../knowledge/knowledgeDigest.js';
import type { RubricJudge } from '../evaluation/DeterministicJudge.js';
import { AbortError, runAll } from '../harness/ConcurrencyLimiter.js';
import type { LoadedKnowledge, LearningSolver as Solver } from './types.js';

/** Default seed for the stratified validation sample. */
export const DEFAULT_VALIDATION_SEED = 'recursa-validation';
/** Default number of parallel solve or judge calls. */
const DEFAULT_CONCURRENCY = 4;
/** Category used for tasks without one. */
const UNCATEGORIZED = 'uncategorized';

/** Outcome of validating one revision. */
export interface ValidationVerdictResult {
  /** `accept` only when `fixed.length > 0` and `regressed.length === 0`. */
  verdict: 'accept' | 'reject';
  /** Affected tasks that pass on the scratch copy. */
  fixed: string[];
  /** Sampled previously passing tasks that fail on the scratch copy. */
  regressed: string[];
  /** Affected tasks still failing plus sampled tasks still passing. */
  unchanged: string[];
  /** Why the revision was rejected before any solve, when its ops do not apply. */
  reason?: string;
}

/** Inputs shared by planning and validation. */
export interface ValidationPlanOptions {
  /** Repository whose scratch copy the revision is applied to. */
  repository: KnowledgeRepository;
  /** Tasks whose previous feedback failed and that the revision should fix. */
  affectedTaskIds: string[];
  /** Every task of the learning run. */
  allTasks: TaskRecord[];
  /** Feedback from the round the revision was derived from, keyed by task id. */
  priorFeedback: Record<string, Feedback>;
  /** Number of previously passing tasks to sample (stratified by category). */
  validationSampleSize: number;
  /** Role whose instructions are rendered (default `solver`). */
  role?: InstructionSetRole;
  /** Token budget per rendered knowledge (default 4000). */
  budgetTokens?: number;
  /** Seed for the deterministic sample (default {@link DEFAULT_VALIDATION_SEED}). */
  seed?: string;
}

/** What to solve and judge for one validation, with the scratch knowledge for each task. */
export interface ValidationPlan {
  /** Affected task ids, in `allTasks` order. */
  affected: string[];
  /** Sampled task ids, in `allTasks` order. */
  sample: string[];
  /** Affected and sampled tasks, in `allTasks` order. */
  tasks: TaskRecord[];
  /** Knowledge rendered from the scratch copy, keyed by task id. */
  knowledge: Record<string, LoadedKnowledge>;
}

/** Result of {@link planValidation}. A rejected plan means the revision does not apply. */
export type ValidationPlanResult = { ok: true; plan: ValidationPlan } | { ok: false; reason: string };

/** Options for {@link RevisionValidator.validate}. */
export interface ValidateOptions extends ValidationPlanOptions {
  /** Repeats per task; a task passes only if every repeat passes (default 1). */
  validationRepeats?: number;
  /** Solver used for every solve call. */
  solver: Solver;
  /** Judge used for every judge call. */
  judge: RubricJudge;
  /** Abort signal; an abort during validation throws {@link AbortError}. */
  signal?: AbortSignal;
  /** Maximum parallel calls (default 4). */
  concurrency?: number;
}

/**
 * Whether a task passes given its criterion results: at least one criterion, and every
 * criterion passes. Missing or null results fail.
 *
 * @param task - Task whose rubric applies.
 * @param criteria - Judge results, or `null` when the judge failed.
 * @returns True when the task passes.
 */
export function passesRubric(task: TaskRecord, criteria: readonly CriterionResult[] | null | undefined): boolean {
  if (!criteria || task.rubric.length === 0) return false;
  return task.rubric.every((c) => criteria.some((r) => r.criterionId === c.id && r.pass));
}

/**
 * Deterministic stratified sample: tasks are grouped by category, each group is ordered by a
 * seeded hash of the task id, and groups are taken round-robin until `size` tasks are chosen.
 *
 * @param tasks - Candidate tasks (previously passing).
 * @param size - Number to sample; at most `tasks.length` are returned.
 * @param seed - Seed for the ordering.
 * @returns Chosen task ids.
 */
export function stratifiedSample(tasks: readonly TaskRecord[], size: number, seed: string): Set<string> {
  const buckets = new Map<string, Array<{ id: string; key: string }>>();
  for (const task of tasks) {
    const category = task.category ?? UNCATEGORIZED;
    const bucket = buckets.get(category) ?? [];
    bucket.push({ id: task.id, key: sha256Hex(`${seed}\u0000${task.id}`) });
    buckets.set(category, bucket);
  }
  const categories = [...buckets.keys()].sort(compareText);
  for (const category of categories) {
    buckets.get(category)!.sort((a, b) => compareText(a.key, b.key) || compareText(a.id, b.id));
  }
  const picked = new Set<string>();
  for (let i = 0; picked.size < size; i++) {
    let any = false;
    for (const category of categories) {
      const item = buckets.get(category)![i];
      if (item === undefined) continue;
      any = true;
      if (picked.size < size) picked.add(item.id);
    }
    if (!any) break;
  }
  return picked;
}

/**
 * Apply a revision to a scratch copy and select the tasks to validate, with the knowledge each
 * one is solved with. Storage is read (to seed the scratch copy) but never written.
 *
 * @param revision - Revision to validate.
 * @param options - Affected tasks, prior feedback, sample size and repository.
 * @returns The plan, or `{ ok: false, reason }` when an op does not apply.
 * @throws RangeError when `validationSampleSize` is not a non-negative integer or an affected id is unknown.
 */
export async function planValidation(
  revision: KnowledgeRevisionRecord,
  options: ValidationPlanOptions,
): Promise<ValidationPlanResult> {
  const size = options.validationSampleSize;
  if (!Number.isInteger(size) || size < 0) throw new RangeError('validationSampleSize must be an integer >= 0');
  const byId = new Map(options.allTasks.map((t) => [t.id, t] as const));
  for (const id of options.affectedTaskIds) {
    if (!byId.has(id)) throw new RangeError(`unknown affected task id: ${id}`);
  }
  const affectedSet = new Set(options.affectedTaskIds);
  const passing = options.allTasks.filter((t) => !affectedSet.has(t.id) && options.priorFeedback[t.id]?.allPass === true);
  const sampled = stratifiedSample(passing, size, options.seed ?? DEFAULT_VALIDATION_SEED);
  const tasks = options.allTasks.filter((t) => affectedSet.has(t.id) || sampled.has(t.id));
  const scratch = await options.repository.cloneForValidation();
  const applied = scratch.apply(revision.ops);
  if (!applied.ok) return { ok: false, reason: `op ${applied.failedOpIndex}: ${applied.reason}` };
  const knowledge: Record<string, LoadedKnowledge> = {};
  for (const task of tasks) {
    knowledge[task.id] = await scratch.loadForContext({
      role: options.role ?? 'solver',
      taskHint: task.input,
      includeSkillIds: await scratch.skillIdsForTasks([task.id]),
      ...(options.budgetTokens !== undefined ? { budgetTokens: options.budgetTokens } : {}),
    });
  }
  return {
    ok: true,
    plan: {
      affected: tasks.filter((t) => affectedSet.has(t.id)).map((t) => t.id),
      sample: tasks.filter((t) => sampled.has(t.id)).map((t) => t.id),
      tasks,
      knowledge,
    },
  };
}

/**
 * Verdict for a plan from per-task pass results. A task missing from `passes` counts as failing.
 *
 * @param plan - Plan the passes belong to.
 * @param passes - Pass per task id (every repeat already ANDed).
 * @returns Verdict with fixed, regressed and unchanged task ids.
 */
export function decideValidation(plan: ValidationPlan, passes: Readonly<Record<string, boolean>>): ValidationVerdictResult {
  const ok = (id: string): boolean => passes[id] === true;
  const fixed = plan.affected.filter(ok);
  const regressed = plan.sample.filter((id) => !ok(id));
  const unchanged = [...plan.affected.filter((id) => !ok(id)), ...plan.sample.filter(ok)];
  return {
    verdict: fixed.length > 0 && regressed.length === 0 ? 'accept' : 'reject',
    fixed,
    regressed,
    unchanged,
  };
}

/**
 * Validates revisions against a scratch copy of `K` (spec RS-17).
 *
 * @example
 * ```ts
 * const verdict = await new RevisionValidator().validate(revision, { ...options, solver, judge });
 * if (verdict.verdict === 'accept') { /* apply to live K with expectedSnapshotId *\/ }
 * ```
 */
export class RevisionValidator {
  /**
   * Validate a revision: plan, run every repeat of solve and judge over the affected and sampled
   * tasks, then decide.
   *
   * @param revision - Revision to validate.
   * @param options - Plan options plus solver, judge, repeats, signal and concurrency.
   * @returns The verdict. A revision whose ops do not apply is rejected with a `reason`.
   * @throws RangeError for invalid options (sample size, repeats, unknown affected id).
   * @throws AbortError when the signal aborts during validation.
   */
  async validate(revision: KnowledgeRevisionRecord, options: ValidateOptions): Promise<ValidationVerdictResult> {
    const repeats = options.validationRepeats ?? 1;
    if (!Number.isInteger(repeats) || repeats < 1) throw new RangeError('validationRepeats must be an integer >= 1');
    const planned = await planValidation(revision, options);
    if (!planned.ok) {
      return { verdict: 'reject', fixed: [], regressed: [], unchanged: [...options.affectedTaskIds], reason: planned.reason };
    }
    const { plan } = planned;
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    const passes: Record<string, boolean> = Object.fromEntries(plan.tasks.map((t) => [t.id, true]));
    for (let repeat = 0; repeat < repeats; repeat++) {
      const answers = await runAll(
        plan.tasks,
        (task, _i, signal) => options.solver.solve(task, plan.knowledge[task.id]!, signal),
        { concurrency, ...(options.signal ? { signal: options.signal } : {}) },
      );
      const answered = plan.tasks.flatMap((task, i) => {
        const result = answers[i]!;
        if (!result.ok) passes[task.id] = false;
        return result.ok ? [{ task, answer: result.value.answer }] : [];
      });
      const judged = await runAll(
        answered,
        (entry, _i, signal) => options.judge.judge(entry.task, entry.answer, signal),
        { concurrency, ...(options.signal ? { signal: options.signal } : {}) },
      );
      answered.forEach((entry, i) => {
        const result = judged[i]!;
        passes[entry.task.id] = (passes[entry.task.id] ?? false) && passesRubric(entry.task, result.ok ? result.value : null);
      });
      if (options.signal?.aborted) throw new AbortError();
    }
    return decideValidation(plan, passes);
  }
}

/**
 * Locale-independent string comparison.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Negative, zero or positive.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
