/**
 * Step 3 of the revision merger (spec RS-20, §3.7 B2): generalize `skill.add` ops from two or
 * more children into one skill.
 *
 * Two adds are grouped only when their `kind` matches, their `scope.domains` overlap AND their
 * descriptions have token Jaccard >= {@link GENERALIZE_DESCRIPTION_JACCARD}. The merged skill keeps
 * what made each member loadable: its description is the deduplicated union of the member
 * descriptions (at most 400 characters) and `scope.tasks` is the union of the members' tasks. Its
 * name is `Merged <kind>: <first 3 keywords> <6-hex hash of the member ids>`, unique per group.
 * Domains are the union of the children's evidence domains, falling back to the members' skill
 * domains; a group whose domains would still be empty is not generalized.
 *
 * @module agent/learning/RevisionGeneralize
 * @internal
 */

import { createHash } from 'crypto';
import type { RevisionOp, SkillSource } from '../../types/skills.js';
import { ENGLISH_STOPWORDS_SMALL, jaccard, tokenSetWithoutStopwords } from '../../utils/textSimilarity.js';
import { escapeHeadings, escapeProse, fencedText, inlineSafe } from './llmJson.js';
import { BodySchema, NAME_MAX_CHARS, labelOfEntry, union, type CallJson, type ChildOutcome, type Entry, type RevisionMergeResult } from './revisionMergeShared.js';
import type { MergePlan } from './RevisionReconcile.js';

/** Minimum description token Jaccard for two adds to be generalized together. */
export const GENERALIZE_DESCRIPTION_JACCARD = 0.5;
/** Maximum characters of a merged description. */
const DESCRIPTION_MAX_CHARS = 400;

type AddEntry = Entry & { op: Extract<RevisionOp, { op: 'skill.add' }> };

/**
 * Description tokens used by the generalize rule.
 *
 * @param text - Description
 * @returns Token set
 */
function descTokens(text: string): Set<string> {
  return tokenSetWithoutStopwords(text, ENGLISH_STOPWORDS_SMALL, 2);
}

/**
 * Whether two adds may be generalized together.
 *
 * @param a - First add
 * @param b - Second add
 * @returns True when kind matches, domains overlap and descriptions are similar
 */
export function canGeneralize(a: AddEntry['op']['skill'], b: AddEntry['op']['skill']): boolean {
  if (a.kind !== b.kind) return false;
  if (!a.scope.domains.some((d) => b.scope.domains.includes(d))) return false;
  return jaccard(descTokens(a.description), descTokens(b.description)) >= GENERALIZE_DESCRIPTION_JACCARD;
}

/**
 * Group adds (union-find over {@link canGeneralize}) and replace each multi-child group with one add.
 *
 * @param entries - Flattened ops
 * @param children - Child outcomes
 * @param plan - Merge plan (mutated)
 * @param callJson - Validated LLM call, when an LLM is configured
 * @param signal - Optional abort signal
 * @returns Generalized groups
 */
export async function generalizeAdds(
  entries: Entry[],
  children: ChildOutcome[],
  plan: MergePlan,
  callJson: CallJson | undefined,
  signal?: AbortSignal,
): Promise<RevisionMergeResult['generalized']> {
  const adds = entries.filter((e): e is AddEntry => e.op.op === 'skill.add' && !plan.dropped.has(e.index));
  const parent = adds.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    parent[i] = r;
    return r;
  };
  for (let i = 0; i < adds.length; i++) {
    for (let j = i + 1; j < adds.length; j++) {
      if (canGeneralize(adds[i]!.op.skill, adds[j]!.op.skill)) parent[find(i)] = find(j);
    }
  }
  const components = new Map<number, AddEntry[]>();
  adds.forEach((a, i) => components.set(find(i), [...(components.get(find(i)) ?? []), a]));
  const labelOf = (e: Entry): string => labelOfEntry(children, e);
  const out: RevisionMergeResult['generalized'] = [];
  for (const members of components.values()) {
    if (new Set(members.map((m) => m.child)).size < 2) continue;
    const from = [...new Set(members.map(labelOf))];
    let domains = union(...members.map((m) => children[m.child]?.evidenceDomains));
    if (domains.length === 0) domains = union(...members.map((m) => m.op.skill.scope.domains));
    if (domains.length === 0) {
      plan.notes.push(`[not-generalized] ${from.join(', ')}: no domains`);
      continue;
    }
    const merged = await mergedAdd(members, domains, labelOf, callJson, signal);
    plan.replaced.set(members[0]!.index, merged);
    for (const m of members.slice(1)) plan.dropped.add(m.index);
    out.push({ kind: merged.skill.kind, from, domains });
    plan.notes.push(`[generalized] ${merged.skill.kind} from ${from.join(', ')} over domains ${domains.join(', ')}`);
  }
  return out;
}

