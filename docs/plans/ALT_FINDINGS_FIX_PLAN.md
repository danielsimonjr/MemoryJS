# Fix plan for the findings outside the clone refactor

Planning only. This file does not change `src/` or tests. Each open bug is its own pull request, off `master`, in any order. Do not squash them into one PR. Do not bump the package version, tag, or release.

Measured against `master` `6bebe2ae4c0d4ff7b15a291a92382e9f30eac0a4` (`docs: clone refactor plan for remaining pairs K001-K051 (#229)`). The list is `docs/plans/CLONES_REFACTOR_PLAN_ALT.md`, section [Findings outside this plan](CLONES_REFACTOR_PLAN_ALT.md#findings-outside-this-plan). That section numbers the items 1–9. This plan numbers them 0–8 in the same order. "Fixed in PR 0" in the clone plan means that plan's PR 0 is the intended owner of item 0. That PR has not landed. `JsonlColumnStore.clear` still runs without the mutex on this commit.

Each item was read at that commit and, where the behavior can be exercised without a new committed test, reproduced with Bun against the source.

## Verdicts

| Item | Verdict | Where |
|---|---|---|
| 0. `JsonlColumnStore.clear` does not lock | **Confirmed.** Open. Same change as clone-plan PR 0. Implement it once. | `src/core/columns/JsonlColumnStore.ts:162-165` |
| 1. Jaccard `distinct` filter never removes a group | **Confirmed.** | `src/agent/ObservationDedupManager.ts:171-174` |
| 2. `JsonlColumnStore.delete` rollback moves the key | **Confirmed.** | `src/core/columns/JsonlColumnStore.ts:112-116` |
| 3. `searchWithRecencyRanking` ignores `offset` | **Confirmed.** | `src/agent/SessionQueryBuilder.ts:445-448` |
| 4. `retrieveForContext` hard-codes `4000` | **Confirmed** for `contextWindow.defaultMaxTokens`. The "role profile maxTokens" half does not match the code. | `src/agent/AgentMemoryManager.ts:367` |
| 5. `validateSync` drops an async rule's promise | **Confirmed.** | `src/utils/EntityValidator.ts:227-228` |
| 6. Semantic "not configured" calls `Date.now()` twice | **Already fixed** in `549c083` (`#247`), an ancestor of this commit. | `src/search/ParallelSearchExecutor.ts:216-228` |
| 7. Tag and saved-search sidecars use `fs.writeFile` | **Confirmed.** One helper, one PR. | `src/utils/jsonlRecordFile.ts:14` |
| 8. `RefIndex.renameEntity(x, x)` deletes the reverse bucket | **Confirmed** for direct callers. `EntityManager` does not reach it. | `src/core/RefIndex.ts:182-205` |

## Pull requests

Every implementation PR:

- Branches from `master`. Suggested names are below. None stack.
- Runs `bunx vitest run` on the test files named in that PR, then `bun run typecheck` and `bun run lint`, both exit 0.
- Does not change public signatures except where the section says a caller-visible result changes.
- Items 0 and 2 both edit `JsonlColumnStore.ts` and the hunks do not overlap (`delete` at 107–120, `clear` at 162–165). Either order merges.

| PR | Branch | Item | Files |
|---|---|---|---|
| A | `cursor/column-clear-lock` | 0 | `src/core/columns/JsonlColumnStore.ts`, `tests/unit/core/columns/JsonlColumnStore.test.ts` |
| B | `cursor/jaccard-distinct-text` | 1 | `src/agent/ObservationDedupManager.ts`, `tests/unit/agent/ObservationDedupManager.test.ts` |
| C | `cursor/column-delete-order` | 2 | `src/core/columns/JsonlColumnStore.ts`, `tests/unit/core/columns/columns-review-fixes.test.ts` |
| D | `cursor/recency-search-offset` | 3 | `src/agent/SessionQueryBuilder.ts`, `tests/unit/agent/SessionQueryBuilder.test.ts` |
| E | `cursor/context-default-tokens` | 4 | `src/agent/AgentMemoryManager.ts`, `tests/unit/agent/AgentMemoryManager.test.ts` |
| F | `cursor/validate-sync-rejection` | 5 | `src/utils/EntityValidator.ts`, `tests/unit/utils/EntityValidator.test.ts` |
| G | `cursor/jsonl-record-durable-write` | 7 | `src/utils/jsonlRecordFile.ts`, `tests/unit/utils/jsonlRecordFile.test.ts` |
| — | no PR | 6 | Optional pin only if `ParallelSearchExecutor.test.ts` is already open. |
| H | `cursor/refindex-identity-rename` | 8 | `src/core/RefIndex.ts`, `tests/unit/core/RefIndex.test.ts` |

PR A is the same diff as `CLONES_REFACTOR_PLAN_ALT.md` PR 0. If that PR is opened, do not open PR A. K010 in the clone plan depends on the lock landing first; this plan does not otherwise depend on the clone series. PR C restores insertion order inline. It does not add the shared snapshot helper (H6) from the clone plan. That helper can replace the inlined body later.

---

## 0. `JsonlColumnStore.clear` does not lock

**Verdict:** confirmed, not already fixed.

**Evidence.** `put` (`101-104`), `delete` (`108`), and `batchPut` (`127`) each run inside `this.mutex.runExclusive`. `clear` does not:

```162:165:src/core/columns/JsonlColumnStore.ts
  async clear(): Promise<void> {
    const cache = await this.ensureLoaded();
    await clearMapWithFlushRollback(cache, c => this.flush(c));
  }
```

`MapFileTier.clear` already locks (`src/search/tiered/MapFileTier.ts:95-99`). The class comment at `JsonlColumnStore.ts:42-52` says in-process mutations are serialized because `flush` rewrites the whole sidecar from one `Map`. `flush` (`225-228`) serializes that map synchronously, then awaits `durableWriteFile`.

**Reproduction.** Seed `seed=1`. Start `put('extra', 2)` and hold `fs.rename` of the sidecar (the binding `durableWriteFile` uses, `import { promises as fs } from 'fs'`). `clear()` settled while that rename was still held. After both calls finished, `entries()` was `[]` and the sidecar names were `["seed","extra"]`. Memory and disk disagreed.

**Root cause.** `clear` mutates and flushes the same `Map` a locked `put` is flushing, without waiting for the mutex. The later `flush` writes whatever the map contains at serialize time, and `clear` can empty that map under the in-flight `put`.

**Intended behavior.** `clear` waits for any in-flight `put`, `delete`, or `batchPut`, and those wait for an in-flight `clear`. When both have settled, `entries()` and the sidecar names are the same, and the result is one of the two serial orders (put-then-clear, or clear-then-put). A failed flush during `clear` still restores the previous entries in their previous order (`clearMapWithFlushRollback`, `src/utils/mutateMapWithFlushRollback.ts:26-42`). That restore already keeps order. This PR does not change it.

**Exact fix.**

```typescript
async clear(): Promise<void> {
  return this.mutex.runExclusive(async () => {
    const cache = await this.ensureLoaded();
    await clearMapWithFlushRollback(cache, c => this.flush(c));
  });
}
```

No method in this class calls `clear` while holding `mutex`. The mutex is private. Callers in tests await `clear()` from outside. This cannot deadlock.

**Regression test.** In `tests/unit/core/columns/JsonlColumnStore.test.ts`: seed one key, start `put` of a second key, hold `fs.rename` onto the sidecar until the test releases it, start `clear()` without awaiting, and assert `clear` has not settled while the rename is held. Release the rename, await both, then assert the names from `entries()` equal the names parsed from the sidecar. On this commit `clear` settles during the hold and the two name lists differ (`[]` vs `["seed","extra"]` in the reproduction). After the fix they match. Keep the existing failed-flush test in `tests/unit/core/columns/columns-review-fixes.test.ts` (`clear: cache restores on flush failure`, around line 145). It stays green.

**Risk.** `clear` waits for an in-flight mutation. No caller depends on it returning early. Reads (`get`, `keys`, `entries`) still do not take the mutex. That is outside this bug. Do not lock them in this PR.

---

## 1. Jaccard `distinct` filter never removes a group

**Verdict:** confirmed.

**Evidence.** The method doc says it "Skips pairs already caught by the exact tier so the output is genuinely additive" (`src/agent/ObservationDedupManager.ts:108-111`). The filter is:

```168:175:src/agent/ObservationDedupManager.ts
    const groups: DuplicateObservationGroup[] = [];
    for (const g of byRoot.values()) {
      if (g.occurrences.length < minOccurrences) continue;
      // Skip groups that collapse to a single distinct text (those are
      // the exact-tier's job).
      const distinct = new Set(g.occurrences.map((o) => `${o.entityName}|${o.observationIndex}`));
      if (distinct.size < minOccurrences) continue;
      groups.push(g);
    }
```

`bucketObservationsByHash` (`183-201`) pushes each observation once. `entityName|observationIndex` is unique per push, so `distinct.size` equals `g.occurrences.length`. The second check removes nothing. The line above it already applied `minOccurrences`.

`normalizeObservation` (`224-226`) lowercases and collapses whitespace, so `"User prefers Italian food"` and `"User prefers italian food"` share one hash and never reach the pairwise loop. They still form a group because that one bucket has two occurrences.

**Reproduction.** With threshold `0.85`:

- Alice `"User prefers Italian food"`, Bob `"User prefers italian food"`: `findJaccardDuplicates()` returned 1 group, and `findDuplicateObservations()` also returned 1 group. The Jaccard group is the exact-tier group.
- Alice `"red blue green yellow purple orange black white"`, Bob the same words plus `"pink"`: returned 1 Jaccard group (8 shared tokens, union 9, Jaccard 8/9 ≈ 0.889). That pair is a real near-duplicate and must stay.

The test "finds near-duplicates that exact tier misses" (`tests/unit/agent/ObservationDedupManager.test.ts:171-187`) uses the case-variation fixture. It passes because of this bug.

**Root cause.** The set key is the occurrence identity. The comment describes distinct normalized texts. Those texts are the hash buckets already built in `all` (`128-133`).

**Intended behavior.** A group whose occurrences all share one normalized text belongs to the exact tier whenever the caller asked for duplicates (`minOccurrences >= 2`). A group with two or more hashes is additive and stays, including when `minOccurrences` is greater than the hash count, as long as the occurrence count already passed. `minOccurrences: 1` still returns a one-text group. The pinned threshold-0 test (`ObservationDedupManager.test.ts:222-227`) expects the tokenless observation `C` as its own group under `minOccurrences: 1`. Comparing hash count to `minOccurrences` would drop a two-text cluster when `minOccurrences` is 3 even though that cluster is what this method exists to report. Use "one text, and the caller asked for duplicates" instead.

**Exact fix.** While coalescing union-find roots (`156-166`), record the set of `e.hash` values that landed in each group. Replace the occurrence-identity set with:

```typescript
if (hashes.size < 2 && minOccurrences >= 2) continue;
```

Leave the `g.occurrences.length < minOccurrences` check in place.

**Regression test.** In `tests/unit/agent/ObservationDedupManager.test.ts`:

- New test, fails before and passes after: the Italian-food case pair. `findJaccardDuplicates()` equals `[]`. `findDuplicateObservations()` still has length 1.
- Rewrite "finds near-duplicates that exact tier misses" (`171-187`) to the eight-color pair plus `"pink"`, and keep Carol's unrelated sentence. Expect one `jaccard` group containing Alice and Bob. On this commit the old fixture passes for the wrong reason; after the fix that fixture returns `[]` and the file goes red until the fixture changes.
- Do not edit the pinned tests at lines 205, 211, and 222. They stay green: the 0.5-threshold merge, the below-threshold non-merge, and the threshold-0 tokenless singleton.

**Risk.** Callers that treated case-only or whitespace-only pairs as Jaccard output will stop seeing them. They already appear in `findDuplicateObservations()`. Mixed groups (one exact pair unioned with a near text) stay, and the exact occurrences remain inside that group. This PR does not split them out. Output order is unchanged (`occurrences.length` descending, then `maxGroups`).

---

## 2. `JsonlColumnStore.delete` rollback moves the key

**Verdict:** confirmed.

**Evidence.**

```107:120:src/core/columns/JsonlColumnStore.ts
  async delete(name: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      if (!cache.has(name)) return false;
      const priorValue = cache.get(name)!;
      cache.delete(name);
      try {
        await this.flush(cache);
      } catch (err) {
        cache.set(name, priorValue);
        throw err;
      }
      return true;
    });
  }
```

`cache.delete` removes the key. `Map.prototype.set` of a missing key appends it. `serializeJsonlMap` (`src/utils/jsonlMapFile.ts:76-81`) writes keys in map iteration order, so the next successful flush writes that line last.

`MapFileTier.delete` (`src/search/tiered/MapFileTier.ts:71-85`) copies the map first and, on failure, `clear`s and re-sets every entry from that copy. `put` goes through `mutateMapWithFlushRollback`, which `set`s an existing key in place (order unchanged) or `delete`s a new key. `batchPut` (`131-140`) and `clearMapWithFlushRollback` already restore from a full snapshot. Only `delete` moves a key.

**Reproduction.** `put` `a`, `b`, `c` in that order. Fail the next flush with the same rename/open failure `tests/test-utils/inject-flush-failure.ts` uses. `delete('b')` threw. `entries()` was `["a","c","b"]`. A following successful `put('d', 4)` wrote the sidecar as `a`, `c`, `b`, `d`.

**Root cause.** The rollback inserts a key that was just deleted, so it becomes the last key. The failed flush does not change the file. The damage shows up on the next successful flush.

**Intended behavior.** After a failed `delete`, every key is back with its previous value, in the previous order. The next successful flush writes that order. A successful `delete` still removes the key and leaves the relative order of the others unchanged.

**Exact fix.** Match `MapFileTier.delete`. Do not add a new shared helper in this PR.

```typescript
async delete(name: string): Promise<boolean> {
  return this.mutex.runExclusive(async () => {
    const cache = await this.ensureLoaded();
    if (!cache.has(name)) return false;
    const snapshot = new Map(cache);
    cache.delete(name);
    try {
      await this.flush(cache);
    } catch (err) {
      cache.clear();
      for (const [k, v] of snapshot) cache.set(k, v);
      throw err;
    }
    return true;
  });
}
```

**Regression test.** In `tests/unit/core/columns/columns-review-fixes.test.ts`, next to "delete: cache restores the deleted value on flush failure" (line 121), which checks the value and not the order: `put` `a`, `b`, `c`; inject the flush failure; `delete('b')` rejects; after `vi.restoreAllMocks()`, `entries()` names are `['a','b','c']`; `put` `d`; the sidecar names are `['a','b','c','d']`. On this commit the names are `['a','c','b']` and then `['a','c','b','d']`.

**Risk.** The sidecar line order after a failed delete followed by a later successful write changes from "restored key last" to the pre-delete order. Readers that parse the file as a map are unaffected. A byte-for-byte snapshot of that sequence will change. Disk content of the failed flush itself stays the previous generation, as it does today. This is the order change the clone plan's K022 note is about. Landing it lets a later H6 adoption of `delete` preserve behavior.

---

## 3. `searchWithRecencyRanking` ignores `offset`

**Verdict:** confirmed.

**Evidence.** `search` returns `this.paginate(results)` (`SessionQueryBuilder.ts:374`, and `collectFiltered` at `467`). `paginate` (`470-478`) applies `offset`, then `limit`. `searchWithRecencyRanking` sorts, then:

```445:450:src/agent/SessionQueryBuilder.ts
    if (this.limit) {
      return sorted.slice(0, this.limit);
    }

    return sorted;
```

`offset` is stored by `withOffset` (`270-272`) and cleared by `reset` (`536`). It is never read in this method. `if (this.offset)` treats `0` as "skip nothing". `paginate` uses that same check. Keep it so the three execution methods agree, including for `offset: 0`.

The child builders inside the loop (`416-428`) are new instances. They do not inherit the parent's offset, and `builder.search` paginates only that child's state. Pagination of the merged list happens once, at the end. Do not copy `offset` onto the children.

**Reproduction.** Four working memories `mem_a`…`mem_d` in one session, `withOffset(1).withLimit(2)`, query `'mem'`. `search` returned `['mem_b','mem_c']`. `searchWithRecencyRanking` returned `['mem_a','mem_b']`. One session gives every hit the same recency score, and `Array.prototype.sort` is stable, so the order is graph order.

**Root cause.** The recency method applies `limit` itself and never calls `paginate`.

**Intended behavior.** `withOffset(n).withLimit(m)` skips `n` merged hits, then returns `m`, on `search`, `execute`, and `searchWithRecencyRanking`. Offset applies to the merged, recency-sorted list, once.

**Exact fix.** Replace the limit block and the bare `return sorted` with `return this.paginate(sorted)`.

**Regression test.** In `tests/unit/agent/SessionQueryBuilder.test.ts`, in the `searchWithRecencyRanking` describe (line 479), using the same fixture shape as "applies offset then limit on search and execute" (line 539): four `mem_*` entities in `session_1`, `withOffset(1).withLimit(2).searchWithRecencyRanking('mem')` equals `['mem_b','mem_c']`. On this commit it returns `['mem_a','mem_b']`. The existing search/execute test stays as it is.

**Risk.** Callers who set `offset` and today receive the first page will receive the requested page. Callers who set only `limit`, or neither, see the same list. `offset: 0` still means "do not skip", because `paginate` is falsy on `0`.

---

## 4. `retrieveForContext` hard-codes `4000`

**Verdict:** confirmed for the configured default. The role-profile claim is not a bug in this method.

**Evidence.**

```365:378:src/agent/AgentMemoryManager.ts
  async retrieveForContext(options: RetrieveContextOptions = {}): Promise<ContextPackage> {
    const retrievalOptions: ContextRetrievalOptions = {
      maxTokens: options.maxTokens ?? 4000,
      context: {
        currentSession: options.sessionId,
        currentTask: options.taskId,
        queryText: options.keywords?.join(' '),
      },
```

The facade builds its `ContextWindowManager` with `this.config.contextWindow` (`195-198`). That object carries `defaultMaxTokens` from the constructor and from `MEMORY_CONTEXT_MAX_TOKENS` (`AgentMemoryConfig.ts:107-108`). User config overrides the env value (`mergeSubConfig`, `244-253`). `retrieveForContext` never reads it.

`ContextWindowManager.retrieveForContext` uses `options.maxTokens` directly (`386-399`) unless `options.profile` is set (`381-383`). The `?? profileConfig.maxTokens ?? this.config.defaultMaxTokens` chain at line 1362 runs only inside `applyProfile`. `RetrieveContextOptions` (`74-83`) has no `profile` field, and this method does not set one. `maxTokens` on `ContextRetrievalOptions` is required (`src/types/agent-memory.ts:2258`), so the facade has to pass a number. Omitting the field makes `effectiveBudget` `NaN`.

Built-in role profiles set budget percentages and salience weights. None set `defaultMaxTokens` or `maxTokens` (`src/agent/RoleProfiles.ts:49-53` and the other four profiles). `createRoleAwareContextWindowManager` (`568-575`) is a separate factory. `retrieveForContext` does not call it. Built-in context profiles in `ContextProfileManager.ts` also leave `ProfileConfig.maxTokens` unset. A custom context profile's `maxTokens` is reachable only by calling `ContextWindowManager.retrieveForContext` with `profile` and without `maxTokens`. This facade method has no such argument. Do not add one in this PR.

**Reproduction.** `new AgentMemoryManager(storage, { contextWindow: { defaultMaxTokens: 150, reserveBuffer: 0, tokenMultiplier: 1 } })`, one session, 12 working memories of about 30 words. `getConfig().contextWindow.defaultMaxTokens` was `150`. `retrieveForContext({ sessionId })` returned `totalTokens` 424 and `excluded.length` 0. The same call with `maxTokens: 150` returned `totalTokens` 144 and `excluded.length` 8. A direct `contextWindowManager.retrieveForContext({ maxTokens: 150, ... })` matched the explicit call (144). All five built-in role profiles reported `defaultMaxTokens` and `maxTokens` unset.

**Root cause.** The `?? 4000` runs before the manager that was constructed with the configured default. The number `4000` is also `ContextWindowManager`'s own fill-in (`ContextWindowManager.ts:164`), so an unset config still means 4000. A set config is ignored.

**Intended behavior.** An explicit `options.maxTokens` wins. Otherwise the budget is the merged `contextWindow.defaultMaxTokens` (constructor, else `MEMORY_CONTEXT_MAX_TOKENS`, else `4000`). `reserveBuffer` and `tokenMultiplier` stay inside `ContextWindowManager`, as they do today.

**Exact fix.** In `AgentMemoryManager.retrieveForContext` only:

```typescript
maxTokens: options.maxTokens ?? this.config.contextWindow?.defaultMaxTokens ?? 4000,
```

Do not change `ContextWindowManager`. Do not add `profile` to `RetrieveContextOptions`.

**Regression test.** In `tests/unit/agent/AgentMemoryManager.test.ts`, in "context retrieval + formatting" (line 401): build a manager with `contextWindow: { defaultMaxTokens: 150, reserveBuffer: 0, tokenMultiplier: 1 }` on its own temp `GraphStorage` (the suite's shared manager uses the defaults). Add a session and enough working memories that their token total is above 150 and below 4000. `retrieveForContext({ sessionId })` has `excluded.length > 0` and `totalTokens <= 150`. The same call with `maxTokens: 4000` has `excluded.length === 0`. On this commit the omitted call excludes nothing. Leave the existing tests that pass `maxTokens` as they are.

**Risk.** Callers who omit `maxTokens` and also set `defaultMaxTokens` or `MEMORY_CONTEXT_MAX_TOKENS` to something other than 4000 get that budget. Callers who omit both keep 4000. Callers who pass `maxTokens` are unchanged. `validateConfig` already rejects a non-positive `defaultMaxTokens` (`AgentMemoryConfig.ts:209-212`).

---

## 5. `validateSync` drops an async rule's promise

**Verdict:** confirmed.

**Evidence.**

```226:229:src/utils/EntityValidator.ts
        if (result instanceof Promise) {
          throw new Error(`Rule "${rule.name}" is async. Use validate() instead of validateSync()`);
        }
```

The `throw` is inside the `try` at line 223. The `catch` at `247-256` records it as a validation error and does not rethrow. `validateSync` returns `{ isValid: false }` (the existing test at `EntityValidator.test.ts:336-349`). Calling `rule.validate` has already started the promise. Nothing attaches a rejection handler. The existing test's rule resolves `{ valid: true }`, so it never rejects and the suite stays quiet.

**Reproduction.** A rule whose `validate` returns `Promise.reject(new Error('rule blew up'))`. `validateSync` returned `isValid: false` and the message `Validation error: Rule "async-reject" is async. Use validate() instead of validateSync()`. An `unhandledRejection` listener then received `"rule blew up"`.

**Root cause.** The sync API detects the promise and refuses to use it, and it never catches it. A later rejection is unhandled. Node reports that as `unhandledRejection`. Vitest's default run fails the file on one (`vitest.config.ts` leaves `dangerouslyIgnoreUnhandledErrors` off unless `IGNORE_UNHANDLED_REJECTIONS=true`).

**Intended behavior.** `validateSync` still does not await the rule and still reports the "is async" error. The promise's later rejection is swallowed. Side effects the rule already started still happen. There is no way to know the return is a promise without calling `validate`.

**Exact fix.** Attach the catch on the same turn, before the `throw`:

```typescript
if (result instanceof Promise) {
  void result.catch(() => {});
  throw new Error(`Rule "${rule.name}" is async. Use validate() instead of validateSync()`);
}
```

**Regression test.** In `tests/unit/utils/EntityValidator.test.ts`, beside "should throw for async rules" (line 336): add a listener for `unhandledRejection` before `validateSync`, use `validate: () => Promise.reject(new Error('rule blew up'))`, expect `isValid === false` and a message containing `async`, `await` a macrotask (`setTimeout` 0), expect the listener's list to be empty, and remove the listener in `finally`. On this commit the list is `['rule blew up']`. Keep the resolving-async test. It still covers the recorded error.

**Risk.** A rejected async rule invoked through `validateSync` no longer surfaces as an unhandled rejection. The caller still gets the "is async" error and is expected to use `validate()`. A rule that resolves is unchanged. Do not await the promise. That would make `validateSync` async in practice and would change the recorded error.

---

## 6. Semantic "not configured" called `Date.now()` twice

**Verdict:** already fixed. No PR.

**Evidence.** Current early return, one timestamp, duration fixed at 0:

```216:228:src/search/ParallelSearchExecutor.ts
    if (!this.semanticSearch) {
      const now = Date.now();
      return {
        results,
        timing: {
          layer: 'semantic',
          startTime: now,
          endTime: now,
          durationMs: 0,
          success: true,
          resultCount: 0,
        },
      };
    }
```

`git log -L 207,229:src/search/ParallelSearchExecutor.ts` shows the previous body, introduced in the initial commit and replaced in `549c083` (`refactor(search): parallel layer timing (P19 / K038) (#247)`, 2026-10-29). That commit is an ancestor of `6bebe2ae`. The old return used `endTime: Date.now()` and `durationMs: Date.now() - startTime`, which is two further calls after `const startTime = Date.now()`, so `durationMs` could be 0 or 1. The clone-plan sentence "PR 7 keeps this as it is" describes the pre-`549c083` code. The finding was already stale when `#229` merged.

**Reproduction.** 50 `execute` calls with `semanticSearch: null` and a ranked-search double that returns `[]`. Every semantic `durationMs` was 0.

**Root cause.** None left on this commit.

**Intended behavior.** An unconfigured semantic layer reports `success: true`, `resultCount: 0`, `durationMs: 0`, and `startTime === endTime`.

**Exact fix.** None.

**Regression test.** The existing test "should report semantic layer success even when not configured" (`tests/unit/search/ParallelSearchExecutor.test.ts:278-289`) already requires `success` and `resultCount`. A pin of `durationMs === 0` and `startTime === endTime` would pass today and would have failed before `549c083`. Add those two expects only as part of a PR that is already editing that test. Do not open a PR to pin a fixed bug.

**Risk.** None. Leaving it unpinned means a future edit could reintroduce two clock reads. The duration is hardcoded `0`, so a single `Date.now()` cannot flap.

---

## 7. Tag and saved-search sidecars use `fs.writeFile`

**Verdict:** confirmed. The two classes are one bug. They both call `writeJsonlRecordsUpdatingCache`.

**Evidence.** `TagManager.saveTagAliases` (`src/features/TagManager.ts:60-73`) and `SavedSearchManager.saveSavedSearches` (`src/search/SavedSearchManager.ts:79-93`) are the only callers (`writeJsonlRecordsUpdatingCache` is defined once). The helper writes the live path:

```11:19:src/utils/jsonlRecordFile.ts
  const text = records.map(record => JSON.stringify(record)).join('\n');
  try {
    await fs.writeFile(filePath, text);
  } catch (err) {
    onWriteFailure();
    throw err;
  }
  onWriteSuccess(records as T[]);
```

`fs` here is `import * as fs from 'fs/promises'` (line 1). `fs.writeFile` of a string opens the target with truncation. A crash or a throw after that open leaves a short file. `durableWriteFile` (`src/utils/durableWriteFile.ts:104-114`) writes a temp file beside the target, fsyncs, and renames. Its contract says a failure leaves the previous generation in place.

`tests/unit/utils/jsonlRecordFile.test.ts` mocks `fs/promises` `writeFile` (lines 10-14). "nulls tag cache and both saved-search caches when writeFile throws" (lines 64-79) depends on that mock. "writeJsonlRecordsUpdatingCache writes no trailing newline" (lines 58-62) pins the text this helper builds: `join('\n')` with no final newline.

**Reproduction.** Under Vitest's `vi.mock('fs/promises')`, `TagManager.addTagAlias('js', 'javascript')` wrote one JSON object. The next `writeFile` was replaced with "truncate the target to `''`, then throw `crash mid-write`". The call rejected with that message and the sidecar read back as `''`. The previous alias line was gone.

**Root cause.** The helper rewrites the live file in place. Both sidecars share that helper. `RefIndex.persistAll` (`src/core/RefIndex.ts:340-345`) also uses `fs.writeFile`. That is a different writer and is outside this bug. Do not change it here.

**Intended behavior.** A failed save leaves the previous sidecar bytes unchanged, then runs the existing `onWriteFailure` (tag cache nulled; saved-search cache and index nulled) and rethrows. A successful save writes the same string as today, including no trailing newline, then runs `onWriteSuccess`.

**Exact fix.** In `writeJsonlRecordsUpdatingCache`, replace `fs.writeFile(filePath, text)` with `durableWriteFile(filePath, text)`. Keep the `try/catch`, both callbacks, and the `join('\n')` text. Import `durableWriteFile` from `./durableWriteFile.js`.

`durableWriteFile` creates the parent directory (`mode 0o700`) if it is missing, and a new file is mode `0o600` (`restrictedModeForReplacement`, lines 197-204). An existing `0644` sidecar becomes `0600` on the next successful save because the rename swaps in the temp inode. That matches the other durable sidecars (`JsonlColumnStore`, the tier files). Accept it. Do not change `durableWriteFile` in this PR.

**Regression test.** Rewrite the writeFile-throw test in `tests/unit/utils/jsonlRecordFile.test.ts`. The `vi.mock` of `writeFile` stops observing this helper once it no longer calls `writeFile`, and that test would fail for the wrong reason (the save would succeed).

Replace it with: `addTagAlias('js', 'javascript')`, read the bytes, `vi.spyOn` `fs.rename` from `import { promises as fs } from 'fs'` to reject `Object.assign(new Error('EPERM'), { code: 'EPERM' })`, expect `addTagAlias('py', 'python')` to reject `/EPERM|replace/`, expect the file bytes to equal the pre-failure bytes, and expect `aliasCache` to be `null`. On Linux, `isWindowsRenameInterference` is false (`durableWriteFile.ts:240-243`), so one rejected rename throws immediately and the target is never opened for write. On this commit `rename` is not called, the second alias is written, and `rejects` fails.

Add the same shape for `SavedSearchManager.saveSearch`: previous bytes remain, and both `searchCache` and `searchIndex` are null. Keep "writes no trailing newline".

**Risk.** Failed saves no longer truncate a good sidecar. They can leave a `*.tmp.<pid>.<hex>` file next to it, which `durableWriteFile` already does for other callers. Parent directories are created when missing (today `writeFile` would throw `ENOENT`). New and replaced sidecars are owner read/write (`0600`). The on-disk JSON text of a successful save is unchanged. Windows `EPERM`/`EBUSY`/`EACCES` renames retry with the existing backoff (up to about 785ms) and then throw `DurableReplaceError`, with the previous file intact.

---

## 8. `RefIndex.renameEntity(x, x)` deletes the reverse bucket

**Verdict:** confirmed for a direct `RefIndex` caller. `EntityManager.renameEntity` does not reach it.

**Evidence.** `renameEntity` (`src/core/RefIndex.ts:180-189`) runs every ref through a mutate that `set`s `entry.entityName = newName` and `addToReverseIndex(newName, ref)` (`351-356`), then `rewriteReverseBucket` deletes the bucket it iterated (`205`):

```192:208:src/core/RefIndex.ts
  private async rewriteReverseBucket(
    entityName: string,
    mutate: (ref: string) => void,
  ): Promise<number> {
    await this.ensureLoaded();

    const refs = this.reverseIndex.get(entityName);
    if (!refs || refs.size === 0) return 0;

    const count = refs.size;
    for (const ref of refs) {
      mutate(ref);
    }
    this.reverseIndex.delete(entityName);

    await this.persistAll();
    return count;
  }
```

When `oldName === newName`, `addToReverseIndex` adds into the set `reverseIndex.get(oldName)` already points at. The `delete` on the next line removes that set. `this.entries` still maps the ref to the name, so `resolve` keeps working. `refsForEntity` (`129-134`) reads `reverseIndex` and returns `[]`. A later `renameEntity(oldName, otherName)` takes the empty-bucket early return and leaves `entries` pointing at the old name.

`EntityManager.renameEntity` calls `storage.renameEntity` (`src/core/EntityManager.ts:1131`) before `refIndex.renameEntity` (`1143-1144`). Both backends throw `DuplicateEntityError` when `nameIndex.has(newName)` (`GraphStorage.ts:1624-1626`, `SQLiteStorage.ts:1779-1780`). The same name is in the index, so the throw happens first. There is no `oldName === newName` short-circuit. That part of the finding is accurate. Do not change `EntityManager` or the storage rename in this PR.

**Reproduction.** `register('alias', 'Alice')`, then `renameEntity('Alice', 'Alice')` returned `1`. `resolve('alias')` was still `'Alice'`. `refsForEntity('Alice')` was `[]`. `renameEntity('Alice', 'Alicia')` then returned `0`, and `resolve('alias')` stayed `'Alice'`.

**Root cause.** The reverse-index update adds to the destination bucket, and the helper always deletes the source bucket. They are the same bucket when the names are equal.

**Intended behavior.** `renameEntity(x, x)` returns the number of refs that point at `x` (0 when there are none), leaves `reverseIndex` and `entries` as they were, and does not rewrite the sidecar. A following rename to a different name still moves those refs. `renameEntity(x, y)` for `x !== y` stays as it is, including when `y` already has other refs: the source bucket and the destination bucket are different sets, and deleting the source is correct.

**Exact fix.** Inside the existing `mutex.runExclusive` of `renameEntity`, before `rewriteReverseBucket`:

```typescript
if (oldName === newName) {
  await this.ensureLoaded();
  return this.reverseIndex.get(oldName)?.size ?? 0;
}
```

Do not take the mutex twice. `rewriteReverseBucket` does not acquire it. The caller does.

**Regression test.** In `tests/unit/core/RefIndex.test.ts`, in the `renameEntity` describe (line 195): register `'alias'` → `'Alice'`, `renameEntity('Alice', 'Alice')` returns `1`, `refsForEntity('Alice')` equals `['alias']`, `resolve('alias')` equals `'Alice'`, then `renameEntity('Alice', 'Alicia')` returns `1` and `resolve('alias')` equals `'Alicia'`. On this commit the reverse list is `[]` and the second rename returns `0` with `resolve` still `'Alice'`. A name with no refs still returns `0` (the existing test at line 205). Assert the sidecar bytes are unchanged across the identity call. Today `persistAll` rewrites the same JSON. After the fix it does not write. Equal bytes cover both.

**Risk.** Direct callers who renamed a name to itself and then expected `refsForEntity` to be empty will see the refs still there. The return count for that call stays the bucket size. `EntityManager` behavior is unchanged, including `DuplicateEntityError` when the new name already exists. No sidecar rewrite on the identity path, so a crash cannot truncate the file during a no-op rename.

---

## Out of scope

- Clone-plan helpers H1–H9, including H6. PR C inlines the order restore so it does not wait on H6. PR A is H6's prerequisite and is specified here only so it is not forgotten if the clone series stalls.
- `RefIndex.persistAll` and any other `fs.writeFile` besides `writeJsonlRecordsUpdatingCache`.
- Locking `JsonlColumnStore` reads, `reload`, or `keys`.
- Adding `profile` to `RetrieveContextOptions`, or teaching `retrieveForContext` about role profiles.
- A `durationMs` pin on the unconfigured semantic layer, unless that test file is already being edited.
- Version bumps, tags, releases, and changelog entries. The behavior changes are the ones named in items 1, 2, 3, 4, and 7 (Jaccard output, delete-rollback order, recency offset, configured token default, sidecar durability and file mode). Items 0, 5, and 8 change behavior only for the bug itself (a race, an unhandled rejection, an identity rename).
