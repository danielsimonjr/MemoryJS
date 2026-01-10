/**
 * Search Module Barrel Export
 *
 * Sprint 2: Added SearchFilterChain for centralized filter logic
 * Phase 4 Sprint 10: Added EmbeddingService for semantic search
 */

export { BasicSearch } from './BasicSearch.js';
export { RankedSearch } from './RankedSearch.js';
export { BooleanSearch } from './BooleanSearch.js';
export { FuzzySearch, type FuzzySearchOptions } from './FuzzySearch.js';
export { SearchSuggestions } from './SearchSuggestions.js';
export { SavedSearchManager } from './SavedSearchManager.js';
export { SearchManager } from './SearchManager.js';

// Sprint 2: Search Filter Chain utilities
export { SearchFilterChain, type SearchFilters, type ValidatedPagination } from './SearchFilterChain.js';

// Phase 4 Sprint 10: Embedding Service for semantic search
// Phase 12 Sprint 5: Added l2Normalize, prefixes, and progress callback
export {
  OpenAIEmbeddingService,
  LocalEmbeddingService,
  MockEmbeddingService,
  createEmbeddingService,
  l2Normalize,
  QUERY_PREFIX,
  DOCUMENT_PREFIX,
  type EmbeddingProgressCallback,
} from './EmbeddingService.js';

// Phase 12 Sprint 5: Embedding Cache with LRU eviction
export {
  EmbeddingCache,
  DEFAULT_EMBEDDING_CACHE_OPTIONS,
  type EmbeddingCacheStats,
  type EmbeddingCacheOptions,
} from './EmbeddingCache.js';

// Phase 12 Sprint 5: Incremental Indexer for batch updates
export {
  IncrementalIndexer,
  DEFAULT_INDEXER_OPTIONS,
  type IndexOperationType,
  type IndexOperation,
  type IncrementalIndexerOptions,
  type FlushResult,
} from './IncrementalIndexer.js';

// Phase 4 Sprint 11: Vector Store for semantic search
export {
  InMemoryVectorStore,
  SQLiteVectorStore,
  createVectorStore,
  cosineSimilarity,
  type SQLiteStorageWithEmbeddings,
} from './VectorStore.js';

// Phase 4 Sprint 12: Semantic Search Manager
export {
  SemanticSearch,
  entityToText,
} from './SemanticSearch.js';

// Phase 10 Sprint 3: TF-IDF Index Manager and Event Sync
export { TFIDFIndexManager } from './TFIDFIndexManager.js';
export { TFIDFEventSync } from './TFIDFEventSync.js';

// Phase 10 Sprint 4: Query Cost Estimation
// Phase 12 Sprint 4: Enhanced with adaptive depth, token estimation, layer recommendations
export {
  QueryCostEstimator,
  type SearchLayer,
  type ExtendedQueryCostEstimate,
  type LayerRecommendationOptions,
  type TokenEstimationOptions,
  type AdaptiveDepthConfig,
} from './QueryCostEstimator.js';

// Phase 11 Sprint 1: Hybrid Search
export { SymbolicSearch, type SymbolicResult } from './SymbolicSearch.js';
export { HybridSearchManager, DEFAULT_HYBRID_WEIGHTS } from './HybridSearchManager.js';

// Phase 11 Sprint 3: Query Analysis
export { QueryAnalyzer } from './QueryAnalyzer.js';
export { QueryPlanner } from './QueryPlanner.js';

// Phase 11 Sprint 4: Reflection-based Retrieval
// Phase 12 Sprint 4: Enhanced with progressive limits, focused refinement, history tracking
export {
  ReflectionManager,
  type ReflectionOptions,
  type ReflectionResult,
  type RefinementHistoryEntry,
} from './ReflectionManager.js';

// Phase 12 Sprint 3: Search Algorithm Optimization
export {
  BM25Search,
  STOPWORDS,
  DEFAULT_BM25_CONFIG,
  type BM25DocumentEntry,
  type BM25Index,
  type BM25Config,
} from './BM25Search.js';

export {
  OptimizedInvertedIndex,
  type IndexMemoryUsage,
  type PostingListResult,
} from './OptimizedInvertedIndex.js';

export {
  HybridScorer,
  DEFAULT_SCORER_WEIGHTS,
  type SemanticLayerResult,
  type LexicalSearchResult,
  type SymbolicSearchResult,
  type ScoredResult,
  type HybridWeights,
  type HybridScorerOptions,
} from './HybridScorer.js';

// Phase 12 Sprint 2: Parallel Search Execution
export {
  ParallelSearchExecutor,
  type LayerTiming,
  type ParallelSearchResult,
  type ParallelSearchOptions,
} from './ParallelSearchExecutor.js';

// Phase 12 Sprint 4: Query Execution Optimization
export {
  EarlyTerminationManager,
  type AdequacyCheck,
  type EarlyTerminationOptions,
  type EarlyTerminationResult,
} from './EarlyTerminationManager.js';

export {
  QueryPlanCache,
  type CachedQueryEntry,
  type QueryPlanCacheStats,
  type QueryPlanCacheOptions,
} from './QueryPlanCache.js';

// Phase 12 Sprint 6: Quantized Vector Store
export {
  QuantizedVectorStore,
  type QuantizationParams,
  type QuantizedVectorStoreStats,
  type QuantizedSearchResult,
  type QuantizedVectorStoreOptions,
} from './QuantizedVectorStore.js';
