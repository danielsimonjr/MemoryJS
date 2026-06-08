# Unused Files and Exports Analysis

**Generated**: 2026-05-17

## Summary

- **Potentially unused files**: 2
- **Potentially unused exports**: 461

## Potentially Unused Files

These files are not imported by any other file in the codebase:

- `src/cli/index.ts`
- `src/cli/interactive.ts`

## Potentially Unused Exports

These exports are not imported by any other file in the codebase:

### `src/adapters/LangChainMemoryAdapter.ts`

- `ChatMessage` (interface)
- `MemoryInputs` (interface)
- `MemoryVariables` (interface)
- `LangChainMemoryAdapterOptions` (interface)

### `src/adapters/pagination.ts`

- `PaginationParams` (interface)
- `ParsePaginationOptions` (interface)
- `PaginatedResult` (interface)

### `src/adapters/RateLimiter.ts`

- `RateLimiterConfig` (interface)
- `RateLimitVerdict` (interface)

### `src/adapters/RestRouter.ts`

- `RestRequest` (interface)
- `RestResponse` (interface)
- `RouteDefinition` (interface)
- `RestMethod` (type)
- `RestHandler` (type)

### `src/agent/AccessTracker.ts`

- `AccessStats` (interface)
- `AccessTrackerConfig` (interface)

### `src/agent/AgentMemoryManager.ts`

- `CreateMemoryOptions` (interface)
- `RetrieveContextOptions` (interface)

### `src/agent/causal/CausalReasoner.ts`

- `CausalCycle` (interface)
- `CausalReasonerConfig` (interface)
- `CausalRelationType` (type)

### `src/agent/CognitiveLoadAnalyzer.ts`

- `CognitiveLoadConfig` (interface)

### `src/agent/collaboration/CollaborationAuditEnforcer.ts`

- `CollaborationAuditEnforcerOptions` (interface)
- `AttributionMode` (type)

### `src/agent/CollaborativeSynthesis.ts`

- `ConflictView` (interface)
- `SynthesisResult` (interface)
- `ConflictResolutionPolicy` (type)

### `src/agent/ConsolidationPipeline.ts`

- `ReflectionStageConfig` (interface)
- `HeuristicExtractionStageConfig` (interface)
- `ObservationDedupReportStageConfig` (interface)

### `src/agent/ConsolidationScheduler.ts`

- `ConsolidationSchedulerConfig` (interface)
- `ConsolidationCycleResult` (interface)

### `src/agent/ContextWindowManager.ts`

- `ContextCompressionResult` (interface)
- `WakeUpOptions` (interface)
- `WakeUpResult` (interface)
- `SpilloverResult` (interface)
- `CompressionLevel` (type)

### `src/agent/DecayEngine.ts`

- `DecayOperationOptions` (interface)
- `ReinforcementOptions` (interface)

### `src/agent/DecisionManager.ts`

- `DecisionInput` (interface)
- `DecisionEntityOptions` (interface)
- `ListDecisionsOptions` (interface)
- `AcceptDecisionResult` (type)
- `RejectDecisionResult` (type)
- `SupersedeDecisionResult` (type)

### `src/agent/DistillationPipeline.ts`

- `DistillationStats` (interface)
- `DistillationResult` (interface)

### `src/agent/DreamEngine.ts`

- `DreamPhaseConfig` (interface)
- `DreamEngineCallbacks` (interface)
- `DreamPhaseResult` (interface)

### `src/agent/ExclusionManager.ts`

- `AddExclusionRuleInput` (interface)
- `ExclusionCheckResult` (interface)

### `src/agent/ExperienceExtractor.ts`

- `Action` (interface)
- `Rule` (interface)
- `HeuristicGuideline` (interface)
- `DecisionRule` (interface)
- `Experience` (interface)
- `ExperienceExtractorConfig` (interface)
- `Outcome` (type)
- `ClusterMethod` (type)
- `ExperienceType` (type)

### `src/agent/FailureDistillation.ts`

- `FailureDistillationConfig` (interface)
- `FailureDistillationResult` (interface)

### `src/agent/FailureManager.ts`

- `FailureManagerConfig` (interface)
- `FailureEntityOptions` (interface)
- `LookupOptions` (interface)
- `GetAllOptions` (interface)
- `FailureInput` (type)

### `src/agent/HeuristicManager.ts`

- `AddHeuristicOptions` (interface)
- `HeuristicMatch` (interface)
- `HeuristicConflict` (interface)
- `HeuristicUpdateResult` (type)

### `src/agent/ImportanceScorer.ts`

- `ImportanceScorerConfig` (interface)
- `ScoreOptions` (interface)

### `src/agent/MemoryEngine.ts`

