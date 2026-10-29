# Clones refactor plan

Planning only. This file does not change `src/`. Each implementation pull request below branches from `master`, changes one family, and stays reviewable on its own. Do not stack them. Do not squash them into one pull request. Do not bump the package version, tag, or release.

The Phase 2 ledger in [`docs/analysis/CLONES_REMAINING.md`](../analysis/CLONES_REMAINING.md) left 1 exact group and 51 near pairs in place. Several of those skip reasons treat a shared prelude as if it were the whole function. `FailureDistillation.buildFailureDescription` and `buildLesson` share the content / empty-chain / root-cause prelude; only the sentence template differs. `FailureManager.getAll` and `PlanManager.listPlans` share load-all-then-optional-field-filter; the record types and the field list differ. Those are real duplications. This plan re-reads every K row against the source on the baseline below and marks it **MERGE** or **KEEP**.

A **MERGE** extracts the shared algorithm into a helper and leaves every behavior difference at the call site. It does not combine the two functions into one body with a mode flag when that flag would hide a different control-flow or a different write path. A **KEEP** leaves both bodies as they are. "The score is high" is not a reason to merge, and "the names differ" is not a reason to keep.

`src/types` stays a leaf. `src/workers` does not import the library. Helpers that both storage classes can call live in `src/core/storageCache.ts` or `src/utils/`. They edit the in-memory snapshot. The JSONL rewrite and the SQLite statements stay in `GraphStorage` and `SQLiteStorage`.

## Baseline

Re-measured on `master` `246622d63f2826827aaf950a70dd9f238b52118e` (the `#224` cleanup head). `@danielsimonjr/repo-tools` 2.3.0. The five summary lines match the ledger's "After cleanup" counts. Resolving `inventory.jsonl` reproduces K001–K051 with the same units. Line numbers below are that inventory. They move. Re-resolve before editing.

```bash
npm install --global --ignore-scripts --no-audit --no-fund @danielsimonjr/repo-tools@2.3.0
repo-tools clones . --src=src --out=../tmp/memoryjs-clones-baseline
```

`--out` rejects an absolute path. `../tmp/memoryjs-clones-baseline` from this repo is `/tmp/memoryjs-clones-baseline`. Do not pass a path inside the repo. Do not commit `inventory.jsonl` or `clones.json`. Do not add `repo-tools.config.json`. Do not change the thresholds (`minNodes` 50, `shingle` 6, `near` 0.6, `containment` 0.9, `containment-min` 20, `rare` 60, `min-shared` 3).

Stdout on this baseline:

```text
files=307 parseErrors=0 units(minNodes=50)=1376
nodes p50=105 p90=293 p99=756 max=1915
exact groups=1 (units in them=2) text-identical groups=0
near pairs=51 by jStruct: 0.9 or more: 2, 0.8 to 0.9: 11, 0.7 to 0.8: 12, 0.6 to 0.7: 15, below 0.6 (containment): 11
units by folder: src/adapters=28 src/agent=556 src/cli=74 src/core=221 src/features=92 src/search=256 src/security=11 src/types=9 src/utils=127 src/workers=2
```

| Count | Value |
|---|---|
| Files | 307 |
| Parse errors | 0 |
| Units (`minNodes=50`) | 1376 |
| Exact groups | 1 |
| Units in exact groups | 2 |
| Text-identical groups | 0 |
| Near pairs | 51 |

`jStruct` bands inside the 51: `>= 0.9` is 2 (K001 and K002, both `jStruct` 1), `0.8–0.9` is 11, `0.7–0.8` is 12, `0.6–0.7` is 15, below `0.6` (containment rule) is 11.

The pre-cleanup baseline in [`docs/plans/EMMA_M1_M3_PLAN.md`](./EMMA_M1_M3_PLAN.md) (4 exact groups, 54 near pairs, 1365 units, commit `6010249`) is historical. Implementation PRs re-measure against the table above, then against their own head.

## Rules for every implementation PR

- Behavior stays the same. Pin the current result in a test before deleting the copy. A helper that is longer than the copy and shares only a handful of lines stays a KEEP (this is why K040 stays split).
- One family per pull request. A family is one helper plus its call sites. Do not land an unrelated K row in the same PR.
- A bad merge that creates a new near pair is fixed in that PR. Do not ledger it to skip the work.
- After the helper lands, units that fall under `minNodes=50` leave the report. That is the success condition for a thin wrapper. Do not keep wrapping until `jStruct` is zero.
- A pair that remains because the leftover shape still matches is re-judged. Do not merge the two classes to chase the score.
- Do not edit `docs/analysis/CLONES_REMAINING.md` in the code PRs. Do not renumber K ids. The closing docs PR re-runs the command and records what left the report.
- Do not sweep other `??` constructors, other `emitJson` copies, or other `graph.entities.filter` loops. Extra call sites are listed per PR, and only because they are the same algorithm as the helper just introduced.
- Each PR that edits `src/`:
  - `bunx vitest run` on the test files named in that PR.
  - `bun run typecheck` and `bun run lint` exit 0.
  - `repo-tools docs check src` exits 0. Every new exported symbol has a JSDoc block. The first sentence says what it does.
  - `repo-tools check . --docs=docs/architecture` exits 0. Update only Value cells the check reports as drift. A new `src/` file moves `reachableFiles`, `totalSourceFiles`, `totalLinesOfCode`, and `totalExports` in `docs/architecture/OVERVIEW.md`. Do not rewrite architecture prose.
  - One bullet under `CHANGELOG.md` `## [Unreleased]`. No version heading.
- Re-measure with the command above. `git status` must not show `inventory.jsonl` or `clones.json`.

`AgentMemoryConfig.mergeConfig` stays as it is. It merges nested user config with env config. `fillDefaults` below is a one-level `??` copy. Neither function replaces the other.

## Cross-cutting helpers

These four patterns cover many rows. The signature is the merge. Call sites keep the literals, the templates, and the field lists.

### `fillDefaults` — constructor `??` tables

Rows: K005, K009, K011, K020, K024, K026, K028, K039, K041, K042, K043, K044, K048.

`src/utils/fillDefaults.ts`:

```typescript
/**
 * Copies each key of `defaults` onto a new object.
 * Uses the source value when it is not null or undefined, and the default otherwise.
 * `0` and `false` on the source are kept. Keys absent from `defaults` are dropped.
 * This matches `source.field ?? default` and does not match object spread.
 */
export function fillDefaults<D extends Record<string, unknown>>(
  source: { [K in keyof D]?: D[K] | null } | null | undefined,
  defaults: D,
): D
```

Implement it as a loop over `Object.keys(defaults)` with `value ?? defaults[key]`. `{ ...defaults, ...source }` is the wrong implementation: spread copies extra keys, and an explicit `undefined` overwrites a default where `??` would not. `null` selects the default, because every current `??` site does that.

Do not put a field in `defaults` when the constructor assigns it without `??`. Those assignments keep `null`. The mixed constructors in P8 list them.

### `matchesDefined` and `loadProjectedRecords` — optional equality filters

Row: K002. Same algorithm, under the detector threshold, so the helper also replaces `DecisionManager.loadAllDecisions` / `list` and the equality checks in `AgentReflectionManager.list`.

`src/agent/recordQuery.ts` (the predicates are agent records; `src/utils` does not import `src/agent`):

```typescript
export async function loadProjectedRecords<E extends Entity, T>(
  storage: Pick<IGraphStorage, 'loadGraph'>,
  isRecord: (entity: Entity) => entity is E,
  project: (entity: E) => T,
): Promise<T[]>

export function matchesDefined(
  predicates: ReadonlyArray<readonly [wanted: unknown, actual: unknown]>,
): boolean
```

