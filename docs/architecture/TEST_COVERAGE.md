# Test Coverage Analysis

**Generated**: 2026-04-25 (regenerated from current `tests/` directory)

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 183 |
| Total Test Files | 214 |
| Tests passing | 6157 |
| Tests failing (pre-existing) | 5 |
| Tests skipped | 3 |
| Test categories | 4 (unit, integration, edge-cases, performance) |

**Pre-existing failures** (tracked, not introduced by recent commits):
- 4 in `tests/file-path.test.ts` — `ensureMemoryFilePath` path-validation regressions; predate v1.14
- 1 in `tests/performance/memory-engine-perf.test.ts` — Windows perf-timing flake (P95 threshold)

---

## Test Organization

### Test Pyramid

```
            /\
           /  \
          / E2E \ (Edge cases: 1 file)
         /______\
        /        \
       / Integr.  \ (Integration: 17 files)
      /____________\
     /              \
    /   Unit Tests   \ (Unit: 181 files across 11 dirs)
   /                  \
  /____________________\
 /                      \
/   Performance Tests    \ (Performance: 13 files; gated by SKIP_BENCHMARKS)
```

### File counts by test directory

| Directory | Test files | Source dir | Source files | Files-coverage |
|-----------|-----------:|------------|-------------:|---------------:|
| `tests/unit/agent/` | 53 | `src/agent/` | 61 | 87% |
| `tests/unit/cli/` | 6 | `src/cli/` | 16 | 38% |
| `tests/unit/core/` | 30 | `src/core/` | 14 | 214% (multiple test files per source) |
| `tests/unit/features/` | 22 | `src/features/` | 17 | 129% |
| `tests/unit/search/` | 37 | `src/search/` | 37 | 100% |
| `tests/unit/security/` | 1 | `src/security/` | 2 | 50% |
| `tests/unit/types/` | 6 | `src/types/` | 7 | 86% |
| `tests/unit/utils/` | 22 | `src/utils/` | 26 | 85% |
| `tests/unit/workers/` | 2 | `src/workers/` | 2 | 100% |
| `tests/unit/performance/` | 1 | (helper) | — | — |
| `tests/unit/tools/` | 1 | `tools/plan-doc-audit/` | — | — |
| `tests/integration/` | 17 | (cross-module) | — | — |
| `tests/edge-cases/` | 1 | (boundary) | — | — |
| `tests/performance/` | 13 | (benchmarks) | — | — |

> "Files-coverage" measures whether each source file has at least one
> test file targeting it. It is NOT a substitute for line-coverage; for
> that run `npm run test:coverage`.

---

## Test Categories

### Unit Tests — Agent (53 files; src/agent has 61 files)

Includes the original Phase 3 surface plus all new sub-modules through Unreleased.

**Original (v1.0–v1.7):**
- AccessTracker, AgentMemoryManager, ConflictResolver, ConsolidationPipeline,
  ContextWindowManager, DecayEngine, DecayScheduler, EpisodicMemoryManager,
  MemoryFormatter, MultiAgentMemoryManager, PatternDetector, RuleEvaluator,
  SalienceEngine, SessionManager, SessionQueryBuilder, SummarizationService,
  WorkingMemoryManager, ArtifactManager, CognitiveLoadAnalyzer, ConsolidationScheduler,
  DistillationPolicy, EntropyFilter, FailureDistillation, MemoryFormatterSalience,
  ObserverPipeline, RoleProfiles, VisibilityResolver, ContextProfileManager,
  CollaborativeSynthesis, profile-manager-basics, profile-manager-extraction,
  agent-memory-manager-diary, context-window-manager-compress,
  context-window-manager-wakeup, SessionCheckpoint, WorkThreadManager,
  DreamEngine

**v1.11 — Memory Engine:**
- MemoryEngine.test.ts, ImportanceScorer.test.ts

**v1.12 — Pluggable backends:**
- IMemoryBackend.contract.test.ts (parameterized contract suite)
- InMemoryBackend.test.ts, SQLiteBackend.test.ts
- memoryBackend-wiring.test.ts

**v1.13 — Phase δ Memory Intelligence:**
- MemoryValidator.test.ts, TrajectoryCompressor.test.ts,
  ExperienceExtractor.test.ts, delta-services-wiring.test.ts

**Unreleased — η.5.5 + η.6.1 + 3B.4–3B.7:**
- CollaborationAuditEnforcer.test.ts (η.5.5.d)
- rbac.test.ts (η.6.1)
- ProcedureManager.test.ts (3B.4)
- ActiveRetrieval.test.ts (3B.5)
- CausalReasoner.test.ts (3B.6)
- WorldModel.test.ts (3B.7)

### Unit Tests — Core (30 files; src/core has 14 files)

Multiple test files per source — heavy coverage of EntityManager / RelationManager / ObservationManager / GraphStorage / SQLiteStorage:

