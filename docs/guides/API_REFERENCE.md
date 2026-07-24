# MemoryJS API Reference

**Version**: 1.14.0 + Unreleased
**Last Updated**: 2026-04-25

> **Note:** sections below cover the v1.1-era surface. For the v1.6+ additions
> (Memory Engine, Memory Validator, Trajectory Compressor, Experience Extractor,
> Causal Reasoner, Procedure Manager, Active Retrieval, World Model, RBAC,
> PII Redactor, conflict view, audit enforcer, OCC, bitemporal versioning,
> RDF export) see the per-manager API tables in [README.md](../../README.md)
> and the architecture map in [docs/architecture/API.md](../architecture/API.md).

Complete API documentation for all public classes, methods, and types.

---

## Table of Contents

1. [ManagerContext](#managercontext)
2. [EntityManager](#entitymanager)
3. [RelationManager](#relationmanager)
4. [ObservationManager](#observationmanager)
5. [HierarchyManager](#hierarchymanager)
6. [SearchManager](#searchmanager)
7. [GraphTraversal](#graphtraversal)
8. [IOManager](#iomanager)
9. [TagManager](#tagmanager)
10. [CompressionManager](#compressionmanager)
11. [AnalyticsManager](#analyticsmanager)
12. [ArchiveManager](#archivemanager)
13. [SemanticSearch](#semanticsearch)
14. [GraphRankPrior](#graphrankprior) *(Unreleased)*
15. [HybridSearchManager](#hybridsearchmanager)
16. [Storage Classes](#storage-classes)
17. [Utility Functions](#utility-functions)
18. [Types & Interfaces](#types--interfaces)
19. [Error Classes](#error-classes)

---

## ManagerContext

Central facade providing access to all managers.

### Constructor

```typescript
new ManagerContext(storagePath: string)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `storagePath` | `string` | Path to storage file (`.jsonl` or `.db`) |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `storage` | `IGraphStorage` | Underlying storage instance |
| `entityManager` | `EntityManager` | Entity operations (lazy) |
| `relationManager` | `RelationManager` | Relation operations (lazy) |
| `observationManager` | `ObservationManager` | Observation operations (lazy) |
| `hierarchyManager` | `HierarchyManager` | Hierarchy operations (lazy) |
| `searchManager` | `SearchManager` | Search operations (lazy) |
| `graphTraversal` | `GraphTraversal` | Graph algorithms (lazy) |
| `ioManager` | `IOManager` | Import/export (lazy) |
| `tagManager` | `TagManager` | Tag aliases (lazy) |
| `analyticsManager` | `AnalyticsManager` | Statistics (lazy) |
| `compressionManager` | `CompressionManager` | Deduplication (lazy) |
| `archiveManager` | `ArchiveManager` | Archival (lazy) |
| `rankedSearch` | `RankedSearch` | TF-IDF search (lazy) |
| `semanticSearch` | `SemanticSearch` | Vector search (lazy, requires config) |
| `graphRankPrior` | `GraphRankPrior` | Cached graph-connectivity ranking signal (lazy, `@experimental`, Unreleased) |
| `hybridSearchManager` | `HybridSearchManager` | Semantic + lexical + symbolic (+ optional graph) search (lazy, Unreleased) |

### Example

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const entities = await ctx.entityManager.getAllEntities();
```

---

## EntityManager

Manages entity CRUD operations.

### Methods

#### createEntities

```typescript
async createEntities(
  entities: CreateEntityInput[],
  options?: LongRunningOperationOptions
): Promise<Entity[]>
```

Creates multiple entities in a single operation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entities` | `CreateEntityInput[]` | Yes | Entities to create |
| `options.signal` | `AbortSignal` | No | Cancellation signal |
| `options.onProgress` | `ProgressCallback` | No | Progress callback |

**Returns**: `Entity[]` - Created entities with timestamps

**Throws**: `ValidationError` if input is invalid

```typescript
const entities = await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'language',
    observations: ['Typed superset of JavaScript'],
    tags: ['programming', 'microsoft'],
    importance: 8
  }
]);
```

---

#### getEntityByName

```typescript
async getEntityByName(name: string): Promise<Entity | null>
```

Retrieves a single entity by name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Entity name (case-sensitive) |

**Returns**: `Entity | null` - Entity or null if not found

```typescript
const entity = await ctx.entityManager.getEntityByName('TypeScript');
if (entity) {
  console.log(entity.observations);
}
```

---

#### getAllEntities

```typescript
async getAllEntities(): Promise<Entity[]>
```

Retrieves all entities.

**Returns**: `Entity[]` - All entities in the graph

---

#### deleteEntities

```typescript
async deleteEntities(
  entityNames: string[],
  options?: LongRunningOperationOptions
): Promise<void>
```

Deletes entities and their related relations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityNames` | `string[]` | Yes | Names to delete |
| `options.signal` | `AbortSignal` | No | Cancellation signal |

**Note**: Automatically removes relations where deleted entity is `from` or `to`.

```typescript
await ctx.entityManager.deleteEntities(['OldEntity', 'DeprecatedEntity']);
```

---

#### updateEntity

```typescript
async updateEntity(
  name: string,
  updates: UpdateEntityInput
): Promise<Entity>
```

Updates an existing entity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Entity to update |
| `updates` | `UpdateEntityInput` | Yes | Fields to update |

**Throws**: `EntityNotFoundError` if entity doesn't exist

```typescript
await ctx.entityManager.updateEntity('TypeScript', {
  observations: ['Typed superset of JavaScript', 'Version 5.0 released'],
  importance: 9
});
```

---

#### addTags

```typescript
async addTags(entityName: string, tags: string[]): Promise<Entity>
```

Adds tags to an entity (normalized to lowercase).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityName` | `string` | Yes | Target entity |
| `tags` | `string[]` | Yes | Tags to add |

**Throws**: `EntityNotFoundError` if entity doesn't exist

```typescript
await ctx.entityManager.addTags('TypeScript', ['frontend', 'backend']);
```

---

#### removeTags

```typescript
async removeTags(entityName: string, tags: string[]): Promise<Entity>
```

Removes tags from an entity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityName` | `string` | Yes | Target entity |
| `tags` | `string[]` | Yes | Tags to remove |

```typescript
await ctx.entityManager.removeTags('TypeScript', ['deprecated']);
```

---

#### setImportance

```typescript
async setImportance(entityName: string, importance: number): Promise<Entity>
```

Sets entity importance (0-10 scale).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityName` | `string` | Yes | Target entity |
| `importance` | `number` | Yes | Value 0-10 |

**Throws**:
- `EntityNotFoundError` if entity doesn't exist
- `InvalidImportanceError` if value out of range

```typescript
await ctx.entityManager.setImportance('TypeScript', 8);
```

---

#### addTagsToMultipleEntities

```typescript
async addTagsToMultipleEntities(
  entityNames: string[],
  tags: string[]
): Promise<Entity[]>
```

Bulk tag addition to multiple entities.

```typescript
await ctx.entityManager.addTagsToMultipleEntities(
  ['TypeScript', 'JavaScript', 'Python'],
  ['programming-language']
);
```

---

#### replaceTag

```typescript
async replaceTag(oldTag: string, newTag: string): Promise<number>
```

Replaces a tag across all entities.

**Returns**: `number` - Count of entities modified

```typescript
const count = await ctx.entityManager.replaceTag('js', 'javascript');
console.log(`Updated ${count} entities`);
```

---

#### mergeTags

```typescript
async mergeTags(
  tag1: string,
  tag2: string,
  targetTag: string
): Promise<number>
```

Merges two tags into one across all entities.

**Returns**: `number` - Count of entities modified

```typescript
await ctx.entityManager.mergeTags('ml', 'machine-learning', 'machine-learning');
```

---

## RelationManager

Manages relation CRUD operations.

### Methods

#### createRelations

```typescript
async createRelations(
  relations: CreateRelationInput[]
): Promise<Relation[]>
```

Creates multiple relations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `relations` | `CreateRelationInput[]` | Yes | Relations to create |

**Note**: Uses deferred integrity - entities don't need to exist yet.

```typescript
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'JavaScript', relationType: 'compiles_to' },
  { from: 'TypeScript', to: 'Microsoft', relationType: 'developed_by' }
]);
```

---

#### getRelationsForEntity

```typescript
async getRelationsForEntity(entityName: string): Promise<{
  incoming: Relation[];
  outgoing: Relation[];
}>
```

Gets all relations for an entity.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityName` | `string` | Yes | Entity name |

```typescript
const { incoming, outgoing } = await ctx.relationManager.getRelationsForEntity('TypeScript');
console.log(`${incoming.length} incoming, ${outgoing.length} outgoing`);
```

---

#### getAllRelations

```typescript
async getAllRelations(): Promise<Relation[]>
```

Gets all relations in the graph.

---

#### deleteRelations

```typescript
async deleteRelations(relations: DeleteRelationInput[]): Promise<void>
```

Deletes specific relations.

```typescript
await ctx.relationManager.deleteRelations([
  { from: 'TypeScript', to: 'JavaScript', relationType: 'compiles_to' }
]);
```

---

## ObservationManager

Manages entity observations.

### Methods

#### addObservations

```typescript
async addObservations(
  additions: ObservationAddition[]
): Promise<ObservationResult[]>
```

Adds observations to entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `additions[].entityName` | `string` | Yes | Target entity |
| `additions[].contents` | `string[]` | Yes | Observations to add |

**Throws**: `EntityNotFoundError` if entity doesn't exist

```typescript
const results = await ctx.observationManager.addObservations([
  {
    entityName: 'TypeScript',
    contents: ['Supports decorators', 'Has strict null checks']
  }
]);
// Returns: [{ entityName: 'TypeScript', addedObservations: ['Supports decorators', ...] }]
```

---

#### deleteObservations

```typescript
async deleteObservations(
  deletions: ObservationDeletion[]
): Promise<ObservationResult[]>
```

Removes observations from entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `deletions[].entityName` | `string` | Yes | Target entity |
| `deletions[].observations` | `string[]` | Yes | Observations to remove |

```typescript
await ctx.observationManager.deleteObservations([
  { entityName: 'TypeScript', observations: ['Outdated info'] }
]);
```

---

## HierarchyManager

Manages parent-child entity relationships.

### Methods

#### setEntityParent

```typescript
async setEntityParent(
  entityName: string,
  parentName: string | null
): Promise<Entity>
```

Sets or clears an entity's parent.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityName` | `string` | Yes | Child entity |
| `parentName` | `string \| null` | Yes | Parent (null to clear) |

**Throws**:
- `EntityNotFoundError` if entity/parent doesn't exist
- `CycleDetectedError` if would create cycle

```typescript
await ctx.hierarchyManager.setEntityParent('Junior Dev', 'Senior Dev');
await ctx.hierarchyManager.setEntityParent('Orphan', null); // Clear parent
```

---

#### getParent

```typescript
async getParent(entityName: string): Promise<Entity | null>
```

Gets an entity's parent.

---

#### getChildren

```typescript
async getChildren(entityName: string): Promise<Entity[]>
```

Gets an entity's direct children.

---

#### getAncestors

```typescript
async getAncestors(entityName: string): Promise<Entity[]>
```

Gets all ancestors (parent, grandparent, etc.).

---

#### getDescendants

```typescript
async getDescendants(entityName: string): Promise<Entity[]>
```

Gets all descendants recursively.

---

#### getSubtree

```typescript
async getSubtree(entityName: string): Promise<KnowledgeGraph>
```

Gets entity with all descendants and their relations.

```typescript
const subtree = await ctx.hierarchyManager.getSubtree('Engineering');
console.log(`${subtree.entities.length} entities, ${subtree.relations.length} relations`);
```

---

#### getRootEntities

```typescript
async getRootEntities(): Promise<Entity[]>
```

Gets all entities without parents.

---

#### getEntityDepth

```typescript
async getEntityDepth(entityName: string): Promise<number>
```

Gets depth in hierarchy (root = 0).

---

#### moveEntity

```typescript
async moveEntity(
  entityName: string,
  newParentName: string | null
): Promise<Entity>
```

Moves entity to new parent (with cycle detection).

---

## SearchManager

Orchestrates all search operations.

### Methods

#### searchNodes

```typescript
async searchNodes(
  query: string,
  options?: SearchOptions
): Promise<KnowledgeGraph>
```

Basic substring search across entity names, observations, and types.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `options.tags` | `string[]` | No | Filter by tags |
| `options.minImportance` | `number` | No | Min importance (0-10) |
| `options.maxImportance` | `number` | No | Max importance (0-10) |
| `options.entityType` | `string` | No | Filter by type |
| `options.limit` | `number` | No | Max results |
| `options.offset` | `number` | No | Skip results |

```typescript
const results = await ctx.searchManager.searchNodes('TypeScript', {
  tags: ['programming'],
  minImportance: 5,
  limit: 20
});
```

---

#### searchNodesRanked

```typescript
async searchNodesRanked(
  query: string,
  options?: RankedSearchOptions
): Promise<SearchResult[]>
```

TF-IDF ranked search with relevance scores.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `options.limit` | `number` | No | Max results (default: 50) |
| `options.minScore` | `number` | No | Minimum score threshold |
| `options.tags` | `string[]` | No | Filter by tags |

**Returns**: `SearchResult[]` with score and matchedFields

```typescript
const ranked = await ctx.searchManager.searchNodesRanked('programming language', {
  limit: 10,
  minScore: 0.3
});

ranked.forEach(r => {
  console.log(`${r.entity.name}: ${r.score.toFixed(3)}`);
});
```

---

#### booleanSearch

```typescript
async booleanSearch(
  query: string,
  options?: SearchOptions
): Promise<KnowledgeGraph>
```

Boolean query with AND, OR, NOT operators.

**Query Syntax**:
- `AND` - Both terms required
- `OR` - Either term matches
- `NOT` - Exclude term
- `name:value` - Field-specific search
- `(...)` - Grouping

```typescript
const results = await ctx.searchManager.booleanSearch(
  'name:TypeScript AND (type:language OR observation:Microsoft) AND NOT tag:deprecated'
);
```

---

#### fuzzySearch

```typescript
async fuzzySearch(
  query: string,
  options?: FuzzySearchOptions
): Promise<KnowledgeGraph>
```

Typo-tolerant search using Levenshtein distance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `options.threshold` | `number` | No | Similarity 0-1 (default: 0.7) |

```typescript
// Finds "TypeScript" even with typo
const results = await ctx.searchManager.fuzzySearch('Typscript', {
  threshold: 0.7
});
```

---

> **Note:** hybrid (semantic + lexical + symbolic + optional graph) search is
> not a `SearchManager` method — it is `ctx.hybridSearchManager.search(graph,
> query, options)`. See [HybridSearchManager](#hybridsearchmanager) below.

#### getSearchSuggestions

```typescript
async getSearchSuggestions(
  query: string,
  limit?: number
): Promise<string[]>
```

Gets autocomplete suggestions based on existing entity names.

```typescript
const suggestions = await ctx.searchManager.getSearchSuggestions('Type', 5);
// ['TypeScript', 'TypeError', 'TypeORM', ...]
```

---

#### saveSearch

```typescript
async saveSearch(search: SavedSearchInput): Promise<SavedSearch>
```

Saves a search for later execution.

```typescript
await ctx.searchManager.saveSearch({
  name: 'important-projects',
  query: 'project',
  options: { tags: ['important'], minImportance: 7 }
});
```

---

#### executeSavedSearch

```typescript
async executeSavedSearch(name: string): Promise<KnowledgeGraph>
```

Executes a saved search by name.

---

#### listSavedSearches

```typescript
async listSavedSearches(): Promise<SavedSearch[]>
```

Lists all saved searches.

---

## GraphTraversal

Graph algorithms and path finding.

### Methods

#### findShortestPath

```typescript
async findShortestPath(
  source: string,
  target: string,
  options?: PathOptions   // { maxDepth?, direction?, relationTypes? }
): Promise<PathResult | null>
```

Finds shortest path between two entities using Dijkstra's algorithm.

**Returns**: `PathResult` (`{ path: string[], relations: Relation[], length: number }`), or `null` if no path exists

```typescript
const result = await ctx.graphTraversal.findShortestPath('Alice', 'Bob');
// result?.path === ['Alice', 'Charlie', 'Bob']
```

---

#### findAllPaths

```typescript
async findAllPaths(
  source: string,
  target: string,
  maxDepth?: number,     // default 5
  options?: PathOptions
): Promise<PathResult[]>
```

Finds all paths between entities up to `maxDepth`.

---

#### Centrality methods

```typescript
async calculateDegreeCentrality(
  direction?: 'in' | 'out' | 'both', topN?: number
): Promise<CentralityResult>
async calculateBetweennessCentrality(
  options?: { approximate?: boolean; sampleRate?: number; topN?: number }
): Promise<CentralityResult>
async calculatePageRank(
  dampingFactor?: number, maxIterations?: number, tolerance?: number, topN?: number
): Promise<CentralityResult>
```

Three separate methods (there is no unified `getCentrality()`). Each resolves to a `CentralityResult` (`{ scores: Map<string, number>, ... }`).

```typescript
const pageRank = await ctx.graphTraversal.calculatePageRank();
pageRank.scores.forEach((score, name) => {
  console.log(`${name}: ${score.toFixed(4)}`);
});
```

---

#### findConnectedComponents

```typescript
async findConnectedComponents(): Promise<ConnectedComponentsResult>
```

Finds connected components (subgraphs).

**Returns**: `{ components: string[][], count: number, largestComponentSize: number }`

---

#### bfs / dfs

```typescript
bfs(startEntity: string, options?: TraversalOptions): TraversalResult
dfs(startEntity: string, options?: TraversalOptions): TraversalResult
```

Breadth-first / depth-first traversal. Both are **synchronous** (no `Promise`) and take an options object rather than a visitor callback.

**Returns**: `TraversalResult` (`{ nodes: string[], depths: Map<string, number>, parents: Map<string, string> }`)

---

## IOManager

Import, export, and backup operations.

### Methods

#### exportGraph

```typescript
async exportGraph(
  format: ExportFormat,
  options?: ExportOptions
): Promise<string>
```

Exports graph to various formats.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | `ExportFormat` | Yes | Output format |
| `options.filter` | `ExportFilter` | No | Filter entities |
| `options.compress` | `boolean` | No | Brotli compression |

**Formats**: `'json'`, `'csv'`, `'graphml'`, `'gexf'`, `'dot'`, `'markdown'`, `'mermaid'`

```typescript
const json = await ctx.ioManager.exportGraph('json');
const mermaid = await ctx.ioManager.exportGraph('mermaid');
const filtered = await ctx.ioManager.exportGraph('json', {
  filter: { tags: ['important'], minImportance: 7 },
  compress: true
});
```

---

#### importGraph

```typescript
async importGraph(
  format: ImportFormat,
  data: string,
  options?: ImportOptions
): Promise<ImportResult>
```

Imports data into the graph.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | `ImportFormat` | Yes | `'json'`, `'csv'`, `'graphml'` |
| `data` | `string` | Yes | Data to import |
| `options.mergeStrategy` | `MergeStrategy` | No | Conflict handling |
| `options.dryRun` | `boolean` | No | Preview without applying |

**Merge Strategies**:
- `'merge'` - Combine observations/tags
- `'replace'` - Overwrite existing
- `'skip'` - Ignore conflicts
- `'fail'` - Error on conflict

```typescript
const result = await ctx.ioManager.importGraph('json', jsonData, {
  mergeStrategy: 'merge',
  dryRun: true
});
console.log(`Would create ${result.entitiesCreated}, update ${result.entitiesUpdated}`);
```

---

#### createBackup

```typescript
async createBackup(options?: BackupOptions | string): Promise<BackupResult>
```

Creates a timestamped backup. `BackupResult` carries `path` (not `id`) — pass that to `restoreFromBackup`/`deleteBackup`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.compress` | `boolean` | No | Brotli compression |
| `options.description` | `string` | No | Backup description |

```typescript
const backup = await ctx.ioManager.createBackup({ compress: true });
console.log(`Backup created: ${backup.path}`);
```

---

#### restoreFromBackup

```typescript
async restoreFromBackup(backupPath: string): Promise<RestoreResult>
```

Restores the graph from a backup file (by path — since v1.15.0 Phase 5 delegates to `BackupManager.restore()`, which rejects symlinks).

---

#### listBackups

```typescript
async listBackups(): Promise<BackupInfo[]>
```

Lists all available backups, sorted newest first.

---

#### deleteBackup

```typescript
async deleteBackup(backupPath: string): Promise<void>
```

Deletes a backup by path. Since v1.15.0 Phase 5 delegates to `BackupManager.delete()`, which validates the path stays in the backup directory and rejects symlinks.

---

#### cleanOldBackups

```typescript
async cleanOldBackups(keepCount?: number): Promise<number>
```

Keeps the `keepCount` most recent backups (default 10); deletes the rest.

---

## TagManager

Tag alias management.

### Methods

#### addTagAlias

```typescript
async addTagAlias(
  alias: string,
  canonical: string,
  description?: string
): Promise<TagAlias>
```

Creates a tag alias (synonym).

```typescript
await ctx.tagManager.addTagAlias('ml', 'machine-learning', 'Abbreviation');
```

---

#### resolveTag

```typescript
async resolveTag(tag: string): Promise<string>
```

Resolves a tag to its canonical form.

```typescript
const canonical = await ctx.tagManager.resolveTag('ml');
// Returns: 'machine-learning'
```

---

#### listTagAliases

```typescript
async listTagAliases(): Promise<TagAlias[]>
```

Lists all tag aliases.

---

#### getAliasesForTag

```typescript
async getAliasesForTag(canonicalTag: string): Promise<string[]>
```

Gets all aliases for a canonical tag.

---

#### removeTagAlias

```typescript
async removeTagAlias(alias: string): Promise<boolean>
```

Removes a tag alias.

---

## CompressionManager

Duplicate detection and entity merging.

### Methods

#### findDuplicates

```typescript
async findDuplicates(threshold?: number): Promise<string[][]>
```

Finds potential duplicate entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threshold` | `number` | No | Similarity 0-1 (default: 0.8) |

**Returns**: Groups of similar entity names

```typescript
const duplicates = await ctx.compressionManager.findDuplicates(0.8);
// [['Alice', 'alice'], ['TypeScript', 'Typescript']]
```

---

#### mergeEntities

```typescript
async mergeEntities(
  entityNames: string[],
  targetName?: string
): Promise<Entity>
```

Merges multiple entities into one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityNames` | `string[]` | Yes | Entities to merge (min 2) |
| `targetName` | `string` | No | Name for merged entity |

**Throws**: `InsufficientEntitiesError` if less than 2 entities

```typescript
const merged = await ctx.compressionManager.mergeEntities(
  ['TypeScript', 'Typescript', 'typescript'],
  'TypeScript'
);
```

---

#### compressGraph

```typescript
async compressGraph(
  threshold?: number,
  options?: CompressOptions
): Promise<GraphCompressionResult>
```

Auto-detects and merges duplicates.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `threshold` | `number` | No | Similarity threshold |
| `options.dryRun` | `boolean` | No | Preview without applying |

```typescript
const result = await ctx.compressionManager.compressGraph(0.8, { dryRun: true });
console.log(`Would merge ${result.mergedGroups.length} groups`);
```

---

## AnalyticsManager

Graph statistics and validation.

### Methods

#### getGraphStats

```typescript
async getGraphStats(): Promise<GraphStats>
```

Gets comprehensive graph statistics.

**Returns**:
```typescript
{
  entityCount: number;
  relationCount: number;
  entityTypes: Record<string, number>;
  tagCounts: Record<string, number>;
  importanceDistribution: Record<number, number>;
  averageObservationsPerEntity: number;
  orphanedRelations: number;
}
```

---

#### validateGraph

```typescript
async validateGraph(): Promise<ValidationReport>
```

Validates graph integrity.

**Returns**:
```typescript
{
  isValid: boolean;
  issues: ValidationIssue[];       // type: 'orphaned_relation' | 'duplicate_entity' | 'invalid_data'
  warnings: ValidationWarning[];   // type: 'isolated_entity' | 'empty_observations' | 'missing_metadata'
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

Entity archival operations.

### Methods

#### archiveEntities

```typescript
async archiveEntities(
  criteria: ArchiveCriteria,
  options?: ArchiveOptions
): Promise<ArchiveResult>
```

Archives entities matching criteria.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `criteria.olderThan` | `string` | No | ISO date string |
| `criteria.maxImportance` | `number` | No | Max importance |
| `criteria.tags` | `string[]` | No | Tags to match |
| `criteria.entityTypes` | `string[]` | No | Types to match |
| `options.dryRun` | `boolean` | No | Preview mode |

```typescript
const result = await ctx.archiveManager.archiveEntities({
  olderThan: '2024-01-01',
  maxImportance: 2,
  tags: ['deprecated']
}, { dryRun: false });
```

---

## SemanticSearch

Vector similarity search using embeddings. Note the constructor takes no
`storage` argument — `graph` is passed per-call to `indexAll`/`search`/
`findSimilar` instead.

### Constructor

```typescript
new SemanticSearch(
  embeddingService: EmbeddingService,
  vectorStore?: IVectorStore   // defaults to a new InMemoryVectorStore
)
```

### Methods

#### isAvailable

```typescript
async isAvailable(): Promise<boolean>
```

#### indexAll

```typescript
async indexAll(
  graph: ReadonlyKnowledgeGraph,
  options?: SemanticIndexOptions   // { forceReindex?, onProgress?, batchSize?, signal? }
): Promise<{ indexed: number; skipped: number; errors: number }>
```

Indexes all entities for semantic search. Incremental — entities already indexed are skipped unless `forceReindex` is set.

```typescript
const embedding = await createEmbeddingService({ provider: 'openai' });
const semantic = new SemanticSearch(embedding);

const graph = await ctx.entityManager.getAllEntities().then(entities => ({ entities, relations: [] }));
await semantic.indexAll(graph);
```

---

#### indexEntity

```typescript
async indexEntity(entity: Entity): Promise<boolean>
```

Indexes a single entity. Returns `false` on embedding failure instead of throwing.

---

#### search

```typescript
async search(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  limit?: number,          // default SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT
  minSimilarity?: number   // default SEMANTIC_SEARCH_LIMITS.MIN_SIMILARITY
): Promise<SemanticSearchResult[]>
```

Searches by semantic similarity.

```typescript
const results = await semantic.search(graph, 'functional programming concepts', 10, 0.7);
```

---

#### findSimilar

```typescript
async findSimilar(
  graph: ReadonlyKnowledgeGraph,
  entityName: string,
  limit?: number,
  minSimilarity?: number
): Promise<SemanticSearchResult[]>
```

Finds entities similar to a given entity.

```typescript
const similar = await semantic.findSimilar(graph, 'TypeScript', 5);
```

---

## GraphRankPrior

(Unreleased, `@experimental`) Cached graph-connectivity ranking signal — normalized PageRank over `GraphTraversal`, with a degree-only fallback once the graph exceeds `maxPageRankEntities`. Event-invalidated (entity/relation events + `graph:saved`, so manager-level batch mutations don't leave it stale). Wired via `ctx.graphRankPrior` (lazy getter).

### Constructor

```typescript
new GraphRankPrior(
  source: GraphTraversal | GraphStorage,
  options?: {
    maxPageRankEntities?: number;  // default 50_000
    dampingFactor?: number;        // default 0.85
    events?: GraphEventEmitter;    // enables auto-invalidation
  }
)
```

### Methods

```typescript
async getScores(names: string[]): Promise<Map<string, number>>  // normalized [0, 1]
async getPageRank(entityName: string): Promise<number>
async getDegree(entityName: string): Promise<number>
neighbors(entityName: string): string[]         // one-hop, both directions
isDegreeFallback(): boolean | undefined
invalidate(): void
dispose(): void
```

```typescript
const prior = ctx.graphRankPrior;
const scores = await prior.getScores(['Alice', 'Bob']);
```

---

## HybridSearchManager

Combines semantic, lexical, symbolic, and (optionally) graph-connectivity search layers with configurable weights. Wired via `ctx.hybridSearchManager` (lazy getter; attaches the graph channel only when `MEMORY_HYBRID_GRAPH_WEIGHT > 0`).

### Constructor

```typescript
new HybridSearchManager(
  semanticSearch: SemanticSearch | null,
  rankedSearch: RankedSearch,
  graphPrior?: GraphRankPrior | null,
  defaults?: {
    graphWeight?: number;
    expandNeighbors?: { hops: 1; topK?: number; damping?: number };
  }
)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `semanticSearch` | `SemanticSearch \| null` | Yes | Semantic layer; `null` disables it |
| `rankedSearch` | `RankedSearch` | Yes | Lexical layer (TF-IDF/BM25) |
| `graphPrior` | `GraphRankPrior \| null` | No | Graph-connectivity signal; absent = graph channel inert (default `null`) |
| `defaults` | `GraphHybridOptions` | No | Default `graphWeight`/`expandNeighbors`, overridable per call |

### Methods

#### search

```typescript
async search(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  options?: Partial<HybridSearchOptions> & {
    graphWeight?: number;  // graph channel weight, default 0 (off)
    expandNeighbors?: { hops: 1; topK?: number; damping?: number };
  }
): Promise<HybridSearchResult[]>
```

Executes hybrid search combining all layers and returns results sorted by `scores.combined`, descending. Note the parameter order: `graph` first, then `query` (opposite of most other search methods in this library).

`matchedLayers` can include `'graph'`; `scores.graph` carries the normalized graph-connectivity contribution when that channel is active.

```typescript
const results = await ctx.hybridSearchManager.search(graph, 'machine learning', {
  semanticWeight: 0.5,
  lexicalWeight: 0.3,
  symbolicWeight: 0.2,
  symbolic: { tags: ['ai'], importance: { min: 5 } },
  limit: 20,
});
```

#### searchWithEntities

Alias for `search()`.

```typescript
async searchWithEntities(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  options?: Partial<HybridSearchOptions> & GraphHybridOptions
): Promise<HybridSearchResult[]>
```

#### getSymbolicSearch

```typescript
getSymbolicSearch(): SymbolicSearch
```

---

## Storage Classes

### GraphStorage (JSONL)

```typescript
new GraphStorage(memoryFilePath: string)
```

| Method | Description |
|--------|-------------|
| `loadGraph()` | Loads graph (cached) |
| `saveGraph(graph)` | Saves graph (invalidates cache) |
| `invalidateCache()` | Manually invalidate cache |

### SQLiteStorage

```typescript
new SQLiteStorage(dbPath: string)
```

| Method | Description |
|--------|-------------|
| `loadGraph()` | Loads graph |
| `saveGraph(graph)` | Saves graph |
| `searchFTS(query)` | FTS5 full-text search |
| `close()` | Close database connection |

Since Unreleased, `SQLiteStorage` also implements `renameEntity(oldName, newName)` (the storage-level primitive backing `EntityManager.renameEntity`), `events` (a `GraphEventEmitter` with full parity to `GraphStorage` — `graph:loaded`/`saved`, `entity:created`/`updated`/`deleted`, `relation:created`), and `graphMutex` (fixes a crash in batch manager mutations against the raw SQLite backend). `IGraphStorage.renameEntity` and `.events` are both optional interface members so third-party/test implementations remain valid without changes.

### Factory Functions

```typescript
// Create from path (auto-detects type)
const storage = createStorageFromPath('./memory.jsonl');
const storage = createStorageFromPath('./memory.db');

// Create with explicit config
const storage = createStorage({
  type: 'sqlite',
  path: './memory.db'
});
```

---

## Utility Functions

### Validation

```typescript
import {
  validateWithSchema,
  validateEntity,
  validateRelation,
  validateImportance,
  formatZodErrors
} from '@danielsimonjr/memoryjs';

// Schema validation
const result = validateWithSchema(EntitySchema, input);
if (!result.success) {
  console.error(formatZodErrors(result.error));
}

// Manual validation
validateImportance(5); // throws if invalid
validateTags(['valid', 'INVALID']); // normalizes to lowercase
```

### Search Algorithms

```typescript
import {
  levenshteinDistance,
  calculateTF,
  calculateIDF,
  calculateTFIDF,
  tokenize
} from '@danielsimonjr/memoryjs';

const distance = levenshteinDistance('TypeScript', 'JavaScript');
const tokens = tokenize('TypeScript is a programming language');
```

### Entity Utilities

```typescript
import {
  findEntityByName,
  entityExists,
  normalizeTag,
  normalizeTags,
  getCurrentTimestamp,
  sanitizeObject
} from '@danielsimonjr/memoryjs';
```

### Batch Processing

```typescript
import { processBatch, chunkArray } from '@danielsimonjr/memoryjs';

const results = await processBatch(items, processItem, {
  batchSize: 100,
  onProgress: (done, total) => console.log(`${done}/${total}`)
});
```

---

## Types & Interfaces

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
  id?: string;  // Unreleased — stable opaque UUID assigned at creation, preserved across
                // updates/renames/persistence; `name` remains the public key
}
```

> See [docs/architecture/API.md](../architecture/API.md#entity) for the full
> field set (freshness, versioning, bitemporal, Memory Engine dedup fields).

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

### HybridSearchResult

`HybridSearchManager.search()` resolves to `HybridSearchResult[]` — a flat array, not a wrapper object.

```typescript
interface HybridSearchResult {
  entity: Entity;
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
    combined: number;
    graph?: number;  // present when the graph channel is active (Unreleased)
  };
  matchedLayers: ('semantic' | 'lexical' | 'symbolic' | 'graph')[];
}
```

### HybridSearchOptions

```typescript
interface HybridSearchOptions {
  semanticWeight: number;   // default 0.5
  lexicalWeight: number;    // default 0.3
  symbolicWeight: number;   // default 0.2
  semantic?: { minSimilarity?: number; topK?: number };
  lexical?: { useStopwords?: boolean; useStemming?: boolean };
  symbolic?: SymbolicFilters;
  limit?: number;
}

interface SymbolicFilters {
  tags?: string[];
  entityTypes?: string[];
  dateRange?: { start: string; end: string };
  importance?: { min?: number; max?: number };
  parentId?: string;
  hasObservations?: boolean;
}
```

### SearchOptions

```typescript
interface SearchOptions {
  tags?: string[];
  minImportance?: number;
  maxImportance?: number;
  entityType?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
}
```

### ImportResult

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

---

## Error Classes

All errors extend `KnowledgeGraphError`:

| Error | Cause |
|-------|-------|
| `EntityNotFoundError` | Entity doesn't exist |
| `RelationNotFoundError` | Relation doesn't exist |
| `DuplicateEntityError` | Entity already exists |
| `ValidationError` | Invalid input data |
| `CycleDetectedError` | Would create hierarchy cycle |
| `InvalidImportanceError` | Importance out of range |
| `FileOperationError` | File I/O failure |
| `ImportError` | Import operation failed |
| `ExportError` | Export operation failed |
| `InsufficientEntitiesError` | Merge requires 2+ entities |
| `OperationCancelledError` | Operation was aborted |

```typescript
import { EntityNotFoundError, ValidationError } from '@danielsimonjr/memoryjs';

try {
  await ctx.entityManager.setImportance('Unknown', 5);
} catch (e) {
  if (e instanceof EntityNotFoundError) {
    console.error(`Entity ${e.entityName} not found`);
  }
}
```

---

**Document Version**: 2.0
**Last Updated**: 2026-04-25

---

## v1.6 → Unreleased — added API surface

Sections above cover the original v1.1-era API. Below are the new
public surfaces shipped since.

### EntityManager — new methods

```typescript
class EntityManager {
  // η.4.4 — bitemporal validity
  invalidateEntity(name: string, ended?: string): Promise<void>;
  entityAsOf(name: string, asOf: string): Promise<Entity | null>;
  entityTimeline(name: string): Promise<Entity[]>;

  // η.5.5.c — optimistic concurrency control (opt-in)
  updateEntity(
    name: string,
    updates: Partial<Entity>,
    options?: { expectedVersion?: number },  // throws VersionConflictError on mismatch
  ): Promise<Entity>;

  // v1.8 — supersession chain navigation
  getVersionChain(entityName: string): Promise<Entity[]>;
  getLatestVersion(entityName: string): Promise<Entity | null>;

  // Unreleased — knowledge-graph-as-core convergence
  /** Public bulk enumeration; O(k) TypeIndex fast path when filtered. */
  listEntities(filter?: { entityType?: string }): Promise<Entity[]>;
  /**
   * Atomically renames an entity: rewrites Relation.from/to, children's
   * parentId, version-chain fields, and RefIndex aliases. Emits
   * entity:renamed -> entity:deleted -> entity:created.
   */
  renameEntity(oldName: string, newName: string): Promise<Entity>;
}
```

### RelationManager — new methods (v1.9)

```typescript
class RelationManager {
  invalidateRelation(
    from: string, relationType: string, to: string, ended?: string,
  ): Promise<void>;
  queryAsOf(
    entityName: string, asOf: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' },
  ): Promise<Relation[]>;
  timeline(
    entityName: string,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' },
  ): Promise<Relation[]>;
}
```

### ObservationManager — new methods (η.4.4)

```typescript
class ObservationManager {
  invalidateObservation(
    entityName: string, content: string, ended?: string,
  ): Promise<void>;
  observationsAsOf(entityName: string, asOf: string): Promise<string[]>;
}
```

### IOManager — new export formats (η.5.4 + v1.9)

```typescript
type ExportFormat =
  | 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid'
  | 'turtle' | 'rdf-xml' | 'json-ld';  // ← new

class IOManager {
  exportGraph(graph: ReadonlyKnowledgeGraph, format: ExportFormat): string;

  // v1.9 conversation ingest pipeline
  ingest(input: IngestInput, options?: IngestOptions): Promise<IngestResult>;
  splitSessions(content: string, options?: SplitOptions): Promise<SplitResult>;

  // v1.9.1 visualization
  visualizeGraph(options?: VisualizeOptions): Promise<string>;
}
```

### MemoryEngine (v1.11)

```typescript
class MemoryEngine extends EventEmitter {
  addTurn(
    content: string,
    options: { sessionId: string; role: 'user' | 'assistant' | 'system' },
  ): Promise<{ turn?: MemoryTurn; deduped: boolean; tier?: DedupTier; existingTurn?: MemoryTurn }>;

  checkDuplicate(content: string, sessionId: string): Promise<DedupResult>;

  getSessionTurns(
    sessionId: string,
    options?: { role?: string; limit?: number },
  ): Promise<MemoryTurn[]>;

  deleteSession(sessionId: string): Promise<void>;
  listSessions(): Promise<string[]>;
}
// Events: memoryEngine:turnAdded / duplicateDetected / sessionDeleted
```

### IMemoryBackend (v1.12)

```typescript
interface IMemoryBackend {
  add(turn: MemoryTurn, options?: { dedupOnAdd?: boolean }): Promise<MemoryTurn>;
  get_weighted(sessionId: string, options?: GetWeightedOptions): Promise<WeightedTurn[]>;
  delete_session(sessionId: string): Promise<void>;
  list_sessions(): Promise<string[]>;
}

// Implementations:
//   InMemoryBackend  — ephemeral; dedups on (sessionId, content)
//   SQLiteBackend    — wraps MemoryEngine + DecayEngine

ctx.memoryBackend  // selected by MEMORY_BACKEND=sqlite|in-memory
```

### MemoryValidator (v1.13)

```typescript
class MemoryValidator {
  validateConsistency(newObs: string, existing: Entity): Promise<MemoryValidationResult>;
  detectContradictions(entity: Entity): Promise<Contradiction[]>;
  repairWithResolver(
    entity: Entity, competing: Entity[], resolver: ConflictResolver,
    contradiction?: Contradiction,
    options?: { detectionMethod?, strategy?, agents? },
  ): Promise<Entity>;
  validateTemporalOrder(observations: string[]): MemoryValidationResult;
  calculateReliability(entity: Entity): number;
}
```

### TrajectoryCompressor (v1.13)

```typescript
class TrajectoryCompressor {
  distill(observations: string[], maxLength: number): string;
  abstractAtLevel(observations: string[], level: 'fine' | 'medium' | 'coarse'): string[];
  foldContext(content: string, level?: CompressionLevel): string;
  findRedundancies(observations: string[], threshold?: number): Array<string[]>;  // groups
  mergeRedundant(
    entities: Entity[],
    strategy: TrajectoryMergeStrategy,  // 'keep-newest' | 'keep-most-confident' | 'union-observations'
  ): Entity;
}
```

### ExperienceExtractor (v1.13)

```typescript
class ExperienceExtractor {
  extractFromContrastivePairs(success: Trajectory[], failure: Trajectory[]): Rule[];
  abstractPattern(observations: string[]): Pattern;
  learnDecisionBoundary(positive: Trajectory[], negative: Trajectory[]): DecisionRule;
  clusterTrajectories(
    trajectories: Trajectory[],
    method: 'semantic' | 'structural' | 'outcome',
  ): TrajectoryCluster[];
  synthesizeExperience(cluster: TrajectoryCluster): Experience;
}
```

### CollaborativeSynthesis (v1.7 + η.5.5.a)

```typescript
class CollaborativeSynthesis {
  // v1.7
  synthesize(seedEntity: string, context?: SalienceContext): Promise<SynthesisResult>;

  // η.5.5.a — conflict detection + resolution
  resolveConflicts(
    result: SynthesisResult,
    policy: ConflictResolutionPolicy,
  ): Map<string, AgentEntity>;
}

interface SynthesisResult {
  // ... pre-existing fields
  conflicts: ConflictView[];  // ← new in η.5.5.a
}

type ConflictResolutionPolicy =
  | { strategy: 'most_recent' }
  | { strategy: 'highest_confidence' }
  | { strategy: 'highest_score' }
  | { strategy: 'trusted_agent'; trustedAgentId: string };
```

### VisibilityResolver (v1.7 + η.5.5.b)

```typescript
class VisibilityResolver {
  canAccess(
    memory: AgentEntity,
    requestingAgentId: string,
    requestingMeta: AgentMetadata | undefined,
    ownerMeta: AgentMetadata | undefined,
    now?: string,  // ← new in η.5.5.b for time-window evaluation
  ): boolean;
}

// AgentEntity gains:
interface AgentEntity {
  // ... existing
  allowedRoles?: string[];   // η.5.5.b — role gate (AND-combined)
  visibleFrom?: string;      // η.5.5.b — time-window start
  visibleUntil?: string;     // η.5.5.b — time-window end
}
```

### CollaborationAuditEnforcer (η.5.5.d)

```typescript
class CollaborationAuditEnforcer {
  constructor(
    em: EntityManager,
    log: AuditLog,
    options?: { mode?: 'strict' | 'lenient' },  // strict throws AttributionRequiredError
  );

  createEntities(entities: Entity[], agentId: string | undefined): Promise<Entity[]>;
  updateEntity(
    name: string, updates: Partial<Entity>, agentId: string | undefined,
    options?: { expectedVersion?: number },  // forwards to OCC
  ): Promise<Entity>;
  deleteEntities(names: string[], agentId: string | undefined): Promise<void>;
}
```

### CausalReasoner (3B.6)

```typescript
class CausalReasoner {
  findEffects(
    causeEntityName: string, candidateEffects: string[], maxDepth?: number,
  ): Promise<CausalChain[]>;
  findCauses(
    effectEntityName: string, candidateCauses: string[], maxDepth?: number,
  ): Promise<CausalChain[]>;
  counterfactual(scenario: {
    seed: string; removeFrom: string; removeTo: string; predict: string; maxDepth?: number;
  }): Promise<CausalChain[]>;
  detectCycles(seed: string, maxDepth?: number): CausalCycle[];
}

interface CausalChain {
  path: string[];        // entity names cause→effect
  relations: Relation[]; // edges traversed
  score: number;         // product of per-edge causalStrength
  length: number;
}
```

### ProcedureManager (3B.4)

```typescript
class ProcedureManager {
  addProcedure(input: Partial<Procedure>): Promise<Procedure>;
  getProcedure(id: string): Promise<Procedure | null>;
  getStep(id: string, order: number): Promise<ProcedureStep | null>;
  getNextStep(id: string, currentOrder: number): Promise<ProcedureStep | null>;
  openSequencer(id: string): Promise<StepSequencer | null>;
  matchProcedure(
    contextDescription: string,
    candidates: Procedure[],
    threshold?: number,
  ): Promise<ProcedureMatch[]>;
  refineProcedure(id: string, feedback: ProcedureFeedback): Promise<Procedure>;
}

class StepSequencer {
  current(): ProcedureStep | null;
  next(): ProcedureStep | null;
  branchToFallback(): void;       // throws if no fallback
  reset(): void;
  isComplete(): boolean;
  readonly cursorIndex: number;
  readonly steps: readonly ProcedureStep[];
}
```

### ActiveRetrievalController (3B.5)

```typescript
class ActiveRetrievalController {
  shouldRetrieve(context: RetrievalContext): RetrievalDecision;
  adaptiveRetrieve(context: RetrievalContext): Promise<AdaptiveResult>;
}

class QueryRewriter {
  rewrite(
    query: string, snippets: ReadonlyArray<string>, expansionLimit?: number,
  ): RewriteResult;
}

interface AdaptiveResult {
  bestResults: SearchResult[];
  bestCoverage: number;
  rounds: RetrievalRound[];
}
```

### WorldModelManager (3B.7)

```typescript
class WorldModelManager {
  getCurrentState(): Promise<WorldStateSnapshot>;
  validateFact(observation: string, entityName: string): Promise<MemoryValidationResult | null>;
  predictOutcome(actionEntity: string, candidateEffects: string[]): Promise<CausalChain[]>;
  detectStateChange(before: WorldStateSnapshot, after: WorldStateSnapshot): WorldStateChange;
}

class WorldStateSnapshot {
  readonly takenAt: string;
  readonly entitiesByName: ReadonlyMap<string, WorldStateEntity>;
  readonly size: number;
  entities(): ReadonlyArray<WorldStateEntity>;
  diffTo(next: WorldStateSnapshot): WorldStateChange;
  toJSON(): { takenAt: string; entities: WorldStateEntity[] };
  static fromJSON(json): WorldStateSnapshot;
}
```

### RBAC (η.6.1)

```typescript
class RoleAssignmentStore {
  constructor(options?: { persistencePath?: string });
  hydrate(): Promise<void>;
  assign(assignment: RoleAssignment): Promise<void>;
  revoke(agentId: string, role: Role, resourceType?: ResourceType): Promise<void>;
  list(agentId: string): RoleAssignment[];
  listActive(agentId: string, now?: string): RoleAssignment[];
}

class RbacMiddleware implements RbacPolicy {
  constructor(
    store: RoleAssignmentStore,
    options?: {
      matrix?: PermissionMatrix;
      overrides?: ResourcePermissionOverrides;
      defaultRole?: string;  // 'reader' default; pass undefined to deny unregistered
    },
  );
  checkPermission(
    agentId: string,
    action: Permission,
    resourceType: ResourceType,
    resourceName?: string,
    now?: string,
  ): boolean;
}
```

### PiiRedactor (η.6.3)

```typescript
class PiiRedactor {
  constructor(options?: {
    patterns?: ReadonlyArray<PiiPattern>;       // replaces default bank
    additionalPatterns?: ReadonlyArray<PiiPattern>;  // layered on top
  });
  redact(text: string): string;
  redactWithStats(text: string): RedactionResult;  // { text, stats }
  redactGraph<T>(graph: T): T;  // shallow clone; non-destructive
}

const DEFAULT_PII_PATTERNS: ReadonlyArray<PiiPattern>;
// Bundled: email, ssn, credit-card, phone, ipv4
```

### New error types

```typescript
// η.5.5.c — optimistic concurrency
class VersionConflictError extends KnowledgeGraphError {
  readonly entityName: string;
  readonly expected: number;
  readonly actual: number;
  readonly conflictingAgentId?: string;
}

// η.5.5.d — strict-mode attribution enforcement
class AttributionRequiredError extends KnowledgeGraphError {}
```

### `ManagerContext` — full lazy-getter list (current)

```typescript
// Core
ctx.entityManager / relationManager / observationManager / hierarchyManager
ctx.searchManager / rankedSearch / graphTraversal / tagManager / refIndex

// I/O + governance
ctx.ioManager / archiveManager / compressionManager / analyticsManager
ctx.semanticForget / governanceManager / freshnessManager

// Search extensions
ctx.semanticSearch / temporalSearch / activeRetrieval
ctx.llmQueryPlanner() / queryNaturalLanguage()
ctx.graphRankPrior / hybridSearchManager   // Unreleased — knowledge-graph-as-core convergence

// Memory + agent
ctx.memoryEngine / memoryBackend / contextWindowManager / agentMemory()

// Memory intelligence
ctx.memoryValidator / trajectoryCompressor / experienceExtractor / patternDetector

// Memory theory (3B)
ctx.procedureManager / causalReasoner / worldModelManager

// Auth
ctx.roleAssignmentStore / rbacMiddleware / accessTracker
```
