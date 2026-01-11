# Memoryjs - Dependency Graph

**Version**: 1.0.0 | **Last Updated**: 2026-01-10

This document provides a comprehensive dependency graph of all files, components, imports, functions, and variables in the codebase.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Dependencies](#core-dependencies)
3. [Features Dependencies](#features-dependencies)
4. [Entry Dependencies](#entry-dependencies)
5. [Search Dependencies](#search-dependencies)
6. [Types Dependencies](#types-dependencies)
7. [Utils Dependencies](#utils-dependencies)
8. [Workers Dependencies](#workers-dependencies)
9. [Dependency Matrix](#dependency-matrix)
10. [Circular Dependency Analysis](#circular-dependency-analysis)
11. [Visual Dependency Graph](#visual-dependency-graph)
12. [Summary Statistics](#summary-statistics)

---

## Overview

The codebase is organized into the following modules:

- **core**: 12 files
- **features**: 9 files
- **entry**: 1 file
- **search**: 29 files
- **types**: 2 files
- **utils**: 18 files
- **workers**: 2 files

---

## Core Dependencies

### `src/core/EntityManager.ts` - Entity Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, LongRunningOperationOptions` | Import (type-only) |
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/errors.js` | `EntityNotFoundError, InvalidImportanceError, ValidationError` | Import |
| `../utils/index.js` | `BatchCreateEntitiesSchema, UpdateEntitySchema, EntityNamesSchema, checkCancellation, createProgressReporter, createProgress, sanitizeObject` | Import |
| `../utils/constants.js` | `GRAPH_LIMITS` | Import |

**Exports:**

- Classes: `EntityManager`

---

### `src/core/GraphEventEmitter.ts` - Graph Event Emitter

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `GraphEventType, GraphEvent, GraphEventListener, GraphEventMap, Entity, Relation, EntityCreatedEvent, EntityUpdatedEvent, EntityDeletedEvent, RelationCreatedEvent, RelationDeletedEvent, ObservationAddedEvent, ObservationDeletedEvent, GraphSavedEvent, GraphLoadedEvent` | Import (type-only) |

**Exports:**

- Classes: `GraphEventEmitter`

---

### `src/core/GraphStorage.ts` - Graph Storage

**External Dependencies:**
| Package | Import |
|---------|--------|
| `async-mutex` | `Mutex` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `promises` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData` | Import (type-only) |
| `../utils/searchCache.js` | `clearAllSearchCaches` | Import |
| `../utils/indexes.js` | `NameIndex, TypeIndex, LowercaseCache, RelationIndex, ObservationIndex` | Import |
| `../utils/index.js` | `sanitizeObject` | Import |
| `./TransactionManager.js` | `BatchTransaction` | Import |
| `./GraphEventEmitter.js` | `GraphEventEmitter` | Import |

**Exports:**

- Classes: `GraphStorage`

---

### `src/core/GraphTraversal.ts` - Graph Traversal

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, Relation, TraversalOptions, TraversalResult, PathResult, ConnectedComponentsResult, CentralityResult` | Import (type-only) |
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `checkCancellation` | Import |

**Exports:**

- Classes: `GraphTraversal`

---

### `src/core/HierarchyManager.ts` - Hierarchy Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, KnowledgeGraph, ReadonlyKnowledgeGraph` | Import (type-only) |
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/errors.js` | `EntityNotFoundError, CycleDetectedError` | Import |

**Exports:**

- Classes: `HierarchyManager`

---

### `src/core/index.ts` - Core Module Barrel Export

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./GraphStorage.js` | `GraphStorage` | Re-export |
| `./SQLiteStorage.js` | `SQLiteStorage` | Re-export |
| `./EntityManager.js` | `EntityManager` | Re-export |
| `./RelationManager.js` | `RelationManager` | Re-export |
| `./ObservationManager.js` | `ObservationManager` | Re-export |
| `./HierarchyManager.js` | `HierarchyManager` | Re-export |
| `./ManagerContext.js` | `ManagerContext` | Re-export |
| `./GraphTraversal.js` | `GraphTraversal` | Re-export |
| `./ManagerContext.js` | `ManagerContext` | Re-export |
| `./TransactionManager.js` | `TransactionManager, OperationType, BatchTransaction, type TransactionOperation, type TransactionResult` | Re-export |
| `./StorageFactory.js` | `createStorage, createStorageFromPath` | Re-export |
| `./GraphEventEmitter.js` | `GraphEventEmitter` | Re-export |

**Exports:**

- Re-exports: `GraphStorage`, `SQLiteStorage`, `EntityManager`, `RelationManager`, `ObservationManager`, `HierarchyManager`, `ManagerContext`, `GraphTraversal`, `TransactionManager`, `OperationType`, `BatchTransaction`, `type TransactionOperation`, `type TransactionResult`, `createStorage`, `createStorageFromPath`, `GraphEventEmitter`

---

### `src/core/ManagerContext.ts` - Manager Context

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `path` | `path` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./GraphStorage.js` | `GraphStorage` | Import |
| `./StorageFactory.js` | `createStorageFromPath` | Import |
| `./EntityManager.js` | `EntityManager` | Import |
| `./RelationManager.js` | `RelationManager` | Import |
| `./ObservationManager.js` | `ObservationManager` | Import |
| `./HierarchyManager.js` | `HierarchyManager` | Import |
| `./GraphTraversal.js` | `GraphTraversal` | Import |
| `../search/SearchManager.js` | `SearchManager` | Import |
| `../search/RankedSearch.js` | `RankedSearch` | Import |
| `../search/index.js` | `SemanticSearch, createEmbeddingService, createVectorStore` | Import |
| `../features/IOManager.js` | `IOManager` | Import |
| `../features/TagManager.js` | `TagManager` | Import |
| `../features/AnalyticsManager.js` | `AnalyticsManager` | Import |
| `../features/CompressionManager.js` | `CompressionManager` | Import |
| `../features/ArchiveManager.js` | `ArchiveManager` | Import |
| `../utils/constants.js` | `getEmbeddingConfig` | Import |

**Exports:**

- Classes: `ManagerContext`

---

### `src/core/ObservationManager.ts` - Observation Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/errors.js` | `EntityNotFoundError` | Import |

**Exports:**

- Classes: `ObservationManager`

---

### `src/core/RelationManager.ts` - Relation Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Relation` | Import (type-only) |
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/errors.js` | `ValidationError` | Import |
| `../utils/index.js` | `BatchCreateRelationsSchema, DeleteRelationsSchema` | Import |
| `../utils/constants.js` | `GRAPH_LIMITS` | Import |

**Exports:**

- Classes: `RelationManager`

---

### `src/core/SQLiteStorage.ts` - SQLite Storage

**External Dependencies:**
| Package | Import |
|---------|--------|
| `better-sqlite3` | `Database` |
| `better-sqlite3` | `Database` |
| `async-mutex` | `Mutex` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `KnowledgeGraph, Entity, Relation, ReadonlyKnowledgeGraph, IGraphStorage, LowercaseData` | Import (type-only) |
| `../utils/searchCache.js` | `clearAllSearchCaches` | Import |
| `../utils/indexes.js` | `NameIndex, TypeIndex` | Import |
| `../utils/index.js` | `sanitizeObject` | Import |

**Exports:**

- Classes: `SQLiteStorage`

---

### `src/core/StorageFactory.ts` - Storage Factory

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./GraphStorage.js` | `GraphStorage` | Import |
| `./SQLiteStorage.js` | `SQLiteStorage` | Import |
| `../types/index.js` | `IGraphStorage, StorageConfig` | Import (type-only) |

**Exports:**

- Functions: `createStorage`, `createStorageFromPath`

---

### `src/core/TransactionManager.ts` - Transaction Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, Relation, KnowledgeGraph, LongRunningOperationOptions, BatchOperation, BatchResult, BatchOptions` | Import (type-only) |
| `./GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../features/IOManager.js` | `IOManager` | Import |
| `../utils/errors.js` | `KnowledgeGraphError` | Import |
| `../utils/index.js` | `checkCancellation, createProgressReporter, createProgress, sanitizeObject` | Import |

**Exports:**

- Classes: `TransactionManager`, `BatchTransaction`
- Interfaces: `TransactionResult`
- Enums: `OperationType`

---

## Features Dependencies

### `src/features/AnalyticsManager.ts` - Analytics Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../types/index.js` | `GraphStats, ValidationReport, ValidationIssue, ValidationWarning` | Import (type-only) |

**Exports:**

- Classes: `AnalyticsManager`

---

### `src/features/ArchiveManager.ts` - Archive Manager

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `promises` |
| `path` | `dirname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, LongRunningOperationOptions` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `compress, COMPRESSION_CONFIG, checkCancellation, createProgressReporter, createProgress` | Import |

**Exports:**

- Classes: `ArchiveManager`
- Interfaces: `ArchiveCriteria`, `ArchiveOptions`, `ArchiveResult`

---

### `src/features/CompressionManager.ts` - Compression Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, Relation, GraphCompressionResult, KnowledgeGraph, LongRunningOperationOptions, PreparedEntity` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `levenshteinDistance, checkCancellation, createProgressReporter, createProgress, fnv1aHash` | Import |
| `../utils/errors.js` | `EntityNotFoundError, InsufficientEntitiesError` | Import |
| `../utils/constants.js` | `SIMILARITY_WEIGHTS, DEFAULT_DUPLICATE_THRESHOLD` | Import |

**Exports:**

- Classes: `CompressionManager`

---

### `src/features/index.ts` - Features Module Barrel Export

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./TagManager.js` | `TagManager` | Re-export |
| `./IOManager.js` | `IOManager, type ExportFormat, type ImportFormat, type MergeStrategy, type BackupMetadata, type BackupInfo` | Re-export |
| `./AnalyticsManager.js` | `AnalyticsManager` | Re-export |
| `./CompressionManager.js` | `CompressionManager` | Re-export |
| `./ArchiveManager.js` | `ArchiveManager, type ArchiveCriteria, type ArchiveOptions, type ArchiveResult` | Re-export |
| `./StreamingExporter.js` | `StreamingExporter, type StreamResult` | Re-export |
| `./ObservationNormalizer.js` | `ObservationNormalizer, type NormalizationOptions, type NormalizationResult` | Re-export |
| `./KeywordExtractor.js` | `KeywordExtractor, type ScoredKeyword` | Re-export |

**Exports:**

- Re-exports: `TagManager`, `IOManager`, `type ExportFormat`, `type ImportFormat`, `type MergeStrategy`, `type BackupMetadata`, `type BackupInfo`, `AnalyticsManager`, `CompressionManager`, `ArchiveManager`, `type ArchiveCriteria`, `type ArchiveOptions`, `type ArchiveResult`, `StreamingExporter`, `type StreamResult`, `ObservationNormalizer`, `type NormalizationOptions`, `type NormalizationResult`, `KeywordExtractor`, `type ScoredKeyword`

---

### `src/features/IOManager.ts` - IO Manager

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `promises` |
| `path` | `dirname, join` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, Relation, KnowledgeGraph, ReadonlyKnowledgeGraph, ImportResult, BackupOptions, BackupResult, RestoreResult, ExportOptions, ExportResult, LongRunningOperationOptions` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/errors.js` | `FileOperationError` | Import |
| `../utils/index.js` | `compress, decompress, hasBrotliExtension, COMPRESSION_CONFIG, STREAMING_CONFIG, checkCancellation, createProgressReporter, createProgress, validateFilePath, sanitizeObject, escapeCsvFormula` | Import |
| `./StreamingExporter.js` | `StreamingExporter, StreamResult` | Import |

**Exports:**

- Classes: `IOManager`
- Interfaces: `BackupMetadata`, `BackupInfo`

---

### `src/features/KeywordExtractor.ts` - Keyword Extractor

**Exports:**

- Classes: `KeywordExtractor`
- Interfaces: `ScoredKeyword`

---

### `src/features/ObservationNormalizer.ts` - Observation Normalizer

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity` | Import (type-only) |

**Exports:**

- Classes: `ObservationNormalizer`
- Interfaces: `NormalizationOptions`, `NormalizationResult`

---

### `src/features/StreamingExporter.ts` - Streaming Export Module

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `createWriteStream` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/types.js` | `Entity, ReadonlyKnowledgeGraph, LongRunningOperationOptions` | Import (type-only) |
| `../utils/index.js` | `checkCancellation, createProgressReporter, createProgress, validateFilePath` | Import |

**Exports:**

- Classes: `StreamingExporter`
- Interfaces: `StreamResult`

---

### `src/features/TagManager.ts` - Tag Manager

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs/promises` | `* as fs` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `TagAlias` | Import (type-only) |

**Exports:**

- Classes: `TagManager`

---

## Entry Dependencies

### `src/index.ts` - MemoryJS - Knowledge Graph Storage Library

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types/index.js` | `*` | Re-export |
| `./utils/index.js` | `*` | Re-export |
| `./core/index.js` | `*` | Re-export |
| `./features/index.js` | `*` | Re-export |
| `./search/index.js` | `*` | Re-export |

**Exports:**

- Re-exports: `* from ./types/index.js`, `* from ./utils/index.js`, `* from ./core/index.js`, `* from ./features/index.js`, `* from ./search/index.js`

---

## Search Dependencies

### `src/search/BasicSearch.ts` - Basic Search

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `KnowledgeGraph` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `isWithinDateRange, SEARCH_LIMITS, searchCaches` | Import |
| `./SearchFilterChain.js` | `SearchFilterChain, SearchFilters` | Import |

**Exports:**

- Classes: `BasicSearch`

---

### `src/search/BM25Search.ts` - BM25 Search

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, SearchResult` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/constants.js` | `SEARCH_LIMITS` | Import |

**Exports:**

- Classes: `BM25Search`
- Interfaces: `BM25DocumentEntry`, `BM25Index`, `BM25Config`
- Constants: `STOPWORDS`, `DEFAULT_BM25_CONFIG`

---

### `src/search/BooleanSearch.ts` - Boolean Search

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `BooleanQueryNode, Entity, KnowledgeGraph` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/constants.js` | `SEARCH_LIMITS, QUERY_LIMITS` | Import |
| `../utils/errors.js` | `ValidationError` | Import |
| `./SearchFilterChain.js` | `SearchFilterChain, SearchFilters` | Import |

**Exports:**

- Classes: `BooleanSearch`

---

### `src/search/EarlyTerminationManager.ts` - Early Termination Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `HybridSearchResult, QueryAnalysis, ReadonlyKnowledgeGraph` | Import (type-only) |
| `./HybridSearchManager.js` | `HybridSearchManager` | Import (type-only) |
| `./QueryCostEstimator.js` | `SearchLayer` | Import (type-only) |
| `./QueryCostEstimator.js` | `QueryCostEstimator` | Import |

**Exports:**

- Classes: `EarlyTerminationManager`
- Interfaces: `AdequacyCheck`, `EarlyTerminationOptions`, `EarlyTerminationResult`

---

### `src/search/EmbeddingCache.ts` - Embedding Cache

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `crypto` | `createHash` |

**Exports:**

- Classes: `EmbeddingCache`
- Interfaces: `EmbeddingCacheStats`, `EmbeddingCacheOptions`
- Constants: `DEFAULT_EMBEDDING_CACHE_OPTIONS`

---

### `src/search/EmbeddingService.ts` - Embedding Service

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `EmbeddingService, EmbeddingConfig, EmbeddingMode` | Import (type-only) |
| `../utils/constants.js` | `EMBEDDING_DEFAULTS, OPENAI_API_CONFIG, getEmbeddingConfig` | Import |

**Exports:**

- Classes: `OpenAIEmbeddingService`, `LocalEmbeddingService`, `MockEmbeddingService`
- Functions: `l2Normalize`, `createEmbeddingService`
- Constants: `QUERY_PREFIX`, `DOCUMENT_PREFIX`

---

### `src/search/FuzzySearch.ts` - Fuzzy Search

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@danielsimonjr/workerpool` | `Pool, workerpool` |

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `url` | `fileURLToPath` |
| `path` | `dirname, join, sep` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, KnowledgeGraph` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `levenshteinDistance` | Import |
| `../utils/constants.js` | `SEARCH_LIMITS` | Import |
| `./SearchFilterChain.js` | `SearchFilterChain, SearchFilters` | Import |

**Exports:**

- Classes: `FuzzySearch`
- Interfaces: `FuzzySearchOptions`
- Constants: `DEFAULT_FUZZY_THRESHOLD`

---

### `src/search/HybridScorer.ts` - Hybrid Scorer

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity` | Import (type-only) |

**Exports:**

- Classes: `HybridScorer`
- Interfaces: `SemanticLayerResult`, `LexicalSearchResult`, `SymbolicSearchResult`, `ScoredResult`, `HybridWeights`, `HybridScorerOptions`
- Constants: `DEFAULT_SCORER_WEIGHTS`

---

### `src/search/HybridSearchManager.ts` - Hybrid Search Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, HybridSearchOptions, HybridSearchResult, ReadonlyKnowledgeGraph, SymbolicFilters` | Import (type-only) |
| `./SemanticSearch.js` | `SemanticSearch` | Import (type-only) |
| `./RankedSearch.js` | `RankedSearch` | Import (type-only) |
| `./SymbolicSearch.js` | `SymbolicSearch` | Import |
| `../utils/constants.js` | `SEMANTIC_SEARCH_LIMITS` | Import |

**Exports:**

- Classes: `HybridSearchManager`
- Constants: `DEFAULT_HYBRID_WEIGHTS`

---

### `src/search/IncrementalIndexer.ts` - Incremental Indexer

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `EmbeddingService, EmbeddingMode` | Import (type-only) |
| `../types/index.js` | `IVectorStore` | Import (type-only) |
| `./EmbeddingService.js` | `EmbeddingProgressCallback` | Import (type-only) |

**Exports:**

- Classes: `IncrementalIndexer`
- Interfaces: `IndexOperation`, `IncrementalIndexerOptions`, `FlushResult`
- Constants: `DEFAULT_INDEXER_OPTIONS`

---

### `src/search/index.ts` - Search Module Barrel Export

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./BasicSearch.js` | `BasicSearch` | Re-export |
| `./RankedSearch.js` | `RankedSearch` | Re-export |
| `./BooleanSearch.js` | `BooleanSearch` | Re-export |
| `./FuzzySearch.js` | `FuzzySearch, type FuzzySearchOptions` | Re-export |
| `./SearchSuggestions.js` | `SearchSuggestions` | Re-export |
| `./SavedSearchManager.js` | `SavedSearchManager` | Re-export |
| `./SearchManager.js` | `SearchManager` | Re-export |
| `./SearchFilterChain.js` | `SearchFilterChain, type SearchFilters, type ValidatedPagination` | Re-export |
| `./EmbeddingService.js` | `OpenAIEmbeddingService, LocalEmbeddingService, MockEmbeddingService, createEmbeddingService, l2Normalize, QUERY_PREFIX, DOCUMENT_PREFIX, type EmbeddingProgressCallback` | Re-export |
| `./EmbeddingCache.js` | `EmbeddingCache, DEFAULT_EMBEDDING_CACHE_OPTIONS, type EmbeddingCacheStats, type EmbeddingCacheOptions` | Re-export |
| `./IncrementalIndexer.js` | `IncrementalIndexer, DEFAULT_INDEXER_OPTIONS, type IndexOperationType, type IndexOperation, type IncrementalIndexerOptions, type FlushResult` | Re-export |
| `./VectorStore.js` | `InMemoryVectorStore, SQLiteVectorStore, createVectorStore, cosineSimilarity, type SQLiteStorageWithEmbeddings` | Re-export |
| `./SemanticSearch.js` | `SemanticSearch, entityToText` | Re-export |
| `./TFIDFIndexManager.js` | `TFIDFIndexManager` | Re-export |
| `./TFIDFEventSync.js` | `TFIDFEventSync` | Re-export |
| `./QueryCostEstimator.js` | `QueryCostEstimator, type SearchLayer, type ExtendedQueryCostEstimate, type LayerRecommendationOptions, type TokenEstimationOptions, type AdaptiveDepthConfig` | Re-export |
| `./SymbolicSearch.js` | `SymbolicSearch, type SymbolicResult` | Re-export |
| `./HybridSearchManager.js` | `HybridSearchManager, DEFAULT_HYBRID_WEIGHTS` | Re-export |
| `./QueryAnalyzer.js` | `QueryAnalyzer` | Re-export |
| `./QueryPlanner.js` | `QueryPlanner` | Re-export |
| `./ReflectionManager.js` | `ReflectionManager, type ReflectionOptions, type ReflectionResult, type RefinementHistoryEntry` | Re-export |
| `./BM25Search.js` | `BM25Search, STOPWORDS, DEFAULT_BM25_CONFIG, type BM25DocumentEntry, type BM25Index, type BM25Config` | Re-export |
| `./OptimizedInvertedIndex.js` | `OptimizedInvertedIndex, type IndexMemoryUsage, type PostingListResult` | Re-export |
| `./HybridScorer.js` | `HybridScorer, DEFAULT_SCORER_WEIGHTS, type SemanticLayerResult, type LexicalSearchResult, type SymbolicSearchResult, type ScoredResult, type HybridWeights, type HybridScorerOptions` | Re-export |
| `./ParallelSearchExecutor.js` | `ParallelSearchExecutor, type LayerTiming, type ParallelSearchResult, type ParallelSearchOptions` | Re-export |
| `./EarlyTerminationManager.js` | `EarlyTerminationManager, type AdequacyCheck, type EarlyTerminationOptions, type EarlyTerminationResult` | Re-export |
| `./QueryPlanCache.js` | `QueryPlanCache, type CachedQueryEntry, type QueryPlanCacheStats, type QueryPlanCacheOptions` | Re-export |
| `./QuantizedVectorStore.js` | `QuantizedVectorStore, type QuantizationParams, type QuantizedVectorStoreStats, type QuantizedSearchResult, type QuantizedVectorStoreOptions` | Re-export |

**Exports:**

- Re-exports: `BasicSearch`, `RankedSearch`, `BooleanSearch`, `FuzzySearch`, `type FuzzySearchOptions`, `SearchSuggestions`, `SavedSearchManager`, `SearchManager`, `SearchFilterChain`, `type SearchFilters`, `type ValidatedPagination`, `OpenAIEmbeddingService`, `LocalEmbeddingService`, `MockEmbeddingService`, `createEmbeddingService`, `l2Normalize`, `QUERY_PREFIX`, `DOCUMENT_PREFIX`, `type EmbeddingProgressCallback`, `EmbeddingCache`, `DEFAULT_EMBEDDING_CACHE_OPTIONS`, `type EmbeddingCacheStats`, `type EmbeddingCacheOptions`, `IncrementalIndexer`, `DEFAULT_INDEXER_OPTIONS`, `type IndexOperationType`, `type IndexOperation`, `type IncrementalIndexerOptions`, `type FlushResult`, `InMemoryVectorStore`, `SQLiteVectorStore`, `createVectorStore`, `cosineSimilarity`, `type SQLiteStorageWithEmbeddings`, `SemanticSearch`, `entityToText`, `TFIDFIndexManager`, `TFIDFEventSync`, `QueryCostEstimator`, `type SearchLayer`, `type ExtendedQueryCostEstimate`, `type LayerRecommendationOptions`, `type TokenEstimationOptions`, `type AdaptiveDepthConfig`, `SymbolicSearch`, `type SymbolicResult`, `HybridSearchManager`, `DEFAULT_HYBRID_WEIGHTS`, `QueryAnalyzer`, `QueryPlanner`, `ReflectionManager`, `type ReflectionOptions`, `type ReflectionResult`, `type RefinementHistoryEntry`, `BM25Search`, `STOPWORDS`, `DEFAULT_BM25_CONFIG`, `type BM25DocumentEntry`, `type BM25Index`, `type BM25Config`, `OptimizedInvertedIndex`, `type IndexMemoryUsage`, `type PostingListResult`, `HybridScorer`, `DEFAULT_SCORER_WEIGHTS`, `type SemanticLayerResult`, `type LexicalSearchResult`, `type SymbolicSearchResult`, `type ScoredResult`, `type HybridWeights`, `type HybridScorerOptions`, `ParallelSearchExecutor`, `type LayerTiming`, `type ParallelSearchResult`, `type ParallelSearchOptions`, `EarlyTerminationManager`, `type AdequacyCheck`, `type EarlyTerminationOptions`, `type EarlyTerminationResult`, `QueryPlanCache`, `type CachedQueryEntry`, `type QueryPlanCacheStats`, `type QueryPlanCacheOptions`, `QuantizedVectorStore`, `type QuantizationParams`, `type QuantizedVectorStoreStats`, `type QuantizedSearchResult`, `type QuantizedVectorStoreOptions`

---

### `src/search/OptimizedInvertedIndex.ts` - Optimized Inverted Index

**Exports:**

- Classes: `OptimizedInvertedIndex`
- Interfaces: `IndexMemoryUsage`, `PostingListResult`

---

### `src/search/ParallelSearchExecutor.ts` - Parallel Search Executor

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, ReadonlyKnowledgeGraph, SymbolicFilters` | Import (type-only) |
| `./SemanticSearch.js` | `SemanticSearch` | Import (type-only) |
| `./RankedSearch.js` | `RankedSearch` | Import (type-only) |
| `./SymbolicSearch.js` | `SymbolicSearch` | Import |
| `../utils/constants.js` | `SEMANTIC_SEARCH_LIMITS` | Import |

**Exports:**

- Classes: `ParallelSearchExecutor`
- Interfaces: `LayerTiming`, `ParallelSearchResult`, `ParallelSearchOptions`

---

### `src/search/QuantizedVectorStore.ts` - Quantized Vector Store

**Exports:**

- Classes: `QuantizedVectorStore`
- Interfaces: `QuantizationParams`, `QuantizedVectorStoreStats`, `QuantizedSearchResult`, `QuantizedVectorStoreOptions`

---

### `src/search/QueryAnalyzer.ts` - Query Analyzer

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `QueryAnalysis, ExtractedEntity, TemporalRange` | Import (type-only) |

**Exports:**

- Classes: `QueryAnalyzer`

---

### `src/search/QueryCostEstimator.ts` - Query Cost Estimator

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `SearchMethod, QueryCostEstimate, QueryCostEstimatorOptions, QueryAnalysis` | Import (type-only) |

**Exports:**

- Classes: `QueryCostEstimator`
- Interfaces: `ExtendedQueryCostEstimate`, `LayerRecommendationOptions`, `TokenEstimationOptions`, `AdaptiveDepthConfig`

---

### `src/search/QueryPlanCache.ts` - Query Plan Cache

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `QueryAnalysis, QueryPlan` | Import (type-only) |

**Exports:**

- Classes: `QueryPlanCache`
- Interfaces: `CachedQueryEntry`, `QueryPlanCacheStats`, `QueryPlanCacheOptions`

---

### `src/search/QueryPlanner.ts` - Query Planner

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `QueryAnalysis, QueryPlan, SubQuery, SymbolicFilters` | Import (type-only) |

**Exports:**

- Classes: `QueryPlanner`

---

### `src/search/RankedSearch.ts` - Ranked Search

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, SearchResult, TFIDFIndex, TokenizedEntity` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `calculateTF, calculateIDFFromTokenSets, tokenize` | Import |
| `../utils/constants.js` | `SEARCH_LIMITS` | Import |
| `./TFIDFIndexManager.js` | `TFIDFIndexManager` | Import |
| `./SearchFilterChain.js` | `SearchFilterChain, SearchFilters` | Import |

**Exports:**

- Classes: `RankedSearch`

---

### `src/search/ReflectionManager.ts` - Reflection Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `ReadonlyKnowledgeGraph, QueryAnalysis, HybridSearchResult, HybridSearchOptions` | Import (type-only) |
| `./HybridSearchManager.js` | `HybridSearchManager` | Import (type-only) |
| `./QueryAnalyzer.js` | `QueryAnalyzer` | Import (type-only) |

**Exports:**

- Classes: `ReflectionManager`
- Interfaces: `ReflectionOptions`, `RefinementHistoryEntry`, `ReflectionResult`

---

### `src/search/SavedSearchManager.ts` - Saved Search Manager

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs/promises` | `* as fs` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `SavedSearch, KnowledgeGraph` | Import (type-only) |
| `./BasicSearch.js` | `BasicSearch` | Import (type-only) |
| `../utils/index.js` | `sanitizeObject` | Import |

**Exports:**

- Classes: `SavedSearchManager`

---

### `src/search/SearchFilterChain.ts` - Search Filter Chain

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity` | Import (type-only) |
| `../utils/index.js` | `normalizeTags, hasMatchingTag, isWithinImportanceRange, validatePagination, applyPagination, ValidatedPagination` | Import |

**Exports:**

- Classes: `SearchFilterChain`
- Interfaces: `SearchFilters`

---

### `src/search/SearchManager.ts` - Search Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `KnowledgeGraph, SearchResult, SavedSearch, AutoSearchResult, Entity` | Import (type-only) |
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `./BasicSearch.js` | `BasicSearch` | Import |
| `./RankedSearch.js` | `RankedSearch` | Import |
| `./BooleanSearch.js` | `BooleanSearch` | Import |
| `./FuzzySearch.js` | `FuzzySearch` | Import |
| `./SearchSuggestions.js` | `SearchSuggestions` | Import |
| `./SavedSearchManager.js` | `SavedSearchManager` | Import |
| `./QueryCostEstimator.js` | `QueryCostEstimator` | Import |

**Exports:**

- Classes: `SearchManager`

---

### `src/search/SearchSuggestions.ts` - Search Suggestions

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../core/GraphStorage.js` | `GraphStorage` | Import (type-only) |
| `../utils/index.js` | `levenshteinDistance` | Import |

**Exports:**

- Classes: `SearchSuggestions`

---

### `src/search/SemanticSearch.ts` - Semantic Search Manager

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, EmbeddingService, IVectorStore, SemanticSearchResult, SemanticIndexOptions, ReadonlyKnowledgeGraph` | Import (type-only) |
| `./VectorStore.js` | `InMemoryVectorStore` | Import |
| `../utils/constants.js` | `EMBEDDING_DEFAULTS, SEMANTIC_SEARCH_LIMITS` | Import |
| `../utils/index.js` | `checkCancellation` | Import |

**Exports:**

- Classes: `SemanticSearch`
- Functions: `entityToText`

---

### `src/search/SymbolicSearch.ts` - Symbolic Search Layer

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, SymbolicFilters` | Import (type-only) |

**Exports:**

- Classes: `SymbolicSearch`
- Interfaces: `SymbolicResult`

---

### `src/search/TFIDFEventSync.ts` - TF-IDF Event Sync

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../core/GraphEventEmitter.js` | `GraphEventEmitter` | Import (type-only) |
| `./TFIDFIndexManager.js` | `TFIDFIndexManager` | Import (type-only) |
| `../types/index.js` | `IGraphStorage` | Import (type-only) |
| `../types/types.js` | `EntityCreatedEvent, EntityUpdatedEvent, EntityDeletedEvent` | Import (type-only) |

**Exports:**

- Classes: `TFIDFEventSync`

---

### `src/search/TFIDFIndexManager.ts` - TF-IDF Index Manager

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs/promises` | `* as fs` |
| `path` | `* as path` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `TFIDFIndex, DocumentVector, KnowledgeGraph, ReadonlyKnowledgeGraph` | Import (type-only) |
| `../utils/index.js` | `calculateIDFFromTokenSets, tokenize` | Import |

**Exports:**

- Classes: `TFIDFIndexManager`

---

### `src/search/VectorStore.ts` - Vector Store

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `IVectorStore, VectorSearchResult` | Import (type-only) |

**Exports:**

- Classes: `InMemoryVectorStore`, `SQLiteVectorStore`
- Interfaces: `SQLiteStorageWithEmbeddings`
- Functions: `cosineSimilarity`, `createVectorStore`

---

## Types Dependencies

### `src/types/index.ts` - Types Module - Barrel Export

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./types/index.js` | `Entity, Relation, KnowledgeGraph, SearchResult` | Import |

---

### `src/types/types.ts` - Type Definitions

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../utils/taskScheduler.js` | `ProgressCallback, TaskPriority` | Import (type-only) |

---

## Utils Dependencies

### `src/utils/BatchProcessor.ts` - Batch Processor

**Exports:**

- Classes: `BatchProcessor`
- Interfaces: `BatchProgress`, `BatchItemResult`, `BatchProcessResult`, `BatchProcessorOptions`
- Functions: `processBatch`, `processWithRetry`, `chunkArray`, `parallelLimit`, `mapParallel`, `filterParallel`

---

### `src/utils/compressedCache.ts` - Compressed Cache Utility

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `zlib` | `brotliCompressSync, brotliDecompressSync, constants` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity` | Import (type-only) |
| `./constants.js` | `COMPRESSION_CONFIG` | Import |

**Exports:**

- Classes: `CompressedCache`
- Interfaces: `CompressedCacheOptions`, `CompressedCacheStats`

---

### `src/utils/compressionUtil.ts` - Compression Utility Module

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `zlib` | `brotliCompress, brotliDecompress, constants` |
| `util` | `promisify` |
| `fs` | `promises` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./constants.js` | `COMPRESSION_CONFIG` | Import |

**Exports:**

- Interfaces: `CompressionOptions`, `CompressionResult`, `CompressionMetadata`
- Functions: `hasBrotliExtension`, `compress`, `decompress`, `getCompressionRatio`, `compressFile`, `decompressFile`, `createMetadata`, `createUncompressedMetadata`, `compressToBase64`, `decompressFromBase64`

---

### `src/utils/constants.ts` - Application Constants

**Exports:**

- Functions: `getEmbeddingConfig`
- Constants: `FILE_EXTENSIONS`, `FILE_SUFFIXES`, `DEFAULT_FILE_NAMES`, `ENV_VARS`, `DEFAULT_BASE_DIR`, `LOG_PREFIXES`, `SIMILARITY_WEIGHTS`, `DEFAULT_DUPLICATE_THRESHOLD`, `SEARCH_LIMITS`, `IMPORTANCE_RANGE`, `GRAPH_LIMITS`, `QUERY_LIMITS`, `COMPRESSION_CONFIG`, `EMBEDDING_ENV_VARS`, `EMBEDDING_DEFAULTS`, `SEMANTIC_SEARCH_LIMITS`, `OPENAI_API_CONFIG`, `STREAMING_CONFIG`

---

### `src/utils/entityUtils.ts` - Entity Utilities

**Node.js Built-in Dependencies:**
| Module | Import |
|--------|--------|
| `fs` | `promises` |
| `path` | `path` |
| `url` | `fileURLToPath` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, KnowledgeGraph` | Import (type-only) |
| `./errors.js` | `EntityNotFoundError, FileOperationError` | Import |

**Exports:**

- Interfaces: `CommonSearchFilters`
- Functions: `fnv1aHash`, `findEntityByName`, `findEntityByName`, `findEntityByName`, `findEntityByName`, `findEntitiesByNames`, `entityExists`, `getEntityIndex`, `removeEntityByName`, `getEntityNameSet`, `groupEntitiesByType`, `touchEntity`, `normalizeTag`, `normalizeTags`, `hasMatchingTag`, `hasAllTags`, `filterByTags`, `addUniqueTags`, `removeTags`, `isWithinDateRange`, `parseDateRange`, `isValidISODate`, `getCurrentTimestamp`, `isWithinImportanceRange`, `filterByImportance`, `filterByCreatedDate`, `filterByModifiedDate`, `filterByEntityType`, `entityPassesFilters`, `sanitizeObject`, `escapeCsvFormula`, `validateFilePath`, `ensureMemoryFilePath`
- Constants: `defaultMemoryPath`

---

### `src/utils/errors.ts` - Custom Error Types

**Exports:**

- Classes: `KnowledgeGraphError`, `EntityNotFoundError`, `RelationNotFoundError`, `DuplicateEntityError`, `ValidationError`, `CycleDetectedError`, `InvalidImportanceError`, `FileOperationError`, `ImportError`, `ExportError`, `InsufficientEntitiesError`, `OperationCancelledError`

---

### `src/utils/formatters.ts` - Response and Pagination Formatters

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./constants.js` | `SEARCH_LIMITS` | Import |

**Exports:**

- Interfaces: `ValidatedPagination`
- Functions: `formatToolResponse`, `formatTextResponse`, `formatRawResponse`, `formatErrorResponse`, `validatePagination`, `applyPagination`, `paginateArray`, `getPaginationMeta`

---

### `src/utils/index.ts` - Utilities Module Barrel Export

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `KnowledgeGraphError, EntityNotFoundError, RelationNotFoundError, DuplicateEntityError, ValidationError, CycleDetectedError, InvalidImportanceError, FileOperationError, ImportError, ExportError, InsufficientEntitiesError, OperationCancelledError` | Re-export |
| `./constants.js` | `FILE_EXTENSIONS, FILE_SUFFIXES, DEFAULT_FILE_NAMES, ENV_VARS, DEFAULT_BASE_DIR, LOG_PREFIXES, SIMILARITY_WEIGHTS, DEFAULT_DUPLICATE_THRESHOLD, SEARCH_LIMITS, IMPORTANCE_RANGE, GRAPH_LIMITS, QUERY_LIMITS, COMPRESSION_CONFIG, STREAMING_CONFIG, type CompressionQuality` | Re-export |
| `./compressionUtil.js` | `compress, decompress, compressFile, decompressFile, compressToBase64, decompressFromBase64, hasBrotliExtension, getCompressionRatio, createMetadata, createUncompressedMetadata, type CompressionOptions, type CompressionResult, type CompressionMetadata` | Re-export |
| `./compressedCache.js` | `CompressedCache, type CompressedCacheOptions, type CompressedCacheStats` | Re-export |
| `./logger.js` | `logger` | Re-export |
| `./searchAlgorithms.js` | `levenshteinDistance, calculateTF, calculateIDF, calculateIDFFromTokenSets, calculateTFIDF, tokenize` | Re-export |
| `./indexes.js` | `NameIndex, TypeIndex, LowercaseCache, RelationIndex` | Re-export |
| `./searchCache.js` | `SearchCache, searchCaches, clearAllSearchCaches, getAllCacheStats, cleanupAllCaches, type CacheStats` | Re-export |
| `./schemas.js` | `// Zod schemas - Entity/Relation
  EntitySchema, CreateEntitySchema, UpdateEntitySchema, RelationSchema, CreateRelationSchema, SearchQuerySchema, DateRangeSchema, TagAliasSchema, ExportFormatSchema, BatchCreateEntitiesSchema, BatchCreateRelationsSchema, EntityNamesSchema, DeleteRelationsSchema, // Zod schemas - Observations
  AddObservationInputSchema, AddObservationsInputSchema, DeleteObservationInputSchema, DeleteObservationsInputSchema, // Zod schemas - Archive
  ArchiveCriteriaSchema, // Zod schemas - Saved Search
  SavedSearchInputSchema, SavedSearchUpdateSchema, // Zod schemas - Import/Export
  ImportFormatSchema, ExtendedExportFormatSchema, MergeStrategySchema, ExportFilterSchema, // Zod schemas - Search
  OptionalTagsSchema, OptionalEntityNamesSchema, // Schema types
  type EntityInput, type CreateEntityInput, type UpdateEntityInput, type RelationInput, type CreateRelationInput, type SearchQuery, type DateRange, type TagAliasInput, type AddObservationInput, type DeleteObservationInput, type ArchiveCriteriaInput, type SavedSearchInput, type SavedSearchUpdateInput, type ImportFormatInput, type ExtendedExportFormatInput, type MergeStrategyInput, type ExportFilterInput, // Validation result type
  type ValidationResult, // Zod helpers
  formatZodErrors, validateWithSchema, validateSafe, validateArrayWithSchema, // Manual validation functions
  validateEntity, validateRelation, validateImportance, validateTags` | Re-export |
| `./formatters.js` | `// Response formatting
  formatToolResponse, formatTextResponse, formatRawResponse, formatErrorResponse, type ToolResponse, // Pagination utilities
  validatePagination, applyPagination, paginateArray, getPaginationMeta, type ValidatedPagination` | Re-export |
| `./entityUtils.js` | `// Hash functions (Phase 12 Sprint 1)
  fnv1aHash, // Entity lookup
  findEntityByName, findEntitiesByNames, entityExists, getEntityIndex, removeEntityByName, getEntityNameSet, groupEntitiesByType, touchEntity, // Tag utilities
  normalizeTag, normalizeTags, hasMatchingTag, hasAllTags, filterByTags, addUniqueTags, removeTags, // Date utilities
  isWithinDateRange, parseDateRange, isValidISODate, getCurrentTimestamp, // Filter utilities
  isWithinImportanceRange, filterByImportance, filterByCreatedDate, filterByModifiedDate, filterByEntityType, entityPassesFilters, type CommonSearchFilters, // Path utilities
  validateFilePath, defaultMemoryPath, ensureMemoryFilePath, // Security utilities
  sanitizeObject, escapeCsvFormula` | Re-export |
| `./parallelUtils.js` | `parallelMap, parallelFilter, getPoolStats, shutdownParallelUtils` | Re-export |
| `./taskScheduler.js` | `// Types and Enums
  TaskPriority, TaskStatus, type Task, type TaskResult, type ProgressCallback, type TaskBatchOptions, type QueueStats, // Task Queue
  TaskQueue, // Batch Processing
  batchProcess, rateLimitedProcess, withRetry, // Rate Limiting
  debounce, throttle` | Re-export |
| `./operationUtils.js` | `checkCancellation, createProgressReporter, createProgress, executeWithPhases, processBatchesWithProgress, type PhaseDefinition` | Re-export |
| `./WorkerPoolManager.js` | `WorkerPoolManager, getWorkerPoolManager, type WorkerPoolConfig, type ExtendedPoolStats, type PoolEventCallback` | Re-export |
| `./BatchProcessor.js` | `BatchProcessor, processBatch, processWithRetry, chunkArray, parallelLimit, mapParallel, filterParallel, type BatchProgress, type BatchProgressCallback, type BatchItemResult, type BatchProcessResult, type BatchProcessorOptions` | Re-export |
| `./MemoryMonitor.js` | `MemoryMonitor, globalMemoryMonitor, type ComponentMemoryUsage, type MemoryUsageStats, type MemoryThresholds, type MemoryAlert, type MemoryChangeCallback` | Re-export |

**Exports:**

- Re-exports: `KnowledgeGraphError`, `EntityNotFoundError`, `RelationNotFoundError`, `DuplicateEntityError`, `ValidationError`, `CycleDetectedError`, `InvalidImportanceError`, `FileOperationError`, `ImportError`, `ExportError`, `InsufficientEntitiesError`, `OperationCancelledError`, `FILE_EXTENSIONS`, `FILE_SUFFIXES`, `DEFAULT_FILE_NAMES`, `ENV_VARS`, `DEFAULT_BASE_DIR`, `LOG_PREFIXES`, `SIMILARITY_WEIGHTS`, `DEFAULT_DUPLICATE_THRESHOLD`, `SEARCH_LIMITS`, `IMPORTANCE_RANGE`, `GRAPH_LIMITS`, `QUERY_LIMITS`, `COMPRESSION_CONFIG`, `STREAMING_CONFIG`, `type CompressionQuality`, `compress`, `decompress`, `compressFile`, `decompressFile`, `compressToBase64`, `decompressFromBase64`, `hasBrotliExtension`, `getCompressionRatio`, `createMetadata`, `createUncompressedMetadata`, `type CompressionOptions`, `type CompressionResult`, `type CompressionMetadata`, `CompressedCache`, `type CompressedCacheOptions`, `type CompressedCacheStats`, `logger`, `levenshteinDistance`, `calculateTF`, `calculateIDF`, `calculateIDFFromTokenSets`, `calculateTFIDF`, `tokenize`, `NameIndex`, `TypeIndex`, `LowercaseCache`, `RelationIndex`, `SearchCache`, `searchCaches`, `clearAllSearchCaches`, `getAllCacheStats`, `cleanupAllCaches`, `type CacheStats`, `// Zod schemas - Entity/Relation
  EntitySchema`, `CreateEntitySchema`, `UpdateEntitySchema`, `RelationSchema`, `CreateRelationSchema`, `SearchQuerySchema`, `DateRangeSchema`, `TagAliasSchema`, `ExportFormatSchema`, `BatchCreateEntitiesSchema`, `BatchCreateRelationsSchema`, `EntityNamesSchema`, `DeleteRelationsSchema`, `// Zod schemas - Observations
  AddObservationInputSchema`, `AddObservationsInputSchema`, `DeleteObservationInputSchema`, `DeleteObservationsInputSchema`, `// Zod schemas - Archive
  ArchiveCriteriaSchema`, `// Zod schemas - Saved Search
  SavedSearchInputSchema`, `SavedSearchUpdateSchema`, `// Zod schemas - Import/Export
  ImportFormatSchema`, `ExtendedExportFormatSchema`, `MergeStrategySchema`, `ExportFilterSchema`, `// Zod schemas - Search
  OptionalTagsSchema`, `OptionalEntityNamesSchema`, `// Schema types
  type EntityInput`, `type CreateEntityInput`, `type UpdateEntityInput`, `type RelationInput`, `type CreateRelationInput`, `type SearchQuery`, `type DateRange`, `type TagAliasInput`, `type AddObservationInput`, `type DeleteObservationInput`, `type ArchiveCriteriaInput`, `type SavedSearchInput`, `type SavedSearchUpdateInput`, `type ImportFormatInput`, `type ExtendedExportFormatInput`, `type MergeStrategyInput`, `type ExportFilterInput`, `// Validation result type
  type ValidationResult`, `// Zod helpers
  formatZodErrors`, `validateWithSchema`, `validateSafe`, `validateArrayWithSchema`, `// Manual validation functions
  validateEntity`, `validateRelation`, `validateImportance`, `validateTags`, `// Response formatting
  formatToolResponse`, `formatTextResponse`, `formatRawResponse`, `formatErrorResponse`, `type ToolResponse`, `// Pagination utilities
  validatePagination`, `applyPagination`, `paginateArray`, `getPaginationMeta`, `type ValidatedPagination`, `// Hash functions (Phase 12 Sprint 1)
  fnv1aHash`, `// Entity lookup
  findEntityByName`, `findEntitiesByNames`, `entityExists`, `getEntityIndex`, `removeEntityByName`, `getEntityNameSet`, `groupEntitiesByType`, `touchEntity`, `// Tag utilities
  normalizeTag`, `normalizeTags`, `hasMatchingTag`, `hasAllTags`, `filterByTags`, `addUniqueTags`, `removeTags`, `// Date utilities
  isWithinDateRange`, `parseDateRange`, `isValidISODate`, `getCurrentTimestamp`, `// Filter utilities
  isWithinImportanceRange`, `filterByImportance`, `filterByCreatedDate`, `filterByModifiedDate`, `filterByEntityType`, `entityPassesFilters`, `type CommonSearchFilters`, `// Path utilities
  validateFilePath`, `defaultMemoryPath`, `ensureMemoryFilePath`, `// Security utilities
  sanitizeObject`, `escapeCsvFormula`, `parallelMap`, `parallelFilter`, `getPoolStats`, `shutdownParallelUtils`, `// Types and Enums
  TaskPriority`, `TaskStatus`, `type Task`, `type TaskResult`, `type ProgressCallback`, `type TaskBatchOptions`, `type QueueStats`, `// Task Queue
  TaskQueue`, `// Batch Processing
  batchProcess`, `rateLimitedProcess`, `withRetry`, `// Rate Limiting
  debounce`, `throttle`, `checkCancellation`, `createProgressReporter`, `createProgress`, `executeWithPhases`, `processBatchesWithProgress`, `type PhaseDefinition`, `WorkerPoolManager`, `getWorkerPoolManager`, `type WorkerPoolConfig`, `type ExtendedPoolStats`, `type PoolEventCallback`, `BatchProcessor`, `processBatch`, `processWithRetry`, `chunkArray`, `parallelLimit`, `mapParallel`, `filterParallel`, `type BatchProgress`, `type BatchProgressCallback`, `type BatchItemResult`, `type BatchProcessResult`, `type BatchProcessorOptions`, `MemoryMonitor`, `globalMemoryMonitor`, `type ComponentMemoryUsage`, `type MemoryUsageStats`, `type MemoryThresholds`, `type MemoryAlert`, `type MemoryChangeCallback`

---

### `src/utils/indexes.ts` - Search Indexes

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `Entity, LowercaseData, Relation` | Import (type-only) |

**Exports:**

- Classes: `NameIndex`, `TypeIndex`, `LowercaseCache`, `RelationIndex`, `ObservationIndex`

---

### `src/utils/logger.ts` - Simple logging utility for the Memory MCP Server

**Exports:**

- Constants: `logger`

---

### `src/utils/MemoryMonitor.ts` - Memory Usage Monitor

**Exports:**

- Classes: `MemoryMonitor`
- Interfaces: `ComponentMemoryUsage`, `MemoryUsageStats`, `MemoryThresholds`, `MemoryAlert`
- Constants: `globalMemoryMonitor`

---

### `src/utils/operationUtils.ts` - Operation Utilities

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./errors.js` | `OperationCancelledError` | Import |
| `./taskScheduler.js` | `ProgressCallback` | Import (type-only) |

**Exports:**

- Interfaces: `PhaseDefinition`
- Functions: `checkCancellation`, `createProgressReporter`, `createProgress`, `executeWithPhases`, `processBatchesWithProgress`

---

### `src/utils/parallelUtils.ts` - Parallel Utilities

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@danielsimonjr/workerpool` | `workerpool` |

**Exports:**

- Functions: `shutdownParallelUtils`, `parallelMap`, `parallelFilter`, `getPoolStats`

---

### `src/utils/schemas.ts` - Validation Schemas and Helpers

**External Dependencies:**
| Package | Import |
|---------|--------|
| `zod` | `z, ZodSchema, ZodError` |

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./constants.js` | `IMPORTANCE_RANGE` | Import |
| `./errors.js` | `ValidationError` | Import |

**Exports:**

- Interfaces: `ValidationResult`
- Functions: `formatZodErrors`, `validateWithSchema`, `validateSafe`, `validateArrayWithSchema`, `validateEntity`, `validateRelation`, `validateImportance`, `validateTags`
- Constants: `EntitySchema`, `CreateEntitySchema`, `UpdateEntitySchema`, `RelationSchema`, `CreateRelationSchema`, `SearchQuerySchema`, `DateRangeSchema`, `TagAliasSchema`, `ExportFormatSchema`, `BatchCreateEntitiesSchema`, `BatchCreateRelationsSchema`, `EntityNamesSchema`, `DeleteRelationsSchema`, `AddObservationInputSchema`, `AddObservationsInputSchema`, `DeleteObservationInputSchema`, `DeleteObservationsInputSchema`, `ArchiveCriteriaSchema`, `SavedSearchInputSchema`, `SavedSearchUpdateSchema`, `ImportFormatSchema`, `ExtendedExportFormatSchema`, `MergeStrategySchema`, `ExportFilterSchema`, `OptionalTagsSchema`, `OptionalEntityNamesSchema`

---

### `src/utils/searchAlgorithms.ts` - Search Algorithms

**Exports:**

- Functions: `levenshteinDistance`, `calculateTF`, `calculateIDF`, `calculateIDFFromTokenSets`, `calculateTFIDF`, `tokenize`

---

### `src/utils/searchCache.ts` - Search Result Cache

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `../types/index.js` | `SearchResult, KnowledgeGraph` | Import (type-only) |

**Exports:**

- Classes: `SearchCache`
- Interfaces: `CacheStats`
- Functions: `clearAllSearchCaches`, `getAllCacheStats`, `cleanupAllCaches`
- Constants: `searchCaches`

---

### `src/utils/taskScheduler.ts` - Task Scheduler

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@danielsimonjr/workerpool` | `workerpool` |

**Exports:**

- Classes: `TaskQueue`
- Interfaces: `Task`, `TaskResult`, `TaskBatchOptions`, `QueueStats`
- Enums: `TaskPriority`, `TaskStatus`
- Functions: `batchProcess`, `rateLimitedProcess`, `withRetry`, `debounce`, `throttle`

---

### `src/utils/WorkerPoolManager.ts` - Worker Pool Manager

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@danielsimonjr/workerpool` | `workerpool` |
| `@danielsimonjr/workerpool` | `Pool, PoolStats` |

**Exports:**

- Classes: `WorkerPoolManager`
- Interfaces: `WorkerPoolConfig`, `ExtendedPoolStats`
- Functions: `getWorkerPoolManager`

---

## Workers Dependencies

### `src/workers/index.ts` - Workers Module

**Internal Dependencies:**
| File | Imports | Type |
|------|---------|------|
| `./levenshteinWorker.js` | `levenshteinDistance, similarity, searchEntities` | Re-export |

**Exports:**

- Re-exports: `levenshteinDistance`, `similarity`, `searchEntities`

---

### `src/workers/levenshteinWorker.ts` - Levenshtein Worker

**External Dependencies:**
| Package | Import |
|---------|--------|
| `@danielsimonjr/workerpool` | `workerpool` |

**Exports:**

- Interfaces: `WorkerInput`, `MatchResult`
- Functions: `levenshteinDistance`, `similarity`, `searchEntities`

---

## Dependency Matrix

### File Import/Export Matrix

| File                      | Imports From | Exports To |
| ------------------------- | ------------ | ---------- |
| `EntityManager`           | 5 files      | 2 files    |
| `GraphEventEmitter`       | 1 files      | 3 files    |
| `GraphStorage`            | 6 files      | 20 files   |
| `GraphTraversal`          | 3 files      | 2 files    |
| `HierarchyManager`        | 3 files      | 2 files    |
| `index`                   | 11 files     | 1 files    |
| `ManagerContext`          | 16 files     | 1 files    |
| `ObservationManager`      | 2 files      | 2 files    |
| `RelationManager`         | 5 files      | 2 files    |
| `SQLiteStorage`           | 4 files      | 2 files    |
| `StorageFactory`          | 3 files      | 2 files    |
| `TransactionManager`      | 5 files      | 2 files    |
| `AnalyticsManager`        | 2 files      | 2 files    |
| `ArchiveManager`          | 3 files      | 2 files    |
| `CompressionManager`      | 5 files      | 2 files    |
| `index`                   | 8 files      | 1 files    |
| `IOManager`               | 5 files      | 3 files    |
| `KeywordExtractor`        | 0 files      | 1 files    |
| `ObservationNormalizer`   | 1 files      | 1 files    |
| `StreamingExporter`       | 2 files      | 2 files    |
| `TagManager`              | 1 files      | 2 files    |
| `index`                   | 5 files      | 0 files    |
| `BasicSearch`             | 4 files      | 3 files    |
| `BM25Search`              | 3 files      | 1 files    |
| `BooleanSearch`           | 5 files      | 2 files    |
| `EarlyTerminationManager` | 3 files      | 1 files    |
| `EmbeddingCache`          | 0 files      | 1 files    |
| `EmbeddingService`        | 2 files      | 2 files    |
| `FuzzySearch`             | 5 files      | 2 files    |
| `HybridScorer`            | 1 files      | 1 files    |

---

## Circular Dependency Analysis

**2 circular dependencies detected:**

- **Runtime cycles**: 0 (require attention)
- **Type-only cycles**: 2 (safe, no runtime impact)

### Type-Only Circular Dependencies

These cycles only involve type imports and are safe (erased at runtime):

- src/core/GraphStorage.ts -> src/core/TransactionManager.ts -> src/core/GraphStorage.ts
- src/core/GraphStorage.ts -> src/core/TransactionManager.ts -> src/features/IOManager.ts -> src/core/GraphStorage.ts

---

## Visual Dependency Graph

```mermaid
graph TD
    subgraph Core
        N0[EntityManager]
        N1[GraphEventEmitter]
        N2[GraphStorage]
        N3[GraphTraversal]
        N4[HierarchyManager]
        N5[...7 more]
    end

    subgraph Features
        N6[AnalyticsManager]
        N7[ArchiveManager]
        N8[CompressionManager]
        N9[index]
        N10[IOManager]
        N11[...4 more]
    end

    subgraph Entry
        N12[index]
    end

    subgraph Search
        N13[BasicSearch]
        N14[BM25Search]
        N15[BooleanSearch]
        N16[EarlyTerminationManager]
        N17[EmbeddingCache]
        N18[...24 more]
    end

    subgraph Types
        N19[index]
        N20[types]
    end

    subgraph Utils
        N21[BatchProcessor]
        N22[compressedCache]
        N23[compressionUtil]
        N24[constants]
        N25[entityUtils]
        N26[...13 more]
    end

    subgraph Workers
        N27[index]
        N28[levenshteinWorker]
    end

    N0 --> N19
    N0 --> N2
    N0 --> N24
    N1 --> N19
    N2 --> N19
    N2 --> N1
    N3 --> N19
    N3 --> N2
    N4 --> N19
    N4 --> N2
    N6 --> N2
    N6 --> N19
    N7 --> N19
    N7 --> N2
    N8 --> N19
    N8 --> N2
    N8 --> N24
    N9 --> N10
    N9 --> N6
    N9 --> N8
    N9 --> N7
    N10 --> N19
    N10 --> N2
    N12 --> N19
    N12 --> N9
    N13 --> N19
    N13 --> N2
    N14 --> N19
    N14 --> N2
    N14 --> N24
```

---

## Summary Statistics

| Category                | Count |
| ----------------------- | ----- |
| Total TypeScript Files  | 73    |
| Total Modules           | 7     |
| Total Lines of Code     | 28939 |
| Total Exports           | 558   |
| Total Re-exports        | 333   |
| Total Classes           | 73    |
| Total Interfaces        | 145   |
| Total Functions         | 100   |
| Total Type Guards       | 3     |
| Total Enums             | 3     |
| Type-only Imports       | 77    |
| Runtime Circular Deps   | 0     |
| Type-only Circular Deps | 2     |

---

*Last Updated*: 2026-01-10
*Version*: 1.0.0
