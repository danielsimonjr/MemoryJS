# Storage Wire-up Trace (Phase β.0)

**Generated:** 2026-04-25
**Source commit:** `master @ 2b151b3` (post-v1.11.0)
**Purpose:** Map every place in `src/` that imports or directly references the storage layer types (`GraphStorage`, `SQLiteStorage`, `IGraphStorage`, `StorageFactory`, `WorkingMemoryManager`, `EpisodicMemoryManager`). This is the input for Phase β.1 (`IMemoryBackend` interface design) — it identifies every wire-up point the new abstraction must cover without breaking existing callers.

**Method:** `git grep -nw <symbol> -- src` for each storage symbol, then categorized by usage pattern. Total: **232 wire-up points across 56 source files** (one stale `.tmp` editor-cruft file deleted as drive-by).

---

## Category A — Storage layer (4 files)

The storage backends themselves and their factory. These are where `IMemoryBackend` will be implemented (β.2 InMemoryBackend) or wrapped (β.3 SQLiteBackend).

| File | Hits | Role |
|---|---|---|
| `src/core/GraphStorage.ts` | 11 | JSONL backend; implements `IGraphStorage` |
| `src/core/SQLiteStorage.ts` | 11 | SQLite backend; implements `IGraphStorage` |
| `src/core/StorageFactory.ts` | 15 | `createStorage()` switch on `MEMORY_STORAGE_TYPE` |
| `src/core/index.ts` | 4 | Public barrel re-export |

**β-impact:** Every existing storage method must continue to work after `IMemoryBackend` lands. Both backends are referenced directly throughout the codebase (Category B/C) — `IMemoryBackend` is therefore a **pure ADD** that wraps existing storage rather than replacing it. The storage classes themselves do not need to implement `IMemoryBackend` — only the new `InMemoryBackend` / `SQLiteBackend` adapter classes do.

---

## Category B — Manager & coordinator layer (3 files)

Top-level facades. These instantiate or compose storage.

| File | Hits | Notes |
|---|---|---|
| `src/core/ManagerContext.ts` | 11 | Central facade. Imports `GraphStorage`, `SQLiteStorage`, `StorageFactory`, `EpisodicMemoryManager`, `WorkingMemoryManager`. Already routes via `StorageFactory` (`createStorage` based on `MEMORY_STORAGE_TYPE`). β.4 will extend its `memoryEngine` getter to optionally accept an `IMemoryBackend`. |
| `src/agent/AgentMemoryManager.ts` | 16 | Composes `WorkingMemoryManager` + `EpisodicMemoryManager` over `IGraphStorage`. Uses `StorageFactory` for sub-storage when configured. The constructor signature here is the most-likely back-compat risk in β.4. |
| `src/agent/MemoryEngine.ts` | 9 | The v1.11.0 facade. Already takes `IGraphStorage`/`EpisodicMemoryManager`/`WorkingMemoryManager` injected. β.4 adds an optional `backend?: IMemoryBackend` parameter at the end of the constructor (default `InMemoryBackend`) — preserves all existing call sites unchanged. |

**β-impact:** β.4's wiring change is concentrated in these three files. **No other manager construction sites need to change.**

---

## Category C — Type-only import surface (32 files)

Files that `import type { IGraphStorage }` (or `GraphStorage`/`SQLiteStorage`) for parameter typing only — they don't construct storage, they receive it injected. These are the "happy paths" — `IMemoryBackend` doesn't need to touch them at all because the existing types stay valid.

### C.1 Agent subsystem (16 files)

| File | Hits | Imports |
|---|---|---|
| `src/agent/AccessTracker.ts` | 3 | `IGraphStorage` |
| `src/agent/AgentMemoryConfig.ts` | 2 | `EpisodicMemoryManager`, `WorkingMemoryManager` |
| `src/agent/ArtifactManager.ts` | 4 | `IGraphStorage`, `WorkingMemoryManager` |
| `src/agent/CollaborativeSynthesis.ts` | 2 | `IGraphStorage` |
| `src/agent/ConsolidationPipeline.ts` | 6 | `IGraphStorage`, `WorkingMemoryManager` |
| `src/agent/ContextWindowManager.ts` | 3 | `IGraphStorage` |
| `src/agent/DecayEngine.ts` | 3 | `IGraphStorage` |
| `src/agent/DreamEngine.ts` | 6 | `GraphStorage`, `IGraphStorage` |
| `src/agent/EntropyFilter.ts` | 1 | `WorkingMemoryManager` |
| `src/agent/EpisodicMemoryManager.ts` | 7 | `EpisodicMemoryManager`, `IGraphStorage` (self) |
| `src/agent/FailureDistillation.ts` | 4 | `EpisodicMemoryManager`, `IGraphStorage` |
| `src/agent/MultiAgentMemoryManager.ts` | 3 | `IGraphStorage` |
| `src/agent/ProfileManager.ts` | 2 | `IGraphStorage` |
| `src/agent/SalienceEngine.ts` | 3 | `IGraphStorage` |
| `src/agent/SessionCheckpoint.ts` | 6 | `IGraphStorage`, `WorkingMemoryManager` |
| `src/agent/SessionManager.ts` | 10 | `EpisodicMemoryManager`, `IGraphStorage`, `WorkingMemoryManager` |
| `src/agent/SessionQueryBuilder.ts` | 3 | `IGraphStorage` |
| `src/agent/WorkThreadManager.ts` | 2 | `IGraphStorage` |
| `src/agent/WorkingMemoryManager.ts` | 7 | `IGraphStorage`, `WorkingMemoryManager` (self) |
| `src/agent/index.ts` | 4 | Barrel re-export |

### C.2 Core subsystem (6 files)

