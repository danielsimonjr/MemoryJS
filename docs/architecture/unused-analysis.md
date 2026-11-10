<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `npm run tools:deps:full`. -->

# Unused Files and Exports Analysis

## Summary

- **Potentially unused files**: 0
- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 0
  - **Orphaned (reachable from nothing — delete/wire candidates)**: 0
  - **Test-only (exercised by a test, ships nothing)**: 0
- **Potentially unused exports**: 119
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 119

Seeded reachability roots (4):

- `src/cli/index.ts`
- `src/index.ts`
- `src/sqlite.ts`
- `src/workers/levenshteinWorker.ts`

## Dormant Files — Orphaned (delete/wire candidates)

Runtime source files reachable from NO root and NO test. Each is either dead code
to delete, or a root the tool cannot see (a new build/worker entry, a
`new URL()`-loaded script, or a side-effect-only module) — in which case wire it
or seed it. Verify before deleting.

_None._

## Dormant Files — Test-only (ships nothing, but exercised)

Not reachable from any package entry point, but imported by a test — deliberately
kept, standalone-tested code or a helper a test drives directly. Not dead; not
shipped. No action needed.

_None._

## Potentially Unused Files

These files are not imported by any other file in the codebase:

_None._

## Unreferenced Anywhere (deletion candidates)

Not imported by any other file AND not referenced within their own module — the true dead-code candidates. Verify each isn't consumed by a mechanism the
parser can't see (dynamic access, docs examples, published-API contract) before deleting.

_None._

## Referenced In-Module (type contracts / helpers backing live exports)

Not imported cross-file, but referenced within their own module — they type or
support exports that ARE used, so they cannot be deleted in isolation.

### `src/adapters/ApiKeyAuthMiddleware.ts`

- `DEFAULT_READ_SCOPE` (constant) — 1 in-file ref

### `src/adapters/LangChainMemoryAdapter.ts`

- `ChatMessage` (interface) — 6 in-file refs
- `MemoryInputs` (interface) — 1 in-file ref
- `MemoryVariables` (interface) — 1 in-file ref
- `LangChainMemoryAdapterOptions` (interface) — 1 in-file ref

### `src/adapters/RateLimiter.ts`

- `DEFAULT_MAX_BUCKETS` (constant) — 1 in-file ref

### `src/adapters/RestRouter.ts`

- `RestLimits` (interface) — 3 in-file refs

### `src/adapters/recursaToolBounds.ts`

- `byteSize` (function) — 5 in-file refs

### `src/adapters/recursaToolSupport.ts`

- `messageOf` (function) — 7 in-file refs

### `src/agent/AgentEnvDefaults.ts`

- `DEFAULT_ENTROPY_THRESHOLD_BITS` (constant) — 1 in-file ref
- `DEFAULT_COGNITIVE_LOAD_MAX` (constant) — 1 in-file ref

### `src/agent/CollaborativeSynthesis.ts`

- `ConflictView` (interface) — 6 in-file refs
- `ConflictResolutionPolicy` (type) — 1 in-file ref

### `src/agent/ContextWindowManager.ts`

- `ContextCompressionResult` (interface) — 2 in-file refs
- `CompressionLevel` (type) — 4 in-file refs

### `src/agent/DecayEngine.ts`

- `BatchReinforcementOptions` (interface) — 1 in-file ref

### `src/agent/PatternDetector.ts`

- `PatternDetectorOptions` (interface) — 1 in-file ref

### `src/agent/bootstrap/bootstrapShared.ts`

- `MemoryEntityParts` (interface) — 1 in-file ref
- `PartitionableSource` (interface) — 2 in-file refs

### `src/agent/harness/InteractionLogFormat.ts`

- `isInteractionRecord` (function) — 1 in-file ref
- `ScannedRecord` (interface) — 2 in-file refs
- `ScanResult` (interface) — 1 in-file ref
- `MAX_RESULT_LIMIT` (constant) — 2 in-file refs

### `src/agent/harness/InteractionLogRegex.ts`

- `analyzeSelectRegex` (function) — 1 in-file ref
- `CompiledSelectRegex` (interface) — 2 in-file refs
- `MAX_MATCH_LINE_BYTES` (constant) — 2 in-file refs
- `MAX_MATCH_LINE_BYTES_TWO_UNBOUNDED` (constant) — 2 in-file refs
- `SELECT_TIME_BUDGET_MS` (constant) — 3 in-file refs