`loadProjectedRecords` is `loadGraph`, then `filter(isRecord).map(project)`. It returns the same record objects the entity already holds. It does not clone.

`matchesDefined` returns false on the first pair where `wanted !== undefined && actual !== wanted`. `null` and `''` are real filters. Do not write this with `??`. A `<` comparison is not this helper. `AgentReflectionManager.list` keeps `generalization_confidence < minConfidence` beside the helper. Limit slices stay at the call site. `DecisionManager.list` filters `r.status`. `FailureManager.getAll` filters `rec.lifecycle.status`. The caller passes the value. The helper has no field names.

### `removeIdFromPostings` — inverted-index removal

Row: K004.

`src/utils/postingIndex.ts`:

```typescript
/**
 * Deletes `id` from each posting set named by `terms`, and drops empty sets.
 * A missing `terms` iterable returns without writing. The forward map is left untouched.
 */
export function removeIdFromPostings<Term>(
  postings: Map<Term, Set<string>>,
  terms: Iterable<Term> | undefined,
  id: string,
): void
```

`NGramIndex.removeFromInvertedIndex` calls it and does not delete `docToNgrams`. `ObservationIndex.remove` returns immediately when the forward set is missing, then calls it, then deletes `entityObservations`. That forward-map delete stays in `ObservationIndex`. `TypeIndex.removeFromBucket` and `RelationIndex.remove` scan different structures. They are not call sites.

### `clearMapWithFlushRollback` — clear a map, restore on flush failure

Row: K010. K022 is a different restore and stays split.

Add to `src/utils/mutateMapWithFlushRollback.ts` (do not move `mutateMapWithFlushRollback`):

```typescript
/**
 * Clears `cache` and flushes. On flush failure, puts the snapshotted entries back
 * in their previous order and rethrows. An empty cache returns before flush.
 */
export async function clearMapWithFlushRollback<K, V>(
  cache: Map<K, V>,
  flush: (map: Map<K, V>) => Promise<void>,
): Promise<void>
```

The snapshot is `new Map(cache)`. Restore iterates that snapshot and `cache.set`s. It does not `cache.clear()` before the restore. `JsonlColumnStore.clear` calls it without taking `this.mutex`. `MapFileTier.clear` calls it inside `this.mutex.runExclusive`. The lock difference stays.

## Verdict index

| id | verdict | PR | What happens |
|---|---|---|---|
| K001 | MERGE | P1 | Shared chain prelude. Templates stay in each method. |
| K002 | MERGE | P2 | `loadProjectedRecords` + `matchesDefined`. |
| K003 | MERGE | P4 | `deleteRecordsByKey`. Case-fold stays in `TagManager`. |
| K004 | MERGE | P3 | `removeIdFromPostings`. Forward map stays in `ObservationIndex`. |
| K005 | MERGE | P7 | `fillDefaults` for both pure `??` config objects. |
| K006 | MERGE | P14 | Stream lifecycle helper. Line text stays in each method. |
| K007 | MERGE | P13 | Semantic branch helper. Score tiers stay in the fallbacks. |
| K008 | MERGE | P10 | `WorkThreadManager.updateThread` frame. Guards stay in the callback. |
| K009 | MERGE | P7 | Same `fillDefaults` as K005. |
| K010 | MERGE | P5 | `clearMapWithFlushRollback`. Mutex stays at each call site. |
| K011 | MERGE | P8 | `fillDefaults` for the `??` fields only. Callbacks stay direct. |
| K012 | MERGE | P11 | `closeProposed` for accept and reject. `supersede` stays. |
| K013 | MERGE | P22 | `bindStorageCacheState`. Lowercase callbacks stay per backend. |
| K014 | KEEP | — | Async await and sync Promise rejection cannot share one body. |
| K015 | MERGE | P12 | `AccessTracker.recordAccessBatch`. Context objects stay at the call sites. |
| K016 | MERGE | P9 | `beginUnrefInterval`. The immediate cycle stays in each `start`. |
| K017 | MERGE | P13 | Same semantic helper as K007. Intent fallback stays observations-only. |
| K018 | KEEP | — | Lexical and semantic score tables use different inputs and weights. |
| K019 | KEEP | — | `supersede` checks a second entity and starts from `accepted`. |
| K020 | MERGE | P7 | Same `fillDefaults` as K005. |
| K021 | MERGE | P10 | Same `updateThread` as K008. `finish` does not clear `owner`. |
| K022 | KEEP | — | Column delete restores one key. Tier delete restores the whole map. |
| K023 | MERGE | P4 | `writeJsonlRecordsUpdatingCache`. Invalidation stays in the callbacks. |
| K024 | MERGE | P8 | `??` fields use `fillDefaults`. `onEvict` stays a direct assign. |
| K025 | KEEP | — | Same split as K019, from the accept side. |
| K026 | MERGE | P8 | Flat `??` fields use `fillDefaults`. Nested `thresholds.semantic` stays a line. |
| K027 | MERGE | P13 | Task id short-circuit stays in front of the semantic helper. |
| K028 | MERGE | P7 | `createSummaryOnEnd`'s default is the computed boolean passed into `fillDefaults`. |
| K029 | KEEP | — | Archive and resolve already share `versionedWriteFailure`. The patches differ. |
| K030 | MERGE | P15 | `selectWeightedTurns`. Fetch and projection stay in each backend. |
| K031 | KEEP | — | BFS marks visited on enqueue. DFS marks visited on pop. |
| K032 | MERGE | P17 | Shared load and relation-end projection. Report shapes stay. |
| K033 | KEEP | — | GraphML and GEXF write different XML schemas. |
| K034 | MERGE | P18 | `collectEvents`. Candidate queries and predicates stay in each method. |
| K035 | MERGE | P6 | `clampedHalfLifeScore`. Default half-lives stay 24 and 168. |
| K036 | MERGE | P16 | `RefIndex.rewriteReverseBucket`. Per-ref mutation stays in the callback. |
| K037 | MERGE | P10 | Same `updateThread` as K008. |
| K038 | MERGE | P19 | `timeLayer` shell. Search calls and the semantic early return stay outside. |
| K039 | MERGE | P8 | `??` fields use `fillDefaults`. `entropyFilter` and `exclusionManager` stay direct. |
| K040 | KEEP | — | `add` sets bits and increments `inserted`. `mayContain` returns on the first clear bit. |
| K041 | MERGE | P8 | `??` fields use `fillDefaults`. `maxDuplicateComparisons` keeps its integer check. |
| K042 | MERGE | P7 | Same `fillDefaults` as K005. |
| K043 | MERGE | P7 | Same `fillDefaults` as K005. |
| K044 | MERGE | P8 | Same split as K041, paired with `ContextWindowManager`. |
| K045 | MERGE | P20 | Shared hash bucket. Union-find and the exact-group return stay separate. |
| K046 | KEEP | — | The two registrars bind different commands, flags, and handlers. |
| K047 | MERGE | P21 | Default collect path. The custom `searchFunction` path stays in `search`. |
| K048 | MERGE | P8 | Same split as K041, paired with `MemoryFormatter`. |
| K049 | KEEP | — | `openNodes` induces relations on entities that exist. Boolean cache hits use the cached name set. |
| K050 | MERGE | P23 | Snapshot relation-delete helper. SQL and the JSONL rewrite stay put. |
| K051 | MERGE | P23 | Snapshot entity-delete helper. SQL and the JSONL rewrite stay put. |

## P1. Failure chain prelude (K001)

`buildFailureDescription` (lines 215–226) and `buildLesson` (lines 232–240) in `src/agent/FailureDistillation.ts` are the exact group (`exactHash=8eba186423d6ddd8`). Both do this, then interpolate:

