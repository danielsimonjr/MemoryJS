# MemoryJS API Reference

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

**Version**: 4.5.0 (Unreleased changes noted inline)
**Last Updated**: 2026-11-06

> **Note:** sections below cover the v1.1-era surface. For the v1.6+ additions
> (Memory Engine, Memory Validator, Trajectory Compressor, Experience Extractor,
> Causal Reasoner, Procedure Manager, Active Retrieval, World Model, RBAC,
> PII Redactor, conflict view, audit enforcer, OCC, bitemporal versioning,
> RDF export) see the per-manager API tables in [README.md](../../README.md)
> and the architecture map in [docs/architecture/API.md](../architecture/API.md).
> For the post-v2.9.0 additions (event reification, evidence paths, relation
> consolidation, ingest provenance, NL-guided traversal) see
> [API surface added in 3.0.0 and later](#api-surface-added-in-300-and-later) at the
> bottom of this document.

Complete API documentation for all public classes, methods, and types.

> **Subpath exports (3.0.0):** the package ships subpath exports so bundlers can
> tree-shake unused managers. A `sideEffects` allowlist of the `sqlite-register` modules is **Unreleased** (see CHANGELOG `[Unreleased]`):
> `@danielsimonjr/memoryjs` (root), `/core`, `/search`, `/agent`, `/features`,
> `/utils`, `/types`, `/adapters`, `/security`, and `/sqlite` (isolates the
> SQLite backend so JSONL-only consumers never load the driver). Each
> subpath re-exports the same module barrel as before — only the import path
> changes:
> ```typescript
> import { EntityManager } from '@danielsimonjr/memoryjs/core';
> import { HybridSearchManager } from '@danielsimonjr/memoryjs/search';
> import { SQLiteStorage } from '@danielsimonjr/memoryjs/sqlite';
> ```

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
14. [GraphRankPrior](#graphrankprior) *(v2.9.0)*
15. [HybridSearchManager](#hybridsearchmanager)
16. [Storage Classes](#storage-classes)
17. [Utility Functions](#utility-functions)
18. [Types & Interfaces](#types--interfaces)
19. [Error Classes](#error-classes)
20. [API surface added in 3.0.0 and later](#api-surface-added-in-300-and-later) — EventManager, RelationConsolidator, evidence paths, ingest provenance

---

## ManagerContext

Central facade providing access to all managers.

### Constructor

```text
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
| `graphRankPrior` | `GraphRankPrior` | Cached graph-connectivity ranking signal (lazy, `@experimental`, v2.9.0) |
| `hybridSearchManager` | `HybridSearchManager` | Semantic + lexical + symbolic (+ optional graph) search (lazy, v2.9.0) |
| `eventManager` | `EventManager` | Event reification — actions as first-class hub entities (lazy, `@experimental`, 3.0.0) |

### Example

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const entities = await ctx.entityManager.listEntities();
```

---

## EntityManager

Manages entity CRUD operations.

### Methods

#### createEntities

```text
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

```text
async getEntityByName(name: string): Promise<Entity | null>
```

Retrieves a single entity by name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Entity name (case-sensitive) |

**Returns**: `Entity | null` - Entity or null if not found

```typescript
const entity = await ctx.entityManager.getEntity('TypeScript');
if (entity) {
  console.log(entity.observations);
}
```

---

#### getAllEntities

```text
async getAllEntities(): Promise<Entity[]>
```

Retrieves all entities.

**Returns**: `Entity[]` - All entities in the graph

---

#### deleteEntities

```text
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

```text
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

```text
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

```text
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

```text
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

```text
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

```text
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

```text
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

```text
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

```text
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
const relations = await ctx.relationManager.getRelations('TypeScript');
console.log(`${relations.length} relations`);
```

---

#### getAllRelations

```text
async getAllRelations(): Promise<Relation[]>
```

Gets all relations in the graph.

---

#### deleteRelations

```text
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

```text
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

```text
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

```text
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

```text
async getParent(entityName: string): Promise<Entity | null>
```

Gets an entity's parent.

---

#### getChildren

```text
async getChildren(entityName: string): Promise<Entity[]>
```

Gets an entity's direct children.

---

#### getAncestors

```text
async getAncestors(entityName: string): Promise<Entity[]>
```

Gets all ancestors (parent, grandparent, etc.).

---

#### getDescendants

```text
async getDescendants(entityName: string): Promise<Entity[]>
```

Gets all descendants recursively.

---

#### getSubtree

```text
async getSubtree(entityName: string): Promise<KnowledgeGraph>
```

Gets entity with all descendants and their relations.

```typescript
const subtree = await ctx.hierarchyManager.getSubtree('Engineering');
console.log(`${subtree.entities.length} entities, ${subtree.relations.length} relations`);
```

---

#### getRootEntities

```text
async getRootEntities(): Promise<Entity[]>
```

Gets all entities without parents.

---

#### getEntityDepth

```text
async getEntityDepth(entityName: string): Promise<number>
```

Gets depth in hierarchy (root = 0).

---

#### moveEntity

```text
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

```text
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
const results = await ctx.searchManager.searchNodes('TypeScript', ['programming'], 5);
```

---

#### searchNodesRanked

```text
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
const ranked = await ctx.searchManager.searchNodesRanked('programming language', undefined, undefined, undefined, 10);

ranked.forEach(r => {
  console.log(`${r.entity.name}: ${r.score.toFixed(3)}`);
});
```

---

#### booleanSearch

```text
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

```text
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
const results = await ctx.searchManager.fuzzySearch('Typscript', 0.7);
```

---

> **Note:** hybrid (semantic + lexical + symbolic + optional graph) search is
> not a `SearchManager` method — it is `ctx.hybridSearchManager.search(graph,
> query, options)`. See [HybridSearchManager](#hybridsearchmanager) below.

#### getSearchSuggestions

```text
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

```text
async saveSearch(search: SavedSearchInput): Promise<SavedSearch>
```

Saves a search for later execution.

```typescript
await ctx.searchManager.saveSearch({
  name: 'important-projects',
  query: 'project',
  tags: ['important'],
  minImportance: 7,
});
```

---

#### executeSavedSearch

```text
async executeSavedSearch(name: string): Promise<KnowledgeGraph>
```

Executes a saved search by name.

---

#### listSavedSearches

```text
async listSavedSearches(): Promise<SavedSearch[]>
```

Lists all saved searches.

---

## GraphTraversal

Graph algorithms and path finding.

### Methods

#### findShortestPath

```text
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

```text
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

```text
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

```text
async findConnectedComponents(): Promise<ConnectedComponentsResult>
```

Finds connected components (subgraphs).

**Returns**: `{ components: string[][], count: number, largestComponentSize: number }`

---

#### bfs / dfs

```text
bfs(startEntity: string, options?: TraversalOptions): TraversalResult
dfs(startEntity: string, options?: TraversalOptions): TraversalResult
```

Breadth-first / depth-first traversal. Both are **synchronous** (no `Promise`) and take an options object rather than a visitor callback.

**Returns**: `TraversalResult` (`{ nodes: string[], depths: Map<string, number>, parents: Map<string, string> }`)

---

#### findPathWithin *(3.0.0 — R2 evidence-path support)*

```text
async findPathWithin(
  source: string,
  target: string,
  maxDepth?: number,     // default 3
  options?: TraversalOptionsWithTracking
): Promise<PathResult | null>
```

Depth-bounded shortest path — identical semantics to `findShortestPath` but stops exploring beyond `maxDepth` hops, so worst-case cost is bounded on large graphs. Returns `null` when no path exists within the cap (a longer path may still exist beyond it).

```typescript
const short = await ctx.graphTraversal.findPathWithin('Alice', 'Bob', 3);
```

---

#### getNeighborsWithRelations — `lookFor` (NL-guided ranking) *(3.0.0, R7)*

```text
getNeighborsWithRelations(
  entityName: string,
  options?: TraversalOptions
): Array<{ neighbor: string; relation: Relation }>;

getNeighborsWithRelations(
  entityName: string,
  options: TraversalOptions & {
    lookFor: string;              // free-text description of the desired connection
    semanticSearch?: SimilarityProvider;  // optional; falls back to lexical Jaccard
  }
): Promise<Array<{ neighbor: string; relation: Relation; lookForScore?: number }>>;
```

Overloaded: without `options.lookFor` the method is unchanged (synchronous, unranked). With `lookFor` set, the same neighbor set is ranked by similarity between the free-text query and each neighbor's descriptor (`name + relationType + first 200 observation chars`) and the call returns a `Promise` of neighbors ordered best-first, each carrying `lookForScore` (0–1). `options.semanticSearch` (any object exposing `calculateSimilarity(a, b)`, e.g. `ctx.semanticSearch`) upgrades ranking from lexical Jaccard to semantic similarity.

```typescript
const ranked = await ctx.graphTraversal.getNeighborsWithRelations('project-x', {
  lookFor: 'who is blocking this release',
  semanticSearch: ctx.semanticSearch ?? undefined,
});
```

`HybridSearchManager`'s one-hop `expandNeighbors` also accepts a top-level `lookFor` option that ranks expansion neighbors the same way — see [HybridSearchManager](#hybridsearchmanager).

---

## IOManager

Import, export, and backup operations.

### Methods

#### exportGraph

```text
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
const graph = await ctx.storage.loadGraph();
const json = ctx.ioManager.exportGraph(graph, 'json');
const mermaid = ctx.ioManager.exportGraph(graph, 'mermaid');
const filtered = await ctx.ioManager.exportGraphWithCompression(graph, 'json', {
  filter: { tags: ['important'] },
  compress: true
});
```

---

#### importGraph

```text
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
declare const jsonData: string;
const result = await ctx.ioManager.importGraph('json', jsonData, 'merge', true);
console.log(`Would add ${result.entitiesAdded}, update ${result.entitiesUpdated}`);
```

---

#### createBackup

```text
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

```text
async restoreFromBackup(backupPath: string): Promise<RestoreResult>
```

Restores the graph from a backup file (by path — since v1.15.0 Phase 5 delegates to `BackupManager.restore()`, which rejects symlinks).

---

#### listBackups

```text
async listBackups(): Promise<BackupInfo[]>
```

Lists all available backups, sorted newest first.

---

#### deleteBackup

```text
async deleteBackup(backupPath: string): Promise<void>
```

Deletes a backup by path. Since v1.15.0 Phase 5 delegates to `BackupManager.delete()`, which validates the path stays in the backup directory and rejects symlinks.

---

#### cleanOldBackups

```text
async cleanOldBackups(keepCount?: number): Promise<number>
```

Keeps the `keepCount` most recent backups (default 10); deletes the rest.

---

## TagManager

Tag alias management.

### Methods

#### addTagAlias

```text
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

```text
async resolveTag(tag: string): Promise<string>
```

Resolves a tag to its canonical form.

```typescript
const canonical = await ctx.tagManager.resolveTag('ml');
// Returns: 'machine-learning'
```

---

#### listTagAliases

```text
async listTagAliases(): Promise<TagAlias[]>
```

Lists all tag aliases.

---

#### getAliasesForTag

```text
async getAliasesForTag(canonicalTag: string): Promise<string[]>
```

Gets all aliases for a canonical tag.

---

#### removeTagAlias

```text
async removeTagAlias(alias: string): Promise<boolean>
```

Removes a tag alias.

---

## CompressionManager

Duplicate detection and entity merging.

### Methods

#### findDuplicates

```text
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

```text
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

```text
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
const result = await ctx.compressionManager.compressGraph(0.8, true);
console.log(`Would merge ${result.entitiesMerged} entities (${result.duplicatesFound} duplicates)`);
```

---

## AnalyticsManager

Graph statistics and validation.

### Methods

#### getGraphStats

```text
async getGraphStats(): Promise<GraphStats>
```

Gets comprehensive graph statistics.

**Returns**:
```typescript
interface GraphStatsReport {
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

```text
async validateGraph(): Promise<ValidationReport>
```

Validates graph integrity.

**Returns**:
```text
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

```text
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
  importanceLessThan: 2,
  tags: ['deprecated']
}, { dryRun: false });
```

---

## SemanticSearch

Vector similarity search using embeddings. Note the constructor takes no
`storage` argument — `graph` is passed per-call to `indexAll`/`search`/
`findSimilar` instead.

### Constructor

```text
new SemanticSearch(
  embeddingService: EmbeddingService,
  vectorStore?: IVectorStore   // defaults to a new InMemoryVectorStore
)
```

### Methods

#### isAvailable

```text
async isAvailable(): Promise<boolean>
```

#### indexAll

```text
async indexAll(
  graph: ReadonlyKnowledgeGraph,
  options?: SemanticIndexOptions   // { forceReindex?, onProgress?, batchSize?, signal? }
): Promise<{ indexed: number; skipped: number; errors: number }>
```

Indexes all entities for semantic search. Incremental — entities already indexed are skipped unless `forceReindex` is set.

```typescript
import { SemanticSearch, createEmbeddingService } from '@danielsimonjr/memoryjs';
const embedding = await createEmbeddingService({ provider: 'openai' });
if (!embedding) throw new Error('No embedding provider configured');
const semantic = new SemanticSearch(embedding);

const graph = await ctx.entityManager.listEntities().then(entities => ({ entities, relations: [] }));
await semantic.indexAll(graph);
```

---

#### indexEntity

```text
async indexEntity(entity: Entity): Promise<boolean>
```

Indexes a single entity. Returns `false` on embedding failure instead of throwing.

---

#### search

```text
async search(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  limit?: number,          // default SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT
  minSimilarity?: number   // default SEMANTIC_SEARCH_LIMITS.MIN_SIMILARITY
): Promise<SemanticSearchResult[]>
```

Searches by semantic similarity.

```typescript
declare const semantic: import('@danielsimonjr/memoryjs').SemanticSearch;
const results = await semantic.search(graph, 'functional programming concepts', 10, 0.7);
```

---

#### findSimilar

```text
async findSimilar(
  graph: ReadonlyKnowledgeGraph,
  entityName: string,
  limit?: number,
  minSimilarity?: number
): Promise<SemanticSearchResult[]>
```

Finds entities similar to a given entity.

```typescript
declare const semantic: import('@danielsimonjr/memoryjs').SemanticSearch;
const similar = await semantic.findSimilar(graph, 'TypeScript', 5);
```

---

## GraphRankPrior

(v2.9.0, `@experimental`) Cached graph-connectivity ranking signal — normalized PageRank over `GraphTraversal`, with a degree-only fallback once the graph exceeds `maxPageRankEntities`. Event-invalidated (entity/relation events + `graph:saved`, so manager-level batch mutations don't leave it stale). Wired via `ctx.graphRankPrior` (lazy getter).

### Constructor

```text
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

```text
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

```text
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

```text
async search(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  options?: Partial<HybridSearchOptions> & {
    graphWeight?: number;  // graph channel weight, default 0 (off)
    expandNeighbors?: { hops: 1; topK?: number; damping?: number };
    // 3.0.0 (R2/R7) — see below
    explain?: boolean;
    explainOptions?: { maxDepth?: number; maxPathsPerResult?: number };
    lookFor?: string;
  }
): Promise<ExplainedHybridSearchResult[]>
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

##### `explain: true` — evidence paths *(3.0.0, R2)*

When `explain: true`, every result gains an `evidencePaths` array — the graph
paths connecting the query's direct anchor matches (entities that matched a
text layer directly) to the result — plus `evidenceTruncated` (true when a
depth/count cap changed the outcome). Off by default; `explain` omitted or
`false` is byte-identical to pre-R2 behavior (nothing is computed).

```typescript
import { HybridSearchResult } from '@danielsimonjr/memoryjs';
interface ExplainedHybridSearchResult extends HybridSearchResult {
  evidencePaths?: EvidencePath[];   // anchor → result shortest paths (BFS, undirected)
  evidenceTruncated?: boolean;      // a maxDepth/maxPathsPerResult cap bit
  lookForScore?: number;            // present on expandNeighbors results when lookFor is set
}

interface EvidencePath {
  nodes: string[];
  relations: Array<{ from: string; to: string; relationType: string }>;
  anchor: string;             // the query-matching entity this path starts from
  viaLayer: 'semantic' | 'lexical' | 'symbolic';
}
```

```typescript
const explained = await ctx.hybridSearchManager.search(graph, 'deployment failure', {
  explain: true,
  explainOptions: { maxDepth: 3, maxPathsPerResult: 3 },  // both are the defaults
});
for (const r of explained) {
  console.log(r.entity.name, r.evidencePaths?.map(p => p.nodes.join(' -> ')));
}
```

`LLMSearchExecutor.execute(query, { explain: true })` supports the same
option and wraps each entity as `{ entity, evidencePaths, evidenceTruncated }`.

Evidence paths are also computable standalone via `EvidencePathBuilder`
(`src/search/EvidencePathBuilder.ts`, `@experimental`) — bounded BFS over the
undirected projection of a `ReadonlyKnowledgeGraph`, capped by `maxDepth`
(default 3) and `maxPathsPerResult` (default 3):

```typescript
import { EvidencePathBuilder } from '@danielsimonjr/memoryjs/search';

const builder = new EvidencePathBuilder(graph, { maxDepth: 3, maxPathsPerResult: 3 });
const { paths, truncated } = builder.buildForResult('result-entity', [
  { name: 'anchor-entity', viaLayer: 'lexical', score: 0.8 },
]);
```

##### `lookFor` — NL-guided neighbor expansion *(3.0.0, R7)*

When `expandNeighbors` is active, pass `lookFor` (free text) to rank the
expansion neighbors by similarity to that text instead of expansion order;
matches carry `lookForScore`. See
[`GraphTraversal.getNeighborsWithRelations`](#graphtraversal) for the
underlying primitive.

#### searchWithEntities

Alias for `search()`.

```text
async searchWithEntities(
  graph: ReadonlyKnowledgeGraph,
  query: string,
  options?: Partial<HybridSearchOptions> & GraphHybridOptions
): Promise<HybridSearchResult[]>
```

#### getSymbolicSearch

```text
getSymbolicSearch(): SymbolicSearch
```

---

## Storage Classes

### GraphStorage (JSONL)

```text
new GraphStorage(memoryFilePath: string)
```

| Method | Description |
|--------|-------------|
| `loadGraph()` | Loads graph (cached) |
| `saveGraph(graph)` | Saves graph (invalidates cache) |
| `invalidateCache()` | Manually invalidate cache |

### SQLiteStorage

```text
new SQLiteStorage(dbPath: string)
```

| Method | Description |
|--------|-------------|
| `loadGraph()` | Loads graph |
| `saveGraph(graph)` | Saves graph |
| `searchFTS(query)` | FTS5 full-text search |
| `close()` | Close database connection |

Since v2.9.0, `SQLiteStorage` also implements `renameEntity(oldName, newName)` (the storage-level primitive backing `EntityManager.renameEntity`), `events` (a `GraphEventEmitter` with full parity to `GraphStorage` — `graph:loaded`/`saved`, `entity:created`/`updated`/`deleted`, `relation:created`), and `graphMutex` (fixes a crash in batch manager mutations against the raw SQLite backend). `IGraphStorage.renameEntity` and `.events` are both optional interface members so third-party/test implementations remain valid without changes.

### Factory Functions

```typescript
import { createStorage } from '@danielsimonjr/memoryjs';
import { createStorageFromPath } from '@danielsimonjr/memoryjs';
// Create from path (auto-detects type)
const storage = createStorageFromPath('./memory.jsonl');
// const storage = createStorageFromPath('./memory.db');  // alternative to the line above

// Create with explicit config
const sqliteStorage = createStorage({
  type: 'sqlite',
  path: './memory.db'
});
```

---

## Utility Functions

### Validation

```typescript
import { EntitySchema, validateTags } from '@danielsimonjr/memoryjs';
import {
  validateWithSchema,
  validateEntity,
  validateRelation,
  validateImportance,
  formatZodErrors
} from '@danielsimonjr/memoryjs';

// Schema validation
declare const input: unknown;

// Schema validation (throws on invalid input)
try {
  validateWithSchema(input, EntitySchema);
} catch (err) {
  console.error(err);
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
declare const items: string[];
declare function processItem(item: string): Promise<number>;

const results = await processBatch(items, processItem, {
  batchSize: 100,
  onProgress: ({ completed: done, total }) => console.log(`${done}/${total}`)
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
  id?: string;  // v2.9.0 — stable opaque UUID assigned at creation, preserved across
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

### HybridSearchResult

`HybridSearchManager.search()` resolves to `HybridSearchResult[]` — a flat array, not a wrapper object.

```typescript
import { Entity } from '@danielsimonjr/memoryjs';
interface HybridSearchResult {
  entity: Entity;
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
    combined: number;
    graph?: number;  // present when the graph channel is active (v2.9.0)
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
    console.error(`Entity not found: ${e.message}`);
  }
}
```

---

**Document Version**: 2.0
**Last Updated**: 2026-11-06

---

## v1.6 → v2.9.0 — added API surface

Sections above cover the original v1.1-era API. Below are the new
public surfaces shipped since.

### EntityManager — new methods

```text
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

  // v2.9.0 — knowledge-graph-as-core convergence
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

```text
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

```text
class ObservationManager {
  invalidateObservation(
    entityName: string, content: string, ended?: string,
  ): Promise<void>;
  observationsAsOf(entityName: string, asOf: string): Promise<string[]>;
}
```

### IOManager — new export formats (η.5.4 + v1.9)

```text
type ExportFormat =
  | 'json' | 'csv' | 'graphml' | 'gexf' | 'dot' | 'markdown' | 'mermaid'
  | 'turtle' | 'rdf-xml' | 'json-ld';  // ← new

class IOManager {
  exportGraph(graph: ReadonlyKnowledgeGraph, format: ExportFormat): string;

  // v1.9 conversation ingest pipeline (see "ingest provenance" below for
  // the 3.0.0 manifest/mode/tokenUsage additions)
  ingest(input: IngestInput, options?: IngestOptions): Promise<IngestResult>;
  splitSessions(content: string, options?: SplitOptions): Promise<SplitResult>;

  // v1.9.1 visualization
  visualizeGraph(options?: VisualizeOptions): Promise<string>;
}
```

#### `ingest` — provenance + cost/quality dial *(3.0.0, R4b/R5)*

Every `ingest()` run now writes a per-run **manifest entity**
(`entityType: 'ingest-manifest'`, name `ingest-<id>`) with one
`[chunk]: <JSON {id, source, offset, length, hash}>` observation line per
source chunk (raw chunk text is NOT stored by default — pass
`keepSourceText: true` to include it, capped at 4000 chars/chunk). Every
entity created by the run is linked back to the manifest with a
`derived_from` relation, and observations gain
`observationMeta[].sourceRef` (`<ingestId>-chunk-<n>`) — this is what lets
evidence paths extend `answer → relation → observation → source chunk`.

```typescript
import { LLMProvider } from '@danielsimonjr/memoryjs';
import type { IngestProduced } from '@danielsimonjr/memoryjs';
interface IngestOptions {
  // ...existing fields (projectId, entityType, tags, chunkBy, maxChunkSize,
  // deduplicateThreshold, dryRun) unchanged...

  /** Cost/quality dial. Default 'balanced' (= pre-R5 behavior). */
  mode?: 'accurate' | 'balanced' | 'lightweight';
  /** Store raw chunk text in the manifest (capped 4000 chars/chunk). Default false. */
  keepSourceText?: boolean;
  /** Enables LLM-based distillation enrichment (mode !== 'lightweight'). */
  llmProvider?: LLMProvider;
  /** 'accurate'-mode validation hook, invoked after entities/manifest/relations are written. */
  validate?: (produced: IngestProduced) => Promise<{ valid: boolean; issues?: string[] }>;
}

interface IngestResult {
  // ...existing fields (entitiesCreated, observationsAdded, skippedDuplicates,
  // entityNames) unchanged...
  ingestId: string;             // 8 hex chars
  manifestEntity: string;       // `ingest-<ingestId>` (unless dryRun or zero chunks)
  chunkCount: number;           // total source chunks produced (incl. skipped duplicates)
  tokenUsage?: { input: number; output: number; approximate: boolean };  // present only when the LLM ran
  validation?: { valid: boolean; issues?: string[] };  // present only in 'accurate' mode with a validator
}
```

**`mode` dial:**
- `'lightweight'` — heuristic extraction only; the LLM provider is **never** called even if configured.
- `'balanced'` (default) — LLM extraction when a provider is present, heuristic fallback otherwise (identical to pre-R5 behavior).
- `'accurate'` — LLM extraction when available, plus the `validate` hook is invoked after the write (the structural seam `RelationConsolidator` plugs into). Without a `validate` callback, `'accurate'` degrades to `'balanced'` with stricter heuristic thresholds.

```typescript
declare const conversationMessages: import('@danielsimonjr/memoryjs').IngestInput['messages'];
declare const myProvider: import('@danielsimonjr/memoryjs').LLMProvider;
const result = await ctx.ioManager.ingest(
  { messages: conversationMessages, source: 'support-thread-42' },
  { mode: 'accurate', llmProvider: myProvider, validate: async (produced) => ({ valid: true }) }
);
console.log(result.manifestEntity, result.chunkCount, result.tokenUsage);
```

### MemoryEngine (v1.11)

```text
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

  getRepeatedTurnCount(sessionId: string): number;

  deleteSession(sessionId: string): Promise<{ deleted: number }>;
  listSessions(): Promise<string[]>;
}
// Events: memoryEngine:turnAdded / duplicateDetected / sessionDeleted
```

### IMemoryBackend (v1.12)

```typescript
import { GetWeightedOptions, MemoryTurn, WeightedTurn } from '@danielsimonjr/memoryjs';
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

```text
import { MemoryValidationResult } from '@danielsimonjr/memoryjs';
import { ConflictResolver, Contradiction, Entity } from '@danielsimonjr/memoryjs';
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

```text
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

```text
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

```text
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

```text
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
import { AuditLog, Entity, EntityManager } from '@danielsimonjr/memoryjs';
declare class CollaborationAuditEnforcer {
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

```text
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
import type { Procedure, ProcedureMatch, ProcedureFeedback } from '@danielsimonjr/memoryjs';
type ProcedureStep = { order: number; action: string; parameters: Record<string, unknown>; fallback?: ProcedureStep };
declare class ProcedureManager {
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

declare class StepSequencer {
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

```text
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

```text
import { CausalChain, MemoryValidationResult, WorldStateChange, WorldStateEntity } from '@danielsimonjr/memoryjs';
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
import { Permission } from '@danielsimonjr/memoryjs';
import { PermissionMatrix, RbacPolicy, ResourcePermissionOverrides, ResourceType, Role, RoleAssignment } from '@danielsimonjr/memoryjs';
declare class RoleAssignmentStore {
  constructor(options?: { persistencePath?: string });
  hydrate(): Promise<void>;
  assign(assignment: RoleAssignment): Promise<void>;
  revoke(agentId: string, role: Role, resourceType?: ResourceType): Promise<void>;
  list(agentId: string): RoleAssignment[];
  listActive(agentId: string, now?: string): RoleAssignment[];
}

declare class RbacMiddleware implements RbacPolicy {
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

```text
import { PiiPattern, RedactionResult } from '@danielsimonjr/memoryjs';
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

Both are exported from the package root and extend `KnowledgeGraphError`:

```typescript
import { VersionConflictError, AttributionRequiredError } from '@danielsimonjr/memoryjs';
// η.5.5.c — optimistic concurrency: entityName, expected, actual, conflictingAgentId?
const conflict = new VersionConflictError('Alice', 3, 4);
// η.5.5.d — strict-mode attribution enforcement
const missing = new AttributionRequiredError('createEntities');
console.log(conflict.code, conflict.expected, missing.code);
```

### `ManagerContext` — lazy-getter list (current)

Every public getter, method, and factory on `ManagerContext`. Delegates live in `src/core/ManagerContext.ts`; the owning facade is in `src/core/context/`. Lazy getters construct once. Factories (`method`) build a new instance per call.

**Core storage and graph**

| Member | Kind | Notes |
|---|---|---|
| `ctx.entityManager` | getter | Entity CRUD and tags; governance hooks wired on first access |
| `ctx.relationManager` | getter | Relation CRUD |
| `ctx.observationManager` | getter | Observation CRUD; column store wired on first access when enabled |
| `ctx.observationColumnStore` | getter | Column sidecar or `null` (`MEMORY_OBSERVATIONS_COLUMNAR`) |
| `ctx.hierarchyManager` | getter | Parent/child hierarchy operations |
| `ctx.graphTraversal` | getter | Shortest path, components, centrality |
| `ctx.refIndex` | getter | Named reference index for O(1) stable lookups |
| `ctx.tieredPostingsIndex` | getter | Tiered index or `null` (`MEMORY_TIERED_INDEX`, `@internal`) |
| `ctx.compressedEntityCache` | getter | Compressed cache or `null` (`MEMORY_CACHE_COMPRESS`, `@internal`) |
| `ctx.bloomPreScreener` | getter | Bloom pre-screener or `null` (`MEMORY_FUZZY_BLOOM_PRESCREEN`) |
| `ctx.observationStore` | getter | Content-addressable observation store (opt-in) |
| `ctx.governanceManager` | getter | Policies, transactions, rollback |
| `ctx.auditLog` | getter | Same `AuditLog` instance as `governanceManager.auditLog` (no new construction) |

**Search**

| Member | Kind | Notes |
|---|---|---|
| `ctx.searchManager` | getter | All text, boolean, fuzzy, and time search |
| `ctx.rankedSearch` | getter | TF-IDF / BM25 ranked search |
| `ctx.graphRankPrior` | getter | Cached normalised PageRank signal |
| `ctx.hybridSearchManager` | getter | Semantic + lexical + symbolic (+ graph) layered search |
| `ctx.materializedViews` | getter | Materialised search views |
| `ctx.semanticSearch` | getter | Vector search or `null` when no embedding provider |
| `ctx.temporalSearch` | getter | Natural-language time-range search (`TemporalSearch`) |
| `ctx.autoLinker` | getter | Entity mention auto-linking |
| `ctx.factExtractor` | getter | Fact extraction from text |
| `ctx.llmQueryPlanner` | method | `llmQueryPlanner(config?)`: NL to structured query planner |
| `ctx.queryNaturalLanguage` | method | `queryNaturalLanguage(text)`: LLM-planned query; provider set first |

**I/O, tags, analytics, archive**

| Member | Kind | Notes |
|---|---|---|
| `ctx.ioManager` | getter | Import, export, backup, restore, `ingest()` |
| `ctx.streamingExporter` | method | `streamingExporter(filePath)`: new `StreamingExporter` per call (bound to one output file, so not lazy) |
| `ctx.tagManager` | getter | Tag aliases |
| `ctx.analyticsManager` | getter | Graph statistics and validation |
| `ctx.compressionManager` | getter | Duplicate detection and merging |
| `ctx.archiveManager` | getter | Archive to compressed storage |

**Agent memory**

| Member | Kind | Notes |
|---|---|---|
| `ctx.agentMemory` | method | `agentMemory(config?)`: `AgentMemoryManager` facade |
| `ctx.memoryEngine` | getter | Turn-aware conversation memory |
| `ctx.memoryBackend` | getter | `IMemoryBackend` selected by `MEMORY_BACKEND` |
| `ctx.contextWindowManager` | getter | Token-budgeted retrieval |
| `ctx.memoryFormatter` | getter | Formats memories for prompts |
| `ctx.salienceEngine` | getter | Context-aware salience scoring |
| `ctx.accessTracker` | getter | Access statistics |
| `ctx.decayEngine` | getter | Decay calculations |
| `ctx.decayScheduler` | getter | Decay timer (`MEMORY_AUTO_DECAY`); `undefined` when off |
| `ctx.consolidationScheduler` | getter | Consolidation timer; `undefined` unless `MEMORY_AUTO_CONSOLIDATION` or `MEMORY_CONSOLIDATION_SCHEDULER_ENABLED` is `true` |
| `ctx.dreamEngine` | method | `dreamEngine(config?)`: background maintenance |
| `ctx.observerPipeline` | getter | Observer pipeline; `undefined` unless `MEMORY_OBSERVER_PIPELINE` |
| `ctx.artifactManager` | getter | Artifact creation with stable names |
| `ctx.trajectoryCompressor` | getter | Trajectory compression |
| `ctx.experienceExtractor` | getter | Experience extraction |
| `ctx.patternDetector` | getter | Pattern detection |
| `ctx.observationDedupManager` | getter | Cross-entity duplicate observations |
| `ctx.exclusionManager` | getter | `do_not_remember` exclusion rules |
| `ctx.semanticForget` | getter | Two-tier deletion (exact, then semantic) |
| `ctx.freshnessManager` | getter | TTL and confidence freshness reports (`FreshnessManager`) |
| `ctx.memoryValidator` | getter | Pre-storage validation |
| `ctx.heuristicManager` | getter | Condition to action heuristics |
| `ctx.decisionManager` | getter | Decision records |
| `ctx.projectContextManager` | getter | Project context |
| `ctx.spellChecker` | getter | Spelling suggestions |
| `ctx.toolAffordanceManager` | getter | Tool affordances |
| `ctx.toolCallObserver` | getter | Tool call observation |

**Cognition (3B and events)**

| Member | Kind | Notes |
|---|---|---|
| `ctx.procedureManager` | getter | Procedural memory |
| `ctx.createProceduralGraph` | method | `createProceduralGraph(config)`: procedural graph factory |
| `ctx.eventManager` | getter | Event reification (`@experimental`) |
| `ctx.prospectiveMemory` | getter | Prospective memory triggers |
| `ctx.failureManager` | getter | Failure records |
| `ctx.plan` | getter | Plan manager |
| `ctx.reflectionManager` | getter | Reflections |
| `ctx.causalReasoner` | getter | `findCauses`, `findEffects`, counterfactuals |
| `ctx.worldModelManager` | getter | World-model snapshots and diffs |
| `ctx.activeRetrieval` | getter | Iterative query rewriting |
| `ctx.reconstructiveMemory` | method | `reconstructiveMemory(config?)`: cue-tag-content memory (`@experimental`) |

**Access control**

| Member | Kind | Notes |
|---|---|---|
| `ctx.roleAssignmentStore` | getter | RBAC grants: `assign`, `revoke`, `list`, `listActive`, `hydrate` |
| `ctx.rbacMiddleware` | getter | `checkPermission(agentId, action, resourceType, resourceName?, now?)`, sync |

**Knowledge and Recursa**

| Member | Kind | Notes |
|---|---|---|
| `ctx.skillManager` | getter | Skill registry (`@experimental`) |
| `ctx.instructionSets` | getter | Role-scoped instruction sets |
| `ctx.knowledgeRepository` | getter | Snapshots, revisions, `loadForContext()` |
| `ctx.skillPublisher` | getter | Atomic `SKILL.md` publish and import; confined to `skillPublishRoot` |
| `ctx.transitionLedger` | getter | Transition history; `null` unless `MEMORY_TRANSITION_LEDGER` |
| `ctx.learningLoop` | method | `learningLoop(deps)`: leaf or recursive learner; see [Learning](#learning-recursa-rs-14-to-rs-21) |
| `ctx.bootstrapper` | method | `bootstrapper(deps?)`: corpus bootstrapping; see [Bootstrap](#bootstrap-recursa-rs-10-to-rs-13) |

**Infrastructure and diagnostics**

| Member | Kind | Notes |
|---|---|---|
| `ctx.indexHealth` | method | `indexHealth()`: index health snapshot |
| `ctx.diagnostics` | method | `diagnostics(options?)`: aggregate report over `indexHealth()` |
| `ctx.close` | method | Release the storage handle and detach listeners |

Count: 80 members, generated from `src/core/ManagerContext.ts`.

---

## Recursa and knowledge APIs

Recursa adds skills, instruction sets, a learning loop, bootstrapping,
evaluation, a harness log, and a tool adapter. Every surface below is
`@experimental`. Use the root entry point:

```typescript
import {
  ManagerContext,
  DeterministicJudge,
  createRecursaTools,
} from '@danielsimonjr/memoryjs';
```

### Knowledge: SkillPublisher and KnowledgeRepository

`ctx.skillManager` stores skills. `ctx.skillPublisher` writes them to `SKILL.md`
files, confined to `skillPublishRoot` (see [SECURITY_GUIDE.md](./SECURITY_GUIDE.md#recursa-hardening)).
`ctx.knowledgeRepository` snapshots skills, instructions, and failure lessons for a prompt.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
const ctx = new ManagerContext({ storagePath: './memory.jsonl', skillPublishRoot: process.cwd() });

// Load the knowledge a solver should see for a task (additive options)
const loaded = await ctx.knowledgeRepository.loadForContext({
  role: 'solver',
  taskHint: 'ledger totals',
  maxSkills: 5,
});
// loaded.markdown is ordered instructions -> skills -> failure lessons
```

### Learning (Recursa RS-14 to RS-21)

`ctx.learningLoop(deps)` returns a fresh loop per call. Runs with more tasks than
`MEMORY_LEARNING_LEAF_THRESHOLD` (default `20`) use the recursive learner. Pass
`leafThreshold` to override it. Learned skills are written to `publishDir`.

```typescript
declare const taskIds: string[];
import { DeterministicJudge } from '@danielsimonjr/memoryjs';
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
declare const solver: import('@danielsimonjr/memoryjs').LearningSolver;
const loop = ctx.learningLoop({
  solver,                      // LearningSolver: solve(task, knowledge, signal?)
  judge: new DeterministicJudge(),
  publishDir: './skills',
});

const result = await loop.learn({
  taskIds,
  tasks,
  budget: { maxRounds: 3 },
  validationSampleSize: 4,
  split: 'auto',
});
```

**Step-wise protocol (leaf run).** When the harness owns the solver, drive the
leaf learner one step at a time. `next` returns the next request, and `submit`
returns the answers or judgements for it.

```typescript
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
declare const loop: ReturnType<typeof ctx.learningLoop>;
declare const answers: Record<string, import('@danielsimonjr/memoryjs').SolveResult | null>;
const { traceId } = await loop.start({ taskIds: tasks.map((t) => t.id), tasks, budget: { maxRounds: 3 } });
for (;;) {
  const step = await loop.next(traceId);
  if (step.kind === 'done') break;
  // solve the requested tasks with step.tasks, then submit
  await loop.submit(traceId, 'solve', answers);
}
```

`loop.status(traceId)` returns the current state and report. A recursive run is
driven with `plan`, `submitChild`, `merge`, and `reflect` instead of `next` and `submit`.

### Bootstrap (Recursa RS-10 to RS-13)

`ctx.bootstrapper(deps)` maps a corpus, records coverage per region, writes
exploration notes, generates practice tasks, and optionally runs learning.

```typescript
declare const corpusSources: import('@danielsimonjr/memoryjs').CorpusSource[];
const boot = await ctx.bootstrapper({ learning: { publishDir: './skills' } }).run({
  sources: corpusSources,      // corpus loader inputs
  budget: { maxRounds: 2 },
  corpusLabel: 'corpus',
});
// boot.taskIds, boot.notesSkillId
```

### Evaluation (Recursa RS-25/26)

`Evaluator` scores a solver against tasks. `DeterministicJudge` checks `fact`,
`number`, `set-*`, and `document` criteria. `free` criteria need an LLM judge.

```typescript
import { Evaluator, DeterministicJudge, stratifiedSplit } from '@danielsimonjr/memoryjs';
declare const tasks: import('@danielsimonjr/memoryjs').TaskRecord[];
declare const solver: import('@danielsimonjr/memoryjs').Solver;

const evaluator = new Evaluator();
const { metrics, feedback } = await evaluator.evaluate(tasks, solver, new DeterministicJudge());
const { train, test } = stratifiedSplit(tasks, { seed: 7, testFraction: 0.25, by: 'difficulty' });
```

### Harness support (InteractionLog, EvictionIndex, ConcurrencyLimiter)

`InteractionLog` is an append-only sidecar, `<basename>-interactions.jsonl`, that
addresses records `e<n>`. Large content spills to blobs. `select` returns excerpts.

```typescript
import { InteractionLog } from '@danielsimonjr/memoryjs';
import { runAll } from '@danielsimonjr/memoryjs/agent';

const log = new InteractionLog('./memory.jsonl');
const addr = await log.append({ kind: 'tool_call', content: 'lookup result', sessionId: 'session-1' });
const excerpt = await log.select(addr, { regex: 'result', lines: [1, 20] });

declare const items: string[];
declare function process(item: string): Promise<string>;
const results = await runAll(items, async (item) => process(item), { concurrency: 4 });
```

`ctx.toolCallObserver` records tool calls into the log when wired with
`setInteractionLog(log, sessionId?)`. `ContextWindowManager.setEvictionIndex`
shows spilled ranges as `[evicted]` lines.

### Reconstructive memory (MRAgent)

`ctx.reconstructiveMemory(config?)` builds a cue-tag-content graph from
conversation turns and answers queries by reconstructing evidence over several
steps. It defaults to the context's own managers as its backing store.

```typescript
const memory = ctx.reconstructiveMemory();
await memory.ingest([
  { id: 'D1:1', speaker: 'user', text: 'I moved to Lisbon in March.' },
]);
const answer = await memory.reconstruct('Where did the user move?');
```

### RecursaToolAdapter

`createRecursaTools(ctx, deps?)` exposes the Recursa tools as stateless JSON calls.
`call` never throws, and results are capped at `maxBytes` (default 64 KiB).
Skills tools need `deps.publishDir`.

```typescript
import { createRecursaTools } from '@danielsimonjr/memoryjs';
const tools = createRecursaTools(ctx, { publishDir: './skills' });
console.log(tools.list().map((t) => t.name));

const loaded = await tools.call('recursa.knowledge.load', { role: 'solver', taskHint: 'ledger totals' });
if (loaded.ok) console.log(loaded.result);
```

Error codes: `invalid_args`, `not_found`, `invalid_state`, `not_configured`,
`solver_required`, `aborted`, `unknown_tool`, `internal_error`.


## API surface added in 3.0.0 and later

Post-v2.9.0 additions. `explain`/`lookFor` on `HybridSearchManager.search`,
`GraphTraversal.findPathWithin`/`getNeighborsWithRelations(lookFor)`, and the
`ingest()` provenance/mode additions are documented inline in their
respective sections above (§[GraphTraversal](#graphtraversal),
§[HybridSearchManager](#hybridsearchmanager), §[IOManager](#iomanager)).
This section covers the two new standalone classes: `EventManager` and
`RelationConsolidator`.

### EventManager (R1 — event reification) `@experimental`

Wired via `ctx.eventManager` (lazy getter over `ctx.entityManager` /
`ctx.relationManager`). Reifies actions as first-class `entityType: 'event'`
hub entities — "who did what, to whom, where, when" as one queryable unit —
instead of flat triples. Pure convention layer; no schema changes.

```typescript
import { EntityManager } from '@danielsimonjr/memoryjs';
import { EventRecord, RelationManager } from '@danielsimonjr/memoryjs';
declare class EventManager {
  constructor(
    entityManager: EntityManager,
    relationManager: RelationManager,
    config?: { autoCreateEndpoints?: boolean }  // default true
  );

  recordEvent(input: {
    action: string;             // required
    actor: string;              // required
    target?: string;
    context?: string;
    participants?: string[];
    occurredAt?: string | Date;
    flowKey?: string;           // groups events under tag `flow:<key>`
    detail?: string | string[];
    importance?: number;
  }): Promise<EventRecord>;

  getEvent(name: string): Promise<EventRecord | null>;
  queryEvents(filter?: {
    actor?: string; target?: string; action?: string; flowKey?: string;
    timeRange?: { start?: string | Date; end?: string | Date };
    limit?: number;
  }): Promise<EventRecord[]>;
  getFlow(flowKey: string): Promise<EventRecord[]>;         // chronological events sharing a flow key
  whoDidWhat(filter?: {
    target?: string; context?: string;
    timeRange?: { start?: string | Date; end?: string | Date };
    limit?: number;
  }): Promise<Array<{ actor: string; action: string; event: EventRecord; occurredAt?: string }>>;
}
```

Each event hub entity is named `event-<action>-<shortId>` and linked to its
participants with role-typed relations: `actor —actor_of→ event`,
`event —targeted→ target`, `event —occurred_in→ context`,
`participant —participant_in→ event`. Missing endpoint entities are
auto-created as lightweight `entityType: 'concept'` stubs by default
(`autoCreateEndpoints: false` throws before writing anything instead).
Reads use the `TypeIndex`/`RelationIndex` — never a full-graph scan.

```typescript
await ctx.eventManager.recordEvent({
  action: 'deployed',
  actor: 'alice',
  target: 'api-service',
  context: 'production',
  occurredAt: '2026-07-24T12:00:00Z',
  flowKey: 'release-42',
});
const flow = await ctx.eventManager.getFlow('release-42');
const who = await ctx.eventManager.whoDidWhat({ target: 'api-service' });
```

### RelationConsolidator (R3 — relation "Janitor" pass) `@experimental`

Not wired to `ManagerContext` — construct directly with `ctx.relationManager`
(and optionally `ctx.entityManager`, an embedding provider, and an
`LLMProvider`). A three-tier dedup/validation pass for relations
(`ConsolidationPipeline` had historically been entity/observation-only):

```text
import { RelationConsolidationReport, RelationConsolidationResult } from '@danielsimonjr/memoryjs';
import { LLMProvider, Relation } from '@danielsimonjr/memoryjs';
class RelationConsolidator {
  constructor(
    relationOps: { getRelations, createRelations, deleteRelations },  // RelationManager-compatible
    entityOps?: { listEntities },                                     // enables tier 1/2 graph scan
    options?: {
      embedding?: { embed, embedBatch? };  // enables tier 2 (semantic dedup)
      llm?: LLMProvider;                    // enables tier 3 (neighborhood validation)
      thresholds?: { semantic?: number };    // default 0.90
      maxGroups?: number;                    // default 100
      maxLlmBatch?: number;                  // default 50
      maxNeighborhoodRelations?: number;      // default 200
    }
  );

  analyze(options?: { newRelations?: Relation[] }): Promise<RelationConsolidationReport>;
  consolidate(options?: {
    newRelations?: Relation[];
    apply?: boolean;   // default false = dry-run, alias for analyze()
  }): Promise<RelationConsolidationResult>;
}
```

- **Tier 1 (exact/near-exact)** — same-`(from, to)` relations whose
  `relationType`s are trivial spelling variants (`works_at` vs `works-at` vs
  `WorksAt`) merge onto the canonical (most-used, tie → oldest) spelling.
  Also flags `properties.bidirectional`-marked inverse-direction duplicates.
- **Tier 2 (semantic, embedding-gated)** — same-pair relations whose
  descriptors have cosine similarity ≥ threshold (default 0.90) are flagged
  as semantic duplicates. Skipped silently without an embedding provider.
- **Tier 3 (neighborhood validation, LLM-gated)** — a caller-supplied batch
  of new relations (e.g. freshly ingested) is validated against a 2-hop
  neighborhood snapshot; returns `'ok' | 'suspect' | 'wrong'` verdicts as
  `ConsolidationFeedback`. **Never mutates** — the caller decides what to do.
  Skipped silently without an `LLMProvider`.

`consolidate({ apply: true })` applies tier 1+2 merges via
`deleteRelations` + `createRelations` (tier 3 always stays report-only).

```typescript
declare const myLlmProvider: import('@danielsimonjr/memoryjs').LLMProvider;
declare const embedding: import('@danielsimonjr/memoryjs').EmbeddingService;
import { RelationConsolidator } from '@danielsimonjr/memoryjs';
declare const freshlyIngested: import('@danielsimonjr/memoryjs').Relation[];
const janitor = new RelationConsolidator(ctx.relationManager, ctx.entityManager, {
  embedding,
  llm: myLlmProvider,
});
const report = await janitor.analyze({ newRelations: freshlyIngested });
const result = await janitor.consolidate({ apply: true });
console.log(result.relationsDeleted, result.relationsCreated);
```

A `RelationConsolidationStage implements PipelineStage` wrapper exists for
`ConsolidationPipeline` (not auto-registered — construct and
`pipeline.registerStage(new RelationConsolidationStage(janitor))`
explicitly); report-only by default, emits `[info]`-prefixed findings on
`StageResult.errors`.
