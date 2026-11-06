/**
 * Canonical JSON, digest and budget helpers shared by the Recursa knowledge
 * repository (`KnowledgeRepository`) and the instruction-set manager.
 *
 * Canonical form: object keys sorted, `undefined` members dropped, and any
 * array whose elements are all objects carrying a string `id` sorted by that
 * id. Other arrays keep their order (section order is meaningful).
 *
 * @module agent/knowledge/knowledgeDigest
 * @experimental Part of the Recursa knowledge-repository work (spec RS-4, RS-5).
 */

import { randomUUID } from 'crypto';
import { canonicalJson, sha256Hex } from '../procedural/graph/canonical.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import type {
  InstructionSetRecord,
  KnowledgeSnapshotRecord,
  SkillId,
  SkillRecord,
} from '../../types/skills.js';

/** Compare two strings by UTF-16 code unit (locale-independent). */
export function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hasStringId(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalValue);
    if (items.length > 0 && items.every(hasStringId)) {
      return [...items].sort((x, y) => compareIds((x as { id: string }).id, (y as { id: string }).id));
    }
    return items;
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareIds)) {
      const member = source[key];
      if (member === undefined) continue;
      out[key] = canonicalValue(member);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON string of `value` (sorted keys, id-sorted record arrays).
 * Two values that differ only in key order or record order serialise identically.
 */
export function canonicalKnowledgeJson(value: unknown): string {
  // Reuses the Procedural Graph canonical serialiser (sorted keys); the
  // knowledge-specific step is the id-sort of record arrays done first.
  return canonicalJson(canonicalValue(value));
}

/** Deep copy of a JSON-compatible value (records hold no Dates or functions). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Lower-case hex SHA-256 of a UTF-8 string (re-exported from the shared canonical module). */
export { sha256Hex };

/** SHA-256 digest of the canonical JSON of a knowledge payload. */
export function digestOf(payload: unknown): string {
  return sha256Hex(canonicalKnowledgeJson(payload));
}

/** Lower-case ASCII slug (at most 40 characters, never empty). */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'item';
}

/** Eight hex characters drawn from a random UUID. */
export function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Keep the longest prefix of `items` whose rendering stays within the budget.
 * Stops at the first item that would overflow, so earlier items (higher
 * priority) are never displaced by later ones.
 *
 * @param items - Candidates in priority order.
 * @param render - Renders a candidate prefix to the text that is measured.
 * @param budgetTokens - Maximum estimated tokens.
 * @param multiplier - Tokens per word, passed to `estimateTokensFromText`.
 * @returns The kept prefix (a fresh array).
 */
export function fitInOrder<T>(
  items: readonly T[],
  render: (kept: readonly T[]) => string,
  budgetTokens: number,
  multiplier: number,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const candidate = [...kept, item];
    if (estimateTokensFromText(render(candidate), multiplier) > budgetTokens) break;
    kept.push(item);
  }
  return kept;
}

/**
 * Validate a token budget.
 *
 * @param budget - Requested budget.
 * @param where - Method name for the error message.
 * @returns `budget` when it is a finite number >= 0.
 * @throws RangeError otherwise.
 */
export function assertBudgetTokens(budget: number, where: string): number {
  if (!Number.isFinite(budget) || budget < 0) throw new RangeError(`${where}: budgetTokens must be a finite number >= 0`);
  return budget;
}

/** Added and removed identifiers between two sets (`removed` is the mirror of `added`). */
export interface IdDelta {
  /** Present in the target, absent from the source. */
  added: string[];
  /** Present in the source, absent from the target. */
  removed: string[];
}

/**
 * Difference between two knowledge snapshots, read as "source a to target b".
 * `diffSnapshots(b, a)` is the exact mirror: every `added` becomes `removed`,
 * and every `retired` becomes `restored`. `updated` and `changed` are symmetric.
 */
