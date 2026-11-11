/**
 * Skill selection shared by `KnowledgeRepository.loadForContext` and
 * `ScratchKnowledge.loadForContext`: included skills first, then lexical matches,
 * capped at `maxSkills` (the token budget still bounds the output).
 *
 * Loadability contract (spec §3.4, D1/D2): a learned skill carries `task:<id>` in
 * `scope.tasks`; loaders given `includeSkillIds` load those skills regardless of
 * their lexical score.
 *
 * @module agent/knowledge/knowledgeLoad
 * @internal
 */

import type { Entity } from '../../types/types.js';
import type { FailureRecord } from '../../types/agent-memory.js';
import type {
  InstructionSetRecord,
  InstructionSetRole,
  KnowledgeSnapshotEntity,
  KnowledgeSnapshotRecord,
  SkillId,
  SkillRecord,
} from '../../types/skills.js';
import {
  isFailureMemory,
  isHeuristicMemory,
  isInstructionSetEntity,
  isKnowledgeSnapshotEntity,
  isReflectionMemory,
  isSkillEntity,
} from '../../types/agent-memory.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import { readEnvNumber } from '../../utils/envConfig.js';
import { instructionItemsFor, renderInstructionItems, type InstructionItem } from './InstructionSetManager.js';
import { assertBudgetTokens, fitInOrder } from './knowledgeDigest.js';
import { compareIds } from './knowledgeDigest.js';
import type { LoadedKnowledge, LoadForContextOptions, SkillMatchLike } from './KnowledgeRepository.js';

/** One candidate item in load priority order (instructions, then skills, then failures). */
export type LoadItem =
  | { kind: 'instruction'; item: InstructionItem }
  | { kind: 'skill'; match: SkillMatchLike }
  | { kind: 'failure'; failure: FailureRecord };

/** Default maximum skills one load considers. */
export const DEFAULT_MAX_SKILLS = 20;
/** Maximum included skill ids derived for one batch of tasks. */
export const MAX_TASK_SKILLS = 50;

/**
 * Live skills whose `scope.tasks` names one of the tasks as `task:<id>`.
 *
 * @param skills - Candidate skills.
 * @param taskIds - Task ids.
 * @returns Skill ids, at most {@link MAX_TASK_SKILLS}.
 */
export function skillIdsForTaskIds(skills: readonly SkillRecord[], taskIds: readonly string[]): SkillId[] {
  const refs = new Set(taskIds.map((id) => `task:${id}`));
  if (refs.size === 0) return [];
  return skills
    .filter((s) => s.retired === undefined && (s.scope.tasks ?? []).some((t) => refs.has(t)))
    .map((s) => s.id)
    .slice(0, MAX_TASK_SKILLS);
}

/**
 * Validate and default `maxSkills`.
 *
 * @param maxSkills - Requested maximum.
 * @returns A non-negative integer.
 * @throws RangeError when the value is not a non-negative integer.
 */
export function resolveMaxSkills(maxSkills: number | undefined): number {
  const max = maxSkills ?? DEFAULT_MAX_SKILLS;
  if (!Number.isInteger(max) || max < 0) throw new RangeError('loadForContext: maxSkills must be an integer >= 0');
  return max;
}

/**
 * Markdown rendering of a load candidate list: one `##` group per section, in order.
 *
 * @param role - Role the instructions were selected for.
 * @param items - Items to render, in priority order.
 * @returns Markdown text (empty string for no items).
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
 * Lay out instructions, matched skills and failure lessons as one candidate list, in that order. *
 * @param instructions - Instruction items for the role.
 * @param matches - Skill matches, best first.
 * @param failures - Failure lessons.
 * @returns Candidates in load priority order.
 */
export function toLoadItems(
  instructions: readonly InstructionItem[],
  matches: readonly SkillMatchLike[],
  failures: readonly FailureRecord[],
): LoadItem[] {
  return [
    ...instructions.map((item): LoadItem => ({ kind: 'instruction', item })),
    ...matches.map((match): LoadItem => ({ kind: 'skill', match })),
    ...failures.map((failure): LoadItem => ({ kind: 'failure', failure })),
  ];
}

/**
 * Trim a candidate list to the token budget and render it, collecting the ids that made it in. *
 * @param role - Role the instructions were selected for.
 * @param candidates - Candidates in load priority order.
 * @param budget - Token budget.
 * @param multiplier - Tokens per word, passed to the token estimate.
 * @returns Markdown plus the ids of the kept items.
 */
