# MemoryJS

[![Version](https://img.shields.io/badge/version-2.4.0-blue.svg)](https://github.com/danielsimonjr/memoryjs)
[![NPM](https://img.shields.io/npm/v/@danielsimonjr/memoryjs.svg)](https://www.npmjs.com/package/@danielsimonjr/memoryjs)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-7127%20passing-brightgreen.svg)](https://github.com/danielsimonjr/memoryjs)

A **TypeScript knowledge graph library** for managing entities, relations, and observations with **advanced search**, **hierarchical organization**, **bitemporal versioning**, **causal reasoning**, **role-based access control**, **multi-agent collaboration**, **memory-mapped I/O**, **segment-sharded JSONL**, **tiered indexing**, and **multiple storage backends**.

> Core library powering [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp). **235 TypeScript files**, **79,378 lines of code**, **7127+ passing tests**, dual storage backends (JSONL/SQLite + pluggable `IMemoryBackend`), comprehensive search (BM25 with incremental indexing, TF-IDF, fuzzy with N-gram pre-filter, semantic, hybrid, temporal, LLM-planned, active iterative retrieval, minimal SPARQL subset), and a complete **Agent Memory System** for AI agents — role profiles, entropy filtering, recursive consolidation, collaborative synthesis with conflict resolution, failure distillation, cognitive load analysis, visibility hierarchies, RBAC, optimistic concurrency, audit attribution, procedural memory, causal reasoning, world-model orchestrator, and the Phase 2 catalog-aligned memory-type slots: **prospective** (intentions-to-act), **failure** (structured pre-task lookup), **plan** (hierarchical goal trees), **reflection** (derived pattern + trajectory summary) + a discriminated `TrustLevel` provenance mixin.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Storage Options](#storage-options)
- [Search Capabilities](#search-capabilities)
- [Graph Algorithms](#graph-algorithms)
- [Agent Memory System](#agent-memory-system)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## Features

### Core Capabilities

- **Knowledge Graph Storage**: Entity-Relation-Observation model for structured data
- **Dual Storage Backends**: JSONL (human-readable) or SQLite (FTS5, 3-10x faster)
- **Full CRUD Operations**: Create, read, update, delete entities and relations
- **Hierarchical Nesting**: Parent-child relationships for tree structures
- **Timestamps**: Automatic createdAt and lastModified tracking

### Advanced Features

| Category | Description |
|----------|-------------|
| **Search Algorithms** | Basic, TF-IDF ranked, BM25, Boolean (AND/OR/NOT), Fuzzy (Levenshtein + N-gram pre-filter), Semantic (embeddings), Hybrid |
| **Graph Algorithms** | Shortest path (BFS), all paths, centrality metrics (degree, betweenness, PageRank), connected components |
| **Hierarchical Nesting** | Parent-child relationships, ancestor/descendant traversal, subtree operations |
| **Duplicate Detection** | Intelligent compression with similarity scoring |
| **Tag Management** | Tags, aliases, bulk operations, importance scores (0-10) |
| **Import/Export** | JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid formats with Brotli compression |
| **Analytics** | Graph statistics, validation, integrity checks |
| **Temporal Queries** | Natural language time parsing ("last hour", "10 minutes ago") via `searchByTime()` and `ManagerContext.temporalSearch` |
| **Memory Distillation** | Post-retrieval policy filter (relevance + freshness + dedup) wired into `ContextWindowManager` |
| **Freshness Auditing** | `Entity.ttl` / `Entity.confidence`, `FreshnessManager` reports, TTL-aware decay and salience weighting |
| **N-gram Search** | Trigram index with Jaccard pre-filtering reduces Levenshtein candidate set in `FuzzySearch` |
| **LLM Query Planner** | Optional natural language → `StructuredQuery` decomposition via `LLMProvider`; `ManagerContext.queryNaturalLanguage()` |
| **Governance & Audit** | `AuditLog` (JSONL), `GovernanceManager` (transactions/rollback), `GovernancePolicy` (canCreate/canUpdate/canDelete) |

### Module Statistics

| Module | Files | Key Components |
|--------|-------|----------------|
| `agent/` | 65 | AgentMemoryManager, SessionManager, DecayEngine, WorkingMemoryManager, ArtifactManager, DistillationPipeline, RoleProfiles, EntropyFilter, ConsolidationScheduler, MemoryFormatter, CollaborativeSynthesis, FailureDistillation, CognitiveLoadAnalyzer, VisibilityResolver, **MemoryEngine**, **MemoryValidator**, **TrajectoryCompressor**, **ExperienceExtractor**, **CausalReasoner**, **ProcedureManager**, **WorldModelManager**, **ActiveRetrievalController**, **CollaborationAuditEnforcer**, **RbacMiddleware**, **InMemoryBackend** / **SQLiteBackend**, **ProspectiveMemoryManager**, **FailureManager**, **PlanManager**, **ReflectionManager** (Phase 2 memory-type slots), **ReflectionStage** + **ProspectivePromotionStage** (pipeline stages) |
| `core/` | 25 | ManagerContext, EntityManager (with OCC), RelationManager (with temporal validity), ObservationManager (with bitemporal axis), HierarchyManager, GraphStorage, SQLiteStorage, GraphTraversal, TransactionManager, RefIndex, **FileSegmentStorage**, **WriteAheadLog** + **EntityProxy**, **JsonlColumnStore**, **TieredIndex** (`LRUHotTier`/`DiskWarmTier`/`BrotliColdTier`), **IMmapBackend** / **BufferMmapBackend** / **FsReadMmapBackend** |
| `search/` | 55 | SearchManager, RankedSearch (TF-IDF), BM25Search (incremental), BooleanSearch, FuzzySearch, SemanticSearch, HybridSearchManager, NGramIndex, TemporalQueryParser, TemporalSearch, LLMQueryPlanner, LLMSearchExecutor, EmbeddingService, VectorStore, **SparqlExecutor** (minimal subset), **PartialIndexAdvisor** |
| `features/` | 20 | IOManager (with RDF/Turtle/JSON-LD export), **BackupManager**, ArchiveManager, CompressionManager, StreamingExporter, FreshnessManager, AuditLog, GovernanceManager, ContradictionDetector, SemanticForget, AutoLinker, **CRDT**, **AnomalyDetector** |
| `utils/` | 34 | BatchProcessor, CompressedCache, WorkerPoolManager, MemoryMonitor, schemas (Zod), **ICompressionAdapter** / **BrotliCompressionAdapter** / **ZlibCompressionAdapter** / **IdentityCompressionAdapter** / **CompressedMap**, structured `logger`, scheduler/explainPlan/indexHealth diagnostics |
| `types/` | 7 | Entity, Relation, AgentEntity, SessionEntity, ArtifactEntity, Procedure, **ProspectiveEntity** / **FailureEntity** / **PlanEntity** / **ReflectionEntity** (Phase 2 per-type entities), **TrustLevel** mixin on `MemorySource` |
| `security/` | 5 | **PiiRedactor** + bundled patterns (email/SSN/CC/phone/IP), **ABAC + RLS + API keys** |
| `cli/` | 16 | `memory` / `memoryjs` binary commands (entity, relation, search, observation, tag, hierarchy, graph, io, maintenance) + pipe support |
| `adapters/` | 4 | `IDatabaseAdapter` / `IVectorDBAdapter` interfaces, `LangChainMemoryAdapter`, `RestRouter` |
| `workers/` | 2 | Levenshtein distance calculations |

**Total:** 235 TypeScript files | 79,378 lines of code | 7127+ passing tests | 11 modules | 1 runtime + 3 type-only circular dependencies (see `docs/architecture/DEPENDENCY_GRAPH.md`)

### Agent Memory

| Capability | Entry point |
|-----------|-------------|
| Sessions, working memory, episodic memory | `ctx.agentMemory()` — `startSession` / `addWorkingMemory` / `retrieveForContext` |
| Turn-aware conversation memory with 4-tier dedup (exact / prefix / Jaccard / semantic) | `ctx.memoryEngine.addTurn()` / `getSessionTurns()` |
| Time-based decay, salience scoring, freshness | `DecayEngine`, `SalienceEngine`, `ctx.freshnessManager` |
| Role profiles (`researcher` / `planner` / `executor` / `reviewer` / `coordinator`) | `MEMORY_AGENT_ROLE` / `RoleProfileManager.apply(role)` |
| Memory consolidation, summarization, pattern detection | `ConsolidationPipeline`, `ConsolidationScheduler` |
| Collaborative synthesis across agents with conflict resolution | `CollaborativeSynthesis.synthesize()` / `resolveConflicts()` |
| Failure-driven distillation, cognitive load analysis | `FailureDistillation`, `CognitiveLoadAnalyzer` |
| Procedural memory (executable procedures with feedback refinement) | `ctx.procedureManager.addProcedure()` / `matchProcedure()` / `refineProcedure()` |
| Active retrieval (iterative query rewriting) | `ctx.activeRetrieval.adaptiveRetrieve()` |
| Causal reasoning (causes / effects / counterfactuals / cycle detection) | `ctx.causalReasoner.findCauses()` / `findEffects()` / `counterfactual()` |
| World-state orchestrator | `ctx.worldModelManager.getCurrentState()` / `predictOutcome()` |
| Per-agent persistent journal | `AgentMemoryManager.writeDiary()` / `readDiary()` |
| Prospective memory (intentions-to-act with discriminated lifecycle) | `ctx.prospectiveMemory.schedule()` / `fire()` / `cancel()` |
| Failure memory (pre-task `applicability_hint` lookup) | `ctx.failureManager.record()` / `lookupForTask()` / `markResolved()` |
| Plan memory (hierarchical goal trees with invariant validation) | `ctx.plan.createPlan()` / `pushSubGoal()` / `transitionNode()` / `getCurrentPath()` |
| Reflection memory (additive derived insights with content-hash dedup) | `ctx.reflectionManager.create()` / `getRelevantForSession()` / `archive()` |
| Trust hierarchy (`ground-truth` / `verified` / `inferred` / `unverified`) | `MemorySource.trustLevel?:` + `'trust_level'` `ConflictStrategy` + `inferTrustLevel()` backfill |

### Search & Retrieval

| Capability | Entry point |
|-----------|-------------|
| Auto-selecting search with method explanation | `ctx.searchManager.autoSearch(query)` |
| TF-IDF + BM25 ranked search (incremental indexing) | `ctx.rankedSearch`, `BM25Search` |
| Boolean (AND / OR / NOT) with AST parser | `ctx.searchManager.booleanSearch()` |
| Fuzzy matching (Levenshtein, N-gram pre-filtered) | `ctx.searchManager.fuzzySearch()` |
| Semantic search with pluggable embedding provider | `ctx.semanticSearch` (set `MEMORY_EMBEDDING_PROVIDER`) |
| Hybrid (semantic + lexical + symbolic) | `ctx.hybridSearch` |
| Temporal range queries with natural-language parsing | `ctx.searchManager.searchByTime("last hour")` |
| LLM-planned natural-language queries | `ctx.queryNaturalLanguage(query, llmProvider?)` |
| Minimal SPARQL subset (BGP / FILTER / OPTIONAL / UNION) | `ctx.sparqlExecutor.query()` |
| Query diagnostics (`explainPlan`, index health) | `ctx.diagnostics` |

### Knowledge Graph

| Capability | Entry point |
|-----------|-------------|
| Entity / relation / observation CRUD | `ctx.entityManager`, `ctx.relationManager`, `ctx.observationManager` |
| Optimistic concurrency control on updates | `entityManager.updateEntity(name, updates, { expectedVersion })` |
| Bitemporal versioning (entities + observations) | `invalidateEntity()` / `entityAsOf()` / `entityTimeline()` |
| Temporal relations (validity windows) | `relationManager.invalidateRelation()` / `queryAsOf()` / `timeline()` |
| Memory versioning with contradiction-driven supersession | `Entity.version` / `parentEntityName` / `rootEntityName` / `supersededBy` |
| Project scoping | `Entity.projectId` + `MEMORY_DEFAULT_PROJECT_ID` |
| Two-tier deletion (exact match → 0.85 semantic fallback) | `ctx.semanticForget` |
| Hierarchical nesting + traversal (ancestors / descendants / subtrees) | `ctx.hierarchyManager` |
| Graph algorithms — shortest path, all paths, BFS / DFS | `ctx.graphTraversal.findShortestPath()` |
| Centrality — degree, betweenness, PageRank, HITS hub/authority | `ctx.graphTraversal.pageRank()` / `hits()` |
| Community detection (Louvain), clique enumeration | `ctx.graphTraversal.louvainCommunities()` / `findMaximalCliques()` |
| Stable named references for entity name changes | `ctx.refIndex.register()` / `resolve()` |
| Tag aliases, importance scores (0–10) | `ctx.tagManager`, `Entity.importance` |
| Multi-format import / export — JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid | `ctx.ioManager.exportGraph(format)` |
| W3C Linked Data export — Turtle, RDF/XML, JSON-LD | `ctx.ioManager.exportGraph('turtle' \| 'rdf-xml' \| 'json-ld')` |
| Conversation ingestion (format-agnostic) | `ctx.ioManager.ingest(input, options)` |

### Storage & Performance

| Capability | Entry point |
|-----------|-------------|
| JSONL or SQLite backend (FTS5, BM25, WAL mode) | `MEMORY_STORAGE_TYPE=jsonl\|sqlite` |
| Pluggable Memory Engine backend | `MEMORY_BACKEND=sqlite\|in-memory` |
| Memory-mapped file loading for stores > 100 MB | `MEMORY_USE_MMAP=true`, `MEMORY_MMAP_THRESHOLD_BYTES` |
| Segment-sharded JSONL (FNV-routed N-way shards) | `MEMORY_STORAGE_SEGMENT_COUNT=1..1024` |
| Columnar observation storage | `JsonlColumnStore`, `ObservationColumn` |
| Tiered index — LRU hot / disk warm / Brotli cold | `LRUHotTier` → `DiskWarmTier` → `BrotliColdTier` via `TieredIndex` |
| In-memory entity-cache compression (Zlib / Brotli / Identity) | `ctx.compressedEntityCache`, `CompressedMap` |
| Write-ahead log + entity proxy for durable mutations | `WriteAheadLog`, `EntityProxy` |
| Backup lifecycle (create / list / restore / delete / cleanOld) with symlink-attack guards | `ctx.ioManager` (delegates to `BackupManager`) |
| Streaming export with Brotli compression | `ctx.streamingExporter` |
| Entity archival to compressed storage | `ctx.archiveManager` |
| Duplicate detection + entity merging | `ctx.compressionManager` |
| LSH-based anomaly detection | `ctx.anomalyDetector` |

### Governance, Security, Multi-Agent

| Capability | Entry point |
|-----------|-------------|
| Policy enforcement + transactional rollback | `ctx.governanceManager.withTransaction()` / `GovernancePolicy` |
| Immutable JSONL audit trail | `ctx.auditLog` |
| Strict-mode attribution enforcer | `CollaborationAuditEnforcer` (requires `agentId` on every mutation) |
| RBAC — role / permission / matrix / middleware | `ctx.rbacMiddleware.checkPermission()` / `ctx.roleAssignmentStore` |
| ABAC + row-level security + API-key scoping | `src/security/abac.ts`, `rls.ts`, `apiKeys.ts` |
| PII redactor (email / SSN / CC / phone / IP) with per-pattern stats | `new PiiRedactor().redactGraph()` / `redactWithStats()` |
| Visibility hierarchies — 5-level (`private` / `team` / `org` / `shared` / `public`) | `VisibilityResolver.canAccess()` |
| Time-window + role-gated visibility | `AgentEntity.visibleFrom` / `visibleUntil` / `allowedRoles[]` |
| CRDT primitives for multi-writer scenarios | `src/features/CRDT.ts` |
| Path-traversal protection (defense-in-depth) | `validateFilePath(path, baseDir?, confineToBase=true)` |

## What's New

**Unreleased (Phase 2 memory-types expansion, 2026-05)** — Four catalog-aligned `MemoryType` slots and one provenance mixin land on top of v1.15:
- **Sprint 4 — Failure Memory**: `FailureManager` + `MemoryType: 'failure'` + `ctx.failureManager`. Structured `FailureRecord` with `applicability_hint` retrieval key; pre-task `lookupForTask(taskContext)` scoring; discriminated `MarkResolvedResult`.
- **Sprint 5 — Plan / Goal Stack**: `PlanManager` + `MemoryType: 'plan'` + `ctx.plan`. Recursive `GoalNode` tree with discriminated `PlanLifecycle` / `GoalNodeLifecycle`, branded `PlanId` / `GoalNodeId`, `validatePlanInvariants` after every mutation, cycle-protected DFS.
- **Sprint 6 — Trust Hierarchy formalization (partial)**: `TrustLevel` discriminated mixin on `MemorySource` (`'ground-truth' | 'verified' | 'inferred' | 'unverified'`) with `inferTrustLevel` backfill and `'trust_level'` `ConflictStrategy`. `CollaborativeSynthesis.resolveConflicts` ordering integration deferred.
- **Sprint 8 — Reflection Log scheduled pass**: `ReflectionManager` + `MemoryType: 'reflection'` + `ReflectionStage` pipeline stage + `ctx.reflectionManager` (publicly aliased as `ReflectionMemoryManager`). Additive (no supersession); content-hash dedup at create; session-end scheduling via `runOnSessionEnd(sessionId)` helper.

**v1.15.0** — Twelve-phase performance & scale track adding mmap-backed I/O, segment-sharded JSONL, columnar observation storage, tiered indexing, pluggable in-memory compression, a minimal SPARQL subset, write-ahead log, extracted `BackupManager`, CRDT primitives, ABAC + RLS + API keys, HITS / clique / Louvain graph algorithms, and a hardened security baseline (`crypto.randomBytes` for IDs, ReDoS-resistant regex escapes, bounded `TaskQueue`).

See [CHANGELOG.md](CHANGELOG.md) for the full per-version history. The roadmap and remaining items live in [`docs/roadmap/ROADMAP.md`](docs/roadmap/ROADMAP.md) and [`docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md`](docs/roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md).

## Installation

```bash
npm install @danielsimonjr/memoryjs
```

### Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## Quick Start

### 1. Initialize Storage

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default, human-readable)
const ctx = new ManagerContext('./memory.jsonl');

// Or SQLite storage (set MEMORY_STORAGE_TYPE=sqlite env var)
const ctx = new ManagerContext('./memory.db');
```

### 2. Create Entities

```typescript
await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'language',
    observations: ['A typed superset of JavaScript'],
    tags: ['programming', 'frontend'],
    importance: 8
  },
  {
    name: 'Node.js',
    entityType: 'runtime',
    observations: ['JavaScript runtime built on V8'],
    tags: ['backend', 'server']
  }
]);
```

### 3. Create Relations

```typescript
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' }
]);
```

### 4. Search

```typescript
// Basic search
const results = await ctx.searchManager.search('JavaScript');

// Ranked search (TF-IDF scoring)
const ranked = await ctx.searchManager.searchRanked('runtime environment', { limit: 10 });

// Boolean search
const filtered = await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// Fuzzy search (typo-tolerant; N-gram pre-filtered)
const fuzzy = await ctx.searchManager.fuzzySearch('Typscript', { threshold: 0.7 });

// Active retrieval — iterative query rewriting until coverage threshold
const adaptive = await ctx.activeRetrieval.adaptiveRetrieve({ query: 'memory leak' });
console.log(adaptive.bestResults, adaptive.bestCoverage, adaptive.rounds);
```

### 5. Multi-agent collaboration

```typescript
// Optimistic concurrency control — fail loudly on stale writes
try {
  await ctx.entityManager.updateEntity('Alice',
    { importance: 9 },
    { expectedVersion: 3 });
} catch (e) {
  if (e.name === 'VersionConflictError') {
    // Refetch + retry
  }
}

// Detect cross-agent conflicts after collaborative synthesis
const synth = await ctx.agentMemory().collaborativeSynthesis.synthesize('Alice');
const winners = ctx.agentMemory().collaborativeSynthesis.resolveConflicts(synth, {
  strategy: 'highest_confidence',
});

// Enforce attribution on every mutation
import { CollaborationAuditEnforcer, AuditLog } from '@danielsimonjr/memoryjs';
const enforcer = new CollaborationAuditEnforcer(
  ctx.entityManager,
  new AuditLog('./audit.jsonl'),
);
await enforcer.createEntities([{ name: 'X', entityType: 't', observations: ['fact'] }],
  'agent-alice'); // throws AttributionRequiredError if agentId is missing
```

### 6. Bitemporal versioning

```typescript
// Mark an entity as no longer valid at a specific time
await ctx.entityManager.invalidateEntity('OldFact', '2025-12-31T00:00:00Z');

// Time-travel query
const past = await ctx.entityManager.entityAsOf('Alice', '2024-06-15T00:00:00Z');

// Per-observation validity windows
await ctx.observationManager.invalidateObservation(
  'Alice', 'works at Acme', '2024-12-31T00:00:00Z',
);
const obsAtTime = await ctx.observationManager.observationsAsOf(
  'Alice', '2024-06-15T00:00:00Z',
);
```

### 7. Causal reasoning and world model

```typescript
// Forward inference — "what does X cause?"
const effects = await ctx.causalReasoner.findEffects('rain', ['flooding', 'erosion']);
// Counterfactual — "what if we remove this edge?"
const surviving = await ctx.causalReasoner.counterfactual({
  seed: 'rain', removeFrom: 'rain', removeTo: 'flooding', predict: 'flooding',
});

// World model snapshot + diff
const before = await ctx.worldModelManager.getCurrentState();
// ... mutations ...
const after = await ctx.worldModelManager.getCurrentState();
const change = ctx.worldModelManager.detectStateChange(before, after);
```

### 8. RBAC and PII redaction

```typescript
// Grant a role
await ctx.roleAssignmentStore.assign({
  agentId: 'alice', role: 'writer', resourceType: 'entity',
});
ctx.rbacMiddleware.checkPermission('alice', 'write', 'entity'); // true

// Redact PII from any export
import { PiiRedactor } from '@danielsimonjr/memoryjs';
const redactor = new PiiRedactor();
const cleanGraph = redactor.redactGraph(graph);
const { text, stats } = redactor.redactWithStats(observation);
```

## Core Concepts

### Entities

Primary nodes in the knowledge graph.

```typescript
interface Entity {
  name: string;              // Unique identifier
  entityType: string;        // Classification (person, project, concept)
  observations: string[];    // Facts about the entity
  parentId?: string;         // Parent entity for hierarchical nesting
  tags?: string[];           // Lowercase tags for categorization
  importance?: number;       // 0-10 scale for prioritization
  createdAt?: string;        // ISO 8601 timestamp
  lastModified?: string;     // ISO 8601 timestamp

  // Freshness
  ttl?: number;              // Seconds until stale
  confidence?: number;       // [0, 1] belief strength

  // Project scoping + supersession
  projectId?: string;        // Multi-project isolation
  version?: number;          // Supersession chain version (also drives η.5.5.c OCC)
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // Memory Engine dedup
  contentHash?: string;      // SHA-256 for O(1) Tier-1 dedup

  // η.4.4 — Bitemporal validity (orthogonal to supersession)
  validFrom?: string;        // Entity valid from this instant
  validUntil?: string;       // Entity valid until this instant
  observationMeta?: Array<{  // Per-observation validity windows
    content: string;
    validFrom?: string;
    validUntil?: string;
    recordedAt?: string;     // Bitemporal axis
  }>;
}
```

### Relations

Directed connections between entities.

```typescript
interface Relation {
  from: string;           // Source entity name
  to: string;             // Target entity name
  relationType: string;   // Relationship type (active voice)
}
```

### Observations

Discrete facts about entities. Each observation should be atomic and independently manageable. Use `addObservations()` to append new facts without overwriting existing ones.

### ManagerContext

Central access point for all managers with lazy initialization:

```typescript
// Core
ctx.entityManager        // Entity CRUD + hierarchy + temporal validity + OCC
ctx.relationManager      // Relation management + temporal invalidation
ctx.observationManager   // Observation CRUD + bitemporal axis
ctx.hierarchyManager     // Entity tree (parents, children, ancestors)
ctx.searchManager        // All search operations (incl. searchByTime)
ctx.rankedSearch         // TF-IDF / BM25 ranked search
ctx.graphTraversal       // BFS / DFS / shortest path / centrality
ctx.tagManager           // Tag aliases + bulk operations
ctx.refIndex             // Stable name → entity O(1) lookup

// Storage + I/O
ctx.ioManager            // Import / export (incl. RDF/Turtle/JSON-LD) / backup / ingest
ctx.archiveManager       // Entity archival
ctx.compressionManager   // Duplicate detection, entity merging
ctx.analyticsManager     // Graph statistics + validation
ctx.semanticForget       // Two-tier deletion with audit
ctx.governanceManager    // Transactions + policy enforcement (canCreate/Update/Delete)
ctx.freshnessManager     // TTL/confidence freshness reports

// Search extensions
ctx.semanticSearch       // Vector similarity (lazy; needs embedding provider)
ctx.temporalSearch       // Natural language time-range search
ctx.activeRetrieval      // 3B.5 — iterative query rewriting (no LLM)
ctx.llmQueryPlanner()    // NL → StructuredQuery decomposition (optional LLM)
ctx.queryNaturalLanguage // Convenience wrapper around the planner

// Memory + agent
ctx.memoryEngine         // Turn-aware conversation memory (4-tier dedup)
ctx.memoryBackend        // Pluggable IMemoryBackend (in-memory / sqlite)
ctx.contextWindowManager // 4-layer wake-up stack + token budgeting
ctx.agentMemory()        // Full Agent Memory System facade

// Memory intelligence
ctx.memoryValidator         // Validate consistency / contradictions / temporal order
ctx.trajectoryCompressor    // Distill / abstract / merge redundant trajectories
ctx.experienceExtractor     // Cluster trajectories → reusable experience patterns
ctx.patternDetector         // Trigger / sequence / outcome pattern mining

// Memory theory
ctx.procedureManager     // 3B.4 — executable procedure memory + EWMA refinement
ctx.causalReasoner       // 3B.6 — findCauses / findEffects / counterfactual
ctx.worldModelManager    // 3B.7 — snapshot orchestrator + state-change diff

// Access control + audit
ctx.roleAssignmentStore  // η.6.1 — role grants registry
ctx.rbacMiddleware       // η.6.1 — RbacPolicy.checkPermission()
ctx.accessTracker        // Per-entity access metrics
```

## Storage Options

### Comparison

| Feature | JSONL (Default) | SQLite (better-sqlite3) |
|---------|-----------------|-------------------------|
| Format | Human-readable text | Native binary database |
| Transactions | Basic | Full ACID with WAL mode |
| Full-Text Search | Basic | FTS5 with BM25 ranking |
| Performance | Good | 3-10x faster |
| Concurrency | Single-threaded | Thread-safe with async-mutex |
| Best For | Small graphs, debugging | Large graphs (10k+ entities) |

### JSONL Storage

```typescript
const ctx = new ManagerContext('./memory.jsonl');
```

Features:
- Human-readable line-delimited JSON
- In-memory caching with write-through invalidation
- Atomic writes via temp file + rename
- Backward compatibility for legacy formats

### SQLite Storage

```typescript
// Set MEMORY_STORAGE_TYPE=sqlite environment variable
const ctx = new ManagerContext('./memory.db');
```

Features:
- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- Referential integrity with ON DELETE CASCADE
- ACID transactions

### Storage Files

When using JSONL, related files are automatically created:

```
/your/data/directory/
├── memory.jsonl                    # Main knowledge graph
├── memory-saved-searches.jsonl     # Saved search queries
├── memory-tag-aliases.jsonl        # Tag synonym mappings
└── .backups/                       # Timestamped backups
```

## Search Capabilities

### Search Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `searchManager.search()` | Basic substring matching | Simple queries |
| `searchManager.searchRanked()` | TF-IDF relevance scoring | Finding most relevant results |
| `searchManager.booleanSearch()` | AND/OR/NOT operators with AST | Complex filtering |
| `searchManager.fuzzySearch()` | Levenshtein + N-gram pre-filter | Typo tolerance |
| `searchManager.hybridSearch()` | Semantic + lexical + symbolic | Multi-signal ranking |
| `searchManager.searchByTime()` | Natural-language time ranges | "last hour", "10 minutes ago" |
| `activeRetrieval.adaptiveRetrieve()` | Iterative rewrite + retrieve | Adaptive coverage refinement |
| `queryNaturalLanguage()` | LLM-planned decomposition | Free-text queries (optional LLM provider) |
| `causalReasoner.findEffects()` | Causal subgraph traversal | Inference over `causes`/`enables`/`prevents` edges |

### Basic Search

```typescript
const results = await ctx.searchManager.search('TypeScript');
```

### Ranked Search (TF-IDF)

```typescript
const ranked = await ctx.searchManager.searchRanked('JavaScript runtime', {
  limit: 10,
  minScore: 0.1
});
```

### Boolean Search

```typescript
// AND - both terms must match
const results = await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// OR - either term matches
const results = await ctx.searchManager.booleanSearch('frontend OR backend');

// NOT - exclude term
const results = await ctx.searchManager.booleanSearch('JavaScript NOT browser');

// Parentheses for grouping
const results = await ctx.searchManager.booleanSearch('(TypeScript OR JavaScript) AND server');
```

### Fuzzy Search

```typescript
// Typo-tolerant search with threshold (0-1, higher = stricter)
const results = await ctx.searchManager.fuzzySearch('Typscript', {
  threshold: 0.7
});
```

### Hybrid Search

Combines three signal layers for sophisticated ranking:

```typescript
const results = await ctx.searchManager.hybridSearch('programming concepts', {
  weights: {
    semantic: 0.5,   // Vector similarity (requires embeddings)
    lexical: 0.3,    // TF-IDF text matching
    symbolic: 0.2    // Metadata (tags, importance, type)
  },
  filters: {
    entityTypes: ['concept'],
    minImportance: 5,
    tags: ['programming']
  }
});
```

## Graph Algorithms

### Path Finding

```typescript
// Shortest path between entities (BFS)
const path = await ctx.graphTraversal.findShortestPath('A', 'Z');
// Returns: ['A', 'B', 'C', 'Z']

// All paths with max depth
const paths = await ctx.graphTraversal.findAllPaths('A', 'Z', { maxDepth: 5 });
// Returns: [['A', 'B', 'Z'], ['A', 'C', 'D', 'Z'], ...]
```

### Centrality Analysis

```typescript
// Calculate importance metrics
const centrality = await ctx.graphTraversal.getCentrality({
  algorithm: 'pagerank'  // or 'degree', 'betweenness'
});
// Returns: Map<string, number> with entity scores
```

### Connected Components

```typescript
// Find isolated subgraphs
const components = await ctx.graphTraversal.getConnectedComponents();
// Returns: [['A', 'B', 'C'], ['X', 'Y'], ...]
```

### Traversal

```typescript
// Breadth-first traversal
await ctx.graphTraversal.bfs('startNode', (node) => {
  console.log('Visited:', node.name);
});

// Depth-first traversal
await ctx.graphTraversal.dfs('startNode', (node) => {
  console.log('Visited:', node.name);
});
```

## Agent Memory System

A complete memory system for AI agents with working memory, episodic memory, decay mechanisms, and multi-agent support.

### Key Components

| Component | Description |
|-----------|-------------|
| **AgentMemoryManager** | Unified facade for all agent memory operations |
| **SessionManager** | Session lifecycle management |
| **WorkingMemoryManager** | Short-term memory with promotion to long-term |
| **EpisodicMemoryManager** | Timeline-based episodic memory |
| **DecayEngine** | Time-based memory importance decay |
| **SalienceEngine** | Context-aware memory scoring |
| **MultiAgentMemoryManager** | Shared memory with visibility controls |
| **ConflictResolver** | Resolution strategies for concurrent updates |

### Quick Start

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const agent = ctx.agentMemory();

// Start a session
const session = await agent.startSession({ agentId: 'my-agent' });

// Add working memory
await agent.addWorkingMemory({
  sessionId: session.name,
  content: 'User prefers dark mode',
  importance: 7
});

// Create episodic memory
await agent.createEpisode('Completed onboarding flow', {
  sessionId: session.name,
  importance: 8
});

// Retrieve context for LLM prompt
const context = await agent.retrieveForContext({
  maxTokens: 2000,
  includeEpisodic: true
});

// End session
await agent.endSession(session.name);
```

### Memory Types

```typescript
type MemoryType =
  | 'working'      // Short-term, session-scoped memories that may be promoted
  | 'episodic'     // Timeline-based event memories with temporal ordering
  | 'semantic'     // Long-term factual knowledge
  | 'procedural'   // Learned behaviors and patterns (3B.4)
  | 'prospective'  // (Phase 1) Intentions-to-act at a future time / event / condition
  | 'failure'      // (Phase 2 Sprint 4) Pre-task failure lookup with applicability_hint
  | 'plan'         // (Phase 2 Sprint 5) Hierarchical goal trees with sub-tasks + acceptance criteria
  | 'reflection';  // (Phase 2 Sprint 8) Additive derived insights with content-hash dedup
```

- **Working Memory**: Short-term, session-scoped memories that may be promoted
- **Episodic Memory**: Timeline-based event memories with temporal ordering
- **Semantic Memory**: Long-term factual knowledge
- **Procedural Memory**: Learned behaviors and patterns (`ctx.procedureManager`)
- **Prospective Memory**: Forward-looking intentions with discriminated `ProspectiveLifecycle` (`pending` / `fired` / `cancelled` / `expired`); `ctx.prospectiveMemory`. Catalog Type 4
- **Failure Memory**: Structured `FailureRecord` with `applicability_hint` as the retrieval key; `markResolved` returns discriminated `MarkResolvedResult`; `ctx.failureManager`. Catalog Type 9
- **Plan Memory**: Recursive `GoalNode` tree with discriminated `PlanLifecycle` / `GoalNodeLifecycle`, branded `PlanId` / `GoalNodeId`, `validatePlanInvariants` after every mutation; `ctx.plan`. Catalog Type 6
- **Reflection Memory**: Additive (no supersession of evidence entities) with `ReflectionScope` discriminator (`session` / `project` / `global`); content-hash dedup at `create`; `ctx.reflectionManager`. Catalog Type 10. Produced by `ReflectionStage` pipeline stage

**Trust-hierarchy mixin** (Phase 2 Sprint 6, Catalog Type 12): every `MemorySource` may carry an optional categorical `trustLevel?: TrustLevel` (`'ground-truth' | 'verified' | 'inferred' | 'unverified'`) — backfilled from `method` + `reliability` via `inferTrustLevel(source)`. Powers the `'trust_level'` `ConflictStrategy` with recency tiebreak.

### Decay System

Memories naturally decay over time unless reinforced:

```typescript
// Configure decay behavior
const agent = ctx.agentMemory({
  decay: {
    halfLifeHours: 168,  // 1 week half-life
    minImportance: 0.1   // Never fully forget
  },
  enableAutoDecay: true
});

// Reinforce important memories
await agent.confirmMemory('memory_name', 0.1);  // Boost confidence
await agent.promoteMemory('memory_name', 'episodic');  // Promote to long-term
```

### Multi-Agent Support

```typescript
// Register agents
agent.registerAgent('agent_1', {
  name: 'Research Agent',
  type: 'llm',
  trustLevel: 0.8,
  capabilities: ['read', 'write']
});

// Create memories with visibility controls
await agent.addWorkingMemory({
  sessionId: session.name,
  content: 'Shared insight',
  visibility: 'shared',  // 'private' | 'shared' | 'public'
  ownerAgentId: 'agent_1'
});

// Cross-agent search
const results = await agent.searchCrossAgent('agent_2', 'query');
```

## API Reference

### EntityManager

| Method | Description |
|--------|-------------|
| `createEntities(entities)` | Create multiple entities |
| `deleteEntities(names)` | Delete entities by name |
| `getEntity(name, options?)` | Get single entity (with optional access tracking) |
| `updateEntity(name, updates, { expectedVersion? })` | Partial update; OCC if `expectedVersion` provided (η.5.5.c) |
| `batchUpdate(updates[])` | Atomic multi-entity update |
| `addTags(name, tags)` / `removeTags(name, tags)` | Tag management |
| `setImportance(name, score)` | Set importance (0-10) |
| `getVersionChain(name)` / `getLatestVersion(name)` | supersession chains |
| `invalidateEntity(name, ended?)` | η.4.4 — set `validUntil` |
| `entityAsOf(name, asOf)` | η.4.4 — time-travel query |
| `entityTimeline(name)` | η.4.4 — versions sorted by `validFrom` |

### RelationManager

| Method | Description |
|--------|-------------|
| `createRelations(relations)` | Create multiple relations |
| `getRelations(entityName)` | Get incoming/outgoing relations |
| `deleteRelations(relations)` | Delete specific relations |
| `invalidateRelation(from, type, to, ended?)` | set `validUntil` on a relation |
| `queryAsOf(entity, asOf, { direction? })` | relations valid at time T |
| `timeline(entity, { direction? })` | chronological history |

### ObservationManager

| Method | Description |
|--------|-------------|
| `addObservations(adds, dedupOptions?)` | Add observations (with optional dedup) |
| `deleteObservations(deletions)` | Remove specific observations |
| `invalidateObservation(entity, content, ended?)` | η.4.4 — set per-observation `validUntil` |
| `observationsAsOf(entity, asOf)` | η.4.4 — observations valid at time T |

### SearchManager

| Method | Description |
|--------|-------------|
| `search(query, options)` | Basic substring search |
| `searchRanked(query, options)` | TF-IDF ranked search |
| `booleanSearch(query, options)` | Boolean operators (AND/OR/NOT) |
| `fuzzySearch(query, options)` | Levenshtein-based typo tolerance |
| `hybridSearch(query, options)` | Multi-signal search |
| `autoSearch(query, limit?)` | Auto-select best search method |

### IOManager

| Method | Description |
|--------|-------------|
| `exportGraph(graph, format)` | Export to `json` / `csv` / `graphml` / `gexf` / `dot` / `markdown` / `mermaid` / `turtle` / `rdf-xml` / `json-ld` |
| `exportGraphWithCompression(graph, format, options?)` | Brotli-compressed export |
| `importGraph(format, data, options)` | Import with merge strategies (`replace` / `skip` / `merge` / `fail`) |
| `ingest({ messages }, options?)` | conversation ingestion pipeline |
| `splitSessions(content, options?)` | split multi-session transcripts |
| `visualizeGraph(options?)` | interactive HTML visualization |
| `createBackup(options)` / `restoreBackup(path)` | Backup management |

### GraphTraversal

| Method | Description |
|--------|-------------|
| `findShortestPath(from, to)` | BFS shortest path |
| `findAllPaths(from, to, maxDepth, options?)` | All paths with max depth |
| `getCentrality(options)` | Centrality metrics (degree / betweenness / pagerank) |
| `getConnectedComponents()` | Find isolated subgraphs |
| `bfs(start, options)` / `dfs(start, options)` | Traversal |

### CausalReasoner

| Method | Description |
|--------|-------------|
| `findEffects(cause, candidates, maxDepth?)` | Forward causal inference; sorted by `Π causalStrength` |
| `findCauses(effect, candidates, maxDepth?)` | Backward inference (symmetric inverse) |
| `counterfactual({ seed, removeFrom, removeTo, predict })` | Chains surviving edge removal (pure; no graph mutation) |
| `detectCycles(seed, maxDepth?)` | Depth-bounded DFS over causal subgraph |

### ProcedureManager

| Method | Description |
|--------|-------------|
| `addProcedure({ steps, ... })` | Persist a procedure; auto-generates id |
| `getProcedure(id)` / `getStep(id, order)` / `getNextStep(id, order)` | Access |
| `openSequencer(id)` | Stateful execution cursor with fallback support |
| `matchProcedure(context, candidates, threshold?)` | Token-overlap match |
| `refineProcedure(id, { succeeded, notes? })` | EWMA success-rate update |

### WorldModelManager

| Method | Description |
|--------|-------------|
| `getCurrentState()` | `WorldStateSnapshot` from live graph (capped at `maxSnapshotSize`) |
| `validateFact(observation, entityName)` | Delegates to `MemoryValidator` if wired |
| `predictOutcome(action, candidates)` | Delegates to `CausalReasoner.findEffects` |
| `detectStateChange(before, after)` | Pure snapshot diff |

### ActiveRetrievalController

| Method | Description |
|--------|-------------|
| `shouldRetrieve(context)` | Cost heuristic; rejects empty / over-budget |
| `adaptiveRetrieve(context)` | Iterative rewrite + retrieve until coverage threshold |

### CollaborativeSynthesis

| Method | Description |
|--------|-------------|
| `synthesize(seedEntity, context?)` | BFS + salience scoring; surfaces multi-agent `conflicts[]` |
| `resolveConflicts(result, policy)` | Pick winners per `most_recent` / `highest_confidence` / `highest_score` / `trusted_agent` |

### MemoryValidator

| Method | Description |
|--------|-------------|
| `validateConsistency(newObs, existing)` | Composite duplicate / semantic / low-confidence check |
| `detectContradictions(entity)` | Delegates to `ContradictionDetector` |
| `repairWithResolver(entity, competing, resolver, contradiction?, options?)` | Apply `ConflictResolver` strategies |
| `validateTemporalOrder(observations)` | Sync `[T=ISO]` ordering check |
| `calculateReliability(entity)` | Confidence × confirmation × age penalty |

### RbacMiddleware

| Method | Description |
|--------|-------------|
| `checkPermission(agentId, action, resourceType, resourceName?, now?)` | Returns `true` / `false`; falls back to `defaultRole` (default `reader`) |
| `roleAssignmentStore.assign({ agentId, role, resourceType?, scope?, validFrom?, validUntil? })` | Grant a role |
| `roleAssignmentStore.revoke(agentId, role, resourceType?)` | Remove a grant |
| `roleAssignmentStore.listActive(agentId, now?)` | Active grants at a point in time |

### PiiRedactor

| Method | Description |
|--------|-------------|
| `redact(text)` | Apply patterns; returns redacted string |
| `redactWithStats(text)` | Returns `{ text, stats: { totalRedactedBytes, countsByPattern } }` |
| `redactGraph(graph)` | Apply to every observation in a graph-shaped object |

### ProspectiveMemoryManager (`ctx.prospectiveMemory`)

| Method | Description |
|--------|-------------|
| `schedule(intention, options?)` | Persist a `ProspectiveEntity`; trigger kind `time-based` / `time-window` / `event` / `conditional` |
| `fire(id, result?)` | Transition `pending → fired`; returns discriminated `MarkResolvedResult` |
| `cancel(id, reason?)` | Transition `pending → cancelled`; returns `CancelResult` |
| `expireDueIntentions()` | Bulk-expire past-due pending intentions; returns count |
| `getPending(filter?)` / `getFired(filter?)` | Query by `sessionId` / `agentId` |

### FailureManager (`ctx.failureManager`)

| Method | Description |
|--------|-------------|
| `record(input, options?)` | Persist a structured `FailureRecord`; validates five required non-empty fields |
| `lookupForTask(taskContext, options?)` | Pre-task substring-match scoring (`applicability_hint` 3× / `context` 2× / `attempted` 1×) |
| `markResolved(id, reason?)` | Returns discriminated `MarkResolvedResult` (`resolved` / `already-resolved` / `not-found` / `vanished-mid-update`) |
| `getAll(options?)` | Filter by `status` and/or `sourceSessionId` |

### PlanManager (`ctx.plan`)

| Method | Description |
|--------|-------------|
| `createPlan(rootDescription, options?)` | Create a single-node plan tree; mints branded `PlanId` |
| `pushSubGoal(planId, parentNodeId, description, options?)` | Append a child `GoalNode`; throws on `persistPlan` failure |
| `transitionNode(planId, nodeId, transition)` | Unified `GoalNodeLifecycle` state-machine entry point |
| `markPlanComplete(planId, note?)` / `abandonPlan(planId, reason?)` | Plan-level lifecycle; returns `MarkResolvedResult` |
| `findPlan` / `findNode` / `getCurrentPath` | `Readonly<>` reads (clone-free) |
| `getActivePlan(sessionId)` / `listPlans(options?)` | Session-scoped + filtered queries |

### ReflectionManager (`ctx.reflectionManager`)

| Method | Description |
|--------|-------------|
| `create(input, options?)` | Persist a `ReflectionRecord`; content-hash dedup on `sha256(scope\|sorted(evidence))` |
| `list(options?)` | Filter by `scope` / `sourceSessionId` / `minConfidence` / `includeArchived` / `limit` |
| `getRelevantForSession(sessionId, options?)` | Reflections matching `sourceSessionId` OR overlapping evidence; confidence-sorted |
| `archive(id)` | Soft-delete; returns discriminated `ArchiveReflectionResult` |
| `ReflectionStage.runOnSessionEnd(sessionId)` | Pipeline stage helper — runs the reflection pass scoped to one session |

## Configuration

### Environment Variables

The full env-var reference lives in [CLAUDE.md](CLAUDE.md). Most-used:

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORY_STORAGE_TYPE` | Storage backend: `jsonl` or `sqlite` | `jsonl` |
| `MEMORY_FILE_PATH` | Override storage file path | (per `ManagerContext` ctor) |
| `MEMORY_BACKEND` | Pluggable Memory Engine backend: `sqlite` or `in-memory` | `sqlite` |
| `MEMORY_EMBEDDING_PROVIDER` | Embedding provider: `openai`, `local`, or `none` | `local` |
| `MEMORY_OPENAI_API_KEY` | OpenAI API key (required if provider is `openai`) | - |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | Auto-build embedding index on entity create | `false` |
| `MEMORY_AUTO_DECAY` | Enable background memory decay | `false` |
| `MEMORY_DECAY_HALF_LIFE_HOURS` | Half-life for importance decay | `168` |
| `MEMORY_GOVERNANCE_ENABLED` | Enable `GovernanceManager` policy enforcement | `false` |
| `MEMORY_AUDIT_LOG_FILE` | Path for audit JSONL trail | - |
| `MEMORY_AGENT_ROLE` | Apply built-in role profile (`researcher`/`planner`/`executor`/`reviewer`/`coordinator`) | - |
| `MEMORY_VALIDATE_ON_STORE` | Run `MemoryValidator` before observation writes | `false` |
| `MEMORY_AUDIT_ATTRIBUTION_REQUIRED` | `CollaborationAuditEnforcer` strict mode | `false` |
| `MEMORY_RBAC_ENABLED` | Wire `RbacMiddleware` into `GovernancePolicy` | `false` |
| `MEMORY_DEFAULT_VISIBILITY` | Default `AgentEntity.visibility` | `private` |
| `MEMORY_USE_MMAP` | Use mmap (`FsReadMmapBackend`) for `GraphStorage.loadFromDisk` | `false` (strict `'true'` literal match) |
| `MEMORY_MMAP_THRESHOLD_BYTES` | Minimum file size to trigger mmap path; `0` means always-on | `104857600` (100 MB) |
| `MEMORY_STORAGE_SEGMENT_COUNT` | Number of FNV-routed JSONL shards in `FileSegmentStorage` (1–1024) | `1` (off) |
| `MEMORY_SQLITE_READ_POOL_SIZE` | Read-connection pool size for `SQLiteStorage` | `4` |
| `MEMORY_SQLITE_AUTO_INDEX` | Enable `PartialIndexAdvisor`-driven automatic partial-index DDL | `false` |
| `SKIP_BENCHMARKS` | Skip perf benchmark tests | `false` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | (none) |

See [CLAUDE.md](CLAUDE.md#environment-variables) for the complete list (~60 variables across decay/salience/context-window/freshness/RBAC/PRD scoring/MemoryEngine/mmap/segment/SQLite-pool/PartialIndex knobs).

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- TypeScript 5.0+

### Build Commands

```bash
npm install            # Install dependencies
npm run build          # Build TypeScript to dist/ (tsup; ESM + CJS dual output)
npm run build:watch    # Watch mode compilation
npm run build:tsc      # Bare tsc build (does NOT include workers — use tsup)
npm test               # Run all tests
npm run test:watch     # Watch mode testing
npm run test:coverage  # Run with coverage report
npm run typecheck      # Type checking without emit
npm run benchmark      # Standalone synthetic benchmarks
npm run bench          # Vitest performance suite
SKIP_BENCHMARKS=true npm test  # Skip perf tests in main suite
```

### Tooling

```bash
npm run audit:plans                                                 # Detect plan-doc rot
node tools/create-dependency-graph/create-dependency-graph.ts       # Refresh DEPENDENCY_GRAPH.md
node tools/chunking-for-files/chunking-for-files.ts split <file>    # Split large files
node tools/chunking-for-files/chunking-for-files.ts merge <manifest>  # Merge back
node tools/migrate-from-jsonl-to-sqlite/...                         # JSONL → SQLite migration
```

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade — lazy init)            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│  Layer 2: Domain managers (40+ lazy getters)                     │
│  Core: Entity / Relation / Observation / Hierarchy / Search /    │
│        GraphTraversal / Tags / RefIndex                          │
│  I/O:  IOManager / Archive / Compression / Analytics / Audit /   │
│        Governance / Freshness / SemanticForget                   │
│  Search: Ranked / Hybrid / Semantic / Temporal / LLMQueryPlanner │
│        / ActiveRetrievalController                               │
│  Memory: MemoryEngine / MemoryBackend / ContextWindowManager /   │
│        AgentMemory(facade)                                       │
│  Intel: MemoryValidator / TrajectoryCompressor /                 │
│        ExperienceExtractor / PatternDetector                     │
│  Theory: ProcedureManager / CausalReasoner / WorldModelManager   │
│  Auth:  RbacMiddleware / RoleAssignmentStore / AccessTracker     │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│  Layer 3: Storage                                                │
│  GraphStorage (JSONL) or SQLiteStorage (better-sqlite3, FTS5)    │
│  ─ Pluggable IMemoryBackend: in-memory or sqlite-backed engine   │
└──────────────────────────────────────────────────────────────────┘
```

### Project Structure

```
memoryjs/
├── src/                            # Source (183 TypeScript files, 62.7K LOC)
│   ├── index.ts                    # Entry point
│   ├── agent/                      # Agent Memory System (61 files)
│   │   ├── AgentMemoryManager.ts       # Unified facade
│   │   ├── SessionManager.ts           # Session lifecycle
│   │   ├── WorkingMemoryManager.ts     # Working memory + promotion
│   │   ├── EpisodicMemoryManager.ts    # Timeline-based events
│   │   ├── DecayEngine.ts              # Decay (legacy + PRD scales)
│   │   ├── SalienceEngine.ts           # Context-aware scoring
│   │   ├── MultiAgentMemoryManager.ts  # Multi-agent support
│   │   ├── ConflictResolver.ts         # Concurrent-update resolution
│   │   ├── ArtifactManager.ts          # Stable artifact entities
│   │   ├── DistillationPipeline.ts     # Post-retrieval policy filter
│   │   ├── RoleProfiles.ts             # 5 built-in roles + presets
│   │   ├── EntropyFilter.ts            # Shannon entropy gate
│   │   ├── ConsolidationScheduler.ts   # Background dedup+merge
│   │   ├── MemoryFormatter.ts          # formatWithSalienceBudget()
│   │   ├── CollaborativeSynthesis.ts   # Multi-agent merge + ConflictView
│   │   ├── FailureDistillation.ts      # Causal-chain lesson extraction
│   │   ├── CognitiveLoadAnalyzer.ts    # Density + redundancy + diversity
│   │   ├── VisibilityResolver.ts       # 5-level + role + time-window
│   │   ├── ContextWindowManager.ts     # 4-layer wake-up stack
│   │   ├── MemoryEngine.ts             # Turn-aware + 4-tier dedup (v1.11)
│   │   ├── MemoryBackend.ts            # IMemoryBackend interface (v1.12)
│   │   ├── InMemoryBackend.ts          # Ephemeral adapter
│   │   ├── SQLiteBackend.ts            # SQLite-backed adapter
│   │   ├── MemoryValidator.ts          # Memory consistency / contradiction checks
│   │   ├── TrajectoryCompressor.ts     # Distill / merge trajectory data
│   │   ├── ExperienceExtractor.ts      # Pattern abstraction from contrastive pairs
│   │   ├── PatternDetector.ts          # Sequence + outcome mining
│   │   ├── causal/                     # 3B.6 — CausalReasoner
│   │   ├── procedural/                 # 3B.4 — ProcedureManager + Sequencer
│   │   ├── retrieval/                  # 3B.5 — ActiveRetrievalController
│   │   ├── world/                      # 3B.7 — WorldModelManager + Snapshot
│   │   ├── rbac/                       # η.6.1 — Role/Permission/Matrix/Middleware
│   │   ├── collaboration/              # η.5.5.d — CollaborationAuditEnforcer
│   │   └── ...
│   ├── core/                       # Core managers (14 files)
│   │   ├── ManagerContext.ts           # Central facade (lazy)
│   │   ├── EntityManager.ts            # CRUD + hierarchy + OCC + temporal
│   │   ├── RelationManager.ts          # CRUD + temporal validity
│   │   ├── ObservationManager.ts       # CRUD + per-obs validity windows
│   │   ├── HierarchyManager.ts         # Tree traversal
│   │   ├── GraphStorage.ts             # JSONL I/O + atomic writes
│   │   ├── SQLiteStorage.ts            # SQLite + FTS5 + BM25
│   │   ├── GraphTraversal.ts           # BFS / DFS / paths / centrality
│   │   ├── TransactionManager.ts       # ACID batch operations
│   │   ├── RefIndex.ts                 # O(1) name → entity sidecar
│   │   └── ...
│   ├── search/                     # Search (37 files)
│   │   ├── SearchManager.ts            # Orchestrator
│   │   ├── RankedSearch.ts             # TF-IDF
│   │   ├── BM25Search.ts               # Okapi BM25 with stopwords
│   │   ├── BooleanSearch.ts            # AND/OR/NOT AST
│   │   ├── FuzzySearch.ts              # Levenshtein + N-gram pre-filter
│   │   ├── SemanticSearch.ts           # Embedding-based
│   │   ├── HybridSearchManager.ts      # Multi-signal scoring
│   │   ├── NGramIndex.ts               # Trigram + Jaccard
│   │   ├── TemporalSearch.ts           # Time-range execution
│   │   ├── LLMQueryPlanner.ts          # NL → StructuredQuery
│   │   └── ...
│   ├── features/                   # Advanced capabilities (17 files)
│   │   ├── IOManager.ts                # Import / export (incl. RDF/JSON-LD) / backup / ingest
│   │   ├── TagManager.ts               # Tag aliases
│   │   ├── ArchiveManager.ts           # Entity archival
│   │   ├── CompressionManager.ts       # Duplicate detection
│   │   ├── FreshnessManager.ts         # TTL/confidence
│   │   ├── AuditLog.ts                 # JSONL immutable trail
│   │   ├── GovernanceManager.ts        # Transactions + policy
│   │   ├── ContradictionDetector.ts    # Semantic-similarity supersession
│   │   ├── SemanticForget.ts           # Two-tier deletion
│   │   └── ...
│   ├── cli/                        # CLI binary (16 files)
│   ├── security/                   # PII redaction (2 files; η.6.3)
│   ├── types/                      # TypeScript definitions (7 files)
│   ├── utils/                      # Shared utilities (26 files)
│   └── workers/                    # Worker pool (2 files)
├── tests/                          # 6157 passing tests
│   ├── unit/                       # Per-module unit tests
│   ├── integration/                # Cross-module workflows
│   ├── edge-cases/                 # Boundary conditions
│   └── performance/                # Benchmarks (gated by SKIP_BENCHMARKS)
├── docs/                           # Documentation
│   ├── architecture/               # OVERVIEW, ARCHITECTURE, DEPENDENCY_GRAPH, etc.
│   ├── development/                # ADRs (incl. ADR-011 wrap-and-extend)
│   ├── guides/                     # API reference, configuration, recipes
│   ├── roadmap/                    # ROADMAP.md
│   └── superpowers/plans/          # Phase α–η implementation plans
├── tools/                          # Dev utilities
│   ├── chunking-for-files/         # File splitting / merging
│   ├── compress-for-context/       # LLM-context compression
│   ├── create-dependency-graph/    # Generates DEPENDENCY_GRAPH.md
│   ├── migrate-from-jsonl-to-sqlite/  # Storage migration
│   └── plan-doc-audit/             # Plan-doc rot detection (audit:plans)
├── CLAUDE.md                       # Full env-var + architecture reference
├── CHANGELOG.md                    # Version-by-version history
└── README.md                       # This file
```

## Documentation

Comprehensive architecture documentation in `docs/architecture/`:

- [OVERVIEW.md](docs/architecture/OVERVIEW.md) - High-level project overview
- [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) - Technical architecture and design
- [COMPONENTS.md](docs/architecture/COMPONENTS.md) - Component breakdown
- [DATAFLOW.md](docs/architecture/DATAFLOW.md) - Data flow patterns
- [API.md](docs/architecture/API.md) - Complete API documentation
- [DEPENDENCY_GRAPH.md](docs/architecture/DEPENDENCY_GRAPH.md) - Module dependencies (auto-generated by `tools/create-dependency-graph`)
- [unused-analysis.md](docs/architecture/unused-analysis.md) - Unused exports report
- [TEST_COVERAGE.md](docs/architecture/TEST_COVERAGE.md) - Test coverage analysis
- [AGENT_MEMORY.md](docs/architecture/AGENT_MEMORY.md) - Agent memory system design

ADRs and roadmap:

- [ARCHITECTURE_DECISIONS.md](docs/development/ARCHITECTURE_DECISIONS.md) - including ADR-011 (wrap-and-extend pattern for memory intelligence services)
- [ROADMAP.md](docs/roadmap/ROADMAP.md) - Feature roadmap with implementation details
- [docs/superpowers/plans/](docs/superpowers/plans/) - Phase α–η implementation plans

Project-internal:

- [CLAUDE.md](CLAUDE.md) - Full environment-variable reference + architecture map
- [CHANGELOG.md](CHANGELOG.md) - Version-by-version history

## License

**MIT License** - see [LICENSE](LICENSE)

## Related

- [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) - MCP server built on this library

---

**Repository:** https://github.com/danielsimonjr/memoryjs
**NPM:** https://www.npmjs.com/package/@danielsimonjr/memoryjs
**Issues:** https://github.com/danielsimonjr/memoryjs/issues
