# Future Features

Consolidated list of all planned but unimplemented features for MemoryJS, merging the original [ROADMAP.md](./ROADMAP.md) phases with new performance & scale proposals.

> **What's already done**: Phase 1 (95% — only CLI pipe support remains), Phase 2 (partial — search suggestions and performance metrics exist), Phase 3 (100%). See ROADMAP.md for details on completed work.

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

### 1.3 Incremental Index Updates

Replace full index rebuilds with surgical add/remove operations.

**Problem**: `TFIDFIndexManager` and `OptimizedInvertedIndex` rebuild on entity changes. At 100K entities, rebuilds take 500ms+.

**Proposal**:
- Add `addDocument(entityName, terms[])` and `removeDocument(entityName)` to inverted index
- Update TF-IDF scores incrementally (adjust document frequency counts, recalculate only affected terms)
- BM25 index: maintain running average document length, update on add/remove
- Batch coalescing: if N writes happen within a configurable window (e.g., 50ms), apply all updates in a single pass

**Expected impact**: Index updates drop from O(n) to O(1) amortized per entity change.

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

*All Phase 3B features are unimplemented. These transform raw storage into validated, compressed, transferable knowledge. See ROADMAP.md for full interface specifications.*

### 11.1 Memory Validation & Error Rectification

Prevent hallucinations and logical errors from contaminating memory through self-critique before storage.

- `MemoryValidator` service with consistency checking against existing entity knowledge
- Contradiction detection (factual, temporal, logical) within and across entities
- Temporal consistency validation (event ordering)
- Reliability scoring based on source and confirmation count
- Pre-storage validation hooks

### 11.2 Trajectory Compression

Distill verbose interaction histories into compact, reusable representations.

- `TrajectoryCompressor` with multiple strategies: semantic clustering, temporal windowing, importance filtering, hierarchical
- Multi-granularity abstraction (fine/medium/coarse)
- Context folding for working memory (fit into token budget)
- Redundancy detection across entities
- LLM-powered summarization (optional) + embedding-based clustering

### 11.3 Experience Extraction

Abstract universal patterns from clusters of trajectories for zero-shot transfer.

- `ExperienceExtractor` with contrastive induction (learn from success/failure pairs)
- Trajectory clustering by semantic, structural, or outcome similarity
- Decision boundary learning from trajectory outcomes
- Rule confidence scoring with support/contra counts
- Experience lifecycle management (creation, validation, application, retirement)

### 11.4 Procedural Memory Manager

Encapsulate recurring action patterns into reusable procedures (skills).

- `ProceduralMemoryManager` — learn procedures from observed action sequences
- Context-based procedure matching
- Procedure refinement from execution feedback
- Procedure composition into higher-level skills
- Success rate tracking and versioning

### 11.5 Heuristic Guidelines Manager

Crystallize implicit patterns into explicit natural language strategies.

- `HeuristicManager` — create, match, reinforce, and merge heuristics
- Natural language condition matching via semantic similarity
- Conflict detection between heuristics (contradictory actions, overlapping conditions)
- Heuristic induction from trajectory analysis
- Prioritized application when multiple heuristics match

### 11.6 Active Retrieval Controller

Transform memory from passive storage to autonomous, context-aware resource invocation.

- `ActiveRetrievalController` — decide if/when/what to retrieve based on task context
- Cost-benefit analysis for retrieval (estimated benefit vs token/latency cost)
- Adaptive retrieval strategy based on task type (recall, reasoning, planning, creative, diagnostic)
- Retrieval pattern learning from feedback
- Dynamic budget allocation across memory types

### 11.7 Causal Relations

Extend relations to capture causal dependencies with delayed effects.

- `CausalRelation` type with strength, delay, probability, conditions, mechanism
- `CausalGraphManager` — causal inference, effect prediction, causal path finding
- Cycle detection for inconsistency identification
- Causal structure learning from observations
- Integration with `GraphTraversal` for causal path algorithms