- BatchTransaction, ConcurrencyControl, EntityManager (+ list-projects,
  profile-namespace, project-stamping, version-chain), GraphEventEmitter,
  GraphEvents, GraphStorage, GraphTraversal, HierarchyManager,
  ManagerContext (+ default-embedding, new-managers, project),
  ObservationManager (+ dedup), observation-validate-hook (η.5.5 hook),
  **optimistic-concurrency.test.ts** (η.5.5.c), RefIndex,
  RelationManager (+ relation-manager-temporal, v1.9.0),
  sqlite-content-hash-migration (v1.11), SQLiteStorage, StorageFactory,
  **temporal-versioning.test.ts** (η.4.4), TransactionBatching,
  TransactionManager, TransitionLedger

### Unit Tests — Features (22 files; src/features has 17 files)

- AnalyticsManager, ArchiveManager, AuditLog, AutoLinker,
  CompressionManager (+ priority-dedup, versioning-guard),
  contradiction-detector-detect, FactExtractor, FreshnessManager,
  GovernanceManager, **IOManager.rdf-export.test.ts** (η.5.4),
  IOManager, io-manager-ingest (v1.9.0), io-manager-split,
  io-manager-visualize (v1.9.1), ObservableDataModelAdapter,
  ObservationNormalizer, semantic-forget-exact / -semantic (v1.8),
  StreamingExporter, TagManager

### Unit Tests — Search (37 files; src/search has 37 files; 100% files-coverage)

All search algorithms covered:

- BasicSearch, BM25Search, BooleanSearch, EarlyTerminationManager,
  EmbeddingCache, EmbeddingService, FuzzySearch, HybridScorer,
  HybridSearchManager, IncrementalIndexer, IncrementalTFIDF,
  LLMQueryPlanner (v1.6), NGramFuzzyIntegration (v1.6),
  NGramIndex, OptimizedInvertedIndex, ParallelSearchExecutor,
  ProximitySearch, QuantizedVectorStore, QueryAnalyzer,
  QueryCostEstimator, QueryLogger, QueryParser, QueryPlanCache,
  RankedSearch, ReflectionManager, SavedSearchManager,
  SearchFilterChain (+ project, versioning), SearchManager,
  SearchSuggestions, SemanticSearch, TemporalQueryParser /
  TemporalSearch (v1.6), TFIDFEventSync, TFIDFIndexManager,
  VectorStore

### Unit Tests — Utils (22 files; src/utils has 26 files)

- BatchProcessor, compressedCache, compressionUtil, entityUtils,
  EntityValidator, errors, errorSuggestions, formatters, indexes,
  logger, MemoryMonitor, operationUtils, parallelUtils, relationHelpers,
  relationValidation, schemas, SchemaValidator, searchAlgorithms,
  searchCache, taskScheduler, validators, WorkerPoolManager

### Unit Tests — Security (1 file; new in η.6.3)

- **PiiRedactor.test.ts** — covers default pattern bank (email/SSN/CC/phone/IPv4),
  custom patterns, redactWithStats, redactGraph

### Unit Tests — Types (6 files)

- agent-memory, **entity-content-hash** (v1.11),
  **entity-new-fields** (η.4.4 + supersession), profile-entity,
  progress, search

### Unit Tests — CLI (6 files)

- commands, config, formatters, index, interactive, options

### Unit Tests — Workers (2 files)

- levenshteinWorker, WorkerPool

### Unit Tests — Performance helpers (1 file)

- baselineHelper.test.ts — platform-keyed perf baseline lookup

### Unit Tests — Tools (1 file)

- plan-doc-audit.test.ts — audit tool's symbol detection + flip logic

### Integration Tests (17 files)

Cross-module workflows and storage roundtrips:

- access-tracking, agent-memory-manager-profile, backup-compression,
  compression-optimization, contradiction-detector-supersede (v1.8),
  graph-storage-new-fields (η.4.4 / v1.8 fields persist correctly),
  hybrid-search, manager-context-semantic-forget,
  MemoryEngineStorage (v1.11 turn dedup roundtrip),
  observation-manager-contradiction, operation-progress,
  project-scope-isolation (v1.8), smart-search,
  sqlite-storage-new-fields, streaming-export,
  worker-pool-integration, workflows

### Edge Cases (1 file)

- edge-cases.test.ts — boundary conditions

### Performance Tests (13 files; gated by `SKIP_BENCHMARKS=true`)

- benchmarks, compression-benchmarks, embedding-benchmarks,
  foundation-benchmarks, **memory-engine-perf** (v1.11 P95 thresholds —
  carries documented Windows flake), optimization-benchmarks,
  parallel-benchmarks, query-execution-benchmarks,
  search-algorithm-benchmarks, task-scheduler-benchmarks,
  task-scheduler-config-benchmarks, v10-benchmarks, write-performance

### File-path tests (1 file at root)

- file-path.test.ts — `ensureMemoryFilePath` validation; **carries 4
  pre-existing failures** unrelated to v1.14+ work

---

## Source-to-Test Mapping (selected)

### Core — every source file has at least one test file

