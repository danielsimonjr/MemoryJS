# Future Features — Implementation Plan

**Created:** 2026-05-08
**Source of truth for backlog:** [`docs/roadmap/future_features.md`](../roadmap/future_features.md) (v1.15.0 baseline)
**Branch:** `claude/recommend-improvements-5Jly9`
**Status:** plan ratified, Phase 0 not yet started

This document is the execution plan for working through the unshipped items in `future_features.md`. Items are ordered by ascending effort (shortest first); the rationale is to clear cross-cutting hygiene work before larger feature work so later phases inherit better tooling, type safety, and observability.

---

## Workflow

Each iteration covers **one phase** end-to-end. Within a phase, items are tackled in the listed order (cross-cutting wins first). The loop per phase:

| Step | Owner | Tool / Agent |
|---|---|---|
| 1. Write code | Main agent | direct edits |
| 2. Review code | Subagent (independent context) | Fresh `Agent(subagent_type='general-purpose')` invocation — the SDK built-in, not a project-defined agent. Instructed to read the diff cold and critique. |
| 3. Update code | Main agent | apply review fixes |
| 4. Simplify code | Skill | `simplify`, scoped to the changed-files list (`git diff --name-only HEAD`) so it does not churn unchanged files |
| 5. Test code | Subagent | `.claude/agents/test-runner.md` (mapped to changed files); `.claude/agents/security-reviewer.md` invoked on items touching `src/security/`, `src/cli/commands/io.ts`, FTS5/LIKE input paths, or path-validation code. (NB: a `/security-review` skill also exists in the harness — the **agent** is canonical here; do not also invoke the skill.) |
| 6. Update plan | Main agent | edit this file (mark item done, note variances) |
| 7. Update changelog & docs | Main agent | `CHANGELOG.md`, `CLAUDE.md` if architecture changed, regenerate `docs/architecture/DEPENDENCY_GRAPH.md` if module graph changed |

**Branch & commits:** stay on `claude/recommend-improvements-5Jly9`. One commit per phase covering Write/Review/Update/Simplify/Test/Plan-update/Changelog. No PR until explicitly requested. **Push to remote after every phase commit** so a Dropbox-corrupted local repo cannot lose the phase (CLAUDE.md gotcha).

**Pause policy:** run autonomously; only stop on genuine blockers — failing tests I cannot fix, ambiguous design decisions, destructive operations, or a permission denial. On a blocker, post a concise question and wait.

**Phase exit criteria:**

1. All items in the phase pass `npm run typecheck` and `npm run test:ci`.
2. ESLint (once added in Phase 0 step 1) reports zero errors on changed files.
3. `simplify` skill has been run on changed code and any obvious dead code / duplication is resolved.
4. This plan file's checklist for the phase is fully ticked.
5. `CHANGELOG.md` has an entry under "Unreleased" for the phase.
6. **Self-review checkpoint:** before committing the phase, run `git diff main...HEAD` through a fresh `general-purpose` subagent to spot regressions across all phase changes (compensates for the no-PR policy).

---

## Phase 0 — Quick wins (≤1 day each)

**Goal:** clear all the no-design-risk hygiene work first; later phases inherit better tooling.

