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
├── agent/     # Agent Memory System (sessions, working memory, episodic, decay, artifacts, distillation, role profiles, entropy, consolidation scheduler, collaborative synthesis, failure distillation, cognitive load, visibility, MemoryEngine + ImportanceScorer for turn-aware memory with four-tier dedup)
├── cli/       # CLI commands (bin: `memory` / `memoryjs`)
├── core/      # Storage backends, entity/relation/observation managers, transactions, RefIndex
├── search/    # Search algorithms (BM25, TF-IDF, fuzzy, semantic, hybrid, temporal, LLM-planned)
├── features/  # Import/export, compression, analytics, archiving, freshness, audit, governance
├── utils/     # Caching, errors, indexing, batch processing
├── types/     # TypeScript interfaces (Entity, Relation, ArtifactEntity, etc.)
└── workers/   # Worker pool for CPU-intensive tasks (Levenshtein)
```

### Key Components

**ManagerContext** (`src/core/ManagerContext.ts`): Central facade providing lazy-initialized access to all managers:
```typescript
// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (set MEMORY_STORAGE_TYPE=sqlite env var)
const ctx = new ManagerContext('./memory.db');

ctx.entityManager       // Entity CRUD + tags
ctx.relationManager     // Relation CRUD
ctx.observationManager  // Observation CRUD
ctx.hierarchyManager    // Entity hierarchy (parent/child, ancestors, descendants)
ctx.searchManager       // All search operations (incl. searchByTime())
ctx.rankedSearch        // TF-IDF/BM25 ranked search
ctx.graphTraversal      // Path finding, centrality, connected components
ctx.ioManager           // Import/export/backup/restore
ctx.tagManager          // Tag aliases and management
ctx.analyticsManager    // Graph statistics and validation
ctx.compressionManager  // Duplicate detection, entity merging
ctx.archiveManager      // Entity archival to compressed storage
ctx.semanticSearch      // Vector similarity (requires embedding provider)
ctx.temporalSearch      // Natural language time-range search (chrono-node)
ctx.freshnessManager    // TTL/confidence freshness reporting
ctx.governanceManager   // Governance policies + audit transaction support
ctx.refIndex            // Named reference index for O(1) entity lookup
ctx.semanticForget      // Two-tier deletion (exact → semantic fallback)
ctx.queryNaturalLanguage() // LLM-planned query decomposition (optional provider)
ctx.agentMemory()       // Agent Memory System facade
ctx.procedureManager    // 3B.4 Procedural Memory (executable procedures)
ctx.causalReasoner      // 3B.6 Causal Reasoning (findCauses/findEffects/counterfactual)
ctx.roleAssignmentStore // η.6.1 RBAC role grants registry
ctx.rbacMiddleware      // η.6.1 RBAC policy (checkPermission)
ctx.worldModelManager   // 3B.7 World Model orchestrator (snapshots + diff)
```

**v1.9.0 Additions:**
- `RelationManager.invalidateRelation()` — mark relations as ended (temporal validity)
- `RelationManager.queryAsOf(entity, date)` — time-travel queries
- `RelationManager.timeline(entity)` — chronological relation history
- `ContextWindowManager.wakeUp()` — 4-layer memory stack (~600 token wake-up context); accepts optional `compress` parameter for token-efficient loading
- `ContextWindowManager.compressForContext()` — n-gram context compression with §-code legend, three levels (light/medium/aggressive)
- `ContextWindowManager.compressEntitiesForContext()` — entity-aware compression wrapper
- `IOManager.ingest(input, options)` — conversation ingestion pipeline (format-agnostic)
- `AgentMemoryManager.writeDiary() / readDiary()` — per-agent persistent journal
- Default embedding provider: `local` (zero-config semantic search, no API key needed)

**Storage Layer** (`src/core/StorageFactory.ts`): Two backends selected via `MEMORY_STORAGE_TYPE` env var:
- `GraphStorage` (JSONL, default): Human-readable, in-memory caching, atomic writes via temp file + rename
- `SQLiteStorage`: FTS5 full-text search with BM25, WAL mode, ACID transactions, better-sqlite3

**Search System** (`src/search/`): Layered search architecture:
- **Text search**: `BasicSearch` (substring), `BooleanSearch` (AND/OR/NOT with AST), `FuzzySearch` (Levenshtein via worker pool, N-gram pre-filtered)
- **Ranked search**: `RankedSearch` (TF-IDF via `TFIDFIndexManager`), `BM25Search` (Okapi BM25 with stopwords)
- **Semantic search**: `SemanticSearch` + `EmbeddingService` + `VectorStore`/`QuantizedVectorStore` (requires embedding provider)
- **Hybrid search**: `HybridSearchManager` + `HybridScorer` + `SymbolicSearch` - combines semantic, lexical, and symbolic signals
- **Temporal search**: `TemporalQueryParser` (chrono-node NL time parsing) + `TemporalSearch` — `searchByTime()` on SearchManager
- **LLM-planned search**: `LLMQueryPlanner` (NL → `StructuredQuery`) + `LLMSearchExecutor` — optional `LLMProvider`, keyword fallback
- **N-gram index**: `NGramIndex` (trigram + Jaccard similarity) — pre-filter for `FuzzySearch` before Levenshtein
- **Query optimization**: `QueryAnalyzer`/`QueryPlanner`, `QueryCostEstimator`, `QueryPlanCache`, `EarlyTerminationManager`, `ParallelSearchExecutor`
- **Retrieval**: `ReflectionManager` (progressive refinement), `SavedSearchManager`, `SearchSuggestions`, `ProximitySearch` (term proximity scoring)
- **Parsing & logging**: `QueryParser` (query string parsing), `QueryLogger` (query performance logging)
- **Infrastructure**: `TFIDFEventSync` (auto-sync), `OptimizedInvertedIndex`, `IncrementalIndexer`, `EmbeddingCache`, `SearchFilterChain`

**CLI** (`src/cli/`): Command-line interface exposed as `memory` / `memoryjs` binaries (see `bin` in package.json). Built as separate ESM bundle by tsup. Commands split into `commands/{entity,relation,search,observation,tag,hierarchy,graph,io,maintenance}.ts` with shared `helpers.ts`.

**Agent Memory System** (`src/agent/`): Complete memory system for AI agents:
- **Facade**: `AgentMemoryManager` - unified entry point for all agent memory operations
- **Session lifecycle**: `SessionManager`, `SessionQueryBuilder` - start/end/query sessions
- **Memory types**: `WorkingMemoryManager` (short-term with TTL + promotion), `EpisodicMemoryManager` (timeline-based events)
- **Decay & salience**: `DecayEngine`/`DecayScheduler` (TTL-aware decay), `SalienceEngine` (context-aware scoring with `freshnessWeight`)
- **Multi-agent**: `MultiAgentMemoryManager` (visibility controls: private/shared/public), `ConflictResolver`
- **Processing**: `ConsolidationPipeline`, `SummarizationService`, `PatternDetector`, `RuleEvaluator`
- **Context**: `ContextWindowManager` (token budgeting + distillation), `MemoryFormatter` (`formatWithSalienceBudget()` for proportional allocation), `AccessTracker`
- **Artifacts**: `ArtifactManager` — `createArtifact()` generates stable human-readable names (`toolName-date-shortId`), auto-registers refs; `ArtifactEntity` type + `ArtifactType` union
- **Distillation**: `IDistillationPolicy` interface + `DefaultDistillationPolicy` (relevance + freshness + dedup), `CompositeDistillationPolicy`, `NoOpDistillationPolicy` — wired into `ContextWindowManager`
- **Role profiles** (v1.7.0): `RoleProfiles` — five built-in roles (`researcher`, `planner`, `executor`, `reviewer`, `coordinator`) each with salience weight presets and token budget splits; applied via `RoleProfileManager`
- **Entropy filtering** (v1.7.0): `EntropyFilter` — Shannon entropy gate that drops low-information memories; integrated as an early `ConsolidationPipeline` stage
- **Consolidation scheduler** (v1.7.0): `ConsolidationScheduler` — background recursive dedup+merge scheduler; runs `ConsolidationPipeline.runAutoConsolidation()` until a fixed point
- **Collaborative synthesis** (v1.7.0): `CollaborativeSynthesis` — graph-neighbourhood merge across agents within N hops; returns unified view with provenance metadata
- **Failure distillation** (v1.7.0): `FailureDistillation` — causal chain lesson extraction from failed episodes; promotes high-scoring observations to semantic memory
- **Cognitive load** (v1.7.0): `CognitiveLoadAnalyzer` — token density + redundancy ratio + observation diversity → `CognitiveLoadReport`; used by `ContextWindowManager` to prune high-load sections
- **Visibility hierarchies** (v1.7.0): `VisibilityResolver` — five-level model (`private` | `team` | `org` | `shared` | `public`) with `GroupMembership` registry
- **Memory Engine** (v1.11.0): `MemoryEngine` — turn-aware conversation memory facade composing over `EpisodicMemoryManager` + `WorkingMemoryManager`. Public API: `addTurn(content, opts)` (dedup-first write with importance scoring + event emission), `checkDuplicate(content, sessionId)`, `getSessionTurns(sessionId, { role?, limit? })` (chronological), `deleteSession`, `listSessions`. Four-tier dedup chain: `checkTierExact` (SHA-256 contentHash) / `checkTierPrefix` (50% prefix overlap) / `checkTierJaccard` (token Jaccard ≥ 0.72) / optional `checkTierSemantic` (embedding similarity). Emits `memoryEngine:turnAdded` / `memoryEngine:duplicateDetected` / `memoryEngine:sessionDeleted` on its own `node:events` `EventEmitter`. Companion: `ImportanceScorer` (length × keyword × recent-turn-overlap signals → integer [0, 10]). Wired via `ctx.memoryEngine` lazy getter; `agentMemory(config)` invalidates the cache on re-instantiation.

### Data Model

**Entity** (`src/types/types.ts`): Primary graph nodes with:
- `name` (unique identifier), `entityType`, `observations[]`
- Optional: `parentId` (hierarchy), `tags[]`, `importance` (0-10), timestamps
- Optional (v1.6.0): `ttl` (time-to-live for freshness), `confidence` (0.0–1.0 belief strength)
- Optional (v1.8.0): `projectId` (project scoping), `version`/`parentEntityName`/`rootEntityName`/`isLatest`/`supersededBy` (memory versioning)
- Optional (v1.11.0): `contentHash` (SHA-256 of raw turn content; powers `MemoryEngine` Tier 1 exact-equality dedup with O(1) index hit on SQLite via `idx_entities_content_hash`)

**ArtifactEntity** (`src/types/artifact.ts`): Extends `AgentEntity` with `artifactType` (`ArtifactType` union) and stable auto-generated name (`toolName-date-shortId`).

**Relation**: Directed edges with `from`, `to`, `relationType` fields.

### Features (`src/features/`)

- `IOManager`: Import/export in JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid formats; `ingest()` for conversation ingestion (v1.9.0)
- `SemanticForget` (v1.8.0): Two-tier deletion (exact match → 0.85 semantic fallback) with audit logging
- `ContradictionDetector` (v1.8.0): Semantic similarity-based contradiction detection with entity versioning
- `StreamingExporter`: Streaming export for large graphs with Brotli compression
- `AnalyticsManager`: Graph statistics, validation, duplicate detection
- `CompressionManager`: Entity merging, graph compression
- `ArchiveManager`: Archive old/low-importance entities
- `TagManager`: Tag alias management and resolution
- `ObservationNormalizer`: Pronoun resolution, relative date anchoring
- `KeywordExtractor`: Keyword extraction from text
- `FreshnessManager`: `calculateFreshness`, `getStaleEntities`, `getExpiredEntities`, `generateReport` — uses `Entity.ttl` and `Entity.confidence`
- `AuditLog`: Immutable JSONL audit trail for all create/update/delete operations
- `GovernanceManager`: `withTransaction`/`rollback`, `GovernancePolicy` (`canCreate`/`canUpdate`/`canDelete`) enforcement

### Graph Algorithms (`src/core/GraphTraversal.ts`)

- Shortest path (Dijkstra), all paths enumeration
- Connected components detection
- Centrality metrics: degree, betweenness, PageRank
- Hierarchy traversal: ancestors, descendants, subtrees

### Key Patterns

- Storage abstraction: Both backends implement same interface via duck typing
- Eager core managers: Core managers initialized in constructor as readonly fields
- Lazy agent managers: Agent memory managers (`semanticSearch`, `agentMemory()`, etc.) created on first access
- Event-driven cache invalidation: `GraphEventEmitter` notifies subscribers on changes
- TF-IDF auto-sync: `TFIDFEventSync` keeps index current with storage
- Worker pool: CPU-intensive Levenshtein calculations offloaded to workers (`dist/workers/` built separately by tsup)
- Transaction support: `TransactionManager` for atomic batch operations
- Named references: `RefIndex` JSONL sidecar provides O(1) stable-name lookups independent of entity name changes
- Governance: `GovernanceManager` wraps mutations with policy checks and rollback; `AuditLog` appends every operation immutably
- Distillation: `IDistillationPolicy` applied post-retrieval in `ContextWindowManager` before formatting for LLM prompts
- Role-aware salience: `RoleProfileManager` applies role presets to `SalienceEngine` weights and `ContextWindowManager` budget splits
- Entropy gate: `EntropyFilter` runs before consolidation; drops observations that do not increase information diversity
- Visibility resolution: `VisibilityResolver` evaluates `GroupMembership` against entity visibility level before returning memories to a requesting agent

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
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `local` |
| `MEMORY_OPENAI_API_KEY` | API key string | - |
| `MEMORY_EMBEDDING_MODEL` | Model name override | - |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | `true`, `false` | `false` |

### Agent Memory

Decay: `MEMORY_AUTO_DECAY` (false), `MEMORY_DECAY_HALF_LIFE_HOURS` (168), `MEMORY_DECAY_MIN_IMPORTANCE` (0.1), `MEMORY_DECAY_INTERVAL_MS` (3600000), `MEMORY_AUTO_FORGET` (false), `MEMORY_FORGET_THRESHOLD` (0.05)

Salience weights (all 0-1): `MEMORY_SALIENCE_IMPORTANCE_WEIGHT` (0.25), `MEMORY_SALIENCE_RECENCY_WEIGHT` (0.25), `MEMORY_SALIENCE_FREQUENCY_WEIGHT` (0.2), `MEMORY_SALIENCE_CONTEXT_WEIGHT` (0.2), `MEMORY_SALIENCE_NOVELTY_WEIGHT` (0.1)

Context window: `MEMORY_CONTEXT_MAX_TOKENS` (4000), `MEMORY_CONTEXT_TOKEN_MULTIPLIER` (1.3), `MEMORY_CONTEXT_RESERVE_BUFFER` (100)

Query logging: `MEMORY_QUERY_LOGGING` (false), `MEMORY_QUERY_LOG_FILE`, `MEMORY_QUERY_LOG_LEVEL` (info)

### Governance & Freshness (v1.6.0)
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_GOVERNANCE_ENABLED` | `true`, `false` | `false` |
| `MEMORY_AUDIT_LOG_FILE` | Path for audit JSONL | - |
| `MEMORY_FRESHNESS_TTL_DEFAULT_HOURS` | Number | `168` |
| `MEMORY_LLM_QUERY_PLANNER_PROVIDER` | Provider name string | - |

