# Future Features: Performance & Scale

Focused proposals for optimizing MemoryJS at the 10K-100K entity scale, with search latency as the primary target.

> **Context**: These features complement the existing [ROADMAP.md](./ROADMAP.md) phases. They are scoped to single-machine optimizations — no distributed architecture required.

---

## 1. Search Latency Optimizations (Highest Priority)

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

---

## 6. Observability & Diagnostics

### 6.1 Search Explain Mode

Show exactly how search results were scored and ranked.

**Problem**: When search results are unexpected, there's no way to understand why entities were ranked in a particular order.

**Proposal**:
- `searchManager.search(query, { explain: true })` returns `ExplainedResult` with per-signal breakdowns
- Show: TF-IDF score, BM25 score, semantic similarity, symbolic match, final hybrid score
- Show which signals dominated, which entities were filtered out and why
- Output as structured JSON or formatted markdown

### 6.2 Performance Dashboard

Real-time visibility into search and storage performance.

**Problem**: No way to identify slow queries, cache misses, or index staleness without adding custom logging.

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

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
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
| 6.1 Search Explain Mode | Medium | Low | **P2** |
| 1.5 Tiered Index Architecture | Medium | High | **P3** |
| 2.1 WAL for JSONL Backend | Medium | High | **P3** |
| 3.1 Observation Deduplication | Low | Medium | **P3** |
| 3.4 Compressed In-Memory Storage | Medium | High | **P3** |
| 4.1 Query Plan Caching w/ Stats | Low | Medium | **P3** |
| 4.3 Columnar Observation Storage | Medium | High | **P3** |
| 5.2 SQLite Partial Indexes | Low | Medium | **P3** |
| 5.3 JSONL Segment Files | Medium | High | **P3** |
| 6.2 Performance Dashboard | Low | Medium | **P3** |
| 6.3 Index Health Monitor | Low | Low | **P3** |

---

## Implementation Strategy

**Phase A (P0 — Weeks 1-3)**: Incremental indexing, materialized views, batch mutations. These three changes eliminate the most common performance bottlenecks with moderate effort.

**Phase B (P1 — Weeks 4-7)**: Streaming results, bloom filters, parallel cancellation, lazy hydration. These reduce worst-case latency and memory usage.

**Phase C (P2 — Weeks 8-10)**: Background indexing, LRU caches, SQLite pooling, explain mode. Polish and observability.

**Phase D (P3 — As needed)**: WAL, compression, columnar storage, segmented JSONL. Only pursue these if Phases A-C don't meet performance targets.

---

## Benchmarking Plan

Each feature should be validated with:
- **Baseline**: Run `tests/performance/` suite before implementation
- **Target**: Define specific latency/throughput targets per feature (documented in PR)
- **Measurement**: Before/after comparison at 10K, 50K, and 100K entity scales
- **Regression**: Add benchmark to CI to prevent future regressions

Environment variable to enable benchmarks: `SKIP_BENCHMARKS=false`

---

*Generated: 2026-02-10*
*Complements: [ROADMAP.md](./ROADMAP.md)*