```typescript
const content = episode.observations[0] ?? episode.name;
if (causeChain.length === 0) { /* template without a root */ }
const rootCause = causeChain[causeChain.length - 1];
const rootContent = rootCause.observations[0] ?? rootCause.name;
```

Private method on `FailureDistillation`:

```typescript
private failureChainText(
  episode: AgentEntity,
  causeChain: readonly AgentEntity[],
): { content: string; rootContent: string | undefined }
```

Empty `causeChain` returns `rootContent: undefined` and does not read a root entity. `observations[0] ?? name` keeps `''`. The root is the last cause, which is what `traceCauseChain` pushes, not the first.

The methods keep their templates:

- empty description: `` `Failure: ${content}` ``
- description with a root: `` `Failure: ${content} (root cause: ${rootContent})` ``
- empty lesson: `` `Avoid: ${content}` ``
- lesson with a root: `` `To prevent "${content}", address root cause: "${rootContent}"` ``

The lesson quotes both pieces. The description does not. Do not pass the template as a tag and branch inside the helper.

**Risk.** Default `minLessonConfidence` is `0.6`. An empty chain scores `0.5` and `distillFromSession` drops it, so the empty templates are live only when config allows `0.5`. A test that uses the default config never reaches them. Do not delete the empty branch because the default hides it.

**Tests.** Extend `tests/unit/agent/FailureDistillation.test.ts`. With `minLessonConfidence: 0.5`, pin exact `failureDescription` and `lesson` for an episode with no `CAUSED_BY` edge, for a one-step chain (root is that cause), and for a chain of two (root is the last entity, the existing `ep_b → ep_c → ep_d` case). Pin one episode with `observations: []` so `content` is the entity name. Existing `toContain('Environment not set')` stays.

## P2. Load-all and optional equality filter (K002)

`FailureManager.getAll` (lines 329–336) loads failure records and keeps a row when every provided option matches. `PlanManager.listPlans` (lines 392–400) does the same for plan records. The fields differ:

| Method | Predicates |
|---|---|
| `getAll` | `options.status` against `rec.lifecycle.status`; `options.sourceSessionId` against `rec.sourceSessionId` |
| `listPlans` | `options.sessionId`, `options.agentId`, `options.status` against `p.lifecycle.status` |
| `DecisionManager.list` | `options.status` against `r.status`; `sourceSessionId`; `sourceProjectId`; then a limit slice |
| `AgentReflectionManager.list` | `scope`, `sourceSessionId`, `sourceProjectId` through the helper; `minConfidence` stays `<`; limit stays |

`loadAllFailureRecords`, `loadAllPlanRecords`, and `loadAllDecisions` become `loadProjectedRecords` with `isFailureMemory` / `isPlanMemory` / `isDecisionMemory` and the existing `.failureRecord` / `.planRecord` / `.decisionRecord` projection. `getActivePlan` keeps using the plan loader, including its reverse-then-stable-sort tie break. `AgentReflectionManager.loadAllRecords` wraps `loadGraph` in its own error and then drops archived rows. Leave that method on its own loader.

**Risk.** One `filter` pass and several `filter` passes are the same AND of equalities, in the same order, with the same object identity. Do not add a limit parameter to `matchesDefined`. `DecisionManager.list` slices after the filter. `getAll` and `listPlans` do not.

**Tests.** Extend `tests/unit/agent/FailureManager.test.ts`, `tests/unit/agent/PlanManager.test.ts`, and `tests/unit/cli/decision.test.ts` or `tests/unit/agent/DecisionManager.test.ts`. Pin: omitted field does not filter; `null` does not match a string status (it is a real wanted value); a matching status plus a mismatched session returns empty; `listPlans` still returns the cached record object rather than a clone. Reflection: `minConfidence` still uses `<`, and `includeArchived` still changes `loadAllRecords` only.

## P3. Posting-list removal (K004)

`NGramIndex.removeFromInvertedIndex` (lines 255–269) and `ObservationIndex.remove` (lines 362–377) walk a document's terms, `Set.delete` the id, and delete the posting key when the set is empty.

Call `removeIdFromPostings` as specified above. `removeFromInvertedIndex` stays a one-line private method so `remove` and `addDocument` keep their current call. `ObservationIndex.remove` still deletes `entityObservations` only after a present forward set.

**Risk.** An empty `Set` still falls through and deletes the forward entry. A missing forward entry still returns first, so a stale posting is left alone. Do not delete `docToNgrams` inside the helper. `addDocument` relies on that split when it replaces a document.

**Tests.** Extend `tests/unit/search/NGramIndex.test.ts`. Re-add a document id and check the old n-gram no longer returns it, and the new n-gram does. Add an `ObservationIndex` case in `tests/unit/utils/indexes.test.ts`: removing an entity drops it from `getEntitiesWithWord`, a second remove is a no-op, and an empty observation list still clears the forward map.

## P4. JSONL record lists (K003, K023)

`TagManager.removeTagAlias` (lines 205–217) and `SavedSearchManager.deleteSavedSearch` (lines 177–188) load an array, filter by a key, and save when the length changes. `saveTagAliases` (lines 56–68) and `saveSavedSearches` (lines 75–88) stringify each element, `fs.writeFile` the `join('\n')` text, null the cache on failure, and publish the cache on success.

`src/utils/jsonlRecordFile.ts`:

```typescript
export async function writeJsonlRecordsUpdatingCache<T>(
  filePath: string,
  records: readonly T[],
  onWriteFailure: () => void,
  onWriteSuccess: (records: T[]) => void,
): Promise<void>

export async function deleteRecordsByKey<T>(
  load: () => Promise<T[]>,
  save: (records: T[]) => Promise<void>,
  keyOf: (record: T) => string,
  key: string,
): Promise<boolean>
```

`writeJsonlRecordsUpdatingCache` writes `records.map(JSON.stringify).join('\n')` with `fs.writeFile`. No trailing newline. An empty array writes `''`. It does not call `durableWriteFile` and it does not call `serializeJsonlMap` (that helper adds a trailing newline and wraps `{key, value}`). On failure it calls `onWriteFailure` and rethrows the same error. On success it calls `onWriteSuccess` with the same array reference.

Tag failure callback nulls `aliasCache` only. Saved-search failure callback nulls `searchCache` and `searchIndex`. Tag success assigns `aliasCache`. Saved-search success calls `setCache`, which rebuilds the name index.

`deleteRecordsByKey` filters out every row whose `keyOf` equals `key`. Length unchanged returns `false` and does not save. Tag passes `alias.toLowerCase()` as `key` and `row.alias` as `keyOf`. Saved search passes `name` and `row.name` with no case fold.

Leave `loadTagAliases` and `loadSavedSearches` as they are. Saved search maintains `searchIndex`. Tag does not.

**Risk.** A case-fold inside `deleteRecordsByKey` would make saved-search names case-insensitive. A switch to `durableWriteFile` would change permissions and the crash window. Both are out of this PR.

**Tests.** Extend `tests/unit/features/TagManager.test.ts`, `tests/unit/features/TagManager-loader-pins.test.ts`, `tests/unit/search/SavedSearchManager.test.ts`, and `tests/unit/search/SavedSearchManager-loader-pins.test.ts`. Pin: removing `JS` removes a tag alias `js` and returns true; removing `JS` does not remove a saved search named `js`; a missing name returns false and leaves the file bytes unchanged; a thrown `writeFile` nulls the tag cache and nulls both saved-search caches; the file has no trailing newline.

## P5. Clear-with-rollback (K010)