### `src/agent/knowledge/ScratchKnowledge.ts`

- `ScratchPayload` (interface) — 1 in-file ref
- `ScratchOptions` (interface) — 1 in-file ref
- `ScratchApplyResult` (type) — 1 in-file ref
- `SkillMatcher` (type) — 5 in-file refs

### `src/agent/knowledge/knowledgeLoad.ts`

- `DEFAULT_MAX_SKILLS` (constant) — 1 in-file ref
- `MAX_TASK_SKILLS` (constant) — 2 in-file refs

### `src/agent/learning/ChildKnowledgeOverlay.ts`

- `OverlayBase` (interface) — 2 in-file refs
- `CHILD_REVISIONS_TAG` (constant) — 3 in-file refs

### `src/agent/learning/Diagnoser.ts`

- `buildDiagnosisPrompt` (function) — 1 in-file ref

### `src/agent/learning/KnowledgeEditor.ts`

- `taskRef` (function) — 2 in-file refs
- `taskKeywords` (function) — 1 in-file ref
- `buildDraftPrompt` (function) — 1 in-file ref

### `src/agent/learning/LeafLearnerContext.ts`

- `countBudget` (function) — 1 in-file ref

### `src/agent/learning/LeafLearnerStore.ts`

- `ValidationRun` (interface) — 1 in-file ref

### `src/agent/learning/LeafRound.ts`

- `resultsFor` (function) — 2 in-file refs
- `runDedup` (function) — 1 in-file ref
- `callContextOf` (function) — 2 in-file refs
- `completeEvaluation` (function) — 2 in-file refs

### `src/agent/learning/LearningReflector.ts`

- `preferredStrategyOf` (function) — 1 in-file ref

### `src/agent/learning/LearningTrace.ts`

- `buildTraceEntity` (function) — 1 in-file ref
- `DEFAULT_TRACE_MAX_ACTIONS` (constant) — 2 in-file refs

### `src/agent/learning/RecursiveChildren.ts`

- `RecursiveCtor` (type) — 2 in-file refs

### `src/agent/learning/RecursiveDrive.ts`

- `mergeDepsOf` (function) — 2 in-file refs
- `CheckedStart` (interface) — 2 in-file refs

### `src/agent/learning/RecursiveEvaluate.ts`

- `LiveEvaluation` (interface) — 1 in-file ref

### `src/agent/learning/RecursiveLearnerState.ts`

- `sumTokens` (function) — 2 in-file refs
- `SplitEvidence` (interface) — 2 in-file refs
- `LoadedRecursive` (interface) — 1 in-file ref

### `src/agent/learning/RecursiveMerge.ts`

- `ValidateAndApplyArgs` (interface) — 2 in-file refs

### `src/agent/learning/RecursivePlan.ts`

- `splitContextOf` (function) — 1 in-file ref
- `normalizeSubsets` (function) — 1 in-file ref

### `src/agent/learning/RevisionGeneralize.ts`

- `canGeneralize` (function) — 2 in-file refs
- `GENERALIZE_DESCRIPTION_JACCARD` (constant) — 2 in-file refs

### `src/agent/learning/llmJson.ts`

- `escapeFenceContent` (function) — 2 in-file refs
- `escapeHeading` (function) — 3 in-file refs

### `src/agent/learning/revisionMergeShared.ts`

- `BODY_MAX_CHARS` (constant) — 3 in-file refs
- `FIELD_MAX_CHARS` (constant) — 1 in-file ref

### `src/agent/procedural/graph/backing/ProceduralGraphState.ts`

- `PGRevisionListItem` (interface) — 6 in-file refs

### `src/agent/reconstruction/MemoryDistiller.ts`

- `MemoryDistillerConfig` (interface) — 1 in-file ref
- `DistillerTokenUsage` (interface) — 1 in-file ref
- `UsageReportingLLMProvider` (interface) — 1 in-file ref
- `DistillerMode` (type) — 2 in-file refs

### `src/agent/skills/SkillPublisher.ts`

- `SkillPublisherOptions` (interface) — 1 in-file ref

### `src/agent/skills/skillRecordUtils.ts`

- `LexicalSkillMatch` (interface) — 4 in-file refs

### `src/agent/skills/skillTreeFs.ts`

- `TreeDirRefusal` (type) — 2 in-file refs

### `src/cli/commands/audit.ts`

- `AUDIT_OPERATIONS` (constant) — 2 in-file refs

