<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Test Coverage Analysis

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 416 |
| Total Test Files | 586 |
| Source Files with Tests | 386 |
| Source Files without Tests | 30 |
| Coverage (raw, direct-import) | **92.8%** |
---

## Source Files Without Test Coverage

The following 30 source files are not directly imported by any test file:

### adapters/

- `src/adapters/recursaToolBounds.ts` → Expected test: `tests/unit/adapters/recursaToolBounds.test.ts`

### agent/

- `src/agent/bootstrap/bootstrapShared.ts` → Expected test: `tests/unit/agent/bootstrapShared.test.ts`
- `src/agent/harness/InteractionLogBlobs.ts` → Expected test: `tests/unit/agent/InteractionLogBlobs.test.ts`
- `src/agent/knowledge/privateRecordEntity.ts` → Expected test: `tests/unit/agent/privateRecordEntity.test.ts`
- `src/agent/learning/ChildKnowledgeOverlay.ts` → Expected test: `tests/unit/agent/ChildKnowledgeOverlay.test.ts`
- `src/agent/learning/LeafApply.ts` → Expected test: `tests/unit/agent/LeafApply.test.ts`
- `src/agent/learning/LeafLearnerContext.ts` → Expected test: `tests/unit/agent/LeafLearnerContext.test.ts`
- `src/agent/learning/LeafRound.ts` → Expected test: `tests/unit/agent/LeafRound.test.ts`
- `src/agent/learning/LeafValidation.ts` → Expected test: `tests/unit/agent/LeafValidation.test.ts`
- `src/agent/learning/RecursiveChildren.ts` → Expected test: `tests/unit/agent/RecursiveChildren.test.ts`
- `src/agent/learning/RecursiveDrive.ts` → Expected test: `tests/unit/agent/RecursiveDrive.test.ts`
- `src/agent/learning/RecursiveEvaluate.ts` → Expected test: `tests/unit/agent/RecursiveEvaluate.test.ts`
- `src/agent/learning/RecursivePlan.ts` → Expected test: `tests/unit/agent/RecursivePlan.test.ts`
- `src/agent/learning/RevisionGeneralize.ts` → Expected test: `tests/unit/agent/RevisionGeneralize.test.ts`
- `src/agent/procedural/graph/backing/LockedProceduralGraphBacking.ts` → Expected test: `tests/unit/agent/LockedProceduralGraphBacking.test.ts`
- `src/agent/procedural/graph/backing/ProceduralGraphState.ts` → Expected test: `tests/unit/agent/ProceduralGraphState.test.ts`
- `src/agent/versionedWriteFailure.ts` → Expected test: `tests/unit/agent/versionedWriteFailure.test.ts`

### cli/

- `src/cli/commands/entity.ts` → Expected test: `tests/unit/cli/entity.test.ts`
- `src/cli/commands/io.ts` → Expected test: `tests/unit/cli/io.test.ts`
- `src/cli/commands/relation.ts` → Expected test: `tests/unit/cli/relation.test.ts`

### core/

- `src/core/context/BootstrapFacade.ts` → Expected test: `tests/unit/core/BootstrapFacade.test.ts`
- `src/core/context/envBounds.ts` → Expected test: `tests/unit/core/envBounds.test.ts`

### search/

- `src/search/enDate/calendar.ts` → Expected test: `tests/unit/search/calendar.test.ts`
- `src/search/enDate/constants.ts` → Expected test: `tests/unit/search/constants.test.ts`
- `src/search/enDate/parsers.ts` → Expected test: `tests/unit/search/parsers.test.ts`
- `src/search/enDate/refiners.ts` → Expected test: `tests/unit/search/refiners.test.ts`
- `src/search/enDate/timezones.ts` → Expected test: `tests/unit/search/timezones.test.ts`
- `src/search/tiered/MapFileTier.ts` → Expected test: `tests/unit/search/MapFileTier.test.ts`

### root/

- `src/sqlite.ts` → Expected test: `tests/unit/root/sqlite.test.ts`

### utils/