- `MemoryEngineConfig` (interface)
- `AddTurnOptions` (interface)
- `AddTurnResult` (interface)
- `DuplicateCheckResult` (interface)
- `DedupTier` (type)
- `MemoryEngineEventName` (type)

### `src/agent/MemoryValidator.ts`

- `Contradiction` (interface)
- `MemoryValidatorConfig` (interface)

### `src/agent/ObservationDedupManager.ts`

- `DuplicateObservationOccurrence` (interface)
- `DuplicateObservationGroup` (interface)
- `ObservationDedupManagerConfig` (interface)

### `src/agent/ObserverPipeline.ts`

- `ObservationScore` (interface)
- `ObserverPipelineStats` (interface)

### `src/agent/PlanManager.ts`

- `PlanManagerConfig` (interface)
- `CreatePlanOptions` (interface)
- `PushSubGoalOptions` (interface)
- `ListPlansOptions` (interface)

### `src/agent/procedural/ProcedureManager.ts`

- `ProcedureManagerConfig` (interface)
- `InvocationResult` (type)

### `src/agent/ProfileManager.ts`

- `ProfileResponse` (interface)
- `ProfileOptions` (interface)

### `src/agent/ProjectContextManager.ts`

- `ProjectContextUpsertInput` (interface)
- `ProjectContextManagerConfig` (interface)
- `ForContextOptions` (interface)

### `src/agent/ProspectiveMemoryManager.ts`

- `ProspectiveMemoryConfig` (interface)
- `ScheduleOptions` (interface)

### `src/agent/rbac/PermissionMatrix.ts`

- `PermissionMatrixRow` (type)

### `src/agent/rbac/RbacMiddleware.ts`

- `RbacMiddlewareOptions` (interface)

### `src/agent/rbac/RoleAssignmentStore.ts`

- `RoleAssignmentStoreOptions` (interface)

### `src/agent/ReflectionManager.ts`

- `ReflectionManagerConfig` (interface)
- `ReflectionInput` (interface)
- `ReflectionEntityOptions` (interface)
- `ListReflectionsOptions` (interface)
- `RelevanceOptions` (interface)
- `ArchiveReflectionResult` (type)

### `src/agent/retrieval/ActiveRetrievalController.ts`

- `RetrievalContext` (interface)
- `RetrievalDecision` (interface)
- `RetrievalRound` (interface)
- `AdaptiveResult` (interface)
- `ActiveRetrievalConfig` (interface)

### `src/agent/retrieval/QueryRewriter.ts`

- `RewriteResult` (interface)

### `src/agent/RoleProfiles.ts`

- `RoleProfile` (interface)
- `AgentRole` (type)

### `src/agent/SessionManager.ts`

- `SessionHistoryOptions` (interface)

### `src/agent/SessionQueryBuilder.ts`

- `SessionSearchOptions` (interface)
- `EntityWithContext` (interface)
- `SearchFunction` (type)

### `src/agent/SQLiteBackend.ts`

- `SQLiteBackendOptions` (interface)

### `src/agent/SummarizationService.ts`

- `GroupingResult` (interface)

### `src/agent/ToolAffordanceManager.ts`

- `ToolAffordanceManagerConfig` (interface)
- `RecordOutcomeInput` (interface)
- `ToolAffordanceStats` (interface)
- `SuggestToolOptions` (interface)
- `ToolSuggestion` (interface)

### `src/agent/ToolCallObserver.ts`

- `ToolCallEvent` (type)

### `src/agent/TrajectoryCompressor.ts`

- `DistillOptions` (interface)
- `CompressedMemory` (interface)
- `RedundancyGroup` (interface)
- `TrajectoryCompressorConfig` (interface)
- `Granularity` (type)
- `TrajectoryMergeStrategy` (type)

### `src/agent/WorkingMemoryManager.ts`

- `SessionMemoryFilter` (interface)
- `PromotionMarkOptions` (interface)
- `PromotionCriteria` (interface)

### `src/agent/WorkThreadManager.ts`

- `WorkThread` (interface)
- `WorkThreadFilter` (interface)
- `CreateWorkThreadOptions` (interface)
- `WorkThreadStatus` (type)

### `src/agent/world/WorldModelManager.ts`

- `WorldModelManagerOptions` (interface)

### `src/cli/commands/helpers.ts`

- `withErrorHandling` (function)

### `src/cli/formatters.ts`

- `OutputFormat` (type)

### `src/cli/options.ts`

- `defaultOptions` (constant)

### `src/core/columns/IColumnStore.ts`

- `InMemoryColumnStore` (class)

### `src/core/EntityManager.ts`

- `EntityManagerOptions` (interface)
- `GetEntityOptions` (interface)

