# MemoryJS

[![NPM](https://img.shields.io/npm/v/@danielsimonjr/memoryjs.svg)](https://www.npmjs.com/package/@danielsimonjr/memoryjs)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A TypeScript knowledge-graph library for AI agents and applications that need
structured long-term memory. Entities, relations, and observations with
multiple storage backends (JSONL, SQLite, PostgreSQL), advanced search (BM25, TF-IDF,
fuzzy, semantic, hybrid, temporal, LLM-planned), graph algorithms, bitemporal
versioning, RBAC, and a complete Agent Memory System (session lifecycle,
working / episodic / semantic / procedural memory, decay, salience, consolidation,
causal reasoning, world-model orchestration).

> Powers [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp),
> a Model Context Protocol server for Claude and other MCP clients. The
> library and the MCP server share the same core; this package is published
> independently so non-MCP applications can use it directly.

For a runnable CLI: `npx -p @danielsimonjr/memoryjs memory --help`.

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

### Knowledge graph

| Capability | Entry point |
|---|---|
| Entity / relation / observation CRUD | `ctx.entityManager`, `ctx.relationManager`, `ctx.observationManager` |
| Optimistic concurrency control on updates | `entityManager.updateEntity(name, updates, { expectedVersion })` |
| Bitemporal versioning (entities + observations) | `invalidateEntity()` / `entityAsOf()` / `entityTimeline()` |
| Temporal relations (validity windows) | `relationManager.invalidateRelation()` / `queryAsOf()` / `timeline()` |
| Memory versioning with contradiction-driven supersession | `Entity.version` / `parentEntityName` / `rootEntityName` / `supersededBy` |
| Project scoping | `Entity.projectId` + `MEMORY_DEFAULT_PROJECT_ID` |
| Two-tier deletion (exact match → semantic fallback) | `ctx.semanticForget` |
| Hierarchical nesting + traversal | `ctx.hierarchyManager` (ancestors / descendants / subtrees) |
| Stable named references that survive entity renames | `ctx.refIndex.register()` / `resolve()` |
| Multi-format import / export | `ctx.ioManager.exportGraph(format)` — JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid |
| W3C Linked Data export | `ctx.ioManager.exportGraph('turtle' \| 'rdf-xml' \| 'json-ld')` |
| Conversation ingestion (format-agnostic) | `ctx.ioManager.ingest(input, options)` |

### Search & retrieval

| Capability | Entry point |
|---|---|
| Auto-selecting search with method explanation | `ctx.searchManager.autoSearch(query)` |
| TF-IDF + BM25 ranked search (incremental indexing) | `ctx.rankedSearch`, `BM25Search` |
| Boolean (AND / OR / NOT) with AST parser | `ctx.searchManager.booleanSearch()` |
| Fuzzy matching (Levenshtein, N-gram pre-filtered) | `ctx.searchManager.fuzzySearch()` |
| Semantic search with pluggable embedding provider | `ctx.semanticSearch` (set `MEMORY_EMBEDDING_PROVIDER`) |
| Hybrid (semantic + lexical + symbolic) | `new HybridSearchManager(ctx.storage, …).search(query)` |
| Temporal range queries with natural-language parsing | `ctx.searchManager.searchByTime("last hour")` |
| LLM-planned natural-language queries | `ctx.queryNaturalLanguage(query, llmProvider?)` |
| Query diagnostics (`explainPlan`, index health) | `ctx.diagnostics` |

### Graph algorithms

| Capability | Entry point |
|---|---|
| Shortest path + all paths | `ctx.graphTraversal.findShortestPath()` / `findAllPaths()` |
| Centrality — degree, betweenness, PageRank, HITS | `ctx.graphTraversal.calculatePageRank()` / `calculateHITS()` |
| Community detection (Louvain), clique enumeration | `ctx.graphTraversal.findCommunities()` / `findCliques()` |
| Connected components | `ctx.graphTraversal.findConnectedComponents()` |

### Agent Memory System

| Capability | Entry point |
|---|---|
| Sessions, working memory, episodic memory | `ctx.agentMemory()` — `startSession` / `addWorkingMemory` / `retrieveForContext` |
| Turn-aware conversation memory with 4-tier dedup (exact / prefix / Jaccard / semantic) | `ctx.memoryEngine.addTurn()` / `getSessionTurns()` |
| Decay, salience, freshness | `DecayEngine`, `SalienceEngine`, `ctx.freshnessManager` |
| Role profiles — `researcher` / `planner` / `executor` / `reviewer` / `coordinator` | `MEMORY_AGENT_ROLE` or `RoleProfileManager.apply(role)` |
| Memory consolidation, summarization, pattern detection | `ConsolidationPipeline`, `ConsolidationScheduler` |
| Collaborative synthesis with conflict resolution | `CollaborativeSynthesis.synthesize()` / `resolveConflicts()` |
| Failure-driven distillation, cognitive load analysis | `FailureDistillation`, `CognitiveLoadAnalyzer` |
| Procedural memory (executable procedures with feedback refinement) | `ctx.procedureManager.addProcedure()` / `matchProcedure()` / `refineProcedure()` |
| Active retrieval (iterative query rewriting) | `ctx.activeRetrieval.adaptiveRetrieve()` |
| Causal reasoning — causes / effects / counterfactuals / cycle detection | `ctx.causalReasoner.findCauses()` / `findEffects()` / `counterfactual()` |
| World-state orchestrator | `ctx.worldModelManager.getCurrentState()` / `predictOutcome()` |
| Per-agent persistent journal | `AgentMemoryManager.writeDiary()` / `readDiary()` |
| Prospective memory (intentions-to-act) | `ctx.prospectiveMemory.schedule()` / `fire()` / `cancel()` |
| Failure memory (pre-task `applicability_hint` lookup) | `ctx.failureManager.record()` / `lookupForTask()` |
| Plan memory (hierarchical goal trees) | `ctx.plan.createPlan()` / `pushSubGoal()` / `transitionNode()` |
| Reflection memory (additive insights with content-hash dedup) | `ctx.reflectionManager.create()` / `getRelevantForSession()` |
| Heuristic memory (condition → action guidelines) | `ctx.heuristicManager.add()` / `match()` / `reinforce()` |
| Decision rationale (ADR-style records) | `ctx.decisionManager.propose()` / `accept()` / `supersede()` |
| Project context (facts / conventions / commands / glossary) | `ctx.projectContextManager.upsert()` / `forContext()` |
| Tool affordance (outcome-aware tool suggestions) | `ctx.toolAffordanceManager.recordOutcome()` / `suggestTool()` |
| Trust hierarchy — `ground-truth` / `verified` / `inferred` / `unverified` | `MemorySource.trustLevel` + `inferTrustLevel()` |

### Storage & performance

| Capability | Entry point |
|---|---|
| JSONL or SQLite backend (FTS5, BM25, WAL mode) | `MEMORY_STORAGE_TYPE=jsonl\|sqlite` |
| Pluggable Memory Engine backend | `MEMORY_BACKEND=sqlite\|in-memory` |
| Memory-mapped file loading for large stores | `MEMORY_USE_MMAP=true`, `MEMORY_MMAP_THRESHOLD_BYTES` |
| Segment-sharded JSONL (FNV-routed N-way shards) | `MEMORY_STORAGE_SEGMENT_COUNT=1..1024` |
| Columnar observation storage | `JsonlColumnStore` (env-gated) |
| Tiered index — LRU hot / disk warm / Brotli cold | `LRUHotTier` → `DiskWarmTier` → `BrotliColdTier` via `TieredIndex` |
| In-memory entity-cache compression | `ctx.compressedEntityCache`, `CompressedMap` |
| Backup lifecycle (create / list / restore / delete) with symlink-attack guards | `ctx.ioManager` (delegates to `BackupManager`) |
| Streaming export with Brotli compression | `ctx.streamingExporter` |
| Entity archival to compressed storage | `ctx.archiveManager` |
| Duplicate detection + entity merging | `ctx.compressionManager` |

### Governance, security, multi-agent

| Capability | Entry point |
|---|---|
| Policy enforcement + transactional rollback | `ctx.governanceManager.withTransaction()` / `GovernancePolicy` |
| Immutable JSONL audit trail | `ctx.auditLog` |
| Strict-mode attribution enforcer | `CollaborationAuditEnforcer` (requires `agentId` on every mutation) |
| RBAC — role / permission / matrix / middleware | `ctx.rbacMiddleware.checkPermission()` / `ctx.roleAssignmentStore` |
| ABAC + row-level security + API-key scoping | `src/security/abac.ts`, `rls.ts`, `apiKeys.ts` |
| PII redactor (email / SSN / CC / phone / IP) | `new PiiRedactor().redactGraph()` / `redactWithStats()` |
| Visibility hierarchies (5-level: `private` / `team` / `org` / `shared` / `public`) | `VisibilityResolver.canAccess()` |
| Time-window + role-gated visibility | `AgentEntity.visibleFrom` / `visibleUntil` / `allowedRoles[]` |
| Path-traversal protection | `validateFilePath(path, baseDir?, confineToBase=true)` |

### Tooling

| Capability | Entry point |
|---|---|
| Command-line interface | `npx -p @danielsimonjr/memoryjs memory --help` |
| End-to-end smoke test against a fresh temp graph (~30 ops) | `memory smoke --keep --verbose` |
| Diagnostic snapshot + graph health checks | `memory diag` / `memory health` |
| Orphan + missing-parent + cycle detection with optional repair | `memory check [--apply]` |
| Rebuild ranked + spell indexes | `memory reindex [--ranked\|--spell]` |
| Inspect a single entity verbosely | `memory show <name>` |
| Hierarchy tree (JSON or `--ascii`) | `memory tree [root]` |
| Search-cache stats / clear | `memory cache stats \| clear` |
| Interactive REPL | `memory interactive` |


## Installation

```bash
npm install @danielsimonjr/memoryjs
```

### Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## Quick Start

### 1. Initialize storage

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default, human-readable)
const ctx = new ManagerContext('./memory.jsonl');

// Or SQLite (set MEMORY_STORAGE_TYPE=sqlite in the environment)
const sqliteCtx = new ManagerContext('./memory.db');
```

### 2. Create entities

```typescript
await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'language',
    observations: ['A typed superset of JavaScript'],
    tags: ['programming', 'frontend'],
    importance: 8,
  },
  {
    name: 'Node.js',
    entityType: 'runtime',
    observations: ['JavaScript runtime built on V8'],
    tags: ['backend', 'server'],
  },
]);
```

### 3. Create relations

```typescript
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' },
]);
```

### 4. Search

```typescript
// Auto-select the best method
const auto = await ctx.searchManager.autoSearch('JavaScript');

