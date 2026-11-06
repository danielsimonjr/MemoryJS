/**
 * Planning helpers of the recursive learner (Recursa RS-21, spec §3.7 S1/S2).
 *
 * - The split receives the evidence of the previous round's children (diagnoses and feedback) and a
 *   `skillMatch` backed by the run's repository (top matching skill id).
 * - A one-subset split is rejected: the next strategy in `auto` order is tried, and when every
 *   strategy gives one subset the node runs as a single forced leaf (no further recursion).
 * - Each child gets `floor(remainingTokens / children)` tokens and the remaining wall-clock time.
 *
 * @module agent/learning/RecursivePlan
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { LearningBudget, SplitStrategyName, TaskRecord } from '../../types/learning.js';
import type { KnowledgeRepository } from '../knowledge/KnowledgeRepository.js';
import { LearningAccountant } from './LearningAccountant.js';
import type { ChildResult, RecursiveState, SubsetRecord } from './RecursiveLearnerState.js';
import { CONCRETE_SPLITS, type SplitContext, type TaskSubset } from './SplitStrategies.js';

/** Split function shape (the 5A `split` by default). */
type Split = (name: SplitStrategyName, tasks: TaskRecord[], ctx?: SplitContext) => Promise<TaskSubset[]>;

/**
 * Split context for a round: insights, the previous children's evidence and a repository-backed skill match.
 *
 * @param state - Run record.
 * @param repository - Knowledge the run reads.
 * @returns The context.
 */
export function splitContextOf(state: RecursiveState, repository: KnowledgeRepository): SplitContext {
  const ids = new Set(state.taskIds);
  const own = <T>(rec: Record<string, T> | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => ids.has(id)));
  return {
    ...(state.keyInsights.length > 0 ? { keyInsights: [...state.keyInsights] } : {}),
    diagnoses: own(state.evidence?.diagnoses),
    feedback: own(state.evidence?.feedback),
    skillMatch: async (task) =>
      (await repository.loadForContext({ role: 'solver', taskHint: task.input, sections: ['skills'], maxSkills: 1 })).skillIds[0],
  };
}

/**
 * Subsets of a round. One-subset results fall through to the next strategy; if every strategy
 * gives one subset, a single forced-leaf subset is returned.
 *
 * @param split - Split function.
 * @param state - Run record.
 * @param tasks - Tasks of the run.
 * @param repository - Knowledge the run reads (for `skillMatch`).
 * @returns The subsets and the strategy used (`leaf` for the forced leaf).
 * @throws RangeError when a split does not partition the tasks.
 */
export async function planSubsets(
  split: Split,
  state: RecursiveState,
  tasks: TaskRecord[],
  repository: KnowledgeRepository,
): Promise<{ subsets: SubsetRecord[]; strategy: string }> {
  const ctx = splitContextOf(state, repository);
  const first = state.options.split;
  const order: SplitStrategyName[] = [first, ...CONCRETE_SPLITS.filter((n) => n !== first)];
  for (const name of order) {
    const raw = await split(name, tasks, ctx);
    if (raw.length < 2) continue;
    return { subsets: normalizeSubsets(raw, state.taskIds, state.options.budget.maxChildren), strategy: raw[0]?.strategy ?? name };
  }
  return {
    subsets: [{ label: 'all', taskIds: [...state.taskIds], rationale: 'every strategy gave one subset; running as a leaf', forceLeaf: true }],
    strategy: 'leaf',
  };
}

/**
 * Budget for each of `children` children: an even share of the remaining tokens and the remaining time.
 *
 * @param state - Run record.
 * @param children - Number of children.
 * @returns The child budget.
 */
export function childBudgetOf(state: RecursiveState, children: number): LearningBudget {
  const budget: LearningBudget = { ...state.options.budget };
  const n = Math.max(1, children);
  if (budget.maxTokens !== undefined) {
    const spent = LearningAccountant.fromState(state.accounting).report().totalTokens;
    budget.maxTokens = Math.max(1, Math.floor((budget.maxTokens - spent) / n));
  }
  if (budget.maxWallClockMs !== undefined) {
    budget.maxWallClockMs = Math.max(1, budget.maxWallClockMs - (Date.now() - state.startedAtMs));
  }
  return budget;
}

/**
 * Fold a completed child's evidence into the run record (latest wins per task).
 *
 * @param state - Run record (mutated).
 * @param result - The child's result.
 */
export function absorbEvidence(state: RecursiveState, result: ChildResult): void {
  const prior = state.evidence ?? { diagnoses: {}, feedback: {} };
  state.evidence = {
    diagnoses: { ...prior.diagnoses, ...result.evidence.diagnoses },
    feedback: { ...prior.feedback, ...result.evidence.feedback },
  };
}

/**
 * Parent budget stop between child completions (tokens, then wall-clock).
 *
 * @param state - Run record.
 * @returns `budget-tokens`, `budget-time` or `null`.
 */
export function childPhaseBudgetStop(state: RecursiveState): 'budget-tokens' | 'budget-time' | null {
  const { maxTokens, maxWallClockMs } = state.options.budget;
  if (maxTokens !== undefined && LearningAccountant.fromState(state.accounting).report().totalTokens >= maxTokens) return 'budget-tokens';
  if (maxWallClockMs !== undefined && Date.now() - state.startedAtMs >= maxWallClockMs) return 'budget-time';
  return null;
}

/**
 * Split a round's output into subsets: validated as a partition, then capped at `maxChildren`
 * (extra subsets are merged into the last one).
 *
 * @param raw - Split output.
 * @param taskIds - Every task id of the run.
 * @param maxChildren - Optional cap on subsets.
 * @returns The subsets to delegate.
 * @throws RangeError when a subset is empty, a task repeats, or a task is missing.
 */
export function normalizeSubsets(raw: TaskSubset[], taskIds: readonly string[], maxChildren: number | undefined): SubsetRecord[] {
  if (raw.length === 0) throw new RangeError('RecursiveLearner: split returned no subsets');
  const seen = new Set<string>();
  for (const subset of raw) {
    if (subset.taskIds.length === 0) throw new RangeError(`RecursiveLearner: subset ${subset.label} is empty`);
    for (const id of subset.taskIds) {
      if (seen.has(id)) throw new RangeError(`RecursiveLearner: task ${id} appears in more than one subset`);
      seen.add(id);
    }
  }
  if (seen.size !== taskIds.length || taskIds.some((id) => !seen.has(id))) {
    throw new RangeError('RecursiveLearner: split must partition the run tasks');
  }
  let subsets: SubsetRecord[] = raw.map((s) => ({ label: s.label, taskIds: [...s.taskIds], rationale: s.rationale }));
  if (maxChildren !== undefined && subsets.length > maxChildren) {
    const head = subsets.slice(0, maxChildren - 1);
    const tail = subsets.slice(maxChildren - 1);
    subsets = [
      ...head,
      {
        label: tail[0]!.label,
        taskIds: tail.flatMap((s) => s.taskIds),
        rationale: `merged ${tail.length} subsets to honour maxChildren=${maxChildren}`,
      },
    ];
  }
  return subsets;
}
