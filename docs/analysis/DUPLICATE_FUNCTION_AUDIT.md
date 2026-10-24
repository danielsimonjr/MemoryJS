# Duplicate Function Audit

**Date**: 2026-10-22
**Commit audited**: `6a20b5c` on `master`
**Scope**: `src/` only. 292 TypeScript files. 1,372 functions of 50 or more normalised syntax-tree nodes.
**Status**: Read-only analysis. No source file changed.

> This report lists copied and near-copied functions and proposes a merge target for each family.
> `SIMPLIFICATION_AUDIT.md` covers a different topic (abstraction layering). This report does not repeat it.
> Line numbers refer to the audited commit. Check them again before you edit.

---

## 1. Summary

Two automatic detectors proposed 299 candidate pairs. An automated first-pass review judged 217 of them and added 16 cases from its own reading.
Each finding in Section 4 was then compared by hand, line by line, against the code. The evidence field of each family says what was read.

| Measure | Value |
|---|---|
| Functions analysed (50 or more normalised nodes) | 1,372 |
| Groups with identical normalised syntax | 20 groups (40 functions) |
| Structural candidate pairs kept (similarity 0.60 or more) | 145 (20 identical, 125 near) |
| Semantic candidate pairs (embedding similarity 0.88 or more, not structural) | 154 |
| Pairs in the first-pass review | 217 (145 structural, 72 semantic at 0.90 or more) |
| Semantic pairs not reviewed (0.88 to 0.90) | 82 |
| Extra cases added by the first-pass review | 16 |
| Refactor families in this report | 26 |
| Behaviour differences and defects (Section 5) | 13 |

Most functions sit in two folders. `src/agent` holds 546 of the 1,372 analysed functions and `src/search` holds 268.

### Main conclusions

1. **Exact and near-exact copies exist and are cheap to remove.** R11 has three copies of a key=value line decoder. R02 has two identical cache helpers in the two storage classes. R08 has identical delete and clear methods in the tiered stores. R19 has several copied escape helpers.
2. **The largest duplicated mass is in the two storage classes.** `GraphStorage` and `SQLiteStorage` repeat the same append, delete and cache steps (R01, R02). Entity and relation methods repeat each other inside each class.
3. **Some copies have drifted apart.** Section 5 lists 13 differences and defects. Decide the behaviour first. Then merge the code.
4. **Many small utilities exist more than once.** Hashes, cosine similarity, Jaccard similarity, sleep, timeouts and heaps each have two to nine copies (R16 to R21).
5. **Some similar code must stay separate.** Examples are the two procedural-graph backings, the constructors and the sync/async validator pair (Section 6).

### Families by priority

| ID | Family | Priority | Effort | Risk |
|---|---|---|---|---|
| R03 | Lowercase view of an entity | P1 | S | Low |
| R08 | Tiered column stores | P1 | M | Low |
| R11 | Key=value line codec | P1 | S | Low |
| R12 | One-axis twins in agent managers | P1 | M | Low |
| R13 | Half-life decay formula | P1 | S | Low |
| R16 | Hash functions | P1 | S | Low |
| R19 | String escapes | P1 | S | Low |
| R20 | Tag and filter predicates | P1 (after D3) | S | Low |
| R22 | Embedding batch methods | P1 | S | Low |
| R24 | Governance audit recorders | P1 | S | Low |
| R02 | Cache step in the two storages | P2 | M | Medium |
| R04 | SQLite statement twins | P2 | M | Low |
| R05 | Transaction operation switch | P2 | M | Medium |
| R07 | Segment storage helpers | P2 (after D4) | S | Medium |
| R09 | Cache eviction, TTL cleanup, debounce | P2 | M | Low |
| R10 | Lifecycle transition helpers | P2 | M | Medium |
| R14 | Record type guards | P2 | M | Low |
| R15 | Validators and field-path getters | P2 | M | Low |
| R17 | Similarity and normalisation math | P2 | M | Medium |
| R18 | Sleep, timeout and chunk helpers | P2 (after D5) | S | Low |
| R21 | Bounded heaps and vector top-k | P2 | M | Medium |
| R23 | Search-layer twins | P2 | M | Medium |
| R25 | CLI action wrapper | P2 | M | Low |
| R26 | Export skeletons and sidecar loaders | P3 | M | Low |
| R01 | Entity and relation append twins | P3 | L | Medium |
| R06 | JSONL load paths | P3 (after D1) | M | High |

---

## 2. Method

### 2.1 Candidate generation

Two detectors and one review produced the candidates.

1. **Syntax-tree clone detector.** A parser read every `.ts` file under `src/`. For each function of 50 or more nodes, the detector wrote a sequence of node kinds. Names and literal values do not enter the sequence. An identical sequence gives an exact group. Overlapping 6-gram shingles give a Jaccard score for near pairs. The cut-off for a near pair was 0.60. The detector dropped 32 pairs that were nested or overlapping in one file.
2. **Embedding detector.** An embedding model scored the text of each function. A pair with cosine 0.88 or more became a semantic candidate. The first detector had not reported that pair.
3. **First-pass review.** An automated review read both bodies of each pair. It gave one verdict: duplicate, parameterize, shared helper, real difference, or false positive. It also proposed a merge target and a risk.

### 2.2 Check of the detector

A test fixture held a planted exact clone, a planted near clone and an unrelated function. The detector grouped the exact clone with similarity 1.0. It scored the near clone at 0.676. It did not flag the unrelated function.

### 2.3 Check of the findings

A first-pass verdict is a hint, not a result. Each family in Section 4 was compared by hand against the code. For the 20 exact groups, a script printed the difference of the two de-indented bodies. A second script checked that every `src/...:LINE` citation in this report names a symbol at that line.

### 2.4 Evidence levels

| Level | Meaning |
|---|---|
| **Read** | Both bodies were read and compared line by line. |
| **Read (partial)** | The start of the difference, or one body, was read. The evidence field names the unread part. |
| **Executed** | A command ran and its output confirmed the claim. |
| **First pass only** | The automated first-pass review gave the verdict. Nobody re-read the code. |

A test run did not prove any equivalence claim in this report. "Identical" means identical text after the removal of indentation. "Same behaviour" means that reading found no difference.

### 2.5 Test counts

Each family lists test counts. A count is the number of files under `tests/` that contain both the class name and a call pattern, or the symbol name alone. The scan covered 385 test files.

A count is not coverage. A test file may name a class and not exercise the method. A count of 0 means that no test file names the symbol. A test may still reach the symbol through a caller.

---

## 3. Priority and effort

| Value | Meaning |
|---|---|
| P1 | Remove or delegate. Behaviour stays the same. One small commit per family. |
| P2 | Merge after you add a parameter. Add a test for the parameter first. |
| P3 | Needs a design decision or touches a hot path. Plan it separately. |
| S / M / L | Under 100 changed lines / under 400 / over 400. |
| Risk | The chance of a silent behaviour change when you merge the family. |

---

## 4. Findings by family

### R01 Entity and relation append twins

**Evidence**: Read. A diff compared each entity form with its relation form (four pairs). The single-against-batch pairs are candidates only. Nobody compared them line by line.

| Class | Entity single | Relation single | Entity batch | Relation batch |
|---|---|---|---|---|
| `GraphStorage` | `src/core/GraphStorage.ts:870` `appendEntity` | `src/core/GraphStorage.ts:987` `appendRelation` | `src/core/GraphStorage.ts:932` `appendEntities` | `src/core/GraphStorage.ts:1041` `appendRelations` |
| `SQLiteStorage` | `src/core/SQLiteStorage.ts:1073` `appendEntity` | `src/core/SQLiteStorage.ts:1137` `appendRelation` | `src/core/SQLiteStorage.ts:1102` `appendEntities` | `src/core/SQLiteStorage.ts:1214` `appendRelations` |

- **What is the same**: the order of steps in each method.
- **What differs**: five points. The cache upsert function. The segment route key (entity name or relation `from`). The generation counter that is bumped. The event that is emitted. The serializer.
- **Merge target**: one private method per class that takes a small descriptor with these five points. Keep the public methods as thin callers.
- **Risk**: Medium. The generation counter and the event feed derived indexes.
- **Tests**: `GraphStorage` single forms 17 and 10 files, batch forms 1 and 1. `SQLiteStorage` single forms 7 and 5, batch forms 1 and 1. The batch forms have the thinnest tests.