// Substring + tag search
const nodes = await ctx.searchManager.searchNodes('JavaScript');

// Boolean (AND / OR / NOT) with an AST parser
const both = await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// Fuzzy (typo-tolerant; N-gram pre-filtered)
const fuzzy = await ctx.searchManager.fuzzySearch('Typscript', { threshold: 0.7 });

// Ranked TF-IDF / BM25
const ranked = await ctx.rankedSearch.searchNodesRanked('runtime environment',
  undefined, undefined, undefined, 10);

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
  if (e instanceof Error && e.name === 'VersionConflictError') {
    // Refetch + retry
  }
}

// Synthesize a view across agents + resolve conflicts
const agent = ctx.agentMemory();
const synth = await agent.collaborativeSynthesis.synthesize('Alice');
const winners = agent.collaborativeSynthesis.resolveConflicts(synth, {
  strategy: 'highest_confidence',
});

// Enforce attribution on every mutation
import { CollaborationAuditEnforcer, AuditLog } from '@danielsimonjr/memoryjs';
const enforcer = new CollaborationAuditEnforcer(
  ctx.entityManager,
  new AuditLog('./audit.jsonl'),
);
await enforcer.createEntities(
  [{ name: 'X', entityType: 't', observations: ['fact'] }],
  'agent-alice', // throws AttributionRequiredError if agentId is missing
);
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

