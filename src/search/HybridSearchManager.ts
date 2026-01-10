/**
 * Hybrid Search Manager
 *
 * Phase 11: Orchestrates three-layer hybrid search combining
 * semantic, lexical, and symbolic signals.
 *
 * @module search/HybridSearchManager
 */

import type {
  Entity,
  HybridSearchOptions,
  HybridSearchResult,
  ReadonlyKnowledgeGraph,
  SymbolicFilters,
} from '../types/index.js';
import type { SemanticSearch } from './SemanticSearch.js';
import type { RankedSearch } from './RankedSearch.js';
import { SymbolicSearch } from './SymbolicSearch.js';
import { SEMANTIC_SEARCH_LIMITS } from '../utils/constants.js';

/**
 * Default weights for hybrid search layers.
 */
export const DEFAULT_HYBRID_WEIGHTS = {
  semantic: 0.5,
  lexical: 0.3,
  symbolic: 0.2,
};

/**
 * Hybrid Search Manager
 *
 * Combines three search layers:
 * 1. Semantic: Vector similarity via embeddings
 * 2. Lexical: Keyword matching via TF-IDF/BM25
 * 3. Symbolic: Structured metadata filtering
 *
 * @example
 * ```typescript
 * const hybrid = new HybridSearchManager(semanticSearch, rankedSearch);
 * const results = await hybrid.search(graph, 'machine learning', {
 *   semanticWeight: 0.5,
 *   lexicalWeight: 0.3,
 *   symbolicWeight: 0.2,
 *   symbolic: { tags: ['ai'] }
 * });
 * ```
 */
export class HybridSearchManager {
  private symbolicSearch: SymbolicSearch;

  constructor(
    private semanticSearch: SemanticSearch | null,
    private rankedSearch: RankedSearch
  ) {
    this.symbolicSearch = new SymbolicSearch();
  }

  /**
   * Perform hybrid search combining all three layers.
   *
   * @param graph - Knowledge graph to search
   * @param query - Search query text
   * @param options - Hybrid search options with weights
   * @returns Combined and ranked results
   */
  async search(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> = {}
  ): Promise<HybridSearchResult[]> {
    const {
      semanticWeight = DEFAULT_HYBRID_WEIGHTS.semantic,
      lexicalWeight = DEFAULT_HYBRID_WEIGHTS.lexical,
      symbolicWeight = DEFAULT_HYBRID_WEIGHTS.symbolic,
      semantic = {},
      lexical = {},
      symbolic = {},
      limit = SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT,
    } = options;

    // Normalize weights
    const totalWeight = semanticWeight + lexicalWeight + symbolicWeight;
    const normSemantic = semanticWeight / totalWeight;
    const normLexical = lexicalWeight / totalWeight;
    const normSymbolic = symbolicWeight / totalWeight;

    // Execute searches in parallel
    const [semanticResults, lexicalResults, symbolicResults] = await Promise.all([
      this.executeSemanticSearch(graph, query, semantic, limit * 2),
      this.executeLexicalSearch(query, lexical, limit * 2),
      this.executeSymbolicSearch(graph.entities, symbolic),
    ]);

    // Merge results
    const merged = this.mergeResults(
      graph.entities,
      semanticResults,
      lexicalResults,
      symbolicResults,
      { semantic: normSemantic, lexical: normLexical, symbolic: normSymbolic }
    );

    // Sort by combined score and limit
    return merged
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);
  }

  /**
   * Execute semantic search layer.
   */
  private async executeSemanticSearch(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: { minSimilarity?: number; topK?: number },
    limit: number
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    if (!this.semanticSearch) {
      return results; // Semantic search not available
    }

    try {
      const semanticResults = await this.semanticSearch.search(
        graph,
        query,
        options.topK ?? limit,
        options.minSimilarity ?? 0
      );

      for (const result of semanticResults) {
        results.set(result.entity.name, result.similarity);
      }
    } catch {
      // Semantic search may fail if not indexed
    }

    return results;
  }

  /**
   * Execute lexical search layer (TF-IDF/BM25).
   */
  private async executeLexicalSearch(
    query: string,
    _options: { useStopwords?: boolean; useStemming?: boolean },
    limit: number
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    try {
      const lexicalResults = await this.rankedSearch.searchNodesRanked(
        query,
        undefined, // tags
        undefined, // minImportance
        undefined, // maxImportance
        limit
      );

      // Normalize scores to 0-1 range
      const maxScore = Math.max(...lexicalResults.map(r => r.score), 1);
      for (const result of lexicalResults) {
        results.set(result.entity.name, result.score / maxScore);
      }
    } catch {
      // Lexical search may fail
    }

    return results;
  }

  /**
   * Execute symbolic search layer.
   */
  private executeSymbolicSearch(
    entities: readonly Entity[],
    filters: SymbolicFilters | undefined
  ): Map<string, number> {
    const results = new Map<string, number>();

    if (!filters || Object.keys(filters).length === 0) {
      // No symbolic filters, give all entities base score
      for (const entity of entities) {
        results.set(entity.name, 0.5);
      }
      return results;
    }

    const symbolicResults = this.symbolicSearch.search(entities, filters);
    for (const result of symbolicResults) {
      results.set(result.entity.name, result.score);
    }

    return results;
  }

  /**
   * Merge results from all three layers.
   */
  private mergeResults(
    entities: readonly Entity[],
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    symbolicScores: Map<string, number>,
    weights: { semantic: number; lexical: number; symbolic: number }
  ): HybridSearchResult[] {
    // Collect all unique entity names that have at least one non-zero score
    const allNames = new Set([
      ...semanticScores.keys(),
      ...lexicalScores.keys(),
      ...symbolicScores.keys(),
    ]);

    // Create entity lookup map
    const entityMap = new Map(entities.map(e => [e.name, e]));

    const results: HybridSearchResult[] = [];

    for (const name of allNames) {
      const entity = entityMap.get(name);
      if (!entity) continue;

      const semantic = semanticScores.get(name) ?? 0;
      const lexical = lexicalScores.get(name) ?? 0;
      const symbolic = symbolicScores.get(name) ?? 0;

      const combined =
        semantic * weights.semantic +
        lexical * weights.lexical +
        symbolic * weights.symbolic;

      const matchedLayers: ('semantic' | 'lexical' | 'symbolic')[] = [];
      if (semantic > 0) matchedLayers.push('semantic');
      if (lexical > 0) matchedLayers.push('lexical');
      if (symbolic > 0) matchedLayers.push('symbolic');

      // Skip if no layers matched meaningfully
      if (matchedLayers.length === 0) continue;

      results.push({
        entity,
        scores: { semantic, lexical, symbolic, combined },
        matchedLayers,
      });
    }

    return results;
  }

  /**
   * Search with full entity resolution.
   * Alias for search() since we now always resolve entities.
   */
  async searchWithEntities(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> = {}
  ): Promise<HybridSearchResult[]> {
    return this.search(graph, query, options);
  }

  /**
   * Get the symbolic search instance for direct access.
   */
  getSymbolicSearch(): SymbolicSearch {
    return this.symbolicSearch;
  }
}
