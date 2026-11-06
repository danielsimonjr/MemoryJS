/**
 * Learning reflector (Recursa RS-21): one `learning` reflection per recursive round.
 *
 * Reads the round's child outcomes and writes exactly one {@link ReflectionRecord} through
 * `AgentReflectionManager.create` with `scope: 'learning'`. Evidence is the child trace names that
 * exist (a missing id is skipped and reported). `keyInsights` (at most five) name subsets that did
 * not improve, conflicting edits, noisy-feedback clusters, the `split by <strategy>` insight (one
 * slot is always reserved for it) and, when a concrete strategy was used, the structured
 * `prefer-split:<name>` token that `split('auto')` parses for its tie-break. Text is deterministic;
 * an optional LLM provider only polishes the summary, and any failure falls back.
 *
 * Reflection creation is idempotent per round: the record carries the round tag
 * `learning-round:<traceId>#<round>` in `experienceType`, and a reflection with the same tag and
 * evidence is returned instead of writing a second one.
 *
 * @module agent/learning/LearningReflector
 * @experimental Spec RS-21. Insight wording may change.
 */

import type { EvalMetrics } from '../../types/learning.js';
import type { ReflectionRecord } from '../../types/agent-memory.js';
import type { AgentReflectionManager } from '../AgentReflectionManager.js';
import type { PGCompletionProvider } from '../procedural/graph/CompletionProvider.js';
import type { LearningTrace } from './LearningTrace.js';

/** Maximum number of key insights stored on a reflection. */
export const MAX_KEY_INSIGHTS = 5;

/** One child's outcome, as the reflector reads it. */
export interface ReflectChild {
  /** Child trace id (evidence when the trace exists). */
  traceId: string;
  /** Subset label. */
  label: string;
  /** Whether the child improved. */
  improved: boolean;
  /** Child metrics before its run. */
  before: EvalMetrics;
  /** Child metrics after its run. */
  after: EvalMetrics;
  /** Conflicting edits seen in the merge, if any. */
  conflicts?: string[];
  /** Tasks with noisy feedback in this subset, if counted. */
  noisyCount?: number;
}

/** Input of {@link LearningReflector.reflect}. */
export interface ReflectInput {
  /** Recursive trace the round belongs to (fallback evidence). */
  traceId: string;
  /** Round number, 0-based. */
  round: number;
  /** Child outcomes of the round. */
  children: ReflectChild[];
  /** Merge notes of the round. */
  mergeNotes: string[];
  /** Split strategy used this round, for the split hint. */
  strategy?: string;
}

/** Result of {@link LearningReflector.reflect}. */
export interface ReflectResult {
  /** Id of the reflection written. */
  reflectionId: string;
  /** Key insights stored (at most {@link MAX_KEY_INSIGHTS}). */
  keyInsights: string[];
  /** Share of children that improved, in [0, 1]. */
  improvedShare: number;
  /** Child trace ids that do not exist, skipped as evidence. */
  skippedEvidence: string[];
  /** Summary text stored on the reflection. */
  summary: string;
  /** Strategy the next `auto` split should prefer on a tie, when one is derived. */
  preferredStrategy?: string;
}

/** Concrete split strategies in `auto` order (mirrors `SplitStrategies`). */
const CONCRETE_STRATEGIES = ['byCategory', 'byFailureMode', 'bySkill', 'byTool'] as const;

/**
 * Strategy to prefer next: the same one when a subset improved, else the next concrete strategy.
 *
 * @param strategy - Strategy used this round.
 * @param improved - Number of improved children.
 * @returns A concrete strategy name, or `undefined` for `auto`/unknown names.
 */
export function preferredStrategyOf(strategy: string | undefined, improved: number): string | undefined {
  const i = CONCRETE_STRATEGIES.indexOf(strategy as (typeof CONCRETE_STRATEGIES)[number]);
  if (i < 0) return undefined;
  return improved > 0 ? CONCRETE_STRATEGIES[i] : CONCRETE_STRATEGIES[(i + 1) % CONCRETE_STRATEGIES.length];
}

/** Options of {@link LearningReflector}. */
export interface LearningReflectorOptions {
  /** Optional LLM used only to polish the summary. */
  llmProvider?: PGCompletionProvider;
}

/**
 * Writes one learning reflection per round.
 *
 * @example
 * ```ts
 * const reflector = new LearningReflector(agentReflections, traces);
 * const { reflectionId, keyInsights } = await reflector.reflect({ traceId, round, children, mergeNotes });
 * ```
 */
export class LearningReflector {
  private readonly reflections: AgentReflectionManager;
  private readonly traces: LearningTrace;
  private readonly llm: PGCompletionProvider | undefined;

