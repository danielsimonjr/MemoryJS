# Clone review — 2026-11-05 (`repo-tools clones`)

**Tool:** `@danielsimonjr/repo-tools@2.3.0`, `repo-tools clones . --src=src` (structural
shingling of function bodies with names, literals, types and comments erased). Run on
master `e250a88`.

| Threshold | Units | Exact groups | Near pairs |
|---|---|---|---|
| `--min-nodes=50` (default) | 1379 | 0 | 16 |
| `--min-nodes=30` | 1952 | 30 (61 units) | 141 |

The tool reports *candidates*. Every pair below was read before classification. Two
classes:

- **Consolidate** — the bodies implement the same logic and a shared helper removes the
  duplicate without hurting readability or behaviour.
- **Keep** — the bodies are structurally alike but semantically distinct (different
  literals/fields/formats), or the shared form would be harder to read than two short
  functions. Listed so the next run of the tool is not re-triaged from scratch.

Rules for every consolidation: behaviour byte-identical (same results, same tie-breaks,
same error text); additive public API only; `src/types` stays a leaf; new helpers get a
doc comment (`repo-tools docs check src` gates MUST issues) and a direct unit test;
existing tests unchanged; files < 500 lines (src) / < 400 (tests).

## 1. Consolidate

| ID | Duplicates | Shared helper (new or existing) | Owner batch |
|----|-----------|----------------------------------|-------------|
| CL-1 | `ImportanceScorer.tokenise` ≡ `MemoryEngine.tokeniseForDedup` (Unicode `\p{L}\p{N}` tokenizer → `Set`) | `tokenizeUnicodeToSet(text)` in `src/utils/textSimilarity.ts` (keep `tokenizeStripped` separate: it is ASCII-only and strips rather than splits) | A |
| CL-2 | `HeuristicManager.tokenSet` ≈ `ObservationDedupManager.tokenSet` (+ two identical `STOPWORDS` sets). Heuristic lowercases first; ObservationDedup relies on the caller. | `tokenSetWithoutStopwords(text, stopwords, minLen)` in `textSimilarity.ts` that lowercases; one exported `ENGLISH_STOPWORDS_SMALL` constant. Builder must grep ObservationDedup's call sites and prove inputs are already lowercase (else leave that site as is and note it). | A |
| CL-3 | `ContextWindowManager.estimateStringTokens`, `MemoryFormatter.estimateTokens`, tail of `ContextWindowManager.estimateTokens(entity)` (word count × multiplier) | `estimateTokensFromText(text, multiplier)` in new `src/utils/tokenEstimate.ts`; export from utils barrel | A |
| CL-4 | `compareEdges` ×3 + `compareString` ×2 in `procedural/graph/{ProceduralGraph,ProceduralGraphSerializer,canonical}.ts` | export `compareEdges` / `compareString` from `canonical.ts` (structural `{source,target,relation}` type); import in the other two | B |
| CL-5 | `assertValidId` in `FileSegmentStorage` and `ISegmentStorage` (`InMemorySegmentStorage`) | module-level `assertValidSegmentId(id, segmentCount)` exported from `ISegmentStorage.ts` next to `assertSegmentOwnership` | B |
| CL-6 | `getDataValue` closure ×2 in `IOManager.importGraphML` (node and edge) | module-level `readGraphMlDataValue(xml, key)` in `IOManager.ts` | B |
| CL-7 | `ProjectContextManager.dedupCommands` / `dedupGlossary` (last-wins Map by key) | `dedupByKey(items, keyOf)` module helper (or `src/utils/collections.ts` if one exists) | B |
| CL-8 | `SessionQueryBuilder.createdInLastHours` / `createdInLastDays` | private `createdWithinMs(ms)`; both delegate | B |
| CL-9 | `JsonlColumnStore.delete` ≡ `MapFileTier.delete` (snapshot → delete → persist → restore on throw) | `deleteFromMapWithFlushRollback(cache, key, flush)` in `src/utils/mutateMapWithFlushRollback.ts` (MapFileTier passes `c => this.persistDelete(c, key)`) | C |
| CL-10 | `GraphStorage.getEntitiesByType` ≡ `SQLiteStorage.getEntitiesByType`; `GraphStorage.buildRelationIndex` ≡ `SQLiteStorage.rebuildRelationIndexes` | `entitiesByTypeFromIndexes(typeIndex, nameIndex, type)` and `rebuildRelationIndexes(relationIndex, relationKeyMap, relations)` in `src/core/storageCache.ts` (already the shared snapshot-helper module) | C |
| CL-11 | `RefIndex.addToReverseIndex` / `removeFromReverseIndex` ≡ `TypeIndex.addToIndex` bucket code / `removeFromBucket` in `utils/indexes.ts` | exported `addToSetBucket(map, key, value)` / `removeFromSetBucket(map, key, value)` in `utils/indexes.ts`; RefIndex and TypeIndex use them | C |
| CL-12 | `EmbeddingCache.pruneExpired` ≡ `QueryPlanCache.cleanup` | `pruneExpiredEntries(map, isExpired)` in `src/utils/searchCache.ts` (next to the existing eviction helpers) | C |
| CL-13 | `SingleTierIndex.stats` (ITieredIndex.ts) ≡ `TieredIndex.stats` | `snapshotTierStats(stats)` exported from `ITieredIndex.ts` | C |
| CL-14 | `clearAllSearchCaches` / `cleanupAllCaches` (four hard-coded caches) | `forEachSearchCache(fn)`; `getAllCacheStats` may use it too | C |
| CL-15 | `EntityManager.deleteEntitiesCompat` legacy branch re-implements `storageCache.deleteNamesFromSnapshot` | call `deleteNamesFromSnapshot(graph, namesToDelete)` | C |
| CL-16 | `ConflictResolver.resolveMostRecent` / `resolveHighestConfidence` / `resolveMostConfirmations` (reduce keeping first max) | private `pickFirstMax(memories, keyOf)`; strict `>` so the first maximum wins exactly as today | D |
| CL-17 | `IncrementalIndexer.queueCreate` / `queueUpdate` / `queueDelete` | private `enqueue(op)` doing shutdown check, dedup, push, auto-flush | D |
| CL-18 | `schemas.validateEntity` / `validateRelation` | `validateWithSchema(schema, value)` module helper | D |
| CL-19 | `validators.min` / `max` | `numericBoundRule(name, field, passes, defaultMessage)` module helper; `custom`/`customSync` stay (async vs sync is the point) | D |
| CL-20 | `EntityValidator.validate` / `validateSync` (identical issue construction, error wrapping and result assembly) | private `issueFor(rule, result, entity)`, `errorIssueFor(rule, err)`, `buildResult(errors, warnings, entity)`; the two loops remain (one awaits, one rejects promises) | D |
| CL-21 | `ReflectionStage.runOnSessionEnd` / `HeuristicExtractionStage.runOnResolution` non-empty-string guard with the same message shape | `assertNonEmptyString(value, label, context)` in `src/utils/validation.ts` (or the existing validation util) producing the identical message | D |
| CL-22 | `GraphEventEmitter.emitObservationAdded` / `emitObservationDeleted` | leave the two public emitters; share a private `emitObservationEvent(type, name, observations)` only if it does not change payload shape | D (optional) |
| CL-23 | `EventManager.queryEvents` / `whoDidWhat` candidate selection (relation-filtered `from`/`to` by relation type, else all events) | private `candidatesVia(anchor, relationType, direction)` | D (optional) |