### R02 Cache step in the two storages

**Evidence**: Read for `upsertRelationInCache` and `deleteEntities`. Read (partial) for the other rows: the shared validation and cache steps were compared, the persistence steps were not.

| Pair | GraphStorage | SQLiteStorage | Result |
|---|---|---|---|
| Relation upsert | `src/core/GraphStorage.ts:822` `upsertRelationInCache` | `src/core/SQLiteStorage.ts:1187` `upsertRelationInCache` | Identical text. |
| Entity upsert | `src/core/GraphStorage.ts:784` `upsertEntityInCache` | `src/core/SQLiteStorage.ts:1040` `upsertEntityInCache` | `GraphStorage` writes the lowercase view and the observation index inline. `SQLiteStorage` calls `updateLowercaseCache` and has no observation index. |
| Delete entities | `src/core/GraphStorage.ts:1469` `deleteEntities` | `src/core/SQLiteStorage.ts:1468` `deleteEntities` | Same name set, same filters, same generation bumps, same events. Persistence differs. |
| Delete relations | `src/core/GraphStorage.ts:1568` `deleteRelations` | `src/core/SQLiteStorage.ts:1570` `deleteRelations` | Persistence differs. |
| Update entities | `src/core/GraphStorage.ts:1323` `updateEntities` | `src/core/SQLiteStorage.ts:1367` `updateEntities` | Validation matches. Persistence differs. |

- **Persistence difference in `deleteEntities`**: `GraphStorage` saves segments or rewrites the file. `SQLiteStorage` toggles foreign keys and runs a SQL transaction.
- **Cache difference in `deleteEntities`**: the `GraphStorage` closure `applyCacheDeletion` also clears the observation index and uses `lowercaseCache.remove`. `SQLiteStorage` calls `lowercaseCache.delete` on a plain map.
- **Merge target**: move the two upsert functions and the index-removal step to a new shared module in `src/core`. Both classes call it. A later step can split each mutation into plan, persist and apply-to-cache. The plan and apply parts are then shared.
- **Risk**: Medium. The foreign-key toggle in `SQLiteStorage.deleteEntities` must stay outside the shared code.
- **Tests**: `deleteEntities` 10 files (`GraphStorage`) and 5 (`SQLiteStorage`). `deleteRelations` 3 and 1. `updateEntities` 1 and 1.

### R03 Lowercase view of an entity

**Evidence**: Read. The three bodies compute the same four fields.

| Site | Location |
|---|---|
| Class method | `src/utils/indexes.ts:135` `LowercaseCache.computeLowercase` |
| SQLite copy | `src/core/SQLiteStorage.ts:840` `updateLowercaseCache` |
| PostgreSQL copy | `src/core/PostgreSQLStorage.ts:513` `getLowercased` |

- **What is the same**: lowercase `name`, lowercase `entityType`, lowercase observations, and lowercase tags (empty list when none).
- **What differs**: where the result goes. `LowercaseCache` stores it. `SQLiteStorage` stores it in a plain map. `PostgreSQLStorage` computes it on every call and stores nothing.
- **Merge target**: export `computeLowercase` as a pure function from `indexes.ts`. All three sites call it. Do not add a cache to `PostgreSQLStorage`.
- **Risk**: Low. The result type `LowercaseData` stays the same.
- **Tests**: `LowercaseCache` 1 file. `getLowercased` 5 files. `PostgreSQLStorage` 1 file.

### R04 SQLite statement twins

**Evidence**: Read for the relation queries and for the row-binding pair. Read (partial) for the migrations: the shared pattern was confirmed, the column lists were not compared.

| Group | Sites | Difference |
|---|---|---|
| Relation queries | `src/core/SQLiteStorage.ts:2224` `getRelationsFrom`, `src/core/SQLiteStorage.ts:2244` `getRelationsTo`, `src/core/SQLiteStorage.ts:2264` `getRelationsFor` | Each method first asks `relationIndex` when the cache is loaded. Otherwise it runs one SQL statement. Only the index method and the `WHERE` clause differ. `getRelationsFor` uses `fromEntity = ? OR toEntity = ?` and binds the name twice. |
| Migrations | `src/core/SQLiteStorage.ts:553` `migrateRelationsTable`, `src/core/SQLiteStorage.ts:579` `migrateEntitiesTable`, `src/core/SQLiteStorage.ts:647` `migrateEmbeddingsTable` | Each reads `table_info` and adds the missing columns. Table name and column list differ. |
| Entity row binding | `src/core/SQLiteStorage.ts:1010` `runEntityUpsert`, `src/core/SQLiteStorage.ts:1328` `runEntityUpdateRow` | Both bind the same entity fields in the same order. The upsert binds `name` first and `createdAt`, and it defaults both timestamps. The update omits both and binds `entityName` last. |

- **Merge target**: a private `ensureColumns(table, columns)` for the migrations. A private function that returns the shared bind values for the two entity statements. A `relationsWhere` helper for the three queries.
- **Risk**: Low. Each SQL text stays in its own constant.
- **Tests**: `getRelationsFrom` 3 files, `getRelationsTo` 2, `getRelationsFor` 3. The stem "migrat" appears in 5 test files that name `SQLiteStorage`.

### R05 Transaction operation switch

**Evidence**: Read. The five shared cases were compared.

| Site | Location |
|---|---|
| Transaction | `src/core/TransactionManager.ts:301` `TransactionManager.applyOperation` |
| Batch | `src/core/TransactionManager.ts:645` `BatchTransaction.applyBatchOperation` |

- **What is the same**: five cases (create, update and delete entity; create and delete relation). The graph change in each case is the same text, apart from labels and counters.
- **What differs**: the batch form increments counters. It also handles `addObservations` and `deleteObservations`.
- **Merge target**: one module-level function that applies one operation to the graph and returns what changed. The batch form counts from the return value and handles the two extra cases itself.
- **Risk**: Medium. Duplicate checks throw errors. Keep the error codes.
- **Tests**: `TransactionManager` 6 files, `BatchTransaction` 3 files. The two extra batch operations appear in 3 files.

### R06 JSONL load paths

**Evidence**: Read. Both bodies.

| Site | Location |
|---|---|
| Whole-file read | `src/core/GraphStorage.ts:470` `loadFromDisk` |
| Memory-mapped read | `src/core/GraphStorage.ts:677` `loadViaMmap` |

- **What is the same**: the work for each record. Each path sanitizes the record, fills `createdAt` and `lastModified` when missing, and keys the maps. Each then builds the cache and the indexes and calls `emitGraphLoaded`.
- **What differs**: the read loop and the policy for a malformed line (D1).
- **Merge target**: two private helpers. One ingests a record. One commits the loaded graph. The malformed-line policy becomes an explicit argument.
- **Risk**: High until D1 is decided. A merge that picks one policy changes the other path.
- **Tests**: 4 files name the mmap switch, the mmap backend or `loadViaMmap`.

### R07 Segment storage helpers

**Evidence**: Read.

| Pair | Location | Result |
|---|---|---|
| Ownership check | `src/core/segments/FileSegmentStorage.ts:396` `assertOwnership`, `src/core/segments/ISegmentStorage.ts:209` `InMemorySegmentStorage.saveSegment` | The check is a copy. Only the class name in the error message differs. |
| Temp file write | `src/core/segments/FileSegmentStorage.ts:643` `writeTmpFile`, `src/utils/durableWriteFile.ts:73` `durableWriteFile` | Both build the temp name `${target}.tmp.${process.pid}.${randomBytes(6)}`, open it, write, sync and close. See D4 for the mode difference. |