### `src/core/EntityStateMachine.ts`

- `effectiveStatus` (function)
- `canTransition` (function)
- `IllegalStatusTransitionError` (class)

### `src/core/GraphTraversal.ts`

- `TraversalOptionsWithTracking` (interface)

### `src/core/ManagerContext.ts`

- `ManagerContextOptions` (interface)

### `src/core/mmap/FsReadMmapBackend.ts`

- `FsReadMmapBackendOptions` (interface)

### `src/core/ObservationStore.ts`

- `ObservationStoreStats` (interface)

### `src/core/RefIndex.ts`

- `RefIndexStats` (interface)

### `src/core/segments/ISegmentStorage.ts`

- `fnv1a32` (function)
- `InMemorySegmentStorage` (class)

### `src/core/TransactionManager.ts`

- `TransactionResult` (interface)
- `TransactionOperation` (type)

### `src/core/TransitionLedger.ts`

- `TransitionEvent` (interface)
- `TransitionFilter` (interface)

### `src/features/ArchiveManager.ts`

- `ArchiveCriteria` (interface)
- `ArchiveOptions` (interface)
- `ArchiveResult` (interface)

### `src/features/AuditLog.ts`

- `AuditFilter` (interface)
- `AuditStats` (interface)
- `AuditOperation` (type)

### `src/features/BackupManager.ts`

- `BackupMetadata` (interface)
- `BackupInfo` (interface)

### `src/features/FactExtractor.ts`

- `ExtractedFact` (interface)
- `FactExtractionOptions` (interface)
- `FactExtractionResult` (interface)

### `src/features/FreshnessManager.ts`

- `FreshnessReport` (interface)
- `FreshnessManagerConfig` (interface)

### `src/features/GovernanceManager.ts`

- `GovernancePolicy` (interface)
- `GovernanceOperationOptions` (interface)

### `src/features/IOManager.ts`

- `IngestInput` (interface)
- `IngestOptions` (interface)
- `IngestResult` (interface)
- `BackupMetadata` (interface)
- `BackupInfo` (interface)
- `SplitOptions` (interface)
- `SplitResult` (interface)
- `VisualizeOptions` (interface)
- `VisualizeOptions` (interface)
- `ExportFormat` (type)
- `ImportFormat` (type)
- `MergeStrategy` (type)

### `src/features/KeywordExtractor.ts`

- `ScoredKeyword` (interface)

### `src/features/ObservableDataModelAdapter.ts`

- `ObservableDataModelShape` (interface)
- `ObservableDataModelAdapterOptions` (interface)
- `JSONValue` (type)
- `GraphProjection` (type)

### `src/features/ObservationNormalizer.ts`

- `NormalizationOptions` (interface)
- `NormalizationResult` (interface)

### `src/features/SemanticForget.ts`

- `SemanticForgetResult` (interface)
- `SemanticForgetOptions` (interface)

### `src/search/BloomFilter.ts`

- `bloomParams` (function)

### `src/search/BloomPreScreener.ts`

- `BloomPreScreenerOptions` (interface)

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

### `src/search/LLMQueryPlanner.ts`

- `LLMProvider` (interface)

### `src/search/LLMSearchExecutor.ts`

- `LLMSearchExecutorOptions` (interface)

### `src/search/MaterializedViews.ts`

- `ViewDefinition` (interface)
- `ViewSnapshot` (interface)

### `src/search/NGramIndex.ts`

- `NGramIndexStats` (interface)

### `src/search/OptimizedInvertedIndex.ts`

- `IndexMemoryUsage` (interface)
- `PostingListResult` (interface)

### `src/search/ParallelSearchExecutor.ts`

- `LayerTiming` (interface)
- `ParallelSearchResult` (interface)
- `ParallelSearchOptions` (interface)

### `src/search/PartialIndexAdvisor.ts`

- `IndexRecommendation` (interface)
- `PartialIndexAdvisorOptions` (interface)

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

### `src/search/SearchSuggestions.ts`

- `CorrectedQuery` (interface)
- `CorrectQueryOptions` (interface)

### `src/search/SpellChecker.ts`

- `SpellCheckerConfig` (interface)
- `SuggestOptions` (interface)
- `SpellSuggestion` (interface)

### `src/search/SymbolicSearch.ts`

- `SymbolicResult` (interface)

### `src/search/TemporalSearch.ts`

- `TemporalFilterField` (type)

### `src/search/tiered/BrotliColdTier.ts`

- `BrotliColdTierOptions` (interface)

### `src/search/tiered/DiskWarmTier.ts`

- `DiskWarmTierOptions` (interface)

### `src/search/tiered/ITieredIndex.ts`

- `InMemoryTier` (class)
- `HotOnlyIndex` (class)