- `src/utils/jsonlRecordFile.ts` → Expected test: `tests/unit/utils/jsonlRecordFile.test.ts`

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `adapters/ApiKeyAuthMiddleware.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `RecursaToolAdapterSafety.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/LangChainMemoryAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LangChainMemoryAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/MCPToolObserverAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/RateLimiter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RateLimiter.bounds.test.ts`, `RateLimiter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `rest-tenancy.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/RecursaToolAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/RestRouter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `RecursaToolAdapterSafety.test.ts`, `RestRouter.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapterSafety.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/pagination.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapterSafety.test.ts`, `pagination.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `adapters/recursaToolSchemas.ts` | `schema.parity.test.ts` |
| `adapters/recursaToolSupport.ts` | `schema.parity.test.ts` |
| `agent/AccessTracker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AccessTracker.recordBatch.test.ts`, `AccessTracker.test.ts`, `AgentMemoryManager.test.ts`, `ConnectivitySignals.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.reinforceBatch.test.ts`, `DecayEngine.test.ts`, `InMemoryBackend.test.ts`, `SalienceEngine-heap-pins.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/AgentEnvDefaults.ts` | `AgentEnvDefaults.test.ts` |
| `agent/AgentMemoryConfig.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConnectivitySignals.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/AgentMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentEnvDefaults.test.ts`, `AgentMemoryManager.collaborativeSynthesis.test.ts`, `AgentMemoryManager.knowledge.test.ts`, `AgentMemoryManager.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/AgentReflectionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `AgentReflectionManager.test.ts`, `ReflectionStage.test.ts`, `Diagnoser.test.ts`, `LearningReflector.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ArtifactManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ArtifactManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/CognitiveLoadAnalyzer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentEnvDefaults.test.ts`, `AgentMemoryManager.test.ts`, `CognitiveLoadAnalyzer.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/CollaborativeSynthesis.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.collaborativeSynthesis.test.ts`, `AgentMemoryManager.test.ts`, `CollaborativeSynthesis.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ConflictResolver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConflictResolver.strategies.test.ts`, `ConflictResolver.test.ts`, `MemoryValidator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ConsolidationPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ConsolidationPipeline.test.ts`, `ConsolidationScheduler.test.ts`, `DreamEngine.test.ts`, `HeuristicExtractionStage.test.ts`, `ObservationDedupReportStage.test.ts`, `ReflectionStage.test.ts`, `RelationConsolidator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `validation.assertNonEmptyString.test.ts` |
| `agent/ConsolidationScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationScheduler.test.ts`, `ManagerContext.agentEnvDefaults.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ContextProfileManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ContextProfileManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ContextWindowManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `TrajectoryCompressor.test.ts`, `ManagerContext-hybridContext.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DecayEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AccessTracker.test.ts`, `AgentMemoryManager.test.ts`, `ConnectivitySignals.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ConsolidationPipeline.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.reinforceBatch.test.ts`, `DecayEngine.test.ts`, `DecayScheduler.test.ts`, `InMemoryBackend.test.ts`, `RelationConsolidator.test.ts`, `SalienceEngine-heap-pins.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DecayScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DecayScheduler.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DecisionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DecisionManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DistillationPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DistillationPolicy.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/DreamEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `DreamEngine.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/EntropyFilter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EntropyFilter.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/EpisodicMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EpisodicMemoryManager.test.ts`, `SessionManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ExclusionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExclusionManager.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ExperienceExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExperienceExtractor.test.ts`, `ReflectionStage.test.ts`, `delta-services-wiring.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/FailureDistillation.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `FailureDistillation.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/FailureManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `FailureManager.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `LeafAbortDedup.test.ts`, `KnowledgeGovernanceFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/GuardedComponentEdit.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `GuardedComponentEdit.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/HeuristicManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ImportanceScorer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ImportanceScorer.test.ts`, `MemoryEngine.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/InMemoryBackend.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `InMemoryBackend.test.ts`, `memoryBackend-wiring.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/MemoryBackend.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `IMemoryBackend.contract.test.ts`, `selectWeightedTurns.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/MemoryEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryEngine.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/MemoryFormatter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryFormatter.test.ts`, `MemoryFormatterSalience.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/MemoryValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryValidator.test.ts`, `delta-services-wiring.test.ts`, `AgentCognitionFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/MultiAgentMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MultiAgentMemoryManager.fieldPreservation.test.ts`, `MultiAgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ObservationDedupManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ObservationDedupManager.test.ts`, `ObservationDedupReportStage.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ObserverPipeline.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ObserverPipeline.test.ts`, `ObservationManager.events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/PatternDetector.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExperienceExtractor.test.ts`, `PatternDetector.test.ts`, `ReflectionStage.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/PlanManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `PlanManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ProfileManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ProjectContextManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProjectContextManager.dedupByKey.test.ts`, `ProjectContextManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ProspectiveMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `ProspectiveMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/RelationConsolidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RelationConsolidator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/RoleProfiles.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RoleProfiles.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/RuleEvaluator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RuleEvaluator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SQLiteBackend.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SQLiteBackend.test.ts`, `memoryBackend-wiring.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SalienceEngine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CollaborativeSynthesis.test.ts`, `ConnectivitySignals.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `SalienceEngine-heap-pins.test.ts`, `SalienceEngine.test.ts`, `profile-manager-extraction.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SessionCheckpoint.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SessionCheckpoint.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SessionManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.createdWithin.test.ts`, `SessionQueryBuilder.test.ts`, `profile-manager-extraction.test.ts`, `storage-write-ownership.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SessionQueryBuilder.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SessionQueryBuilder.createdWithin.test.ts`, `SessionQueryBuilder.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/SummarizationService.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SummarizationService.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ToolAffordanceManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.interactionLog.test.ts`, `ToolCallObserver.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/ToolCallObserver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolCallObserver.interactionLog.test.ts`, `ToolCallObserver.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/TrajectoryCompressor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ReflectionStage.test.ts`, `TrajectoryCompressor.test.ts`, `delta-services-wiring.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/VisibilityResolver.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `VisibilityResolver.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/WorkThreadManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorkThreadManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/WorkingMemoryManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ConsolidationPipeline.test.ts`, `EntropyFilter.test.ts`, `RelationConsolidator.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts`, `WorkingMemoryManager.test.ts`, `storage-write-ownership.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/Bootstrapper.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Bootstrapper.test.ts`, `LearnedSkillLoadability.test.ts`, `ManagerContext.bootstrapper.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/BoundaryRecorder.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `BootstrapValidation.test.ts`, `BoundaryRecorder.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/CorpusMapper.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `BootstrapValidation.test.ts`, `CorpusMapper.test.ts`, `ExplorationNotes.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/ExplorationNotes.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExplorationNotes.test.ts`, `ManagerContext.bootstrapper.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/PracticeTaskGenerator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `PracticeTaskGenerator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `bootstrap/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `causal/CausalReasoner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CausalReasoner.test.ts`, `manager-context-new-managers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `causal/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `collaboration/CollaborationAuditEnforcer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/connectivity.ts` | `ConnectivitySignals.test.ts` |
| `evaluation/DeterministicJudge.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapter.test.ts`, `AgentMemoryManager.test.ts`, `DeterministicJudge.hardening.test.ts`, `DeterministicJudge.test.ts`, `Evaluator.hardening.test.ts`, `Evaluator.test.ts`, `LLMRubricJudge.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `evaluation/Evaluator.ts` | `file-path.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Evaluator.hardening.test.ts`, `Evaluator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `evaluation/LLMRubricJudge.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LLMRubricJudge.hardening.test.ts`, `LLMRubricJudge.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `evaluation/RubricAudit.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RubricAudit.hardening.test.ts`, `RubricAudit.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `evaluation/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `events/EventManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EventManager.candidatesVia.test.ts`, `EventManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `events/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `EventManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `harness/ConcurrencyLimiter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ConcurrencyLimiter.test.ts`, `LeafAbortDedup.test.ts`, `RevisionMerger.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `harness/EvictionIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `EvictionIndex.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `harness/InteractionLog.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolCallObserver.interactionLog.test.ts`, `InteractionLog.hardening.test.ts`, `InteractionLog.test.ts`, `Diagnoser.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `harness/InteractionLogFormat.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RecursaToolAdapter.test.ts`, `AgentMemoryManager.test.ts`, `ToolCallObserver.interactionLog.test.ts`, `InteractionLog.hardening.test.ts`, `InteractionLog.test.ts`, `Diagnoser.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `harness/InteractionLogRegex.ts` | `InteractionLog.hardening.test.ts`, `InteractionLog.test.ts` |
| `harness/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/keyValueLine.ts` | `keyValueLine.test.ts` |
| `knowledge/InstructionSetManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `InstructionSetManager.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeRepository.rollback.test.ts`, `KnowledgeRepository.test.ts`, `knowledgeLoad.pack.test.ts`, `knowledgeContext.sections.test.ts`, `privateRecordEntity.test.ts`, `SkillWritePath.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `knowledge/KnowledgeRepository.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Bootstrapper.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeRepository.rollback.test.ts`, `KnowledgeRepository.test.ts`, `knowledgeLoad.pack.test.ts`, `knowledgeContext.sections.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `KnowledgeEditor.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `knowledge/ScratchKnowledge.ts` | `LeafValidationPlan.test.ts` |
| `knowledge/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `knowledge/knowledgeDigest.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Bootstrapper.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeRepository.rollback.test.ts`, `KnowledgeRepository.test.ts`, `knowledgeDigest.test.ts`, `knowledgeLoad.pack.test.ts`, `knowledgeContext.sections.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `KnowledgeEditor.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `knowledge/knowledgeLoad.ts` | `knowledgeLoad.pack.test.ts`, `LeafValidationPlan.test.ts`, `LearnedSkillLoadability.test.ts` |
| `knowledge/knowledgeRevision.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `privateRecordEntity.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/knowledgeContext.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.knowledge.test.ts`, `AgentMemoryManager.test.ts`, `ContextWindowManager.knowledge.test.ts`, `knowledgeContext.sections.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/Diagnoser.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `LeafAbortDedup.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/InProcessLearnHandler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `InProcessLearnHandler.concurrency.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/KnowledgeEditor.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `KnowledgeEditor.test.ts`, `LearnedSkillLoadability.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LeafLearner.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `LeafLearnerBounds.test.ts`, `LeafLearnerResume.test.ts`, `LeafValidationPlan.test.ts`, `RecursiveLearner.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LeafLearnerDeps.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LeafAbortDedup.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LeafLearnerOptions.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `LeafLearnerBounds.test.ts`, `LeafLearnerResume.test.ts`, `LeafValidationPlan.test.ts`, `RecursiveLearner.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LeafLearnerStore.ts` | `LeafLearnerBounds.test.ts`, `loadTasksByIds.test.ts` |
| `learning/LearningAccountant.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LearningAccountant.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LearningReflector.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LearningReflector.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/LearningTrace.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `LearningReflector.test.ts`, `LearningTrace.test.ts`, `RecursiveLearner.test.ts`, `RecursivePlanBudget.test.ts`, `RecursiveWriteBudget.test.ts`, `loadTasksByIds.test.ts`, `privateRecordEntity.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/RecursiveLearner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `InProcessLearnHandler.concurrency.test.ts`, `RecursiveWriteBudget.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/RecursiveLearnerState.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RecursiveCriteria.test.ts`, `RecursiveLearner.test.ts`, `loadTasksByIds.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/RecursiveMerge.ts` | `RecursiveCriteria.test.ts` |
| `learning/RevisionMerger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RecursiveLiveK.test.ts`, `RevisionMergeRules.test.ts`, `RevisionMerger.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/RevisionReconcile.ts` | `RevisionMergeRules.test.ts` |
| `learning/RevisionValidator.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RecursiveLiveK.test.ts`, `RevisionValidator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/SplitStrategies.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RecursivePlanBudget.test.ts`, `SplitStrategies.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/llmJson.ts` | `RevisionMergeRules.test.ts`, `llmJson.raceAbort.test.ts` |
| `learning/observationChunks.ts` | `LeafLearnerBounds.test.ts`, `LearningTrace.test.ts` |
| `learning/revisionMergeShared.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `RecursiveLiveK.test.ts`, `RevisionMergeRules.test.ts`, `RevisionMerger.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `learning/types.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `Bootstrapper.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `KnowledgeEditor.test.ts`, `LeafAbortDedup.test.ts`, `LeafLearner.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `procedural/ProcedureManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `manager-context-new-managers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `procedural/ProcedureStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `procedural/StepSequencer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProcedureGraphAdapter.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/CompletionProvider.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `LLMRubricJudge.hardening.test.ts`, `LLMRubricJudge.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `KnowledgeEditor.test.ts`, `LeafAbortDedup.test.ts`, `LearningReflector.test.ts`, `RevisionMerger.test.ts`, `CompletionProvider.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphSession.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraph.ts` | `file-path.test.ts`, `procedural-graph-guidance.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraph.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphSerializer.test.ts`, `ProceduralGraphSession.test.ts`, `ProceduralGraphValidator.test.ts`, `appendixF.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphEvolution.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphEvolution.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `GuardedComponentEdit.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphManager.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphRefiner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphRefiner.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphSchemas.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphSchemas.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `schema.parity.test.ts` |
| `graph/ProceduralGraphSerializer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphSerializer.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphSession.ts` | `file-path.test.ts`, `procedural-graph-guidance.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphSession.test.ts`, `appendixF.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGraphValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphValidator.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProceduralGuidance.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/ProcedureGraphAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProcedureGraphAdapter.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `backing/IProceduralGraphBacking.ts` | `file-path.test.ts`, `procedural-graph-recovery.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `memory.test.ts`, `hardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `backing/InMemoryProceduralGraphBacking.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `GuardedComponentEdit.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphManager.test.ts`, `memory.test.ts`, `hardening.test.ts`, `ManagerContext-proceduralGraph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `backing/JsonlProceduralGraphBacking.ts` | `file-path.test.ts`, `procedural-graph-recovery.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `jsonl.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `backing/SqliteProceduralGraphBacking.ts` | `file-path.test.ts`, `procedural-graph-recovery.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `sqlite.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `backing/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/canonical.ts` | `file-path.test.ts`, `procedural-graph-recovery.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraph.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphManager.test.ts`, `ProceduralGraphSchemas.test.ts`, `ProceduralGraphSerializer.test.ts`, `ProceduralGraphValidator.test.ts`, `canonical-compare.test.ts`, `canonical.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/prompts.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphSession.test.ts`, `hardening.test.ts`, `prompts.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `graph/tokenTail.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraphEvolution.test.ts`, `hardening.test.ts`, `tokenTail.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `procedural/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `rbac/PermissionMatrix.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `rbac/RbacMiddleware.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `manager-context-new-managers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `rbac/RbacTypes.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `rbac/RoleAssignmentStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `manager-context-new-managers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `rbac/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `rbac.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/CueTagContentGraph.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CueTagContentGraph.test.ts`, `MemoryToolkit.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/MemoryDistiller.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryDistiller.test.ts`, `ReconstructiveMemory.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/MemoryGraphBridge.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `CorpusMapper.test.ts`, `MemoryGraphBridge.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/MemoryReconstructor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/MemoryToolkit.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryToolkit.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/ReconstructiveMemory.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `MemoryGraphBridge.test.ts`, `ReconstructiveMemory.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `reconstruction/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/recordQuery.ts` | `recordQuery.test.ts` |
| `retrieval/ActiveRetrievalController.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `retrieval/QueryRewriter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `retrieval/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/selectWeightedTurns.ts` | `selectWeightedTurns.test.ts` |
| `skills/SkillFormat.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `SkillFormat.test.ts`, `SkillHardening.test.ts`, `SkillPublisher.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `skills/SkillManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `ExplorationNotes.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeEditor.test.ts`, `SkillHardening.test.ts`, `SkillIOConfinement.test.ts`, `SkillManager.test.ts`, `SkillPublisher.test.ts`, `SkillPublisherConfinement.test.ts`, `SkillWritePath.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `skills/SkillPublisher.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `operation-progress.test.ts`, `streaming-export.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-benchmarks.test.ts`, `AgentMemoryManager.test.ts`, `SkillHardening.test.ts`, `SkillIOConfinement.test.ts`, `SkillPublisher.test.ts`, `SkillPublisherConfinement.test.ts`, `SkillWritePath.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BackupManager.test.ts`, `IOManager.graphmlDataValue.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `IOManager.xmlGoldens.test.ts`, `ingest-provenance-modes.test.ts`, `pii-redaction-export.test.ts` |
| `skills/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `skills/skillRecordUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `KnowledgeHardening.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `skills/skillTreeFs.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `agent/workingMemoryGuard.ts` | `workingMemoryGuard.test.ts` |
| `world/WorldModelManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `world/WorldStateSnapshot.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `world/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentMemoryManager.test.ts`, `WorldModel.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `cli/ansi.ts` | `ansi.test.ts` |
| `commands/audit.ts` | `audit.test.ts` |
| `commands/cache.ts` | `cache-reindex.test.ts` |
| `commands/check.ts` | `check.test.ts` |
| `commands/decision.ts` | `decision.test.ts` |
| `commands/diag.ts` | `diag.test.ts` |
| `commands/doctor.ts` | `doctor.test.ts` |
| `commands/exclusion.ts` | `exclusion.test.ts` |
| `commands/graph.ts` | `graph.test.ts` |
| `commands/helpers.ts` | `emitJson.test.ts` |
| `commands/heuristic.ts` | `heuristic.test.ts` |
| `commands/hierarchy.ts` | `hierarchy.test.ts` |
| `commands/index.ts` | `actionFrame.test.ts`, `commands.test.ts`, `index.test.ts`, `parseArgsPinned.test.ts` |
| `commands/inspect.ts` | `inspect.test.ts` |
| `commands/maintenance.ts` | `maintenance-cli.test.ts` |
| `commands/observation.ts` | `observation.test.ts` |
| `commands/observationDedup.ts` | `observationDedup.test.ts` |
| `commands/projectContext.ts` | `projectContext.test.ts` |
| `commands/reindex.ts` | `cache-reindex.test.ts` |
| `commands/search.ts` | `search-extended.test.ts` |
| `commands/smoke.ts` | `smoke.test.ts` |
| `commands/spell.ts` | `spell.test.ts` |
| `commands/tag.ts` | `tag.test.ts` |
| `commands/toolAffordance.ts` | `toolAffordance.test.ts` |
| `cli/config.ts` | `actionFrame.test.ts`, `config.test.ts` |
| `cli/formatters.ts` | `formatters.test.ts` |
| `cli/index.ts` | `index.test.ts` |
| `cli/interactive.ts` | `interactive.test.ts` |
| `cli/options.ts` | `actionFrame.test.ts`, `options.test.ts` |
| `cli/parseArgs.ts` | `actionFrame.test.ts`, `audit.test.ts`, `cache-reindex.test.ts`, `check.test.ts`, `commands.test.ts`, `diag.test.ts`, `doctor.test.ts`, `emitJson.test.ts`, `index.test.ts`, `inspect.test.ts`, `parseArgsPinned.test.ts`, `parseArgsSurfacePinned.test.ts`, `smoke.test.ts` |
| `cli/plainTable.ts` | `plainTable.challenger.test.ts`, `plainTable.test.ts` |
| `core/EntityManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `optimization-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `MCPToolObserverAdapter.test.ts`, `AgentReflectionManager.test.ts`, `ArtifactManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `DecisionManager.test.ts`, `EventManager.candidatesVia.test.ts`, `EventManager.test.ts`, `ExclusionManager.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `ObserverPipeline.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProjectContextManager.test.ts`, `ReflectionStage.test.ts`, `RelationConsolidator.test.ts`, `SessionCheckpoint.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `WorkThreadManager.test.ts`, `WorldModel.test.ts`, `LearningReflector.test.ts`, `LearningTrace.test.ts`, `loadTasksByIds.test.ts`, `SkillWritePath.test.ts`, `ConcurrencyControl.test.ts`, `EntityManager.legacyDelete.test.ts`, `EntityManager.test.ts`, `ManagerContext.test.ts`, `ObservationManager.events.test.ts`, `RefIndex.test.ts`, `RelationManager-metadata.test.ts`, `RelationManager.test.ts`, `AgentBookkeepingFacade.test.ts`, `AgentCognitionFacade.test.ts`, `AgentMemoryFacade.test.ts`, `KnowledgeGovernanceFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `entity-id.test.ts`, `optimistic-concurrency.test.ts`, `recursa-record-persistence.test.ts`, `rename-entity.test.ts`, `sqlite-events.test.ts`, `storage-write-ownership.test.ts`, `temporal-versioning.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `CompressionManager.test.ts`, `FactExtractor.test.ts`, `BM25Search.test.ts`, `BM25SearchReadPath.test.ts`, `BasicSearch.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `MaterializedViews.test.ts`, `NGramFuzzyIntegration.test.ts`, `RankedSearch.test.ts`, `RankedSearchGraphBoost.test.ts`, `RankedSearchProjectStarvation.test.ts`, `update-entity-schema-strip.test.ts` |
| `core/EntityStateMachine.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `EntityStateMachine.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/GraphEventEmitter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ObserverPipeline.test.ts`, `GraphEventEmitter.observation.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `ManagerContext.test.ts`, `TransitionLedger.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GraphRankPrior.test.ts`, `TFIDFEventSync.test.ts` |
| `core/GraphStorage.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `compression-optimization.test.ts`, `hybrid-search.test.ts`, `operation-progress.test.ts`, `smart-search.test.ts`, `graph-storage-new-fields.test.ts`, `storage-dedup-safety.test.ts`, `streaming-export.test.ts`, `transaction-isolation.test.ts`, `worker-pool-integration.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `optimization-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `AgentEnvDefaults.test.ts`, `AgentMemoryManager.collaborativeSynthesis.test.ts`, `AgentMemoryManager.test.ts`, `ArtifactManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.test.ts`, `DecayEngine.test.ts`, `EventManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `RelationConsolidator.test.ts`, `SessionCheckpoint.test.ts`, `WorkThreadManager.test.ts`, `WorkingMemoryManager.test.ts`, `WorldModel.test.ts`, `LearningTrace.test.ts`, `RecursiveWriteBudget.test.ts`, `loadTasksByIds.test.ts`, `SkillIOConfinement.test.ts`, `SkillPublisherConfinement.test.ts`, `SkillWritePath.test.ts`, `BatchTransaction.test.ts`, `ConcurrencyControl.test.ts`, `EntityManager.legacyDelete.test.ts`, `EntityManager.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `GraphStorage.test.ts`, `GraphTraversal.test.ts`, `GraphTraversalLookFor.test.ts`, `HierarchyManager.test.ts`, `ManagerContext.test.ts`, `ObservationManager.dedup.test.ts`, `ObservationManager.events.test.ts`, `ObservationManager.test.ts`, `RefIndex.test.ts`, `RelationManager-metadata.test.ts`, `RelationManager.test.ts`, `StorageFactory.test.ts`, `TransactionBatching.test.ts`, `TransactionManager.test.ts`, `ObservationColumnStore-wiring.test.ts`, `AgentBookkeepingFacade.test.ts`, `AgentCognitionFacade.test.ts`, `AgentMemoryFacade.test.ts`, `KnowledgeGovernanceFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `entity-id.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `mmap-review-fixes.test.ts`, `mutation-isolation.test.ts`, `optimistic-concurrency.test.ts`, `recursa-record-persistence.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-events.test.ts`, `storage-write-ownership.test.ts`, `storageCapabilities.test.ts`, `temporal-versioning.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AnalyticsManager.test.ts`, `ArchiveManager.test.ts`, `AutoLinker.test.ts`, `BackupManager.test.ts`, `CompressionManager.test.ts`, `FreshnessManager.test.ts`, `GovernanceManager-delta.test.ts`, `GovernanceManager-fresh-storage.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `IOManager.xmlGoldens.test.ts`, `ObservableDataModelAdapter.test.ts`, `pii-redaction-export.test.ts`, `BM25Search.test.ts`, `BM25SearchReadPath.test.ts`, `BasicSearch.test.ts`, `BloomFilter.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `IncrementalTFIDF.test.ts`, `MaterializedViews.test.ts`, `NGramFuzzyIntegration.test.ts`, `RankedSearch.test.ts`, `RankedSearchGraphBoost.test.ts`, `RankedSearchProjectStarvation.test.ts`, `SavedSearchManager.test.ts`, `SearchManager.test.ts`, `SearchSuggestions.test.ts`, `TFIDFEventSync.test.ts`, `cache-isolation.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsPaths.test.ts`, `update-entity-schema-strip.test.ts` |
| `core/GraphTraversal.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `CausalReasoner.test.ts`, `CollaborativeSynthesis.test.ts`, `GraphTraversal.bfsDuplicates.test.ts`, `GraphTraversal.test.ts`, `GraphTraversalLookFor.test.ts`, `ManagerContext.test.ts`, `AgentCognitionFacade.test.ts`, `AgentMemoryFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GraphRankPrior.test.ts`, `RankedSearchGraphBoost.test.ts`, `searchTwinsPaths.test.ts` |
| `core/HierarchyManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `EntityManager.test.ts`, `HierarchyManager.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/ManagerContext.ts` | `edge-cases.test.ts`, `file-path.test.ts`, `MemoryEngineStorage.test.ts`, `access-tracking.test.ts`, `agent-memory-manager-profile.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `manager-context-semantic-forget.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `governance-enforcement.test.ts`, `procedural-graph-iomanager-roundtrip.test.ts`, `project-scope-isolation.test.ts`, `storage-dedup-safety.test.ts`, `transaction-isolation.test.ts`, `knowledge-graph.test.ts`, `memory-engine-perf.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `LangChainMemoryAdapter.test.ts`, `RecursaToolAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `RestRouter.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `ArtifactManager.test.ts`, `ConnectivitySignals.test.ts`, `GuardedComponentEdit.test.ts`, `MemoryEngine.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `SQLiteBackend.test.ts`, `agent-memory-manager-diary.test.ts`, `context-window-manager-compress.test.ts`, `context-window-manager-wakeup.test.ts`, `delta-services-wiring.test.ts`, `LeafValidationPlan.test.ts`, `memoryBackend-wiring.test.ts`, `hardening.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts`, `MemoryGraphBridge.test.ts`, `cache-reindex.test.ts`, `check.test.ts`, `diag.test.ts`, `exclusion.test.ts`, `graph.test.ts`, `hierarchy.test.ts`, `inspect.test.ts`, `maintenance-cli.test.ts`, `observation.test.ts`, `observationDedup.test.ts`, `search-extended.test.ts`, `spell.test.ts`, `tag.test.ts`, `toolAffordance.test.ts`, `ManagerContext-hybridContext.test.ts`, `ManagerContext-proceduralGraph.test.ts`, `ManagerContext-vectorStore.test.ts`, `ManagerContext.agentEnvDefaults.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `ManagerContext.recursa-wiring.test.ts`, `ManagerContext.test.ts`, `bloom-prescreener-wiring.test.ts`, `ObservationColumnStore-wiring.test.ts`, `columns-review-fixes.test.ts`, `shadow-write-drain.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `ManagerContext.close.test.ts`, `ManagerContext.newMembers.test.ts`, `StorageInfraFacade.test.ts`, `entity-manager-list-projects.test.ts`, `entity-manager-profile-namespace.test.ts`, `entity-manager-project-stamping.test.ts`, `entity-manager-version-chain.test.ts`, `known-issue-fixes.test.ts`, `manager-context-env-number.test.ts`, `manager-context-new-managers.test.ts`, `manager-context-project.test.ts`, `observation-validate-hook.test.ts`, `relation-manager-temporal.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GovernanceManager.test.ts`, `compression-manager-priority-dedup.test.ts`, `compression-manager-versioning-guard.test.ts`, `ingest-provenance-modes.test.ts`, `io-manager-ingest.test.ts`, `io-manager-split.test.ts`, `io-manager-visualize.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts`, `TieredIndex-wiring.test.ts`, `Diagnostics.observationDedup.test.ts`, `compressedEntityCache-wiring.test.ts` |
| `core/ObservationManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `write-performance.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConcurrencyControl.test.ts`, `ManagerContext.test.ts`, `ObservationManager.dedup.test.ts`, `ObservationManager.events.test.ts`, `ObservationManager.test.ts`, `ObservationColumnStore-wiring.test.ts`, `AgentBookkeepingFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `sqlite-events.test.ts`, `temporal-versioning.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/ObservationStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `ObservationStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/PostgreSQLStorage.ts` | `PostgreSQLStorage.test.ts` |
| `core/RefIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ArtifactManager.test.ts`, `ManagerContext.test.ts`, `RefIndex.test.ts`, `AgentMemoryFacade.test.ts`, `rename-entity.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `indexBuckets.test.ts` |
| `core/RelationManager.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `EventManager.candidatesVia.test.ts`, `EventManager.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `RelationConsolidator.test.ts`, `SessionCheckpoint.test.ts`, `WorkThreadManager.test.ts`, `LearningTrace.test.ts`, `loadTasksByIds.test.ts`, `ManagerContext.test.ts`, `RelationManager-metadata.test.ts`, `RelationManager.test.ts`, `AgentCognitionFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `rename-entity.test.ts`, `sqlite-events.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `CompressionManager.test.ts`, `FactExtractor.test.ts`, `BasicSearch.test.ts`, `BooleanSearch.test.ts`, `FuzzySearch.test.ts`, `NGramFuzzyIntegration.test.ts`, `RankedSearchGraphBoost.test.ts` |
| `core/SQLiteStorage.ts` | `MemoryEngineStorage.test.ts`, `procedural-graph-recovery.test.ts`, `sqlite-storage-new-fields.test.ts`, `storage-dedup-safety.test.ts`, `write-path-benchmarks.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `EventManager.test.ts`, `MemoryEngine.test.ts`, `LearningTrace.test.ts`, `RecursiveWriteBudget.test.ts`, `sqlite.test.ts`, `ConcurrencyControl.test.ts`, `EntityManager.test.ts`, `HierarchyManager.test.ts`, `RelationManager-metadata.test.ts`, `SQLiteStorage.autoIndexDeprecation.test.ts`, `SQLiteStorage.test.ts`, `StorageFactory.test.ts`, `entity-id.test.ts`, `mutation-isolation.test.ts`, `recursa-record-persistence.test.ts`, `rename-entity.test.ts`, `sqlite-append-replace.test.ts`, `sqlite-content-hash-migration.test.ts`, `sqlite-driver-resolver.test.ts`, `sqlite-embeddings-content-hash.test.ts`, `sqlite-events.test.ts`, `sqlite-fts5-error.test.ts`, `sqlite-on-disk-compat.test.ts`, `storage-write-ownership.test.ts`, `storageCapabilities.test.ts`, `write-path-delta.test.ts`, `GovernanceManager-fresh-storage.test.ts`, `BM25SearchReadPath.test.ts`, `SQLiteFtsSearchIntegration.test.ts`, `SemanticSearch.test.ts`, `VectorStore.test.ts`, `cache-isolation.test.ts`, `searchTwinsFts.test.ts` |
| `core/StorageFactory.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `AgentEnvDefaults.test.ts`, `AgentMemoryManager.collaborativeSynthesis.test.ts`, `ManagerContext.test.ts`, `StorageFactory.test.ts`, `AgentBookkeepingFacade.test.ts`, `AgentCognitionFacade.test.ts`, `AgentMemoryFacade.test.ts`, `KnowledgeGovernanceFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/TransactionManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `transaction-isolation.test.ts`, `knowledge-graph.test.ts`, `BatchTransaction.test.ts`, `ManagerContext.test.ts`, `TransactionBatching.test.ts`, `TransactionManager.test.ts`, `mutation-isolation.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `core/TransitionLedger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `ObservationManager.events.test.ts`, `TransitionLedger.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `columns/IColumnStore.ts` | `IColumnStore.test.ts`, `JsonlColumnStore.test.ts`, `ObservationColumnStore-wiring.test.ts`, `columns-review-fixes.test.ts`, `sqlite-events.test.ts` |
| `columns/JsonlColumnStore.ts` | `JsonlColumnStore.test.ts`, `columns-review-fixes.test.ts` |
| `context/AgentBookkeepingFacade.ts` | `AgentBookkeepingFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts` |
| `context/AgentCognitionFacade.ts` | `edge-cases.test.ts`, `file-path.test.ts`, `MemoryEngineStorage.test.ts`, `access-tracking.test.ts`, `agent-memory-manager-profile.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `manager-context-semantic-forget.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `governance-enforcement.test.ts`, `procedural-graph-iomanager-roundtrip.test.ts`, `project-scope-isolation.test.ts`, `storage-dedup-safety.test.ts`, `transaction-isolation.test.ts`, `knowledge-graph.test.ts`, `memory-engine-perf.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `LangChainMemoryAdapter.test.ts`, `RecursaToolAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `RestRouter.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `ArtifactManager.test.ts`, `ConnectivitySignals.test.ts`, `GuardedComponentEdit.test.ts`, `MemoryEngine.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `SQLiteBackend.test.ts`, `agent-memory-manager-diary.test.ts`, `context-window-manager-compress.test.ts`, `context-window-manager-wakeup.test.ts`, `delta-services-wiring.test.ts`, `LeafValidationPlan.test.ts`, `memoryBackend-wiring.test.ts`, `hardening.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts`, `MemoryGraphBridge.test.ts`, `cache-reindex.test.ts`, `check.test.ts`, `diag.test.ts`, `exclusion.test.ts`, `graph.test.ts`, `hierarchy.test.ts`, `inspect.test.ts`, `maintenance-cli.test.ts`, `observation.test.ts`, `observationDedup.test.ts`, `search-extended.test.ts`, `spell.test.ts`, `tag.test.ts`, `toolAffordance.test.ts`, `ManagerContext-hybridContext.test.ts`, `ManagerContext-proceduralGraph.test.ts`, `ManagerContext-vectorStore.test.ts`, `ManagerContext.agentEnvDefaults.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `ManagerContext.recursa-wiring.test.ts`, `ManagerContext.test.ts`, `bloom-prescreener-wiring.test.ts`, `ObservationColumnStore-wiring.test.ts`, `columns-review-fixes.test.ts`, `shadow-write-drain.test.ts`, `AgentCognitionFacade.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `ManagerContext.close.test.ts`, `ManagerContext.newMembers.test.ts`, `StorageInfraFacade.test.ts`, `entity-manager-list-projects.test.ts`, `entity-manager-profile-namespace.test.ts`, `entity-manager-project-stamping.test.ts`, `entity-manager-version-chain.test.ts`, `known-issue-fixes.test.ts`, `manager-context-env-number.test.ts`, `manager-context-new-managers.test.ts`, `manager-context-project.test.ts`, `observation-validate-hook.test.ts`, `relation-manager-temporal.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GovernanceManager.test.ts`, `compression-manager-priority-dedup.test.ts`, `compression-manager-versioning-guard.test.ts`, `ingest-provenance-modes.test.ts`, `io-manager-ingest.test.ts`, `io-manager-split.test.ts`, `io-manager-visualize.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts`, `TieredIndex-wiring.test.ts`, `Diagnostics.observationDedup.test.ts`, `compressedEntityCache-wiring.test.ts` |
| `context/AgentMemoryFacade.ts` | `AgentMemoryFacade.test.ts` |
| `context/KnowledgeGovernanceFacade.ts` | `KnowledgeGovernanceFacade.test.ts` |
| `context/LearningFacade.ts` | `ManagerContext.learningLoop.facade.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts` |
| `context/SearchFacade.ts` | `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts` |
| `context/StorageInfraFacade.ts` | `StorageInfraFacade.test.ts` |
| `core/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `mmap/FsReadMmapBackend.ts` | `FsReadMmapBackend.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `mmap-review-fixes.test.ts` |
| `mmap/IMmapBackend.ts` | `FsReadMmapBackend.test.ts`, `IMmapBackend.test.ts`, `mmap-review-fixes.test.ts` |
| `core/nodeSqliteAdapter.ts` | `SQLiteStorage.autoIndexDeprecation.test.ts`, `SQLiteStorage.test.ts`, `entity-id.test.ts`, `node-sqlite-adapter-edge-parity.test.ts`, `nodeSqliteAdapter.test.ts`, `sqlite-append-replace.test.ts`, `sqlite-driver-parity.test.ts`, `sqlite-fts5-error.test.ts`, `sqlite-on-disk-compat.test.ts`, `PartialIndexAdvisor.test.ts`, `searchTwinsFts.test.ts` |
| `segments/FileSegmentStorage.ts` | `FileSegmentStorage.test.ts`, `GraphStorage-segments.test.ts`, `assertValidSegmentId.test.ts`, `segments-review-fixes.test.ts` |
| `segments/ISegmentStorage.ts` | `FileSegmentStorage.test.ts`, `ISegmentStorage.test.ts`, `assertValidSegmentId.test.ts`, `segments-review-fixes.test.ts`, `segment-jsonl.test.ts` |
| `core/sqlite-register.ts` | `edge-cases.test.ts`, `file-path.test.ts`, `MemoryEngineStorage.test.ts`, `access-tracking.test.ts`, `agent-memory-manager-profile.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `manager-context-semantic-forget.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `governance-enforcement.test.ts`, `procedural-graph-iomanager-roundtrip.test.ts`, `project-scope-isolation.test.ts`, `storage-dedup-safety.test.ts`, `transaction-isolation.test.ts`, `knowledge-graph.test.ts`, `memory-engine-perf.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `LangChainMemoryAdapter.test.ts`, `RecursaToolAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `RestRouter.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `ArtifactManager.test.ts`, `ConnectivitySignals.test.ts`, `GuardedComponentEdit.test.ts`, `MemoryEngine.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `SQLiteBackend.test.ts`, `agent-memory-manager-diary.test.ts`, `context-window-manager-compress.test.ts`, `context-window-manager-wakeup.test.ts`, `delta-services-wiring.test.ts`, `LeafValidationPlan.test.ts`, `memoryBackend-wiring.test.ts`, `hardening.test.ts`, `profile-manager-basics.test.ts`, `profile-manager-extraction.test.ts`, `MemoryGraphBridge.test.ts`, `cache-reindex.test.ts`, `check.test.ts`, `diag.test.ts`, `exclusion.test.ts`, `graph.test.ts`, `hierarchy.test.ts`, `inspect.test.ts`, `maintenance-cli.test.ts`, `observation.test.ts`, `observationDedup.test.ts`, `search-extended.test.ts`, `spell.test.ts`, `tag.test.ts`, `toolAffordance.test.ts`, `ManagerContext-hybridContext.test.ts`, `ManagerContext-proceduralGraph.test.ts`, `ManagerContext-vectorStore.test.ts`, `ManagerContext.agentEnvDefaults.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.facade.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `ManagerContext.recursa-wiring.test.ts`, `ManagerContext.test.ts`, `bloom-prescreener-wiring.test.ts`, `ObservationColumnStore-wiring.test.ts`, `columns-review-fixes.test.ts`, `shadow-write-drain.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `ManagerContext.close.test.ts`, `ManagerContext.newMembers.test.ts`, `StorageInfraFacade.test.ts`, `entity-manager-list-projects.test.ts`, `entity-manager-profile-namespace.test.ts`, `entity-manager-project-stamping.test.ts`, `entity-manager-version-chain.test.ts`, `known-issue-fixes.test.ts`, `manager-context-env-number.test.ts`, `manager-context-new-managers.test.ts`, `manager-context-project.test.ts`, `observation-validate-hook.test.ts`, `relation-manager-temporal.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GovernanceManager.test.ts`, `compression-manager-priority-dedup.test.ts`, `compression-manager-versioning-guard.test.ts`, `ingest-provenance-modes.test.ts`, `io-manager-ingest.test.ts`, `io-manager-split.test.ts`, `io-manager-visualize.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts`, `TieredIndex-wiring.test.ts`, `Diagnostics.observationDedup.test.ts`, `compressedEntityCache-wiring.test.ts` |
| `core/storageCache.ts` | `storageCache.rebuild.test.ts`, `storageCache.test.ts` |
| `core/storageCapabilities.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `features/AnalyticsManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AnalyticsManager.test.ts` |
| `features/ArchiveManager.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ArchiveManager.test.ts` |
| `features/AuditLog.ts` | `file-path.test.ts`, `governance-enforcement.test.ts`, `knowledge-graph.test.ts`, `CollaborationAuditEnforcer.test.ts`, `GuardedComponentEdit.test.ts`, `audit.test.ts`, `ManagerContext.newMembers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AuditLog.test.ts`, `GovernanceManager-delta.test.ts`, `GovernanceManager-fresh-storage.test.ts`, `GovernanceManager.test.ts`, `pii-redaction-export.test.ts` |
| `features/AutoLinker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts` |
| `features/BackupManager.ts` | `BackupManager.test.ts` |
| `features/CompressionManager.ts` | `file-path.test.ts`, `compression-optimization.test.ts`, `operation-progress.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `optimization-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `ConsolidationScheduler.test.ts`, `ManagerContext.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `CompressionManager.test.ts` |
| `features/ContradictionDetector.ts` | `file-path.test.ts`, `observation-manager-contradiction.test.ts`, `contradiction-detector-supersede.test.ts`, `knowledge-graph.test.ts`, `GuardedComponentEdit.test.ts`, `MemoryValidator.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `contradiction-detector-detect.test.ts` |
| `features/FactExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FactExtractor.test.ts` |
| `features/FreshnessManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FreshnessManager.test.ts` |
| `features/GovernanceManager.ts` | `file-path.test.ts`, `governance-enforcement.test.ts`, `knowledge-graph.test.ts`, `SkillWritePath.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GovernanceManager-delta.test.ts`, `GovernanceManager-fresh-storage.test.ts`, `GovernanceManager.test.ts`, `pii-redaction-export.test.ts` |
| `features/IOManager.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `operation-progress.test.ts`, `streaming-export.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-benchmarks.test.ts`, `SkillIOConfinement.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BackupManager.test.ts`, `IOManager.graphmlDataValue.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `IOManager.xmlGoldens.test.ts`, `ingest-provenance-modes.test.ts`, `pii-redaction-export.test.ts` |
| `features/KeywordExtractor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ObservationNormalizer.test.ts` |
| `features/ObservableDataModelAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ObservableDataModelAdapter.test.ts` |
| `features/ObservationNormalizer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ObservationNormalizer.test.ts` |
| `features/SemanticForget.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `semantic-forget-exact.test.ts`, `semantic-forget-semantic.test.ts` |
| `features/StreamingExporter.ts` | `file-path.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-benchmarks.test.ts`, `ManagerContext.newMembers.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `StreamingExporter-frame-pins.test.ts`, `StreamingExporter.test.ts`, `pii-redaction-export.test.ts` |
| `features/TagManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ManagerContext.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `TagManager-loader-pins.test.ts`, `TagManager.test.ts`, `jsonlRecordFile.test.ts` |
| `features/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `src/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts` |
| `search/BM25Search.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BM25Search.test.ts`, `BM25SearchReadPath.test.ts`, `LexicalCandidateSelection.test.ts`, `SQLiteFtsSearchIntegration.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/BasicSearch.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BasicSearch.test.ts`, `SavedSearchManager-loader-pins.test.ts`, `SavedSearchManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `cache-isolation.test.ts`, `searchTwinsSemantic.test.ts`, `jsonlRecordFile.test.ts` |
| `search/BloomFilter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BloomFilter.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/BloomPreScreener.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BloomFilter.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/BooleanSearch.ts` | `file-path.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `BooleanSearch.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/EarlyTerminationManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `EarlyTerminationManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/EmbeddingCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `EmbeddingCache.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/EmbeddingService.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `MemoryEngine.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `EmbeddingService.test.ts`, `LlamaCppEmbeddingService.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/EvidencePathBuilder.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `EvidencePathBuilder.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/FuzzySearch.ts` | `file-path.test.ts`, `worker-pool-integration.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `SearchFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `FuzzySearchWorkerPath.test.ts`, `NGramFuzzyIntegration.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/GraphRankPrior.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ContextWindowManager.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `GraphRankPrior.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManagerGraph.test.ts`, `LexicalCandidateSelection.test.ts`, `RankedSearchGraphBoost.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/HybridScorer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/HybridSearchManager.ts` | `file-path.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `ContextWindowManager.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `SQLiteFtsSearchIntegration.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/IncrementalIndexer.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/LLMQueryPlanner.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `RelationConsolidator.test.ts`, `CompletionProvider.test.ts`, `MemoryDistiller.test.ts`, `ReconstructiveMemory.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ingest-provenance-modes.test.ts`, `LLMQueryPlanner.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/LLMSearchExecutor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/LSHVectorStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LSHVectorStore.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/MaterializedViews.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `MaterializedViews.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/NGramIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FuzzySearchPerformance.test.ts`, `NGramFuzzyIntegration.test.ts`, `NGramIndex.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/OptimizedInvertedIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `OptimizedInvertedIndex.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/ParallelSearchExecutor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ParallelSearchExecutor.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/PartialIndexAdvisor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `PartialIndexAdvisor.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/ProximitySearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ProximitySearch.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QuantizedVectorStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QuantizedVectorStore-topk-pins.test.ts`, `QuantizedVectorStore.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryAnalyzer.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryAnalyzer.test.ts`, `QueryCostEstimator.test.ts`, `ReflectionManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryCostEstimator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `EarlyTerminationManager.test.ts`, `QueryCostEstimator.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryLogger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryLogger.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryParser.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryParser.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryPlanCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryPlanCache.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryPlanFormatter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryPlanFormatter.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/QueryPlanner.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `QueryPlanner.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/RankedSearch.ts` | `file-path.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `workflows.test.ts`, `knowledge-graph.test.ts`, `benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `ActiveRetrieval.test.ts`, `AgentCognitionFacade.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LexicalCandidateSelection.test.ts`, `RankedSearch.test.ts`, `RankedSearchGraphBoost.test.ts`, `RankedSearchProjectStarvation.test.ts`, `SQLiteFtsSearchIntegration.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/ReflectionManager.ts` | `file-path.test.ts`, `smart-search.test.ts`, `knowledge-graph.test.ts`, `query-execution-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ReflectionManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SavedSearchManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SavedSearchManager-loader-pins.test.ts`, `SavedSearchManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `jsonlRecordFile.test.ts` |
| `search/SearchFilterChain.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `search-filter-chain-project.test.ts`, `search-filter-chain-versioning.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SearchManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `ManagerContext.test.ts`, `AgentMemoryFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `SearchManager.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SearchSuggestions.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SearchSuggestions.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SemanticSearch.ts` | `file-path.test.ts`, `contradiction-detector-supersede.test.ts`, `knowledge-graph.test.ts`, `GuardedComponentEdit.test.ts`, `MemoryEngine.test.ts`, `MemoryValidator.test.ts`, `KnowledgeGovernanceFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `contradiction-detector-detect.test.ts`, `semantic-forget-semantic.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SpellChecker.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `SpellChecker.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/SymbolicSearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `HybridSearchManager.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `hybridLayers.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/TFIDFEventSync.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `rename-entity.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `IncrementalTFIDF.test.ts`, `SemanticSearch.test.ts`, `TFIDFEventSync.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/TFIDFIndexManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `rename-entity.test.ts`, `sqlite-events.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `IncrementalTFIDF.test.ts`, `SemanticSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIncrementalPersistence.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts` |
| `search/TemporalQueryParser.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `TemporalQueryParser.test.ts`, `TemporalSearch.test.ts`, `enDate.inventory.test.ts`, `enDate.parity.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/TemporalSearch.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `TemporalSearch.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/VectorStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `MemoryEngine.test.ts`, `ManagerContext-vectorStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LSHVectorStore.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `VectorStore-topk-pins.test.ts`, `VectorStore.test.ts`, `searchTwinsSemantic.test.ts` |
| `enDate/components.ts` | `enDate.similarFields.test.ts` |
| `enDate/parseEnDate.ts` | `enDate.challenger.test.ts`, `enDate.parity.test.ts`, `enDate.relativeMerge.test.ts`, `enDate.timePatterns.test.ts` |
| `enDate/types.ts` | `enDate.similarFields.test.ts` |
| `search/ftsCandidates.ts` | `searchTwinsFts.test.ts` |
| `search/hybridLayers.ts` | `hybridLayers.test.ts` |
| `search/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts` |
| `search/inducedSubgraph.ts` | `inducedSubgraph.test.ts` |
| `tiered/BrotliColdTier.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `BrotliColdTier.test.ts`, `disk-tier-concurrency.test.ts` |
| `tiered/DiskWarmTier.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `DiskWarmTier.compaction.test.ts`, `DiskWarmTier.test.ts`, `disk-tier-concurrency.test.ts`, `tiered-review-fixes.test.ts` |
| `tiered/ITieredIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `ITieredIndex.test.ts`, `TieredIndex.test.ts`, `snapshotTierStats.test.ts`, `tiered-review-fixes.test.ts` |
| `tiered/LRUHotTier.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `LRUHotTier.test.ts`, `TieredIndex.test.ts`, `tiered-review-fixes.test.ts` |
| `tiered/TieredIndex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `searchTwinsSemantic.test.ts`, `TieredIndex.test.ts`, `snapshotTierStats.test.ts`, `tiered-review-fixes.test.ts` |
| `security/ABACPolicy.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `ABACPolicy.test.ts`, `PiiRedactor.test.ts` |
| `security/APIKeyStore.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ApiKeyAuthMiddleware.test.ts`, `rest-input-security.test.ts`, `rest-tenancy.test.ts`, `rest-unscoped-warning.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `APIKeyStore.test.ts`, `PiiRedactor.test.ts` |
| `security/PiiRedactor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `PiiRedactor.test.ts` |
| `security/RowLevelFilter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `PiiRedactor.test.ts`, `RowLevelFilter.test.ts` |
| `security/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `PiiRedactor.test.ts` |
| `types/agent-memory.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `AccessTracker.recordBatch.test.ts`, `AccessTracker.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `AgentReflectionManager.test.ts`, `CausalReasoner.test.ts`, `CognitiveLoadAnalyzer.test.ts`, `CollaborativeSynthesis.test.ts`, `ConflictResolver.strategies.test.ts`, `ConflictResolver.test.ts`, `ConnectivitySignals.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ConsolidationPipeline.test.ts`, `ConsolidationScheduler.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.reinforceBatch.test.ts`, `DecayEngine.test.ts`, `DecayScheduler.test.ts`, `DecisionManager.test.ts`, `EntropyFilter.test.ts`, `EpisodicMemoryManager.test.ts`, `FailureDistillation.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `InMemoryBackend.test.ts`, `MemoryFormatter.test.ts`, `MemoryFormatterSalience.test.ts`, `MemoryValidator.test.ts`, `MultiAgentMemoryManager.fieldPreservation.test.ts`, `MultiAgentMemoryManager.test.ts`, `ObservationDedupReportStage.test.ts`, `PlanManager.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `ProspectiveMemoryManager.test.ts`, `ReflectionStage.test.ts`, `RelationConsolidator.test.ts`, `RoleProfiles.test.ts`, `RuleEvaluator.test.ts`, `SalienceEngine-heap-pins.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.test.ts`, `VisibilityResolver.test.ts`, `WorkingMemoryManager.test.ts`, `Bootstrapper.test.ts`, `BoundaryRecorder.test.ts`, `CorpusMapper.test.ts`, `PracticeTaskGenerator.test.ts`, `KnowledgeHardening.test.ts`, `knowledgeLoad.pack.test.ts`, `LeafApply.test.ts`, `LearnedSkillLoadability.test.ts`, `RecursiveLiveK.test.ts`, `RevisionMerger.test.ts`, `workingMemoryGuard.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `ManagerContext.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `profile-entity.test.ts`, `skills.types.test.ts`, `trust-level.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/artifact.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `ArtifactManager.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/event.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/index.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/learning.ts` | `file-path.test.ts`, `recursa-end-to-end.test.ts`, `recursa-leaf-learner.test.ts`, `recursa-loop.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `RecursaToolAdapter.test.ts`, `RecursaToolAdapterSafety.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `CausalReasoner.test.ts`, `Bootstrapper.test.ts`, `DeterministicJudge.hardening.test.ts`, `DeterministicJudge.test.ts`, `Evaluator.hardening.test.ts`, `Evaluator.test.ts`, `LLMRubricJudge.hardening.test.ts`, `LLMRubricJudge.test.ts`, `RubricAudit.hardening.test.ts`, `RubricAudit.test.ts`, `Diagnoser.test.ts`, `DiagnoserBatchDurability.challenger.test.ts`, `KnowledgeEditor.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `LeafLearnerBounds.test.ts`, `LeafLearnerResume.test.ts`, `LeafValidationPlan.test.ts`, `LearnedSkillLoadability.test.ts`, `LearningAccountant.test.ts`, `LearningReflector.test.ts`, `LearningTrace.test.ts`, `RecursiveCriteria.test.ts`, `RecursiveLearner.test.ts`, `RecursivePlanBudget.test.ts`, `RevisionValidator.test.ts`, `SplitStrategies.test.ts`, `loadTasksByIds.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `ManagerContext.bootstrapper.test.ts`, `ManagerContext.learningLoop.recursive.test.ts`, `ManagerContext.learningLoop.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/proceduralGraph.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `procedural-graph-recovery.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.test.ts`, `CausalReasoner.test.ts`, `GuardedComponentEdit.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProceduralGraph.test.ts`, `ProceduralGraphEvolution.test.ts`, `ProceduralGraphManager.test.ts`, `ProceduralGraphRefiner.test.ts`, `ProceduralGraphSchemas.test.ts`, `ProceduralGraphSerializer.test.ts`, `ProceduralGraphSession.test.ts`, `ProceduralGraphValidator.test.ts`, `appendixF.test.ts`, `canonical-compare.test.ts`, `canonical.test.ts`, `hardening.test.ts`, `tokenTail.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `ManagerContext-proceduralGraph.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/procedure.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `ProcedureManager.test.ts`, `ProcedureStore.test.ts`, `ProcedureGraphAdapter.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/progress.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `progress.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/reconstruction.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `MemoryDistiller.test.ts`, `MemoryGraphBridge.test.ts`, `ReconstructiveMemory.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/result.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `result.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/search.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `ProximitySearch.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalQueryParser.lazy.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `search.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/skills.ts` | `file-path.test.ts`, `recursa-leaf-learner.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `ExplorationNotes.test.ts`, `PracticeTaskGenerator.test.ts`, `InstructionSetManager.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeRepository.rollback.test.ts`, `KnowledgeRepository.test.ts`, `knowledgeDigest.test.ts`, `knowledgeLoad.pack.test.ts`, `Diagnoser.test.ts`, `KnowledgeEditor.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `LeafLearnerResume.test.ts`, `RevisionMergeRules.test.ts`, `RevisionMerger.test.ts`, `RevisionValidator.test.ts`, `SkillFormat.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/task-scheduler.ts` | `file-path.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `smart-search.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `ActiveRetrieval.test.ts`, `CausalReasoner.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEvents.test.ts`, `HierarchyManager.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `rename-entity.test.ts`, `GraphStorage-segments.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `ObservationNormalizer.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `agent-memory.test.ts`, `learning.types.test.ts`, `skills.types.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `update-entity-schema-strip.test.ts` |
| `types/types.ts` | `file-path.test.ts`, `mockStorage.test.ts`, `backup-compression.test.ts`, `hybrid-search.test.ts`, `operation-progress.test.ts`, `smart-search.test.ts`, `graph-storage-new-fields.test.ts`, `sqlite-storage-new-fields.test.ts`, `storage-dedup-safety.test.ts`, `streaming-export.test.ts`, `worker-pool-integration.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `foundation-benchmarks.test.ts`, `merge-perf.test.ts`, `mmap-load-benchmark.test.ts`, `parallel-benchmarks.test.ts`, `query-execution-benchmarks.test.ts`, `ranked-search-benchmarks.test.ts`, `search-algorithm-benchmarks.test.ts`, `task-scheduler-benchmarks.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `write-path-benchmarks.test.ts`, `write-performance.test.ts`, `MCPToolObserverAdapter.test.ts`, `rest-tenancy.test.ts`, `AccessTracker.test.ts`, `ActiveRetrieval.test.ts`, `AgentMemoryManager.knowledge.test.ts`, `AgentReflectionManager.test.ts`, `ArtifactManager.test.ts`, `CausalReasoner.test.ts`, `CollaborativeSynthesis.test.ts`, `ConnectivitySignals.test.ts`, `ConsolidationPipeline.mergeDelta.test.ts`, `ConsolidationPipeline.mergeRace.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `ConsolidationPipeline.test.ts`, `ContextProfileManager.test.ts`, `ContextWindowManager.eviction.test.ts`, `ContextWindowManager.knowledge.test.ts`, `ContextWindowManager.test.ts`, `DecayEngine.test.ts`, `DecisionManager.test.ts`, `DistillationPipeline.test.ts`, `DistillationPolicy.test.ts`, `DreamEngine.test.ts`, `EpisodicMemoryManager.test.ts`, `EventManager.candidatesVia.test.ts`, `ExclusionManager.test.ts`, `FailureDistillation.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `InMemoryBackend.test.ts`, `MemoryEngine.test.ts`, `MemoryValidator.test.ts`, `MultiAgentMemoryManager.test.ts`, `ObservationDedupManager.test.ts`, `ObservationDedupReportStage.test.ts`, `PlanManager.test.ts`, `ProjectContextManager.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `ProspectiveMemoryManager.test.ts`, `ReflectionStage.test.ts`, `RelationConsolidator.test.ts`, `SalienceEngine-heap-pins.test.ts`, `SalienceEngine.test.ts`, `SessionCheckpoint.test.ts`, `SessionManager.test.ts`, `SessionQueryBuilder.createdWithin.test.ts`, `SessionQueryBuilder.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `TrajectoryCompressor.test.ts`, `WorkThreadManager.test.ts`, `WorkingMemoryManager.test.ts`, `CorpusMapper.test.ts`, `KnowledgeHardening.test.ts`, `KnowledgeRepository.rollback.test.ts`, `KnowledgeRepository.test.ts`, `LeafAbortDedup.test.ts`, `LeafApply.test.ts`, `LeafLearner.test.ts`, `LeafLearnerBounds.test.ts`, `LeafLearnerResume.test.ts`, `LearningReflector.test.ts`, `LearningTrace.test.ts`, `RecursiveLiveK.test.ts`, `RecursiveWriteBudget.test.ts`, `RevisionValidator.test.ts`, `loadTasksByIds.test.ts`, `privateRecordEntity.test.ts`, `MemoryGraphBridge.test.ts`, `SkillHardening.test.ts`, `SkillManager.test.ts`, `SkillPublisher.test.ts`, `SkillWritePath.test.ts`, `workingMemoryGuard.test.ts`, `formatters.test.ts`, `BatchTransaction.test.ts`, `EntityManager.legacyDelete.test.ts`, `GraphEventEmitter.test.ts`, `GraphEvents.test.ts`, `GraphStorage.test.ts`, `GraphTraversal.bfsDuplicates.test.ts`, `HierarchyManager.test.ts`, `ObservationManager.dedup.test.ts`, `ObservationManager.events.test.ts`, `PostgreSQLStorage.test.ts`, `StorageFactory.test.ts`, `TransactionManager.test.ts`, `bloom-prescreener-wiring.test.ts`, `known-issue-fixes.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `mutation-isolation.test.ts`, `recursa-record-persistence.test.ts`, `rename-entity.test.ts`, `FileSegmentStorage.test.ts`, `GraphStorage-segments.test.ts`, `ISegmentStorage.test.ts`, `segments-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `sqlite-events.test.ts`, `storage-write-ownership.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `storageCapabilities.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `AutoLinker.test.ts`, `CompressionManager.test.ts`, `FreshnessManager.test.ts`, `GovernanceManager.test.ts`, `IOManager.rdf-export.test.ts`, `IOManager.test.ts`, `IOManager.xmlGoldens.test.ts`, `ObservableDataModelAdapter.test.ts`, `ObservationNormalizer.test.ts`, `StreamingExporter-frame-pins.test.ts`, `StreamingExporter.test.ts`, `contradiction-detector-detect.test.ts`, `pii-redaction-export.test.ts`, `BM25SearchReadPath.test.ts`, `EarlyTerminationManager.test.ts`, `EvidencePathBuilder.test.ts`, `FuzzySearch.test.ts`, `FuzzySearchPerformance.test.ts`, `GraphRankPrior.test.ts`, `HybridScorer.test.ts`, `HybridScorerGraphChannel.test.ts`, `HybridSearchExplain.test.ts`, `HybridSearchManager.test.ts`, `HybridSearchManagerGraph.test.ts`, `IncrementalIndexer.queue.test.ts`, `IncrementalIndexer.test.ts`, `IncrementalTFIDF.test.ts`, `LLMQueryPlanner.test.ts`, `LLMSearchExecutor.test.ts`, `LLMSearchExecutorExplain.test.ts`, `LexicalCandidateSelection.test.ts`, `ParallelSearchExecutor.test.ts`, `ProximitySearch.test.ts`, `QueryCostEstimator.test.ts`, `QueryPlanCache.test.ts`, `QueryPlanFormatter.test.ts`, `QueryPlanner.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `ReflectionManager.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `SpellChecker.test.ts`, `SymbolicSearch.test.ts`, `TFIDFEventSync.test.ts`, `TFIDFIndexManager.test.ts`, `TemporalSearch.test.ts`, `cache-isolation.test.ts`, `hybridLayers.test.ts`, `inducedSubgraph.test.ts`, `search-filter-chain-project.test.ts`, `search-filter-chain-versioning.test.ts`, `searchTwinsFts.test.ts`, `searchTwinsLayers.test.ts`, `searchTwinsPaths.test.ts`, `searchTwinsProximity.test.ts`, `searchTwinsSemantic.test.ts`, `searchTwinsTfidf.test.ts`, `RowLevelFilter.test.ts`, `observations-to-columns.test.ts`, `segment-jsonl.test.ts`, `agent-memory.test.ts`, `entity-new-fields.test.ts`, `learning.types.test.ts`, `profile-entity.test.ts`, `skills.types.test.ts`, `EntityValidator.results.test.ts`, `EntityValidator.test.ts`, `SchemaValidator.test.ts`, `compressedCache.test.ts`, `compressedEntityCache-wiring.test.ts`, `entityUtils.test.ts`, `indexes.test.ts`, `relationHelpers.test.ts`, `relationValidation.test.ts`, `update-entity-schema-strip.test.ts`, `validators.bounds.test.ts`, `validators.test.ts` |
| `utils/AsyncMutex.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `EntityManager.legacyDelete.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `AsyncMutex.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/BatchProcessor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `BatchProcessor.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/CachePressureCoordinator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `LazyGetters.freshness-temporal.test.ts`, `SearchFacade.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `CachePressureCoordinator.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/Diagnostics.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/EntityValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `EntityValidator.results.test.ts`, `EntityValidator.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/IIndexHealth.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `IndexHealthMonitor.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/IndexHealthMonitor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `IndexHealthMonitor.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/MemoryMonitor.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `MemoryMonitor.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/RunExclusiveMutex.ts` | `RunExclusiveMutex.challenger.test.ts`, `RunExclusiveMutex.test.ts` |
| `utils/SchemaValidator.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `SchemaValidator.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/WorkerPoolManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `parallel-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `WorkerPoolManager.test.ts`, `WorkerTaskManager.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/WorkerTaskManager.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `WorkerTaskManager.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/boundedTopK.ts` | `boundedTopK.test.ts` |
| `utils/compressedCache.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `v10-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `compressedCache.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `compression/CompressedMap.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `CompressedMap.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `compression/ICompressionAdapter.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `CompressedMap.test.ts`, `ICompressionAdapter.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/compressionUtil.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `IOManager.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `BrotliColdTier.test.ts`, `compressionUtil.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/constants.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `compression-benchmarks.test.ts`, `MemoryEngine.test.ts`, `manager-context-default-embedding.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `IOManager.test.ts`, `BM25SearchReadPath.test.ts`, `EmbeddingService.test.ts`, `RankedSearch.test.ts`, `RankedSearchProjectStarvation.test.ts`, `SearchFilterChain.test.ts`, `compressionUtil.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/durableWriteFile.ts` | `procedural-graph-recovery.test.ts`, `durableWriteFile.test.ts` |
| `utils/entityUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `foundation-benchmarks.test.ts`, `FileSegmentStorage.test.ts`, `ISegmentStorage.test.ts`, `assertValidSegmentId.test.ts`, `segments-review-fixes.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `segment-jsonl.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/envConfig.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `envConfig.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/errorSuggestions.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `errorSuggestions.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/errors.ts` | `file-path.test.ts`, `mockStorage.test.ts`, `operation-progress.test.ts`, `knowledge-graph.test.ts`, `MCPToolObserverAdapter.test.ts`, `rest-tenancy.test.ts`, `AgentMemoryManager.test.ts`, `AgentReflectionManager.test.ts`, `ArtifactManager.test.ts`, `CollaborationAuditEnforcer.test.ts`, `ConsolidationPipeline.promoteBatch.test.ts`, `DecisionManager.test.ts`, `EntropyFilter.test.ts`, `FailureManager.test.ts`, `HeuristicExtractionStage.test.ts`, `HeuristicManager.test.ts`, `ProjectContextManager.test.ts`, `ReflectionStage.test.ts`, `ToolAffordanceManager.test.ts`, `ToolCallObserver.test.ts`, `WorkingMemoryManager.test.ts`, `BootstrapValidation.test.ts`, `ConcurrencyLimiter.test.ts`, `EvictionIndex.test.ts`, `InteractionLog.hardening.test.ts`, `SkillPublisherConfinement.test.ts`, `EntityManager.test.ts`, `HierarchyManager.test.ts`, `ObservationManager.test.ts`, `RefIndex.test.ts`, `RelationManager.test.ts`, `TransactionManager.test.ts`, `entity-manager-profile-namespace.test.ts`, `optimistic-concurrency.test.ts`, `rename-entity.test.ts`, `temporal-versioning.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `CompressionManager.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `errorSuggestions.test.ts`, `errors.test.ts`, `formatters.test.ts`, `operationUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/fieldPath.ts` | `fieldPath.test.ts` |
| `utils/fillDefaults.ts` | `fillDefaults.test.ts` |
| `utils/formatters.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/graphCopy.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `graphCopy.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/halfLife.ts` | `DecayEngine.test.ts`, `halfLife.test.ts` |
| `utils/ids.ts` | `ids.test.ts` |
| `utils/index.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/indexes.ts` | `file-path.test.ts`, `storage-dedup-safety.test.ts`, `knowledge-graph.test.ts`, `storageCache.rebuild.test.ts`, `storageCache.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `indexBuckets.test.ts`, `indexes.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/jsonlMapFile.ts` | `jsonlMapFile.test.ts` |
| `utils/logger.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `rest-input-security.test.ts`, `AgentEnvDefaults.test.ts`, `ContextWindowManager.test.ts`, `ProspectiveMemoryManager.conditional.test.ts`, `jsonl.test.ts`, `SQLiteStorage.autoIndexDeprecation.test.ts`, `ManagerContext.close.test.ts`, `GraphStorage-mmap-wiring.test.ts`, `mmap-review-fixes.test.ts`, `sqlite-append-replace.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `TagManager-loader-pins.test.ts`, `RankedSearch.test.ts`, `SavedSearchManager-loader-pins.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `envConfig.test.ts`, `formatters.test.ts`, `jsonlMapFile.test.ts`, `logger.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/mutateMapWithFlushRollback.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `deleteFromMapWithFlushRollback.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `mutateMapWithFlushRollback.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/nextMonotonicIsoTimestamp.ts` | `nextMonotonicIsoTimestamp.test.ts` |
| `utils/operationUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `operationUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/parallelUtils.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `parallelUtils.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/postingIndex.ts` | `postingIndex.test.ts` |
| `utils/relationHelpers.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `relationHelpers.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts`, `walkParents.test.ts` |
| `utils/relationValidation.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `relationValidation.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/schema.ts` | `schema.challenger.test.ts`, `schema.failures.test.ts`, `schema.parity.test.ts`, `schemas.test.ts` |
| `utils/schemas.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entity-content-hash.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schema.parity.test.ts`, `schemas.test.ts`, `schemas.validateResult.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts`, `update-entity-schema-strip.test.ts` |
| `utils/searchAlgorithms.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FuzzySearchPerformance.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts`, `levenshteinWorker.test.ts` |
| `utils/searchCache.ts` | `file-path.test.ts`, `storage-dedup-safety.test.ts`, `knowledge-graph.test.ts`, `write-path-delta.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `FuzzySearchPerformance.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `cache-isolation.test.ts`, `pruneExpiredEntries.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `searchCache.test.ts`, `searchCacheForEach.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/sidecarPath.ts` | `InteractionLog.hardening.test.ts`, `StorageInfraFacade.test.ts`, `sidecarPath.test.ts` |
| `utils/taskScheduler.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `task-scheduler-config-benchmarks.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `WorkerTaskManager.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `taskScheduler.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/textSimilarity.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `embedding-benchmarks.test.ts`, `MemoryEngine.test.ts`, `ManagerContext-vectorStore.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `LSHVectorStore.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `SemanticSearch.resolver.test.ts`, `SemanticSearch.test.ts`, `TemporalQueryParser.lazy.test.ts`, `VectorStore-topk-pins.test.ts`, `VectorStore.test.ts`, `searchTwinsSemantic.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/threadPool.ts` | `threadPool.challenger.test.ts`, `threadPool.parity.test.ts`, `threadPool.test.ts` |
| `utils/timing.ts` | `timing.test.ts` |
| `utils/tokenEstimate.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `ContextWindowManager.knowledge.test.ts`, `knowledgeContext.sections.test.ts`, `SkillManager.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts` |
| `utils/unrefInterval.ts` | `unrefInterval.test.ts` |
| `utils/validation.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts`, `validation.assertNonEmptyString.test.ts` |
| `utils/validators.ts` | `file-path.test.ts`, `knowledge-graph.test.ts`, `exports-barrels.recursa.test.ts`, `exports-barrels.test.ts`, `RankedSearch.test.ts`, `SearchFilterChain.test.ts`, `EntityValidator.results.test.ts`, `EntityValidator.test.ts`, `entityUtils.test.ts`, `formatters.test.ts`, `schemas.test.ts`, `searchAlgorithms.test.ts`, `textSimilarity.tokenSets.test.ts`, `tokenEstimate.test.ts`, `validators.bounds.test.ts`, `validators.test.ts` |
| `workers/levenshteinWorker.ts` | `FuzzySearchPerformance.test.ts`, `levenshteinWorker.test.ts` |

---

## Test File Details

| Test File | Imports from Source |
|-----------|---------------------|
| `edge-cases/edge-cases.test.ts` | 3 files |
| `examples/examples.test.ts` | 0 files |
| `tests/file-path.test.ts` | 300 files |
| `__tests__/mockStorage.test.ts` | 2 files |
| `integration/MemoryEngineStorage.test.ts` | 4 files |
| `agent/access-tracking.test.ts` | 3 files |
| `agent/agent-memory-manager-profile.test.ts` | 3 files |
| `agent/recursa-end-to-end.test.ts` | 10 files |
| `agent/recursa-leaf-learner.test.ts` | 16 files |
| `agent/recursa-loop.test.ts` | 10 files |
| `integration/backup-compression.test.ts` | 17 files |
| `integration/compression-optimization.test.ts` | 2 files |
| `core/manager-context-semantic-forget.test.ts` | 3 files |
| `core/observation-manager-contradiction.test.ts` | 4 files |
| `features/contradiction-detector-supersede.test.ts` | 5 files |
| `features/governance-enforcement.test.ts` | 5 files |
| `integration/hybrid-search.test.ts` | 17 files |
| `integration/operation-progress.test.ts` | 10 files |
| `integration/procedural-graph-guidance.test.ts` | 2 files |
| `integration/procedural-graph-iomanager-roundtrip.test.ts` | 3 files |
| `integration/procedural-graph-recovery.test.ts` | 7 files |
| `search/project-scope-isolation.test.ts` | 3 files |
| `integration/smart-search.test.ts` | 20 files |
| `storage/graph-storage-new-fields.test.ts` | 2 files |
| `storage/sqlite-storage-new-fields.test.ts` | 2 files |
| `integration/storage-dedup-safety.test.ts` | 8 files |
| `integration/streaming-export.test.ts` | 4 files |
| `integration/transaction-isolation.test.ts` | 5 files |
| `integration/worker-pool-integration.test.ts` | 16 files |
| `integration/workflows.test.ts` | 8 files |
| `tests/knowledge-graph.test.ts` | 300 files |
| `performance/benchmarks.test.ts` | 8 files |
| `performance/compression-benchmarks.test.ts` | 19 files |
| `performance/embedding-benchmarks.test.ts` | 5 files |
| `performance/foundation-benchmarks.test.ts` | 19 files |
| `performance/memory-engine-perf.test.ts` | 3 files |
| `performance/merge-perf.test.ts` | 16 files |
| `performance/mmap-load-benchmark.test.ts` | 15 files |
| `performance/optimization-benchmarks.test.ts` | 3 files |
| `performance/parallel-benchmarks.test.ts` | 17 files |
| `performance/query-execution-benchmarks.test.ts` | 19 files |
| `performance/ranked-search-benchmarks.test.ts` | 16 files |
| `performance/search-algorithm-benchmarks.test.ts` | 19 files |
| `performance/task-scheduler-benchmarks.test.ts` | 7 files |
| `performance/task-scheduler-config-benchmarks.test.ts` | 5 files |
| `performance/v10-benchmarks.test.ts` | 32 files |
| `performance/write-path-benchmarks.test.ts` | 17 files |
| `performance/write-performance.test.ts` | 17 files |
| `adapters/ApiKeyAuthMiddleware.test.ts` | 6 files |
| `adapters/LangChainMemoryAdapter.test.ts` | 4 files |
| `adapters/MCPToolObserverAdapter.test.ts` | 6 files |
| `adapters/RateLimiter.bounds.test.ts` | 1 files |
| `adapters/RateLimiter.test.ts` | 1 files |
| `adapters/RecursaToolAdapter.test.ts` | 8 files |
| `adapters/RecursaToolAdapterSafety.test.ts` | 12 files |
| `adapters/RestRouter.test.ts` | 4 files |
| `adapters/pagination.test.ts` | 1 files |
| `adapters/rest-input-security.test.ts` | 7 files |
| `adapters/rest-tenancy.test.ts` | 9 files |
| `adapters/rest-unscoped-warning.test.ts` | 6 files |
| `agent/AccessTracker.recordBatch.test.ts` | 2 files |
| `agent/AccessTracker.test.ts` | 4 files |
| `agent/ActiveRetrieval.test.ts` | 18 files |
| `agent/AgentEnvDefaults.test.ts` | 6 files |
| `agent/AgentMemoryManager.collaborativeSynthesis.test.ts` | 4 files |
| `agent/AgentMemoryManager.knowledge.test.ts` | 3 files |
| `agent/AgentMemoryManager.test.ts` | 153 files |
| `agent/AgentReflectionManager.test.ts` | 5 files |
| `agent/ArtifactManager.test.ts` | 10 files |
| `agent/CausalReasoner.test.ts` | 16 files |
| `agent/CognitiveLoadAnalyzer.test.ts` | 2 files |
| `agent/CollaborationAuditEnforcer.test.ts` | 5 files |
| `agent/CollaborativeSynthesis.test.ts` | 5 files |
| `agent/ConflictResolver.strategies.test.ts` | 2 files |
| `agent/ConflictResolver.test.ts` | 2 files |
| `agent/ConnectivitySignals.test.ts` | 10 files |
| `agent/ConsolidationPipeline.mergeDelta.test.ts` | 8 files |
| `agent/ConsolidationPipeline.mergeRace.test.ts` | 9 files |
| `agent/ConsolidationPipeline.promoteBatch.test.ts` | 7 files |
| `agent/ConsolidationPipeline.test.ts` | 6 files |
| `agent/ConsolidationScheduler.test.ts` | 4 files |
| `agent/ContextProfileManager.test.ts` | 7 files |
| `agent/ContextWindowManager.eviction.test.ts` | 7 files |
| `agent/ContextWindowManager.knowledge.test.ts` | 8 files |
| `agent/ContextWindowManager.test.ts` | 9 files |
| `agent/DecayEngine.reinforceBatch.test.ts` | 3 files |
| `agent/DecayEngine.test.ts` | 6 files |
| `agent/DecayScheduler.test.ts` | 3 files |
| `agent/DecisionManager.test.ts` | 5 files |
| `agent/DistillationPipeline.test.ts` | 3 files |
| `agent/DistillationPolicy.test.ts` | 3 files |
| `agent/DreamEngine.test.ts` | 3 files |
| `agent/EntropyFilter.test.ts` | 4 files |
| `agent/EpisodicMemoryManager.test.ts` | 3 files |
| `agent/EventManager.candidatesVia.test.ts` | 4 files |
| `agent/EventManager.test.ts` | 6 files |
| `agent/ExclusionManager.test.ts` | 3 files |
| `agent/ExperienceExtractor.test.ts` | 2 files |
| `agent/FailureDistillation.test.ts` | 3 files |
| `agent/FailureManager.test.ts` | 5 files |
| `agent/GuardedComponentEdit.test.ts` | 10 files |
| `agent/HeuristicExtractionStage.test.ts` | 6 files |
| `agent/HeuristicManager.test.ts` | 4 files |
| `agent/IMemoryBackend.contract.test.ts` | 1 files |
| `agent/ImportanceScorer.test.ts` | 1 files |
| `agent/InMemoryBackend.test.ts` | 5 files |
| `agent/MemoryEngine.test.ts` | 12 files |
| `agent/MemoryFormatter.test.ts` | 2 files |
| `agent/MemoryFormatterSalience.test.ts` | 2 files |
| `agent/MemoryValidator.test.ts` | 6 files |
| `agent/MultiAgentMemoryManager.fieldPreservation.test.ts` | 2 files |
| `agent/MultiAgentMemoryManager.test.ts` | 3 files |
| `agent/ObservationDedupManager.test.ts` | 2 files |
| `agent/ObservationDedupReportStage.test.ts` | 4 files |
| `agent/ObserverPipeline.test.ts` | 3 files |
| `agent/PatternDetector.test.ts` | 1 files |
| `agent/PlanManager.test.ts` | 3 files |
| `agent/ProcedureManager.test.ts` | 29 files |
| `agent/ProcedureStore.test.ts` | 29 files |
| `agent/ProjectContextManager.dedupByKey.test.ts` | 1 files |
| `agent/ProjectContextManager.test.ts` | 4 files |
| `agent/ProspectiveMemoryManager.conditional.test.ts` | 7 files |
| `agent/ProspectiveMemoryManager.test.ts` | 3 files |
| `agent/ReflectionStage.test.ts` | 9 files |
| `agent/RelationConsolidator.test.ts` | 10 files |
| `agent/RoleProfiles.test.ts` | 2 files |
| `agent/RuleEvaluator.test.ts` | 2 files |
| `agent/SQLiteBackend.test.ts` | 4 files |
| `agent/SalienceEngine-heap-pins.test.ts` | 5 files |
| `agent/SalienceEngine.test.ts` | 5 files |
| `agent/SessionCheckpoint.test.ts` | 9 files |
| `agent/SessionManager.test.ts` | 5 files |
| `agent/SessionQueryBuilder.createdWithin.test.ts` | 3 files |
| `agent/SessionQueryBuilder.test.ts` | 5 files |
| `agent/SummarizationService.test.ts` | 1 files |
| `agent/ToolAffordanceManager.test.ts` | 4 files |
| `agent/ToolCallObserver.interactionLog.test.ts` | 4 files |
| `agent/ToolCallObserver.test.ts` | 5 files |
| `agent/TrajectoryCompressor.test.ts` | 3 files |
| `agent/VisibilityResolver.test.ts` | 2 files |
| `agent/WorkThreadManager.test.ts` | 5 files |
| `agent/WorkingMemoryManager.test.ts` | 5 files |
| `agent/WorldModel.test.ts` | 5 files |
| `agent/agent-memory-manager-diary.test.ts` | 3 files |
| `bootstrap/BootstrapValidation.test.ts` | 3 files |
| `bootstrap/Bootstrapper.test.ts` | 6 files |
| `bootstrap/BoundaryRecorder.test.ts` | 2 files |
| `bootstrap/CorpusMapper.test.ts` | 4 files |
| `bootstrap/ExplorationNotes.test.ts` | 4 files |
| `bootstrap/PracticeTaskGenerator.test.ts` | 3 files |
| `agent/context-window-manager-compress.test.ts` | 3 files |
| `agent/context-window-manager-wakeup.test.ts` | 3 files |
| `agent/delta-services-wiring.test.ts` | 6 files |
| `evaluation/DeterministicJudge.hardening.test.ts` | 2 files |
| `evaluation/DeterministicJudge.test.ts` | 2 files |
| `evaluation/Evaluator.hardening.test.ts` | 3 files |
| `evaluation/Evaluator.test.ts` | 3 files |
| `evaluation/LLMRubricJudge.hardening.test.ts` | 3 files |
| `evaluation/LLMRubricJudge.test.ts` | 4 files |
| `evaluation/RubricAudit.hardening.test.ts` | 2 files |
| `evaluation/RubricAudit.test.ts` | 2 files |
| `harness/ConcurrencyLimiter.test.ts` | 2 files |
| `harness/EvictionIndex.test.ts` | 2 files |
| `harness/InteractionLog.hardening.test.ts` | 5 files |
| `harness/InteractionLog.test.ts` | 3 files |
| `agent/keyValueLine.test.ts` | 1 files |
| `knowledge/InstructionSetManager.test.ts` | 2 files |
| `knowledge/KnowledgeHardening.test.ts` | 8 files |
| `knowledge/KnowledgeRepository.rollback.test.ts` | 5 files |
| `knowledge/KnowledgeRepository.test.ts` | 5 files |
| `knowledge/knowledgeDigest.test.ts` | 2 files |
| `knowledge/knowledgeLoad.pack.test.ts` | 6 files |
| `agent/knowledgeContext.sections.test.ts` | 5 files |
| `learning/Diagnoser.test.ts` | 11 files |
| `learning/DiagnoserBatchDurability.challenger.test.ts` | 7 files |
| `learning/InProcessLearnHandler.concurrency.test.ts` | 2 files |
| `learning/KnowledgeEditor.test.ts` | 8 files |
| `learning/LeafAbortDedup.test.ts` | 12 files |
| `learning/LeafApply.test.ts` | 8 files |
| `learning/LeafLearner.test.ts` | 8 files |
| `learning/LeafLearnerBounds.test.ts` | 6 files |
| `learning/LeafLearnerResume.test.ts` | 5 files |
| `learning/LeafValidationPlan.test.ts` | 8 files |
| `learning/LearnedSkillLoadability.test.ts` | 5 files |
| `learning/LearningAccountant.test.ts` | 2 files |
| `learning/LearningReflector.test.ts` | 7 files |
| `learning/LearningTrace.test.ts` | 8 files |
| `learning/RecursiveCriteria.test.ts` | 3 files |
| `learning/RecursiveLearner.test.ts` | 5 files |
| `learning/RecursiveLiveK.test.ts` | 5 files |
| `learning/RecursivePlanBudget.test.ts` | 3 files |
| `learning/RecursiveWriteBudget.test.ts` | 5 files |
| `learning/RevisionMergeRules.test.ts` | 5 files |
| `learning/RevisionMerger.test.ts` | 6 files |
| `learning/RevisionValidator.test.ts` | 4 files |
| `learning/SplitStrategies.test.ts` | 2 files |
| `learning/llmJson.raceAbort.test.ts` | 1 files |
| `learning/loadTasksByIds.test.ts` | 8 files |
| `agent/memoryBackend-wiring.test.ts` | 5 files |
| `agent/privateRecordEntity.test.ts` | 4 files |
| `graph/CompletionProvider.test.ts` | 2 files |
| `graph/ProceduralGraph.test.ts` | 3 files |
| `graph/ProceduralGraphEvolution.test.ts` | 8 files |
| `graph/ProceduralGraphManager.test.ts` | 4 files |
| `graph/ProceduralGraphRefiner.test.ts` | 2 files |
| `graph/ProceduralGraphSchemas.test.ts` | 3 files |
| `graph/ProceduralGraphSerializer.test.ts` | 4 files |
| `graph/ProceduralGraphSession.test.ts` | 5 files |
| `graph/ProceduralGraphValidator.test.ts` | 4 files |
| `graph/ProcedureGraphAdapter.test.ts` | 3 files |
| `graph/appendixF.test.ts` | 3 files |
| `backing/jsonl.test.ts` | 2 files |
| `backing/memory.test.ts` | 2 files |
| `backing/sqlite.test.ts` | 2 files |
| `graph/canonical-compare.test.ts` | 2 files |
| `graph/canonical.test.ts` | 2 files |
| `graph/hardening.test.ts` | 16 files |
| `graph/prompts.test.ts` | 1 files |
| `graph/tokenTail.test.ts` | 2 files |
| `agent/profile-manager-basics.test.ts` | 4 files |
| `agent/profile-manager-extraction.test.ts` | 6 files |
| `agent/rbac.test.ts` | 5 files |
| `reconstruction/CueTagContentGraph.test.ts` | 1 files |
| `reconstruction/MemoryDistiller.test.ts` | 3 files |
| `reconstruction/MemoryGraphBridge.test.ts` | 7 files |
| `reconstruction/MemoryToolkit.test.ts` | 2 files |
| `reconstruction/ReconstructiveMemory.test.ts` | 4 files |
| `agent/recordQuery.test.ts` | 1 files |
| `agent/selectWeightedTurns.test.ts` | 2 files |
| `skills/SkillFormat.test.ts` | 2 files |
| `skills/SkillHardening.test.ts` | 4 files |
| `skills/SkillIOConfinement.test.ts` | 4 files |
| `skills/SkillManager.test.ts` | 3 files |
| `skills/SkillPublisher.test.ts` | 4 files |
| `skills/SkillPublisherConfinement.test.ts` | 4 files |
| `skills/SkillWritePath.test.ts` | 7 files |
| `agent/workingMemoryGuard.test.ts` | 3 files |
| `cli/actionFrame.test.ts` | 4 files |
| `cli/ansi.test.ts` | 1 files |
| `cli/audit.test.ts` | 3 files |
| `cli/cache-reindex.test.ts` | 6 files |
| `cli/check.test.ts` | 5 files |
| `cli/commands.test.ts` | 2 files |
| `cli/config.test.ts` | 1 files |
| `cli/decision.test.ts` | 1 files |
| `cli/diag.test.ts` | 5 files |
| `cli/doctor.test.ts` | 2 files |
| `cli/emitJson.test.ts` | 2 files |
| `cli/exclusion.test.ts` | 4 files |
| `cli/formatters.test.ts` | 2 files |
| `cli/graph.test.ts` | 4 files |
| `cli/heuristic.test.ts` | 1 files |
| `cli/hierarchy.test.ts` | 4 files |
| `cli/index.test.ts` | 3 files |
| `cli/inspect.test.ts` | 5 files |
| `cli/interactive.test.ts` | 1 files |
| `cli/maintenance-cli.test.ts` | 4 files |
| `cli/observation.test.ts` | 4 files |
| `cli/observationDedup.test.ts` | 4 files |
| `cli/options.test.ts` | 1 files |
| `cli/parseArgsPinned.test.ts` | 2 files |
| `cli/parseArgsSurfacePinned.test.ts` | 1 files |
| `cli/plainTable.challenger.test.ts` | 1 files |
| `cli/plainTable.test.ts` | 1 files |
| `cli/projectContext.test.ts` | 1 files |
| `cli/recorderDoc.test.ts` | 0 files |
| `cli/search-extended.test.ts` | 4 files |
| `cli/smoke.test.ts` | 2 files |
| `cli/spell.test.ts` | 4 files |
| `cli/tag.test.ts` | 4 files |
| `cli/toolAffordance.test.ts` | 4 files |
| `core/BatchTransaction.test.ts` | 3 files |
| `core/ConcurrencyControl.test.ts` | 4 files |
| `core/EntityManager.legacyDelete.test.ts` | 17 files |
| `core/EntityManager.test.ts` | 5 files |
| `core/EntityStateMachine.test.ts` | 1 files |
| `core/GraphEventEmitter.observation.test.ts` | 1 files |
| `core/GraphEventEmitter.test.ts` | 3 files |
| `core/GraphEvents.test.ts` | 16 files |
| `core/GraphStorage.test.ts` | 2 files |
| `core/GraphTraversal.bfsDuplicates.test.ts` | 2 files |
| `core/GraphTraversal.test.ts` | 2 files |
| `core/GraphTraversalLookFor.test.ts` | 2 files |
| `core/HierarchyManager.test.ts` | 18 files |
| `core/ManagerContext-hybridContext.test.ts` | 4 files |
| `core/ManagerContext-proceduralGraph.test.ts` | 5 files |
| `core/ManagerContext-vectorStore.test.ts` | 5 files |
| `core/ManagerContext.agentEnvDefaults.test.ts` | 4 files |
| `core/ManagerContext.bootstrapper.test.ts` | 9 files |
| `core/ManagerContext.learningLoop.facade.test.ts` | 8 files |
| `core/ManagerContext.learningLoop.recursive.test.ts` | 12 files |
| `core/ManagerContext.learningLoop.test.ts` | 11 files |
| `core/ManagerContext.recursa-wiring.test.ts` | 3 files |
| `core/ManagerContext.test.ts` | 32 files |
| `core/ObservationManager.dedup.test.ts` | 3 files |
| `core/ObservationManager.events.test.ts` | 6 files |
| `core/ObservationManager.test.ts` | 3 files |
| `core/ObservationStore.test.ts` | 1 files |
| `core/PostgreSQLStorage.test.ts` | 15 files |
| `core/RefIndex.test.ts` | 4 files |
| `core/RelationManager-metadata.test.ts` | 4 files |
| `core/RelationManager.test.ts` | 4 files |
| `core/SQLiteStorage.autoIndexDeprecation.test.ts` | 3 files |
| `core/SQLiteStorage.test.ts` | 2 files |
| `core/StorageFactory.test.ts` | 17 files |
| `core/TransactionBatching.test.ts` | 2 files |
| `core/TransactionManager.test.ts` | 4 files |
| `core/TransitionLedger.test.ts` | 2 files |
| `core/bloom-prescreener-wiring.test.ts` | 4 files |
| `columns/IColumnStore.test.ts` | 1 files |
| `columns/JsonlColumnStore.test.ts` | 2 files |
| `columns/ObservationColumnStore-wiring.test.ts` | 6 files |
| `columns/columns-review-fixes.test.ts` | 5 files |
| `columns/shadow-write-drain.test.ts` | 3 files |
| `context/AgentBookkeepingFacade.test.ts` | 5 files |
| `context/AgentCognitionFacade.test.ts` | 8 files |
| `context/AgentMemoryFacade.test.ts` | 12 files |
| `context/KnowledgeGovernanceFacade.test.ts` | 6 files |
| `context/LazyGetters.freshness-temporal.test.ts` | 14 files |
| `context/ManagerContext.close.test.ts` | 4 files |
| `context/ManagerContext.newMembers.test.ts` | 5 files |
| `context/SearchFacade.test.ts` | 9 files |
| `context/StorageInfraFacade.test.ts` | 5 files |
| `core/entity-id.test.ts` | 4 files |
| `core/entity-manager-list-projects.test.ts` | 3 files |
| `core/entity-manager-profile-namespace.test.ts` | 4 files |
| `core/entity-manager-project-stamping.test.ts` | 3 files |
| `core/entity-manager-version-chain.test.ts` | 3 files |
| `core/known-issue-fixes.test.ts` | 18 files |
| `core/manager-context-default-embedding.test.ts` | 1 files |
| `core/manager-context-env-number.test.ts` | 3 files |
| `core/manager-context-new-managers.test.ts` | 7 files |
| `core/manager-context-project.test.ts` | 3 files |
| `mmap/FsReadMmapBackend.test.ts` | 2 files |
| `mmap/GraphStorage-mmap-wiring.test.ts` | 17 files |
| `mmap/IMmapBackend.test.ts` | 1 files |
| `mmap/mmap-review-fixes.test.ts` | 4 files |
| `core/mutation-isolation.test.ts` | 4 files |
| `core/node-sqlite-adapter-edge-parity.test.ts` | 1 files |
| `core/node-sqlite-probe.test.ts` | 0 files |
| `core/nodeSqliteAdapter.test.ts` | 1 files |
| `core/observation-validate-hook.test.ts` | 3 files |
| `core/optimistic-concurrency.test.ts` | 3 files |
| `core/rebuild-native.test.ts` | 0 files |
| `core/recursa-record-persistence.test.ts` | 4 files |
| `core/relation-manager-temporal.test.ts` | 3 files |
| `core/rename-entity.test.ts` | 22 files |
| `segments/FileSegmentStorage.test.ts` | 4 files |
| `segments/GraphStorage-segments.test.ts` | 16 files |
| `segments/ISegmentStorage.test.ts` | 3 files |
| `segments/assertValidSegmentId.test.ts` | 3 files |
| `segments/segments-review-fixes.test.ts` | 18 files |
| `core/sqlite-append-replace.test.ts` | 17 files |
| `core/sqlite-content-hash-migration.test.ts` | 1 files |
| `core/sqlite-driver-inventory.test.ts` | 0 files |
| `core/sqlite-driver-parity.test.ts` | 1 files |
| `core/sqlite-driver-resolver.test.ts` | 1 files |
| `core/sqlite-embeddings-content-hash.test.ts` | 1 files |
| `core/sqlite-events.test.ts` | 14 files |
| `core/sqlite-fts5-error.test.ts` | 2 files |
| `core/sqlite-lazy-load.test.ts` | 0 files |
| `core/sqlite-on-disk-compat.test.ts` | 2 files |
| `core/storage-write-ownership.test.ts` | 19 files |
| `core/storageCache.rebuild.test.ts` | 16 files |
| `core/storageCache.test.ts` | 16 files |
| `core/storageCapabilities.test.ts` | 17 files |
| `core/temporal-versioning.test.ts` | 4 files |
| `core/write-path-delta.test.ts` | 8 files |
| `unit/exports-barrels.recursa.test.ts` | 300 files |
| `unit/exports-barrels.test.ts` | 300 files |
| `features/AnalyticsManager.test.ts` | 2 files |
| `features/ArchiveManager.test.ts` | 2 files |
| `features/AuditLog.test.ts` | 1 files |
| `features/AutoLinker.test.ts` | 18 files |
| `features/BackupManager.test.ts` | 4 files |
| `features/CompressionManager.test.ts` | 6 files |
| `features/FactExtractor.test.ts` | 3 files |
| `features/FreshnessManager.test.ts` | 3 files |
| `features/GovernanceManager-delta.test.ts` | 3 files |
| `features/GovernanceManager-fresh-storage.test.ts` | 4 files |
| `features/GovernanceManager.test.ts` | 20 files |
| `features/IOManager.graphmlDataValue.test.ts` | 2 files |
| `features/IOManager.rdf-export.test.ts` | 17 files |
| `features/IOManager.test.ts` | 19 files |
| `features/IOManager.xmlGoldens.test.ts` | 4 files |
| `features/ObservableDataModelAdapter.test.ts` | 3 files |
| `features/ObservationNormalizer.test.ts` | 16 files |
| `features/StreamingExporter-frame-pins.test.ts` | 2 files |
| `features/StreamingExporter.test.ts` | 2 files |
| `features/TagManager-loader-pins.test.ts` | 2 files |
| `features/TagManager.test.ts` | 1 files |
| `features/compression-manager-priority-dedup.test.ts` | 3 files |
| `features/compression-manager-versioning-guard.test.ts` | 3 files |
| `features/contradiction-detector-detect.test.ts` | 3 files |
| `features/ingest-provenance-modes.test.ts` | 6 files |
| `features/io-manager-ingest.test.ts` | 3 files |
| `features/io-manager-split.test.ts` | 3 files |
| `features/io-manager-visualize.test.ts` | 3 files |
| `features/pii-redaction-export.test.ts` | 20 files |
| `features/semantic-forget-exact.test.ts` | 4 files |
| `features/semantic-forget-semantic.test.ts` | 5 files |
| `lint-rules/lint-rules.test.ts` | 0 files |
| `performance/baselineHelper.test.ts` | 0 files |
| `scripts/clean-dist.edges.test.ts` | 0 files |
| `scripts/clean-dist.test.ts` | 0 files |
| `scripts/publish-version-guard.test.ts` | 0 files |
| `search/BM25Search.test.ts` | 3 files |
| `search/BM25SearchReadPath.test.ts` | 19 files |
| `search/BasicSearch.test.ts` | 4 files |
| `search/BloomFilter.test.ts` | 3 files |
| `search/BooleanSearch.test.ts` | 4 files |
| `search/EarlyTerminationManager.test.ts` | 16 files |
| `search/EmbeddingCache.test.ts` | 1 files |
| `search/EmbeddingService.test.ts` | 2 files |
| `search/EvidencePathBuilder.test.ts` | 15 files |
| `search/FuzzySearch.test.ts` | 19 files |
| `search/FuzzySearchPerformance.test.ts` | 21 files |
| `search/FuzzySearchWorkerPath.test.ts` | 1 files |
| `search/GraphRankPrior.test.ts` | 18 files |
| `search/HybridScorer.test.ts` | 15 files |
| `search/HybridScorerGraphChannel.test.ts` | 15 files |
| `search/HybridSearchExplain.test.ts` | 16 files |
| `search/HybridSearchManager.test.ts` | 16 files |
| `search/HybridSearchManagerGraph.test.ts` | 16 files |
| `search/IncrementalIndexer.queue.test.ts` | 15 files |
| `search/IncrementalIndexer.test.ts` | 15 files |
| `search/IncrementalTFIDF.test.ts` | 4 files |
| `search/LLMQueryPlanner.test.ts` | 16 files |
| `search/LLMSearchExecutor.test.ts` | 16 files |
| `search/LLMSearchExecutorExplain.test.ts` | 16 files |
| `search/LSHVectorStore.test.ts` | 3 files |
| `search/LexicalCandidateSelection.test.ts` | 17 files |
| `search/LlamaCppEmbeddingService.test.ts` | 1 files |
| `search/MaterializedViews.test.ts` | 3 files |
| `search/NGramFuzzyIntegration.test.ts` | 5 files |
| `search/NGramIndex.test.ts` | 1 files |
| `search/OptimizedInvertedIndex.test.ts` | 1 files |
| `search/ParallelSearchExecutor.test.ts` | 15 files |
| `search/PartialIndexAdvisor.test.ts` | 2 files |
| `search/ProximitySearch.test.ts` | 3 files |
| `search/QuantizedVectorStore-topk-pins.test.ts` | 1 files |
| `search/QuantizedVectorStore.test.ts` | 1 files |
| `search/QueryAnalyzer.test.ts` | 1 files |
| `search/QueryCostEstimator.test.ts` | 16 files |
| `search/QueryLogger.test.ts` | 1 files |
| `search/QueryParser.test.ts` | 1 files |
| `search/QueryPlanCache.test.ts` | 15 files |
| `search/QueryPlanFormatter.test.ts` | 15 files |
| `search/QueryPlanner.test.ts` | 15 files |
| `search/RankedSearch.test.ts` | 55 files |
| `search/RankedSearchGraphBoost.test.ts` | 6 files |
| `search/RankedSearchProjectStarvation.test.ts` | 18 files |
| `search/ReflectionManager.test.ts` | 16 files |
| `search/SQLiteFtsSearchIntegration.test.ts` | 4 files |
| `search/SavedSearchManager-loader-pins.test.ts` | 3 files |
| `search/SavedSearchManager.test.ts` | 3 files |
| `search/SearchFilterChain.test.ts` | 53 files |
| `search/SearchManager.test.ts` | 2 files |
| `search/SearchSuggestions.test.ts` | 2 files |
| `search/SemanticSearch.resolver.test.ts` | 18 files |
| `search/SemanticSearch.test.ts` | 67 files |
| `search/SpellChecker.test.ts` | 2 files |
| `search/SymbolicSearch.test.ts` | 15 files |
| `search/TFIDFEventSync.test.ts` | 18 files |
| `search/TFIDFIncrementalPersistence.test.ts` | 1 files |
| `search/TFIDFIndexManager.test.ts` | 15 files |
| `search/TemporalQueryParser.lazy.test.ts` | 53 files |
| `search/TemporalQueryParser.test.ts` | 1 files |
| `search/TemporalSearch.test.ts` | 16 files |
| `search/VectorStore-topk-pins.test.ts` | 2 files |
| `search/VectorStore.test.ts` | 3 files |
| `search/cache-isolation.test.ts` | 5 files |
| `search/enDate.challenger.test.ts` | 1 files |
| `search/enDate.inventory.test.ts` | 1 files |
| `search/enDate.parity.test.ts` | 2 files |
| `search/enDate.relativeMerge.test.ts` | 1 files |
| `search/enDate.similarFields.test.ts` | 2 files |
| `search/enDate.timePatterns.test.ts` | 1 files |
| `search/hybridLayers.test.ts` | 16 files |
| `search/inducedSubgraph.test.ts` | 16 files |
| `search/pruneExpiredEntries.test.ts` | 1 files |
| `search/search-filter-chain-project.test.ts` | 2 files |
| `search/search-filter-chain-versioning.test.ts` | 2 files |
| `search/searchTwinsFts.test.ts` | 19 files |
| `search/searchTwinsLayers.test.ts` | 16 files |
| `search/searchTwinsPaths.test.ts` | 17 files |
| `search/searchTwinsProximity.test.ts` | 15 files |
| `search/searchTwinsSemantic.test.ts` | 66 files |
| `search/searchTwinsTfidf.test.ts` | 15 files |
| `tiered/BrotliColdTier.test.ts` | 2 files |
| `tiered/DiskWarmTier.compaction.test.ts` | 1 files |
| `tiered/DiskWarmTier.test.ts` | 1 files |
| `tiered/ITieredIndex.test.ts` | 1 files |
| `tiered/LRUHotTier.test.ts` | 1 files |
| `tiered/TieredIndex-wiring.test.ts` | 3 files |
| `tiered/TieredIndex.test.ts` | 3 files |
| `tiered/disk-tier-concurrency.test.ts` | 2 files |
| `tiered/snapshotTierStats.test.ts` | 2 files |
| `tiered/tiered-review-fixes.test.ts` | 4 files |
| `security/ABACPolicy.test.ts` | 1 files |
| `security/APIKeyStore.test.ts` | 1 files |
| `security/PiiRedactor.test.ts` | 5 files |
| `security/RowLevelFilter.test.ts` | 2 files |
| `tools/observations-to-columns.test.ts` | 1 files |
| `tools/plan-doc-audit.test.ts` | 0 files |
| `tools/segment-jsonl.test.ts` | 3 files |
| `unit/tools-migrate-rebuild-native.test.ts` | 0 files |
| `types/agent-memory.test.ts` | 14 files |
| `types/entity-content-hash.test.ts` | 1 files |
| `types/entity-new-fields.test.ts` | 1 files |
| `types/learning.types.test.ts` | 14 files |
| `types/profile-entity.test.ts` | 2 files |
| `types/progress.test.ts` | 1 files |
| `types/result.test.ts` | 1 files |
| `types/search.test.ts` | 1 files |
| `types/skills.types.test.ts` | 14 files |
| `types/trust-level.test.ts` | 1 files |
| `utils/AsyncMutex.test.ts` | 1 files |
| `utils/BatchProcessor.test.ts` | 1 files |
| `utils/CachePressureCoordinator.test.ts` | 1 files |
| `utils/Diagnostics.observationDedup.test.ts` | 3 files |
| `utils/EntityValidator.results.test.ts` | 3 files |
| `utils/EntityValidator.test.ts` | 3 files |
| `utils/IndexHealthMonitor.test.ts` | 2 files |
| `utils/MemoryMonitor.test.ts` | 1 files |
| `utils/RunExclusiveMutex.challenger.test.ts` | 1 files |
| `utils/RunExclusiveMutex.test.ts` | 1 files |
| `utils/SchemaValidator.test.ts` | 2 files |
| `utils/WorkerPoolManager.test.ts` | 1 files |
| `utils/WorkerTaskManager.test.ts` | 3 files |
| `utils/boundedTopK.test.ts` | 1 files |
| `utils/compressedCache.test.ts` | 15 files |
| `compression/CompressedMap.test.ts` | 2 files |
| `compression/ICompressionAdapter.test.ts` | 1 files |
| `compression/compressedEntityCache-wiring.test.ts` | 17 files |
| `utils/compressionUtil.test.ts` | 2 files |
| `utils/deleteFromMapWithFlushRollback.test.ts` | 1 files |
| `utils/durableWriteFile.test.ts` | 1 files |
| `utils/entityUtils.test.ts` | 52 files |
| `utils/envConfig.test.ts` | 2 files |
| `utils/errorSuggestions.test.ts` | 2 files |
| `utils/errors.test.ts` | 1 files |
| `utils/fieldPath.test.ts` | 1 files |
| `utils/fillDefaults.test.ts` | 1 files |
| `utils/formatters.test.ts` | 38 files |
| `utils/graphCopy.test.ts` | 1 files |
| `utils/halfLife.test.ts` | 1 files |
| `utils/ids.test.ts` | 1 files |
| `utils/indexBuckets.test.ts` | 2 files |
| `utils/indexes.test.ts` | 15 files |
| `utils/jsonlMapFile.test.ts` | 2 files |
| `utils/jsonlRecordFile.test.ts` | 3 files |
| `utils/logger.test.ts` | 1 files |
| `utils/mutateMapWithFlushRollback.test.ts` | 1 files |
| `utils/nextMonotonicIsoTimestamp.test.ts` | 1 files |
| `utils/operationUtils.test.ts` | 2 files |
| `utils/parallelUtils.test.ts` | 1 files |
| `utils/postingIndex.test.ts` | 1 files |
| `utils/relationHelpers.test.ts` | 2 files |
| `utils/relationValidation.test.ts` | 2 files |
| `utils/schema.challenger.test.ts` | 1 files |
| `utils/schema.failures.test.ts` | 1 files |
| `utils/schema.inventory.test.ts` | 0 files |
| `utils/schema.parity.test.ts` | 5 files |
| `utils/schemas.test.ts` | 39 files |
| `utils/schemas.validateResult.test.ts` | 1 files |
| `utils/searchAlgorithms.test.ts` | 38 files |
| `utils/searchCache.test.ts` | 1 files |
| `utils/searchCacheForEach.test.ts` | 1 files |
| `utils/sidecarPath.test.ts` | 1 files |
| `utils/taskScheduler.test.ts` | 1 files |
| `utils/textSimilarity.test.ts` | 1 files |
| `utils/textSimilarity.tokenSets.test.ts` | 38 files |
| `utils/threadPool.challenger.test.ts` | 1 files |
| `utils/threadPool.parity.test.ts` | 1 files |
| `utils/threadPool.test.ts` | 1 files |
| `utils/timing.test.ts` | 1 files |
| `utils/tokenEstimate.test.ts` | 38 files |
| `utils/unrefInterval.test.ts` | 1 files |
| `utils/update-entity-schema-strip.test.ts` | 17 files |
| `utils/validation.assertNonEmptyString.test.ts` | 2 files |
| `utils/validators.bounds.test.ts` | 2 files |
| `utils/validators.test.ts` | 2 files |
| `utils/walkParents.test.ts` | 1 files |
| `workers/WorkerPool.test.ts` | 0 files |
| `workers/levenshteinWorker.test.ts` | 2 files |
