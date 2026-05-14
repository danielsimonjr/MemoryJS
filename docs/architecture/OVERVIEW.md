# MemoryJS - Project Overview

**Version**: 2.0.0 (Phases 0–11 performance & scale track via PR #34; security follow-up via PRs #38 + #39; Phase 2 memory-types expansion Sprints 4–6 + 8; v2.0.0 seven-theme function/API-call consistency & efficiency audit)
**Last Updated**: 2026-05-14

## What Is This?

MemoryJS is a **TypeScript knowledge graph library** for managing entities, relations, and observations with advanced search, bitemporal versioning, causal reasoning, role-based access control, multi-agent collaboration, and pluggable storage backends. Powers [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp) and can be embedded directly into TypeScript / Node.js apps.

## Key Capabilities

| Feature | Description |
|---------|-------------|
| **Knowledge Graph** | Entity-Relation-Observation model in a flexible directed graph |
| **Multiple Backends** | JSONL (human-readable) or SQLite (FTS5 + BM25) storage; pluggable `IMemoryBackend` for memory engine |
| **Hierarchical Nesting** | Parent-child relationships for tree organization |
| **Advanced Search** | Basic / ranked (TF-IDF, BM25) / boolean / fuzzy (N-gram pre-filtered) / semantic / hybrid / temporal / LLM-planned / active iterative retrieval |
| **Agent Memory System** | Working memory, episodic memory, decay, multi-agent support, role profiles, entropy filtering, recursive consolidation |
| **Memory Types (Phase 2)** | (v1.15+) Catalog-aligned `MemoryType` slots: `prospective` (intentions-to-act), `failure` (structured pre-task failure lookup), `plan` (hierarchical goal trees), `reflection` (derived pattern + trajectory summary). Per-type managers: `ProspectiveMemoryManager` / `FailureManager` / `PlanManager` / `ReflectionManager`. Pipeline stages: `ProspectivePromotionStage` / `ReflectionStage` |
| **Trust Hierarchy** | (v1.15+) Discriminated `TrustLevel` mixin on `MemorySource` (`ground-truth` / `verified` / `inferred` / `unverified`); `inferTrustLevel` backfill from `method` + `reliability`; `'trust_level'` `ConflictStrategy` with recency tiebreak |
| **Bitemporal Versioning** | `validFrom`/`validUntil` on entities, observations, and relations; time-travel queries |
| **Memory Intelligence** | Validator (consistency / contradictions), TrajectoryCompressor, ExperienceExtractor, PatternDetector |
| **Memory Theory (3B)** | Procedural memory, active retrieval, causal reasoning, world-model orchestrator |
| **Multi-Agent Collaboration** | Visibility hierarchies (5-level + role + time-window), optimistic concurrency, attribution enforcement, conflict view |
| **Duplicate Detection** | Four-tier dedup (exact / prefix / Jaccard / semantic) + entity-level compression |
| **Graph Algorithms** | Shortest path, centrality, connected components, BFS/DFS traversal |
| **Multi-format Export** | JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid; **W3C Linked Data**: Turtle, RDF/XML, JSON-LD |
| **Access Control** | RBAC (Role / Permission / Matrix / Middleware), audit attribution enforcer, governance policies |
| **Privacy** | Pluggable PII redactor (email / SSN / CC / phone / IP) with per-pattern statistics |
| **Tag Management** | Aliases, bulk operations, validation |
| **Memory-Mapped I/O** | (v1.15.0) `IMmapBackend` + `BufferMmapBackend` + `FsReadMmapBackend`; `GraphStorage.loadFromDisk` mmap branch gated by `MEMORY_USE_MMAP` + `MEMORY_MMAP_THRESHOLD_BYTES` |
| **Segment-Sharded JSONL** | (v1.15.0) `FileSegmentStorage` — FNV-routed N-way shards via `MEMORY_STORAGE_SEGMENT_COUNT` (1–1024); enables parallel reads on very large stores |
| **Columnar Observation Store** | (v1.15.0) `IColumnStore<T>` + `JsonlColumnStore` + `ObservationColumn` — observation data physically separated from entity rows |
| **Tiered Index** | (v1.15.0) `LRUHotTier` (in-memory) → `DiskWarmTier` (uncompressed JSONL) → `BrotliColdTier` (compressed); composed via `TieredIndex` |
| **In-Memory Compression** | (v1.15.0) `ICompressionAdapter` (sync `compress`/`decompress`) + `ZlibCompressionAdapter` / `BrotliCompressionAdapter` / `IdentityCompressionAdapter` + `CompressedMap` |
| **SPARQL Subset** | (v1.15.0) `SparqlExecutor` — minimal BGP / FILTER / OPTIONAL / UNION subset on top of the entity/relation graph |
| **Write-Ahead Log** | (v1.15.0) `WriteAheadLog` + `EntityProxy` — durable mutation log preceding storage commit |
| **CRDT** | (v1.15.0) Convergent replicated data type primitives for multi-writer scenarios (currently scaffolded; awaiting wiring) |
| **ABAC + RLS + API keys** | (v1.15.0) Attribute-based access control with row-level security predicates; API-key-scoped access alongside RBAC |
| **Graph Algorithms (extended)** | (v1.15.0) HITS, clique enumeration, Louvain community detection alongside existing shortest path / centrality / connected components |
| **Error-Handling Contract** | (v2.0.0) `Result<T, E>` discriminated-union type (`ok`/`err`/`isOk`/`isErr`/`unwrap`/`unwrapOr`/`mapOk`) in `src/types/result.ts`; a documented policy (`CONTRIBUTING.md`): throw for programmer errors, return `Result` for expected domain failures, absent-value sentinel is `T \| undefined` not `T \| null` |

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
│  Layer 2: Specialized Managers (40+ lazy getters)      │
│  Core:    EntityManager / RelationManager /            │
│           ObservationManager / HierarchyManager /      │
│           SearchManager / GraphTraversal / RefIndex    │
│  I/O:     IOManager / Archive / Compression /          │
│           Analytics / Audit / Governance / Freshness   │
│  Search:  Ranked / Hybrid / Semantic / Temporal /      │
│           LLMQueryPlanner / ActiveRetrievalController  │
│  Memory:  MemoryEngine / MemoryBackend /               │
│           ContextWindowManager / AgentMemory()         │
│  Types:   ProspectiveMemoryManager / FailureManager /  │
│           PlanManager / ReflectionManager              │
│  Intel:   MemoryValidator / TrajectoryCompressor /     │
│           ExperienceExtractor / PatternDetector        │
│  Theory:  ProcedureManager / CausalReasoner /          │
│           WorldModelManager                            │
│  Auth:    RbacMiddleware / RoleAssignmentStore /       │
│           AccessTracker                                │
└───────────────────────┬────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────┐
│  Layer 3: Storage Layer                                │
│  GraphStorage (JSONL) — optionally:                    │
│    • mmap branch via FsReadMmapBackend (>100MB files)  │
│    • FileSegmentStorage (FNV-routed JSONL shards)      │
│    • JsonlColumnStore (columnar observation data)      │
│    • TieredIndex (LRU hot / disk warm / Brotli cold)   │
│    • CompressedMap (Zlib/Brotli in-memory entry cache) │
│  OR SQLiteStorage (better-sqlite3, FTS5, BM25,         │
│    read pool, PartialIndexAdvisor)                     │
└────────────────────────────────────────────────────────┘
```

## Data Model

### Entity (Graph Node)
```typescript
interface Entity {
  // Core
  name: string;           // Unique identifier
  entityType: string;     // Classification (person, project, concept)
  observations: string[]; // Facts/notes about the entity
  parentId?: string;      // Hierarchical parent
  tags?: string[];        // Categories (lowercase)
  importance?: number;    // Priority 0-10
  createdAt?: string;     // ISO 8601
  lastModified?: string;  // ISO 8601

  // v1.6.0 — Freshness
  ttl?: number;
  confidence?: number;

  // v1.8.0 — Project scoping + supersession
  projectId?: string;
  version?: number;
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // v1.11.0 — Memory Engine dedup
  contentHash?: string;   // SHA-256 for O(1) Tier-1 dedup

  // η.4.4 — Bitemporal validity (orthogonal to supersession)
  validFrom?: string;
  validUntil?: string;
  observationMeta?: Array<{
    content: string;
    validFrom?: string;
    validUntil?: string;
    recordedAt?: string;  // bitemporal axis
  }>;
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

> Counts below are from `dependency-summary.compact.json` (2026-05-14)
> — the authoritative output of `tools/create-dependency-graph`. Repo
> totals: **236 source files, 79,841 LOC, 1,262 exports, 214 classes,
> 501 interfaces, 232 functions, 1 runtime + 3 type-only circular dependencies.**

```
src/ (236 TypeScript files, 79,841 lines of code)
├── index.ts              # Entry point, main exports
│
├── adapters/ (4 files)   # External-system adapter interfaces (Phase 4)
│   ├── IDatabaseAdapter.ts
│   ├── IVectorDBAdapter.ts
│   ├── LangChainMemoryAdapter.ts
│   └── RestRouter.ts
│
├── agent/ (66 files)     # Agent Memory System
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
├── core/ (25 files)      # Core managers and storage
│   ├── ManagerContext.ts         # Context holder (lazy init)
│   ├── EntityManager.ts          # Entity CRUD operations (with OCC)
│   ├── RelationManager.ts        # Relation CRUD (with temporal validity)
│   ├── ObservationManager.ts     # Observation add/delete (bitemporal)
│   ├── HierarchyManager.ts       # Parent-child relationships
│   ├── GraphStorage.ts           # JSONL file I/O + mmap branch + caching
│   ├── SQLiteStorage.ts          # SQLite backend (read pool, partial-index advisor)
│   ├── StorageFactory.ts         # Storage backend factory
│   ├── TransactionManager.ts     # Batch operations
│   ├── GraphTraversal.ts         # Graph algorithms (HITS / clique / Louvain added)
│   ├── GraphEventEmitter.ts      # Event-driven updates
│   ├── TransitionLedger.ts       # Entity state machine ledger
│   ├── EntityProxy.ts            # Phase 6 — proxy facade for WAL-backed writes
│   ├── WriteAheadLog.ts          # Phase 6 — durable mutation log
│   ├── mmap/                     # Phase 11 — memory-mapped file backends
│   │   ├── IMmapBackend.ts             # Interface + streamLines helper
│   │   ├── BufferMmapBackend.ts        # Read-everything-at-open reference impl
│   │   └── FsReadMmapBackend.ts        # Portable mmap-equivalent via FileHandle
│   ├── segments/                 # Phase 7 — FNV-routed JSONL shards
│   │   └── FileSegmentStorage.ts
│   ├── columns/                  # Phase 8 — columnar observation storage
│   │   ├── IColumnStore.ts             # Interface
│   │   ├── JsonlColumnStore.ts         # JSONL-backed impl
│   │   ├── InMemoryColumnStore.ts      # In-memory impl
│   │   └── ObservationColumn.ts        # Observation-specific column type
│   ├── tiered/                   # Phase 9 — hot / warm / cold index tiers
│   │   ├── ITieredIndex.ts             # Composer interface
│   │   ├── LRUHotTier.ts               # In-memory LRU
│   │   ├── DiskWarmTier.ts             # Uncompressed disk
│   │   └── BrotliColdTier.ts           # Compressed disk
│   └── index.ts                  # Barrel export
│
├── search/ (55 files)    # Search implementations
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
├── features/ (20 files)  # Advanced capabilities
│   ├── TagManager.ts             # Tag aliases
│   ├── IOManager.ts              # Import + export (backup logic extracted to BackupManager)
│   ├── BackupManager.ts          # Phase 5 — create / list / restore / delete / cleanOld
│   ├── ArchiveManager.ts         # Entity archival
│   ├── CompressionManager.ts     # Duplicate detection / entity merging
│   ├── CRDT.ts                   # Phase 5 — convergent replicated data type primitives
│   ├── AnomalyDetector.ts        # Phase 5 — LSH-backed anomaly detection
│   └── ...
│
├── types/ (8 files)      # TypeScript definitions
│   ├── types.ts                  # Core type definitions
│   ├── agent-memory.ts           # Agent memory types
│   ├── result.ts                 # Result<T,E> discriminated union (v2.0.0)
│   └── index.ts                  # Barrel export
│
├── utils/ (34 files)     # Shared utilities
│   ├── schemas.ts                # Zod validation schemas
│   ├── logger.ts                 # Phase 0 — structured logger
│   ├── taskScheduler.ts          # Phase 0 — priority task queue with bounds
│   ├── BatchProcessor.ts         # Batch processing utilities
│   ├── WorkerPoolManager.ts      # Worker pool management
│   ├── compression/              # Phase 10 — pluggable in-memory compression
│   │   ├── ICompressionAdapter.ts      # sync compress/decompress interface
│   │   ├── ZlibCompressionAdapter.ts   # Node zlib reference impl
│   │   ├── BrotliCompressionAdapter.ts # Node zlib brotli impl
│   │   ├── IdentityCompressionAdapter.ts # Test baseline (no-op)
│   │   └── CompressedMap.ts            # Map<K,V> with values compressed at rest
│   └── ...
│
├── security/ (5 files)   # PII redaction (η.6.3) + ABAC + RLS + API keys (Phase 5)
│   ├── PiiRedactor.ts
│   ├── abac.ts
│   ├── rls.ts
│   └── apiKeys.ts
│
├── cli/ (16 files)       # `memory` / `memoryjs` binary commands
│
└── workers/ (2 files)    # Web workers for CPU-intensive tasks
    ├── levenshteinWorker.ts      # Levenshtein calculations
    └── index.ts

# Sub-modules under agent/ (new since v1.13):
src/agent/causal/         # 3B.6 — CausalReasoner (findCauses / findEffects / counterfactual / detectCycles)
src/agent/procedural/     # 3B.4 — ProcedureManager + ProcedureStore + StepSequencer
src/agent/retrieval/      # 3B.5 — ActiveRetrievalController + QueryRewriter
src/agent/world/          # 3B.7 — WorldModelManager + WorldStateSnapshot
src/agent/rbac/           # η.6.1 — Role / Permission / Matrix / Middleware / RoleAssignmentStore
src/agent/collaboration/  # η.5.5.d — CollaborationAuditEnforcer
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

Most-used:

- `MEMORY_STORAGE_TYPE`: `jsonl` (default) or `sqlite`
- `MEMORY_BACKEND`: pluggable Memory Engine — `sqlite` (default) or `in-memory`
- `MEMORY_EMBEDDING_PROVIDER`: `openai`, `local` (default), or `none`
- `MEMORY_OPENAI_API_KEY`: required when using OpenAI embeddings
- `MEMORY_AGENT_ROLE`: built-in role profile (`researcher`/`planner`/`executor`/`reviewer`/`coordinator`)
- `MEMORY_GOVERNANCE_ENABLED`: enable `GovernanceManager`
- `MEMORY_AUDIT_LOG_FILE`: path for JSONL audit trail
- `MEMORY_VALIDATE_ON_STORE`: run `MemoryValidator` before observation writes
- `MEMORY_AUDIT_ATTRIBUTION_REQUIRED`: `CollaborationAuditEnforcer` strict mode
- `MEMORY_RBAC_ENABLED`: wire `RbacMiddleware` into `GovernancePolicy`

Full reference (~50 variables): see [CLAUDE.md](../../CLAUDE.md#environment-variables).

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
