/**
 * Early Termination Manager
 *
 * Phase 12 Sprint 4: Manages early termination of hybrid search when
 * results are adequate, executing layers in cost-order for efficiency.
 *
 * @module search/EarlyTerminationManager
 */

import type {
  HybridSearchResult,
  QueryAnalysis,
  ReadonlyKnowledgeGraph,
} from '../types/index.js';
import type { HybridSearchManager } from './HybridSearchManager.js';
import type { SearchLayer } from './QueryCostEstimator.js';
import { QueryCostEstimator } from './QueryCostEstimator.js';

/**
 * Adequacy check result for a set of search results.
 */
export interface AdequacyCheck {
  /** Whether results are adequate */
  adequate: boolean;
  /** Adequacy score (0-1) */
  score: number;
  /** Reasons for the adequacy determination */
  reasons: string[];
  /** Layers that contributed to results */
  contributingLayers: SearchLayer[];
}

/**
 * Options for early termination.
 */
export interface EarlyTerminationOptions {
  /** Adequacy threshold (0-1, default: 0.7) */
  adequacyThreshold?: number;
  /** Minimum results required (default: 3) */
  minResults?: number;
  /** Maximum results to collect (default: 20) */
  maxResults?: number;
  /** Whether semantic search is available (default: true) */
  semanticAvailable?: boolean;
  /** Query analysis for smarter adequacy checking */
  analysis?: QueryAnalysis;
  /** Minimum diversity score (0-1, default: 0.3) */
  minDiversity?: number;
  /** Minimum average relevance score (0-1, default: 0.4) */
  minRelevance?: number;
}

/**
 * Result from early termination search.
 */
export interface EarlyTerminationResult {
  /** Final search results */
  results: HybridSearchResult[];
  /** Layers that were executed (in order) */
  executedLayers: SearchLayer[];
  /** Adequacy check details */
  adequacy: AdequacyCheck;
  /** Whether early termination occurred */
  earlyTerminated: boolean;
  /** Total time in milliseconds */
  executionTimeMs: number;
}

/**
 * Default options for early termination.
 */
const DEFAULT_OPTIONS: Required<Omit<EarlyTerminationOptions, 'analysis'>> = {
  adequacyThreshold: 0.7,
  minResults: 3,
  maxResults: 20,
  semanticAvailable: true,
  minDiversity: 0.3,
  minRelevance: 0.4,
};

/**
 * Early Termination Manager
 *
 * Executes search layers in cost-order (fastest first) and terminates
 * early when results are adequate, saving computation time.
 *
 * @example
 * ```typescript
 * const manager = new EarlyTerminationManager(hybridSearch);
 * const result = await manager.searchWithEarlyTermination(
 *   graph,
 *   'machine learning',
 *   { adequacyThreshold: 0.8, minResults: 5 }
 * );
 *
 * if (result.earlyTerminated) {
 *   console.log(`Terminated after ${result.executedLayers.length} layers`);
 * }
 * ```
 */
export class EarlyTerminationManager {
  private costEstimator: QueryCostEstimator;

  constructor(
    private hybridSearch: HybridSearchManager,
    costEstimator?: QueryCostEstimator
  ) {
    this.costEstimator = costEstimator ?? new QueryCostEstimator();
  }

  /**
   * Execute search with early termination support.
   *
   * Executes layers in cost-order and terminates early when results
   * meet the adequacy threshold.
   *
   * @param graph - Knowledge graph to search
   * @param query - Search query
   * @param options - Early termination options
   * @returns Search results with termination details
   */
  async searchWithEarlyTermination(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: EarlyTerminationOptions = {}
  ): Promise<EarlyTerminationResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { semanticAvailable, maxResults } = opts;

    // Get layers sorted by cost (fastest first)
    const orderedLayers = this.costEstimator.getLayersByCost(
      query,
      graph.entities.length,
      semanticAvailable
    );

