# MemoryJS - Data Flow Documentation

**Version**: Unreleased (post v2.9.0 — brainapi2-inspired features R1–R5/R7/R9 + S1–S10/Sec1–Sec10 speed & security optimization program; Phases 0–11 performance & scale track via PR #34; Phase 2 memory-types expansion Sprints 4–6 + 8; v2.0.0 seven-theme function/API-call consistency & efficiency audit; knowledge-graph-as-core convergence)
**Last Updated**: 2026-07-24

> **Unreleased — the single biggest data-flow change since the last review**:
> manager mutations no longer read-modify-write the whole graph. The
> per-operation flow diagrams below (Create/Delete Entities, Add
> Observations, Create Relations, Import) still show the pre-optimization
> `storage.saveGraph(graph)` PERSIST step for illustrative simplicity — the
> semantics of *what* gets persisted and *which* events fire have changed;
> see [Batch Mutation Delta Flow](#batch-mutation-delta-flow-s2) for the
> current, accurate mechanics. Three more flows added in this pass:
> [Governance-Enforced Mutation Flow](#governance-enforced-mutation-flow-sec1),
> [Ingest-with-Provenance Flow](#ingest-with-provenance-flow-r4br5), and
> [Explain Evidence-Path Flow](#explain-evidence-path-flow-r2).

> Most data-flow patterns documented here remain accurate. New flows added
> in v1.9–v1.15: temporal-validity invalidation cascade (η.4.4),
> conversation ingestion pipeline (`IOManager.ingest`, v1.9.0), four-tier
> dedup chain in `MemoryEngine` (v1.11.0), pluggable backend selection
> (`MEMORY_BACKEND`, v1.12.0), iterative active-retrieval round-robin
> (3B.5), causal-chain traversal (3B.6), world-state snapshot diff (3B.7),
> mmap-branched JSONL load via `IMmapBackend.streamLines` (v1.15.0 Phase 11),
> FNV-routed segment-shard reads (v1.15.0 Phase 7), columnar observation
> reads via `JsonlColumnStore` (v1.15.0 Phase 8), tiered-index lookups
> (`LRUHotTier` → `DiskWarmTier` → `BrotliColdTier`, v1.15.0 Phase 9),
> compressed entity-cache hits via `CompressedMap` (v1.15.0 Phase 10),
> write-ahead log commit-then-apply (v1.15.0 Phase 6), and `BackupManager`'s
> three-step delete (path-validate → symlink-check → unlink-then-cleanup-meta).
> See the relevant per-manager sections below.
>
> **Phase 2 memory-types expansion (2026-05)** added five new flows:
> - **Failure lookup (Sprint 4):** Pre-task `FailureManager.lookupForTask`
>   substring-scores `applicability_hint` (3×), `context` (2×), `attempted`
>   (1×). `markResolved` branches on `storage.updateEntity` boolean to
>   surface `'vanished-mid-update'` vs. `'already-resolved'`.
> - **Plan-tree mutation (Sprint 5):** `loadPlanMutable` → deep-clone →
>   tree mutation → `validatePlanInvariants` (uniqueness, currentNodeId ∈
>   tree, no cycles) → `persistPlan`. The deep clone IS the rollback —
>   invariant failure throws without touching storage. Read paths skip the
>   clone (`Readonly<T>` is type-only).
> - **Trust-level resolution (Sprint 6):** `ConflictResolver` with
>   `'trust_level'` strategy calls `inferTrustLevel(source)` per memory
>   (explicit `source.trustLevel` wins; otherwise NaN-guard then method-
>   based mapping); `compareTrustLevel` orders results; recency tiebreak
>   on equal tier.
> - **Reflection emission (Sprint 8):** `ReflectionStage.runOnSessionEnd(sessionId)`
>   → load `episodic + semantic` candidates filtered by `sessionId` →
>   collect observations (max-per-run circuit breaker) → `PatternDetector`
>   → early-return-with-`[info]`-error when below `minConfidence` →
>   `TrajectoryCompressor.distill` → clamp confidence to `[0, 1]` →
>   `ReflectionManager.create` with content-hash dedup (`sha256(scope|sorted(evidence))`).
> - **Prospective promotion (Phase 1, integrated 2026-04):**
>   `ProspectivePromotionStage` scans storage for fired `inject-context`
>   intentions, promotes them to `'episodic'` with `prospective-fulfilled`
>   tag, branches on `storage.updateEntity` boolean to surface
>   vanished-mid-batch as errors.
>
> **Knowledge-graph-as-core convergence (2026-07)** added two more flows,
> both documented in full below:
> - **Entity rename** (`EntityManager.renameEntity`): atomic rewrite of
>   every stored `name` reference, followed by a fixed three-event emission
>   sequence (`entity:renamed` → `entity:deleted` → `entity:created`) — see
>   [Entity Rename Flow](#entity-rename-flow).
> - **Graph-connectivity signal propagation** (`GraphRankPrior`): a single
>   cached PageRank/degree computation feeding four independent opt-in
>   consumers (`RankedSearch` boost, `HybridScorer` graph channel,
>   `SalienceEngine` connectivity weight, `DecayEngine` connectivity
>   protection) — see
>   [Graph-Connectivity Signal Flow](#graph-connectivity-signal-flow).
> Also: `SQLiteStorage` now emits the same `GraphEventEmitter` events as
> JSONL `GraphStorage` (see the updated
> [TF-IDF Event Sync Flow](#tf-idf-event-sync-flow)), so every event-driven
> derived view works on both backends.

---

## Table of Contents

1. [Overview](#overview)
2. [Request Processing Flow](#request-processing-flow)
3. [Entity Operations](#entity-operations)
4. [Relation Operations](#relation-operations)
5. [Search Operations](#search-operations)
6. [Hierarchy Operations](#hierarchy-operations)
7. [Compression Operations](#compression-operations)
8. [Import/Export Operations](#importexport-operations)
9. [Agent Memory Operations](#agent-memory-operations)
10. [Graph-Connectivity Signal Flow](#graph-connectivity-signal-flow)
11. [Caching Strategy](#caching-strategy)
12. [Index Architecture](#index-architecture)
13. [Error Handling Flow](#error-handling-flow)
14. [Batch Mutation Delta Flow (S2)](#batch-mutation-delta-flow-s2)
15. [Governance-Enforced Mutation Flow (Sec1)](#governance-enforced-mutation-flow-sec1)
16. [Ingest-with-Provenance Flow (R4b/R5)](#ingest-with-provenance-flow-r4br5)
17. [Explain Evidence-Path Flow (R2)](#explain-evidence-path-flow-r2)

---

## Overview

Data flows through MemoryJS in a layered pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Code                                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: ManagerContext (Facade)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Lazy-initialized access to all managers                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Manager Layer                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  EntityManager │ RelationManager │ SearchManager │ etc. │   │
│  └───────────────────────────┬─────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Storage Layer                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              GraphStorage / SQLiteStorage                │   │
│  │  ┌──────────────┐              ┌───────────────────┐    │   │
│  │  │ In-Memory    │◀────────────▶│   File System     │    │   │
│  │  │ Cache        │   read/write │   (JSONL/SQLite)  │    │   │
│  │  └──────────────┘              └───────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Processing Flow

### General Request Flow

```
1. Application calls ManagerContext method
        │
        ▼
2. ManagerContext lazy-initializes manager (if needed)
        │
        ▼
3. Manager validates input (Zod schemas)
        │
        ▼
4. Manager loads graph from storage
        │
        ▼
5. Manager processes request in memory
        │
        ▼
6. Manager saves graph (if modified)
        │
        ▼
7. Result returned to application
```

### Example: Create Entities

```typescript
// 1. Application calls
const ctx = new ManagerContext({ storagePath: './memory.jsonl' });
await ctx.entityManager.createEntities([
  { name: 'Alice', entityType: 'person', observations: ['Engineer'] }
]);

// 2. EntityManager processing
async createEntities(entities: Entity[]): Promise<Entity[]> {
  // Validate input
  const validated = BatchCreateEntitiesSchema.parse(entities);

  // Load graph
  const graph = await this.storage.loadGraph();

  // Filter duplicates
  const newEntities = validated.filter(e => !graph.entities.find(x => x.name === e.name));

  // Add timestamps and normalize
  const withTimestamps = newEntities.map(e => ({
    ...e,
    tags: e.tags?.map(t => t.toLowerCase()),
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString()
  }));

  // Add to graph
  graph.entities.push(...withTimestamps);

  // Save
  await this.storage.saveGraph(graph);

  // Emit events (for TF-IDF sync)
  this.eventEmitter?.emit('entity:created', withTimestamps);

  return withTimestamps;
}
```

---

## Entity Operations

### Create Entities Flow

```
createEntities(entities)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATION                                                │
│    BatchCreateEntitiesSchema.safeParse(entities)            │
│    └── Validates: name, entityType, observations, tags      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD GRAPH                                                │
│    storage.loadGraph()                                       │
│    └── Returns cached or loads from disk                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. FILTER DUPLICATES                                         │
│    entities.filter(e => !exists(e.name))                    │
│    └── Skip entities that already exist                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. TRANSFORM ENTITIES                                        │
│    For each entity:                                          │
│    ├── Add timestamps (createdAt, lastModified)              │
│    ├── Normalize tags to lowercase                           │
│    └── Validate importance (0-10)                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST                                                   │
│    graph.entities.push(...newEntities)                       │
│    storage.saveGraph(graph)                                  │
│    └── Writes to disk, invalidates cache                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. EMIT EVENTS                                               │
│    eventEmitter.emit('entity:created', newEntities)         │
│    └── Triggers TF-IDF index update                          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity[]
```

### Delete Entities Flow

```
deleteEntities(entityNames)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
│    storage.loadGraph()                                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. REMOVE ENTITIES                                           │
│    graph.entities = entities.filter(e => !toDelete(e.name)) │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. REMOVE ORPHANED RELATIONS                                 │
│    graph.relations = relations.filter(r =>                   │
│      !toDelete(r.from) && !toDelete(r.to))                   │
│    └── Cascading delete of related relations                 │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EMIT EVENTS                                               │
│    eventEmitter.emit('entity:deleted', entityNames)         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: void
```

### Add Observations Flow

```
addObservations([{ entityName, contents }])
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FOR EACH OBSERVATION REQUEST                              │
│    ├── Find entity by name (throw if not found)              │
│    ├── Filter out duplicate observations                     │
│    ├── Push new observations to entity.observations          │
│    └── Update entity.lastModified                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PERSIST (single write for all updates)                    │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: { entityName, addedObservations }[]
```

### Entity Rename Flow

```
renameEntity(oldName, newName)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATE NEW NAME                                         │
│    EntityNamesSchema.safeParse([newName])                    │
│    └── Same checks as createEntities (length, reserved        │
│        namespace prefixes, etc.)                              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOOKUP + EXISTENCE CHECKS                                  │
│    ├── oldName must exist → else EntityNotFoundError          │
│    └── newName must NOT exist → else DuplicateEntityError     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. STORAGE-LEVEL ATOMIC REWRITE                               │
│    storage.renameEntity(oldName, newName) — optional          │
│    IGraphStorage member, implemented by both GraphStorage      │
│    (JSONL, segment-routing-aware) and SQLiteStorage:           │
│    ├── Rewrite Relation.from / Relation.to                    │
│    ├── Rewrite other entities' parentId                       │
│    ├── Rewrite version-chain fields (parentEntityName,        │
│    │   rootEntityName, supersededBy)                           │
│    └── Preserve id / createdAt; bump lastModified              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. REMAP REFINDEX ALIASES                                     │
│    Any stable-name aliases pointing at oldName now point       │
│    at newName (only if a RefIndex is wired — ManagerContext    │
│    does this automatically)                                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EMIT EVENTS (fixed order, exactly once)                    │
│    events.emitEntityRenamed(oldName, newName, entity)          │
│      └── 'entity:renamed'                                     │
│    events.emit('entity:deleted', oldName)                     │
│    events.emit('entity:created', entity)                      │
│    └── Lets create/delete-only derived views (TF-IDF sync,     │
│        GraphRankPrior) stay consistent without learning the    │
│        new event type. Fires on both JSONL and SQLite.         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity (renamed)
```

**Known limitations**: archived snapshots, the immutable audit log, and free-text soft references (e.g. `promotedFrom` inside agent-memory blobs) keep the old name — only structural references (relations, `parentId`, version chain, `RefIndex`) are rewritten.

---

## Relation Operations

### Create Relations Flow

```
createRelations(relations)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATION                                                │
│    BatchCreateRelationsSchema.safeParse(relations)          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. FILTER DUPLICATES                                         │
│    Check for existing (from, to, relationType) combinations │
│    └── Note: Deferred integrity - entities may not exist     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ADD TIMESTAMPS                                            │
│    For each relation:                                        │
│    ├── Add createdAt                                         │
│    └── Add lastModified                                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST                                                   │
│    graph.relations.push(...newRelations)                     │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Relation[]
```

---

## Search Operations

### Basic Search Flow

```
search(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
│    storage.loadGraph() → cached if available                 │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TEXT MATCHING                                             │
│    For each entity:                                          │
│    ├── Match query against entity.name (case-insensitive)    │
│    ├── Match query against entity.entityType                 │
│    └── Match query against each observation                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. APPLY FILTERS (SearchFilterChain)                         │
│    SearchFilterChain.applyFilters(matches, {                 │
│      tags, minImportance, maxImportance                      │
│    })                                                        │
│    ├── Filter by tags (any match)                            │
│    └── Filter by importance range                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. COLLECT RELATIONS                                         │
│    Find relations where from OR to matches filtered entities │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph { entities, relations }
```

### Ranked Search Flow (TF-IDF)

```
searchRanked(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD & FILTER                                             │
│    Load graph, apply SearchFilterChain filters               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUILD DOCUMENT CORPUS                                     │
│    For each entity, create searchable document:              │
│    document = name + ' ' + entityType + ' ' + observations   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. TOKENIZE QUERY                                            │
│    queryTerms = query.toLowerCase().split(/\s+/)            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CALCULATE TF-IDF SCORES                                   │
│    For each entity:                                          │
│    ├── For each query term:                                  │
│    │   ├── TF = term frequency in document                   │
│    │   ├── IDF = log(N / docs containing term)               │
│    │   └── score += TF × IDF                                 │
│    └── Total score = sum of term scores                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. SORT & LIMIT                                              │
│    results.sort((a, b) => b.score - a.score)                │
│    results.slice(0, limit)                                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: SearchResult[] { entity, score, matchedFields }
```

### Boolean Search Flow

```
booleanSearch("name:Alice AND (type:person OR observation:engineer)")
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. TOKENIZE QUERY                                            │
│    Tokens: ['name:Alice', 'AND', '(', 'type:person', 'OR',  │
│             'observation:engineer', ')']                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PARSE TO AST                                              │
│    BooleanQueryNode tree:                                    │
│    AND                                                       │
│    ├── FIELD(name, Alice)                                    │
│    └── OR                                                    │
│        ├── FIELD(type, person)                               │
│        └── FIELD(observation, engineer)                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. EVALUATE AST                                              │
│    For each entity:                                          │
│    ├── Recursively evaluate AST nodes                        │
│    ├── AND: all children must match                          │
│    ├── OR: any child must match                              │
│    ├── NOT: child must not match                             │
│    └── FIELD: check specific field contains value            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. APPLY FILTERS & COLLECT RELATIONS                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph
```

### Fuzzy Search Flow

```
fuzzySearch(query, threshold=0.7)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD & FILTER                                             │
│    Load graph, apply tag/importance filters                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CALCULATE SIMILARITIES (worker pool)                      │
│    For each entity:                                          │
│    ├── For each searchable field (name, type, observations): │
│    │   ├── distance = levenshteinDistance(query, field)     │
│    │   ├── maxLen = max(query.length, field.length)         │
│    │   └── similarity = 1 - (distance / maxLen)             │
│    └── Match if any similarity >= threshold                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. COLLECT MATCHES & RELATIONS                               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph
```

### Hybrid Search Flow

```
hybridSearch(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PARALLEL SEARCH EXECUTION                                 │
│    ├── Semantic: Vector similarity (embeddings)              │
│    ├── Lexical: TF-IDF/BM25 text matching                   │
│    └── Symbolic: Metadata filtering (tags, importance)       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SCORE FUSION                                              │
│    For each result:                                          │
│    finalScore = (semantic × 0.4) + (lexical × 0.4) +        │
│                 (symbolic × 0.2)                             │
│    └── Weights configurable via options                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RANK & RETURN                                             │
│    Sort by finalScore, apply limit                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: HybridSearchResult
```

### Query Planning Pipeline

The modern search pipeline processes queries through multiple optimization stages:

```
Query String
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PARSE                                                     │
│    QueryParser → AST (Abstract Syntax Tree)                 │
│    └── Extracts field filters, boolean ops, quoted phrases   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. ANALYZE                                                   │
│    QueryAnalyzer → QueryAnalysis                            │
│    ├── Complexity scoring (simple / moderate / complex)      │
│    ├── Named entity extraction                               │
│    ├── Temporal reference detection                          │
│    └── Question type classification                          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PLAN                                                      │
│    QueryPlanner → ExecutionPlan                              │
│    ├── Select search methods based on analysis               │
│    ├── Assign layer weights (semantic, lexical, symbolic)     │
│    └── QueryCostEstimator → cost estimate for each layer     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CACHE CHECK                                               │
│    QueryPlanCache → cached plan or miss                      │
│    └── LRU (1000 max), 5 min TTL                             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EXECUTE                                                   │
│    ParallelSearchExecutor → concurrent layer results         │
│    ├── Semantic layer (embedding similarity)                  │
│    ├── Lexical layer (TF-IDF / BM25)                         │
│    └── Symbolic layer (metadata filters)                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. EARLY TERMINATION CHECK                                   │
│    EarlyTerminationManager → adequate? (threshold 0-1)       │
│    └── If adequate, skip remaining layers                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. SCORE FUSION                                              │
│    HybridScorer → normalized combined scores                 │
│    └── Weighted sum across layers                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. REFLECTION (optional)                                     │
│    ReflectionManager → iterative refinement                  │
│    ├── Evaluate result adequacy                              │
│    ├── If inadequate: reformulate query, re-execute          │
│    └── Max iterations (default: 3)                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: HybridSearchResult[]
```

### TF-IDF Event Sync Flow

`TFIDFEventSync` listens to `GraphEventEmitter` to keep the TF-IDF index current. **Both storage backends now emit identical events** — `SQLiteStorage.events` has full parity with JSONL `GraphStorage.events` (previously only JSONL fired these events, so TF-IDF sync silently went stale on SQLite):

```
GraphEventEmitter (GraphStorage OR SQLiteStorage — same event surface)
      │
      ├── entity:created ──► TFIDFEventSync.addToIndex(entities)
      │                       └── Index new entity documents
      │
      ├── entity:updated ──► TFIDFEventSync.reindex(entities)
      │                       └── Remove old + add updated documents
      │
      ├── entity:deleted ──► TFIDFEventSync.removeFromIndex(names)
      │                       └── Remove entity documents from index
      │
      ├── entity:renamed ──► (handled via the entity:deleted + entity:created
      │                       that immediately follow — see Entity Rename
      │                       Flow above; TFIDFEventSync does not need to
      │                       special-case the rename event itself)
      │
      └── observation:added ─► TFIDFEventSync.reindex(entities)
                                └── Re-index affected entity documents
```

`GraphRankPrior` subscribes to the same emitter (`entity:created/updated/deleted`, `relation:created/deleted`, plus `graph:saved` — the latter covers manager-level batch mutations like `EntityManager.createEntities`, which persist via a full `saveGraph` and emit no per-item events) to invalidate its cached PageRank/degree scores. See [Graph-Connectivity Signal Flow](#graph-connectivity-signal-flow).

---

## Hierarchy Operations

### Set Parent Flow

```
setEntityParent(entityName, parentName)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. VALIDATE ENTITY EXISTS                                    │
│    if (!entity) throw EntityNotFoundError                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. VALIDATE PARENT EXISTS (if not null)                      │
│    if (parentName && !parent) throw EntityNotFoundError     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CYCLE DETECTION                                           │
│    wouldCreateCycle(graph, entityName, parentName):         │
│    ├── Start at parentName                                   │
│    ├── Walk up parent chain                                  │
│    ├── If we reach entityName → cycle detected              │
│    └── If we reach root (no parent) → no cycle              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. UPDATE ENTITY                                             │
│    entity.parentId = parentName || undefined                 │
│    entity.lastModified = timestamp                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity
```

### Get Descendants Flow (Recursive)

```
getDescendants(entityName)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH & FIND ENTITY                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RECURSIVE TRAVERSAL                                       │
│    function collectDescendants(name):                        │
│    ├── children = entities.filter(e => e.parentId === name) │
│    ├── For each child:                                       │
│    │   ├── Add child to results                              │
│    │   └── results.push(...collectDescendants(child.name))   │
│    └── Return results                                        │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity[] (all descendants, depth-first)
```

---

## Compression Operations

### Find Duplicates Flow

```
findDuplicates(threshold=0.8)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUCKET BY TYPE (Optimization)                             │
│    buckets = Map<entityType, Entity[]>                       │
│    └── Only compare entities of same type                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PAIRWISE SIMILARITY (within buckets)                      │
│    For each bucket:                                          │
│    ├── For each pair (e1, e2):                               │
│    │   └── similarity = calculateEntitySimilarity(e1, e2)   │
│    └── If similarity >= threshold → add to duplicate group   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SIMILARITY CALCULATION                                    │
│    score = (nameSim × 0.4) + (typeSim × 0.3)                │
│          + (obsSim × 0.2) + (tagSim × 0.1)                  │
│    ├── nameSim: 1 - levenshtein/maxLen                       │
│    ├── typeSim: 1 if exact match, 0 otherwise               │
│    ├── obsSim: Jaccard(observations1, observations2)         │
│    └── tagSim: Jaccard(tags1, tags2)                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: string[][] (groups of duplicate entity names)
```

### Merge Entities Flow

```
mergeEntities(entityNames, targetName?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATE                                                  │
│    if (entityNames.length < 2) throw InsufficientEntities   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD & FIND ENTITIES                                      │
│    entities = entityNames.map(name => findEntity(name))     │
│    if (any missing) throw EntityNotFoundError               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CREATE MERGED ENTITY                                      │
│    merged = {                                                │
│      name: targetName || entityNames[0],                     │
│      entityType: first.entityType,                           │
│      observations: unique(all observations),                 │
│      tags: unique(all tags),                                 │
│      importance: max(all importances),                       │
│      createdAt: earliest createdAt,                          │
│      lastModified: now()                                     │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. TRANSFER RELATIONS                                        │
│    For each relation involving merged entities:              │
│    ├── Update 'from' to point to merged entity              │
│    └── Update 'to' to point to merged entity                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. REMOVE ORIGINAL ENTITIES                                  │
│    graph.entities = entities.filter(e =>                     │
│      !entityNames.includes(e.name) || e.name === merged.name │
│    )                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity (merged entity)
```

---

## Import/Export Operations

### Export Flow

```
exportGraph(format, options?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. GET GRAPH DATA                                            │
│    if (options.filter) {                                     │
│      graph = searchByDateRange(filter params)                │
│    } else {                                                  │
│      graph = loadGraph()                                     │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FORMAT CONVERSION                                         │
│    switch (format):                                          │
│    ├── 'json'     → JSON.stringify(graph, null, 2)          │
│    ├── 'csv'      → entities CSV + relations CSV             │
│    ├── 'graphml'  → XML graph format                         │
│    ├── 'gexf'     → Gephi exchange format                    │
│    ├── 'dot'      → Graphviz DOT                             │
│    ├── 'markdown' → Human-readable MD                        │
│    └── 'mermaid'  → Mermaid diagram syntax                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. OPTIONAL COMPRESSION                                      │
│    if (options.compress) {                                   │
│      content = brotliCompress(content)                      │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: string (formatted export)
```

### Import Flow

```
importGraph(format, data, options?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PARSE INPUT                                               │
│    switch (format):                                          │
│    ├── 'json'    → JSON.parse(data)                         │
│    ├── 'csv'     → parseCSV(data)                           │
│    └── 'graphml' → parseXML(data)                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. VALIDATE PARSED DATA                                      │
│    Validate entities and relations against schemas           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LOAD EXISTING GRAPH                                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. APPLY MERGE STRATEGY                                      │
│    For each imported entity:                                 │
│    ├── 'replace' → overwrite if exists                      │
│    ├── 'skip'    → ignore if exists                         │
│    ├── 'merge'   → combine observations/tags                │
│    └── 'fail'    → error if any conflict                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST (unless dryRun)                                   │
│    if (!dryRun) storage.saveGraph(mergedGraph)              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: ImportResult {
     entitiesCreated, entitiesUpdated, entitiesSkipped,
     relationsCreated, relationsSkipped, errors
   }
```

---

## Agent Memory Operations

### Session Lifecycle Flow

```
startSession(options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. GENERATE SESSION ID                                       │
│    sessionId = generateUniqueId()                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CREATE SESSION ENTITY                                     │
│    SessionEntity = {                                         │
│      name: sessionId,                                        │
│      entityType: 'session',                                  │
│      memoryType: 'episodic',                                 │
│      status: 'active',                                       │
│      startedAt: timestamp,                                   │
│      goalDescription: options.goal                           │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PERSIST SESSION                                           │
│    entityManager.createEntities([sessionEntity])             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: SessionEntity
```

### Working Memory Flow

```
addWorkingMemory(sessionId, content, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATE SESSION                                          │
│    if (!sessionExists(sessionId)) throw SessionNotFoundError │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CREATE AGENT ENTITY                                       │
│    AgentEntity = {                                           │
│      name: generateId(),                                     │
│      entityType: 'working_memory',                           │
│      memoryType: 'working',                                  │
│      sessionId: sessionId,                                   │
│      observations: [content],                                │
│      expiresAt: now + ttlHours,                              │
│      accessCount: 0,                                         │
│      confidence: options.confidence || 0.5,                  │
│      visibility: 'private'                                   │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PERSIST & RETURN                                          │
│    entityManager.createEntities([agentEntity])               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: AgentEntity
```

### Memory Decay Flow

```
DecayScheduler.runDecayCycle()
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD ALL AGENT ENTITIES                                   │
│    entities = getAllAgentEntities()                          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FOR EACH ENTITY: CALCULATE DECAY                          │
│    For each entity:                                          │
│    ├── age = now - lastAccessedAt                            │
│    ├── decayFactor = e^(-ln(2) × age / halfLife)            │
│    ├── strengthMultiplier = 1 + (confirmations × 0.1)       │
│    └── effectiveImportance = base × decay × strength        │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. UPDATE IMPORTANCE VALUES                                  │
│    For entities where importance changed significantly:      │
│    └── entityManager.setImportance(name, newImportance)     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ARCHIVE WEAK MEMORIES                                     │
│    if (effectiveImportance < forgetThreshold):               │
│    └── archiveManager.archiveEntities({ names: [entity] })   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: DecayResult { processed, archived, averageDecay }
```

### Context-Aware Retrieval Flow

```
retrieveForContext(options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. GATHER CANDIDATES                                         │
│    candidates = []                                           │
│    ├── Add working memory (current session)                  │
│    ├── Add recent episodic (last N sessions)                 │
│    ├── Add semantically similar (embedding search)           │
│    └── Add graph neighbors (related entities)                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CALCULATE SALIENCE SCORES                                 │
│    For each candidate:                                       │
│      salience = (                                            │
│        baseImportance × decayFactor +                        │
│        recencyBoost +                                        │
│        frequencyBoost +                                      │
│        contextRelevance +                                    │
│        noveltyBonus                                          │
│      )                                                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PRIORITIZE BY TOKEN BUDGET                                │
│    sorted = candidates.sort((a,b) => b.salience - a.salience)│
│    selected = []                                             │
│    tokensUsed = 0                                            │
│    For each candidate in sorted:                             │
│    ├── tokens = estimateTokens(candidate)                    │
│    ├── if (tokensUsed + tokens <= maxTokens):                │
│    │   └── selected.push(candidate)                          │
│    └── tokensUsed += tokens                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. RECORD ACCESS                                             │
│    For each selected entity:                                 │
│    └── accessTracker.recordAccess(entity.name, context)      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: ContextPackage { memories, totalTokens, excluded }
```

### Consolidation Pipeline Flow

```
consolidateSession(sessionId, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD SESSION MEMORIES                                     │
│    memories = getWorkingMemories(sessionId)                  │
│    Filter by: confidence >= minConfidence                    │
│               confirmations >= minConfirmations              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. GROUP SIMILAR MEMORIES                                    │
│    groups = clusterBySimilarity(memories, threshold)         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. SUMMARIZE EACH GROUP (if options.summarize)               │
│    For each group:                                           │
│    └── summary = summarizationService.summarize(group)       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PROMOTE TO LONG-TERM                                      │
│    For each memory/summary to promote:                       │
│    ├── Update memoryType: 'working' → 'episodic'/'semantic' │
│    ├── Remove expiresAt (permanent)                          │
│    ├── Set promotedAt = timestamp                            │
│    └── Set promotedFrom = sessionId                          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. CLEANUP WORKING MEMORY                                    │
│    Delete original working memory entities                   │
│    (replaced by promoted versions)                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: ConsolidationResult { promoted, summarized, merged }
```

### Multi-Agent Memory Flow

```
createAgentMemory(agentId, entityData)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATE AGENT                                            │
│    if (!agentRegistered(agentId)) throw AgentNotFoundError   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. ENRICH ENTITY WITH AGENT METADATA                         │
│    entity = {                                                │
│      ...entityData,                                          │
│      agentId: agentId,                                       │
│      visibility: entityData.visibility || 'private',         │
│      source: {                                               │
│        agentId, timestamp, method: 'observed',               │
│        reliability: agent.trustLevel                         │
│      }                                                       │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CHECK FOR CONFLICTS                                       │
│    existing = findSimilarMemories(entity)                    │
│    if (existing.length > 0 && conflicts(entity, existing)):  │
│    └── entity = resolveConflict([entity, ...existing],      │
│                                 config.conflictStrategy)     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PERSIST                                                   │
│    entityManager.createEntities([entity])                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: AgentEntity
```

---

## Graph-Connectivity Signal Flow

All four consumers below share a single cached `GraphRankPrior` instance per `ManagerContext` (`ctx.graphRankPrior`) rather than each recomputing PageRank independently. Every knob defaults to `0`/off — when unset, `GraphRankPrior` is never constructed and behavior is byte-for-byte identical to before the feature existed.

```
GraphRankPrior (wraps GraphTraversal)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. FIRST SCORE ACCESS (getScores / getPageRank / getDegree)  │
│    ├── cache hit? → return cached ConnectivityCache          │
│    └── cache miss/stale → compute():                         │
│        ├── calculateDegreeCentrality('both', 0) — O(V + E)   │
│        ├── if entityCount <= maxPageRankEntities (50,000):    │
│        │     calculatePageRank(dampingFactor=0.85)            │
│        │   else: skip PageRank, use degree as the signal       │
│        └── minMaxNormalize(pageRank ?? degree) → [0, 1]        │
└─────────────────────────────────────────────────────────────┘
      │
      ▼ (normalized scores feed four independent, opt-in consumers)
┌─────────────────────────────────────────────────────────────┐
│ RankedSearch.setGraphPrior(prior, boost)                      │
│   score × (1 + boost × normalizedPageRank)                     │
│   Env: MEMORY_RANKED_GRAPH_BOOST (default 0)                   │
├─────────────────────────────────────────────────────────────┤
│ HybridScorer graph channel (HybridSearchManager)               │
│   combined += graphScore × effectiveWeights.graph               │
│   matchedLayers includes 'graph' when it contributed            │
│   Env: MEMORY_HYBRID_GRAPH_WEIGHT (default 0)                   │
│   expandNeighbors: one-hop neighbors added at damping 0.3 ×      │
│   parent's combined score                                       │
├─────────────────────────────────────────────────────────────┤
│ SalienceEngine connectivity boost                               │
│   weighted sum += connectivityWeight × normalizedDegree          │
│   (other weights are NOT renormalized)                          │
│   Env: MEMORY_SALIENCE_CONNECTIVITY_WEIGHT /                    │
│        AGENT_MEMORY_SALIENCE_CONNECTIVITY_WEIGHT (default 0)    │
├─────────────────────────────────────────────────────────────┤
│ DecayEngine connectivity protection (legacy decay path only)    │
│   effectiveDecayFactor = decayFactor +                           │
│     (1 − decayFactor) × connectivityProtection × normalizedDegree│
│   Requires a degree snapshot — refreshed by batch decay ops       │
│   or refreshConnectivitySnapshot()                                │
│   Env: MEMORY_DECAY_CONNECTIVITY_PROTECTION /                    │
│        AGENT_MEMORY_DECAY_CONNECTIVITY_PROTECTION (default 0)    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. INVALIDATION (event-driven, both storage backends)         │
│    GraphEventEmitter: entity:created/updated/deleted,          │
│    relation:created/deleted, graph:saved → prior.invalidate()  │
│    └── Next access recomputes lazily; concurrent callers        │
│        share one in-flight computation                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Caching Strategy

### GraphStorage Cache Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     loadGraph()                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │  cache !== null ?     │
              └───────────┬───────────┘
                    ╱           ╲
                 YES              NO
                  │                │
                  ▼                ▼
         ┌────────────────┐  ┌────────────────────┐
         │ Return deep    │  │ Read from disk     │
         │ copy of cache  │  │ Parse JSONL        │
         └────────────────┘  │ Populate cache     │
                             │ Return deep copy   │
                             └────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     saveGraph()                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Write to disk         │
              │ (JSONL format)        │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Invalidate cache      │
              │ cache = null          │
              └───────────────────────┘
```

### Cache Characteristics

| Aspect | Behavior |
|--------|----------|
| Cache Population | On first `loadGraph()` call |
| Cache Invalidation | On every `saveGraph()` call |
| Deep Copy | Always returns deep copy (prevents mutation) |
| Memory Impact | Full graph held in memory |

### Multi-Layered Caching

| Cache | Purpose | Eviction | TTL |
|-------|---------|----------|-----|
| GraphStorage Cache | Full graph in-memory | Write invalidation | None |
| SearchCache | Search results (basic/ranked/boolean/fuzzy) | LRU (500 max) | 5 min |
| EmbeddingCache | Vector embeddings | LRU (1000 max) | 1 hour |
| CompressedCache | Archived entities with Brotli compression | Adaptive | 5 min uncompressed |
| QueryPlanCache | Query analysis & execution plans | LRU (1000 max) | 5 min |

All caches use `>=` for TTL expiration checks (not `>`) to avoid boundary issues on Windows timer resolution.

---

## Index Architecture

O(1) lookup indexes maintained by the storage layer for fast access:

```
┌─────────────────────────────────────────────────────────────┐
│ NameIndex                                                    │
│   Map<string, Entity>                                        │
│   └── Direct entity lookup by name                           │
├─────────────────────────────────────────────────────────────┤
│ TypeIndex                                                    │
│   Map<string, Entity[]> (case-insensitive keys)              │
│   └── All entities of a given type                           │
├─────────────────────────────────────────────────────────────┤
│ LowercaseCache                                               │
│   Map<string, string> (name → lowercased name)               │
│   └── Pre-computed lowercase strings for search matching     │
├─────────────────────────────────────────────────────────────┤
│ RelationIndex                                                │
│   fromIndex: Map<string, Relation[]>                         │
│   toIndex:   Map<string, Relation[]>                         │
│   └── Relations by source/target entity name                 │
├─────────────────────────────────────────────────────────────┤
│ ObservationIndex (OptimizedInvertedIndex)                     │
│   Map<keyword, Set<entityName>>                              │
│   └── Inverted index mapping keywords to entity names        │
│   └── Maintained by IncrementalIndexer on mutations          │
└─────────────────────────────────────────────────────────────┘
```

Indexes are rebuilt on `loadGraph()` and incrementally updated on mutations via `GraphEventEmitter`.

---

## Error Handling Flow

### Error-Signalling Contract (v2.0.0)

As of v2.0.0 the codebase has one documented error-signalling policy
(`CONTRIBUTING.md` > Error Handling); the flows below should be read
against it:

- **`throw`** — for *programmer errors*: bad arguments, invariant
  violations, "this should never happen" states. These use the custom
  error classes below and propagate to the application as exceptions.
- **`return Result<T, E>`** — for *expected domain failures* the caller is
  meant to branch on. `Result<T, E>` (`src/types/result.ts`) is a
  discriminated union (`ok`/`err`/`isOk`/`isErr`/`unwrap`/`unwrapOr`/`mapOk`);
  the caller narrows with a plain `if (result.ok)`. Existing discriminated
  returns (`MarkResolvedResult`, `CancelResult`, `ArchiveReflectionResult`)
  follow the same spirit.
- **Never swallow silently** — a failure that can't be handled is at least
  re-emitted on an error channel (`logger`, a `StageResult.errors[]` entry,
  an event). Deliberate fire-and-forget discards carry an `eslint-disable`
  with a reason (see `memoryjs/no-unused-updateentity-return`).
- **Absent-value sentinel is `T | undefined`**, never `T | null`.

### Error Class Hierarchy

All errors extend `KnowledgeGraphError` (base class) with an `ErrorCode` enum:

```
KnowledgeGraphError (base)
├── EntityNotFoundError         (Validation)
├── RelationNotFoundError       (Validation)
├── DuplicateEntityError        (Validation)
├── ValidationError             (Validation)
├── CycleDetectedError          (Validation)
├── InvalidImportanceError      (Validation)
├── InsufficientEntitiesError   (Validation)
├── FileOperationError          (Storage)
├── ImportError                 (Storage)
├── ExportError                 (Storage)
└── OperationCancelledError     (Operation)
```

**ErrorCode enum categories**: Validation, Storage, Search, Configuration, Operation.

### Error Propagation

```
┌─────────────────────────────────────────────────────────────┐
│ Manager Layer Errors                                         │
│ ├── ValidationError (invalid input / Zod schema failure)     │
│ ├── EntityNotFoundError (missing entity)                     │
│ ├── RelationNotFoundError (missing relation)                 │
│ ├── DuplicateEntityError (name collision)                    │
│ ├── InvalidImportanceError (out of 0-10 range)               │
│ ├── CycleDetectedError (hierarchy cycle)                     │
│ ├── InsufficientEntitiesError (merge < 2)                   │
│ └── OperationCancelledError (cancelled transaction)          │
├─────────────────────────────────────────────────────────────┤
│ Storage Layer Errors                                         │
│ ├── FileOperationError (disk read/write failures)            │
│ ├── ImportError (parse/validation failures during import)    │
│ └── ExportError (serialization/write failures during export) │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Error propagates to application                              │
│ Application handles or re-throws                             │
└─────────────────────────────────────────────────────────────┘
```

### Validation Error Details

```typescript
// Zod validation provides detailed error paths
{
  "errors": [
    "entities.0.name: Required",
    "entities.0.entityType: String must contain at least 1 character",
    "entities.2.importance: Number must be less than or equal to 10"
  ]
}
```

---

## Batch Mutation Delta Flow (S2)

Manager mutations (`EntityManager.createEntities`/`updateEntity`/`batchUpdate`/`deleteEntities`, `RelationManager.createRelations`/`deleteRelations`) persist via targeted delta primitives instead of `loadGraph()` + mutate-in-memory + `saveGraph()` of the entire graph:

```
createEntities(entities)  [example — same shape for update/delete/relation paths]
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. ACQUIRE graphMutex                                        │
│    Prevents a TOCTOU race between the read-only validation   │
│    snapshot below and the delta write.                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. READ-ONLY SNAPSHOT (validation only)                       │
│    storage.loadGraph() — used to check duplicates/graph-size  │
│    limits; NOT mutated and NOT the thing that gets persisted  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. VALIDATE + GOVERNANCE (if wired — see the flow below)      │
│    Schema validation, importance range, governance canCreate  │
│    consulted for every new entity BEFORE the write (one       │
│    denial blocks the whole batch atomically)                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. DELTA WRITE (one fsync / one SQLite transaction)            │
│    storage.appendEntities(newEntities)                         │
│    JSONL: appends new lines to the file (no full rewrite)      │
│    SQLite: single INSERT-per-row transaction                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EMIT PER-ITEM EVENTS                                       │
│    entity:created fired once per created entity — NOT          │
│    graph:saved. Derived views (TF-IDF sync, GraphRankPrior)    │
│    receive a targeted invalidation instead of a "resync        │
│    everything" signal.                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. RELEASE graphMutex; fire audit hooks (if governed)          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity[]
```

`graph:saved` is now reserved for true full-graph writes — explicit `saveGraph` callers (import/restore, `TransactionManager`, legacy bulk paths) and the JSONL backend's internal compaction/rename rewrites. See the `GraphEventEmitter` module JSDoc (`src/core/GraphEventEmitter.ts`) for the exhaustive event contract. This closes the root cause behind several previously-documented staleness issues: `GraphRankPrior`, TF-IDF sync, and search-result caches used to only see batch mutations via the coarse `graph:saved` signal (or not at all, if they only subscribed to per-item events).

---

## Governance-Enforced Mutation Flow (Sec1)

Applies only when `MEMORY_GOVERNANCE_ENABLED === 'true'` (strict literal, checked once at first `ctx.entityManager` access). Unset = this flow does not run at all — zero overhead, identical to pre-Sec1 behavior.

```
ctx.entityManager (first access, env var == 'true')
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. ManagerContext builds ctx.governanceManager (if not yet    │
│    built) and calls entityManager.setGovernanceHooks({         │
│      canCreate:  entity          => gov.getPolicy().canCreate?.(entity)  ?? true, │
│      canUpdate:  (entity, patch) => gov.getPolicy().canUpdate?.(entity, patch) ?? true, │
│      canDelete:  entity          => gov.getPolicy().canDelete?.(entity)  ?? true, │
│      audit:      event           => gov.appendAudit({ ...event, status: 'committed' }), │
│    })                                                          │
│    Policy is read LIVE via getPolicy() — a setPolicy() call    │
│    after construction takes effect on the next mutation.       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼  (every subsequent createEntities/updateEntity/batchUpdate/deleteEntities/renameEntity call)
┌─────────────────────────────────────────────────────────────┐
│ 2. PRE-MUTATION POLICY CHECK (before any write)                │
│    For every entity in the batch: canCreate / canUpdate /      │
│    canDelete consulted. A single denial throws                 │
│    GovernanceError and blocks the ENTIRE batch atomically       │
│    (matches the delta write's all-or-nothing semantics) —       │
│    nothing in the batch is written.                             │
└─────────────────────────────────────────────────────────────┘
      │ (all checks passed)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. DELTA WRITE (Batch Mutation Delta Flow, above)               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FIRE-AND-FORGET AUDIT                                        │
│    audit(event) → GovernanceManager.appendAudit → AuditLog.append│
│    Applies redactAuditSnapshots (Sec6, opt-in) to before/after   │
│    snapshots if configured. Failure here is logged as a          │
│    warning and NEVER rolls back or fails the write that already  │
│    succeeded — the write and the audit are decoupled.            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: normal mutation result (or throws GovernanceError pre-write)
```

Contrast with `GovernanceManager.withTransaction()` (unchanged, still available): that path snapshots the whole graph up front and rolls back to the snapshot on any exception inside the callback — a heavier, opt-in mechanism for callers who want full rollback semantics rather than per-mutation policy gating.

---

## Ingest-with-Provenance Flow (R4b/R5)

```
ctx.ioManager.ingest(input, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. NORMALIZE INPUT                                              │
│    Raw transcript text / { messages } / ChatMessage[]           │
│    → chunked via _chunkMessages (chunkBy: exchange|paragraph|fixed)│
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PER CHUNK: DEDUP CHECK                                       │
│    SHA-256 of the chunk's rendered text vs. existing entities'  │
│    contentHash / observation hash — skip if already ingested    │
│    (result.skippedDuplicates++), no tokens spent on skips        │
└─────────────────────────────────────────────────────────────┘
      │ (new chunk)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. R5 MODE DIAL (only if options.llmProvider is set)            │
│    'lightweight' → heuristic-only (LLM never called)             │
│    'balanced'    → auto (default, = pre-R5 behaviour)            │
│    'accurate'    → llm-preferred; heuristicStrictness: 'strict'  │
│                    when no options.validate hook is supplied     │
│    MemoryDistiller.distill(turns) → extra [distilled] … lines    │
│    + tokenUsage accounting (exact when the provider reports it,  │
│    chars/4 approximate otherwise)                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CREATE CHUNK ENTITY (unless dryRun)                          │
│    em.createEntities([{                                          │
│      name: '<source>-<NNN>', observations: [...raw, ...distilled],│
│      contentHash: <chunk SHA-256>,     // dedup on re-ingest      │
│      observationMeta: [{ content, recordedAt, sourceRef: chunkId }]│
│    }])                                                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼ (after all chunks processed)
┌─────────────────────────────────────────────────────────────┐
│ 5. WRITE MANIFEST + DERIVED_FROM RELATIONS (unless dryRun)      │
│    em.createEntities([{ name: 'ingest-<id>', entityType:         │
│      'ingest-manifest', observations: manifestLines }])          │
│    manifestLines[i] = '[chunk]: ' + JSON.stringify(               │
│      { id, source, offset, length, hash[, text if keepSourceText] })│
│    rm.createRelations(createdEntities.map(e => ({ from: e.name,  │
│      to: manifestEntity, relationType: 'derived_from' })))        │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. ACCURATE-MODE VALIDATION (only if mode==='accurate' &&       │
│    options.validate && !dryRun)                                  │
│    result.validation = await options.validate({ ingestId,        │
│      manifestEntity, entities: createdEntities,                  │
│      relations: createdRelations })                              │
│    Never mutates — purely a feedback report on result.validation.│
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: IngestResult { entitiesCreated, observationsAdded,
     skippedDuplicates, entityNames, ingestId, manifestEntity,
     chunkCount, tokenUsage?, validation? }
```

The manifest + `derived_from` relations + per-observation `sourceRef` together let evidence paths extend `answer → relation → observation → source chunk` — see [Explain Evidence-Path Flow](#explain-evidence-path-flow-r2) below for how a search result traces back to its anchors.

---

## Explain Evidence-Path Flow (R2)

Applies only when a caller passes `explain: true` to `HybridSearchManager.search` or `LLMSearchExecutor.execute`. Omitting it is byte-identical to pre-R2 output — `EvidencePathBuilder` is never constructed.

```
search(query, { explain: true })
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. RUN NORMAL HYBRID SEARCH                                     │
│    Semantic / lexical / symbolic (+ opt-in graph) layers        │
│    execute exactly as without explain; each layer's direct       │
│    matches become that result's "anchors" (EvidenceAnchor:        │
│    { name, viaLayer, score })                                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUILD ADJACENCY INDEX (once per search call)                 │
│    new EvidencePathBuilder(graph, { maxDepth, maxPathsPerResult})│
│    One pass over graph.relations; self-loops excluded             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PER RESULT: BOUNDED BFS FROM EACH ANCHOR                      │
│    builder.buildForResult(resultName, anchors)                   │
│    ├── Dedupe anchors by name (first occurrence wins);            │
│    │   try in descending score order                               │
│    ├── Anchor === result → trivial single-node path                │
│    ├── Otherwise: BFS over the undirected projection of the        │
│    │   graph (relation direction preserved in output, ignored      │
│    │   for traversal), capped at maxDepth hops (default 3) —       │
│    │   BFS guarantees each returned path is a SHORTEST path        │
│    └── Stop collecting once maxPathsPerResult (default 3) paths    │
│        are found; set truncated: true if anchors remained or       │
│        maxDepth was hit with unexplored frontier                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Result gains: evidencePaths: { paths: EvidencePath[], truncated: boolean }
```

`EvidencePath` entries carry the node sequence, the relations traversed (direction preserved), the originating anchor name, and its `viaLayer`. Evidence paths compose with the ingest provenance chain above — a result whose anchor observation carries `observationMeta.sourceRef` can trace all the way back to the original ingested chunk.

---

## I/O Optimization Summary

| Operation | Read Ops | Write Ops | Total I/O |
|-----------|----------|-----------|-----------|
| create_entities (batch) | 1 | 1 | 2 |
| delete_entities | 1 | 1 | 2 |
| add_observations (batch) | 1 | 1 | 2 |
| search | 1 (cached) | 0 | 1 |
| search_ranked | 1 (cached) | 0 | 1 |
| find_duplicates | 1 (cached) | 0 | 1 |
| merge_entities | 1 | 1 | 2 |
| export_graph | 1 (cached) | 0 | 1 |
| import_graph | 1 | 1 | 2 |

**Key Optimization**: Batch operations use single read/write cycle regardless of batch size.

### Agent Memory I/O Summary

| Operation | Read Ops | Write Ops | Total I/O |
|-----------|----------|-----------|-----------|
| start_session | 1 | 1 | 2 |
| add_working_memory | 1 | 1 | 2 |
| retrieve_for_context | 1 (cached) | 0 | 1 |
| consolidate_session | 1 | 2 | 3 |
| decay_cycle | 1 | 1 | 2 |

**Agent Memory Optimization**: Decay cycles run on configurable intervals to batch importance updates.
