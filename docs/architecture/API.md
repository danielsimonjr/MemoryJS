# MemoryJS - API Reference

**Version**: 1.0.0
**Last Updated**: 2026-01-10

Complete reference for the MemoryJS library public API.

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
12. [Types](#types)

---

## ManagerContext

Central access point for all managers. Provides lazy-initialized access to all subsystems.

### Constructor

```typescript
new ManagerContext(config: ManagerContextConfig)
```

**Parameters:**
```typescript
interface ManagerContextConfig {
  storagePath: string;          // Path to storage file
  storageType?: 'jsonl' | 'sqlite';  // Storage backend (default: 'jsonl')
}
```

**Example:**
```typescript
// JSONL storage (default)
const ctx = new ManagerContext({ storagePath: './memory.jsonl' });

// SQLite storage
const ctx = new ManagerContext({
  storagePath: './memory.db',
  storageType: 'sqlite'
});
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
| `storage` | `IGraphStorage` | Direct storage access |

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

### getRelationsForEntity

Get all relations for an entity.

```typescript
async getRelationsForEntity(entityName: string): Promise<{
  incoming: Relation[];
  outgoing: Relation[];
}>
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

### search

Basic text search.

```typescript
async search(query: string, options?: SearchOptions): Promise<KnowledgeGraph>
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
const results = await ctx.searchManager.search('TypeScript', {
  tags: ['programming'],
  minImportance: 5
});
```

### searchRanked

TF-IDF relevance-ranked search.

```typescript
async searchRanked(query: string, options?: RankedSearchOptions): Promise<SearchResult[]>
```

**Returns:**
```typescript
interface SearchResult {
  entity: Entity;
  score: number;
  matchedFields: string[];
}
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

### hybridSearch

Three-layer hybrid search combining semantic, lexical, and symbolic signals.

```typescript
async hybridSearch(query: string, options?: HybridSearchOptions): Promise<HybridSearchResult>
```

**Parameters:**
```typescript
interface HybridSearchOptions {
  weights?: {
    semantic?: number;   // Default: 0.4
    lexical?: number;    // Default: 0.4
    symbolic?: number;   // Default: 0.2
  };
  filters?: SymbolicFilters;
  limit?: number;
  minScore?: number;
}
```

### smartSearch

AI-assisted search with query analysis and refinement.

```typescript
async smartSearch(query: string, options?: SmartSearchOptions): Promise<SmartSearchResult>
```

### getSearchSuggestions

Get "did you mean" suggestions.

```typescript
async getSearchSuggestions(query: string, limit?: number): Promise<string[]>
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

---

## GraphTraversal

Graph algorithms and traversal operations.

### findShortestPath

Find shortest path between two entities.

```typescript
async findShortestPath(from: string, to: string): Promise<string[] | null>
```

**Returns:** Array of entity names in path, or `null` if no path exists

### findAllPaths

Find all paths between two entities.

```typescript
async findAllPaths(from: string, to: string, options?: PathOptions): Promise<string[][]>
```

**Parameters:**
```typescript
interface PathOptions {
  maxDepth?: number;  // Maximum path length (default: 10)
  maxPaths?: number;  // Maximum paths to return
}
```

### getCentrality

Calculate node centrality.

```typescript
async getCentrality(options?: CentralityOptions): Promise<Map<string, number>>
```

**Parameters:**
```typescript
interface CentralityOptions {
  algorithm?: 'degree' | 'betweenness' | 'pagerank';  // Default: 'degree'
  iterations?: number;  // For pagerank (default: 100)
  dampingFactor?: number;  // For pagerank (default: 0.85)
}
```

### getConnectedComponents

Find connected components in the graph.

```typescript
async getConnectedComponents(): Promise<string[][]>
```

**Returns:** Array of components, each an array of entity names

### bfs

Breadth-first traversal.

```typescript
async bfs(startNode: string, visitor: (node: string) => void): Promise<void>
```

### dfs

Depth-first traversal.

```typescript
async dfs(startNode: string, visitor: (node: string) => void): Promise<void>
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

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Maintained By**: Daniel Simon Jr.
