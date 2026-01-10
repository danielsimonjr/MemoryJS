/**
 * Hybrid Scorer
 *
 * Combines semantic, lexical, and symbolic search scores with
 * min-max normalization and configurable weights.
 *
 * Phase 12 Sprint 3: Search Algorithm Optimization
 *
 * @module search/HybridScorer
 */

import type { Entity } from '../types/index.js';

/**
 * Result from semantic search layer.
 */
export interface SemanticLayerResult {
  /** Entity name */
  entityName: string;
  /** Similarity score (typically 0-1 for cosine similarity) */
  similarity: number;
  /** The matched entity (if resolved) */
  entity?: Entity;
}

/**
 * Result from lexical search layer (TF-IDF or BM25).
 */
export interface LexicalSearchResult {
  /** Entity name */
  entityName: string;
  /** Relevance score (unbounded, higher is better) */
  score: number;
  /** The matched entity (if resolved) */
  entity?: Entity;
}

/**
 * Result from symbolic search layer.
 */
export interface SymbolicSearchResult {
  /** Entity name */
  entityName: string;
  /** Match score (typically 0-1) */
  score: number;
  /** The matched entity (if resolved) */
  entity?: Entity;
}

/**
 * Combined result with scores from all layers.
 */
export interface ScoredResult {
  /** Entity name */
  entityName: string;
  /** The matched entity */
  entity: Entity;
  /** Individual layer scores (normalized 0-1) */
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
    combined: number;
  };
  /** Which layers contributed to this result */
  matchedLayers: ('semantic' | 'lexical' | 'symbolic')[];
  /** Original raw scores before normalization */
  rawScores: {
    semantic?: number;
    lexical?: number;
    symbolic?: number;
  };
}

/**
 * Configurable weights for hybrid scoring.
 */
export interface HybridWeights {
  /** Weight for semantic layer (default: 0.4) */
  semantic: number;
  /** Weight for lexical layer (default: 0.4) */
  lexical: number;
  /** Weight for symbolic layer (default: 0.2) */
  symbolic: number;
}

/**
 * Default weights for hybrid search.
 */
export const DEFAULT_SCORER_WEIGHTS: HybridWeights = {
  semantic: 0.4,
  lexical: 0.4,
  symbolic: 0.2,
};

/**
 * Options for the HybridScorer.
 */
export interface HybridScorerOptions {
  /** Weights for each layer */
  weights?: Partial<HybridWeights>;
  /** Minimum score to include in results (default: 0) */
  minScore?: number;
  /** Whether to normalize weights to sum to 1 (default: true) */
  normalizeWeights?: boolean;
}

