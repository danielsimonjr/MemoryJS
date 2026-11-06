/**
 * Skill-record helpers shared by `SkillManager` and the knowledge-revision
 * planner, so a skill written by either path carries the same `contentHash`,
 * observations and id shape (spec RS-2).
 *
 * @module agent/skills/skillRecordUtils
 * @experimental
 */

import { createHash, randomUUID } from 'crypto';
import type { SkillId, SkillKind, SkillRecord } from '../../types/skills.js';
import { ENGLISH_STOPWORDS_SMALL, jaccard, tokenSetWithoutStopwords } from '../../utils/textSimilarity.js';

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

/** One lexical skill match: the skill, its Jaccard score and the shared tokens. */
export interface LexicalSkillMatch {
  /** Matched skill. */
  skill: SkillRecord;
  /** Jaccard score in [0, 1]. */
  score: number;
  /** Tokens shared by the hint and the skill's searchable text, sorted. */
  matched: string[];
}

/**
 * Stopword-free token set used by skill matching.
 *
 * @param text - Text to tokenize.
 * @returns Distinct tokens.
 */
export function skillTokenSet(text: string): Set<string> {
  return tokenSetWithoutStopwords(text, ENGLISH_STOPWORDS_SMALL, 2);
}

/**
 * Searchable text of a skill: description, scope domains and scope tasks.
 *
 * @param skill - Skill record.
 * @returns Text the matcher scores against.
 */
export function skillSearchableText(skill: SkillRecord): string {
  return [skill.description, ...skill.scope.domains, ...(skill.scope.tasks ?? [])].join(' ');
}

/**
 * Order matches by score (descending), then `helped - hurt` (descending), then id.
 *
 * @param a - First match.
 * @param b - Second match.
 * @returns Negative, zero or positive.
 */
export function compareSkillMatches(a: LexicalSkillMatch, b: LexicalSkillMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  const netA = a.skill.stats.helped - a.skill.stats.hurt;
  const netB = b.skill.stats.helped - b.skill.stats.hurt;
  if (netB !== netA) return netB - netA;
  return a.skill.id < b.skill.id ? -1 : a.skill.id > b.skill.id ? 1 : 0;
}

/**
 * Pure lexical ranking shared by `SkillManager.match` (without its semantic blend) and the
 * validation scratch copy of `K`: Jaccard of stopword-free tokens over
 * {@link skillSearchableText}, retired skills skipped, scores below `minScore` dropped.
 *
 * @param taskHint - Task hint text.
 * @param skills - Candidate skills.
 * @param options - `limit` (default 5) and `minScore` (default 0.1).
 * @returns Matches, best first.
 */
export function rankSkillsLexically(
  taskHint: string,
  skills: readonly SkillRecord[],
  options: { limit?: number; minScore?: number } = {},
): LexicalSkillMatch[] {
  const limit = Math.max(0, Math.floor(options.limit ?? 5));
  const minScore = options.minScore ?? 0.1;
  const hintTokens = skillTokenSet(taskHint);
  if (hintTokens.size === 0) return [];
  const scored: LexicalSkillMatch[] = [];
  for (const skill of skills) {
    if (skill.retired !== undefined) continue;
    const skillTokens = skillTokenSet(skillSearchableText(skill));
    const score = jaccard(hintTokens, skillTokens);
    if (score < minScore) continue;
    scored.push({ skill, score, matched: [...hintTokens].filter((t) => skillTokens.has(t)).sort() });
  }
  return scored.sort(compareSkillMatches).slice(0, limit);
}