export function packLoadedKnowledge(
  role: InstructionSetRole,
  candidates: readonly LoadItem[],
  budget: number,
  multiplier: number,
): LoadedKnowledge {
  const render = (items: readonly LoadItem[]): string => renderLoadedKnowledge(role, items);
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

/**
 * Included skills (live, in the given order) followed by matched skills, deduplicated, at most `max`.
 *
 * @param included - Skills that must be loaded.
 * @param matched - Lexically matched skills, best first.
 * @param max - Maximum skills.
 * @returns Selected skills.
 */
export function selectSkills(included: readonly SkillRecord[], matched: readonly SkillRecord[], max: number): SkillRecord[] {
  const out: SkillRecord[] = [];
  const seen = new Set<string>();
  for (const skill of [...included, ...matched]) {
    if (out.length >= max) break;
    if (skill.retired !== undefined || seen.has(skill.id)) continue;
    seen.add(skill.id);
    out.push(skill);
  }
  return out;
}

// ==================== Entity payload helpers (KnowledgeRepository) ====================

/**
 * Snapshot entity with the given id.
 *
 * @param entities - Graph entities.
 * @param id - Snapshot id (`K-<n>`).
 * @returns The snapshot entity, or `undefined`.
 */
export function findSnapshot(entities: readonly Entity[], id: string): KnowledgeSnapshotEntity | undefined {
  return entities.find((e) => e.name === id && isKnowledgeSnapshotEntity(e)) as KnowledgeSnapshotEntity | undefined;
}

/**
 * Id of the highest-numbered `K-<n>` snapshot.
 *
 * @param entities - Graph entities.
 * @returns The id, or `''` when there is none.
 */
export function latestSnapshotId(entities: readonly Entity[]): string {
  let best = '';
  let bestN = -1;
  for (const entity of entities) {
    const match = /^K-(\d+)$/.exec(entity.name);
    if (!match || !isKnowledgeSnapshotEntity(entity)) continue;
    const n = Number(match[1]);
    if (n > bestN) [bestN, best] = [n, entity.name];
  }
  return best;
}

/**
 * Instruction sets and skills of the graph (the snapshot payload).
 *
 * @param entities - Graph entities.
 * @returns The payload.
 */
export function payloadOf(entities: readonly Entity[]): {
  instructionSets: InstructionSetRecord[];
  skills: SkillRecord[];
} {
  return {
    instructionSets: entities.filter(isInstructionSetEntity).map((e) => e.instructionSetRecord),
    skills: entities.filter(isSkillEntity).map((e) => e.skillRecord),
  };
}

/**
 * Sorted ids of heuristics, failures and reflections (snapshot `memoryRefs`).
 *
 * @param entities - Graph entities.
 * @returns The refs.
 */
export function memoryRefsOf(entities: readonly Entity[]): KnowledgeSnapshotRecord['memoryRefs'] {
  const ids = (guard: (e: unknown) => boolean, pick: (e: Entity) => string): string[] =>
    entities.filter(guard).map(pick).sort(compareIds);
  return {
    heuristicIds: ids(isHeuristicMemory, (e) => (e as unknown as { heuristicRecord: { id: string } }).heuristicRecord.id),
    failureIds: ids(isFailureMemory, (e) => (e as unknown as { failureRecord: { id: string } }).failureRecord.id),
    reflectionIds: ids(isReflectionMemory, (e) => (e as unknown as { reflectionRecord: { id: string } }).reflectionRecord.id),
  };
}

/** Default token budget for a load. */
export const DEFAULT_BUDGET_TOKENS = 4000;

/** Sections a load includes by default. */
export const DEFAULT_LOAD_SECTIONS = ['instructions', 'skills', 'failures'] as const;

/** Resolved per-call settings shared by both `loadForContext` implementations. */
export interface LoadSetup {
  /** Token budget, already validated. */
  budget: number;
  /** Tokens per word, for the token estimate. */
  multiplier: number;
  /** Section set the caller asked for. */
  want: ReadonlySet<string>;
  /** Instruction items for the role (empty when instructions are not wanted). */
  instructions: InstructionItem[];
  /** Maximum skills to consider. */
  maxSkills: number;
}

/**
 * Read the per-call settings both loaders need: validate the budget, read the multiplier, resolve
 * the wanted sections and flatten the instruction items.
 *
 * The `where` label is passed to {@link assertBudgetTokens} unchanged, so the two loaders keep the
 * error text they had (`loadForContext` vs `ScratchKnowledge.loadForContext`).
 *
 * @param options - Load options.
 * @param where - Label for the budget error.
 * @param sets - Instruction sets to flatten (live list or scratch copy).
 * @returns The resolved setup.
 * @throws RangeError when the budget is negative or not finite.
 */
export function prepareLoad(
  options: LoadForContextOptions,
  where: string,
  sets: readonly InstructionSetRecord[],
): LoadSetup {
  const budget = assertBudgetTokens(options.budgetTokens ?? DEFAULT_BUDGET_TOKENS, where);
  const multiplier = options.multiplier ?? readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3);
  const want = new Set<string>(options.sections ?? DEFAULT_LOAD_SECTIONS);
  const instructions = want.has('instructions') ? instructionItemsFor(sets, options.role) : [];
  return { budget, multiplier, want, instructions, maxSkills: resolveMaxSkills(options.maxSkills) };
}

/**
 * Select the skills to load: the caller's included ids first, then the matcher's order, deduped
 * and capped, each wrapped in the `SkillMatchLike` shape the renderer expects.
 *
 * `candidates` is the matcher's ranking (already limited); `included` is resolved by the caller
 * because only it knows where live skills live.
 *
 * @param included - Skills the caller must load.
 * @param candidates - Matcher ranking, best first.
 * @param maxSkills - Maximum skills.
 * @returns Matches with zeroed score and no matched tokens (ordering already decided).
 */
export function loadSkillMatches(
  included: readonly SkillRecord[],
  candidates: readonly SkillRecord[],
  maxSkills: number,
): SkillMatchLike[] {
  return selectSkills(included, candidates, maxSkills).map((skill) => ({ skill, score: 0, matched: [] }));
}
