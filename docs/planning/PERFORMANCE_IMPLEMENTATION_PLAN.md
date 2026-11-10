# MemoryJS performance implementation plan

Date: 2026-11-10
Baseline: 5ceb972545baa2c6cd44d21d18e3e7c3aa05c668

## Objective
Implement ten performance improvements while preserving exact-search results, stable tie ordering, filtering, graph ownership, and transactional failure behavior. Approximate search remains explicitly opt-in. No claimed speedup is accepted without measurement.

## Work packages

| # | Improvement | Implementation and acceptance |
|---|---|---|
| 1 | Posting-driven lexical scoring | Maintain BM25 term postings across builds and mutations; iterate selective FTS candidates directly. Preserve corpus statistics and insertion-order ties. |
| 2 | Bounded lexical top-k | Shared stable bounded selection for BM25 and ranked search, retaining graph-boost correctness and stale-hit handling. Compare output to full-sort oracle. |
| 3 | Lazy TF-IDF statistics | Avoid vocabulary-wide IDF recalculation per individual write, without changing the public index contract or scoring semantics. Verify additions, replacements, deletions, and batches. |
| 4 | Incremental index persistence | Add recoverable delta persistence or equivalent coalesced atomic persistence. Preserve legacy snapshots, reload correctness, close/flush behavior, and write-error visibility. |
| 5 | Early fuzzy filters | Apply metadata eligibility before expensive scoring, preserving full-graph version visibility and pagination. |
| 6 | Efficient fuzzy worker inputs | Reuse normalized text and bound worker count by workload; preserve worker timeout behavior and deterministic output. |
| 7 | Semantic lookup reuse | Optional versioned resolver or explicit generation cache; keep arbitrary mutable graph inputs correct. |
| 8 | Optional ANN vector backend | Implement an opt-in approximate vector store behind IVectorStore; preserve exact default; support updates/deletes and test recall against exact search. |
| 9 | PostgreSQL bulk persistence | Chunk multi-row inserts within the existing transaction, respecting parameter limits and rollback. |
| 10 | PostgreSQL cache indexes | Incrementally maintain entity positions, relation keys, type index and lowercase cache across hydration and mutations. |

## Execution
Independent agents own lexical scoring, TF-IDF lifecycle, fuzzy search, semantic/vector search, and PostgreSQL. Integration owner maintains this plan, reviews interfaces and diffs, runs verification, and fixes discovered failures, including preexisting failures. Agents must not overwrite each other's changes.

## Validation
Run focused regression tests for each package, full type checks, lint, build/export checks, and the non-performance suite. Add deterministic performance scenarios for lexical candidate selectivity, write/index maintenance, fuzzy filtering, semantic lookup and ANN recall, and PostgreSQL query-count scaling. Record actual executed commands and distinguish environmental blockers from product failures. Test cold/warm behavior separately; measure rather than promise speedups. Preserve Node runtime compatibility and package exports.

## Delivery
Commit the plan and implementation on a reviewable branch, push, open a PR, inspect checks and review feedback, fix discovered issues, then merge as authorized by the user. Update this document with implementation details, validation evidence, and any limitations before merging.

## Implementation outcome

All ten packages were implemented on `perf/search-storage-optimization` by five implementation agents with an independent validation agent and integration review.

- BM25 maintains postings and switches to sequential iteration for dense queries. BM25 and ranked search share stable bounded top-k selection; graph boosts consider every eligible scored result before truncation.
- TF-IDF statistics are lazy on internal scoring paths. Public index reads refresh native Map values for cloning. Persistence uses atomic snapshots and a generation-tagged delta journal, with serialized lifecycle operations and legacy migration. See [persistence and compatibility](../guides/TFIDF_INDEX_PERSISTENCE.md).
- Fuzzy eligibility precedes scoring, normalized worker inputs are reused, worker counts follow workload size, and same-count mutations invalidate results. Bloom/ngram rejection is explicitly approximate and off by default.
- Semantic searches accept an authoritative resolver. The optional LSH vector store has exact cosine reranking and exact fallback, defensive copies, deterministic seeding, and mutation support. Exact search remains the default. See [usage and recall tradeoffs](../guides/APPROXIMATE_VECTOR_SEARCH.md).
- PostgreSQL uses bounded multi-row insertion and incremental cache indexes. Mocked scaling tests show six insert statements for 2,501 entities and 2,500 relations. No live PostgreSQL server was available; SQL integration remains a validation limitation.

### Additional fixes found during implementation

Fixed graph-boost candidate starvation beyond 200 lexical results; stale fuzzy results after same-count updates; fuzzy prefilters dropping valid typo matches; semantic infinite retry after failed indexing and zero-limit leakage; PostgreSQL nested update aliasing, relation-field loss on reload, unsafe extension-field overrides, and duplicate-key cache/database divergence. The plan-audit CLI test now uses Node's tsx loader rather than the IPC-opening CLI, allowing it to run in restricted environments. Refreshed source inventories and architecture claims, and corrected the README's stale side-effects declaration.

### Measured outcomes

The [benchmark instructions and interpretation](../../benchmarks/README.md#performance-implementation-workloads) link checked-in same-machine before/after records. At 10,000 synthetic entities, warm p50 selective BM25 changed 0.357 to 0.022 ms; broad BM25 0.640 to 0.578 ms; filtered fuzzy 10.550 to 0.540 ms. One hundred TF-IDF additions changed 347.15 to 1.22 ms and incremental save 56.23 to 0.79 ms. Reload increased 53.59 to 88.69 ms. These samples measure source code with production guards, exclude remote embedding latency, and are observations rather than guarantees.

ANN recall@10 was 0.867 with about 36.6% of vectors evaluated, but was slower than exact search (309.44 versus 207.08 ms for 100 queries). It is an opt-in scaling/tuning option, not a demonstrated speed improvement for this workload. Optional semantic resolution reduced warm p50 from 1.709 to 0.805 ms in the same after run.

### Verification completed

- `node_modules/.bin/vitest run --maxWorkers=4`: 531 test files and 11,894 tests passed, with unhandled-error suppression disabled.
- `MEMORY_SQLITE_DRIVER=node node_modules/.bin/vitest run tests/unit/core/SQLiteStorage* tests/unit/search/TFIDF* tests/unit/search/BM25Search.test.ts tests/unit/search/RankedSearch.test.ts --maxWorkers=4`: seven files and 294 tests passed against Node SQLite.
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed, including declarations and all 44 exported artifact paths.
- `node scripts/node-runtime-smoke.mjs`: shipped CommonJS entrypoints load under Node 24.22.1 and SQLite executes statements.
- Dependency-graph regeneration, duplicate-symbol gate, and source census: passed.
- `repo-tools check . --docs=docs/architecture`: all 30 claims in six checked documents match.
- `repo-tools docs check src`: no mandatory documentation issues.
- `git diff --check`: passed.

Validation used Node 24.22.1 on Linux. GitHub's platform matrix is the additional check for Windows/macOS and Node 22 compatibility. No new runtime dependencies were added. The optional ANN backend and resolver require explicit caller adoption; existing exact vector retrieval is unchanged.
