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
import type { EvidencePath, EvidencePathOptions } from '../types/search.js';
import { EvidencePathBuilder, type EvidenceAnchor } from './EvidencePathBuilder.js';
import { jaccard, tokenizeToSet } from '../utils/textSimilarity.js';

export const DEFAULT_HYBRID_WEIGHTS = {
  semantic: 0.5,
  lexical: 0.3,
  symbolic: 0.2,
};

/** Default number of top results whose neighbors are expanded. */
export const DEFAULT_NEIGHBOR_TOP_K = 10;
/** Default damping applied to a neighbor's inherited combined score. */
export const DEFAULT_NEIGHBOR_DAMPING = 0.3;

/**
 * Matched-layer union including the graph-connectivity channel.
 *
 * @deprecated The canonical `HybridSearchResult['matchedLayers']` union
 * (src/types) now includes `'graph'`. Use
 * `HybridSearchResult['matchedLayers'][number]` instead. Kept as an alias
 * for back-compat (exported from the search barrel).
 */
export type HybridSearchLayer = HybridSearchResult['matchedLayers'][number];
/** Text layers that can be executed independently. */
export type HybridExecutableLayer = Exclude<HybridSearchLayer, 'graph'>;

/**
 * HybridSearchResult variant whose scores may carry the normalized
 * graph-connectivity score. Now that the canonical `matchedLayers` union
 * includes `'graph'`, this type differs from HybridSearchResult only by
 * the optional `scores.graph` field, so every GraphHybridSearchResult is a
 * valid HybridSearchResult (and vice versa when the graph layer did not
 * run). Results produced with the graph channel enabled conform to this
 * shape.
 */
