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

The rows below use stable **K** ids from the pre-series ledger. This re-audit ran on `master` `246622d` before the P1–P23 code PRs landed, so every K001–K051 pair is still in the tool report. Rows are **not** moved to Merged until a later re-audit on a head that actually contains those helpers shows they left. KEEP why-it-stays sentences below are from re-reading the source (plan #225), not from predicted post-series counts.

## Removed (earlier cleanup PR)

| id | was | units | merge |
|---|---|---|---|
| R001 | exact | `src/agent/EpisodicMemoryManager.ts EpisodicMemoryManager.getNextEvent` ; `src/agent/EpisodicMemoryManager.ts EpisodicMemoryManager.getPreviousEvent` | private `getAdjacentEvent`, relation type parameter |
| R002 | text | `src/agent/procedural/graph/backing/ProceduralGraphState.ts ProceduralGraphState.nextTimestamp` ; `src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.ts SqliteProceduralGraphBacking.nextTimestamp` | `nextMonotonicIsoTimestamp` pure helper |
| R003 | exact | `src/core/columns/JsonlColumnStore.ts JsonlColumnStore.put` ; `src/search/tiered/BrotliColdTier.ts BrotliColdTier.put` | `mutateMapWithFlushRollback` shared flush rollback |

## Remaining

The table is the tool report on this head. MERGE/KEEP is the plan-#225 verdict; MERGE rows are still present until the matching code PR lands and a later re-audit moves them.

| id | result | units | scores | verdict | why it stays |
|---|---|---|---|---|---|
| K001 | exact | `src/agent/FailureDistillation.ts FailureDistillation.buildFailureDescription` ; `src/agent/FailureDistillation.ts FailureDistillation.buildLesson` | exactHash=8eba186423d6ddd8 jStruct=1 contain=1 jNames=1 | look-alike | Shared empty-chain prelude; sentence templates differ. Planned MERGE in P1. |
| K002 | near | `src/agent/FailureManager.ts FailureManager.getAll` ; `src/agent/PlanManager.ts PlanManager.listPlans` | jStruct=1 contain=1 jNames=0.462 | look-alike | Same load-then-optional-field-filter; record types and field lists differ. Planned MERGE in P2. |
| K003 | near | `src/features/TagManager.ts TagManager.removeTagAlias` ; `src/search/SavedSearchManager.ts SavedSearchManager.deleteSavedSearch` | jStruct=0.898 contain=1 jNames=0.25 | look-alike | Both delete a named JSONL row; case-fold stays in TagManager. Planned MERGE in P4. |
| K004 | near | `src/search/NGramIndex.ts NGramIndex.removeFromInvertedIndex` ; `src/utils/indexes.ts ObservationIndex.remove` | jStruct=0.891 contain=1 jNames=0.2 | look-alike | Both drop an id from posting sets; forward-map delete stays in ObservationIndex. Planned MERGE in P3. |
| K005 | near | `src/agent/ContextWindowManager.ts ContextWindowManager.constructor` ; `src/agent/SalienceEngine.ts SalienceEngine.constructor` | jStruct=0.848 contain=1 jNames=0.067 | look-alike | Each constructor merges its own `??` defaults. Planned MERGE in P7. |
| K006 | near | `src/features/StreamingExporter.ts StreamingExporter.streamJSONL` ; `src/features/StreamingExporter.ts StreamingExporter.streamCSV` | jStruct=0.846 contain=0.93 jNames=0.843 | look-alike | Shared stream lifecycle; line text differs. Planned MERGE in P14. |
| K007 | near | `src/agent/SalienceEngine.ts SalienceEngine.calculateTaskRelevance` ; `src/agent/SalienceEngine.ts SalienceEngine.calculateQueryRelevance` | jStruct=0.841 contain=0.958 jNames=0.684 | look-alike | Same semantic branch; score tiers differ. Planned MERGE in P13. |
| K008 | near | `src/agent/WorkThreadManager.ts WorkThreadManager.claim` ; `src/agent/WorkThreadManager.ts WorkThreadManager.release` | jStruct=0.831 contain=0.958 jNames=0.857 | look-alike | Shared persist frame; owner/status mutations differ. Planned MERGE in P10. |
| K009 | near | `src/agent/AccessTracker.ts AccessTracker.constructor` ; `src/agent/ContextWindowManager.ts ContextWindowManager.constructor` | jStruct=0.824 contain=1 jNames=0.095 | look-alike | Each constructor merges its own `??` defaults. Planned MERGE in P7. |
| K010 | near | `src/core/columns/JsonlColumnStore.ts JsonlColumnStore.clear` ; `src/search/tiered/MapFileTier.ts MapFileTier.clear` | jStruct=0.82 contain=1 jNames=0.846 | look-alike | Shared clear-with-rollback; mutex stays at each call site. Planned MERGE in P5. |
| K011 | near | `src/agent/ConsolidationScheduler.ts ConsolidationScheduler.constructor` ; `src/agent/DecayScheduler.ts DecayScheduler.constructor` | jStruct=0.81 contain=0.971 jNames=0.143 | look-alike | `??` fields can share fillDefaults; callbacks stay direct. Planned MERGE in P8. |
| K012 | near | `src/agent/DecisionManager.ts DecisionManager.accept` ; `src/agent/DecisionManager.ts DecisionManager.reject` | jStruct=0.8 contain=0.955 jNames=0.737 | look-alike | Shared proposed-close frame; reason validation stays on reject. Planned MERGE in P11. |
| K013 | near | `src/core/GraphStorage.ts GraphStorage.cacheStateOf` ; `src/core/SQLiteStorage.ts SQLiteStorage.cacheStateOf` | jStruct=0.8 contain=0.933 jNames=0.688 | look-alike | Live getters can be bound; lowercase writes stay per backend. Planned MERGE in P22. |
| K014 | near | `src/utils/EntityValidator.ts EntityValidator.validate` ; `src/utils/EntityValidator.ts EntityValidator.validateSync` | jStruct=0.799 contain=0.931 jNames=0.957 | look-alike | One body cannot be both async-await and sync Promise rejection without changing ticks. KEEP. |
| K015 | near | `src/core/GraphTraversal.ts GraphTraversal.trackTraversalAccess` ; `src/search/SearchManager.ts SearchManager.trackSearchResults` | jStruct=0.768 contain=0.896 jNames=0.706 | look-alike | Shared Promise.all fan-out; AccessContext objects stay at the call sites. Planned MERGE in P12. |
| K016 | near | `src/agent/ConsolidationScheduler.ts ConsolidationScheduler.start` ; `src/agent/DecayScheduler.ts DecayScheduler.start` | jStruct=0.765 contain=0.907 jNames=0.5 | look-alike | Shared unref interval; the immediate cycle stays in each start. Planned MERGE in P9. |
| K017 | near | `src/agent/SalienceEngine.ts SalienceEngine.calculateQueryRelevance` ; `src/agent/SalienceEngine.ts SalienceEngine.calculateIntentRelevance` | jStruct=0.757 contain=0.966 jNames=0.667 | look-alike | Query fallback scores name/type/observations; intent scores observations only. Planned MERGE in P13. |
| K018 | near | `src/search/QueryCostEstimator.ts QueryCostEstimator.scoreLexicalLayer` ; `src/search/QueryCostEstimator.ts QueryCostEstimator.scoreSemanticLayer` | jStruct=0.738 contain=0.882 jNames=0.909 | look-alike | Layer cost tables use different inputs and weights. KEEP. |
| K019 | near | `src/agent/DecisionManager.ts DecisionManager.reject` ; `src/agent/DecisionManager.ts DecisionManager.supersede` | jStruct=0.72 contain=0.922 jNames=0.636 | look-alike | `supersede` loads a second entity, requires `accepted`, and stores `supersededBy`. KEEP. |
| K020 | near | `src/agent/AccessTracker.ts AccessTracker.constructor` ; `src/agent/SalienceEngine.ts SalienceEngine.constructor` | jStruct=0.718 contain=0.848 jNames=0.08 | look-alike | Each constructor merges its own `??` defaults. Planned MERGE in P7. |
| K021 | near | `src/agent/WorkThreadManager.ts WorkThreadManager.release` ; `src/agent/WorkThreadManager.ts WorkThreadManager.finish` | jStruct=0.716 contain=0.866 jNames=0.733 | look-alike | Finish does not clear owner. Planned MERGE in P10. |
| K022 | near | `src/core/columns/JsonlColumnStore.ts JsonlColumnStore.delete` ; `src/search/tiered/MapFileTier.ts MapFileTier.delete` | jStruct=0.714 contain=0.887 jNames=0.5 | look-alike | Column delete restores one key at the end; tier delete restores the whole map. KEEP. |
| K023 | near | `src/features/TagManager.ts TagManager.saveTagAliases` ; `src/search/SavedSearchManager.ts SavedSearchManager.saveSavedSearches` | jStruct=0.714 contain=0.889 jNames=0.444 | look-alike | Shared JSONL write+cache; invalidation callbacks differ. Planned MERGE in P4. |
| K024 | near | `src/adapters/LangChainMemoryAdapter.ts LangChainMemoryAdapter.constructor` ; `src/search/tiered/LRUHotTier.ts LRUHotTier.constructor` | jStruct=0.704 contain=1 jNames=0.05 | look-alike | `??` fields can share fillDefaults; `onEvict` stays direct. Planned MERGE in P8. |
| K025 | near | `src/agent/DecisionManager.ts DecisionManager.accept` ; `src/agent/DecisionManager.ts DecisionManager.supersede` | jStruct=0.701 contain=0.844 jNames=0.737 | look-alike | Same split as K019 from the accept side. KEEP. |
| K026 | near | `src/adapters/LangChainMemoryAdapter.ts LangChainMemoryAdapter.constructor` ; `src/agent/RelationConsolidator.ts RelationConsolidator.constructor` | jStruct=0.679 contain=1 jNames=0.056 | look-alike | Nested `thresholds.semantic` stays a line. Planned MERGE in P8. |
| K027 | near | `src/agent/SalienceEngine.ts SalienceEngine.calculateTaskRelevance` ; `src/agent/SalienceEngine.ts SalienceEngine.calculateIntentRelevance` | jStruct=0.671 contain=0.948 jNames=0.667 | look-alike | Task id short-circuit stays in front of the semantic helper. Planned MERGE in P13. |
| K028 | near | `src/agent/AccessTracker.ts AccessTracker.constructor` ; `src/agent/SessionManager.ts SessionManager.constructor` | jStruct=0.667 contain=0.824 jNames=0.167 | look-alike | `createSummaryOnEnd` default is the computed boolean passed into fillDefaults. Planned MERGE in P7. |
| K029 | near | `src/agent/AgentReflectionManager.ts AgentReflectionManager.archive` ; `src/agent/FailureManager.ts FailureManager.markResolved` | jStruct=0.658 contain=0.859 jNames=0.5 | look-alike | Archive writes `archived`/`archivedAt`; resolve writes lifecycle and may omit `resolvedReason`. KEEP. |
| K030 | near | `src/agent/InMemoryBackend.ts InMemoryBackend.get_weighted` ; `src/agent/SQLiteBackend.ts SQLiteBackend.get_weighted` | jStruct=0.655 contain=0.796 jNames=0.714 | look-alike | Shared threshold/sort/slice; fetch and projection stay in each backend. Planned MERGE in P15. |
| K031 | near | `src/core/GraphTraversal.ts GraphTraversal.bfs` ; `src/core/GraphTraversal.ts GraphTraversal.dfs` | jStruct=0.654 contain=0.801 jNames=0.846 | look-alike | BFS marks visited on enqueue; DFS marks visited on pop. KEEP. |
| K032 | near | `src/cli/commands/inspect.ts snapshotEntity` ; `src/cli/commands/inspect.ts neighbors` | jStruct=0.65 contain=0.918 jNames=0.486 | look-alike | Shared load and relation-end projection; report shapes stay. Planned MERGE in P17. |
| K033 | near | `src/features/IOManager.ts IOManager.exportAsGraphML` ; `src/features/IOManager.ts IOManager.exportAsGEXF` | jStruct=0.646 contain=0.913 jNames=0.731 | look-alike | Two export formats with different XML schemas. KEEP. |
| K034 | near | `src/agent/events/EventManager.ts EventManager.queryEvents` ; `src/agent/events/EventManager.ts EventManager.whoDidWhat` | jStruct=0.644 contain=0.786 jNames=0.778 | look-alike | Shared collect; candidate queries and no-actor handling stay in each method. Planned MERGE in P18. |
| K035 | near | `src/agent/AccessTracker.ts AccessTracker.calculateRecencyScoreFromTimestamp` ; `src/agent/DecayEngine.ts DecayEngine.calculateDecayFactorStatic` | jStruct=0.623 contain=0.809 jNames=0.769 | look-alike | Shared clamped half-life; defaults stay 24 and 168. Planned MERGE in P6. |
| K036 | near | `src/core/RefIndex.ts RefIndex.purgeEntity` ; `src/core/RefIndex.ts RefIndex.renameEntity` | jStruct=0.616 contain=0.869 jNames=0.765 | look-alike | Shared reverse-bucket rewrite; per-ref mutation stays in the callback. Planned MERGE in P16. |
| K037 | near | `src/agent/WorkThreadManager.ts WorkThreadManager.claim` ; `src/agent/WorkThreadManager.ts WorkThreadManager.finish` | jStruct=0.615 contain=0.836 jNames=0.733 | look-alike | Same updateThread as K008. Planned MERGE in P10. |
| K038 | near | `src/search/ParallelSearchExecutor.ts ParallelSearchExecutor.executeSemanticLayer` ; `src/search/ParallelSearchExecutor.ts ParallelSearchExecutor.executeLexicalLayer` | jStruct=0.607 contain=0.884 jNames=0.649 | look-alike | Shared timeLayer shell; search calls and the semantic early return stay outside. Planned MERGE in P19. |
| K039 | near | `src/agent/DecayScheduler.ts DecayScheduler.constructor` ; `src/agent/WorkingMemoryManager.ts WorkingMemoryManager.constructor` | jStruct=0.605 contain=0.765 jNames=0.056 | look-alike | `??` fields use fillDefaults; entropy/exclusion stay direct. Planned MERGE in P8. |
| K040 | near | `src/search/BloomFilter.ts BloomFilter.add` ; `src/search/BloomFilter.ts BloomFilter.mayContain` | jStruct=0.603 contain=0.783 jNames=0.917 | look-alike | `add` sets bits and increments `inserted`; `mayContain` returns on the first clear bit. KEEP. |
| K041 | near | `src/agent/AccessTracker.ts AccessTracker.constructor` ; `src/agent/ConsolidationPipeline.ts ConsolidationPipeline.constructor` | jStruct=0.541 contain=0.971 jNames=0.083 | look-alike | `maxDuplicateComparisons` keeps its integer check. Planned MERGE in P8. |
| K042 | near | `src/agent/AccessTracker.ts AccessTracker.constructor` ; `src/agent/MemoryFormatter.ts MemoryFormatter.constructor` | jStruct=0.528 contain=0.905 jNames=0.063 | look-alike | Each constructor merges its own `??` defaults. Planned MERGE in P7. |
| K043 | near | `src/agent/MemoryFormatter.ts MemoryFormatter.constructor` ; `src/agent/SessionManager.ts SessionManager.constructor` | jStruct=0.5 contain=0.905 jNames=0.053 | look-alike | Each constructor merges its own `??` defaults. Planned MERGE in P7. |
| K044 | near | `src/agent/ConsolidationPipeline.ts ConsolidationPipeline.constructor` ; `src/agent/ContextWindowManager.ts ContextWindowManager.constructor` | jStruct=0.467 contain=1 jNames=0.069 | look-alike | Same fillDefaults split as K041, paired with ContextWindowManager. Planned MERGE in P8. |
| K045 | near | `src/agent/ObservationDedupManager.ts ObservationDedupManager.findDuplicateObservations` ; `src/agent/ObservationDedupManager.ts ObservationDedupManager.findJaccardDuplicates` | jStruct=0.453 contain=0.925 jNames=0.615 | look-alike | Shared hash bucket; union-find and exact-group return stay separate. Planned MERGE in P20. |
| K046 | near | `src/cli/commands/heuristic.ts registerHeuristicCommands` ; `src/cli/commands/observationDedup.ts registerObservationDedupCommands` | jStruct=0.426 contain=0.933 jNames=0.227 | look-alike | CLI registrars bind different commands, flags, and handlers. KEEP. |
| K047 | near | `src/agent/SessionQueryBuilder.ts SessionQueryBuilder.search` ; `src/agent/SessionQueryBuilder.ts SessionQueryBuilder.execute` | jStruct=0.382 contain=0.935 jNames=0.448 | look-alike | Shared default collect; custom `searchFunction` stays in search. Planned MERGE in P21. |
| K048 | near | `src/agent/ConsolidationPipeline.ts ConsolidationPipeline.constructor` ; `src/agent/MemoryFormatter.ts MemoryFormatter.constructor` | jStruct=0.306 contain=0.905 jNames=0.042 | look-alike | Same fillDefaults split as K041, paired with MemoryFormatter. Planned MERGE in P8. |
| K049 | near | `src/search/BasicSearch.ts BasicSearch.openNodes` ; `src/search/BooleanSearch.ts BooleanSearch.booleanSearch` | jStruct=0.235 contain=0.909 jNames=0.227 | look-alike | `openNodes` induces relations on entities that exist; boolean cache hits use the cached name set. KEEP. |
| K050 | near | `src/core/GraphStorage.ts GraphStorage.applyCacheMutation` ; `src/core/SQLiteStorage.ts SQLiteStorage.deleteRelations` | jStruct=0.199 contain=0.982 jNames=0.315 | boundary | Snapshot relation-delete helper; SQL and the JSONL rewrite stay put. Planned MERGE in P23. |
| K051 | near | `src/core/GraphStorage.ts GraphStorage.applyCacheDeletion` ; `src/core/SQLiteStorage.ts SQLiteStorage.deleteEntities` | jStruct=0.177 contain=0.978 jNames=0.366 | boundary | Snapshot entity-delete helper; SQL and the JSONL rewrite stay put. Planned MERGE in P23. |