export interface KnowledgeDiff {
  /** Skill-level changes (ids). */
  skills: {
    /** Skill live in the target only. */
    added: SkillId[];
    /** Skill live in the source only. */
    removed: SkillId[];
    /** Live in both, content differs (ignoring retirement and `lastUpdatedAt`). */
    updated: SkillId[];
    /** Live in the source, retired in the target. */
    retired: SkillId[];
    /** Retired in the source, live in the target. */
    restored: SkillId[];
  };
  /** Instruction-section changes, keyed `<setId>#<heading>`. */
  sections: { added: string[]; removed: string[]; changed: string[] };
  /** Instruction-set membership changes (ids). */
  instructionSets: IdDelta;
  /** Changes to the non-skill memory references. */
  memoryRefs: { heuristicIds: IdDelta; failureIds: IdDelta; reflectionIds: IdDelta };
}

function sortedIds(values: Iterable<string>): string[] {
  return [...values].sort(compareIds);
}

/** Ids in `to` but not `from` (`added`) and in `from` but not `to` (`removed`). */
export function idDelta(from: readonly string[], to: readonly string[]): IdDelta {
  const source = new Set(from);
  const target = new Set(to);
  return {
    added: sortedIds([...target].filter((id) => !source.has(id))),
    removed: sortedIds([...source].filter((id) => !target.has(id))),
  };
}

/** Canonical form of a skill for change detection (retirement and timestamp excluded). */
function skillContent(skill: SkillRecord): string {
  return canonicalKnowledgeJson({ ...skill, lastUpdatedAt: undefined, retired: undefined });
}

function sectionMap(sets: readonly InstructionSetRecord[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const set of sets) {
    for (const section of set.sections) out.set(`${set.id}#${section.heading}`, canonicalKnowledgeJson(section));
  }
  return out;
}

/**
 * Compare two snapshot payloads. Pure: no storage access.
 *
 * @param a - Source snapshot record.
 * @param b - Target snapshot record.
 * @returns The change set from `a` to `b`.
 */
export function diffSnapshots(a: KnowledgeSnapshotRecord, b: KnowledgeSnapshotRecord): KnowledgeDiff {
  const aSkills = new Map(a.skills.map((skill) => [skill.id, skill] as const));
  const bSkills = new Map(b.skills.map((skill) => [skill.id, skill] as const));
  const skillDiff: KnowledgeDiff['skills'] = { added: [], removed: [], updated: [], retired: [], restored: [] };
  for (const [id, after] of bSkills) {
    const before = aSkills.get(id);
    if (!before) {
      skillDiff.added.push(id);
    } else if (!before.retired && after.retired) {
      skillDiff.retired.push(id);
    } else if (before.retired && !after.retired) {
      skillDiff.restored.push(id);
    } else if (skillContent(before) !== skillContent(after)) {
      skillDiff.updated.push(id);
    }
  }
  for (const id of aSkills.keys()) if (!bSkills.has(id)) skillDiff.removed.push(id);

  const aSections = sectionMap(a.instructionSets);
  const bSections = sectionMap(b.instructionSets);
  const sectionDiff: KnowledgeDiff['sections'] = { added: [], removed: [], changed: [] };
  for (const [key, content] of bSections) {
    const before = aSections.get(key);
    if (before === undefined) sectionDiff.added.push(key);
    else if (before !== content) sectionDiff.changed.push(key);
  }
  for (const key of aSections.keys()) if (!bSections.has(key)) sectionDiff.removed.push(key);

  return {
    skills: {
      added: sortedIds(skillDiff.added) as SkillId[],
      removed: sortedIds(skillDiff.removed) as SkillId[],
      updated: sortedIds(skillDiff.updated) as SkillId[],
      retired: sortedIds(skillDiff.retired) as SkillId[],
      restored: sortedIds(skillDiff.restored) as SkillId[],
    },
    sections: {
      added: sortedIds(sectionDiff.added),
      removed: sortedIds(sectionDiff.removed),
      changed: sortedIds(sectionDiff.changed),
    },
    instructionSets: idDelta(
      a.instructionSets.map((set) => set.id),
      b.instructionSets.map((set) => set.id),
    ),
    memoryRefs: {
      heuristicIds: idDelta(a.memoryRefs.heuristicIds, b.memoryRefs.heuristicIds),
      failureIds: idDelta(a.memoryRefs.failureIds, b.memoryRefs.failureIds),
      reflectionIds: idDelta(a.memoryRefs.reflectionIds, b.memoryRefs.reflectionIds),
    },
  };
}
