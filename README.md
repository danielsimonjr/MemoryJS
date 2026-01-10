# @danielsimonjr/memoryjs

Core knowledge graph library for managing entities, relations, and observations with advanced search capabilities.

## Features

- **Entity Management**: Create, read, update, delete entities with observations
- **Relation Management**: Connect entities with typed relationships
- **Hierarchical Organization**: Parent-child entity nesting
- **Multiple Storage Backends**: JSONL (default) or SQLite
- **Advanced Search**: Basic, ranked (TF-IDF), boolean, fuzzy, semantic, and hybrid search
- **Tag Management**: Tag aliasing, bulk operations
- **Graph Algorithms**: Shortest path, centrality, connected components
- **Import/Export**: JSON, CSV, GraphML formats with compression

## Installation

```bash
npm install @danielsimonjr/memoryjs
```

## Quick Start

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Initialize with JSONL storage (default)
const ctx = new ManagerContext({
  storagePath: './memory.jsonl'
});

// Create entities
await ctx.entityManager.createEntities([
  { name: 'TypeScript', entityType: 'language', observations: ['A typed superset of JavaScript'] },
  { name: 'Node.js', entityType: 'runtime', observations: ['JavaScript runtime built on V8'] }
]);

// Create relations
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' }
]);

// Search entities
const results = await ctx.searchManager.search('JavaScript');
```

## Storage Options

### JSONL (Default)

```typescript
const ctx = new ManagerContext({
  storagePath: './memory.jsonl'
});
```

### SQLite

```typescript
const ctx = new ManagerContext({
  storageType: 'sqlite',
  storagePath: './memory.db'
});
```

SQLite provides:
- FTS5 full-text search with BM25 ranking
- Referential integrity (ON DELETE CASCADE)
- WAL mode for better concurrency
- ACID transactions

## Core Components

### ManagerContext

Central access point for all managers:

```typescript
ctx.entityManager    // Entity CRUD + hierarchy
ctx.relationManager  // Relation management
ctx.searchManager    // All search operations
ctx.tagManager       // Tag aliases
ctx.ioManager        // Import/export/backup
ctx.graphTraversal   // Graph algorithms
ctx.semanticSearch   // Vector similarity search (optional)
```

### Entity Structure

```typescript
interface Entity {
  name: string;           // Unique identifier
  entityType: string;     // Classification
  observations: string[]; // Facts about the entity
  parentId?: string;      // For hierarchy
  tags?: string[];        // Categories
  importance?: number;    // 0-10 scale
  createdAt?: string;     // ISO 8601
  lastModified?: string;
}
```

### Relation Structure

```typescript
interface Relation {
  from: string;          // Source entity name
  to: string;            // Target entity name
  relationType: string;  // Connection type
}
```

## Search Capabilities

### Basic Search

```typescript
// Find entities by name or observation content
const results = await ctx.searchManager.search('TypeScript');
```

### Ranked Search (TF-IDF)

```typescript
// Get relevance-scored results
const ranked = await ctx.searchManager.searchRanked('JavaScript runtime', { limit: 10 });
```

### Boolean Search

```typescript
// AND, OR, NOT operators
const results = await ctx.searchManager.booleanSearch('TypeScript AND runtime');
const excluded = await ctx.searchManager.booleanSearch('JavaScript NOT browser');
```

### Fuzzy Search

```typescript
// Typo-tolerant search
const results = await ctx.searchManager.fuzzySearch('Typscript', { threshold: 0.7 });
```

### Hybrid Search

Combines semantic (vector), lexical (TF-IDF), and symbolic (metadata) signals:

```typescript
const results = await ctx.searchManager.hybridSearch('programming concepts', {
  weights: { semantic: 0.5, lexical: 0.3, symbolic: 0.2 },
  filters: { entityTypes: ['concept'], minImportance: 5 }
});
```

## Graph Algorithms

```typescript
// Shortest path between entities
const path = await ctx.graphTraversal.findShortestPath('A', 'Z');

// All paths up to max depth
const paths = await ctx.graphTraversal.findAllPaths('A', 'Z', { maxDepth: 5 });

// Centrality analysis
const centrality = await ctx.graphTraversal.getCentrality({ algorithm: 'pagerank' });

// Connected components
const components = await ctx.graphTraversal.getConnectedComponents();
```

## Import/Export

```typescript
// Export to JSON
const json = await ctx.ioManager.exportGraph('json');

// Export to CSV
const csv = await ctx.ioManager.exportGraph('csv');

// Export to GraphML (with compression)
await ctx.ioManager.exportGraph('graphml', {
  outputPath: './graph.graphml.br',
  compress: true
});

// Import from file
await ctx.ioManager.importGraph('json', jsonData, { mergeStrategy: 'merge' });
```

## Hierarchical Organization

```typescript
// Set parent
await ctx.entityManager.setEntityParent('Component', 'Module');

// Get hierarchy
const children = await ctx.entityManager.getChildren('Module');
const ancestors = await ctx.entityManager.getAncestors('Component');
const subtree = await ctx.entityManager.getSubtree('Module');
```

## Tag Management

```typescript
// Add/remove tags
await ctx.entityManager.addTags('Entity1', ['tag1', 'tag2']);
await ctx.entityManager.removeTags('Entity1', ['tag1']);

// Tag aliases (synonyms)
await ctx.tagManager.addTagAlias('js', 'javascript');

// Bulk operations
await ctx.entityManager.addTagsToMultipleEntities(['E1', 'E2'], ['shared-tag']);
```

## API Reference

### EntityManager

| Method | Description |
|--------|-------------|
| `createEntities(entities)` | Create multiple entities |
| `deleteEntities(names)` | Delete entities by name |
| `getEntityByName(name)` | Get single entity |
| `addObservations(name, observations)` | Add observations to entity |
| `deleteObservations(name, observations)` | Remove observations |
| `addTags(name, tags)` | Add tags to entity |
| `removeTags(name, tags)` | Remove tags from entity |
| `setImportance(name, score)` | Set importance (0-10) |
| `setEntityParent(name, parentName)` | Set hierarchy parent |
| `getChildren(name)` | Get child entities |
| `getAncestors(name)` | Get ancestor chain |
| `getDescendants(name)` | Get all descendants |

### SearchManager

| Method | Description |
|--------|-------------|
| `search(query, options)` | Basic search |
| `searchRanked(query, options)` | TF-IDF ranked search |
| `booleanSearch(query, options)` | Boolean operators |
| `fuzzySearch(query, options)` | Typo-tolerant |
| `hybridSearch(query, options)` | Multi-signal search |
| `smartSearch(query, options)` | AI-assisted refinement |

### IOManager

| Method | Description |
|--------|-------------|
| `exportGraph(format, options)` | Export to format |
| `importGraph(format, data, options)` | Import from format |
| `createBackup(options)` | Create backup |
| `restoreBackup(path)` | Restore from backup |

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## License

MIT

## Related

- [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) - MCP server built on this library
