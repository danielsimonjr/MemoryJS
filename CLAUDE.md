# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MemoryJS is a TypeScript knowledge graph library for managing entities, relations, and observations with advanced search capabilities. It supports multiple storage backends (JSONL, SQLite) and provides features like hierarchical organization, graph algorithms, and hybrid search.

## Common Commands

```bash
# Build
npm run build           # Compile TypeScript to dist/
npm run build:watch     # Watch mode compilation

# Test
npm run test            # Run all tests once
npm run test:watch      # Watch mode
npm run test:coverage   # Run with coverage report

# Run a single test file
npx vitest run tests/unit/core/EntityManager.test.ts

# Type checking
npm run typecheck       # Check types without emitting
```

## Architecture

### Module Organization

```
src/
├── core/      # Storage backends, entity/relation/observation managers, transactions
├── search/    # Search algorithms (BM25, TF-IDF, fuzzy, semantic, hybrid)
├── features/  # Import/export, compression, analytics, archiving
├── utils/     # Caching, errors, indexing, batch processing
├── types/     # TypeScript interfaces (Entity, Relation, etc.)
└── workers/   # Worker pool for CPU-intensive tasks (Levenshtein)
```

### Key Components

**ManagerContext** (`src/core/ManagerContext.ts`): Central facade providing lazy-initialized access to all managers. Instantiate with a storage path string:
```typescript
const ctx = new ManagerContext('./memory.jsonl');
ctx.entityManager      // Entity CRUD + tags + hierarchy
ctx.relationManager    // Relation CRUD
ctx.observationManager // Observation CRUD
ctx.searchManager      // All search operations
ctx.graphTraversal     // Path finding, centrality
ctx.ioManager          // Import/export/backup
ctx.tagManager         // Tag aliases
ctx.semanticSearch     // Vector similarity (optional)
```

**Storage Layer** (`src/core/StorageFactory.ts`): Two backends selected via `MEMORY_STORAGE_TYPE` env var:
- `GraphStorage` (JSONL, default): Human-readable, in-memory caching, atomic writes via temp file + rename
- `SQLiteStorage`: FTS5 full-text search with BM25, WAL mode, ACID transactions, better-sqlite3

**Search System** (`src/search/`):
- `BasicSearch`: Simple substring matching
- `RankedSearch`: TF-IDF scoring via `TFIDFIndexManager`
- `BooleanSearch`: AND/OR/NOT operators with AST parsing
- `FuzzySearch`: Levenshtein distance via worker pool
- `SemanticSearch`: Vector similarity (requires embedding provider)
- `HybridSearchManager`: Combines semantic, lexical, and symbolic signals with configurable weights

### Data Model

**Entity** (`src/types/types.ts`): Primary graph nodes with:
- `name` (unique identifier), `entityType`, `observations[]`
- Optional: `parentId` (hierarchy), `tags[]`, `importance` (0-10), timestamps

**Relation**: Directed edges with `from`, `to`, `relationType` fields.

### Key Patterns

- Storage abstraction: Both backends implement same interface via duck typing
- Lazy initialization: Managers created on first access via getters
- Event-driven cache invalidation: `GraphEventEmitter` notifies subscribers on changes
- TF-IDF auto-sync: `TFIDFEventSync` keeps index current with storage
- Worker pool: CPU-intensive Levenshtein calculations offloaded to workers

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
| `EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` |
| `OPENAI_API_KEY` | API key string | - |

## Documentation

Architecture docs in `docs/architecture/` cover design patterns, component interactions, data flow, and dependency graphs.