### 11.8 World Model Manager

Build and maintain internal models of the environment from observations.

- `WorldModelManager` — infer environment rules, predict outcomes, track state
- State versioning and change detection
- Rule learning from observation sequences with confidence calibration
- Prediction with uncertainty quantification
- Integration with `CausalGraphManager` for causal reasoning

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

### 12.4 Temporal Versioning

- Entity/relation change history (append-only audit log)
- Point-in-time queries: `ctx.entityManager.getAt(name, timestamp)`
- User attribution on changes
- Rollback to any previous version

### 12.5 Graph Visualization

- Browser-based graph explorer (standalone HTML + D3.js or Cytoscape.js)
- Interactive filtering, search, and drill-down
- Export to SVG/PNG
- Cluster visualization for communities

### 12.6 GraphQL Support

- Auto-generated GraphQL schema from entity types
- Query and mutation resolvers
- Subscription support for real-time graph change notifications

### 12.7 Framework Integrations

- NestJS module with decorators for entity/relation injection
- Express middleware for REST endpoints
- Next.js API route helpers

### 12.8 LLM Ecosystem Integrations

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

### 13.4 Standards Compliance

- SPARQL query support
- RDF import/export
- Linked Data compatibility

### 13.5 Collaboration Features

- Multi-user graph editing with conflict resolution
- Change conflict detection and merge strategies
- Real-time collaboration via WebSocket

---

## 14. Enterprise (from ROADMAP Phase 6)

### 14.1 Access Control

- Role-Based Access Control (RBAC) with entity-level permissions
- Attribute-Based Access Control (ABAC)
- Row-level security for entity queries
- API key management

### 14.2 Distributed Architecture

- Graph sharding by entity type or hierarchy
- Read replicas for query scaling
- Write-ahead log for cross-node consistency
- Conflict-free replicated data types (CRDTs) for eventual consistency

### 14.3 Security & Compliance

