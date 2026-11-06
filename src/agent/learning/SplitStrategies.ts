/**
 * Split strategies (spec RS-19): partition a set of tasks into labelled subsets for recursive
 * learning. Every strategy is a partition: each task lands in exactly one subset, no subset is
 * empty, and the result is deterministic for the same inputs.
 *
 * Subsets are sorted by label; task identifiers inside a subset keep the input order.
 * `auto` evaluates the four concrete strategies and keeps the most balanced partition; a
 * single-subset partition always ranks last (spec §3.7 S2). Each subset carries the concrete
 * `strategy` that produced it.
 *
 * @module agent/learning/SplitStrategies
 * @experimental Part of the Recursa self-improvement work (spec RS-19).
 */

import type {
  Diagnosis,
  SplitStrategyName,
  TaskRecord,
} from '../../types/learning.js';

/** One subset of a partition. */
export interface TaskSubset {
  /** Subset label (unique within a partition). */
  label: string;
  /** Task identifiers in input order. */
  taskIds: string[];
  /** Human-readable reason the tasks were grouped. */
  rationale: string;
  /** Concrete strategy that produced the subset (set by {@link split}). */
  strategy?: string;
}

/** Optional evidence a split strategy may consult. */
export interface SplitContext {
  /** Diagnoses keyed by task id. */
  diagnoses?: Record<string, Diagnosis>;
  /** Judged feedback keyed by task id. */
  feedback?: Record<string, { allPass: boolean; criteria: Array<{ criterionId: string; pass: boolean }> }>;
  /** Returns the top matching skill id for a task, if any. */
  skillMatch?: (task: TaskRecord) => Promise<string | undefined> | string | undefined;
  /** Reflection insights; an exact `prefer-split:<name>` token is preferred among tied `auto` candidates. */
  keyInsights?: string[];
}

/** Label of the subset holding tasks without a category, tag, skill or tool. */
const UNCATEGORIZED = 'uncategorized';

/** Concrete (non-`auto`) strategies in tie-break order. */
export const CONCRETE_SPLITS: readonly Exclude<SplitStrategyName, 'auto'>[] = ['byCategory', 'byFailureMode', 'bySkill', 'byTool'];
const CONCRETE = CONCRETE_SPLITS;

/**
 * Strategy named by an exact `prefer-split:<name>` insight token (the last one wins).
 *
 * @param keyInsights - Reflection insights
 * @returns The concrete strategy, or `undefined`
 */
export function preferredSplitOf(keyInsights: readonly string[] | undefined): Exclude<SplitStrategyName, 'auto'> | undefined {
  let found: Exclude<SplitStrategyName, 'auto'> | undefined;
  for (const insight of keyInsights ?? []) {
    const m = /^prefer-split:(\w+)$/.exec(insight.trim());
    const name = m?.[1] as Exclude<SplitStrategyName, 'auto'> | undefined;
    if (name && CONCRETE.includes(name)) found = name;
  }
  return found;
}

/**
 * Compare two strings by code unit, so sorting never depends on the locale.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Negative, zero or positive
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Throw when two tasks share an identifier, since a partition cannot place one id twice.
 *
 * @param tasks - Tasks to check
 * @throws Error on the first duplicate task id
 */
function assertUniqueIds(tasks: TaskRecord[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`split: duplicate task id "${task.id}"`);
    seen.add(task.id);
  }
}

/**
 * Group tasks by a label function, preserving input order inside each group.
 *
 * @param tasks - Tasks in input order
 * @param labelOf - Label per task
 * @param rationaleOf - Rationale per label
 * @returns Subsets sorted by label
 */
function group(
  tasks: TaskRecord[],
  labelOf: (task: TaskRecord) => string,
  rationaleOf: (label: string) => string,
): TaskSubset[] {
  const buckets = new Map<string, string[]>();
  for (const task of tasks) {
    const label = labelOf(task);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(task.id);
    else buckets.set(label, [task.id]);
  }
  return [...buckets.keys()]
    .sort(compareStrings)
    .map((label) => ({ label, taskIds: buckets.get(label) ?? [], rationale: rationaleOf(label) }));
}

/**
 * Partition by category, falling back to the first tag and then to `uncategorized`.
 *
 * @param tasks - Tasks to partition
 * @returns Partition
 */
