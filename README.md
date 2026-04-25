# MemoryJS

[![Version](https://img.shields.io/badge/version-1.14.0-blue.svg)](https://github.com/danielsimonjr/memoryjs)
[![NPM](https://img.shields.io/npm/v/@danielsimonjr/memoryjs.svg)](https://www.npmjs.com/package/@danielsimonjr/memoryjs)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-6157%20passing-brightgreen.svg)](https://github.com/danielsimonjr/memoryjs)

A **TypeScript knowledge graph library** for managing entities, relations, and observations with **advanced search**, **hierarchical organization**, **bitemporal versioning**, **causal reasoning**, **role-based access control**, **multi-agent collaboration**, and **multiple storage backends**.

> Core library powering [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp). **183 TypeScript files**, **62.7K lines of code**, **6157 passing tests**, dual storage backends (JSONL/SQLite + pluggable `IMemoryBackend`), comprehensive search (BM25, TF-IDF, fuzzy with N-gram pre-filter, semantic, hybrid, temporal, LLM-planned, active iterative retrieval), and a complete **Agent Memory System** for AI agents — role profiles, entropy filtering, recursive consolidation, collaborative synthesis with conflict resolution, failure distillation, cognitive load analysis, visibility hierarchies, RBAC, optimistic concurrency, audit attribution, procedural memory, causal reasoning, and a world-model orchestrator.

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
| `agent/` | 61 | AgentMemoryManager, SessionManager, DecayEngine, WorkingMemoryManager, ArtifactManager, DistillationPipeline, RoleProfiles, EntropyFilter, ConsolidationScheduler, MemoryFormatter, CollaborativeSynthesis, FailureDistillation, CognitiveLoadAnalyzer, VisibilityResolver, **MemoryEngine**, **MemoryValidator**, **TrajectoryCompressor**, **ExperienceExtractor**, **CausalReasoner**, **ProcedureManager**, **WorldModelManager**, **ActiveRetrievalController**, **CollaborationAuditEnforcer**, **RbacMiddleware**, **InMemoryBackend** / **SQLiteBackend** |
| `core/` | 14 | ManagerContext, EntityManager (with OCC), RelationManager (with temporal validity), ObservationManager (with bitemporal axis), HierarchyManager, GraphStorage, SQLiteStorage, GraphTraversal, TransactionManager, RefIndex |
| `search/` | 37 | SearchManager, RankedSearch (TF-IDF), BM25Search, BooleanSearch, FuzzySearch, SemanticSearch, HybridSearchManager, NGramIndex, TemporalQueryParser, TemporalSearch, LLMQueryPlanner, LLMSearchExecutor, EmbeddingService, VectorStore |
| `features/` | 17 | IOManager (with RDF/Turtle/JSON-LD export), ArchiveManager, CompressionManager, StreamingExporter, FreshnessManager, AuditLog, GovernanceManager, ContradictionDetector, SemanticForget, AutoLinker |
| `utils/` | 26 | BatchProcessor, CompressedCache, WorkerPoolManager, MemoryMonitor, schemas (Zod) |
| `types/` | 7 | Entity, Relation, AgentEntity, SessionEntity, ArtifactEntity, Procedure |
| `security/` | 2 | **PiiRedactor** + bundled patterns (email/SSN/CC/phone/IP) |
| `cli/` | 16 | `memory` / `memoryjs` binary commands (entity, relation, search, observation, tag, hierarchy, graph, io, maintenance) |
| `workers/` | 2 | Levenshtein distance calculations |

**Total:** 183 TypeScript files | 62.7K lines of code | 6157 passing tests

### Recent additions (Unreleased — built on top of v1.14.0)

| Feature | Entry Point |
|---------|-------------|
| **η.4.4 Bitemporal Versioning** | `EntityManager.invalidateEntity()` / `entityAsOf()` / `entityTimeline()`; `ObservationManager.invalidateObservation()` / `observationsAsOf()`; `Entity.validFrom` / `validUntil` / `observationMeta[]` |
| **η.5.4 Linked Data Export** | `ioManager.exportGraph(g, 'turtle' \| 'rdf-xml' \| 'json-ld')` — W3C RDF 1.1; reification fallback for non-NCName predicates |
| **η.5.5.a Multi-Agent Conflict View** | `SynthesisResult.conflicts[]` + `CollaborativeSynthesis.resolveConflicts(result, policy)` (most_recent / highest_confidence / highest_score / trusted_agent) |
| **η.5.5.b Visibility Expansion** | `AgentEntity.visibleFrom` / `visibleUntil` / `allowedRoles[]`; `VisibilityResolver` adds time-window gate + role predicate |
| **η.5.5.c Optimistic Concurrency** | `EntityManager.updateEntity(name, updates, { expectedVersion })` → throws `VersionConflictError` on mismatch |
| **η.5.5.d Attribution Enforcer** | `CollaborationAuditEnforcer` — strict-mode requires `agentId` on every mutation; appends to `AuditLog` |
| **η.6.1 RBAC** | `ctx.rbacMiddleware.checkPermission(agentId, action, resourceType, resourceName?)`; `ctx.roleAssignmentStore` with optional JSONL persistence |
| **η.6.3 PII Redactor** | `new PiiRedactor().redactGraph(graph)` — pluggable regex bank with `redactWithStats()` for compliance audit trails |
| **3B.4 Procedural Memory** | `ctx.procedureManager.addProcedure({ steps })` / `matchProcedure(context)` / `refineProcedure(id, feedback)` (EWMA success-rate) |
| **3B.5 Active Retrieval** | `ctx.activeRetrieval.adaptiveRetrieve({ query })` — iterative query rewriting with token-overlap expansion |
| **3B.6 Causal Reasoning** | `ctx.causalReasoner.findCauses()` / `findEffects()` / `counterfactual()` / `detectCycles()` |
| **3B.7 World Model** | `ctx.worldModelManager.getCurrentState()` / `validateFact()` / `predictOutcome()` / `detectStateChange()` |

### v1.13.0 — Memory Intelligence Services (Phase δ)

| Feature | Entry Point |
|---------|-------------|
| Memory Validator | `ctx.memoryValidator.validateConsistency()` / `detectContradictions()` / `repairWithResolver()` / `validateTemporalOrder()` / `calculateReliability()` |
| Trajectory Compressor | `ctx.trajectoryCompressor.distill()` / `abstractAtLevel()` / `findRedundancies()` / `mergeRedundant()` |
| Experience Extractor | `ctx.experienceExtractor.extractFromContrastivePairs()` / `clusterTrajectories()` / `synthesizeExperience()` |

### v1.12.0 — Pluggable Memory Backends (Phase β)

| Feature | Entry Point |
|---------|-------------|
| `IMemoryBackend` interface | `MEMORY_BACKEND=in-memory \| sqlite` selects via `ctx.memoryBackend` |
| `InMemoryBackend` | Ephemeral, dedup on `(sessionId, content)` |
| `SQLiteBackend` | Wraps `MemoryEngine` + `DecayEngine.calculatePrdEffectiveImportance()` |
| Audit-tooling guard | `npm run audit:plans` PostToolUse hook catches plan-doc rot |

### v1.11.0 — Turn-Aware Memory Engine

| Feature | Entry Point |
|---------|-------------|
| `MemoryEngine` | `ctx.memoryEngine.addTurn()` / `getSessionTurns()` — four-tier dedup (exact / prefix / Jaccard / optional semantic) |
| `ImportanceScorer` | length × keyword × recent-turn-overlap → integer [0, 10] |
| O(1) exact-equality dedup | `Entity.contentHash` (SHA-256) + SQLite `idx_entities_content_hash` |

### v1.9.0 — Temporal Relations + Conversation Ingest

| Feature | Entry Point |
|---------|-------------|
| Temporal Relations | `RelationManager.invalidateRelation()` / `queryAsOf(date)` / `timeline()` |
| 4-Layer Wake-Up Stack | `ContextWindowManager.wakeUp({ compress })` — ~600-token context bootstrap |
| Conversation Ingestion | `IOManager.ingest({ messages, ...options })` — format-agnostic pipeline |
| Per-Agent Diary | `AgentMemoryManager.writeDiary()` / `readDiary()` |
| Local Embeddings (default) | `MEMORY_EMBEDDING_PROVIDER=local` — zero-config semantic search |

### v1.8.0 — Memory Versioning + Project Scoping

| Feature | Entry Point |
|---------|-------------|
| Contradiction-driven supersession | `Entity.version` / `parentEntityName` / `rootEntityName` / `supersededBy` |
| Project scoping | `Entity.projectId` + `MEMORY_DEFAULT_PROJECT_ID` |
| Two-tier deletion | `ctx.semanticForget` — exact match → 0.85 semantic fallback with audit logging |

### v1.7.0 — Multi-Agent Memory

| Feature | Entry Point |
|---------|-------------|
| Role-Aware Customization | `RoleProfileManager.apply(role)` — salience weights + budget splits |
| Entropy-Aware Filtering | `EntropyFilter` — Shannon entropy gate in `ConsolidationPipeline` |
| Recursive Memory Consolidation | `ConsolidationScheduler` — background dedup + merge to fixed point |
| Salience Budget Allocation | `MemoryFormatter.formatWithSalienceBudget()` |
| Collaborative Memory Synthesis | `CollaborativeSynthesis.synthesize(entity, hopDepth)` |
| Failure-Driven Distillation | `FailureDistillation.distill(failureEntity)` |
| Cognitive Load Metrics | `CognitiveLoadAnalyzer.analyze(memories)` → `CognitiveLoadReport` |
| Shared Visibility Hierarchies | `VisibilityResolver.canAccess()` — 5-level model |

### v1.6.0 — Governance + Temporal

| Feature | Entry Point |
|---------|-------------|
| Stable Index Dereferencing | `ctx.refIndex` — `register` / `resolve` / `deregister` |
| Artifact-Level Granularity | `ctx.agentMemory().artifactManager.createArtifact()` |
| Temporal Range Queries | `ctx.searchManager.searchByTime()` / `ctx.temporalSearch` |
| Memory Distillation Policy | `IDistillationPolicy` — wired into `ContextWindowManager` |
| Freshness Auditing | `ctx.freshnessManager` — TTL, confidence, staleness report |
| N-gram Pre-filtering | Automatic in `FuzzySearch` via `NGramIndex` |
| LLM Query Planner | `ctx.queryNaturalLanguage(query, llmProvider?)` |
| Dynamic Memory Governance | `ctx.governanceManager` — `withTransaction` / `GovernancePolicy` |

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

### 6. Bitemporal versioning (η.4.4)

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

### 7. Causal reasoning + world model (3B.6 / 3B.7)

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

### 8. RBAC + PII redaction (η.6.1 / η.6.3)

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

  // v1.6.0 — Freshness
  ttl?: number;              // Seconds until stale
  confidence?: number;       // [0, 1] belief strength

  // v1.8.0 — Project scoping + supersession
  projectId?: string;        // Multi-project isolation
  version?: number;          // Supersession chain version (also drives η.5.5.c OCC)
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // v1.11.0 — Memory Engine dedup
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

// Memory intelligence (Phase δ)
ctx.memoryValidator         // Validate consistency / contradictions / temporal order
ctx.trajectoryCompressor    // Distill / abstract / merge redundant trajectories
ctx.experienceExtractor     // Cluster trajectories → reusable experience patterns
ctx.patternDetector         // Trigger / sequence / outcome pattern mining

// Memory theory (Phase 3B)
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
type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
```

- **Working Memory**: Short-term, session-scoped memories that may be promoted
- **Episodic Memory**: Timeline-based event memories with temporal ordering
- **Semantic Memory**: Long-term factual knowledge
- **Procedural Memory**: Learned behaviors and patterns

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
| `getVersionChain(name)` / `getLatestVersion(name)` | v1.8.0 supersession chains |
| `invalidateEntity(name, ended?)` | η.4.4 — set `validUntil` |
| `entityAsOf(name, asOf)` | η.4.4 — time-travel query |
| `entityTimeline(name)` | η.4.4 — versions sorted by `validFrom` |

### RelationManager

| Method | Description |
|--------|-------------|
| `createRelations(relations)` | Create multiple relations |
| `getRelations(entityName)` | Get incoming/outgoing relations |
| `deleteRelations(relations)` | Delete specific relations |
| `invalidateRelation(from, type, to, ended?)` | v1.9.0 — set `validUntil` on a relation |
| `queryAsOf(entity, asOf, { direction? })` | v1.9.0 — relations valid at time T |
| `timeline(entity, { direction? })` | v1.9.0 — chronological history |

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
| `ingest({ messages }, options?)` | v1.9.0 — conversation ingestion pipeline |
| `splitSessions(content, options?)` | v1.9.0 — split multi-session transcripts |
| `visualizeGraph(options?)` | v1.9.1 — interactive HTML visualization |
| `createBackup(options)` / `restoreBackup(path)` | Backup management |

### GraphTraversal

| Method | Description |
|--------|-------------|
| `findShortestPath(from, to)` | BFS shortest path |
| `findAllPaths(from, to, maxDepth, options?)` | All paths with max depth |
| `getCentrality(options)` | Centrality metrics (degree / betweenness / pagerank) |
| `getConnectedComponents()` | Find isolated subgraphs |
| `bfs(start, options)` / `dfs(start, options)` | Traversal |

### CausalReasoner (3B.6)

| Method | Description |
|--------|-------------|
| `findEffects(cause, candidates, maxDepth?)` | Forward causal inference; sorted by `Π causalStrength` |
| `findCauses(effect, candidates, maxDepth?)` | Backward inference (symmetric inverse) |
| `counterfactual({ seed, removeFrom, removeTo, predict })` | Chains surviving edge removal (pure; no graph mutation) |
| `detectCycles(seed, maxDepth?)` | Depth-bounded DFS over causal subgraph |

### ProcedureManager (3B.4)

| Method | Description |
|--------|-------------|
| `addProcedure({ steps, ... })` | Persist a procedure; auto-generates id |
| `getProcedure(id)` / `getStep(id, order)` / `getNextStep(id, order)` | Access |
| `openSequencer(id)` | Stateful execution cursor with fallback support |
| `matchProcedure(context, candidates, threshold?)` | Token-overlap match |
| `refineProcedure(id, { succeeded, notes? })` | EWMA success-rate update |

### WorldModelManager (3B.7)

| Method | Description |
|--------|-------------|
| `getCurrentState()` | `WorldStateSnapshot` from live graph (capped at `maxSnapshotSize`) |
| `validateFact(observation, entityName)` | Delegates to `MemoryValidator` if wired |
| `predictOutcome(action, candidates)` | Delegates to `CausalReasoner.findEffects` |
| `detectStateChange(before, after)` | Pure snapshot diff |

### ActiveRetrievalController (3B.5)

| Method | Description |
|--------|-------------|
| `shouldRetrieve(context)` | Cost heuristic; rejects empty / over-budget |
| `adaptiveRetrieve(context)` | Iterative rewrite + retrieve until coverage threshold |

### CollaborativeSynthesis (η.5.5.a)

| Method | Description |
|--------|-------------|
| `synthesize(seedEntity, context?)` | BFS + salience scoring; surfaces multi-agent `conflicts[]` |
| `resolveConflicts(result, policy)` | Pick winners per `most_recent` / `highest_confidence` / `highest_score` / `trusted_agent` |

### MemoryValidator (Phase δ)

| Method | Description |
|--------|-------------|
| `validateConsistency(newObs, existing)` | Composite duplicate / semantic / low-confidence check |
| `detectContradictions(entity)` | Delegates to `ContradictionDetector` |
| `repairWithResolver(entity, competing, resolver, contradiction?, options?)` | Apply `ConflictResolver` strategies |
| `validateTemporalOrder(observations)` | Sync `[T=ISO]` ordering check |
| `calculateReliability(entity)` | Confidence × confirmation × age penalty |

### RbacMiddleware (η.6.1)

| Method | Description |
|--------|-------------|
| `checkPermission(agentId, action, resourceType, resourceName?, now?)` | Returns `true` / `false`; falls back to `defaultRole` (default `reader`) |
| `roleAssignmentStore.assign({ agentId, role, resourceType?, scope?, validFrom?, validUntil? })` | Grant a role |
| `roleAssignmentStore.revoke(agentId, role, resourceType?)` | Remove a grant |
| `roleAssignmentStore.listActive(agentId, now?)` | Active grants at a point in time |

### PiiRedactor (η.6.3)

| Method | Description |
|--------|-------------|
| `redact(text)` | Apply patterns; returns redacted string |
| `redactWithStats(text)` | Returns `{ text, stats: { totalRedactedBytes, countsByPattern } }` |
| `redactGraph(graph)` | Apply to every observation in a graph-shaped object |

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
| `SKIP_BENCHMARKS` | Skip perf benchmark tests | `false` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | (none) |

See [CLAUDE.md](CLAUDE.md#environment-variables) for the complete list (~50 variables across decay/salience/context-window/freshness/RBAC/PRD scoring/MemoryEngine knobs).

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
│   │   ├── MemoryValidator.ts          # Phase δ — consistency checks
│   │   ├── TrajectoryCompressor.ts     # Phase δ — distill / merge
│   │   ├── ExperienceExtractor.ts      # Phase δ — pattern abstraction
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

- [ARCHITECTURE_DECISIONS.md](docs/development/ARCHITECTURE_DECISIONS.md) - including ADR-011 (Phase δ wrap-and-extend pattern)
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
