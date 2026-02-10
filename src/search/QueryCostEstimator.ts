/**
 * Estimates the cost of different search methods and recommends the optimal
 * method based on query characteristics and graph size. Also provides
 * adaptive depth calculation, layer recommendations, and token estimation.
 *
 * @module search/QueryCostEstimator
 */

import type {
  SearchMethod,
  QueryCostEstimate,
  QueryCostEstimatorOptions,
  QueryAnalysis,
} from '../types/index.js';

/** Layer type for hybrid search. */
export type SearchLayer = 'semantic' | 'lexical' | 'symbolic';

/** Extended cost estimate with layer recommendations. */
export interface ExtendedQueryCostEstimate extends QueryCostEstimate {
  /** Recommended layers in priority order */
  recommendedLayers: SearchLayer[];
  /** Estimated tokens for this query */
  estimatedTokens: number;
  /** Adaptive depth (k_dyn) for search results */
  adaptiveDepth: number;
  /** Layer-specific cost estimates */
  layerCosts: Record<SearchLayer, number>;
}

/** Layer recommendation options. */
export interface LayerRecommendationOptions {
  /** Query analysis from QueryAnalyzer */
  analysis?: QueryAnalysis;
  /** Whether semantic search is available */
  semanticAvailable?: boolean;
  /** Maximum layers to recommend (default: 3) */
  maxLayers?: number;
}

/** Token estimation options. */
export interface TokenEstimationOptions {
  /** Average characters per token (default: 4) */
  charsPerToken?: number;
  /** Include entity count in estimate (default: true) */
  includeEntityCount?: boolean;
}

/** Adaptive depth calculation parameters. */
export interface AdaptiveDepthConfig {
  /** Base number of results (k_base, default: 10) */
  kBase?: number;
  /** Complexity scaling factor (δ, delta, default: 0.5) */
  delta?: number;
  /** Maximum depth cap (default: 100) */
  maxDepth?: number;
}

/** Default options. */
const DEFAULT_OPTIONS: Required<QueryCostEstimatorOptions> = {
  basicTimePerEntity: 0.01,
  rankedTimePerEntity: 0.05,
  booleanTimePerEntity: 0.02,
  fuzzyTimePerEntity: 0.1,
  semanticTimePerEntity: 0.5,
  lowComplexityThreshold: 100,
  highComplexityThreshold: 1000,
};

/** Default adaptive depth config. */
const DEFAULT_ADAPTIVE_DEPTH: Required<AdaptiveDepthConfig> = {
  kBase: 10,
  delta: 0.5,
  maxDepth: 100,
};

/** Default token estimation config. */
const DEFAULT_TOKEN_ESTIMATION: Required<TokenEstimationOptions> = {
  charsPerToken: 4,
  includeEntityCount: true,
};

/** Estimates search query costs and recommends optimal methods. */
export class QueryCostEstimator {
  private options: Required<QueryCostEstimatorOptions>;
  private adaptiveDepthConfig: Required<AdaptiveDepthConfig>;
  private tokenEstimationConfig: Required<TokenEstimationOptions>;

  /** Create a new QueryCostEstimator instance. */
  constructor(
    options?: QueryCostEstimatorOptions,
    adaptiveDepthConfig?: AdaptiveDepthConfig,
    tokenEstimationConfig?: TokenEstimationOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.adaptiveDepthConfig = { ...DEFAULT_ADAPTIVE_DEPTH, ...adaptiveDepthConfig };
    this.tokenEstimationConfig = { ...DEFAULT_TOKEN_ESTIMATION, ...tokenEstimationConfig };
  }

  /** Estimate the cost of a specific search method. */
  estimateMethod(
    method: SearchMethod,
    query: string,
    entityCount: number
  ): QueryCostEstimate {
    // Get the recommended method first to determine isRecommended
    const recommendedMethod = this.getRecommendedMethodOnly(query, entityCount);
    return this.estimateMethodInternal(method, query, entityCount, method === recommendedMethod);
  }