- **What differs in the temp write**: `durableWriteFile` opens with flag `'wx'` and a restricted mode. It also makes the parent directory, renames the file and syncs the parent. `writeTmpFile` opens with flag `'w'` and the default mode. A comment in the file explains why it stays standalone: the two-phase `saveAll`.
- **Merge target**: export one ownership check from `ISegmentStorage.ts`. Export one helper from `durableWriteFile.ts` that returns the synced temp path. `durableWriteFile` adds the rename and the parent sync. `writeTmpFile` keeps its two-phase commit.
- **Risk**: Medium for the temp write (D4). Low for the ownership check.
- **Tests**: `FileSegmentStorage` 3 files, `InMemorySegmentStorage` 1, `durableWriteFile` 3.

### R08 Tiered column stores

**Evidence**: Read. A diff of each pair below.

`JsonlColumnStore`, `DiskWarmTier` and `BrotliColdTier` share one skeleton: a map cache, a mutex, a rollback on a failed flush, and a load from disk.

| Method | Locations | Result |
|---|---|---|
| `put` | `src/core/columns/JsonlColumnStore.ts:102` `put`, `src/search/tiered/BrotliColdTier.ts:126` `put` | Identical except parameter names and comments. |
| `delete` | `src/search/tiered/BrotliColdTier.ts:146` `delete`, `src/search/tiered/DiskWarmTier.ts:176` `delete` | Identical text. `src/core/columns/JsonlColumnStore.ts:125` `delete` restores one value on rollback. The tiered stores restore the whole map. |
| `clear` | `src/search/tiered/BrotliColdTier.ts:170` `clear`, `src/search/tiered/DiskWarmTier.ts:200` `clear` | Identical except comment lines. `src/core/columns/JsonlColumnStore.ts:180` `clear` has no mutex wrapper. |
| `flush` | `src/core/columns/JsonlColumnStore.ts:261` `flush`, `src/search/tiered/DiskWarmTier.ts:267` `flush` | Same loop. The line format differs: `{name,value}` against `{k,v}`. The target path field differs. |
| `loadFromDisk` | `src/core/columns/JsonlColumnStore.ts:232` `loadFromDisk`, `src/search/tiered/DiskWarmTier.ts:238` `loadFromDisk`, `src/search/tiered/BrotliColdTier.ts:240` `loadFromDisk` | Same shape. `BrotliColdTier` decompresses first. The path field and the line keys differ. |

- **Merge target**: an abstract base class with hooks for the line format, the path and the file read and write. `put`, `delete`, `clear`, `flush` and `loadFromDisk` live once in the base.
- **Risk**: Low. The on-disk format of each store must stay the same. Add a round-trip test per store first.
- **Tests**: `JsonlColumnStore` 3 files, `DiskWarmTier` 4, `BrotliColdTier` 3.

### R09 Cache eviction, TTL cleanup and debounce

**Evidence**: Read for every row except the plan-cache setters, which were read in part.

| Group | Sites | Result |
|---|---|---|
| Identical eviction | `src/search/RankedSearch.ts:161` `evictTo`, `src/utils/searchCache.ts:350` `evictTo` | Identical except the map field. |
| TTL cleanup | `src/search/BooleanSearch.ts:128` `cleanupResultCache`, `src/search/FuzzySearch.ts:320` `cleanupCache` | Same logic. The map, the TTL constant and the size constant differ. |
| Eviction | `src/search/EmbeddingCache.ts:322` `evictTo`, `src/search/QueryPlanCache.ts:494` `evictTo` | Both sort by access time and delete the oldest. `QueryPlanCache` first drops expired entries and counts evictions. The time field is `lastAccess` in one and `lastAccessed` in the other. |
| Plan cache setters | `src/search/QueryPlanCache.ts:185` `setAnalysis`, `src/search/QueryPlanCache.ts:217` `setPlan` | 4 lines differ. `setPlan` also stores the plan. |
| Debounce | `src/search/GraphRankPrior.ts:188` `scheduleInvalidate`, `src/search/TFIDFEventSync.ts:303` `scheduleFlush` | Same pattern: run now when the delay is zero, return when a timer is open, else set an unreferenced timer. Field names and the zero test differ (`<= 0` and `=== 0`). |

- **Merge target**: one `evictOldest(map, target, timeOf)` function in `src/utils`. A small debouncer class for the two schedulers. `setAnalysis` and `setPlan` share one private writer.
- **Risk**: Low.
- **Tests**: `evictTo` or the two cleanup names 4 files. `SearchCache` 3, `EmbeddingCache` 3, `QueryPlanCache` 3, the debounce names 5.

### R10 Lifecycle transition helpers (agent)

**Evidence**: Read. Every method in the table.

The managers do not share one skeleton. Four different mechanisms exist.

| Manager | Sites | Mechanism |
|---|---|---|
| Work thread | `src/agent/WorkThreadManager.ts:308` `claim`, `src/agent/WorkThreadManager.ts:337` `release`, `src/agent/WorkThreadManager.ts:362` `complete`, `src/agent/WorkThreadManager.ts:386` `cancel` | Look up the thread in a map. Throw when it is missing. Check `canTransition` and throw when illegal. Set the status and `updatedAt`. Persist. Return a copy. `claim` also rejects an owned thread. `complete` and `cancel` differ only in the target status and one message word. |
| Decision | `src/agent/DecisionManager.ts:226` `accept`, `src/agent/DecisionManager.ts:237` `reject`, `src/agent/DecisionManager.ts:253` `supersede` | Return a result string for each case: `not-found`, `already-<state>`, `illegal-transition`. Build the new lifecycle. Call the shared `applyUpdate`. `supersede` also loads the replacement. |
| Plan | `src/agent/PlanManager.ts:293` `markPlanComplete`, `src/agent/PlanManager.ts:310` `abandonPlan` | Identical frame. Only the status literal and the two field names differ. |
| Failure and reflection | `src/agent/FailureManager.ts:243` `markResolved`, `src/agent/AgentReflectionManager.ts:233` `archive` | Identical error tail: update with an expected version, then map `VersionConflictError` to `conflict` and `EntityNotFoundError` to `vanished-mid-update`. |

- **Merge target**: merge only inside a manager, or for the identical parts. `markPlanComplete` and `abandonPlan` take one private helper with a status argument. `markResolved` and `archive` take one shared helper for the versioned update and its error mapping. Leave the four mechanisms separate.
- **Risk**: Medium. Each manager returns its own result union, and callers switch on it.
- **Tests**: `WorkThreadManager` 1 file, `DecisionManager` 1, `PlanManager` 1, `FailureManager` 1, `AgentReflectionManager` 2. These transitions have the thinnest tests in the audit. Add a test for every transition before you merge.

### R11 Key=value line codec

**Evidence**: Read. Diffs and the encoder bodies.

| Role | Location | Note |
|---|---|---|
| Decoder | `src/agent/SessionCheckpoint.ts:650` `decodeKeyValueLine` | Identical to the next decoder. |
| Decoder | `src/agent/WorkThreadManager.ts:781` `decodeMetaLine` | Identical text. |
| Decoder | `src/agent/procedural/ProcedureStore.ts:359` `decodeParamLine` | Adds one check: the decoded value must be a string. |
| Encoder | `src/agent/SessionCheckpoint.ts:588` `encodeCheckpointObservations` | Writes decay lines and metadata lines. |
| Encoder | `src/agent/WorkThreadManager.ts:690` `encodeThreadObservations` | Writes metadata lines. |
| Encoder | `src/agent/procedural/ProcedureStore.ts:319` `encodeStepObservations` | Writes parameter lines. |

- **What differs in the encoders**: the metadata lines skip a value when `JSON.stringify` returns `undefined`. The decay lines and the parameter lines do not skip it.
- **Merge target**: a new module in `src/agent` with an encode function and a decode function for one prefixed line. The encoder takes a flag for the `undefined` case. Decide the flag with a test.
- **Risk**: Low for the decoders. Medium for the encoders, because the stored line format must not change.
- **Tests**: the three decoder names appear in 0 test files. `SessionCheckpointManager` appears in 1 file, `ProcedureStore` in 1, `WorkThreadManager` in 1.

### R12 One-axis twins in agent managers

**Evidence**: Read. Every pair below, except `linkEvents` and `addCausalLink`, where only the shared pattern was confirmed.

