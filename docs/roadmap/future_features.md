# Future Features

**Last refreshed**: 2026-05-13 (v1.15.0)

Forward-looking work tracker. **Shipped features are not listed here** — see [CHANGELOG.md](../../CHANGELOG.md) for the per-version history of completed work. This document tracks the genuinely outstanding items, mirrored from [`ROADMAP.md`](./ROADMAP.md) with deeper proposal-level detail per item.

> **Why this list is much shorter than the prior version**: PR #34 shipped Phases 0–11 of the performance & scale track in v1.15.0, absorbing all of §1 (Search Latency), §2 (Write Throughput), §4 (Query Execution), §5 (Storage Backends), and most of §6 (Observability), §7–§8 (Search Intelligence + Graph Analytics), §9–§10 (Entity Lifecycle + CLI), and large portions of §13 (Advanced Features) and §14 (Enterprise). The η-series (η.4.4 / η.5.4 / η.5.5.a–d / η.6.1 / η.6.3) and 3B.1–3B.7 also shipped in the v1.14.0 → v1.15.0 line. What remains below is the genuinely outstanding work.

---

## 3. Memory Footprint Optimizations

### 3.1 Entity-Level Observation Deduplication — P1

Store identical observation strings once and reference by hash. *Distinct from the turn-level dedup in `MemoryEngine` (Tier 1–4 chain) — this is for cross-entity duplicate observations like "Created on 2025-01-15" that appear on many entities.*

**Problem**: Many entities share similar or identical observations. Each copy consumes memory.

**Proposal**:
- Content-addressable observation store: `Map<hash, string>`
- Entities store `observationHashes: string[]` instead of `observations: string[]` (transparent to existing callers via getter)
- Dedup runs incrementally on entity create/update
- Could reuse `MemoryEngine`'s existing four-tier dedup machinery applied at observation granularity

**Expected impact**: 20–40% memory reduction for graphs with repetitive observations.

---

## 7. Search Intelligence

### 7.1 Context-Aware Spell Correction — P2

Correct typos using the graph's own vocabulary as a dictionary.

**Problem**: `FuzzySearch` finds close matches but doesn't proactively correct query terms before execution.

**Proposal**:
- Build a vocabulary index from all entity names, types, and observation terms (reuse existing `NGramIndex`)
- Before search execution, check each query term against vocabulary
- If no exact match and Levenshtein distance ≤ 2, suggest or auto-correct
- Use entity importance as a tiebreaker (prefer correcting to high-importance terms)
- Hook into `QueryAnalyzer` for parse-time suggestions

---

## 11. Memory Intelligence

### 11.1 Heuristic Guidelines Manager (3B.8) — P1

Crystallize implicit patterns into explicit natural-language strategies. Final 3B item — closes the "From Storage to Experience" memory-evolution series.

**Status**: `src/agent/HeuristicManager.ts` exists as a scaffold but is not wired into `ConsolidationPipeline`.

**Proposal**:
- Wire `HeuristicManager` into the consolidation pipeline as a late-stage stage
- Natural-language condition matching via semantic similarity over the embedding index
- Conflict detection between heuristics (contradictory actions, overlapping conditions)
- Heuristic induction from trajectory analysis (consume `TrajectoryCompressor` output)
- Prioritised application when multiple heuristics match
- Reinforcement / decay tied to procedural-memory success metrics

### 11.2 Prospective memory (new memory type) — P1

Memory for intentions to perform actions at specific future times or in specific future contexts. Extends the canonical `MemoryType` union to `'working' | 'episodic' | 'semantic' | 'procedural' | 'prospective'`.

**Cognitive-science basis**: Einstein & McDaniel 1990 — distinguishes **time-based** (T+5h) from **event-based** (when I see X) prospective memory.

**Status**: not started. Full design + integration + test surface lives in [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md); summary below.