function byCategory(tasks: TaskRecord[]): TaskSubset[] {
  return group(
    tasks,
    (t) => (t.category ?? t.tags?.[0]) || UNCATEGORIZED,
    (label) => `tasks share category "${label}"`,
  );
}

/**
 * Partition by the first tool a task exercises.
 *
 * @param tasks - Tasks to partition
 * @returns Partition
 */
function byTool(tasks: TaskRecord[]): TaskSubset[] {
  return group(
    tasks,
    (t) => t.tools?.[0] || 'no-tool',
    (label) => `tasks exercise tool "${label}"`,
  );
}

/**
 * Failure-mode label of one task: `passing`, `undiagnosed`, or `<DiagnosisKind>:<failed criterion kinds>`.
 *
 * @param task - Task to label
 * @param ctx - Split context
 * @returns Failure-mode label
 */
function failureModeOf(task: TaskRecord, ctx: SplitContext): string {
  const feedback = ctx.feedback?.[task.id];
  if (feedback?.allPass) return 'passing';
  const diagnosis = ctx.diagnoses?.[task.id];
  if (!feedback || !diagnosis) return 'undiagnosed';
  const kinds = new Set<string>();
  for (const criterion of feedback.criteria) {
    if (criterion.pass) continue;
    kinds.add(task.rubric.find((c) => c.id === criterion.criterionId)?.kind ?? 'unknown');
  }
  const sorted = [...kinds].sort(compareStrings);
  return `${diagnosis.kind}:${sorted.length > 0 ? sorted.join('+') : 'none'}`;
}

/**
 * Partition by failure mode: failed tasks cluster by diagnosis kind and failed criterion kinds.
 *
 * @param tasks - Tasks to partition
 * @param ctx - Split context
 * @returns Partition
 */
function byFailureMode(tasks: TaskRecord[], ctx: SplitContext): TaskSubset[] {
  return group(
    tasks,
    (t) => failureModeOf(t, ctx),
    (label) => (label === 'passing' ? 'tasks already pass' : `failure mode "${label}"`),
  );
}

/**
 * Resolve the top skill id of every task, in input order, once per call.
 *
 * @param tasks - Tasks to match
 * @param ctx - Split context
 * @returns Skill id or `undefined` per task, aligned with `tasks`
 */
async function resolveSkills(tasks: TaskRecord[], ctx: SplitContext): Promise<Array<string | undefined>> {
  const out: Array<string | undefined> = [];
  for (const task of tasks) {
    const found = ctx.skillMatch ? await ctx.skillMatch(task) : undefined;
    out.push(found ? found : undefined);
  }
  return out;
}

/**
 * Partition by top skill id (`no-skill` when no skill matches). The skill ids are resolved
 * by the caller so `auto` can reuse them.
 *
 * @param tasks - Tasks to partition
 * @param skills - Resolved skill ids aligned with `tasks`
 * @returns Partition
 */
function bySkill(tasks: TaskRecord[], skills: Array<string | undefined>): TaskSubset[] {
  const labelById = new Map<string, string>();
  tasks.forEach((t, i) => labelById.set(t.id, skills[i] ?? 'no-skill'));
  return group(
    tasks,
    (t) => labelById.get(t.id) ?? 'no-skill',
    (label) => (label === 'no-skill' ? 'no skill matches' : `top skill "${label}"`),
  );
}

/**
 * Number of skill ids that appear among the top skills of more than one subset.
 *
 * @param partition - Partition to inspect
 * @param skills - Resolved skill ids aligned with the partition's source tasks
 * @param tasks - Source tasks in input order
 * @returns Shared-skill count
 */
function sharedSkillCount(
  partition: TaskSubset[],
  skills: Array<string | undefined>,
  tasks: TaskRecord[],
): number {
  const skillOfTask = new Map<string, string>();
  tasks.forEach((t, i) => {
    const s = skills[i];
    if (s) skillOfTask.set(t.id, s);
  });
  const subsetsPerSkill = new Map<string, Set<number>>();
  partition.forEach((subset, index) => {
    for (const id of subset.taskIds) {
      const s = skillOfTask.get(id);
      if (!s) continue;
      const set = subsetsPerSkill.get(s) ?? new Set<number>();
      set.add(index);
      subsetsPerSkill.set(s, set);
    }
  });
  let shared = 0;
  for (const set of subsetsPerSkill.values()) {
    if (set.size > 1) shared += 1;
  }
  return shared;
}