| Pair | Locations | Axis |
|---|---|---|
| Causes and effects | `src/agent/EpisodicMemoryManager.ts:453` `getDirectCauses`, `src/agent/EpisodicMemoryManager.ts:475` `getDirectEffects` | Direction. `getRelationsTo` with `rel.from`, against `getRelationsFrom` with `rel.to`. Both keep only `CAUSES` relations. |
| Cause and effect chains | `src/agent/causal/CausalReasoner.ts:105` `findCauses`, `src/agent/causal/CausalReasoner.ts:133` `findEffects` | The argument order of `findAllPaths`. The rest is identical. |
| Timeline | `src/agent/EpisodicMemoryManager.ts:253` `getTimeline`, `src/agent/EpisodicMemoryManager.ts:499` `getAllEpisodes` | `getAllEpisodes` is `getTimeline` without the `sessionId` filter. |
| Event links | `src/agent/EpisodicMemoryManager.ts:202` `linkEvents`, `src/agent/EpisodicMemoryManager.ts:373` `addCausalLink` | Both write a relation and its reverse relation. A shared helper is plausible. |
| Tool call end | `src/agent/ToolCallObserver.ts:76` `observeComplete`, `src/agent/ToolCallObserver.ts:98` `observeError`, `src/agent/ToolCallObserver.ts:123` `observePartial` | Same frame: take the entry, delete it, compute the duration, record the outcome, emit an event. The outcome, the error text, the event name and the payload differ. |
| Decay queries | `src/agent/DecayEngine.ts:485` `getDecayedMemories`, `src/agent/DecayEngine.ts:516` `getMemoriesAtRisk` | The predicate only: below the threshold, or between `minImportance` and the threshold. |
| Decay run | `src/agent/DecayScheduler.ts:175` `runDecayCycle`, `src/agent/DecayScheduler.ts:218` `runNow` | Both run decay, then forget when configured. See D11 for the callback difference. |
| Access lists | `src/agent/AccessTracker.ts:242` `getFrequentlyAccessed`, `src/agent/AccessTracker.ts:294` `getRecentlyAccessed` | The sort key. The window, score and slice steps are shared. |
| Context retrieval | `src/agent/ContextWindowManager.ts:641` `retrieveWorkingMemory`, `src/agent/ContextWindowManager.ts:734` `retrieveSemanticRelevant` | The memory type, and an optional session filter. |
| Visibility | `src/agent/MultiAgentMemoryManager.ts:331` `getVisibleMemories`, `src/agent/MultiAgentMemoryManager.ts:500` `filterByVisibility` | The loops are identical. `getVisibleMemories` loads the graph and can call `filterByVisibility` on `graph.entities`. |
| Conflict similarity | `src/agent/ConflictResolver.ts:150` `calculateSimilarity`, `src/agent/ConflictResolver.ts:228` `textSimilarity` | `calculateSimilarity` repeats the body of `textSimilarity` after it builds two strings. It can call it. |
| Pending and fired | `src/agent/ProspectiveMemoryManager.ts:205` `getPending`, `src/agent/ProspectiveMemoryManager.ts:217` `getFired` | Weak. Only the three-line session and agent filter is shared. Status, sort and the `sinceDate` filter differ. |

- **Merge target**: delegate or add one parameter per row. Do the pure delegations first: `getVisibleMemories`, `calculateSimilarity` and `getAllEpisodes`.
- **Risk**: Low. Each row changes one method pair.
- **Tests**: `EpisodicMemoryManager` 3 files, `ToolCallObserver` 2, `DecayEngine` 12, `DecayScheduler` 1, `AccessTracker` 13, `ContextWindowManager` 9, `MultiAgentMemoryManager` 1, `ConflictResolver` 3, `CausalReasoner` 3, `ProspectiveMemoryManager` 2.

### R13 Half-life decay formula

**Evidence**: Read. All six bodies.

Six sites compute `exp(-ln(2) / halfLife * ageHours)`.

| Site | Location | Half-life | Result guard |
|---|---|---|---|
| Instance | `src/agent/AccessTracker.ts:192` `calculateRecencyScore` | Argument, else the configured value | Returns 0 without a record. Clamped to [0, 1]. |
| Static | `src/agent/AccessTracker.ts:219` `calculateRecencyScoreFromTimestamp` | Argument, default 24 h | Returns 0 without a timestamp. Clamped to [0, 1]. |
| Instance | `src/agent/DecayEngine.ts:196` `calculateDecayFactor` | Argument, scaled by importance and by a TTL multiplier | Returns 0 without a timestamp. Clamped to [0, 1]. |
| Static | `src/agent/DecayEngine.ts:242` `calculateDecayFactorStatic` | Argument, default 168 h | Returns 0 without a timestamp. Clamped to [0, 1]. |
| Score | `src/agent/DistillationPolicy.ts:192` `scoreRecency` | Fixed 24 h | Returns 0 without a timestamp. **Not clamped** (D10). |
| Freshness | `src/features/FreshnessManager.ts:94` `calculateFreshness` | Configured value | Age floored at 0. Used only when the entity has no TTL. With a TTL, the score falls linearly. |

- **What is the same**: the two static methods are identical except for the default half-life.
- **Merge target**: one pure function `halfLifeFactor(ageHours, halfLifeHours)` in `src/utils`. The six callers keep their own default, guard and clamp. Do not merge the defaults. They differ on purpose.
- **Risk**: Low.
- **Tests**: `calculateRecencyScoreFromTimestamp` 1 file, `calculateDecayFactorStatic` 1, `calculateRecencyScore` 2, `FreshnessManager` 1, `scoreRecency` 1.

### R14 Record type guards

**Evidence**: Read for `isProspectiveMemory`, `isFailureMemory`, `isPlanMemory` and the four trivial guards. A diff compared `isHeuristicMemory` with `isExclusionMemory`: one record field and its four property checks differ. First pass only for the other four.

The module `src/types/agent-memory.ts` holds nine record guards of one shape.

| Guard | Location |
|---|---|
| Prospective | `src/types/agent-memory.ts:1213` `isProspectiveMemory` |
| Failure | `src/types/agent-memory.ts:1344` `isFailureMemory` |
| Plan | `src/types/agent-memory.ts:1466` `isPlanMemory` |
| Reflection | `src/types/agent-memory.ts:1546` `isReflectionMemory` |
| Heuristic | `src/types/agent-memory.ts:1605` `isHeuristicMemory` |
| Exclusion | `src/types/agent-memory.ts:1674` `isExclusionMemory` |
| Decision | `src/types/agent-memory.ts:1747` `isDecisionMemory` |
| Project context | `src/types/agent-memory.ts:1814` `isProjectContextMemory` |
| Tool affordance | `src/types/agent-memory.ts:1877` `isToolAffordanceMemory` |

- **What is the same**: each guard calls `isAgentEntity` and tests one `memoryType` literal. Each casts the record property to an object with optional `unknown` fields. Each ends with a chain of `typeof` checks.
- **What differs**: the literal, the record property name, and the checked fields. `isProspectiveMemory` checks that `lifecycle.status` is one of four strings. `isFailureMemory` checks `id` and `lifecycle`. `isPlanMemory` checks `id`, `rootGoal` and `lifecycle`.
- **Four trivial guards**: `src/types/agent-memory.ts:1034` `isWorkingMemory` and the three guards after it test only the `memoryType` literal.
- **Merge target**: one factory in the same file. The lint rule keeps `src/types` a leaf layer, so the factory must live in `src/types`. The type predicates need a generic parameter.
- **Risk**: Low.
- **Tests**: `isFailureMemory` 1 file, `isPlanMemory` 1, `isReflectionMemory` 1. The five other guards appear in 0 test files.

### R15 Validators and field-path getters

**Evidence**: Read for the seven rule builders listed and for the three getters.

| Group | Sites |
|---|---|
| Rule builders | `src/utils/validators.ts:52` `minLength`, `src/utils/validators.ts:68` `maxLength`, `src/utils/validators.ts:84` `pattern`, `src/utils/validators.ts:105` `range`, `src/utils/validators.ts:168` `minItems`, `src/utils/validators.ts:184` `maxItems`, `src/utils/validators.ts:200` `email` |
| Dot-path getters | `src/utils/validators.ts:14` `getField`, `src/utils/EntityValidator.ts:270` `getFieldValue` |
| Slash-path getter | `src/features/ObservableDataModelAdapter.ts:135` `getByPath` |