### `src/search/tiered/LRUHotTier.ts`

- `LRUHotTierOptions` (interface)

### `src/search/tiered/TieredIndex.ts`

- `TieredIndexOptions` (interface)
- `TieredIndexBuildOptions` (interface)

### `src/search/VectorStore.ts`

- `SQLiteStorageWithEmbeddings` (interface)

### `src/security/ABACPolicy.ts`

- `ABACPolicyError` (class)
- `ABACContext` (interface)
- `ABACCondition` (interface)
- `ABACRule` (interface)
- `ABACDecision` (type)
- `ABACEffect` (type)
- `ABACOp` (type)

### `src/security/APIKeyStore.ts`

- `ValidationResult` (interface)
- `KeyRecord` (interface)
- `IssueOptions` (interface)
- `IssueResult` (interface)

### `src/security/PiiRedactor.ts`

- `PiiPattern` (interface)
- `PiiRedactorOptions` (interface)
- `RedactionStats` (interface)
- `RedactionResult` (interface)

### `src/security/RowLevelFilter.ts`

- `RowPredicate` (type)

### `src/types/agent-memory.ts`

- `ObservationSource` (interface)
- `MemorySource` (interface)
- `AgentObservation` (interface)
- `ProfileEntity` (interface)
- `SalienceWeights` (interface)
- `DecayOptions` (interface)
- `GoalEvent` (interface)
- `GroupMembership` (interface)
- `MemoryAcquisitionMethod` (type)
- `TrustLevel` (type)
- `PositiveInt` (type)
- `AtLeastOne` (type)
- `WorkingMemoryEntity` (type)
- `EpisodicMemoryEntity` (type)
- `SemanticMemoryEntity` (type)
- `ProceduralMemoryEntity` (type)
- `ConsolidationAction` (type)
- `TRUST_LEVEL_ORDER` (constant)
- `DEFAULT_TRUST_THRESHOLDS` (constant)

### `src/types/progress.ts`

- `ProgressInfo` (interface)
- `ProgressOptions` (interface)
- `ProgressInfoCallback` (type)

### `src/types/result.ts`

- `Result` (type)

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

- `FuzzyCacheKey` (interface)
- `BooleanCacheEntry` (interface)
- `PaginatedCacheEntry` (interface)
- `TokenizedEntity` (interface)
- `SavedSearch` (interface)
- `DocumentVector` (interface)
- `TFIDFIndex` (interface)
- `GraphStats` (interface)
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
- `EmbeddingService` (interface)
- `SemanticSearchResult` (interface)
- `IVectorStore` (interface)
- `VectorSearchResult` (interface)
- `EmbeddingConfig` (interface)
- `SemanticIndexOptions` (interface)
- `BatchResult` (interface)
- `OperationResult` (interface)
- `BatchOptions` (interface)
- `GraphEventBase` (interface)
- `RelationCreatedEvent` (interface)
- `RelationDeletedEvent` (interface)
- `ObservationDeletedEvent` (interface)
- `GraphLoadedEvent` (interface)
- `GraphEventMap` (interface)
- `QueryCostEstimate` (interface)
- `AutoSearchResult` (interface)
- `QueryCostEstimatorOptions` (interface)
- `PreparedEntity` (interface)
- `SymbolicFilters` (interface)
- `HybridSearchOptions` (interface)
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

### `src/utils/AsyncMutex.ts`

- `AsyncMutexOptions` (interface)

### `src/utils/BatchProcessor.ts`

- `BatchProgress` (interface)
- `BatchItemResult` (interface)
- `BatchProcessResult` (interface)
- `BatchProcessorOptions` (interface)
- `BatchProgressCallback` (type)

### `src/utils/CachePressureCoordinator.ts`

- `PressureAwareCache` (interface)
- `CachePressureSnapshot` (interface)

### `src/utils/compressedCache.ts`

- `CompressedCacheOptions` (interface)
- `CompressedCacheStats` (interface)

### `src/utils/compression/CompressedMap.ts`

- `CompressedMapOptions` (interface)

### `src/utils/compression/ICompressionAdapter.ts`

- `IdentityCompressionAdapter` (class)

### `src/utils/compressionUtil.ts`

- `CompressionOptions` (interface)
- `CompressionResult` (interface)
- `CompressionMetadata` (interface)

### `src/utils/constants.ts`

- `CompressionQuality` (type)
- `EMBEDDING_ENV_VARS` (constant)

### `src/utils/Diagnostics.ts`

- `EntityCounts` (interface)
- `TieredIndexStatsSnapshot` (interface)

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

### `src/utils/IndexHealthMonitor.ts`

- `IndexHealthSources` (interface)

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

