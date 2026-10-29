# Clones remaining

**Tool**: `@danielsimonjr/repo-tools` 2.3.0  
**Command**: `repo-tools clones . --src=src --out=tmp/memoryjs-clones-master`  
**Baseline commit**: `60102494873a4edb3aa4b1007dd26dca55a60951`  
**Baseline**: 4 exact groups, 8 units in them, 1 text-identical group, 54 near pairs, 1365 units  
**After cleanup**: 1 exact group, 2 units in them, 0 text-identical groups, 51 near pairs, 1376 units  
**Cleanup commit**: `d3413b82d5d38add291a88abd4cb5c776cab919a`

**Re-audit commit (this doc)**: `246622d63f2826827aaf950a70dd9f238b52118e` on `master`  
**Re-audit summary** (same command; open clone PR series not merged into this head yet):

```
files=307 parseErrors=0 units(minNodes=50)=1376
nodes p50=105 p90=293 p99=756 max=1915
exact groups=1 (units in them=2) text-identical groups=0
near pairs=51 by jStruct: 0.9 or more: 2, 0.8 to 0.9: 11, 0.7 to 0.8: 12, 0.6 to 0.7: 15, below 0.6 (containment): 11
units by folder: src/adapters=28 src/agent=556 src/cli=74 src/core=221 src/features=92 src/search=256 src/security=11 src/types=9 src/utils=127 src/workers=2
```

The rows below use stable **K** ids from the pre-series ledger. Pairs addressed by the CLONES_REFACTOR_PLAN code PRs (P1–P23) move to **Merged after the re-audit** with the shared helper name; they stay in the tool report on `master` until those PRs land. **Remaining** lists only **KEEP** verdicts from the plan.

## Removed (earlier cleanup PR)

| id | was | units | merge |
|---|---|---|---|
| R001 | exact | `src/agent/EpisodicMemoryManager.ts EpisodicMemoryManager.getNextEvent` ; `src/agent/EpisodicMemoryManager.ts EpisodicMemoryManager.getPreviousEvent` | private `getAdjacentEvent`, relation type parameter |
| R002 | text | `src/agent/procedural/graph/backing/ProceduralGraphState.ts ProceduralGraphState.nextTimestamp` ; `src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.ts SqliteProceduralGraphBacking.nextTimestamp` | `nextMonotonicIsoTimestamp` pure helper |
| R003 | exact | `src/core/columns/JsonlColumnStore.ts JsonlColumnStore.put` ; `src/search/tiered/BrotliColdTier.ts BrotliColdTier.put` | `mutateMapWithFlushRollback` shared flush rollback |

## Merged after the re-audit (CLONES_REFACTOR_PLAN P1–P23)

| id | helper / frame | plan PR |
|---|---|---|
| K001 | shared failure-chain prelude in `FailureDistillation` | P1 |
| K002 | `loadProjectedRecords` + `matchesDefined` | P2 |
| K003 | `deleteRecordsByKey` | P4 |
| K004 | `removeIdFromPostings` | P3 |
| K005 | `fillDefaults` (config constructors) | P7 |
| K006 | `StreamingExporter.writeStreamed` | P14 |
| K007 | `SalienceEngine.semanticOr` | P13 |
| K008 | `WorkThreadManager.updateThread` | P10 |
| K009 | `fillDefaults` | P7 |
| K010 | `clearMapWithFlushRollback` | P5 |
| K011 | `fillDefaults` (`??` scheduler fields) | P8 |
| K012 | `DecisionManager.closeProposed` | P11 |
| K013 | `bindStorageCacheState` | P22 |
| K015 | `AccessTracker.recordAccessBatch` | P12 |
| K016 | `beginUnrefInterval` | P9 |
| K017 | `SalienceEngine.semanticOr` (intent path) | P13 |
| K020 | `fillDefaults` | P7 |
| K021 | `WorkThreadManager.updateThread` | P10 |
| K023 | `writeJsonlRecordsUpdatingCache` | P4 |
| K024 | `fillDefaults` | P8 |
| K026 | `fillDefaults` | P8 |
| K027 | `SalienceEngine.semanticOr` (task path) | P13 |
| K028 | `fillDefaults` | P7 |
| K030 | `selectWeightedTurns` | P15 |
| K032 | `loadEntityRelationEnds` | P17 |
| K034 | `EventManager.collectEvents` | P18 |
| K035 | `clampedHalfLifeScore` | P6 |
| K036 | `RefIndex.rewriteReverseBucket` | P16 |
| K037 | `WorkThreadManager.updateThread` | P10 |
| K038 | `ParallelSearchExecutor.timeLayer` | P19 |
| K039 | `fillDefaults` | P8 |
| K041 | `fillDefaults` | P8 |
| K042 | `fillDefaults` | P7 |
| K043 | `fillDefaults` | P7 |
| K044 | `fillDefaults` | P8 |
| K045 | `ObservationDedupManager.bucketObservationsByHash` | P20 |
| K047 | `SessionQueryBuilder.collectFiltered` | P21 |
| K048 | `fillDefaults` | P8 |
| K050 | `deleteRelationsFromSnapshot` | P23 |
| K051 | `deleteNamesFromSnapshot` (+ `removeEntitiesFromIndexes` at call sites) | P23 |

