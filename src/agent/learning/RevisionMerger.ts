/**
 * RevisionMerger (spec RS-20): merges the knowledge revisions of child learners into one revision.
 *
 * Steps, in order:
 * 1. Dedupe `skill.add` ops whose bodies have token Jaccard >= {@link DEFAULT_DEDUP_JACCARD}.
 *    The op from the child with more `fixed` tasks wins; a tie goes to the earlier child.
 * 2. Reconcile `skill.update` / `instruction.patch` ops that target the same section from
 *    different children (see `RevisionReconcile`: per-child folding, disjoint-field merge,
 *    `[conflict]` notes naming only losers).
 * 3. Generalize `skill.add` ops from two or more children (see `RevisionGeneralize`: kind match,
 *    domain overlap and description Jaccard >= 0.5; unique names; never empty domains).
 *
 * The merger never applies anything; the caller validates the merged revision (RS-17).
 *
 * @module agent/learning/RevisionMerger
 * @experimental Part of the Recursa self-improvement work (spec RS-20).
 */

import { randomUUID } from 'crypto';
import type { z } from '../../utils/schema.js';
import type { RevisionOp, KnowledgeRevisionRecord } from '../../types/skills.js';
import { toIsoDateTime } from '../../types/agent-memory.js';
import type { PGCompletionProvider } from '../procedural/graph/CompletionProvider.js';
import { DEFAULT_DEDUP_JACCARD } from '../ObservationDedupManager.js';
import { ENGLISH_STOPWORDS_SMALL, jaccard, tokenSetWithoutStopwords } from '../../utils/textSimilarity.js';
import { AbortError } from '../harness/ConcurrencyLimiter.js';
import { ABORTED, describeError, extractJsonObject, raceAbort } from './llmJson.js';
import { logger } from '../../utils/logger.js';
import { union, type CallJson, type ChildOutcome, type Entry, type RevisionMergeResult, type RevisionMergerDeps } from './revisionMergeShared.js';
import { reconcileTargets, type MergePlan } from './RevisionReconcile.js';
import { generalizeAdds } from './RevisionGeneralize.js';

export type { ChildOutcome, RevisionMergeResult, RevisionMergerDeps } from './revisionMergeShared.js';

/** Merges child knowledge revisions (spec RS-20). */
export class RevisionMerger {
  private readonly llm: PGCompletionProvider | undefined;

  /**
   * Create a merger.
   *
   * @param deps - Optional LLM provider for reconciliation and generalization
   */
  constructor(deps: RevisionMergerDeps = {}) {
    this.llm = deps.llmProvider;
  }

  /**
   * Merge child revisions into one revision.
   *
   * @param children - Child outcomes in the order they should be considered
   * @param opts - Base snapshot id (defaults to the first child's), optional reason and abort signal
   * @returns The merged revision with the merge log
   * @throws AbortError when the signal aborts
   */
  async merge(
    children: ChildOutcome[],
    opts?: { baseSnapshotId: string; reason?: string; signal?: AbortSignal },
  ): Promise<RevisionMergeResult> {
    const signal = opts?.signal;
    if (signal?.aborted) throw new AbortError();
    const notes: string[] = [];
    const plan: MergePlan = { dropped: new Set<number>(), replaced: new Map<number, RevisionOp>(), extra: [], notes };
    const { dropped, replaced, extra } = plan;
    const callJson: CallJson | undefined = this.llm ? (prompt, schema, sig) => this.callJson(prompt, schema, sig) : undefined;

    const entries: Entry[] = [];
    children.forEach((child, c) => {
      for (const op of child.revision.ops) entries.push({ child: c, index: entries.length, op });
    });

    const dedupedSkillAdds = this.dedupeAdds(entries, children, dropped, notes);
    const reconciled = await reconcileTargets(entries, children, plan, callJson, signal);
    const generalized = await generalizeAdds(entries, children, plan, callJson, signal);

    const ops: RevisionOp[] = [];
    for (const entry of entries) {
      if (dropped.has(entry.index)) continue;
      ops.push(replaced.get(entry.index) ?? entry.op);
    }
    ops.push(...extra);

    const rationale = [opts?.reason, ...children.map((c) => c.revision.rationale)]
      .filter((r): r is string => Boolean(r && r.trim()))
      .join(' | ');
    const revision: KnowledgeRevisionRecord = {
      id: `revision-${randomUUID().slice(0, 8)}`,
      baseSnapshotId: opts?.baseSnapshotId ?? children[0]?.revision.baseSnapshotId ?? '',
      ops,
      rationale: rationale || `merged ${children.length} child revisions`,
      diagnosedFailureIds: union(...children.map((c) => c.revision.diagnosedFailureIds)),
      producedBy: 'merge',
      createdAt: toIsoDateTime(new Date()),
    };
    return { revision, dedupedSkillAdds, reconciled, generalized, notes };
  }

  /**
   * Step 1: drop near-duplicate `skill.add` ops (greedy against the kept ops).
   *
   * @param entries - Flattened ops
   * @param children - Child outcomes
   * @param dropped - Indices to drop (mutated)
   * @param notes - Merge log (mutated)
   * @returns Number of ops dropped
   */
  private dedupeAdds(entries: Entry[], children: ChildOutcome[], dropped: Set<number>, notes: string[]): number {
    const kept: Entry[] = [];
    const tokens = new Map<number, Set<string>>();
    let count = 0;
    const fixedOf = (e: Entry): number => children[e.child]?.fixed.length ?? 0;
    for (const entry of entries) {
      if (entry.op.op !== 'skill.add') continue;
      const body = entry.op.skill.body;
      const tok = tokenSetWithoutStopwords(body, ENGLISH_STOPWORDS_SMALL, 2);
      tokens.set(entry.index, tok);
      const hit = kept.findIndex((k) => jaccard(tokens.get(k.index) ?? new Set(), tok) >= DEFAULT_DEDUP_JACCARD);
      if (hit < 0) {
        kept.push(entry);
        continue;
      }
      const incumbent = kept[hit];
      if (!incumbent) continue;
      const challengerWins =
        fixedOf(entry) > fixedOf(incumbent) || (fixedOf(entry) === fixedOf(incumbent) && entry.child < incumbent.child);
      const loser = challengerWins ? incumbent : entry;
      if (challengerWins) kept[hit] = entry;
      dropped.add(loser.index);
      count += 1;
      notes.push(
        `deduped skill.add from ${children[loser.child]?.label ?? '?'} (kept ${children[(challengerWins ? entry : incumbent).child]?.label ?? '?'})`,
      );
    }
    return count;
  }

  /**
   * Call the LLM and validate its JSON. Provider failures and invalid output yield `undefined`.
   *
   * @param prompt - Prompt text
   * @param schema - Zod schema for the parsed output
   * @param signal - Optional abort signal
   * @returns Validated output, or `undefined`
   * @throws AbortError when the signal aborts
   */
  private async callJson<T>(prompt: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T | undefined> {
    if (!this.llm) return undefined;
    if (signal?.aborted) throw new AbortError();
    try {
      const text = await raceAbort(this.llm.complete(prompt, { signal }), signal);
      if (text === ABORTED) throw new AbortError();
      const parsed = schema.safeParse(extractJsonObject(text));
      if (parsed.success) return parsed.data;
      logger.warn(`RevisionMerger: LLM output rejected (${parsed.error.issues[0]?.message ?? 'invalid'})`);
      return undefined;
    } catch (err) {
      if (err instanceof AbortError) throw err;
      logger.warn(`RevisionMerger: LLM call failed, using fallback (${describeError(err)})`);
      return undefined;
    }
  }
}
