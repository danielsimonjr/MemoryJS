# MemoryJS - System Architecture

**Version**: Unreleased (post v2.9.0 — brainapi2-inspired features R1/R2/R3/R4/R5/R7/R9 + S1–S10/Sec1–Sec10 speed & security optimization program; Phases 0–11 performance & scale track via PR #34; security follow-up via PRs #38 + #39; Phase 2 memory-types expansion Sprints 4–6 + 8; v2.0.0 seven-theme function/API-call consistency & efficiency audit; knowledge-graph-as-core convergence — stable `Entity.id` + `renameEntity`, SQLite event parity, opt-in graph-connectivity signals)
**Last Updated**: 2026-07-24

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [System Context](#system-context)
4. [Component Architecture](#component-architecture)
5. [Data Model](#data-model)
6. [Key Design Decisions](#key-design-decisions)
7. [Storage Architecture](#storage-architecture)
8. [Build & Packaging](#build--packaging)
9. [Performance Considerations](#performance-considerations)
10. [Security Architecture](#security-architecture)
11. [Testing Strategy](#testing-strategy)

---

## System Overview

MemoryJS is a TypeScript knowledge graph library providing:

- **Entity-Relation Knowledge Graph**: Store and query interconnected knowledge
- **Hierarchical Organization**: Parent-child entity relationships
- **Advanced Search**: Basic, ranked (TF-IDF/BM25), boolean, fuzzy, semantic, hybrid, temporal (NL time queries), and LLM-planned search
- **Agent Memory System**: Working memory, episodic memory, decay, artifacts, distillation, role profiles, entropy filtering, recursive consolidation, collaborative synthesis, failure distillation, cognitive load analysis, and shared visibility hierarchies
- **Memory Governance**: Audit logging, governance policies, freshness tracking, and stable reference indexing
- **Compression**: Automatic duplicate detection and merging
- **Tagging & Importance**: Flexible categorization and prioritization
- **Timestamps**: Automatic tracking of creation and modification times
- **Batch Operations**: Efficient bulk updates
- **Graph Algorithms**: Shortest path, centrality, connected components

### Key Statistics (Unreleased)

Numbers below are extracted from the authoritative `dependency-summary.compact.json`
produced by `tools/create-dependency-graph`, regenerated 2026-07-24 as part of the
brainapi2-inspired feature batch + S1–S10/Sec1–Sec10 optimization program. To
regenerate run `npx tsx tools/create-dependency-graph/create-dependency-graph.ts`
(or the `node --experimental-strip-types` variant on newer Node versions).

| Metric | Value |
|--------|-------|
| Source files | 266 TypeScript files |
| Lines of code | 92,541 |
| Total exports | 1,765 |
| Re-exports (barrel) | 1,151 |
| Classes | 221 |
| Interfaces | 584 |
| Functions | 277 |
| Type guards | 28 |
| Enums | 4 |
| Type-only imports | 421 |
| Runtime circular dependencies | 0 |
| Type-only circular dependencies | 4 (down from 39 pre-optimization — S10, see [Build & Packaging](#build--packaging)) |
| Modules | 12 |

### Module Distribution

| Module | Files | Key Exports |
|--------|-------|-------------|
| `adapters/` | 7 | `LangChainMemoryAdapter`, `RestRouter`, `RateLimiter`, `pagination` helpers, `MCPToolObserverAdapter`, **`ApiKeyAuthMiddleware`** (Sec9) |
| `agent/` | 83 | AgentMemoryManager, SessionManager, DecayEngine, WorkingMemoryManager, ArtifactManager, DistillationPipeline, RoleProfiles, EntropyFilter, ConsolidationScheduler, MemoryFormatter, CollaborativeSynthesis (with ConflictView), FailureDistillation, CognitiveLoadAnalyzer, VisibilityResolver (with role + time-window gates), ContextWindowManager, **MemoryEngine**, **MemoryBackend** + **InMemoryBackend** + **SQLiteBackend**, **MemoryValidator**, **TrajectoryCompressor**, **ExperienceExtractor**, **PatternDetector**, **CausalReasoner**, **ProcedureManager**, **WorldModelManager**, **ActiveRetrievalController**, **CollaborationAuditEnforcer**, **RbacMiddleware**, **ProspectiveMemoryManager** (Phase 1 prospective), **FailureManager** (Sprint 4), **PlanManager** (Sprint 5), **ReflectionManager** (Sprint 8, aliased as `ReflectionMemoryManager`), **ReflectionStage** + **ProspectivePromotionStage** pipeline stages, **`EventManager`** (`agent/events/`, R1, `@experimental`), **`RelationConsolidator`** (R3, `@experimental`) |
| `core/` | 24 | ManagerContext, EntityManager (with optimistic concurrency + temporal validity + state machine + **`GovernanceHooks`**, Sec1), RelationManager (with temporal invalidation), ObservationManager (with bitemporal axis), HierarchyManager, GraphStorage (with optional mmap branch), SQLiteStorage (with read-pool + `PartialIndexAdvisor` + **tuned pragmas + cached prepared statements**, S3), GraphTraversal (HITS / clique / Louvain), TransactionManager, RefIndex, `FileSegmentStorage`, `JsonlColumnStore`, `TieredIndex` (`LRUHotTier` / `DiskWarmTier` / `BrotliColdTier`), `IMmapBackend` / `FsReadMmapBackend`, **`sqlite-register`** (S9 lazy-loading side effect) |
| `search/` | 50 | SearchManager, RankedSearch (incremental TF-IDF), BM25Search (incremental), BooleanSearch, FuzzySearch, SemanticSearch, HybridSearchManager, NGramIndex, TemporalSearch, LLMQueryPlanner, LLMSearchExecutor, `PartialIndexAdvisor`, `SpellChecker`, **`EvidencePathBuilder`** (R2, `@experimental`) |
| `features/` | 18 | IOManager (with RDF / Turtle / JSON-LD export + **ingest provenance/mode dial**, R4b/R5), `BackupManager`, TagManager, ArchiveManager, CompressionManager, StreamingExporter, FreshnessManager, AuditLog (**hash-chained**, Sec5), GovernanceManager (**enforcement chokepoint**, Sec1), ContradictionDetector, SemanticForget, AutoLinker |
| `utils/` | 34 | BatchProcessor, CompressedCache, WorkerPoolManager, schemas (Zod), errors (with VersionConflictError + AttributionRequiredError), `logger` (Phase 0), `taskScheduler` (Phase 0, bounded), **`compression/`** (`ICompressionAdapter` + `Zlib`/`Brotli`/`Identity` + `CompressedMap`, Phase 10) |
| `types/` | 11 | Entity (with bitemporal + supersession + contentHash fields), Relation, AgentEntity (with allowedRoles + visibleFrom/Until), SessionEntity, ArtifactEntity, Procedure, **ProspectiveEntity** + **FailureEntity** + **PlanEntity** + **ReflectionEntity** (Phase 2 memory-type entities), **TrustLevel** mixin on `MemorySource` (`ground-truth`/`verified`/`inferred`/`unverified`), **`Result<T, E>`** (v2.0.0 — `ok`/`err`/`isOk`/`isErr`/`unwrap`/`unwrapOr`/`mapOk` in `result.ts`), **`event.ts`** (R1 — `EventRecord`/`EventQueryFilter`/`WhoDidWhatEntry`) — leaf layer, ESLint-enforced (S10) |
| `security/` | 5 | **PiiRedactor** + DEFAULT_PII_PATTERNS, **ABAC + RLS + API keys** (Phase 5) |
| `cli/` | 31 | `memory` / `memoryjs` binary commands (with pipe support, Phase 0), **`memory audit log\|history\|verify\|stats`** (R4a) + **`memory doctor`** (R9) |
| `entry/` | 1 | `src/index.ts` |
| `workers/` | 1 | Levenshtein distance calculations (the orphan `workers/index.ts` barrel was deleted as dead code) |

---


## Architecture Principles

### 1. Modularity
- **Single Responsibility**: Each manager has one clear purpose
- **Loose Coupling**: Modules interact through well-defined interfaces
- **High Cohesion**: Related functionality grouped together

### 2. Testability
- **Dependency Injection**: Storage injected into managers
- **Pure Functions**: Utils are stateless and predictable
- **Interface-Based**: `IGraphStorage` interface enables mocking

### 3. Performance
- **Single I/O Operations**: Batch operations use one read/write cycle
- **In-Memory Processing**: Load once, process in memory, save once
- **Efficient Algorithms**: TF-IDF for ranking, Levenshtein for fuzzy matching
- **Parallel Execution**: Worker pools for CPU-intensive operations

### 4. Maintainability
- **TypeScript Strict Mode**: Full type safety
- **Consistent Patterns**: Similar structure across managers
- **Barrel Exports**: Clean module boundaries

### 5. Extensibility
- **Storage Abstraction**: Easy to add new storage backends
- **Search Abstraction**: Pluggable search implementations
- **Event System**: GraphEventEmitter for reactive updates

---

## System Context

```
┌─────────────────────────────────────────────────────────────┐
│              Application / MCP Server / AI Agent             │
└───────────────────────────┬──────────────────────────────────┘
                            │ Library API
┌───────────────────────────┴──────────────────────────────────┐
│                      MemoryJS Library                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Layer 1: ManagerContext (Central Facade)              │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ Lazy-initialized getters for all managers        │  │ │
│  │  │ ctx.agentMemory() - Agent Memory System          │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────┬───────────────────────────┘ │
│                               │                              │
│  ┌────────────────────────────┴───────────────────────────┐ │
│  │  Layer 2: Manager Layer                                │ │
│  │  ┌───────────┬───────────┬────────────┬─────────────┐  │ │
│  │  │ agent/    │ core/     │ search/    │ features/   │  │ │
│  │  │ AgentMem  │ EntityMgr │ SearchMgr  │ IOManager   │  │ │
│  │  │ SessionMgr│ RelationM │ BasicSearch│ TagMgr      │  │ │
│  │  │ WorkingMem│ HierarchyM│ RankedSrch │ AnalyticsMgr│  │ │
│  │  │ DecayEng  │ TransactM │ BooleanSrch│ ArchiveMgr  │  │ │
│  │  │ SalienceE │ GraphTrav │ FuzzySearch│ CompressMgr │  │ │
│  │  │ ContextWin│ RefIndex  │ HybridSrch │ FreshnessMgr│  │ │
│  │  │ MultiAgent│           │ SemanticSrch│ AuditLog   │  │ │
│  │  │ ArtifactMg│           │ TemporalSrch│ GovernanceMg│ │ │
│  │  │ Distillati│           │ LLMPlanner │             │  │ │
│  │  │ on        │           │ NGramIndex │             │  │ │
│  │  └───────────┴───────────┴────────────┴─────────────┘  │ │
│  └────────────────────────────┬───────────────────────────┘ │
│                               │                              │
│  ┌────────────────────────────┴───────────────────────────┐ │
│  │  Layer 3: Storage Layer                                │ │
│  │  ┌─────────────────────┬────────────────────────────┐  │ │
│  │  │ GraphStorage (JSONL)│ SQLiteStorage (FTS5)       │  │ │
│  │  └─────────────────────┴────────────────────────────┘  │ │
│  └────────────────────────────┬───────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────┘
                                │ File System I/O
                    ┌───────────┴───────────┐
                    │    Storage Files      │
                    │ ┌───────────────────┐ │
                    │ │ memory.jsonl      │ │
                    │ │ memory.db         │ │
                    │ │ *-tag-aliases     │ │
                    │ └───────────────────┘ │
                    └───────────────────────┘
```

### External Actors

1. **Application Code**: TypeScript/JavaScript applications using the library
2. **MCP Servers**: Model Context Protocol servers built on MemoryJS
3. **AI Agents**: LLM-powered agents using the Agent Memory System
4. **File System**: Persistent storage for knowledge graph

---

## Component Architecture

### Layer 1: ManagerContext

**Responsibility**: Central facade providing lazy access to all managers

```typescript
export class ManagerContext {
  private readonly storage: IGraphStorage;

  // Lazy-initialized managers (instantiated on first access)
  private _entityManager?: EntityManager;
  private _relationManager?: RelationManager;
  private _searchManager?: SearchManager;
  private _ioManager?: IOManager;
  private _tagManager?: TagManager;
  private _graphTraversal?: GraphTraversal;
  private _agentMemoryManager?: AgentMemoryManager;

  constructor(config: ManagerContextConfig) {
    this.storage = createStorage(config);
    // Managers initialized lazily via getters
  }

  // Lazy getter example
  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }

  // Agent Memory System access
  agentMemory(config?: AgentMemoryConfig): AgentMemoryManager {
    return (this._agentMemoryManager ??= new AgentMemoryManager(this, config));
  }
}
```

**Key Features**:
- **Context Pattern**: Single holder for all manager instances
- **Lazy Initialization**: Managers created on-demand using `??=`
- **Dependency Injection**: Storage injected into all managers
- **Storage Abstraction**: Works with JSONL or SQLite
- **Agent Memory Access**: `agentMemory()` method for AI agent memory operations

### Layer 2: Manager Layer

#### EntityManager (`core/EntityManager.ts`)

**Responsibility**: Entity CRUD operations

```typescript
class EntityManager {
  constructor(private storage: IGraphStorage)

  // Core Operations
  async createEntities(entities: Entity[]): Promise<Entity[]>
  async getEntity(name: string, options?: GetEntityOptions): Promise<Entity | null>
  async listEntities(filter?: { entityType?: string }): Promise<Entity[]>
  async deleteEntities(names: string[]): Promise<void>
  async renameEntity(oldName: string, newName: string): Promise<Entity>

  // Tag Operations
  async addTags(entityName: string, tags: string[]): Promise<Entity>
  async removeTags(entityName: string, tags: string[]): Promise<Entity>
  async setImportance(entityName: string, importance: number): Promise<Entity>
}
```

#### RelationManager (`core/RelationManager.ts`)

**Responsibility**: Relation CRUD operations

```typescript
class RelationManager {
  constructor(private storage: IGraphStorage)

  async createRelations(relations: Relation[]): Promise<Relation[]>
  async getRelations(entityName: string): Promise<{incoming, outgoing}>
  async deleteRelations(relations: Relation[]): Promise<void>
}
```

#### SearchManager (`search/SearchManager.ts`)

**Responsibility**: Orchestrates multiple search strategies

```typescript
class SearchManager {
  // Delegates to specialized search implementations
  async search(query: string, options?): Promise<KnowledgeGraph>
  async searchRanked(query: string, options?): Promise<SearchResult[]>
  async booleanSearch(query: string, options?): Promise<KnowledgeGraph>
  async fuzzySearch(query: string, options?): Promise<KnowledgeGraph>
  async autoSearch(query: string, limit?: number): Promise<AutoSearchResult>
  async searchByTime(query: string, options?): Promise<Entity[]>
}
// Hybrid search lives on `HybridSearchManager`, not `SearchManager`.
```

`ManagerContext` also exposes `ctx.graphRankPrior` (`GraphRankPrior`, `@experimental`) — a cached normalized-PageRank/degree-centrality signal, event-invalidated via the storage's `GraphEventEmitter` — and `ctx.hybridSearchManager` (`HybridSearchManager`), both lazy getters. Neither is constructed unless a caller opts in via the graph-connectivity env vars (`MEMORY_HYBRID_GRAPH_WEIGHT`, `MEMORY_RANKED_GRAPH_BOOST`); `ctx.rankedSearch` also wires `setGraphPrior` automatically when `MEMORY_RANKED_GRAPH_BOOST > 0`.

#### GraphTraversal (`core/GraphTraversal.ts`)

**Responsibility**: Graph algorithms

```typescript
class GraphTraversal {
  async findShortestPath(from: string, to: string): Promise<PathResult | null>
  async findAllPaths(from: string, to: string, options?): Promise<string[][]>
  async findConnectedComponents(): Promise<ConnectedComponentsResult>
  async findCommunities(): Promise<CommunitiesResult>             // Louvain
  async findCliques(minSize?: number): Promise<string[][]>
  async calculateDegreeCentrality(): Promise<Map<string, number>>
  async calculateBetweennessCentrality(): Promise<Map<string, number>>
  async calculatePageRank(): Promise<Map<string, number>>
  async calculateHITS(): Promise<HITSResult>
  bfs(startNode: string, options?: TraversalOptions): TraversalResult
  dfs(startNode: string, options?: TraversalOptions): TraversalResult
}
```

#### AgentMemoryManager (`agent/AgentMemoryManager.ts`)

**Responsibility**: Unified facade for AI agent memory operations

```typescript
class AgentMemoryManager {
  // Session Management
  async startSession(options?: SessionOptions): Promise<SessionEntity>
  async endSession(sessionId: string): Promise<void>
  async getActiveSession(): Promise<SessionEntity | undefined>

  // Working Memory
  async addWorkingMemory(sessionId: string, content: string, options?): Promise<AgentEntity>
  async getWorkingMemories(sessionId: string): Promise<AgentEntity[]>
  async clearExpiredMemories(): Promise<number>

  // Memory Lifecycle
  async reinforceMemory(entityName: string): Promise<void>
  async promoteToLongTerm(entityName: string): Promise<void>
  async consolidateSession(sessionId: string, options?): Promise<ConsolidationResult>

  // Context-Aware Retrieval
  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
  async getMostSalient(context: SalienceContext, limit: number): Promise<ScoredEntity[]>

  // Decay Management
  start(): void   // Start decay scheduler
  stop(): void    // Stop decay scheduler
}
```

**Key Components**:
- **SessionManager**: Session lifecycle management
- **WorkingMemoryManager**: Short-term memory with TTL and promotion
- **DecayEngine**: TTL-aware importance decay with reinforcement
- **SalienceEngine**: Context-aware memory scoring with `freshnessWeight`
- **ContextWindowManager**: LLM token budget optimization + `DistillationPipeline`
- **MultiAgentMemoryManager**: Shared memory and conflict resolution
- **ArtifactManager**: Stable artifact creation with auto-registered refs
- **DistillationPipeline**: Post-retrieval policy-based memory filtering

**Phase 2 memory-type managers** (sit alongside `AgentMemoryManager` as
dedicated per-type write paths; accessed via `ctx.<getter>` rather than
through `AgentMemoryManager`):
- **ProspectiveMemoryManager** (`ctx.prospectiveMemory`) — intentions-to-act
  with discriminated `ProspectiveLifecycle` (`pending` / `fired` /
  `cancelled` / `expired`); `ProspectivePromotionStage` promotes fired
  `inject-context` actions to episodic. Catalog Type 4.
- **FailureManager** (`ctx.failureManager`) — pre-task failure lookup with
  structured `FailureRecord` (`applicability_hint` is the retrieval key);
  `markResolved` returns discriminated `MarkResolvedResult`. Catalog Type 9.
- **PlanManager** (`ctx.plan`) — hierarchical goal trees with branded
  `PlanId` / `GoalNodeId`, discriminated `PlanLifecycle` /
  `GoalNodeLifecycle`, `validatePlanInvariants` after every mutation,
  cycle-protected DFS. Catalog Type 6.
- **ReflectionManager** (`ctx.reflectionManager`) — additive reflections
  produced by `ReflectionStage` (pattern + trajectory + experience); content-
  hash dedup at create; `ReflectionScope` discriminator. Catalog Type 10.
- **TrustLevel mixin** on `MemorySource` (Sprint 6) — discriminated
  categorical label complementing the numeric `reliability`/`confidence`
  scores; powers the `'trust_level'` `ConflictStrategy`. Catalog Type 12
  (Provenance).

#### Features Module (`features/`)

**Components**: IOManager, ArchiveManager, StreamingExporter, AnalyticsManager, CompressionManager, TagManager, ObservationNormalizer, KeywordExtractor

#### CLI Module (`cli/`)

**6 files, ~1048 lines**. Binaries: `memory` / `memoryjs`.

- **`index.ts`**: Entry point, command registry and dispatch
- **`options.ts`**: CLI option parsing and validation
- **`config.ts`**: Config file support (`.memoryrc`, `memory.config.json`)
- **`formatters.ts`**: Output formatters (JSON, table, plain text)
- **`interactive.ts`**: Interactive REPL mode
- **`commands/index.ts`**: Command definitions and handlers

#### Search Infrastructure (`search/`)

Beyond the primary search classes, the search module includes:

- **Query optimization**: QueryPlanner, QueryCostEstimator, QueryPlanCache, ParallelSearchExecutor, EarlyTerminationManager
- **Specialized search**: ProximitySearch (term proximity scoring), SymbolicSearch (metadata filtering), SearchSuggestions
- **Parsing & logging**: QueryParser, QueryLogger
- **Indexing**: TFIDFIndexManager, TFIDFEventSync, OptimizedInvertedIndex, IncrementalIndexer
- **Scoring**: HybridScorer, SearchFilterChain
- **Retrieval**: ReflectionManager (progressive refinement), SavedSearchManager
- **Vector**: VectorStore, QuantizedVectorStore

#### Utils Infrastructure (`utils/`)

- **O(1) lookup indexes**: NameIndex, TypeIndex, LowercaseCache, RelationIndex, ObservationIndex
- **Caching**: SearchCache (LRU + TTL eviction)
- **Helpers**: RelationBuilder, SchemaValidator, TaskQueue

#### Types (`types/`)

- **`types/progress.ts`**: ProgressCallback, ProgressEvent, CancellationToken
- **`types/search.ts`**: QueryTrace, SearchExplanation, QueryNode types, QueryLogEntry

### Layer 3: Storage Layer

#### IGraphStorage Interface

```typescript
interface IGraphStorage {
  loadGraph(): Promise<ReadonlyKnowledgeGraph>
  getGraphForMutation(): Promise<KnowledgeGraph>
  saveGraph(graph: KnowledgeGraph): Promise<void>
  appendEntity(entity: Entity): Promise<void>
  appendRelation(relation: Relation): Promise<void>
  updateEntity(entityName: string, updates: Partial<Entity>): Promise<boolean>

  // Optional members — kept optional so third-party/test IGraphStorage
  // implementations remain valid without changes.
  renameEntity?(oldName: string, newName: string): Promise<Entity>
  readonly events?: GraphEventEmitter
  searchFTS?(query: string): Promise<Entity[]>
}
```

Both first-party backends (`GraphStorage`, `SQLiteStorage`) implement `renameEntity` and expose `events` — `EntityManager.renameEntity` requires the former; event-driven derived views (TF-IDF sync, `GraphRankPrior`, columnar observation mirroring) rely on the latter and now work identically on both backends.

#### GraphStorage (JSONL)

- Human-readable line-delimited JSON
- In-memory caching with write-through invalidation
- Atomic writes via temp file + rename
- Backward compatibility for legacy formats
- `GraphEventEmitter` (`storage.events`) for reactive derived views

#### SQLiteStorage

- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- Referential integrity with ON DELETE CASCADE
- ACID transactions
- `GraphEventEmitter` (`storage.events`) with full parity to `GraphStorage` — `graph:loaded`/`graph:saved`, `entity:created`/`updated`, `relation:created`, plus the manager-level rename sequence (`entity:renamed` → `entity:deleted` → `entity:created`). Previously only the JSONL backend emitted events, so TF-IDF sync, `GraphRankPrior`, and similar derived views silently went stale on SQLite; that gap is closed.
- `graphMutex` guards batch manager mutations (previously missing, which crashed batch operations against a raw SQLite backend)

#### SQLiteVectorStore

Persists vector embeddings to SQLite for semantic search, avoiding re-computation on restart.

---

## Data Model

### Entity

```typescript
interface Entity {
  name: string;              // Unique identifier (1-500 chars) — the public key
  id?: string;                // Stable opaque UUID, assigned at creation
                               // (crypto.randomUUID); preserved across
                               // updates/renames on both backends. `name`
                               // remains the public key; `id` is forward-
                               // compat infrastructure for v2 reference
                               // migration. SQLite auto-migrates the column
                               // (NULL backfill) at init.
  entityType: string;        // Category (e.g., "person", "project")
  observations: string[];    // Free-form text descriptions
  createdAt: string;         // ISO 8601 timestamp
  lastModified: string;      // ISO 8601 timestamp
  tags?: string[];           // Optional categorization (lowercase)
  importance?: number;       // Optional 0-10 priority
  parentId?: string;         // Optional hierarchical parent
  // v1.6.0: freshness governance
  ttl?: number;              // Optional time-to-live in milliseconds
  confidence?: number;       // Optional belief strength 0.0–1.0
  // v1.8.0: project scoping + memory versioning
  projectId?: string;
  version?: number;
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;
  // v1.11.0: MemoryEngine dedup
  contentHash?: string;      // SHA-256 of raw content — O(1) exact-equality dedup
}
```

`renameEntity(oldName, newName)` (`EntityManager`) is the storage-level primitive that keeps every stored reference to `name` consistent across a rename: it atomically rewrites `Relation.from`/`Relation.to`, other entities' `parentId`, and the version-chain fields (`parentEntityName`/`rootEntityName`/`supersededBy`) above, remaps `RefIndex` aliases, and emits `entity:renamed` → `entity:deleted` → `entity:created`. `id` is not yet a reference key anywhere in the codebase — `renameEntity` exists precisely because `name` still is.

### AgentEntity (extends Entity)

```typescript
interface AgentEntity extends Entity {
  memoryType: MemoryType;    // 'working' | 'episodic' | 'semantic' | 'procedural'
                             // | 'prospective' | 'failure' | 'plan' | 'reflection'
  sessionId?: string;        // Session grouping
  expiresAt?: string;        // TTL for working memory
  accessCount: number;       // Retrieval frequency
  lastAccessedAt?: string;   // Most recent access
  confidence: number;        // Belief strength (0.0-1.0)
  agentId?: string;          // Owning agent
  visibility: 'private' | 'team' | 'org' | 'shared' | 'public';
  source?: MemorySource;     // Provenance (with optional TrustLevel mixin)
}

// Per-type entity specializations extend AgentEntity with a typed record:
interface ProspectiveEntity extends AgentEntity { memoryType: 'prospective'; trigger: ProspectiveTrigger; action: ProspectiveAction; lifecycle: ProspectiveLifecycle; }
interface FailureEntity     extends AgentEntity { memoryType: 'failure';     failureRecord: FailureRecord; }
interface PlanEntity        extends AgentEntity { memoryType: 'plan';        planRecord: PlanRecord; }
interface ReflectionEntity  extends AgentEntity { memoryType: 'reflection';  reflectionRecord: ReflectionRecord; }
```

### Relation

```typescript
interface Relation {
  from: string;              // Source entity name
  to: string;                // Target entity name
  relationType: string;      // Relation type (e.g., "works_at")
  createdAt: string;         // ISO 8601 timestamp
  lastModified: string;      // ISO 8601 timestamp
}
```

### Knowledge Graph

```typescript
interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

---

## Key Design Decisions

### 1. Why Dual Storage Backends?

**Decision**: Support both JSONL and SQLite storage

**Rationale**:
- **JSONL**: Human-readable, easy debugging, simple deployment
- **SQLite**: FTS5 search, indexing, ACID transactions for larger graphs

**Trade-offs**:
- JSONL: Simpler but slower for large graphs
- SQLite: Faster search but requires native dependency

### 2. Why Lazy Initialization?

**Decision**: Managers created on-demand via getters

**Rationale**:
- Faster startup (no upfront initialization)
- Reduced memory for unused features
- Cleaner separation of concerns

### 3. Why Event-Driven TF-IDF Updates?

**Decision**: `GraphEventEmitter` triggers index updates on entity changes

**Rationale**:
- Keeps TF-IDF index synchronized without explicit calls
- Decouples storage operations from indexing
- Enables reactive search optimization

**Backend parity**: `SQLiteStorage` now exposes its own `GraphEventEmitter` with the same event surface as JSONL `GraphStorage`, so every event-driven derived view (`TFIDFEventSync`, `GraphRankPrior`, the columnar observation store) works identically regardless of storage backend — previously these only worked reliably on JSONL.

### 4. Why Worker Pool for Fuzzy Search?

**Decision**: Use `@danielsimonjr/workerpool` for Levenshtein calculations

**Rationale**:
- Levenshtein distance is CPU-intensive
- Worker pools prevent blocking main thread
- Enables parallel processing for large result sets

### 5. Why Deferred Integrity?

**Decision**: Allow relations to non-existent entities

**Rationale**:
- Flexibility: Create relations before entities exist
- Import/Export: Easier to reconstruct graphs
- Performance: No existence validation overhead

### 6. Why Unified Agent Memory Facade?

**Decision**: Single `AgentMemoryManager` facade for all agent memory operations

**Rationale**:
- Simplifies AI agent integration (one entry point)
- Coordinates complex memory lifecycle (decay, consolidation, retrieval)
- Encapsulates session management and working memory TTL
- Enables multi-agent support with conflict resolution

**Trade-offs**:
- Higher-level abstraction may hide granular control
- Additional complexity for simple use cases

### 7. Why a `Result<T, E>` Error-Handling Contract? (v2.0.0)

**Decision**: One documented error-signalling policy across the codebase
(`CONTRIBUTING.md` > Error Handling), backed by a `Result<T, E>`
discriminated-union type in `src/types/result.ts`.

**Rationale**:
- The v2.0.0 API audit found four error-signalling styles coexisting with
  no rule — `throw`, `return null`, discriminated unions, and silent
  swallowing — mixed even within single classes.
- The policy: **throw** for programmer errors (bad arguments, invariant
  violations); **return `Result<T, E>`** for expected domain failures the
  caller should branch on; **never swallow** silently; the absent-value
  sentinel is `T | undefined`, never `T | null`.
- `Result<T, E>` (`ok`/`err`/`isOk`/`isErr`/`unwrap`/`unwrapOr`/`mapOk`) is
  discriminated on an `ok` boolean — callers narrow with a plain
  `if (result.ok)`.

**Trade-offs**:
- The contract is established in v2.0.0; migrating every existing call
  site onto it is incremental follow-up work.

### 8. Why Stable Entity IDs + a `renameEntity` Primitive?

**Decision**: Add an optional `Entity.id` (UUID, assigned at creation, immutable thereafter) alongside a storage-level `renameEntity` primitive that atomically rewrites every reference to an entity's `name`.

**Rationale**:
- `name` is the primary key throughout the codebase (`Relation.from`/`to`, `parentId`, version-chain fields) — renaming an entity has always meant either leaving dangling references or hand-rolling a rewrite.
- `id` gives a stable, rename-proof handle for the future (v2 reference migration) without breaking any existing `name`-keyed code today — it is inert until adopted.
- `renameEntity` closes the immediate gap: relations, hierarchy, versioning, and `RefIndex` aliases all stay consistent across a rename on both storage backends.

**Trade-offs**:
- `id` is not yet used as a reference key anywhere — it is pure forward-compat cost until a v2 migration lands.
- `renameEntity` is an optional `IGraphStorage` member (not required), so third-party storage backends that don't implement it simply can't support renames yet.

### 9. Why Opt-In Graph-Connectivity Signals (Default Off)?

**Decision**: Layer a normalized-PageRank/degree-centrality signal (`GraphRankPrior`) on top of existing search and agent-memory scoring — `RankedSearch` boost, `HybridScorer` graph channel, `SalienceEngine` connectivity weight, `DecayEngine` connectivity protection — all gated behind env vars that default to `0` (off).

**Rationale**:
- The knowledge graph's own connectivity (which entities are well-linked) is a signal search and memory scoring weren't using at all; well-connected entities are frequently the ones worth surfacing or protecting from decay.
- Making every knob default to `0` means the feature is zero-overhead and behaviorally invisible until a deployment explicitly opts in — `GraphRankPrior` itself is never constructed unless a weight is non-zero.
- Centralizing the computation in one cached, event-invalidated class (`GraphRankPrior`) means every consumer shares one PageRank computation instead of each recomputing its own.

**Trade-offs**:
- Four independent opt-in knobs (`MEMORY_HYBRID_GRAPH_WEIGHT`, `MEMORY_RANKED_GRAPH_BOOST`, `MEMORY_SALIENCE_CONNECTIVITY_WEIGHT`, `MEMORY_DECAY_CONNECTIVITY_PROTECTION`) is more surface area than a single global switch, but lets each consumer tune independently.
- PageRank is skipped above 50,000 entities (degree-centrality fallback) — a deliberate scalability cap rather than an unbounded computation.

### 10. Why Enforce Governance Directly on `EntityManager` Rather Than a Parallel Transaction Path? (Unreleased — Sec1)

**Decision**: Wire `GovernanceManager`'s policy + audit log directly into `EntityManager` via a `setGovernanceHooks()` chokepoint, consulted inline by `createEntities`/`updateEntity`/`batchUpdate`/`deleteEntities`/`renameEntity`, rather than requiring callers to route writes through `GovernanceManager.withTransaction()`.

**Context**: `MEMORY_GOVERNANCE_ENABLED` and `ctx.governanceManager` existed before this change, but the env var was read nowhere in `src/` — it was a documented no-op. `GovernanceManager.withTransaction()` enforced policy only for callers who explicitly opted in to that API; every other mutation path (agent memory managers, the CLI, the reconstructive-memory storage backing) wrote straight through `EntityManager` with zero policy checks or audit trail, regardless of the env var.

**Rationale**:
- `EntityManager` is already the single mutation surface nearly every caller in the codebase goes through — a chokepoint there covers all of them by construction, rather than requiring every caller to remember to opt in to a second API.
- Policy is read *live* via `GovernanceManager.getPolicy()` inside the hooks (not snapshotted at wiring time), so `setPolicy()` calls after construction take effect immediately without re-wiring.
- Denials throw `GovernanceError` before any write happens (checked for the whole batch up front, matching delta persistence's all-or-nothing semantics); audit is fire-and-forget so an audit-sink outage can never fail or roll back a write that already succeeded — a deliberate trade-off documented on `GovernanceHooks`' JSDoc.
- The env-gate (`MEMORY_GOVERNANCE_ENABLED === 'true'`, strict literal, read once at first `entityManager` access) preserves zero-overhead behavior for the (default, unset) case — `setGovernanceHooks` is never called, so there's no hook object to check.

**Alternatives considered**:
| Option | Pros | Cons |
|---|---|---|
| **`EntityManager` chokepoint** (chosen) | Covers every caller automatically; single source of truth for "is this write governed" | Couples `core/` to a `features/` concept — `EntityManager` imports the `GovernancePolicy` type and `GovernanceError` class from `features/GovernanceManager.ts` (mitigated: `GovernanceHooks` only extends the policy shape, not the manager class itself, and `ManagerContext` — not `EntityManager` — owns constructing the `GovernanceManager` instance) |
| Keep `withTransaction()` as the only enforcement path | No new coupling | Silently ungoverned for every caller who doesn't use it — the exact gap this change closes |
| Event-based enforcement (listen for mutation events, veto after the fact) | Fully decoupled | Can't prevent a write before it happens — events fire post-commit; wrong shape for a "canCreate/canUpdate/canDelete" veto |

**Trade-offs**:
- `EntityManager` now has an optional dependency on a `GovernancePolicy`-shaped interface (structural, not a class import) — a small increase in its surface area for a capability most callers never enable.
- Sec1 governs `EntityManager` writes only; other direct-storage write paths (if any exist outside `EntityManager`) are not covered by this chokepoint and would need their own wiring.

---

## Storage Architecture

### JSONL Format

```jsonl
{"entities":[...],"relations":[...]}
```

Single line containing the entire graph as JSON. Simple, portable, human-readable.

### SQLite Schema

```sql
CREATE TABLE entities (
  name TEXT PRIMARY KEY,
  id TEXT,            -- stable opaque UUID (auto-migrated column, NULL-backfilled for pre-existing rows)
  entity_type TEXT NOT NULL,
  observations TEXT,  -- JSON array
  parent_id TEXT REFERENCES entities(name),
  tags TEXT,          -- JSON array
  importance INTEGER,
  created_at TEXT,
  last_modified TEXT
);

CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
  from_entity TEXT NOT NULL REFERENCES entities(name),
  to_entity TEXT NOT NULL REFERENCES entities(name),
  relation_type TEXT NOT NULL,
  created_at TEXT,
  last_modified TEXT,
  UNIQUE(from_entity, to_entity, relation_type)
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name, entity_type, observations,
  content='entities', content_rowid='rowid'
);
```

---

## Build & Packaging

**Unreleased — subpath exports, tree-shaking, and lazy heavy dependencies (S7–S10).**

Prior to this pass, `package.json` `exports` had only a `"."` entry and no `sideEffects` field, so any consumer importing from the package root pulled in 217 of the (then) 255 source files — including `chrono-node` (the heaviest external dependency) and the `better-sqlite3` native addon — regardless of which managers were actually used.

### `sideEffects: false` + 9 subpath exports (S7)

`package.json` now declares `"sideEffects": false` (the only real module-scope side effect in the whole tree, `globalMemoryMonitor` in `src/utils/MemoryMonitor.ts`, was confirmed not to be relied on for implicit registration) and adds dedicated ESM/CJS dual-condition subpath exports: `./core`, `./search`, `./agent`, `./features`, `./utils`, `./types`, `./sqlite`, alongside the root `.` entry. Bundlers can now tree-shake unused managers and consumers can import only the subsystem they need (e.g. `import { EntityManager } from '@danielsimonjr/memoryjs/core'` skips the search/agent/features barrels entirely).

### Lazy `chrono-node` (S8)

`TemporalQueryParser`'s top-level `import * as chrono from 'chrono-node'` became a lazy `await import('chrono-node')` at its actual call sites. `TemporalSearch.searchByTimeQuery` was already async, so no caller-visible signature change was needed. This removes the single heaviest external dependency from the default import path — warm root import dropped from ~220ms to ~150ms; the `./search` subpath alone imports in ~40ms.

### Lazy SQLite via a registration pattern (S9)

`StorageFactory` no longer statically imports `SQLiteStorage` (whose module top-level `import Database from 'better-sqlite3'` loads the native addon unconditionally). Instead, `SQLiteStorage`'s constructor is delivered through a small module-level registry (`registerSQLiteStorage`/`preloadSQLiteStorage` in `src/core/StorageFactory.ts`); `src/core/sqlite-register.ts` performs the registration as a module side effect, imported by the core barrel so ordinary `createStorage({ type: 'sqlite' })` callers see no change. Requesting SQLite before registration throws a descriptive error pointing at `preloadSQLiteStorage()` or an explicit `SQLiteStorage` import — never a cryptic ABI-mismatch crash for callers who never asked for SQLite. **Known gap**: the root package barrel (`src/index.ts`) still re-exports `SQLiteStorage` via the `core` barrel, so importing from the package root still eagerly evaluates it; only the new subpath imports (`./core` without the root, `./sqlite` explicitly) skip the native addon. Full removal from the default import graph is a documented v3 follow-up (`docs/development/OPTIMIZATION_OPPORTUNITIES.md`, item S9).

### Types layer as a leaf, ESLint-enforced (S10)

**Design decision**: `src/types/**` may only be imported *from*, never import implementation code — including type-only imports, which still create `tsc`/IDE recompile fan-out and were the source of all 37+ pre-existing circular dependencies (all type-only, zero runtime cost, but real developer-experience cost). Two ESLint rules in `eslint.config.mjs` enforce this on every file under `src/types/**/*.ts`:

- `no-restricted-imports` blocks any import matching `**/agent/**`, `**/core/**`, `**/utils/**`, `**/search/**`, `**/features/**`, `**/adapters/**`, `**/security/**`, `**/cli/**`, `**/workers/**`.
- `no-restricted-syntax` additionally catches inline `import('...')` type annotations (a `TSImportType` AST node) targeting the same directories — the historical escape hatch `no-restricted-imports` alone can't see, and the one that created the pre-existing cycles.

Where a type genuinely needs to be shared, the shared type moves *into* `src/types` and the implementation module re-exports it (not the other way around). Result: type-only circular dependencies dropped from 39 to 4; runtime circular dependencies are 0. Separately, `ManagerContext`'s import of the search barrel for three symbols (`SemanticSearch`, `createEmbeddingService`, `createVectorStore`, previously pulling in ~70 files including chrono-node and workerpool transitively) was narrowed to their concrete source files.

---

## Performance Considerations

### Benchmarks

| Operation | Scale | Target | Notes |
|-----------|-------|--------|-------|
| Create entities | 100 | <200ms | Single I/O cycle |
| Create entities | 1000 | <1500ms | Batch processing |
| Basic search | 500 entities | <100ms | Cached graph |
| Ranked search | 500 entities | <600ms | TF-IDF calculation |
| Boolean search | 500 entities | <150ms | AST evaluation |
| Fuzzy search | 500 entities | <200ms | Worker pool |
| BM25 search | 500 entities | <400ms | Okapi BM25 with stopwords |
| Hybrid search | 500 entities | <800ms | Combined semantic+lexical+symbolic |
| Semantic search | 500 entities | <500ms | Vector similarity |
| Query planning | - | <50ms | Plan generation + caching |
| Parallel execution | 500 entities | <600ms | Multi-layer concurrent search |
| Find duplicates | 100 | <300ms | Bucketed comparison |

### Optimization Strategies

1. **Batch Operations**: Single I/O cycle for multiple operations
2. **In-Memory Caching**: Graph cached with write-through invalidation
3. **Efficient Algorithms**: TF-IDF, Levenshtein with early termination
4. **Type Bucketing**: Reduce O(n²) to O(n²/k) for similarity
5. **Lazy Initialization**: Managers created on-demand
6. **Worker Parallelism**: CPU-intensive operations offloaded
7. **Query Planning & Caching**: QueryPlanner generates execution plans, QueryPlanCache avoids re-planning
8. **Parallel Search Layers**: ParallelSearchExecutor runs independent search strategies concurrently
9. **Early Termination**: EarlyTerminationManager stops search when sufficient results found
10. **Incremental Indexing**: IncrementalIndexer updates TF-IDF index on entity changes without full rebuild

### Scalability Limits

**Current Design**:
- 0-2000 entities: Excellent performance
- 2000-5000 entities: Good performance
- 5000-10000 entities: Acceptable performance
- 10000+ entities: Consider SQLite or redesign

---

## Security Architecture

### Input Validation

- All inputs validated using Zod schemas (SchemaValidator)
- Prototype pollution prevention via `sanitizeObject` function

### Path Traversal Protection

- `validateFilePath` with `confineToBase` parameter for directory confinement
- Derived paths (e.g., appending `.meta.json`) re-validated independently to prevent escape

### Query Sanitization

- **FTS5 queries**: Strip `:{}()"^~*` and boolean keywords `NEAR/AND/OR/NOT` before passing to SQLite
- **LIKE queries**: Escape `\`, `%`, `_` with `ESCAPE '\'` clause

### XML Import Safety

- Decode XML entities (`&amp;` -> `&`, `&lt;` -> `<`, etc.) rather than stripping characters
- Preserves data integrity for names like "AT&T", "O'Brien"

### Worker Error Handling

- Worker errors wrapped with `new Error(err.message)` before re-throwing to strip internal stack traces

### No Code Injection

- No `eval()` or `Function()` calls
- Boolean query parser uses safe AST-based tokenization

### Governance, Audit & Authentication (Unreleased — Sec1/Sec5/Sec6/Sec9)

- **Governance enforcement chokepoint (Sec1)**: `MEMORY_GOVERNANCE_ENABLED='true'` wires policy checks + audit logging directly into `EntityManager` mutations — see [Key Design Decision #10](#key-design-decisions) for the full rationale.
- **Tamper-evident audit log (Sec5)**: `AuditLog` entries are hash-chained (monotonic `seq` + SHA-256 `prevHash`); `verifyChain()` detects tampering, reordering, or truncation of any line but the last. File mode `0600`. Documented honestly as tamper-*evident*, not tamper-*proof* (see the `AuditLog` module JSDoc's trust-boundary note).
- **PII redaction (Sec6)**: opt-in `redactPii` on `IOManager` exports/backups and opt-in `redactAuditSnapshots` on `GovernanceManager` — both pass observation text through `PiiRedactor` on a copy; the live graph is never mutated.
- **REST authentication (Sec9)**: `ApiKeyAuthMiddleware` wires `APIKeyStore.validate()` into `RestRouter` — Bearer/`X-Api-Key` extraction, per-route scope enforcement (`GET` → no scope required, mutating methods → `entities:write` by default), timing-safe key comparison. Previously `APIKeyStore` existed but had zero wiring into the REST adapter.
- **Decompression bomb caps (Sec8)**: Brotli/zlib decompression now enforces a default 256 MB output cap (`MEMORY_MAX_DECOMPRESSED_BYTES`), closing an unbounded-expansion path in `BackupManager.restore` and related decompression call sites.

---

## Testing Strategy

### Test Pyramid

```
            /\
           /  \
          / E2E \ (Edge cases)
         /______\
        /        \
       / Integr.  \ (Workflows, streaming, compression)
      /____________\
     /              \
    /   Unit Tests   \ (Per-module)
   /                  \
  /____________________\
 /                      \
/   Performance Tests    \ (Benchmarks)
```

### Test Organization

| Directory | Purpose |
|-----------|---------|
| `tests/unit/agent/` | Agent memory system tests |
| `tests/unit/core/` | Core manager tests |
| `tests/unit/search/` | Search implementation tests |
| `tests/unit/features/` | Feature manager tests |
| `tests/integration/` | Cross-module workflows |
| `tests/performance/` | Benchmarks |
| `tests/edge-cases/` | Boundary conditions |

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

---

## Conclusion

The MemoryJS architecture prioritizes:
- **Simplicity**: Easy to understand and maintain
- **Performance**: Efficient for typical use cases (<5000 entities)
- **Testability**: Clean interfaces, dependency injection
- **Extensibility**: Modular design, clear interfaces
- **Flexibility**: Multiple storage backends, search strategies
- **AI Agent Support**: Comprehensive memory lifecycle for LLM-powered agents

