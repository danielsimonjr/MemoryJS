/**
 * Skill-record helpers shared by `SkillManager` and the knowledge-revision
 * planner, so a skill written by either path carries the same `contentHash`,
 * observations and id shape (spec RS-2).
 *
 * @module agent/skills/skillRecordUtils
 * @internal
 */

import { createHash, randomUUID } from 'crypto';
import type { SkillId, SkillKind, SkillRecord } from '../../types/skills.js';

/** Accepted `SkillRecord.kind` values. */
export const SKILL_KIND_VALUES: readonly SkillKind[] = ['navigation', 'procedure', 'judgment', 'convention', 'tool'];

/**
 * Dedup hash of a skill: SHA-256 of `name + '\0' + body`. The separator keeps
 * `('ab', 'c')` and `('a', 'bc')` apart.
 *
 * @param name - Skill name.
 * @param body - Skill body.
 * @returns Lower-case hex digest.
 */
export function skillDedupHash(name: string, body: string): string {
  return createHash('sha256').update(`${name}\0${body}`, 'utf8').digest('hex');
}

/**
 * Mint a skill id `skill-<slug>-<8 hex>`.
 *
 * @param name - Skill name the slug is derived from.
 * @returns A fresh skill id.
 */
export function mintSkillId(name: string): SkillId {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'skill';
  return `skill-${slug}-${randomUUID().replace(/-/g, '').slice(0, 8)}` as SkillId;
}

/**
 * Searchable observations for a skill entity (name, kind, scope, description).
 *
 * @param record - Skill record.
 * @returns Observation strings.
 */
export function skillObservations(record: SkillRecord): string[] {
  const scope = [`domains=${record.scope.domains.join(',')}`];
  if (record.scope.tasks?.length) scope.push(`tasks=${record.scope.tasks.join(',')}`);
  if (record.scope.tools?.length) scope.push(`tools=${record.scope.tools.join(',')}`);
  return [
    `[skill-name]: ${record.name}`,
    `[kind]: ${record.kind}`,
    `[scope]: ${scope.join('; ')}`,
    `[description]: ${record.description}`,
  ];
}
