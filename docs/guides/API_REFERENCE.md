# MemoryJS API Reference

**Version**: 1.1.1
**Last Updated**: 2026-01-12

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
14. [HybridSearchManager](#hybridsearchmanager)
15. [Storage Classes](#storage-classes)
16. [Utility Functions](#utility-functions)
17. [Types & Interfaces](#types--interfaces)
18. [Error Classes](#error-classes)

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

#### search

```typescript
async search(
  query: string,
  options?: SearchOptions
): Promise<KnowledgeGraph>
```

Basic substring search.

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
const results = await ctx.searchManager.search('TypeScript', {
  tags: ['programming'],
  minImportance: 5,
  limit: 20
});
```

---

#### searchRanked

```typescript
async searchRanked(
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
const ranked = await ctx.searchManager.searchRanked('programming language', {
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

#### hybridSearch

```typescript
async hybridSearch(
  query: string,
  options?: HybridSearchOptions
): Promise<HybridSearchResult>
```

Three-layer search combining semantic, lexical, and symbolic signals.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `options.weights.semantic` | `number` | No | Semantic weight (default: 0.4) |
| `options.weights.lexical` | `number` | No | Lexical weight (default: 0.4) |
| `options.weights.symbolic` | `number` | No | Symbolic weight (default: 0.2) |
| `options.filters` | `SymbolicFilters` | No | Metadata filters |
| `options.limit` | `number` | No | Max results |

```typescript
const results = await ctx.searchManager.hybridSearch('machine learning', {
  weights: { semantic: 0.5, lexical: 0.3, symbolic: 0.2 },
  filters: { tags: ['ai'], minImportance: 5 },
  limit: 20
});
```

---

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
  from: string,
  to: string
): Promise<string[] | null>
```

Finds shortest path between two entities using BFS.

**Returns**: Path as array of entity names, or null if no path exists

```typescript
const path = await ctx.graphTraversal.findShortestPath('Alice', 'Bob');
// ['Alice', 'Charlie', 'Bob']
```

---

#### findAllPaths

```typescript
async findAllPaths(
  from: string,
  to: string,
  options?: PathOptions
): Promise<string[][]>
```

Finds all paths between entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | `string` | Yes | Start entity |
| `to` | `string` | Yes | End entity |
| `options.maxDepth` | `number` | No | Maximum path length |
| `options.maxPaths` | `number` | No | Maximum paths to return |

---

#### getCentrality

```typescript
async getCentrality(
  options?: CentralityOptions
): Promise<Map<string, number>>
```

Calculates centrality metrics for all nodes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.algorithm` | `string` | No | `'degree'`, `'betweenness'`, `'pagerank'` |

```typescript
const centrality = await ctx.graphTraversal.getCentrality({ algorithm: 'pagerank' });
centrality.forEach((score, name) => {
  console.log(`${name}: ${score.toFixed(4)}`);
});
```

---

#### getConnectedComponents

```typescript
async getConnectedComponents(): Promise<string[][]>
```

Finds connected components (subgraphs).

**Returns**: Array of entity name arrays, one per component

---

#### bfs

```typescript
async bfs(
  startNode: string,
  visitor: (node: string, depth: number) => void
): Promise<void>
```

Breadth-first traversal with visitor callback.

---

#### dfs

```typescript
async dfs(
  startNode: string,
  visitor: (node: string, depth: number) => void
): Promise<void>
```

Depth-first traversal with visitor callback.

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
async createBackup(options?: BackupOptions): Promise<BackupInfo>
```

Creates a timestamped backup.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.compress` | `boolean` | No | Brotli compression |
| `options.description` | `string` | No | Backup description |

```typescript
const backup = await ctx.ioManager.createBackup({ compress: true });
console.log(`Backup created: ${backup.id}`);
```

---

#### restoreBackup

```typescript
async restoreBackup(backupId: string): Promise<void>
```

Restores from a backup.

---

#### listBackups

```typescript
async listBackups(): Promise<BackupInfo[]>
```

Lists all available backups.

---

#### deleteBackup

```typescript
async deleteBackup(backupId: string): Promise<void>
```

Deletes a backup.

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
  issues: ValidationIssue[];
  warnings: ValidationWarning[];
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

Vector similarity search using embeddings.

### Constructor

```typescript
new SemanticSearch(
  storage: IGraphStorage,
  embeddingService: EmbeddingService,
  vectorStore: IVectorStore
)
```

### Methods

#### indexAll

```typescript
async indexAll(options?: SemanticIndexOptions): Promise<void>
```

Indexes all entities for semantic search.

```typescript
const embedding = await createEmbeddingService({ provider: 'openai' });
const vectorStore = createVectorStore('memory', storage);
const semantic = new SemanticSearch(storage, embedding, vectorStore);

await semantic.indexAll();
```

---

#### indexEntity

```typescript
async indexEntity(entity: Entity): Promise<void>
```

Indexes a single entity.

---

#### search

```typescript
async search(
  query: string,
  options?: SemanticSearchOptions
): Promise<SemanticSearchResult[]>
```

Searches by semantic similarity.

```typescript
const results = await semantic.search('functional programming concepts', {
  limit: 10,
  minScore: 0.7
});
```

---

#### findSimilar

```typescript
async findSimilar(
  entityName: string,
  options?: FindSimilarOptions
): Promise<SemanticSearchResult[]>
```

Finds entities similar to a given entity.

```typescript
const similar = await semantic.findSimilar('TypeScript', { limit: 5 });
```

---

## HybridSearchManager

Three-layer hybrid search.

### Constructor

```typescript
new HybridSearchManager(
  storage: IGraphStorage,
  semanticSearch?: SemanticSearch,
  rankedSearch?: RankedSearch
)
```

### Methods

#### search

```typescript
async search(
  query: string,
  graph: ReadonlyKnowledgeGraph,
  options?: HybridSearchOptions
): Promise<HybridSearchResult>
```

Executes hybrid search combining all three layers.

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

### HybridSearchResult

```typescript
interface HybridSearchResult {
  results: Array<{
    entity: Entity;
    score: number;
    layerScores: {
      semantic: number;
      lexical: number;
      symbolic: number;
    };
  }>;
  timing: {
    semantic: number;
    lexical: number;
    symbolic: number;
    total: number;
  };
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

**Document Version**: 1.0
**Last Updated**: 2026-01-12