### Role Profiles & Advanced Agent Features (v1.7.0)
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_AGENT_ROLE` | `researcher`, `planner`, `executor`, `reviewer`, `coordinator` | - |
| `MEMORY_ENTROPY_FILTER_ENABLED` | `true`, `false` | `false` |
| `MEMORY_ENTROPY_THRESHOLD` | Number (0–1) | `0.3` |
| `MEMORY_CONSOLIDATION_SCHEDULER_ENABLED` | `true`, `false` | `false` |
| `MEMORY_CONSOLIDATION_INTERVAL_MS` | Number | `3600000` |
| `MEMORY_COGNITIVE_LOAD_MAX` | Number (0–1) | `0.8` |
| `MEMORY_DEFAULT_VISIBILITY` | `private`, `team`, `org`, `shared`, `public` | `private` |

### Memory Engine (v1.11.0)
Read by `ctx.memoryEngine` lazy getter on first access. All ten knobs.

| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_ENGINE_JACCARD_THRESHOLD` | Number (0–1) | `0.72` |
| `MEMORY_ENGINE_PREFIX_OVERLAP` | Number (0–1) | `0.5` |
| `MEMORY_ENGINE_DEDUP_SCAN_WINDOW` | Integer (recent-turns to scan) | `200` |
| `MEMORY_ENGINE_MAX_TURNS_PER_SESSION` | Integer | `1000` |
| `MEMORY_ENGINE_SEMANTIC_DEDUP` | `true`, `false` | `false` |
| `MEMORY_ENGINE_SEMANTIC_THRESHOLD` | Number (0–1) | `0.92` |
| `MEMORY_ENGINE_RECENT_TURNS` | Integer (turns for importance overlap) | `10` |
| `MEMORY_ENGINE_LENGTH_WEIGHT` | Number (0–1) | `0.3` |
| `MEMORY_ENGINE_KEYWORD_WEIGHT` | Number (0–1) | `0.4` |
| `MEMORY_ENGINE_OVERLAP_WEIGHT` | Number (0–1) | `0.3` |

