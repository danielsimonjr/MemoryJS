# Test Coverage Analysis

**Generated**: 2026-01-14

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 93 |
| Total Test Files | 109 |
| Total Tests | 3,604 |
| Test Categories | 5 |

---

## Test Organization

### Test Pyramid

```
            /\
           /  \
          / E2E \ (Edge cases: 1 file)
         /______\
        /        \
       / Integr.  \ (Integration: 8 files)
      /____________\
     /              \
    /   Unit Tests   \ (Unit: 68 files)
   /                  \
  /____________________\
 /                      \
/   Performance Tests    \ (Performance: 12 files)
```

---

## Test Categories

### Unit Tests (68 files)

#### Core (16 files)
| Test File | Tests |
|-----------|-------|
| `BatchTransaction.test.ts` | Batch transaction operations |
| `ConcurrencyControl.test.ts` | Concurrent operation handling |
| `EntityManager.test.ts` | Entity CRUD operations |
| `GraphEventEmitter.test.ts` | Event emission system |
| `GraphEvents.test.ts` | Event handling |
| `GraphStorage.test.ts` | JSONL storage operations |
| `GraphTraversal.test.ts` | Graph algorithms |
| `HierarchyManager.test.ts` | Parent-child relationships |
| `ManagerContext.test.ts` | Context initialization |
| `ObservationManager.test.ts` | Observation operations |
| `RelationManager.test.ts` | Relation operations |
| `SQLiteStorage.test.ts` | SQLite storage operations |
| `StorageFactory.test.ts` | Storage backend factory |
| `TransactionBatching.test.ts` | Transaction batching |
| `TransactionManager.test.ts` | Transaction management |

#### Features (7 files)
| Test File | Tests |
|-----------|-------|
| `AnalyticsManager.test.ts` | Graph statistics |
| `ArchiveManager.test.ts` | Entity archival |
| `CompressionManager.test.ts` | Duplicate detection |
| `IOManager.test.ts` | Import/export |
| `ObservationNormalizer.test.ts` | Observation normalization |
| `StreamingExporter.test.ts` | Streaming exports |
| `TagManager.test.ts` | Tag aliases |

#### Search (27 files)
| Test File | Tests |
|-----------|-------|
| `BasicSearch.test.ts` | Text matching |
| `BM25Search.test.ts` | BM25 ranking |
| `BooleanSearch.test.ts` | Boolean queries |
| `EarlyTerminationManager.test.ts` | Early termination |
| `EmbeddingCache.test.ts` | Embedding caching |
| `EmbeddingService.test.ts` | Embedding providers |
| `FuzzySearch.test.ts` | Fuzzy matching |
| `HybridScorer.test.ts` | Hybrid scoring |
| `HybridSearchManager.test.ts` | Hybrid search |
| `IncrementalIndexer.test.ts` | Incremental indexing |
| `IncrementalTFIDF.test.ts` | TF-IDF updates |
| `OptimizedInvertedIndex.test.ts` | Inverted index |
| `ParallelSearchExecutor.test.ts` | Parallel execution |
| `QuantizedVectorStore.test.ts` | Vector quantization |
| `QueryAnalyzer.test.ts` | Query analysis |
| `QueryCostEstimator.test.ts` | Query cost estimation |
| `QueryPlanCache.test.ts` | Query plan caching |
| `RankedSearch.test.ts` | TF-IDF ranking |
| `ReflectionManager.test.ts` | Result refinement |
| `SavedSearchManager.test.ts` | Saved searches |
| `SearchFilterChain.test.ts` | Filter chain |
| `SearchManager.test.ts` | Search orchestration |
| `SearchSuggestions.test.ts` | Suggestions |
| `SemanticSearch.test.ts` | Vector search |
| `TFIDFEventSync.test.ts` | TF-IDF sync |
| `TFIDFIndexManager.test.ts` | TF-IDF index |
| `VectorStore.test.ts` | Vector storage |

#### Utils (16 files)
| Test File | Tests |
|-----------|-------|
| `BatchProcessor.test.ts` | Batch processing |
| `compressedCache.test.ts` | Compressed caching |
| `compressionUtil.test.ts` | Compression utilities |
| `entityUtils.test.ts` | Entity helpers |
| `errors.test.ts` | Error classes |
| `formatters.test.ts` | Response formatting |
| `indexes.test.ts` | Index structures |
| `logger.test.ts` | Logging |
| `MemoryMonitor.test.ts` | Memory monitoring |
| `operationUtils.test.ts` | Operation utilities |
| `parallelUtils.test.ts` | Parallel utilities |
| `schemas.test.ts` | Zod schemas |
| `searchAlgorithms.test.ts` | Search algorithms |
| `searchCache.test.ts` | Search caching |
| `taskScheduler.test.ts` | Task scheduling |
| `WorkerPoolManager.test.ts` | Worker pool |