/**
 * HybridScorer combines multiple search signals using min-max normalization.
 *
 * Features:
 * 1. Min-max normalization brings all scores to 0-1 range
 * 2. Configurable weights for each layer
 * 3. Handles missing layers gracefully (redistributes weights)
 * 4. Tracks which layers contributed to each result
 *
 * @example
 * ```typescript
 * const scorer = new HybridScorer({
 *   weights: { semantic: 0.5, lexical: 0.3, symbolic: 0.2 }
 * });
 *
 * const results = scorer.combine(
 *   semanticResults,
 *   lexicalResults,
 *   symbolicResults,
 *   entityMap
 * );
 * ```
 */
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

  /**
   * Get current weights configuration.
   */
  getWeights(): HybridWeights {
    return { ...this.weights };
  }

  /**
   * Update weights configuration.
   */
  setWeights(weights: Partial<HybridWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Perform min-max normalization on scores.
   *
   * Formula: normalized = (x - min) / (max - min)
   *
   * @param scores - Map of entity name to raw score
   * @returns Map of entity name to normalized score (0-1)
   */
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
   * Combine results from all three search layers.
   *
   * @param semanticResults - Results from semantic search
   * @param lexicalResults - Results from lexical search
   * @param symbolicResults - Results from symbolic search
   * @param entityMap - Map of entity names to Entity objects
   * @returns Array of combined results sorted by score
   */
  combine(
    semanticResults: SemanticLayerResult[],
    lexicalResults: LexicalSearchResult[],
    symbolicResults: SymbolicSearchResult[],
    entityMap: Map<string, Entity>
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

    // Normalize scores
    const normalizedSemantic = this.minMaxNormalize(semanticScores);
    const normalizedLexical = this.minMaxNormalize(lexicalScores);
    const normalizedSymbolic = this.minMaxNormalize(symbolicScores);

    // Calculate effective weights
    let effectiveWeights = { ...this.weights };
    if (this.normalizeWeights) {
      effectiveWeights = this.getNormalizedWeights(
        semanticResults.length > 0,
        lexicalResults.length > 0,
        symbolicResults.length > 0
      );
    }

    // Collect all unique entity names
    const allNames = new Set<string>([
      ...normalizedSemantic.keys(),
      ...normalizedLexical.keys(),
      ...normalizedSymbolic.keys(),
    ]);

    // Calculate combined scores
    const results: ScoredResult[] = [];
    for (const entityName of allNames) {
      const entity = entityMap.get(entityName);
      if (!entity) continue;

      const semanticScore = normalizedSemantic.get(entityName) ?? 0;
      const lexicalScore = normalizedLexical.get(entityName) ?? 0;
      const symbolicScore = normalizedSymbolic.get(entityName) ?? 0;

      // Calculate weighted combination
      const combined =
        semanticScore * effectiveWeights.semantic +
        lexicalScore * effectiveWeights.lexical +
        symbolicScore * effectiveWeights.symbolic;

      // Track matched layers
      const matchedLayers: ('semantic' | 'lexical' | 'symbolic')[] = [];
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
          combined,
        },
        matchedLayers,
        rawScores,
      });
    }

    // Sort by combined score descending
    return results.sort((a, b) => b.scores.combined - a.scores.combined);
  }

  /**
   * Get weights normalized to sum to 1, redistributing for missing layers.
   *
   * @param hasSemantic - Whether semantic results are available
   * @param hasLexical - Whether lexical results are available
   * @param hasSymbolic - Whether symbolic results are available
   * @returns Normalized weights
   */
  getNormalizedWeights(
    hasSemantic: boolean,
    hasLexical: boolean,
    hasSymbolic: boolean
  ): HybridWeights {
    let totalActiveWeight = 0;
    if (hasSemantic) totalActiveWeight += this.weights.semantic;
    if (hasLexical) totalActiveWeight += this.weights.lexical;
    if (hasSymbolic) totalActiveWeight += this.weights.symbolic;

    // If no layers are active, return zero weights
    if (totalActiveWeight === 0) {
      return { semantic: 0, lexical: 0, symbolic: 0 };
    }

    // Normalize active weights to sum to 1
    return {
      semantic: hasSemantic ? this.weights.semantic / totalActiveWeight : 0,
      lexical: hasLexical ? this.weights.lexical / totalActiveWeight : 0,
      symbolic: hasSymbolic ? this.weights.symbolic / totalActiveWeight : 0,
    };
  }

  /**
   * Combine scores from maps directly (alternative interface).
   *
   * @param semanticScores - Map of entity name to semantic score
   * @param lexicalScores - Map of entity name to lexical score
   * @param symbolicScores - Map of entity name to symbolic score
   * @param entityMap - Map of entity names to Entity objects
   * @returns Array of combined results sorted by score
   */
  combineFromMaps(
    semanticScores: Map<string, number>,
    lexicalScores: Map<string, number>,
    symbolicScores: Map<string, number>,
    entityMap: Map<string, Entity>
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

    return this.combine(semanticResults, lexicalResults, symbolicResults, entityMap);
  }

  /**
   * Calculate combined score for a single entity.
   *
   * Useful for scoring individual results without full normalization.
   *
   * @param semanticScore - Normalized semantic score (0-1)
   * @param lexicalScore - Normalized lexical score (0-1)
   * @param symbolicScore - Normalized symbolic score (0-1)
   * @returns Combined weighted score
   */
  calculateScore(
    semanticScore: number,
    lexicalScore: number,
    symbolicScore: number
  ): number {
    return (
      semanticScore * this.weights.semantic +
      lexicalScore * this.weights.lexical +
      symbolicScore * this.weights.symbolic
    );
  }
}
