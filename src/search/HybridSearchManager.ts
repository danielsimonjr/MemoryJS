/**
 * Hybrid Search Manager - orchestrates semantic, lexical, symbolic, and
 * (optionally) graph-connectivity search layers.
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
import type { GraphRankPrior } from './GraphRankPrior.js';
import { SymbolicSearch } from './SymbolicSearch.js';
import { SEMANTIC_SEARCH_LIMITS } from '../utils/constants.js';

export const DEFAULT_HYBRID_WEIGHTS = {
  semantic: 0.5,
  lexical: 0.3,
  symbolic: 0.2,
};

/** Default number of top results whose neighbors are expanded. */
export const DEFAULT_NEIGHBOR_TOP_K = 10;
/** Default damping applied to a neighbor's inherited combined score. */
export const DEFAULT_NEIGHBOR_DAMPING = 0.3;

/** Matched-layer union including the graph-connectivity channel. */
export type HybridSearchLayer = 'semantic' | 'lexical' | 'symbolic' | 'graph';

/**
 * HybridSearchResult variant whose matchedLayers may include 'graph' and
 * whose scores may carry the normalized graph-connectivity score. Every
 * HybridSearchResult is assignable to this type; results produced with the
 * graph channel or neighbor expansion enabled conform to this shape.
 */
export interface GraphHybridSearchResult {
  entity: Entity;
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
    combined: number;
    /** Normalized graph-connectivity score. Present when the graph layer ran. */
    graph?: number;
  };
  matchedLayers: HybridSearchLayer[];
}

/** One-hop neighbor expansion options (only a single hop is supported). */
export interface NeighborExpansionOptions {
  /** Number of hops to expand. Only 1 is supported. */
  hops: 1;
  /** Number of top-ranked results to expand from (default: 10). */
  topK?: number;
  /** Damping factor applied to the parent's combined score (default: 0.3). */
  damping?: number;
}

/** Additive graph-channel options for hybrid search. All default off. */
export interface GraphHybridOptions {
  /**
   * Weight for the graph-connectivity channel (normalized PageRank via
   * GraphRankPrior). Default 0 = channel disabled. Requires a GraphRankPrior
   * to have been passed to the constructor.
   */
  graphWeight?: number;
  /**
   * One-hop neighbor expansion: after scoring, neighbors of the top-K
   * results are appended with a damped combined score and re-sorted.
   * Requires a GraphRankPrior. Off unless provided.
   */
  expandNeighbors?: NeighborExpansionOptions;
}

/**
 * Combines semantic, lexical, symbolic, and (optionally) graph-connectivity
 * search layers with configurable weights.
 */
export class HybridSearchManager {
  private symbolicSearch: SymbolicSearch;

  /**
   * @param semanticSearch - Semantic layer (null = layer disabled)
   * @param rankedSearch - Lexical layer (TF-IDF/BM25)
   * @param graphPrior - Optional graph-connectivity signal provider; when
   *   absent, the graph channel and neighbor expansion are inert
   * @param defaults - Default per-search graph options (e.g. env-configured
   *   graphWeight); per-call options override these
   */
  constructor(
    private semanticSearch: SemanticSearch | null,
    private rankedSearch: RankedSearch,
    private graphPrior: GraphRankPrior | null = null,
    private defaults: GraphHybridOptions = {}
  ) {
    this.symbolicSearch = new SymbolicSearch();
  }

  /**
   * Perform hybrid search combining all layers.
   *
   * The declared return type stays HybridSearchResult[] for compatibility;
   * when the graph channel or expandNeighbors is enabled, results conform to
   * the wider GraphHybridSearchResult shape (matchedLayers may include
   * 'graph').
   */
  async search(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> & GraphHybridOptions = {}
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
    const graphWeight = options.graphWeight ?? this.defaults.graphWeight ?? 0;
    const expandNeighbors = options.expandNeighbors ?? this.defaults.expandNeighbors;

    // Execute searches in parallel
    const [semanticResults, lexicalResults, symbolicResults] = await Promise.all([
      this.executeSemanticSearch(graph, query, semantic, limit * 2),
      this.executeLexicalSearch(query, lexical, limit * 2),
      this.executeSymbolicSearch(graph.entities, symbolic),
    ]);

    // Graph-connectivity layer: normalized PageRank over the candidate union.
    const graphActive = graphWeight > 0 && this.graphPrior !== null;
    let graphResults = new Map<string, number>();
    if (graphActive) {
      const candidateNames = new Set<string>([
        ...semanticResults.keys(),
        ...lexicalResults.keys(),
        ...symbolicResults.keys(),
      ]);
      graphResults = await this.graphPrior!.getScores([...candidateNames]);
    }

    // Normalize weights (graph participates only when active)
    const totalWeight =
      semanticWeight + lexicalWeight + symbolicWeight + (graphActive ? graphWeight : 0);
    const weights = {
      semantic: semanticWeight / totalWeight,
      lexical: lexicalWeight / totalWeight,
      symbolic: symbolicWeight / totalWeight,
      graph: graphActive ? graphWeight / totalWeight : 0,
    };

    // Create entity lookup map (shared by merge and neighbor expansion)
    const entityMap = new Map(graph.entities.map(e => [e.name, e]));

    // Merge results
    const merged = this.mergeResults(
      entityMap,
      semanticResults,
      lexicalResults,
      symbolicResults,
      graphResults,
      weights,
      graphActive
    );

    // Sort by combined score and limit
    let ranked = merged
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);