// World-state snapshot + diff
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

// Redact PII from exports / logs
import { PiiRedactor } from '@danielsimonjr/memoryjs';
const redactor = new PiiRedactor();
const cleanGraph = redactor.redactGraph(graph);
const { text, stats } = redactor.redactWithStats(observation);
```

## Core Concepts

### Entity

The primary node in the knowledge graph. Required fields are `name`, `entityType`,
and `observations`; the rest are optional and unlock specific features:

```typescript
interface Entity {
  name: string;              // Unique identifier
  entityType: string;        // Classification (person, project, concept, …)
  observations: string[];    // Atomic facts about the entity
  parentId?: string;         // Parent entity for hierarchical nesting
  tags?: string[];           // Lowercase tags for categorisation
  importance?: number;       // 0–10 scale for prioritisation
  createdAt?: string;        // ISO 8601
  lastModified?: string;     // ISO 8601

  // Freshness
  ttl?: number;              // Seconds until stale
  confidence?: number;       // [0, 1] belief strength

  // Project scoping + supersession
  projectId?: string;        // Multi-project isolation
  version?: number;          // Drives optimistic concurrency on updates
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // Memory-engine deduplication
  contentHash?: string;      // SHA-256 for O(1) exact-equality dedup

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

### Relation

A directed edge between two entities:

```typescript
interface Relation {
  from: string;           // Source entity name
  to: string;             // Target entity name
  relationType: string;   // Relationship type (active voice — "depends_on", "wrote")
}
```

### Observation

A discrete atomic fact about an entity. Use `addObservations()` to append without
overwriting; combined with the bitemporal axis and per-observation `validFrom` /
`validUntil` you can preserve historical state instead of mutating in place.

### ManagerContext

The central facade. Construct it with a storage-path string; every manager is
exposed as a property with lazy initialisation:

```typescript
const ctx = new ManagerContext('./memory.jsonl');

// Core
ctx.entityManager        // Entity CRUD + hierarchy + temporal validity + OCC
ctx.relationManager      // Relation management + temporal invalidation
ctx.observationManager   // Observation CRUD + bitemporal axis
ctx.hierarchyManager     // Tree operations (parent / children / ancestors)
ctx.searchManager        // All search operations including `searchByTime`
ctx.rankedSearch         // TF-IDF / BM25 ranked search
ctx.graphTraversal       // BFS / DFS / shortest path / centrality / communities
ctx.tagManager           // Tag aliases + bulk operations
ctx.refIndex             // Stable name → entity O(1) lookup

// Storage + I/O
ctx.ioManager            // Import / export (RDF/Turtle/JSON-LD) / backup / ingest
ctx.archiveManager       // Entity archival
ctx.compressionManager   // Duplicate detection, entity merging
ctx.analyticsManager     // Graph statistics + validation
ctx.semanticForget       // Two-tier deletion with audit
ctx.governanceManager    // Transactions + policy enforcement
ctx.freshnessManager     // TTL / confidence freshness reports

// Search extensions
ctx.semanticSearch       // Vector similarity (lazy; needs embedding provider)
ctx.temporalSearch       // Natural-language time-range search
ctx.activeRetrieval      // Iterative query rewriting (no LLM required)
ctx.queryNaturalLanguage // Convenience wrapper for NL → StructuredQuery

// Memory engine + agent system
ctx.memoryEngine         // Turn-aware conversation memory (4-tier dedup)
ctx.memoryBackend        // Pluggable IMemoryBackend (in-memory / sqlite)
ctx.agentMemory()        // Agent Memory System facade

// Memory intelligence
ctx.memoryValidator      // Consistency / contradictions / temporal-order checks
ctx.trajectoryCompressor // Distill / abstract / merge redundant trajectories

// Specialised memory managers
ctx.procedureManager     // Executable procedure memory + feedback refinement
ctx.causalReasoner       // findCauses / findEffects / counterfactual
ctx.worldModelManager    // State-snapshot orchestrator + diff
ctx.heuristicManager     // Condition → action guidelines
ctx.decisionManager      // ADR-style decision records
ctx.projectContextManager
ctx.toolAffordanceManager
ctx.spellChecker         // Vocabulary-driven spell suggestions
ctx.exclusionManager     // `do_not_remember` content-pattern rules
ctx.observationDedupManager

// Access control + audit
ctx.roleAssignmentStore
ctx.rbacMiddleware
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

### Available methods

| Method | Description | Use case |
|---|---|---|
| `searchManager.autoSearch(query)` | Auto-selects the best method + explains why | Default entry point |
| `searchManager.searchNodes(query)` | Substring + tag matching | Simple queries |
| `searchManager.booleanSearch(query)` | AND / OR / NOT with AST parser | Complex filters |
| `searchManager.fuzzySearch(query)` | Levenshtein + N-gram pre-filter | Typo tolerance |
| `searchManager.searchByTime(query)` | Natural-language time ranges (`chrono-node`) | "last hour", "since 2024-01-01" |
| `rankedSearch.searchNodesRanked(query, ...)` | TF-IDF / BM25 ranking | Most-relevant ordering |
| `semanticSearch.search(query)` | Vector similarity (requires embedding provider) | Semantic queries |
| `new HybridSearchManager(...).search(query)` | Semantic + lexical + symbolic | Multi-signal ranking |
| `activeRetrieval.adaptiveRetrieve({ query })` | Iterative query rewriting + coverage check | Adaptive refinement |
| `queryNaturalLanguage(query, llmProvider?)` | LLM-planned NL decomposition (fallback: keyword) | Free-text queries |
| `causalReasoner.findEffects(seed, candidates)` | Subgraph traversal over `causes`/`enables`/`prevents` | Causal inference |

### Auto-search

```typescript
const auto = await ctx.searchManager.autoSearch('TypeScript runtime');
console.log(auto.selectedMethod, auto.selectionReason);
console.log(auto.results);
```

### Boolean search

```typescript
// AND — both terms must match
await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// OR — either term matches
await ctx.searchManager.booleanSearch('frontend OR backend');

// NOT — exclude term
await ctx.searchManager.booleanSearch('JavaScript NOT browser');

// Grouping
await ctx.searchManager.booleanSearch('(TypeScript OR JavaScript) AND server');
```

### Fuzzy search

```typescript
// Typo-tolerant; threshold 0–1 (higher = stricter)
await ctx.searchManager.fuzzySearch('Typscript', { threshold: 0.7 });
```

### Hybrid search

`HybridSearchManager` combines three signal layers. Instantiate it directly —
it is exported from the package but not wired onto `ManagerContext` because the
weighting + filter configuration is application-specific.

```typescript
import { HybridSearchManager } from '@danielsimonjr/memoryjs';

const hybrid = new HybridSearchManager(ctx.storage, ctx.rankedSearch);
const results = await hybrid.search('programming concepts', {
  weights: {
    semantic: 0.5,   // Vector similarity (requires embeddings)
    lexical: 0.3,    // TF-IDF text matching
    symbolic: 0.2,   // Metadata (tags, importance, type)
  },
  filters: {
    entityTypes: ['concept'],
    minImportance: 5,
    tags: ['programming'],
  },
});
```

## Graph Algorithms

### Path finding

```typescript
// Shortest path between entities (BFS)
const result = await ctx.graphTraversal.findShortestPath('A', 'Z');
console.log(result.path);     // ['A', 'B', 'C', 'Z']
console.log(result.distance); // 3

// All paths with a depth bound
const all = await ctx.graphTraversal.findAllPaths('A', 'Z', { maxDepth: 5 });
// → [['A', 'B', 'Z'], ['A', 'C', 'D', 'Z'], …]
```

### Centrality

Each centrality algorithm has its own method (no unified `getCentrality()` — the
algorithms have different parameters and return shapes):

```typescript
const degree = await ctx.graphTraversal.calculateDegreeCentrality();
const between = await ctx.graphTraversal.calculateBetweennessCentrality();
const pagerank = await ctx.graphTraversal.calculatePageRank();
const hits = await ctx.graphTraversal.calculateHITS();
// Each returns a Map<entityName, score>
```

### Connected components, communities, cliques

```typescript
const components = await ctx.graphTraversal.findConnectedComponents();
const communities = await ctx.graphTraversal.findCommunities();   // Louvain
const cliques = await ctx.graphTraversal.findCliques(/* minSize */ 3);
```

### Traversal

```typescript
// Returns a TraversalResult { visited, edges, depthMap }
const bfs = ctx.graphTraversal.bfs('startNode', { maxDepth: 3 });
const dfs = ctx.graphTraversal.dfs('startNode');
```

## Agent Memory System

A memory system for AI agents with session lifecycle, working / episodic /
semantic / procedural memory, decay, salience, multi-agent visibility, and
specialised memory types (prospective, failure, plan, reflection, heuristic,
decision rationale, project context, tool affordance).

### Key components

| Component | Purpose |
|---|---|
| `AgentMemoryManager` | Unified facade for the system |
| `SessionManager` | Session lifecycle (start / end / restore / checkpoint) |
| `WorkingMemoryManager` | Short-term, session-scoped memories with promotion |
| `EpisodicMemoryManager` | Timeline-based event memories |
| `DecayEngine` | Time-based importance decay |
| `SalienceEngine` | Context-aware memory scoring |
| `MultiAgentMemoryManager` | Cross-agent memory with visibility controls |
| `ConflictResolver` | Resolution strategies for concurrent updates |

### Quick start

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
  importance: 7,
});

// Episodic event
await agent.createEpisode('Completed onboarding flow', {
  sessionId: session.name,
  importance: 8,
});

// Retrieve context for an LLM prompt (token-budgeted)
const context = await agent.retrieveForContext({
  maxTokens: 2000,
  includeEpisodic: true,
});

// End session
await agent.endSession(session.name);
```

### Memory types

```typescript
type MemoryType =
  | 'working'      // Short-term, session-scoped; may be promoted
  | 'episodic'     // Timeline-based event memories
  | 'semantic'     // Long-term factual knowledge
  | 'procedural'   // Executable procedures with feedback refinement
  | 'prospective'  // Intentions-to-act at a future time / event / condition
  | 'failure'      // Pre-task failure lookup keyed on applicability_hint
  | 'plan'         // Hierarchical goal trees with sub-tasks + acceptance criteria
  | 'reflection'   // Additive derived insights with content-hash dedup
  | 'heuristic';   // Condition → action guidelines
```

Each specialised type has a dedicated manager on `ManagerContext` —
`ctx.prospectiveMemory`, `ctx.failureManager`, `ctx.plan`, `ctx.reflectionManager`,
`ctx.heuristicManager`, `ctx.decisionManager`, `ctx.projectContextManager`,
`ctx.toolAffordanceManager`.

**Trust hierarchy mixin**: every `MemorySource` may carry an optional
categorical `trustLevel`: `'ground-truth' | 'verified' | 'inferred' | 'unverified'`.
Used by the `'trust_level'` `ConflictStrategy` (with recency tiebreak) and
backfilled from `method` + `reliability` via `inferTrustLevel(source)`.

### Decay

Memories naturally decay over time unless reinforced:

```typescript
const agent = ctx.agentMemory({
  decay: {
    halfLifeHours: 168,  // One-week half-life
    minImportance: 0.1,  // Never fully forget
  },
  enableAutoDecay: true,
});

// Reinforce a memory
await agent.confirmMemory('memory_name', 0.1);  // Boost confidence
await agent.promoteMemory('memory_name', 'episodic');  // Promote to long-term
```

### Multi-agent

```typescript
// Register an agent
agent.registerAgent('agent_1', {
  name: 'Research Agent',
  type: 'llm',
  trustLevel: 0.8,
  capabilities: ['read', 'write'],
});

// Create with visibility (private / team / org / shared / public)
await agent.addWorkingMemory({
  sessionId: session.name,
  content: 'Shared insight',
  visibility: 'shared',
  ownerAgentId: 'agent_1',
});

// Cross-agent search
const results = await agent.searchCrossAgent('agent_2', 'query');
```

## API Reference

Method tables below cover the most-used surfaces. For the full surface use
your IDE's go-to-definition or read `dist/index.d.ts`.

### EntityManager

| Method | Description |
|---|---|
| `createEntities(entities)` | Create multiple entities in one batch |
| `deleteEntities(names)` | Delete entities by name |
| `getEntity(name, options?)` | Get one entity (with optional access tracking) |
| `updateEntity(name, updates, { expectedVersion? })` | Partial update; opt-in optimistic concurrency |
| `addTags(name, tags)` / `removeTags(name, tags)` | Tag management |
| `setImportance(name, score)` | Set importance (0–10) |
| `getVersionChain(name)` / `getLatestVersion(name)` | Supersession chains |
| `invalidateEntity(name, ended?)` | Set `validUntil` (bitemporal) |
| `entityAsOf(name, asOf)` | Time-travel query |
| `entityTimeline(name)` | Versions sorted by `validFrom` |

### RelationManager

| Method | Description |
|---|---|
| `createRelations(relations)` | Create multiple relations |
| `getRelations(entityName)` | Incoming + outgoing relations |
| `deleteRelations(relations)` | Delete specific relations |
| `invalidateRelation(from, type, to, ended?)` | Set `validUntil` on a relation |
| `queryAsOf(entity, asOf, options?)` | Relations valid at time T |
| `timeline(entity, options?)` | Chronological history |

### ObservationManager

| Method | Description |
|---|---|
| `addObservations(adds, dedupOptions?)` | Add observations (optional dedup) |
| `deleteObservations(deletions)` | Remove specific observations |
| `getObservationsFor(entityName)` | Read observations (column-store-aware) |
| `invalidateObservation(entity, content, ended?)` | Set per-observation `validUntil` |
| `observationsAsOf(entity, asOf)` | Observations valid at time T |

### SearchManager (`ctx.searchManager`)

| Method | Description |
|---|---|
| `searchNodes(query, options?)` | Substring + tag matching |
| `booleanSearch(query, options?)` | AND / OR / NOT with AST |
| `fuzzySearch(query, options?)` | Levenshtein + N-gram pre-filter |
| `searchByTime(query, options?)` | Natural-language time ranges |
| `autoSearch(query, limit?)` | Auto-select best method; returns `selectedMethod` + `selectionReason` |
| `openNodes(names)` | Bulk-fetch entities by name |

For ranked search use `ctx.rankedSearch.searchNodesRanked(query, tags?, min?, max?, limit?)`.
For hybrid search, instantiate `HybridSearchManager` directly.

### IOManager (`ctx.ioManager`)

| Method | Description |
|---|---|
| `exportGraph(graph, format)` | Export to `json` / `csv` / `graphml` / `gexf` / `dot` / `markdown` / `mermaid` / `turtle` / `rdf-xml` / `json-ld` |
| `exportGraphWithCompression(graph, format, options?)` | Brotli-compressed export |
| `importGraph(format, data, options?)` | Import with merge strategies (`replace` / `skip` / `merge` / `fail`) |
| `ingest(input, options?)` | Conversation ingestion pipeline (format-agnostic) |
| `splitTranscript(content, options?)` | Split multi-session transcripts |
| `visualizeGraph(options?)` | Interactive HTML visualisation |
| `createBackup(options?)` / `restoreFromBackup(path)` / `deleteBackup(path)` / `cleanOldBackups(keepCount?)` | Backup lifecycle |

### GraphTraversal (`ctx.graphTraversal`)

| Method | Description |
|---|---|
| `findShortestPath(from, to)` | BFS shortest path |
| `findAllPaths(from, to, options?)` | All paths with depth bound |
| `findConnectedComponents()` | Isolated subgraphs |
| `findCliques(minSize?)` | Maximal cliques |
| `findCommunities()` | Louvain community detection |
| `calculateDegreeCentrality()` / `calculateBetweennessCentrality()` / `calculatePageRank()` / `calculateHITS()` | Centrality (each returns `Map<entityName, score>`) |
| `bfs(start, options?)` / `dfs(start, options?)` | Returns `TraversalResult` |

### CausalReasoner (`ctx.causalReasoner`)

| Method | Description |
|---|---|
| `findEffects(cause, candidates, maxDepth?)` | Forward inference; sorted by causal-strength product |
| `findCauses(effect, candidates, maxDepth?)` | Backward inference (symmetric inverse) |
| `counterfactual({ seed, removeFrom, removeTo, predict })` | Pure: doesn't mutate the graph |
| `detectCycles(seed, maxDepth?)` | Depth-bounded DFS over causal subgraph |

### ProcedureManager (`ctx.procedureManager`)

| Method | Description |
|---|---|
| `addProcedure({ steps, ... })` | Persist a procedure; auto-generates id |
| `getProcedure(id)` / `getStep(id, order)` / `getNextStep(id, order)` | Access |
| `openSequencer(id)` | Stateful execution cursor with fallback support |
| `matchProcedure(context, candidates, threshold?)` | Token-overlap match |
| `refineProcedure(id, { succeeded, notes? })` | EWMA success-rate update |

### WorldModelManager (`ctx.worldModelManager`)

| Method | Description |
|---|---|
| `getCurrentState()` | Snapshot from the live graph (capped at `maxSnapshotSize`) |
| `validateFact(observation, entityName)` | Delegates to `MemoryValidator` if wired |
| `predictOutcome(action, candidates)` | Delegates to `CausalReasoner.findEffects` |
| `detectStateChange(before, after)` | Pure snapshot diff |

### ActiveRetrievalController (`ctx.activeRetrieval`)

| Method | Description |
|---|---|
| `shouldRetrieve(context)` | Cost heuristic; rejects empty / over-budget |
| `adaptiveRetrieve(context)` | Iterative rewrite + retrieve until coverage threshold |

### CollaborativeSynthesis (`ctx.agentMemory().collaborativeSynthesis`)

| Method | Description |
|---|---|
| `synthesize(seedEntity, context?)` | BFS + salience scoring; surfaces multi-agent conflicts |
| `resolveConflicts(result, policy)` | Pick winners per `most_recent` / `highest_confidence` / `highest_score` / `trusted_agent` |

### MemoryValidator (`ctx.memoryValidator`)

| Method | Description |
|---|---|
| `validateConsistency(newObs, existing)` | Composite duplicate / semantic / low-confidence check |
| `detectContradictions(entity)` | Delegates to `ContradictionDetector` |
| `repairWithResolver(entity, competing, resolver, contradiction?, options?)` | Apply `ConflictResolver` strategies |
| `validateTemporalOrder(observations)` | `[T=ISO]` ordering check |
| `calculateReliability(entity)` | Confidence × confirmation × age penalty |

### RBAC (`ctx.rbacMiddleware`, `ctx.roleAssignmentStore`)

| Method | Description |
|---|---|
| `rbacMiddleware.checkPermission(agentId, action, resourceType, resourceName?, now?)` | Returns `true` / `false`; falls back to `defaultRole` (default `reader`) |
| `roleAssignmentStore.assign({ agentId, role, resourceType?, scope?, validFrom?, validUntil? })` | Grant a role |
| `roleAssignmentStore.revoke(agentId, role, resourceType?)` | Remove a grant |
| `roleAssignmentStore.listActive(agentId, now?)` | Active grants at a point in time |

### PiiRedactor

| Method | Description |
|---|---|
| `redact(text)` | Apply patterns; returns redacted string |
| `redactWithStats(text)` | Returns `{ text, stats: { totalRedactedBytes, countsByPattern } }` |
| `redactGraph(graph)` | Apply to every observation in a graph-shaped object |

### Specialised memory managers

| Manager | Path | Key methods |
|---|---|---|
| Prospective | `ctx.prospectiveMemory` | `schedule()` / `fire()` / `cancel()` / `expireDueIntentions()` / `getPending()` |
| Failure | `ctx.failureManager` | `record()` / `lookupForTask()` / `markResolved()` / `getAll()` |
| Plan | `ctx.plan` | `createPlan()` / `pushSubGoal()` / `transitionNode()` / `markPlanComplete()` / `getCurrentPath()` |
| Reflection | `ctx.reflectionManager` | `create()` / `list()` / `getRelevantForSession()` / `archive()` |
| Heuristic | `ctx.heuristicManager` | `add()` / `match()` / `reinforce()` / `recordContradiction()` / `detectConflicts()` |
| Decision | `ctx.decisionManager` | `propose()` / `accept()` / `reject()` / `supersede()` / `findByContext()` / `getChain()` |
| Project context | `ctx.projectContextManager` | `upsert()` / `appendFact()` / `appendCommand()` / `forContext()` |
| Tool affordance | `ctx.toolAffordanceManager` | `recordOutcome()` / `suggestTool()` / `rollingStats()` |
| Exclusion | `ctx.exclusionManager` | `add()` / `list()` / `remove()` / `check()` / `findMatchingMemories()` |
| Observation dedup | `ctx.observationDedupManager` | `findDuplicateObservations()` / `findJaccardDuplicates()` |
| Spell | `ctx.spellChecker` | `suggest()` / `rebuild()` / `vocabularySize()` |

## Configuration

memoryjs is configured almost entirely through environment variables. The
table below lists the most-used; the full reference (decay / salience /
context-window / freshness / RBAC / mmap / segment / SQLite-pool / partial-index
knobs) lives in [CLAUDE.md](CLAUDE.md#environment-variables).

| Variable | Description | Default |
|---|---|---|
| `MEMORY_STORAGE_TYPE` | Storage backend: `jsonl` or `sqlite` | `jsonl` |
| `MEMORY_FILE_PATH` | Override storage file path | (per `ManagerContext` ctor) |
| `MEMORY_BACKEND` | Pluggable Memory-Engine backend: `sqlite` or `in-memory` | `sqlite` |
| `MEMORY_EMBEDDING_PROVIDER` | Embedding provider: `openai`, `local`, or `none` | `local` |
| `MEMORY_OPENAI_API_KEY` | OpenAI API key (required when provider is `openai`) | — |
| `MEMORY_AUTO_INDEX_EMBEDDINGS` | Auto-build embedding index on entity create | `false` |
| `MEMORY_AUTO_DECAY` | Enable background memory decay | `false` |
| `MEMORY_DECAY_HALF_LIFE_HOURS` | Half-life for importance decay | `168` |
| `MEMORY_GOVERNANCE_ENABLED` | Enable `GovernanceManager` policy enforcement | `false` |
| `MEMORY_AUDIT_LOG_FILE` | Path for the audit JSONL trail | — |
| `MEMORY_AGENT_ROLE` | Apply a built-in role profile (`researcher` / `planner` / `executor` / `reviewer` / `coordinator`) | — |
| `MEMORY_VALIDATE_ON_STORE` | Run `MemoryValidator` before observation writes | `false` |
| `MEMORY_AUDIT_ATTRIBUTION_REQUIRED` | `CollaborationAuditEnforcer` strict mode | `false` |
| `MEMORY_RBAC_ENABLED` | Wire `RbacMiddleware` into `GovernancePolicy` | `false` |
| `MEMORY_DEFAULT_VISIBILITY` | Default `AgentEntity.visibility` | `private` |
| `MEMORY_USE_MMAP` | Use mmap for `GraphStorage.loadFromDisk` (strict `'true'` literal match) | `false` |
| `MEMORY_MMAP_THRESHOLD_BYTES` | Minimum file size to trigger the mmap path; `0` = always | `104857600` |
| `MEMORY_STORAGE_SEGMENT_COUNT` | FNV-routed JSONL shard count (1–1024) | `1` (off) |
| `MEMORY_SQLITE_READ_POOL_SIZE` | Read-connection pool size for `SQLiteStorage` | `4` |
| `MEMORY_SQLITE_AUTO_INDEX` | Enable `PartialIndexAdvisor`-driven automatic partial-index DDL | `false` |
| `SKIP_BENCHMARKS` | Skip perf-benchmark tests | `false` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | (none) |

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- TypeScript 5.0+

### Common commands

```bash
npm install            # Install dependencies
npm run build          # Build TypeScript to dist/ (tsup; ESM + CJS dual output)
npm run build:watch    # Watch mode
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run test:coverage  # Run with coverage report
npm run test:ci        # Excludes tests/performance/** (used by prepublishOnly)
npm run typecheck      # Type checking without emit
npm run lint           # ESLint (flat config; @typescript-eslint)
npm run benchmark      # Standalone synthetic benchmarks
npm run bench          # Vitest performance suite
SKIP_BENCHMARKS=true npm test  # Skip perf tests in the main suite
```

### Tooling

```bash
npm run audit:plans                                                    # Detect plan-doc rot
npx tsx tools/create-dependency-graph/create-dependency-graph.ts       # Refresh DEPENDENCY_GRAPH.md
npx tsx tools/chunking-for-files/chunking-for-files.ts split <file>    # Split a large file
npx tsx tools/chunking-for-files/chunking-for-files.ts merge <manifest>  # Merge back
npx tsx tools/migrate-from-jsonl-to-sqlite/...                         # JSONL → SQLite migration
```

### Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade — lazy init)            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│  Layer 2: Domain managers                                        │
│  Core: Entity / Relation / Observation / Hierarchy / Search /    │
│        GraphTraversal / Tags / RefIndex                          │
│  I/O:  IOManager / Archive / Compression / Analytics / Audit /   │
│        Governance / Freshness / SemanticForget                   │
│  Search: Ranked / Semantic / Temporal / LLMQueryPlanner /        │
│        ActiveRetrievalController                                 │
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
│  Pluggable IMemoryBackend: in-memory or sqlite-backed engine     │
└──────────────────────────────────────────────────────────────────┘
```

### Project layout

```
src/
├── index.ts                # Public entry point
├── agent/                  # Agent Memory System (managers, decay, salience,
│                           #   multi-agent, specialised memory types)
├── core/                   # ManagerContext, entity / relation / observation
│                           #   managers, storage backends, graph traversal
├── search/                 # Ranked / boolean / fuzzy / semantic / hybrid /
│                           #   temporal / LLM-planned search + indexes
├── features/               # IOManager, Archive, Compression, Audit,
│                           #   Governance, Freshness, SemanticForget
├── cli/                    # `memory` / `memoryjs` CLI binary
├── security/               # PII redactor, ABAC, RLS, API keys
├── types/                  # Shared TypeScript definitions
├── utils/                  # Caching, schemas, compression adapters, logger
└── workers/                # Worker pool for CPU-intensive tasks

tests/                      # vitest test suite
├── unit/                   # Per-module unit tests
├── integration/            # Cross-module workflows
├── edge-cases/             # Boundary conditions
└── performance/            # Benchmarks (gated by SKIP_BENCHMARKS)

tools/                      # Dev utilities (chunker, dep-graph generator,
                            #   migration, plan-doc audit, etc.)
```

See [`docs/architecture/DEPENDENCY_GRAPH.md`](docs/architecture/DEPENDENCY_GRAPH.md)
for the autogenerated dependency graph and module breakdown.

## Documentation

Architecture documentation lives under `docs/architecture/`:

- [OVERVIEW.md](docs/architecture/OVERVIEW.md) — high-level project overview
- [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) — technical design
- [COMPONENTS.md](docs/architecture/COMPONENTS.md) — module-by-module breakdown
- [DATAFLOW.md](docs/architecture/DATAFLOW.md) — data-flow patterns
- [API.md](docs/architecture/API.md) — full API reference
- [DEPENDENCY_GRAPH.md](docs/architecture/DEPENDENCY_GRAPH.md) — module dependencies (auto-generated)
- [AGENT_MEMORY.md](docs/architecture/AGENT_MEMORY.md) — Agent Memory System design
- [TEST_COVERAGE.md](docs/architecture/TEST_COVERAGE.md) — test coverage analysis

Other:

- [ARCHITECTURE_DECISIONS.md](docs/development/ARCHITECTURE_DECISIONS.md) — Architecture Decision Records
- [ROADMAP.md](docs/roadmap/ROADMAP.md) — feature roadmap
- [CLAUDE.md](CLAUDE.md) — full environment-variable reference + working notes
- [CHANGELOG.md](CHANGELOG.md) — version-by-version history

## License

**MIT License** - see [LICENSE](LICENSE)

## Related

- [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) - MCP server built on this library

---

**Repository:** https://github.com/danielsimonjr/memoryjs
**NPM:** https://www.npmjs.com/package/@danielsimonjr/memoryjs
**Issues:** https://github.com/danielsimonjr/memoryjs/issues
