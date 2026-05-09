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
| 2. Review code | Subagent (independent context) | `general-purpose` Agent — instructed to read the diff cold and critique |
| 3. Update code | Main agent | apply review fixes |
| 4. Simplify code | Skill | `simplify` |
| 5. Test code | Subagent | `.claude/agents/test-runner.md` (mapped to changed files); `.claude/agents/security-reviewer.md` invoked on items touching `src/security/`, `src/cli/commands/io.ts`, FTS5/LIKE input paths, or path-validation code |
| 6. Update plan | Main agent | edit this file (mark item done, note variances) |
| 7. Update changelog & docs | Main agent | `CHANGELOG.md`, `CLAUDE.md` if architecture changed, regenerate `docs/architecture/DEPENDENCY_GRAPH.md` if module graph changed |

**Branch & commits:** stay on `claude/recommend-improvements-5Jly9`. One commit per phase (squash the Write/Review/Update/Simplify diff; Test, Plan-update, and Changelog can ride in the same commit). No PR until explicitly requested.

**Pause policy:** run autonomously; only stop on genuine blockers — failing tests I cannot fix, ambiguous design decisions, destructive operations, or a permission denial. On a blocker, post a concise question and wait.

**Phase exit criteria:**

1. All items in the phase pass `npm run typecheck` and `npm run test:ci`.
2. ESLint (once added in Phase 0 step 1) reports zero errors on changed files.
3. `simplify` skill has been run on changed code and any obvious dead code / duplication is resolved.
4. This plan file's checklist for the phase is fully ticked.
5. `CHANGELOG.md` has an entry under "Unreleased" for the phase.

---

## Phase 0 — Quick wins (≤1 day each)

**Goal:** clear all the no-design-risk hygiene work first; later phases inherit better tooling.

| ☐ | # | Item | Est. | First file(s) to touch | Acceptance |
|---|---|------|------|------------------------|------------|
| ☐ | 1 | **§15.6 Tooling: commit `package-lock.json`, add ESLint** | 3 h | `.gitignore`, `package.json`, new `.eslintrc.cjs`, new `package-lock.json` | `npm run lint` script exists; `no-explicit-any`, `no-console` (allow `src/cli/`), `no-floating-promises` rules active; `package-lock.json` committed |
| ☐ | 2 | **§15.5 Scheduler / lifecycle hygiene** | 2 h | `src/agent/DecayScheduler.ts:121`, `src/cli/index.ts` | `.unref()` on `DecayScheduler` interval; every scheduler tick has try/catch; CLI registers `unhandledRejection` + `uncaughtException` handlers |
| ☐ | 3 | **§15.4 Centralize logging** | 4 h | `src/utils/Logger.ts` (new), 26 grep-located sites | A `Logger` facade exports `debug/info/warn/error`; all 26 raw `console.*` outside `src/cli/` and tests routed through it; ESLint `no-console` enforces this |
| ☐ | 4 | **§15.10 Documentation drift fix** | 1 h | `CLAUDE.md`, `docs/architecture/DEPENDENCY_GRAPH.md`, `src/core/ManagerContext.ts` (DistillationPipeline decision) | Either `ctx.distillationPipeline` getter exists OR `DistillationPipeline` is marked `@internal` and removed from CLAUDE.md; `DEPENDENCY_GRAPH.md` regenerated via `DEPS` skill |
| ☐ | 5 | **§6.1 Query plan visualization (ASCII)** | 4 h | `src/search/SearchManager.ts`, `src/search/QueryPlanFormatter.ts` (new) | `searchManager.explainPlan(query)` returns `{ ascii: string, json: object }`; existing `QueryPlan` shape is the only input |
| ☐ | 6 | **§6.3 Index health monitor** | 4 h | `src/utils/IndexHealthMonitor.ts` (new), `src/core/ManagerContext.ts` | `ctx.indexHealth()` returns `{ tfidf, inverted, embedding }` summaries pulled from existing managers; no schema changes |
| ☐ | 7 | **§10.1 CLI pipe support** | 6 h | `src/cli/index.ts`, `src/cli/commands/*.ts` (output-format flag) | Non-TTY stdin reads commands; `--format json\|csv\|table` flag works; default to `json` when piped; closes the last 5% of Phase 1 of the original ROADMAP |

