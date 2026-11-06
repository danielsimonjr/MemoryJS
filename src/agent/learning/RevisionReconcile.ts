/**
 * Step 2 of the revision merger (spec RS-20, §3.7 S7): reconcile `skill.update` /
 * `instruction.patch` ops that target the same section from different children.
 *
 * - A child's sequential patches to one target are folded into one op first (later fields win),
 *   so a child never conflicts with itself.
 * - `skill.update` patches from different children that touch disjoint fields are merged into one
 *   op, not treated as a conflict.
 * - Otherwise the op of the child with more fixed tasks wins (tie: earlier child). With an LLM the
 *   winner gets a reconciled patch; without one, each child whose edit differs from the winner's
 *   gets a `memory.reflect` `[conflict]: <label>` op, and the `[conflict]` note names only those losers.
 *
 * @module agent/learning/RevisionReconcile
 * @internal
 */

import { z } from 'zod';
import type { RevisionOp, SkillRecord } from '../../types/skills.js';
import { fencedText, inlineSafe } from './llmJson.js';
import {
  InstructionPatchSchema,
  SkillPatchSchema,
  canonical,
  fixedOfEntry,
  labelOfEntry,
  targetOf,
  type CallJson,
  type ChildOutcome,
  type Entry,
  type RevisionMergeResult,
} from './revisionMergeShared.js';

/** Mutable merge plan shared by the merger steps. */
export interface MergePlan {
  /** Indices to drop. */
  dropped: Set<number>;
  /** Replacement ops keyed by index. */
  replaced: Map<number, RevisionOp>;
  /** Ops appended to the end. */
  extra: RevisionOp[];
  /** Merge log. */
  notes: string[];
}

/**
 * Fold one child's sequential ops on a target into one op (later fields win).
 *
 * @param ops - The child's ops on the target, in order
 * @returns One op
 */
export function foldOps(ops: readonly RevisionOp[]): RevisionOp {
  let acc = ops[0]!;
  for (const op of ops.slice(1)) {
    if (acc.op === 'skill.update' && op.op === 'skill.update') acc = { ...acc, patch: { ...acc.patch, ...op.patch } };
    else acc = op;
  }
  return acc;
}

/**
 * Reconcile conflicting updates to the same target from different children.
 *
 * @param entries - Flattened ops
 * @param children - Child outcomes
 * @param plan - Merge plan (mutated)
 * @param callJson - Validated LLM call, when an LLM is configured
 * @param signal - Optional abort signal
 * @returns Reconciled target groups
 */
export async function reconcileTargets(
  entries: Entry[],
  children: ChildOutcome[],
  plan: MergePlan,
  callJson: CallJson | undefined,
  signal?: AbortSignal,
): Promise<RevisionMergeResult['reconciled']> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = targetOf(entry.op);
    if (key === undefined || plan.dropped.has(entry.index)) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const labelOf = (e: Entry): string => labelOfEntry(children, e);
  const out: RevisionMergeResult['reconciled'] = [];
  for (const [target, raw] of groups) {
    if (new Set(raw.map((m) => m.child)).size < 2) continue;
    const members = foldPerChild(raw, plan);
    const winner = members.reduce((best, cur) => {
      const a = fixedOfEntry(children, cur);
      const b = fixedOfEntry(children, best);
      return a > b || (a === b && cur.child < best.child) ? cur : best;
    });
    const losers = members.filter((m) => m !== winner);
    losers.forEach((l) => plan.dropped.add(l.index));
    out.push({ target, keptFrom: labelOf(winner), droppedFrom: [...new Set(losers.map(labelOf))] });
    const differing = losers.filter((l) => canonical(l.op) !== canonical(winner.op));
    if (differing.length === 0) {
      plan.notes.push(`[reconciled] ${target}: identical edits, kept ${labelOf(winner)}`);
      continue;
    }
    const disjoint = disjointMerge(members);
    if (disjoint) {
      plan.replaced.set(winner.index, disjoint);
      plan.notes.push(`[reconciled] ${target}: merged disjoint fields from ${[...new Set(members.map(labelOf))].join(', ')}`);
      continue;
    }
    const llmOp = callJson ? await llmReconcile(target, members, labelOf, winner, callJson, signal) : undefined;
    if (llmOp) {
      plan.replaced.set(winner.index, llmOp);
      plan.notes.push(`[reconciled] ${target}: LLM patch from ${labelOf(winner)}`);
      continue;
    }
    const names = [...new Set(differing.map(labelOf))];
    for (const name of names) plan.extra.push({ op: 'memory.reflect', summary: `[conflict]: ${name}`, evidence: [target] });
    plan.notes.push(`[conflict] ${target}: dropped ${names.join(', ')}`);
  }
  return out;
}

