# MemoryJS - Project Overview

**Version**: 1.2.0
**Last Updated**: 2026-01-14

## What Is This?

MemoryJS is a **TypeScript knowledge graph library** for managing entities, relations, and observations with advanced search capabilities. It provides the core foundation for building knowledge management systems and can be used as a library in other applications or as the backend for MCP servers.

## Key Capabilities

| Feature | Description |
|---------|-------------|
| **Knowledge Graph** | Store entities and relations in a flexible graph structure |
| **Multiple Backends** | JSONL (human-readable) or SQLite (indexed, FTS5) storage |
| **Hierarchical Nesting** | Parent-child relationships for tree organization |
| **Advanced Search** | Basic, TF-IDF ranked, boolean, fuzzy, semantic, and hybrid search |
| **Agent Memory System** | Working memory, episodic memory, decay, multi-agent support |
| **Duplicate Detection** | Intelligent compression with similarity scoring |
| **Graph Algorithms** | Shortest path, centrality, connected components, BFS/DFS traversal |
| **Multi-format Export** | JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid |
| **Tag Management** | Aliases, bulk operations, and validation |

## Quick Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│              Application / MCP Server / AI Agent        │
└───────────────────────┬────────────────────────────────┘
                        │ (library usage)
┌───────────────────────┴────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade)              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Lazy-initialized access to all managers          │  │
│  │ ctx.agentMemory() - Agent Memory System          │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────┬────────────────────────────────┘
                        │ (direct manager access)
┌───────────────────────┴────────────────────────────────┐
│  Layer 2: Specialized Managers                         │
│  • EntityManager       (CRUD + hierarchy + archive)    │
│  • RelationManager     (relation CRUD)                 │
│  • SearchManager       (search + compression + analytics)
│  • IOManager           (import + export + backup)      │
│  • TagManager          (tag aliases)                   │
│  • GraphTraversal      (graph algorithms)              │
│  • AgentMemoryManager  (session, working memory, decay)│
└───────────────────────┬────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────┐
│  Layer 3: Storage Layer                                │
│  GraphStorage (JSONL) or SQLiteStorage (better-sqlite3)│
└────────────────────────────────────────────────────────┘
```

## Data Model

### Entity (Graph Node)
```typescript
interface Entity {
  name: string;           // Unique identifier
  entityType: string;     // Classification (person, project, concept)
  observations: string[]; // Facts/notes about the entity
  parentId?: string;      // Hierarchical parent (optional)
  tags?: string[];        // Categories (lowercase, optional)
  importance?: number;    // Priority 0-10 (optional)
  createdAt?: string;     // ISO 8601 timestamp
  lastModified?: string;  // ISO 8601 timestamp
}
```

### Relation (Graph Edge)
```typescript
interface Relation {
  from: string;         // Source entity name
  to: string;           // Target entity name
  relationType: string; // Relationship type (works_at, knows, etc.)
}
```

## Directory Structure

```
src/ (93 TypeScript files, ~41,000 lines of code, 657 exports)
├── index.ts              # Entry point, main exports
│
├── agent/ (19 files)     # Agent Memory System
│   ├── AgentMemoryManager.ts     # Unified facade for all agent operations
│   ├── AgentMemoryConfig.ts      # Configuration with env var loading
│   ├── SessionManager.ts         # Session lifecycle management
│   ├── WorkingMemoryManager.ts   # Short-term memory with promotion
│   ├── EpisodicMemoryManager.ts  # Timeline-based episodic memory
│   ├── DecayEngine.ts            # Time-based importance decay
│   ├── DecayScheduler.ts         # Scheduled decay cycles
│   ├── SalienceEngine.ts         # Context-aware memory scoring
│   ├── ContextWindowManager.ts   # LLM context window management
│   ├── MemoryFormatter.ts        # Memory-to-prompt formatting
│   ├── MultiAgentMemoryManager.ts # Multi-agent shared memory
│   ├── ConflictResolver.ts       # Conflict resolution strategies
│   ├── ConsolidationPipeline.ts  # Memory consolidation pipeline
│   ├── SummarizationService.ts   # Memory summarization
│   ├── PatternDetector.ts        # Pattern detection
│   ├── RuleEvaluator.ts          # Rule-based evaluation
│   ├── AccessTracker.ts          # Access pattern tracking
│   └── index.ts                  # Barrel export
│
├── core/ (12 files)      # Core managers and storage
│   ├── ManagerContext.ts         # Context holder (lazy init)
│   ├── EntityManager.ts          # Entity CRUD operations
│   ├── RelationManager.ts        # Relation CRUD
│   ├── ObservationManager.ts     # Observation add/delete
│   ├── HierarchyManager.ts       # Parent-child relationships
│   ├── GraphStorage.ts           # JSONL file I/O, caching
│   ├── SQLiteStorage.ts          # SQLite backend (better-sqlite3)
│   ├── StorageFactory.ts         # Storage backend factory
│   ├── TransactionManager.ts     # Batch operations
│   ├── GraphTraversal.ts         # Graph algorithms
│   ├── GraphEventEmitter.ts      # Event-driven updates
│   └── index.ts                  # Barrel export
│
├── search/ (29 files)    # Search implementations
│   ├── SearchManager.ts          # Search orchestrator
│   ├── BasicSearch.ts            # Text matching
│   ├── RankedSearch.ts           # TF-IDF scoring
│   ├── BM25Search.ts             # BM25 ranking algorithm
│   ├── BooleanSearch.ts          # AND/OR/NOT logic
│   ├── FuzzySearch.ts            # Levenshtein matching
│   ├── SemanticSearch.ts         # Vector similarity search
│   ├── HybridSearchManager.ts    # Three-layer hybrid search
│   └── ...
│
├── features/ (9 files)   # Advanced capabilities
│   ├── TagManager.ts             # Tag aliases
│   ├── IOManager.ts              # Import + export + backup
│   ├── ArchiveManager.ts         # Entity archival
│   ├── CompressionManager.ts     # Duplicate detection
│   └── ...
│
├── types/ (3 files)      # TypeScript definitions
│   ├── types.ts                  # Core type definitions
│   ├── agent-memory.ts           # Agent memory types
│   └── index.ts                  # Barrel export
│
├── utils/ (18 files)     # Shared utilities
│   ├── schemas.ts                # Zod validation schemas
│   ├── BatchProcessor.ts         # Batch processing utilities
│   ├── WorkerPoolManager.ts      # Worker pool management
│   └── ...
│
└── workers/ (2 files)    # Web workers for CPU-intensive tasks
    ├── levenshteinWorker.ts      # Levenshtein calculations
    └── index.ts
