/**
 * Types and helpers shared by the revision merger's steps (spec RS-20).
 *
 * @module agent/learning/revisionMergeShared
 * @internal
 */

import { z } from 'zod';
import type { PGCompletionProvider } from '../procedural/graph/CompletionProvider.js';
import type { KnowledgeRevisionRecord, RevisionOp } from '../../types/skills.js';

/** Outcome of one child learner, as handed to {@link RevisionMerger.merge}. */
export interface ChildOutcome {
  /** Child label (used in notes and provenance). */
  label: string;
  /** The child's revision. */
  revision: KnowledgeRevisionRecord;
  /** Task ids the child fixed. */
  fixed: string[];
  /** Task ids the child regressed. */
  regressed: string[];
  /** Evidence domains backing the child's additions; falls back to each skill's `scope.domains`. */
  evidenceDomains?: string[];
}

/** Result of {@link RevisionMerger.merge}. */
export interface RevisionMergeResult {
  /** The merged revision (not validated or applied). */
  revision: KnowledgeRevisionRecord;
  /** Number of `skill.add` ops removed as near-duplicates. */
  dedupedSkillAdds: number;
  /** Conflicting target groups and which child's op was kept. */
  reconciled: Array<{ target: string; keptFrom: string; droppedFrom: string[] }>;
  /** Skill additions generalized from several children. */
  generalized: Array<{ kind: string; from: string[]; domains: string[] }>;
  /** Human-readable log of the merge decisions. */
  notes: string[];
}

/** Dependencies of {@link RevisionMerger}. */
export interface RevisionMergerDeps {
  /** Optional LLM used for reconciliation and generalization. Deterministic fallbacks without it. */
  llmProvider?: PGCompletionProvider;
}

/** Maximum characters of an LLM-written skill body. */
export const BODY_MAX_CHARS = 8000;
/** Maximum characters of an LLM-written patch field other than the body. */
export const FIELD_MAX_CHARS = 2000;
/** Maximum characters of a generalized skill name. */
export const NAME_MAX_CHARS = 80;

/** Zod schema for a reconciled `skill.update` patch. */
export const SkillPatchSchema = z
  .object({
    body: z.string().trim().min(1).max(BODY_MAX_CHARS).optional(),
    description: z.string().trim().min(1).max(FIELD_MAX_CHARS).optional(),
    uncertainty: z.number().min(0).max(1).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'empty patch');

/** Zod schema for a reconciled `instruction.patch` text. */
export const InstructionPatchSchema = z.object({ text: z.string().trim().min(1).max(BODY_MAX_CHARS) });

/** Zod schema for a generalized body. */
export const BodySchema = z.object({ body: z.string().trim().min(1).max(BODY_MAX_CHARS) });

/** One op of a child, with its position in the flattened input. */
export interface Entry {
  /** Index of the child in the input array. */
  child: number;
  /** Flattened position across all children. */
  index: number;
  /** The op itself. */
  op: RevisionOp;
}

/**
 * Stable JSON of a value with sorted object keys, for equality checks.
 *
 * @param value - Value to serialise
 * @returns Canonical JSON text
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Union of strings, keeping first-seen order.
 *
 * @param lists - String lists
 * @returns Unique strings
 */
export function union(...lists: Array<readonly string[] | undefined>): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list ?? []) if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Target key of a reconcilable op, or `undefined` for ops that never conflict.
 *
 * @param op - Revision op
 * @returns Target key such as `skill:<id>` or `instruction:<id>#<heading>`
 */
export function targetOf(op: RevisionOp): string | undefined {
  if (op.op === 'skill.update') return `skill:${op.id}`;
  if (op.op === 'instruction.patch') return `instruction:${op.id}#${op.heading}`;
  return undefined;
}


/** Validated LLM JSON call used by the merger steps; `undefined` on any failure. */
export type CallJson = <T>(prompt: string, schema: z.ZodType<T>, signal?: AbortSignal) => Promise<T | undefined>;

/**
 * Child label of an entry.
 *
 * @param children - Child outcomes
 * @param e - Entry
 * @returns The label, or `?`
 */
export function labelOfEntry(children: readonly ChildOutcome[], e: Entry): string {
  return children[e.child]?.label ?? '?';
}

/**
 * Number of tasks the entry's child fixed.
 *
 * @param children - Child outcomes
 * @param e - Entry
 * @returns Fixed-task count
 */
export function fixedOfEntry(children: readonly ChildOutcome[], e: Entry): number {
  return children[e.child]?.fixed.length ?? 0;
}
