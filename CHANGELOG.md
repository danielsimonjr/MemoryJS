# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - Agent Memory System

### Added

#### Sprint 1: Extended Type Definitions
- **AgentEntity Interface**: Extended Entity with 20+ fields for AI agent memory systems
  - Memory classification (working/episodic/semantic/procedural)
  - Session and task context (sessionId, conversationId, taskId)
  - Lifecycle management (expiresAt, promotedAt, markedForPromotion)
  - Access tracking (accessCount, lastAccessedAt, accessPattern)
  - Memory strength (confidence, confirmationCount, decayRate)
  - Multi-agent support (agentId, visibility, source)
- **AgentObservation Interface**: Extended observations with confidence, temporal validity, provenance
- **SessionEntity Interface**: Session tracking with status, goals, and session linking
- **MemorySource Interface**: Provenance tracking for memory origin
- **Type Guards**: isAgentEntity, isSessionEntity, isWorkingMemory, isEpisodicMemory, isSemanticMemory, isProceduralMemory
- **AccessContextBuilder**: Fluent builder for access context construction
- **Utility Types**: WorkingMemoryEntity, EpisodicMemoryEntity, SemanticMemoryEntity, ProceduralMemoryEntity

### Testing

- Added 67 unit tests for type guards and AccessContextBuilder

## [1.1.0] - 2026-01-11

### Added

- **Dual Module Format**: Added tsup bundler for ESM and CommonJS output
  - `dist/index.js` - ES Module format
  - `dist/index.cjs` - CommonJS format
  - Proper `exports` field with `import` and `require` conditions
- **Test Reporter**: Added per-file-reporter for detailed test reports
  - JSON reports per test file in `tests/test-results/json/`
  - HTML reports per test file in `tests/test-results/html/`
  - Summary reports with coverage integration in `tests/test-results/summary/`
  - Configurable modes via `VITEST_REPORT_MODE` (all, summary, debug)
- **Build Scripts**:
  - `build` - tsup bundled build (ESM + CJS)
  - `build:watch` - tsup watch mode
  - `build:tsc` - original TypeScript compiler build
- **Worker Files**: Separate worker bundle for dynamic loading by workerpool
- **Tool Management Scripts**:
  - `tools:install` - install dependencies for all standalone tools
  - `tools:build` - build all standalone tool executables

### Changed

- Updated vitest.config.ts with `SKIP_BENCHMARKS` environment variable support
- Updated vitest.config.ts with `json-summary` coverage reporter for per-file-reporter integration
- Updated .gitignore to exclude tool build artifacts (`tools/*/node_modules/`, `tools/*/dist/`, `tools/*/*.exe`)

## [1.0.0] - 2026-01-10

### Added

Initial release - extracted core knowledge graph functionality from memory-mcp.

#### Core Features
- **Entity Management**: Full CRUD operations for entities with observations
- **Relation Management**: Create and manage typed relationships between entities
- **Hierarchical Organization**: Parent-child entity nesting with tree operations
- **Tag Management**: Tag aliasing, bulk operations, and filtering

#### Storage Backends
- **JSONL Storage**: Default file-based storage with in-memory caching
- **SQLite Storage**: Optional database backend with FTS5 full-text search
- **Storage Factory**: Automatic backend selection via configuration

#### Search Capabilities
- **Basic Search**: Name and observation content matching
- **Ranked Search**: TF-IDF relevance scoring
- **Boolean Search**: AND, OR, NOT operators
- **Fuzzy Search**: Levenshtein distance-based typo tolerance
- **BM25 Search**: Probabilistic ranking function
- **Semantic Search**: Vector similarity (requires embedding provider)
- **Hybrid Search**: Multi-signal fusion (semantic + lexical + symbolic)
- **Smart Search**: Reflection-based query refinement

#### Graph Algorithms
- **Shortest Path**: BFS-based pathfinding
- **All Paths**: DFS enumeration up to max depth
- **Centrality**: Degree, betweenness, and PageRank algorithms
- **Connected Components**: Graph connectivity analysis

#### Import/Export
- **Formats**: JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid
- **Compression**: Optional Brotli compression for large exports
- **Streaming**: Memory-efficient export for large graphs (>= 5000 entities)
- **Backup/Restore**: Full graph backup with compression support

#### Utilities
- **Zod Validation**: Schema validation for all inputs
- **Compression**: Brotli compression utilities with base64 support
- **Search Cache**: LRU caching with TTL for search results
- **Indexes**: Name, type, and relation indexes for O(1) lookups
- **Worker Pool**: Parallel processing for CPU-intensive operations

### Architecture

- **ManagerContext**: Central access point with lazy-initialized managers
- **Layered Design**: Protocol → Managers → Storage
- **Barrel Exports**: Clean module organization via index files

### Testing

- 2882 tests across 90 test files
- Unit, integration, and performance benchmarks
- Coverage for edge cases and error handling

---

## Implementation Notes

The original Phase 13 plan specified adapter interfaces (`IStorageAdapter`, `IWorkerAdapter`) for
pluggable storage and worker backends. The actual implementation used a direct code copy approach,
preserving the existing class structure (`GraphStorage`, `SQLiteStorage`, `StorageFactory`) without
introducing adapter abstractions. This simplified the extraction while maintaining full functionality.

Future versions may introduce adapter interfaces to enable Bun/Deno support.

---

## Extracted From

This library was extracted from [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) v10.1.0 as Phase 13 of the memory-mcp project evolution.

The extraction separates the core knowledge graph functionality from the MCP server implementation, enabling:
- Standalone use without MCP dependencies
- Cleaner dependency tree
- Independent versioning and releases