### PRD Decay Extensions (v1.12.0 — Phase β.5/β.6)
Powers `DecayEngine.calculatePrdEffectiveImportance` and is read by `IMemoryBackend.get_weighted` filter.

| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_PRD_DECAY_RATE` | Number (1/seconds) | auto-derived from `MEMORY_DECAY_HALF_LIFE_HOURS` via `ln(2) / (halfLifeHours × 3600)` |
| `MEMORY_PRD_FRESHNESS_COEFFICIENT` | Number (1/seconds) | `0.01` |
| `MEMORY_PRD_RELEVANCE_WEIGHT` | Number (0–1) | `0.35` |
| `MEMORY_PRD_MIN_IMPORTANCE_THRESHOLD` | Number | `0.1` |

Distinct from the legacy `MEMORY_DECAY_*` set: those drive `DecayEngine.calculateEffectiveImportance` (memoryjs scale `[0, 10]`), while `MEMORY_PRD_*` drive the parallel `calculatePrdEffectiveImportance` (PRD scale, auto-translates `[0, 10]` → `[1.0, 3.0]`). Both formulas coexist; existing callers (`DecayScheduler`, `SearchManager`, `SemanticForget`) keep using the legacy method.

**Important cross-link:** `MEMORY_DECAY_HALF_LIFE_HOURS` *does* feed PRD scoring — when `MEMORY_PRD_DECAY_RATE` is unset, the PRD `decayRate` is auto-derived from the half-life. Set `MEMORY_PRD_DECAY_RATE` explicitly to decouple.

### Memory Backend selector (v1.12.0 — Phase β.4)
| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_BACKEND` | `sqlite`, `in-memory` (aliases: `inmemory`, `memory`) | `sqlite` |