## 2. Keep (reviewed, intentionally not merged)

| Pair | Why |
|------|-----|
| `GraphTraversal.bfs` / `dfs` | Queue vs stack, different visit-time bookkeeping; a parameterised walker is harder to read than two textbook functions. |
| `IOManager.exportAsGraphML` / `exportAsGEXF` | Different XML schemas; only the loop skeleton matches. |
| `SalienceEngine.calculate{Task,Query,Intent}Relevance` | Already share `semanticOr`; remaining bodies are the per-signal scoring tables. |
| `QueryCostEstimator.score{Lexical,Symbolic,Semantic}Layer` | Scoring tables; a data-driven form would obscure the heuristics. |
| `ConsolidationScheduler` / `DecayScheduler` constructors | Already share `fillDefaults`. |
| `AgentReflectionManager.archive` / `FailureManager.markResolved` | Different record types and result unions; share `versionedWriteFailure` already. |
| `CueTagContentGraph.addCue` / `addTag`; `ObservationNormalizer.guessMasculine` / `guessFeminine`; `IOManager.decodeXmlEntities` / `escapeHtml`; `errors.ts` constructors; `ObserverPipeline.onScored` / `WorkerPoolManager.onEvent` | Same shape, different data; merging adds indirection for ~5 lines each. |
| `GraphStorage` / `SQLiteStorage` `appendEntity(ies)` / `appendRelation(s)` | Per-table write paths; the symmetry is the design. |
| `BloomFilter.add` / `mayContain` | Hot path; a shared index generator costs an allocation per call. |
| `DecayEngine.calculateDecayFactor` vs `halfLife.clampedHalfLifeScore` | Already shares `halfLifeFactor`; the rest is TTL/importance modulation. |
| `validators.custom` / `customSync` | The async/sync split is the API. |
| CLI `registerHeuristicCommands` / `registerObservationDedupCommands`, `smoke.ts` runs | Commander boilerplate. |

## 3. Verification

- `bun run typecheck`, `bun run lint`, `bun run build`, `SKIP_BENCHMARKS=true bun run test:ci`
  (baseline 420 files / 10522 tests), `bun run tools:check-duplicates`, `bun run tools:check-census`,
  `repo-tools docs check src` (0 MUST), `repo-tools check . --docs=docs/architecture`.
- Re-run `repo-tools clones . --src=src --min-nodes=30` and record the new exact-group /
  near-pair counts in §4.

## 4. Result

_Filled in after the consolidation lands._