/**
 * The merged `skill.add` of one group.
 *
 * @param members - Contributing adds
 * @param domains - Merged domains (non-empty)
 * @param labelOf - Child label lookup
 * @param callJson - Validated LLM call, when configured
 * @param signal - Optional abort signal
 * @returns The merged op
 */
async function mergedAdd(
  members: AddEntry[],
  domains: string[],
  labelOf: (e: Entry) => string,
  callJson: CallJson | undefined,
  signal?: AbortSignal,
): Promise<Extract<RevisionOp, { op: 'skill.add' }>> {
  const kind = members[0]!.op.skill.kind;
  const descriptions = union(members.map((m) => m.op.skill.description.trim()).filter((d) => d.length > 0));
  const description = inlineSafe(descriptions.join('; '), DESCRIPTION_MAX_CHARS) || 'Apply when the merged evidence applies';
  const keywords = [...descTokens(descriptions.join(' '))].slice(0, 3).join(' ');
  const hash = createHash('sha256')
    .update(members.map((m) => `${m.child}:${m.index}:${m.op.skill.name}`).sort().join('\0'))
    .digest('hex')
    .slice(0, 6);
  const sources: SkillSource[] = [];
  for (const m of members) {
    for (const s of m.op.skill.sources) if (!sources.some((x) => x.ref === s.ref && x.kind === s.kind)) sources.push(s);
  }
  const tasks = union(...members.map((m) => m.op.skill.scope.tasks));
  const tools = union(...members.map((m) => m.op.skill.scope.tools));
  const learned = union(...members.map((m) => m.op.skill.lineage.learnedFromTaskIds));
  return {
    op: 'skill.add',
    skill: {
      name: inlineSafe(`Merged ${kind}: ${keywords} ${hash}`.replace(/\s+/g, ' '), NAME_MAX_CHARS),
      description,
      kind,
      scope: { domains, ...(tasks.length > 0 ? { tasks } : {}), ...(tools.length > 0 ? { tools } : {}) },
      uncertainty: Math.max(...members.map((m) => m.op.skill.uncertainty)),
      body: await generalizeBody(members, labelOf, callJson, signal),
      resources: [],
      sources,
      lineage: { producedBy: 'merge', ...(learned.length > 0 ? { learnedFromTaskIds: learned } : {}) },
    },
  };
}

/**
 * Body of a generalized skill: LLM output when valid, otherwise per-child sections. Child bodies
 * have line-start `#` escaped so they cannot forge headings of the merged skill.
 *
 * @param members - Contributing adds
 * @param labelOf - Child label lookup
 * @param callJson - Validated LLM call, when configured
 * @param signal - Optional abort signal
 * @returns Escaped Markdown body
 */
async function generalizeBody(
  members: AddEntry[],
  labelOf: (e: Entry) => string,
  callJson: CallJson | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (callJson) {
    const prompt = [
      'Generalize the guidance from several learners into one skill body in Markdown.',
      'Use only the evidence below. Return ONLY JSON: {"body": "<markdown>"}',
      ...members.map((m) => `From ${inlineSafe(labelOf(m), 80)}:\n${fencedText(m.op.skill.body)}`),
    ].join('\n\n');
    const parsed = await callJson(prompt, BodySchema, signal);
    if (parsed) return escapeProse(parsed.body);
  }
  return members
    .map((m) => `## From ${inlineSafe(labelOf(m), 80)}\n\n${escapeHeadings(escapeProse(m.op.skill.body))}`)
    .join('\n\n');
}