**Phase 0 expected total:** ~3 working days. Steps 1–3 are force-multipliers; step 1 must land before steps 2–7 to get ESLint coverage on later changes.

---

## Phase 1 — Small features (1–3 days each)

| ☐ | # | Item | Est. |
|---|---|------|------|
| ☐ | 8 | **§15.9 `SECURITY.md` + CLI path-validation audit** | 1 d |
| ☐ | 9 | **§8.2 HITS algorithm** | 1 d |
| ☐ | 10 | **§15.3 Eliminate `as any` casts (19 sites)** | 1–2 d |
| ☐ | 11 | **§8.1 Clique detection (Bron-Kerbosch)** | 2 d |
| ☐ | 12 | **§5.1 SQLite read connection pool** | 2 d |
| ☐ | 13 | **§1.3 BM25 incrementality + batch coalescing** | 2–3 d |
| ☐ | 14 | **§9.1 Entity state machine (`status` field + transitions)** | 3 d |
| ☐ | 15 | **§4.2 AbortController in `ParallelSearchExecutor`** | 3 d |
| ☐ | 16 | **§8.3 Louvain community detection** | 3 d |
| ☐ | 17 | **§6.2 `ctx.diagnostics()` aggregator** | 3 d |

Phase 1 expected total: ~3 weeks.

---

## Phase 2 — Medium features (1–2 weeks each)

| ☐ | # | Item | Est. |
|---|---|------|------|
| ☐ | 18 | **§7.1 Pre-execution spell correction** | 1 wk |
| ☐ | 19 | **§7.2 Synonym expansion** | 1 wk |
| ☐ | 20 | **§5.2 SQLite partial indexes (auto from `QueryLogger`)** | 1 wk |
| ☐ | 21 | **§4.1 `QueryPlanCache` runtime feedback to `QueryCostEstimator`** | 1 wk |
| ☐ | 22 | **§15.7 Zod v4 + Commander v14 migration** | 1 wk |
| ☐ | 23 | **§15.2 Close agent-memory test gaps** (DistillationPipeline, ProfileManager, AgentMemoryConfig, LLMSearchExecutor, SymbolicSearch) | 1–2 wk |
| ☐ | 24 | **§15.8 Public API tiering (`api-extractor` + `@public/@internal/@experimental`)** | 1–2 wk |
| ☐ | 25 | **§2.2 Batch mutation API (`ctx.batch(async b => …)`)** | 1–2 wk |
| ☐ | 26 | **§1.1 Materialized search views** | 2 wk |
| ☐ | 27 | **§1.2 Bloom filter pre-screening** | 2 wk |
| ☐ | 28 | **§3.3 LRU pressure eviction (wire `MemoryMonitor` to caches)** | 1–2 wk |
| ☐ | 29 | **§15.1 Split god-objects — first pass on `IOManager.ts`** | 2 wk |

Phase 2 expected total: ~3 months.

---

## Phase 3 — Larger features (3–6 weeks each)

| ☐ | # | Item | Est. |
|---|---|------|------|
| ☐ | 30 | §1.4 Query result streaming (`AsyncIterable<ScoredEntity>`) | 3 wk |
| ☐ | 31 | §2.3 Background index maintenance | 3 wk |
| ☐ | 32 | §3.1 Observation deduplication (content-addressable) | 3 wk |
| ☐ | 33 | §5.5 Index partitioning by entity type | 3 wk |
| ☐ | 34 | §11.1 Heuristic Guidelines Manager (last Phase 3B item) | 3–4 wk |
| ☐ | 35 | §4.3 Columnar observation storage | 3–4 wk |
| ☐ | 36 | §3.2 Lazy entity hydration (`EntityProxy`) | 4 wk |
| ☐ | 37 | §3.4 Compressed in-memory storage (LZ4 cold tier) | 4 wk |
| ☐ | 38 | §5.3 JSONL segment files | 4 wk |
| ☐ | 39 | §5.4 Memory-mapped file support | 4–6 wk |
| ☐ | 40 | §2.1 WAL for JSONL backend | 4–6 wk |
| ☐ | 41 | §1.5 Tiered index architecture | 4–6 wk |

