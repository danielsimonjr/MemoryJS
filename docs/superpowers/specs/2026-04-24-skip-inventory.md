# Skipped Performance Benchmarks Inventory (Phase ε.1)

**Generated:** 2026-04-25
**Source commit:** `master @ ddc1d03` (post-T46 audit-tool ship)
**Purpose:** Catalog every `it.skip` in `tests/performance/`, identify what each was waiting on, and recommend a per-test action for T42 (the unskip pass).

---

## Summary

| Metric | Value |
|---|---|
| Total `it.skip` blocks across `tests/performance/` | **10** |
| All blocked by the same "codebase split" event | **10/10** |
| Codebase split has happened | **yes** (memoryjs is the post-split repo) |
| Underlying SUTs (subjects under test) all present in `src/` | **yes** (verified — `EmbeddingCache`, `MockEmbeddingService`, `IncrementalIndexer`, `EntityManager.deleteEntities`, `RelationManager.removeRelations`, `CompressionManager.findDuplicates`, `CompressionManager.compress`, `TagManager.*`) |
| Recommended action for all 10 | **`unskip-with-baseline-update`** |

---

## Per-test catalog

### `tests/performance/embedding-benchmarks.test.ts`

| Line | Title | SKIPPED reason | SUT | Recommendation |
|---|---|---|---|---|
| 404 | `BENCHMARK: Cache operations should be fast` | "pending codebase split" | `EmbeddingCache` (`src/search/EmbeddingCache.ts`) | `unskip-with-baseline-update` |
| 430 | `BENCHMARK: Batch embedding should be efficient` | "pending codebase split" | `MockEmbeddingService.embedBatch` (`src/search/EmbeddingService.ts`) | `unskip-with-baseline-update` |
| 444 | `BENCHMARK: Incremental indexing throughput` | "pending codebase split" | `IncrementalIndexer` + `InMemoryVectorStore` (`src/search/IncrementalIndexer.ts`, `src/search/VectorStore.ts`) | `unskip-with-baseline-update` |

**Notes:** All three SUTs are present in `src/`. The "codebase split" is the historical event of memoryjs being split out from its parent repo — already shipped. Window to unskip is **now**. Each test logs durations to `console.log`; T42 should add proper P95 assertions plus a baselines file (T43).

### `tests/performance/foundation-benchmarks.test.ts`

| Line | Title | SKIPPED reason | SUT | Recommendation |
|---|---|---|---|---|
| 121 | `should scale linearly for entity deletion (benchmark)` | "Benchmark assertion - optimize after codebase split" | `EntityManager.deleteEntities` | `unskip-with-baseline-update` |
| 147 | `should scale linearly for relation deletion (benchmark)` | "...optimize after codebase split" | `RelationManager.removeRelations` (or `deleteRelation`) | `unskip-with-baseline-update` |
| 259 | `should improve findDuplicates performance with pre-computed data (benchmark)` | "...optimize after codebase split" | `CompressionManager.findDuplicates(threshold)` | `unskip-with-baseline-update` |
| 305 | `should scale linearly for compression (benchmark)` | "...optimize after codebase split" | `CompressionManager.compress` | `unskip-with-baseline-update` |
| 413 | `should scale well for tag operations (benchmark)` | "...optimize after codebase split" | `TagManager.addTagsToEntity` / `removeTagsFromEntity` | `unskip-with-baseline-update` |
| 443 | `should scale well for bulk tag operations (benchmark)` | "...optimize after codebase split" | `TagManager.addTagsToMultipleEntities` (bulk path) | `unskip-with-baseline-update` |
| 509 | `should complete complex workflow within time limit (benchmark)` | "...optimize after codebase split" | end-to-end across `EntityManager` + `RelationManager` + search | `unskip-with-baseline-update` |

**Notes:** Every named manager method is present and has unit-test coverage. The "optimize after codebase split" comment was a tactical pause to avoid CI flakiness while the parent repo's worker pool was being extracted. That extraction is complete (workers live in `dist/workers/`). Unskip is straightforward.

---

## Recommended T42 action plan

For each of the 10 tests:
1. **Replace `it.skip(` with `it(`** — single mechanical edit.
2. **Read the existing assertion shape.** Most tests already have `expect(duration).toBeLessThan(N)` — keep them but widen N by 2× for Windows/Dropbox jitter (per CLAUDE.md "Performance benchmark flakiness" gotcha).
3. **For tests that only `console.log` durations** (the three embedding-benchmarks blocks): add a P95 assertion using the existing pattern from `tests/performance/memory-engine-perf.test.ts` (sort timings, pick `Math.floor(timings.length * 0.95)`).
4. **Establish baselines** in `tests/performance/baselines.json` (T43): record p50/p95 for each test on first green run; future runs assert against those numbers ± noise floor.

Per `CLAUDE.md` § Gotchas:
> **Performance benchmark flakiness**: Overhead thresholds in `tests/performance/task-scheduler-benchmarks.test.ts` may need widening on Windows/Dropbox due to timing variance from file locking.

T45 will add a documented noise-floor entry to that gotcha covering the new benchmarks.

---

## Cross-reference: required src/ symbols (all verified present)

| Symbol | File | Status |
|---|---|---|
| `EmbeddingCache` | `src/search/EmbeddingCache.ts` | ✅ shipped |
| `MockEmbeddingService` | `src/search/EmbeddingService.ts` (line 489) | ✅ shipped |
| `IncrementalIndexer` | `src/search/IncrementalIndexer.ts` | ✅ shipped |
| `InMemoryVectorStore` | `src/search/VectorStore.ts` | ✅ shipped |
| `EntityManager.deleteEntities` | `src/core/EntityManager.ts:337` | ✅ shipped |
| `RelationManager.removeRelations` | `src/core/RelationManager.ts` | ✅ shipped |
| `CompressionManager.findDuplicates` | `src/features/CompressionManager.ts` | ✅ shipped |
| `CompressionManager.compress` | `src/features/CompressionManager.ts` | ✅ shipped |
| `TagManager.*` (per-entity + bulk) | `src/features/TagManager.ts` | ✅ shipped |

---

## Open questions for T42

1. **Should benchmarks run in CI by default?** Currently gated by `SKIP_BENCHMARKS=true` env var. Recommend keeping that gate so default `npm test` is fast; benchmarks run via a separate `npm run bench` script (T44).
2. **Should baselines be machine-specific?** Windows vs Linux timing differs by 5–20× on these workloads. Recommend per-platform baseline rows in `baselines.json`, keyed by `process.platform + os.cpus()[0].model.slice(0,20)`.
3. **The complex-workflow test (line 509) is e2e-shaped.** Likely flakier than unit-shaped benchmarks. Recommend a 3× threshold for it specifically.

---

## Next: T42

Mechanical unskip pass per the table above. Single commit per file is fine; no need to split per-test. Commit message convention: `test(perf): unskip benchmarks (post codebase split)`.
