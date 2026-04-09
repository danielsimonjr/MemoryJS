# MemoryJS Codebase Simplification Audit

**Date**: 2026-02-09
**Overall pattern**: Excessive abstraction layering — facades wrapping facades, lazy initialization of lightweight objects, and config objects with rarely-used options.

---

## Top 15 Findings

### 1. Over-Engineered Lazy Initialization Pattern

**Location**: `src/core/ManagerContext.ts` (lines 50-69, 89-329)

The `ManagerContext` class implements 20+ lazy-initialized private fields with getter methods. Most managers are stateless wrappers around storage — lazy initialization provides minimal value since managers are lightweight. Could eagerly initialize core managers in constructor.

**Impact**: Reduce 300+ lines to ~100 lines, eliminate 20 getters.

---

### 2. Redundant Storage Abstraction Layer

**Location**: `src/core/StorageFactory.ts` (entire file)

The `StorageFactory` with `createStorage()` and `createStorageFromPath()` is a thin wrapper that just switches on an environment variable. Both `GraphStorage` and `SQLiteStorage` already implement the same interface via duck typing.

**Impact**: Eliminate entire file (~75 lines), reduce indirection.

---

### 3. Excessive Search Manager Indirection

**Location**: `src/search/SearchManager.ts` (lines 38-592)

`SearchManager` is a pass-through wrapper that delegates to 7 different search implementations without adding meaningful logic. The only value-add is cache clearing (lines 70-103), which could move to `ManagerContext`.

**Impact**: Reduce from 592 lines to <100 lines for cache coordination only.

---

### 4. Redundant Agent Memory Facade

**Location**: `src/agent/AgentMemoryManager.ts` (lines 122-649)

`AgentMemoryManager` is another lazy-initialized facade wrapping 12+ agent components. Almost every method is a single-line delegation. EventEmitter inheritance adds complexity for minimal gain (only 4 emit calls).

**Impact**: Reduce from 649 lines to ~200 lines by exposing managers directly.

---

### 5. Over-Complex Query Cost Estimator

**Location**: `src/search/QueryCostEstimator.ts` (826 lines total)

Contains extensive logic for estimating search costs with multiple configuration objects, layer recommendations, adaptive depth calculations, and token estimation. The `autoSearch` feature (only consumer) just needs basic heuristics.

**Impact**: Reduce to ~150 lines with simple heuristic rules.

---

### 6. Duplicate Validation Logic

**Locations**:
- `src/utils/schemas.ts` (601 lines)
- `src/utils/EntityValidator.ts` (separate validator)
- Manual validation scattered in managers

Three separate validation systems: Zod schemas, `EntityValidator` class with rule-based validation, and manual checks in managers. Consolidating to Zod schemas alone is sufficient.

**Impact**: Eliminate ~400 lines of duplicate validation logic.

---

### 7. Unnecessary Wrapper Classes

**Locations**:
- `src/search/BasicSearch.ts` — wraps `loadGraph()` + filter
- `src/search/SymbolicSearch.ts` — just filters entities
- `src/search/SearchSuggestions.ts` — simple text processing

These could be standalone functions instead of classes. No instance state needed.

**Impact**: Reduce from class-based to functional approach (~200 lines).

---

### 8. Over-Engineered Hybrid Search

**Locations**:
- `src/search/HybridSearchManager.ts` (272 lines)
- `src/search/HybridScorer.ts` (separate scorer)
- `src/search/QueryPlanner.ts` (147 lines)

Complex multi-layer orchestration with weight normalization, layer selection, and merge strategies. Most use cases just need semantic + keyword search with fixed weights. `QueryPlanner` creates execution plans that are rarely needed.

**Impact**: Reduce combined ~600 lines to ~200 lines.

---

### 9. Excessive Configuration Objects

**Location**: Throughout codebase

Many managers accept large configuration objects with 5-15 optional fields, most with defaults that are never overridden. Could hard-code sensible defaults and use env vars for the 2-3 that genuinely need runtime configuration.

**Impact**: Eliminate 20+ config interfaces (~300 lines).

---

### 10. Duplicate Index Implementations

**Location**: `src/utils/indexes.ts` (588 lines)

Five separate index classes (`NameIndex`, `TypeIndex`, `LowercaseCache`, `RelationIndex`, `ObservationIndex`) that all implement similar Map-based lookups. Could unify into a single `GraphIndex` class with different key extractors.

**Impact**: Reduce from 588 lines to ~200 lines.

---

### 11. Overly Complex IOManager

**Location**: `src/features/IOManager.ts` (1,378 lines)

Massive file combining export, import, backup, streaming, and compression — too many responsibilities in one class. Should split into separate focused classes: `Exporter`, `Importer`, `BackupManager`.

**Impact**: Better separation of concerns, easier to understand.

---

### 12. Redundant Environment Variable Helpers

**Location**: `src/core/ManagerContext.ts` (lines 331-352)

Two private helper methods for reading env vars used in one place. Could inline at call sites.

**Impact**: Remove ~20 lines.

---

### 13. Unnecessary Transaction Wrapper

**Location**: `src/core/TransactionManager.ts` (1,021 lines)

Complex transaction system with rollback, batching, and ACID guarantees. For JSONL storage, transactions are overkill (single-threaded Node.js). SQLite already has native transactions. Could simplify to basic batch operations only.

**Impact**: Reduce from 1,021 lines to ~300 lines.

---

### 14. Over-Engineered Worker Pool

**Location**: `src/utils/WorkerPoolManager.ts` (514 lines)

Sophisticated worker pool with dynamic sizing, task queuing, priority, health monitoring, and event emission. Only used for Levenshtein distance calculations. Could use simple `Promise.all()` with concurrency limit.

**Impact**: Reduce from 514 lines to ~100 lines.

---

### 15. Redundant Error Suggestion System

**Locations**:
- `src/utils/errors.ts` (custom error classes)
- `src/utils/errorSuggestions.ts` (suggestion generation)

Elaborate error suggestion system that generates contextual hints. Most errors are self-explanatory from the message.

**Impact**: Remove errorSuggestions.ts (~200 lines), simplify error classes.

---

## Top 5 Highest-Impact Simplifications

1. **Eliminate ManagerContext lazy init** — eager init is simpler for lightweight managers
2. **Remove StorageFactory indirection** — inline the 2-line switch
3. **Simplify SearchManager to cache coordinator only** — 592 to ~100 lines
4. **Split IOManager into focused classes** — 1,378-line monolith needs separation
5. **Consolidate validation to Zod schemas only** — remove 400+ duplicate lines

**Total potential reduction: ~3,000+ lines (~7% of codebase) while maintaining all functionality.**
