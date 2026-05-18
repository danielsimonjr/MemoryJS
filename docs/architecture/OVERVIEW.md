# MemoryJS — Project Overview

A TypeScript knowledge-graph library for managing entities, relations, and
observations with advanced search, bitemporal versioning, causal reasoning,
role-based access control, multi-agent collaboration, and pluggable storage
backends. Powers
[@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp)
and can be embedded directly into TypeScript / Node.js apps.

## Key capabilities

| Area | Description |
|---|---|
| Knowledge graph | Entity-Relation-Observation model in a flexible directed graph |
| Storage backends | JSONL (human-readable) or SQLite (FTS5 + BM25); pluggable `IMemoryBackend` for the memory engine |
| Hierarchical nesting | Parent-child relationships for tree organisation |
| Advanced search | Basic / ranked (TF-IDF, BM25) / boolean / fuzzy (N-gram pre-filtered) / semantic / hybrid / temporal / LLM-planned / active iterative retrieval |
| Agent Memory System | Sessions, working memory, episodic memory, decay, multi-agent visibility, role profiles, entropy filtering, recursive consolidation |
| Memory types | Catalog-aligned `MemoryType` slots: `working`, `episodic`, `semantic`, `procedural`, `prospective`, `failure`, `plan`, `reflection`, `heuristic` |
| Trust hierarchy | Discriminated `TrustLevel` mixin on `MemorySource` (`ground-truth` / `verified` / `inferred` / `unverified`); `inferTrustLevel` backfill from `method` + `reliability`; `'trust_level'` `ConflictStrategy` with recency tiebreak |
| Bitemporal versioning | `validFrom` / `validUntil` on entities, observations, and relations; time-travel queries |
| Memory intelligence | Validator (consistency / contradictions), `TrajectoryCompressor`, `ExperienceExtractor`, `PatternDetector` |
| Memory theory | Procedural memory, active retrieval, causal reasoning, world-model orchestrator |
| Multi-agent collaboration | Visibility hierarchies (5-level + role + time-window), optimistic concurrency, attribution enforcement, conflict view |
| Duplicate detection | Four-tier dedup (exact / prefix / Jaccard / semantic) + entity-level compression |
| Graph algorithms | Shortest path, all paths, degree / betweenness / PageRank / HITS centrality, connected components, communities (Louvain), cliques, BFS / DFS |
| Multi-format export | JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid; W3C Linked Data: Turtle, RDF/XML, JSON-LD |
| Access control | RBAC (Role / Permission / Matrix / Middleware), audit attribution enforcer, governance policies; ABAC + RLS + API keys |
| Privacy | `PiiRedactor` (email / SSN / CC / phone / IP) with per-pattern statistics |
| Memory-mapped I/O | `IMmapBackend` + `FsReadMmapBackend`; `GraphStorage.loadFromDisk` mmap branch gated by `MEMORY_USE_MMAP` + `MEMORY_MMAP_THRESHOLD_BYTES` |
| Segment-sharded JSONL | `FileSegmentStorage` — FNV-routed N-way shards via `MEMORY_STORAGE_SEGMENT_COUNT` (1–1024) |
| Columnar observation store | `IColumnStore<T>` + `JsonlColumnStore` — observation data physically separated from entity rows |
| Tiered index | `LRUHotTier` (in-memory) → `DiskWarmTier` (uncompressed JSONL) → `BrotliColdTier` (compressed); composed via `TieredIndex` |
| In-memory compression | `ICompressionAdapter` (sync `compress`/`decompress`) + `ZlibCompressionAdapter` + `IdentityCompressionAdapter` + `CompressedMap` |
| Error-handling contract | `Result<T, E>` discriminated-union type in `src/types/result.ts`. Throw for programmer errors, return `Result` for expected domain failures, absent-value sentinel is `T \| undefined` not `T \| null` |

## Quick architecture overview

