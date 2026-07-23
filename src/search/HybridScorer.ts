/**
 * Hybrid Scorer - combines search scores with min-max normalization and configurable weights.
 * @module search/HybridScorer
 */

import type { Entity } from '../types/index.js';

export interface SemanticLayerResult {
  entityName: string;
  similarity: number;
  entity?: Entity;
}

export interface LexicalSearchResult {
  entityName: string;
  score: number;
  entity?: Entity;
}

export interface SymbolicSearchResult {
  entityName: string;
  score: number;
  entity?: Entity;
}

/**
 * Result from the graph-connectivity layer (e.g. normalized PageRank from
 * GraphRankPrior). Same shape as the symbolic layer results.
 */
export type GraphLayerResult = SymbolicSearchResult;

export interface ScoredResult {
  entityName: string;
  entity: Entity;
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
    graph: number;
    combined: number;
  };
  matchedLayers: ('semantic' | 'lexical' | 'symbolic' | 'graph')[];
  rawScores: {
    semantic?: number;
    lexical?: number;
    symbolic?: number;
    graph?: number;
  };
}

export interface HybridWeights {
  semantic: number;
  lexical: number;
  symbolic: number;
  /** Graph-connectivity channel weight. Default 0 = disabled (legacy behavior). */
  graph: number;
}

export const DEFAULT_SCORER_WEIGHTS: HybridWeights = {
  semantic: 0.4,
  lexical: 0.4,
  symbolic: 0.2,
  graph: 0,
};

export interface HybridScorerOptions {
  weights?: Partial<HybridWeights>;
  minScore?: number;
  normalizeWeights?: boolean;
}

/** Combines multiple search signals using min-max normalization and configurable weights. */
export class HybridScorer {
  private weights: HybridWeights;
  private minScore: number;
  private normalizeWeights: boolean;

  constructor(options: HybridScorerOptions = {}) {
    this.weights = {
      ...DEFAULT_SCORER_WEIGHTS,
      ...options.weights,
    };
    this.minScore = options.minScore ?? 0;
    this.normalizeWeights = options.normalizeWeights ?? true;
  }

  /** Get current weights configuration. */
  getWeights(): HybridWeights {
    return { ...this.weights };
  }