  /**
   * Create the instance.
   *
   * @param reflections - Reflection manager (writes the record).
   * @param traces - Trace store (verifies evidence).
   * @param options - Optional LLM for summary polish.
   */
  constructor(reflections: AgentReflectionManager, traces: LearningTrace, options: LearningReflectorOptions = {}) {
    this.reflections = reflections;
    this.traces = traces;
    this.llm = options.llmProvider;
  }

  /**
   * Reflect on one round and write its reflection.
   *
   * @param input - Round outcome.
   * @returns The reflection id, insights, improved share and skipped evidence.
   * @throws Error when the round trace itself does not exist (no evidence can be recorded).
   */
  async reflect(input: ReflectInput): Promise<ReflectResult> {
    const skippedEvidence: string[] = [];
    const evidence: string[] = [];
    for (const child of input.children) {
      if (evidence.includes(child.traceId) || skippedEvidence.includes(child.traceId)) continue;
      if (await this.traces.get(child.traceId)) evidence.push(child.traceId);
      else skippedEvidence.push(child.traceId);
    }
    if (evidence.length === 0) {
      if (!(await this.traces.get(input.traceId))) throw new Error(`LearningReflector: unknown trace "${input.traceId}"`);
      evidence.push(input.traceId);
    }
    const total = input.children.length;
    const improved = input.children.filter((c) => c.improved).length;
    const improvedShare = total === 0 ? 0 : improved / total;
    const preferredStrategy = input.children.length > 0 ? preferredStrategyOf(input.strategy, improved) : undefined;
    const reserved = [
      ...(input.strategy !== undefined && input.children.length > 0 ? [splitInsightOf(input, improved)] : []),
      ...(preferredStrategy ? [`prefer-split:${preferredStrategy}`] : []),
    ];
    const keyInsights = [...insightsOf(input).slice(0, MAX_KEY_INSIGHTS - reserved.length), ...reserved];
    const tag = `learning-round:${input.traceId}#${input.round}`;
    const sameEvidence = (r: ReflectionRecord): boolean =>
      r.experienceType === tag && [...r.evidence].sort().join('\0') === [...evidence].sort().join('\0');
    const prior = (await this.reflections.list({ scope: 'learning' })).find(sameEvidence);
    const extra = preferredStrategy ? { preferredStrategy } : {};
    if (prior) {
      return { reflectionId: prior.id, keyInsights: prior.keyInsights, improvedShare, skippedEvidence, summary: prior.summary, ...extra };
    }
    const summary = await this.summaryOf(input, improved, skippedEvidence);
    const record: ReflectionRecord = await this.reflections.create({
      scope: 'learning',
      evidence,
      summary,
      generalization_confidence: improvedShare,
      keyInsights,
      experienceType: tag,
    });
    return { reflectionId: record.id, keyInsights, improvedShare, skippedEvidence, summary, ...extra };
  }

  /**
   * Deterministic summary, polished by the LLM when one is configured. Any error or empty
   * answer keeps the deterministic text.
   *
   * @param input - Round outcome.
   * @param improved - Number of improved children.
   * @param skipped - Skipped evidence ids.
   * @returns Summary text.
   */
  private async summaryOf(input: ReflectInput, improved: number, skipped: string[]): Promise<string> {
    const notes = skipped.length > 0 ? `; skipped nonexistent evidence: ${skipped.join(', ')}` : '';
    const base = `Round ${input.round}: ${improved} of ${input.children.length} subsets improved; ${input.mergeNotes.length} merge note(s)${notes}`;
    if (!this.llm) return base;
    try {
      const polished = (await this.llm.complete(`Rewrite as one plain sentence, keep every number:\n${base}`)).trim();
      return polished.length > 0 && polished.length <= 500 ? polished : base;
    } catch {
      return base;
    }
  }
}

/**
 * Key insights of a round in priority order: non-improving subsets, conflicts, noisy clusters.
 * The split insight and the `prefer-split:` token are added separately in reserved slots.
 *
 * @param input - Round outcome.
 * @returns Insight strings (not yet capped).
 */
function insightsOf(input: ReflectInput): string[] {
  const out: string[] = [];
  for (const child of input.children) {
    if (!child.improved) out.push(`subset ${child.label} did not improve (allPass ${child.before.allPass} -> ${child.after.allPass})`);
  }
  for (const child of input.children) {
    for (const conflict of child.conflicts ?? []) out.push(`conflict in subset ${child.label}: ${conflict}`);
  }
  for (const child of input.children) {
    if ((child.noisyCount ?? 0) > 0) out.push(`noisy feedback in subset ${child.label}: ${child.noisyCount} task(s)`);
  }
  return out;
}

/**
 * The `split by <strategy>` insight.
 *
 * @param input - Round outcome.
 * @param improved - Number of improved children.
 * @returns Insight text.
 */
function splitInsightOf(input: ReflectInput, improved: number): string {
  return improved > 0
    ? `split by ${input.strategy}: ${improved} of ${input.children.length} subsets improved`
    : `split by ${input.strategy}: no subset improved; try another strategy`;
}
