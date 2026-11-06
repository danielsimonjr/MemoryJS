/**
 * Wake-up layers from the Recursa knowledge repository (spec RS-27).
 *
 * Splits `KnowledgeRepository.loadForContext` output into its instruction and
 * skill sections so that instructions can extend L0 and skill bodies can extend
 * L1 of `ContextWindowManager.wakeUp`, each within its own remaining budget.
 *
 * @module agent/knowledgeContext
 * @experimental Part of the Recursa context integration (spec RS-27).
 */

import type { KnowledgeRepository } from './knowledge/KnowledgeRepository.js';
import { estimateTokensFromText } from '../utils/tokenEstimate.js';
import { logger } from '../utils/logger.js';

/** Structural view of a knowledge repository: only `loadForContext` is used. */
export type KnowledgeRepositoryLike = Pick<KnowledgeRepository, 'loadForContext'>;

/** Sections requested from `loadForContext`. */
type LoadSections = NonNullable<Parameters<KnowledgeRepository['loadForContext']>[0]['sections']>;

/** Token budgets for {@link knowledgeLayersForWakeUp}. */
export interface KnowledgeLayerBudgets {
  /** Tokens available for instructions in L0 (values ≤ 0 yield nothing). */
  maxL0Tokens: number;
  /** Tokens available for skill bodies in L1 (values ≤ 0 yield nothing). */
  maxL1Tokens: number;
  /** Tokens per word, matching the caller's token estimator. */
  multiplier: number;
}

/** Markdown fragments to append to L0 and L1. Either may be empty. */
export interface KnowledgeLayers {
  /** Rendered shared instructions for L0. */
  l0: string;
  /** Rendered matched skill bodies for L1. */
  l1: string;
}

/** Section boundaries produced by `KnowledgeRepository` rendering. */
const SECTION_START = /^(?=## (?:Instructions \(|Skills$|Failure lessons$))/m;

/**
 * Keep the leading whole words of `text` whose estimated tokens fit `budget`.
 *
 * @param text - Markdown to trim.
 * @param budget - Token budget.
 * @param multiplier - Tokens per word.
 * @returns The trimmed text, or '' when the budget is non-positive.
 */
function fitTokens(text: string, budget: number, multiplier: number): string {
  if (budget <= 0 || text.length === 0) return '';
  if (estimateTokensFromText(text, multiplier) <= budget) return text;
  const chunks = text.match(/\S+\s*/g) ?? [];
  const keep = Math.max(0, Math.floor(budget / multiplier));
  return chunks.slice(0, keep).join('').trimEnd();
}

/**
 * Return the section of rendered knowledge whose heading starts with `prefix`
 * (`Instructions (` or `Skills`), or '' when absent.
 *
 * @param markdown - Output of `loadForContext`.
 * @param prefix - Heading prefix, without the leading `## `.
 */
function sectionOf(markdown: string, prefix: string): string {
  const part = markdown.split(SECTION_START).find((p) => p.startsWith(`## ${prefix}`));
  return part ? part.trimEnd() : '';
}

/**
 * Load shared instructions for L0 and matched skill bodies for L1.
 *
 * Calls `loadForContext` once per layer with `role: 'shared'` and the layer's
 * own budget: L0 requests only `instructions`, L1 only `skills`,
 * so instructions never consume the skill budget and skills are matched once
 * per wake-up. Errors are logged and yield
 * empty layers, so wake-up never fails because of knowledge loading.
 *
 * @param knowledge - Repository (or fake) exposing `loadForContext`.
 * @param taskHint - Task description used to match skills.
 * @param budgets - Token budgets and the estimator multiplier.
 * @returns Markdown for L0 (instructions) and L1 (skill bodies), each within its budget.
 * @example
 * ```typescript
 * const layers = await knowledgeLayersForWakeUp(repo, 'fix the parser', {
 *   maxL0Tokens: 100, maxL1Tokens: 500, multiplier: 1.3,
 * });
 * ```
 */
export async function knowledgeLayersForWakeUp(
  knowledge: KnowledgeRepositoryLike,
  taskHint: string,
  budgets: KnowledgeLayerBudgets,
): Promise<KnowledgeLayers> {
  const { maxL0Tokens, maxL1Tokens, multiplier } = budgets;
  const load = async (budget: number, sections: LoadSections): Promise<string> => {
    if (budget <= 0) return '';
    const loaded = await knowledge.loadForContext({ role: 'shared', taskHint, budgetTokens: budget, multiplier, sections });
    return loaded.markdown;
  };
  try {
    const [l0Md, l1Md] = await Promise.all([
      load(maxL0Tokens, ['instructions']),
      load(maxL1Tokens, ['skills']),
    ]);
    return {
      l0: fitTokens(sectionOf(l0Md, 'Instructions ('), maxL0Tokens, multiplier),
      l1: fitTokens(sectionOf(l1Md, 'Skills'), maxL1Tokens, multiplier),
    };
  } catch (err) {
    logger.error('[knowledgeContext] knowledge loading failed:', err);
    return { l0: '', l1: '' };
  }
}
