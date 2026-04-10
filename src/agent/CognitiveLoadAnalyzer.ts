/**
 * Cognitive Load Analyzer
 *
 * Computes cognitive-load metrics for a set of agent memories and provides
 * an adaptive-reduction strategy that drops the most redundant / least-salient
 * memories until the load falls below a configurable threshold.
 *
 * @module agent/CognitiveLoadAnalyzer
 */

import type { AgentEntity, CognitiveLoadMetrics, AdaptiveReductionResult } from '../types/agent-memory.js';

// ==================== Configuration ====================

/**
 * Configuration for CognitiveLoadAnalyzer.
 */
export interface CognitiveLoadConfig {
  /**
   * Combined load score at which the context is considered overloaded.
   * @default 0.7
   */
  loadThreshold?: number;

  /**
   * Weight given to token-density when computing the final load score.
   * @default 0.4
   */
  tokenWeight?: number;

  /**
   * Weight given to redundancy ratio when computing the final load score.
   * @default 0.35
   */
  redundancyWeight?: number;

  /**
   * Weight given to (1 - diversity) when computing the final load score.
   * @default 0.25
   */
  diversityWeight?: number;

  /**
   * Denominator used for token-density normalisation.
   * Typically the maximum token budget for the context window.
   * @default 8000
   */
  maxTokensForDensity?: number;

  /**
   * Jaccard similarity score at or above which two memories are considered
   * redundant with each other.
   * @default 0.85
   */
  redundancyThreshold?: number;
}

// ==================== Resolved config type ====================

type ResolvedConfig = Required<CognitiveLoadConfig>;

// ==================== Analyzer class ====================

/**
 * Analyzes and reduces cognitive load for agent memory sets.
 *
 * @example
 * ```typescript
 * const analyzer = new CognitiveLoadAnalyzer();
 * const metrics = analyzer.computeMetrics(memories, estimateTokens);
 * if (metrics.exceedsThreshold) {
 *   const result = analyzer.adaptiveReduce(memories, salienceMap, estimateTokens);
 *   console.log(`Kept ${result.retained.length} memories`);
 * }
 * ```
 */
export class CognitiveLoadAnalyzer {
  private readonly config: ResolvedConfig;

  constructor(config: CognitiveLoadConfig = {}) {
    this.config = {
      loadThreshold: config.loadThreshold ?? 0.7,
      tokenWeight: config.tokenWeight ?? 0.4,
      redundancyWeight: config.redundancyWeight ?? 0.35,
      diversityWeight: config.diversityWeight ?? 0.25,
      maxTokensForDensity: config.maxTokensForDensity ?? 8000,
      redundancyThreshold: config.redundancyThreshold ?? 0.85,
    };
  }

  // ==================== Public API ====================

  /**
   * Compute cognitive-load metrics for a collection of memories.
   *
   * @param memories - Memories to analyse
   * @param estimateTokensFn - Function that estimates token count for one entity
   * @returns Computed metrics
   */
  computeMetrics(
    memories: AgentEntity[],
    estimateTokensFn: (entity: AgentEntity) => number
  ): CognitiveLoadMetrics {
    if (memories.length === 0) {
      return this.zeroMetrics();
    }

    const tokenCount = memories.reduce((sum, m) => sum + estimateTokensFn(m), 0);
    const tokenDensity = Math.min(1, tokenCount / this.config.maxTokensForDensity);

    const { redundancyRatio, diversityScore } = this.computeRedundancyAndDiversity(memories);

    // Higher (1-diversity) means less diverse — more load
    const loadScore =
      tokenDensity * this.config.tokenWeight +
      redundancyRatio * this.config.redundancyWeight +
      (1 - diversityScore) * this.config.diversityWeight;

    return {
      tokenCount,
      tokenDensity,
      redundancyRatio,
      diversityScore,
      loadScore: Math.min(1, loadScore),
      exceedsThreshold: loadScore >= this.config.loadThreshold,
    };
  }

