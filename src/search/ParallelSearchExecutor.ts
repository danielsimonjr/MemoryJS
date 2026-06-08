/**
 * Parallel Search Executor
 *
 * Phase 12 Sprint 2: Executes search layers (semantic, lexical, symbolic)
 * concurrently using Promise.all with graceful fallback on failures.
 *
 * @module search/ParallelSearchExecutor
 */

import type {
  Entity,
  ReadonlyKnowledgeGraph,
  SymbolicFilters,
} from '../types/index.js';
import type { SemanticSearch } from './SemanticSearch.js';
import type { RankedSearch } from './RankedSearch.js';
import { SymbolicSearch } from './SymbolicSearch.js';
import { SEMANTIC_SEARCH_LIMITS } from '../utils/constants.js';

/**
 * Timing information for a search layer.
 */
export interface LayerTiming {
  /** Layer identifier */
  layer: 'semantic' | 'lexical' | 'symbolic';
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether the layer succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of results returned */
  resultCount: number;
}

/**
 * Result from parallel search execution with timing metadata.
 */
export interface ParallelSearchResult {
  /** Semantic search results: entity name -> similarity score */
  semanticResults: Map<string, number>;
  /** Lexical search results: entity name -> normalized score */
  lexicalResults: Map<string, number>;
  /** Symbolic search results: entity name -> filter match score */
  symbolicResults: Map<string, number>;
  /** Timing information for each layer */
  timings: LayerTiming[];
  /** Total execution time in milliseconds */
  totalTimeMs: number;
  /** Whether all layers succeeded */
  allSucceeded: boolean;
  /** Summary of failed layers */
  failedLayers: string[];
}

/**
 * Options for parallel search execution.
 */
export interface ParallelSearchOptions {
  /** Semantic search options */
  semantic?: {
    minSimilarity?: number;
    topK?: number;
  };
  /** Lexical search options */
  lexical?: {
    useStopwords?: boolean;
    useStemming?: boolean;
  };
  /** Symbolic filter criteria */
  symbolic?: SymbolicFilters;
  /** Maximum results per layer */
  limit?: number;
  /** Timeout per layer in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/**
 * ParallelSearchExecutor - Execute search layers concurrently
 *
 * Orchestrates parallel execution of semantic, lexical, and symbolic search
 * layers using Promise.all. Provides:
 * - Concurrent execution for improved latency
 * - Per-layer timing metadata
 * - Graceful fallback on individual layer failures
 * - Layer-specific error isolation
 *
 * @example
 * ```typescript
 * const executor = new ParallelSearchExecutor(semanticSearch, rankedSearch);
 *
 * const result = await executor.execute(graph, 'machine learning', {
 *   semantic: { minSimilarity: 0.5 },
 *   symbolic: { tags: ['ai'] }
 * });
 *
 * console.log(`Total time: ${result.totalTimeMs}ms`);
 * for (const timing of result.timings) {
 *   console.log(`${timing.layer}: ${timing.durationMs}ms, ${timing.resultCount} results`);
 * }
 * ```
 */
export class ParallelSearchExecutor {
  private symbolicSearch: SymbolicSearch;

  constructor(
    private semanticSearch: SemanticSearch | null,
    private rankedSearch: RankedSearch
  ) {
    this.symbolicSearch = new SymbolicSearch();
  }

  /**
   * Execute all search layers in parallel.
   *
   * @param graph - Knowledge graph to search
   * @param query - Search query text
   * @param options - Search options for each layer
   * @returns Parallel search results with timing metadata
   */
  async execute(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: ParallelSearchOptions = {}
  ): Promise<ParallelSearchResult> {
    const {
      semantic = {},
      lexical = {},
      symbolic = {},
      limit = SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT,
      timeoutMs = 30000,
    } = options;

    const overallStart = Date.now();
    const timings: LayerTiming[] = [];
    const failedLayers: string[] = [];

    // Execute all three layers in parallel
    const [semanticResult, lexicalResult, symbolicResult] = await Promise.all([
      this.executeSemanticLayer(graph, query, semantic, limit * 2, timeoutMs),
      this.executeLexicalLayer(query, lexical, limit * 2, timeoutMs),
      this.executeSymbolicLayer(graph.entities, symbolic, timeoutMs),
    ]);

    // Collect timing information
    timings.push(semanticResult.timing);
    timings.push(lexicalResult.timing);
    timings.push(symbolicResult.timing);

    // Track failed layers
    if (!semanticResult.timing.success) failedLayers.push('semantic');
    if (!lexicalResult.timing.success) failedLayers.push('lexical');
    if (!symbolicResult.timing.success) failedLayers.push('symbolic');

    const totalTimeMs = Date.now() - overallStart;

    return {
      semanticResults: semanticResult.results,
      lexicalResults: lexicalResult.results,
      symbolicResults: symbolicResult.results,
      timings,
      totalTimeMs,
      allSucceeded: failedLayers.length === 0,
      failedLayers,
    };
  }