| File | Hits | Imports |
|---|---|---|
| `src/core/EntityManager.ts` | 2 | `GraphStorage` |
| `src/core/GraphTraversal.ts` | 2 | `GraphStorage` |
| `src/core/HierarchyManager.ts` | 2 | `GraphStorage` |
| `src/core/ObservationManager.ts` | 2 | `GraphStorage` |
| `src/core/RefIndex.ts` | 1 | `GraphStorage` |
| `src/core/RelationManager.ts` | 2 | `GraphStorage` |
| `src/core/TransactionManager.ts` | 4 | `GraphStorage` |

### C.3 Features subsystem (8 files)

| File | Hits | Imports |
|---|---|---|
| `src/features/AnalyticsManager.ts` | 2 | `GraphStorage` |
| `src/features/ArchiveManager.ts` | 2 | `GraphStorage` |
| `src/features/AutoLinker.ts` | 2 | `IGraphStorage` |
| `src/features/CompressionManager.ts` | 2 | `GraphStorage` |
| `src/features/FreshnessManager.ts` | 6 | `IGraphStorage` |
| `src/features/GovernanceManager.ts` | 3 | `GraphStorage` |
| `src/features/IOManager.ts` | 2 | `GraphStorage` |
| `src/features/ObservableDataModelAdapter.ts` | 3 | `GraphStorage` |
| `src/features/SemanticForget.ts` | 2 | `GraphStorage` |

### C.4 Search subsystem (10 files)

| File | Hits | Imports |
|---|---|---|
| `src/search/BasicSearch.ts` | 2 | `GraphStorage` |
| `src/search/BM25Search.ts` | 2 | `GraphStorage` |
| `src/search/BooleanSearch.ts` | 2 | `GraphStorage` |
| `src/search/FuzzySearch.ts` | 3 | `GraphStorage` |
| `src/search/RankedSearch.ts` | 2 | `GraphStorage` |
| `src/search/SearchManager.ts` | 3 | `GraphStorage` |
| `src/search/SearchSuggestions.ts` | 2 | `GraphStorage` |
| `src/search/TemporalSearch.ts` | 4 | `GraphStorage`, `IGraphStorage` |
| `src/search/TFIDFEventSync.ts` | 4 | `GraphStorage`, `IGraphStorage` |
| `src/search/VectorStore.ts` | 3 | `SQLiteStorage` *(direct concrete reference — only place in `src/`)* |

### C.5 Types & misc (3 files)

| File | Hits | Imports |
|---|---|---|
| `src/types/index.ts` | 1 | `IGraphStorage` (re-export) |
| `src/types/types.ts` | 2 | `IGraphStorage`, `SQLiteStorage` |
| `src/core/README.md` | 2 | (doc reference — not code) |

**β-impact:** None. These files type-import existing storage interfaces; introducing `IMemoryBackend` does not require any change here. They will continue to receive an `IGraphStorage` parameter via dependency injection from Category B sites.

---

## Concrete-class direct references (worth tracking)

A small number of sites reference the **concrete** `SQLiteStorage` class rather than the `IGraphStorage` interface. These are points where backend abstraction leaks through:

| Site | Reason |
|---|---|
| `src/search/VectorStore.ts` × 3 | Calls `SQLiteStorage.storeEmbedding()` directly. Already protected via the `hasStoreEmbedding` duck-typed type guard pattern shipped in v1.11.0 (`src/agent/MemoryEngine.ts`). |
| `src/core/ManagerContext.ts` × 1 | Imported but only for instanceof / fallback construction in `StorageFactory` chain. |
| `src/types/types.ts` × 1 | Type-only re-export. |
| `src/core/index.ts` × 1 | Barrel re-export. |
| `src/agent/AgentMemoryManager.ts` × 1 | Constructor wiring. |

**β-impact:** `IMemoryBackend` doesn't need to subsume `storeEmbedding` — it's already handled via the duck-typed guard. The interface stays scoped to the agent-memory-flavored operations (`add`, `getWeighted`, `delete_session`, `list_sessions`, decay hooks) per the v1.12.0 spec.

---

## Wire-up summary for Phase β.1

| Decision | Rationale |
|---|---|
| `IMemoryBackend` interface lives in `src/agent/IMemoryBackend.ts` | Co-located with `MemoryEngine.ts`, the primary consumer. Avoids circular-import risk from `src/core/` → `src/agent/`. |
| Existing `IGraphStorage` interface stays as-is | Different abstraction level — `IGraphStorage` is the durable graph-store contract, `IMemoryBackend` is the agent-memory-flavored contract. Both can coexist. |
| `InMemoryBackend` adapter wraps the in-memory `Map` path inside `WorkingMemoryManager` | Mirror existing storage pattern; do not duplicate state. |
| `SQLiteBackend` adapter wraps existing `SQLiteStorage` (Category A) | Reuses FTS5/WAL setup. The new `agentMetadata` JSON-blob column shipped in T06b is already in place. |
| `MemoryEngine` constructor gains a final optional `backend?: IMemoryBackend` parameter | Preserves backward compat for the 9 existing call sites mapped above. |
| **No other Category C files need to change** | They receive storage via dependency injection. |

---

## Drive-by cleanup (this commit)

- **Removed `src/agent/ContextWindowManager.ts.tmp.44728.1775826871762`** — stale 35KB editor crufts (file from 2026-04-10, fully superseded by `ContextWindowManager.ts`). It was tracked in git, which is a defect; should never have been committed. Deleted with `git rm`.

---

## Next: T11 (β.1)

Define `IMemoryBackend` interface in `src/agent/IMemoryBackend.ts` per `docs/superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md`. Methods: `add`, `get`, `getWeighted`, `delete_session`, `list_sessions`, plus the decay-related hooks. Failing contract test first; no backend impl yet (T12 / T13).