```


## Key Design Principles

1. **Context Pattern**: `ManagerContext` holds all managers with lazy-initialized getters
2. **Lazy Initialization**: Managers instantiated on-demand using `??=` operator
3. **Dual Storage Backends**: JSONL (default) or SQLite (via `storageType: 'sqlite'`)
4. **Dependency Injection**: `IGraphStorage` injected into managers for testability
5. **Barrel Exports**: Each module exports through `index.ts`
6. **Worker Parallelism**: Fuzzy search uses `@danielsimonjr/workerpool` for parallel processing
7. **Event-Driven Updates**: `GraphEventEmitter` triggers TF-IDF index updates on entity changes

## Performance Characteristics

- **Entities**: Handles 2,000+ efficiently; 5,000+ with acceptable performance
- **Batch Operations**: Single I/O cycle for bulk operations
- **Caching**: In-memory graph caching with write-through invalidation
- **Duplicate Detection**: O(n²/k) via entityType bucketing (50x faster than naive)
- **Search**: TF-IDF index for relevance ranking; Levenshtein for fuzzy matching
- **SQLite**: FTS5 full-text search with BM25 ranking, WAL mode concurrency

## Storage Files

| File | Purpose |
|------|---------|
| `memory.jsonl` | Main graph (entities + relations) |
| `memory.db` | SQLite database (alternative backend) |
| `*-saved-searches.jsonl` | Saved search queries |
| `*-tag-aliases.jsonl` | Tag synonym mappings |

## Getting Started

```bash
# Install
npm install @danielsimonjr/memoryjs

# Basic usage
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext({ storagePath: './memory.jsonl' });

// Create entities
await ctx.entityManager.createEntities([
  { name: 'TypeScript', entityType: 'language', observations: ['Typed superset of JavaScript'] }
]);

// Search
const results = await ctx.searchManager.search('TypeScript');
```

## Environment Variables

- `MEMORY_STORAGE_TYPE`: `jsonl` (default) or `sqlite`
- `EMBEDDING_PROVIDER`: `openai`, `local`, or `none` for semantic search
- `OPENAI_API_KEY`: Required when using OpenAI embeddings

## Related Documentation

- **[Architecture Details](./ARCHITECTURE.md)** - In-depth technical architecture
- **[Component Reference](./COMPONENTS.md)** - Complete component documentation
- **[Agent Memory System](./AGENT_MEMORY.md)** - AI agent memory documentation
- **[Data Flow](./DATAFLOW.md)** - Data flow patterns
- **[API Reference](./API.md)** - Public API documentation
- **[Dependency Graph](./DEPENDENCY_GRAPH.md)** - Complete dependency analysis
- **[Test Coverage](./TEST_COVERAGE.md)** - Test coverage analysis

---

**Maintained by**: Daniel Simon Jr.