`JsonlColumnStore.clear` (lines 162–173) and `MapFileTier.clear` (lines 94–107) snapshot the map, `clear` it, flush, and on failure `set` each snapshotted entry back. Use `clearMapWithFlushRollback`. `JsonlColumnStore.clear` stays outside `this.mutex`. `MapFileTier.clear` stays inside it. Do not "fix" the missing column-store lock here.

K022 stays out. `JsonlColumnStore.delete` remembers one value and `cache.set`s it back, which moves that key to the end of the map. `MapFileTier.delete` snapshots the whole map, `clear`s, and reinserts, which restores every key's position. Under the lock the other keys are unchanged, so the restored key's position is the behavior difference. A later successful flush writes that order. Do not pick one restore and call it equivalent.

**Tests.** Extend `tests/unit/core/columns/JsonlColumnStore.test.ts` and `tests/unit/search/tiered/DiskWarmTier.test.ts` (`MapFileTier.clear` / `delete` run through `DiskWarmTier`). A flush that throws leaves the previous entries in their previous order and still throws. An empty clear does not call flush. A column-store `delete` whose flush throws still restores that single key at the end. A tier `delete` whose flush throws restores the deleted key at its old index.

## P6. Clamped half-life (K035)

`AccessTracker.calculateRecencyScoreFromTimestamp` (lines 218–231, default half-life 24) and `DecayEngine.calculateDecayFactorStatic` (lines 241–252, default half-life 168) both return `0` for a missing timestamp, convert the timestamp to hours, call `halfLifeFactor`, and clamp to `[0, 1]`.

Add to `src/utils/halfLife.ts`:

```typescript
/**
 * Returns the clamped half-life score of a timestamp.
 * An empty timestamp returns 0. A future timestamp clamps to 1.
 * An unparseable timestamp still produces NaN, matching both callers.
 */
export function clampedHalfLifeScore(timestamp: string, halfLifeHours: number): number
```

Each static method becomes a one-line call that keeps its own default argument. `calculateRecencyScore` (the instance method) has a different empty-history result and stays as it is. `DistillationPolicy.scoreRecency` is unclamped (audit D10) and is not a call site.

**Tests.** Extend `tests/unit/agent/AccessTracker.test.ts` and `tests/unit/agent/DecayEngine.test.ts`. Same timestamp and same half-life produce the same number from both methods. Defaults 24 and 168 still differ. `''` returns 0. A timestamp one hour ahead clamps to 1. `'not-a-date'` still returns `NaN`.

## P7. `fillDefaults` for pure config objects

K005, K009, K020, K028, K042, K043. The constructors and their `??` fields:

| Constructor | Lines | Defaults |
|---|---|---|
| `AccessTracker` | 90–100 | `historyBufferSize` 100, `recencyHalfLifeHours` 24, `frequentThreshold` 10, `occasionalThreshold` 1 |
| `ContextWindowManager` | 154–174 | `defaultMaxTokens` 4000, `tokenMultiplier` 1.3, `reserveBuffer` 100, `maxEntitiesToConsider` 1000, `workingBudgetPct` 0.3, `episodicBudgetPct` 0.3, `semanticBudgetPct` 0.4, `recentSessionCount` 3, `diversityThreshold` 0.8, `enforceDiversity` true |
| `SalienceEngine` | 71–96 | `importanceWeight` 0.25, `recencyWeight` 0.25, `frequencyWeight` 0.2, `contextWeight` 0.2, `noveltyWeight` 0.1, `recencyDecayHours` 24, `sessionBoostFactor` 1.0, `recentEntityBoostFactor` 0.7, `useSemanticSimilarity` true, `uniquenessThreshold` 0.5, `freshnessWeight` 0.15, `connectivityWeight` 0 |
| `MemoryFormatter` | 49–62 | `defaultMaxTokens` 2000, `tokenMultiplier` 1.3, `includeTimestamps` true, `includeSalience` false, `includeMemoryType` true, `promptTemplate` `''` |
| `SessionManager` | 127–144 | `consolidateOnEnd` false, `cleanupOnEnd` false, `promoteOnEnd` true, `createSummaryOnEnd` (`episodicMemory !== undefined`), `defaultAgentId` `'default'` |

`this.accessRecords`, `this.dirty`, `ContextProfileManager`, `SummarizationService`, `FreshnessManager`, `defaultPromptTemplate`, and `activeSessions` stay handwritten. They are not config fields. `SessionManager` passes the computed boolean as the `createSummaryOnEnd` default. Explicit `false` still wins, including when an episodic manager was passed.

Add `tests/unit/utils/fillDefaults.test.ts` for `null`, `undefined`, `0`, `false`, dropped extra keys, and key order following `defaults`. Extend `tests/unit/agent/SessionManager.test.ts` so `createSummaryOnEnd` defaults true only when the episodic argument is present, and an explicit `false` stays false. Existing salience, context-window, and formatter tests cover the other defaults.

**Risk.** Constructors of two classes stay two constructors. If a pair remains after this PR, the leftover is dependency wiring. Leave it.

## P8. `fillDefaults` for mixed constructors

Depends on P7 only for the shared file. Land after P7 so the two diffs do not edit `fillDefaults.ts` together. K011, K024, K026, K039, K041, K044, K048.

Fields that go through `fillDefaults`:

| Constructor | `??` fields |
|---|---|
| `ConsolidationScheduler` | `consolidationIntervalMs` `60 * 60 * 1000`, `autoMergeDuplicates` false, `duplicateThreshold` 0.9 |
| `DecayScheduler` | `decayIntervalMs` `60 * 60 * 1000`, `autoForget` false |
| `WorkingMemoryManager` | `defaultTTLHours` 24, `maxPerSession` 100, `autoPromote` false, `autoPromoteConfidenceThreshold` 0.8, `autoPromoteConfirmationThreshold` 2 |
| `ConsolidationPipeline` | `summarizationEnabled` true, `patternExtractionEnabled` true, `minPromotionConfidence` 0.7, `minPromotionConfirmations` 2, `preserveOriginals` false, `similarityThreshold` 0.8 |
| `LangChainMemoryAdapter` | `sessionId` `'langchain'`, `inputKey` `'input'`, `outputKey` `'output'`, `memoryKey` `'history'`, `returnString` false, `maxTurns` 20 |
| `LRUHotTier` | `name` `'hot'`, `maxEntries` `DEFAULT_MAX_ENTRIES`, `maxBytes` `Number.POSITIVE_INFINITY`, `estimateBytes` `defaultEstimateBytes` |
| `RelationConsolidator` | `maxGroups` 100, `maxLlmBatch` 50, `maxNeighborhoodRelations` 200 |

Fields that stay a direct assignment, because the source uses no `??` and `null` must survive:

- `ConsolidationScheduler`: `onConsolidationComplete`, `onError`
- `DecayScheduler`: `forgetOptions`, `onDecayComplete`, `onForgetComplete`, `onError`
- `WorkingMemoryManager`: `entropyFilter`, `exclusionManager`
- `LRUHotTier`: `onEvict`
- `RelationConsolidator`: `embedding`, `llm`, and `semanticThreshold = options.thresholds?.semantic ?? 0.9`

`ConsolidationPipeline.maxDuplicateComparisons` stays the current condition: a safe integer greater than 0, otherwise `100_000`. `0`, `1.5`, and `-1` still become `100_000`. Fill `similarityThreshold` first and pass that filled value into `new SummarizationService({ defaultSimilarityThreshold })`, which is the same number the `??` expression produces today.

`LangChainMemoryAdapter` and `LRUHotTier` assign fields one by one. Build one defaults object, then assign `this.*` from it. `this.engine = ctx.memoryEngine` stays outside that object.

