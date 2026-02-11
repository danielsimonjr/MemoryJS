# MemoryJS - System Architecture

**Version**: 1.5.0
**Last Updated**: 2026-02-11

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [System Context](#system-context)
4. [Component Architecture](#component-architecture)
5. [Data Model](#data-model)
6. [Key Design Decisions](#key-design-decisions)
7. [Storage Architecture](#storage-architecture)
8. [Performance Considerations](#performance-considerations)
9. [Security Architecture](#security-architecture)
10. [Testing Strategy](#testing-strategy)

---

## System Overview

MemoryJS is a TypeScript knowledge graph library providing:

- **Entity-Relation Knowledge Graph**: Store and query interconnected knowledge
- **Hierarchical Organization**: Parent-child entity relationships
- **Advanced Search**: Basic, ranked (TF-IDF/BM25), boolean, fuzzy, semantic, and hybrid search
- **Agent Memory System**: Working memory, episodic memory, decay, and multi-agent support
- **Compression**: Automatic duplicate detection and merging
- **Tagging & Importance**: Flexible categorization and prioritization
- **Timestamps**: Automatic tracking of creation and modification times
- **Batch Operations**: Efficient bulk updates
- **Graph Algorithms**: Shortest path, centrality, connected components

### Key Statistics (v1.5.0)

| Metric | Value |
|--------|-------|
| Source Files | 110 TypeScript files |
| Lines of Code | ~43,000 lines |
| Exports | 770 total (460 re-exports) |
| Classes | 98 |
| Interfaces | 249 |
| Functions | 157 |
| Circular Dependencies | 3 (1 runtime, 2 type-only) |

### Module Distribution

| Module | Files | Key Exports |
|--------|-------|-------------|
| `agent/` | 19 | AgentMemoryManager, SessionManager, DecayEngine, WorkingMemoryManager |
| `core/` | 12 | EntityManager, GraphStorage, SQLiteStorage, TransactionManager |
| `search/` | 32 | SearchManager, BM25Search, HybridScorer, VectorStore |
| `features/` | 9 | IOManager, ArchiveManager, StreamingExporter |
| `utils/` | 24 | BatchProcessor, CompressedCache, WorkerPoolManager |
| `types/` | 5 | Entity, Relation, AgentEntity, SessionEntity interfaces |
| `workers/` | 2 | Levenshtein distance calculations |

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
│  │  │ ContextWin│           │ HybridSrch │             │  │ │
│  │  │ MultiAgent│           │ SemanticSrch             │  │ │
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
  async getEntityByName(name: string): Promise<Entity | null>
  async deleteEntities(names: string[]): Promise<void>

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
  async hybridSearch(query: string, options?): Promise<HybridSearchResult>
}
```

#### GraphTraversal (`core/GraphTraversal.ts`)

**Responsibility**: Graph algorithms

```typescript
class GraphTraversal {
  async findShortestPath(from: string, to: string): Promise<string[]>
  async findAllPaths(from: string, to: string, options?): Promise<string[][]>
  async getCentrality(options?): Promise<Map<string, number>>
  async getConnectedComponents(): Promise<string[][]>
  async bfs(startNode: string, visitor: Function): Promise<void>
  async dfs(startNode: string, visitor: Function): Promise<void>
}
```

#### AgentMemoryManager (`agent/AgentMemoryManager.ts`)

**Responsibility**: Unified facade for AI agent memory operations

```typescript
class AgentMemoryManager {
  // Session Management
  async startSession(options?: SessionOptions): Promise<SessionEntity>
  async endSession(sessionId: string): Promise<void>
  async getActiveSession(): Promise<SessionEntity | null>

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
- **DecayEngine**: Time-based importance decay with reinforcement
- **SalienceEngine**: Context-aware memory scoring
- **ContextWindowManager**: LLM token budget optimization
- **MultiAgentMemoryManager**: Shared memory and conflict resolution

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
  loadGraph(): Promise<KnowledgeGraph>
  saveGraph(graph: KnowledgeGraph): Promise<void>

  // Optional methods for SQLite
  searchFTS?(query: string): Promise<Entity[]>
}
```

#### GraphStorage (JSONL)

- Human-readable line-delimited JSON
- In-memory caching with write-through invalidation
- Atomic writes via temp file + rename
- Backward compatibility for legacy formats

#### SQLiteStorage

- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- Referential integrity with ON DELETE CASCADE
- ACID transactions

#### SQLiteVectorStore

Persists vector embeddings to SQLite for semantic search, avoiding re-computation on restart.

---

## Data Model

### Entity

```typescript
interface Entity {
  name: string;              // Unique identifier (1-500 chars)
  entityType: string;        // Category (e.g., "person", "project")
  observations: string[];    // Free-form text descriptions
  createdAt: string;         // ISO 8601 timestamp
  lastModified: string;      // ISO 8601 timestamp
  tags?: string[];           // Optional categorization (lowercase)
  importance?: number;       // Optional 0-10 priority
  parentId?: string;         // Optional hierarchical parent
}
```

### AgentEntity (extends Entity)

```typescript
interface AgentEntity extends Entity {
  memoryType: 'working' | 'episodic' | 'semantic';  // Memory classification
  sessionId?: string;        // Session grouping
  expiresAt?: string;        // TTL for working memory
  accessCount: number;       // Retrieval frequency
  lastAccessedAt?: string;   // Most recent access
  confidence: number;        // Belief strength (0.0-1.0)
  agentId?: string;          // Owning agent
  visibility: 'private' | 'shared' | 'public';
}
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

