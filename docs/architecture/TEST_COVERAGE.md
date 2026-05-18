# Test Coverage Analysis

**Generated**: 2026-05-17

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 244 |
| Total Test Files | 281 |
| Source Files with Tests | 219 |
| Source Files without Tests | 25 |
| Coverage | 89.8% |

---

## Source Files Without Test Coverage

The following 25 source files are not directly imported by any test file:

### agent/

- `src/agent/rbac/RbacTypes.ts` → Expected test: `tests/unit/agent/RbacTypes.test.ts`

### cli/

- `src/cli/commands/decision.ts` → Expected test: `tests/unit/cli/decision.test.ts`
- `src/cli/commands/entity.ts` → Expected test: `tests/unit/cli/entity.test.ts`
- `src/cli/commands/exclusion.ts` → Expected test: `tests/unit/cli/exclusion.test.ts`
- `src/cli/commands/graph.ts` → Expected test: `tests/unit/cli/graph.test.ts`
- `src/cli/commands/helpers.ts` → Expected test: `tests/unit/cli/helpers.test.ts`
- `src/cli/commands/heuristic.ts` → Expected test: `tests/unit/cli/heuristic.test.ts`
- `src/cli/commands/hierarchy.ts` → Expected test: `tests/unit/cli/hierarchy.test.ts`
- `src/cli/commands/io.ts` → Expected test: `tests/unit/cli/io.test.ts`
- `src/cli/commands/maintenance.ts` → Expected test: `tests/unit/cli/maintenance.test.ts`
- `src/cli/commands/observation.ts` → Expected test: `tests/unit/cli/observation.test.ts`
- `src/cli/commands/observationDedup.ts` → Expected test: `tests/unit/cli/observationDedup.test.ts`
- `src/cli/commands/projectContext.ts` → Expected test: `tests/unit/cli/projectContext.test.ts`
- `src/cli/commands/relation.ts` → Expected test: `tests/unit/cli/relation.test.ts`
- `src/cli/commands/search.ts` → Expected test: `tests/unit/cli/search.test.ts`
- `src/cli/commands/spell.ts` → Expected test: `tests/unit/cli/spell.test.ts`
- `src/cli/commands/tag.ts` → Expected test: `tests/unit/cli/tag.test.ts`
- `src/cli/commands/toolAffordance.ts` → Expected test: `tests/unit/cli/toolAffordance.test.ts`
- `src/cli/index.ts` → Expected test: `tests/unit/cli/index.test.ts`
- `src/cli/interactive.ts` → Expected test: `tests/unit/cli/interactive.test.ts`

### search/

- `src/search/QueryPlanFormatter.ts` → Expected test: `tests/unit/search/QueryPlanFormatter.test.ts`

### utils/

- `src/utils/Diagnostics.ts` → Expected test: `tests/unit/utils/Diagnostics.test.ts`
- `src/utils/IIndexHealth.ts` → Expected test: `tests/unit/utils/IIndexHealth.test.ts`
- `src/utils/IndexHealthMonitor.ts` → Expected test: `tests/unit/utils/IndexHealthMonitor.test.ts`

### workers/

