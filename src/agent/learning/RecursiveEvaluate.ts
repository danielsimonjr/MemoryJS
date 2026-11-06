/**
 * Live-`K` evaluation and round settlement of the recursive learner (Recursa RS-21, spec §3.4 B1).
 *
 * A recursive round's result is never taken from the children's private overlays: when the merged
 * revision was applied, every task of the run is solved and judged once against the live
 * repository (the parent's knowledge view) and that pass map becomes the run's `current`; when it
 * was not applied, `current` returns to the round's `before`.
 *
 * @module agent/learning/RecursiveEvaluate
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { TaskRecord, TokenTotals } from '../../types/learning.js';
import type { RubricJudge } from '../evaluation/DeterministicJudge.js';
import { runAll } from '../harness/ConcurrencyLimiter.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import { feedbackFromCriteria } from './LeafLearnerStore.js';
import type { LearningSolver } from './types.js';

/** Result of {@link evaluateLive}. */
export interface LiveEvaluation {
  /** Pass per task id (solver or judge failures count as failing). */
  pass: Record<string, boolean>;
  /** Solver tokens reported by the solve calls. */
  tokens: TokenTotals;
}

/**
 * Solve and judge every task once against `repository` (skills learned for each task included).
 *
 * @param repository - Knowledge the tasks are evaluated against (live `K` or a parent overlay).
 * @param tasks - Tasks to evaluate.
 * @param deps - Solver, judge and optional abort signal.
 * @param concurrency - Maximum parallel calls.
 * @returns Pass per task and solver tokens.
 */
export async function evaluateLive(
  repository: KnowledgeRepository,
  tasks: readonly TaskRecord[],
  deps: { solver: LearningSolver; judge: RubricJudge; signal?: AbortSignal },
  concurrency: number,
): Promise<LiveEvaluation> {
  const tokens: TokenTotals = { input: 0, output: 0 };
  const repo = repository as KnowledgeRepository & { skillIdsForTasks?: (ids: readonly string[]) => Promise<string[]> };
  const results = await runAll(
    [...tasks],
    async (task, _i, signal) => {
      const includeSkillIds = repo.skillIdsForTasks ? await repo.skillIdsForTasks([task.id]) : [];
      const knowledge = await repository.loadForContext({ role: 'solver', taskHint: task.input, includeSkillIds });
      const solved = await deps.solver.solve(task, knowledge, signal);
      if (solved.tokens) {
        tokens.input += solved.tokens.input;
        tokens.output += solved.tokens.output;
      }
      return feedbackFromCriteria(task, await deps.judge.judge(task, solved.answer, signal)).allPass;
    },
    { concurrency, ...(deps.signal ? { signal: deps.signal } : {}) },
  );
  const pass: Record<string, boolean> = {};
  tasks.forEach((task, i) => {
    const r = results[i];
    pass[task.id] = r !== undefined && r.ok && r.value === true;
  });
  return { pass, tokens };
}

/**
 * Tasks that fail in `before` and pass in `after`.
 *
 * @param before - Pass map at the start of the round.
 * @param after - Pass map after the round.
 * @param ids - Task ids considered.
 * @returns Fixed task ids.
 */
export function fixedBetween(before: Readonly<Record<string, boolean>>, after: Readonly<Record<string, boolean>>, ids: readonly string[]): string[] {
  return ids.filter((id) => before[id] !== true && after[id] === true);
}