    const allResults: HybridSearchResult[] = [];
    const executedLayers: SearchLayer[] = [];
    let earlyTerminated = false;

    // Execute layers in cost order
    for (const { layer } of orderedLayers) {
      executedLayers.push(layer);

      // Execute single layer search
      const layerResults = await this.executeLayerSearch(
        graph,
        query,
        layer,
        maxResults
      );

      // Merge results (deduplicate by entity name)
      for (const result of layerResults) {
        const existing = allResults.find(r => r.entity.name === result.entity.name);
        if (existing) {
          // Update scores if this layer has higher score
          if (result.scores.combined > existing.scores.combined) {
            Object.assign(existing, result);
          }
          // Add to matched layers
          if (!existing.matchedLayers.includes(layer)) {
            existing.matchedLayers.push(layer);
          }
        } else {
          // Ensure matchedLayers includes current layer
          if (!result.matchedLayers.includes(layer)) {
            result.matchedLayers = [...result.matchedLayers, layer];
          }
          allResults.push(result);
        }
      }

      // Check adequacy
      const adequacy = this.checkAdequacy(allResults, opts, executedLayers);

      if (adequacy.adequate) {
        earlyTerminated = executedLayers.length < orderedLayers.length;
        break;
      }
    }

    // Final sort by combined score
    const sortedResults = allResults
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, maxResults);

    const finalAdequacy = this.checkAdequacy(sortedResults, opts, executedLayers);

    return {
      results: sortedResults,
      executedLayers,
      adequacy: finalAdequacy,
      earlyTerminated,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single layer search.
   * @private
   */
  private async executeLayerSearch(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    layer: SearchLayer,
    limit: number
  ): Promise<HybridSearchResult[]> {
    // Configure weights to emphasize the current layer
    const weights = this.getLayerWeights(layer);

    try {
      return await this.hybridSearch.search(graph, query, {
        ...weights,
        limit: limit * 2, // Over-fetch for better merging
      });
    } catch {
      // Layer failed, return empty results
      return [];
    }
  }

  /**
   * Get weight configuration for a specific layer.
   * @private
   */
  private getLayerWeights(layer: SearchLayer): {
    semanticWeight: number;
    lexicalWeight: number;
    symbolicWeight: number;
  } {
    switch (layer) {
      case 'semantic':
        return { semanticWeight: 1.0, lexicalWeight: 0.0, symbolicWeight: 0.0 };
      case 'lexical':
        return { semanticWeight: 0.0, lexicalWeight: 1.0, symbolicWeight: 0.0 };
      case 'symbolic':
        return { semanticWeight: 0.0, lexicalWeight: 0.0, symbolicWeight: 1.0 };
    }
  }

  /**
   * Check if results are adequate based on configured thresholds.
   *
   * @param results - Current search results
   * @param options - Adequacy options
   * @param executedLayers - Layers that have been executed
   * @returns Adequacy check result
   */
  checkAdequacy(
    results: HybridSearchResult[],
    options: EarlyTerminationOptions,
    executedLayers: SearchLayer[]
  ): AdequacyCheck {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const {
      adequacyThreshold,
      minResults,
      minDiversity,
      minRelevance,
      analysis,
    } = opts;

    const reasons: string[] = [];
    let score = 0;

    // Weight components
    const weights = {
      quantity: 0.35,
      diversity: 0.25,
      relevance: 0.25,
      coverage: 0.15,
    };

    // 1. Quantity score (do we have enough results?)
    const quantityScore = Math.min(results.length / minResults, 1);
    score += quantityScore * weights.quantity;

    if (quantityScore < 1) {
      reasons.push(`Insufficient results: ${results.length}/${minResults}`);
    } else {
      reasons.push(`Sufficient results: ${results.length}`);
    }

    // 2. Diversity score (variety of entity types and layers)
    const diversityScore = this.calculateDiversityScore(results);
    score += Math.min(diversityScore / minDiversity, 1) * weights.diversity;

    if (diversityScore < minDiversity) {
      reasons.push(`Low diversity: ${diversityScore.toFixed(2)}/${minDiversity}`);
    } else {
      reasons.push(`Good diversity: ${diversityScore.toFixed(2)}`);
    }

    // 3. Relevance score (average combined score)
    const avgRelevance = results.length > 0
      ? results.reduce((sum, r) => sum + r.scores.combined, 0) / results.length
      : 0;
    const relevanceScore = Math.min(avgRelevance / minRelevance, 1);
    score += relevanceScore * weights.relevance;

    if (avgRelevance < minRelevance) {
      reasons.push(`Low relevance: ${avgRelevance.toFixed(2)}/${minRelevance}`);
    } else {
      reasons.push(`Good relevance: ${avgRelevance.toFixed(2)}`);
    }

    // 4. Coverage score (how many layers contributed)
    const contributingLayers = this.getContributingLayers(results);
    const coverageScore = contributingLayers.length / executedLayers.length;
    score += coverageScore * weights.coverage;

    if (coverageScore < 0.5) {
      reasons.push(`Low layer coverage: ${contributingLayers.length}/${executedLayers.length}`);
    } else {
      reasons.push(`Good layer coverage: ${contributingLayers.length}/${executedLayers.length}`);
    }

    // Bonus for matching required info types (if analysis provided)
    if (analysis && analysis.requiredInfoTypes.length > 0) {
      const entityTypes = new Set(results.map(r => r.entity.entityType.toLowerCase()));
      const matchedTypes = analysis.requiredInfoTypes.filter(t =>
        entityTypes.has(t) ||
        (t === 'person' && entityTypes.has('person')) ||
        (t === 'entity' && entityTypes.size > 0)
      );
      const typeMatchScore = matchedTypes.length / analysis.requiredInfoTypes.length;
      score += typeMatchScore * 0.1; // Bonus weight
      reasons.push(`Info type coverage: ${matchedTypes.length}/${analysis.requiredInfoTypes.length}`);
    }

    // Normalize score
    score = Math.min(score, 1);

    return {
      adequate: score >= adequacyThreshold,
      score,
      reasons,
      contributingLayers,
    };
  }

  /**
   * Calculate diversity score from results.
   * @private
   */
  private calculateDiversityScore(results: HybridSearchResult[]): number {
    if (results.length === 0) return 0;

    // Type diversity
    const entityTypes = new Set(results.map(r => r.entity.entityType));
    const typeDiversity = Math.min(entityTypes.size / 3, 1);

    // Layer diversity
    const layerCounts = { semantic: 0, lexical: 0, symbolic: 0 };
    for (const result of results) {
      for (const layer of result.matchedLayers) {
        layerCounts[layer]++;
      }
    }
    const activeLayers = Object.values(layerCounts).filter(c => c > 0).length;
    const layerDiversity = activeLayers / 3;

    // Combined diversity
    return (typeDiversity + layerDiversity) / 2;
  }

  /**
   * Get layers that contributed to results.
   * @private
   */
  private getContributingLayers(results: HybridSearchResult[]): SearchLayer[] {
    const layers = new Set<SearchLayer>();
    for (const result of results) {
      for (const layer of result.matchedLayers) {
        layers.add(layer);
      }
    }
    return Array.from(layers);
  }

  /**
   * Calculate adequacy score for a set of results.
   *
   * Standalone method for checking result adequacy without full search.
   *
   * @param results - Results to evaluate
   * @param options - Adequacy options
   * @returns Adequacy score (0-1)
   */
  calculateAdequacyScore(
    results: HybridSearchResult[],
    options: EarlyTerminationOptions = {}
  ): number {
    const allLayers: SearchLayer[] = ['semantic', 'lexical', 'symbolic'];
    return this.checkAdequacy(results, options, allLayers).score;
  }

  /**
   * Get the cost estimator for external use.
   */
  getCostEstimator(): QueryCostEstimator {
    return this.costEstimator;
  }
}