**Tests.** `tests/unit/utils/fillDefaults.test.ts` already covers `??`. Add constructor cases, or extend the manager tests, for: scheduler `onError: null` stays `null`; `LRUHotTier` `onEvict: null` stays `null` and `maxBytes: 0` stays `0`; `WorkingMemoryManager` passes an `exclusionManager` through; `ConsolidationPipeline` `maxDuplicateComparisons: 0` still stores `100_000` (`tests/unit/agent/ConsolidationPipeline.test.ts` already passes `5`); `RelationConsolidator` `thresholds: { semantic: 0.5 }` still stores `0.5`, and a missing `thresholds` still stores `0.9`.

## P9. Scheduler interval (K016)

`ConsolidationScheduler.start` (lines 123–137) and `DecayScheduler.start` (lines 118–132) share: return if `running`, set `running`, `setInterval` of a voided cycle, `unref`. They differ after that. Consolidation stores `this.initialCyclePromise = this.runConsolidationCycle()`. Decay fires `void this.runDecayCycle()` and stores nothing.

`src/utils/unrefInterval.ts`:

```typescript
export interface IntervalRunState {
  running: boolean;
  intervalId?: ReturnType<typeof setInterval>;
}

/** Starts the interval. Returns false when `state.running` was already true. */
export function beginUnrefInterval(
  state: IntervalRunState,
  intervalMs: number,
  tick: () => Promise<void> | void,
): boolean

export function stopUnrefInterval(state: IntervalRunState): void
```

`beginUnrefInterval` sets `running`, assigns `setInterval(() => { void tick(); }, intervalMs)`, and `unref`s. It does not call `tick` itself. Each `start` returns immediately when the helper returns false, so a second `start` does not launch a second immediate cycle. The immediate call stays in the class: stored promise on consolidation, `void` on decay.

`stop` on both classes is the same `clearInterval` and `running = false`, and it is under `minNodes`. Point both `stop` methods at `stopUnrefInterval` in this PR so the teardown does not become the next copy. `isRunning` and `getInterval` stay in each class. They read different config fields (`consolidationIntervalMs` vs `decayIntervalMs`).

**Risk.** Folding the immediate call into the helper would drop `initialCyclePromise`. Tests that await the first consolidation cycle depend on that property. The interval callback stays `void tick()`, matching today's fire-and-forget tick. Decay's cycle already catches its own errors. Do not add a try/catch in the helper.

**Tests.** `tests/unit/agent/ConsolidationScheduler.test.ts` and `tests/unit/agent/DecayScheduler.test.ts`, with fake timers: first `start` sets the interval to the configured ms and unrefs; second `start` does not call `setInterval` again; consolidation's `initialCyclePromise` is defined after the first start and unchanged after the second; decay does not grow a promise field; `stop` then `start` arms a new interval.

## P10. Work-thread frame (K008, K021, K037)

`claim` (lines 309–329), `release` (lines 338–354), and `finish` (lines 562–577) load `this.threads`, throw `Thread not found: ${threadId}`, mutate, set `updatedAt`, `persistThread`, and return `{ ...thread }`.

Private method:

```typescript
private async updateThread(
  threadId: string,
  apply: (thread: WorkThread) => void,
): Promise<WorkThread>
```

`apply` runs before `updatedAt`. A throw from `apply` skips `updatedAt` and `persistThread`. The callback validates before it writes, which is what the three methods do today. The helper does not snapshot the thread. There is no rollback.

Callbacks keep the current error strings:

- claim, already owned: `` `Thread ${threadId} is already owned by ${thread.owner}` ``
- claim, bad transition: `` `Cannot transition thread ${threadId} from '${thread.status}' to 'active'` ``
- release: `` `Cannot release thread ${threadId} from '${thread.status}' status` ``
- finish: `` `Cannot ${verb} thread ${threadId} from '${thread.status}' status` ``

`claim` sets `owner` and `status = 'active'`. `release` sets `owner = undefined` and `status = 'open'`. `finish` sets `status` to `done` or `cancelled` and does not touch `owner`. `complete` and `cancel` keep returning `this.finish(...)` so they stay non-async wrappers.

**Tests.** `tests/unit/agent/WorkThreadManager.test.ts`. A rejected claim leaves `updatedAt` and the persisted entity unchanged. Release clears `owner`. Finish leaves `owner` in place. The four error strings above stay exact.

## P11. Proposed-decision close (K012)

`accept` (lines 226–235) and `reject` (lines 237–251) load the entity, return `not-found`, return the already-terminal tag, reject anything other than `proposed`, build a lifecycle at `toIsoDateTime(new Date())`, and call `applyUpdate`. `reject` calls `validateNonEmpty(reason, 'reason', 'DecisionManager')` before the load.

```typescript
private async closeProposed(
  id: DecisionId | string,
  alreadyStatus: 'accepted' | 'rejected',
  alreadyResult: 'already-accepted' | 'already-rejected',
  success: 'accepted' | 'rejected',
  buildLifecycle: (now: string) => DecisionLifecycle,
): Promise<AcceptDecisionResult | RejectDecisionResult>
```

`reject` calls `validateNonEmpty` and then `closeProposed`. An empty reason still throws when the id is missing. `applyUpdate` still re-reads the entity and still stamps `lastModified` with a second `toIsoDateTime(new Date())`. Do not thread the lifecycle `now` into `lastModified`.

K019 and K025 stay KEEP. `supersede` returns `not-found` when the replacement is not a decision, allows only `accepted`, has no already-superseded return, and writes `supersededBy`. Do not add a second-entity parameter to `closeProposed`. After this PR, `accept` and `reject` may fall under `minNodes` and those two pairs may leave the report. That is expected. `supersede` stays a full method.

**Tests.** `tests/unit/agent/DecisionManager.test.ts`. Empty `reject` reason throws before a missing id can return `not-found`. Accept of a proposed decision returns `accepted`. Accept of an accepted decision returns `already-accepted`. Reject of a non-proposed status returns `illegal-transition`. `supersede` of a proposed decision is still `illegal-transition`, and `supersede` onto a missing id is still `not-found`.

## P12. Access batch (K015)

`GraphTraversal.trackTraversalAccess` (lines 133–149) and `SearchManager.trackSearchResults` (lines 210–228) return when the tracker is missing or the list is empty, build an `AccessContext`, and `Promise.all` `recordAccess`.

Add to `AccessTracker`:

```typescript
async recordAccessBatch(names: readonly string[], context: AccessContext): Promise<void>
```

The body is `Promise.all(names.map((name) => this.recordAccess(name, context)))`. Keep `Promise.all`. A sequential loop would change interleaving of the storage writes. The traversal context is `{ sessionId, taskId, retrievalMethod: 'traversal' }`. The search context adds `queryContext: query` and sets `retrievalMethod: 'search'`. Those objects stay at the call sites. The `if (!this.accessTracker)` check stays at the call sites, because the tracker is optional there.

**Tests.** `tests/unit/core/GraphTraversal.test.ts` and `tests/unit/search/SearchManager.test.ts`, or the access-tracker tests with a fake `recordAccess`. An empty node list does not call `recordAccess`. Two names call it twice with the same context object. `retrievalMethod` is `traversal` or `search` as today.

## P13. Salience semantic branch (K007, K017, K027)

`calculateTaskRelevance` (lines 352–376), `calculateQueryRelevance` (lines 401–423), and `calculateIntentRelevance` (lines 433–447) share `buildEntityText` plus `summarizationService.calculateSimilarity` when `useSemanticSimilarity` is on. The keyword tiers differ, and task relevance returns `1` when `entity.taskId === taskDescription` before any similarity call.

