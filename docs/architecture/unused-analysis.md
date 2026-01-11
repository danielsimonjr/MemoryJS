# Unused Files and Exports Analysis

**Generated**: 2026-01-10

## Summary

- **Potentially unused files**: 0
- **Potentially unused exports**: 198

## Potentially Unused Files

These files are not imported by any other file in the codebase:


## Potentially Unused Exports

These exports are not imported by any other file in the codebase:

### `src/core/TransactionManager.ts`

- `TransactionResult` (interface)
- `TransactionOperation` (type)

### `src/features/ArchiveManager.ts`

- `ArchiveCriteria` (interface)
- `ArchiveOptions` (interface)
- `ArchiveResult` (interface)

### `src/features/IOManager.ts`

- `BackupMetadata` (interface)
- `BackupInfo` (interface)
- `ExportFormat` (type)
- `ImportFormat` (type)
- `MergeStrategy` (type)

### `src/features/KeywordExtractor.ts`

- `ScoredKeyword` (interface)

### `src/features/ObservationNormalizer.ts`

- `NormalizationOptions` (interface)
- `NormalizationResult` (interface)

### `src/search/BM25Search.ts`

- `BM25DocumentEntry` (interface)
- `BM25Index` (interface)
- `BM25Config` (interface)

### `src/search/EarlyTerminationManager.ts`

- `AdequacyCheck` (interface)
- `EarlyTerminationOptions` (interface)
- `EarlyTerminationResult` (interface)

### `src/search/EmbeddingCache.ts`

- `EmbeddingCacheStats` (interface)
- `EmbeddingCacheOptions` (interface)

### `src/search/FuzzySearch.ts`

- `FuzzySearchOptions` (interface)
- `DEFAULT_FUZZY_THRESHOLD` (constant)

### `src/search/HybridScorer.ts`

- `SemanticLayerResult` (interface)
- `LexicalSearchResult` (interface)
- `SymbolicSearchResult` (interface)
- `ScoredResult` (interface)
- `HybridWeights` (interface)
- `HybridScorerOptions` (interface)

### `src/search/IncrementalIndexer.ts`

- `IndexOperation` (interface)
- `IncrementalIndexerOptions` (interface)
- `FlushResult` (interface)
- `IndexOperationType` (type)

### `src/search/OptimizedInvertedIndex.ts`

- `IndexMemoryUsage` (interface)
- `PostingListResult` (interface)

### `src/search/ParallelSearchExecutor.ts`

- `LayerTiming` (interface)
- `ParallelSearchResult` (interface)
- `ParallelSearchOptions` (interface)

### `src/search/QuantizedVectorStore.ts`

- `QuantizationParams` (interface)
- `QuantizedVectorStoreStats` (interface)
- `QuantizedSearchResult` (interface)
- `QuantizedVectorStoreOptions` (interface)

### `src/search/QueryCostEstimator.ts`

- `ExtendedQueryCostEstimate` (interface)
- `LayerRecommendationOptions` (interface)
- `TokenEstimationOptions` (interface)
- `AdaptiveDepthConfig` (interface)

### `src/search/QueryPlanCache.ts`

- `CachedQueryEntry` (interface)
- `QueryPlanCacheStats` (interface)
- `QueryPlanCacheOptions` (interface)

### `src/search/ReflectionManager.ts`

- `ReflectionOptions` (interface)
- `RefinementHistoryEntry` (interface)
- `ReflectionResult` (interface)

### `src/search/SymbolicSearch.ts`

- `SymbolicResult` (interface)

### `src/search/VectorStore.ts`

- `SQLiteStorageWithEmbeddings` (interface)

### `src/types/types.ts`