```
┌────────────────────────────────────────────────────────┐
│              Application / MCP Server / AI Agent       │
└───────────────────────┬────────────────────────────────┘
                        │ (library usage)
┌───────────────────────┴────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade)              │
│  Lazy-initialised access to every manager              │
│  ctx.agentMemory() — Agent Memory System facade        │
└───────────────────────┬────────────────────────────────┘
                        │ (direct manager access)
┌───────────────────────┴────────────────────────────────┐
│  Layer 2: Specialised managers                         │
│  Core:    EntityManager / RelationManager /            │
│           ObservationManager / HierarchyManager /      │
│           SearchManager / GraphTraversal / RefIndex    │
│  I/O:     IOManager / Archive / Compression /          │
│           Analytics / Audit / Governance / Freshness   │
│  Search:  Ranked / Semantic / Temporal /               │
│           LLMQueryPlanner / ActiveRetrievalController  │
│  Memory:  MemoryEngine / MemoryBackend /               │
│           ContextWindowManager / AgentMemory()         │
│  Types:   ProspectiveMemoryManager / FailureManager /  │
│           PlanManager / ReflectionManager /            │
│           HeuristicManager / DecisionManager /         │
│           ProjectContextManager / ToolAffordanceManager│
│  Intel:   MemoryValidator / TrajectoryCompressor /     │
│           ExperienceExtractor / PatternDetector        │
│  Theory:  ProcedureManager / CausalReasoner /          │
│           WorldModelManager                            │
│  Auth:    RbacMiddleware / RoleAssignmentStore /       │
│           AccessTracker                                │
└───────────────────────┬────────────────────────────────┘
                        │
┌───────────────────────┴────────────────────────────────┐
│  Layer 3: Storage                                      │
│  GraphStorage (JSONL) — optionally:                    │
│    • mmap branch via FsReadMmapBackend (large files)   │
│    • FileSegmentStorage (FNV-routed JSONL shards)      │
│    • JsonlColumnStore (columnar observation data)      │
│    • TieredIndex (LRU hot / disk warm / Brotli cold)   │
│    • CompressedMap (Zlib in-memory entry cache)        │
│  OR SQLiteStorage (better-sqlite3, FTS5, BM25,         │
│    read pool, PartialIndexAdvisor)                     │
└────────────────────────────────────────────────────────┘
```

## Data model

### Entity (graph node)

```typescript
interface Entity {
  // Core
  name: string;           // Unique identifier
  entityType: string;     // Classification (person, project, concept, …)
  observations: string[]; // Atomic facts about the entity
  parentId?: string;      // Hierarchical parent
  tags?: string[];        // Categories (lowercase)
  importance?: number;    // Priority 0–10
  createdAt?: string;     // ISO 8601
  lastModified?: string;  // ISO 8601

  // Freshness
  ttl?: number;
  confidence?: number;

  // Project scoping + supersession
  projectId?: string;
  version?: number;
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // Memory-engine deduplication
  contentHash?: string;   // SHA-256 for O(1) exact-equality dedup

  // Bitemporal validity (orthogonal to supersession)
  validFrom?: string;
  validUntil?: string;
  observationMeta?: Array<{
    content: string;
    validFrom?: string;
    validUntil?: string;
    recordedAt?: string;
  }>;
}
```

### Relation (graph edge)

```typescript
interface Relation {
  from: string;         // Source entity name
  to: string;           // Target entity name
  relationType: string; // Active voice — "works_at", "knows", "depends_on"
}
```

## Directory structure

```
src/
├── index.ts          # Public entry point + barrel exports
├── adapters/         # External-system adapters (LangChainMemoryAdapter, RestRouter)
├── agent/            # Agent Memory System (managers, decay, salience,
│                     #   multi-agent, specialised memory types)
│   ├── causal/       # CausalReasoner
│   ├── procedural/   # ProcedureManager + StepSequencer
│   ├── retrieval/    # ActiveRetrievalController + QueryRewriter
│   ├── world/        # WorldModelManager + WorldStateSnapshot
│   ├── rbac/         # Role / Permission / Matrix / Middleware
│   └── collaboration/ # CollaborationAuditEnforcer
├── core/             # ManagerContext, entity / relation / observation
│   │                 #   managers, storage backends, graph traversal
│   ├── mmap/         # Memory-mapped I/O backends
│   ├── segments/     # FileSegmentStorage (FNV-routed shards)
│   ├── columns/      # IColumnStore + JsonlColumnStore + InMemoryColumnStore
│   └── tiered/       # LRU hot / disk warm / Brotli cold tiers
├── search/           # Ranked / boolean / fuzzy / semantic / hybrid /
│                     #   temporal / LLM-planned search + indexes
├── features/         # IOManager, Archive, Compression, Audit,
│                     #   Governance, Freshness, SemanticForget,
│                     #   ContradictionDetector
├── cli/              # `memory` / `memoryjs` CLI binary
├── security/         # PII redactor, ABAC, RLS, API keys
├── types/            # Entity, Relation, AgentEntity, Result<T,E>, …
├── utils/            # Caching, schemas, compression adapters, logger
│   └── compression/  # ICompressionAdapter + Zlib + Identity + CompressedMap
└── workers/          # Worker pool for CPU-intensive tasks
```