#### Workers (2 files)
| Test File | Tests |
|-----------|-------|
| `levenshteinWorker.test.ts` | Levenshtein worker |
| `WorkerPool.test.ts` | Worker pool operations |

---

### Integration Tests (8 files)

| Test File | Purpose |
|-----------|---------|
| `backup-compression.test.ts` | Backup with compression |
| `compression-optimization.test.ts` | Compression performance |
| `hybrid-search.test.ts` | Hybrid search workflow |
| `operation-progress.test.ts` | Progress tracking |
| `smart-search.test.ts` | Smart search workflow |
| `streaming-export.test.ts` | Streaming exports |
| `worker-pool-integration.test.ts` | Worker pool integration |
| `workflows.test.ts` | End-to-end workflows |

---

### Performance Tests (12 files)

| Test File | Purpose |
|-----------|---------|
| `benchmarks.test.ts` | General benchmarks |
| `compression-benchmarks.test.ts` | Compression performance |
| `embedding-benchmarks.test.ts` | Embedding performance |
| `foundation-benchmarks.test.ts` | Core operation benchmarks |
| `optimization-benchmarks.test.ts` | Optimization benchmarks |
| `parallel-benchmarks.test.ts` | Parallel execution |
| `query-execution-benchmarks.test.ts` | Query execution |
| `search-algorithm-benchmarks.test.ts` | Search algorithms |
| `task-scheduler-benchmarks.test.ts` | Task scheduling |
| `task-scheduler-config-benchmarks.test.ts` | Scheduler config |
| `v10-benchmarks.test.ts` | Version 10 benchmarks |
| `write-performance.test.ts` | Write operations |

---

### Edge Cases (1 file)

| Test File | Purpose |
|-----------|---------|
| `edge-cases.test.ts` | Boundary conditions |

---

### Other Tests (2 files)

| Test File | Purpose |
|-----------|---------|
| `file-path.test.ts` | File path handling |
| `knowledge-graph.test.ts` | Knowledge graph operations |

---

## Source to Test Mapping

### Core Module Coverage

| Source File | Primary Test File |
|-------------|-------------------|
| `EntityManager.ts` | `EntityManager.test.ts` |
| `RelationManager.ts` | `RelationManager.test.ts` |
| `ObservationManager.ts` | `ObservationManager.test.ts` |
| `HierarchyManager.ts` | `HierarchyManager.test.ts` |
| `GraphStorage.ts` | `GraphStorage.test.ts` |
| `SQLiteStorage.ts` | `SQLiteStorage.test.ts` |
| `StorageFactory.ts` | `StorageFactory.test.ts` |
| `GraphTraversal.ts` | `GraphTraversal.test.ts` |
| `TransactionManager.ts` | `TransactionManager.test.ts` |
| `GraphEventEmitter.ts` | `GraphEventEmitter.test.ts` |
| `ManagerContext.ts` | `ManagerContext.test.ts` |

### Search Module Coverage

| Source File | Primary Test File |
|-------------|-------------------|
| `BasicSearch.ts` | `BasicSearch.test.ts` |
| `RankedSearch.ts` | `RankedSearch.test.ts` |
| `BM25Search.ts` | `BM25Search.test.ts` |
| `BooleanSearch.ts` | `BooleanSearch.test.ts` |
| `FuzzySearch.ts` | `FuzzySearch.test.ts` |
| `SemanticSearch.ts` | `SemanticSearch.test.ts` |
| `HybridSearchManager.ts` | `HybridSearchManager.test.ts` |
| `SearchManager.ts` | `SearchManager.test.ts` |
| `TFIDFIndexManager.ts` | `TFIDFIndexManager.test.ts` |
| `VectorStore.ts` | `VectorStore.test.ts` |
| `EmbeddingService.ts` | `EmbeddingService.test.ts` |
| `QueryAnalyzer.ts` | `QueryAnalyzer.test.ts` |
| `SearchFilterChain.ts` | `SearchFilterChain.test.ts` |

### Features Module Coverage

| Source File | Primary Test File |
|-------------|-------------------|
| `IOManager.ts` | `IOManager.test.ts` |
| `TagManager.ts` | `TagManager.test.ts` |
| `CompressionManager.ts` | `CompressionManager.test.ts` |
| `AnalyticsManager.ts` | `AnalyticsManager.test.ts` |
| `ArchiveManager.ts` | `ArchiveManager.test.ts` |
| `StreamingExporter.ts` | `StreamingExporter.test.ts` |
| `ObservationNormalizer.ts` | `ObservationNormalizer.test.ts` |

---

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest run tests/unit/core/EntityManager.test.ts

# Run tests matching pattern
npx vitest run --grep "EntityManager"

# Watch mode
npm run test:watch

# Run only unit tests
npx vitest run tests/unit

# Run only integration tests
npx vitest run tests/integration

# Run only performance tests
npx vitest run tests/performance
```

---

## Test Configuration

### vitest.config.ts

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/index.ts', '**/types.ts']
    }
  }
});
```

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Maintained By**: Daniel Simon Jr.
