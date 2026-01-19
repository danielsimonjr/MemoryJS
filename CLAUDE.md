# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MemoryJS is a TypeScript knowledge graph library for managing entities, relations, and observations with advanced search capabilities. It supports multiple storage backends (JSONL, SQLite) and provides features like hierarchical organization, graph algorithms, and hybrid search.

## Common Commands

```bash
# Build
npm run build           # Compile TypeScript to dist/
npm run build:watch     # Watch mode compilation
npm run clean           # Remove dist/ directory

# Test
npm run test            # Run all tests once
npm run test:watch      # Watch mode
npm run test:coverage   # Run with coverage report

# Run a single test file
npx vitest run tests/unit/core/EntityManager.test.ts

# Type checking
npm run typecheck       # Check types without emitting

# Tools (utilities in tools/ directory)
npm run tools:install   # Install tool subdependencies
npm run tools:build     # Build all tools

# Skip performance benchmarks
SKIP_BENCHMARKS=true npm test
```

## Architecture

### Module Organization

```
src/
├── agent/     # Agent Memory System (sessions, working memory, episodic, decay)
├── core/      # Storage backends, entity/relation/observation managers, transactions
├── search/    # Search algorithms (BM25, TF-IDF, fuzzy, semantic, hybrid)
├── features/  # Import/export, compression, analytics, archiving
├── utils/     # Caching, errors, indexing, batch processing
├── types/     # TypeScript interfaces (Entity, Relation, etc.)
└── workers/   # Worker pool for CPU-intensive tasks (Levenshtein)
```

### Key Components

**ManagerContext** (`src/core/ManagerContext.ts`): Central facade providing lazy-initialized access to all managers:
```typescript
// JSONL storage (default)
const ctx = new ManagerContext({ storagePath: './memory.jsonl' });

// SQLite storage
const ctx = new ManagerContext({ storageType: 'sqlite', storagePath: './memory.db' });

ctx.entityManager       // Entity CRUD + tags
ctx.relationManager     // Relation CRUD
ctx.observationManager  // Observation CRUD
ctx.hierarchyManager    // Entity hierarchy (parent/child, ancestors, descendants)
ctx.searchManager       // All search operations
ctx.rankedSearch        // TF-IDF/BM25 ranked search
ctx.graphTraversal      // Path finding, centrality, connected components
ctx.ioManager           // Import/export/backup/restore
ctx.tagManager          // Tag aliases and management
ctx.analyticsManager    // Graph statistics and validation
ctx.compressionManager  // Duplicate detection, entity merging
ctx.archiveManager      // Entity archival to compressed storage
ctx.semanticSearch      // Vector similarity (requires embedding provider)
ctx.agentMemory()       // Agent Memory System facade
```

**Storage Layer** (`src/core/StorageFactory.ts`): Two backends selected via `MEMORY_STORAGE_TYPE` env var:
- `GraphStorage` (JSONL, default): Human-readable, in-memory caching, atomic writes via temp file + rename
- `SQLiteStorage`: FTS5 full-text search with BM25, WAL mode, ACID transactions, better-sqlite3

**Search System** (`src/search/`):
- `BasicSearch`: Simple substring matching
- `RankedSearch`: TF-IDF scoring via `TFIDFIndexManager`
- `BM25Search`: Okapi BM25 algorithm with stopwords
- `BooleanSearch`: AND/OR/NOT operators with AST parsing
- `FuzzySearch`: Levenshtein distance via worker pool
- `SemanticSearch`: Vector similarity (requires embedding provider)
- `HybridSearchManager`: Combines semantic, lexical, and symbolic signals with configurable weights
- `QueryAnalyzer`/`QueryPlanner`: Query understanding, cost estimation, execution planning
- `ReflectionManager`: Reflection-based retrieval with progressive refinement
- `SavedSearchManager`: Saved search persistence and execution

**Agent Memory System** (`src/agent/`): Complete memory system for AI agents:
- `AgentMemoryManager`: Unified facade for agent memory operations
- `SessionManager`: Session lifecycle (start, end, query sessions)
- `WorkingMemoryManager`: Short-term memory with TTL and promotion to long-term
- `EpisodicMemoryManager`: Timeline-based event memories with temporal ordering
- `DecayEngine`/`DecayScheduler`: Time-based memory importance decay
- `SalienceEngine`: Context-aware memory scoring based on keywords/relevance
- `MultiAgentMemoryManager`: Shared memory with visibility controls (private/shared/public)
- `ConflictResolver`: Resolution strategies for concurrent updates

### Data Model

**Entity** (`src/types/types.ts`): Primary graph nodes with:
- `name` (unique identifier), `entityType`, `observations[]`
- Optional: `parentId` (hierarchy), `tags[]`, `importance` (0-10), timestamps

**Relation**: Directed edges with `from`, `to`, `relationType` fields.

### Features (`src/features/`)

- `IOManager`: Import/export in JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid formats
- `StreamingExporter`: Streaming export for large graphs with Brotli compression
- `AnalyticsManager`: Graph statistics, validation, duplicate detection
- `CompressionManager`: Entity merging, graph compression
- `ArchiveManager`: Archive old/low-importance entities
- `TagManager`: Tag alias management and resolution
- `ObservationNormalizer`: Pronoun resolution, relative date anchoring
- `KeywordExtractor`: Keyword extraction from text

### Graph Algorithms (`src/core/GraphTraversal.ts`)

- Shortest path (Dijkstra), all paths enumeration
- Connected components detection
- Centrality metrics: degree, betweenness, PageRank
- Hierarchy traversal: ancestors, descendants, subtrees

### Key Patterns

- Storage abstraction: Both backends implement same interface via duck typing
- Lazy initialization: Managers created on first access via getters
- Event-driven cache invalidation: `GraphEventEmitter` notifies subscribers on changes
- TF-IDF auto-sync: `TFIDFEventSync` keeps index current with storage
- Worker pool: CPU-intensive Levenshtein calculations offloaded to workers
- Transaction support: `TransactionManager` for atomic batch operations

## Testing

Test organization:
- `tests/unit/` - Unit tests per module
- `tests/integration/` - Cross-module workflows
- `tests/performance/` - Benchmarks
- `tests/edge-cases/` - Boundary conditions

Vitest with 30s timeout. Coverage excludes `index.ts` barrel files.

## Environment Variables

| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite` | `jsonl` |
| `MEMORY_FILE_PATH` | Custom storage file path | - |
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` |
| `MEMORY_OPENAI_API_KEY` | API key string | - |
| `MEMORY_EMBEDDING_MODEL` | Model name override | - |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | `true`, `false` | `false` |
| `SKIP_BENCHMARKS` | `true`, `false` | `false` (run benchmarks) |

## Documentation

```
docs/
├── architecture/   # Design patterns, component interactions, data flow
│   └── AGENT_MEMORY.md  # Agent memory system design (short/long-term)
├── guides/         # Usage guides (API reference, configuration, recipes)
├── roadmap/        # Future development roadmap
└── development/    # Contributing, debugging, architecture decisions
```

Key documents:
- `docs/architecture/AGENT_MEMORY.md` - Comprehensive agent memory system design
- `docs/roadmap/ROADMAP.md` - Feature roadmap with implementation details
- `docs/guides/IMPLEMENTATION_GUIDE.md` - Detailed implementation patterns
