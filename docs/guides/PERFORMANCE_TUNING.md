# MemoryJS Performance Tuning Guide

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

**Version**: 4.5.0 (Unreleased changes noted inline)
**Last Updated**: 2026-11-06

> **Performance-relevant additions since v1.1:**
>
> - **N-gram pre-filter** in `FuzzySearch` (v1.6) — Levenshtein candidates
>   now reduced via Jaccard trigram pre-filter before expensive distance
>   calculations.
> - **Memory Engine four-tier dedup** (v1.11) — exact (SHA-256) → prefix
>   → Jaccard → optional semantic. Tier 1 is O(1) via SQLite
>   `idx_entities_content_hash`; configure scan window with
>   `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` (default 200).
> - **Decay scheduler** (`MEMORY_AUTO_DECAY=true`, v1.7) — background
>   periodic decay; configure with `MEMORY_DECAY_INTERVAL_MS` (default
>   3600000).
> - **Entropy filter + consolidation scheduler** (v1.7) — drops low-info
>   memories before they reach the consolidation pipeline.
> - **PRD decay scoring** (v1.12) — parallel formula
>   `DecayEngine.calculatePrdEffectiveImportance` with separate knobs
>   (`MEMORY_PRD_DECAY_RATE`, etc.).
> - **Active retrieval cost-benefit** (3B.5) — `shouldRetrieve()` rejects
>   over-budget queries before any search work happens.
> - **World model snapshot cap** (3B.7) — `maxSnapshotSize` (default 1000)
>   keeps state-diff cost bounded; over-cap prefers high-importance.
> - **Graph-connectivity ranking signal** (`GraphRankPrior`, 2.9.0,
>   `@experimental`) — cached normalized PageRank over `GraphTraversal`,
>   with a degree-only O(V+E) fallback beyond `maxPageRankEntities`
>   (default 50,000) so cost stays bounded on very large graphs;
>   event-invalidated on both backends (SQLite now emits the same
>   `GraphEventEmitter` events as JSONL). Opt-in and zero overhead when
>   unused — `MEMORY_HYBRID_GRAPH_WEIGHT` (hybrid search channel),
>   `MEMORY_RANKED_GRAPH_BOOST` (ranked-search boost),
>   `MEMORY_SALIENCE_CONNECTIVITY_WEIGHT` (salience), and
>   `MEMORY_DECAY_CONNECTIVITY_PROTECTION` (decay) all default to `0`.