- `src/workers/index.ts` → Expected test: `tests/unit/workers/index.test.ts`

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `adapters/LangChainMemoryAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LangChainMemoryAdapter.test.ts` |
| `adapters/MCPToolObserverAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts` |
| `adapters/RateLimiter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RateLimiter.test.ts` |
| `adapters/RestRouter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RestRouter.test.ts` |
| `adapters/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts` |
| `adapters/pagination.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `pagination.test.ts` |
| `agent/AccessTracker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AccessTracker.test.ts`, `AgentMemoryManager.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.test.ts`, `InMemoryBackend.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `ManagerContext.test.ts` |
| `agent/AgentMemoryConfig.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts` |
| `agent/AgentMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ManagerContext.test.ts` |
| `agent/ArtifactManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ArtifactManager.test.ts` |
| `agent/CognitiveLoadAnalyzer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CognitiveLoadAnalyzer.test.ts` |
| `agent/CollaborativeSynthesis.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CollaborativeSynthesis.test.ts` |
| `agent/ConflictResolver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConflictResolver.test.ts` |
| `agent/ConsolidationPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationPipeline.test.ts`, `ConsolidationScheduler.test.ts`, `DreamEngine.test.ts`, `HeuristicExtractionStage.test.ts`, `ObservationDedupReportStage.test.ts`, `ReflectionStage.test.ts` |
| `agent/ConsolidationScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationScheduler.test.ts` |
| `agent/ContextProfileManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ContextProfileManager.test.ts` |
| `agent/ContextWindowManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `TrajectoryCompressor.test.ts`, `ManagerContext.test.ts` |
| `agent/DecayEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationPipeline.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.test.ts`, `DecayScheduler.test.ts`, `InMemoryBackend.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `ManagerContext.test.ts` |
| `agent/DecayScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DecayScheduler.test.ts` |
| `agent/DecisionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DecisionManager.test.ts` |
| `agent/DistillationPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts` |
| `agent/DistillationPolicy.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts` |
| `agent/DreamEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DreamEngine.test.ts` |
| `agent/EntropyFilter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EntropyFilter.test.ts` |
| `agent/EpisodicMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EpisodicMemoryManager.test.ts` |
| `agent/ExclusionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExclusionManager.test.ts` |
| `agent/ExperienceExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `delta-services-wiring.test.ts`, `ExperienceExtractor.test.ts`, `ReflectionStage.test.ts` |
| `agent/FailureDistillation.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `FailureDistillation.test.ts` |
| `agent/FailureManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `FailureManager.test.ts` |
| `agent/HeuristicManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts` |
| `agent/ImportanceScorer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ImportanceScorer.test.ts`, `MemoryEngine.test.ts` |
| `agent/InMemoryBackend.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `InMemoryBackend.test.ts`, `memoryBackend-wiring.test.ts` |
| `agent/MemoryBackend.ts` | `IMemoryBackend.contract.test.ts` |
| `agent/MemoryEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryEngine.test.ts` |
| `agent/MemoryFormatter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryFormatter.test.ts`, `MemoryFormatterSalience.test.ts`, `ManagerContext.test.ts` |
| `agent/MemoryValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `delta-services-wiring.test.ts`, `MemoryValidator.test.ts` |
| `agent/MultiAgentMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MultiAgentMemoryManager.test.ts` |
| `agent/ObservationDedupManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ObservationDedupManager.test.ts`, `ObservationDedupReportStage.test.ts` |
| `agent/ObserverPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ObserverPipeline.test.ts` |
| `agent/PatternDetector.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExperienceExtractor.test.ts`, `PatternDetector.test.ts`, `ReflectionStage.test.ts` |
| `agent/PlanManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `PlanManager.test.ts` |
| `agent/ProfileManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts` |
| `agent/ProjectContextManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProjectContextManager.test.ts` |
| `agent/ProspectiveMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProspectiveMemoryManager.test.ts` |
| `agent/ReflectionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ReflectionManager.test.ts`, `ReflectionStage.test.ts` |
| `agent/RoleProfiles.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RoleProfiles.test.ts` |
| `agent/RuleEvaluator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RuleEvaluator.test.ts` |
| `agent/SQLiteBackend.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `memoryBackend-wiring.test.ts`, `SQLiteBackend.test.ts` |
| `agent/SalienceEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CollaborativeSynthesis.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `profile-manager-extraction.test.ts`, `SalienceEngine.test.ts`, `ManagerContext.test.ts` |
| `agent/SessionCheckpoint.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SessionCheckpoint.test.ts` |
| `agent/SessionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `profile-manager-extraction.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts` |
| `agent/SessionQueryBuilder.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SessionQueryBuilder.test.ts` |
| `agent/SummarizationService.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SummarizationService.test.ts` |
| `agent/ToolAffordanceManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts` |
| `agent/ToolCallObserver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolCallObserver.test.ts` |
| `agent/TrajectoryCompressor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `delta-services-wiring.test.ts`, `ReflectionStage.test.ts`, `TrajectoryCompressor.test.ts` |
| `agent/VisibilityResolver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `VisibilityResolver.test.ts` |
| `agent/WorkThreadManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorkThreadManager.test.ts` |
| `agent/WorkingMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationPipeline.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts`, `WorkingMemoryManager.test.ts` |
| `causal/CausalReasoner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CausalReasoner.test.ts`, `manager-context-new-managers.test.ts` |
| `causal/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts` |
| `collaboration/CollaborationAuditEnforcer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CollaborationAuditEnforcer.test.ts` |
| `agent/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts` |
| `procedural/ProcedureManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `manager-context-new-managers.test.ts` |
| `procedural/ProcedureStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts` |
| `procedural/StepSequencer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts` |
| `procedural/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts` |
| `rbac/PermissionMatrix.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts` |
| `rbac/RbacMiddleware.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `manager-context-new-managers.test.ts` |
| `rbac/RoleAssignmentStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `manager-context-new-managers.test.ts` |
| `rbac/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts` |
| `retrieval/ActiveRetrievalController.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts` |
| `retrieval/QueryRewriter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts` |
| `retrieval/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts` |
| `world/WorldModelManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts` |
| `world/WorldStateSnapshot.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts` |
| `world/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts` |
| `commands/cache.ts` | `cache-reindex.test.ts` |
| `commands/check.ts` | `check.test.ts` |
| `commands/diag.ts` | `diag.test.ts` |
| `commands/index.ts` | `commands.test.ts` |
| `commands/inspect.ts` | `inspect.test.ts` |
| `commands/reindex.ts` | `cache-reindex.test.ts` |
| `commands/smoke.ts` | `smoke.test.ts` |
| `cli/config.ts` | `config.test.ts` |
| `cli/formatters.ts` | `formatters.test.ts` |
| `cli/options.ts` | `options.test.ts` |
| `core/EntityManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `optimization-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `MCPToolObserverAdapter.test.ts`, `ArtifactManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `DecisionManager.test.ts`, `ExclusionManager.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `ObserverPipeline.test.ts`, `ProcedureManager.test.ts`, `ProjectContextManager.test.ts`, `ReflectionManager.test.ts`, `ReflectionStage.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `WorldModel.test.ts`, `ConcurrencyControl.test.ts`, `EntityManager.test.ts`, `ManagerContext.test.ts`, `optimistic-concurrency.test.ts`, `RefIndex.test.ts`, `RelationManager.test.ts`, `temporal-versioning.test.ts`, `AutoLinker.test.ts`, `CompressionManager.test.ts`, `FactExtractor.test.ts`, `BasicSearch.test.ts`, `BM25Search.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `NGramFuzzyIntegration.test.ts`, `RankedSearch.test.ts` |
| `core/EntityStateMachine.ts` | `EntityStateMachine.test.ts` |
| `core/GraphEventEmitter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ObserverPipeline.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `ManagerContext.test.ts`, `TransitionLedger.test.ts`, `TFIDFEventSync.test.ts` |
| `core/GraphStorage.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `compression-optimization.test.ts`, `hybrid-search.test.ts`, `operation-progress.test.ts`, `smart-search.test.ts`, `graph-storage-new-fields.test.ts`, `streaming-export.test.ts`, `worker-pool-integration.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `optimization-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `AgentMemoryManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `ProcedureManager.test.ts`, `WorldModel.test.ts`, `BatchTransaction.test.ts`, `ObservationColumnStore-wiring.test.ts`, `ConcurrencyControl.test.ts`, `EntityManager.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `GraphStorage.test.ts`, `GraphTraversal.test.ts`, `HierarchyManager.test.ts`, `known-issue-fixes.test.ts`, `ManagerContext.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `mmap-review-fixes.test.ts`, `ObservationManager.dedup.test.ts`, `ObservationManager.test.ts`, `optimistic-concurrency.test.ts`, `RefIndex.test.ts`, `RelationManager.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `StorageFactory.test.ts`, `temporal-versioning.test.ts`, `TransactionBatching.test.ts`, `TransactionManager.test.ts`, `AnalyticsManager.test.ts`, `ArchiveManager.test.ts`, `AutoLinker.test.ts`, `BackupManager.test.ts`, `CompressionManager.test.ts`, `FreshnessManager.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservableDataModelAdapter.test.ts`, `BasicSearch.test.ts`, `BloomFilter.test.ts`, `BM25Search.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `IncrementalTFIDF.test.ts`, `MaterializedViews.test.ts`, `NGramFuzzyIntegration.test.ts`, `RankedSearch.test.ts`, `SavedSearchManager.test.ts`, `SearchManager.test.ts`, `SearchSuggestions.test.ts`, `TFIDFEventSync.test.ts` |
| `core/GraphTraversal.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `CausalReasoner.test.ts`, `CollaborativeSynthesis.test.ts`, `GraphTraversal.test.ts`, `ManagerContext.test.ts` |
| `core/HierarchyManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `EntityManager.test.ts`, `HierarchyManager.test.ts`, `ManagerContext.test.ts` |
| `core/ManagerContext.ts` | `edge-cases.test.ts`, `file-path.test.ts`, `access-tracking.test.ts`, `agent-memory-manager-profile.test.ts`, `manager-context-semantic-forget.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `MemoryEngineStorage.test.ts`, `project-scope-isolation.test.ts`, `knowledge-graph.test.ts`, `memory-engine-perf.test.ts`, `LangChainMemoryAdapter.test.ts`, `RestRouter.test.ts`, `agent-memory-manager-diary.test.ts`, `ArtifactManager.test.ts`, `context-window-manager-compress.test.ts`, `context-window-manager-wakeup.test.ts`, `delta-services-wiring.test.ts`, `memoryBackend-wiring.test.ts`, `MemoryEngine.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts`, `SQLiteBackend.test.ts`, `cache-reindex.test.ts`, `check.test.ts`, `diag.test.ts`, `inspect.test.ts`, `columns-review-fixes.test.ts`, `ObservationColumnStore-wiring.test.ts`, `entity-manager-list-projects.test.ts`, `entity-manager-profile-namespace.test.ts`, `entity-manager-project-stamping.test.ts`, `entity-manager-version-chain.test.ts`, `known-issue-fixes.test.ts`, `manager-context-new-managers.test.ts`, `manager-context-project.test.ts`, `ManagerContext.test.ts`, `observation-validate-hook.test.ts`, `relation-manager-temporal.test.ts`, `compression-manager-priority-dedup.test.ts`, `compression-manager-versioning-guard.test.ts`, `io-manager-ingest.test.ts`, `io-manager-split.test.ts`, `io-manager-visualize.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts`, `TieredIndex-wiring.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts` |
| `core/ObservationManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `write-performance.test.ts`, `ObservationColumnStore-wiring.test.ts`, `ConcurrencyControl.test.ts`, `ManagerContext.test.ts`, `ObservationManager.dedup.test.ts`, `ObservationManager.test.ts`, `temporal-versioning.test.ts` |
| `core/ObservationStore.ts` | `ObservationStore.test.ts` |
| `core/RefIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ArtifactManager.test.ts`, `ManagerContext.test.ts`, `RefIndex.test.ts` |
| `core/RelationManager.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `ManagerContext.test.ts`, `RelationManager.test.ts`, `AutoLinker.test.ts`, `CompressionManager.test.ts`, `FactExtractor.test.ts`, `BasicSearch.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `NGramFuzzyIntegration.test.ts` |
| `core/SQLiteStorage.ts` | `file-path.test.ts`, `sqlite-storage-new-fields.test.ts`, `knowledge-graph.test.ts`, `ConcurrencyControl.test.ts`, `ManagerContext.test.ts`, `sqlite-content-hash-migration.test.ts`, `SQLiteStorage.test.ts`, `StorageFactory.test.ts` |
| `core/StorageFactory.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `StorageFactory.test.ts` |
| `core/TransactionManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `BatchTransaction.test.ts`, `ManagerContext.test.ts`, `TransactionBatching.test.ts`, `TransactionManager.test.ts` |
| `core/TransitionLedger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `TransitionLedger.test.ts` |
| `columns/IColumnStore.ts` | `columns-review-fixes.test.ts`, `IColumnStore.test.ts`, `JsonlColumnStore.test.ts`, `ObservationColumnStore-wiring.test.ts` |
| `columns/JsonlColumnStore.ts` | `columns-review-fixes.test.ts`, `JsonlColumnStore.test.ts` |
| `core/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts` |
| `mmap/FsReadMmapBackend.ts` | `FsReadMmapBackend.test.ts`, `mmap-review-fixes.test.ts` |
| `mmap/IMmapBackend.ts` | `FsReadMmapBackend.test.ts`, `IMmapBackend.test.ts`, `mmap-review-fixes.test.ts` |
| `segments/FileSegmentStorage.ts` | `FileSegmentStorage.test.ts`, `segments-review-fixes.test.ts` |
| `segments/ISegmentStorage.ts` | `FileSegmentStorage.test.ts`, `ISegmentStorage.test.ts`, `segments-review-fixes.test.ts`, `segment-jsonl.test.ts` |
| `features/AnalyticsManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `AnalyticsManager.test.ts` |
| `features/ArchiveManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `ManagerContext.test.ts`, `ArchiveManager.test.ts` |
| `features/AuditLog.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `CollaborationAuditEnforcer.test.ts`, `AuditLog.test.ts`, `GovernanceManager.test.ts` |
| `features/AutoLinker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AutoLinker.test.ts` |
| `features/BackupManager.ts` | `BackupManager.test.ts` |
| `features/CompressionManager.ts` | `file-path.test.ts`, `compression-optimization.test.ts`, `operation-progress.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `optimization-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `ConsolidationScheduler.test.ts`, `ManagerContext.test.ts`, `CompressionManager.test.ts` |
| `features/ContradictionDetector.ts` | `file-path.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `knowledge-graph.test.ts`, `MemoryValidator.test.ts`, `contradiction-detector-detect.test.ts` |
| `features/FactExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `FactExtractor.test.ts` |
| `features/FreshnessManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `FreshnessManager.test.ts` |
| `features/GovernanceManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `GovernanceManager.test.ts` |
| `features/IOManager.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `operation-progress.test.ts`, `streaming-export.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-benchmarks.test.ts`, `ManagerContext.test.ts`, `BackupManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts` |
| `features/KeywordExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ObservationNormalizer.test.ts` |
| `features/ObservableDataModelAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ObservableDataModelAdapter.test.ts` |
| `features/ObservationNormalizer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ObservationNormalizer.test.ts` |
| `features/SemanticForget.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts` |
| `features/StreamingExporter.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-benchmarks.test.ts`, `StreamingExporter.test.ts` |
| `features/TagManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `TagManager.test.ts` |
| `features/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts` |
| `src/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts` |
| `search/BM25Search.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `BM25Search.test.ts`, `SemanticSearch.test.ts` |
| `search/BasicSearch.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `BasicSearch.test.ts`, `SavedSearchManager.test.ts`, `SemanticSearch.test.ts` |
| `search/BloomFilter.ts` | `BloomFilter.test.ts` |
| `search/BloomPreScreener.ts` | `BloomFilter.test.ts` |
| `search/BooleanSearch.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `BooleanSearch.test.ts`, `SemanticSearch.test.ts` |
| `search/EarlyTerminationManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `EarlyTerminationManager.test.ts`, `SemanticSearch.test.ts` |
| `search/EmbeddingCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `EmbeddingCache.test.ts`, `SemanticSearch.test.ts` |
| `search/EmbeddingService.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `EmbeddingService.test.ts`, `SemanticSearch.test.ts` |
| `search/FuzzySearch.ts` | `file-path.test.ts`, `worker-pool-integration.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `FuzzySearch.test.ts`, `NGramFuzzyIntegration.test.ts`, `SemanticSearch.test.ts` |
| `search/HybridScorer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `HybridScorer.test.ts`, `SemanticSearch.test.ts` |
| `search/HybridSearchManager.ts` | `file-path.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `HybridSearchManager.test.ts`, `SemanticSearch.test.ts` |
| `search/IncrementalIndexer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `IncrementalIndexer.test.ts`, `SemanticSearch.test.ts` |
| `search/LLMQueryPlanner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LLMQueryPlanner.test.ts`, `SemanticSearch.test.ts` |
| `search/LLMSearchExecutor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LLMQueryPlanner.test.ts`, `SemanticSearch.test.ts` |
| `search/MaterializedViews.ts` | `MaterializedViews.test.ts` |
| `search/NGramIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `NGramFuzzyIntegration.test.ts`, `NGramIndex.test.ts`, `SemanticSearch.test.ts` |
| `search/OptimizedInvertedIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `OptimizedInvertedIndex.test.ts`, `SemanticSearch.test.ts` |
| `search/ParallelSearchExecutor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `ParallelSearchExecutor.test.ts`, `SemanticSearch.test.ts` |
| `search/PartialIndexAdvisor.ts` | `PartialIndexAdvisor.test.ts` |
| `search/ProximitySearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ProximitySearch.test.ts`, `SemanticSearch.test.ts` |
| `search/QuantizedVectorStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `QuantizedVectorStore.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryAnalyzer.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `QueryAnalyzer.test.ts`, `QueryCostEstimator.test.ts`, `ReflectionManager.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryCostEstimator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `EarlyTerminationManager.test.ts`, `QueryCostEstimator.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryLogger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `QueryLogger.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryParser.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `QueryParser.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryPlanCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `QueryPlanCache.test.ts`, `SemanticSearch.test.ts` |
| `search/QueryPlanner.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `QueryAnalyzer.test.ts`, `SemanticSearch.test.ts` |
| `search/RankedSearch.ts` | `file-path.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `ActiveRetrieval.test.ts`, `RankedSearch.test.ts`, `SemanticSearch.test.ts` |
| `search/ReflectionManager.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `ReflectionManager.test.ts`, `SemanticSearch.test.ts` |
| `search/SavedSearchManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SavedSearchManager.test.ts`, `SemanticSearch.test.ts` |
| `search/SearchFilterChain.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-filter-chain-project.test.ts`, `search-filter-chain-versioning.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts` |
| `search/SearchManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `ManagerContext.test.ts`, `SearchManager.test.ts`, `SemanticSearch.test.ts` |
| `search/SearchSuggestions.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SearchSuggestions.test.ts`, `SemanticSearch.test.ts` |
| `search/SemanticSearch.ts` | `file-path.test.ts`, `contradiction-detector-supersede.test.ts`, `knowledge-graph.test.ts`, `MemoryEngine.test.ts`, `MemoryValidator.test.ts`, `contradiction-detector-detect.test.ts`, `semantic-forget-semantic.test.ts`, `SemanticSearch.test.ts` |
| `search/SpellChecker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SemanticSearch.test.ts`, `SpellChecker.test.ts` |
| `search/SymbolicSearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `HybridSearchManager.test.ts`, `SemanticSearch.test.ts` |
| `search/TFIDFEventSync.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `IncrementalTFIDF.test.ts`, `SemanticSearch.test.ts`, `TFIDFEventSync.test.ts` |
| `search/TFIDFIndexManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `IncrementalTFIDF.test.ts`, `SemanticSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts` |
| `search/TemporalQueryParser.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.test.ts`, `TemporalSearch.test.ts` |
| `search/TemporalSearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts` |
| `search/VectorStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `SemanticSearch.test.ts`, `VectorStore.test.ts` |
| `search/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `SemanticSearch.test.ts` |
| `tiered/BrotliColdTier.ts` | `BrotliColdTier.test.ts` |
| `tiered/DiskWarmTier.ts` | `DiskWarmTier.test.ts`, `tiered-review-fixes.test.ts` |
| `tiered/ITieredIndex.ts` | `ITieredIndex.test.ts`, `tiered-review-fixes.test.ts`, `TieredIndex.test.ts` |
| `tiered/LRUHotTier.ts` | `LRUHotTier.test.ts`, `tiered-review-fixes.test.ts`, `TieredIndex.test.ts` |
| `tiered/TieredIndex.ts` | `tiered-review-fixes.test.ts`, `TieredIndex.test.ts` |
| `security/ABACPolicy.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ABACPolicy.test.ts`, `PiiRedactor.test.ts` |
| `security/APIKeyStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `APIKeyStore.test.ts`, `PiiRedactor.test.ts` |
| `security/PiiRedactor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `PiiRedactor.test.ts` |
| `security/RowLevelFilter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `PiiRedactor.test.ts`, `RowLevelFilter.test.ts` |
| `security/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `PiiRedactor.test.ts` |
| `types/agent-memory.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `AccessTracker.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `CognitiveLoadAnalyzer.test.ts`, `CollaborativeSynthesis.test.ts`, `ConflictResolver.test.ts`, `ConsolidationPipeline.test.ts`, `ConsolidationScheduler.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.test.ts`, `DecayScheduler.test.ts`, `DecisionManager.test.ts`, `EntropyFilter.test.ts`, `EpisodicMemoryManager.test.ts`, `FailureDistillation.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `MemoryFormatter.test.ts`, `MemoryFormatterSalience.test.ts`, `MemoryValidator.test.ts`, `MultiAgentMemoryManager.test.ts`, `ObservationDedupReportStage.test.ts`, `PlanManager.test.ts`, `ProspectiveMemoryManager.test.ts`, `ReflectionManager.test.ts`, `ReflectionStage.test.ts`, `RoleProfiles.test.ts`, `RuleEvaluator.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts`, `VisibilityResolver.test.ts`, `WorkingMemoryManager.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `profile-entity.test.ts`, `trust-level.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/artifact.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `ArtifactManager.test.ts`, `CausalReasoner.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/index.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/procedure.ts` | `ProcedureManager.test.ts` |
| `types/progress.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `progress.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/result.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `result.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/search.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `ProximitySearch.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `agent-memory.test.ts`, `search.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `indexes.test.ts` |
| `types/types.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `operation-progress.test.ts`, `smart-search.test.ts`, `graph-storage-new-fields.test.ts`, `sqlite-storage-new-fields.test.ts`, `streaming-export.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-performance.test.ts`, `MCPToolObserverAdapter.test.ts`, `AccessTracker.test.ts`, `ActiveRetrieval.test.ts`, `ArtifactManager.test.ts`, `CausalReasoner.test.ts`, `CollaborativeSynthesis.test.ts`, `ConsolidationPipeline.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.test.ts`, `DecisionManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts`, `DreamEngine.test.ts`, `EpisodicMemoryManager.test.ts`, `ExclusionManager.test.ts`, `FailureDistillation.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `InMemoryBackend.test.ts`, `MemoryEngine.test.ts`, `MemoryValidator.test.ts`, `MultiAgentMemoryManager.test.ts`, `ObservationDedupManager.test.ts`, `ObservationDedupReportStage.test.ts`, `PlanManager.test.ts`, `ProjectContextManager.test.ts`, `ProspectiveMemoryManager.test.ts`, `ReflectionManager.test.ts`, `ReflectionStage.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `TrajectoryCompressor.test.ts`, `WorkingMemoryManager.test.ts`, `WorkThreadManager.test.ts`, `formatters.test.ts`, `BatchTransaction.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `ObservationManager.dedup.test.ts`, `FileSegmentStorage.test.ts`, `GraphStorage-segments.test.ts`, `ISegmentStorage.test.ts`, `segments-review-fixes.test.ts`, `AutoLinker.test.ts`, `contradiction-detector-detect.test.ts`, `FreshnessManager.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservableDataModelAdapter.test.ts`, `ObservationNormalizer.test.ts`, `StreamingExporter.test.ts`, `EarlyTerminationManager.test.ts`, `HybridScorer.test.ts`, `HybridSearchManager.test.ts`, `IncrementalIndexer.test.ts`, `IncrementalTFIDF.test.ts`, `LLMQueryPlanner.test.ts`, `ParallelSearchExecutor.test.ts`, `ProximitySearch.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `ReflectionManager.test.ts`, `search-filter-chain-project.test.ts`, `search-filter-chain-versioning.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `SpellChecker.test.ts`, `TemporalSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `RowLevelFilter.test.ts`, `observations-to-columns.test.ts`, `segment-jsonl.test.ts`, `agent-memory.test.ts`, `entity-new-fields.test.ts`, `profile-entity.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `compression-review-fixes.test.ts`, `entityUtils.test.ts`, `EntityValidator.test.ts`, `indexes.test.ts`, `relationHelpers.test.ts`, `relationValidation.test.ts`, `SchemaValidator.test.ts`, `validators.test.ts` |
| `utils/AsyncMutex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/BatchProcessor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `BatchProcessor.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/CachePressureCoordinator.ts` | `CachePressureCoordinator.test.ts` |
| `utils/EntityValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `EntityValidator.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/MemoryMonitor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `MemoryMonitor.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/SchemaValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `SchemaValidator.test.ts`, `searchAlgorithms.test.ts` |
| `utils/WorkerPoolManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `WorkerPoolManager.test.ts` |
| `utils/compressedCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `compressedCache.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `compression/CompressedMap.ts` | `CompressedMap.test.ts`, `compression-review-fixes.test.ts` |
| `compression/ICompressionAdapter.ts` | `CompressedMap.test.ts`, `compression-review-fixes.test.ts`, `ICompressionAdapter.test.ts` |
| `utils/compressionUtil.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `IOManager.test.ts`, `BrotliColdTier.test.ts`, `compressionUtil.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/constants.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `IOManager.test.ts`, `EmbeddingService.test.ts`, `compressionUtil.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/durableWriteFile.ts` | `durableWriteFile.test.ts` |
| `utils/entityUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `foundation-benchmarks.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/errorSuggestions.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `errorSuggestions.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/errors.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentMemoryManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `DecisionManager.test.ts`, `EntropyFilter.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `ProjectContextManager.test.ts`, `ReflectionManager.test.ts`, `ReflectionStage.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `entity-manager-profile-namespace.test.ts`, `EntityManager.test.ts`, `HierarchyManager.test.ts`, `ObservationManager.test.ts`, `optimistic-concurrency.test.ts`, `RefIndex.test.ts`, `RelationManager.test.ts`, `temporal-versioning.test.ts`, `TransactionManager.test.ts`, `CompressionManager.test.ts`, `entityUtils.test.ts`, `errors.test.ts`, `errorSuggestions.test.ts`, `formatters.test.ts`, `operationUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/formatters.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/indexes.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `indexes.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/logger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `logger.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/operationUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `operationUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/parallelUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `parallelUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/relationHelpers.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `relationHelpers.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/relationValidation.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `relationValidation.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/schemas.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entity-content-hash.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/searchAlgorithms.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/searchCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `searchCache.test.ts` |
| `utils/taskScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `taskScheduler.test.ts` |
| `utils/textSimilarity.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts` |
| `utils/validators.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `entityUtils.test.ts`, `EntityValidator.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `validators.test.ts` |
| `workers/levenshteinWorker.ts` | `levenshteinWorker.test.ts` |

---

## Test File Details

| Test File | Imports from Source |
|-----------|---------------------|
| `edge-cases/edge-cases.test.ts` | 1 files |
| `tests/file-path.test.ts` | 184 files |
| `agent/access-tracking.test.ts` | 1 files |
| `agent/agent-memory-manager-profile.test.ts` | 1 files |
| `integration/backup-compression.test.ts` | 9 files |
| `integration/compression-optimization.test.ts` | 2 files |
| `core/manager-context-semantic-forget.test.ts` | 1 files |
| `core/observation-manager-contradiction.test.ts` | 2 files |
| `features/contradiction-detector-supersede.test.ts` | 3 files |
| `integration/hybrid-search.test.ts` | 10 files |
| `integration/MemoryEngineStorage.test.ts` | 1 files |
| `integration/operation-progress.test.ts` | 9 files |
| `search/project-scope-isolation.test.ts` | 1 files |
| `integration/smart-search.test.ts` | 13 files |
| `storage/graph-storage-new-fields.test.ts` | 2 files |
| `storage/sqlite-storage-new-fields.test.ts` | 2 files |
| `integration/streaming-export.test.ts` | 3 files |
| `integration/worker-pool-integration.test.ts` | 9 files |
| `integration/workflows.test.ts` | 8 files |
| `tests/knowledge-graph.test.ts` | 184 files |
| `performance/benchmarks.test.ts` | 8 files |
| `performance/compression-benchmarks.test.ts` | 12 files |
| `performance/embedding-benchmarks.test.ts` | 4 files |
| `performance/foundation-benchmarks.test.ts` | 12 files |
| `performance/memory-engine-perf.test.ts` | 1 files |
| `performance/mmap-load-benchmark.test.ts` | 8 files |
| `performance/optimization-benchmarks.test.ts` | 3 files |
| `performance/parallel-benchmarks.test.ts` | 10 files |
| `performance/query-execution-benchmarks.test.ts` | 12 files |
| `performance/search-algorithm-benchmarks.test.ts` | 12 files |
| `performance/task-scheduler-benchmarks.test.ts` | 6 files |
| `performance/task-scheduler-config-benchmarks.test.ts` | 5 files |
| `performance/v10-benchmarks.test.ts` | 25 files |
| `performance/write-performance.test.ts` | 10 files |
| `adapters/LangChainMemoryAdapter.test.ts` | 2 files |
| `adapters/MCPToolObserverAdapter.test.ts` | 6 files |
| `adapters/pagination.test.ts` | 1 files |
| `adapters/RateLimiter.test.ts` | 1 files |
| `adapters/RestRouter.test.ts` | 2 files |
| `agent/AccessTracker.test.ts` | 3 files |
| `agent/ActiveRetrieval.test.ts` | 11 files |
| `agent/agent-memory-manager-diary.test.ts` | 1 files |
| `agent/AgentMemoryManager.test.ts` | 72 files |
| `agent/ArtifactManager.test.ts` | 6 files |
| `agent/CausalReasoner.test.ts` | 9 files |
| `agent/CognitiveLoadAnalyzer.test.ts` | 2 files |
| `agent/CollaborationAuditEnforcer.test.ts` | 5 files |
| `agent/CollaborativeSynthesis.test.ts` | 5 files |
| `agent/ConflictResolver.test.ts` | 2 files |
| `agent/ConsolidationPipeline.test.ts` | 5 files |
| `agent/ConsolidationScheduler.test.ts` | 4 files |
| `agent/context-window-manager-compress.test.ts` | 1 files |
| `agent/context-window-manager-wakeup.test.ts` | 1 files |
| `agent/ContextProfileManager.test.ts` | 7 files |
| `agent/ContextWindowManager.test.ts` | 6 files |
| `agent/DecayEngine.test.ts` | 4 files |
| `agent/DecayScheduler.test.ts` | 3 files |
| `agent/DecisionManager.test.ts` | 5 files |
| `agent/delta-services-wiring.test.ts` | 4 files |
| `agent/DistillationPipeline.test.ts` | 3 files |
| `agent/DistillationPolicy.test.ts` | 3 files |
| `agent/DreamEngine.test.ts` | 3 files |
| `agent/EntropyFilter.test.ts` | 3 files |
| `agent/EpisodicMemoryManager.test.ts` | 3 files |
| `agent/ExclusionManager.test.ts` | 3 files |
| `agent/ExperienceExtractor.test.ts` | 2 files |
| `agent/FailureDistillation.test.ts` | 3 files |
| `agent/FailureManager.test.ts` | 5 files |
| `agent/HeuristicExtractionStage.test.ts` | 6 files |
| `agent/HeuristicManager.test.ts` | 4 files |
| `agent/IMemoryBackend.contract.test.ts` | 1 files |
| `agent/ImportanceScorer.test.ts` | 1 files |
| `agent/InMemoryBackend.test.ts` | 4 files |
| `agent/memoryBackend-wiring.test.ts` | 3 files |
| `agent/MemoryEngine.test.ts` | 5 files |
| `agent/MemoryFormatter.test.ts` | 2 files |
| `agent/MemoryFormatterSalience.test.ts` | 2 files |
| `agent/MemoryValidator.test.ts` | 5 files |
| `agent/MultiAgentMemoryManager.test.ts` | 3 files |
| `agent/ObservationDedupManager.test.ts` | 2 files |
| `agent/ObservationDedupReportStage.test.ts` | 4 files |
| `agent/ObserverPipeline.test.ts` | 3 files |
| `agent/PatternDetector.test.ts` | 1 files |
| `agent/PlanManager.test.ts` | 3 files |
| `agent/ProcedureManager.test.ts` | 7 files |
| `agent/profile-manager-basics.test.ts` | 2 files |
| `agent/profile-manager-extraction.test.ts` | 4 files |
| `agent/ProjectContextManager.test.ts` | 4 files |
| `agent/ProspectiveMemoryManager.test.ts` | 3 files |
| `agent/rbac.test.ts` | 4 files |
| `agent/ReflectionManager.test.ts` | 5 files |
| `agent/ReflectionStage.test.ts` | 9 files |
| `agent/RoleProfiles.test.ts` | 2 files |
| `agent/RuleEvaluator.test.ts` | 2 files |
| `agent/SalienceEngine.test.ts` | 5 files |
| `agent/SessionCheckpoint.test.ts` | 6 files |
| `agent/SessionManager.test.ts` | 4 files |
| `agent/SessionQueryBuilder.test.ts` | 5 files |
| `agent/SQLiteBackend.test.ts` | 2 files |
| `agent/SummarizationService.test.ts` | 1 files |
| `agent/ToolAffordanceManager.test.ts` | 4 files |
| `agent/ToolCallObserver.test.ts` | 5 files |
| `agent/TrajectoryCompressor.test.ts` | 3 files |
| `agent/VisibilityResolver.test.ts` | 2 files |
| `agent/WorkingMemoryManager.test.ts` | 3 files |
| `agent/WorkThreadManager.test.ts` | 2 files |
| `agent/WorldModel.test.ts` | 5 files |
| `cli/cache-reindex.test.ts` | 3 files |
| `cli/check.test.ts` | 2 files |
| `cli/commands.test.ts` | 1 files |
| `cli/config.test.ts` | 1 files |
| `cli/diag.test.ts` | 2 files |
| `cli/formatters.test.ts` | 2 files |
| `cli/index.test.ts` | 0 files |
| `cli/inspect.test.ts` | 2 files |
| `cli/interactive.test.ts` | 0 files |
| `cli/options.test.ts` | 1 files |
| `cli/smoke.test.ts` | 1 files |
| `core/BatchTransaction.test.ts` | 3 files |
| `columns/columns-review-fixes.test.ts` | 3 files |
| `columns/IColumnStore.test.ts` | 1 files |
| `columns/JsonlColumnStore.test.ts` | 2 files |
| `columns/ObservationColumnStore-wiring.test.ts` | 4 files |
| `core/ConcurrencyControl.test.ts` | 4 files |
| `core/entity-manager-list-projects.test.ts` | 1 files |
| `core/entity-manager-profile-namespace.test.ts` | 2 files |
| `core/entity-manager-project-stamping.test.ts` | 1 files |
| `core/entity-manager-version-chain.test.ts` | 1 files |
| `core/EntityManager.test.ts` | 4 files |
| `core/EntityStateMachine.test.ts` | 1 files |
| `core/GraphEventEmitter.test.ts` | 3 files |
| `core/GraphEvents.test.ts` | 9 files |
| `core/GraphStorage.test.ts` | 1 files |
| `core/GraphTraversal.test.ts` | 2 files |
| `core/HierarchyManager.test.ts` | 3 files |
| `core/known-issue-fixes.test.ts` | 9 files |
| `core/manager-context-default-embedding.test.ts` | 0 files |
| `core/manager-context-new-managers.test.ts` | 5 files |
| `core/manager-context-project.test.ts` | 1 files |
| `core/ManagerContext.test.ts` | 26 files |
| `mmap/FsReadMmapBackend.test.ts` | 2 files |
| `mmap/GraphStorage-mmap-wiring.test.ts` | 8 files |
| `mmap/IMmapBackend.test.ts` | 1 files |
| `mmap/mmap-review-fixes.test.ts` | 3 files |
| `core/observation-validate-hook.test.ts` | 1 files |
| `core/ObservationManager.dedup.test.ts` | 3 files |
| `core/ObservationManager.test.ts` | 3 files |
| `core/ObservationStore.test.ts` | 1 files |
| `core/optimistic-concurrency.test.ts` | 3 files |
| `core/RefIndex.test.ts` | 4 files |
| `core/relation-manager-temporal.test.ts` | 1 files |
| `core/RelationManager.test.ts` | 4 files |
| `segments/FileSegmentStorage.test.ts` | 3 files |
| `segments/GraphStorage-segments.test.ts` | 8 files |
| `segments/ISegmentStorage.test.ts` | 2 files |
| `segments/segments-review-fixes.test.ts` | 10 files |
| `core/sqlite-content-hash-migration.test.ts` | 1 files |
| `core/SQLiteStorage.test.ts` | 1 files |
| `core/StorageFactory.test.ts` | 3 files |
| `core/temporal-versioning.test.ts` | 4 files |
| `core/TransactionBatching.test.ts` | 2 files |
| `core/TransactionManager.test.ts` | 3 files |
| `core/TransitionLedger.test.ts` | 2 files |
| `eslint/no-unused-updateentity-return.test.ts` | 0 files |
| `features/AnalyticsManager.test.ts` | 2 files |
| `features/ArchiveManager.test.ts` | 2 files |
| `features/AuditLog.test.ts` | 1 files |
| `features/AutoLinker.test.ts` | 11 files |
| `features/BackupManager.test.ts` | 3 files |
| `features/compression-manager-priority-dedup.test.ts` | 1 files |
| `features/compression-manager-versioning-guard.test.ts` | 1 files |
| `features/CompressionManager.test.ts` | 5 files |
| `features/contradiction-detector-detect.test.ts` | 3 files |
| `features/FactExtractor.test.ts` | 3 files |
| `features/FreshnessManager.test.ts` | 3 files |
| `features/GovernanceManager.test.ts` | 10 files |
| `features/io-manager-ingest.test.ts` | 1 files |
| `features/io-manager-split.test.ts` | 1 files |
| `features/io-manager-visualize.test.ts` | 1 files |
| `features/IOManager.rdf-export.test.ts` | 9 files |
| `features/IOManager.test.ts` | 11 files |
| `features/ObservableDataModelAdapter.test.ts` | 3 files |
| `features/ObservationNormalizer.test.ts` | 9 files |
| `features/semantic-forget-exact.test.ts` | 2 files |
| `features/semantic-forget-semantic.test.ts` | 3 files |
| `features/StreamingExporter.test.ts` | 2 files |
| `features/TagManager.test.ts` | 1 files |
| `performance/baselineHelper.test.ts` | 0 files |
| `search/BasicSearch.test.ts` | 4 files |
| `search/BloomFilter.test.ts` | 3 files |
| `search/BM25Search.test.ts` | 3 files |
| `search/BooleanSearch.test.ts` | 4 files |
| `search/EarlyTerminationManager.test.ts` | 9 files |
| `search/EmbeddingCache.test.ts` | 1 files |
| `search/EmbeddingService.test.ts` | 2 files |
| `search/FuzzySearch.test.ts` | 4 files |
| `search/HybridScorer.test.ts` | 8 files |
| `search/HybridSearchManager.test.ts` | 9 files |
| `search/IncrementalIndexer.test.ts` | 8 files |
| `search/IncrementalTFIDF.test.ts` | 4 files |
| `search/LLMQueryPlanner.test.ts` | 9 files |
| `search/MaterializedViews.test.ts` | 2 files |
| `search/NGramFuzzyIntegration.test.ts` | 5 files |
| `search/NGramIndex.test.ts` | 1 files |
| `search/OptimizedInvertedIndex.test.ts` | 1 files |
| `search/ParallelSearchExecutor.test.ts` | 8 files |
| `search/PartialIndexAdvisor.test.ts` | 1 files |
| `search/ProximitySearch.test.ts` | 3 files |
| `search/QuantizedVectorStore.test.ts` | 1 files |
| `search/QueryAnalyzer.test.ts` | 2 files |
| `search/QueryCostEstimator.test.ts` | 9 files |
| `search/QueryLogger.test.ts` | 1 files |
| `search/QueryParser.test.ts` | 1 files |
| `search/QueryPlanCache.test.ts` | 8 files |
| `search/RankedSearch.test.ts` | 3 files |
| `search/ReflectionManager.test.ts` | 9 files |
| `search/SavedSearchManager.test.ts` | 3 files |
| `search/search-filter-chain-project.test.ts` | 2 files |
| `search/search-filter-chain-versioning.test.ts` | 2 files |
| `search/SearchFilterChain.test.ts` | 8 files |
| `search/SearchManager.test.ts` | 2 files |
| `search/SearchSuggestions.test.ts` | 2 files |
| `search/SemanticSearch.test.ts` | 45 files |
| `search/SpellChecker.test.ts` | 2 files |
| `search/TemporalQueryParser.test.ts` | 1 files |
| `search/TemporalSearch.test.ts` | 9 files |
| `search/TFIDFEventSync.test.ts` | 11 files |
| `search/TFIDFIndexManager.test.ts` | 8 files |
| `tiered/BrotliColdTier.test.ts` | 2 files |
| `tiered/DiskWarmTier.test.ts` | 1 files |
| `tiered/ITieredIndex.test.ts` | 1 files |
| `tiered/LRUHotTier.test.ts` | 1 files |
| `tiered/tiered-review-fixes.test.ts` | 4 files |
| `tiered/TieredIndex-wiring.test.ts` | 1 files |
| `tiered/TieredIndex.test.ts` | 3 files |
| `search/VectorStore.test.ts` | 1 files |
| `security/ABACPolicy.test.ts` | 1 files |
| `security/APIKeyStore.test.ts` | 1 files |
| `security/PiiRedactor.test.ts` | 5 files |
| `security/RowLevelFilter.test.ts` | 2 files |
| `tools/observations-to-columns.test.ts` | 1 files |
| `tools/plan-doc-audit.test.ts` | 0 files |
| `tools/segment-jsonl.test.ts` | 2 files |
| `types/agent-memory.test.ts` | 7 files |
| `types/entity-content-hash.test.ts` | 1 files |
| `types/entity-new-fields.test.ts` | 1 files |
| `types/profile-entity.test.ts` | 2 files |
| `types/progress.test.ts` | 1 files |
| `types/result.test.ts` | 1 files |
| `types/search.test.ts` | 1 files |
| `types/trust-level.test.ts` | 1 files |
| `utils/BatchProcessor.test.ts` | 1 files |
| `utils/CachePressureCoordinator.test.ts` | 1 files |
| `utils/compressedCache.test.ts` | 8 files |
| `compression/compressedEntityCache-wiring.test.ts` | 8 files |
| `compression/CompressedMap.test.ts` | 2 files |
| `compression/compression-review-fixes.test.ts` | 10 files |
| `compression/ICompressionAdapter.test.ts` | 1 files |
| `utils/compressionUtil.test.ts` | 2 files |
| `utils/durableWriteFile.test.ts` | 1 files |
| `utils/entityUtils.test.ts` | 33 files |
| `utils/EntityValidator.test.ts` | 3 files |
| `utils/errors.test.ts` | 1 files |
| `utils/errorSuggestions.test.ts` | 2 files |
| `utils/formatters.test.ts` | 26 files |
| `utils/indexes.test.ts` | 8 files |
| `utils/logger.test.ts` | 1 files |
| `utils/MemoryMonitor.test.ts` | 1 files |
| `utils/operationUtils.test.ts` | 2 files |
| `utils/parallelUtils.test.ts` | 1 files |
| `utils/relationHelpers.test.ts` | 2 files |
| `utils/relationValidation.test.ts` | 2 files |
| `utils/schemas.test.ts` | 26 files |
| `utils/SchemaValidator.test.ts` | 2 files |
| `utils/searchAlgorithms.test.ts` | 26 files |
| `utils/searchCache.test.ts` | 1 files |
| `utils/taskScheduler.test.ts` | 1 files |
| `utils/validators.test.ts` | 2 files |
| `utils/WorkerPoolManager.test.ts` | 1 files |
| `workers/levenshteinWorker.test.ts` | 1 files |
| `workers/WorkerPool.test.ts` | 0 files |