```typescript
private semanticOr(
  entity: AgentEntity,
  text: string,
  fallback: (entity: AgentEntity, lowered: string) => number,
): number
```

When `useSemanticSimilarity` is true, return `calculateSimilarity(buildEntityText(entity), text)`. Otherwise return `fallback(entity, text.toLowerCase())`.

Call-site fallbacks, unchanged:

- task, after the `taskId` short-circuit: name `includes` → `0.8`, observation `includes` → `0.5`, else `0`
- query: name → `1.0`, `entityType` → `0.7`, observation → `0.5`, else `0`
- intent: observation → `0.8`, else `0`. Intent does not read `name` or `entityType`.

**Risk.** Putting the `taskId` check inside `semanticOr` would make query and intent honor it. Leaving the score numbers in a shared table would hide the tiers this cleanup was right to keep apart. The helper is only the semantic branch.

**Tests.** `tests/unit/agent/SalienceEngine.test.ts`. With semantic similarity off: task name match is `0.8` and does not also return the query's `1.0`; query type match is `0.7`; intent name match is `0` and observation match is `0.8`. With a task id equal to the description, the result is `1` even when similarity is on. With similarity on and a stub `calculateSimilarity`, all three methods return that stub and do not consult the keyword tiers.

## P14. Streaming frame (K006)

`streamJSONL` (lines 140–216) and `streamCSV` (lines 243–311) share cancellation, the progress reporter, the `0o600` write stream, the `writeError` listener, the end promise, `restrictSensitiveFilePermissions`, and the `StreamResult`. They do not share the bytes they write.

Private method on `StreamingExporter`:

```typescript
private async writeStreamed(args: {
  operationName: string;
  total: number;
  options?: StreamingExportOptions;
  writeBody: (io: StreamWriteIo) => void;
}): Promise<StreamResult>
```

`StreamWriteIo.writeRaw(line: string)` writes, adds `Buffer.byteLength(line, 'utf-8')`, and does not bump `processed`. The CSV header uses it. `StreamWriteIo.writeItem(line: string, phase: string, bucket: 'entity' | 'relation')` throws `writeError` when set, checks cancellation with `operationName`, writes, counts bytes, increments `processed` and the bucket counter, and reports progress with `phase`. JSONL calls it for entities (`'writing entities'`) and relations (`'writing relations'`). CSV calls it for entity rows only. `relationsWritten` stays `0` for CSV because the body never passes `'relation'`.

The frame still: checks cancellation before setup; reports `0` and `100` under `operationName`; `secureExistingOutput`; `createWriteStream(this.filePath, { mode: 0o600 })`; registers `writeStream.on('error')` before writes; after the body, checks cancellation, waits on `writeStream.end` with the second `error` listener, then `restrictSensitiveFilePermissions`. `write()` stays un-awaited. Do not add drain handling.

Redaction stays in the body. JSONL stringifies the entity or the redacted copy. CSV calls `entityToCSVRow`. `total` is entities plus relations for JSONL, and entities only for CSV.

**Tests.** `tests/unit/features/StreamingExporter-frame-pins.test.ts` already freezes the clock and pins bytes, progress, and cancellation. Those assertions stay as they are. This PR is done when that file passes without edited expected strings. Also run `tests/unit/features/StreamingExporter.test.ts`.

## P15. Weighted-turn selection (K030)

`InMemoryBackend.get_weighted` (lines 59–86) and `SQLiteBackend.get_weighted` (lines 115–135) differ in where the turns come from and how they become a `MemoryTurn`. The tail matches: threshold default `prdMinImportanceThreshold`, limit default `10`, score with `calculatePrdEffectiveImportance`, drop scores below the threshold, sort descending, slice.

`src/agent/selectWeightedTurns.ts`:

```typescript
export function selectWeightedTurns<T>(
  items: readonly T[],
  project: (item: T) => WeightedTurn,
  threshold: number,
  limit: number,
): WeightedTurn[]
```

In-memory `project` scores `turnToEntity(turn)` and returns the original `turn`. SQLite `project` scores the entity and returns `entityToTurn(entity)`. Empty-list returns stay in each method (`!list || list.length === 0` vs `turns.length === 0`). The default `10` stays written at both call sites. `getSessionTurns` and the `Map` lookup stay in the backends.

**Tests.** `tests/unit/agent/InMemoryBackend.test.ts` and `tests/unit/agent/SQLiteBackend.test.ts`. Equal scores keep their input order. A score equal to the threshold is kept. `limit: 1` returns the higher score. An empty session returns `[]` without calling the decay engine.

## P16. Ref-index bucket rewrite (K036)

`purgeEntity` (lines 162–178) and `renameEntity` (lines 190–210) take the mutex, `ensureLoaded`, read `reverseIndex`, return `0` when the set is missing or empty, count `refs.size`, loop, delete that reverse key, `persistAll`, and return the count.

```typescript
private async rewriteReverseBucket(
  entityName: string,
  mutate: (ref: string) => void,
): Promise<number>
```

`purgeEntity` deletes `this.entries` for each ref. `renameEntity` sets `entry.entityName = newName` when the entry exists, then `addToReverseIndex(newName, ref)`. The reverse-key delete stays after the loop, in the helper. `purgeEntities` persists once for many names. It is not a call site.

**Risk.** Deleting the reverse key inside the callback changes `renameEntity` when `newName === oldName`, because `addToReverseIndex` would be writing into a set the callback already dropped. The helper deletes after `mutate` returns, matching both methods today.

**Tests.** `tests/unit/core/RefIndex.test.ts`. Purge removes every alias and returns the count. Rename moves `entityName` and `refsForEntity(oldName)` is empty. A name with no refs returns `0` and does not rewrite the sidecar.

## P17. Inspect relation ends (K032)

`snapshotEntity` (lines 42–74) and `neighbors` (lines 186–203) in `src/cli/commands/inspect.ts` both `loadGraph`, `getEntityByName`, throw `` `entity not found: ${name}` ``, and map relations to `{ to, type }` / `{ from, type }`.

Private function in that file:

```typescript
async function loadEntityRelationEnds(
  ctx: ManagerContext,
  name: string,
): Promise<{
  entity: Entity;
  outgoing: Array<{ to: string; type: string }>;
  incoming: Array<{ from: string; type: string }>;
}>
```

`snapshotEntity` still loads observations from `observationManager`, children, and ancestors, and still returns `entity.name` plus the snapshot fields. `neighbors` still returns `entity: name` (the argument), `outDegree`, and `inDegree`. It does not load the hierarchy.

**Tests.** `tests/unit/cli/inspect.test.ts`. A missing name throws the same message from `show` and `neighbors`. `neighbors` does not include `children`. `show` still includes observations from the observation manager.

## P18. Event collection (K034)

`queryEvents` (lines 277–314) and `whoDidWhat` (lines 330–367) pick candidates differently, then share dedupe, `getEvent`, optional filters, chronological sort, and limit.

`queryEvents` candidates: `actor` via `ACTOR_OF_RELATION`, else `target` via `TARGETED_RELATION`, else every `event` entity. Filters: actor, target, action, flow tag, time range. It keeps events with no actor.

`whoDidWhat` candidates: `target` via `TARGETED_RELATION`, else `context` via `OCCURRED_IN_RELATION`, else every `event` entity. It drops events whose `actor` is missing, filters target, context, and time range, then maps to `{ actor, action, event, occurredAt? }`.

```typescript
private async collectEvents(
  candidates: readonly string[],
  accept: (event: EventRecord) => boolean,
): Promise<EventRecord[]>
```

The helper `dedupe`s, skips a null `getEvent`, skips `accept === false`, `sortChronologically`, and returns the events. Limit and the who-did-what mapping stay in the callers. Candidate queries stay in the callers. `getFlow` still calls `queryEvents({ flowKey })`.

