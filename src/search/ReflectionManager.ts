/**
 * Reflection Manager
 *
 * Phase 11: Implements reflection-based iterative retrieval
 * that refines results until adequate.
 *
 * @module search/ReflectionManager
 */

import type {
  ReadonlyKnowledgeGraph,
  QueryAnalysis,
  HybridSearchResult,
  HybridSearchOptions,
} from '../types/index.js';
import type { HybridSearchManager } from './HybridSearchManager.js';
import type { QueryAnalyzer } from './QueryAnalyzer.js';

/**
 * Options for reflection-based retrieval.
 */
export interface ReflectionOptions {
  /** Maximum number of reflection iterations (default: 3) */
  maxIterations?: number;
  /** Adequacy threshold 0-1 (default: 0.7) */
  adequacyThreshold?: number;
  /** Minimum results required (default: 3) */
  minResults?: number;
  /** Hybrid search options */
  searchOptions?: Partial<HybridSearchOptions>;
  /** Phase 12 Sprint 4: Progressive limit increase factor (default: 1.5) */
  limitIncreaseFactor?: number;
  /** Phase 12 Sprint 4: Initial search limit (default: 10) */
  initialLimit?: number;
  /** Phase 12 Sprint 4: Focus on specific missing info types */
  focusMissingTypes?: boolean;
}

/**
 * Phase 12 Sprint 4: Refinement history entry.
 */
export interface RefinementHistoryEntry {
  /** Iteration number (1-based) */
  iteration: number;
  /** Query used in this iteration */
  query: string;
  /** Search limit used */
  limit: number;
  /** Results found in this iteration */
  resultsFound: number;
  /** Adequacy score after this iteration */
  adequacyScore: number;
  /** Reason for refinement (if not final) */
  refinementReason?: string;
  /** Missing info types that triggered refinement */
  missingInfoTypes?: string[];
}

/**
 * Result of reflection-based retrieval.
 */
export interface ReflectionResult {
  results: HybridSearchResult[];
  iterations: number;
  adequate: boolean;
  refinements: string[];
  adequacyScore: number;
  /** Phase 12 Sprint 4: Detailed refinement history */
  refinementHistory: RefinementHistoryEntry[];
  /** Phase 12 Sprint 4: Final search limit used */
  finalLimit: number;
}

/**
 * Reflection Manager for iterative retrieval refinement.
 *
 * Implements the SimpleMem-inspired reflection loop:
 * 1. Execute initial search
 * 2. Check result adequacy
 * 3. If inadequate, refine query and repeat
 * 4. Combine results from all iterations
 *
 * @example
 * ```typescript
 * const reflection = new ReflectionManager(hybridSearch, analyzer);
 * const result = await reflection.retrieveWithReflection(
 *   graph,
 *   'What projects did Alice work on?',
 *   { maxIterations: 3 }
 * );
 * ```
 */
export class ReflectionManager {
  constructor(
    private hybridSearch: HybridSearchManager,
    private analyzer: QueryAnalyzer
  ) {}

  /**
   * Perform retrieval with reflection-based refinement.
   *
   * Phase 12 Sprint 4 enhancements:
   * - Progressive limit increase per round
   * - Focused query refinement based on missing information
   * - Detailed refinement history tracking
   */
  async retrieveWithReflection(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: ReflectionOptions = {}
  ): Promise<ReflectionResult> {
    const {
      maxIterations = 3,
      adequacyThreshold = 0.7,
      minResults = 3,
      searchOptions = {},
      limitIncreaseFactor = 1.5,
      initialLimit = 10,
      focusMissingTypes = true,
    } = options;

    const allResults: HybridSearchResult[] = [];
    const refinements: string[] = [];
    const refinementHistory: RefinementHistoryEntry[] = [];
    let currentQuery = query;
    let iteration = 0;
    let adequacyScore = 0;
    let currentLimit = initialLimit;

    // Get initial analysis for tracking
    const analysis = this.analyzer.analyze(query);

    while (iteration < maxIterations) {
      iteration++;

      // Calculate current limit with progressive increase
      currentLimit = Math.round(initialLimit * Math.pow(limitIncreaseFactor, iteration - 1));

      // Execute search with current limit
      const results = await this.hybridSearch.searchWithEntities(
        graph,
        currentQuery,
        { ...searchOptions, limit: currentLimit }
      );

      // Track results found this iteration (before deduplication)
      const newResultsCount = results.filter(
        r => !allResults.some(existing => existing.entity.name === r.entity.name)
      ).length;

      // Add new results (deduplicated)
      for (const result of results) {
        if (!allResults.some(r => r.entity.name === result.entity.name)) {
          allResults.push(result);
        }
      }

      // Check adequacy
      const iterAnalysis = this.analyzer.analyze(currentQuery);
      adequacyScore = this.calculateAdequacy(allResults, iterAnalysis, minResults);

      // Determine missing info types
      const missingInfoTypes = this.findMissingInfoTypes(allResults, analysis);

      // Record history entry
      const historyEntry: RefinementHistoryEntry = {
        iteration,
        query: currentQuery,
        limit: currentLimit,
        resultsFound: newResultsCount,
        adequacyScore,
      };

      if (adequacyScore >= adequacyThreshold) {
        refinementHistory.push(historyEntry);
        break;
      }

      // Refine query if not adequate
      const refinedQuery = focusMissingTypes && missingInfoTypes.length > 0
        ? this.refineQueryFocused(currentQuery, allResults, analysis, missingInfoTypes)
        : this.refineQuery(currentQuery, allResults, analysis);

      if (refinedQuery === currentQuery) {
        // No refinement possible
        historyEntry.refinementReason = 'No further refinement possible';
        refinementHistory.push(historyEntry);
        break;
      }

      // Record refinement details in history
      historyEntry.refinementReason = this.getRefinementReason(
        currentQuery,
        refinedQuery,
        missingInfoTypes
      );
      historyEntry.missingInfoTypes = missingInfoTypes;
      refinementHistory.push(historyEntry);

      refinements.push(refinedQuery);
      currentQuery = refinedQuery;
    }

    return {
      results: allResults.sort((a, b) => b.scores.combined - a.scores.combined),
      iterations: iteration,
      adequate: adequacyScore >= adequacyThreshold,
      refinements,
      adequacyScore,
      refinementHistory,
      finalLimit: currentLimit,
    };
  }