Read by `ctx.memoryBackend` lazy getter. `sqlite` wraps `MemoryEngine` (which transparently spans JSONL + actual SQLite per `MEMORY_STORAGE_TYPE`). `in-memory` is ephemeral; suitable for tests and short-lived processes. Phase γ adds `postgres` and `vector` choices.

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

- **Security review iteration**: Run `.claude/agents/security-reviewer.md` iteratively after fixes — fixes can introduce regressions (e.g., destructive sanitization, unvalidated derived paths).
- **XML import sanitization**: Decode XML entities (`&amp;` -> `&`), never strip characters — stripping corrupts data like "AT&T", "O'Brien".
- **FTS5/LIKE input sanitization**: FTS5 queries must strip `:{}()"^~*` and boolean keywords. LIKE queries must escape `\%_` with `ESCAPE '\'`.
- **Path confinement**: When validating derived paths (e.g., appending `.meta.json`), re-validate independently — the derived path may escape the confined directory.
- **Windows atomic writes**: `fs.rename()` can fail with EPERM in temp directories due to Dropbox/antivirus file locking. `GraphStorage.durableWriteFile` has a fallback that writes directly if rename fails.
- **Windows + Dropbox + git**: This repo is synced via Dropbox which can corrupt git objects (e.g., `fatal: bad object HEAD`). If git commands fail, try `git fsck` and `git reflog` to recover.
- **`better-sqlite3` native addon**: Requires a compatible prebuild or build tools (Python, C++ compiler) for the platform. If `npm install` fails on this, check node-gyp prerequisites. **Node version mismatch**: if SQLite tests fail with `NODE_MODULE_VERSION mismatch`, run `npm rebuild better-sqlite3` — Node was upgraded since `npm install` and the prebuilt binary's ABI no longer matches.
- **Worker pool path resolution**: Workers are loaded dynamically from `dist/workers/`. If you only run `npm run build` (tsup), workers are built. But `npm run build:tsc` (bare tsc) does NOT build workers - use tsup.
- **`package-lock.json` is gitignored**: Uses `npm install` (not `npm ci`) for development. Dependencies may drift between machines.
- **Cache TTL boundary**: `SearchCache` uses `>=` for expiration checks. Using `>` causes TTL=0 entries to persist when accessed within the same millisecond (flaky on Windows due to timer resolution).
- **Performance benchmark flakiness**: Overhead thresholds in `tests/performance/task-scheduler-benchmarks.test.ts` may need widening on Windows/Dropbox due to timing variance from file locking. The unskipped benchmarks in `tests/performance/embedding-benchmarks.test.ts` and `tests/performance/foundation-benchmarks.test.ts` (un-skipped 2026-04-25 after the "codebase split" event was confirmed complete) carry generous thresholds for the same reason. Benchmarks run via `npm run bench`; gated from default `npm test` by `SKIP_BENCHMARKS=true` env-var support inside individual tests.
- **Search API return types**: `autoSearch()` returns `{ results: SearchResult[], selectedMethod, selectionReason }`. `booleanSearch()`/`fuzzySearch()` return `KnowledgeGraph` (not `SearchResult[]`) — callers must wrap with scores.
