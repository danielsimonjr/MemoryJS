<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `npm run tools:deps:full`. -->

# Unused Files and Exports Analysis

**Generated**: 2026-08-07

## Summary

- **Potentially unused files**: 0
- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 0
  - **Orphaned (reachable from nothing — delete/wire candidates)**: 0
  - **Test-only (exercised by a test, ships nothing)**: 0
- **Potentially unused exports**: 56
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 56

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

### `src/adapters/LangChainMemoryAdapter.ts`

- `ChatMessage` (interface) — 6 in-file refs
- `MemoryInputs` (interface) — 1 in-file ref
- `MemoryVariables` (interface) — 1 in-file ref
- `LangChainMemoryAdapterOptions` (interface) — 1 in-file ref

### `src/agent/CollaborativeSynthesis.ts`

- `ConflictView` (interface) — 6 in-file refs
- `ConflictResolutionPolicy` (type) — 1 in-file ref

### `src/agent/ContextWindowManager.ts`

- `ContextCompressionResult` (interface) — 2 in-file refs
- `CompressionLevel` (type) — 4 in-file refs

### `src/agent/reconstruction/MemoryDistiller.ts`

- `MemoryDistillerConfig` (interface) — 1 in-file ref
- `DistillerTokenUsage` (interface) — 1 in-file ref
- `UsageReportingLLMProvider` (interface) — 1 in-file ref
- `DistillerMode` (type) — 2 in-file refs

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

- `GovernanceAuditEvent` (interface) — 2 in-file refs
- `GovernanceHooks` (interface) — 3 in-file refs
- `GetEntityOptions` (interface) — 1 in-file ref

### `src/core/GraphTraversal.ts`

- `SimilarityProvider` (interface) — 2 in-file refs
- `LookForOptions` (interface) — 2 in-file refs
- `RankedNeighborWithRelation` (interface) — 3 in-file refs
- `TraversalOptionsWithTracking` (interface) — 4 in-file refs

### `src/core/mmap/FsReadMmapBackend.ts`

- `FsReadMmapBackendOptions` (interface) — 1 in-file ref

### `src/core/ObservationStore.ts`

- `ObservationStoreStats` (interface) — 1 in-file ref

### `src/features/IOManager.ts`

- `IngestTokenUsage` (interface) — 2 in-file refs
- `IngestProduced` (interface) — 1 in-file ref
- `IngestValidationFeedback` (interface) — 2 in-file refs
- `IngestMode` (type) — 3 in-file refs

### `src/search/BloomPreScreener.ts`

- `BloomPreScreenerOptions` (interface) — 1 in-file ref

### `src/search/MaterializedViews.ts`

- `ViewDefinition` (interface) — 3 in-file refs
- `ViewSnapshot` (interface) — 1 in-file ref

### `src/search/PartialIndexAdvisor.ts`

- `IndexRecommendation` (interface) — 2 in-file refs
- `PartialIndexAdvisorOptions` (interface) — 1 in-file ref

### `src/search/SearchManager.ts`

- `SearchOptionsWithTracking` (interface) — 12 in-file refs

### `src/search/SearchSuggestions.ts`

- `CorrectedQuery` (interface) — 2 in-file refs
- `CorrectQueryOptions` (interface) — 1 in-file ref

### `src/search/tiered/BrotliColdTier.ts`

- `BrotliColdTierOptions` (interface) — 1 in-file ref

### `src/search/tiered/DiskWarmTier.ts`

- `DiskWarmTierOptions` (interface) — 1 in-file ref

### `src/search/tiered/LRUHotTier.ts`

- `LRUHotTierOptions` (interface) — 1 in-file ref

### `src/search/tiered/TieredIndex.ts`

- `TieredIndexOptions` (interface) — 1 in-file ref
- `TieredIndexBuildOptions` (interface) — 1 in-file ref

### `src/types/agent-memory.ts`

- `GoalEvent` (interface) — 1 in-file ref
- `PositiveInt` (type) — 5 in-file refs
- `AtLeastOne` (type) — 1 in-file ref
- `DEFAULT_TRUST_THRESHOLDS` (constant) — 4 in-file refs

### `src/utils/CachePressureCoordinator.ts`

- `CachePressureSnapshot` (interface) — 2 in-file refs

### `src/utils/compression/CompressedMap.ts`

- `CompressedMapOptions` (interface) — 1 in-file ref

### `src/utils/compressionUtil.ts`

- `DecompressionOptions` (interface) — 3 in-file refs

### `src/utils/constants.ts`

- `EMBEDDING_ENV_VARS` (constant) — 4 in-file refs

### `src/utils/Diagnostics.ts`

- `EntityCounts` (interface) — 2 in-file refs
- `TieredIndexStatsSnapshot` (interface) — 2 in-file refs

### `src/utils/IndexHealthMonitor.ts`

- `IndexHealthSources` (interface) — 1 in-file ref

### `src/utils/searchCache.ts`

- `GraphGenerationDependency` (type) — 2 in-file refs

