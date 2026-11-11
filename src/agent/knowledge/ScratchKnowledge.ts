/**
 * In-memory scratch copy of `K` for validating a revision (Recursa RS-17).
 *
 * A `ScratchKnowledge` is seeded from the live instruction sets, skills and failure lookup,
 * applies revision ops to its own copies and renders knowledge with the same section order,
 * budget and markdown as `KnowledgeRepository.loadForContext`. It never reads or writes
 * storage after construction, so a rejected revision cannot leak into live `K`.
 *
 * Skill selection uses an injectable {@link SkillMatcher} over the scratch skills (the live
 * `SkillManager.match` only ranks stored skills, so a skill added by a revision would be invisible
 * to it). `KnowledgeRepository.cloneForValidation` passes the same lexical scorer the live
 * `SkillManager.match` uses (`rankSkillsLexically`), so scratch and live agree on which skills a
 * task sees. The semantic blend of the live matcher is not available in scratch.
 *
 * @module agent/knowledge/ScratchKnowledge
 * @experimental Part of the Recursa knowledge-repository work (spec RS-17).
 */

import type { InstructionSetRecord, RevisionOp, SkillId, SkillRecord } from '../../types/skills.js';
import { clone } from './knowledgeDigest.js';
import { safeApplyOp, workFrom } from './knowledgeRevision.js';
import { rankSkillsLexically } from '../skills/skillRecordUtils.js';
import {
  skillIdsForTaskIds,
  toLoadItems,
  packLoadedKnowledge,
  prepareLoad,
  loadSkillMatches,
} from './knowledgeLoad.js';
import type { FailureLookupLike, LoadedKnowledge, LoadForContextOptions, SkillMatchLike } from './KnowledgeRepository.js';

/** Maximum failures returned by one load, matching the live path. */
const LOOKUP_LIMIT = 5;

/** Items rendered by {@link ScratchKnowledge.loadForContext}, in priority order. */
export type { LoadItem } from './knowledgeLoad.js';

/** Live payload a scratch copy is seeded from. */
export interface ScratchPayload {
  /** Instruction sets. */
  instructionSets: InstructionSetRecord[];
  /** Skills, retired ones included. */
  skills: SkillRecord[];
}

/** Result of {@link ScratchKnowledge.apply}. */
export type ScratchApplyResult = { ok: true } | { ok: false; failedOpIndex: number; reason: string };

/** Ranks skills for a task hint; returns at most `limit` skills, best first. */
export type SkillMatcher = (query: string, skills: SkillRecord[], limit: number) => SkillRecord[];

/** Options for {@link ScratchKnowledge}. */
export interface ScratchOptions {
  /** Skill matcher (default: the shared lexical scorer `rankSkillsLexically`). */
  matcher?: SkillMatcher;
}

/** Default matcher: the lexical scorer shared with `SkillManager.match`. */
const defaultMatcher: SkillMatcher = (query, skills, limit) => rankSkillsLexically(query, skills, { limit }).map((m) => m.skill);

/**
 * Markdown for `loadForContext`: groups in fixed order (instructions, skills, failure lessons),
 * items in priority order. Shared by the live repository and the scratch copy.
 *
 * @param role - Role whose instructions are rendered.
 * @param items - Items already selected by the budget.
 * @returns Markdown text.
 */
export { renderLoadedKnowledge } from './knowledgeLoad.js';

/**
 * Mutable, storage-free copy of `K` used to validate a revision.
 *
 * @example
 * ```ts
 * const scratch = await repo.cloneForValidation();
 * const applied = scratch.apply(revision.ops);
 * if (applied.ok) await scratch.loadForContext({ role: 'solver', taskHint: task.input });
 * ```
 */
export class ScratchKnowledge {
  private sets: InstructionSetRecord[];
  private skills: SkillRecord[];
  private readonly failures: FailureLookupLike;
  private readonly matcher: SkillMatcher;

  /**
   * Seed a scratch copy. Records are cloned, so later changes to the payload do not reach it.
   *
   * @param payload - Live instruction sets and skills.
   * @param failures - Failure lookup (not changed by revision ops, so shared as-is).
   * @param options - Optional skill matcher.
   */
  constructor(payload: ScratchPayload, failures: FailureLookupLike, options: ScratchOptions = {}) {
    this.sets = clone(payload.instructionSets);
    this.skills = clone(payload.skills);
    this.failures = failures;
    this.matcher = options.matcher ?? defaultMatcher;
  }

  /**
   * Apply revision ops to this copy, in order, all-or-nothing. A rejected op leaves the copy
   * unchanged. Nothing is written to storage.
   *
   * @param ops - Revision ops.
   * @returns `{ ok: true }`, or the index and reason of the first rejected op.
   */
  apply(ops: readonly RevisionOp[]): ScratchApplyResult {
    const work = workFrom({ instructionSets: this.sets, skills: this.skills });
    const now = new Date().toISOString();
    for (let i = 0; i < ops.length; i++) {
      const reason = safeApplyOp(ops[i]!, work, now, i);
      if (reason !== undefined) return { ok: false, failedOpIndex: i, reason };
    }
    this.sets = [...work.sets.values()];
    this.skills = [...work.skills.values()];
    return { ok: true };
  }

  /**
   * Live scratch skills learned for the given tasks (`scope.tasks` contains `task:<id>`).
   *
   * @param taskIds - Task ids.
   * @returns Skill ids, at most 50.
   */
  async skillIdsForTasks(taskIds: readonly string[]): Promise<SkillId[]> {
    return skillIdsForTaskIds(this.skills, taskIds);
  }

  /**
   * Render knowledge for a task from this copy, with the same budget rule and section order as
   * `KnowledgeRepository.loadForContext`. Skills are ranked by the injected {@link SkillMatcher}.
   *
   * @param options - Role, task hint, budget and sections.
   * @returns Markdown plus the ids that made it in.
   * @throws RangeError when `budgetTokens` is negative or not finite.
   */
  async loadForContext(options: LoadForContextOptions): Promise<LoadedKnowledge> {
    const setup = prepareLoad(options, 'ScratchKnowledge.loadForContext', this.sets);
    const live = this.skills.filter((skill) => skill.retired === undefined);
    const byId = new Map(live.map((skill) => [skill.id as string, skill] as const));
    const included = (options.includeSkillIds ?? []).flatMap((id) => byId.get(id) ?? []);
    const matches: SkillMatchLike[] = setup.want.has('skills')
      ? loadSkillMatches(included, this.matcher(options.taskHint, live, setup.maxSkills), setup.maxSkills)
      : [];
    const failures = setup.want.has('failures') ? await this.failures.lookupForTask(options.taskHint, { limit: LOOKUP_LIMIT }) : [];
    return packLoadedKnowledge(options.role, toLoadItems(setup.instructions, matches, failures), setup.budget, setup.multiplier);
  }
}