/**
 * Check that `subsets` is a partition of `tasks`: every task id appears exactly once, no subset
 * is empty, and no id appears that is not a task.
 *
 * @param tasks - Source tasks
 * @param subsets - Candidate partition
 * @returns True when the subsets partition the tasks
 */
export function isPartition(tasks: TaskRecord[], subsets: TaskSubset[]): boolean {
  const expected = new Set(tasks.map((t) => t.id));
  if (expected.size !== tasks.length) return false;
  const seen = new Set<string>();
  for (const subset of subsets) {
    if (subset.taskIds.length === 0) return false;
    for (const id of subset.taskIds) {
      if (!expected.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return seen.size === expected.size;
}

/**
 * Pick the `auto` winner. Lowest `max(size) * k` wins (equivalent to `max/mean` for a fixed
 * task count); a single-subset partition ranks last; ties go to fewer shared skills, then to the
 * strategy of a `prefer-split:<name>` insight,
 * then to the fixed order byCategory, byFailureMode, bySkill, byTool.
 *
 * @param candidates - Evaluated candidates keyed by strategy
 * @param ctx - Split context
 * @returns Name of the chosen strategy
 */
function pickAuto(
  candidates: Map<Exclude<SplitStrategyName, 'auto'>, { partition: TaskSubset[]; shared: number }>,
  ctx: SplitContext,
): Exclude<SplitStrategyName, 'auto'> {
  const score = (name: Exclude<SplitStrategyName, 'auto'>): number => {
    const { partition } = candidates.get(name) ?? { partition: [] };
    const sizes = partition.map((s) => s.taskIds.length);
    if (partition.length < 2) return Number.POSITIVE_INFINITY;
    return Math.max(0, ...sizes) * partition.length;
  };
  const best = Math.min(...CONCRETE.map(score));
  let tied = CONCRETE.filter((name) => score(name) === best);
  const minShared = Math.min(...tied.map((n) => candidates.get(n)?.shared ?? 0));
  tied = tied.filter((n) => (candidates.get(n)?.shared ?? 0) === minShared);
  const wanted = preferredSplitOf(ctx.keyInsights);
  const preferred = tied.find((n) => n === wanted);
  return preferred ?? tied[0] ?? 'byCategory';
}

/**
 * Partition tasks with a named strategy.
 *
 * @param name - Strategy name; `auto` picks the most balanced of the four concrete strategies
 * @param tasks - Tasks to partition
 * @param ctx - Optional evidence for failure-mode, skill and insight-based choices
 * @returns A partition of `tasks` (empty when `tasks` is empty)
 * @throws Error when two tasks share an identifier
 */
export async function split(
  name: SplitStrategyName,
  tasks: TaskRecord[],
  ctx: SplitContext = {},
): Promise<TaskSubset[]> {
  assertUniqueIds(tasks);
  if (tasks.length === 0) return [];
  const needsSkills = name === 'bySkill' || name === 'auto';
  const skills = needsSkills ? await resolveSkills(tasks, ctx) : [];

  const build = (strategy: Exclude<SplitStrategyName, 'auto'>): TaskSubset[] =>
    buildRaw(strategy).map((subset) => ({ ...subset, strategy }));
  const buildRaw = (strategy: Exclude<SplitStrategyName, 'auto'>): TaskSubset[] => {
    switch (strategy) {
      case 'byCategory':
        return byCategory(tasks);
      case 'byFailureMode':
        return byFailureMode(tasks, ctx);
      case 'bySkill':
        return bySkill(tasks, skills);
      case 'byTool':
        return byTool(tasks);
    }
  };

  if (name !== 'auto') return build(name);

  const candidates = new Map<Exclude<SplitStrategyName, 'auto'>, { partition: TaskSubset[]; shared: number }>();
  for (const strategy of CONCRETE) {
    const partition = build(strategy);
    candidates.set(strategy, { partition, shared: sharedSkillCount(partition, skills, tasks) });
  }
  const chosen = pickAuto(candidates, ctx);
  return candidates.get(chosen)?.partition ?? build('byCategory');
}
