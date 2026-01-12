# MemoryJS Quick Reference

A concise cheat sheet for common MemoryJS operations.

---

## Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (for larger graphs)
const ctx = new ManagerContext('./memory.db');
```

---

## Entity Operations

```typescript
// Create
await ctx.entityManager.createEntities([
  { name: 'Alice', entityType: 'person', observations: ['Engineer'] }
]);

// Read
const entity = await ctx.entityManager.getEntityByName('Alice');
const all = await ctx.entityManager.getAllEntities();

// Update
await ctx.entityManager.updateEntity('Alice', { observations: ['Senior Engineer'] });

// Delete (cascades relations)
await ctx.entityManager.deleteEntities(['Alice']);

// Tags
await ctx.entityManager.addTags('Alice', ['important', 'active']);
await ctx.entityManager.removeTags('Alice', ['active']);

// Importance (0-10)
await ctx.entityManager.setImportance('Alice', 8);
```

---

## Relation Operations

```typescript
// Create
await ctx.relationManager.createRelations([
  { from: 'Alice', to: 'Acme Corp', relationType: 'works_at' }
]);

// Read
const { incoming, outgoing } = await ctx.relationManager.getRelationsForEntity('Alice');

// Delete
await ctx.relationManager.deleteRelations([
  { from: 'Alice', to: 'Acme Corp', relationType: 'works_at' }
]);
```

---

## Observations

```typescript
// Add
await ctx.observationManager.addObservations([
  { entityName: 'Alice', contents: ['New observation', 'Another one'] }
]);

// Delete
await ctx.observationManager.deleteObservations([
  { entityName: 'Alice', observations: ['Old observation'] }
]);
```

---

## Hierarchy

```typescript
// Set parent
await ctx.hierarchyManager.setEntityParent('Junior', 'Senior');

// Navigate
const children = await ctx.hierarchyManager.getChildren('Senior');
const parent = await ctx.hierarchyManager.getParent('Junior');
const ancestors = await ctx.hierarchyManager.getAncestors('Junior');
const descendants = await ctx.hierarchyManager.getDescendants('Senior');

// Get subtree with relations
const subtree = await ctx.hierarchyManager.getSubtree('Department');
```

---

## Search Operations

| Method | Use Case |
|--------|----------|
| `search()` | Basic substring matching |
| `searchRanked()` | TF-IDF relevance ranking |
| `booleanSearch()` | AND/OR/NOT operators |
| `fuzzySearch()` | Typo tolerance |
| `hybridSearch()` | Combined semantic+lexical+symbolic |

```typescript
// Basic search with filters
const results = await ctx.searchManager.search('query', {
  tags: ['important'],
  minImportance: 5,
  maxImportance: 10,
  entityType: 'person'
});

// Ranked search (TF-IDF)
const ranked = await ctx.searchManager.searchRanked('query', {
  limit: 20,
  minScore: 0.3
});

// Boolean search
const bool = await ctx.searchManager.booleanSearch(
  'name:Alice AND (type:person OR observation:engineer) AND NOT tag:archived'
);

// Fuzzy search (typo-tolerant)
const fuzzy = await ctx.searchManager.fuzzySearch('Typscript', {
  threshold: 0.7  // 0.0-1.0
});

// Hybrid search (multi-layer)
const hybrid = await ctx.searchManager.hybridSearch('query', {
  weights: { semantic: 0.4, lexical: 0.4, symbolic: 0.2 },
  filters: { tags: ['ai'], minImportance: 3 }
});
```

---

## Graph Algorithms

```typescript
// Shortest path
const path = await ctx.graphTraversal.findShortestPath('A', 'B');

// All paths
const paths = await ctx.graphTraversal.findAllPaths('A', 'B', { maxDepth: 5 });

// Centrality
const centrality = await ctx.graphTraversal.getCentrality({
  algorithm: 'pagerank'  // 'degree' | 'betweenness' | 'pagerank'
});

// Connected components
const components = await ctx.graphTraversal.getConnectedComponents();

// Traversal
await ctx.graphTraversal.bfs('Start', (node, depth) => console.log(node));
await ctx.graphTraversal.dfs('Start', (node, depth) => console.log(node));
```

---

## Import/Export

```typescript
// Export formats: json, csv, graphml, gexf, dot, markdown, mermaid
const json = await ctx.ioManager.exportGraph('json');
const mermaid = await ctx.ioManager.exportGraph('mermaid');