**Proposal**:
- New `ProspectiveEntity` extending `AgentEntity` with `trigger` (time / time-window / event / conditional) + `action` (inject-context / invoke / tag-related) + lifecycle (`status`, `firedAt`, `fireCount`, `maxFireCount`)
- New `ProspectiveMemoryManager` in `src/agent/` with `scheduleAt`, `scheduleOnEvent`, `scheduleConditional`, `getPending`, `tick`, `onObservation`, `cancel`, `expireOverdue`, `start` / `stop`
- Integrates with `TaskQueue` (recurring tick at `MEMORY_PROSPECTIVE_POLL_INTERVAL_MS`), `DecayEngine` (expiry after `MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS`), `SalienceEngine` (imminent-fire boost), `ConsolidationPipeline` (new `ProspectivePromotion` stage: fired→episodic), `ContextWindowManager.wakeUp` (new L1.5 layer for pending intentions), `MemoryEngine` (dedup on `content`), `VisibilityResolver`, `AuditLog` (fire + cancel events)
- Five new env vars: `MEMORY_PROSPECTIVE_ENABLED` (default `false`), `MEMORY_PROSPECTIVE_POLL_INTERVAL_MS` (default `60000`), `MEMORY_PROSPECTIVE_MAX_PENDING_PER_SESSION` (default `100`), `MEMORY_PROSPECTIVE_DEFAULT_EXPIRY_HOURS` (default `168`), `MEMORY_PROSPECTIVE_INJECT_INTO_WAKEUP` (default `true`)
- CLI surface in same release: `memory prospective schedule "..." --at "..."`, `memory prospective list`, `memory prospective cancel <name>`
- MCP surface (`schedule_reminder`, `list_pending_reminders`, `cancel_reminder`) ships in a follow-up minor release of `@danielsimonjr/memory-mcp`

**Design decisions** (locked in [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md) §6):
- D1: `action: 'invoke'` fires procedures via **dependency injection** (callback in constructor), not direct `ProcedureManager` import
- D2: `cancelOnEvent` uses **OR semantics** (first match) — mirrors trigger semantics, AND-style cancellation can be composed
- D3: Default visibility is `private` — matches every other memory type
- D4: CLI ships with library release; MCP follows in `@danielsimonjr/memory-mcp` next minor

**Effort**: ~10 days (1–2 weeks). Effort breakdown in [`MEMORY_TYPES_EXPANSION.md`](./MEMORY_TYPES_EXPANSION.md) §4.7.

**Differentiator**: no competitor library (MemPalace, Supermemory, mem0, LangChain, LlamaIndex, Letta) has prospective memory as a typed tier — they all quietly assume memory is past-tense.

---

## 11B. Query Language

### 11B.1 Domain-Specific Query Language (DSL) — P2

A purpose-built query language for knowledge-graph operations.

**Status**: `QueryParser` + `QueryDslError` + `QueryAnalyzer` shipped; full DSL frontend pending.

**Proposal**:
- SQL-like syntax for familiarity: `SELECT entities WHERE type = 'person' AND tag = 'active'`
- Graph-specific operators: path queries, neighbourhood traversal, pattern matching (Cypher-inspired)
- Sit on top of the shipped `QueryPlanner` + `QueryCostEstimator` so it benefits from cost-based optimisation
- Optional visual query builder (browser-based; integrates with the shipped `IOManager.visualizeGraph`)

---

## 12. Integration & Ecosystem

### 12.1 Concrete Database Adapters — P2/P3

`IDatabaseAdapter` interface + `NullDatabaseAdapter` + `InMemoryDatabaseAdapter` shipped. Concrete drivers remain.

- **PostgreSQL** adapter with `pg_trgm` for text search (P2 — overlaps with MEM-05 multi-user backend)
- **MongoDB** adapter for document-oriented storage (P3)
- Connection-pooling pattern available from `SQLiteStorage` read-pool implementation; extend when concrete drivers land

### 12.2 REST API Generation polish — P2

`RestRouter` scaffold shipped under `src/adapters/`. Remaining: framework binding, OpenAPI generation, rate-limiting + pagination.

- **Fastify plugin** wrapping `RestRouter` for one-line `app.register(memoryjs)` integration
- **OpenAPI / Swagger** generation from `RestRouter` route metadata
- **Rate limiting + cursor-based pagination** middleware
- **Error-response normalisation** mapping internal errors to RFC 7807 problem-detail JSON

