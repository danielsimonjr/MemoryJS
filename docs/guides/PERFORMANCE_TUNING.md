# MemoryJS Performance Tuning Guide

**Version**: 1.1.1
**Last Updated**: 2026-01-12

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

---

## Performance Overview

### Operation Complexity

| Operation | JSONL | SQLite | Notes |
|-----------|-------|--------|-------|
| Load graph | O(n) | O(n) | Full scan |
| Save graph | O(n) | O(n) | Full write |
| Create entities | O(n) + O(m) | O(k) | n=graph, k=new |
| Search basic | O(n) | O(log n) | FTS5 indexed |
| Search ranked | O(n log n) | O(log n) | TF-IDF |
| Fuzzy search | O(n × m) | O(n × m) | Levenshtein |
| Find duplicates | O(n²/k) | O(n²/k) | Bucketed |

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
  await ctx.searchManager.search('test');
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
// Check current performance
const ctx = new ManagerContext('./memory.jsonl');
const stats = await ctx.analyticsManager.getGraphStats();

if (stats.entityCount > 2000) {
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
await ctx.entityManager.createEntities(entities, {
  onProgress: (completed, total, phase) => {
    const percent = (completed / total * 100).toFixed(1);
    console.log(`${phase}: ${percent}% (${completed}/${total})`);
  }
});
```

---

## Search Optimization

### Filter Early

```typescript
// ❌ BAD: Search all, filter in code
const all = await ctx.searchManager.search('query');
const filtered = all.entities.filter(e => e.importance >= 5);

// ✅ GOOD: Filter in query
const filtered = await ctx.searchManager.search('query', {
  minImportance: 5
});
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
// Always set reasonable limits
const results = await ctx.searchManager.searchRanked('query', {
  limit: 20,      // Don't retrieve more than needed
  minScore: 0.3   // Filter low-relevance results
});
```

### Use Tags for Filtering

```typescript
// Pre-filter with tags (very efficient)
const results = await ctx.searchManager.search('query', {
  tags: ['important', 'active'],
  entityType: 'project'
});
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
// First call: loads from disk
const results1 = await ctx.searchManager.search('query');  // ~100ms

// Subsequent calls: uses cache
const results2 = await ctx.searchManager.search('query2'); // ~10ms

// After write: cache invalidated
await ctx.entityManager.createEntities([...]);             // Invalidates

// Next read: reloads from disk
const results3 = await ctx.searchManager.search('query3'); // ~100ms
```

### Search Result Caching

```typescript
import { searchCaches, getAllCacheStats } from '@danielsimonjr/memoryjs';

// Get cache stats
const stats = getAllCacheStats();
console.log('Cache hit rate:', stats.hits / (stats.hits + stats.misses));

// Clear caches if memory constrained
import { clearAllSearchCaches } from '@danielsimonjr/memoryjs';
clearAllSearchCaches();
```

### Application-Level Caching

```typescript
class CachedSearch {
  private cache = new Map<string, { result: any; timestamp: number }>();
  private ttlMs = 60000; // 1 minute

  async search(ctx: ManagerContext, query: string, options: SearchOptions) {
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result;
    }

    const result = await ctx.searchManager.search(query, options);
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
console.log(`Heap used: ${usage.heapUsed / 1024 / 1024}MB`);
console.log(`Heap total: ${usage.heapTotal / 1024 / 1024}MB`);

// Set up alerts
globalMemoryMonitor.setThresholds({
  heapUsedPercent: 0.8,  // Alert at 80%
  heapTotalMB: 1024      // Alert at 1GB
});

globalMemoryMonitor.onAlert((alert) => {
  console.warn(`Memory alert: ${alert.message}`);
  // Take action: clear caches, reduce batch sizes, etc.
});
```

### Memory-Efficient Patterns

```typescript
// ❌ BAD: Load all at once
const all = await ctx.entityManager.getAllEntities();
processAll(all);  // Holds all in memory

// ✅ GOOD: Stream processing
const graph = await ctx.storage.loadGraph();
for (const entity of graph.entities) {
  await processOne(entity);  // Process one at a time
}

// ✅ GOOD: Paginated access
let offset = 0;
const pageSize = 100;

while (true) {
  const results = await ctx.searchManager.search('', {
    limit: pageSize,
    offset
  });

  if (results.entities.length === 0) break;

  await processPage(results.entities);
  offset += pageSize;
}
```

### Streaming for Large Exports

```typescript
import { StreamingExporter } from '@danielsimonjr/memoryjs';

const exporter = new StreamingExporter(ctx.storage);

await exporter.exportToFile('./large-export.json', {
  chunkSize: 500,
  onProgress: (processed, total) => {
    console.log(`Exported ${processed}/${total}`);
  }
});
```

### Garbage Collection Hints

```typescript
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

const pool = getWorkerPoolManager();

// Configure for heavy parallel workloads
pool.configure({
  minWorkers: 2,
  maxWorkers: Math.min(8, require('os').cpus().length),
  workerType: 'thread'
});

// Monitor pool
const stats = pool.getStats();
console.log(`Active: ${stats.busyWorkers}, Pending: ${stats.pendingTasks}`);
```

### Parallel Search Execution

```typescript
import { parallelMap } from '@danielsimonjr/memoryjs';

// Execute multiple searches in parallel
const queries = ['query1', 'query2', 'query3', 'query4'];

const results = await parallelMap(queries, async (query) => {
  return ctx.searchManager.search(query);
}, { concurrency: 4 });
```

### Parallel Entity Processing

```typescript
import { parallelMap, parallelFilter } from '@danielsimonjr/memoryjs';

// Parallel processing with controlled concurrency
const entities = await ctx.entityManager.getAllEntities();

// Process in parallel
const processed = await parallelMap(entities, async (entity) => {
  return await enrichEntity(entity);
}, { concurrency: 10 });

// Filter in parallel
const important = await parallelFilter(entities, async (entity) => {
  return entity.importance && entity.importance >= 7;
}, { concurrency: 10 });
```

---

## Index Optimization

### TF-IDF Index Management

```typescript
import { TFIDFIndexManager, TFIDFEventSync } from '@danielsimonjr/memoryjs';

// Index is auto-synced via events
// For manual control:
const indexManager = new TFIDFIndexManager(ctx.storage);

// Force rebuild (useful after large imports)
await indexManager.rebuildIndex();

// Get index stats
const stats = indexManager.getStats();
console.log(`Terms indexed: ${stats.termCount}`);
console.log(`Documents indexed: ${stats.documentCount}`);
```

### Semantic Search Indexing

```typescript
// Index all entities for semantic search
await ctx.semanticSearch.indexAll({
  onProgress: (indexed, total) => {
    console.log(`Indexed ${indexed}/${total}`);
  },
  batchSize: 100  // Adjust based on memory/API limits
});

// Incremental indexing for new entities
await ctx.semanticSearch.indexEntity(newEntity);
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

---

## Scale-Specific Tuning

### Small Scale (< 500 entities)

```typescript
// Default configuration works well
const ctx = new ManagerContext('./memory.jsonl');

// No special tuning needed
```

### Medium Scale (500-2,000 entities)

```typescript
// Consider SQLite for search-heavy workloads
const ctx = new ManagerContext('./memory.db');

// Use batch operations
await ctx.entityManager.createEntities(entities);  // Not one-by-one

// Add filters to searches
const results = await ctx.searchManager.search('query', {
  limit: 50,
  tags: ['relevant']
});
```

### Large Scale (2,000-10,000 entities)

```typescript
// Use SQLite
process.env.MEMORY_STORAGE_TYPE = 'sqlite';
const ctx = new ManagerContext('./memory.db');

// Aggressive filtering
const results = await ctx.searchManager.search('query', {
  limit: 20,
  minImportance: 5,
  tags: ['active']
});

// Chunk large operations
const chunks = chunkArray(entities, 500);
for (const chunk of chunks) {
  await ctx.entityManager.createEntities(chunk);
}

// Monitor memory
globalMemoryMonitor.onAlert(handleMemoryPressure);
```

### Very Large Scale (10,000+ entities)

```typescript
// SQLite required
const ctx = new ManagerContext('./memory.db');

// Configure worker pool
getWorkerPoolManager().configure({
  minWorkers: 4,
  maxWorkers: 8
});

// Very aggressive filtering
const results = await ctx.searchManager.searchRanked('query', {
  limit: 10,
  minScore: 0.5,
  minImportance: 7
});

// Use streaming for exports
const exporter = new StreamingExporter(ctx.storage);
await exporter.exportToFile('./export.json', { chunkSize: 500 });

// Paginated access
async function* paginatedEntities(pageSize: number = 100) {
  let offset = 0;
  while (true) {
    const results = await ctx.searchManager.search('', { limit: pageSize, offset });
    if (results.entities.length === 0) break;
    yield* results.entities;
    offset += pageSize;
  }
}

// Consider archiving old data
await ctx.archiveManager.archiveEntities({
  olderThan: '2023-01-01',
  maxImportance: 3
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
    workers: getWorkerPoolManager().getStats()
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
await ctx.searchManager.search('query');
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
await ctx.entityManager.createEntities(allEntities);  // Single write

// Not individual creates
for (const e of entities) {
  await ctx.entityManager.createEntities([e]);  // Multiple writes
}
```

### 2. Large Graph Loads

**Symptom**: Slow first operation, high memory

**Solution**:
```typescript
// Switch to SQLite for large graphs
const ctx = new ManagerContext('./memory.db');

// Use pagination
const results = await ctx.searchManager.search('query', {
  limit: 100,
  offset: 0
});
```

### 3. Unfiltered Searches

**Symptom**: Slow searches, too many results

**Solution**:
```typescript
// Add filters
const results = await ctx.searchManager.search('query', {
  tags: ['relevant'],
  minImportance: 5,
  limit: 20
});
```

### 4. Memory Pressure

**Symptom**: OOM errors, GC pauses

**Solution**:
```typescript
// Clear caches
clearAllSearchCaches();

// Use streaming
const exporter = new StreamingExporter(ctx.storage);

// Process in chunks
for (const chunk of chunks) {
  await process(chunk);
  if (global.gc) global.gc();
}
```

### 5. Slow Fuzzy Search

**Symptom**: Fuzzy search much slower than others

**Solution**:
```typescript
// Reduce dataset with pre-filtering
const results = await ctx.searchManager.fuzzySearch('query', {
  tags: ['searchable'],  // Pre-filter
  threshold: 0.8,        // Higher threshold = fewer comparisons
  limit: 10
});
```

### 6. TF-IDF Index Out of Sync

**Symptom**: Search results don't match recent changes

**Solution**:
```typescript
// Rebuild index
const indexManager = new TFIDFIndexManager(ctx.storage);
await indexManager.rebuildIndex();

// Or ensure event sync is active
const eventSync = new TFIDFEventSync(indexManager, ctx.storage, eventEmitter);
```

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