**Tests.** `tests/unit/agent/EventManager.test.ts`. `queryEvents({ actor })` does not use the target index. `whoDidWhat` omits an event with no actor. `queryEvents` keeps that event. Flow-tag and context filters still apply only on their own method. Order stays chronological with unknown times last.

## P19. Parallel layer timing (K038)

`executeSemanticLayer` (lines 207–269) and `executeLexicalLayer` (lines 274–321) share a start timestamp, an empty result map, a timeout race, a catch that records `error.message`, `timeout.clear()` in `finally`, and a `LayerTiming` object. Semantic search returns before creating a timeout when `this.semanticSearch` is missing, with `success: true` and `resultCount: 0`. Lexical search has no such early return. The calls are `semanticSearch.search` plus `addSimilarityScores`, versus `rankedSearch.searchNodesRanked` plus `addNormalizedLexicalScores`.

```typescript
private async timeLayer(
  layer: 'semantic' | 'lexical',
  timeoutMs: number,
  timeoutMessage: string,
  results: Map<string, number>,
  run: (results: Map<string, number>) => Promise<void>,
): Promise<{ results: Map<string, number>; timing: LayerTiming }>
```

The semantic early return stays in `executeSemanticLayer`, before `timeLayer`. `executeSymbolicLayer` is synchronous and has no timeout. It is not a call site.

**Tests.** `tests/unit/search/ParallelSearchExecutor.test.ts`. A missing semantic search does not start a timer and returns success with zero results. A lexical throw records the message, clears the timeout, and returns `success: false`. A semantic success still goes through `addSimilarityScores`.

## P20. Observation hash buckets (K045)

`findDuplicateObservations` (lines 90–121) and the first loop of `findJaccardDuplicates` (lines 128–211) walk candidate entities, skip empty normalized observations, and bucket by `sha256`. Exact groups then sort by occurrence count and slice. Jaccard continues with union-find, the distinct-text skip, and `tier: 'jaccard'`.

Private method that returns the exact-tier bucket shape `{ observation, occurrences }` keyed by hash. It does not call `tokenSet`. Jaccard builds tokens in a second pass over those buckets with `tokenSet(bucket.observation)`. Exact grouping, the jaccard threshold, and the distinct-text skip stay in their methods. Both methods keep `minOccurrences ?? 2` and `maxGroups ?? 100`.

**Risk.** Computing tokens inside the shared bucket would make the exact path pay for Jaccard. A second pass after the hash bucket keeps the exact path token-free and keeps occurrence order.

**Tests.** `tests/unit/agent/ObservationDedupManager.test.ts`. Exact groups still use `tier: 'exact'` and do not merge near-duplicates. Jaccard still skips a group whose texts are identical. Occurrence order inside a hash bucket matches entity walk order.

## P21. Session query default collect (K047)

`search` (lines 363–407) and `execute` (lines 481–497) share `resolveSessionIds`, a graph load, `applyFilters`, then offset and limit. `search` also has a `searchFunction` branch that never loads the graph, and a default branch that keeps agent entities whose name or an observation contains the query. `execute` keeps every agent entity. `search` does not build a plan that `execute` runs. The ledger sentence that says so does not match the methods.

```typescript
private async collectFiltered(
  predicate: (entity: Entity) => boolean,
): Promise<AgentEntity[]>

private paginate(results: AgentEntity[]): AgentEntity[]
```

`collectFiltered` resolves session ids, loads the graph, filters with `predicate`, keeps `isAgentEntity`, runs `applyFilters`, and `paginate`s. `execute` calls it with `isAgentEntity`. The default arm of `search` calls it with the current name-or-observation predicate (that predicate already requires `isAgentEntity`). The `searchFunction` arm maps `SearchResult.entity`, filters `isAgentEntity`, `applyFilters`, and `paginate`s. It does not call `collectFiltered`. `searchWithRecencyRanking` slices `limit` and does not apply `offset`. It does not call `paginate`.

**Tests.** `tests/unit/agent/SessionQueryBuilder.test.ts`. A custom `searchFunction` does not call `loadGraph`. `execute` returns entities that fail the text predicate `search` would drop. `offset` then `limit` still apply in that order on both methods.

## P22. Cache-state binding (K013)

`GraphStorage.cacheStateOf` (lines 349–376) and `SQLiteStorage.cacheStateOf` (lines 386–410) build live getters for `cache`, `nameIndex`, `typeIndex`, `relationIndex`, and `relationKeyMap`. GraphStorage also exposes `observationIndex`. Lowercase writes differ: `lowercaseCache.set` / `lowercaseCache.remove(entity.name)` versus `updateLowercaseCache` / `lowercaseCache.delete(entity.name)`.

Add to `src/core/storageCache.ts`:

```typescript
export function bindStorageCacheState(
  owner: {
    cache: KnowledgeGraph | null;
    nameIndex: NameIndex;
    typeIndex: TypeIndex;
    relationIndex: RelationIndex;
    relationKeyMap: Map<string, Relation>;
    observationIndex?: ObservationIndex;
  },
  lowercase: {
    set(entity: Entity): void;
    remove(entity: Entity): void;
  },
  options?: { includeObservationIndex?: boolean },
): StorageCacheState
```

Getters read `owner.*` at call time. `includeObservationIndex: true` defines an enumerable `observationIndex` getter. SQLite omits the option, and the returned object has no `observationIndex` property. Each storage class keeps a private `cacheStateOf` that passes its lowercase callbacks. The constructors still call that private method.

**Tests.** In `tests/unit/core/GraphStorage.test.ts` and `tests/unit/core/SQLiteStorage.test.ts`, an entity written through the public API is visible to the name index after construction (the getters are live). `'observationIndex' in state` is not required if the state stays private; instead pin a JSONL observation lookup and a SQLite write that does not touch an observation index. A lowercase update still changes the JSONL cache via `set` and the SQLite cache via `updateLowercaseCache`.

## P23. Snapshot edits after the durable write (K050, K051)

This is the storage-boundary PR. The clone tool pairs the small JSONL closures with the large SQLite methods because the closure's shape is contained in the SQLite method (`contain` 0.982 and 0.978). The containment is the in-memory edit both backends already perform after their own durable write. The durable writes stay different.

`applyCacheDeletion` (GraphStorage lines 1412–1418) and the block in `SQLiteStorage.deleteEntities` after the SQL transaction both filter `cache.entities` and `cache.relations` with the name set and call `removeEntitiesFromIndexes`.

`applyCacheMutation` (GraphStorage lines 1514–1527) and the block in `SQLiteStorage.deleteRelations` after `tx()` both filter relations by `relationKeyOf`, remove them from `relationIndex` and `relationKeyMap`, and set `lastModified` on `touchedEntities`. The timestamp loop runs even when `deletedRelations` is empty.

Add to `src/core/storageCache.ts`:

```typescript
export function deleteNamesFromSnapshot(
  cache: KnowledgeGraph,
  nameSet: ReadonlySet<string>,
): void

export function deleteRelationsFromSnapshot(
  cache: KnowledgeGraph,
  indexes: Pick<StorageCacheState, 'relationIndex' | 'relationKeyMap'>,
  keySet: ReadonlySet<string>,
  deletedRelations: readonly Relation[],
  touchedEntities: readonly Entity[],
  timestamp: string,
): void
```

`GraphStorage` keeps the closures. `appendViaSegmentSave` still receives `applyCacheDeletion` / `applyCacheMutation` and still runs them only after the segment write. The non-segment path still writes the file, then calls the closure. `SQLiteStorage` still runs `PRAGMA foreign_keys`, the `DELETE` statements, and the embeddings delete inside the transaction, then calls the helper. `previousTimestamps` is still captured before the helper mutates `lastModified`. Event emission stays in each method.

