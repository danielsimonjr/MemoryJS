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

import type { InstructionSetRecord, InstructionSetRole, RevisionOp, SkillRecord } from '../../types/skills.js';
import type { FailureRecord } from '../../types/agent-memory.js';
import { readEnvNumber } from '../../utils/envConfig.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import { instructionItemsFor, renderInstructionItems, type InstructionItem } from './InstructionSetManager.js';
import { assertBudgetTokens, clone, fitInOrder } from './knowledgeDigest.js';
import { safeApplyOp, workFrom } from './knowledgeRevision.js';
import { rankSkillsLexically } from '../skills/skillRecordUtils.js';
import type { FailureLookupLike, LoadedKnowledge, LoadForContextOptions, SkillMatchLike } from './KnowledgeRepository.js';

/** Default token budget, matching `KnowledgeRepository.loadForContext`. */
const DEFAULT_BUDGET_TOKENS = 4000;
/** Maximum skills and failures returned by one load, matching the live path. */
const LOOKUP_LIMIT = 5;

/** Items rendered by {@link ScratchKnowledge.loadForContext}, in priority order. */
export type LoadItem =
  | { kind: 'instruction'; item: InstructionItem }
  | { kind: 'skill'; match: SkillMatchLike }
  | { kind: 'failure'; failure: FailureRecord };

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
export function renderLoadedKnowledge(role: InstructionSetRole, items: readonly LoadItem[]): string {
  const groups: string[] = [];
  const instructions = items.flatMap((x) => (x.kind === 'instruction' ? [x.item] : []));
  if (instructions.length > 0) groups.push(`## Instructions (${role})\n\n${renderInstructionItems(instructions)}`);
  const skills = items.flatMap((x) => (x.kind === 'skill' ? [x.match.skill] : []));
  if (skills.length > 0) {
    const blocks = skills.map((skill) => {
      const refs = skill.sources.map((source) => source.ref).join(', ') || 'none';
      return `### ${skill.name} (uncertainty ${skill.uncertainty}, sources: ${refs})\n\n${skill.body}`;
    });
    groups.push(`## Skills\n\n${blocks.join('\n\n')}`);
  }
  const failures = items.flatMap((x) => (x.kind === 'failure' ? [x.failure] : []));
  if (failures.length > 0) {
    const lines = failures.map(
      (f) => `- ${f.failure_mode} → ${f.alternative_taken ?? f.root_cause} (applies when: ${f.applicability_hint})`,
    );
    groups.push(`## Failure lessons\n\n${lines.join('\n')}`);
  }
  return groups.join('\n\n');
}

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
   * Render knowledge for a task from this copy, with the same budget rule and section order as
   * `KnowledgeRepository.loadForContext`. Skills are ranked by the injected {@link SkillMatcher}.
   *
   * @param options - Role, task hint, budget and sections.
   * @returns Markdown plus the ids that made it in.
   * @throws RangeError when `budgetTokens` is negative or not finite.
   */
  async loadForContext(options: LoadForContextOptions): Promise<LoadedKnowledge> {
    const budget = assertBudgetTokens(options.budgetTokens ?? DEFAULT_BUDGET_TOKENS, 'ScratchKnowledge.loadForContext');
    const multiplier = options.multiplier ?? readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3);
    const want = new Set(options.sections ?? ['instructions', 'skills', 'failures']);
    const instructions = want.has('instructions') ? instructionItemsFor(this.sets, options.role) : [];
    const live = this.skills.filter((skill) => skill.retired === undefined);
    const matches: SkillMatchLike[] = want.has('skills')
      ? this.matcher(options.taskHint, live, LOOKUP_LIMIT).slice(0, LOOKUP_LIMIT).map((skill) => ({ skill, score: 0, matched: [] }))
      : [];
    const failures = want.has('failures') ? await this.failures.lookupForTask(options.taskHint, { limit: LOOKUP_LIMIT }) : [];
    const candidates: LoadItem[] = [
      ...instructions.map((item): LoadItem => ({ kind: 'instruction', item })),
      ...matches.map((match): LoadItem => ({ kind: 'skill', match })),
      ...failures.map((failure): LoadItem => ({ kind: 'failure', failure })),
    ];
    const render = (items: readonly LoadItem[]): string => renderLoadedKnowledge(options.role, items);
    const kept = fitInOrder(candidates, render, budget, multiplier);
    const markdown = render(kept);
    return {
      markdown,
      skillIds: kept.flatMap((x) => (x.kind === 'skill' ? [x.match.skill.id] : [])),
      instructionSetIds: [...new Set(kept.flatMap((x) => (x.kind === 'instruction' ? [x.item.setId] : [])))],
      failureIds: kept.flatMap((x) => (x.kind === 'failure' ? [x.failure.id] : [])),
      tokens: estimateTokensFromText(markdown, multiplier),
    };
  }
}
