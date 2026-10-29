# Clone refactor plan (K001–K051)

Planning only. This file does not change `src/`. It reviews every row left in `docs/analysis/CLONES_REMAINING.md` after the EMMA clone cleanup ([#224](https://github.com/danielsimonjr/MemoryJS/pull/224)), decides MERGE or KEEP from the code itself, and orders the merges into small pull requests.

Measured against `master` `246622d63f2826827aaf950a70dd9f238b52118e` ("Clone cleanup: merge same-algorithm duplicates and document remaining pairs (#224)"). Every line number below is at that commit.

Out of scope for every PR: version bumps, tags, releases, new public API beyond the helpers named here, and any change to observable behavior other than PR 0. The findings in [Findings outside this plan](#findings-outside-this-plan) are listed, not fixed.

## Summary

The old reasons in `CLONES_REMAINING.md` mostly described what the two units are for, not whether their code differs. Read against the source, most pairs share a real step (a prelude, a filter, a guard, a rollback, a bucket removal) that a small helper can own, while the parts that differ stay in the callers.

| Verdict | Rows | Count |
|---|---|---|
| MERGE | K001–K012, K014, K016–K018, K020, K021, K023, K027, K028, K030, K032, K035, K037–K039, K041–K045, K047–K051 | 37 |
| MERGE, partial | K022, K034, K036, K046 | 4 |
| KEEP | K013, K015, K019, K024, K025, K026, K029, K031, K033, K040 | 10 |

Eleven of the MERGE rows are constructor default merges (K005, K009, K011, K020, K028, K039, K041, K042, K043, K044, K048). They all go through PR 16, which is optional. That PR turns per-field `??` lines into one table per class. It removes no logic, so the owner may drop it. If PR 16 is dropped, those eleven rows become KEEP with the reason given under [PR 16](#pr-16-constructor-defaults-optional).

Expected end state: 0 exact groups, and between 10 and 16 near pairs with PR 16 (10 KEEP rows plus any residual pairs listed per PR), or between 21 and 27 without it. Each PR reports the measured counts.

## Baseline and re-measure

Tool pin: `@danielsimonjr/repo-tools@2.3.0` (the version in `.github/workflows/typescript.yml`). The global `repo-tools` binary is not installed in the dev environment; use `npx`. `--out` must be a relative path.

```bash
npx --yes @danielsimonjr/repo-tools@2.3.0 clones . --src=src --out=../tmp/memoryjs-clones-<label>
```

Parameters (from `clones.json`): `minNodes=50`, `shingleLength=6`, `nearThreshold=0.6`, `containmentThreshold=0.9`, `containmentMinShingles=20`, `rareShingleLimit=60`, `minSharedShingles=3`. A function under 50 AST nodes is not a unit, so it is never compared. That is why moving a shared step into a small helper removes a pair, and why a helper of 50 nodes or more can create a new one.

Baseline on `246622d`:

| Measure | Value |
|---|---|
| files | 307 (parseErrors=0) |
| units | 1376 |
| exact groups | 1 (2 units: K001) |
| text-identical groups | 0 |
| near pairs | 51 |
| near pairs by jStruct | 0.9 or more: 2; 0.8–0.9: 11; 0.7–0.8: 12; 0.6–0.7: 15; below 0.6 (containment): 11 |
| units by folder | adapters 28, agent 556, cli 74, core 221, features 92, search 256, security 11, types 9, utils 127, workers 2 |

The 51 near pairs in `clones.json` are in the same order as K001–K051. Near pair 1 is the K001 exact pair again. To compare two runs by label:

```bash
list_pairs() {
  node -e '
const fs = require("fs"), d = process.argv[1];
const inv = fs.readFileSync(d + "/inventory.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const byId = new Map(inv.map((u) => [u.id, u]));
const label = (i) => { const u = byId.get(i); return u.file + " " + (u.container ? u.container + "." : "") + u.name; };
const c = JSON.parse(fs.readFileSync(d + "/clones.json", "utf8"));
for (const g of c.exactGroups) console.log("exact: " + g.map(label).join(" ; "));
for (const p of c.near) console.log(label(p.a) + " ; " + label(p.b));
' "$1" | sort
}
list_pairs ../tmp/memoryjs-clones-before > ../tmp/pairs-before.txt
list_pairs ../tmp/memoryjs-clones-after  > ../tmp/pairs-after.txt
diff ../tmp/pairs-before.txt ../tmp/pairs-after.txt
```

The labels match the `units` column of `CLONES_REMAINING.md` exactly.

## Rules for every PR

### Behavior

- Error classes and message text stay verbatim, including quotes and punctuation.
- Evaluation order stays the same where a caller can observe it: which check throws first, which I/O runs before a throw, insertion order of `Map`/`Set`/arrays, event order.
- Equality stays strict where it is strict today (`!== undefined`, `===`). A helper does not switch a check between `undefined`, `null` and truthiness.
- Public signatures do not change. New helpers are private, module-local, or in `src/utils/` and `src/core/storageCache.ts` as listed.
- No test is edited to fit a refactor. A PR may only add tests.

### Microtask ticks

Several lifecycle methods have tick pins (`tests/test-utils/microtask-ticks.ts`): `WorkThreadManager` complete/cancel (`THREAD_TICKS`), `FailureManager` (`FAILURE_TICKS`), `AgentReflectionManager` (`REFLECTION_TICKS`), `PlanManager` (`PLAN_TICKS`), the `TagManager`/`SavedSearchManager` loaders (cache miss 3, ENOENT 3, cache hit 2), and the `SalienceEngine.getMostSalient` heap pins.

- A synchronous helper never changes ticks.
- A non-async method that returns the promise of an async inner function with the same awaits keeps ticks.
- Adding an `async` layer adds ticks. That is allowed only where nothing is pinned, and the PR adds a pin first.

### Storage boundary

`GraphStorage` (JSONL file and segment writes) and `SQLiteStorage` (transactions) keep separate persistence paths. Only the in-memory cache mirror is shared, through `src/core/storageCache.ts`, which already holds `upsertEntityInCache`, `upsertRelationInCache` and `removeEntitiesFromIndexes`. PR 17 extends that file and nothing else crosses the boundary.

### Checklist

Each PR that edits `src/`:

- The first commit adds pin tests for the behavior the refactor must keep. They pass on `master` before the refactor commit.
- `bunx vitest run` on the test files named in the PR, then `SKIP_BENCHMARKS=true bun run test`.
- `bun run typecheck` and `bun run lint` exit 0.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 docs check src` exits 0. Every new exported symbol has a JSDoc block whose first sentence says what it does.
- `npx --yes @danielsimonjr/repo-tools@2.3.0 check . --docs=docs/architecture` exits 0. Update only Value cells the check reports as drift.
- Re-measure clones. The PR description lists before and after counts, the rows that left, and any new pair with its explanation.
- In `docs/analysis/CLONES_REMAINING.md`, move the resolved rows from Remaining to Removed with new ids (R004 onward). Do not edit the header counts; PR 18 does that once.
- One bullet under `CHANGELOG.md` `## [Unreleased]`. No version heading.

The PRs touch different files, except for the overlaps listed under the [PR sequence](#pr-sequence) table. `CHANGELOG.md` and `CLONES_REMAINING.md` edits are line-local; rebase before merge.

## Shared helpers

Nine helpers cover the cross-cutting patterns. Each one is small, does a single step that is identical in its adopters, and leaves the differing parts in the caller.

### H1. Optional-field equality filter (K002, K034)

`src/utils/matchesDefinedFields.ts`:

```typescript
/** Reads the record field that an option key is compared against. */
export type FieldReaders<R, O> = {
  readonly [K in keyof O]?: (record: R) => O[K] | undefined;
};

/**
 * Returns whether a record matches every defined option, by strict equality.
 *
 * Options that are `undefined` are skipped. Readers run in the key order of
 * `readers` and the check stops at the first mismatch.
 */
export function matchesDefinedFields<R, O extends object>(
  record: R,
  options: O,
  readers: FieldReaders<R, O>,
): boolean;
```

The readers objects are module-level constants, so the filter allocates nothing per record. `null` is not skipped (it is compared, as today). Range checks, text search, confidence floors and limits stay inline in the caller.

Adopters:

| Method | Reader keys | Stays inline |
|---|---|---|
| `FailureManager.getAll` (329–335) | `status` → `rec.lifecycle.status`, `sourceSessionId` | — |
| `PlanManager.listPlans` (392–399) | `sessionId`, `agentId`, `status` → `p.lifecycle.status` | — |
| `AgentReflectionManager.list` | `scope`, `sourceSessionId`, `sourceProjectId` | `minConfidence`, `limit` |
| `ProspectiveMemoryManager.getPending` / `getFired` | `sessionId`, `agentId` | status, `sinceDate` |
| `AuditLog.query` | `operation`, `entityName`, `agentId` | time range, text, `limit` |
| `EventManager.queryEvents` / `whoDidWhat` (PR 15) | equality options only | branch ladders |

`entityPassesFilters` in `src/utils/entityUtils.ts` is not reused: it tests `entityType` by truthiness and is tied to `Entity`.

### H2. Set multimap add and delete (K004, K036)

`src/utils/setMultimap.ts`:

```typescript
/** Adds a value to the set stored under a key, creating the set when missing. */
export function addToSetMultimap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void;

/**
 * Deletes a value from the set stored under a key and drops the key when the
 * set is empty afterwards. Returns whether the value was present.
 */
export function deleteFromSetMultimap<K, V>(map: Map<K, Set<V>>, key: K, value: V): boolean;
```

Adopters: `NGramIndex.removeFromInvertedIndex` and its add loop, `ObservationIndex.add`/`remove` and `TypeIndex.addToIndex`/`removeFromBucket` in `src/utils/indexes.ts`, `RelationIndex.addToIndexes` (both maps) and the inner bucket blocks of `RelationIndex.removeAllForEntity`, `RefIndex.addToReverseIndex`/`removeFromReverseIndex`.

`RelationIndex.remove` is excluded. It removes the first structurally equal relation by scanning a bucket and drops the bucket even when nothing matched. A set delete would change both.

### H3. Constructor defaults (K005 and ten more rows, optional)

`src/utils/applyDefaults.ts`:

```typescript
/**
 * Builds a resolved config with one entry per defaults key, in defaults order,
 * taking `config[key] ?? defaults[key]`.
 *
 * Keys of `config` that are not in `defaults` are not copied.
 */
export function applyDefaults<D extends object>(
  config: { readonly [K in keyof D]?: D[K] },
  defaults: Readonly<D>,
): D;
```

Scalar defaults only. Callbacks, injected services and validated fields stay explicit after the call. See [PR 16](#pr-16-constructor-defaults-optional).

### H4. Lifecycle guards (K008, K021, K037, K012)

The two managers return failures differently. `WorkThreadManager` throws, while `DecisionManager` returns an outcome union (`'not-found'`, `'already-accepted'`, `'illegal-transition'`). One cross-manager state machine would hide that difference, so each manager gets its own private guard. `src/core/EntityStateMachine.ts` is not reused: its transition table is `ENTITY_STATUS_TRANSITIONS` for `EntityStatus`, and it treats a same-status transition as legal.

### H5. JSONL array sidecar (K003, K023)

`src/utils/JsonlArraySidecar.ts`:

```typescript
/** Options for {@link JsonlArraySidecar}. */
export interface JsonlArraySidecarOptions<T> {
  /** Runs after the cache is set from a load or a successful save. */
  onCached?(records: T[]): void;
  /** Runs after a failed save drops the cache. */
  onDropped?(): void;
}

/**
 * Loads, caches and saves an array of records kept as one JSON object per line.
 */
export class JsonlArraySidecar<T> {
  constructor(filePath: string, options?: JsonlArraySidecarOptions<T>);
  /** The cached records, or null before the first load and after a failed save. */
  get cached(): T[] | null;
  /** Returns the cached records, or reads and caches the file. A missing file caches `[]`. */
  load(): Promise<T[]>;
  /** Writes the records and caches them. A failed write drops the cache and rethrows. */
  save(records: T[]): Promise<void>;
  /**
   * Loads, computes a key once, removes every record that matches it, and saves
   * when something was removed. Returns whether a record was removed.
   */
  removeMatching<K>(prepareKey: () => K, matches: (record: T, key: K) => boolean): Promise<boolean>;
}
```

The body of `load` is today's loader: cache hit, `fs.readFile(path, 'utf-8')`, `parseJsonlRecords`, set the cache inside the `try`, ENOENT caches `[]`, any other error rethrows. `save` maps `JSON.stringify` over the records, joins with `'\n'`, and calls `fs.writeFile`. The class imports `* as fs from 'fs/promises'`, the same module the managers import today, so the `vi.mock('fs/promises', …)` in the loader pin tests still intercepts.

`prepareKey` runs after the load, which keeps `TagManager`'s order (`await loadTagAliases()`, then `alias.toLowerCase()`).

### H6. Snapshot rollback (K010, K022)

Add to `src/utils/mutateMapWithFlushRollback.ts`, next to the R003 helper:

```typescript
/**
 * Mutates a map, then flushes it. On a flush failure, restores the exact prior
 * entries in their prior insertion order and rethrows.
 */
export async function mutateMapWithSnapshotRollback<K, V>(
  cache: Map<K, V>,
  mutate: (map: Map<K, V>) => void,
  flush: (map: Map<K, V>) => Promise<void>,
): Promise<void>;
```

Order: snapshot with `new Map(cache)`, `mutate(cache)`, `await flush(cache)`. On failure, `cache.clear()`, re-set every snapshot entry in order, rethrow. It is called inside each store's `mutex.runExclusive`, never around it.

### H7. Interval timer (K016)

`src/utils/IntervalTimer.ts`:

```typescript
/** Owns one unref'd interval and its running flag. */
export class IntervalTimer {
  /** Whether an interval is active. */
  get running(): boolean;
  /**
   * Starts the interval. Returns false without side effects when already running.
   * Sets running, calls the global `setInterval`, then `unref()`s the handle.
   */
  start(tick: () => void, intervalMs: number): boolean;
  /** Clears the interval and the running flag. No-op when stopped. */
  stop(): void;
}
```

It reads the global `setInterval`/`clearInterval` at call time so `vi.useFakeTimers()` still replaces them. The schedulers hold an instance; they do not inherit from it (`ConsolidationScheduler` already extends `EventEmitter`).

### H8. Half-life since a timestamp (K035)

Add to `src/utils/halfLife.ts`:

```typescript
/**
 * Returns the half-life factor for the hours elapsed since an ISO timestamp,
 * clamped to [0, 1]. An unparsable timestamp gives NaN, as the callers do today.
 */
export function halfLifeFactorSince(timestamp: string, halfLifeHours: number, now: number = Date.now()): number;
```

Body: `Math.max(0, Math.min(1, halfLifeFactor((now - new Date(timestamp).getTime()) / (1000 * 60 * 60), halfLifeHours)))`. Callers keep their own empty-value guard (`if (!lastAccessedAt) return 0`) and their own default half-life (24 in `AccessTracker`, 168 in `DecayEngine`).

### H9. Storage cache mirror (K050, K051)

Add to `src/core/storageCache.ts`. All functions are synchronous and touch only `StorageCacheState`.

```typescript
/** Selects the entities named in `nameSet` and every relation that touches one of them. */
export function selectEntityDeletion(
  state: StorageCacheState,
  nameSet: ReadonlySet<string>,
): { deletedEntities: Entity[]; deletedRelations: Relation[] };

/** Removes deleted entities and their relations from the snapshot arrays and the indexes. */
export function removeEntitiesFromCache(
  state: StorageCacheState,
  nameSet: ReadonlySet<string>,
  deletedEntities: readonly Entity[],
  deletedRelations: readonly Relation[],
): void;

/** Selects the cached relations whose composite key is in `keySet`. */
export function selectRelationsByKey(state: StorageCacheState, keySet: ReadonlySet<string>): Relation[];

/** Returns the cached entities for `names`, first occurrence only, skipping unknown names. */
export function collectTouchedEntities(state: StorageCacheState, names: readonly string[]): Entity[];

/** Removes relations by composite key from the snapshot array and the relation indexes. No-op when none were deleted. */
export function removeRelationsFromCache(
  state: StorageCacheState,
  keySet: ReadonlySet<string>,
  deletedRelations: readonly Relation[],
): void;
```

`removeEntitiesFromCache` filters `state.cache!.entities` and `state.cache!.relations`, then calls the existing `removeEntitiesFromIndexes`. `removeRelationsFromCache` filters `state.cache!.relations`, then calls `relationIndex.remove(r)` and `relationKeyMap.delete(relationKeyOf(r))` per deleted relation.

## Row verdicts

"PR" is the pull request in [PR sequence](#pr-sequence) that resolves the row.

| id | Pair | Verdict | PR | Change |
|---|---|---|---|---|
| K001 | `FailureDistillation.buildFailureDescription` / `buildLesson` | MERGE | 1 | shared subject prelude; templates stay |
| K002 | `FailureManager.getAll` / `PlanManager.listPlans` | MERGE | 2 | H1 |
| K003 | `TagManager.removeTagAlias` / `SavedSearchManager.deleteSavedSearch` | MERGE | 5 | H5 `removeMatching` |
| K004 | `NGramIndex.removeFromInvertedIndex` / `ObservationIndex.remove` | MERGE | 4 | H2 |
| K005 | `ContextWindowManager` / `SalienceEngine` constructors | MERGE | 16 | H3 |
| K006 | `StreamingExporter.streamJSONL` / `streamCSV` | MERGE | 12 | export sink + redaction copy |
| K007 | `SalienceEngine.calculateTaskRelevance` / `calculateQueryRelevance` | MERGE | 1 | keyword tier tables |
| K008 | `WorkThreadManager.claim` / `release` | MERGE | 3 | H4 thread guards |
| K009 | `AccessTracker` / `ContextWindowManager` constructors | MERGE | 16 | H3 |
| K010 | `JsonlColumnStore.clear` / `MapFileTier.clear` | MERGE | 6 (after 0) | H6 |
| K011 | `ConsolidationScheduler` / `DecayScheduler` constructors | MERGE | 16 | H3 |
| K012 | `DecisionManager.accept` / `reject` | MERGE | 3 | H4 decision guard |
| K013 | `GraphStorage.cacheStateOf` / `SQLiteStorage.cacheStateOf` | KEEP | — | adapter over private fields |
| K014 | `EntityValidator.validate` / `validateSync` | MERGE | 13 | issue recorder |
| K015 | `GraphTraversal.trackTraversalAccess` / `SearchManager.trackSearchResults` | KEEP | — | one shared statement |
| K016 | `ConsolidationScheduler.start` / `DecayScheduler.start` | MERGE | 11 | H7 |
| K017 | `SalienceEngine.calculateQueryRelevance` / `calculateIntentRelevance` | MERGE | 1 | keyword tier tables |
| K018 | `QueryCostEstimator.scoreLexicalLayer` / `scoreSemanticLayer` | MERGE | 7 | query feature helpers |
| K019 | `DecisionManager.reject` / `supersede` | KEEP | — | different guard |
| K020 | `AccessTracker` / `SalienceEngine` constructors | MERGE | 16 | H3 |
| K021 | `WorkThreadManager.release` / `finish` | MERGE | 3 | H4 thread guards |
| K022 | `JsonlColumnStore.delete` / `MapFileTier.delete` | MERGE, partial | 6 | H6 for `MapFileTier` only |
| K023 | `TagManager.saveTagAliases` / `SavedSearchManager.saveSavedSearches` | MERGE | 5 | H5 `save` |
| K024 | `LangChainMemoryAdapter` / `LRUHotTier` constructors | KEEP | — | field assignments, no config object |
| K025 | `DecisionManager.accept` / `supersede` | KEEP | — | different guard |
| K026 | `LangChainMemoryAdapter` / `RelationConsolidator` constructors | KEEP | — | field assignments, no config object |
| K027 | `SalienceEngine.calculateTaskRelevance` / `calculateIntentRelevance` | MERGE | 1 | keyword tier tables |
| K028 | `AccessTracker` / `SessionManager` constructors | MERGE | 16 | H3 |
| K029 | `AgentReflectionManager.archive` / `FailureManager.markResolved` | KEEP | — | tick-pinned, record-specific |
| K030 | `InMemoryBackend.get_weighted` / `SQLiteBackend.get_weighted` | MERGE | 10 | weighted-turn ranking |
| K031 | `GraphTraversal.bfs` / `dfs` | KEEP | — | different visit rule |
| K032 | `inspect.ts snapshotEntity` / `neighbors` | MERGE | 14 | entity load + edge split |
| K033 | `IOManager.exportAsGraphML` / `exportAsGEXF` | KEEP | — | different markup on every line |
| K034 | `EventManager.queryEvents` / `whoDidWhat` | MERGE, partial | 15 (after 2) | candidate + collect helpers, H1 |
| K035 | `AccessTracker.calculateRecencyScoreFromTimestamp` / `DecayEngine.calculateDecayFactorStatic` | MERGE | 9 | H8 |
| K036 | `RefIndex.purgeEntity` / `renameEntity` | MERGE, partial | 4 | `purgeEntity` delegates; rename stays |
| K037 | `WorkThreadManager.claim` / `finish` | MERGE | 3 | H4 thread guards |
| K038 | `ParallelSearchExecutor.executeSemanticLayer` / `executeLexicalLayer` | MERGE | 7 | timed layer runner |
| K039 | `DecayScheduler` / `WorkingMemoryManager` constructors | MERGE | 16 | H3 |
| K040 | `BloomFilter.add` / `mayContain` | KEEP | — | three lines on a hot path |
| K041 | `AccessTracker` / `ConsolidationPipeline` constructors | MERGE | 16 | H3 |
| K042 | `AccessTracker` / `MemoryFormatter` constructors | MERGE | 16 | H3 |
| K043 | `MemoryFormatter` / `SessionManager` constructors | MERGE | 16 | H3 |
| K044 | `ConsolidationPipeline` / `ContextWindowManager` constructors | MERGE | 16 | H3 |
| K045 | `ObservationDedupManager.findDuplicateObservations` / `findJaccardDuplicates` | MERGE | 1 | bucketing + top-N |
| K046 | `registerHeuristicCommands` / `registerObservationDedupCommands` | MERGE, partial | 14 | `emitJson`, shared dedup options |
| K047 | `SessionQueryBuilder.search` / `execute` | MERGE | 1 | `paginate` |
| K048 | `ConsolidationPipeline` / `MemoryFormatter` constructors | MERGE | 16 | H3 |
| K049 | `BasicSearch.openNodes` / `BooleanSearch.booleanSearch` | MERGE | 8 | filter tail + induced graph |
| K050 | `GraphStorage.applyCacheMutation` / `SQLiteStorage.deleteRelations` | MERGE, cache side | 17 | H9 |
| K051 | `GraphStorage.applyCacheDeletion` / `SQLiteStorage.deleteEntities` | MERGE, cache side | 17 | H9 |

## KEEP rows

These reasons replace the old ones in PR 18.

**K013** `GraphStorage.cacheStateOf` (349–376) / `SQLiteStorage.cacheStateOf` (386–410). Each builds the `StorageCacheState` adapter over its own private fields. The differences are the point of the adapter: only JSONL has `observationIndex`, JSONL lowercases with `lowercaseCache.set`/`remove`, and SQLite with `updateLowercaseCache` and a `Map.delete`. Sharing the builder would mean exposing the private fields or passing five accessor callbacks, which is more code than the two adapters.

**K015** `GraphTraversal.trackTraversalAccess` (133–149) / `SearchManager.trackSearchResults` (210–228). The only shared statement is `await Promise.all(items.map((x) => tracker.recordAccess(x, context)))`. The context literals differ (search adds `queryContext`, and `retrievalMethod` is `'traversal'` or `'search'`). A `recordAccessBatch` method on `AccessTracker` would break the duck-typed tracker doubles in `tests/unit/search/SearchManager.test.ts` (lines 532–565 pass an object with only `recordAccess`). A free function would add the first runtime import from `core/` and `search/` into `agent/`; both files import `AccessTracker` as a type only today. Revisit if access recording gets a real batched write (one storage write per batch instead of one per entity).

**K019, K025** `DecisionManager.supersede` (253–270) against `reject`/`accept`. `supersede` checks two entities (the decision and its replacement), allows only `accepted → superseded`, and has no "already" outcome. `accept` and `reject` allow only `proposed → X` and return `already-X` when repeated. The shared write is already in `applyUpdate`. A guard that covered all three would need a flag for each of those differences.

**K024, K026** `LangChainMemoryAdapter` constructor (86–94) against `LRUHotTier` (73–79) and `RelationConsolidator` (405–416). These do not build a config object. Each line assigns one `readonly` field that methods read directly (`this.sessionId`, `this.maxEntries`, `this.maxGroups`). The lines are not uniform either: some options pass through with no default (`onEvict`, `embedding`, `llm`), one reads a nested option (`options.thresholds?.semantic`), and one comes from the context (`ctx.memoryEngine`). Each line is the option and its default, so there is nothing to factor out. H3 does not apply because there is no resolved config to return.

**K029** `AgentReflectionManager.archive` / `FailureManager.markResolved`. Both are pinned at 2 microtask ticks for the resolved path (`REFLECTION_TICKS`, `FAILURE_TICKS`). Their only async step is `try { await storage.updateEntity(...) } catch (err) { return versionedWriteFailure(err) }`. [#186](https://github.com/danielsimonjr/MemoryJS/pull/186) first shared that step, found that the shared body settled in more microtask turns, and in its D-3 fix kept both methods `async` with the write awaited in their own body, sharing only the synchronous `versionedWriteFailure`. Moving the await into a helper would undo that fix. The rest is record-specific: the status read, the "already" outcome, and the lifecycle literal.

**K031** `GraphTraversal.bfs` / `dfs`. BFS marks a node visited when it is enqueued and records its parent once. DFS marks a node when it is popped and keeps the parent of the first push. A shared loop would need flags for both rules, and that would hide the algorithm difference the two methods exist to show.

**K033** `IOManager.exportAsGraphML` / `exportAsGEXF`. Every emitted line differs (`<key>`/`<data>` against `<attributes>`/`<attvalue>`, different headers and edge attributes). `escapeXml` is already shared. What is left is two templates.

**K040** `BloomFilter.add` / `mayContain`. The shared part is three lines of bit-position arithmetic per hash. `add` sets bits, while `mayContain` returns early on the first clear bit. A callback or a returned index tuple would allocate on the pre-screen hot path. The two layouts are pinned against each other by the test "mayContain is true for inserted items (no false negatives)".

## PR sequence

| PR | Suggested branch | Base | Rows | Risk |
|---|---|---|---|---|
| 0 | `cursor/clones-column-store-clear-lock` | `master` | none (prerequisite for K010) | low, behavior fix |
| 1 | `cursor/clones-agent-local-helpers` | `master` | K001, K007, K017, K027, K045, K047 | low |
| 2 | `cursor/clones-defined-field-filter` | `master` | K002 | low |
| 3 | `cursor/clones-lifecycle-guards` | `master` | K008, K021, K037, K012 | medium (ticks) |
| 4 | `cursor/clones-set-multimap` | `master` | K004, K036 | medium (index invariants) |
| 5 | `cursor/clones-jsonl-array-sidecar` | `master` | K003, K023 | medium (ticks, mocks) |
| 6 | `cursor/clones-snapshot-rollback` | `master` after PR 0 merges | K010, K022 (partial) | medium |
| 7 | `cursor/clones-search-scoring` | `master` | K018, K038 | low |
| 8 | `cursor/clones-search-filter-tail` | `master` | K049 | medium (version visibility) |
| 9 | `cursor/clones-recency-math` | `master` | K035 | low |
| 10 | `cursor/clones-weighted-turns` | `master` | K030 | low |
| 11 | `cursor/clones-interval-timer` | `master` | K016 | medium (fake timers) |
| 12 | `cursor/clones-export-sink` | `master` | K006 | medium (stream errors) |
| 13 | `cursor/clones-validator-recorder` | `master` | K014 | low |
| 14 | `cursor/clones-cli-helpers` | `master` | K032, K046 (partial) | low |
| 15 | `cursor/clones-event-queries` | `master` after PR 2 merges | K034 (partial) | medium |
| 16 | `cursor/clones-constructor-defaults` | `master` (optional) | K005, K009, K011, K020, K028, K039, K041–K044, K048 | low, owner decision |
| 17 | `cursor/clones-storage-cache-mirror` | `master`, last `src/` PR | K050, K051 | high |
| 18 | `cursor/clones-close-out` | `master` after the rest | docs only | low |

File overlap: PR 1 and PR 16 both edit `SalienceEngine.ts` (scoring and constructor), and PR 9 and PR 16 both edit `AccessTracker.ts` (recency and constructor). Their regions differ. PR 8 and PR 16 do not overlap.

---

### PR 0. `JsonlColumnStore.clear` takes the store mutex

This is a behavior fix and the only PR that changes behavior.

`JsonlColumnStore.put`, `delete` and `batchPut` run inside `this.mutex.runExclusive`, and the class doc says in-process concurrency is handled. `clear` (162–173) does not lock. A `put` that interleaves with `clear` can be erased by the clear's flush. If the clear's flush fails, its rollback re-adds the snapshot on top of whatever the `put` inserted. `MapFileTier.clear` already locks.

Change: wrap the body of `clear` in `return this.mutex.runExclusive(async () => { ... })`. Nothing inside the class calls `clear` while holding the mutex, so it cannot deadlock.

Tests (`tests/unit/core/columns/JsonlColumnStore.test.ts`):

- Start `put('a')` and `clear()` without awaiting in between, then await both. After that, `entries()` and the sidecar on disk agree, and the result is one of the two serial orders.
- A failing flush during `clear` leaves exactly the prior entries, in order.

Risk: `clear` now waits for an in-flight mutation. No caller depends on it returning early.

---

### PR 1. Agent in-file helpers

Rows: K001, K007, K017, K027, K045, K047. Each change stays inside one file.

**K001, `src/agent/FailureDistillation.ts`.** Both builders compute the episode text `episode.observations[0] ?? episode.name`, return a no-cause template for an empty chain, and otherwise read the last chain entry the same way. Lines 138–139 call them back to back.

```typescript
interface FailureSubjects {
  readonly content: string;
  /** Undefined when the cause chain is empty. */
  readonly rootContent: string | undefined;
}

function leadText(entity: AgentEntity): string {
  return entity.observations[0] ?? entity.name;
}

function failureSubjects(episode: AgentEntity, causeChain: readonly AgentEntity[]): FailureSubjects {
  return {
    content: leadText(episode),
    rootContent: causeChain.length === 0 ? undefined : leadText(causeChain[causeChain.length - 1]),
  };
}
```

`buildFailureDescription(subjects)` and `buildLesson(subjects)` keep their templates verbatim (`Failure: …`, `Failure: … (root cause: …)`, `Avoid: …`, `To prevent "…", address root cause: "…"`). They branch on `rootContent === undefined`, not truthiness, so a root cause whose first observation is `''` still gets the root-cause template. The call site computes `failureSubjects` once. The check stays `causeChain.length === 0`, so a chain ending in a hole still throws as it does today.

**K007, K017, K027, `src/agent/SalienceEngine.ts`.** The three public relevance methods (352, 401, 433) share a frame: build the entity text, return `summarizationService.calculateSimilarity(entityText, text)` when `useSemanticSimilarity` is on, otherwise return the first matching keyword tier. Only the tiers differ, and the old reasons said a helper would hide them. A table states them more plainly than the `if` ladders do.

```typescript
type KeywordField = 'name' | 'entityType' | 'observations';
type KeywordTiers = ReadonlyArray<readonly [KeywordField, number]>;

const TASK_TIERS: KeywordTiers = [['name', 0.8], ['observations', 0.5]];
const QUERY_TIERS: KeywordTiers = [['name', 1.0], ['entityType', 0.7], ['observations', 0.5]];
const INTENT_TIERS: KeywordTiers = [['observations', 0.8]];

private scoreTextRelevance(entity: AgentEntity, text: string, tiers: KeywordTiers): number;
```

`scoreTextRelevance` calls `buildEntityText(entity)` first, as all three do today, then the semantic branch, then `text.toLowerCase()` and the tiers in order. The field tests keep their null-safety: `name` and `entityType` call `.toLowerCase()` directly, and observations use `entity.observations?.some(...)`. `calculateTaskRelevance` keeps its `entity.taskId === taskDescription` short-circuit before the call. The three public signatures do not change.

**K045, `src/agent/ObservationDedupManager.ts`.** `findDuplicateObservations` (90–121) and `findJaccardDuplicates` (128–211) run the same first pass (99–112 and 145–163): for each candidate entity and each observation index, normalize, skip empty text, hash, get or create the bucket for that hash, and push `{ entityName, observationIndex }`. Both end with the same stable sort by occurrence count and the `maxGroups` slice (119–120, 209–210).

```typescript
/** Buckets every non-empty normalized observation by its hash, in first-seen order. */
function bucketObservations<B extends { occurrences: DuplicateObservationOccurrence[] }>(
  entities: readonly Entity[],
  createBucket: (normalized: string, hash: string) => B,
): Map<string, B>;

/** Sorts groups by occurrence count, descending and stable, in place, and returns the first `maxGroups`. */
function topGroups<G extends { occurrences: readonly unknown[] }>(groups: G[], maxGroups: number): G[];
```

`createBucket` runs only for a new hash, so the Jaccard tier still computes `tokenSet` once per distinct text. The exact tier's bucket is `{ observation, occurrences }`, and the Jaccard tier's is its `Indexed` record. Each scan keeps its own grouping (minimum-occurrence filter, or union-find and the root coalescing) and its `tier` value. The no-op `distinct` check in `findJaccardDuplicates` (205–206) stays as it is; see [Findings](#findings-outside-this-plan).

**K047, `src/agent/SessionQueryBuilder.ts`.** The old reason ("search builds a plan; execute runs it") is wrong. Both apply the same pagination, at 398–404 and 488–494:

```typescript
private paginate<T>(results: T[]): T[] {
  if (this.offset) results = results.slice(this.offset);
  if (this.limit) results = results.slice(0, this.limit);
  return results;
}
```

The truthiness checks stay, so 0 or unset skips the step. `searchWithRecencyRanking` (468–471) applies only the limit and is not changed.

Pins first:

- `FailureDistillation`: empty chain; an episode with no observations falls back to its name; a root cause whose first observation is `''` gets the root-cause template.
- `SalienceEngine`: each method's tier order (a name match wins over an entityType match), an entity with `observations` undefined, the semantic path calling `calculateSimilarity` with the built text, and the `taskId` short-circuit.
- `ObservationDedupManager`: group order on ties and the `maxGroups` cut, for both scans.
- `SessionQueryBuilder`: offset 0 and limit 0 behave as unset, for `search` and `execute`.

Tests: `tests/unit/agent/{FailureDistillation,SalienceEngine,SalienceEngine-heap-pins,ObservationDedupManager,SessionQueryBuilder}.test.ts`.

Expected: K001 (exact and near), K007, K017, K027, K045 and K047 leave the report.

---

### PR 2. Optional-field filter

Rows: K002. Adds H1 and adopts it in the six methods of the H1 table. `EventManager` is PR 15.

Risks:

- A reader that reads a different field than the inline check did. Each reader table sits next to its options type, and the pins cover every key.
- `null` options: today `options.status !== undefined && rec.status !== options.status` compares `null`. H1 does the same.

Pins first: for each adopter, one test per option key (match and mismatch), one with every key `undefined`, and one with a `null` option. `AuditLog.query` also needs a combined test with the inline time and text filters.

Tests: `tests/unit/agent/{FailureManager,PlanManager,AgentReflectionManager,ProspectiveMemoryManager}.test.ts`, `tests/unit/features/AuditLog.test.ts`, and a new `tests/unit/utils/matchesDefinedFields.test.ts`.

Expected: K002 leaves. Watch for a new pair among the slimmer adopters.

---

### PR 3. Lifecycle guards

Rows: K008, K021, K037, K012.

**`src/agent/WorkThreadManager.ts`.** `Thread not found: ${threadId}` is thrown at 312 (claim), 341 (release), 389 (block), 439 (unblock) and 565 (finish). `release`, `block` and `finish` share the message shape `Cannot <verb> thread <id> from '<status>' status` (345, 400, 569).

```typescript
private requireThread(threadId: string): WorkThread;
private assertTransition(threadId: string, thread: WorkThread, target: WorkThreadStatus, verb: string): void;
```

Both are synchronous, so no tick changes. `claim` uses `requireThread` but keeps its own owner check and its transition message (`Cannot transition thread … to 'active'`) inline. `unblock` uses `requireThread` and keeps its `status !== 'blocked'` check. The mutations, `updatedAt`, `await this.persistThread(thread)` and `return { ...thread }` stay in each method.

**`src/agent/DecisionManager.ts`.** `accept` (226–235) and `reject` (237–251) share the lookup, the `isDecisionMemory` check, the `already-X` outcome and the `proposed`-only rule.

```typescript
private checkProposedTransition<T extends 'accepted' | 'rejected'>(
  id: DecisionId | string,
  target: T,
): DecisionEntity | 'not-found' | `already-${T}` | 'illegal-transition';
```

`reject` keeps `validateNonEmpty(reason, …)` before the call, so an empty reason still throws before the lookup. The lifecycle literal and `applyUpdate` stay in each method. `supersede` stays as it is (K019, K025).

Pins first:

- Tick counts and error messages for `claim`, `release`, `block` and `unblock`, on the resolved path and on each throw path. `complete` and `cancel` are already pinned by `THREAD_TICKS`.
- Every `accept`/`reject` outcome from each status, and `reject('')` on an unknown id throwing rather than returning `'not-found'`.

Tests: `tests/unit/agent/{WorkThreadManager,DecisionManager}.test.ts`.

Expected: K012 leaves. K008, K021 and K037 should leave or drop in score. `claim`, `release` and `finish` may each stay at 50 nodes or more with the same mutation tail, so report any pair that remains instead of forcing it out.

---

### PR 4. Set multimap and `RefIndex.purgeEntity`

Rows: K004, K036.

Adds H2 and adopts it as listed. `deleteFromSetMultimap` drops the key whenever the set is empty after the delete. The adopters keep the invariant that no empty set is stored, and the pins check it.

**K036.** `RefIndex.purgeEntity(name)` (162–177) does exactly what `purgeEntities([name])` (219–240) does: same mutex, same `ensureLoaded`, 0 for a missing or empty set, the same deletes, and a persist only when something was removed.

```typescript
purgeEntity(entityName: string): Promise<number> {
  return this.purgeEntities([entityName]);
}
```

It is non-async and returns the inner promise, so ticks do not change. `renameEntity` stays: it remaps entries and moves refs to another key, which is a different mutation.

Risks: `RelationIndex.remove` is excluded (see H2). `TypeIndex` takes the entity type, so pass the type that was indexed, not the current one.

Pins first: after removing the last value under a key, the key is gone; removing an absent value leaves the other values; `purgeEntity` return values and persist calls for unknown, empty and populated names.

Tests: `tests/unit/search/NGramIndex.test.ts`, `tests/unit/utils/indexes.test.ts`, `tests/unit/core/RefIndex.test.ts`, and a new `tests/unit/utils/setMultimap.test.ts`.

Expected: K004 and K036 leave.

---

### PR 5. JSONL array sidecar

Rows: K003, K023. The old reasons are wrong. `removeTagAlias` (205–217) and `deleteSavedSearch` (177–188) have the same contract: load, filter, return false when nothing was removed, save, return true. `saveTagAliases` (56–68) and `saveSavedSearches` (75–88) are the same write with the same drop-cache-on-failure rule.

Adds H5. The managers keep their private method names so the white-box pin tests (`manager['loadTagAliases']()`, `manager['aliasCache']`, `manager['searchCache']`, `manager['searchIndex']`) stay unchanged:

- `loadTagAliases()` / `loadSavedSearches()` become non-async and return `this.sidecar.load()`. The inner `load` has the same awaits, so the tick pins (cache miss 3, ENOENT 3, cache hit 2) hold.
- `saveTagAliases` / `saveSavedSearches` return `this.sidecar.save(...)` the same way.
- `aliasCache` and `searchCache` become private getters over `sidecar.cached`.
- `SavedSearchManager` keeps `searchIndex` as a field. `onCached` rebuilds it, which replaces `setCache`, and `onDropped` clears it.
- `removeTagAlias(alias)` returns `this.sidecar.removeMatching(() => alias.toLowerCase(), (a, key) => a.alias === key)`. `deleteSavedSearch(name)` uses `() => name` and an exact name match.

Risk: the loader pins assert that a `null` line throws a `TypeError` while the parsed list stays cached. H5 must set the cache before calling `onCached`, both inside the `try`, as `setCache` does today.

Pins first: removal with a mixed-case alias; removing a missing name returns false and does not write; a failed save drops the cache and `searchIndex`; the order of `readFile`, `writeFile` and `toLowerCase` on the remove path.

Tests: `tests/unit/features/{TagManager,TagManager-loader-pins}.test.ts`, `tests/unit/search/{SavedSearchManager,SavedSearchManager-loader-pins}.test.ts`, and a new `tests/unit/utils/JsonlArraySidecar.test.ts`.

Expected: K003 and K023 leave. `JsonlArraySidecar.load` may pair with another JSONL loader; report it.

---

### PR 6. Snapshot rollback

Rows: K010, K022 (partial). Depends on PR 0.

Adds H6. Adopters: `MapFileTier.delete` (70–85) and `clear` (94–106), and `JsonlColumnStore.clear` (after PR 0) and `batchPut` (123–143). Each call stays inside the store's own `runExclusive`. The early returns (`if (!cache.has(key)) return false`, `if (cache.size === 0) return`) stay before the call.

`JsonlColumnStore.delete` (107–121) keeps its single-key rollback. `cache.set(name, priorValue)` re-inserts the key at the end of the map, so a failed delete changes the line order of the next flush. `MapFileTier.delete` restores the order. Making them the same is an owner decision (see [Findings](#findings-outside-this-plan)), so K022 may stay in the report.

The helper adds an `async` layer to the adopters. None of them is tick-pinned.

Pins first: after a failed flush in each adopter, `keys()` returns the prior keys in the prior order, and the sidecar on disk is unchanged.

Tests: `tests/unit/core/columns/JsonlColumnStore.test.ts`, `tests/unit/search/tiered/{DiskWarmTier,BrotliColdTier}.test.ts` (both build on `MapFileTier`).

Expected: K010 leaves. K022 stays unless the owner accepts the order change.

---

### PR 7. Search scoring helpers

Rows: K018, K038.

**K018, `src/search/QueryCostEstimator.ts`.** The layer scorers share two query features. `query.trim().split(/\s+/).length` appears at 299, 394, 483, 572, 660, 679 and 721. `/\b(AND|OR|NOT)\b/.test(query)` appears at 300, 391, 481, 573, 680 and 722.

```typescript
const BOOLEAN_OPERATOR = /\b(AND|OR|NOT)\b/;
function queryWordCount(query: string): number;
function hasBooleanOperators(query: string): boolean;
```

The regex stays non-global, so `.test` keeps no `lastIndex` state. A blank query still counts as 1 word. The layer weights stay inline in each scorer, so nothing is blurred.

**K038, `src/search/ParallelSearchExecutor.ts`.** `executeSemanticLayer` (207–269) and `executeLexicalLayer` (274–321) run the same timed frame: start time, a result `Map`, `createTimeout`, `Promise.race` against the search, add the scores, catch into `success: false` with the error message, clear the timeout in `finally`, then build the same `LayerTiming`.

```typescript
private async runTimedLayer<T>(
  layer: LayerTiming['layer'],
  timeoutMs: number,
  timeoutMessage: string,
  search: () => Promise<T>,
  addScores: (results: Map<string, number>, found: T) => void,
): Promise<{ results: Map<string, number>; timing: LayerTiming }>;
```

`search()` is called inside the `try`, after `createTimeout`, so a synchronous throw is still caught. The semantic layer passes `addSimilarityScores` and the lexical layer passes `addNormalizedLexicalScores`. The semantic layer's "not configured" early return (220–233) keeps its own start time and its two `Date.now()` calls. The two layer methods become non-async and return `runTimedLayer(...)`, or `Promise.resolve(...)` for that early return. The symbolic layer is synchronous and stays as it is.

Pins first: a blank query, lowercase `and`, and operator-only queries; layer timeout with fake timers (the timer is cleared, `success: false`, the message); a thrown search error; the semantic "not configured" result.

Tests: `tests/unit/search/{QueryCostEstimator,ParallelSearchExecutor}.test.ts`.

Expected: K018 and K038 leave.

---

### PR 8. Search filter tail

Rows: K049. `BasicSearch.searchNodes` (non-cached tail 51–97), `searchByDateRange` (from 113), `openNodes` (101–110), `BooleanSearch.booleanSearch` (non-cached tail 228–263) and the `FuzzySearch` search tail (420–451) end the same way: compute the version context from the whole graph, apply filters, validate and apply pagination, build the induced subgraph.

`SearchFilterChain.filterAndPaginate` (278–287) already exists but has no callers in `src/`. It calls `applyFilters` without a version context, which falls back to `publishedAncestorsOfDraftHeads(entities)` over the matched subset. That is not what the search methods do. They compute it from `graph.entities`, so a published ancestor stays visible even when its draft head did not match.

Change:

```typescript
// SearchFilterChain
/** Builds the superseded-name visibility set from the whole graph. */
static versionContextOf(graphEntities: readonly Entity[]): SearchFilterVersionContext;

/** Existing method; a new optional trailing parameter is passed to applyFilters. */
static filterAndPaginate(
  entities: Entity[],
  filters: SearchFilters,
  offset?: number,
  limit?: number,
  versionContext?: SearchFilterVersionContext,
): Entity[];
```

```typescript
// src/search/inducedSubgraph.ts
/** Returns the entities with the relations whose endpoints are both among them. */
export function inducedGraph(
  storage: IGraphStorage,
  entities: Entity[],
  keepRelation?: (relation: Relation) => boolean,
): KnowledgeGraph;
```

Use the parameter type `collectInducedRelations` already takes for `storage`. The callers pass `SearchFilterChain.versionContextOf(graph.entities)`. The steps keep today's order: version context, then `applyFilters`, then `validatePagination` (which can throw), then `paginate`. `BooleanSearch` and `FuzzySearch` still write their result cache between pagination and `inducedGraph`. The cached paths that use `cachedNameSet` are not changed. Calls to `filterAndPaginate` without the new argument behave as before.

Pins first: a draft head that does not match the query while its published ancestor does, so the ancestor must stay visible, for each adopter; offset and limit; `searchByDateRange` keeps its relation predicate.

Tests: `tests/unit/search/{BasicSearch,BooleanSearch,FuzzySearch,FuzzySearchWorkerPath,SearchFilterChain,SearchManager}.test.ts`.

Expected: K049 leaves.

---

### PR 9. Recency math

Rows: K035. Adds H8. Adopters: `AccessTracker.calculateRecencyScore` (193–208), `AccessTracker.calculateRecencyScoreFromTimestamp` (218–231), `DecayEngine.calculateDecayFactorStatic` (241–252) and `DefaultDistillationPolicy.scoreRecency` in `src/agent/DistillationPolicy.ts` (194–203). Each keeps its empty-value guard, its timestamp choice (`scoreRecency` reads `lastModified ?? createdAt`) and its default half-life. `scoreRecency` also clamps the age with `Math.max(0, ageHours)`. That gives the same result as H8's clamp of the factor to 1, and NaN passes through both, so the clamp can go.

Today `DecayEngine` calls `Date.now()` before parsing the timestamp and `AccessTracker` calls it after. Parsing never reads the clock, so the order is not observable.

Pins first: an empty string returns 0; an unparsable timestamp returns NaN; a future timestamp clamps to 1; the exact value at one half-life for each default.

Tests: `tests/unit/agent/{AccessTracker,DecayEngine,DistillationPolicy}.test.ts`, `tests/unit/utils/halfLife.test.ts`.

Expected: K035 leaves.

---

### PR 10. Weighted-turn ranking

Rows: K030. New `src/agent/weightedTurns.ts`:

```typescript
/** Converts PRD importance [1, 3] to memoryjs importance [0, 10], clamped. */
export function prdToMemoryjsImportance(prd: number): number;   // Math.max(0, Math.min(10, (prd - 1) * 5))

/** Converts memoryjs importance [0, 10] back to PRD importance [1, 3]. */
export function memoryjsToPrdImportance(importance: number): number;   // 1 + (importance / 10) * 2

/**
 * Scores candidates, keeps scores at or above the threshold, sorts by score
 * descending (stable) and returns at most `limit` turns.
 */
export function rankWeightedTurns<C>(
  candidates: readonly C[],
  score: (candidate: C) => number,
  toTurn: (candidate: C) => MemoryTurn,
  threshold: number,
  limit: number,
): WeightedTurn[];
```

The backends keep their own loading, empty check (`[]`), and option defaults (`options?.threshold ?? decayEngine.prdMinImportanceThreshold`, `options?.limit ?? 10`). They differ in one way, and the helper keeps it. `InMemoryBackend` (59–86) scores a synthetic entity built from each turn but returns the original turn object (`toTurn` is the identity). `SQLiteBackend` (115–135) scores the stored entity and returns `entityToTurn(entity)`. Per candidate, `score` runs before `toTurn`, as both do today. `prdToMemoryjsImportance` replaces the same formula in `InMemoryBackend.turnToEntity` (108) and `SQLiteBackend.add` (87). `memoryjsToPrdImportance` replaces line 161.

Pins first: a score equal to the threshold is kept; ties keep their input order; the default limit is 10; the in-memory backend returns the same turn object (`toBe`); the round-trip of importance at 1, 2 and 3.

Tests: `tests/unit/agent/{InMemoryBackend,SQLiteBackend,memoryBackend-wiring}.test.ts`.

Expected: K030 leaves.

---

### PR 11. Interval timer

Rows: K016. Adds H7. The three `start` methods share `if (this.running) return`, `running = true`, `setInterval(...)`, `unref()`. The three `stop` methods are identical (clear the interval if set, unset it, `running = false`), as are the three `isRunning` getters. Adopters:

- `DecayScheduler` (118–155). The tick is `() => { void this.runDecayCycle(); }`. After starting it runs one cycle (`void this.runDecayCycle()`).
- `ConsolidationScheduler` (123–157). The tick is `() => { void this.runConsolidationCycle(); }`. After starting it stores `this.initialCyclePromise = this.runConsolidationCycle()`. Line 207 `if (!this.running) return` reads `this.timer.running`.
- `DreamEngine` (259–288). The tick is `() => { void this.runDreamCycle(); }`. It has no immediate run.

Each `start` becomes `if (!this.timer.start(tick, intervalMs)) return;` followed by its own immediate run, if it has one. `stop()` calls `this.timer.stop()`, and `isRunning()` returns `this.timer.running`. Each scheduler keeps its own interval source (config or env) and its callbacks. No test reads the private `intervalId` or `running` fields.

Pins first: a second `start` creates no second interval and no second immediate cycle; `unref` is called; `stop` then `start` works; with fake timers, the cycle count after N intervals for each scheduler; `ConsolidationScheduler` does not run a cycle after `stop` while the initial cycle is in flight.

Tests: `tests/unit/agent/{DecayScheduler,ConsolidationScheduler,DreamEngine}.test.ts`.

Expected: K016 leaves.

---

### PR 12. Export sink

Rows: K006. In `src/features/StreamingExporter.ts`, `streamJSONL` (140–216) and `streamCSV` (243–311) share the stream setup and teardown, the per-line guard and the redaction copy. Only the totals, labels, header, line format and the relations loop differ.

```typescript
/** Returns the entity to write: a copy with redacted observations, or the entity itself. */
function forExport(entity: Entity, redactPii: boolean | undefined): Entity;

interface ExportSink {
  /** Throws the first stream error, then checks cancellation. */
  guard(): void;
  /** Writes text and returns its UTF-8 byte length. */
  write(text: string): number;
  /** Ends the stream; rejects with the first stream error. */
  end(): Promise<void>;
}

/** Opens the output with mode 0o600 and registers the error handler before any write. */
function openExportSink(filePath: string, signal: AbortSignal | undefined, operation: string): ExportSink;
```

`await secureExistingOutput(this.filePath)` stays before `openExportSink`, and `await restrictSensitiveFilePermissions(this.filePath)` stays after `await sink.end()`. `end()` is non-async and returns the same `new Promise(...)` as today, so awaiting it costs the same ticks. The CSV header write stays unguarded, as it is today. The cancellation-only check before `end()` stays inline.

Pins first: a stream error raised after the first write is thrown on the next guard; cancellation between lines; byte counts with multibyte text; the CSV header write before any guard.

Tests: `tests/unit/features/{StreamingExporter,StreamingExporter-frame-pins}.test.ts`.

Expected: K006 leaves.

---

### PR 13. Validator recorder

Rows: K014. `EntityValidator.validate` (156–199) and `validateSync` (218–266) have the same issue recording, the same `failFast` rule and the same result. Only `await rule.validate(entity)` against the synchronous call with its `instanceof Promise` throw differs.

```typescript
interface IssueSink {
  readonly errors: EntityValidationIssue[];
  readonly warnings: EntityValidationIssue[];
}

/** Records a failed rule result. Returns true when validation should stop (failFast on an error). */
private recordResult(sink: IssueSink, rule: EntityValidationRule, entity: Entity, result: EntityRuleResult): boolean;
/** Records a thrown rule as an error. Returns true when validation should stop. */
private recordFailure(sink: IssueSink, rule: EntityValidationRule, error: unknown): boolean;
private toResult(sink: IssueSink, entity: Entity): EntityValidationResult;
```

Each loop keeps its own `try`/`catch` and calls `recordResult` inside the `try`, so a throwing `getFieldValue` is still recorded as `Validation error: …`. Each loop does `if (this.recordResult(...)) break;`.

Pins first: `failFast` with a warning followed by an error; an async rule passed to `validateSync` is recorded with the "is async" message; `strict` with warnings only.

Tests: `tests/unit/utils/EntityValidator.test.ts`.

Expected: K014 leaves.

---

### PR 14. CLI helpers

Rows: K032, K046 (partial).

**K032, `src/cli/commands/inspect.ts`.**

```typescript
/** Loads the graph (hydrating the name index), then returns it with the named entity. Throws `entity not found: <name>`. */
async function loadEntityOrThrow(ctx: ManagerContext, name: string): Promise<{ graph: ReadonlyKnowledgeGraph; entity: Entity }>;

/** Splits the relations touching `name` into outgoing `{ to, type }` and incoming `{ from, type }` edges. */
function relationEdges(
  relations: readonly Relation[],
  name: string,
): { outgoing: Array<{ to: string; type: string }>; incoming: Array<{ from: string; type: string }> };
```

`snapshotEntity` (42–47), `buildTree` (82–86) and `neighbors` (186–189) each run `await ctx.storage.loadGraph()`, then `getEntityByName`, then throw the same message. `relationEdges` replaces the identical splits at 51–56 and 190–195. The REPL re-exports stay unchanged.

**K046.** `emitJson(payload: unknown): void` is defined identically in `spell.ts:14`, `cache.ts:20`, `heuristic.ts:14`, `observationDedup.ts:41` and `reindex.ts:27`, and `inspect.ts` inlines it three times. Export one copy from `src/cli/commands/helpers.ts`. `withDedupFilterOptions(command: Command): Command` adds the five options that `obs-dedup find` and `find-jaccard` both declare, with the same flags, descriptions and defaults. The Commander registration bodies stay: they are declarative, and `heuristic match` has its own `try`/`catch` and `process.exit` for variadic input. The K046 pair may remain.

Pins first: byte-for-byte JSON output of one command per file; `--help` text for both `obs-dedup` subcommands; the not-found message from `inspect`.

Tests: `tests/unit/cli/{inspect,heuristic,observationDedup}.test.ts`.

Expected: K032 leaves. K046 drops or stays; report it.

---

### PR 15. Event queries

Rows: K034 (partial). Depends on PR 2 (H1).

In `src/agent/events/EventManager.ts` (277–367), `queryEvents` and `whoDidWhat` gather candidate event names from the relations around one anchor (or all `event` entities), dedupe them, load each event, filter, sort chronologically and cut at `limit`.

```typescript
/** Names on the far side of `relationType` relations whose `anchorSide` endpoint is `anchor`. */
private async eventsLinkedTo(anchor: string, relationType: string, anchorSide: 'from' | 'to'): Promise<string[]>;
private async allEventNames(): Promise<string[]>;
private async collectEvents(
  candidates: readonly string[],
  keep: (event: EventRecord) => boolean,
  limit: number | undefined,
): Promise<EventRecord[]>;
```

`eventsLinkedTo` covers the three relation filters: `actor_of` from the actor (returns `r.to`), and `targeted` and `occurred_in` to the target or context (return `r.from`). `collectEvents` keeps today's loop: `for (const name of dedupe(candidates))`, one `await this.getEvent(name)` at a time (no `Promise.all`), skip missing events, `keep`, then `sortChronologically` and the `limit` slice. The equality checks inside `keep` use H1. The flow-tag and time-range checks and `whoDidWhat`'s `event.actor === undefined` skip stay in `keep` as written. Each method keeps its own branch ladder for choosing candidates (actor, then target, or target, then context), which is the real difference. Candidate selection still runs before `resolveRange`, so a bad range still fails after the relation read, as today. `whoDidWhat` still maps the limited events to entries.

This adds an `async` layer. Neither method is tick-pinned.

Pins first: result order and dedupe when an event is reachable twice; `limit`; each branch of both ladders; an event whose actor was deleted is skipped by `whoDidWhat`; `getEvent` calls happen one at a time, in candidate order.

Tests: `tests/unit/agent/EventManager.test.ts`.

Expected: K034 drops; the ladders may keep a pair.

---

### PR 16. Constructor defaults (optional)

Rows: K005, K009, K011, K020, K028, K039, K041, K042, K043, K044, K048.

Adds H3. The nine constructors involved write one `config.x ?? default` line per field, for example `AccessTracker` (92–97), `SalienceEngine` (82–95, twelve fields), `ContextWindowManager` (162–173) and `MemoryFormatter` (50–57). H3 turns each into a module-level `DEFAULTS` table and one call. Pass-through fields are written after the call, in their current position, so the key order of the resolved object stays the same and keys that are `undefined` are still present. The `DEFAULTS` constants stay unexported.

| Constructor | Explicit after the call |
|---|---|
| `AccessTracker` | — |
| `ContextWindowManager` | — |
| `SalienceEngine` | — |
| `ConsolidationScheduler` | `onConsolidationComplete`, `onError` |
| `DecayScheduler` | `forgetOptions`, `onDecayComplete`, `onForgetComplete`, `onError` |
| `WorkingMemoryManager` | `entropyFilter`, `exclusionManager` |
| `MemoryFormatter` | — |
| `SessionManager` | a per-call defaults literal, so `createSummaryOnEnd: episodicMemory !== undefined` keeps its key position |
| `ConsolidationPipeline` | `maxDuplicateComparisons` validation stays last and inline. Resolve the config before `new SummarizationService({ defaultSimilarityThreshold: resolved.similarityThreshold })`. |

Why it is optional: no logic moves and no behavior is shared. Each line is one option and its default, and the table holds the same facts. The gain is that every default sits in one constant per class. If the owner declines, these rows become KEEP with this reason.

Risks: `Object.keys(getConfig())` order (H3 keeps defaults order; pin it); a config with extra keys (not copied, as today); `null` (treated as missing by `??`, as today).

Pins first: for each class, the `getConfig()` result (or the private config) for `{}`, for a full config and for `null` values, including key order.

Tests: `tests/unit/agent/{AccessTracker,ContextWindowManager,SalienceEngine,ConsolidationScheduler,DecayScheduler,WorkingMemoryManager,MemoryFormatter,MemoryFormatterSalience,SessionManager,ConsolidationPipeline}.test.ts`, and a new `tests/unit/utils/applyDefaults.test.ts`.

Expected: the eleven rows leave. K024 and K026 stay (KEEP).

---

### PR 17. Storage cache mirror

Rows: K050, K051. The highest risk; it goes last.

Adds H9 and adopts it on the cache side only:

| Site | Shared now |
|---|---|
| `GraphStorage.deleteEntities` (1396–1457): selection at 1402–1406, `applyCacheDeletion` at 1412–1418 | `selectEntityDeletion`, `removeEntitiesFromCache` |
| `SQLiteStorage.deleteEntities` (1575–1649): selection at 1583–1587, cache step at 1628–1633 | the same |
| `GraphStorage.deleteRelations` (1486–1590): selection 1493–1506, `applyCacheMutation` 1514–1527, rewrite-branch removal 1557–1563 | `selectRelationsByKey`, `collectTouchedEntities`, `removeRelationsFromCache` |
| `SQLiteStorage.deleteRelations` (1669–…): selection 1678–1691, cache step 1718–1725 | the same |

What stays per backend:

- The JSONL file rewrite and the filtered arrays it writes, segment routing and `appendViaSegmentSave`, write-first ordering, and in the rewrite branch the timestamp pre-apply with restore on failure.
- The SQLite `foreign_keys` pragma, the transaction, and embeddings cleanup.
- `pendingAppends`/`pendingChanges`, generation bumps, event emission, and the `touchedEntities` timestamp loops.

`applyCacheDeletion` and `applyCacheMutation` stay as local closures, because `appendViaSegmentSave` takes a callback. Their bodies call the helpers.

Risks: the selection runs before any write today and must stay there; JSONL rewrite failure must leave cache and indexes untouched; segment mode must still apply the cache step only through `appendViaSegmentSave`.

Pins first, on both backends: cache arrays, `nameIndex`, `typeIndex`, `relationIndex`, `relationKeyMap` and the lowercase views after a delete; an unchanged cache after a failed JSONL write; restored timestamps after a failed rewrite with `touchEntities`; segment mode with entities in two segments.

Tests: `tests/unit/core/{GraphStorage,SQLiteStorage,storageCache}.test.ts`, `tests/unit/core/segments/GraphStorage-segments.test.ts`, `tests/unit/core/mmap/GraphStorage-mmap-wiring.test.ts`, `tests/integration/storage-dedup-safety.test.ts`.

Expected: K050 and K051 leave, or drop below the containment threshold.

---

### PR 18. Close-out

Docs only:

- Rewrite the reasons of the KEEP rows in `docs/analysis/CLONES_REMAINING.md` with the text from [KEEP rows](#keep-rows).
- Add any residual pairs the PRs reported, each with a code-grounded reason.
- Update the header counts from a fresh run on `master`.

## Findings outside this plan

Found while reading the rows. Only the first is fixed here (PR 0), because PR 6 depends on it. Each of the others changes behavior, so each needs its own PR and owner decision.

1. **`JsonlColumnStore.clear` does not lock** (162–173), unlike every other mutation in the class. Fixed in PR 0.
2. **The `distinct` check in `ObservationDedupManager.findJaccardDuplicates` never filters anything** (205–206). It keys on `${entityName}|${observationIndex}`, which is unique per occurrence by construction, so the Jaccard tier also reports groups that the exact tier already found. The method's doc says it "Skips pairs already caught by the exact tier so the output is genuinely additive". The test "finds near-duplicates that exact tier misses" (`ObservationDedupManager.test.ts:171`) passes only because of this: its "case variation" pair normalizes to the same text, since `normalizeObservation` lowercases and collapses whitespace. A fix would count distinct buckets (hashes) per group, which changes the output and that test.
3. **`JsonlColumnStore.delete` rollback moves the key to the end** (116). After a failed flush, the next flush writes that line last. `MapFileTier.delete` restores the order. This decides whether K022 can fully merge.
4. **`SessionQueryBuilder.searchWithRecencyRanking` ignores the offset** (468–471). It applies only the limit, unlike `search` and `execute`.
5. **`AgentMemoryManager.retrieveForContext` hard-codes `maxTokens ?? 4000`** (367). `ContextWindowManager` resolves `options.maxTokens ?? profileConfig.maxTokens ?? this.config.defaultMaxTokens` (1360), so through the facade a role profile's `maxTokens` and a configured `defaultMaxTokens` are never used.
6. **`EntityValidator.validateSync` drops an async rule's promise.** It records "is async" as an error, but if the rule's promise later rejects, nothing handles it.
7. **`ParallelSearchExecutor`'s semantic "not configured" path calls `Date.now()` twice**, so the reported time can be 0 or 1 ms. PR 7 keeps this as it is.
8. **`TagManager` and `SavedSearchManager` write with plain `fs.writeFile`**, not `durableWriteFile`. A crash mid-write can truncate the sidecar. PR 5 keeps this as it is.
9. **`RefIndex.renameEntity(x, x)` deletes the reverse-index set it just added to.** The only caller, `EntityManager.renameEntity`, rejects an existing target name with `DuplicateEntityError` before reaching it, so this only matters for direct callers.

## Owner decisions

- PR 16: take it (eleven rows leave) or drop it (eleven KEEP rows with the reason above).
- K022: accept the insertion-order change in `JsonlColumnStore.delete`'s rollback (finding 3) so it can use H6, or keep the row.
- Findings 2 to 9: which, if any, become behavior-fix PRs. None of them blocks this plan.
