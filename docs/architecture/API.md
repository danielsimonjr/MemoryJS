# MemoryJS — API Reference

Complete reference for the MemoryJS library public API. For a high-level
summary see [README.md](../../README.md); for environment-variable reference
see [CLAUDE.md](../../CLAUDE.md). Per-version changes live in
[CHANGELOG.md](../../CHANGELOG.md) — this document describes the *current*
surface only.

---

## Table of Contents

1. [ManagerContext](#managercontext)
2. [AgentMemoryManager](#agentmemorymanager)
3. [EntityManager](#entitymanager)
4. [RelationManager](#relationmanager)
5. [ObservationManager](#observationmanager)
6. [HierarchyManager](#hierarchymanager)
7. [SearchManager](#searchmanager)
8. [GraphTraversal](#graphtraversal)
9. [IOManager](#iomanager)
10. [TagManager](#tagmanager)
11. [CompressionManager](#compressionmanager)
12. [AnalyticsManager](#analyticsmanager)
13. [ArchiveManager](#archivemanager)
14. [SemanticSearch](#semanticsearch)
15. [ObservationNormalizer](#observationnormalizer)
16. [TransactionManager](#transactionmanager)
17. [BatchTransaction](#batchtransaction)
18. [StorageFactory](#storagefactory)
19. [Types](#types)
20. [BackupManager](#backupmanager) *(v1.15.0 Phase 5)*
21. [MemoryEngine](#memoryengine) *(v1.11.0)*
22. [GovernanceManager](#governancemanager) *(v1.6.0)*
23. [FreshnessManager](#freshnessmanager) *(v1.6.0)*
24. [RbacMiddleware + RoleAssignmentStore](#rbacmiddleware--roleassignmentstore) *(η.6.1)*
25. [ProcedureManager + CausalReasoner + WorldModelManager + ActiveRetrievalController](#proceduremanager--causalreasoner--worldmodelmanager--activeretrievalcontroller) *(3B.4–3B.7)*
26. [IMemoryBackend](#imemorybackend) *(v1.12.0)*
27. [GraphRankPrior + HybridSearchManager](#graphrankprior--hybridsearchmanager) *(v2.9.0)*
28. [EventManager](#eventmanager) *(Unreleased, R1, `@experimental`)*
29. [EvidencePathBuilder](#evidencepathbuilder) *(Unreleased, R2, `@experimental`)*
30. [RelationConsolidator](#relationconsolidator) *(Unreleased, R3, `@experimental`)*
31. [ApiKeyAuthMiddleware](#apikeyauthmiddleware) *(Unreleased, Sec9)*

---

## ManagerContext

Central access point for all managers. Provides lazy-initialized access to all subsystems.

### Constructor

```typescript
new ManagerContext(memoryFilePath: string)
```

**Parameters:**
- `memoryFilePath`: Path to storage file (e.g., `'./memory.jsonl'` or `'./memory.db'`)

Storage backend is selected via the `MEMORY_STORAGE_TYPE` environment variable (`'jsonl'` or `'sqlite'`, default: `'jsonl'`).

**Example:**
```typescript
// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (set MEMORY_STORAGE_TYPE=sqlite)
const ctx = new ManagerContext('./memory.db');
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `entityManager` | `EntityManager` | Entity CRUD operations |
| `relationManager` | `RelationManager` | Relation CRUD operations |
| `observationManager` | `ObservationManager` | Observation operations |
| `hierarchyManager` | `HierarchyManager` | Hierarchy operations |
| `searchManager` | `SearchManager` | Search operations |
| `graphTraversal` | `GraphTraversal` | Graph algorithms |
| `ioManager` | `IOManager` | Import/export |
| `tagManager` | `TagManager` | Tag aliases |
| `compressionManager` | `CompressionManager` | Duplicate detection, merging |
| `archiveManager` | `ArchiveManager` | Entity archival |
| `analyticsManager` | `AnalyticsManager` | Graph statistics, validation |
| `semanticSearch` | `SemanticSearch` | Vector similarity search |
| `accessTracker` | `AccessTracker` | Memory access tracking |
| `decayEngine` | `DecayEngine` | Importance decay |
| `decayScheduler` | `DecayScheduler` | Scheduled decay |
| `salienceEngine` | `SalienceEngine` | Context-aware scoring |
| `contextWindowManager` | `ContextWindowManager` | Token budgeting |
| `memoryFormatter` | `MemoryFormatter` | Output formatting |
| `storage` | `IGraphStorage` | Direct storage access |
| `freshnessManager` | `FreshnessManager` | TTL/confidence freshness reports (v1.6.0) |
| `governanceManager` | `GovernanceManager` | Policy + audit transactions (v1.6.0) |
| `refIndex` | `RefIndex` | Named-reference O(1) lookup (v1.6.0) |
| `semanticForget` | `SemanticForget` | Two-tier deletion with audit (v1.8.0) |
| `temporalSearch` | `TemporalSearch` | NL time-range search (v1.9.0) |
| `procedureManager` | `ProcedureManager` | Procedural memory (3B.4) |
| `causalReasoner` | `CausalReasoner` | Causal find/effects/counterfactual (3B.6) |
| `worldModelManager` | `WorldModelManager` | World-state orchestrator (3B.7) |
| `activeRetrieval` | `ActiveRetrievalController` | Iterative query rewriting (3B.5) |
| `roleAssignmentStore` | `RoleAssignmentStore` | RBAC role grants (η.6.1) |
| `rbacMiddleware` | `RbacMiddleware` | `checkPermission()` policy (η.6.1) |
| `memoryEngine` | `MemoryEngine` | Turn-aware conversation memory + 4-tier dedup (v1.11.0) |
| `memoryBackend` | `IMemoryBackend` | Pluggable backend selector via `MEMORY_BACKEND` (v1.12.0) |
| `compressedEntityCache` | `CompressedMap<string, Entity>` | In-memory compressed entity cache (v1.15.0 Phase 10) |
| `diagnostics` | `Diagnostics` | Query `explainPlan` + index health surface (v1.15.0 Phase 0/1) |
| `graphRankPrior` | `GraphRankPrior` | Cached normalized-PageRank ranking signal, event-invalidated (v2.9.0, `@experimental`) |
| `hybridSearchManager` | `HybridSearchManager` | Semantic + lexical + symbolic (+ optional graph) layered search (v2.9.0) |

### Methods

#### agentMemory

Get the Agent Memory Manager for AI agent memory operations.

```typescript
agentMemory(config?: AgentMemoryConfig): AgentMemoryManager
```

**Parameters:**
```typescript
interface AgentMemoryConfig {
  decay?: {
    enabled?: boolean;
    halfLifeHours?: number;      // Default: 168 (1 week)
    forgetThreshold?: number;    // Default: 0.05
  };
  workingMemory?: {
    defaultTTLHours?: number;    // Default: 24
    maxPerSession?: number;      // Default: 100
  };
  retrieval?: {
    defaultTokenBudget?: number; // Default: 4000
  };
}
```

**Example:**
```typescript
const agentMem = ctx.agentMemory({
  decay: { halfLifeHours: 72 },
  workingMemory: { defaultTTLHours: 48 }
});
```

---

## AgentMemoryManager

Unified facade for AI agent memory operations including sessions, working memory, decay, and context-aware retrieval.

### startSession

Start a new agent session.

```typescript
async startSession(options?: SessionOptions): Promise<SessionEntity>
```

**Parameters:**
```typescript
interface SessionOptions {
  goalDescription?: string;
  taskType?: string;
  previousSessionId?: string;
}
```

**Example:**
```typescript
const session = await agentMem.startSession({
  goalDescription: 'Help user plan a trip to Japan',
  taskType: 'planning'
});
```

### endSession

End an active session.

```typescript
async endSession(sessionId: string): Promise<void>
```

### getActiveSession

Get the currently active session.

```typescript
async getActiveSession(): Promise<SessionEntity | null>
```

### addWorkingMemory

Add a working memory entry to a session.

```typescript
async addWorkingMemory(
  sessionId: string,
  content: string,
  options?: WorkingMemoryOptions
): Promise<AgentEntity>
```

**Parameters:**
```typescript
interface WorkingMemoryOptions {
  ttlHours?: number;
  confidence?: number;          // 0.0-1.0
  importance?: number;          // 0-10
  autoPromote?: boolean;
}
```

**Example:**
```typescript
await agentMem.addWorkingMemory(session.id, 'User prefers budget travel', {
  confidence: 0.9,
  importance: 7
});
```

### getWorkingMemories

Get all working memories for a session.

```typescript
async getWorkingMemories(sessionId: string): Promise<AgentEntity[]>
```

### clearExpiredMemories

Remove expired working memories.

```typescript
async clearExpiredMemories(): Promise<number>
```

**Returns:** Number of memories cleared

### reinforceMemory

Strengthen a memory (reset decay, increase confirmation count).

```typescript
async reinforceMemory(entityName: string): Promise<void>
```

### promoteToLongTerm

Promote a working memory to long-term storage.

```typescript
async promoteToLongTerm(entityName: string): Promise<void>
```

### consolidateSession

Consolidate session memories into long-term storage.

```typescript
async consolidateSession(
  sessionId: string,
  options?: ConsolidateOptions
): Promise<ConsolidationResult>
```

**Parameters:**
```typescript
interface ConsolidateOptions {
  summarize?: boolean;
  minConfidence?: number;
  minConfirmations?: number;
}
```

**Returns:**
```typescript
interface ConsolidationResult {
  memoriesProcessed: number;
  memoriesPromoted: number;
  memoriesMerged: number;
  summariesCreated: number;
}
```

### retrieveForContext

Retrieve memories optimized for LLM context window.

```typescript
async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage>
```

**Parameters:**
```typescript
interface ContextRetrievalOptions {
  maxTokens: number;
  context: SalienceContext;
  includeWorkingMemory?: boolean;
  includeEpisodicRecent?: boolean;
  includeSemanticRelevant?: boolean;
  mustInclude?: string[];
}

interface SalienceContext {
  currentTask?: string;
  currentSession?: string;
  recentEntities?: string[];
  queryText?: string;
  temporalFocus?: 'recent' | 'historical' | 'any';
}
```

**Returns:**
```typescript
interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  breakdown: {
    workingMemory: number;
    episodic: number;
    semantic: number;
  };
  excluded: string[];
}
```

**Example:**
```typescript
const pkg = await agentMem.retrieveForContext({
  maxTokens: 4000,
  context: {
    currentTask: 'Recommend hotels in Tokyo',
    queryText: 'What hotels fit my budget?'
  },
  includeWorkingMemory: true
});
```

### getMostSalient

Get most salient memories for a context.

```typescript
async getMostSalient(
  context: SalienceContext,
  limit: number
): Promise<ScoredEntity[]>
```

**Returns:**
```typescript
interface ScoredEntity {
  entity: AgentEntity;
  salienceScore: number;
  components: {
    baseImportance: number;
    recencyBoost: number;
    frequencyBoost: number;
    contextRelevance: number;
    noveltyBoost: number;
  };
}
```

### start

Start the decay scheduler.

```typescript
start(): void
```

### stop

Stop the decay scheduler.

```typescript
stop(): void
```

---

## EntityManager

Manages entity CRUD operations.

### createEntities

Create one or more entities in the knowledge graph.

```typescript
async createEntities(entities: CreateEntity[]): Promise<Entity[]>
```

**Parameters:**
```typescript
interface CreateEntity {
  name: string;              // Unique identifier (1-500 chars)
  entityType: string;        // Category (1-100 chars)
  observations: string[];    // Descriptions (1-5000 chars each)
  tags?: string[];           // Optional tags (normalized to lowercase)
  importance?: number;       // Optional priority (0-10)
  parentId?: string;         // Optional parent entity name
}
```

**Example:**
```typescript
const entities = await ctx.entityManager.createEntities([
  {
    name: 'Alice',
    entityType: 'person',
    observations: ['Software engineer', 'Works on AI projects'],
    tags: ['team', 'engineering'],
    importance: 8
  }
]);
```

### getEntity

Retrieve a single entity by name. (The O(1) `storage.getEntityByName(name): Entity | undefined`
is the underlying `IGraphStorage` primitive; `EntityManager` exposes `getEntity`.)

```typescript
async getEntity(name: string, options?: GetEntityOptions): Promise<Entity | null>
```

### updateEntity (with Optimistic Concurrency Control)

Update an entity, optionally requiring a specific version (η.5.5.c).

```typescript
async updateEntity(
  name: string,
  updates: Partial<Entity>,
  options?: { expectedVersion?: number }
): Promise<Entity>
```

If `expectedVersion` is supplied and doesn't match the current `version` field on the entity, throws `VersionConflictError`. Used by `MultiAgentMemoryManager` to safely interleave writes from multiple agents.

### invalidateEntity (η.4.4 — Bitemporal Versioning)

Mark an entity as no longer valid by setting `validUntil` (does not delete the entity; `entityAsOf` still returns it for past timestamps). Idempotent — a second call updates the existing `validUntil`.

```typescript
async invalidateEntity(name: string, ended?: string): Promise<void>
```

`ended` is an ISO 8601 timestamp string; defaults to the current time. Throws `EntityNotFoundError` if `name` doesn't exist.

### entityAsOf

Time-travel query — get the version of an entity that was valid at a given timestamp.

```typescript
async entityAsOf(name: string, asOf: string): Promise<Entity | null>
```

`asOf` is an ISO 8601 date string. Throws `ValidationError` if it isn't.

### entityTimeline

Get the chronological version history of an entity (across `invalidateEntity` cascades).

```typescript
async entityTimeline(name: string): Promise<Entity[]>
```

### getAllEntities

Retrieve all entities.

```typescript
async getAllEntities(): Promise<Entity[]>
```

### deleteEntities

Delete one or more entities by name.

```typescript
async deleteEntities(entityNames: string[]): Promise<void>
```

**Notes:**
- Relations involving deleted entities are also removed
- Child entities remain but lose their parent reference

### addTags

Add tags to an entity.

```typescript
async addTags(entityName: string, tags: string[]): Promise<Entity>
```

### removeTags

Remove tags from an entity.

```typescript
async removeTags(entityName: string, tags: string[]): Promise<Entity>
```

### setImportance

Set entity importance score.

```typescript
async setImportance(entityName: string, importance: number): Promise<Entity>
```

**Parameters:**
- `importance`: Integer from 0-10

### addTagsToMultipleEntities

Add tags to multiple entities at once.

```typescript
async addTagsToMultipleEntities(entityNames: string[], tags: string[]): Promise<Entity[]>
```

### replaceTag

Replace a tag across all entities.

```typescript
async replaceTag(oldTag: string, newTag: string): Promise<number>
```

**Returns:** Number of entities updated

### mergeTags

Merge two tags into a target tag.

```typescript
async mergeTags(tag1: string, tag2: string, targetTag: string): Promise<number>
```

### listEntities (v2.9.0)

Public bulk enumeration, replacing the old `entityManager['storage']` private-access pattern.

```typescript
async listEntities(filter?: { entityType?: string }): Promise<Entity[]>
```

When `filter.entityType` is supplied, takes an O(k) `TypeIndex` fast path (`storage.getEntitiesByType`) instead of a full-graph scan.

### renameEntity (v2.9.0)

Atomically rename an entity, rewriting every stored reference to the old name.

```typescript
async renameEntity(oldName: string, newName: string): Promise<Entity>
```

Delegates to the storage-level `renameEntity` primitive (an optional member on `IGraphStorage`; both `GraphStorage` and `SQLiteStorage` implement it). Rewrites `Relation.from`/`Relation.to`, other entities' `parentId`, and version-chain fields (`parentEntityName`, `rootEntityName`, `supersededBy`); remaps `RefIndex` aliases pointing at the old name. The entity's `id`, `createdAt`, and all other fields are preserved; `lastModified` is bumped. `newName` must pass the same validation as `createEntities` (including the reserved `profile-`/`diary-` namespaces).

**Events:** emits `entity:renamed`, then `entity:deleted` (old name), then `entity:created` (renamed entity) — so event listeners that only understand create/delete stay consistent.

**Throws:** `ValidationError` if `newName` is invalid, `EntityNotFoundError` if `oldName` doesn't exist, `DuplicateEntityError` if `newName` already exists.

**Example:**
```typescript
const renamed = await ctx.entityManager.renameEntity('Alice', 'Alice Smith');
```

---

## RelationManager

Manages relation CRUD operations.

### createRelations

Create one or more relations between entities.

```typescript
async createRelations(relations: CreateRelation[]): Promise<Relation[]>
```

**Parameters:**
```typescript
interface CreateRelation {
  from: string;           // Source entity name
  to: string;             // Target entity name
  relationType: string;   // Relation type (1-100 chars)
}
```

**Notes:**
- Deferred integrity: entities don't need to exist
- Duplicate relations are filtered out

**Example:**
```typescript
await ctx.relationManager.createRelations([
  { from: 'Alice', to: 'Project_X', relationType: 'works_on' },
  { from: 'Alice', to: 'Bob', relationType: 'knows' }
]);
```

### getRelations

Get all relations for an entity.

```typescript
async getRelations(entityName: string): Promise<Relation[]>
```

### deleteRelations

Delete specific relations.

```typescript
async deleteRelations(relations: Relation[]): Promise<void>
```

### getAllRelations

Get all relations in the graph.

```typescript
async getAllRelations(): Promise<Relation[]>
```

### invalidateRelation (v1.9.0 — Temporal Validity)

Mark the active (non-terminated) relation matching `from`/`relationType`/`to` as ended, by setting `properties.validUntil` (without deleting it).

```typescript
async invalidateRelation(
  from: string,
  relationType: string,
  to: string,
  ended?: string   // ISO 8601 timestamp; defaults to current time
): Promise<void>
```

Throws `RelationNotFoundError` if no active relation matches.

### queryAsOf (v1.9.0 — Time-Travel Queries)

Get all relations involving an entity that were valid at a given timestamp.

```typescript
async queryAsOf(
  entityName: string,
  asOf: string,   // ISO 8601 date string
  options?: { direction?: 'outgoing' | 'incoming' | 'both' }  // default 'both'
): Promise<Relation[]>
```

### timeline (v1.9.0 — Chronological History)

Return all relations involving an entity sorted chronologically by `properties.validFrom` (unbounded relations last).

```typescript
async timeline(
  entityName: string,
  options?: { direction?: 'outgoing' | 'incoming' | 'both' }  // default 'both'
): Promise<Relation[]>
```

---

## ObservationManager

Manages entity observations.

### addObservations

Add observations to entities.

```typescript
async addObservations(additions: ObservationAddition[]): Promise<ObservationResult[]>
```

**Parameters:**
```typescript
interface ObservationAddition {
  entityName: string;
  contents: string[];
}
```

**Example:**
```typescript
await ctx.observationManager.addObservations([
  { entityName: 'Alice', contents: ['Promoted to senior engineer'] }
]);
```

### deleteObservations

Remove observations from entities.

```typescript
async deleteObservations(deletions: ObservationDeletion[]): Promise<ObservationResult[]>
```

### invalidateObservation (η.4.4 — Bitemporal Axis)

Mark a specific observation (matched by its content string) as no longer valid at a given point in time, without removing it from the entity's `observations[]`. Adds an `observationMeta[]` entry recording the boundary.

```typescript
async invalidateObservation(
  entityName: string,
  content: string,
  ended?: string   // ISO 8601 timestamp; defaults to current time
): Promise<void>
```

### observationsAsOf (η.4.4 — Time-Travel)

Return the observations that were valid for an entity at a given timestamp.

```typescript
async observationsAsOf(entityName: string, asOf: string): Promise<string[]>
```

`asOf` is an ISO 8601 date string.

---

## HierarchyManager

Manages parent-child entity relationships.

### setEntityParent

Set or remove an entity's parent.

```typescript
async setEntityParent(entityName: string, parentName: string | null): Promise<Entity>
```

**Notes:**
- Pass `null` to remove parent
- Throws `CycleDetectedError` if would create cycle

### getChildren

Get direct children of an entity.

```typescript
async getChildren(entityName: string): Promise<Entity[]>
```

### getParent

Get parent of an entity.

```typescript
async getParent(entityName: string): Promise<Entity | null>
```

### getAncestors

Get all ancestors (parent chain to root).

```typescript
async getAncestors(entityName: string): Promise<Entity[]>
```

### getDescendants

Get all descendants (recursive children).

```typescript
async getDescendants(entityName: string): Promise<Entity[]>
```

### getSubtree

Get entity and all descendants with their relations.

```typescript
async getSubtree(entityName: string): Promise<KnowledgeGraph>
```

### getRootEntities

Get all entities without parents.

```typescript
async getRootEntities(): Promise<Entity[]>
```

### getEntityDepth

Get depth in hierarchy (0 = root).

```typescript
async getEntityDepth(entityName: string): Promise<number>
```

### moveEntity

Move entity to new parent.

```typescript
async moveEntity(entityName: string, newParentName: string | null): Promise<Entity>
```

---

## SearchManager

Provides multiple search strategies.

### searchNodes

Basic text search across entities.

```typescript
async searchNodes(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
```

**Parameters:**
```typescript
interface SearchOptions {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityTypes?: string[];
  limit?: number;
  offset?: number;
}
```

**Example:**
```typescript
const results = await ctx.searchManager.searchNodes('TypeScript', {
  tags: ['programming'],
  minImportance: 5
});
```

### searchNodesRanked

TF-IDF relevance-ranked search.

```typescript
async searchNodesRanked(query: string, options?: RankedSearchOptions): Promise<SearchResult[]>
```

### openNodes

Retrieve specific entities by name with their relations.

```typescript
async openNodes(names: string[]): Promise<KnowledgeGraph>
```

### searchByDateRange

Search entities by creation/modification date.

```typescript
async searchByDateRange(options: DateRangeOptions): Promise<KnowledgeGraph>
```

### booleanSearch

Boolean query search with AND/OR/NOT operators.

```typescript
async booleanSearch(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
```

**Query Syntax:**
- `AND`: Both terms must match
- `OR`: Either term must match
- `NOT`: Term must not match
- `()`: Grouping
- `field:value`: Field-specific search

**Examples:**
```typescript
await ctx.searchManager.booleanSearch('Alice AND Bob');
await ctx.searchManager.booleanSearch('name:Alice OR type:person');
await ctx.searchManager.booleanSearch('NOT archived AND (project OR task)');
```

### fuzzySearch

Typo-tolerant search using Levenshtein distance.

```typescript
async fuzzySearch(query: string, options?: FuzzySearchOptions): Promise<KnowledgeGraph>
```

**Parameters:**
```typescript
interface FuzzySearchOptions extends SearchOptions {
  threshold?: number;  // 0.0-1.0, default 0.7
}
```

### autoSearch

Automatically select and execute the best search method based on query characteristics.

```typescript
async autoSearch(query: string, limit?: number): Promise<SmartSearchResult>
```

### getSearchSuggestions

Get "did you mean" suggestions.

```typescript
async getSearchSuggestions(query: string, limit?: number): Promise<string[]>
```

### getSearchCostEstimates

Get cost estimates for a query across search strategies.

```typescript
async getSearchCostEstimates(query: string): Promise<CostEstimate[]>
```

### Saved Search Methods

```typescript
async getSavedSearch(name: string): Promise<SavedSearch | null>
async deleteSavedSearch(name: string): Promise<boolean>
async updateSavedSearch(name: string, updates: Partial<SavedSearch>): Promise<SavedSearch>
```

### Cache Management

```typescript
clearAllCaches(): void
clearFuzzyCache(): void
clearBooleanCache(): void
clearRankedCache(): void
```

### searchByTime (v1.9.0 — Temporal Search)

Natural-language time-range search via `chrono-node`.

```typescript
async searchByTime(query: string, options?: TemporalSearchOptions): Promise<KnowledgeGraph>
```

Accepts expressions like `"last hour"`, `"yesterday"`, `"between Jan 1 and Feb 1"`. See also `ctx.temporalSearch` for the lower-level `TemporalSearch` instance.

### autoSearch (BM25-incremental, v1.15.0 Phase 1)

Auto-selects the best search strategy for the query (basic / boolean / fuzzy / ranked / semantic / hybrid). BM25 indexing is now incremental — single-entity creates and updates touch only the affected postings list instead of rebuilding the full corpus.

```typescript
async autoSearch(query: string, options?: SearchOptions): Promise<{
  results: SearchResult[];
  selectedMethod: string;
  selectionReason: string;
}>
```

### Diagnostics (Phase 0/1, v1.15.0)

```typescript
ctx.diagnostics.explainPlan(query: string): QueryPlanExplanation
ctx.diagnostics.indexHealth(): IndexHealthReport
```

`explainPlan` returns the resolved query AST + which indexes would be hit + cost estimate. `indexHealth` reports the fill rate, fragmentation, and last-rebuild timestamp for each index.

---

## GraphTraversal

Graph algorithms and traversal operations.

### findShortestPath

Find shortest path between two entities using Dijkstra's algorithm.

```typescript
async findShortestPath(source: string, target: string, options?: PathOptions): Promise<PathResult | null>
```

**Parameters:**
```typescript
interface PathOptions {
  maxDepth?: number;       // Maximum path length (default: 5)
  direction?: 'outgoing' | 'incoming' | 'both';
  relationTypes?: string[];  // Filter by relation types
}
```

**Returns:**
```typescript
interface PathResult {
  path: string[];        // Entity names in order
  relations: Relation[]; // Relations along the path
  length: number;
}
```

### findAllPaths

Find all paths between two entities up to a maximum depth.

```typescript
async findAllPaths(source: string, target: string, options?: PathOptions): Promise<PathResult[]>
```

### Centrality Methods

Three separate methods for centrality calculation:

```typescript
async calculateDegreeCentrality(direction?: 'in' | 'out' | 'both', topN?: number): Promise<CentralityResult[]>
async calculateBetweennessCentrality(options?: { approximate?: boolean; sampleRate?: number; topN?: number }): Promise<CentralityResult[]>
async calculatePageRank(dampingFactor?: number, maxIterations?: number, tolerance?: number, topN?: number): Promise<CentralityResult[]>
```

**Returns:**
```typescript
interface CentralityResult {
  entity: string;
  score: number;
}
```

### getConnectedComponents

Find connected components in the graph.

```typescript
async findConnectedComponents(): Promise<ConnectedComponentsResult>
```

**Returns:**
```typescript
interface ConnectedComponentsResult {
  components: string[][];
  count: number;
  largestComponentSize: number;
}
```

### bfs / dfs

Breadth-first and depth-first traversal.

```typescript
async bfs(startEntity: string, options?: TraversalOptions): Promise<TraversalResult>
async dfs(startEntity: string, options?: TraversalOptions): Promise<TraversalResult>
```

**Returns:**
```typescript
interface TraversalResult {
  visited: string[];
  edges: Relation[];
}
```

### getNeighborsWithRelations

Get all neighbors of an entity with their connecting relations.

```typescript
async getNeighborsWithRelations(entityName: string, options?: { direction?: 'in' | 'out' | 'both' }): Promise<NeighborResult[]>
```

### HITS Algorithm (v1.15.0 Phase 1)

Hyperlink-Induced Topic Search — computes `hub` and `authority` scores for every entity. Useful for identifying high-quality information sources (high authority) vs. broad connectors (high hub).

```typescript
async hits(options?: { maxIterations?: number; tolerance?: number }): Promise<Map<string, { hub: number; authority: number }>>
```

### Clique Enumeration (v1.15.0 Phase 1)

Enumerate maximal cliques in the (undirected projection of the) graph via Bron–Kerbosch with pivot selection.

```typescript
async findMaximalCliques(options?: { minSize?: number; maxCliques?: number }): Promise<string[][]>
```

### Louvain Community Detection (v1.15.0 Phase 1)

Greedy modularity-optimization community detection. Returns each entity's community ID.

```typescript
async louvainCommunities(options?: { resolution?: number; maxIterations?: number }): Promise<Map<string, number>>
```

---

## IOManager

Import, export, and backup operations.

### exportGraph

Export graph to various formats.

```typescript
async exportGraph(format: ExportFormat, options?: ExportOptions): Promise<string>
```

**Parameters:**
```typescript
type ExportFormat = 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid';

interface ExportOptions {
  filter?: {
    entityTypes?: string[];
    tags?: string[];
    minImportance?: number;
    createdAfter?: string;
    createdBefore?: string;
  };
  compress?: boolean;  // Brotli compression
  outputPath?: string; // Write to file
}
```

**Example:**
```typescript
// Export to JSON
const json = await ctx.ioManager.exportGraph('json');

// Export filtered graph to compressed GraphML
await ctx.ioManager.exportGraph('graphml', {
  filter: { tags: ['project'] },
  compress: true,
  outputPath: './projects.graphml.br'
});
```

### importGraph

Import graph from various formats.

```typescript
async importGraph(
  format: 'json' | 'csv' | 'graphml',
  data: string,
  options?: ImportOptions
): Promise<ImportResult>
```

**Parameters:**
```typescript
interface ImportOptions {
  mergeStrategy?: 'replace' | 'skip' | 'merge' | 'fail';
  dryRun?: boolean;
}
```

**Returns:**
```typescript
interface ImportResult {
  entitiesCreated: number;
  entitiesUpdated: number;
  entitiesSkipped: number;
  relationsCreated: number;
  relationsSkipped: number;
  errors: string[];
}
```

### createBackup

Create a backup of the current graph.

```typescript
async createBackup(options?: BackupOptions): Promise<BackupInfo>
```

### restoreBackup

Restore from a backup.

```typescript
async restoreFromBackup(backupPath: string): Promise<RestoreResult>
```

### listBackups

List available backups.

```typescript
async listBackups(): Promise<BackupInfo[]>
```

### deleteBackup

Delete a backup. Since v1.15.0 (Phase 5) this delegates to `BackupManager.delete()` which adds a symlink-attack guard before the underlying `fs.unlink`.

```typescript
async deleteBackup(backupId: string): Promise<void>
```

> All five backup methods (`createBackup` / `listBackups` / `restoreFromBackup` / `deleteBackup` / `cleanOldBackups`) are thin facades over [`BackupManager`](#backupmanager) since v1.15.0 Phase 5. Existing callers see no API change.

### ingest (v1.9.0 — Conversation Ingestion; Unreleased — provenance + mode dial, R4b/R5)

Format-agnostic conversation ingestion pipeline.

```typescript
async ingest(
  input: string | { messages: ChatMessage[] } | ChatMessage[],
  options?: IngestOptions
): Promise<IngestResult>

type IngestMode = 'accurate' | 'balanced' | 'lightweight';  // R5, default 'balanced'

interface IngestOptions {
  mode?: IngestMode;
  llmProvider?: LLMProvider;       // enables distillation enrichment; omitted = raw-observation behaviour
  validate?: (produced: IngestProduced) => Promise<{ valid: boolean; issues?: string[] }>;  // 'accurate'-mode-only
  keepSourceText?: boolean;        // include raw chunk text (capped 4000 chars) in the manifest
  // ...entityType, chunkBy, dryRun, tags, projectId, maxChunkSize, deduplicateThreshold
}

interface IngestResult {
  entitiesCreated: number; observationsAdded: number; skippedDuplicates: number;
  entityNames: string[];
  ingestId: string;                // 8 hex chars
  manifestEntity: string;          // `ingest-<ingestId>`
  chunkCount: number;
  tokenUsage?: { input: number; output: number; approximate: boolean };
  validation?: { valid: boolean; issues?: string[] };
}
```

`input` accepts raw transcript text (auto-split via `splitTranscript`), a `{ messages: [...] }` object, or an array of `ChatMessage`. v1.15.0 hardens transcript splitting with `MAX_SPLIT_LENGTH` (10 MB) and `MAX_PARTS` (10 000) guards against ReDoS.

**R4b — provenance manifest**: every non-dry-run ingest writes an `ingest-<id>` manifest entity (`entityType: 'ingest-manifest'`) with one `[chunk]: <JSON>` observation line per source chunk (`{ id, source, offset, length, hash }`); each created entity links to the manifest via a `derived_from` relation and records per-observation `sourceRef` provenance through `observationMeta` — evidence paths can extend answer → relation → observation → source chunk.

**R5 — cost/quality dial**: `mode` maps onto the `MemoryDistiller` construction dial — `'lightweight'` → heuristic-only (LLM never called), `'balanced'` (default, = pre-R5 behaviour) → auto, `'accurate'` → llm-preferred plus the optional `validate` hook (the `RelationConsolidator` seam). Distillation enrichment and `tokenUsage` accounting only activate when `llmProvider` is supplied.

### splitTranscript (v1.9.0)

Pure function that splits a transcript into per-session text segments using delimiter regex.

```typescript
splitTranscript(content: string, options?: SplitOptions): SplitResult
```

### exportGraph — Linked-Data formats (η.5.4)

In addition to `json` / `csv` / `graphml` / `gexf` / `dot` / `markdown` / `mermaid`, `exportGraph` accepts W3C Linked-Data targets:

```typescript
async exportGraph(format: 'turtle' | 'rdf-xml' | 'json-ld', options?: ExportOptions): Promise<string>
```

Relation predicates that aren't NCName-compatible fall back to RDF reification (`rdf:Statement` / `rdf:subject` / `rdf:predicate` / `rdf:object`).

---

## TagManager

Manages tag aliases and synonyms.

### addTagAlias

Create a tag alias.

```typescript
async addTagAlias(alias: string, canonical: string, description?: string): Promise<TagAlias>
```

**Example:**
```typescript
await ctx.tagManager.addTagAlias('js', 'javascript', 'JavaScript shorthand');
```

### resolveTag

Resolve a tag to its canonical form.

```typescript
async resolveTag(tag: string): Promise<string>
```

### listTagAliases

List all tag aliases.

```typescript
async listTagAliases(): Promise<TagAlias[]>
```

### removeTagAlias

Remove a tag alias.

```typescript
async removeTagAlias(alias: string): Promise<boolean>
```

### getAliasesForTag

Get all aliases for a canonical tag.

```typescript
async getAliasesForTag(canonicalTag: string): Promise<string[]>
```

---

## CompressionManager

Duplicate detection and entity merging.

### findDuplicates

Find potential duplicate entities.

```typescript
async findDuplicates(threshold?: number): Promise<string[][]>
```

**Parameters:**
- `threshold`: Similarity threshold 0.0-1.0 (default: 0.8)

**Returns:** Groups of potentially duplicate entity names

### mergeEntities

Merge multiple entities into one.

```typescript
async mergeEntities(entityNames: string[], targetName?: string): Promise<Entity>
```

**Notes:**
- Combines all observations and tags
- Takes highest importance
- Transfers all relations to merged entity

### compressGraph

Automatically find and merge duplicates.

```typescript
async compressGraph(threshold?: number, dryRun?: boolean): Promise<CompressionResult>
```

---

## AnalyticsManager

Graph statistics and validation.

### getGraphStats

Get graph statistics.

```typescript
async getGraphStats(): Promise<GraphStats>
```

**Returns:**
```typescript
interface GraphStats {
  entityCount: number;
  relationCount: number;
  entityTypes: Record<string, number>;
  tagCounts: Record<string, number>;
  importanceDistribution: Record<number, number>;
  averageObservationsPerEntity: number;
  orphanEntityCount: number;
}
```

### validateGraph

Validate graph integrity.

```typescript
async validateGraph(): Promise<ValidationReport>
```

**Returns:**
```typescript
interface ValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];    // type: 'orphaned_relation' | 'duplicate_entity' | 'invalid_data'
  warnings: ValidationWarning[]; // type: 'isolated_entity' | 'empty_observations' | 'missing_metadata'
  summary: {
    totalErrors: number;
    totalWarnings: number;
    orphanedRelationsCount: number;
    entitiesWithoutRelationsCount: number;
  };
}
```

---

## ArchiveManager

Archive old or low-importance entities to compressed storage.

### archiveEntities

```typescript
async archiveEntities(criteria: ArchiveCriteria, options?: { dryRun?: boolean }): Promise<ArchiveResult>
```

**Parameters:**
```typescript
interface ArchiveCriteria {
  olderThan?: string;          // ISO 8601 date
  importanceLessThan?: number;
  tags?: string[];
}
```

### listArchives

```typescript
async listArchives(): Promise<ArchiveInfo[]>
```

### getArchiveDir

```typescript
getArchiveDir(): string
```

---

## SemanticSearch

Vector similarity search using embeddings. Requires `MEMORY_EMBEDDING_PROVIDER` to be configured.

```typescript
async isAvailable(): Promise<boolean>
async indexAll(graph: KnowledgeGraph, options?: { forceReindex?: boolean }): Promise<void>
async search(graph: KnowledgeGraph, query: string, limit?: number, minSimilarity?: number): Promise<SemanticResult[]>
async findSimilar(graph: KnowledgeGraph, entityName: string, limit?: number): Promise<SemanticResult[]>
async clearIndex(): Promise<void>
```

---

## ObservationNormalizer

Normalize entity observations by resolving pronouns and anchoring dates.

```typescript
async normalizeObservations(entity: Entity, options?: NormalizeOptions): Promise<NormalizedResult>
resolvePronouns(text: string, entity: Entity): string
anchorRelativeDates(text: string, refDate: Date): string
extractKeywords(text: string): string[]
```

**Parameters:**
```typescript
interface NormalizeOptions {
  resolveCoreferences?: boolean;  // Default: true
  anchorTimestamps?: boolean;     // Default: true
  extractKeywords?: boolean;      // Default: false
}
```

---

## TransactionManager

Atomic batch operations with rollback support.

```typescript
begin(): void
async commit(options?: { force?: boolean }): Promise<void>
rollback(): void
async createEntity(entity: CreateEntity): Promise<Entity>
async updateEntity(name: string, updates: Partial<Entity>): Promise<Entity>
async deleteEntity(name: string): Promise<void>
async createRelation(relation: CreateRelation): Promise<Relation>
async deleteRelation(relation: Relation): Promise<void>
```

---

## BatchTransaction

Fluent API for building batch operations.

```typescript
createEntity(entity: CreateEntity): BatchTransaction
updateEntity(name: string, updates: Partial<Entity>): BatchTransaction
deleteEntity(name: string): BatchTransaction
createRelation(relation: CreateRelation): BatchTransaction
deleteRelation(relation: Relation): BatchTransaction
addObservations(entityName: string, contents: string[]): BatchTransaction
deleteObservations(entityName: string, contents: string[]): BatchTransaction
async execute(options?: { force?: boolean }): Promise<BatchResult>
```

---

## StorageFactory

Create storage backend instances.

```typescript
createStorage(config: { type: 'jsonl' | 'sqlite' | 'postgres' | 'postgresql'; path: string }): IGraphStorage
createStorageFromPath(path: string): IGraphStorage
```

(Free functions, not static class methods — `MEMORY_STORAGE_TYPE` overrides `config.type` when set.)

`IGraphStorage` gained two optional members (v2.9.0) so existing third-party/test implementations remain valid without changes: `renameEntity?(oldName, newName): Promise<Entity>` (storage-level rename primitive; both `GraphStorage` and `SQLiteStorage` implement it) and `readonly events?: GraphEventEmitter` (also now implemented by `SQLiteStorage`, giving it full event parity with `GraphStorage` — `graph:loaded`/`saved`, `entity:created`/`updated`/`deleted`, `relation:created` — so event-driven derived views like `TFIDFEventSync` and `GraphRankPrior` work on the SQLite backend too). `SQLiteStorage` also gained the `graphMutex` member already present on `GraphStorage` (fixes a crash in batch manager mutations against the raw SQLite backend).

---

## Types

### Entity

```typescript
interface Entity {
  // Core (since v1.0)
  name: string;
  entityType: string;
  observations: string[];
  parentId?: string;
  tags?: string[];
  importance?: number;
  createdAt?: string;
  lastModified?: string;

  // v2.9.0 — stable identity
  id?: string;                    // Opaque UUID, assigned at creation (crypto.randomUUID),
                                   // preserved across updates/renames/persistence on both
                                   // backends. `name` remains the public key; `id` is
                                   // forward-compat for v2 reference migration.

  // v1.6.0 — Freshness
  ttl?: number;                    // milliseconds
  confidence?: number;             // 0.0–1.0 belief strength

  // v1.8.0 — Project scoping + supersession
  projectId?: string;
  version?: number;
  parentEntityName?: string;
  rootEntityName?: string;
  isLatest?: boolean;
  supersededBy?: string;

  // v1.11.0 — Memory Engine dedup
  contentHash?: string;            // SHA-256 of raw turn content

  // η.4.4 — Bitemporal validity (orthogonal to supersession)
  validFrom?: string;              // ISO 8601
  validUntil?: string;              // ISO 8601, undefined = open
  observationMeta?: Array<{
    index: number;
    validFrom?: string;
    validUntil?: string;
  }>;
}
```

### AgentEntity

```typescript
interface AgentEntity extends Entity {
  memoryType: 'working' | 'episodic' | 'semantic';
  sessionId?: string;
  expiresAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
  confidence: number;              // 0.0–1.0
  agentId?: string;
  visibility: 'private' | 'team' | 'org' | 'shared' | 'public';   // v1.7.0 expanded from 3-level → 5-level
  promotedAt?: string;
  promotedFrom?: string;
  source?: {
    agentId: string;
    timestamp: string;
    method: string;
    reliability: number;
  };

  // η.5.5.b — Visibility expansion
  visibleFrom?: string;            // ISO 8601 time-window start
  visibleUntil?: string;            // ISO 8601 time-window end
  allowedRoles?: string[];          // RBAC role predicate (any-of)
}
```

### SessionEntity

```typescript
interface SessionEntity extends AgentEntity {
  entityType: 'session';
  memoryType: 'episodic';
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'completed' | 'abandoned';
  goalDescription?: string;
  memoryCount: number;
}
```

### Relation

```typescript
interface Relation {
  from: string;
  to: string;
  relationType: string;
  createdAt?: string;
  lastModified?: string;
}
```

### KnowledgeGraph

```typescript
interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

### SearchResult

```typescript
interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}
```

### SearchFilters

```typescript
interface SearchFilters {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityType?: string;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}
```

### Result\<T, E\> (v2.0.0)

Discriminated-union return type for operations with expected, caller-handled
failure modes (`src/types/result.ts`, exported from the types barrel).
Introduced by the v2.0.0 Theme 1 error-signalling audit.

```typescript
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// constructors
ok<T>(value: T): Result<T, never>
err<E>(error: E): Result<never, E>

// type guards
isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T }
isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E }

// extractors
unwrap<T, E>(result: Result<T, E>): T          // throws if err
unwrapOr<T, E>(result: Result<T, E>, fallback: T): T
mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>
```

**Error-signalling policy** (`CONTRIBUTING.md` > Error Handling): `throw` for
programmer errors (bad arguments, invariant violations); return `Result<T, E>`
for expected domain failures the caller is meant to branch on; never swallow a
failure silently; the absent-value sentinel is `T | undefined`, never `T | null`.

---

## BackupManager

(v1.15.0 Phase 5) Backup lifecycle extracted from `IOManager`. Accessed via `ctx.ioManager` (delegating facade) or directly via the constructor if you need finer-grained control.

### create

```typescript
async create(options?: BackupOptions): Promise<BackupResult>
```

### list

```typescript
async list(): Promise<BackupInfo[]>
```

### restore

Reads, optionally Brotli-decompresses, and writes the backup payload over the live storage file. Rejects symbolic links via `fs.lstat().isSymbolicLink()`.

```typescript
async restore(backupPath: string): Promise<RestoreResult>
```

### delete

Validates the path stays in `backupDir`, rejects symlinks, unlinks the backup, then attempts to remove the `.meta.json` sidecar (derived via `path.basename` + revalidated independently).

```typescript
async delete(backupPath: string): Promise<void>
```

### cleanOld

Keeps the N most recent backups; deletes the rest via `delete()`.

```typescript
async cleanOld(keepCount?: number): Promise<number>
```

---

## MemoryEngine

(v1.11.0) Turn-aware conversation memory composing over `EpisodicMemoryManager` + `WorkingMemoryManager`. Wired via `ctx.memoryEngine` (lazy getter).

### addTurn

Dedup-first write. Runs the four-tier dedup chain (exact contentHash → 50% prefix overlap → token Jaccard ≥ `MEMORY_ENGINE_JACCARD_THRESHOLD` → optional semantic). Emits `memoryEngine:turnAdded` or `memoryEngine:duplicateDetected`.

```typescript
async addTurn(content: string, opts: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  agentId?: string;
}): Promise<AddTurnResult>
```

### checkDuplicate

Run the dedup chain without writing.

```typescript
async checkDuplicate(content: string, sessionId: string): Promise<DuplicateResult | null>
```

### getSessionTurns

Chronological turns for a session.

```typescript
async getSessionTurns(
  sessionId: string,
  opts?: { role?: 'user' | 'assistant' | 'system' | 'tool'; limit?: number }
): Promise<TurnEntity[]>
```

### deleteSession / listSessions

```typescript
async deleteSession(sessionId: string): Promise<{ deletedCount: number }>
async listSessions(): Promise<SessionEntity[]>
```

### Events

`MemoryEngine` is a `node:events.EventEmitter`. Subscribe to `memoryEngine:turnAdded`, `memoryEngine:duplicateDetected`, `memoryEngine:sessionDeleted`.

### ImportanceScorer (companion)

Integer [0, 10] scoring via `length × keyword × recent-turn-overlap` signals. Configurable via `MEMORY_ENGINE_LENGTH_WEIGHT` / `KEYWORD_WEIGHT` / `OVERLAP_WEIGHT` / `RECENT_TURNS`.

---

## GovernanceManager

(v1.6.0; **Unreleased** — enforcement chokepoint, Sec1) Policy enforcement and transactional safety for memory mutations. Wired via `ctx.governanceManager`.

### withTransaction

Wraps a function in a snapshot-based transaction. On exception, the storage is restored to the pre-call snapshot.

```typescript
async withTransaction<T>(fn: (tx: GovernanceTransaction) => Promise<T>): Promise<T>
```

### rollback

Explicit rollback of a previously committed operation by its audit entry id (rare — `withTransaction` rolls back automatically on throw).

```typescript
async rollback(auditEntryId: string): Promise<void>
```

### setPolicy / GovernancePolicy (interface)

```typescript
setPolicy(policy: GovernancePolicy): void

interface GovernancePolicy {
  canCreate?(entity: Omit<Entity, 'createdAt' | 'lastModified'>): boolean;
  canUpdate?(entity: Entity, updates?: Partial<Entity>): boolean;
  canDelete?(entity: Entity): boolean;
}
```

Consulted before every mutation the manager handles; a hook returning `false` throws and rolls back the transaction. All three hooks are optional — an absent hook allows the operation.

### Constructor options — `redactAuditSnapshots` (Sec6)

```typescript
new GovernanceManager(storage: GraphStorage, auditLog: AuditLog, options?: {
  redactAuditSnapshots?: boolean;  // default false — PII-redact before/after snapshots before they hit the audit log
  redactor?: PiiRedactor;          // custom redactor; defaults to new PiiRedactor()
})
```

The live graph is never mutated — only the audit-log copies are redacted.

### Unreleased — enforcement chokepoint (Sec1)

`MEMORY_GOVERNANCE_ENABLED` was previously read nowhere in `src/`, so setting it did nothing and no mutation path was governed. Now, when it is the strict literal `'true'` (checked once at first `ctx.entityManager` access), `ManagerContext` wires this manager's live policy + audit log directly into `EntityManager` via `EntityManager.setGovernanceHooks()` — so `createEntities`/`updateEntity`/`batchUpdate`/`deleteEntities`/`renameEntity` are policy-checked (`GovernanceError` on denial) and audited (fire-and-forget; an audit-sink failure never fails the underlying write) without requiring the caller to route writes through `withTransaction`. Policy is read live via `getPolicy()`, so a `setPolicy()` call after construction takes effect on the next mutation. Unset env var = zero checks, zero audit calls on `EntityManager` (pre-Sec1 behavior); `ctx.governanceManager` remains usable manually via `withTransaction` either way.

---

## FreshnessManager

(v1.6.0) Wired via `ctx.freshnessManager`.

```typescript
calculateFreshness(entity: Entity, now?: Date): FreshnessScore
async getStaleEntities(threshold?: number): Promise<Entity[]>
async getExpiredEntities(): Promise<Entity[]>
async generateReport(): Promise<FreshnessReport>
```

`FreshnessScore.score ∈ [0, 1]` combines `Entity.ttl` (absolute time-to-live in ms) and `Entity.confidence` (belief strength). Used by `SalienceEngine` and `DecayEngine`.

---

## RbacMiddleware + RoleAssignmentStore

(η.6.1) Wired via `ctx.rbacMiddleware` and `ctx.roleAssignmentStore` when `MEMORY_RBAC_ENABLED=true`.

```typescript
ctx.rbacMiddleware.checkPermission(
  agentId: string,
  action: 'read' | 'write' | 'delete' | 'admin',
  resourceType: string,
  resourceName?: string
): Promise<boolean>

ctx.roleAssignmentStore.assignRole(agentId: string, role: string): Promise<void>
ctx.roleAssignmentStore.revokeRole(agentId: string, role: string): Promise<void>
ctx.roleAssignmentStore.listAssignments(agentId?: string): Promise<RoleAssignment[]>
```

Optional JSONL persistence when `MEMORY_RBAC_ASSIGNMENTS_FILE` is set.

---

## ProcedureManager + CausalReasoner + WorldModelManager + ActiveRetrievalController

(3B.4–3B.7) See dedicated component docs in [`COMPONENTS.md`](./COMPONENTS.md). Brief surface:

```typescript
// 3B.4 — Procedural memory
ctx.procedureManager.addProcedure(spec: ProcedureSpec): Promise<string>
ctx.procedureManager.matchProcedure(context: unknown): Promise<ProcedureMatch[]>
ctx.procedureManager.refineProcedure(id: string, feedback: ProcedureFeedback): Promise<void>

// 3B.5 — Active retrieval
ctx.activeRetrieval.adaptiveRetrieve(opts: { query: string; maxRounds?: number }): Promise<RetrievalResult>

// 3B.6 — Causal reasoning
ctx.causalReasoner.findCauses(entity: string): Promise<Entity[]>
ctx.causalReasoner.findEffects(entity: string): Promise<Entity[]>
ctx.causalReasoner.counterfactual(scenario: CounterfactualSpec): Promise<CounterfactualResult>
ctx.causalReasoner.detectCycles(): Promise<CausalCycle[]>

// 3B.7 — World model
ctx.worldModelManager.getCurrentState(): Promise<WorldStateSnapshot>
ctx.worldModelManager.validateFact(fact: FactCandidate): Promise<ValidationResult>
ctx.worldModelManager.predictOutcome(scenario: ScenarioSpec): Promise<OutcomePrediction>
ctx.worldModelManager.detectStateChange(): Promise<StateChangeEvent[]>
```

---

## IMemoryBackend

(v1.12.0) Pluggable backend interface for `MemoryEngine`. Selected via `MEMORY_BACKEND=sqlite|in-memory` and accessed via `ctx.memoryBackend`.

```typescript
interface IMemoryBackend {
  add(entry: MemoryEntry): Promise<void>;
  get(id: string): Promise<MemoryEntry | null>;
  get_weighted(filter: WeightedFilter): Promise<WeightedMemoryEntry[]>;
  delete(id: string): Promise<void>;
}
```

`SQLiteBackend` wraps `MemoryEngine` (and transparently spans JSONL + SQLite per `MEMORY_STORAGE_TYPE`). `InMemoryBackend` is ephemeral; suitable for tests and short-lived processes.

---

## GraphRankPrior + HybridSearchManager

(v2.9.0 — knowledge-graph-as-core convergence) Graph-connectivity as a first-class ranking signal. All new weights/options default to `0`/off with behavior identical to before they existed. See `docs/architecture/KNOWLEDGE_GRAPH_CORE_FEASIBILITY.md`.

### GraphRankPrior

`@experimental`. Cached graph-connectivity ranking signal: normalized PageRank over `GraphTraversal`, with a degree-only fallback beyond `maxPageRankEntities` (default 50 000). Event-invalidated (per-item entity/relation events + `graph:saved`, which covers manager-level batch mutations). Wired via `ctx.graphRankPrior` (lazy getter).

```typescript
new GraphRankPrior(
  source: GraphTraversal | GraphStorage,
  options?: {
    maxPageRankEntities?: number;  // default 50_000
    dampingFactor?: number;        // default 0.85
    events?: GraphEventEmitter;    // enables auto-invalidation
  }
)

async getScores(names: string[]): Promise<Map<string, number>>  // normalized [0, 1]
async getPageRank(entityName: string): Promise<number>
async getDegree(entityName: string): Promise<number>
neighbors(entityName: string): string[]                          // one-hop, both directions
isDegreeFallback(): boolean | undefined
invalidate(): void
dispose(): void
```

### HybridSearchManager

Combines semantic, lexical, symbolic, and (optionally) graph-connectivity search layers. Wired via `ctx.hybridSearchManager` (lazy getter; attaches `graphRankPrior` only when `MEMORY_HYBRID_GRAPH_WEIGHT > 0`).

```typescript
new HybridSearchManager(
  semanticSearch: SemanticSearch | null,
  rankedSearch: RankedSearch,
  graphPrior?: GraphRankPrior | null,          // optional graph-connectivity channel
  defaults?: { graphWeight?: number; expandNeighbors?: { hops: 1; topK?: number; damping?: number } }
)

async search(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  options?: Partial<HybridSearchOptions> & {
    graphWeight?: number;        // graph channel weight (default 0 = off)
    expandNeighbors?: { hops: 1; topK?: number; damping?: number };  // one-hop expansion
  }
): Promise<HybridSearchResult[]>
```

`HybridSearchResult.matchedLayers` can now include `'graph'`; `scores.graph` carries the normalized graph-connectivity contribution when the channel is active. `HybridSearchLayer` (`= HybridSearchResult['matchedLayers'][number]`) is a `@deprecated` alias kept for back-compat.

### RankedSearch.setGraphPrior (v2.9.0)

Opt-in post-scoring boost for TF-IDF/BM25 ranked search.

```typescript
setGraphPrior(prior: GraphRankPrior | null, boost?: number): void
```

Multiplies each result's score by `score × (1 + boost × normalizedPageRank)` and re-sorts. No-op when no prior/boost is configured (the default). `ManagerContext` wires this automatically when `MEMORY_RANKED_GRAPH_BOOST > 0`.

### Related env vars

`MEMORY_HYBRID_GRAPH_WEIGHT`, `MEMORY_RANKED_GRAPH_BOOST`, `MEMORY_SALIENCE_CONNECTIVITY_WEIGHT`, `MEMORY_DECAY_CONNECTIVITY_PROTECTION` (see [CLAUDE.md](../../CLAUDE.md) for the full table).

---

## EventManager

(Unreleased — R1, `@experimental`) Reifies actions as first-class `entityType: 'event'` hub entities with role-typed relations. Wired via `ctx.eventManager`.

### recordEvent

```typescript
async recordEvent(input: RecordEventInput): Promise<EventRecord>

interface RecordEventInput {
  action: string;
  actor: string;
  target?: string;
  context?: string;
  participants?: string[];
  detail?: string | string[];
  occurredAt?: string | Date;   // normalized to ISO 8601
  flowKey?: string;             // grouping key, case-insensitive
  importance?: number;
}
```

Creates an `event-<action>-<shortId>`-named hub entity plus role-typed relations: `<actor> —actor_of→ <event>`, `<event> —targeted→ <target>`, `<event> —occurred_in→ <context>`, `<participant> —participant_in→ <event>` for each participant. Missing endpoints auto-create as `entityType: 'concept'` stubs by default (`autoCreateEndpoints: false` in the constructor config throws instead, before any write). Throws on empty `action`/`actor`, an unparseable `occurredAt`, or shortId exhaustion (10 collision retries).

### getEvent / queryEvents / getFlow / whoDidWhat

```typescript
async getEvent(name: string): Promise<EventRecord | null>
async queryEvents(filter?: EventQueryFilter): Promise<EventRecord[]>
async getFlow(flowKey: string): Promise<EventRecord[]>            // chronological, by flow tag
async whoDidWhat(filter?: WhoDidWhatFilter): Promise<WhoDidWhatEntry[]>
```

Queries use the storage `TypeIndex`/`RelationIndex` — O(k)/O(1), no full-graph scans.

**Example:**
```typescript
await ctx.eventManager.recordEvent({
  action: 'deployed', actor: 'alice', target: 'api-service',
  context: 'production', flowKey: 'release-42',
});
const flow = await ctx.eventManager.getFlow('release-42');
const who = await ctx.eventManager.whoDidWhat({ target: 'api-service' });
```

---

## EvidencePathBuilder

(Unreleased — R2, `@experimental`) Builds traceable graph paths from search-query anchors to a result entity — the "why" behind a hit. Constructed per search call when `explain: true` is requested; not exposed as a `ManagerContext` getter.

```typescript
new EvidencePathBuilder(graph: ReadonlyKnowledgeGraph, options?: {
  maxDepth?: number;            // default 3 hops
  maxPathsPerResult?: number;   // default 3
})

buildForResult(resultName: string, anchors: readonly EvidenceAnchor[]): EvidencePathSet

interface EvidenceAnchor {
  name: string;
  viaLayer: EvidenceLayer;  // which search layer produced this anchor
  score?: number;           // anchors are tried in descending score order
}

interface EvidencePathSet {
  paths: EvidencePath[];    // shortest paths (bounded BFS), at most maxPathsPerResult
  truncated: boolean;       // true if a cap changed the outcome
}
```

Wired automatically into `HybridSearchManager.search({ explain: true })` and `LLMSearchExecutor.execute` — results gain an `evidencePaths` field. `explain` defaults to `false`; omitting it is byte-identical to pre-R2 output.

---

## RelationConsolidator

(Unreleased — R3, `@experimental`) Three-tier "Janitor" pass for relation-level deduplication and neighborhood validation. Not wired into `ManagerContext` — construct directly.

```typescript
new RelationConsolidator(
  relationOps: { getRelations, createRelations, deleteRelations },  // RelationManager or a structural fake
  entityOps?: { listEntities },                                     // needed for tier 1/2 corpus scans
  options?: {
    embedding?: RelationEmbeddingProvider;   // enables tier 2 (embed/embedBatch)
    llm?: LLMProvider;                       // enables tier 3
    thresholds?: { semantic?: number };      // default 0.90
    maxGroups?: number;                      // default 100
    maxLlmBatch?: number;                    // default 50
    maxNeighborhoodRelations?: number;       // default 200
  }
)

async analyze(options?: { newRelations?: Relation[] }): Promise<RelationConsolidationReport>
async consolidate(options?: { newRelations?: Relation[]; apply?: boolean }): Promise<RelationConsolidationReport>
```

- **Tier 1 (exact/near-exact)**: same `(from, to)` pair, spelling-variant `relationType`s (case/underscore/hyphen/camelCase) merge onto the canonical spelling.
- **Tier 2 (semantic, embedding-gated)**: same-pair relations with descriptor cosine similarity ≥ threshold flagged/merged. Skipped without an `embedding` provider.
- **Tier 3 (neighborhood validation, LLM-gated)**: validates caller-supplied `newRelations` against a 2-hop neighborhood; returns `'ok' | 'suspect' | 'wrong'` verdicts. **Never mutates.** Skipped without an `llm` provider.

`consolidate({ apply: true })` applies tier 1+2 merges only (`deleteRelations` + `createRelations`); tier 3 is always report-only. Companion `RelationConsolidationStage` is a report-only `PipelineStage` for `ConsolidationPipeline`.

---

## ApiKeyAuthMiddleware

(Unreleased — Sec9) Reference authentication layer wiring `APIKeyStore.validate()` into `RestRouter`.

```typescript
new ApiKeyAuthMiddleware(options: {
  store: APIKeyStore;
  requiredScopes?: (method: RestMethod, path: string) => readonly string[];  // default: GET → [], others → ['entities:write']
  onReject?: (info: { reason: string; method: RestMethod; path: string }) => void;
})

extractKey(req: RestRequest): string | null       // Authorization: Bearer <key>, falls back to X-Api-Key
authenticate(req: RestRequest): { ok: true; auth: AuthContext } | { ok: false; response: RestResponse }

interface AuthContext { keyId: string; scopes: readonly string[]; ownerId?: string }
```

`401 { error: 'unauthorized' }` for a missing/unknown/revoked/expired key — the specific rejection reason is intentionally not serialized to the client (available server-side via `onReject` for logging). `403 { error: 'forbidden', requiredScopes }` for a valid key lacking a required scope.

**Example:**
```typescript
const store = new APIKeyStore();
const auth = new ApiKeyAuthMiddleware({ store });
const router = RestRouter.withDefaults(ctx, { auth });
```

---