Do not move a SQL statement into `GraphStorage`. Do not move `writeGraphFile` or `appendViaSegmentSave` into `SQLiteStorage`. Do not call the helper before the durable write. A throw from the durable write must leave the cache arrays as they were.

**Tests.** `tests/unit/core/GraphStorage.test.ts`, `tests/unit/core/segments/GraphStorage-segments.test.ts`, and `tests/unit/core/SQLiteStorage.test.ts`. Delete an entity and the cascaded relations disappear from the reloaded graph on both backends. A relation delete with `touchEntities` and no matching relation still bumps `lastModified` and emits `entity:updated`. A failed JSONL write leaves the entity in the cache. SQLite still turns foreign keys back on when the transaction throws.

## KEEP

### K014. `EntityValidator.validate` / `validateSync`

`validate` (lines 156–199) `await`s `rule.validate`. `validateSync` (lines 218–266) calls it, and when the return value is a `Promise` it throws `` `Rule "${rule.name}" is async. Use validate() instead of validateSync()` `` before it reads `valid`. One async function would make `validateSync` return a Promise. One sync function would drop the await in `validate` and change microtask ordering. The issue-object block is repeated. A `pushIssue` helper would leave both loops above `minNodes` and would not remove the row. Leave both methods.

### K018. `scoreLexicalLayer` / `scoreSemanticLayer`

Lexical (lines 676–691) starts at 50, adds 20 for 2–5 words, 10 when the query has no `AND`/`OR`/`NOT`, 15 for `factual`, and 10 for `aggregation`. Semantic (lines 718–736) starts at 45, adds 25 for 5 or more words, the same operator bonus, 30 for `conceptual`, 20 for `comparative`, and 15 for `complexity === 'high'`. `scoreSymbolicLayer` is a third table (base 40, temporal range, filter keywords) and is not this pair. A rule list would hide which inputs each layer is willing to see. Leave the three methods.

### K019 and K025. `supersede` against `reject` and `accept`

`supersede` (lines 253–270) loads a second entity and returns `not-found` when that entity fails `isDecisionMemory`. The source status must be `accepted`. There is no `already-superseded` return. The lifecycle stores `supersededBy`. P11 extracts the proposed→terminal frame from accept and reject only. After those wrappers shrink, these pairs may leave the report. Do not fold `supersede` into `closeProposed` to make that happen.

### K022. `JsonlColumnStore.delete` / `MapFileTier.delete`

Column delete (lines 107–121) stores `cache.get(name)` and `cache.set`s it back on failure. Tier delete (lines 70–85) copies the whole map, `clear`s, and reinserts. The restored key's position differs, so the next flush's line order differs. Both already run their own flush. P5's clear helper is the full-snapshot algorithm. Delete does not join it.

### K029. `AgentReflectionManager.archive` / `FailureManager.markResolved`

Both load, return `not-found` on the wrong type, return an already-done tag, stamp `toIsoDateTime`, patch through `entityManager.updateEntity` with `expectedVersion ?? 1`, and map errors with `versionedWriteFailure`. That error mapping already has one home. The patches do not match. Archive writes `reflectionRecord` with `archived: true` and `archivedAt`. Resolve writes `failureRecord.lifecycle`, and it omits `resolvedReason` when `reason` is absent (`'resolvedReason' in lifecycle` is false). A shared patch helper would have to know the record key, the idempotency predicate, and the omitted-key rule. Leave the methods.

### K031. `GraphTraversal.bfs` / `dfs`

Both reject a missing start entity and return empty maps. The walks differ. BFS marks `visited` when it enqueues, always sets `parents` at enqueue, and uses a head index. A node past `maxDepth` was already marked visited, so another path cannot enter it. DFS marks `visited` when it pops, sets `parents` only when the neighbor has no parent yet, and a node past `maxDepth` is not marked visited, so a later shallower path can still enter it. Because DFS is LIFO, the parent recorded at the first push is not always the path that visits the node. A `frontier` parameter that marks visited at one moment would change one of those results. Leave both walks.

### K033. `exportAsGraphML` / `exportAsGEXF`

GraphML (lines 774–817) declares six node keys and three edge keys, writes optional `createdAt`, `lastModified`, `tags`, and `importance`, and wraps edge data in child elements. GEXF (lines 819–860) writes a meta creator, two node attributes (`entityType`, `observations`), and a self-closing edge whose `label` is the relation type. Both escape with `escapeXml` and join lines. The element vocabulary is the format. Leave both exporters.

### K040. `BloomFilter.add` / `mayContain`

Both hash with `doubleHash` and walk `(h1 + i * h2) % bitCount`. `add` ORs the mask and then increments `inserted`. `mayContain` returns `false` on the first clear bit and never writes. A mode flag would hide that return. A `forEachBit` callback is longer than the five shared lines once both call sites grow closures. Leave the loops. Audit D9 (the FNV comment) is a separate doc fix, not this row.

### K046. CLI registrars

`registerHeuristicCommands` (lines 23–124) registers `add`, `list`, `count`, `get`, `match`, `reinforce`, and the rest of the heuristic tree, including a `match` handler that does not use `runAction`. `registerObservationDedupCommands` (lines 52–82) registers `find` and `find-jaccard` with dedup flags and `buildFilter`. The containment is Commander boilerplate. `emitJson` is a three-line copy in `heuristic.ts`, `observationDedup.ts`, `spell.ts`, `cache.ts`, and `reindex.ts`. It is under `minNodes` and is not this row. Extracting it does not finish K046. Leave the registrars.

### K049. `BasicSearch.openNodes` / `BooleanSearch.booleanSearch`

`openNodes` (lines 101–110) loads the graph, keeps entities whose names were requested, and induces relations on that existing-name set. `booleanSearch` (lines 182–263) parses, evaluates, filters, paginates, and caches. Its cache hit induces relations on `cached.entityNames`, including a name that is no longer an entity. `collectInducedRelations` skips a `to` that is absent from the set, so those two name sets are not interchangeable. The shared induced-relation helper already exists. Leave `openNodes` and `booleanSearch`.

## Closing docs PR

After the code PRs, one docs PR re-runs the baseline command and updates `docs/analysis/CLONES_REMAINING.md` without renumbering K ids. A row that left the report moves to a "Merged after the re-audit" section with the helper name. A row that remains gets a new why-it-stays sentence from the re-measure, still `look-alike` or `boundary`. Do not predict the post-series counts in that PR. Record the five summary lines it actually prints.

Expected direction, not a quota: the exact group goes away when K001's methods stop hashing equal or fall under `minNodes`. Near pairs whose smaller unit falls under `minNodes` leave with it. Constructor pairs that still match after P7 and P8 stay look-alikes of "assign dependencies, then fill defaults". K050 and K051 leave when the JSONL closures fall under `minNodes`. The SQLite delete methods stay large because they still hold the SQL.

## Out of scope

- A new store, a storage-write unification, or a shared SQLite/JSONL transaction type.
- `src/workers` importing the library.
- Changing `minLessonConfidence`, bloom parameters, BFS/DFS parent rules, CSV/JSONL bytes, or the unclamped `scoreRecency` in `DistillationPolicy`.
- `mergeConfig`, `purgeEntities`, `executeSymbolicLayer`, `searchWithRecencyRanking`, and the `FailureDistillation` constructor's own small `??` block. They are not K rows.
- Editing `docs/analysis/DUPLICATE_FUNCTION_AUDIT.md`.
- Version bump, tag, or release.
