<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `npm run tools:deps:full`. -->

# Unused Files and Exports Analysis

**Generated**: 2026-11-06

## Summary

- **Potentially unused files**: 0
- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 4
  - **Orphaned (reachable from nothing — delete/wire candidates)**: 0
  - **Test-only (exercised by a test, ships nothing)**: 4
- **Potentially unused exports**: 91
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 91

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

- `src/agent/knowledge/InstructionSetManager.ts`
- `src/agent/knowledge/KnowledgeRepository.ts`
- `src/agent/knowledge/knowledgeDigest.ts`
- `src/agent/knowledge/knowledgeRevision.ts`

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

### `src/agent/knowledge/InstructionSetManager.ts`

- `InstructionHistorySource` (interface) — 2 in-file refs
- `InstructionSetManagerOptions` (interface) — 1 in-file ref
- `InstructionPatchResult` (type) — 1 in-file ref

### `src/agent/knowledge/KnowledgeRepository.ts`

- `SkillMatchLike` (interface) — 2 in-file refs
- `SkillManagerLike` (interface) — 2 in-file refs
- `FailureLookupLike` (interface) — 2 in-file refs
- `KnowledgeRepositoryOptions` (interface) — 1 in-file ref
- `LoadForContextOptions` (interface) — 1 in-file ref
- `LoadedKnowledge` (interface) — 1 in-file ref
- `ApplyResult` (type) — 2 in-file refs
- `RollbackResult` (type) — 2 in-file refs

### `src/agent/knowledge/knowledgeRevision.ts`

- `WorkState` (interface) — 3 in-file refs

### `src/agent/procedural/graph/backing/ProceduralGraphState.ts`

- `PGRevisionListItem` (interface) — 6 in-file refs

### `src/agent/reconstruction/MemoryDistiller.ts`

- `MemoryDistillerConfig` (interface) — 1 in-file ref
- `DistillerTokenUsage` (interface) — 1 in-file ref
- `UsageReportingLLMProvider` (interface) — 1 in-file ref
- `DistillerMode` (type) — 2 in-file refs

### `src/agent/skills/SkillFormat.ts`

- `SkillParseFailure` (interface) — 4 in-file refs
- `ParseSkillOptions` (interface) — 1 in-file ref
- `SkillParseResult` (type) — 2 in-file refs
- `SKILL_FRONT_MATTER_KEYS` (constant) — 2 in-file refs

### `src/agent/skills/SkillManager.ts`

- `SkillListOptions` (interface) — 1 in-file ref
- `SkillMatch` (interface) — 2 in-file refs
- `SkillMatchOptions` (interface) — 1 in-file ref
- `LoadForContextOptions` (interface) — 1 in-file ref
- `SkillSimilarityProvider` (interface) — 2 in-file refs
- `SkillOutcome` (type) — 1 in-file ref
- `SkillUpdateResult` (type) — 2 in-file refs
- `SkillRetireResult` (type) — 2 in-file refs
- `SkillOutcomeResult` (type) — 1 in-file ref

### `src/agent/skills/SkillPublisher.ts`

- `SkillPublishMarker` (interface) — 5 in-file refs
- `ImportConflict` (interface) — 1 in-file ref
- `ImportParseError` (interface) — 1 in-file ref
- `PublishOptions` (interface) — 1 in-file ref

### `src/cli/commands/audit.ts`

- `AUDIT_OPERATIONS` (constant) — 2 in-file refs

### `src/cli/commands/doctor.ts`

- `defaultWorkerDirs` (function) — 1 in-file ref
- `DoctorCheckResult` (interface) — 8 in-file refs
- `DoctorStatus` (type) — 1 in-file ref
- `EXTRA_NUMERIC_VARS` (constant) — 2 in-file refs

### `src/cli/formatters.ts`

- `OutputFormat` (type) — 8 in-file refs

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
- `IngestProduced` (interface) — 1 in-file ref
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

### `src/search/SemanticSearch.ts`

- `SemanticSearchOptions` (interface) — 1 in-file ref

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