- **Rule builders**: each returns `{ name, field, message, validate }`. `validate` reads the field, returns valid when the type is wrong, and applies one predicate. Only the name, the message, the type test and the predicate differ.
- **Dot-path getters**: the two bodies are identical text.
- **Slash-path getter**: a different contract. It splits on `/`, drops empty segments, returns `undefined` for an empty path or `/`, and range-checks array indexes. `getField` splits on `.`, reads an index only when the segment is all digits, and does no range check. A comment says `getByPath` mirrors a function in an external package on purpose. Keep it separate.
- **Merge target**: a builder function for the rule builders. For the dot-path getters, export one function from a new third module. `validators.ts` imports a type from `EntityValidator.ts` today. A runtime import in the other direction would make a type-and-runtime cycle.
- **Risk**: Low.
- **Tests**: `minLength` 5 files, `maxLength` 4, `EntityValidator` 1, `validateSync` 1.

### R16 Hash functions

**Evidence**: Read. All sites. The equality of the two FNV functions comes from reading, not from a test.

| Site | Location | Result |
|---|---|---|
| FNV-1a | `src/core/segments/ISegmentStorage.ts:99` `fnv1a32` | Same steps and constants as `fnv1aHash`. |
| FNV-1a | `src/utils/entityUtils.ts:46` `fnv1aHash` | Same. |
| FNV-1a, two seeds | `src/search/BloomFilter.ts:114` `doubleHash` | A variant. The first hash follows the same steps. The second uses another seed and is forced odd. |
| 31-multiplier | `src/agent/ConsolidationPipeline.ts:765` `hashPattern` | Hex string cut to 8 characters. The result feeds entity names. |
| 31-multiplier | `src/agent/WorkingMemoryManager.ts:192` `hashContent` | Hex string. |
| 31-multiplier | `src/search/EmbeddingService.ts:879` `hashString` | Returns the signed number. |

- **Merge target**: `fnv1a32` and `fnv1aHash` become one function with a re-export. One shared `hash31` returns the signed number. The two string forms wrap it. Keep the output of `hashPattern` bit-identical, because stored entity names depend on it.
- **Risk**: Low if every output stays identical. Add a golden-value test per function first.
- **Tests**: `fnv1a32` 1 file, `fnv1aHash` 3, `BloomFilter` 1. The three 31-multiplier helpers appear in 0 test files.

### R17 Similarity and normalisation math

**Evidence**: Read. All sites.

| Group | Sites | Note |
|---|---|---|
| Cosine | `src/utils/textSimilarity.ts:75` `cosineSimilarity`, `src/search/QuantizedVectorStore.ts:377` `cosineSimilarity`, `src/agent/RelationConsolidator.ts:233` `cosineSimilarity` | Three contracts (D6). |
| Jaccard helper | `src/utils/textSimilarity.ts:133` `jaccard` | Returns 0 when both sets are empty. Already used by four modules. |
| Jaccard, own function | `src/agent/CognitiveLoadAnalyzer.ts:283` `jaccardSimilarity` | Returns 1 when both sets are empty. |
| Jaccard, inline | `src/agent/ConflictResolver.ts:150` `calculateSimilarity`, `src/agent/ConflictResolver.ts:228` `textSimilarity`, `src/agent/MemoryEngine.ts:548` `checkTierJaccard`, `src/agent/DistillationPolicy.ts:240` `isNearDuplicate`, `src/agent/procedural/ProcedureManager.ts:174` `matchProcedure`, `src/agent/ObservationDedupManager.ts:127` `findJaccardDuplicates`, `src/search/NGramIndex.ts:127` `query` | Seven inline intersection-over-union computations in six files. |
| Entity similarity | `src/features/CompressionManager.ts:85` `calculateEntitySimilarity`, `src/features/CompressionManager.ts:147` `calculatePreparedSimilarity` | Same weights and steps. The first builds sets on every call. The second takes prepared sets (D7). |
| Min-max scaling | `src/search/GraphRankPrior.ts:366` `minMaxNormalize`, `src/search/HybridScorer.ts:116` `minMaxNormalize` | Same behaviour. A comment in `GraphRankPrior` says it mirrors `HybridScorer`. Only comments and the form of the early return differ. |
| Inverse document frequency | `src/utils/searchAlgorithms.ts:130` `calculateIDF`, `src/utils/searchAlgorithms.ts:163` `calculateIDFFromTokenSets` | Same formula, `log(N / df)`. The first tokenizes every document on every call and uses `includes`. The second takes token sets and uses `has`. |

- **Callers of the shared helper today**: `ExperienceExtractor`, `TrajectoryCompressor`, `GraphTraversal` and `HybridSearchManager`.
- **Merge target**: the inline Jaccard sites call `jaccard`. `calculateEntitySimilarity` builds two prepared entities and calls `calculatePreparedSimilarity`. One `minMaxNormalize` goes to `src/utils`. `calculateIDF` builds token sets and calls the second form.
- **Risk**: Medium. The empty-set result differs between the two Jaccard forms (0 and 1). Decide the contract. Then add a test for the empty case.
- **Tests**: `cosineSimilarity` 1 file, `jaccard` 4, `minMaxNormalize` 2, `calculateIDF` 2, `calculateEntitySimilarity` 1, `jaccardSimilarity` 0.
- **Outcome**: `textSimilarity.cosineSimilarity` and the cosine of `RelationConsolidator` share `cosineParts`. The two entity-similarity methods share `weightedEntitySimilarity`. The IDF pair and the cosine of `QuantizedVectorStore` stay separate (section 6).

### R18 Sleep, timeout and chunk helpers

**Evidence**: Read. All sites.

| Group | Sites |
|---|---|
| Named sleep | `src/search/EmbeddingService.ts:281` `sleep`, `src/utils/BatchProcessor.ts:332` `sleep`, `src/utils/durableWriteFile.ts:228` `delay` |
| Inline sleep | `src/search/IncrementalIndexer.ts:396` `setTimeout`, `src/utils/taskScheduler.ts:347` `setTimeout`, `src/utils/taskScheduler.ts:523` `setTimeout`, `src/utils/taskScheduler.ts:574` `setTimeout` |
| Timeout promise | `src/utils/BatchProcessor.ts:323` `createTimeout`, `src/search/ParallelSearchExecutor.ts:374` `createTimeout` |
| Chunking | `src/utils/BatchProcessor.ts:416` `chunkArray`, `src/agent/procedural/graph/ProceduralGraphEvolution.ts:781` `trainingBatches` |

- **Timeout promise**: the `ParallelSearchExecutor` form returns `{ promise, clear }`. The `BatchProcessor` form never clears its timer (D5).
- **Chunking**: `trainingBatches` is `chunkArray` with an early return for one-batch mode and a clamp `Math.max(1, batchSize)` in place of a thrown error. `chunkArray` takes a mutable array, so a call from `trainingBatches` needs a readonly overload.
- **Merge target**: one `sleep(ms)` and one `withTimeout` in `src/utils`. `trainingBatches` calls `chunkArray`.
- **Risk**: Low. Fix D5 in the same commit as the shared timeout.
- **Tests**: `chunkArray` 3 files, `BatchProcessor` 3, the timeout names 1.

### R19 String escapes

**Evidence**: Read. All sites. One first-pass claim was wrong and is corrected below.