- `Relation` (interface)
- `KnowledgeGraph` (interface)
- `FuzzyCacheKey` (interface)
- `BooleanCacheEntry` (interface)
- `PaginatedCacheEntry` (interface)
- `TokenizedEntity` (interface)
- `SearchResult` (interface)
- `SavedSearch` (interface)
- `DocumentVector` (interface)
- `TFIDFIndex` (interface)
- `GraphStats` (interface)
- `ValidationReport` (interface)
- `ValidationIssue` (interface)
- `ValidationWarning` (interface)
- `ExportFilter` (interface)
- `ImportResult` (interface)
- `GraphCompressionResult` (interface)
- `BackupOptions` (interface)
- `BackupResult` (interface)
- `RestoreResult` (interface)
- `BackupMetadataExtended` (interface)
- `BackupInfoExtended` (interface)
- `ExportOptions` (interface)
- `ExportResult` (interface)
- `ArchiveResultExtended` (interface)
- `CacheCompressionStats` (interface)
- `TagAlias` (interface)
- `LowercaseData` (interface)
- `StorageConfig` (interface)
- `IGraphStorage` (interface)
- `TraversalOptions` (interface)
- `TraversalResult` (interface)
- `PathResult` (interface)
- `ConnectedComponentsResult` (interface)
- `CentralityResult` (interface)
- `WeightedRelation` (interface)
- `EmbeddingService` (interface)
- `SemanticSearchResult` (interface)
- `IVectorStore` (interface)
- `VectorSearchResult` (interface)
- `EmbeddingConfig` (interface)
- `SemanticIndexOptions` (interface)
- `BatchResult` (interface)
- `BatchOptions` (interface)
- `GraphEventBase` (interface)
- `RelationCreatedEvent` (interface)
- `RelationDeletedEvent` (interface)
- `ObservationAddedEvent` (interface)
- `ObservationDeletedEvent` (interface)
- `GraphSavedEvent` (interface)
- `GraphLoadedEvent` (interface)
- `GraphEventMap` (interface)
- `QueryCostEstimate` (interface)
- `AutoSearchResult` (interface)
- `QueryCostEstimatorOptions` (interface)
- `PreparedEntity` (interface)
- `SymbolicFilters` (interface)
- `HybridSearchOptions` (interface)
- `HybridSearchResult` (interface)
- `ExtractedEntity` (interface)
- `TemporalRange` (interface)
- `QueryAnalysis` (interface)
- `SubQuery` (interface)
- `QueryPlan` (interface)
- `BooleanQueryNode` (type)
- `EmbeddingMode` (type)
- `BatchOperationType` (type)
- `BatchOperation` (type)
- `GraphEventType` (type)
- `GraphEvent` (type)
- `GraphEventListener` (type)
- `SearchMethod` (type)

### `src/utils/BatchProcessor.ts`

- `BatchProgress` (interface)
- `BatchItemResult` (interface)
- `BatchProcessResult` (interface)
- `BatchProcessorOptions` (interface)
- `BatchProgressCallback` (type)

### `src/utils/compressedCache.ts`

- `CompressedCacheOptions` (interface)
- `CompressedCacheStats` (interface)

### `src/utils/compressionUtil.ts`

- `CompressionOptions` (interface)
- `CompressionResult` (interface)
- `CompressionMetadata` (interface)

### `src/utils/constants.ts`

- `CompressionQuality` (type)
- `EMBEDDING_ENV_VARS` (constant)

### `src/utils/entityUtils.ts`

- `fnv1aHash` (function)
- `findEntityByName` (function)
- `findEntityByName` (function)
- `findEntityByName` (function)
- `findEntityByName` (function)
- `normalizeTag` (function)
- `isWithinDateRange` (function)
- `isWithinImportanceRange` (function)
- `sanitizeObject` (function)
- `validateFilePath` (function)
- `CommonSearchFilters` (interface)

### `src/utils/formatters.ts`

- `formatToolResponse` (function)
- `validatePagination` (function)
- `ValidatedPagination` (interface)
- `ToolResponse` (type)

### `src/utils/MemoryMonitor.ts`

- `ComponentMemoryUsage` (interface)
- `MemoryUsageStats` (interface)
- `MemoryThresholds` (interface)
- `MemoryAlert` (interface)
- `MemoryChangeCallback` (type)

### `src/utils/operationUtils.ts`

- `PhaseDefinition` (interface)

### `src/utils/schemas.ts`

- `formatZodErrors` (function)
- `validateEntity` (function)
- `ValidationResult` (interface)
- `EntityInput` (type)
- `CreateEntityInput` (type)
- `UpdateEntityInput` (type)
- `RelationInput` (type)
- `CreateRelationInput` (type)
- `SearchQuery` (type)
- `DateRange` (type)
- `TagAliasInput` (type)
- `AddObservationInput` (type)
- `DeleteObservationInput` (type)
- `ArchiveCriteriaInput` (type)
- `SavedSearchInput` (type)
- `SavedSearchUpdateInput` (type)
- `ImportFormatInput` (type)
- `ExtendedExportFormatInput` (type)
- `MergeStrategyInput` (type)
- `ExportFilterInput` (type)
- `EntitySchema` (constant)
- `AddObservationInputSchema` (constant)
- `ArchiveCriteriaSchema` (constant)
- `SavedSearchInputSchema` (constant)
- `ImportFormatSchema` (constant)
- `OptionalTagsSchema` (constant)

### `src/utils/searchCache.ts`

- `CacheStats` (interface)

### `src/utils/taskScheduler.ts`

- `batchProcess` (function)
- `debounce` (function)
- `TaskQueue` (class)
- `Task` (interface)
- `TaskResult` (interface)
- `TaskBatchOptions` (interface)
- `QueueStats` (interface)

### `src/utils/WorkerPoolManager.ts`

- `WorkerPoolConfig` (interface)
- `ExtendedPoolStats` (interface)
- `PoolEventCallback` (type)

### `src/workers/levenshteinWorker.ts`

- `WorkerInput` (interface)
- `MatchResult` (interface)