### 12.3 Elasticsearch Integration — P4 (gated)

- Sync entities to Elasticsearch index for offloaded full-text search
- Hybrid local + Elasticsearch queries
- Automatic index mapping from entity types

**Gated**: SQLite FTS5 + BM25 covers the common case. Adds value only when cross-process search at very large scale is required. User pull required to justify the dep.

### 12.4 GraphQL Support — P4

- Auto-generated GraphQL schema from entity types
- Query and mutation resolvers
- Subscription support for real-time graph-change notifications

**Gated**: Build on top of REST layer once `RestRouter` polish (§12.2) ships.

### 12.5 Framework Integrations — P3

- `LangChainMemoryAdapter` scaffolded in `src/adapters/`; remaining: production-grade wiring + tests
- **LlamaIndex** data connector
- **Haystack** integration
- **Semantic Kernel** adapter

### 12.6 LLM Ecosystem Integrations — P3

- LangChain memory backend adapter (use MemoryJS as a LangChain memory store)
- Llama Index data connector
- Neo4j bridge for graph-database interop
- Redis adapter for distributed caching layer

---

## 13. Advanced Features

### 13.1 Concrete External Vector-DB Drivers (MEM-06) — P2

In-process vector stores shipped: `InMemoryVectorStore`, `SQLiteVectorStore`, `QuantizedVectorStore`. External drivers pending.

- **pgvector** adapter (Postgres extension)
- **Pinecone** adapter (managed vector DB)
- **Weaviate** adapter (open-source vector DB)
- Multi-vector embeddings per entity type
- Automatic embedding synchronisation with graph mutations

Each driver is its own integration project — auth, rate limiting, error mapping, schema-mapping.

---

## 14. Enterprise

### 14.2 Multi-Node Distributed Architecture — P4 (gated)

In-process building blocks all ready: `WriteAheadLog`, `EntityProxy`, `CRDTGraph`, `FileSegmentStorage`, `FnvSegmentRouter`. Cross-host coordination layer pending.

- **Cross-host sharding coordinator** that consumes `FnvSegmentRouter` decisions
- **Read replicas** for query scaling (cross-host extension of the SQLite read pool)
- **Replication transport** (gRPC or NATS) for WAL streaming between nodes
- **Cluster membership + failover** (Raft or similar)

**Gated**: Design doc + clustering-model decision required. Roughly a quarter of work.

### 14.3 Encryption & GDPR Tooling — P3

`PiiRedactor` + DEFAULT_PII_PATTERNS + `AuditLog` + `CollaborationAuditEnforcer` + `GovernanceManager` all shipped. Remaining items:

- **GDPR right-to-deletion** workflow: confirmed erasure across primary store + backups + audit trail (with cryptographic erasure-receipt)
- **GDPR right-to-export** workflow: per-tenant data dump as standard format (JSON-LD / CSV)
- **Encryption at rest** — SQLCipher adapter or OS-FS encryption pointer (gated; current recommendation is to delegate to filesystem encryption)
- **Encryption in transit** — N/A for library (consumer concern; document the recommendation)

### 14.4 Cloud-Native Deployment Artefacts — P4 (gated)

Deployment-artefact deliverables that may live in a sibling repo (`memoryjs-deploy`) once API stability is declared.

- Docker images and Kubernetes Helm charts
- Serverless adapters (AWS Lambda, Cloud Functions, Cloudflare Workers)
- Cloud storage backends (S3, GCS, Azure Blob)
- Reference deployments for common topologies (single-pod, replicated, multi-region)

### 14.5 GPU Acceleration — P5 (deferred)

- CUDA-accelerated similarity search
- Batch embedding generation on GPU
- Parallel graph-algorithm execution on GPU

**Deferred**: `src/search/Node2Vec.ts` source comments explicitly defer GPU. The CPU-only Levenshtein worker pool + `better-sqlite3` native + Brotli compression handles graphs up to ~10 M entities. Revisit when there is a concrete >10 M-entity user.

---

## 15. Long-Horizon / Speculative

