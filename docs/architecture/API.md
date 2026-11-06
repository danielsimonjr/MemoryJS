# MemoryJS — API Reference

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

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
28. [EventManager](#eventmanager) *(3.0.0, R1, `@experimental`)*
29. [EvidencePathBuilder](#evidencepathbuilder) *(3.0.0, R2, `@experimental`)*
30. [RelationConsolidator](#relationconsolidator) *(3.0.0, R3, `@experimental`)*
31. [ApiKeyAuthMiddleware](#apikeyauthmiddleware) *(3.0.0, Sec9)*
32. [ProceduralGraphManager](#proceduralgraphmanager) (`ctx.createProceduralGraph`, `@experimental`)
33. [Batch primitives and helper surface](#batch-primitives-and-helper-surface) *(2026-11 design pass)*

---

## ManagerContext

Central access point for all managers. Provides lazy-initialized access to all subsystems.

### Getters for freshness, temporal search, collaboration, export, and audit

- `ctx.freshnessManager`: lazy `FreshnessManager` (TTL and confidence reports). Built by the bookkeeping facade.
- `ctx.temporalSearch`: lazy `TemporalSearch` (natural-language time ranges). Built by the search facade.
- `ctx.streamingExporter(filePath)`: factory. Returns a new `StreamingExporter` bound to `filePath` on each call, so it is not lazy.
- `ctx.auditLog`: returns the same `AuditLog` instance as `ctx.governanceManager.auditLog`. It constructs nothing new.
- `AgentMemoryManager.collaborativeSynthesis`: lazy `CollaborativeSynthesis`, built from the manager's storage, a `GraphTraversal`, the salience engine, and `config.collaborativeSynthesis`.

The full member list is in [API_REFERENCE.md](../guides/API_REFERENCE.md#managercontext--lazy-getter-list-current).

### Constructor

```text
new ManagerContext(memoryFilePath: string)
```

**Parameters:**
- `memoryFilePath`: Path to storage file (e.g., `'./memory.jsonl'` or `'./memory.db'`)

Storage backend is selected via the `MEMORY_STORAGE_TYPE` environment variable (`'jsonl'` or `'sqlite'`, default: `'jsonl'`).

**Example:**
```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (set MEMORY_STORAGE_TYPE=sqlite)
// SQLite alternative (replaces the JSONL line above):
// const ctx = new ManagerContext('./memory.db');
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
| `skillManager` | `SkillManager` | Recursa skill registry over the context storage (RS-2); semantic blending is used when `ctx.semanticSearch` has been initialised before the first `skillManager` access; `MEMORY_EMBEDDING_PROVIDER=none` disables it |
| `instructionSets` | `InstructionSetManager` | Recursa role-scoped instruction sets (RS-5); `history()` uses `transitionLedger` when enabled |
| `knowledgeRepository` | `KnowledgeRepository` | Recursa snapshots, revisions and budgeted `loadForContext` (RS-5), composed from `skillManager`, `instructionSets` and `failureManager` |
| `skillPublisher` | `SkillPublisher` | Recursa atomic SKILL.md publish and import over `skillManager` (RS-3) |
| `learningLoop(deps)` | `LearningLoop` | Recursa learning loop (RS-18, RS-21); a fresh, independent loop per call. `learn` / `start` route to the recursive learner when the run has more tasks than the leaf threshold (`opts.leafThreshold`, else `MEMORY_LEARNING_LEAF_THRESHOLD`, else 20) or `split` is set with more than one task |
| `bootstrapper(deps)` | `Bootstrapper` | Recursa bootstrapper (RS-10..RS-13): corpus map, coverage boundaries, exploration notes, practice tasks, optional learning pass through `learningLoop`; a new instance per call |
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
| `diagnostics(options?)` | `DiagnosticsReport` | **Method, not a getter.** Aggregate report (index health, entity counts). `{ observationDedup: true }` adds the observation dedup ratio (O(total observations)). `explainPlan` is `ctx.searchManager.explainPlan(query)`; index health is `ctx.indexHealth()` (v1.15.0 Phase 0/1) |
| `graphRankPrior` | `GraphRankPrior` | Cached normalized-PageRank ranking signal, event-invalidated (v2.9.0, `@experimental`) |
| `hybridSearchManager` | `HybridSearchManager` | Semantic + lexical + symbolic (+ optional graph) layered search (v2.9.0) |
| `materializedViews` | `MaterializedViewsManager` | Pre-computed result sets for repeated filter-based queries; lazy, auto-invalidated on entity events: updates dirty only views whose filter keys intersect the changed keys, creates/deletes dirty all, date-bounded views are dirtied by every update (`@experimental`) |
| `observationStore` | `ObservationStore` | Per-context, in-process interned observation store; not persisted, starts empty on each new context |
| `tieredPostingsIndex` | `TieredIndex<unknown> \| null` | 3-tier LRU / disk / Brotli index composer, `null` unless `MEMORY_TIERED_INDEX='true'`. `@internal`: no in-tree consumer yet |
| `cachePressure` | `CachePressureCoordinator` | Global cache-entry budget coordinator (`MEMORY_CACHE_BUDGET_ENTRIES`); caches register with it lazily (`@experimental`) |
| `eventManager` | `EventManager` | Event reification: actions become `entityType: 'event'` hub entities with role relations; `whoDidWhat()` (`@experimental`) |
| `reconstructiveMemory(config?)` | `ReconstructiveMemory` | **Method, not a getter.** MRAgent Cue–Tag–Content memory with active multi-step reconstruction; defaults its backing to this context's managers (`@experimental`) |
| `prospectiveMemory` | `ProspectiveMemoryManager` | Intention-to-act (future-tense) memory; lazy. Conditional triggers fire only when `prospectivePredicateEvaluator` is passed in `ManagerContextOptions` (see *Batch primitives and helper surface*) |
| `spellChecker` | `SpellChecker` | Spell correction over the `NGramIndex` vocabulary (entity names + tag values); `suggest(query)`; lazy |
| `toolAffordanceManager` | `ToolAffordanceManager` | Per-tool rolling outcome statistics for adaptive tool selection; lazy |
| `toolCallObserver` | `ToolCallObserver` | Canonical producer pipeline for `toolAffordanceManager` (`observeStart` / `observeComplete` / `observeError`). `@internal` |
| `agentMemory(config?)` | `AgentMemoryManager` | **Method, not a getter.** Agent Memory System facade; `config` overrides the env-var defaults and re-instantiates the cached facade |
| `queryNaturalLanguage(text)` | `Promise<Entity[]>` | **Method.** LLM-planned NL query decomposition; uses the default no-LLM planner unless a custom `llmQueryPlanner()` was initialised. The LLM provider is configured in code (`llmQueryPlanner()`), not by an env var |
| `bloomPreScreener` | `BloomPreScreener \| null` | Bloom-filter pre-screen for `FuzzySearch` (`@experimental`). `null` unless `MEMORY_FUZZY_BLOOM_PRESCREEN='true'`; built lazily on the first fuzzy search and cleared on entity events. Approximate (speed over recall): typo queries can miss matches when another entity contains the literal token |
| `createProceduralGraph(config)` | `Promise<ProceduralGraphManager>` | **Factory, not a lazy getter** (`@experimental`). See note below. |

Procedural Graph is created via `createProceduralGraph(config)`, not a `ctx.proceduralGraph` getter:

```text
createProceduralGraph(config: {
  backing: { type: 'jsonl' | 'sqlite' | 'memory'; path?: string } | IProceduralGraphBacking;
  policy?: PGPolicy;
  guidanceProvider?: PGCompletionProvider;
  paperCompatible?: boolean;
}): Promise<ProceduralGraphManager>
```

Default sidecar path is `<basename>-procedural-graph.jsonl` (`.db` for sqlite). A config-created backing is owned and disposed on `ctx.close()`; an injected `IProceduralGraphBacking` is not.

### Methods

#### agentMemory

Get the Agent Memory Manager for AI agent memory operations.

```text
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

```text
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
declare const agentMem: import('@danielsimonjr/memoryjs').AgentMemoryManager;
const session = await agentMem.startSession({
  goalDescription: 'Help user plan a trip to Japan',
  taskType: 'planning'
});
```

### endSession

End an active session.

```text
async endSession(sessionId: string): Promise<void>
```

### getActiveSession

Get the currently active session.

```text
async getActiveSession(): Promise<SessionEntity | null>
```

### addWorkingMemory

Add a working memory entry to a session.

```text
async addWorkingMemory(options: CreateMemoryOptions): Promise<AgentEntity>
```

**Parameters:**
```typescript
import type { MemoryVisibility } from '@danielsimonjr/memoryjs';
interface CreateMemoryOptions {
  sessionId: string;
  content: string;
  importance?: number;          // 0-10
  taskId?: string;
  ttlHours?: number;
  agentId?: string;             // recorded when multi-agent mode is enabled
  visibility?: MemoryVisibility;
}
```

**Example:**
```typescript
declare const agentMem: import('@danielsimonjr/memoryjs').AgentMemoryManager;
declare const session: Awaited<ReturnType<typeof agentMem.startSession>>;
await agentMem.addWorkingMemory({
  sessionId: session.name,
  content: 'User prefers budget travel',
  importance: 7,
});
```

### getWorkingMemories

Get all working memories for a session.

```text
async getWorkingMemories(sessionId: string): Promise<AgentEntity[]>
```

### clearExpiredMemories

Remove expired working memories.

```text
async clearExpiredMemories(): Promise<number>
```

**Returns:** Number of memories cleared

### reinforceMemory

Strengthen a memory (reset decay, increase confirmation count).

```text
async reinforceMemory(entityName: string): Promise<void>
```

### promoteToLongTerm

Promote a working memory to long-term storage.

```text
async promoteToLongTerm(entityName: string): Promise<void>
```

### consolidateSession

Consolidate session memories into long-term storage.

```text
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

Retrieve memories optimized for LLM context window. `AgentMemoryManager.retrieveForContext`
takes `RetrieveContextOptions` and maps them onto the `ContextWindowManager` options below
(`sessionId` → `context.currentSession`, `taskId` → `context.currentTask`, `keywords` joined →
`context.queryText`). Call `agentMem.contextWindowManager.retrieveForContext()` directly for the
full `ContextRetrievalOptions` (`maxSlots`, `composeHops`, `summarizeExcluded`).

```text
async retrieveForContext(options?: RetrieveContextOptions): Promise<ContextPackage>
```

`RetrieveContextOptions`: `sessionId?`, `taskId?`, `keywords?: string[]`, `maxTokens?` (default
`contextWindow.defaultMaxTokens`, else 4000), `includeWorkingMemory?`, `includeEpisodicRecent?`,
`includeSemanticRelevant?`, `mustInclude?: string[]`.

`ContextWindowManager.retrieveForContext` parameters:

**Parameters:**
```typescript
interface ContextRetrievalOptions {
  maxTokens: number;
  context: SalienceContext;
  includeWorkingMemory?: boolean;
  includeEpisodicRecent?: boolean;
  includeSemanticRelevant?: boolean;
  mustInclude?: string[];
  maxSlots?: number;      // Cap on the number of memories. Must-include entities count and are never cut.
  composeHops?: 0 | 1;    // 1 adds one-hop neighbors of the top hybrid hits. Needs a query and an attached hybrid search.
  summarizeExcluded?: boolean;  // Summarize the excluded entities into excludedSummary. Needs a summarizer from setSummarizer(). Off by default.
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
import { AgentEntity, ExcludedEntity, TokenBreakdown } from '@danielsimonjr/memoryjs';
interface ContextPackage {
  memories: AgentEntity[];
  totalTokens: number;
  sourceTokens: number;        // totalTokens plus the tokens of every excluded entity
  compressionRatio: number;    // sourceTokens / totalTokens; 1 when nothing is excluded
  breakdown: TokenBreakdown;   // working, episodic, semantic, procedural, mustInclude
  excluded: ExcludedEntity[];  // reason: budget_exceeded | low_salience | filtered | slot_limit
  suggestions: string[];
  excludedSummary?: string;    // One summary of the excluded entities. Set only with summarizeExcluded. Not counted in totalTokens.
}
```

`sourceTokens` and `compressionRatio` are required. Code that builds a `ContextPackage` by hand must set both.

**Excluded summary:** `excludedSummary` is set only when `summarizeExcluded` is `true`, a summarizer is attached with `setSummarizer()`, and at least one excluded entity has observation text. `retrieveWithBudgetAllocation` ignores the option. If the summarizer throws, retrieval logs a warning and leaves `excludedSummary` unset.

**Query-ranked retrieval:** call `setHybridSearch(search)` on the `ContextWindowManager` to attach a hybrid search. When `context.queryText` is non-blank, `retrieveForContext` orders candidates by hybrid rank before the salience cut. Only candidates that the hybrid search returns, plus must-include entities, enter the result. If the hybrid search throws, retrieval logs a warning and uses the salience order. Without an attached search, retrieval is unchanged. `ctx.contextWindowManager` attaches the hybrid search only when `MEMORY_CONTEXT_HYBRID_RANKING` is `true`. `AgentMemoryManager` is not covered by this switch.

**Example:**
```typescript
declare const agentMem: import('@danielsimonjr/memoryjs').AgentMemoryManager;
const pkg = await agentMem.retrieveForContext({
  maxTokens: 4000,
  taskId: 'Recommend hotels in Tokyo',
  keywords: ['hotels', 'budget'],
  includeWorkingMemory: true
});
```

### getMostSalient

Get most salient memories for a context.

```text
async getMostSalient(
  context: SalienceContext,
  limit: number
): Promise<ScoredEntity[]>
```

**Returns:**
```typescript
import { AgentEntity } from '@danielsimonjr/memoryjs';
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

```text
start(): void
```

### stop

Stop the decay scheduler.

```text
stop(): void
```

---

## EntityManager

Manages entity CRUD operations.

### createEntities

Create one or more entities in the knowledge graph.

```text
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

Retrieve a single entity by name. (The O(1) `storage.getEntity(name): Entity | undefined`
is the underlying `IGraphStorage` primitive; `EntityManager` exposes `getEntity`.)

```text
async getEntity(name: string, options?: GetEntityOptions): Promise<Entity | null>
```

### updateEntity (with Optimistic Concurrency Control)

Update an entity, optionally requiring a specific version (η.5.5.c).

```text
async updateEntity(
  name: string,
  updates: Partial<Entity>,
  options?: { expectedVersion?: number }
): Promise<Entity>
```

If `expectedVersion` is supplied and doesn't match the current `version` field on the entity, throws `VersionConflictError`. Used by `MultiAgentMemoryManager` to safely interleave writes from multiple agents.

### invalidateEntity (η.4.4 — Bitemporal Versioning)

Mark an entity as no longer valid by setting `validUntil` (does not delete the entity; `entityAsOf` still returns it for past timestamps). Idempotent — a second call updates the existing `validUntil`.

```text
async invalidateEntity(name: string, ended?: string): Promise<void>
```

`ended` is an ISO 8601 timestamp string; defaults to the current time. Throws `EntityNotFoundError` if `name` doesn't exist.

### entityAsOf

Time-travel query — get the version of an entity that was valid at a given timestamp.

```text
async entityAsOf(name: string, asOf: string): Promise<Entity | null>
```

`asOf` is an ISO 8601 date string. Throws `ValidationError` if it isn't.

### entityTimeline

Get the chronological version history of an entity (across `invalidateEntity` cascades).

```text
async entityTimeline(name: string): Promise<Entity[]>
```

### getAllEntities

Retrieve all entities.

```text
async getAllEntities(): Promise<Entity[]>
```

### deleteEntities

Delete one or more entities by name.

```text
async deleteEntities(entityNames: string[]): Promise<void>
```

**Notes:**
- Relations involving deleted entities are also removed
- Child entities remain but lose their parent reference

### addTags

Add tags to an entity.

```text
async addTags(entityName: string, tags: string[]): Promise<Entity>
```

### removeTags

Remove tags from an entity.

```text
async removeTags(entityName: string, tags: string[]): Promise<Entity>
```

### setImportance

Set entity importance score.

```text
async setImportance(entityName: string, importance: number): Promise<Entity>
```

**Parameters:**
- `importance`: Integer from 0-10

### addTagsToMultipleEntities

Add tags to multiple entities at once.

```text
async addTagsToMultipleEntities(entityNames: string[], tags: string[]): Promise<Entity[]>
```

### replaceTag

Replace a tag across all entities.

```text
async replaceTag(oldTag: string, newTag: string): Promise<number>
```

**Returns:** Number of entities updated

### mergeTags

Merge two tags into a target tag.

```text
async mergeTags(tag1: string, tag2: string, targetTag: string): Promise<number>
```

### listEntities (v2.9.0)

Public bulk enumeration, replacing the old `entityManager['storage']` private-access pattern.

```text
async listEntities(filter?: { entityType?: string }): Promise<Entity[]>
```

When `filter.entityType` is supplied, takes an O(k) `TypeIndex` fast path (`storage.getEntitiesByType`) instead of a full-graph scan.

### renameEntity (v2.9.0)

Atomically rename an entity, rewriting every stored reference to the old name.

```text
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

```text
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

```text
async getRelations(entityName: string): Promise<Relation[]>
```

### deleteRelations

Delete specific relations.

```text
async deleteRelations(relations: Relation[]): Promise<void>
```

### getAllRelations

Get all relations in the graph.

```text
async getAllRelations(): Promise<Relation[]>
```

### invalidateRelation (v1.9.0 — Temporal Validity)

Mark the active (non-terminated) relation matching `from`/`relationType`/`to` as ended, by setting `properties.validUntil` (without deleting it).

```text
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

```text
async queryAsOf(
  entityName: string,
  asOf: string,   // ISO 8601 date string
  options?: { direction?: 'outgoing' | 'incoming' | 'both' }  // default 'both'
): Promise<Relation[]>
```

### timeline (v1.9.0 — Chronological History)

Return all relations involving an entity sorted chronologically by `properties.validFrom` (unbounded relations last).

```text
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

```text
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

```text
async deleteObservations(deletions: ObservationDeletion[]): Promise<ObservationResult[]>
```

**Events (DES-3).** `addObservations` emits `observation:added` once per entity that gained observations, with only the strings actually added. Duplicates emit nothing. `deleteObservations` emits `observation:deleted` with only the strings actually removed; requested-but-absent strings are not reported. Both events fire after the `entity:updated` event for the same write. `createEntities` with initial observations emits `entity:created` only, not `observation:added`.

### invalidateObservation (η.4.4 — Bitemporal Axis)

Mark a specific observation (matched by its content string) as no longer valid at a given point in time, without removing it from the entity's `observations[]`. Adds an `observationMeta[]` entry recording the boundary.

```text
async invalidateObservation(
  entityName: string,
  content: string,
  ended?: string   // ISO 8601 timestamp; defaults to current time
): Promise<void>
```

### observationsAsOf (η.4.4 — Time-Travel)

Return the observations that were valid for an entity at a given timestamp.

```text
async observationsAsOf(entityName: string, asOf: string): Promise<string[]>
```

`asOf` is an ISO 8601 date string.

---

## HierarchyManager

Manages parent-child entity relationships.

### setEntityParent

Set or remove an entity's parent.

```text
async setEntityParent(entityName: string, parentName: string | null): Promise<Entity>
```

**Notes:**
- Pass `null` to remove parent
- Throws `CycleDetectedError` if would create cycle

### getChildren

Get direct children of an entity.

```text
async getChildren(entityName: string): Promise<Entity[]>
```

### getParent

Get parent of an entity.

```text
async getParent(entityName: string): Promise<Entity | null>
```

### getAncestors

Get all ancestors (parent chain to root).

```text
async getAncestors(entityName: string): Promise<Entity[]>
```

### getDescendants

Get all descendants (recursive children).

```text
async getDescendants(entityName: string): Promise<Entity[]>
```

### getSubtree

Get entity and all descendants with their relations.

```text
async getSubtree(entityName: string): Promise<KnowledgeGraph>
```

### getRootEntities

Get all entities without parents.

```text
async getRootEntities(): Promise<Entity[]>
```

### getEntityDepth

Get depth in hierarchy (0 = root).

```text
async getEntityDepth(entityName: string): Promise<number>
```

### moveEntity

Move entity to new parent.

```text
async moveEntity(entityName: string, newParentName: string | null): Promise<Entity>
```

---

## SearchManager

Provides multiple search strategies.

### searchNodes

Basic text search across entities.

```text
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

```text
async searchNodesRanked(query: string, options?: RankedSearchOptions): Promise<SearchResult[]>
```

### openNodes

Retrieve specific entities by name with their relations.

```text
async openNodes(names: string[]): Promise<KnowledgeGraph>
```

### searchByDateRange

Search entities by creation/modification date.

```text
async searchByDateRange(options: DateRangeOptions): Promise<KnowledgeGraph>
```

### booleanSearch

Boolean query search with AND/OR/NOT operators.

```text
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

```text
async fuzzySearch(query: string, options?: FuzzySearchOptions): Promise<KnowledgeGraph>
```

**Parameters:**
```typescript
import { SearchOptions } from '@danielsimonjr/memoryjs';
interface FuzzySearchOptions extends SearchOptions {
  threshold?: number;  // 0.0-1.0, default 0.7
}
```

### autoSearch

Automatically select and execute the best search method based on query characteristics.

```text
async autoSearch(query: string, limit?: number): Promise<SmartSearchResult>
```

### getSearchSuggestions

Get "did you mean" suggestions.

```text
async getSearchSuggestions(query: string, limit?: number): Promise<string[]>
```

### getSearchCostEstimates

Get cost estimates for a query across search strategies.

```text
async getSearchCostEstimates(query: string): Promise<CostEstimate[]>
```

### Saved Search Methods

```text
async getSavedSearch(name: string): Promise<SavedSearch | null>
async deleteSavedSearch(name: string): Promise<boolean>
async updateSavedSearch(name: string, updates: Partial<SavedSearch>): Promise<SavedSearch>
```

### Cache Management

```text
clearAllCaches(): void
clearFuzzyCache(): void
clearBooleanCache(): void
clearRankedCache(): void
```

### searchByTime (v1.9.0 — Temporal Search)

Natural-language time-range search via `chrono-node`.

```text
async searchByTime(query: string, options?: TemporalSearchOptions): Promise<KnowledgeGraph>
```

Accepts expressions like `"last hour"`, `"yesterday"`, `"between Jan 1 and Feb 1"`. See also `ctx.temporalSearch` for the lower-level `TemporalSearch` instance.

### autoSearch (BM25-incremental, v1.15.0 Phase 1)

Auto-selects the best search strategy for the query (basic / boolean / fuzzy / ranked / semantic / hybrid). BM25 indexing is now incremental — single-entity creates and updates touch only the affected postings list instead of rebuilding the full corpus.

```text
async autoSearch(query: string, options?: SearchOptions): Promise<{
  results: SearchResult[];
  selectedMethod: string;
  selectionReason: string;
}>
```

### Diagnostics (Phase 0/1, v1.15.0)

```text
ctx.searchManager.explainPlan(query: string): ExplainPlanResult   // { ascii: string; json: QueryPlan }
ctx.indexHealth(): IndexHealthReport
ctx.diagnostics(options?: DiagnosticsOptions): DiagnosticsReport  // composes indexHealth() + entity counts
```

`ctx.diagnostics` is a method. Call it as `ctx.diagnostics()`; it is not a property holding a `Diagnostics` object. `explainPlan` is a `SearchManager` method, not a `ctx.diagnostics` member.

---

## GraphTraversal

Graph algorithms and traversal operations.

### findShortestPath

Find shortest path between two entities using Dijkstra's algorithm.

```text
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
import { Relation } from '@danielsimonjr/memoryjs';
interface PathResult {
  path: string[];        // Entity names in order
  relations: Relation[]; // Relations along the path
  length: number;
}
```

### findAllPaths

Find all paths between two entities up to a maximum depth.

```text
async findAllPaths(source: string, target: string, options?: PathOptions): Promise<PathResult[]>
```

### Centrality Methods

Three separate methods for centrality calculation:

```text
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

### findConnectedComponents

Find connected components in the graph.

```text
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

```text
async bfs(startEntity: string, options?: TraversalOptions): Promise<TraversalResult>
async dfs(startEntity: string, options?: TraversalOptions): Promise<TraversalResult>
```

**Returns:**
```typescript
import { Relation } from '@danielsimonjr/memoryjs';
interface TraversalResult {
  visited: string[];
  edges: Relation[];
}
```

### getNeighborsWithRelations

Get all neighbors of an entity with their connecting relations.

```text
async getNeighborsWithRelations(entityName: string, options?: { direction?: 'in' | 'out' | 'both' }): Promise<NeighborResult[]>
```

### HITS Algorithm (v1.15.0 Phase 1)

Hyperlink-Induced Topic Search — computes `hub` and `authority` scores for every entity. Useful for identifying high-quality information sources (high authority) vs. broad connectors (high hub).

```text
async hits(options?: { maxIterations?: number; tolerance?: number }): Promise<Map<string, { hub: number; authority: number }>>
```

### Clique Enumeration (v1.15.0 Phase 1)

Enumerate maximal cliques in the (undirected projection of the) graph via Bron–Kerbosch with pivot selection.

```text
async findMaximalCliques(options?: { minSize?: number; maxCliques?: number }): Promise<string[][]>
```

### Louvain Community Detection (v1.15.0 Phase 1)

Greedy modularity-optimization community detection. Returns each entity's community ID.

```text
async louvainCommunities(options?: { resolution?: number; maxIterations?: number }): Promise<Map<string, number>>
```

---

## IOManager

Import, export, and backup operations.

### exportGraph

Export graph to various formats.

```text
exportGraph(graph: ReadonlyKnowledgeGraph, format: ExportFormat, options?: PiiRedactionOption): string
exportGraphWithCompression(graph: ReadonlyKnowledgeGraph, format: ExportFormat, options?: ExportOptions & PiiRedactionOption): Promise<ExportResult>
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
const graph = await ctx.storage.loadGraph();
const json = ctx.ioManager.exportGraph(graph, 'json');
// Export filtered graph to compressed GraphML
const result = await ctx.ioManager.exportGraphWithCompression(graph, 'graphml', {
  filter: { tags: ['project'] },
  compress: true,
  outputPath: './projects.graphml.br'
});
```

### importGraph

Import graph from various formats.

```text
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

```text
async createBackup(options?: BackupOptions): Promise<BackupInfo>
```

### restoreBackup

Restore from a backup.

```text
async restoreFromBackup(backupPath: string): Promise<RestoreResult>
```

### listBackups

List available backups.

```text
async listBackups(): Promise<BackupInfo[]>
```

### deleteBackup

Delete a backup. Since v1.15.0 (Phase 5) this delegates to `BackupManager.delete()` which adds a symlink-attack guard before the underlying `fs.unlink`.

```text
async deleteBackup(backupId: string): Promise<void>
```

> All five backup methods (`createBackup` / `listBackups` / `restoreFromBackup` / `deleteBackup` / `cleanOldBackups`) are thin facades over [`BackupManager`](#backupmanager) since v1.15.0 Phase 5. Existing callers see no API change.

### ingest (v1.9.0 — Conversation Ingestion; provenance + mode dial, R4b/R5, 3.0.0)

Format-agnostic conversation ingestion pipeline.

```text
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

```text
splitTranscript(content: string, options?: SplitOptions): SplitResult
```

### exportGraph — Linked-Data formats (η.5.4)

In addition to `json` / `csv` / `graphml` / `gexf` / `dot` / `markdown` / `mermaid`, `exportGraph` accepts W3C Linked-Data targets:

```text
async exportGraph(format: 'turtle' | 'rdf-xml' | 'json-ld', options?: ExportOptions): Promise<string>
```

Relation predicates that aren't NCName-compatible fall back to RDF reification (`rdf:Statement` / `rdf:subject` / `rdf:predicate` / `rdf:object`).

---

## TagManager

Manages tag aliases and synonyms.

### addTagAlias

Create a tag alias.

```text
async addTagAlias(alias: string, canonical: string, description?: string): Promise<TagAlias>
```

**Example:**
```typescript
await ctx.tagManager.addTagAlias('js', 'javascript', 'JavaScript shorthand');
```

### resolveTag

Resolve a tag to its canonical form.

```text
async resolveTag(tag: string): Promise<string>
```

### listTagAliases

List all tag aliases.

```text
async listTagAliases(): Promise<TagAlias[]>
```

### removeTagAlias

Remove a tag alias.

```text
async removeTagAlias(alias: string): Promise<boolean>
```

### getAliasesForTag

Get all aliases for a canonical tag.

```text
async getAliasesForTag(canonicalTag: string): Promise<string[]>
```

---

## CompressionManager

Duplicate detection and entity merging.

### findDuplicates

Find potential duplicate entities.

```text
async findDuplicates(threshold?: number): Promise<string[][]>
```

**Parameters:**
- `threshold`: Similarity threshold 0.0-1.0 (default: 0.8)

**Returns:** Groups of potentially duplicate entity names

### mergeEntities

Merge multiple entities into one.

```text
async mergeEntities(entityNames: string[], targetName?: string): Promise<Entity>
```

**Notes:**
- Combines all observations and tags
- Takes highest importance
- Transfers all relations to merged entity

### compressGraph

Automatically find and merge duplicates.

```text
async compressGraph(threshold?: number, dryRun?: boolean): Promise<CompressionResult>
```

---

## AnalyticsManager

Graph statistics and validation.

### getGraphStats

Get graph statistics.

```text
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

```text
async validateGraph(): Promise<ValidationReport>
```

**Returns:**
```typescript
import { ValidationIssue, ValidationWarning } from '@danielsimonjr/memoryjs';
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

```text
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

```text
async listArchives(): Promise<ArchiveInfo[]>
```

### getArchiveDir

```text
getArchiveDir(): string
```

---

## SemanticSearch

Vector similarity search using embeddings. Requires `MEMORY_EMBEDDING_PROVIDER` to be configured.

```text
async isAvailable(): Promise<boolean>
async indexAll(graph: KnowledgeGraph, options?: { forceReindex?: boolean }): Promise<void>
async search(graph: KnowledgeGraph, query: string, limit?: number, minSimilarity?: number): Promise<SemanticResult[]>
async findSimilar(graph: KnowledgeGraph, entityName: string, limit?: number): Promise<SemanticResult[]>
async clearIndex(): Promise<void>
```

---

## ObservationNormalizer

Normalize entity observations by resolving pronouns and anchoring dates.

```text
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

Stages operations and applies them in one full-graph save. Staging methods only record the operation; storage is not touched until `commit()`.

```text
begin(): void                                                  // throws TRANSACTION_ACTIVE if one is open
createEntity(entity: Omit<Entity, 'createdAt' | 'lastModified'>): void
updateEntity(name: string, updates: Partial<Entity>): void
deleteEntity(name: string): void
createRelation(relation: Omit<Relation, 'createdAt' | 'lastModified'>): void
deleteRelation(from: string, to: string, relationType: string): void
async commit(options?: LongRunningOperationOptions): Promise<TransactionResult>
async rollback(): Promise<{ success: boolean; backupUsed?: string }>
isInTransaction(): boolean
getOperationCount(): number
```

**`commit()` semantics:**

1. Creates a backup file (`IOManager.createBackup`). The storage write lock (`graphMutex`) is held from before the backup until the save or rollback ends.
2. Loads a mutable copy and applies every staged operation in order. A throw here saves nothing.
3. Captures the pre-commit graph and calls `saveGraph` once. This is the only persisted write.
4. On success, deletes the backup and returns `{ success: true, operationsExecuted }`.
5. On any failure, calls `rollback()` and returns `{ success: false, error, rollbackBackup? }`. If no save was attempted, storage still holds the pre-commit state and nothing is rewritten. If a save was attempted, the in-memory pre-commit graph is saved back.

`commit()` is O(graph) by design: it rewrites the whole graph. Use `BatchTransaction` or `ctx.batch()` when only a few changes are needed. JSONL storage is single-process: the lock does not coordinate other processes. If rollback fails, the backup file is kept for manual recovery.

---

## BatchTransaction

Fluent API for building batch operations.

```text
createEntity(entity: CreateEntity): BatchTransaction
updateEntity(name: string, updates: Partial<Entity>): BatchTransaction
deleteEntity(name: string): BatchTransaction
createRelation(relation: CreateRelation): BatchTransaction
deleteRelation(relation: Relation): BatchTransaction
addObservations(entityName: string, contents: string[]): BatchTransaction
deleteObservations(entityName: string, contents: string[]): BatchTransaction
async execute(options?: BatchOptions): Promise<BatchResult>
// BatchOptions: { stopOnError?: boolean; validateBeforeExecute?: boolean; signal?: AbortSignal }
```

`ctx.batch(fn, options)` builds a `BatchTransaction` and calls `execute()`. If `fn` throws, the queued operations are discarded and `execute()` is not called.

**`execute()` semantics:**

- Holds `graphMutex` from the graph load until the save ends.
- `validateBeforeExecute` (default `true`): validates all operations first. A validation failure saves nothing.
- `stopOnError` (default `true`): the first failing operation stops the batch. Nothing is saved, so the batch is all-or-nothing for the write.
- `stopOnError: false`: failing operations are skipped and reported per operation in `operationResults`. The successful ones are saved in one write, so the result can be a partial success.
- The save is one `saveGraph` call. A save failure returns `success: false` with `Failed to save graph: ...`.
- `signal` cancels only while the call waits for the lock. After the lock is acquired, the batch runs to completion.

Use this for atomic multi-operation writes. `GovernanceManager.withTransaction` is not atomic (see below). JSONL storage is single-process.

---

## StorageFactory

Create storage backend instances.

```text
createStorage(config: { type: 'jsonl' | 'sqlite' | 'postgres' | 'postgresql'; path: string }): IGraphStorage
createStorageFromPath(path: string): IGraphStorage
```

(Free functions, not static class methods — `MEMORY_STORAGE_TYPE` overrides `config.type` when set.)

`IGraphStorage` gained two optional members (v2.9.0) so existing third-party/test implementations remain valid without changes: `renameEntity?(oldName, newName): Promise<Entity>` (storage-level rename primitive; both `GraphStorage` and `SQLiteStorage` implement it) and `readonly events?: GraphEventEmitter` (also now implemented by `SQLiteStorage`, giving it full event parity with `GraphStorage` — `graph:loaded`/`saved`, `entity:created`/`updated`/`deleted`, `relation:created` — so event-driven derived views like `TFIDFEventSync` and `GraphRankPrior` work on the SQLite backend too). `SQLiteStorage` also gained the `graphMutex` member already present on `GraphStorage` (fixes a crash in batch manager mutations against the raw SQLite backend).

---

## Batch primitives and helper surface

Added in the 2026-11 design pass. Each entry is additive; existing signatures are unchanged.

### Shared env helpers (`src/utils/envConfig.ts`, `@public`)

Each helper encodes one env-parsing idiom. Call sites keep their previous accept/reject rules.

| Helper | Contract |
|---|---|
| `readEnvStrictFlag(name)` | `true` only for the exact string `'true'` |
| `readEnvLooseFlag(name, defaultValue)` | Case-insensitive `'true'`; unset returns `defaultValue` |
| `readEnvNumber(name, defaultValue, bounds?)` | `bounds`: `{ min?, max?, integer? }`. Invalid or out-of-range input logs and falls back to `defaultValue` |
| `readEnvNumberOrUndefined(name)` | Finite number, or `undefined` |
| `parseStrictDecimalInt(raw, bounds?)` | Accepts only `^(0\|[1-9][0-9]*)$`. Returns `undefined` on rejection. Never throws or logs |
| `readEnvStrictInt(name, bounds?)` | `parseStrictDecimalInt` applied to `process.env[name]` |
| `parseSegmentCount(raw)` | Strict integer in `[2, MAX_SEGMENT_COUNT]` (1024), or `null` |
| `readEnvPositiveIntOrDefault(name, defaultValue)` | Lenient `parseInt`, minimum 1. `'10abc'` gives 10 |
| `readEnvNonNegativeIntOrDefault(name, defaultValue)` | Lenient `parseInt`, minimum 0 |

The lenient helpers are kept lenient on purpose. Tightening them would change behaviour for existing deployments.

### Storage capability guards (`src/core/storageCapabilities.ts`)

Re-exported from the core barrel. The module is tagged `@internal`, so treat these names as not yet stable.

- `hasDeltaPrimitives(storage): storage is DeltaCapableStorage`: true when all batch delta primitives are present.
- `hasWriteLock(storage): storage is WriteLockableStorage`: true when `graphMutex.acquire` exists.
- `withStorageWriteLock(storage, fn)`: runs `fn` under `graphMutex` when present, otherwise runs it directly. The lock is released in `finally`.

Both first-party backends pass the guards. Minimal fakes usually do not, and managers fall back to the per-item path for them.

### `ConsolidationPipeline.promoteMemories(entityNames, targetType)`

```text
async promoteMemories(
  entityNames: readonly string[],
  targetType: MemoryType
): Promise<{ promoted: AgentEntity[]; errors: Array<{ entityName: string; error: string }> }>
```

Each name is validated and reported on its own, so one failing name does not block the others. Error text matches `promoteMemory`. With delta-capable storage the writes are batched into one update per call. A repeated name in one call fails as a second `promoteMemory` would.

### `DecayEngine.reinforceMemories(entityNames, options?)`

Batch form of `reinforceMemory`. All names must exist: a missing name throws `Entity not found: <name>` before any write. Access tracking runs through `AccessTracker.recordAccessBatch`. `options.alreadyApplied: true` skips the reinforcement write when the caller already persisted it (for example, folded into a promotion), and access tracking still runs.

### `AccessTracker.recordAccessBatch(names, context)`

Records the same access context for many entities. With delta-capable storage, all access fields are written in one `updateEntities` call, and a failed batch is retried per entity. Without delta primitives it runs `recordAccess` for each name in parallel.

### Conditional prospective memory (`ProspectiveMemoryManager`)

Conditional triggers (`scheduleConditional`) are evaluated by `tick()` through a code-supplied evaluator. There is no env var and no built-in predicate language.

```typescript
import { ProspectiveMemoryManager } from '@danielsimonjr/memoryjs';
declare const storage: import('@danielsimonjr/memoryjs').IGraphStorage;
declare const predicateEvaluator: import('@danielsimonjr/memoryjs').PredicateEvaluator;
import { ManagerContext } from '@danielsimonjr/memoryjs';
import type { ProspectiveEntity } from '@danielsimonjr/memoryjs';
type PredicateEvaluator = (
  predicate: string,
  context: { entity: ProspectiveEntity; now: Date }
) => boolean | Promise<boolean>;

const pm = new ProspectiveMemoryManager(storage, { predicateEvaluator });
// or
const ctx = new ManagerContext({
  storagePath: './memory.jsonl',
  prospectivePredicateEvaluator: (predicate, { entity, now }) => /* boolean */ true,
});
```

- Only the boolean `true` fires the intention. A throw or rejection counts as not due and is logged once per intention.
- `checkIntervalMs` on the trigger limits how often the evaluator runs. Each check that finds the intention not due is persisted as `lifecycle.lastCheckedAt` on the pending entity. Without `checkIntervalMs` nothing is written on a not-due check.
- With no evaluator, `scheduleConditional` persists the intention, logs a one-time warning, and the intention never fires.

`ManagerContextOptions.prospectivePredicateEvaluator` forwards the evaluator to `ctx.prospectiveMemory`.

### Deprecated: `CompressedCache`

`CompressedCache` (`src/utils/compressedCache.ts`) is `@deprecated`. Use `CompressedMap<K, V>` (`src/utils/compression/CompressedMap.ts`), which `ManagerContext` already uses for `compressedEntityCache`. `CompressedCache` has no behaviour change and is scheduled for removal in v5.

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
import { Entity } from '@danielsimonjr/memoryjs';
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
import { AgentEntity } from '@danielsimonjr/memoryjs';
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
import { Entity, Relation } from '@danielsimonjr/memoryjs';
interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

### SearchResult

```typescript
import { Entity } from '@danielsimonjr/memoryjs';
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

```text
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

### Procedural Graph types (`src/types/proceduralGraph.ts`)

Leaf contracts for the Procedural Graph feature (`@experimental`). This file
imports only sibling `src/types` modules (no Zod, hashing, or storage). Types
are re-exported from `src/types/index.ts`, `src/agent/procedural/graph/index.ts`,
and the agent barrel. See the file for `PGNode`, `PGEdge`, `PGSnapshot`,
`PGEditSet`, `PGCyclePolicy`, `PGHead`, `PGRejectionRecord`, and related
unions — do not treat this section as a copy of that module.

---

## BackupManager

(v1.15.0 Phase 5) Backup lifecycle extracted from `IOManager`. Accessed via `ctx.ioManager` (delegating facade) or directly via the constructor if you need finer-grained control.

### create

```text
async create(options?: BackupOptions): Promise<BackupResult>
```

### list

```text
async list(): Promise<BackupInfo[]>
```

### restore

Reads, optionally Brotli-decompresses, and writes the backup payload over the live storage file. Rejects symbolic links via `fs.lstat().isSymbolicLink()`.

```text
async restore(backupPath: string): Promise<RestoreResult>
```

### delete

Validates the path stays in `backupDir`, rejects symlinks, unlinks the backup, then attempts to remove the `.meta.json` sidecar (derived via `path.basename` + revalidated independently).

```text
async delete(backupPath: string): Promise<void>
```

### cleanOld

Keeps the N most recent backups; deletes the rest via `delete()`.

```text
async cleanOld(keepCount?: number): Promise<number>
```

---

## MemoryEngine

(v1.11.0) Turn-aware conversation memory composing over `EpisodicMemoryManager` + `WorkingMemoryManager`. Wired via `ctx.memoryEngine` (lazy getter).

### addTurn

Dedup-first write. Runs the four-tier dedup chain (exact contentHash → 50% prefix overlap → token Jaccard ≥ `MEMORY_ENGINE_JACCARD_THRESHOLD` → optional semantic). Emits `memoryEngine:turnAdded` or `memoryEngine:duplicateDetected`.

```text
async addTurn(content: string, opts: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  agentId?: string;
}): Promise<AddTurnResult>
```

### checkDuplicate

Run the dedup chain without writing.

```text
async checkDuplicate(content: string, sessionId: string): Promise<DuplicateResult | null>
```

### getSessionTurns

Chronological turns for a session.

```text
async getSessionTurns(
  sessionId: string,
  opts?: { role?: 'user' | 'assistant' | 'system' | 'tool'; limit?: number }
): Promise<AgentEntity[]>
```

### getRepeatedTurnCount

Number of turns that the dedup chain rejected for a session in this process. The count is not persisted. `deleteSession` resets it. Exclusion-manager rejections are not counted.

```text
getRepeatedTurnCount(sessionId: string): number
```

### deleteSession / listSessions

```text
async deleteSession(sessionId: string): Promise<{ deleted: number }>
async listSessions(): Promise<string[]>
```

### Events

`MemoryEngine` is a `node:events.EventEmitter`. Subscribe to `memoryEngine:turnAdded`, `memoryEngine:duplicateDetected`, `memoryEngine:sessionDeleted`.

### ImportanceScorer (companion)

Integer [0, 10] scoring via `length × keyword × recent-turn-overlap` signals. Configurable via `MEMORY_ENGINE_LENGTH_WEIGHT` / `KEYWORD_WEIGHT` / `OVERLAP_WEIGHT` / `RECENT_TURNS`.

---

## GovernanceManager

(v1.6.0; enforcement chokepoint, Sec1, 3.0.0) Policy enforcement and audit logging for memory mutations. Wired via `ctx.governanceManager`.

### withTransaction

Groups operations under one governed scope for audit attribution. **It is not an atomic transaction.** Each operation persists immediately. If `fn` throws, the audit entries recorded in the call are marked `rolled_back` (new `rolled_back` entries are appended) and the error is re-thrown. **Storage is not reverted.** For atomic multi-operation writes use `ctx.batch()` or `TransactionManager.commit()`.

```text
async withTransaction<T>(fn: (tx: GovernanceTransaction) => Promise<T>, agentId?: string): Promise<T>
```

### rollback

Reverses one recorded operation, identified by its audit entry id. It loads the graph and undoes the recorded change (a `create` is undone by deleting the entity; a `delete` is undone by recreating the entity from the entry's before snapshot), saves the graph, and appends a `rolled_back` audit entry. An unknown id throws `KnowledgeGraphError` with code `AUDIT_ENTRY_NOT_FOUND`. It is not invoked automatically by `withTransaction`.

```text
async rollback(auditEntryId: string): Promise<void>
```

### setPolicy / GovernancePolicy (interface)

```text
setPolicy(policy: GovernancePolicy): void

interface GovernancePolicy {
  canCreate?(entity: Omit<Entity, 'createdAt' | 'lastModified'>): boolean;
  canUpdate?(entity: Entity, updates?: Partial<Entity>): boolean;
  canDelete?(entity: Entity): boolean;
}
```

Consulted before every mutation the manager handles; a hook returning `false` throws and rolls back the transaction. All three hooks are optional — an absent hook allows the operation.

### Constructor options — `redactAuditSnapshots` (Sec6)

```text
new GovernanceManager(storage: GraphStorage, auditLog: AuditLog, options?: {
  redactAuditSnapshots?: boolean;  // default false — PII-redact before/after snapshots before they hit the audit log
  redactor?: PiiRedactor;          // custom redactor; defaults to new PiiRedactor()
})
```

The live graph is never mutated — only the audit-log copies are redacted.

### Enforcement chokepoint (Sec1, 3.0.0)

`MEMORY_GOVERNANCE_ENABLED` was previously read nowhere in `src/`, so setting it did nothing and no mutation path was governed. Now, when it is the strict literal `'true'` (checked once at first `ctx.entityManager` access), `ManagerContext` wires this manager's live policy + audit log directly into `EntityManager` via `EntityManager.setGovernanceHooks()` — so `createEntities`/`updateEntity`/`batchUpdate`/`deleteEntities`/`renameEntity` are policy-checked (`GovernanceError` on denial) and audited (fire-and-forget; an audit-sink failure never fails the underlying write) without requiring the caller to route writes through `withTransaction`. Policy is read live via `getPolicy()`, so a `setPolicy()` call after construction takes effect on the next mutation. Unset env var = zero checks, zero audit calls on `EntityManager` (pre-Sec1 behavior); `ctx.governanceManager` remains usable manually via `withTransaction` either way.

---

## FreshnessManager

(v1.6.0) Wired via `ctx.freshnessManager`.

```text
calculateFreshness(entity: Entity, now?: Date): FreshnessScore
async getStaleEntities(threshold?: number): Promise<Entity[]>
async getExpiredEntities(): Promise<Entity[]>
async generateReport(): Promise<FreshnessReport>
```

`FreshnessScore.score ∈ [0, 1]` combines `Entity.ttl` (absolute time-to-live in ms) and `Entity.confidence` (belief strength). Used by `SalienceEngine` and `DecayEngine`.

---

## RbacMiddleware + RoleAssignmentStore

(η.6.1) Available in code via `ctx.rbacMiddleware` and `ctx.roleAssignmentStore` (lazy getters, always present). RBAC is not enabled by an environment variable; `checkPermission` is called by your own code.

```text
// Synchronous decision. Denies when no active assignment matches.
ctx.rbacMiddleware.checkPermission(
  agentId: string,
  action: Permission,            // 'read' | 'write' | 'delete' | 'manage'
  resourceType: ResourceType,    // e.g. 'entity', 'relation'
  resourceName?: string,         // exact name or slash-delimited descendant
  now?: string,                  // ISO 8601; defaults to the current time
): boolean

// Async grant and revoke; list reads are synchronous.
ctx.roleAssignmentStore.assign(assignment: RoleAssignment): Promise<void>
ctx.roleAssignmentStore.revoke(agentId: string, role: Role): Promise<void>
ctx.roleAssignmentStore.list(agentId: string): RoleAssignment[]
ctx.roleAssignmentStore.listActive(agentId: string, now?: string): RoleAssignment[]
ctx.roleAssignmentStore.hydrate(): Promise<void>   // load persisted assignments
```

`ctx.roleAssignmentStore` persists through its own sidecar when storage is file-backed; it does not read a `MEMORY_RBAC_*` environment variable.

---

## ProcedureManager + CausalReasoner + WorldModelManager + ActiveRetrievalController

(3B.4–3B.7) See dedicated component docs in [`COMPONENTS.md`](./COMPONENTS.md). Brief surface:

```text
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

## ProceduralGraphManager

(`@experimental`) Self-evolving execution graphs. Not a lazy getter — obtain via `ctx.createProceduralGraph(config)` (see [ManagerContext](#managercontext)). Public facade in `src/agent/procedural/graph/ProceduralGraphManager.ts` (2026-09-10 dependency graph). Leaf types live in `src/types/proceduralGraph.ts` and are re-exported.

`cyclePolicy` defaults to `reject`, or `repair` when `paperCompatible` is true. `createSkeleton` delegates to `createGraph` and therefore audits as `createGraph`. `canEvolve === false` returns `stoppedBecause: 'aborted'`. `listRejections` strips `trajectoryRefs`. The caller supplies `rollout`, `evaluate`, `refiner`, and `tokenizer` to `evolve`; the library never executes guidance text.

```text
async createGraph(input: {
  graphId: string;
  nodes: PGNode[];
  edges: PGEdge[];
  entryNodeId?: string;
  relationVocabulary?: string[];
  cyclePolicy?: PGCyclePolicy;
  toolCatalog?: string[];
}): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>

async createSkeleton(input: {
  graphId: string;
  toolCatalog?: string[];
  cyclePolicy?: PGCyclePolicy;
}): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>

async getGraph(graphId: string, revisionId?: string): Promise<ProceduralGraph | undefined>
async openSession(
  graphId: string,
  options: PGSessionOptions & { revisionId?: string },
): Promise<ProceduralGraphSession | undefined>
async prepareCandidate(
  graphId: string,
  edits: PGEditSet,
  options?: {
    cyclePolicy?: PGCyclePolicy;
    enforceToolCatalog?: boolean;
    toolCatalog?: string[];
    staticMode?: boolean;
  },
): Promise<
  | { ok: true; candidate: ProceduralGraph; repairs: PGEdge[]; diagnostics: PGDiagnostic[] }
  | { ok: false; diagnostics: PGDiagnostic[]; repairs: PGEdge[] }
>

async evolve(options: PGEvolutionOptions, deps: PGEvolutionDependencies): Promise<PGEvolutionResult>
// deps: { rollout, evaluate, refiner, tokenizer }

listRevisions(
  graphId: string,
  page?: { offset?: number; limit?: number },
): Promise<{
  items: Array<{ revisionId: string; parentRevisionId?: string; graphDigest: string; createdAt: string }>;
  total: number;
}>
async listRejections(
  graphId: string,
  page?: { offset?: number; limit?: number },
): Promise<{
  items: Array<Omit<PGRejectionRecord, 'trajectoryRefs'> & { trajectoryRefs?: undefined }>;
  total: number;
}>

async rollback(
  graphId: string,
  revisionId: string,
  expectedHeadVersion: number,
): Promise<PGCommitResult | { status: 'not-found' }>
async exportGraph(graphId: string, revisionId?: string): Promise<string | undefined>
async importGraph(
  document: string,
  options?: { graphId?: string; toolCatalog?: string[]; enforceToolCatalog?: boolean },
): Promise<{ ok: true; head: PGHead } | { ok: false; diagnostics: PGDiagnostic[] }>
async dispose(): Promise<void>
```

**Example:**
```text
const pg = await ctx.createProceduralGraph({
  backing: { type: 'jsonl' }, // sidecar <basename>-procedural-graph.jsonl
});
await pg.createGraph({ graphId: 'checkout', nodes, edges });

const session = await pg.openSession('checkout', {
  taskDescription: 'Complete checkout',
  toolCatalog: ['pay'],
});
const tip = await session?.guidance('what next?');

const evolved = await pg.evolve({
  graphId: 'checkout',
  mode: 'static_incremental',
  trainingTasks, validationTasks,
  batchSize: 4, maxRounds: 3, maxTokens: 2000,
  cyclePolicy: 'reject', paperCompatible: false,
  toolCatalog: ['pay'], taskDescription: 'Complete checkout',
  taskFailurePolicy: 'fail-round',
}, { rollout, evaluate, refiner, tokenizer });
```

---

## IMemoryBackend

(v1.12.0) Pluggable backend interface for `MemoryEngine`. Selected via `MEMORY_BACKEND=sqlite|in-memory` and accessed via `ctx.memoryBackend`.

```typescript
import type { MemoryTurn, GetWeightedOptions, WeightedTurn } from '@danielsimonjr/memoryjs';
interface IMemoryBackend {
  add(turn: MemoryTurn): Promise<void>;
  get_weighted(query: string, sessionId: string, options?: GetWeightedOptions): Promise<WeightedTurn[]>;
  delete_session(sessionId: string): Promise<void>;
  list_sessions(): Promise<string[]>;
}
```

`SQLiteBackend` wraps `MemoryEngine` (and transparently spans JSONL + SQLite per `MEMORY_STORAGE_TYPE`). `InMemoryBackend` is ephemeral; suitable for tests and short-lived processes.

---

## GraphRankPrior + HybridSearchManager

(v2.9.0 — knowledge-graph-as-core convergence) Graph-connectivity as a first-class ranking signal. All new weights/options default to `0`/off with behavior identical to before they existed. See `docs/architecture/KNOWLEDGE_GRAPH_CORE_FEASIBILITY.md`.

### GraphRankPrior

`@experimental`. Cached graph-connectivity ranking signal: normalized PageRank over `GraphTraversal`, with a degree-only fallback beyond `maxPageRankEntities` (default 50 000). Event-invalidated (per-item entity/relation events + `graph:saved`, which covers manager-level batch mutations). Wired via `ctx.graphRankPrior` (lazy getter).

```text
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

```text
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

```text
setGraphPrior(prior: GraphRankPrior | null, boost?: number): void
```

Multiplies each result's score by `score × (1 + boost × normalizedPageRank)` and re-sorts. No-op when no prior/boost is configured (the default). `ManagerContext` wires this automatically when `MEMORY_RANKED_GRAPH_BOOST > 0`.

### Related env vars

`MEMORY_HYBRID_GRAPH_WEIGHT`, `MEMORY_RANKED_GRAPH_BOOST`, `MEMORY_SALIENCE_CONNECTIVITY_WEIGHT`, `MEMORY_DECAY_CONNECTIVITY_PROTECTION` (see [CLAUDE.md](../../CLAUDE.md) for the full table).

---

## EventManager

(3.0.0 — R1, `@experimental`) Reifies actions as first-class `entityType: 'event'` hub entities with role-typed relations. Wired via `ctx.eventManager`.

### recordEvent

```text
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

```text
async getEvent(name: string): Promise<EventRecord | null>
async queryEvents(filter?: EventQueryFilter): Promise<EventRecord[]>
async getFlow(flowKey: string): Promise<EventRecord[]>            // chronological, by flow tag
async whoDidWhat(filter?: WhoDidWhatFilter): Promise<WhoDidWhatEntry[]>
```

Queries use the storage `TypeIndex`/`RelationIndex` — O(k)/O(1), no full-graph scans.

**Example:**
```text
await ctx.eventManager.recordEvent({
  action: 'deployed', actor: 'alice', target: 'api-service',
  context: 'production', flowKey: 'release-42',
});
const flow = await ctx.eventManager.getFlow('release-42');
const who = await ctx.eventManager.whoDidWhat({ target: 'api-service' });
```

---

## EvidencePathBuilder

(3.0.0 — R2, `@experimental`) Builds traceable graph paths from search-query anchors to a result entity — the "why" behind a hit. Constructed per search call when `explain: true` is requested; not exposed as a `ManagerContext` getter.

```text
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

(3.0.0 — R3, `@experimental`) Three-tier "Janitor" pass for relation-level deduplication and neighborhood validation. Not wired into `ManagerContext` — construct directly.

```text
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

(3.0.0 — Sec9) Reference authentication layer wiring `APIKeyStore.validate()` into `RestRouter`.

```text
new ApiKeyAuthMiddleware(options: {
  store: APIKeyStore;
  requiredScopes?: (method: RestMethod, path: string) => readonly string[];  // default: GET → [] (['entities:read'] for a key with projectIds), others → ['entities:write']
  onReject?: (info: { reason: string; method: RestMethod; path: string }) => void;
})

extractKey(req: RestRequest): string | null       // Authorization: Bearer <key>, falls back to X-Api-Key
authenticate(req: RestRequest): { ok: true; auth: AuthContext } | { ok: false; response: RestResponse }

interface AuthContext { keyId: string; scopes: readonly string[]; ownerId?: string; projectIds?: readonly string[] }
```

`APIKeyStore.issue({ projectIds })` scopes a key to projects; the default `RestRouter` routes then filter list and search before pagination, return 404 for direct reads and deletes outside those projects, and require an allowed `projectId` on create. A key without `projectIds` keeps full access. `RestRouterOptions` also accepts `preAuthLimiter`, `rateLimiter`, `bodyTimeoutMs` and `limits`. See the security guide section "REST tenancy and request budgets".

`401 { error: 'unauthorized' }` for a missing/unknown/revoked/expired key — the specific rejection reason is intentionally not serialized to the client (available server-side via `onReject` for logging). `403 { error: 'forbidden', requiredScopes }` for a valid key lacking a required scope.

**Example:**
```text
const store = new APIKeyStore();
const auth = new ApiKeyAuthMiddleware({ store });
const router = RestRouter.withDefaults(ctx, { auth });
```

---

## Evaluation (Recursa RS-25/26/27)

`@experimental`. Exported from `src/agent` (`src/agent/evaluation/`).

```typescript
declare const provider: import('@danielsimonjr/memoryjs').LLMProvider;
import { Evaluator, DeterministicJudge, LLMRubricJudge, stratifiedSplit, auditRubrics } from '@danielsimonjr/memoryjs';
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
declare const solver: import('@danielsimonjr/memoryjs').Solver;

const { train, test } = stratifiedSplit(tasks, { testFraction: 0.3, by: 'difficulty', seed: 7 });
const judge = new LLMRubricJudge({ provider }); // falls back per criterion to DeterministicJudge
const { metrics, feedback } = await new Evaluator().evaluate(test, solver, judge, { concurrency: 4 });
const issues = auditRubrics(tasks); // placeholder | files | contradicts (advisory) | omits | admits
```

- `DeterministicJudge`: `fact`/`document` match whole words over normalized text (diacritics folded, `U.S.A.` = `USA`); `number` takes the first number (a sign only after start, whitespace or `(`; invalid tolerance → 0 with a note); `free` never passes.
- `LLMRubricJudge`: zod-validated JSON verdicts; malformed output, provider errors and aborts fall back per criterion. On abort it settles at once even if the provider ignores the signal.
- `Evaluator.evaluate` / `stratifiedSplit` throw on duplicate task ids. A non-finite or negative weight becomes 1 with the note `invalid weight; using 1`; a zero weight counts toward `allPass` only.
- `ContextWindowManager.wakeUp({ knowledge, taskHint })` (RS-27): shared instructions extend L0 and matched skill bodies extend L1, each within the budget left in its layer. `KnowledgeRepository.loadForContext({ sections })` loads only the listed sections (default all). `AgentMemoryManager.setKnowledgeRepository(repo)` + `wakeUp(options)` use the stored repository when `options.knowledge` is absent.

---

## Learning loop (Recursa RS-14..RS-18, RS-22, RS-23)

`@experimental`. Exported from `src/agent` (`src/agent/learning/`); wired as `ctx.learningLoop(deps)`.

```typescript
declare const taskId: string;
declare const answer: string;
declare const traceAddrs: string[];
declare const solver: import('@danielsimonjr/memoryjs').LearningSolver;
declare const judge: import('@danielsimonjr/memoryjs').DeterministicJudge;
declare const publishDir: string;
declare const interactionLog: import('@danielsimonjr/memoryjs').InteractionLog;
declare const taskIds: string[];
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
const loop = ctx.learningLoop({ solver, judge, publishDir, interactionLog });
const result = await loop.learn({ taskIds, tasks, budget: { maxRounds: 3 } });
// result.stoppedBecause: 'all-pass' | 'no-progress' | 'budget-rounds' | 'budget-tokens' | 'budget-time' | 'aborted'
// result.report: LearningReport (rework, stalls, signals, tokens and wall-clock per phase)

// Step-wise, one harness tool call at a time:
const { traceId } = await loop.start({ taskIds, tasks, budget: { maxRounds: 3 } });
let step = await loop.next(traceId);          // { kind: 'solve' | 'judge' | 'done', ... }
await loop.submit(traceId, 'solve', { [taskId]: { answer, traceAddrs } });
const status = await loop.status(traceId);    // LeafState + { report }
```

- Each `learningLoop()` call returns a fresh, independent loop (own `LeafLearner` and `Diagnoser`). All run state, including failure-record dedup ids (`traceId + taskId + round`), lives on the run's `learning_trace` entity, so loops can resume each other's runs.
- Single driver per run: saves are compare-and-swap on `stateRev`; a concurrent driver gets `LeafLearner: stale state (expected rev N)` and should reload and retry.
- `submit` rejects an empty payload or a malformed result (`TypeError`). `null` marks a failed solve or judge call.
- Apply: `conflict` records `apply-conflict: …` and starts the next round from live `K`; `rejected` records `apply-rejected: failedOpIndex=…` and stops `no-progress`; a publish failure records `publish-failed: …`. None of these throw. Apply is idempotent across crashes.
- Validation reuses one persisted plan; if live `K` moves mid-validation the revision is rejected (`validation-stale`).
- `deps.interactionLog` feeds the `Diagnoser`'s trace excerpts and keeps solve trace addresses on trace actions (`includeTraceAddrs` overrides).
- Learned skills carry `task:<id>` in `scope.tasks`; every load for a task passes `includeSkillIds` (from `skillIdsForTasks`) so the skill is loaded regardless of lexical score. `loadForContext({ includeSkillIds, maxSkills })` — `maxSkills` defaults to 20; the token budget still bounds the output.

## Recursive learner (Recursa RS-19..RS-21)

`@experimental`. Exported from `src/agent` (`src/agent/learning/`); driven through `ctx.learningLoop(deps)`.

```typescript
declare const solver: import('@danielsimonjr/memoryjs').LearningSolver;
declare const judge: import('@danielsimonjr/memoryjs').DeterministicJudge;
declare const llmProvider: import('@danielsimonjr/memoryjs').LLMProvider;
declare const taskIds: string[];
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
const loop = ctx.learningLoop({ solver, judge, llmProvider });
const result = await loop.learn({ taskIds, tasks, budget: { maxRounds: 3, maxTokens: 50_000 }, split: 'auto' });

// Step-wise (e.g. children hosted by a subagent runner):
const { traceId } = await loop.start({ taskIds, tasks, budget: { maxRounds: 3 }, split: 'byCategory' });
const { childTraceIds } = await loop.plan(traceId);
// drive each child (loop.childDriver(id)), then:
for (const id of childTraceIds) await loop.submitChild(traceId, id); // child must be in phase 'done'
const merged = await loop.merge(traceId);   // { verdict, applied, fixed, regressed, notes }
const decision = await loop.reflect(traceId); // { decision: 'continue' | 'done', stop?, keyInsights }
```

- `split(name, tasks, ctx)`: `byCategory`, `byFailureMode` (uses the previous round's diagnoses and feedback), `bySkill` (top `skillMatch`), `byTool`, `auto` (most balanced; a single-subset partition ranks last; tie-break by the `prefer-split:<name>` insight). A one-subset result falls through to the next strategy; if all give one subset the node runs one forced leaf child.
- Children learn over a `ChildKnowledgeOverlay` and never write live `K`. Each child gets `floor(remainingTokens / children)` tokens and the remaining wall-clock; the parent stops `budget-tokens` / `budget-time` between child completions.
- `merge`: `RevisionMerger` dedupes near-duplicate adds, reconciles same-target updates (per-child folding, disjoint fields merged, `[conflict]` notes name only losers) and generalizes adds (same kind, overlapping domains, description Jaccard ≥ 0.5); the result is validated on a stratified sample and applied with OCC. After an apply, all tasks are evaluated once on live `K`; that pass map is the run's `after`. An `apply-conflict` rebases the next round; the run stops only on budget.
- `reflect`: one `learning` reflection per round (idempotent), `no-progress` when the merge was not applied or fixed nothing live, `all-pass` only from the live evaluation.
- `next` / `submit` throw for a recursive trace and name `plan` / `submitChild` / `merge` / `reflect`.

## Bootstrapping (Recursa RS-10..RS-13)

`@experimental`. Exported from `src/agent` (`src/agent/bootstrap/`); wired as `ctx.bootstrapper(deps)`.

```typescript
declare const llmProvider: import('@danielsimonjr/memoryjs').LLMProvider;
declare const sources: import('@danielsimonjr/memoryjs').CorpusSource[];
declare const solver: import('@danielsimonjr/memoryjs').LearningSolver;
declare const judge: import('@danielsimonjr/memoryjs').DeterministicJudge;
const boot = ctx.bootstrapper({ llmProvider });
const out = await boot.run({ sources, solver, judge, budget: { maxRounds: 2 }, corpusLabel: 'invoices', taskCount: 40 });
// out: navigation map, coverage records, notesSkillId, practice tasks + rubric audit, optional learn result
```

- `CorpusMapper.map(sources)`: one navigation leaf per `ref` (first text wins; a different repeat is a conflict recorded once per call), folded into summary levels. A loader must resolve to a string; refs must be non-empty and at most 493 characters (`MAX_REF_CHARS`). All are `ValidationError`s.
- `BoundaryRecorder.record({ region, status })` keeps the original region name; two distinct regions with the same slug throw a `ValidationError` naming both.

## Harness / MCP tool adapter (Recursa §3.8)

`createRecursaTools(ctx, deps)` (`src/adapters/RecursaToolAdapter.ts`, `@experimental`) is the reference
JSON-in/JSON-out surface a downstream MCP server or Claude Code plugin wraps one-to-one. It is stateless,
`call` never throws, and failures return `{ ok: false, error: { code, message } }` (`RecursaToolResult`; the
descriptor type is `RecursaToolDescriptor`, and the old `ToolResult` / `ToolDescriptor` names remain as
`@deprecated` aliases exported from the adapter module only). Codes:

| Code | Meaning |
|---|---|
| `invalid_args` | zod validation (every object is strict: unknown keys fail), a `__proto__` / `constructor` / `prototype` key anywhere in the arguments, library validation (`RangeError` / `TypeError` / `ValidationError`), a refused skills `dir`, unknown `eval.run` answer ids, a judge result with an unknown `criterionId` |
| `not_found` | unknown trace (or child trace) |
| `invalid_state` | protocol misuse: leaf/recursive mismatch, an out-of-phase or duplicate submit, a non-pending task id, a child that is not part of the round or not done, a stale-state race |
| `not_configured` | log tools without `deps.interactionLog`; skills tools without `deps.publishDir` |
| `solver_required` | `merge` (or another solver-backed call) without `deps.solver` |
| `aborted` / `unknown_tool` | the signal fired / no such tool |
| `internal_error` | a real bug; a library `KnowledgeGraphError` keeps its own code instead |

The skills tools are confined to `deps.publishDir`: without `dir` they target `publishDir` itself; a `dir`
must be a relative subpath strictly below it and goes through the `SkillPublisher` confinement (`..`,
absolute paths, symlinked directories resolving outside, `/proc` / `/sys` / `/dev` are refused before
anything is created). `SkillPublisher` itself takes `{ root }` (default `process.cwd()`; `ctx.skillPublisher`
uses `ManagerContextOptions.skillPublishRoot`) and throws `ValidationError` with `errors[0] = 'dir:<reason>'`
(`path-traversal`, `outside-root`, `is-root`, `symlink-escape`, `special-filesystem`).
`recursa.learn.next` returns the `StepRequest` verbatim so the harness runs solves itself; every other success
is bounded to `maxBytes` (default 64 KiB) and carries `truncated: true` when shrunk.

| Tool | Library call |
|---|---|
| `recursa.knowledge.load` | `ctx.knowledgeRepository.loadForContext({ role, taskHint, budgetTokens, sections, includeSkillIds, maxSkills })` |
| `recursa.skills.publish` | `new SkillPublisher(storage, skillManager, { root }).publish(publishDir[/dir], { snapshotId })`; needs `deps.publishDir` |
| `recursa.skills.import` | the same publisher's `importSkills(publishDir[/dir])`; returns the `ImportReport` (conflicts included) |
| `recursa.learn.start` | `ctx.learningLoop(deps).start(opts)` (leaf or recursive, chosen as in `learn`) |
| `recursa.learn.next` | `loop.next(traceId, { signal })`: `solve` / `judge` `StepRequest`, or `done` |
| `recursa.learn.submit` | `loop.submit(traceId, 'solve' \| 'judge', payload)` |
| `recursa.learn.plan` | `loop.plan(traceId)` |
| `recursa.learn.submitChild` | `loop.submitChild(traceId, childTraceId, failure?)` |
| `recursa.learn.merge` | `loop.merge(traceId, { signal })`; needs `deps.solver` (else `solver_required`) |
| `recursa.learn.reflect` | `loop.reflect(traceId)` |
| `recursa.learn.status` | `loop.status(traceId)` (state plus `LearningReport`) |
| `recursa.log.append` | `deps.interactionLog.append({ sessionId, kind, tag?, content, ts? })`; `tokens` is validated and echoed, not stored (the log has no token field) |
| `recursa.log.select` | `deps.interactionLog.select(addr, { regex?, lines?, fields? })`: the excerpt only |
| `recursa.eval.run` | `new Evaluator().evaluate(tasks, solver, judge, { knowledge?, concurrency? })` with `solver` = `answers[task.id]`; judge = `deps.judge` or `DeterministicJudge`; answers for unknown ids are `invalid_args`, tasks without an answer fail with the note `no answer` and are listed in `missing` |

```ts
import { createRecursaTools } from '@danielsimonjr/memoryjs';
declare const interactionLog: import('@danielsimonjr/memoryjs').InteractionLog;
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
const tools = createRecursaTools(ctx, { publishDir: './skills', interactionLog });
tools.list();                                   // 14 descriptors, section 3.8 order
await tools.call('recursa.learn.start', { tasks, budget: { maxRounds: 3 } });
```

## Verification

Two tools measure this repository. The two tools use different scopes.

The table holds `repo-tools map` metrics. `repo-tools map` parses the whole repository. The gate compares each row with a fresh parse.
Regenerate: `repo-tools map . --out=<dir>` · Check: `repo-tools check . --docs=docs/architecture`

| Claim | Value | Source |
|---|---|---|
| totalExports | 3984 | repo-tools map |
| totalSourceFiles | 995 | repo-tools map |

The figures below come from `bun run tools:deps` and `bun run tools:deps:full`. These generators read `src/` only. The gate does not check these figures. Read them in `dependency-summary.compact.json` and `TEST_COVERAGE.md`.

- Exports in `src/`: 2,030 (1,336 re-exports).
- Source files in `src/`: 292 (292 reachable, 0 dormant).