| Group | Sites | Result |
|---|---|---|
| CSV cell | `src/features/IOManager.ts:717` `escapeCsvField`, `src/cli/formatters.ts:359` `escapeCSV` | Same behaviour for every input. Both call `escapeCsvFormula`, quote on comma, quote or newline, and double the quotes. |
| CSV cell, always quoted | `src/features/StreamingExporter.ts:324` `entityToCSVRow` | Wraps every cell in quotes. Same escaping steps. |
| Formula guard | `src/utils/entityUtils.ts:702` `escapeCsvFormula` | Shared. Returns the empty string for `null` and `undefined`. |
| Regex escape | `src/features/AutoLinker.ts:66` `escapeRegExp`, `src/features/IOManager.ts:1299` `escapeRegExp`, `src/features/IOManager.ts:1350` `escapeRegExpEdge` | Identical regex and replacement. |
| XML escape | `src/features/IOManager.ts:771` `escapeXml`, `src/features/IOManager.ts:826` `escapeXml` | Identical text (checked with a diff). |
| HTML escape | `src/features/IOManager.ts:73` `escapeHtml` | Same as the XML escape, except it writes `&#39;` for an apostrophe where the XML form writes `&apos;`. |

- **Correction**: the first pass said that `escapeCsvFormula` does not map `null` or `undefined`. The function does map both. The null check in `escapeCsvField` is redundant.
- **Merge target**: export one cell function with an `alwaysQuote` option next to `escapeCsvFormula`. `escapeCSV` keeps its export name, because two CLI command files import it. Export one `escapeRegExp` from `src/utils`. Hoist `escapeXml` to module level next to `escapeHtml`. Keep `escapeHtml` separate.
- **Risk**: Low. `alwaysQuote` must stay, because it decides the bytes that `streamCSV` writes.
- **Tests**: `escapeCSV` 1 file, `escapeCsvFormula` 1, `escapeRegExp` 0, `StreamingExporter` 5.

### R20 Tag and filter predicates

**Evidence**: Read. D3 was also executed.

| Group | Sites | Result |
|---|---|---|
| Shared predicate | `src/utils/entityUtils.ts:242` `hasMatchingTag` | Normalizes both lists, then tests for a shared tag. |
| Inline copies | `src/utils/entityUtils.ts:281` `filterByTags`, `src/search/SearchFilterChain.ts:95` `entityPassesFilters` | Both repeat the predicate inline. The tag block of `entityPassesFilters` is at its start. |
| Caller with double normalization | `src/search/SearchFilterChain.ts:246` `filterByTags` | Calls `hasMatchingTag`, but first normalizes the search tags. The predicate normalizes them again. |
| Filter helper | `src/utils/entityUtils.ts:601` `entityPassesFilters` | Applies importance, type, created-date and modified-date filters through shared helpers. It leaves out tags. |
| Chain filter | `src/search/SearchFilterChain.ts:95` `entityPassesFilters` | Applies the same four filters inline, then tags, project, version and lifecycle. |
| Date helper | `src/utils/entityUtils.ts:354` `isWithinDateRange` | Shared. The chain filter does not call it for dates (D3). |

- **Merge target**: the two tag copies call `hasMatchingTag`. The chain `entityPassesFilters` calls the `entityUtils` version, then applies tags, project, version and lifecycle. The order of checks changes only which filter stops first, not the result.
- **Risk**: Low after D3 is decided.
- **Tests**: `filterByTags` 2 files, `entityPassesFilters` 2, `SearchFilterChain` 4, `hasMatchingTag` 1, `isWithinDateRange` 1.

### R21 Bounded heaps and vector top-k

**Evidence**: Read for the two heaps. Read (partial) for the two vector searches: the start of each body.

| Site | Location |
|---|---|
| Heap, ordered by score and insertion order | `src/search/VectorStore.ts:168` `siftUpWorst`, `src/search/VectorStore.ts:177` `siftDownWorst` |
| Heap, ordered by salience score | `src/agent/SalienceEngine.ts:697` `heapSiftUp`, `src/agent/SalienceEngine.ts:712` `heapSiftDown` |
| Top-k search | `src/search/VectorStore.ts:55` `InMemoryVectorStore.search`, `src/search/QuantizedVectorStore.ts:176` `search` |

- **What is the same**: the sift-up and sift-down loops. Only the comparison differs.
- **What differs**: the vector heap breaks ties by insertion order. The salience heap does not.
- **Merge target**: one bounded heap class in `src/utils` that takes a comparator. The two vector searches use it for top-k.
- **Risk**: Medium, because of the tie rule.
- **Tests**: `InMemoryVectorStore` 4 files, `QuantizedVectorStore` 2, `SalienceEngine` 8.
- **Outcome**: The two heaps stay separate (section 6). The quantized search has no heap. The quantized search sorts every score and slices.

### R22 Embedding batch methods

**Evidence**: Read. The four bodies.

| Site | Location |
|---|---|
| Local | `src/search/EmbeddingService.ts:729` `LocalEmbeddingService.embedBatchWithProgress` |
| Mock | `src/search/EmbeddingService.ts:851` `MockEmbeddingService.embedBatchWithProgress` |
| OpenAI with progress | `src/search/EmbeddingService.ts:168` `OpenAIEmbeddingService.embedBatchWithProgress` |
| OpenAI without progress | `src/search/EmbeddingService.ts:137` `OpenAIEmbeddingService.embedBatch` |

- **Local and Mock**: they differ by one line. Local awaits `ensureInitialized`. Mock does not.
- **OpenAI**: `embedBatch` is `embedBatchWithProgress` without the progress callback. `embedBatch` can call `embedBatchWithProgress` with no callback. Both split the input at the provider batch limit and add a prefix by mode.
- **Merge target**: `embedBatch` calls `embedBatchWithProgress`. A shared function can take the chunk size and the chunk embedder for the Local and Mock pair.
- **Risk**: Low.
- **Tests**: `embedBatchWithProgress` 3 files.

### R23 Search-layer twins

**Evidence**: Read for the FTS, TF-IDF, semantic search, path, tracking and proximity rows. Read (partial) for the layer executors: the first-pass description was checked against the method names and call sites only.

| Group | Sites | Result |
|---|---|---|
| FTS candidates | `src/search/BM25Search.ts:323` `getFtsCandidateNames`, `src/search/RankedSearch.ts:316` `getFtsCandidateNames` | Identical except that `BM25Search` passes `rank: false` (D2). |
| TF-IDF IDF update | `src/search/TFIDFIndexManager.ts:514` `recalculateIDFForTerms`, `src/search/TFIDFIndexManager.ts:548` `recalculateAllIDF` | Both compute `log(N / df)`. The first loops over a given term set. The second clears the map and loops over every term. |
| TF-IDF add and update | `src/search/TFIDFIndexManager.ts:329` `addDocument`, `src/search/TFIDFIndexManager.ts:415` `updateDocument` | The result looks equal by reading. Not executed. Both are public methods. |
| Layer executors | `src/search/HybridSearchManager.ts:381` `executeSemanticSearch`, `src/search/HybridSearchManager.ts:414` `executeLexicalSearch`, `src/search/HybridSearchManager.ts:445` `executeSymbolicSearch`, `src/search/ParallelSearchExecutor.ts:205` `executeSemanticLayer`, `src/search/ParallelSearchExecutor.ts:274` `executeLexicalLayer`, `src/search/ParallelSearchExecutor.ts:330` `executeSymbolicLayer` | The same layer call is written twice. The parallel form adds timing, a timeout and error capture. |
| Semantic search | `src/search/SemanticSearch.ts:372` `search`, `src/search/SemanticSearch.ts:422` `findSimilar` | Both prepare the store, bound the limit, search the store, build an entity map and loop over the results. `search` embeds the query. `findSimilar` reads a stored vector, indexes the entity when missing, and skips itself. |
| Path reconstruction | `src/core/GraphTraversal.ts:449` `reconstructPath`, `src/search/EvidencePathBuilder.ts:211` `reconstruct` | The parent-walk loop is identical. The relation type and the returned shape differ. |
| Access tracking | `src/core/GraphTraversal.ts:132` `trackTraversalAccess`, `src/search/SearchManager.ts:210` `trackSearchResults` | Same frame: build a context, record every name in parallel. The context fields and the retrieval method string differ. |
| Proximity | `src/search/ProximitySearch.ts:121` `findProximity`, `src/search/ProximitySearch.ts:173` `getPositions` | `findProximity` repeats the body of `getPositions`. Two other call sites already use `getPositions`. |