  /**
   * Find missing information types based on analysis requirements.
   * @private
   */
  private findMissingInfoTypes(
    results: HybridSearchResult[],
    analysis: QueryAnalysis
  ): string[] {
    const coveredTypes = new Set<string>();

    for (const result of results) {
      const entityType = result.entity.entityType.toLowerCase();
      coveredTypes.add(entityType);

      // Map entity types to info types
      if (['person', 'people', 'user', 'employee'].includes(entityType)) {
        coveredTypes.add('person');
      }
      if (['location', 'place', 'city', 'country', 'address'].includes(entityType)) {
        coveredTypes.add('location');
      }
      if (result.entity.createdAt || result.entity.lastModified) {
        coveredTypes.add('temporal');
      }
      // Entity type covers 'entity' requirement
      coveredTypes.add('entity');
    }

    // Find which required types are missing
    return analysis.requiredInfoTypes.filter(type => !coveredTypes.has(type));
  }

  /**
   * Refine query with focus on missing information types.
   * @private
   */
  private refineQueryFocused(
    query: string,
    results: HybridSearchResult[],
    analysis: QueryAnalysis,
    missingInfoTypes: string[]
  ): string {
    const additions: string[] = [];

    for (const missingType of missingInfoTypes) {
      switch (missingType) {
        case 'person':
          additions.push('person people who');
          break;
        case 'location':
          additions.push('location place where');
          break;
        case 'temporal':
          additions.push('when date time');
          break;
        case 'quantity':
          additions.push('count number how many');
          break;
        case 'reason':
          additions.push('reason why because');
          break;
      }
    }

    if (additions.length > 0) {
      // Add relevant keywords to query
      return `${query} ${additions.slice(0, 2).join(' ')}`;
    }

    // Fallback to standard refinement
    return this.refineQuery(query, results, analysis);
  }

  /**
   * Get human-readable reason for refinement.
   * @private
   */
  private getRefinementReason(
    _originalQuery: string,
    refinedQuery: string,
    missingInfoTypes: string[]
  ): string {
    if (missingInfoTypes.length > 0) {
      return `Added keywords for missing info types: ${missingInfoTypes.join(', ')}`;
    }

    if (refinedQuery.includes('person people')) {
      return 'Expanded query to find person-related entities';
    }

    if (refinedQuery.includes('recent history timeline')) {
      return 'Added temporal context to query';
    }

    return 'Broadened query by removing constraints';
  }

  /**
   * Calculate result adequacy score.
   */
  private calculateAdequacy(
    results: HybridSearchResult[],
    analysis: QueryAnalysis,
    minResults: number
  ): number {
    let score = 0;
    const weights = { quantity: 0.4, diversity: 0.3, relevance: 0.3 };

    // Quantity: Do we have enough results?
    const quantityScore = Math.min(results.length / minResults, 1);
    score += quantityScore * weights.quantity;

    // Diversity: Do results cover different entity types?
    const types = new Set(results.map(r => r.entity.entityType));
    const diversityScore = Math.min(types.size / 3, 1);
    score += diversityScore * weights.diversity;

    // Relevance: Average combined score
    const avgScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.scores.combined, 0) / results.length
      : 0;
    score += avgScore * weights.relevance;

    // Suppress unused parameter warning - analysis reserved for future enhancements
    void analysis;

    return score;
  }

  /**
   * Refine query based on current results and analysis.
   */
  private refineQuery(
    query: string,
    results: HybridSearchResult[],
    analysis: QueryAnalysis
  ): string {
    // Check what information types are missing
    const coveredTypes = new Set<string>();
    for (const result of results) {
      coveredTypes.add(result.entity.entityType.toLowerCase());
    }

    // If looking for persons but no person results, refine
    if (analysis.requiredInfoTypes.includes('person') && !coveredTypes.has('person')) {
      return `${query} person people`;
    }

    // If temporal query but no temporal context, add time hint
    if (analysis.temporalRange && results.length < 3) {
      return `${query} recent history timeline`;
    }

    // Broaden query by removing constraints
    const broader = query.replace(/\b(only|just|exactly|specific)\b/gi, '');
    if (broader !== query) {
      return broader.trim();
    }

    return query;
  }
}