  /** @internal Estimate without triggering recursion. */
  private estimateMethodInternal(
    method: SearchMethod,
    query: string,
    entityCount: number,
    isRecommended: boolean
  ): QueryCostEstimate {
    const baseTime = this.getBaseTimeForMethod(method);
    const queryComplexityFactor = this.getQueryComplexityFactor(query, method);
    const estimatedTimeMs = baseTime * entityCount * queryComplexityFactor;
    const complexity = this.getComplexity(entityCount);
    const recommendation = this.getRecommendation(method, query, entityCount, complexity);

    return {
      method,
      estimatedTimeMs: Math.round(estimatedTimeMs * 100) / 100,
      complexity,
      entityCount,
      recommendation,
      isRecommended,
    };
  }

  /** @internal Get recommended method without full estimate (avoids recursion). */
  private getRecommendedMethodOnly(
    query: string,
    entityCount: number,
    preferredMethods?: SearchMethod[]
  ): SearchMethod {
    const methods = preferredMethods ?? (['basic', 'ranked', 'boolean', 'fuzzy', 'semantic'] as SearchMethod[]);

    // Score each method and find the best
    let bestMethod = methods[0];
    let bestScore = this.scoreMethod(methods[0], query, entityCount);

    for (let i = 1; i < methods.length; i++) {
      const score = this.scoreMethod(methods[i], query, entityCount);
      if (score > bestScore) {
        bestScore = score;
        bestMethod = methods[i];
      }
    }

    return bestMethod;
  }

  /** Get estimates for all available search methods. */
  estimateAllMethods(query: string, entityCount: number): QueryCostEstimate[] {
    const methods: SearchMethod[] = ['basic', 'ranked', 'boolean', 'fuzzy', 'semantic'];
    const recommendedMethod = this.getRecommendedMethodOnly(query, entityCount);
    return methods.map(method =>
      this.estimateMethodInternal(method, query, entityCount, method === recommendedMethod)
    );
  }

  /** Recommend the best search method for a query. */
  recommendMethod(
    query: string,
    entityCount: number,
    preferredMethods?: SearchMethod[]
  ): { method: SearchMethod; reason: string; estimate: QueryCostEstimate } {
    const methods = preferredMethods ?? (['basic', 'ranked', 'boolean', 'fuzzy', 'semantic'] as SearchMethod[]);

    // Score each method based on query characteristics and cost
    const scores = methods.map(method => ({
      method,
      score: this.scoreMethod(method, query, entityCount),
      estimate: this.estimateMethod(method, query, entityCount),
    }));

    // Sort by score (higher is better)
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const reason = this.getSelectionReason(best.method, query, entityCount);

    return {
      method: best.method,
      reason,
      estimate: best.estimate,
    };
  }

  /** @internal */
  private getBaseTimeForMethod(method: SearchMethod): number {
    switch (method) {
      case 'basic':
        return this.options.basicTimePerEntity;
      case 'ranked':
        return this.options.rankedTimePerEntity;
      case 'boolean':
        return this.options.booleanTimePerEntity;
      case 'fuzzy':
        return this.options.fuzzyTimePerEntity;
      case 'semantic':
        return this.options.semanticTimePerEntity;
    }
  }

  /** @internal */
  private getQueryComplexityFactor(query: string, method: SearchMethod): number {
    const words = query.trim().split(/\s+/).length;
    const hasOperators = /\b(AND|OR|NOT)\b/.test(query);
    const hasWildcard = query.includes('*');
    const hasQuotes = query.includes('"');

    let factor = 1.0;

    // More words = slightly more complex
    factor += (words - 1) * 0.1;

    // Boolean operators increase boolean search cost, decrease others
    if (hasOperators) {
      if (method === 'boolean') {
        factor *= 0.8; // Boolean search is optimized for operators
      } else {
        factor *= 1.5; // Other methods struggle with operators
      }
    }

    // Wildcards increase fuzzy search efficiency
    if (hasWildcard) {
      if (method === 'fuzzy') {
        factor *= 0.9;
      } else {
        factor *= 1.3;
      }
    }

    // Quoted phrases benefit ranked search
    if (hasQuotes) {
      if (method === 'ranked') {
        factor *= 0.9;
      } else {
        factor *= 1.1;
      }
    }

    return Math.max(0.5, Math.min(factor, 3.0)); // Clamp between 0.5 and 3.0
  }

  /** @internal */
  private getComplexity(entityCount: number): 'low' | 'medium' | 'high' {
    if (entityCount <= this.options.lowComplexityThreshold) {
      return 'low';
    }
    if (entityCount >= this.options.highComplexityThreshold) {
      return 'high';
    }
    return 'medium';
  }