- **Merge target**: add `rank: false` to `RankedSearch` (D2). Extract the layer calls so that `ParallelSearchExecutor` wraps the functions that `HybridSearchManager` owns. `findProximity` calls `getPositions`. One generic `reconstructPath` returns nodes and relations.
- **Risk**: Medium for the layer executors and TF-IDF. Low for the other rows.
- **Tests**: FTS names 6 files, `TFIDFIndexManager` 6, `ParallelSearchExecutor` 3, `HybridSearchManager` 8, `SemanticSearch` 13, `EvidencePathBuilder` 1, `GraphTraversal` 7.

### R24 Governance audit recorders

**Evidence**: Read. The redactor pair, and the diff of `recordMerge` against `recordArchive`.

| Site | Location |
|---|---|
| Method | `src/features/GovernanceManager.ts:116` `GovernanceTransaction.redactSnapshot` |
| Closure | `src/features/GovernanceManager.ts:428` `redact` |
| Recorders | `src/features/GovernanceManager.ts:280` `recordMerge`, `src/features/GovernanceManager.ts:305` `recordArchive` |

- **Redactor**: both return the snapshot unchanged when it is empty or when no redactor exists. Otherwise both call `redactObjectStrings`. One writes the guard as an `if`, the other as a ternary.
- **Recorders**: 7 lines differ. The operation name, one parameter and the `after` value.
- **Merge target**: one module-level redaction function and one private recorder that takes the operation name.
- **Risk**: Low.
- **Tests**: `GovernanceManager` 3 files, `withTransaction` 3, `recordMerge` or `recordArchive` 1.

### R25 CLI action wrapper

**Evidence**: Read for one command file (`spell.ts`). The counts come from a text search across `src/cli/commands`.

Every command action repeats the same frame. It reads the options and creates a logger and a context. It runs the body in `try`. On an error it logs the error and calls `process.exit(1)`.

| Count | Value |
|---|---|
| `.action(` registrations | 86 |
| `createContext(options)` lines | 74 |
| `logger.error(formatError` lines | 95 |
| `process.exit(1)` lines | 101 |

`src/cli/commands/helpers.ts` exports `src/cli/commands/helpers.ts:17` `getOptions` and `src/cli/commands/helpers.ts:27` `createContext`, and one more function. It exports no wrapper. Register functions such as `src/cli/commands/heuristic.ts:23` `registerHeuristicCommands` and `src/cli/commands/spell.ts:23` `registerSpellCommands` share the frame. They differ in the option declarations and the body.

- **Merge target**: one `runAction` wrapper in `helpers.ts` that owns the error handling and the exit code. Keep the option declarations as data.
- **Risk**: Low. Some commands print differently on error. Pin each output with a test first.
- **Tests**: 22 test files name a CLI command module or its register function.

### R26 Export skeletons and sidecar loaders

**Evidence**: Read (partial). The start of each body.

| Group | Sites | Result |
|---|---|---|
| Streaming exporter | `src/features/StreamingExporter.ts:140` `streamJSONL`, `src/features/StreamingExporter.ts:243` `streamCSV` | Same frame: cancellation check, progress and stream handling. The row body and the totals differ. |
| Graph formats | `src/features/IOManager.ts:768` `exportAsGraphML`, `src/features/IOManager.ts:823` `exportAsGEXF` | Two formats. Share only `escapeXml` (R19). |
| Sidecar load | `src/features/TagManager.ts:32` `loadTagAliases`, `src/search/SavedSearchManager.ts:40` `loadSavedSearches` | Same cache check, read, split and parse of a JSONL sidecar. The row type and the cache setter differ. |

- **Merge target**: one export frame function and one sidecar loader function.
- **Risk**: Low.
- **Tests**: `StreamingExporter` 5 files, GraphML or GEXF 4, `TagManager` 2, `SavedSearchManager` 1.

---

## 5. Behaviour differences and defects found while comparing

Decide each item before you merge the family that touches it.

| ID | Finding | Locations | Evidence | Decision needed |
|---|---|---|---|---|
| D1 | `loadFromDisk` skips a malformed JSON line. `loadViaMmap` throws an error that names the line. The same corrupt file loads below the mmap threshold and fails above it. | `src/core/GraphStorage.ts:470` `loadFromDisk`, `src/core/GraphStorage.ts:677` `loadViaMmap` | Read | Pick one policy, or make it an option. Add a test with one bad line. |
| D2 | `BM25Search` asks the backend for names only (`rank: false`). `RankedSearch` builds the same name set but lets the backend rank. The option documentation says `rank: false` is for callers that score candidates themselves, and a SQLite comment says ranking dominates the cost. | `src/search/BM25Search.ts:323` `getFtsCandidateNames`, `src/search/RankedSearch.ts:316` `getFtsCandidateNames` | Read. The speed gain is not measured. | Measure. Add `rank: false` if the gain is real. |
| D3 | The chain filter lets an entity with an unparseable date pass, because comparisons with an invalid date are false. The shared helper rejects such an entity. | `src/search/SearchFilterChain.ts:95` `entityPassesFilters`, `src/utils/entityUtils.ts:354` `isWithinDateRange` | Read. Executed in Node: both `new Date('bad') < new Date('2020-01-01')` and `>` give `false`. | Decide that an invalid date fails the filter. Then delegate. |
| D4 | `writeTmpFile` opens its temp file with the default mode. `durableWriteFile` limits the mode to `0o600`. Segment files can get wider permissions than other files that the library writes. | `src/core/segments/FileSegmentStorage.ts:643` `writeTmpFile`, `src/utils/durableWriteFile.ts:73` `durableWriteFile` | Read. File modes on disk were not checked. | Choose the segment-file mode on purpose. This is a security item. |
| D5 | `BatchProcessor.createTimeout` never clears its timer. The timer stays pending until it fires, even after the item ends. `ParallelSearchExecutor.createTimeout` returns a `clear` function. | `src/utils/BatchProcessor.ts:323` `createTimeout`, `src/search/ParallelSearchExecutor.ts:374` `createTimeout` | Read | Use the clearing form. The effect shows only when `itemTimeoutMs` is above 0. The default is 0. |
| D6 | The three cosine functions have three contracts. One throws on a length mismatch and clamps. One returns 0 on a mismatch. One cuts both vectors to the shorter length. | `src/utils/textSimilarity.ts:75` `cosineSimilarity`, `src/search/QuantizedVectorStore.ts:377` `cosineSimilarity`, `src/agent/RelationConsolidator.ts:233` `cosineSimilarity` | Read | Choose the mismatch contract before you merge. |
| D7 | `calculateEntitySimilarity` measures name length before lowercasing. `calculatePreparedSimilarity` measures it after. The lengths differ for characters whose lowercase form has another length. | `src/features/CompressionManager.ts:85` `calculateEntitySimilarity`, `src/features/CompressionManager.ts:147` `calculatePreparedSimilarity` | Read | Use the lowercased length in both. Pin it with a test. |
| D8 | Two promotion routes leave different values. `ConsolidationPipeline` sets `isWorkingMemory` and `markedForPromotion` to `false`. `WorkingMemoryManager` sets both to `undefined`. The return types and the configuration differ. | `src/agent/ConsolidationPipeline.ts:317` `promoteMemory`, `src/agent/WorkingMemoryManager.ts:707` `promoteMemory` | Read (partial) | Decide whether one route replaces the other. Do not merge before that. |
| D9 | The comment on `fnv1a32` says the algorithm is also used in `BloomFilter` and "a dozen other modules". Only three source files contain the FNV offset constant, and `BloomFilter` has its own variant. | `src/core/segments/ISegmentStorage.ts:99` `fnv1a32` | Read, with a text search for the constant | Correct the comment when R16 lands. |
| D10 | `scoreRecency` is not clamped and does not floor the age. A timestamp in the future gives a score above 1. The other five half-life sites clamp or floor the age. | `src/agent/DistillationPolicy.ts:192` `scoreRecency` | Read | Clamp, or document the range. |
| D11 | `runDecayCycle` calls `onDecayComplete` and `onForgetComplete` and catches errors. `runNow` calls neither callback and lets errors through. | `src/agent/DecayScheduler.ts:175` `runDecayCycle`, `src/agent/DecayScheduler.ts:218` `runNow` | Read | Confirm that the difference is intended. Keep it when you merge. |
| D12 | `recommendMethod` computes the recommended flag over the default method list, even when the caller passes `preferredMethods`. With `['basic', 'fuzzy']` the best method is `basic`, and its estimate has `isRecommended: false`. The default list is also written three times, at lines 209, 228 and 241. | `src/search/QueryCostEstimator.ts:236` `recommendMethod`, `src/search/QueryCostEstimator.ts:204` `getRecommendedMethodOnly` | Read. Executed: the probe returned `basic` with `isRecommended: false`, while the default list recommends `ranked`. | Pass `preferredMethods` through. Move the default list to one constant. |
| D13 | `getAncestors` guards against a `parentId` cycle. `getDescendants` has no visited set. On two entities whose `parentId` fields point at each other, `getAncestors` returned and `getDescendants` did not return within 8 s. `setEntityParent` rejects a cycle, so the state needs data that skipped that method. Other write paths were not checked. | `src/core/HierarchyManager.ts:159` `getAncestors`, `src/core/HierarchyManager.ts:191` `getDescendants` | Read. Executed with a stub storage: the probe was stopped by a timeout. | Add a visited set to `getDescendants`. |