### 15.1 Real-time collaboration transport — out of scope

CRDT primitives (`VectorClock` / `LWWRegister` / `ORSet` / `CRDTGraph`) + collaboration synthesis + conflict resolution all shipped. WebSocket / SignalR transport layer to make multi-user editing live is **out of scope** for the core library — build on top via MCP server or sibling package.

### 15.2 GraphSAGE for inductive learning — out of scope

node2vec shipped (`BiasedRandomWalk` + `SkipGramTrainer`). GraphSAGE adds a TensorFlow/PyTorch dependency for a marginal capability gain over node2vec. **Out of scope** unless a concrete user need emerges.

### 15.3 Knowledge graph completion (predict missing relations) — speculative

Pattern detection + anomaly detection shipped. Predictive relation-completion not started. **Speculative** — needs concrete user motivation before this becomes P-anything.

### 15.4 Clawvault — out of scope

Separate concept from `CLAWVAULT_IDEAS.md` / `CLAWVAULT_IMPLEMENTATION_PLAN.md`. Per `GAP_ANALYSIS_VS_SUPERMEMORY.md`: "Out of scope for core library; better suited as separate packages or MCP tools." **Spin out** as `memoryjs-clawvault` sibling repo when there's pull.

---

## Codebase Health (§15 remaining)

Items in the codebase-health track that are still partially open:

### 15.2 Agent-memory test gaps — P2

7,098 tests pass and 273 test files cover the codebase. Known gaps:

- Visibility time-window edge cases (`AgentEntity.visibleFrom` / `visibleUntil` boundary tests)
- `ConsolidationScheduler` race-condition tests under high write rates
- `CollaborativeSynthesis.resolveConflicts` policy-coverage tests

### 15.7 Dependency currency — P3

- Periodic `npm outdated` sweep
- Pin major versions; allow minor + patch float
- Auto-PR via Dependabot once API stability declared

### 15.8 Public API tiering completion — P3

- API-stability tags (`@stable` / `@beta` / `@internal`) added during Phase 5
- Coverage is incomplete — need a mechanical sweep of every public export
- Stable-tagged exports become the SemVer contract surface

### 15.10 Documentation drift — P2 (continuous)

- README.md + `docs/architecture/*` refreshed 2026-05-13 alongside this roadmap
- `tools/create-dependency-graph` should be re-run on every release (consider adding to CI)
- `npm run audit:plans` (PostToolUse hook) catches plan-doc rot going forward

---

## Priority Summary

| Priority | Items |
|----------|-------|
| **P1** | 3.1 Entity-level dedup, 11.1 Heuristic Manager wiring, 11.2 Prospective memory (new type) |
| **P2** | 7.1 Spell correction, 11B.1 Query DSL frontend, 12.1 PostgreSQL driver, 12.2 REST API polish, 13.1 Concrete vector-DB drivers (pgvector), 15.2 Agent-memory test gaps, 15.10 Documentation drift |
| **P3** | 12.1 MongoDB driver, 12.5 Framework integrations, 12.6 LLM ecosystem, 13.1 Pinecone/Weaviate drivers, 14.3 GDPR tooling, 15.7 Dep currency, 15.8 API tiering |
| **P4** | 12.3 Elasticsearch, 12.4 GraphQL, 14.2 Distributed architecture, 14.4 Cloud-native artefacts |
| **P5** | 14.5 GPU acceleration |
| **Out of scope / speculative** | 15.1 Real-time WS, 15.2 GraphSAGE, 15.3 KG completion, 15.4 Clawvault |

**P1/P2 count: 10 items.** That's the realistic "active forward work" load for the next 1–2 quarters.

---

## Companion documents

- [ROADMAP.md](./ROADMAP.md) — terser status-focused mirror of this doc
- [CHANGELOG.md](../../CHANGELOG.md) — per-version history of shipped features
- [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) — per-task Phase 0–11 ledger for the shipped perf & scale work
- [`docs/architecture/DEPENDENCY_GRAPH.md`](../architecture/DEPENDENCY_GRAPH.md) — auto-generated source-of-truth for what exists in `src/`
