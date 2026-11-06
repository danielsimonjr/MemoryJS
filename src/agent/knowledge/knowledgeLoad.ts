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
import type { InstructionSetRecord, KnowledgeSnapshotEntity, KnowledgeSnapshotRecord, SkillId, SkillRecord } from '../../types/skills.js';
import {
  isFailureMemory,
  isHeuristicMemory,
  isInstructionSetEntity,
  isKnowledgeSnapshotEntity,
  isReflectionMemory,
  isSkillEntity,
} from '../../types/agent-memory.js';
import { compareIds } from './knowledgeDigest.js';

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