  /** @internal */
  private getRecommendation(
    method: SearchMethod,
    _query: string,
    _entityCount: number,
    complexity: 'low' | 'medium' | 'high'
  ): string {
    const recommendations: Record<SearchMethod, string> = {
      basic: 'Fast substring matching, best for simple queries',
      ranked: 'TF-IDF relevance ranking, best for finding most relevant results',
      boolean: 'Boolean operators (AND/OR/NOT), best for precise filtering',
      fuzzy: 'Tolerant of typos and misspellings, best for uncertain queries',
      semantic: 'Meaning-based search using embeddings, best for conceptual queries',
    };

    let recommendation = recommendations[method];

    if (complexity === 'high' && method === 'semantic') {
      recommendation += ' - may be slow for large graphs';
    }

    if (complexity === 'low') {
      recommendation += ' - fast for small graphs';
    }

    return recommendation;
  }

  /** @internal Score a method (higher = better fit). */
  private scoreMethod(method: SearchMethod, query: string, entityCount: number): number {
    let score = 50; // Base score

    const hasOperators = /\b(AND|OR|NOT)\b/.test(query);
    const hasWildcard = query.includes('*');
    const hasQuotes = query.includes('"');
    const words = query.trim().split(/\s+/).length;
    const isShortQuery = words <= 2;
    const isLongQuery = words >= 5;
    const complexity = this.getComplexity(entityCount);

    switch (method) {
      case 'basic':
        // Basic is good for simple, short queries on any size graph
        if (isShortQuery && !hasOperators && !hasWildcard) {
          score += 30;
        }
        if (complexity === 'low') {
          score += 20;
        }
        // Basic is fastest, give bonus for speed
        score += 10;
        break;

      case 'ranked':
        // Ranked is good for relevance-focused queries
        if (words >= 2) {
          score += 25; // Better for multi-word queries
        }
        if (hasQuotes) {
          score += 15; // Good for phrase matching
        }
        if (!hasOperators) {
          score += 10; // Not optimized for boolean
        }
        // Good balance of speed and quality
        score += 15;
        break;

      case 'boolean':
        // Boolean is best for queries with operators
        if (hasOperators) {
          score += 40;
        }
        if (!hasOperators) {
          score -= 20; // Not useful without operators
        }
        // Fast for filtering
        score += 10;
        break;

      case 'fuzzy':
        // Fuzzy is good for typo-tolerant search
        if (hasWildcard) {
          score += 25;
        }
        if (isShortQuery) {
          score += 15; // Works best on shorter queries
        }
        if (isLongQuery) {
          score -= 15; // Slow on long queries
        }
        if (complexity === 'high') {
          score -= 20; // Slow on large graphs
        }
        break;

      case 'semantic':
        // Semantic is good for conceptual/meaning-based queries
        if (isLongQuery) {
          score += 30; // Better for longer, more descriptive queries
        }
        if (!hasOperators && !hasWildcard) {
          score += 15; // Natural language queries
        }
        // Penalize for large graphs (slow)
        if (complexity === 'high') {
          score -= 30;
        }
        if (complexity === 'medium') {
          score -= 10;
        }
        break;
    }

    return score;
  }

  /** @internal */
  private getSelectionReason(method: SearchMethod, query: string, entityCount: number): string {
    const hasOperators = /\b(AND|OR|NOT)\b/.test(query);
    const hasWildcard = query.includes('*');
    const words = query.trim().split(/\s+/).length;
    const complexity = this.getComplexity(entityCount);

    switch (method) {
      case 'basic':
        if (complexity === 'low') {
          return 'Basic search selected for small graph size - fast and efficient';
        }
        return 'Basic search selected for simple query pattern';

      case 'ranked':
        if (words >= 2) {
          return 'Ranked search selected for multi-word query - provides relevance ordering';
        }
        return 'Ranked search selected for best balance of speed and relevance';

      case 'boolean':
        if (hasOperators) {
          return 'Boolean search selected - query contains logical operators (AND/OR/NOT)';
        }
        return 'Boolean search selected for precise filtering';

      case 'fuzzy':
        if (hasWildcard) {
          return 'Fuzzy search selected - query contains wildcard patterns';
        }
        return 'Fuzzy search selected for typo-tolerant matching';

      case 'semantic':
        if (words >= 5) {
          return 'Semantic search selected - longer natural language query benefits from meaning-based matching';
        }
        return 'Semantic search selected for conceptual/meaning-based matching';
    }
  }

