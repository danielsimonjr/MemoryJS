# Future Features

Consolidated list of all planned but unimplemented features for MemoryJS, merging the original [ROADMAP.md](./ROADMAP.md) phases with new performance & scale proposals.

**Last refreshed: 2026-05-13** — v1.15.0 shipped Phases 0–11 of the performance & scale track via PR #34, absorbing the majority of remaining items across §1–§6 (search latency, write throughput, memory footprint, query execution, storage backends, observability) and large portions of §7–§13 (search intelligence, graph analytics, integration, advanced features). The 2026-05-08 "deep-dive" trimming of §1.3 is now superseded — BM25 incrementality + batch-coalesce window both shipped as part of Phase 1.

> **What's shipped** (regenerated 2026-05-13 against `src/` at HEAD):
>
> | Phase | Status | Notes |
> |-------|--------|-------|
> | Phase 1 — Foundation | ✅ shipped | CLI pipe support landed in Phase 0 of perf & scale track |
> | Phase 2 — Developer Experience | ✅ mostly shipped | Search suggestions + perf metrics + diagnostics (`ctx.diagnostics.explainPlan` / `indexHealth`) all shipped |
> | Phase 3 — Agent Memory | ✅ shipped | All v1.7–v1.11 agent-memory features stable |
> | Phase 3B — Memory Intelligence | ✅ 3B.1–3B.7 shipped | 3B.8 Heuristic Guidelines Manager remains (scaffold in `src/agent/HeuristicManager.ts`) |
> | Phase 4 — Integration & Scale (η.4) | ✅ 5 of 6 shipped | Only Elasticsearch (4.3) remains; mmap / segments / columns / tiered index all shipped |
> | Phase 5 — Advanced Features (η.5) | ✅ shipped | node2vec + LSH + RDF/SPARQL + CRDT + collaboration synthesis all in place |
> | Phase 6 — Enterprise (η.6) | ⚠️ 2 of 5 shipped | RBAC + ABAC + RLS + API keys + PII + governance shipped; distributed / cloud-native / GPU remain |
> | Perf & Scale Track (Phases 0–11) | ✅ shipped | All 12 of 12 Phase 3 items + all 5 multi-month engineering features shipped via PR #34 |
>
> **Remaining work as of 2026-05-13**:
> - **MEM-05** — `PostgreSQLBackend` (multi-user tenant isolation)
> - **MEM-06** — Concrete external `VectorMemoryBackend` (pgvector / Pinecone / Weaviate)
> - **4.3** — Elasticsearch integration (SQLite FTS5 + BM25 covers most original motivation; this is optional add-on)
> - **6.2** — Multi-node distributed coordinator (in-process building blocks ready: `WriteAheadLog`, `CRDTGraph`, `FileSegmentStorage`)
> - **6.4** — Cloud-native deployment artefacts (Helm / K8s operator / Docker)
> - **6.5** — GPU acceleration (deferred — `src/search/Node2Vec.ts` declines it in code comments; CPU envelope covers ~10 M entities)
> - **3B.8** — Heuristic Guidelines Manager wiring
>
> See [ROADMAP.md](./ROADMAP.md) Backlog Audit section for the full ship-state table, and [`docs/planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](../planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md) for the per-task Phase 0–11 ledger.

---

## 1. Search Latency Optimizations

### 1.1 Materialized Search Views

Pre-compute common query patterns into cached result sets that invalidate on write.

**Problem**: Repeated searches with similar filters (e.g., "all entities of type `person` with tag `active`") re-scan the full entity set each time.

**Proposal**:
- Define "views" as stored query predicates (entity type + tag filters + importance range)
- Maintain a result cache per view, updated incrementally on entity create/update/delete
- Views register as `GraphEventEmitter` listeners for automatic invalidation
- Configurable staleness tolerance (e.g., allow 5s stale for read-heavy workloads)

**Expected impact**: 10-50x speedup for repeated filter-based queries.

### 1.2 Bloom Filter Pre-screening

Use bloom filters to quickly eliminate non-matching entities before expensive search operations.

**Problem**: Fuzzy search, semantic search, and hybrid search evaluate every entity in the graph even when most won't match.

**Proposal**:
- Build bloom filters per entity type, per tag, and per observation n-gram
- Before running expensive searches, intersect bloom filters to produce a candidate set
- Only run full search algorithms against the candidate set
- Bloom filters rebuild in background on entity changes (cheap — O(n) insert)

**Expected impact**: 60-80% reduction in candidate set size for filtered searches.

### 1.3 Incremental Index Updates — BM25 + batch coalescing

*TF-IDF (`TFIDFIndexManager`), inverted index (`OptimizedInvertedIndex`), and embedding indexes (`IncrementalIndexer` + `TFIDFEventSync`) already support surgical `addDocument`/`removeDocument` (Phase 10 Sprint 3 / Phase 12 Sprint 5). Two sub-items remain.*

**Problem**: `BM25Search` still has no `addDocument`/`removeDocument` — its index rebuilds on entity changes. And none of the index updaters coalesce clustered writes.

**Proposal**:
- BM25: maintain running average document length, update on add/remove (mirrors what `TFIDFIndexManager` already does)
- Batch coalescing across all incremental updaters: if N writes happen within a configurable window (e.g., 50ms), apply all updates in a single pass

**Expected impact**: Index updates drop from O(n) to O(1) amortized for BM25; reduced churn under burst writes.

### 1.4 Query Result Streaming

Return search results as async iterables instead of fully-materialized arrays.

**Problem**: Callers waiting for all results when they often need only the top 10. Hybrid search collects from 3+ subsystems before returning.

**Proposal**:
- New `searchStream()` methods on `SearchManager` returning `AsyncIterable<ScoredEntity>`
- Priority queue merger for hybrid search: yield highest-scoring results as each subsystem produces them
- Callers can `break` from `for await` to stop early, saving computation
- Backward-compatible: existing `search()` methods unchanged

**Expected impact**: Time-to-first-result reduced by 70-90% for complex queries.

### 1.5 Tiered Index Architecture

Separate hot (frequently queried) entities from cold (rarely accessed) for faster lookups.

**Problem**: All entities share the same index regardless of access patterns. At 100K entities, index scans are proportionally slow.

**Proposal**:
- Track entity access frequency via `AccessTracker` (already exists in agent memory)
- Maintain a compact "hot tier" index (top 20% by access) in memory
- Search hot tier first; only search cold tier if insufficient results
- Promote/demote entities between tiers on a configurable schedule
- Hot tier stays small enough for L2 cache residency

**Expected impact**: 2-5x speedup for common queries that hit frequently-accessed entities.

---

## 2. Write Throughput Optimizations

### 2.1 Write-Ahead Log (WAL) for JSONL Backend

Batch writes through a WAL to reduce fsync overhead.

**Problem**: `GraphStorage` performs an atomic write (temp file + rename) on every mutation. At high write rates, this is the bottleneck — especially on Windows with Dropbox file locking.

**Proposal**:
- Append mutations to a WAL file (fast, sequential writes)
- Periodically compact WAL into the main JSONL file (background task)
- On startup, replay any uncommitted WAL entries
- Configurable flush interval (e.g., every 100ms or every 50 mutations)

**Expected impact**: 10-20x write throughput improvement for burst writes.

### 2.2 Batch Mutation API

Provide a dedicated batch API that groups multiple mutations into a single I/O operation.

**Problem**: Creating 1000 entities = 1000 separate file writes. `TransactionManager` helps but still writes per-operation.

**Proposal**:
- `ctx.batch(async (b) => { b.createEntity(...); b.createRelation(...); })`
- Collect all mutations in memory, validate, then write once
- Return all results at once
- Integrate with WAL for durability

**Expected impact**: N mutations cost ~1 I/O instead of N I/Os.

### 2.3 Background Index Maintenance

Decouple index updates from the write path.

**Problem**: Every entity write triggers synchronous index updates (TF-IDF, inverted index, event sync).

**Proposal**:
- Writes immediately update storage and mark affected indexes as dirty
- A background scheduler rebuilds dirty indexes in batches (every 100ms)
- Searches against dirty indexes use a "pending changes" overlay for correctness
- Configurable: `MEMORY_INDEX_UPDATE_MODE=sync|async` (default: sync for backward compat)

**Expected impact**: Write latency reduced by 40-60% when search indexing is the bottleneck.

---

## 3. Memory Footprint Optimizations

### 3.1 Observation Deduplication

Store identical observation strings once and reference by hash.

**Problem**: Many entities share similar or identical observations (e.g., "Created on 2025-01-15"). Each copy consumes memory.

**Proposal**:
- Content-addressable observation store: `Map<hash, string>`
- Entities store `observationHashes: string[]` instead of `observations: string[]`
- Transparent to callers — entity getter reconstructs full observations
- Dedup runs incrementally on entity create/update

**Expected impact**: 20-40% memory reduction for graphs with repetitive observations.

### 3.2 Lazy Entity Hydration

Load entity observations on-demand instead of eagerly.

**Problem**: Loading 100K entities into memory loads all their observations too, even when callers only need names/types.

**Proposal**:
- `EntityProxy` that loads only `name`, `entityType`, `tags`, `importance` initially
- `entity.observations` triggers lazy load from storage on first access
- Configurable hydration depth: `shallow` (no observations), `full` (all fields)
- Search results return shallow entities by default; caller requests full via `hydrate()`

**Expected impact**: 50-70% reduction in initial memory footprint for large graphs.

### 3.3 LRU Cache with Pressure-Based Eviction

Replace unbounded caches with memory-pressure-aware LRU caches.

**Problem**: `SearchCache`, `EmbeddingCache`, and `QueryPlanCache` grow unbounded. At scale, they consume significant memory.

**Proposal**:
- Shared `CacheManager` with a global memory budget (configurable, default 100MB)
- Each cache gets a proportional allocation based on hit rates
- LRU eviction when a cache exceeds its allocation
- `MemoryMonitor` (already exists) triggers emergency eviction at 80% budget

**Expected impact**: Predictable memory usage with <5% cache miss rate increase.

### 3.4 Compressed In-Memory Storage

Store entity data in compressed form, decompress on access.

**Problem**: At 100K entities with 10 observations each, raw string storage = ~500MB+ RAM.

**Proposal**:
- Compress entity observations using LZ4 (fast decompression) when stored in memory
- Decompress transparently on read
- Only compress entities in the "cold" tier (infrequently accessed)
- Hot entities remain uncompressed for zero-overhead access

**Expected impact**: 3-5x memory reduction for cold entities.

---

## 4. Query Execution Improvements

### 4.1 Query Plan Caching with Statistics

Cache not just query plans, but the runtime statistics that inform plan selection.

**Problem**: `QueryCostEstimator` makes estimates without real execution data. Plans may be suboptimal.

**Proposal**:
- After query execution, record actual latency, result count, and resource usage
- Feed real statistics back into `QueryCostEstimator` for future queries
- Cache the best-performing plan per query pattern (parameterized)
- Expire cached plans when entity distribution changes significantly

**Expected impact**: 20-30% improvement in query planning accuracy after warmup.

### 4.2 Parallel Subsystem Search with Cancellation

Run hybrid search subsystems in parallel with early cancellation.

**Problem**: `ParallelSearchExecutor` exists but doesn't cancel slow subsystems when enough results are found.

**Proposal**:
- Set a "sufficient results" threshold per query
- When any subsystem produces enough high-quality results, cancel remaining subsystems
- Use `AbortController` for clean cancellation of in-flight searches
- Configurable timeout per subsystem with graceful degradation

**Expected impact**: 30-50% reduction in p95 hybrid search latency.

### 4.3 Columnar Observation Storage

Store observations in a columnar format for faster full-text scanning.

**Problem**: Searching observations requires iterating entity-by-entity. Poor cache locality.

**Proposal**:
- Maintain a parallel columnar store: all observations packed contiguously in memory
- Full-text scans operate on the columnar store (cache-friendly sequential access)
- Map results back to owning entities via an index
- Update columnar store incrementally on entity changes

**Expected impact**: 2-3x speedup for full-text observation scans due to better cache utilization.

---

## 5. Storage Backend Improvements

### 5.1 SQLite Connection Pooling

Support concurrent read operations via connection pooling.

**Problem**: Single `better-sqlite3` connection serializes all operations. Reads block behind writes.

**Proposal**:
- Maintain a pool of read-only connections (WAL mode allows concurrent reads)
- Single write connection with exclusive access
- `ctx.searchManager` operations use read pool; mutations use write connection
- Pool size configurable: `MEMORY_SQLITE_READ_POOL_SIZE` (default: 4)

**Expected impact**: 3-4x read throughput improvement under concurrent access.

### 5.2 SQLite Partial Indexes

Create partial indexes for common query patterns.

**Problem**: Full indexes on all entities waste space and slow down writes when most queries target specific entity types or tags.

**Proposal**:
- Auto-detect frequent query patterns from `QueryLogger`
- Create partial SQLite indexes (e.g., `CREATE INDEX idx_active ON entities(name) WHERE entityType = 'person'`)
- Periodically review and drop unused indexes
- Expose `MEMORY_SQLITE_AUTO_INDEX=true` env var

**Expected impact**: 2-5x speedup for filtered queries with matching partial indexes.

### 5.3 JSONL Segment Files

Split large JSONL files into segments for parallel reads.

**Problem**: Single JSONL file becomes a bottleneck at 100K+ entities — loading requires sequential parsing of the entire file.

**Proposal**:
- Split storage into segment files by entity type or creation time (e.g., `memory.0001.jsonl`, `memory.0002.jsonl`)
- Maintain a lightweight manifest file mapping entity names to segments
- Load segments in parallel on startup
- Compact segments periodically (merge small segments, remove deleted entities)

**Expected impact**: 3-5x faster startup for large JSONL graphs.

### 5.4 Memory-Mapped File Support

Use mmap for large graphs to avoid loading everything into heap memory.

**Problem**: JSONL backend loads entire graph into memory on startup. At 100K+ entities this consumes significant heap.

**Proposal**:
- Memory-mapped file access for read-heavy workloads
- OS manages paging — only actively used portions in RAM
- Combine with lazy entity hydration (3.2) for maximum benefit

### 5.5 Index Partitioning by Entity Type

Partition search indexes by entity type for faster filtered queries.

**Problem**: Single monolithic index searched even when query targets a specific entity type.

**Proposal**:
- Maintain per-type inverted indexes
- Query planner routes to correct partition based on entity type filter
- Reduces index scan size proportionally to type distribution

---

## 6. Observability & Diagnostics

### 6.1 Query Plan Visualization

Render query execution plans as visual diagrams for debugging.

**Problem**: `QueryPlan` type exists in `types/search.ts` but there's no way to visualize or render plans for debugging.

**Proposal**:
- `searchManager.explainPlan(query)` returns a formatted plan tree
- Render as ASCII tree, Mermaid diagram, or JSON
- Show estimated vs actual costs per plan node
- Highlight the chosen execution path and alternatives considered

### 6.2 Performance Dashboard

Real-time visibility into search and storage performance.

**Problem**: `MemoryMonitor` and `QueryLogger` collect metrics but there's no aggregated view.

**Proposal**:
- `ctx.diagnostics()` returns current performance metrics
- Metrics: query latency percentiles, cache hit rates, index freshness, entity count by type, memory usage
- Optional periodic logging to file (`MEMORY_DIAGNOSTICS_LOG=true`)
- Integration with `QueryLogger` for query-level tracing

### 6.3 Index Health Monitor

Detect and report index degradation before it affects query performance.

**Problem**: Indexes can become stale, fragmented, or oversized without warning.

**Proposal**:
- Periodic health checks: index size vs entity count ratio, term distribution skew, stale entry count
- Automatic index rebuild recommendations
- `ctx.indexHealth()` returns actionable diagnostics
- Alert thresholds configurable via env vars

---

## 7. Search Intelligence (from ROADMAP Phase 2)

*`SearchSuggestions` provides basic "Did you mean?" — these features go further.*

### 7.1 Context-Aware Spell Correction

Correct typos using the graph's own vocabulary as a dictionary.

**Problem**: `FuzzySearch` finds close matches but doesn't proactively correct query terms before execution.

**Proposal**:
- Build a vocabulary index from all entity names, types, and observation terms
- Before search execution, check each query term against vocabulary
- If no exact match and Levenshtein distance <= 2, suggest or auto-correct
- Use entity importance as a tiebreaker (prefer correcting to high-importance terms)

### 7.2 Query Expansion with Synonyms

Automatically expand queries with synonym terms for better recall.

**Problem**: Searching for "car" misses entities about "automobile" or "vehicle".

**Proposal**:
- Tag alias system (already exists via `TagManager`) extended to observation terms
- Maintain a synonym map: `Map<string, string[]>` (user-configurable + auto-detected)
- Auto-detect synonyms from co-occurring observation terms across entities
- `MEMORY_SYNONYM_EXPANSION=true` env var to enable
- Expanded terms get lower boost weight than original terms

---

## 8. Advanced Graph Analytics (from ROADMAP Phase 2)

*`GraphTraversal` has degree/betweenness/PageRank centrality — these add more algorithms.*

### 8.1 Clique Detection

Find fully-connected subgraphs (cliques) in the knowledge graph.

**Proposal**:
- Bron-Kerbosch algorithm for maximal clique enumeration
- Configurable minimum clique size
- Return cliques sorted by size
- Useful for identifying tightly-coupled entity clusters

### 8.2 HITS Algorithm (Hubs & Authorities)

Identify hub entities (link to many) and authority entities (linked to by many).

**Proposal**:
- Implement Kleinberg's HITS with configurable iteration count
- Return top-N hubs and authorities
- Useful for finding "connector" entities vs "expert" entities

### 8.3 Network Modularity & Community Detection

Detect natural communities/clusters in the graph.

**Proposal**:
- Louvain method for community detection
- Modularity score calculation
- Return community assignments per entity
- Graph density metrics (edges / possible edges)

---

## 9. Entity Lifecycle (from ROADMAP Phase 2)

### 9.1 Entity State Machine

Add draft/published/archived states with transition rules.

**Problem**: Entities are either present or deleted. No way to model a review/approval workflow.

**Proposal**:
- Add `status: 'draft' | 'published' | 'archived'` to Entity type
- State transition rules: draft → published, published → archived, archived → published
- Hooks: `onStateChange(entity, oldState, newState)` callback
- Default search filters to `published` entities only (configurable)
- Bulk state change operations: `ctx.entityManager.publishAll(filter)`

---

## 10. CLI Enhancements (from ROADMAP Phase 1)

### 10.1 Pipe Support for Scripting

Enable stdin/stdout piping for composable CLI workflows.

**Problem**: Interactive mode exists but CLI can't be used in Unix-style pipelines.

**Proposal**:
- Detect non-TTY stdin and read commands from pipe
- Output structured JSON to stdout when piped (not human-formatted)
- Support `memoryjs query "..." | jq '.entities[].name'` workflows
- `--format json|csv|table` flag for output control

---

## 11. Memory Intelligence (from ROADMAP Phase 3B)

*Phase 3B is largely shipped: `MemoryValidator`, `TrajectoryCompressor`, `ExperienceExtractor`, `ProcedureManager`, `ActiveRetrievalController`, `CausalReasoner`, and `WorldModelManager` are all in `src/agent/`. Only the Heuristic Guidelines Manager remains.*

### 11.1 Heuristic Guidelines Manager

Crystallize implicit patterns into explicit natural language strategies.

- `HeuristicManager` — create, match, reinforce, and merge heuristics
- Natural language condition matching via semantic similarity
- Conflict detection between heuristics (contradictory actions, overlapping conditions)
- Heuristic induction from trajectory analysis
- Prioritized application when multiple heuristics match

---

## 11B. Query Language (from ROADMAP Feature Categories)

### 11B.1 Domain-Specific Query Language (DSL)

A purpose-built query language for knowledge graph operations.

**Proposal**:
- SQL-like syntax for familiarity: `SELECT entities WHERE type = 'person' AND tag = 'active'`
- Graph-specific operators: path queries, neighborhood traversal, pattern matching
- Visual query builder (browser-based, integrates with graph visualization)

---

## 12. Integration & Ecosystem (from ROADMAP Phase 4)

### 12.1 Database Adapters

- PostgreSQL adapter with `pg_trgm` for text search
- MongoDB adapter for document-oriented storage
- Connection pooling for concurrent operations

### 12.2 REST API Generation

- Fastify plugin for automatic REST API from the graph
- OpenAPI/Swagger documentation generation
- Rate limiting and cursor-based pagination

### 12.3 Elasticsearch Integration

- Sync entities to Elasticsearch index for offloaded full-text search
- Hybrid local + Elasticsearch queries
- Automatic index mapping from entity types

### 12.4 GraphQL Support

- Auto-generated GraphQL schema from entity types
- Query and mutation resolvers
- Subscription support for real-time graph change notifications

### 12.5 Framework Integrations

- NestJS module with decorators for entity/relation injection
- Express middleware for REST endpoints
- Next.js API route helpers

### 12.6 LLM Ecosystem Integrations

- LangChain memory backend adapter (use MemoryJS as LangChain memory)
- Llama Index data connector
- Neo4j bridge for graph database interop
- Redis adapter for distributed caching layer

---

## 13. Advanced Features (from ROADMAP Phase 5)

### 13.1 Vector Database Integration

- Weaviate/Pinecone adapters for production semantic search
- Multi-vector embeddings per entity type
- Automatic embedding synchronization with graph mutations

### 13.2 Graph Embeddings

- node2vec implementation for entity embeddings based on graph structure
- GraphSAGE for inductive learning on new entities
- Embedding-based entity similarity (structural, not just textual)

### 13.3 ML-Powered Features

- Auto-tagging based on observation content
- Anomaly detection in relationship patterns
- Entity clustering by multi-signal similarity
- Knowledge graph completion (predict missing relations)
- Locality-Sensitive Hashing (LSH) for approximate fuzzy search
- Adaptive indexing based on query patterns

### 13.4 Standards Compliance — SPARQL

*RDF/Turtle/JSON-LD import/export already ship via `IOManager` (η.5.4). Only SPARQL remains.*

- SPARQL query support over the existing RDF view
- Federated query support across local + remote endpoints

### 13.5 Collaboration — CRDT

*Multi-user collaboration audit/conflict-resolution already ship (η.5.5.a–d). Only the CRDT layer (η.5.5.e) remains.*

- Conflict-free replicated data types for eventual consistency
- Real-time collaboration via WebSocket on top of the CRDT layer

---

## 14. Enterprise (from ROADMAP Phase 6)

### 14.1 Access Control

*RBAC ships via `src/agent/rbac/` (η.6.1). Remaining items below.*

- Attribute-Based Access Control (ABAC)
- Row-level security for entity queries
- API key management

### 14.2 Distributed Architecture

- Graph sharding by entity type or hierarchy
- Read replicas for query scaling
- Write-ahead log for cross-node consistency
- Conflict-free replicated data types (CRDTs) for eventual consistency

### 14.3 Security & Compliance

*PII detection/masking ships via `src/security/PiiRedactor.ts` (η.6.3). Audit logging ships via `AuditLog` (v1.6.0). Remaining items below.*

- Encryption at rest (AES-256 / SQLCipher adapter — gated)
- Encryption in transit (TLS)
- GDPR compliance tools (right to deletion, data export)

### 14.4 Cloud-Native Deployment

- Docker images and Kubernetes Helm charts
- Serverless adapters (AWS Lambda, Cloud Functions)
- Cloud storage backends (S3, GCS, Azure Blob)

### 14.5 GPU Acceleration

- CUDA-accelerated similarity search
- Batch embedding generation
- Parallel graph algorithm execution

---

## Priority Matrix

### Shipped in v1.15.0 (PR #34 — Phases 0–11 of performance & scale track)

| Section | Item | Implementation |
|---------|------|----------------|
| **Performance & Scale** | | |
| 1.1 | Materialized Search Views | `MaterializedViewsManager` |
| 1.2 | Bloom Filter Pre-screening | `BloomFilter` + `BloomPreScreener` |
| 1.3 | BM25 Incrementality + Batch Coalescing | `BM25Search` + `IncrementalIndexer` + `TFIDFEventSync` |
| 1.4 | Query Result Streaming | `StreamingExporter` |
| 1.5 | Tiered Index Architecture | `LRUHotTier` → `DiskWarmTier` → `BrotliColdTier` via `TieredIndex` |
| 2.1 | WAL for JSONL Backend | `WriteAheadLog` + `EntityProxy` |
| 2.2 | Batch Mutation API | `BatchTransaction` |
| 2.3 | Background Index Maintenance | `BackgroundIndexer` |
| 3.2 | Lazy Entity Hydration | `JsonlColumnStore` (columnar observation reads) |
| 3.3 | LRU Cache w/ Pressure Eviction | `CachePressureCoordinator` |
| 3.4 | Compressed In-Memory Storage | `CompressedMap` + `BrotliCompressionAdapter` / `ZlibCompressionAdapter` / `IdentityCompressionAdapter` |
| 4.1 | Query Plan Caching with Stats | `QueryPlanCache` + `QueryCostEstimator` + `QueryPlanner` |
| 4.2 | Parallel Search + Cancellation | `ParallelSearchExecutor` + `EarlyTerminationManager` + `OperationCancelledError` (AbortController-driven) |
| 4.3 | Columnar Observation Storage | `IColumnStore<T>` + `JsonlColumnStore` + `InMemoryColumnStore` + `ObservationColumn` |
| 5.1 | SQLite Connection Pooling | Read pool (`MEMORY_SQLITE_READ_POOL_SIZE`) |
| 5.2 | SQLite Partial Indexes | `PartialIndexAdvisor` (auto-DDL via `MEMORY_SQLITE_AUTO_INDEX`) |
| 5.3 | JSONL Segment Files | `FileSegmentStorage` + `FnvSegmentRouter` (`MEMORY_STORAGE_SEGMENT_COUNT`) |
| 5.4 | Memory-Mapped Files | `IMmapBackend` + `BufferMmapBackend` + `FsReadMmapBackend` |
| 5.5 | Index Partitioning | `PartitionedInvertedIndex` |
| **Observability** | | |
| 6.1 | Query Plan Visualization | `ctx.diagnostics.explainPlan` |
| 6.3 | Index Health Monitor | `IndexHealthMonitor` |
| **Search & Analytics** | | |
| 7.2 | Synonym Expansion | `SynonymManager` |
| 8.1 | Clique Detection | `GraphTraversal.findMaximalCliques()` |
| 8.2 | HITS Algorithm | `GraphTraversal.hits()` |
| 8.3 | Community Detection | `GraphTraversal.louvainCommunities()` |
| **Entity & CLI** | | |
| 9.1 | Entity State Machine | `EntityStateMachine` + `TransitionLedger` + `IllegalStatusTransitionError` |
| 10.1 | CLI Pipe Support | `src/cli/` (Phase 0) |
| **Advanced & Enterprise** | | |
| 13.2 | Graph Embeddings | `BiasedRandomWalk` + `SkipGramTrainer` (node2vec) |
| 13.3 | ML-Powered Features (LSH, anomaly) | `LSHIndex` + `AnomalyDetector` + `BloomFilter` + `PatternDetector` |
| 13.4 | SPARQL (Standards) | `SparqlExecutor` (minimal BGP / FILTER / OPTIONAL / UNION) + `SparqlError` |
| 13.5 | CRDT Collaboration | `VectorClock` + `LWWRegister` + `ORSet` + `CRDTGraph` |
| 14.1 | Access Control | `RbacMiddleware` + `RoleAssignmentStore` (η.6.1); `ABACPolicy` + `RowLevelFilter` + `APIKeyStore` (Phase 5) |
| **Codebase Health** | | |
| 15.1 | Split god-object files | Done (IOManager → BackupManager; AgentMemoryManager kept as intentional facade) |
| 15.3 | Eliminate `as any` casts | Done |
| 15.4 | Centralize logging | `src/utils/logger.ts` (structured logger) |
| 15.5 | Scheduler / lifecycle hygiene | `TaskQueue` bounds + `kickProcessNext` error surfacing |
| 15.6 | Tooling (lint, lockfile) | ESLint + improved lockfile discipline |
| 15.9 | Security checklist | `SECURITY.md` + PRs #38/#39 hardening |

### Remaining work (P1 → P5 priority)

| Section | Item | Priority | Effort | Notes |
|---------|------|----------|--------|-------|
| **High-priority remaining** | | | | |
| 3.1 | Observation Deduplication (entity-level) | **P1** | Medium | `MemoryEngine` covers turn-level dedup; entity-level passes still TBD |
| 7.1 | Spell Correction | **P2** | Medium | `NGramIndex` infrastructure exists; spell-correction layer absent |
| 11.1 | Heuristic Manager wiring (3B.8) | **P2** | Medium | `src/agent/HeuristicManager.ts` is scaffolded but not wired to `ConsolidationPipeline` |
| 11B.1 | Query Language DSL parser | **P2** | High | `QueryParser` + `QueryDslError` exist; full DSL frontend pending |
| **Integration & Ecosystem** | | | | |
| 12.1 | Concrete DB drivers (PostgreSQL, MongoDB) | **P2** | High | `IDatabaseAdapter` interface shipped; concrete drivers pending. Overlaps with MEM-05. |
| 12.2 | REST API generation (Fastify, OpenAPI) | **P3** | High | `RestRouter` scaffold shipped; framework binding + OpenAPI pending |
| 12.3 | Elasticsearch Integration | **P4** | High | Optional add-on; SQLite FTS5 + BM25 covers the common case |
| 12.4 | GraphQL Support | **P4** | High | Build on top of REST |
| 12.5 | Framework Integrations (LangChain, LlamaIndex) | **P3** | Medium | `LangChainMemoryAdapter` scaffolded |
| 12.6 | LLM Ecosystem Integrations | **P3** | Medium | Optional embedding/LLM providers pluggable today |
| 13.1 | Concrete Vector-DB drivers (pgvector / Pinecone / Weaviate) | **P3** | High | `IVectorDBAdapter` + in-process stores shipped; external drivers pending. Overlaps with MEM-06. |
| **Enterprise** | | | | |
| 14.2 | Distributed Architecture (multi-node) | **P4** | Very High | In-process building blocks ready (`WriteAheadLog`, `CRDTGraph`, `FileSegmentStorage`); cross-host coordinator pending |
| 14.3 | Encryption & GDPR tooling | **P3** | Medium | PII redactor + audit log shipped; formal GDPR-export / right-to-erasure workflows pending |
| 14.4 | Cloud-Native Deployment artefacts | **P4** | Medium | Helm chart / K8s operator / Docker image — may live in sibling repo |
| 14.5 | GPU Acceleration | **P5** | Very High | Deferred per `src/search/Node2Vec.ts` comments; CPU envelope covers ~10 M entities |
| **Codebase Health** | | | | |
| 15.2 | Close agent-memory test gaps | **P2** | Medium | 273 test files / 7098 tests — gaps remain on visibility-time-window edge cases |
| 15.7 | Dependency currency | **P3** | Medium | Periodic `npm outdated` sweep |
| 15.8 | Public API tiering | **P3** | Low | API-stability tags added Phase 5; coverage incomplete |
| 15.10 | Documentation drift | **P2** | Low | This document + README + architecture/* refreshed 2026-05-13 |

### Priority legend

- **P1** — should be the next sprint's focus
- **P2** — within 1–2 sprints
- **P3** — within the next quarter
- **P4** — strategic; gated on user pull or external dep approval
- **P5** — long-horizon / out-of-scope-for-now

---

## Implementation Strategy

**Phase A (P0 — Weeks 1-3)**: Materialized views, batch mutations. Eliminate the most common performance bottlenecks. (TF-IDF/inverted-index incrementality already shipped — see §1.3 for remaining BM25 + coalescing work, demoted to P1.)

**Phase B (P1 — Weeks 4-7)**: Streaming results, bloom filters, parallel cancellation, lazy hydration. Reduce worst-case latency and memory usage.

**Phase C (P2 — Weeks 8-12)**: Background indexing, LRU caches, SQLite pooling, observability, spell correction, synonym expansion, entity lifecycle, CLI pipe support; codebase-health items 15.3/15.4/15.9/15.10.

**Phase D (P3 — Months 4-6)**: Heuristic manager, community detection, database adapters, REST API, LLM ecosystem integrations; codebase-health item 15.7/15.8.

**Phase E (P4 — Months 7-10)**: Elasticsearch, GraphQL, framework integrations, query DSL, vector DB, graph embeddings, ML features (LSH, adaptive indexing).

**Phase F (P5 — Months 11+)**: SPARQL, CRDT collaboration, ABAC/row-level access control, distributed architecture, encryption & GDPR, cloud-native, GPU acceleration.

**Codebase health (parallel track — Weeks 1-6)**: §15 items run alongside Phase A/B and don't gate feature work. P1 items (15.1, 15.2, 15.5, 15.6) should land first because they unblock cleaner downstream work.

---

## 15. Codebase Health & Improvement Areas (added 2026-05-08)

*Concrete refactoring/quality items grounded in the v1.15.0 source tree (verified file paths and counts). Distinct from feature work — these address tech debt, type safety, lifecycle hygiene, and tooling.*

### 15.1 Split the largest god-object files

Top offenders by LOC (verified via `wc -l`):

| File | LOC | Split direction |
|---|---|---|
| `src/types/types.ts` | 2,242 | `entity-types.ts`, `relation-types.ts`, `search-types.ts` |
| `src/features/IOManager.ts` | 1,934 | `ImportManager`, `ExportManager`, `BackupManager`, `IngestManager` behind a thin facade |
| `src/agent/ContextWindowManager.ts` | 1,517 | Extract `CompressionService` and `TokenBudgetManager` |
| `src/core/SQLiteStorage.ts` | 1,350 | Pull schema/migrations into a separate module |
| `src/agent/ConsolidationPipeline.ts` | 1,276 | One class per pipeline phase |
| `src/types/agent-memory.ts` | 1,267 | Same split treatment as `types.ts` |
| `src/agent/MultiAgentMemoryManager.ts` | 1,139 | Coordination + conflict resolution + visibility |
| `src/core/EntityManager.ts` | 1,007 | Tag-index/query-builder extraction |

The `CHUNK` skill and `tools/chunking-for-files` directly support this work.

### 15.2 Close agent-memory test gaps

Modules in `src/agent/` with **no matching `*.test.ts`**:

- `src/agent/DistillationPipeline.ts`
- `src/agent/ProfileManager.ts`
- `src/agent/MemoryBackend.ts` (interface — but contract enforcement could be stricter)
- `src/agent/AgentMemoryConfig.ts`

`src/search/LLMSearchExecutor.ts` and `src/search/SymbolicSearch.ts` likewise lack dedicated tests. Agent memory is the headline feature; gaps here are the highest-leverage to close.

`DistillationPipeline` is referenced in CLAUDE.md but has no public getter on `ManagerContext` — flag as either internal-only or wire it up properly.

### 15.3 Type-safety leaks

- **19** `as any` casts in `src/` (verified). Hotspots: `src/agent/ProfileManager.ts:158/170/172`, `src/agent/ContextWindowManager.ts:1127–1129`, `src/core/GraphStorage.ts:695`.
- 1 `@ts-expect-error` in `src/search/EmbeddingService.ts:359` for the optional `@xenova/transformers` peer dep — fine, but document the peer-dep matrix.
- Only 2 `TODO/FIXME/HACK` markers — repo is clean on that axis.

### 15.4 Centralize logging

26 raw `console.*` calls outside CLI/tests (error handlers in `DecayScheduler:189`, `ContextWindowManager:1142/1173/1187`, `ConsolidationScheduler:216`, `AgentMemoryManager:125`, `ManagerContext:185/194`, etc.). `QueryLogger` already exists — promote it (or a small `Logger` facade) to project-wide and route these through it. Today, error visibility depends on which class you're in.

### 15.5 Scheduler / lifecycle hygiene

- `DecayScheduler.start()` (`src/agent/DecayScheduler.ts:121`) does **not** `.unref()` its `setInterval`, but `ConsolidationScheduler` and `DreamEngine` do — inconsistent and can keep the process alive.
- Fire-and-forget `void this.runX()` patterns in scheduler ticks swallow rejections. Wrap each tick body in try/catch with logger + optional `onError` callback (some have it, some don't).
- No global `process.on('unhandledRejection' | 'uncaughtException', …)` in `src/cli/index.ts` — silent CLI crashes likely.

### 15.6 Tooling & reproducibility

- **No lint script.** Add ESLint + `@typescript-eslint` (would catch most of §15.3 and §15.4 above). The repo has ~63k LOC and no static analysis beyond `tsc`.
- **`package-lock.json` is gitignored.** For a published library this is unusual and explicitly causes the "dependencies drift between machines" gotcha noted in CLAUDE.md. Commit it.
- `tsup.config.ts` ships sourcemaps in production. Consider gating with `process.env.NODE_ENV` to slim `dist`.

### 15.7 Dependency currency

- `zod ^3.24.1` — Zod v4 is current; the v3→v4 migration affects error formatting and `.parseAsync`. Worth a tracked upgrade.
- `commander ^12.1.0` — current major is v14. Check CLI flag parsing for breaking changes.
- `chrono-node ^2.9.0` — used by `TemporalQueryParser`; check for newer locale/parse fixes.

### 15.8 Public API surface

`src/index.ts` is a barrel of `export *`. With ~150 source files there's a strong chance internal helpers leak.

- Tag intentional exports with `/** @public */` and run `api-extractor` (or just be intentional in barrels).
- Document a stability tier (stable / experimental / internal) — several v1.7+ features (entropy filter, role profiles, dream engine) are still maturing.

### 15.9 Security checklist coverage

`src/security/` exists. Cross-check against the gotchas in CLAUDE.md (FTS5/LIKE escaping, XML entity decoding, path confinement) — make sure CLI I/O paths in `src/cli/commands/io.ts` (which uses `readFileSync`/`writeFileSync` with user-supplied paths) all flow through the validators. A short `SECURITY.md` documenting the threat model would make audit easier.

### 15.10 Documentation drift

CLAUDE.md is largely accurate (verified `ctx.memoryEngine`, `ctx.worldModelManager`, `ctx.causalReasoner`, `ctx.procedureManager`, `ctx.rbacMiddleware`, `ctx.roleAssignmentStore` all present in `src/core/ManagerContext.ts`). Drift to fix:

- `DistillationPipeline` documented but unwired (see §15.2).
- The auto-generated `docs/architecture/DEPENDENCY_GRAPH.md` should be regenerated as part of release (the `DEPS` skill exists for this).

---

## Benchmarking Plan

Each performance feature should be validated with:
- **Baseline**: Run `tests/performance/` suite before implementation
- **Target**: Define specific latency/throughput targets per feature (documented in PR)
- **Measurement**: Before/after comparison at 10K, 50K, and 100K entity scales
- **Regression**: Add benchmark to CI to prevent future regressions

Environment variable to enable benchmarks: `SKIP_BENCHMARKS=false`

---

## Test Coverage Expansion (from ROADMAP)

Planned testing improvements beyond the current 4674 tests:

- **Property-based testing** for search algorithms (verify invariants across random inputs)
- **Chaos engineering** for concurrency (random delays, failures during transactions)
- **Load testing** for scaling scenarios (10K/50K/100K entity benchmarks)
- **Security fuzzing** for input validation (fuzz entity names, observations, query strings)
- **CLI tool testing** (command parsing, output formatting, pipe support)

---

*Generated: 2026-02-10. Last refreshed: 2026-05-08 (removed shipped Phase 3B / η.4.4 / η.4.6 / η.5.4 / η.5.5 / η.6.1 / η.6.3 items; added §15 codebase-health track; deep-dive trimmed §1.3 to BM25 + coalescing).*
*Supersedes performance-only version. Consolidates all unimplemented [ROADMAP.md](./ROADMAP.md) features.*