The autogenerated module breakdown lives at
[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md).

## Key design principles

1. **Context pattern**: `ManagerContext` holds all managers with lazy-init getters.
2. **Lazy initialisation**: managers instantiated on first access via `??=`.
3. **Dual storage backends**: JSONL (default) or SQLite, selected via `MEMORY_STORAGE_TYPE`.
4. **Dependency injection**: `IGraphStorage` is injected into managers for testability.
5. **Barrel exports**: every module re-exports through `index.ts`.
6. **Worker parallelism**: fuzzy search offloads Levenshtein to a worker pool.
7. **Event-driven cache invalidation**: `GraphEventEmitter` triggers TF-IDF index updates on entity changes.

## Performance characteristics

- **Caching**: in-memory graph cache with write-through invalidation.
- **Batch operations**: single I/O cycle for bulk creates.
- **Duplicate detection**: O(n²/k) via entityType bucketing.
- **Search**: TF-IDF / BM25 indexes for ranked relevance; trigram N-gram pre-filter shrinks the Levenshtein candidate set on fuzzy queries.
- **SQLite**: FTS5 + BM25, WAL mode, opt-in read-connection pool.
- **Large files**: opt-in mmap branch (`MEMORY_USE_MMAP`) avoids loading the whole JSONL into RAM.

## Storage files

| File | Purpose |
|---|---|
| `memory.jsonl` | Main graph (entities + relations) |
| `memory.db` | SQLite database (alternative backend) |
| `*-saved-searches.jsonl` | Saved search queries |
| `*-tag-aliases.jsonl` | Tag synonym mappings |
| `*-ref-index.jsonl` | Stable named references |
| `*-observations.jsonl` | Columnar observation sidecar (env-gated) |

## Getting started

```bash
npm install @danielsimonjr/memoryjs
```

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Create entities
await ctx.entityManager.createEntities([
  { name: 'TypeScript', entityType: 'language', observations: ['Typed superset of JavaScript'] },
]);

// Search
const result = await ctx.searchManager.autoSearch('TypeScript');
console.log(result.results);
```

## Environment variables

Most-used:

- `MEMORY_STORAGE_TYPE` — `jsonl` (default) or `sqlite`
- `MEMORY_BACKEND` — pluggable Memory Engine: `sqlite` (default) or `in-memory`
- `MEMORY_EMBEDDING_PROVIDER` — `openai`, `local` (default), or `none`
- `MEMORY_OPENAI_API_KEY` — required when using OpenAI embeddings
- `MEMORY_AGENT_ROLE` — built-in role profile (`researcher` / `planner` / `executor` / `reviewer` / `coordinator`)
- `MEMORY_GOVERNANCE_ENABLED` — enable `GovernanceManager`
- `MEMORY_AUDIT_LOG_FILE` — path for the audit JSONL trail
- `MEMORY_VALIDATE_ON_STORE` — run `MemoryValidator` before observation writes
- `MEMORY_AUDIT_ATTRIBUTION_REQUIRED` — `CollaborationAuditEnforcer` strict mode
- `MEMORY_RBAC_ENABLED` — wire `RbacMiddleware` into `GovernancePolicy`

Full reference: [CLAUDE.md](../../CLAUDE.md#environment-variables).

## Related documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — in-depth technical architecture
- [COMPONENTS.md](./COMPONENTS.md) — module-by-module breakdown
- [AGENT_MEMORY.md](./AGENT_MEMORY.md) — Agent Memory System
- [DATAFLOW.md](./DATAFLOW.md) — data-flow patterns
- [API.md](./API.md) — public API reference
- [DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md) — autogenerated dependency analysis
- [TEST_COVERAGE.md](./TEST_COVERAGE.md) — autogenerated test-coverage report