  /** Update weights configuration. */
  setWeights(weights: Partial<HybridWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /** Min-max normalize scores to 0-1 range. */
  minMaxNormalize(scores: Map<string, number>): Map<string, number> {
    if (scores.size === 0) {
      return new Map();
    }

    // Find min and max
    let min = Infinity;
    let max = -Infinity;
    for (const score of scores.values()) {
      if (score < min) min = score;
      if (score > max) max = score;
    }

    // Handle edge case where all scores are the same
    if (max === min) {
      const normalized = new Map<string, number>();
      for (const name of scores.keys()) {
        // If all scores are zero, keep them zero; otherwise normalize to 1
        normalized.set(name, max === 0 ? 0 : 1);
      }
      return normalized;
    }

    // Normalize
    const range = max - min;
    const normalized = new Map<string, number>();
    for (const [name, score] of scores) {
      normalized.set(name, (score - min) / range);
    }

    return normalized;
  }

  /**
   * Combine results from all search layers.
   *
   * @param semanticResults - Semantic similarity layer results
   * @param lexicalResults - Lexical (TF-IDF/BM25) layer results
   * @param symbolicResults - Symbolic/metadata layer results
   * @param entityMap - Entity lookup map by name
   * @param graphResults - Optional graph-connectivity layer results
   *   (default: empty — legacy three-layer behavior)
   */
  combine(
    semanticResults: SemanticLayerResult[],
    lexicalResults: LexicalSearchResult[],
    symbolicResults: SymbolicSearchResult[],
    entityMap: Map<string, Entity>,
    graphResults: GraphLayerResult[] = []
  ): ScoredResult[] {
    // Build score maps
    const semanticScores = new Map<string, number>();
    for (const result of semanticResults) {
      semanticScores.set(result.entityName, result.similarity);
    }

    const lexicalScores = new Map<string, number>();
    for (const result of lexicalResults) {
      lexicalScores.set(result.entityName, result.score);
    }

    const symbolicScores = new Map<string, number>();
    for (const result of symbolicResults) {
      symbolicScores.set(result.entityName, result.score);
    }

    const graphScores = new Map<string, number>();
    for (const result of graphResults) {
      graphScores.set(result.entityName, result.score);
    }

    // Normalize scores
    const normalizedSemantic = this.minMaxNormalize(semanticScores);
    const normalizedLexical = this.minMaxNormalize(lexicalScores);
    const normalizedSymbolic = this.minMaxNormalize(symbolicScores);
    const normalizedGraph = this.minMaxNormalize(graphScores);

    // Calculate effective weights
    let effectiveWeights = { ...this.weights };
    if (this.normalizeWeights) {
      effectiveWeights = this.getNormalizedWeights(
        semanticResults.length > 0,
        lexicalResults.length > 0,
        symbolicResults.length > 0,
        graphResults.length > 0
      );
    }

    // Collect all unique entity names
    const allNames = new Set<string>([
      ...normalizedSemantic.keys(),
      ...normalizedLexical.keys(),
      ...normalizedSymbolic.keys(),
      ...normalizedGraph.keys(),
    ]);

    // Calculate combined scores
    const results: ScoredResult[] = [];
    for (const entityName of allNames) {
      const entity = entityMap.get(entityName);
      if (!entity) continue;

      const semanticScore = normalizedSemantic.get(entityName) ?? 0;
      const lexicalScore = normalizedLexical.get(entityName) ?? 0;
      const symbolicScore = normalizedSymbolic.get(entityName) ?? 0;
      const graphScore = normalizedGraph.get(entityName) ?? 0;

      // Calculate weighted combination
      const combined =
        semanticScore * effectiveWeights.semantic +
        lexicalScore * effectiveWeights.lexical +
        symbolicScore * effectiveWeights.symbolic +
        graphScore * effectiveWeights.graph;

      // Track matched layers
      const matchedLayers: ScoredResult['matchedLayers'] = [];
      const rawScores: ScoredResult['rawScores'] = {};

      if (semanticScores.has(entityName)) {
        matchedLayers.push('semantic');
        rawScores.semantic = semanticScores.get(entityName);
      }
      if (lexicalScores.has(entityName)) {
        matchedLayers.push('lexical');
        rawScores.lexical = lexicalScores.get(entityName);
      }
      if (symbolicScores.has(entityName)) {
        matchedLayers.push('symbolic');
        rawScores.symbolic = symbolicScores.get(entityName);
      }
      if (graphScores.has(entityName)) {
        matchedLayers.push('graph');
        rawScores.graph = graphScores.get(entityName);
      }

      // Skip if below minimum score or no layers matched
      if (combined < this.minScore || matchedLayers.length === 0) {
        continue;
      }

      results.push({
        entityName,
        entity,
        scores: {
          semantic: semanticScore,
          lexical: lexicalScore,
          symbolic: symbolicScore,
          graph: graphScore,
          combined,
        },
        matchedLayers,
        rawScores,
      });
    }

    // Sort by combined score descending
    return results.sort((a, b) => b.scores.combined - a.scores.combined);
  }

  /** Get weights normalized to sum to 1, redistributing for missing layers. */
  getNormalizedWeights(
    hasSemantic: boolean,
    hasLexical: boolean,
    hasSymbolic: boolean,
    hasGraph: boolean = false
  ): HybridWeights {
    let totalActiveWeight = 0;
    if (hasSemantic) totalActiveWeight += this.weights.semantic;
    if (hasLexical) totalActiveWeight += this.weights.lexical;
    if (hasSymbolic) totalActiveWeight += this.weights.symbolic;
    if (hasGraph) totalActiveWeight += this.weights.graph;

    // If no layers are active, return zero weights
    if (totalActiveWeight === 0) {
      return { semantic: 0, lexical: 0, symbolic: 0, graph: 0 };
    }

    // Normalize active weights to sum to 1
    return {
      semantic: hasSemantic ? this.weights.semantic / totalActiveWeight : 0,
      lexical: hasLexical ? this.weights.lexical / totalActiveWeight : 0,
      symbolic: hasSymbolic ? this.weights.symbolic / totalActiveWeight : 0,
      graph: hasGraph ? this.weights.graph / totalActiveWeight : 0,
    };
  }

  /** Combine scores from maps directly (alternative interface). */
  combineFromMaps(
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    symbolicScores: Map<string, number>,
    entityMap: Map<string, Entity>,
    graphScores: Map<string, number> = new Map()
  ): ScoredResult[] {
    // Convert maps to result arrays
    const semanticResults: SemanticLayerResult[] = [];
    for (const [entityName, similarity] of semanticScores) {
      semanticResults.push({ entityName, similarity });
    }

    const lexicalResults: LexicalSearchResult[] = [];
    for (const [entityName, score] of lexicalScores) {
      lexicalResults.push({ entityName, score });
    }

    const symbolicResults: SymbolicSearchResult[] = [];
    for (const [entityName, score] of symbolicScores) {
      symbolicResults.push({ entityName, score });
    }

    const graphResults: GraphLayerResult[] = [];
    for (const [entityName, score] of graphScores) {
      graphResults.push({ entityName, score });
    }

    return this.combine(
      semanticResults,
      lexicalResults,
      symbolicResults,
      entityMap,
      graphResults
    );
  }

  /** Calculate combined score for a single entity. */
  calculateScore(
    semanticScore: number,
    lexicalScore: number,
    symbolicScore: number,
    graphScore: number = 0
  ): number {
    return (
      semanticScore * this.weights.semantic +
      lexicalScore * this.weights.lexical +
      symbolicScore * this.weights.symbolic +
      graphScore * this.weights.graph
    );
  }
}