- Encryption at rest (AES-256)
- Encryption in transit (TLS)
- GDPR compliance tools (right to deletion, data export)
- PII detection and masking in observations
- Complete audit logging

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

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| **Performance & Scale** | | | |
| 1.3 Incremental Index Updates | High | Medium | **P0** |
| 1.1 Materialized Search Views | High | Medium | **P0** |
| 2.2 Batch Mutation API | High | Low | **P0** |
| 1.4 Query Result Streaming | High | Medium | **P1** |
| 1.2 Bloom Filter Pre-screening | High | Medium | **P1** |
| 4.2 Parallel Search + Cancellation | Medium | Low | **P1** |
| 3.2 Lazy Entity Hydration | High | High | **P1** |
| 2.3 Background Index Maintenance | Medium | Medium | **P2** |
| 3.3 LRU Cache w/ Pressure Eviction | Medium | Medium | **P2** |
| 5.1 SQLite Connection Pooling | Medium | Low | **P2** |
| 1.5 Tiered Index Architecture | Medium | High | **P3** |
| 2.1 WAL for JSONL Backend | Medium | High | **P3** |
| 3.1 Observation Deduplication | Low | Medium | **P3** |
| 3.4 Compressed In-Memory Storage | Medium | High | **P3** |
| 4.1 Query Plan Caching w/ Stats | Low | Medium | **P3** |
| 4.3 Columnar Observation Storage | Medium | High | **P3** |
| 5.2 SQLite Partial Indexes | Low | Medium | **P3** |
| 5.3 JSONL Segment Files | Medium | High | **P3** |
| 5.4 Memory-Mapped Files | Medium | High | **P3** |
| 5.5 Index Partitioning | Medium | Medium | **P3** |
| **Observability** | | | |
| 6.1 Query Plan Visualization | Medium | Low | **P2** |
| 6.2 Performance Dashboard | Low | Medium | **P3** |
| 6.3 Index Health Monitor | Low | Low | **P3** |
| **Search & Analytics** | | | |
| 7.1 Spell Correction | Medium | Medium | **P2** |
| 7.2 Synonym Expansion | Medium | Medium | **P2** |
| 8.1 Clique Detection | Low | Medium | **P3** |
| 8.2 HITS Algorithm | Low | Low | **P3** |
| 8.3 Community Detection | Medium | Medium | **P3** |
| **Entity & CLI** | | | |
| 9.1 Entity State Machine | Medium | Medium | **P2** |
| 10.1 CLI Pipe Support | Low | Low | **P2** |
| **Memory Intelligence (Phase 3B)** | | | |
| 11.1 Memory Validation | High | High | **P2** |
| 11.2 Trajectory Compression | High | High | **P2** |
| 11.3 Experience Extraction | High | Very High | **P3** |
| 11.4 Procedural Memory | Medium | Very High | **P3** |
| 11.5 Heuristic Manager | Medium | High | **P3** |
| 11.6 Active Retrieval | Medium | High | **P3** |
| 11.7 Causal Relations | Medium | Very High | **P4** |
| 11.8 World Model Manager | Medium | Very High | **P4** |
| **Integration & Ecosystem** | | | |
| 12.1 Database Adapters | High | Very High | **P3** |
| 12.2 REST API Generation | High | High | **P3** |
| 12.4 Temporal Versioning | Medium | High | **P3** |
| 12.5 Graph Visualization | Medium | High | **P3** |
| 12.3 Elasticsearch Integration | Medium | High | **P4** |
| 12.6 GraphQL Support | Medium | High | **P4** |
| 12.7 Framework Integrations | Medium | Medium | **P4** |
| 12.8 LLM Ecosystem Integrations | High | High | **P3** |
| 11B.1 Query Language DSL | Medium | Very High | **P4** |
| **Advanced & Enterprise** | | | |
| 13.1 Vector DB Integration | Medium | High | **P4** |
| 13.2 Graph Embeddings | Medium | Very High | **P4** |
| 13.3 ML-Powered Features (incl. LSH, adaptive indexing) | Medium | Very High | **P4** |
| 13.4 Standards Compliance | Low | High | **P5** |
| 13.5 Collaboration | Medium | Very High | **P5** |
| 14.1 Access Control | High | Very High | **P5** |
| 14.2 Distributed Architecture | High | Very High | **P5** |
| 14.3 Security & Compliance | High | High | **P5** |
| 14.4 Cloud-Native Deployment | Medium | High | **P5** |
| 14.5 GPU Acceleration | Low | Very High | **P5** |

---

## Implementation Strategy

**Phase A (P0 — Weeks 1-3)**: Incremental indexing, materialized views, batch mutations. Eliminate the most common performance bottlenecks.

**Phase B (P1 — Weeks 4-7)**: Streaming results, bloom filters, parallel cancellation, lazy hydration. Reduce worst-case latency and memory usage.

**Phase C (P2 — Weeks 8-12)**: Background indexing, LRU caches, SQLite pooling, observability, spell correction, synonym expansion, entity lifecycle, CLI pipe support, memory validation, trajectory compression.

**Phase D (P3 — Months 4-6)**: Experience extraction, procedural memory, heuristics, community detection, database adapters, REST API, temporal versioning, graph visualization, LLM ecosystem integrations.

**Phase E (P4 — Months 7-10)**: Causal relations, world model, Elasticsearch, GraphQL, framework integrations, query DSL, vector DB, graph embeddings, ML features (LSH, adaptive indexing).

**Phase F (P5 — Months 11+)**: Standards compliance, collaboration, access control, distributed architecture, security/compliance, cloud-native, GPU acceleration.

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

*Generated: 2026-02-10*
*Supersedes performance-only version. Consolidates all unimplemented [ROADMAP.md](./ROADMAP.md) features.*