  /**
   * Adaptively reduce a memory set until its cognitive load falls below the
   * configured threshold (or no further reduction is possible).
   *
   * Strategy: iteratively remove the memory with the lowest salience score
   * that is also a member of the most redundant pair.  If no redundant pairs
   * remain but load still exceeds the threshold, continue removing the
   * lowest-salience memory until the threshold is met.
   *
   * @param memories - Memories to reduce
   * @param salienceScores - Map from entity name → salience score (0-1)
   * @param estimateTokensFn - Token estimator
   * @returns Reduction result
   */
  adaptiveReduce(
    memories: AgentEntity[],
    salienceScores: Map<string, number>,
    estimateTokensFn: (entity: AgentEntity) => number
  ): AdaptiveReductionResult {
    const beforeMetrics = this.computeMetrics(memories, estimateTokensFn);

    if (!beforeMetrics.exceedsThreshold || memories.length <= 1) {
      return {
        retained: [...memories],
        removed: [],
        beforeMetrics,
        afterMetrics: beforeMetrics,
        redundantPairsFound: 0,
      };
    }

    let working = [...memories];
    const removed: AgentEntity[] = [];
    let redundantPairsFound = 0;

    while (working.length > 1) {
      const metrics = this.computeMetrics(working, estimateTokensFn);
      if (!metrics.exceedsThreshold) break;

      // Find all redundant pairs
      const redundantPairs = this.findRedundantPairs(working);
      redundantPairsFound += redundantPairs.length;

      if (redundantPairs.length > 0) {
        // Remove the lowest-salience member of the most-redundant pair
        const [a, b] = redundantPairs[0]; // pairs are already sorted by score desc
        const salienceA = salienceScores.get(a.name) ?? 0;
        const salienceB = salienceScores.get(b.name) ?? 0;
        const toRemove = salienceA <= salienceB ? a : b;
        working = working.filter((m) => m.name !== toRemove.name);
        removed.push(toRemove);
      } else {
        // No redundant pairs — just drop the lowest-salience memory
        const sorted = [...working].sort(
          (a, b) => (salienceScores.get(a.name) ?? 0) - (salienceScores.get(b.name) ?? 0)
        );
        const toRemove = sorted[0];
        working = working.filter((m) => m.name !== toRemove.name);
        removed.push(toRemove);
      }
    }

    const afterMetrics = this.computeMetrics(working, estimateTokensFn);

    return {
      retained: working,
      removed,
      beforeMetrics,
      afterMetrics,
      redundantPairsFound,
    };
  }

  /**
   * Get the current resolved configuration.
   */
  getConfig(): Readonly<ResolvedConfig> {
    return { ...this.config };
  }

  // ==================== Internal helpers ====================

  /**
   * Compute redundancy ratio and diversity score for a set of memories.
   *
   * Pairwise Jaccard similarity is computed over the tokenised observation
   * text of each memory.  Comparison is capped at 500 observations per pair
   * to bound O(n²) work.
   *
   * @internal
   */
  private computeRedundancyAndDiversity(
    memories: AgentEntity[]
  ): { redundancyRatio: number; diversityScore: number } {
    if (memories.length <= 1) {
      return { redundancyRatio: 0, diversityScore: 1 };
    }

    let totalSimilarity = 0;
    let comparisons = 0;
    let redundantCount = 0;

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const sim = this.jaccardSimilarity(memories[i], memories[j]);
        totalSimilarity += sim;
        comparisons++;
        if (sim >= this.config.redundancyThreshold) {
          redundantCount++;
        }
      }
    }

    const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0;
    const totalPairs = comparisons;
    const redundancyRatio = totalPairs > 0 ? redundantCount / totalPairs : 0;
    const diversityScore = 1 - avgSimilarity;

    return { redundancyRatio, diversityScore };
  }

  /**
   * Find all pairs of memories above the redundancy threshold.
   * Returns pairs sorted by similarity descending (most redundant first).
   *
   * @internal
   */
  private findRedundantPairs(
    memories: AgentEntity[]
  ): Array<[AgentEntity, AgentEntity]> {
    const pairs: Array<{ pair: [AgentEntity, AgentEntity]; sim: number }> = [];

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const sim = this.jaccardSimilarity(memories[i], memories[j]);
        if (sim >= this.config.redundancyThreshold) {
          pairs.push({ pair: [memories[i], memories[j]], sim });
        }
      }
    }

    pairs.sort((a, b) => b.sim - a.sim);
    return pairs.map((p) => p.pair);
  }

  /**
   * Compute Jaccard similarity between two memories based on word tokens.
   *
   * Observation text is tokenised into lowercase words.  To keep the
   * operation bounded, the observation list is pre-truncated so that the
   * combined token set has at most 500 tokens.
   *
   * @internal
   */
  private jaccardSimilarity(a: AgentEntity, b: AgentEntity): number {
    const tokensA = this.extractTokens(a);
    const tokensB = this.extractTokens(b);

    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersectionSize = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersectionSize++;
    }

    const unionSize = tokensA.size + tokensB.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }

  /**
   * Extract a capped set of word tokens from an entity's observations.
   *
   * Limits total tokens to 500 to bound pairwise comparison cost.
   *
   * @internal
   */
  private extractTokens(entity: AgentEntity): Set<string> {
    const MAX_TOKENS = 500;
    const tokens = new Set<string>();
    const text = [entity.name, entity.entityType, ...(entity.observations ?? [])].join(' ');

    for (const word of text.toLowerCase().split(/\W+/)) {
      if (word.length > 0) {
        tokens.add(word);
        if (tokens.size >= MAX_TOKENS) break;
      }
    }

    return tokens;
  }

  /**
   * Return an all-zero metrics object (used for empty input).
   * @internal
   */
  private zeroMetrics(): CognitiveLoadMetrics {
    return {
      tokenCount: 0,
      tokenDensity: 0,
      redundancyRatio: 0,
      diversityScore: 1,
      loadScore: 0,
      exceedsThreshold: false,
    };
  }
}