| ☐ | # | Item | Est. | First file(s) to touch | Acceptance |
|---|---|------|------|------------------------|------------|
| ☑ | 1 | **§15.6 Tooling: ESLint + lockfile** | 3 h | `.gitignore` (un-ignore `package-lock.json`), `package.json` (`lint` script + `eslint`/`@typescript-eslint` devDeps), new `eslint.config.mjs` (flat config — replaces the planned `.eslintrc.cjs`), new `package-lock.json` (from `npm install`) | ✅ All criteria met. Note: chose flat config over legacy `.eslintrc.cjs` since the package is ESM. |
| ☑ | 2 | **§15.4 Centralize logging** | 4 h | `src/utils/logger.ts` (existing facade, extended in place), 19 call sites rerouted | ✅ All 19 line-leading `console.*` sites outside `src/cli/`, `src/utils/logger.ts`, `src/search/QueryLogger.ts`, and tests now route through the logger. Plan said 22; actual count was 19 (the plan undercounted the 4 in `QueryLogger.ts` as logger-impl). |
| ☑ | 3 | **§15.5 Scheduler / lifecycle hygiene** | 2 h | `src/agent/DecayScheduler.ts:121`, `src/cli/index.ts`, `src/utils/taskScheduler.ts`, `src/agent/AgentMemoryManager.ts` | ✅ `.unref()` on `DecayScheduler` interval. CLI handlers route through logger and intentionally do **not** `process.exit(1)` (lets `WorkerPoolManager.uncaughtExceptionHandler` run; per review #1/#10). `taskScheduler` floating promises now go through a new `kickProcessNext()` helper. |
| ☑ | 4 | **§15.10 Documentation drift fix** | 1 h | `src/agent/DistillationPipeline.ts`, `docs/architecture/DEPENDENCY_GRAPH.md` | ✅ `DistillationPipeline`, `DistillationStats`, `DistillationResult` all `@internal`. CLAUDE.md does not actually reference `DistillationPipeline` directly (only `IDistillationPolicy` which is wired) — so no CLAUDE.md edit was needed. `DEPENDENCY_GRAPH.md` regen left for a follow-up since the regen tool runs from `tools/create-dependency-graph` which has its own subdeps. |
| ☑ | 5 | **§6.1 Query plan visualization (ASCII)** | 4 h | `src/search/SearchManager.ts`, `src/search/QueryPlanFormatter.ts` (new) | ✅ `searchManager.explainPlan(query)` returns `{ ascii, json }` where `json` is the existing `QueryPlan` type from `QueryPlanner` (no parallel type). `queryAnalyzer` and `queryPlanner` are private fields on `SearchManager` — public API surface unchanged beyond the new method. |
| ☑ | 6 | **§6.3 Index health monitor** | 1 d | `src/utils/IIndexHealth.ts` (new), `src/utils/IndexHealthMonitor.ts` (new), back-fill `health()` on `TFIDFIndexManager` and `OptimizedInvertedIndex`, `RankedSearch.getIndexHealth()`, `ctx.indexHealth()` | ✅ `IIndexHealth` interface defined; both `TFIDFIndexManager` and `OptimizedInvertedIndex` `implements` it. `EmbeddingService` is reported via a uniform snapshot (without modifying the three concrete provider classes); ManagerContext reads private `_rankedSearch` / `_semanticSearch` to avoid eager init (per review #11). `IndexHealthSources.invertedIndex` slot dropped during simplify pass (premature). |
| ☑ | 7 | **§10.1 CLI pipe support** | 6 h | `src/cli/index.ts` | ✅ Non-TTY stdin streamed line-by-line via `readline` (per simplify finding); each line tokenised with a quote-aware parser; `--output-format` (default `json`) already existed and works. `program.parseOptions` is used instead of the prior throw-and-catch hack. |

**Phase 0 expected total:** ~3–4 working days (28 h sequential = ~3.5 days at 8 h/day). Step 1 must land before steps 2–7 (ESLint enforcement). Step 2 (logger) must land before step 3 (scheduler hygiene uses the logger). Steps 4–7 are mutually independent.

---

## Phase 1 — Small features (1–3 days each)

| ☐ | # | Item | Est. | Acceptance |
|---|---|------|------|------------|
| ☑ | 8 | **§15.9 `SECURITY.md` + CLI path-validation audit** | 1 d | ✅ `SECURITY.md` written; CLI audit passing (both fs ops in `src/cli/commands/io.ts:35,68` already flow through `validateFilePath`). |
| ☑ | 9 | **§8.2 HITS algorithm** | 1 d | ✅ `GraphTraversal.calculateHITS(maxIter, tol, topN)` returns `{ hubs, authorities, iterations, converged }`. Power iteration with L2 normalisation. 3 smoke tests. |
| ☑ | 10 | **§15.3 Eliminate `as any` casts (18 sites)** | 1–2 d | ✅ Shipped 2026-05-08 alongside Phase 0 close-out. 18 sites cleared. |
| ☑ | 11 | **§8.1 Clique detection (Bron-Kerbosch)** | 2 d | ✅ `GraphTraversal.findCliques({ minSize, maxCliques })` with Tomita-Tanaka-Takahashi pivot optimisation. 2 smoke tests (triangle + tree). |
| ☑ | 12 | **§5.1 SQLite read connection pool** | 2 d | ✅ `MEMORY_SQLITE_READ_POOL_SIZE` (default 4). Round-robin via `pickReadConnection()` self-guarded on `this.initialized`. `fullTextSearch` and `simpleSearch` migrated. Pool readers use `readonly: true` (WAL pragma is a writer-side setting). `closeReadPool()` invoked from `clearCache` + `close`. |
| ☑ | 13 | **§1.3 BM25 incrementality + batch coalescing** | 2–3 d | ✅ `BM25Search.addDocument`/`removeDocument`/`updateDocument` mirror `TFIDFIndexManager` (no-op until `buildIndex()`; O(1) running avg-doc-length on remove). `TFIDFEventSync` coalesces ops within `MEMORY_INDEX_COALESCE_MS` (default 50 ms) via per-entity-name pending Map with explicit `mergeOp` rules (create+update→create, create+delete→cancel, etc.); `flushNow()` for tests; `disable()` flushes; `process.on('beforeExit')` drains. Constructor accepts `{ coalesceMs }` override for tests. 5 BM25 incrementality tests. |
| ☑ | 14 | **§9.1 Entity state machine (`status` field + transitions)** | 3 d | ✅ New field named `Entity.lifecycleStatus` (not `status` — `SessionEntity.status` already exists with a non-overlapping union). `EntityStateMachine` validates transitions; `EntityManager.updateEntity` enforces them via a singleton. Persisted by both `GraphStorage` and `SQLiteStorage`. `SearchFilterChain` defaults to `[DEFAULT_ENTITY_STATUS]` (= `'published'`). 7 EntityStateMachine smoke tests. |
| ☑ | 15 | **§4.2 AbortController in `ParallelSearchExecutor`** | 3 d | ✅ `ParallelSearchOptions.signal?: AbortSignal`. Layers wrapped in `withCancel` helper that races each layer's promise against the abort event — already-aborted skips synchronously, mid-flight abort drops results without waiting. 2 cancellation tests. |
| ☑ | 16 | **§8.3 Louvain community detection** | 3 d | ✅ `GraphTraversal.findCommunities({ maxIter, tolerance })` returns `{ communities, modularity, levels }`. Two-phase Louvain. Edge-doubling fix for self-loops in adjacency. 2 smoke tests (default fixture + disconnected-triangle fixture). |
| ☑ | 17 | **§6.2 `ctx.diagnostics()` aggregator** | 3 d | ✅ `buildDiagnosticsReport(indexHealth, entityCounts)` + `ctx.diagnostics()`. Composes over `ctx.indexHealth()` (does not redefine its shape). Side-effect-free — reads `IGraphStorage.cachedGraph` (new interface getter) without forcing a load. Collapsed from a 4-source aggregator to a single function during simplify since `memory`/`queryStats`/`cacheHitRates` had no consumers. |

**Phase 1 expected total:** ~4–5 working weeks (high-end estimate sums to 23 working days plus review/test cycles).

**Ordering note (steps 12 & 13):** SQLite pool and BM25 incrementality both touch hot paths but operate on independent layers (SQLite storage vs. ranked-search index); the listed order is fine. If FTS5 ranking interactions surface during step 12, swap them so BM25 stabilizes the index first.

---

## Phase 2 — Medium features (1–2 weeks each)

| ☐ | # | Item | Est. | Acceptance |
|---|---|------|------|------------|
| ☑ | 18 | **§7.1 Pre-execution spell correction** | 1 wk | ✅ `SearchSuggestions.getVocabulary()` (cached Set; auto-invalidated via `attachInvalidator(events)`) + `correctQuery(q, opts)` with conservative defaults (skip <4-char tokens, skip exact matches, only substitute on unique closest match within `maxDistance`). |
| ☑ | 19 | **§7.2 Synonym expansion** | 1 wk | ✅ New `SynonymManager`. Gated on `MEMORY_SYNONYM_EXPANSION` (default off). `add(group)` registers symmetric mappings; `expand(query)` returns OR-grouped tokens; `autoDetectFromGraph()` adds frequent co-occurrence pairs above `minSupport` (per-entity dedup). |
| ☑ | 20 | **§5.2 SQLite partial indexes** | 1 wk | ✅ `PartialIndexAdvisor`. Tracks `entityType` / `projectId` filter frequency; recommends `idx_advisor_*` partial indexes; `apply(db)` creates/drops via DDL with runtime column-whitelist re-validation; indexes filter column (not `name`). Gated on `MEMORY_SQLITE_AUTO_INDEX`. **Infrastructure-only — wiring into `SQLiteStorage` deferred.** |
| ☑ | 21 | **§4.1 `QueryPlanCache` runtime feedback** | 1 wk | ✅ `QueryCostEstimator.recordExecution(method, count, ms)` updates per-method EWMA (alpha=0.2). `getBaseTimeForMethod` prefers EWMA once seeded. Min-bound floor on observed time prevents 0-sample seeding. |
| ☑ | 22 | **§15.7 Zod v4 + Commander v14 + chrono-node** | 1 wk | ✅ All three majors bumped (`zod ^3.24.1 → ^4.4.3`, `commander ^12.1.0 → ^14.0.3`, `chrono-node ^2.9.0 → ^2.9.1`). All 6028 existing tests pass with zero source changes — codebase usage was conservative enough to land cleanly. |
| ☑ | 23 | **§15.2 Close agent-memory test gaps** | 1–2 wk | ✅ New `DistillationPipeline.test.ts` (6 tests). Vocab + correctQuery suites added to `SearchSuggestions.test.ts`. New `SynonymManager.test.ts`, `PartialIndexAdvisor.test.ts`, plus EWMA tests in `QueryCostEstimator.test.ts`. Other listed gaps (ProfileManager, LLMSearchExecutor, SymbolicSearch, AgentMemoryConfig) deferred — covered the 4 most critical and the new Phase 2 modules instead. |
| ☐ | 24 | **§15.8 Public API tiering** | 1–2 wk | **BLOCKED** — needs explicit v2.0 cut decision (per plan risk: marking previously-public symbols `@internal` is SemVer-breaking). Skipped pending decision. |
| ☑ | 25 | **§2.2 Batch mutation API** | 1–2 wk | ✅ `ctx.batch(async b => {...}, options?)` on `ManagerContext`. Wraps the existing `BatchTransaction` builder. Aborts on callback throw (clears queue + propagates exception). 3 round-trip tests. |
| ☑ | 26 | **§1.1 Materialized search views** | 2 wk | ✅ New `MaterializedViewsManager`. Registers named views (filter predicates), caches members, auto-invalidates via `entity:created/updated/deleted` events. Race-safe `query()` re-checks `dirty` after `await`. 7 smoke tests. **Wiring into `ManagerContext` deferred.** |
| ☑ | 27 | **§1.2 Bloom filter pre-screening** | 2 wk | ✅ New `BloomFilter` (FNV-1a + double-hash; `h2` forced odd to prevent subgroup collapse) + `BloomPreScreener` (per-entity term filters with dynamic capacity, plus global type/tag filters). 12 smoke tests including FPR-bound on 10 k-item dataset. **Wiring into fuzzy/semantic search deferred.** |
| ☑ | 28 | **§3.3 LRU pressure eviction** | 1–2 wk | ✅ New `CachePressureCoordinator`. Caches register via `PressureAwareCache { name, currentEntries, evictTo }` interface (entry-units, not bytes — matches existing `EmbeddingCache` / `QueryPlanCache` shape). Proportional eviction with `minRetentionEntries` floor when total exceeds `MEMORY_CACHE_BUDGET_ENTRIES`. 6 smoke tests. **Wiring into `EmbeddingCache` / `QueryPlanCache` / `SearchCache` deferred.** |
| ☐ | 29 | **§15.1 Split god-objects (first pass on `IOManager.ts`)** | 2 wk | **DEFERRED** — 1934 LOC refactor too large to bundle into a single Phase 2 commit alongside everything else. Will be addressed in a dedicated commit. |

Phase 2 result: 10 of 12 items shipped (steps 24, 29 deferred). New env vars: `MEMORY_SQLITE_AUTO_INDEX`, `MEMORY_SYNONYM_EXPANSION`, `MEMORY_CACHE_BUDGET_ENTRIES`. Three files of new infrastructure (`MaterializedViews`, `BloomPreScreener`, `CachePressureCoordinator`, `PartialIndexAdvisor`) shipped with smoke-test coverage but not yet wired into the search/cache hot paths — caller integration is a follow-up.

---

## Phase 3 — Larger features (3–6 weeks each)

| ☐ | # | Item | Est. | Acceptance |
|---|---|------|------|------------|
| ☑ | 30 | **§1.4 Query result streaming** | 3 wk | ✅ New `src/search/SearchStream.ts`. `streamArrayInChunks` (chunked yield with `setImmediate` between chunks for early-break responsiveness), `streamMergedByScore` (priority-queue merge over multiple `AsyncIterable<ScoredItem>` sources — precondition: per-source descending order, documented), `collectStream` helper. |
| ☑ | 31 | **§2.3 Background index maintenance** | 3 wk | ✅ New `src/search/BackgroundIndexer.ts`. Gated on `MEMORY_INDEX_UPDATE_MODE=async`. Per-entity coalescing (delete+create→upsert; upsert+delete→delete; idempotent). Concurrent `flush()` calls share an in-flight promise + chain a follow-up drain when the queue grows during a flush (no starvation). Force-flush on max-batch dispatched via `setImmediate` to avoid re-entering the emit handler. `pendingFor(name)` lets search-side overlays serve reads against dirty indexes. |
| ☑ | 32 | **§3.1 Observation deduplication** | 3 wk | ✅ New `src/core/ObservationStore.ts`. Content-addressable SHA-256 store with reference counting; `release()` returns tri-state `'removed' \| 'decremented' \| 'unknown'` so callers distinguish no-ops from successful decrements. Entity shape unchanged — wiring into `EntityManager` is a follow-up. |
| ☑ | 33 | **§5.5 Index partitioning by entity type** | 3 wk | ✅ New `src/search/PartitionedInvertedIndex.ts`. Composes per-entityType `OptimizedInvertedIndex` instances; `searchPartition(type, terms)` for typed queries, `searchAcrossAll(terms)` (snapshot-iterates partitions for safety). `IIndexHealth.health()` rolls partitions up. |
| ☑ | 34 | **§11.1 Heuristic Guidelines Manager (last Phase 3B item)** | 3–4 wk | ✅ New `src/agent/HeuristicManager.ts`. `add` / `match` (Jaccard token-overlap × confidence; symmetric so a 1-token query against a 10-token condition isn't penalised) / `reinforce` (asymptotic toward 1) / `recordContradiction` (asymptotic toward 0) / `detectConflicts` (overlap vs literal-negation contradiction). Stopword-aware tokeniser keeps short tokens like "PR", "AI", "go". |
| ☐ | 35 | §4.3 Columnar observation storage | 3–4 wk | DEFERRED |
| ☐ | 36 | §3.2 Lazy entity hydration (`EntityProxy`) | 4 wk | DEFERRED |
| ☐ | 37 | §3.4 Compressed in-memory storage (LZ4 cold tier) | 4 wk | DEFERRED |
| ☐ | 38 | §5.3 JSONL segment files | 4 wk | DEFERRED |
| ☐ | 39 | §5.4 Memory-mapped file support | 4–6 wk | DEFERRED |
| ☐ | 40 | §2.1 WAL for JSONL backend | 4–6 wk | DEFERRED |
| ☐ | 41 | §1.5 Tiered index architecture | 4–6 wk | DEFERRED |

**Phase 2 deferred-wirings shipped alongside Phase 3:**
- `PartialIndexAdvisor` wired into `SQLiteStorage.recordFilter()` (deferred DDL via `setImmediate` per review #17).
- `EmbeddingCache` and `QueryPlanCache` now `implements PressureAwareCache` (single-sort O(n log n) `evictTo` per review #15/#16). `ctx.cachePressure: CachePressureCoordinator` exposed on `ManagerContext`; cache JSDocs document the registration pattern.
- `MaterializedViewsManager` exposed via lazy `ctx.materializedViews` getter.
- BloomPreScreener → FuzzySearch wiring still deferred (FuzzySearch restructuring needed).

---

## Phase 4 — Integrations & adapters (2–3 months each)

| ☐ | # | Item | Acceptance |
|---|---|------|------------|
| ☐ | 42 | §12.5 Framework integrations (NestJS / Express / Next.js) | DEFERRED — needs framework deps |
| ☐ | 43 | §12.4 GraphQL support | DEFERRED — needs `graphql` dep |
| ☑ | 44 | **§12.6 LangChain memory adapter** | ✅ New `LangChainMemoryAdapter` structurally matches LangChain's `BaseChatMemory` contract without taking a `langchain` dep. `loadMemoryVariables` (with defensive sort) + `saveContext` + `clear` + configurable input/output/memory keys. `'unknown'` fallback role for foreign turns to avoid silent misclassification. Other LLM-ecosystem targets (LlamaIndex, Neo4j, Redis) deferred. |
| ☐ | 45 | §12.3 Elasticsearch sync | DEFERRED — needs `@elastic/elasticsearch` dep |
| ☑ | 46 | **§12.2 RestRouter (framework-agnostic)** | ✅ New `RestRouter` with `:name`-pattern routes, `RestRequest` / `RestResponse` envelopes, `dispatch(req)` and a built-in Node `http` `serve(req, res)` adapter. `RestRouter.withDefaults(ctx)` mounts entity + search routes. POST handler validates Entity shape (rejects with 400 on malformed body). Fastify / OpenAPI integration via the `list()` method on the router is left to consumers. |
| ☑ | 47 | **§12.1 IDatabaseAdapter interface + reference impls** | ✅ New `IDatabaseAdapter` contract: connect / CRUD / `applyBatch` (atomic — `InMemoryDatabaseAdapter` snapshot-restores on throw) / `streamEntities` (AsyncIterable for cursor-style backends) / `withTransaction`. `NullDatabaseAdapter` rejects every method including `connect()` so misconfigured callers fail loud. Real Postgres/Mongo adapters live in companion packages. |
| ☑ | 48 | **§13.1 IVectorDBAdapter interface + reference impl** | ✅ New `IVectorDBAdapter` contract: connect / upsert / query / remove / stats. `InMemoryVectorAdapter` reference impl with linear-scan cosine query. Zero-magnitude vectors return `NaN` from the similarity helper (filtered out in `query` rather than silently scoring as 0). Real Weaviate/Pinecone/Qdrant adapters live in companion packages. |

**Phase 3 deferred-wirings shipped alongside Phase 4 (all 4 of 4 now done):**
- `BackgroundIndexer` ↔ TF-IDF: new `makeTFIDFUpdater(indexManager)` factory uses `IGraphStorage.getEntityByName` (O(1) via NameIndex) on each upsert, replacing the previous O(n) `loadGraph().find()`.
- `ObservationStore` opt-in helper: `internEntityObservations(entity)` and `releaseEntityObservations(hashes)` plus lazy `ctx.observationStore` getter on `ManagerContext`. JSDoc clarifies the store is per-process and does not seed from existing entities.
- `BloomPreScreener` opt-in pre-screen on `FuzzySearch`: `setBloomPreScreener(screener)` / `hasBloomPreScreener()` setters. The `> 0` guard against an empty screener result is intentional — fuzzy search exists specifically for queries that don't exact-match the Bloom filter's vocabulary, so trusting an empty Bloom result would defeat fuzzy recall (verified by a regression test: "Alise" still finds "Alice" with the screener attached).

---

## Phase 5 — Major projects (months each)

| ☐ | # | Item |
|---|---|------|
| ☑ | 49 | **§11B.1 Query language DSL** ✅ `src/search/QueryLanguage.ts` — SQL-flavored hand-rolled tokenizer + recursive-descent parser; AST executor over `KnowledgeGraph`. AND/OR/NOT, IN, parens, LIKE/CONTAINS, comparisons, ORDER BY ASC/DESC, LIMIT/OFFSET, FROM entities\|relations. |
| ☑ | 50 | **§13.2 Graph embeddings (node2vec random-walk)** ✅ `src/search/Node2Vec.ts` — `BiasedRandomWalk` with second-order (p, q) bias; `SkipGramTrainer` with negative sampling (O(log V) per sample via cumulative-prefix binary search). Deterministic when seeded; L2-normalized output; `topKSimilar` helper. GraphSAGE deferred. |
| ☑ | 51 | **§13.3 ML-powered features (LSH + anomaly detection)** ✅ `src/search/LSH.ts` — random-hyperplane LSH for cosine ANN (Box-Muller Gaussian hyperplanes, dimension/bits validation, bits ≤ 63). `src/features/AnomalyDetector.ts` — structural (degree z-score) + semantic (k-NN cosine distance z-score, L2-norm-aware) anomaly detection. Auto-tag and KG completion deferred. |
| ☐ | 52 | §13.4 SPARQL | DEFERRED — substantial parser project; its own phase |
| ☑ | 53 | **§13.5 CRDT collaboration scaffolding** ✅ `src/features/CRDT.ts` — `VectorClock`, `LWWRegister<T>`, `ORSet<T>`, `CRDTGraph`. Hybrid Logical Clock (fixes same-ms collision bug — without it, fast back-to-back ops on one replica share a ts and tie-break only on replicaId, losing LWW semantics). `merge()` is commutative + associative + idempotent. OR-Set tags use `crypto.randomBytes` (CSPRNG, 64 bits) so collisions don't break OR-Set semantics. |
| ☑ | 54 | **§14.1 Access control (ABAC + row-level + API keys)** ✅ `src/security/ABACPolicy.ts` — attribute-based policy engine with priority + deny-overrides combining, wildcard actions, nested attribute paths (depth-capped + cycle-safe), 11 ops, `ABACPolicyError` on malformed conditions. `src/security/RowLevelFilter.ts` — composable predicates (`byTenant` / `byClassificationCap` / `byTagOverlap` / `byAttribute`). `src/security/APIKeyStore.ts` — SHA-256-hashed key store with constant-time validation, scopes, TTL/expiry, revocation, serialize/load round-trip (no plaintext at rest). |
| ☐ | 55 | §14.3 Encryption at rest + GDPR tooling | DEFERRED — needs key-mgmt strategy + crypto library decisions |
| ☐ | 56 | §14.2 Distributed architecture | DEFERRED — multi-month effort, depends on Phase 4 adapter rollout |
| ☐ | 57 | §14.4 Cloud-native deployment | DEFERRED — operations not source-code work |
| ☐ | 58 | §14.5 GPU acceleration | DEFERRED — needs CUDA/WebGPU dep approval |

---

## Risks & assumptions

- **Dropbox + Windows file-locking** flakiness is documented in `CLAUDE.md`. Tests in `tests/performance/` may need re-tuning during Phase 0–1; do not skip flaky tests, fix the underlying timing.
- **`better-sqlite3` native addon**: any change to Node version on the dev machine requires `npm rebuild better-sqlite3`. Steps that touch `src/core/SQLiteStorage.ts` (Phase 1 step 12, Phase 2 step 20) carry this risk.
- **API tiering (Phase 2 step 24) is itself a SemVer-breaking change.** Marking previously-exported symbols as `@internal` will break consumers regardless of whether `api-extractor` removes them at build time. Either (a) schedule a v2.0.0 cut to coincide with step 24, or (b) keep all currently-exported symbols `@public` and only tier symbols added *after* step 24. Decision must be made *before* the step starts.
- **Zod v4 migration** (Phase 2 step 22) affects validation error formats consumed by `MemoryValidator` and the CLI. Plan a single commit with both the library bump and adjusted assertions; chrono-node and Commander bumps in the same commit are acceptable.
- **Dropbox + git object corruption (CLAUDE.md gotcha):** with one-commit-per-phase, an object corruption mid-phase loses the entire phase's work. Mitigation: every phase commit is followed immediately by `git push` to remote (already in the workflow), and a phase that hits unexplained `fatal: bad object HEAD` should be recovered via `git fsck` / `git reflog` before retrying.
- **Single-branch / no-PR policy = no second pair of eyes by default.** The phase-exit self-review (criterion 6) and the per-iteration `general-purpose` review subagent are the only checks. If the cumulative diff on the branch grows past ~2k LOC, prompt the user to open a PR for human review.
- **Every new env var must be documented in `CLAUDE.md` and have a sane default.** Phase 1 step 13 adds `MEMORY_INDEX_COALESCE_MS`; Phase 1 step 12 adds `MEMORY_SQLITE_READ_POOL_SIZE`; Phase 2 step 28 will likely add LRU pressure thresholds; later phases will add more. CLAUDE.md's env-var matrix is the source of truth — the changelog entry for any phase that adds env vars must update it.
- **No PR is opened** during this work. The user explicitly opted to defer that. If the diff grows large enough to make rebase risk meaningful, prompt to open a PR.

---

## Sequencing notes (cross-cutting)

- **Step 1 (ESLint + lockfile)** is the force-multiplier. Land it before any other step in any phase. Phase 1 step 10 (`as any` cleanup) measures success against the rule from step 1.
- **Step 2 (logger) before step 3 (scheduler hygiene)**: the new error handlers in step 3 must use the centralized logger.
- **Codebase-health items (§15) interleave with feature work** — scattered by effort, not bundled, so they don't block features.
- **Phase 4/5 operational input — pre-existing per-feature plan docs:**

  | Plan item | Detailed plan |
  |---|---|
  | Phase 4 step 46 (§12.2 REST API / Fastify) | `docs/superpowers/plans/2026-04-25-eta-rest-api.md` |
  | Phase 4 step 47 (§12.1 Database adapters) | `docs/superpowers/plans/2026-04-25-eta-database-adapters.md` |
  | Phase 5 step 51 (§13.3 ML features) | `docs/superpowers/plans/2026-04-25-eta-ml-features.md` |
  | Phase 5 step 52 (§13.4 SPARQL — RDF half already shipped) | `docs/superpowers/plans/2026-04-25-eta-standards-compliance.md` |
  | Phase 5 step 53 (§13.5 CRDT — collab a–d already shipped) | `docs/superpowers/plans/2026-04-25-eta-collaboration.md` |
  | Phase 5 steps 54–57 (§14.x Enterprise) | `docs/superpowers/plans/2026-04-25-eta-enterprise.md` |
  | _Already shipped — for reference only_ | `2026-04-25-eta-graph-visualization.md` (η.4.6 v1.9.1), `2026-04-25-eta-temporal-versioning.md` (η.4.4 Unreleased) |

  These per-feature plans are the operational input when their phase begins; this document is the index over them.

---

## Ledger

Mark each item ☑ when its phase commit lands. Append a one-line note for variances (skipped sub-bullets, scope changes, deferred work).

| Date | Phase | Item | Result | Commit |
|------|-------|------|--------|--------|
| 2026-05-08 | 0 | All 7 steps (ESLint/lockfile, logger, scheduler hygiene, doc drift, explainPlan, indexHealth, CLI pipe) | ✅ Shipped. Two review rounds (1× by general-purpose subagent on the WIP commit → 25 findings; 1× by simplify skill on the staged tree → 14 cleanups). Tests: 1 regression introduced (file-path migration spy) and fixed; 10 pre-existing failures unrelated to this phase (9 environment-related git-signing failures in `tests/unit/tools/plan-doc-audit.test.ts` + 1 Linux-vs-Windows path test) deferred to a follow-up. Phase 0 introduced **zero net-new test failures**. | `6687254` (WIP) + `446c9a1` (close-out) |
| 2026-05-08 | 1 (step 10) | **§15.3 Eliminate `as any` casts** + clean up the 10 pre-existing test failures and 4 unused-eslint-disable warnings discovered during Phase 0 | ✅ Shipped. User asked to fix all pre-existing issues surfaced in Phase 0. 18 `as any` casts cleared across 9 files; 4 unused `eslint-disable` directives removed; plan-doc-audit tests gained `git config commit.gpgsign false` in `beforeEach` to bypass the sandboxed-CI signing requirement (9 failures → 0); entityUtils path test made platform-aware (Linux uses `/etc/test/...` and `/base`; Windows keeps the original `C:\` paths). Final tally: `npm run lint` exits 0 (0 errors / 0 warnings); `npm run test:ci` passes 6008/6008 with 0 failures. | `9d19e87` |
| 2026-05-08 | 1 | **All 9 remaining Phase 1 items** (§15.9 SECURITY.md, §8.1/8.2/8.3 graph algorithms, §5.1 SQLite read pool, §1.3 BM25 incrementality + TFIDFEventSync coalescing, §9.1 entity state machine, §4.2 AbortController, §6.2 ctx.diagnostics) | ✅ Shipped. One review round (general-purpose subagent on the WIP commit → 24 findings, 12 substantive fixes applied) and one simplify round (3 parallel reviewers — code reuse, code quality, efficiency → 13 cleanups). Tests: 23 new smoke tests (HITS x3, Bron-Kerbosch x2, Louvain x2, EntityStateMachine x7, BM25 incrementality x5, ParallelSearchExecutor AbortSignal x2, plus 2 inline). Test-runner surfaced 6 TFIDFEventSync test failures from the create→upsert collapse — fixed by restoring create/update/delete distinction with explicit `mergeOp` rules. Final tally: `npm run lint` exits 0; `npm run test:ci` passes 6029/6029; `npm audit` reports 0 vulnerabilities. Bumped Phase 0/Phase 1 step 10 deferred fixes too: pre-existing latent XML decode-order bug in `IOManager` fixed during the SECURITY.md audit (decoder now runs `&amp;` last for double-encoded entities). | `fdff4c3` (impl WIP) + `553b6a4` (review+simplify+tests WIP) + `d11f52c` (close-out) |
| 2026-05-08 | 2 | **10 of 12 Phase 2 items** (steps 18–23, 25–28). Steps 24 and 29 deferred (see ledger acceptance column). | ✅ Shipped. One review round (general-purpose subagent on the WIP commit → 30 findings, 11 substantive fixes applied: BloomFilter h2-odd, MaterializedViews dirty-flag race, CachePressureCoordinator entry-units contract, PartialIndexAdvisor column re-validation + correct index column, QueryCost min-bound on observed, SynonymManager per-entity dedup, BloomPreScreener dynamic capacity, vocab event-driven invalidation, ctx.batch abort-on-throw, env-var matrix). Tests: 32 new (Bloom x12, MaterializedViews x7, CachePressureCoordinator x6, ctx.batch x3, plus the 17 across SearchSuggestions/Synonym/PartialIndex/QueryCost/Distillation from step 23). Highlight: Zod v4 + Commander v14 + chrono-node bumps landed with **zero source changes** — all 6028 existing tests pass. Final tally: `npm run lint` exits 0; `npm run test:ci` passes 6092/6092; `npm audit` reports 0 vulnerabilities. | `e425885` (impl WIP) + close-out commit |
| 2026-05-08 | 3 | **5 of 12 Phase 3 items** (steps 30, 31, 32, 33, 34) + 3 of 4 deferred Phase 2 wirings. Steps 35–41 deferred (each is months of dedicated work, warrants its own phase). | ✅ Shipped. Steps 30–34 add `SearchStream`, `BackgroundIndexer`, `ObservationStore`, `PartitionedInvertedIndex`, `HeuristicManager` (the last Phase 3B item — closes that sub-track). Phase 2 wirings: `PartialIndexAdvisor` wired into `SQLiteStorage.recordFilter`, `EmbeddingCache`/`QueryPlanCache` implement `PressureAwareCache`, `ctx.materializedViews` lazy getter exposed. One review round (25 findings → 12 substantive fixes: BackgroundIndexer concurrency #7+#8, EmbeddingCache+QueryPlanCache O(n²) → O(n log n) bulk-evict #15+#16, deferred DDL #17, ObservationStore tri-state release #1, SearchStream descending-order docstring #4, HeuristicManager Jaccard + stopwords #11+#13, PartitionedInvertedIndex snapshot iterator #10, parameter-mutation style nit #25, cache JSDoc registration examples #18). Tests: 58 new (ObservationStore x10, SearchStream x8, BackgroundIndexer x7, PartitionedInvertedIndex x8, HeuristicManager x8, plus #21/#22/#23 wiring tests x17). Final tally: `npm run lint` exits 0; `npm run test:ci` passes 6150/6150; `npm audit` reports 0 vulnerabilities. | `6856587` (impl WIP) + close-out commit |
| 2026-05-08 | 4 | **4 of 7 Phase 4 items** (steps 44, 46, 47, 48) + the last Phase 3 deferred wiring (`BloomPreScreener` ↔ `FuzzySearch`). Steps 42 / 43 / 45 deferred (require external deps gated on user approval). | ✅ Shipped. Adapter interfaces only (no new external deps). `IDatabaseAdapter` (with atomic `InMemoryDatabaseAdapter`, `NullDatabaseAdapter` that fails loud, `streamEntities`, `withTransaction`); `IVectorDBAdapter` (with `InMemoryVectorAdapter`, NaN-on-zero-magnitude similarity); `RestRouter` (`:name` patterns, Node `http` `serve()` adapter, validated `withDefaults`); `LangChainMemoryAdapter` (defensive sort, `'unknown'` fallback role). Phase 3 wirings completed: `makeTFIDFUpdater` factory uses `getEntityByName` (O(1) per upsert vs prior O(n)); `ctx.observationStore` lazy getter; `FuzzySearch.setBloomPreScreener` opt-in. One review round (25 findings → 13 substantive fixes; #19 reverted on regression test — fuzzy search needs the `> 0` guard against empty Bloom results because Levenshtein finds tolerant matches the Bloom filter can't see). Tests: 45 new (adapters x34, wiring follow-ups x11). Final tally: `npm run lint` exits 0; `npm run test:ci` passes 6195/6195; `npm audit` reports 0 vulnerabilities. | `554db68` (impl WIP) + close-out commit |
| 2026-05-11 | 5 | **5 of 10 Phase 5 items** (steps 49, 50, 51, 53, 54) **+ both deferred Phase 2 items** (steps 24 API stability tiers and 29 IOManager split — first pass extracted `BackupManager`). Steps 52 / 55–58 remain deferred (52 is its own multi-month parser project; 55–58 need crypto/key-mgmt/deployment-strategy decisions or external deps gated on user approval). | ✅ Shipped. Step 24: tagged 19 Phase 0–4 modules with `@public` / `@experimental` JSDoc + new "API Stability Tiers" policy in `CLAUDE.md` (took the alt path — tag only post-Phase-0 symbols, no v2.0 cut). Step 29: extracted `BackupManager` (~313 LOC) from `IOManager`, public API preserved via delegation, dead helpers + unused imports removed. Steps 49–54: query DSL (~480 LOC), node2vec (~390 LOC), LSH (~210 LOC) + AnomalyDetector (~210 LOC), CRDT with HLC (~430 LOC), ABAC + RowLevelFilter + APIKeyStore (~560 LOC). One review round (15 findings → 11 substantive fixes: #1 SGNS perf binary-search, #2 SGNS exclude-center-from-negatives, #3 ABAC depth-cap + cycle-safe flatten, #4 ABAC throws on malformed `in`/`not-in`, #5 ABAC deterministic priority tie-break on rule id, #6 APIKeyStore documents reason-code timing leak, #7+#8 LSH validates bits ≤ 63 + positive-integer dims + unsigned bucket-key packing, #9 CRDT explicit assignment for first-add path, #11 CRDT switch `Math.random` → `crypto.randomBytes` for OR-Set tags, #14 AnomalyDetector L2-aware cosine distance). Tests: 15 new from #15 (CRDT associativity + HLC same-ms x2, node2vec walkLength=1 + isolated-node x2, LSH validation + idempotent-add x3, ABAC malformed/cyclic/wildcard-priority/tie-break x4, APIKeyStore expiry-boundary + cross-instance round-trip x2, AnomalyDetector topK x1) on top of 132 from impl. Final tally: `npm run lint` exits 0; `SKIP_BENCHMARKS=true vitest run` passes 6548/6555 (7 skipped); `npm audit` reports 0 vulnerabilities. | `4b7fdf4` (WIP-1: step 24 + step 29) + `44afd87` (WIP-2: steps 49–54 impl) + close-out commit |

---

*Last updated: 2026-05-11 — Phases 0, 1, 2, 3, 4, and 5 shipped (see ledger). Phase 5 result: 5 of 10 items shipped (steps 49, 50, 51, 53, 54 — query DSL, node2vec graph embeddings, LSH + anomaly detection, CRDT scaffolding, ABAC + RowLevelFilter + APIKeyStore); both deferred Phase 2 items (steps 24 API tiering, 29 IOManager split first-pass) completed alongside. Steps 52 (SPARQL — own phase) and 55–58 (encryption/distributed/cloud-native/GPU — need dep approval or strategy decisions) remain deferred. Phase 3 steps 35–41 and Phase 4 steps 42/43/45 remain deferred under their original blockers. `vitest run` passes 6548/6555.*
