# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MemoryJS is a TypeScript knowledge graph library for managing entities, relations, and observations with advanced search capabilities. It supports multiple storage backends (JSONL, SQLite) and provides features like hierarchical organization, graph algorithms, and hybrid search. Requires Node.js >= 18.0.0.

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
```

## Architecture

### Module Organization

```
src/
├── agent/     # Agent Memory System (sessions, working memory, episodic, decay)
├── cli/       # CLI commands (bin: `memory` / `memoryjs`)
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

**Search System** (`src/search/`): Layered search architecture:
- **Text search**: `BasicSearch` (substring), `BooleanSearch` (AND/OR/NOT with AST), `FuzzySearch` (Levenshtein via worker pool)
- **Ranked search**: `RankedSearch` (TF-IDF via `TFIDFIndexManager`), `BM25Search` (Okapi BM25 with stopwords)
- **Semantic search**: `SemanticSearch` + `EmbeddingService` + `VectorStore`/`QuantizedVectorStore` (requires embedding provider)
- **Hybrid search**: `HybridSearchManager` + `HybridScorer` + `SymbolicSearch` - combines semantic, lexical, and symbolic signals
- **Query optimization**: `QueryAnalyzer`/`QueryPlanner`, `QueryCostEstimator`, `QueryPlanCache`, `EarlyTerminationManager`, `ParallelSearchExecutor`
- **Retrieval**: `ReflectionManager` (progressive refinement), `SavedSearchManager`, `SearchSuggestions`, `ProximitySearch` (term proximity scoring)
- **Parsing & logging**: `QueryParser` (query string parsing), `QueryLogger` (query performance logging)
- **Infrastructure**: `TFIDFEventSync` (auto-sync), `OptimizedInvertedIndex`, `IncrementalIndexer`, `EmbeddingCache`, `SearchFilterChain`

**CLI** (`src/cli/`): Command-line interface exposed as `memory` / `memoryjs` binaries (see `bin` in package.json). Built as separate ESM bundle by tsup.

**Agent Memory System** (`src/agent/`): Complete memory system for AI agents:
- **Facade**: `AgentMemoryManager` - unified entry point for all agent memory operations
- **Session lifecycle**: `SessionManager`, `SessionQueryBuilder` - start/end/query sessions
- **Memory types**: `WorkingMemoryManager` (short-term with TTL + promotion), `EpisodicMemoryManager` (timeline-based events)
- **Decay & salience**: `DecayEngine`/`DecayScheduler` (time-based importance decay), `SalienceEngine` (context-aware scoring)
- **Multi-agent**: `MultiAgentMemoryManager` (visibility controls: private/shared/public), `ConflictResolver`
- **Processing**: `ConsolidationPipeline`, `SummarizationService`, `PatternDetector`, `RuleEvaluator`
- **Context**: `ContextWindowManager` (token budgeting), `MemoryFormatter` (output formatting), `AccessTracker`

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

- Uses `tsup` for bundling (ESM + CJS dual output) with 3 separate entry points: library, CLI, workers
- Worker files (`levenshteinWorker.ts`) built separately to `dist/workers/` for dynamic loading
- CLI built separately to `dist/cli/` with `#!/usr/bin/env node` banner
- `better-sqlite3` is externalized (native addon, not bundled)
- No lint script configured - TypeScript compiler (`npm run typecheck`) catches most issues
- Publishable package: `npm run prepublishOnly` runs clean + build + test

## Testing

Test organization:
- `tests/unit/` - Unit tests per module
- `tests/integration/` - Cross-module workflows
- `tests/performance/` - Benchmarks
- `tests/edge-cases/` - Boundary conditions

Vitest with 30s timeout. Coverage excludes `index.ts` barrel files. Custom `per-file-reporter.js` outputs results to `tests/test-results/`.

## Environment Variables

### Core
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite` | `jsonl` |
| `MEMORY_FILE_PATH` | Custom storage file path | - |
| `SKIP_BENCHMARKS` | `true`, `false` | `false` |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` | (none) |

### Embedding/Semantic Search
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` |
| `MEMORY_OPENAI_API_KEY` | API key string | - |
| `MEMORY_EMBEDDING_MODEL` | Model name override | - |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | `true`, `false` | `false` |

### Agent Memory

Decay: `MEMORY_AUTO_DECAY` (false), `MEMORY_DECAY_HALF_LIFE_HOURS` (168), `MEMORY_DECAY_MIN_IMPORTANCE` (0.1), `MEMORY_DECAY_INTERVAL_MS` (3600000), `MEMORY_AUTO_FORGET` (false), `MEMORY_FORGET_THRESHOLD` (0.05)

Salience weights (all 0-1): `MEMORY_SALIENCE_IMPORTANCE_WEIGHT` (0.25), `MEMORY_SALIENCE_RECENCY_WEIGHT` (0.25), `MEMORY_SALIENCE_FREQUENCY_WEIGHT` (0.2), `MEMORY_SALIENCE_CONTEXT_WEIGHT` (0.2), `MEMORY_SALIENCE_NOVELTY_WEIGHT` (0.1)

Context window: `MEMORY_CONTEXT_MAX_TOKENS` (4000), `MEMORY_CONTEXT_TOKEN_MULTIPLIER` (1.3), `MEMORY_CONTEXT_RESERVE_BUFFER` (100)

Query logging: `MEMORY_QUERY_LOGGING` (false), `MEMORY_QUERY_LOG_FILE`, `MEMORY_QUERY_LOG_LEVEL` (info)

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

## Claude Code Automations

- **Hooks** (`.claude/settings.local.json`): PostToolUse auto-typecheck on Edit/Write, PreToolUse blocks .env/.db edits
- **Agents** (`.claude/agents/`): `test-runner.md` (maps changed files to test dirs), `security-reviewer.md` (OWASP-based review)
- **Commands** (`.claude/commands/`): COMMIT, DEPS, CHUNK, SEARCH, MEMORY, RELEASE

## Gotchas

- **Windows atomic writes**: `fs.rename()` can fail with EPERM in temp directories due to Dropbox/antivirus file locking. `GraphStorage.durableWriteFile` has a fallback that writes directly if rename fails.
- **Windows + Dropbox + git**: This repo is synced via Dropbox which can corrupt git objects (e.g., `fatal: bad object HEAD`). If git commands fail, try `git fsck` and `git reflog` to recover.
- **`better-sqlite3` native addon**: Requires a compatible prebuild or build tools (Python, C++ compiler) for the platform. If `npm install` fails on this, check node-gyp prerequisites.
- **Worker pool path resolution**: Workers are loaded dynamically from `dist/workers/`. If you only run `npm run build` (tsup), workers are built. But `npm run build:tsc` (bare tsc) does NOT build workers - use tsup.
- **`package-lock.json` is gitignored**: Uses `npm install` (not `npm ci`) for development. Dependencies may drift between machines.