  /**
   * Execute semantic search layer with timing.
   */
  private async executeSemanticLayer(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: { minSimilarity?: number; topK?: number },
    limit: number,
    _timeoutMs: number
  ): Promise<{ results: Map<string, number>; timing: LayerTiming }> {
    const startTime = Date.now();
    const results = new Map<string, number>();

    let success = true;
    let error: string | undefined;

    if (!this.semanticSearch) {
      // Semantic search not available - treat as graceful degradation
      return {
        results,
        timing: {
          layer: 'semantic',
          startTime,
          endTime: Date.now(),
          durationMs: Date.now() - startTime,
          success: true, // Not an error, just not configured
          resultCount: 0,
        },
      };
    }

    const timeout = this.createTimeout<never>(_timeoutMs, 'Semantic search timeout');
    try {
      // Execute semantic search with timeout
      const semanticResults = await Promise.race([
        this.semanticSearch.search(
          graph,
          query,
          options.topK ?? limit,
          options.minSimilarity ?? 0
        ),
        timeout.promise,
      ]);

      for (const result of semanticResults) {
        results.set(result.entity.name, result.similarity);
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      timeout.clear();
    }

    const endTime = Date.now();
    return {
      results,
      timing: {
        layer: 'semantic',
        startTime,
        endTime,
        durationMs: endTime - startTime,
        success,
        error,
        resultCount: results.size,
      },
    };
  }

  /**
   * Execute lexical search layer (TF-IDF/BM25) with timing.
   */
  private async executeLexicalLayer(
    query: string,
    _options: { useStopwords?: boolean; useStemming?: boolean },
    limit: number,
    _timeoutMs: number
  ): Promise<{ results: Map<string, number>; timing: LayerTiming }> {
    const startTime = Date.now();
    const results = new Map<string, number>();

    let success = true;
    let error: string | undefined;

    const timeout = this.createTimeout<never>(_timeoutMs, 'Lexical search timeout');
    try {
      // Execute lexical search with timeout
      const lexicalResults = await Promise.race([
        this.rankedSearch.searchNodesRanked(
          query,
          undefined, // tags
          undefined, // minImportance
          undefined, // maxImportance
          limit
        ),
        timeout.promise,
      ]);

      // Normalize scores to 0-1 range
      const maxScore = Math.max(...lexicalResults.map(r => r.score), 1);
      for (const result of lexicalResults) {
        results.set(result.entity.name, result.score / maxScore);
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      timeout.clear();
    }

    const endTime = Date.now();
    return {
      results,
      timing: {
        layer: 'lexical',
        startTime,
        endTime,
        durationMs: endTime - startTime,
        success,
        error,
        resultCount: results.size,
      },
    };
  }

  /**
   * Execute symbolic search layer with timing.
   */
  private async executeSymbolicLayer(
    entities: readonly Entity[],
    filters: SymbolicFilters | undefined,
    _timeoutMs: number
  ): Promise<{ results: Map<string, number>; timing: LayerTiming }> {
    const startTime = Date.now();
    const results = new Map<string, number>();

    let success = true;
    let error: string | undefined;

    try {
      // Symbolic search is synchronous but wrap for consistency
      if (!filters || Object.keys(filters).length === 0) {
        // No filters - return empty (no symbolic signal)
      } else {
        const symbolicResults = this.symbolicSearch.search(entities, filters);
        for (const result of symbolicResults) {
          results.set(result.entity.name, result.score);
        }
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
    }

    const endTime = Date.now();
    return {
      results,
      timing: {
        layer: 'symbolic',
        startTime,
        endTime,
        durationMs: endTime - startTime,
        success,
        error,
        resultCount: results.size,
      },
    };
  }

  /**
   * Create a timeout promise.
   */
  private createTimeout<T>(ms: number, message: string): { promise: Promise<T>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return { promise, clear: () => clearTimeout(timer!) };
  }

  /**
   * Execute a single layer independently.
   *
   * @param layer - Layer to execute
   * @param graph - Knowledge graph
   * @param query - Search query
   * @param options - Layer-specific options
   * @returns Layer results with timing
   */
  async executeLayer(
    layer: 'semantic' | 'lexical' | 'symbolic',
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: ParallelSearchOptions = {}
  ): Promise<{ results: Map<string, number>; timing: LayerTiming }> {
    const limit = options.limit ?? SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT;
    const timeoutMs = options.timeoutMs ?? 30000;

    switch (layer) {
      case 'semantic':
        return this.executeSemanticLayer(
          graph,
          query,
          options.semantic ?? {},
          limit * 2,
          timeoutMs
        );
      case 'lexical':
        return this.executeLexicalLayer(
          query,
          options.lexical ?? {},
          limit * 2,
          timeoutMs
        );
      case 'symbolic':
        return this.executeSymbolicLayer(
          graph.entities,
          options.symbolic,
          timeoutMs
        );
    }
  }

  /**
   * Execute only specific layers in parallel.
   *
   * @param layers - Layers to execute
   * @param graph - Knowledge graph
   * @param query - Search query
   * @param options - Search options
   * @returns Partial results for requested layers
   */
  async executeSelectedLayers(
    layers: Array<'semantic' | 'lexical' | 'symbolic'>,
    graph: ReadonlyKnowledgeGraph,
    query: string,
    options: ParallelSearchOptions = {}
  ): Promise<{
    results: Map<'semantic' | 'lexical' | 'symbolic', Map<string, number>>;
    timings: LayerTiming[];
    totalTimeMs: number;
  }> {
    const overallStart = Date.now();
    const results = new Map<'semantic' | 'lexical' | 'symbolic', Map<string, number>>();
    const timings: LayerTiming[] = [];

    const layerPromises = layers.map(layer =>
      this.executeLayer(layer, graph, query, options).then(result => ({
        layer,
        ...result,
      }))
    );

    const layerExecutionResults = await Promise.all(layerPromises);

    for (const { layer, results: layerData, timing } of layerExecutionResults) {
      results.set(layer, layerData);
      timings.push(timing);
    }

    return {
      results,
      timings,
      totalTimeMs: Date.now() - overallStart,
    };
  }

  /**
   * Get timing summary from results.
   *
   * @param timings - Array of layer timings
   * @returns Formatted timing summary
   */
  static formatTimingSummary(timings: LayerTiming[]): string {
    const lines: string[] = [];
    let totalTime = 0;
    let maxTime = 0;

    for (const timing of timings) {
      const status = timing.success ? 'OK' : `FAILED: ${timing.error}`;
      lines.push(
        `  ${timing.layer}: ${timing.durationMs}ms (${timing.resultCount} results) [${status}]`
      );
      totalTime += timing.durationMs;
      maxTime = Math.max(maxTime, timing.durationMs);
    }

    lines.unshift('Search Layer Timings:');
    lines.push(`  Total (sequential): ${totalTime}ms`);
    lines.push(`  Max (parallel bottleneck): ${maxTime}ms`);
    lines.push(`  Speedup: ${(totalTime / maxTime).toFixed(2)}x`);

    return lines.join('\n');
  }

  /**
   * Calculate potential speedup from parallel execution.
   *
   * @param timings - Array of layer timings
   * @returns Speedup metrics
   */
  static calculateSpeedup(timings: LayerTiming[]): {
    sequentialTime: number;
    parallelTime: number;
    speedup: number;
  } {
    const sequentialTime = timings.reduce((sum, t) => sum + t.durationMs, 0);
    const parallelTime = Math.max(...timings.map(t => t.durationMs));
    const speedup = sequentialTime / parallelTime;

    return { sequentialTime, parallelTime, speedup };
  }
}