---

## Phase 4 — Integrations & adapters (2–3 months each)

| ☐ | # | Item |
|---|---|------|
| ☐ | 42 | §12.5 Framework integrations (NestJS / Express / Next.js) |
| ☐ | 43 | §12.4 GraphQL support |
| ☐ | 44 | §12.6 LLM ecosystem adapters (LangChain, LlamaIndex, Neo4j bridge, Redis) |
| ☐ | 45 | §12.3 Elasticsearch sync |
| ☐ | 46 | §12.2 REST API generation (Fastify + OpenAPI) |
| ☐ | 47 | §12.1 Database adapters (Postgres, Mongo) |
| ☐ | 48 | §13.1 Vector DB integration (Weaviate / Pinecone) |

---

## Phase 5 — Major projects (months each)

| ☐ | # | Item |
|---|---|------|
| ☐ | 49 | §11B.1 Query language DSL |
| ☐ | 50 | §13.2 Graph embeddings (node2vec, GraphSAGE) |
| ☐ | 51 | §13.3 ML-powered features (auto-tag, anomaly, LSH, KG completion) |
| ☐ | 52 | §13.4 SPARQL |
| ☐ | 53 | §13.5 CRDT collaboration |
| ☐ | 54 | §14.1 Access control (ABAC, row-level, API keys) |
| ☐ | 55 | §14.3 Encryption at rest + GDPR tooling |
| ☐ | 56 | §14.2 Distributed architecture |
| ☐ | 57 | §14.4 Cloud-native deployment |
| ☐ | 58 | §14.5 GPU acceleration |

---

## Risks & assumptions

- **Dropbox + Windows file-locking** flakiness is documented in `CLAUDE.md`. Tests in `tests/performance/` may need re-tuning during Phase 0–1; do not skip flaky tests, fix the underlying timing.
- **`better-sqlite3` native addon**: any change to Node version on the dev machine requires `npm rebuild better-sqlite3`. Steps that touch `src/core/SQLiteStorage.ts` (Phase 1 step 12, Phase 2 step 20) carry this risk.
- **Public API surface (Phase 2 step 24)** may surface accidental breaking changes. Tier annotations should land *before* any v2.0.0 cut.
- **Zod v4 migration** (Phase 2 step 22) affects validation error formats consumed by `MemoryValidator` and CLI. Plan a single PR with both library bump and adjusted assertions.
- **No PR is opened** during this work. The user explicitly opted to defer that. If the diff grows large enough to make rebase risk meaningful, prompt to open a PR.

---

## Sequencing notes (cross-cutting)

- **Steps 1–3** are force-multipliers. Land them in order before any other Phase 0 step. ESLint must exist before the `as any` cleanup in Phase 1.
- **Codebase-health items (§15) interleave with feature work** — they are scattered across phases by effort, not bundled, so they don't block features.
- **`docs/superpowers/plans/` carries detailed per-feature plan documents** for items already drafted (e.g. `2026-04-25-eta-database-adapters.md`). When Phase 4 begins, those plans are the operational input — this document is just the index.

---

## Ledger

Mark each item ☑ when its phase commit lands. Append a one-line note for variances (skipped sub-bullets, scope changes, deferred work).

| Date | Phase | Item | Result | Commit |
|------|-------|------|--------|--------|
| _to be appended_ |

---

*Last updated: 2026-05-08 — initial plan ratification.*