    // Optional one-hop neighbor expansion (off by default)
    if (expandNeighbors && this.graphPrior) {
      ranked = this.expandOneHop(ranked, expandNeighbors, entityMap, limit);
    }

    // Safe downcast: HybridSearchResult is assignable to GraphHybridSearchResult
    // (the wider type only adds 'graph' to the matchedLayers union and an
    // optional graph score), so the reverse assertion is structurally sound
    // for callers that never enable the graph channel.
    return ranked as HybridSearchResult[];
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
      // No symbolic filters - return empty (no symbolic signal)
      return results;
    }

    const symbolicResults = this.symbolicSearch.search(entities, filters);
    for (const result of symbolicResults) {
      results.set(result.entity.name, result.score);
    }

    return results;
  }

  /**
   * Merge results from all layers.
   */
  private mergeResults(
    entityMap: Map<string, Entity>,
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    symbolicScores: Map<string, number>,
    graphScores: Map<string, number>,
    weights: { semantic: number; lexical: number; symbolic: number; graph: number },
    graphActive: boolean
  ): GraphHybridSearchResult[] {
    // Collect all unique entity names that have at least one non-zero score.
    // Graph scores only rank existing candidates — they never introduce new
    // ones (the candidate union was built from the text layers).
    const allNames = new Set([
      ...semanticScores.keys(),
      ...lexicalScores.keys(),
      ...symbolicScores.keys(),
    ]);

    const results: GraphHybridSearchResult[] = [];

    for (const name of allNames) {
      const entity = entityMap.get(name);
      if (!entity) continue;

      const semantic = semanticScores.get(name) ?? 0;
      const lexical = lexicalScores.get(name) ?? 0;
      const symbolic = symbolicScores.get(name) ?? 0;
      const graph = graphScores.get(name) ?? 0;

      const combined =
        semantic * weights.semantic +
        lexical * weights.lexical +
        symbolic * weights.symbolic +
        graph * weights.graph;

      const matchedLayers: HybridSearchLayer[] = [];
      if (semantic > 0) matchedLayers.push('semantic');
      if (lexical > 0) matchedLayers.push('lexical');
      if (symbolic > 0) matchedLayers.push('symbolic');
      if (graphActive && graph > 0) matchedLayers.push('graph');

      // Skip if no layers matched meaningfully
      if (matchedLayers.length === 0) continue;

      results.push({
        entity,
        scores: graphActive
          ? { semantic, lexical, symbolic, combined, graph }
          : { semantic, lexical, symbolic, combined },
        matchedLayers,
      });
    }

    return results;
  }

  /**
   * One-hop neighbor expansion: append unseen neighbors of the top-K results
   * with a damped combined score (`damping * parent.combined`), tagged with
   * matchedLayers ['graph'], then re-sort and re-apply the limit.
   *
   * Neighbors already present in the result set are never duplicated.
   */
  private expandOneHop(
    results: GraphHybridSearchResult[],
    options: NeighborExpansionOptions,
    entityMap: Map<string, Entity>,
    limit: number
  ): GraphHybridSearchResult[] {
    const topK = options.topK ?? DEFAULT_NEIGHBOR_TOP_K;
    const damping = options.damping ?? DEFAULT_NEIGHBOR_DAMPING;

    const seen = new Set(results.map(r => r.entity.name));
    const added: GraphHybridSearchResult[] = [];

    for (const parent of results.slice(0, topK)) {
      for (const neighborName of this.graphPrior!.neighbors(parent.entity.name)) {
        if (seen.has(neighborName)) continue;
        const entity = entityMap.get(neighborName);
        if (!entity) continue;
        seen.add(neighborName);
        added.push({
          entity,
          scores: {
            semantic: 0,
            lexical: 0,
            symbolic: 0,
            combined: damping * parent.scores.combined,
          },
          matchedLayers: ['graph'],
        });
      }
    }

    if (added.length === 0) {
      return results;
    }

    return [...results, ...added]
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);
  }

  /**
   * Search with full entity resolution.
   * Alias for search() since we now always resolve entities.
   */
  async searchWithEntities(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> & GraphHybridOptions = {}
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