/**
 * Fold each child's entries on one target into its first entry; the others are dropped.
 *
 * @param members - Entries on one target
 * @param plan - Merge plan (mutated: folded-away entries are dropped)
 * @returns One entry per child, carrying the folded op
 */
function foldPerChild(members: Entry[], plan: MergePlan): Entry[] {
  const byChild = new Map<number, Entry[]>();
  for (const m of members) byChild.set(m.child, [...(byChild.get(m.child) ?? []), m]);
  const out: Entry[] = [];
  for (const list of byChild.values()) {
    const first = list[0]!;
    for (const extra of list.slice(1)) plan.dropped.add(extra.index);
    const op = foldOps(list.map((e) => e.op));
    if (list.length > 1) plan.replaced.set(first.index, op);
    out.push({ ...first, op });
  }
  return out;
}

/**
 * One `skill.update` carrying every member's fields when the members patch disjoint fields.
 *
 * @param members - One folded entry per child
 * @returns The merged op, or `undefined` when fields overlap or the ops are not skill updates
 */
function disjointMerge(members: readonly Entry[]): RevisionOp | undefined {
  const first = members[0]?.op;
  if (!first || first.op !== 'skill.update') return undefined;
  const seen = new Set<string>();
  let patch: Record<string, unknown> = {};
  for (const m of members) {
    if (m.op.op !== 'skill.update') return undefined;
    for (const key of Object.keys(m.op.patch)) {
      if (seen.has(key)) return undefined;
      seen.add(key);
    }
    patch = { ...patch, ...m.op.patch };
  }
  return { ...first, patch: patch as typeof first.patch };
}

/**
 * Ask the LLM for a reconciled patch for one conflicting target.
 *
 * @param target - Target key
 * @param members - Conflicting ops
 * @param labelOf - Child label lookup
 * @param winner - Op whose index receives the reconciled patch
 * @param callJson - Validated LLM call
 * @param signal - Optional abort signal
 * @returns Replacement op, or `undefined` when the output is invalid
 */
async function llmReconcile(
  target: string,
  members: Entry[],
  labelOf: (e: Entry) => string,
  winner: Entry,
  callJson: CallJson,
  signal?: AbortSignal,
): Promise<RevisionOp | undefined> {
  const isInstruction = winner.op.op === 'instruction.patch';
  const views = members.map((m) => `Child ${inlineSafe(labelOf(m), 80)}:\n${fencedText(canonical(m.op))}`).join('\n\n');
  const prompt = [
    'Reconcile conflicting edits to one knowledge target produced by different learners.',
    `Target: ${inlineSafe(target, 200)}`,
    isInstruction
      ? 'Return ONLY JSON: {"patch": {"text": "<reconciled section text>"}}'
      : 'Return ONLY JSON: {"patch": {"body"?: string, "description"?: string, "uncertainty"?: number}}',
    'Keep what the edits agree on, and keep the change that the larger evidence supports.',
    views,
  ].join('\n\n');
  const schema = isInstruction ? InstructionPatchSchema : SkillPatchSchema;
  const patch = await callJson(prompt, z.object({ patch: schema }), signal);
  if (!patch) return undefined;
  const data = patch.patch as Record<string, unknown>;
  if (winner.op.op === 'instruction.patch') return { ...winner.op, text: String(data.text) };
  if (winner.op.op === 'skill.update') {
    return { ...winner.op, patch: data as Partial<Pick<SkillRecord, 'body' | 'description' | 'uncertainty'>> };
  }
  return undefined;
}
