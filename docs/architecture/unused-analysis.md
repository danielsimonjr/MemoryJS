# Unused Files and Exports Analysis

**Generated**: 2026-02-11

## Summary

- **Potentially unused files**: 2
- **Potentially unused exports**: 251

## Potentially Unused Files

These files are not imported by any other file in the codebase:

- `src/cli/index.ts`
- `src/cli/interactive.ts`

## Potentially Unused Exports

These exports are not imported by any other file in the codebase:

### `src/agent/AccessTracker.ts`

- `AccessStats` (interface)
- `AccessTrackerConfig` (interface)

### `src/agent/AgentMemoryManager.ts`

- `CreateMemoryOptions` (interface)
- `RetrieveContextOptions` (interface)

### `src/agent/ConsolidationPipeline.ts`

- `PipelineStage` (interface)
- `StageResult` (interface)

### `src/agent/ContextWindowManager.ts`

- `SpilloverResult` (interface)

### `src/agent/DecayEngine.ts`

- `DecayOperationOptions` (interface)
- `ReinforcementOptions` (interface)

### `src/agent/SessionManager.ts`

- `SessionHistoryOptions` (interface)

### `src/agent/SessionQueryBuilder.ts`

- `SessionSearchOptions` (interface)
- `EntityWithContext` (interface)
- `SearchFunction` (type)

### `src/agent/SummarizationService.ts`

- `GroupingResult` (interface)

### `src/agent/WorkingMemoryManager.ts`

- `SessionMemoryFilter` (interface)
- `PromotionMarkOptions` (interface)
- `PromotionCriteria` (interface)

### `src/cli/formatters.ts`

- `OutputFormat` (type)

### `src/cli/options.ts`

- `defaultOptions` (constant)

### `src/core/EntityManager.ts`

- `GetEntityOptions` (interface)

### `src/core/GraphTraversal.ts`

- `TraversalOptionsWithTracking` (interface)

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

### `src/search/ProximitySearch.ts`

- `ProximityMatch` (interface)
- `ProximityMatchLocation` (interface)

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

### `src/search/QueryLogger.ts`

- `QueryLoggerConfig` (interface)

### `src/search/QueryPlanCache.ts`

- `CachedQueryEntry` (interface)
- `QueryPlanCacheStats` (interface)
- `QueryPlanCacheOptions` (interface)

### `src/search/ReflectionManager.ts`

- `ReflectionOptions` (interface)
- `RefinementHistoryEntry` (interface)
- `ReflectionResult` (interface)

### `src/search/SearchManager.ts`

- `SearchOptionsWithTracking` (interface)

### `src/search/SymbolicSearch.ts`

- `SymbolicResult` (interface)

### `src/search/VectorStore.ts`

- `SQLiteStorageWithEmbeddings` (interface)

### `src/types/agent-memory.ts`

- `ObservationSource` (interface)
- `MemorySource` (interface)
- `AgentObservation` (interface)
- `SalienceWeights` (interface)
- `DecayOptions` (interface)
- `MemoryAcquisitionMethod` (type)
- `TemporalFocus` (type)
- `WorkingMemoryEntity` (type)
- `EpisodicMemoryEntity` (type)
- `SemanticMemoryEntity` (type)
- `ProceduralMemoryEntity` (type)
- `ConsolidationAction` (type)

### `src/types/progress.ts`

- `ProgressInfo` (interface)
- `ProgressOptions` (interface)
- `ProgressInfoCallback` (type)

### `src/types/search.ts`

- `QueryTrace` (interface)
- `QueryStage` (interface)
- `SearchExplanation` (interface)
- `ScoringSignal` (interface)
- `MatchedTerm` (interface)
- `ScoreBoost` (interface)
- `ExplainedSearchResult` (interface)
- `TermNode` (interface)
- `PhraseNode` (interface)
- `WildcardNode` (interface)
- `FieldNode` (interface)

### `src/types/types.ts`

- `KnowledgeGraph` (interface)
- `FuzzyCacheKey` (interface)
- `BooleanCacheEntry` (interface)
- `PaginatedCacheEntry` (interface)
- `TokenizedEntity` (interface)
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
- `TraversalOptions` (interface)
- `TraversalResult` (interface)
- `PathResult` (interface)
- `ConnectedComponentsResult` (interface)
- `CentralityResult` (interface)
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

### `src/utils/EntityValidator.ts`

- `EntityValidatorConfig` (interface)

### `src/utils/errors.ts`

- `ErrorOptions` (interface)

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

### `src/utils/relationValidation.ts`

- `RelationValidationError` (interface)
- `RelationValidationWarning` (interface)
- `RelationValidationResult` (interface)

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

### `src/utils/SchemaValidator.ts`

- `JsonSchema` (interface)

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