  // ==================== Enhanced Features ====================

  /** Calculate adaptive depth: k_dyn = k_base × (1 + δ × C_q). */
  calculateAdaptiveDepth(query: string, analysis?: QueryAnalysis): number {
    const { kBase, delta, maxDepth } = this.adaptiveDepthConfig;

    // Calculate complexity score (0-1)
    const complexityScore = this.calculateComplexityScore(query, analysis);

    // Apply formula: k_dyn = k_base × (1 + δ × C_q)
    const kDyn = kBase * (1 + delta * complexityScore);

    // Round and cap at maxDepth
    return Math.min(Math.round(kDyn), maxDepth);
  }

  /** @internal */
  private calculateComplexityScore(query: string, analysis?: QueryAnalysis): number {
    let score = 0;

    // Use analysis if provided
    if (analysis) {
      switch (analysis.complexity) {
        case 'low':
          score = 0.2;
          break;
        case 'medium':
          score = 0.5;
          break;
        case 'high':
          score = 0.8;
          break;
      }

      // Adjust for sub-queries
      if (analysis.subQueries && analysis.subQueries.length > 1) {
        score += 0.1 * (analysis.subQueries.length - 1);
      }

      // Adjust for temporal range (adds complexity)
      if (analysis.temporalRange) {
        score += 0.1;
      }

      // Adjust for entities (more entities = more complex)
      if (analysis.entities.length > 0) {
        score += 0.05 * Math.min(analysis.entities.length, 3);
      }
    } else {
      // Fallback to query-based estimation
      const words = query.trim().split(/\s+/).length;
      const hasOperators = /\b(AND|OR|NOT)\b/.test(query);
      const hasMultipleClauses = /[,;]/.test(query);
      const hasConjunctions = /\b(and|or|but|then|therefore)\b/i.test(query);

      score = Math.min(words / 20, 0.5); // Base score from length
      if (hasOperators) score += 0.2;
      if (hasMultipleClauses) score += 0.15;
      if (hasConjunctions) score += 0.1;
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, score));
  }

  /** Estimate tokens for query and expected results. */
  estimateTokens(query: string, entityCount: number, expectedResults = 10): number {
    const { charsPerToken, includeEntityCount } = this.tokenEstimationConfig;

    // Query tokens
    const queryTokens = Math.ceil(query.length / charsPerToken);

    // Result tokens (approximate average entity text size)
    const avgEntityTextSize = 200; // Conservative estimate
    const resultTokens = Math.ceil((avgEntityTextSize * expectedResults) / charsPerToken);

    // Add overhead for entity count if enabled
    let totalTokens = queryTokens + resultTokens;
    if (includeEntityCount) {
      // More entities = slightly more processing/context
      const entityOverhead = Math.ceil(Math.log10(entityCount + 1) * 10);
      totalTokens += entityOverhead;
    }

    return totalTokens;
  }

  /** Recommend search layers based on query characteristics. */
  recommendLayers(query: string, options: LayerRecommendationOptions = {}): SearchLayer[] {
    const {
      analysis,
      semanticAvailable = true,
      maxLayers = 3,
    } = options;

    const layers: Array<{ layer: SearchLayer; score: number; cost: number }> = [];

    // Score lexical layer
    const lexicalScore = this.scoreLexicalLayer(query, analysis);
    layers.push({
      layer: 'lexical',
      score: lexicalScore,
      cost: this.estimateLayerCost('lexical', query),
    });

    // Score symbolic layer
    const symbolicScore = this.scoreSymbolicLayer(query, analysis);
    layers.push({
      layer: 'symbolic',
      score: symbolicScore,
      cost: this.estimateLayerCost('symbolic', query),
    });

    // Score semantic layer (if available)
    if (semanticAvailable) {
      const semanticScore = this.scoreSemanticLayer(query, analysis);
      layers.push({
        layer: 'semantic',
        score: semanticScore,
        cost: this.estimateLayerCost('semantic', query),
      });
    }

    // Sort by score (higher is better), then by cost (lower is better)
    layers.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.cost - b.cost;
    });

    // Return up to maxLayers
    return layers.slice(0, maxLayers).map(l => l.layer);
  }

  /** @internal */
  private estimateLayerCost(layer: SearchLayer, query: string): number {
    const words = query.trim().split(/\s+/).length;

    switch (layer) {
      case 'lexical':
        return 1 + words * 0.1; // Fast, scales with words
      case 'symbolic':
        return 0.5; // Very fast, constant time
      case 'semantic':
        return 5 + words * 0.5; // Slow, embedding computation
    }
  }

  /** @internal */
  private scoreLexicalLayer(query: string, analysis?: QueryAnalysis): number {
    let score = 50;

    const words = query.trim().split(/\s+/).length;
    const hasOperators = /\b(AND|OR|NOT)\b/.test(query);

    // Good for keyword queries
    if (words >= 2 && words <= 5) score += 20;
    if (!hasOperators) score += 10;

    // Check analysis for factual questions
    if (analysis?.questionType === 'factual') score += 15;
    if (analysis?.questionType === 'aggregation') score += 10;

    return score;
  }

  /** @internal */
  private scoreSymbolicLayer(query: string, analysis?: QueryAnalysis): number {
    let score = 40;

    // Good for temporal queries
    if (analysis?.temporalRange) score += 30;
    if (analysis?.questionType === 'temporal') score += 25;

    // Good for structured filtering
    const hasFilterKeywords = /\b(type|tag|importance|date|created|modified)\b/i.test(query);
    if (hasFilterKeywords) score += 20;

    // If analysis detected entities, might benefit from symbolic
    if (analysis?.entities && analysis.entities.length > 0) score += 10;

    return score;
  }

  /** @internal */
  private scoreSemanticLayer(query: string, analysis?: QueryAnalysis): number {
    let score = 45;

    const words = query.trim().split(/\s+/).length;
    const hasOperators = /\b(AND|OR|NOT)\b/.test(query);

    // Good for longer, natural language queries
    if (words >= 5) score += 25;
    if (!hasOperators) score += 10;

    // Good for conceptual questions
    if (analysis?.questionType === 'conceptual') score += 30;
    if (analysis?.questionType === 'comparative') score += 20;

    // High complexity benefits from semantic understanding
    if (analysis?.complexity === 'high') score += 15;

    return score;
  }

  /** Get extended cost estimate with layer recommendations and adaptive depth. */
  estimateExtended(
    method: SearchMethod,
    query: string,
    entityCount: number,
    analysis?: QueryAnalysis
  ): ExtendedQueryCostEstimate {
    const base = this.estimateMethod(method, query, entityCount);
    const adaptiveDepth = this.calculateAdaptiveDepth(query, analysis);
    const estimatedTokens = this.estimateTokens(query, entityCount, adaptiveDepth);
    const recommendedLayers = this.recommendLayers(query, {
      analysis,
      semanticAvailable: method === 'semantic' || true, // Assume available
    });

    const layerCosts: Record<SearchLayer, number> = {
      semantic: this.estimateLayerCost('semantic', query) * entityCount * 0.001,
      lexical: this.estimateLayerCost('lexical', query) * entityCount * 0.001,
      symbolic: this.estimateLayerCost('symbolic', query) * entityCount * 0.001,
    };

    return {
      ...base,
      recommendedLayers,
      estimatedTokens,
      adaptiveDepth,
      layerCosts,
    };
  }

  /** Get layers sorted by estimated cost (fastest first). */
  getLayersByCost(
    query: string,
    entityCount: number,
    semanticAvailable = true
  ): Array<{ layer: SearchLayer; estimatedMs: number }> {
    const layers: Array<{ layer: SearchLayer; estimatedMs: number }> = [
      {
        layer: 'symbolic',
        estimatedMs: this.estimateLayerCost('symbolic', query) * Math.log10(entityCount + 1),
      },
      {
        layer: 'lexical',
        estimatedMs: this.estimateLayerCost('lexical', query) * Math.sqrt(entityCount),
      },
    ];

    if (semanticAvailable) {
      layers.push({
        layer: 'semantic',
        estimatedMs: this.estimateLayerCost('semantic', query) * entityCount * 0.1,
      });
    }

    return layers.sort((a, b) => a.estimatedMs - b.estimatedMs);
  }
}