export interface GraphHybridSearchResult extends HybridSearchResult {
  scores: HybridSearchResult['scores'] & {
    /** Normalized graph-connectivity score. Present when the graph layer ran. */
    graph?: number;
  };
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

/**
 * R2/R7 additive options for hybrid search. All default off — when absent,
 * search behavior and result shapes are byte-identical to before these
 * options existed.
 */
export interface ExplainHybridOptions {
  /**
   * R2: when true, each result is annotated with `evidencePaths` — the
   * graph paths connecting the query's direct anchor matches to the result
   * — plus an `evidenceTruncated` flag. Default false = zero cost.
   */
  explain?: boolean;
  /** Caps for evidence-path construction (maxDepth, maxPathsPerResult). */
  explainOptions?: EvidencePathOptions;
  /**
   * R7: free-text description of the desired connection. When neighbor
   * expansion (`expandNeighbors`) runs, expansion neighbors are ranked by
   * similarity between this text and each neighbor's descriptor and carry
   * a `lookForScore`; equal-scored neighbors are ordered best-match first.
   */
  lookFor?: string;
}

/**
 * HybridSearchResult variant carrying the R2/R7 optional annotations.
 * All fields are optional, so every ExplainedHybridSearchResult is a valid
 * HybridSearchResult (same extension precedent as GraphHybridSearchResult).
 */
export interface ExplainedHybridSearchResult extends GraphHybridSearchResult {
  /** R2: evidence paths from query anchors to this result (explain: true). */
  evidencePaths?: EvidencePath[];
  /** R2: true when evidence-path caps (maxDepth/maxPathsPerResult) bit. */
  evidenceTruncated?: boolean;
  /** R7: similarity of this expansion neighbor's descriptor to `lookFor`. */
  lookForScore?: number;
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
   * When the graph channel or expandNeighbors is enabled, matchedLayers may
   * include 'graph' and results additionally conform to
   * GraphHybridSearchResult (`scores.graph` carries the normalized
   * graph-connectivity score).
   */
  async search(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> & GraphHybridOptions & ExplainHybridOptions = {}
  ): Promise<ExplainedHybridSearchResult[]> {
    const {
      semanticWeight = DEFAULT_HYBRID_WEIGHTS.semantic,
      lexicalWeight = DEFAULT_HYBRID_WEIGHTS.lexical,
      symbolicWeight = DEFAULT_HYBRID_WEIGHTS.symbolic,
      semantic = {},
      lexical = {},
      symbolic = {},
      limit = SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT,
      explain = false,
      explainOptions,
      lookFor,
    } = options;
    const graphWeight = options.graphWeight ?? this.defaults.graphWeight ?? 0;
    const expandNeighbors = options.expandNeighbors ?? this.defaults.expandNeighbors;

    // Execute only positively weighted channels. In particular, this keeps
    // semantic embedding calls off the hot path when semanticWeight is zero.
    const emptyScores = (): Map<string, number> => new Map<string, number>();
    const [semanticResults, lexicalResults, symbolicResults] = await Promise.all([
      semanticWeight > 0
        ? this.executeSemanticSearch(graph, query, semantic, limit * 2)
        : Promise.resolve(emptyScores()),
      lexicalWeight > 0
        ? this.executeLexicalSearch(query, lexical, limit * 2)
        : Promise.resolve(emptyScores()),
      symbolicWeight > 0
        ? Promise.resolve(this.executeSymbolicSearch(graph.entities, symbolic))
        : Promise.resolve(emptyScores()),
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
    if (totalWeight <= 0) return [];
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
    let ranked: ExplainedHybridSearchResult[] = merged
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);

    // Optional one-hop neighbor expansion (off by default)
    if (expandNeighbors && this.graphPrior) {
      ranked = await this.expandOneHop(ranked, expandNeighbors, entityMap, limit, lookFor);
    }

    // R2: annotate results with traceable evidence paths (off by default —
    // nothing below runs and result objects are untouched unless requested).
    if (explain === true) {
      const anchors = this.collectAnchors(
        entityMap,
        semanticResults,
        lexicalResults,
        symbolicResults
      );
      const builder = new EvidencePathBuilder(graph, explainOptions);
      for (const result of ranked) {
        const { paths, truncated } = builder.buildForResult(result.entity.name, anchors);
        result.evidencePaths = paths;
        result.evidenceTruncated = truncated;
      }
    }

    return ranked;
  }

  /**
   * Execute exactly one text layer and shape its scores as hybrid results.
   * Used by EarlyTerminationManager so each cost-ordered layer runs once,
   * without repeatedly invoking the full hybrid orchestration.
   */
  async searchLayer(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    layer: HybridExecutableLayer,
    options: Partial<HybridSearchOptions> = {},
  ): Promise<HybridSearchResult[]> {
    const limit = options.limit ?? SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT;
    const empty = new Map<string, number>();
    let semanticResults = empty;
    let lexicalResults = empty;
    let symbolicResults = empty;

    switch (layer) {
      case 'semantic':
        semanticResults = await this.executeSemanticSearch(
          graph,
          query,
          options.semantic ?? {},
          limit * 2,
        );
        break;
      case 'lexical':
        lexicalResults = await this.executeLexicalSearch(
          query,
          options.lexical ?? {},
          limit * 2,
        );
        break;
      case 'symbolic':
        symbolicResults = this.executeSymbolicSearch(
          graph.entities,
          options.symbolic ?? {},
        );
        break;
    }

    const entityMap = new Map(graph.entities.map(entity => [entity.name, entity]));
    return this.mergeResults(
      entityMap,
      semanticResults,
      lexicalResults,
      symbolicResults,
      new Map(),
      {
        semantic: layer === 'semantic' ? 1 : 0,
        lexical: layer === 'lexical' ? 1 : 0,
        symbolic: layer === 'symbolic' ? 1 : 0,
        graph: 0,
      },
      false,
    )
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);
  }

  /**
   * R2: collect anchor entities — entities that directly matched query terms
   * in a text layer. When an entity matched several layers, viaLayer follows
   * the priority semantic > lexical > symbolic; the anchor score is the
   * matched layer's score (used to order anchors before caps apply).
   * Graph-channel scores are connectivity priors, not query-term matches,
   * so they never mint anchors.
   */
  private collectAnchors(
    entityMap: Map<string, Entity>,
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    symbolicScores: Map<string, number>
  ): EvidenceAnchor[] {
    const anchors: EvidenceAnchor[] = [];
    const seen = new Set<string>();
    const layers: Array<[EvidenceAnchor['viaLayer'], Map<string, number>]> = [
      ['semantic', semanticScores],
      ['lexical', lexicalScores],
      ['symbolic', symbolicScores],
    ];

    for (const [viaLayer, scores] of layers) {
      for (const [name, score] of scores) {
        if (seen.has(name) || score <= 0 || !entityMap.has(name)) continue;
        seen.add(name);
        anchors.push({ name, viaLayer, score });
      }
    }

    return anchors;
  }