### `src/cli/commands/doctor.ts`

- `defaultWorkerDirs` (function) — 1 in-file ref
- `DoctorCheckResult` (interface) — 8 in-file refs
- `DoctorStatus` (type) — 1 in-file ref
- `EXTRA_NUMERIC_VARS` (constant) — 2 in-file refs

### `src/cli/formatters.ts`

- `OutputFormat` (type) — 8 in-file refs

### `src/cli/plainTable.ts`

- `PlainTableOptions` (interface) — 1 in-file ref

### `src/core/EntityManager.ts`

- `GetEntityOptions` (interface) — 1 in-file ref

### `src/core/GraphTraversal.ts`

- `SimilarityProvider` (interface) — 2 in-file refs
- `LookForOptions` (interface) — 2 in-file refs
- `RankedNeighborWithRelation` (interface) — 3 in-file refs
- `TraversalOptionsWithTracking` (interface) — 4 in-file refs
- `FindAllPathsOptions` (interface) — 1 in-file ref
- `DEFAULT_ALL_PATHS_MAX_PATHS` (constant) — 1 in-file ref
- `DEFAULT_ALL_PATHS_MAX_EXPANSIONS` (constant) — 1 in-file ref

### `src/core/SQLiteStorage.ts`

- `DatabaseCtor` (type) — 6 in-file refs

### `src/core/context/BootstrapFacade.ts`

- `BootstrapFacadeDeps` (interface) — 1 in-file ref

### `src/core/context/LearningFacade.ts`

- `LearningFacadeDeps` (interface) — 1 in-file ref
- `DEFAULT_LOOP_LEAF_THRESHOLD` (constant) — 1 in-file ref

### `src/core/context/StorageInfraFacade.ts`

- `StorageInfraDeps` (interface) — 1 in-file ref

### `src/core/mmap/FsReadMmapBackend.ts`

- `FsReadMmapBackendOptions` (interface) — 1 in-file ref

### `src/core/segments/FileSegmentStorage.ts`

- `SegmentCommitIncompleteError` (class) — 3 in-file refs

### `src/features/ContradictionDetector.ts`

- `SupersedeOptions` (interface) — 1 in-file ref

### `src/features/IOManager.ts`

- `IngestTokenUsage` (interface) — 2 in-file refs
- `IngestValidationFeedback` (interface) — 2 in-file refs
- `IOManagerOptions` (interface) — 1 in-file ref
- `IngestMode` (type) — 3 in-file refs

### `src/search/HybridSearchManager.ts`

- `HybridExecutableLayer` (type) — 1 in-file ref

### `src/search/SearchFilterChain.ts`

- `SearchFilterVersionContext` (interface) — 1 in-file ref

### `src/search/SearchManager.ts`

- `SearchOptionsWithTracking` (interface) — 13 in-file refs

### `src/search/SearchSuggestions.ts`

- `CorrectedQuery` (interface) — 2 in-file refs
- `CorrectQueryOptions` (interface) — 1 in-file ref

### `src/security/APIKeyStore.ts`

- `MAX_KEY_PROJECT_IDS` (constant) — 1 in-file ref
- `MAX_KEY_PROJECT_ID_LENGTH` (constant) — 1 in-file ref

### `src/types/agent-memory.ts`

- `GoalEvent` (interface) — 1 in-file ref
- `PositiveInt` (type) — 5 in-file refs
- `AtLeastOne` (type) — 1 in-file ref
- `DEFAULT_TRUST_THRESHOLDS` (constant) — 4 in-file refs

### `src/utils/Diagnostics.ts`

- `EntityCounts` (interface) — 2 in-file refs

### `src/utils/WorkerPoolManager.ts`

- `WorkerPoolRuntimeStats` (interface) — 1 in-file ref

### `src/utils/compressionUtil.ts`

- `DecompressionOptions` (interface) — 3 in-file refs

### `src/utils/constants.ts`

- `EMBEDDING_ENV_VARS` (constant) — 7 in-file refs

### `src/utils/durableWriteFile.ts`

- `DurableReplaceError` (class) — 3 in-file refs

### `src/utils/jsonlMapFile.ts`

- `JsonlMapParseOptions` (interface) — 1 in-file ref

### `src/utils/searchCache.ts`

- `GraphGenerationDependency` (type) — 2 in-file refs
- `SearchCacheName` (type) — 3 in-file refs