> **Optimization pass (4.5.0) — headline measurements:** see
> [Delta Persistence & Write Path](#delta-persistence--write-path-300)
> for detail. Ranked search ~3.3s → ~16ms at 4k entities (~170×); SQLite
> sequential creates 23 → 1,972 ops/s (84×); JSONL sequential creates 6.1×
> faster; warm root import ~220ms → ~150ms (chrono-node now fully lazy).
> All changes preserve identical results/scores — pure speedups, no
> behavior change to search rankings.

Comprehensive guide for optimizing MemoryJS performance at different scales.

---

## Table of Contents

1. [Performance Overview](#performance-overview)
2. [Benchmarks](#benchmarks)
3. [Storage Selection](#storage-selection)
4. [Batch Operations](#batch-operations)
5. [Search Optimization](#search-optimization)
6. [Caching Strategies](#caching-strategies)
7. [Memory Management](#memory-management)
8. [Parallel Processing](#parallel-processing)
9. [Index Optimization](#index-optimization)
10. [Scale-Specific Tuning](#scale-specific-tuning)
11. [Monitoring & Profiling](#monitoring--profiling)
12. [Common Bottlenecks](#common-bottlenecks)
13. [Delta Persistence & Write Path (3.0.0)](#delta-persistence--write-path-300)

---

## Performance Overview

### Operation Complexity

| Operation | JSONL | SQLite | Notes |
|-----------|-------|--------|-------|
| Load graph | O(n) | O(n) | Full scan (cached after first load) |
| Save graph (import/restore) | O(n) | O(n) | Full write — only for genuinely full-graph writes |
| Create/update/delete entities (batch) | O(k) | O(k) | k=changed, since delta persistence (3.0.0, S2) — was O(n) full-graph rewrite on both backends |
| Search basic | O(n) | O(log n) | FTS5 indexed |
| Search ranked | O(n · terms) | O(log n) | TF-IDF; was O(n² · terms) before the IDF hoist (3.0.0, S1) |
| Fuzzy search | O(n × m) | O(n × m) | Levenshtein |
| Find duplicates | O(n²/k) | O(n²/k) | Bucketed |

**Delta persistence (3.0.0, S2):** `createEntities`/`updateEntity`/
`batchUpdate`/`deleteEntities` and their relation equivalents now persist via
targeted storage primitives (`appendEntity(ies)`, `updateEntity`, targeted
deletes) instead of deep-copying and rewriting the entire graph. `saveGraph`
(the O(n) full-rewrite path) is now reserved for genuinely full-graph writes
— import, restore, and JSONL segment-mode batch saves (a documented
limitation: segment storage still does one full `saveAll` per batch, single-file
JSONL is O(changed)). See
[Delta Persistence & Write Path](#delta-persistence--write-path-300)
for measured throughput.

### Performance Targets

| Scale | Entities | Expected Latency | Recommended Backend |
|-------|----------|------------------|---------------------|
| Small | < 500 | < 50ms | JSONL |
| Medium | 500-2,000 | < 200ms | JSONL or SQLite |
| Large | 2,000-10,000 | < 500ms | SQLite |
| Very Large | 10,000+ | < 1s | SQLite + tuning |

---

## Benchmarks

### Entity Operations

```
Benchmark: Create Entities (single batch)
┌─────────────────┬───────────┬───────────┬───────────┐
│ Entity Count    │ JSONL     │ SQLite    │ Ratio     │
├─────────────────┼───────────┼───────────┼───────────┤
│ 100             │ 15ms      │ 25ms      │ 0.6x      │
│ 500             │ 45ms      │ 55ms      │ 0.8x      │
│ 1,000           │ 95ms      │ 85ms      │ 1.1x      │
│ 5,000           │ 450ms     │ 180ms     │ 2.5x      │
│ 10,000          │ 950ms     │ 320ms     │ 3.0x      │
└─────────────────┴───────────┴───────────┴───────────┘
```

### Search Operations

```
Benchmark: Basic Search (1,000 entities)
┌─────────────────┬───────────┬───────────┬───────────┐
│ Query Type      │ JSONL     │ SQLite    │ Ratio     │
├─────────────────┼───────────┼───────────┼───────────┤
│ Basic search    │ 25ms      │ 8ms       │ 3.1x      │
│ Ranked search   │ 85ms      │ 12ms      │ 7.0x      │
│ Boolean search  │ 35ms      │ 15ms      │ 2.3x      │
│ Fuzzy search    │ 120ms     │ 110ms     │ 1.1x      │
└─────────────────┴───────────┴───────────┴───────────┘

Benchmark: Search at Scale (SQLite)
┌─────────────────┬───────────┬───────────┬───────────┐
│ Entity Count    │ Basic     │ Ranked    │ Boolean   │
├─────────────────┼───────────┼───────────┼───────────┤
│ 1,000           │ 8ms       │ 12ms      │ 15ms      │
│ 5,000           │ 15ms      │ 28ms      │ 32ms      │
│ 10,000          │ 25ms      │ 45ms      │ 55ms      │
│ 50,000          │ 85ms      │ 150ms     │ 180ms     │
└─────────────────┴───────────┴───────────┴───────────┘
```

### Running Your Own Benchmarks

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { performance } from 'perf_hooks';

async function benchmark(name: string, fn: () => Promise<void>, iterations: number = 10) {
  const times: number[] = [];

  // Warmup
  await fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`${name}: avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(2)}ms`);
}

// Usage
const ctx = new ManagerContext('./benchmark.db');

await benchmark('Create 100 entities', async () => {
  const entities = Array.from({ length: 100 }, (_, i) => ({
    name: `entity_${Date.now()}_${i}`,
    entityType: 'test',
    observations: ['test observation']
  }));
  await ctx.entityManager.createEntities(entities);
});

await benchmark('Search 1000 entities', async () => {
  await ctx.searchManager.searchNodes('test');
});
```

---

## Storage Selection

### When to Use JSONL

✅ **Use JSONL when**:
- Entity count < 2,000
- Human-readable data is important
- Debugging/manual editing needed
- Simple deployment (no dependencies)
- Development/testing environments

❌ **Avoid JSONL when**:
- Entity count > 5,000
- High-frequency writes
- Concurrent access needed
- Complex search queries common

### When to Use SQLite

✅ **Use SQLite when**:
- Entity count > 2,000
- Search performance critical
- Complex queries (boolean, ranked)
- Concurrent read access needed
- Production environments

❌ **Avoid SQLite when**:
- Need human-readable format
- Minimal dependencies required
- Very simple use case

### Switching Storage

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Check current performance
const stats = await ctx.analyticsManager.getGraphStats();

if (stats.totalEntities > 2000) {
  console.log('Consider migrating to SQLite for better performance');
}
```

---

## Batch Operations

### Batch vs Individual Operations

```typescript
// ❌ BAD: Multiple I/O cycles
for (const entity of entities) {
  await ctx.entityManager.createEntities([entity]);  // N writes
}

// ✅ GOOD: Single I/O cycle
await ctx.entityManager.createEntities(entities);  // 1 write
```

**Performance Impact**:
- 1,000 individual creates: ~10,000ms
- 1,000 batch creates: ~100ms
- **Improvement: 100x faster**

### Optimal Batch Sizes

| Operation | Recommended Batch Size | Max Batch Size |
|-----------|------------------------|----------------|
| Create entities | 500-1,000 | 5,000 |
| Create relations | 1,000-2,000 | 10,000 |
| Add observations | 100-500 | 1,000 |
| Delete entities | 500-1,000 | 5,000 |

### Chunking Large Batches

```typescript
import { Entity } from '@danielsimonjr/memoryjs';
import { chunkArray } from '@danielsimonjr/memoryjs';

async function createManyEntities(entities: Entity[], chunkSize: number = 1000) {
  const chunks = chunkArray(entities, chunkSize);

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}`);
    await ctx.entityManager.createEntities(chunks[i]);
  }
}
```

### Progress Tracking

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

declare const entities: Array<{ name: string; entityType: string; observations: string[] }>;

// Batch creation: one write for the whole array
await ctx.entityManager.createEntities(entities);
```

---

## Search Optimization

### Filter Early

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// ❌ BAD: Search all, filter in code
const all = await ctx.searchManager.searchNodes('query');
const filtered = all.entities.filter(e => (e.importance ?? 0) >= 5);

// ✅ GOOD: Filter in query (minImportance is the third positional argument)
const narrowed = await ctx.searchManager.searchNodes('query', undefined, 5);
```

### Use Appropriate Search Type

| Need | Use | Why |
|------|-----|-----|
| Exact match | `search()` | Fastest |
| Relevance | `searchRanked()` | TF-IDF scoring |
| Typo tolerance | `fuzzySearch()` | Levenshtein |
| Complex logic | `booleanSearch()` | AST evaluation |
| Semantic | `hybridSearch()` | Combined signals |

### Limit Results

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Ranked search: positional (query, tags?, minImportance?, maxImportance?, limit?)
const results = await ctx.searchManager.searchNodesRanked('query', undefined, undefined, undefined, 20);
const relevant = results.filter((r) => r.score >= 0.3);  // Filter low-relevance results
```

### Use Tags for Filtering

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Pre-filter with tags (very efficient). Entity type filtering is done on the result.
const results = await ctx.searchManager.searchNodes('query', ['important', 'active']);
const projects = results.entities.filter((e) => e.entityType === 'project');
```

### Boolean Search Optimization

```typescript
// ❌ BAD: Overly complex query
const bad = await ctx.searchManager.booleanSearch(
  '(a OR b OR c OR d OR e) AND (f OR g OR h) AND NOT (i OR j)'
);

// ✅ GOOD: Simpler query with pre-filtering
const good = await ctx.searchManager.booleanSearch('a AND f', {
  tags: ['relevant']  // Pre-filter
});
```

---

## Caching Strategies

### Graph Cache Behavior

The graph cache is automatically managed:

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// First call: loads from disk
const results1 = await ctx.searchManager.searchNodes('query');  // ~100ms

// Subsequent calls: uses cache
const results2 = await ctx.searchManager.searchNodes('query2'); // ~10ms

// After write: cache invalidated
await ctx.entityManager.createEntities([
  { name: 'Alice', entityType: 'person', observations: ['Likes tea'] },
]); // Invalidates

// Next read: reloads from disk
const results3 = await ctx.searchManager.searchNodes('query3'); // ~100ms
```

### Search Result Caching

```typescript
import { searchCaches, getAllCacheStats } from '@danielsimonjr/memoryjs';

// Get cache stats
const stats = getAllCacheStats();
const cacheStats = getAllCacheStats();
console.log('Search cache stats:', cacheStats);

// Clear caches if memory constrained
import { clearAllSearchCaches } from '@danielsimonjr/memoryjs';
clearAllSearchCaches();
```

### Application-Level Caching

```typescript
import { SearchOptions } from '@danielsimonjr/memoryjs';
import { ManagerContext } from '@danielsimonjr/memoryjs';
class CachedSearch {
  private cache = new Map<string, { result: any; timestamp: number }>();
  private ttlMs = 60000; // 1 minute

  async search(ctx: ManagerContext, query: string, options: SearchOptions) {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result;
    }

    const result = await ctx.searchManager.searchNodes(query, options);
    this.cache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  invalidate() {
    this.cache.clear();
  }
}
```

---

## Memory Management

### Monitoring Memory Usage

```typescript
import { globalMemoryMonitor, MemoryMonitor } from '@danielsimonjr/memoryjs';

// Get current usage
const usage = globalMemoryMonitor.getUsage();
console.log(`Total: ${usage.totalFormatted}`);

// Set up alerts
globalMemoryMonitor.setThresholds({
  warning: 512 * 1024 * 1024,   // 512 MB
  critical: 1024 * 1024 * 1024, // 1 GB
});

globalMemoryMonitor.checkThresholds().forEach((alert) => {
  console.warn(`Memory alert: ${alert.message}`);
  // Take action: clear caches, reduce batch sizes, etc.
});
```

### Memory-Efficient Patterns

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

declare function processAll(entities: unknown[]): void;
declare function processOne(entity: unknown): Promise<void>;
declare function processPage(entities: unknown[]): Promise<void>;

// ❌ BAD: Load all at once
const all = await ctx.storage.loadGraph();
processAll([...all.entities]);  // Holds all in memory

// ✅ GOOD: Stream processing
const graph = await ctx.storage.loadGraph();
for (const entity of graph.entities) {
  await processOne(entity);  // Process one at a time
}

// ✅ GOOD: Paginated access (slice the results)
const pageSize = 100;
let offset = 0;
const ranked = await ctx.searchManager.searchNodes('');
while (offset < ranked.entities.length) {
  const page = ranked.entities.slice(offset, offset + pageSize);
  await processPage(page);
  offset += pageSize;
}
```

### Streaming for Large Exports

```typescript
import { ManagerContext, StreamingExporter } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const graph = await ctx.storage.loadGraph();

// Stream the export to a file (no progress callback is exposed by streamJSONL)
const exporter = new StreamingExporter('./large-export.jsonl');
await exporter.streamJSONL(graph);
```

### Garbage Collection Hints

```typescript
declare const data: string[];
declare function getChunks<T>(items: T[], size: number): T[][];
declare function processChunk(chunk: string[]): Promise<void>;
async function processLargeDataset() {
  // Process in chunks to allow GC
  const chunks = getChunks(data, 1000);

  for (const chunk of chunks) {
    await processChunk(chunk);

    // Allow GC between chunks
    if (global.gc) {
      global.gc();
    }
  }
}
```

---

## Parallel Processing

### Worker Pool Configuration

```typescript
import { getWorkerPoolManager } from '@danielsimonjr/memoryjs';

// Create a dedicated pool for heavy workloads
const pools = getWorkerPoolManager();
pools.createPool('heavy', {
  maxWorkers: Math.min(8, 4),
  workerType: 'thread',
});

// Monitor the pool
const stats = pools.getPoolStats('heavy');
console.log(`Pool stats: ${JSON.stringify(stats)}`);
```

### Parallel Search Execution

```typescript
import { ManagerContext, parallelMap } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Execute multiple searches in parallel (third argument is the chunk size)
const queries = ['query1', 'query2', 'query3', 'query4'];

const results = await parallelMap(queries, async (query) => {
  return ctx.searchManager.searchNodes(query);
}, 4);
```

### Parallel Entity Processing

```typescript
import { ManagerContext, parallelMap, parallelFilter } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
declare function enrichEntity(entity: import('@danielsimonjr/memoryjs').Entity): Promise<unknown>;

// Parallel processing with controlled chunk size
const entities = await ctx.entityManager.listEntities();

// Process in parallel
const processed = await parallelMap(entities, async (entity) => {
  return await enrichEntity(entity);
}, 10);

// Filter in parallel
const important = await parallelFilter(entities, (entity) => {
  return (entity.importance ?? 0) >= 7;
}, 10);
```

---

## Index Optimization

### TF-IDF Index Management

```typescript
import { ManagerContext, TFIDFIndexManager } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Index is auto-synced via events. For manual control, build from a graph:
const indexManager = new TFIDFIndexManager('./data/index');

// Force rebuild (useful after large imports)
const graph = await ctx.storage.loadGraph();
await indexManager.buildIndex(graph);
```

### Semantic Search Indexing

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const graph = await ctx.storage.loadGraph();

// Index all entities for semantic search (returns when complete)
await ctx.semanticSearch?.indexAll(graph);

// Incremental indexing for a new entity
declare const newEntity: import('@danielsimonjr/memoryjs').Entity;
await ctx.semanticSearch?.indexEntity(newEntity);
```

### SQLite Index Optimization

SQLite indexes are created automatically:

```sql
-- Automatic indexes
CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_relations_from ON relations(from_entity);
CREATE INDEX idx_relations_to ON relations(to_entity);

-- FTS5 for full-text search
CREATE VIRTUAL TABLE entities_fts USING fts5(name, entity_type, observations);
```

**Write-side pragmas (3.0.0, S3)** are also set automatically at
`SQLiteStorage` init — `journal_mode=WAL`, `synchronous=NORMAL` (override via
`MEMORY_SQLITE_SYNCHRONOUS=FULL|OFF`), `busy_timeout=5000`,
`cache_size=-64000` (64MB), `temp_store=MEMORY`. No configuration needed for
the common case; see
[Delta Persistence & Write Path](#delta-persistence--write-path-300)
for the measured throughput impact and [CONFIGURATION.md](./CONFIGURATION.md)
for the durability tradeoff.

---

## Scale-Specific Tuning

### Small Scale (< 500 entities)

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
// Default configuration works well
const ctx = new ManagerContext('./memory.jsonl');

// No special tuning needed
```

### Medium Scale (500-2,000 entities)

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Consider SQLite for search-heavy workloads
const ctx = new ManagerContext('./memory.db');

declare const entities: Array<{ name: string; entityType: string; observations: string[] }>;

// Use batch operations
await ctx.entityManager.createEntities(entities);  // Not one-by-one

// Add filters to searches (tags and minImportance are positional arguments)
const results = await ctx.searchManager.searchNodes('query', ['relevant']);
const top = results.entities.slice(0, 50);
```

### Large Scale (2,000-10,000 entities)

```typescript
import { ManagerContext, chunkArray, globalMemoryMonitor } from '@danielsimonjr/memoryjs';
declare function handleMemoryPressure(alert: unknown): void;

// Use SQLite
process.env.MEMORY_STORAGE_TYPE = 'sqlite';
const ctx = new ManagerContext('./memory.db');
declare const entities: Array<{ name: string; entityType: string; observations: string[] }>;

// Aggressive filtering
const results = await ctx.searchManager.searchNodes('query', ['active'], 5);
const top = results.entities.slice(0, 20);

// Chunk large operations
const chunks = chunkArray(entities, 500);
for (const chunk of chunks) {
  await ctx.entityManager.createEntities(chunk);
}

// Monitor memory
globalMemoryMonitor.checkThresholds().forEach(handleMemoryPressure);
```

### Very Large Scale (10,000+ entities)

```typescript
import { ManagerContext, StreamingExporter, getWorkerPoolManager } from '@danielsimonjr/memoryjs';

// SQLite required
const ctx = new ManagerContext('./memory.db');

// Configure a dedicated worker pool
getWorkerPoolManager().createPool('exports', { maxWorkers: 8 });

// Very aggressive filtering
const results = await ctx.searchManager.searchNodesRanked('query', undefined, 7, undefined, 10);

// Use streaming for exports
const graph = await ctx.storage.loadGraph();
const exporter = new StreamingExporter('./export.jsonl');
await exporter.streamJSONL(graph);

// Consider archiving old data
await ctx.archiveManager.archiveEntities({
  olderThan: '2023-01-01',
  importanceLessThan: 3
});
```

---

## Monitoring & Profiling

### Built-in Metrics

```typescript
import { globalMemoryMonitor, getAllCacheStats, getWorkerPoolManager } from '@danielsimonjr/memoryjs';

function collectMetrics() {
  return {
    memory: globalMemoryMonitor.getUsage(),
    cache: getAllCacheStats(),
    workers: getWorkerPoolManager().getPoolIds(),
  };
}

// Log periodically
setInterval(() => {
  const metrics = collectMetrics();
  console.log(JSON.stringify(metrics));
}, 60000);
```

### Custom Timing

```typescript
class PerformanceTracker {
  private timings: Map<string, number[]> = new Map();

  start(operation: string): () => void {
    const startTime = performance.now();
    return () => {
      const duration = performance.now() - startTime;
      const existing = this.timings.get(operation) || [];
      existing.push(duration);
      this.timings.set(operation, existing);
    };
  }

  getStats(operation: string) {
    const times = this.timings.get(operation) || [];
    if (times.length === 0) return null;

    return {
      count: times.length,
      avg: times.reduce((a, b) => a + b, 0) / times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      p95: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)]
    };
  }
}

// Usage
const tracker = new PerformanceTracker();

const end = tracker.start('search');
await ctx.searchManager.searchNodes('query');
end();

console.log(tracker.getStats('search'));
```

### Profiling Tips

```bash
# Node.js profiling
node --prof app.js
node --prof-process isolate-*.log > profile.txt

# Memory profiling
node --expose-gc --inspect app.js
# Then use Chrome DevTools

# Heap snapshots
node --inspect app.js
# Take heap snapshots in DevTools
```

---

## Common Bottlenecks

### 1. Excessive I/O

**Symptom**: Slow writes, high disk activity

**Solution**:
```typescript
// Use batch operations
await ctx.entityManager.createEntities(entities);  // Single write

// Not individual creates
for (const e of entities) {
  await ctx.entityManager.createEntities([e]);  // Multiple writes
}
```

### 2. Large Graph Loads

**Symptom**: Slow first operation, high memory

**Solution**:
```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Switch to SQLite for large graphs
const ctx = new ManagerContext('./memory.db');

// Use pagination: slice the results from the search
const results = await ctx.searchManager.searchNodes('query');
const firstPage = results.entities.slice(0, 100);
```

### 3. Unfiltered Searches

**Symptom**: Slow searches, too many results

**Solution**:
```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Add filters: tags and minImportance are positional arguments
const results = await ctx.searchManager.searchNodes('query', ['relevant'], 5);
const top = results.entities.slice(0, 20);
```

### 4. Memory Pressure

**Symptom**: OOM errors, GC pauses

**Solution**:
```typescript
import { ManagerContext, StreamingExporter, clearAllSearchCaches } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
declare const chunks: unknown[][];
declare function process(chunk: unknown[]): Promise<void>;

// Clear caches
clearAllSearchCaches();

// Use streaming
const exporter = new StreamingExporter('./export.jsonl');
const graph = await ctx.storage.loadGraph();
await exporter.streamJSONL(graph);

// Process in chunks
for (const chunk of chunks) {
  await process(chunk);
}
```

### 5. Slow Fuzzy Search

**Symptom**: Fuzzy search much slower than others

**Solution**:
```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Reduce dataset with pre-filtering (threshold is the second argument)
const results = await ctx.searchManager.fuzzySearch('query', 0.8, ['searchable']);
const top = results.entities.slice(0, 10);
```

### 6. TF-IDF Index Out of Sync

**Symptom**: Search results don't match recent changes

**Solution**:
```typescript
import { ManagerContext, TFIDFIndexManager, TFIDFEventSync } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
declare const eventEmitter: import('@danielsimonjr/memoryjs').GraphEventEmitter;

// Rebuild index
const indexManager = new TFIDFIndexManager('./data/index');
await indexManager.buildIndex(await ctx.storage.loadGraph());

// Or ensure event sync is active
const eventSync = new TFIDFEventSync(indexManager, eventEmitter, ctx.storage);
```

---

## Delta Persistence & Write Path (3.0.0)

Source: `docs/development/OPTIMIZATION_OPPORTUNITIES.md` (S1–S10 status
block) — every number below was measured on this branch, same day.

### What changed

- **S2 (delta persistence, the keystone change):** manager mutations
  (`createEntities`, `updateEntity`, `batchUpdate`, `deleteEntities`, and
  the `RelationManager` equivalents) no longer deep-copy and rewrite the
  whole graph for a single-entity write. They persist via targeted storage
  primitives instead (`storage.appendEntity(ies)`, `updateEntity`, targeted
  deletes) — O(changed) instead of O(graph). This collapses the blast
  radius of several other issues: per-write cache invalidation (S6),
  `GraphRankPrior` recompute cost (S4), and TF-IDF staleness (S5) all
  shrink because the write path itself got cheaper and more granular.
- **S1 (ranked-search IDF hoist):** `RankedSearch`'s default (unindexed)
  path used to recompute each query term's IDF **inside** the per-document
  loop — an O(N² × terms) rescan of the whole corpus per query. IDF is a
  per-term corpus constant, so it's now hoisted into a `Map<term, idf>`
  computed once before the document loop. Scores are bit-identical; only
  the complexity changed. The O(N) cache-validation key
  (`entities.map(e => e.name).join('\0')`) was also replaced with a
  monotonic generation counter bumped from storage events — this
  incidentally fixes a staleness bug where observation-only updates didn't
  invalidate the ranked-search cache.
- **S3 (SQLite write-side tuning):** `synchronous=NORMAL` (was the
  WAL-incompatible default `FULL`, which fsyncs every commit),
  `busy_timeout=5000`, `cache_size=-64000` (64MB), `temp_store=MEMORY`, plus
  prepared-statement caching and O(1) name-index lookups on append (were
  O(N) `findIndex` scans). See
  [CONFIGURATION.md](./CONFIGURATION.md#storage-configuration) for the
  `MEMORY_SQLITE_SYNCHRONOUS` durability tradeoff.
- **S4/S5/S6:** `GraphRankPrior` invalidation granularity, `TFIDFEventSync`
  batch-flush correctness (was blind to batch mutations, silently omitting
  results), and generation-counter search-cache invalidation (replacing a
  blanket `clearAllSearchCaches()` on every write).
- **S7–S10 (load time):** `"sideEffects": false` + 9 subpath exports
  (`./core`, `./search`, `./agent`, `./features`, `./utils`, `./types`,
  `./adapters`, `./security`, `./sqlite`) with ESM chunk splitting;
  chrono-node (the heaviest external dependency, ~1.6s cold) is now lazily
  `import()`-ed instead of loaded eagerly by the root import; `StorageFactory`
  no longer statically imports `SQLiteStorage` (moved to the `./sqlite`
  subpath so JSONL-only consumers never load the native addon); the types
  layer is now a dependency leaf (type-only import cycles 39 → 4,
  ESLint-enforced going forward).

### Measured numbers

| Metric | Before | After | Ratio |
|---|---|---|---|
| Ranked search (unindexed path, 4k entities) | ~3.3s | ~16ms | ~170× |
| SQLite sequential entity creates | 23 ops/s | 1,972 ops/s | 84× |
| JSONL sequential entity creates | — | — | 6.1× faster |
| Warm root import (`@danielsimonjr/memoryjs`) | ~220ms | ~150ms | — |
| `@danielsimonjr/memoryjs/search` subpath (cold) | — | ~40ms | — |
| Type-only circular dependencies | 39 | 4 (0 runtime cost either way) | — |

All of these are pure speedups — result sets, scores, and rankings are
unchanged (asserted by regression tests comparing before/after output).

### What this means for your tuning

- **Batch-size guidance in this guide is now more conservative than
  necessary for JSONL single-file mode** — a batch create is O(changed)
  regardless of existing graph size, so the "Optimal Batch Sizes" table
  above is a safety/observability margin (progress reporting, avoiding one
  giant fsync) rather than a hard complexity cliff. JSONL **segment mode**
  (`MEMORY_STORAGE_SEGMENT_COUNT >= 2`) still does one full `saveAll` per
  batch — a documented limitation — so batch-size discipline still matters
  there.
- **Prefer subpath imports in bundled consumers.** If you only use core
  CRUD + graph algorithms, `import { EntityManager } from
  '@danielsimonjr/memoryjs/core'` avoids pulling in chrono-node, the
  embedding stack, and (via `/core` vs `/sqlite`) the `better-sqlite3`
  native addon. The root `@danielsimonjr/memoryjs` import still works
  unchanged — subpaths are opt-in tree-shaking, not a breaking split.
- **If you tuned around `MEMORY_HYBRID_GRAPH_WEIGHT`/`MEMORY_RANKED_GRAPH_BOOST`
  write-amplification concerns** (frequent full PageRank recompute on every
  write), re-measure: S2's per-item events mean `GraphRankPrior` invalidation
  is now scoped to what actually changed rather than firing off the old
  blanket `graph:saved`-per-write pattern for ordinary CRUD.
- **SQLite operators who need every commit durable** (e.g. financial/audit
  workloads where losing the last few WAL-uncommitted writes on power loss
  is unacceptable) should set `MEMORY_SQLITE_SYNCHRONOUS=FULL` explicitly —
  the new `NORMAL` default trades that guarantee for throughput. See
  [CONFIGURATION.md](./CONFIGURATION.md) for the full tradeoff writeup.

---

**Document Version**: 1.0
**Last Updated**: 2026-11-06

## Tuning Knobs Reference

Each knob below is read once, when the component it controls is first built,
unless noted. Restart the process to change a value. Defaults are the values in
code. Full names and parsing rules are in [CONFIGURATION.md](./CONFIGURATION.md).

| Knob | Default | Effect | When to change |
|------|---------|--------|----------------|
| `MEMORY_SQLITE_READ_POOL_SIZE` | `4` | Read connections for `SQLiteStorage` search. `0` or `1` uses the writer connection | Raise for many concurrent readers; set `1` to minimise open handles |
| `MEMORY_SQLITE_SYNCHRONOUS` | `NORMAL` | WAL `synchronous` pragma. `NORMAL` is safe across app crashes but may lose the last commit on power loss | `FULL` when durability matters more than commit throughput |
| `MEMORY_INDEX_COALESCE_MS` | `50` | Merges repeated writes to one entity within the window into one TF-IDF index update | `0` for immediate index updates; raise for bursty bulk writes |
| `MEMORY_USE_MMAP` | off | Range-reads a large JSONL file instead of loading it whole (`GraphStorage.loadGraph`) | Multi-GB JSONL files where peak memory matters |
| `MEMORY_MMAP_THRESHOLD_BYTES` | `104857600` (100 MB) | File size above which `MEMORY_USE_MMAP` applies | Lower to use range reads for smaller files |
| `MEMORY_OBSERVATIONS_COLUMNAR` | off | Shadow column store for observations (`<basename>-observations.jsonl`) | Observation-heavy reads; inline observations stay the source of truth |
| `MEMORY_CACHE_COMPRESS` | off | Compressed hot/cold entity cache (`ctx.compressedEntityCache`, `@internal`) | Memory-constrained hosts with large caches |
| `MEMORY_CACHE_BUDGET_ENTRIES` | unset | Shared entry budget across caches registered with `CachePressureCoordinator` | Several large caches competing in one process |
| `MEMORY_TIERED_INDEX` | off | Hot/warm/cold tiered index (`ctx.tieredPostingsIndex`, `@internal`) | Experimental; no production consumer wired yet |
| `MEMORY_STORAGE_SEGMENT_COUNT` | unset (single file) | Splits JSONL into `N` hash-routed segments (2–1024) with a manifest for atomic multi-file commits | Large graphs where whole-file rewrites dominate |

Notes:

- `MEMORY_SQLITE_SYNCHRONOUS` and the write-side pragmas are set when the SQLite
  connection opens.
- `MEMORY_STORAGE_SEGMENT_COUNT >= 2` disables `MEMORY_USE_MMAP` (segments are
  already chunked). Procedural-graph JSONL backing refuses to open in segment mode.
- Measure before tuning. Use `ctx.diagnostics()` and `ctx.indexHealth()` to see
  cache sizes and index state.