## Remaining (KEEP)

| id | result | units | scores | verdict | why it stays |
|---|---|---|---|---|---|
| K014 | near | `src/utils/EntityValidator.ts EntityValidator.validate` ; `src/utils/EntityValidator.ts EntityValidator.validateSync` | jStruct=0.799 contain=0.931 jNames=0.957 | look-alike | Sync and async validators; JavaScript has no clean way to share both bodies without changing microtask ordering. |
| K018 | near | `src/search/QueryCostEstimator.ts QueryCostEstimator.scoreLexicalLayer` ; `src/search/QueryCostEstimator.ts QueryCostEstimator.scoreSemanticLayer` | jStruct=0.738 contain=0.882 jNames=0.909 | look-alike | Layer cost heuristics use different inputs; merging would blur semantic vs lexical weights. |
| K019 | near | `src/agent/DecisionManager.ts DecisionManager.reject` ; `src/agent/DecisionManager.ts DecisionManager.supersede` | jStruct=0.72 contain=0.922 jNames=0.636 | look-alike | `supersede` loads a second entity, requires `accepted`, and stores `supersededBy`; not the accept/reject frame. |
| K022 | near | `src/core/columns/JsonlColumnStore.ts JsonlColumnStore.delete` ; `src/search/tiered/MapFileTier.ts MapFileTier.delete` | jStruct=0.714 contain=0.887 jNames=0.5 | look-alike | Column delete restores one key on flush failure; tier delete restores the whole map and changes flush line order. |
| K025 | near | `src/agent/DecisionManager.ts DecisionManager.accept` ; `src/agent/DecisionManager.ts DecisionManager.supersede` | jStruct=0.701 contain=0.844 jNames=0.737 | look-alike | Same split as K019 from the accept side. |
| K029 | near | `src/agent/AgentReflectionManager.ts AgentReflectionManager.archive` ; `src/agent/FailureManager.ts FailureManager.markResolved` | jStruct=0.658 contain=0.859 jNames=0.5 | look-alike | Archive vs resolve lifecycle; status fields and omitted-key rules differ despite shared `versionedWriteFailure`. |
| K031 | near | `src/core/GraphTraversal.ts GraphTraversal.bfs` ; `src/core/GraphTraversal.ts GraphTraversal.dfs` | jStruct=0.654 contain=0.801 jNames=0.846 | look-alike | BFS marks visited on enqueue; DFS marks visited on pop — a shared loop would not preserve order semantics. |
| K033 | near | `src/features/IOManager.ts IOManager.exportAsGraphML` ; `src/features/IOManager.ts IOManager.exportAsGEXF` | jStruct=0.646 contain=0.913 jNames=0.731 | look-alike | Two export formats with different XML schemas. |
| K040 | near | `src/search/BloomFilter.ts BloomFilter.add` ; `src/search/BloomFilter.ts BloomFilter.mayContain` | jStruct=0.603 contain=0.783 jNames=0.917 | look-alike | `add` sets bits and increments `inserted`; `mayContain` returns on the first clear bit. |
| K046 | near | `src/cli/commands/heuristic.ts registerHeuristicCommands` ; `src/cli/commands/observationDedup.ts registerObservationDedupCommands` | jStruct=0.426 contain=0.933 jNames=0.227 | look-alike | CLI command registration blocks differ in flags and handlers. |
| K049 | near | `src/search/BasicSearch.ts BasicSearch.openNodes` ; `src/search/BooleanSearch.ts BooleanSearch.booleanSearch` | jStruct=0.235 contain=0.909 jNames=0.227 | look-alike | `openNodes` induces relations on entities that exist; boolean cache hits use the cached name set. |
