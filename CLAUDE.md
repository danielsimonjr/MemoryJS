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

# Run tools directly
node tools/create-dependency-graph/create-dependency-graph.ts  # Generate dependency docs
node tools/chunking-for-files/chunking-for-files.ts split <file>  # Split large files
node tools/chunking-for-files/chunking-for-files.ts merge <manifest.json>  # Merge back

# Skip performance benchmarks
SKIP_BENCHMARKS=true npm test

# CLI (after build)
npx memory --help                           # Show all commands
npx memory entity create Alice -t person    # Create entity
npx memory entity list --type person        # List entities
npx memory search "TypeScript"              # Search
npx memory stats                            # Graph statistics
npx memory interactive                      # REPL mode
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

// Or use string path (storage type via MEMORY_STORAGE_TYPE env var)
const ctx = new ManagerContext('./memory.jsonl');

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
- `QueryParser`: Advanced query syntax (phrases, wildcards, proximity, field-specific)
- `ProximitySearch`: Find terms within N words of each other
- `QueryLogger`: Structured logging for search operations with tracing

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
- Worker pool: CPU-intensive Levenshtein calculations offloaded to workers (`dist/workers/` built separately by tsup)
- Transaction support: `TransactionManager` for atomic batch operations

### Build Notes

- Uses `tsup` for bundling (ESM + CJS dual output)
- Worker files (`levenshteinWorker.ts`) built separately to `dist/workers/` for dynamic loading
- `better-sqlite3` is externalized (native addon, not bundled)
- No lint script configured - TypeScript compiler (`npm run typecheck`) catches most issues

## Testing

Test organization:
- `tests/unit/` - Unit tests per module
- `tests/integration/` - Cross-module workflows
- `tests/performance/` - Benchmarks
- `tests/edge-cases/` - Boundary conditions

Vitest with 30s timeout. Coverage excludes `index.ts` barrel files.

## Environment Variables

### Core Storage
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite` | `jsonl` |
| `MEMORY_FILE_PATH` | Custom storage file path | - |

### Embedding/Semantic Search
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` |
| `MEMORY_OPENAI_API_KEY` | API key string | - |
| `MEMORY_EMBEDDING_MODEL` | Model name override | - |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | `true`, `false` | `false` |

### Agent Memory Decay
| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_AUTO_DECAY` | `false` | Enable automatic decay scheduling |
| `MEMORY_DECAY_HALF_LIFE_HOURS` | `168` (1 week) | Half-life for memory importance decay |
| `MEMORY_DECAY_MIN_IMPORTANCE` | `0.1` | Floor value for decayed importance |
| `MEMORY_DECAY_INTERVAL_MS` | `3600000` (1 hour) | Interval between decay runs |
| `MEMORY_AUTO_FORGET` | `false` | Auto-delete memories below threshold |
| `MEMORY_FORGET_THRESHOLD` | `0.05` | Effective importance threshold for forgetting |

### Agent Memory Salience
| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_SALIENCE_IMPORTANCE_WEIGHT` | `0.25` | Weight for base importance |
| `MEMORY_SALIENCE_RECENCY_WEIGHT` | `0.25` | Weight for recency |
| `MEMORY_SALIENCE_FREQUENCY_WEIGHT` | `0.2` | Weight for access frequency |
| `MEMORY_SALIENCE_CONTEXT_WEIGHT` | `0.2` | Weight for context relevance |
| `MEMORY_SALIENCE_NOVELTY_WEIGHT` | `0.1` | Weight for novelty |

### Context Window
| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_CONTEXT_MAX_TOKENS` | `4000` | Default max tokens for context |
| `MEMORY_CONTEXT_TOKEN_MULTIPLIER` | `1.3` | Estimation multiplier |
| `MEMORY_CONTEXT_RESERVE_BUFFER` | `100` | Reserved token buffer |

### Query Logging
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_QUERY_LOGGING` | `true`, `false` | `false` |
| `MEMORY_QUERY_LOG_FILE` | File path for log output | - |
| `MEMORY_QUERY_LOG_LEVEL` | `debug`, `info`, `warn`, `error` | `info` |

### Development/Testing
| Variable | Values | Default |
|----------|--------|---------|
| `SKIP_BENCHMARKS` | `true`, `false` | `false` (run benchmarks) |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | (none) |

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
- `docs/architecture/DEPENDENCY_GRAPH.md` - Auto-generated module dependency documentation
- `docs/roadmap/ROADMAP.md` - Feature roadmap with implementation details
- `docs/guides/IMPLEMENTATION_GUIDE.md` - Detailed implementation patterns

## Tools

Located in `tools/` directory:

| Tool | Purpose |
|------|---------|
| `create-dependency-graph` | Generates DEPENDENCY_GRAPH.md with module dependencies, exports, and Mermaid diagrams |
| `chunking-for-files` | Splits large files (markdown, JSON, TypeScript) into editable chunks, then merges back |
| `migrate-from-jsonl-to-sqlite` | Migrates existing JSONL storage to SQLite backend |
| `compress-for-context` | Compresses graph data for LLM context windows |

## CLI Reference

The `memory` CLI provides commands for working with the knowledge graph:

| Command | Description |
|---------|-------------|
| `memory entity create <name>` | Create entity with `-t type`, `-o obs...`, `--tags`, `-i importance` |
| `memory entity get <name>` | Get entity details |
| `memory entity list` | List entities with `--type`, `--tags`, `--limit` filters |
| `memory entity update <name>` | Update entity fields |
| `memory entity delete <name>` | Delete entity |
| `memory relation create <from> <type> <to>` | Create relation |
| `memory relation list` | List relations with `--from`, `--to`, `--type` filters |
| `memory relation delete <from> <type> <to>` | Delete relation |
| `memory search <query>` | Search entities/observations with `-l limit`, `-t type` |
| `memory import <file>` | Import from file (`-f json|csv|graphml`, `--merge strategy`) |
| `memory export <file>` | Export to file (`-f json|csv|graphml|markdown|mermaid`) |
| `memory stats` | Show graph statistics |
| `memory interactive` | Start REPL mode |

Global options: `-s/--storage <path>`, `-f/--format json|table|csv`, `-q/--quiet`, `--verbose`