| Source File | Test File(s) |
|-------------|--------------|
| `EntityManager.ts` | `EntityManager.test.ts` + 4 specialized + `optimistic-concurrency.test.ts` (η.5.5.c) + `temporal-versioning.test.ts` (η.4.4) |
| `RelationManager.ts` | `RelationManager.test.ts` + `relation-manager-temporal.test.ts` (v1.9) |
| `ObservationManager.ts` | `ObservationManager.test.ts` + `dedup` + `observation-validate-hook.test.ts` (η.5.5 hook) + `temporal-versioning.test.ts` |
| `HierarchyManager.ts` | `HierarchyManager.test.ts` |
| `GraphStorage.ts` | `GraphStorage.test.ts` |
| `SQLiteStorage.ts` | `SQLiteStorage.test.ts` + `sqlite-content-hash-migration.test.ts` (v1.11) |
| `GraphTraversal.ts` | `GraphTraversal.test.ts` |
| `TransactionManager.ts` | `TransactionManager.test.ts` + `BatchTransaction.test.ts` + `TransactionBatching.test.ts` |
| `ManagerContext.ts` | `ManagerContext.test.ts` + 3 specialized (incl. `manager-context-new-managers.test.ts`) |
| `RefIndex.ts` | `RefIndex.test.ts` |
| `TransitionLedger.ts` | `TransitionLedger.test.ts` |

### Search — every source file has a test file

100% files-coverage: 37 source files mapped 1:1 to 37 test files (some sources have multiple test files).

### Features — most source files have tests

`IOManager.ts` has 4 test files (incl. `IOManager.rdf-export.test.ts` for η.5.4 + `io-manager-ingest`/`-split`/`-visualize` for v1.9). `CompressionManager` has 3. `SemanticForget` has 2.

### Recently shipped sub-modules

| Sub-module | Source files | Test file |
|------------|--------------|-----------|
| `src/agent/causal/` (3B.6) | 2 (CausalReasoner, index) | `tests/unit/agent/CausalReasoner.test.ts` |
| `src/agent/procedural/` (3B.4) | 4 (Manager, Store, Sequencer, index) | `tests/unit/agent/ProcedureManager.test.ts` |
| `src/agent/retrieval/` (3B.5) | 3 (Controller, QueryRewriter, index) | `tests/unit/agent/ActiveRetrieval.test.ts` |
| `src/agent/world/` (3B.7) | 3 (Manager, Snapshot, index) | `tests/unit/agent/WorldModel.test.ts` |
| `src/agent/rbac/` (η.6.1) | 5 (Types, Matrix, Middleware, Store, index) | `tests/unit/agent/rbac.test.ts` |
| `src/agent/collaboration/` (η.5.5.d) | 1 (CollaborationAuditEnforcer) | `tests/unit/agent/CollaborationAuditEnforcer.test.ts` |
| `src/security/` (η.6.3) | 2 (PiiRedactor, index) | `tests/unit/security/PiiRedactor.test.ts` |

---

## Running Tests

```bash
# All tests
npm test

# With coverage report
npm run test:coverage

# Single file
npx vitest run tests/unit/core/EntityManager.test.ts

# Pattern match
npx vitest run --grep "EntityManager"

# Watch mode
npm run test:watch

# Targeted suites
npx vitest run tests/unit
npx vitest run tests/integration
npx vitest run tests/performance

# Skip perf tests in main run (default in CI)
SKIP_BENCHMARKS=true npm test

# Standalone benchmark CLI
npm run benchmark
```

### Per-feature smoke tests

```bash
# η.4.4 bitemporal versioning
npx vitest run tests/unit/core/temporal-versioning.test.ts

# η.5.4 RDF export
npx vitest run tests/unit/features/IOManager.rdf-export.test.ts

# η.5.5.* collaboration suite
npx vitest run tests/unit/agent/CollaborationAuditEnforcer.test.ts \
                tests/unit/agent/CollaborativeSynthesis.test.ts \
                tests/unit/agent/VisibilityResolver.test.ts \
                tests/unit/core/optimistic-concurrency.test.ts

# η.6.1 RBAC
npx vitest run tests/unit/agent/rbac.test.ts

# η.6.3 PII
npx vitest run tests/unit/security/PiiRedactor.test.ts

# 3B.4–3B.7 memory theory
npx vitest run tests/unit/agent/ProcedureManager.test.ts \
                tests/unit/agent/ActiveRetrieval.test.ts \
                tests/unit/agent/CausalReasoner.test.ts \
                tests/unit/agent/WorldModel.test.ts
```

---

## Test Configuration

### `vitest.config.ts`

Tests use Vitest with a 30-second default timeout. Coverage excludes barrel
`index.ts` files. Custom `per-file-reporter.js` writes per-file results to
`tests/test-results/`.

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/index.ts', '**/types.ts'],
    },
  },
});
```

### Environment toggles for test runs

| Variable | Effect |
|---|---|
| `SKIP_BENCHMARKS=true` | Performance tests in `tests/performance/` are skipped |
| `MEMORY_STORAGE_TYPE=sqlite` | Run integration tests against the SQLite backend instead of JSONL |
| `MEMORY_BACKEND=in-memory` | Use in-memory `IMemoryBackend` instead of `SQLiteBackend` |

---

**Document Version**: 2.0
**Last Updated**: 2026-04-25
**Maintained By**: Daniel Simon Jr.
