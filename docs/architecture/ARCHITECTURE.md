# MemoryJS - System Architecture

**Version**: 1.0.0
**Last Updated**: 2026-01-10

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
- **Compression**: Automatic duplicate detection and merging
- **Tagging & Importance**: Flexible categorization and prioritization
- **Timestamps**: Automatic tracking of creation and modification times
- **Batch Operations**: Efficient bulk updates
- **Graph Algorithms**: Shortest path, centrality, connected components

### Key Statistics (v1.0.0)

| Metric | Value |
|--------|-------|
| Source Files | 73 TypeScript files |
| Lines of Code | ~29,000 lines |
| Exports | 558 total (333 re-exports) |
| Classes | 73 |
| Interfaces | 145 |
| Functions | 100 |
| Circular Dependencies | 2 (type-only, safe) |

### Module Distribution

| Module | Files | Key Exports |
|--------|-------|-------------|
| `core/` | 12 | EntityManager, GraphStorage, SQLiteStorage, TransactionManager |
| `search/` | 29 | SearchManager, BM25Search, HybridScorer, VectorStore |
| `features/` | 9 | IOManager, ArchiveManager, StreamingExporter |
| `utils/` | 18 | BatchProcessor, CompressedCache, WorkerPoolManager |
| `types/` | 2 | Entity, Relation, KnowledgeGraph interfaces |
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
│                  Application / MCP Server                    │
└───────────────────────────┬──────────────────────────────────┘
                            │ Library API
┌───────────────────────────┴──────────────────────────────────┐
│                      MemoryJS Library                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Layer 1: ManagerContext (Central Facade)              │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ Lazy-initialized getters for all managers        │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────┬───────────────────────────┘ │
│                               │                              │
│  ┌────────────────────────────┴───────────────────────────┐ │
│  │  Layer 2: Manager Layer                                │ │
│  │  ┌──────────────┬────────────────┬──────────────────┐  │ │
│  │  │ core/        │ search/        │ features/        │  │ │
│  │  │ EntityMgr    │ SearchMgr      │ IOManager        │  │ │
│  │  │ RelationMgr  │ BasicSearch    │ TagMgr           │  │ │
│  │  │ HierarchyMgr │ RankedSearch   │ AnalyticsMgr     │  │ │
│  │  │ TransactMgr  │ BooleanSearch  │ ArchiveMgr       │  │ │
│  │  │ GraphTraverse│ FuzzySearch    │ CompressionMgr   │  │ │
│  │  │              │ HybridSearch   │                  │  │ │
│  │  │              │ SemanticSearch │                  │  │ │
│  │  └──────────────┴────────────────┴──────────────────┘  │ │
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
3. **File System**: Persistent storage for knowledge graph

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

  constructor(config: ManagerContextConfig) {
    this.storage = createStorage(config);
    // Managers initialized lazily via getters
  }

  // Lazy getter example
  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }
}
```

**Key Features**:
- **Context Pattern**: Single holder for all manager instances
- **Lazy Initialization**: Managers created on-demand using `??=`
- **Dependency Injection**: Storage injected into all managers
- **Storage Abstraction**: Works with JSONL or SQLite

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
| Find duplicates | 100 | <300ms | Bucketed comparison |

### Optimization Strategies

1. **Batch Operations**: Single I/O cycle for multiple operations
2. **In-Memory Caching**: Graph cached with write-through invalidation
3. **Efficient Algorithms**: TF-IDF, Levenshtein with early termination
4. **Type Bucketing**: Reduce O(n²) to O(n²/k) for similarity
5. **Lazy Initialization**: Managers created on-demand
6. **Worker Parallelism**: CPU-intensive operations offloaded

### Scalability Limits

**Current Design**:
- 0-2000 entities: Excellent performance
- 2000-5000 entities: Good performance
- 5000-10000 entities: Acceptable performance
- 10000+ entities: Consider SQLite or redesign

---

## Security Architecture

### Input Validation

**All inputs validated using Zod schemas**:

```typescript
const EntitySchema = z.object({
  name: z.string().min(1).max(500).trim(),
  entityType: z.string().min(1).max(100).trim(),
  observations: z.array(z.string().min(1).max(5000)),
  tags: z.array(z.string().min(1).max(100)).optional(),
  importance: z.number().min(0).max(10).int().optional(),
});
```

### Path Traversal Protection

```typescript
const resolvedPath = path.resolve(filePath);
const baseDir = path.resolve('.');
if (!resolvedPath.startsWith(baseDir)) {
  throw new SecurityError('Path traversal attempt');
}
```

### No Code Injection

- No `eval()` or `Function()` calls
- Safe string handling (no template injection)
- Boolean query parser uses safe tokenization

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

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Maintained By**: Daniel Simon Jr.