  /**
   * R7: score a candidate neighbor descriptor against `lookFor`. Prefers
   * the semantic layer's `calculateSimilarity` when available; any failure
   * (no provider, provider not ready) falls back to lexical token-overlap.
   */
  private async scoreLookFor(lookFor: string, descriptor: string): Promise<number> {
    if (this.semanticSearch) {
      try {
        return await this.semanticSearch.calculateSimilarity(lookFor, descriptor);
      } catch {
        // Fall through to lexical scoring
      }
    }
    return jaccard(tokenizeToSet(lookFor), tokenizeToSet(descriptor));
  }

  /**
   * R7: descriptor string an expansion neighbor is ranked by. The relation
   * type is unavailable from GraphRankPrior.neighbors(), so the descriptor
   * is `name + entityType + leading observation characters`.
   */
  private buildNeighborDescriptor(entity: Entity): string {
    const observations = entity.observations.join(' ').slice(0, 200);
    return `${entity.name} ${entity.entityType} ${observations}`.trim();
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

      const matchedLayers: HybridSearchResult['matchedLayers'] = [];
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
   *
   * R7: when `lookFor` is set, every added neighbor is scored against it
   * (semantic similarity when available, lexical fallback) and carries a
   * `lookForScore`; the final re-sort breaks combined-score ties by
   * lookForScore so same-parent neighbors surface best-match first.
   * When `lookFor` is absent, behavior is byte-identical to before.
   */
  private async expandOneHop(
    results: ExplainedHybridSearchResult[],
    options: NeighborExpansionOptions,
    entityMap: Map<string, Entity>,
    limit: number,
    lookFor?: string
  ): Promise<ExplainedHybridSearchResult[]> {
    const topK = options.topK ?? DEFAULT_NEIGHBOR_TOP_K;
    const damping = options.damping ?? DEFAULT_NEIGHBOR_DAMPING;

    const seen = new Set(results.map(r => r.entity.name));
    const added: ExplainedHybridSearchResult[] = [];

    for (const parent of results.slice(0, topK)) {
      for (const neighborName of this.graphPrior!.neighbors(parent.entity.name)) {
        if (seen.has(neighborName)) continue;
        const entity = entityMap.get(neighborName);
        if (!entity) continue;
        seen.add(neighborName);
        const neighborResult: ExplainedHybridSearchResult = {
          entity,
          scores: {
            semantic: 0,
            lexical: 0,
            symbolic: 0,
            combined: damping * parent.scores.combined,
          },
          matchedLayers: ['graph'],
        };
        if (lookFor !== undefined) {
          neighborResult.lookForScore = await this.scoreLookFor(
            lookFor,
            this.buildNeighborDescriptor(entity)
          );
        }
        added.push(neighborResult);
      }
    }

    if (added.length === 0) {
      return results;
    }

    const comparator =
      lookFor !== undefined
        ? (a: ExplainedHybridSearchResult, b: ExplainedHybridSearchResult) =>
            b.scores.combined - a.scores.combined ||
            (b.lookForScore ?? 0) - (a.lookForScore ?? 0)
        : (a: ExplainedHybridSearchResult, b: ExplainedHybridSearchResult) =>
            b.scores.combined - a.scores.combined;

    return [...results, ...added].sort(comparator).slice(0, limit);
  }

  /**
   * Search with full entity resolution.
   * Alias for search() since we now always resolve entities.
   */
  async searchWithEntities(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: Partial<HybridSearchOptions> & GraphHybridOptions & ExplainHybridOptions = {}
  ): Promise<ExplainedHybridSearchResult[]> {
    return this.search(graph, query, options);
  }

  /**
   * Get the symbolic search instance for direct access.
   */
  getSymbolicSearch(): SymbolicSearch {
    return this.symbolicSearch;
  }
}