// Export with filters
const filtered = await ctx.ioManager.exportGraph('json', {
  filter: { tags: ['important'] },
  compress: true
});

// Import
const result = await ctx.ioManager.importGraph('json', data, {
  mergeStrategy: 'merge',  // 'merge' | 'replace' | 'skip' | 'fail'
  dryRun: true
});

// Backup
const backup = await ctx.ioManager.createBackup({ compress: true });
await ctx.ioManager.restoreBackup(backup.id);
const backups = await ctx.ioManager.listBackups();
await ctx.ioManager.deleteBackup(backup.id);
```

---

## Compression & Deduplication

```typescript
// Find duplicates (similarity threshold 0-1)
const duplicates = await ctx.compressionManager.findDuplicates(0.8);

// Merge entities
const merged = await ctx.compressionManager.mergeEntities(
  ['Alice', 'alice'],  // entities to merge
  'Alice'              // target name
);

// Auto-compress graph
await ctx.compressionManager.compressGraph(0.8, { dryRun: true });
```

---

## Analytics

```typescript
// Graph statistics
const stats = await ctx.analyticsManager.getGraphStats();
// { entityCount, relationCount, entityTypes, tagCounts, importanceDistribution }

// Validation
const validation = await ctx.analyticsManager.validateGraph();
// { issues: [], warnings: [] }
```

---

## Tag Management

```typescript
// Tag aliases
await ctx.tagManager.addTagAlias('ml', 'machine-learning');
const canonical = await ctx.tagManager.resolveTag('ml');  // 'machine-learning'
const aliases = await ctx.tagManager.getAliasesForTag('machine-learning');
await ctx.tagManager.removeTagAlias('ml');
```

---

## Semantic Search (requires embeddings)

```typescript
import { createEmbeddingService, createVectorStore, SemanticSearch } from '@danielsimonjr/memoryjs';

const embedding = await createEmbeddingService({ provider: 'openai' });
const vectorStore = createVectorStore('memory', storage);
const semantic = new SemanticSearch(storage, embedding, vectorStore);

// Index entities
await semantic.indexAll();

// Search by meaning
const results = await semantic.search('functional programming');

// Find similar entities
const similar = await semantic.findSimilar('TypeScript', { limit: 5 });
```

---

## Error Types

```typescript
import {
  EntityNotFoundError,
  ValidationError,
  CycleDetectedError,
  InvalidImportanceError,
  FileOperationError,
  InsufficientEntitiesError
} from '@danielsimonjr/memoryjs';

try {
  await ctx.entityManager.setImportance('Unknown', 5);
} catch (e) {
  if (e instanceof EntityNotFoundError) { /* handle */ }
}
```

---

## Environment Variables

| Variable | Values | Default |
|----------|--------|---------|
| `MEMORY_STORAGE_TYPE` | `jsonl`, `sqlite` | `jsonl` |
| `EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `none` |
| `OPENAI_API_KEY` | API key | - |

---

## Data Model

### Entity

```typescript
interface Entity {
  name: string;              // Unique ID (1-500 chars)
  entityType: string;        // Category
  observations: string[];    // Facts
  parentId?: string;         // Hierarchy parent
  tags?: string[];           // Labels (lowercase)
  importance?: number;       // Priority (0-10)
  createdAt?: string;        // ISO timestamp
  lastModified?: string;     // ISO timestamp
}
```

### Relation

```typescript
interface Relation {
  from: string;              // Source entity
  to: string;                // Target entity
  relationType: string;      // Edge type
  createdAt?: string;
  lastModified?: string;
}
```

---

## Storage Files

| File | Purpose |
|------|---------|
| `memory.jsonl` | Main graph (JSONL) |
| `memory.db` | Main graph (SQLite) |
| `*-saved-searches.jsonl` | Saved queries |
| `*-tag-aliases.jsonl` | Tag synonyms |

---

## Performance Tips

1. **Use batch operations** - Single I/O cycle
2. **Choose SQLite for >2,000 entities** - FTS5 indexing
3. **Apply filters early** - Reduce result set
4. **Use dry-run first** - Preview destructive ops
5. **Stream large exports** - Avoid memory issues

---

## Common Commands

```bash
# Build
npm run build

# Test
npm test
npm run test:coverage

# Type check
npm run typecheck
```
