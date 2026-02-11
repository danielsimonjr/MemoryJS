# MemoryJS - API Reference

**Version**: 1.5.0
**Last Updated**: 2026-02-11

Complete reference for the MemoryJS library public API.

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

### getEntityByName

Retrieve a single entity by name.

```typescript
async getEntityByName(name: string): Promise<Entity | null>
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
async getConnectedComponents(): Promise<ConnectedComponentsResult>
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
async restoreBackup(backupId: string): Promise<void>
```

### listBackups

List available backups.

```typescript
async listBackups(): Promise<BackupInfo[]>
```

### deleteBackup

Delete a backup.

```typescript
async deleteBackup(backupId: string): Promise<void>
```

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
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
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
static createStorage(config: { storagePath: string; storageType?: 'jsonl' | 'sqlite' }): IGraphStorage
static createStorageFromPath(path: string): IGraphStorage
```

---

## Types

### Entity

```typescript
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  parentId?: string;
  tags?: string[];
  importance?: number;
  createdAt?: string;
  lastModified?: string;
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
  confidence: number;           // 0.0-1.0
  agentId?: string;
  visibility: 'private' | 'shared' | 'public';
  promotedAt?: string;
  promotedFrom?: string;
  source?: {
    agentId: string;
    timestamp: string;
    method: string;
    reliability: number;
  };
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