---

## 6. Candidates reviewed and kept separate

| Pair | Reason | Evidence |
|---|---|---|
| `src/agent/procedural/graph/backing/ProceduralGraphState.ts:354` `resolveRejectionGraphId` and `src/agent/procedural/graph/backing/SqliteProceduralGraphBacking.ts:486` `resolveRejectionGraphId`, and the other methods of the two classes | Two implementations of one interface over two stores. The bodies differ in how they reach the store. | Read (four pairs) |
| `src/agent/SessionCheckpoint.ts:319` `sleep` and `src/agent/SessionCheckpoint.ts:354` `wake` | Opposite transitions with different guards and steps. | Read |
| `src/agent/events/EventManager.ts:277` `queryEvents` and `src/agent/events/EventManager.ts:330` `whoDidWhat` | Different candidate selection. | Read (partial) |
| `src/agent/SalienceEngine.ts:341` `calculateTaskRelevance` and `src/agent/SalienceEngine.ts:390` `calculateQueryRelevance` | Same frame, different score tiers. A shared helper would hide the tiers. | Read (partial) |
| `src/adapters/RateLimiter.ts:99` `check` and `src/adapters/RateLimiter.ts:128` `peek` | `peek` does not consume a token. | Read (partial) |
| `src/utils/EntityValidator.ts:155` `validate` and `src/utils/EntityValidator.ts:217` `validateSync` | A sync and async pair. 9 lines differ. JavaScript has no clean way to share both. | Read |
| `src/agent/ConsolidationPipeline.ts:419` `getPromotionCandidates` and `src/agent/WorkingMemoryManager.ts:637` `getPromotionCandidates` | Different criteria and return types. This follows D8. | Read (partial) |
| `src/search/BloomFilter.ts:65` `add` and `src/search/BloomFilter.ts:81` `mayContain` | Both walk the same index loop. One sets bits and one tests them with an early return. The shared part is five lines. | Read |
| `src/features/IOManager.ts:768` `exportAsGraphML` and `src/features/IOManager.ts:823` `exportAsGEXF` | Two output formats. | Read (partial) |
| `src/agent/FailureDistillation.ts:215` `buildFailureDescription` and `src/agent/FailureDistillation.ts:232` `buildLesson` | Same shape. The three string templates differ. Only a fallback expression is shared. | Read (partial) |
| `src/agent/FailureManager.ts:276` `getAll` and `src/agent/PlanManager.ts:372` `listPlans` | Same guard style, different record types and filtered fields. | First pass only |
| `src/core/RefIndex.ts:162` `purgeEntity` and `src/core/RefIndex.ts:190` `renameEntity` | Same frame. The per-reference work differs. | First pass only |
| `src/agent/DistillationPipeline.ts:111` `distill` and `src/agent/DistillationPolicy.ts:303` `CompositeDistillationPolicy.distill` | Both chain policies. The result detail differs. | First pass only |
| `src/search/QueryParser.ts:219` `tokenize` and `src/search/BooleanSearch.ts:281` `tokenizeBooleanQuery` | Three different output contracts. | First pass only |
| Constructors of `AccessTracker`, `ContextWindowManager`, `SalienceEngine`, `SessionManager`, `MemoryFormatter`, `ConsolidationPipeline`, `ConsolidationScheduler`, `DecayScheduler`, `WorkingMemoryManager`, `LangChainMemoryAdapter`, `LRUHotTier` and `RelationConsolidator` | Each merges its own default configuration. The syntax matches because the pattern matches. | Read (partial) |
| Pairs that the first pass marked as false positives: the `MemoryEngine` tier checks, `ToolCallObserver.observeStart` against `observeError`, `MemoryDistiller.distill` against `distillWithLLM`, the two session-checkpoint migration functions, `WorkerPoolManager.getPoolStats` against `WorkerTaskManager.getStats`, `GraphTraversal` `bfs` against `dfs`, and the two `QueryCostEstimator` layer scorers | The first pass found a real difference in each pair. | First pass only |
| `src/utils/searchAlgorithms.ts:130` `calculateIDF` and `src/utils/searchAlgorithms.ts:163` `calculateIDFFromTokenSets` | The count loops differ by design. The first loop filters, tokenizes and uses `includes`. The first loop skips holes. The second loop uses `for..of` and `has`. The second loop throws on a hole. A shared core adds 10 lines net. A shared core shares four one-line statements. | Executed. Two shared cores were written and tested. Tests pin the read order of the pair. |
| `src/search/VectorStore.ts:168` `siftUpWorst` and `src/agent/SalienceEngine.ts:697` `heapSiftUp`, with the two sift-down functions | The vector heap breaks ties by insertion order. The salience heap has no tie key. The two heaps treat NaN differently. A shared heap with numeric keys had to stay at or below a ratio of 1.10. The salience heap alone, with ascending scores and k = 10, gave 1.19 (95% interval 1.16 to 1.23). Each arm had 24 samples. In a process that also runs the other heap sites, the ratio was 1.11 (interval 1.08 to 1.14). Ratios are new over old. | Executed. A shared heap was written and timed against the old code. |
| `src/search/QuantizedVectorStore.ts:377` `cosineSimilarity` and `cosineParts` in `src/utils/textSimilarity.ts` | The input is a `Float32Array`. A loop shared with the `number[]` sites made the cosine slower at every site. This site keeps its typed loop. | Executed. |

---

## 7. Suggested order of work

1. **Decide D1 to D13 first.** D3, D4, D5, D12 and D13 are small. D4 is a security item. D2 needs one measurement.
2. **Remove pure copies (P1).** Do R11, R16, R19, R13, R03, R22, R24 and the delegations in R12. Use one commit per family. Add a golden-value or round-trip test before each commit.
3. **Merge the tiered stores (R08) and the tag and filter predicates (R20).** Both are mechanical once the tests exist.
4. **Parameterize the twins (P2).** Do R04, R05, R09, R10, R14, R15, R17, R18, R21, R23 and R25. Add a test for each parameter first. R10 needs the most new tests.
5. **Plan the storage work (R02, R01, R07, R06).** These change the write path of both storages. Add crash and reload tests first. Do R06 after D1.
6. **Run the documentation gates after each family.** Use the architecture check and the code-docs check.

---

## 8. Limits of this audit

- The detectors skip functions below 50 normalised nodes. Small helpers with two copies are not listed, unless the first pass or a reader found them.
- The audit covers `src/`. The audit does not cover `tests/`, `tools/` or other languages.
- The reviewed semantic pairs have a cosine value of 0.90 or more. The 82 pairs from 0.88 to 0.90 were not reviewed. A real copy with a lower score may exist.
- Equivalence claims come from reading. No test run proved them, except where the evidence says "Executed".
- Test counts are text matches. They show where a symbol is named. They do not show which branches a test covers.
- The first pass added 16 cases by reading, not by the detectors. A second reading would likely find more.
- Rows marked "First pass only" carry the risk of an unchecked verdict.
