<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Unused Files and Exports Analysis

## Summary

- **Files with no in-repo importer**: 0
- **Dormant files**: 0
  - **Orphaned (reachable from nothing)**: 0
  - **Test-only (only a test reaches them)**: 0
- **Potentially unused exports**: 46
  - **Unreferenced anywhere**: 0
  - **Referenced in their own module**: 46
  - **Not classified**: 0

## Caveats

- A literal relative `import(...)` is a graph edge. A runtime call is a namespace use (`*`), so the exports of that file count as used. A type-position `import(...).Name` counts only `Name`, and `typeof import(...)` counts none. A dynamic import built from a variable or a template, and other runtime loads (e.g. `new Worker(path)`), are still invisible -- a file or export reached ONLY through one of those is reported as no-importer/unreferenced even though it may be live.
- `noImporterFiles` is NOT a deletion-candidate list. A file with zero in-repo importers is expected, not suspicious, for: a standalone script invoked directly (e.g. a smoketest run via `node script.mjs`, never `import`ed by anything), or a build/lint config file loaded by its own tool rather than by source code (e.g. `eslint.config.mjs`, read by eslint itself). Cross-check against package.json scripts / tool configs before treating any entry here as dead.
- Only NAMED exports are analysed (`FileNode.exports` carries named exports only) -- `export default` usage is not checked here.
- The split of exports into `referencedInModule` and `unreferencedAnywhere` is a TEXT-LEVEL heuristic. The analysis counts whole-identifier occurrences in the source of the defining file, minus the declaration site itself. The count is not an AST reference count. The analysis can over-count a name that also appears in a string literal or comment. When the source text cannot be read (no `RepoGraph.root_path`, or the file is missing), the export lands in `unclassifiedExports`. The analysis does not guess a bucket for it.
- `unreferencedAnywhereNotes`'s dynamic-import check (`_dynamic_import_referrers`) only sees `import(...)` calls with a LITERAL string specifier. A dynamic import built from a variable or template literal (e.g. `import(`./cmds/${name}.js`)`, a command-dispatcher pattern) is invisible to it -- 'found none' in a note means no LITERAL match was found, NOT that nothing imports the file.

## Dormant files: orphaned

Source files that no root and no test reaches. Verify each one before you delete it.

_None._

## Dormant files: test-only

Source files that only a test reaches. They ship nothing, but a test uses them.

_None._

## Files with no in-repo importer

No file of this repository imports these files. Do not use the list as a deletion list.

_None._

## Exports unreferenced anywhere

No other file imports these names, and their own module does not use them.

_None._

## Exports referenced in their own module

No other file imports these names, but their own module uses them.

- `src/adapters/LangChainMemoryAdapter.ts`: `ChatMessage`, `LangChainMemoryAdapterOptions`, `MemoryInputs`, `MemoryVariables`
- `src/adapters/RateLimiter.ts`: `DEFAULT_MAX_BUCKETS`
- `src/agent/CollaborativeSynthesis.ts`: `ConflictResolutionPolicy`, `ConflictView`
- `src/agent/ContextWindowManager.ts`: `CompressionLevel`, `ContextCompressionResult`
- `src/agent/DecayEngine.ts`: `BatchReinforcementOptions`
- `src/agent/PatternDetector.ts`: `PatternDetectorOptions`
- `src/agent/procedural/graph/backing/ProceduralGraphState.ts`: `PGRevisionListItem`
- `src/cli/commands/audit.ts`: `AUDIT_OPERATIONS`
- `src/cli/commands/doctor.ts`: `DoctorCheckResult`, `DoctorStatus`, `EXTRA_NUMERIC_VARS`, `defaultWorkerDirs`
- `src/core/GraphTraversal.ts`: `DEFAULT_ALL_PATHS_MAX_EXPANSIONS`, `DEFAULT_ALL_PATHS_MAX_PATHS`, `FindAllPathsOptions`, `LookForOptions`, `RankedNeighborWithRelation`, `SimilarityProvider`, `TraversalOptionsWithTracking`
- `src/core/context/StorageInfraFacade.ts`: `StorageInfraDeps`
- `src/core/mmap/FsReadMmapBackend.ts`: `FsReadMmapBackendOptions`
- `src/core/segments/FileSegmentStorage.ts`: `SegmentCommitIncompleteError`
- `src/features/ContradictionDetector.ts`: `SupersedeOptions`
- `src/features/IOManager.ts`: `IOManagerOptions`, `IngestMode`, `IngestProduced`, `IngestTokenUsage`, `IngestValidationFeedback`
- `src/search/HybridSearchManager.ts`: `HybridExecutableLayer`
- `src/search/SearchFilterChain.ts`: `SearchFilterVersionContext`
- `src/search/SearchManager.ts`: `SearchOptionsWithTracking`
- `src/search/SearchSuggestions.ts`: `CorrectQueryOptions`, `CorrectedQuery`
- `src/search/SemanticSearch.ts`: `SemanticSearchOptions`
- `src/types/agent-memory.ts`: `AtLeastOne`, `DEFAULT_TRUST_THRESHOLDS`, `GoalEvent`, `PositiveInt`
- `src/utils/Diagnostics.ts`: `EntityCounts`
- `src/utils/compressionUtil.ts`: `DecompressionOptions`
- `src/utils/jsonlMapFile.ts`: `JsonlMapParseOptions`

## Exports not classified

The analysis could not read the source of these names.

_None._
