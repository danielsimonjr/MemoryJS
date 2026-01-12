# MemoryJS Developer Implementation Guide

**Version**: 1.1.1
**Last Updated**: 2026-01-12
**Based on**: Dependency Graph Analysis & Codebase Exploration

---

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Quick Start](#quick-start)
4. [Module Deep Dives](#module-deep-dives)
   - [Core Module](#core-module)
   - [Search Module](#search-module)
   - [Features Module](#features-module)
   - [Utils Module](#utils-module)
   - [Workers Module](#workers-module)
5. [Design Patterns](#design-patterns)
6. [Data Model](#data-model)
7. [Storage Backends](#storage-backends)
8. [Search Implementation](#search-implementation)
9. [Performance Optimization](#performance-optimization)
10. [Testing Strategies](#testing-strategies)
11. [Error Handling](#error-handling)
12. [Security Considerations](#security-considerations)
13. [Extension Points](#extension-points)
14. [Best Practices](#best-practices)
15. [Troubleshooting](#troubleshooting)

---

## Introduction

MemoryJS is a TypeScript knowledge graph library providing entity-relation storage, hierarchical organization, and advanced search capabilities. This guide covers the implementation details developers need to effectively use, extend, and contribute to the library.

### Key Statistics

| Metric | Value |
|--------|-------|
| Source Files | 73 TypeScript files |
| Lines of Code | ~29,000 |
| Total Exports | 558 (333 re-exports) |
| Classes | 73 |
| Interfaces | 145 |
| Functions | 100 |
| Circular Dependencies | 2 (type-only, safe) |

### Module Distribution

| Module | Files | Purpose |
|--------|-------|---------|
| `core/` | 12 | Storage backends, entity/relation/observation managers, transactions |
| `search/` | 29 | Search algorithms (BM25, TF-IDF, fuzzy, semantic, hybrid) |
| `features/` | 9 | Import/export, compression, analytics, archiving |
| `utils/` | 18 | Caching, errors, indexing, batch processing |
| `types/` | 2 | TypeScript interfaces (Entity, Relation, etc.) |
| `workers/` | 2 | Worker pool for CPU-intensive tasks (Levenshtein) |

---

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Application Code                                            │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade)                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Lazy-initialized getters for all managers               │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│  Layer 2: Manager Layer                                      │
│  ┌───────────────┬────────────────┬────────────────────────┐│
│  │ core/         │ search/        │ features/              ││
│  │ EntityMgr     │ SearchMgr      │ IOManager              ││
│  │ RelationMgr   │ BasicSearch    │ TagManager             ││
│  │ HierarchyMgr  │ RankedSearch   │ AnalyticsMgr           ││
│  │ TransactMgr   │ BooleanSearch  │ ArchiveManager         ││
│  │ GraphTraverse │ FuzzySearch    │ CompressionMgr         ││
│  │               │ HybridSearch   │                        ││
│  │               │ SemanticSearch │                        ││
│  └───────────────┴────────────────┴────────────────────────┘│
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│  Layer 3: Storage Layer                                      │
│  ┌────────────────────────┬─────────────────────────────────┐│
│  │ GraphStorage (JSONL)   │ SQLiteStorage (FTS5)            ││
│  └────────────────────────┴─────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Dependency Flow

```
ManagerContext
├── storage (GraphStorage | SQLiteStorage)
├── EntityManager → storage
├── RelationManager → storage
├── ObservationManager → storage
├── HierarchyManager → storage
├── GraphTraversal → storage
├── SearchManager
│   ├── BasicSearch → storage
│   ├── RankedSearch → storage, TFIDFIndexManager
│   ├── BooleanSearch → storage
│   ├── FuzzySearch → WorkerPoolManager, storage
│   └── SavedSearchManager → storage
├── HybridSearchManager
│   ├── SemanticSearch → EmbeddingService, VectorStore
│   ├── RankedSearch → TFIDFIndexManager
│   └── SymbolicSearch → storage
├── IOManager → storage, StreamingExporter
├── TagManager → (separate JSONL file)
├── AnalyticsManager → storage
├── CompressionManager → storage
└── ArchiveManager → storage
```

---

## Quick Start

### Installation

```bash
npm install @danielsimonjr/memoryjs
```

### Basic Usage

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// Initialize with storage path
const ctx = new ManagerContext('./memory.jsonl');

// Create entities
await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'programming_language',
    observations: ['Typed superset of JavaScript', 'Developed by Microsoft']
  },
  {
    name: 'JavaScript',
    entityType: 'programming_language',
    observations: ['Dynamic scripting language', 'Created by Brendan Eich']
  }
]);

// Create relations
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'JavaScript', relationType: 'compiles_to' }
]);

// Search
const results = await ctx.searchManager.search('TypeScript');
console.log(results.entities); // Returns matching entities
console.log(results.relations); // Returns related relations
```

### Configuration Options

```typescript
// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (for larger graphs)
const ctx = new ManagerContext('./memory.db');

// Environment variables
// MEMORY_STORAGE_TYPE=jsonl|sqlite
// EMBEDDING_PROVIDER=openai|local|none
// OPENAI_API_KEY=sk-...
```

---

## Module Deep Dives

### Core Module

**Location**: `src/core/` (12 files)

The core module provides fundamental storage and CRUD operations.

#### ManagerContext (`src/core/ManagerContext.ts`)

Central facade with lazy-initialized managers:

```typescript
export class ManagerContext {
  private _entityManager?: EntityManager;
  private _searchManager?: SearchManager;
  // ... other managers

  constructor(storagePath: string) {
    this.storage = createStorageFromPath(storagePath);
  }

  // Lazy initialization pattern
  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }

  get searchManager(): SearchManager {
    return (this._searchManager ??= new SearchManager(this.storage));
  }
  // ... other getters
}
```

**Available Managers**:
- `entityManager` - Entity CRUD + tags + hierarchy
- `relationManager` - Relation CRUD
- `observationManager` - Observation CRUD
- `hierarchyManager` - Parent-child relationships
- `searchManager` - All search operations
- `graphTraversal` - Path finding, centrality algorithms
- `ioManager` - Import/export/backup
- `tagManager` - Tag aliases
- `semanticSearch` - Vector similarity (optional)
- `rankedSearch` - TF-IDF scoring
- `analyticsManager` - Graph statistics
- `compressionManager` - Duplicate detection
- `archiveManager` - Entity archival

#### EntityManager (`src/core/EntityManager.ts`)

Handles entity CRUD operations with validation:

```typescript
// Create entities (batch)
await ctx.entityManager.createEntities([
  { name: 'Alice', entityType: 'person', observations: ['Software Engineer'] }
]);

// Get entity by name
const entity = await ctx.entityManager.getEntityByName('Alice');

// Update entity
await ctx.entityManager.updateEntity('Alice', {
  observations: [...entity.observations, 'Works at Acme Corp']
});

// Add/remove tags
await ctx.entityManager.addTags('Alice', ['engineer', 'senior']);
await ctx.entityManager.removeTags('Alice', ['junior']);

// Set importance (0-10 scale)
await ctx.entityManager.setImportance('Alice', 8);

// Delete entities (cascades to relations)
await ctx.entityManager.deleteEntities(['Alice']);
```

**Key Features**:
- Automatic timestamp management (`createdAt`, `lastModified`)
- Tag normalization (lowercase)
- Importance validation (0-10 range)
- Batch operations (single I/O cycle)
- Zod schema validation
- Event emission for TF-IDF sync

#### RelationManager (`src/core/RelationManager.ts`)

Manages directed graph edges:

```typescript
// Create relations
await ctx.relationManager.createRelations([
  { from: 'Alice', to: 'Acme Corp', relationType: 'works_at' },
  { from: 'Alice', to: 'Bob', relationType: 'knows' }
]);

// Get relations for entity
const { incoming, outgoing } = await ctx.relationManager.getRelationsForEntity('Alice');

// Delete relations
await ctx.relationManager.deleteRelations([
  { from: 'Alice', to: 'Bob', relationType: 'knows' }
]);
```

**Deferred Integrity**: Relations can reference entities that don't yet exist, enabling flexible import/export workflows.

#### HierarchyManager (`src/core/HierarchyManager.ts`)

Tree structure support with cycle detection:

```typescript
// Set parent (creates hierarchy)
await ctx.hierarchyManager.setEntityParent('Junior Dev', 'Senior Dev');

// Get tree structure
const children = await ctx.hierarchyManager.getChildren('Senior Dev');
const parent = await ctx.hierarchyManager.getParent('Junior Dev');
const ancestors = await ctx.hierarchyManager.getAncestors('Junior Dev');
const descendants = await ctx.hierarchyManager.getDescendants('Senior Dev');

// Get complete subtree with relations
const subtree = await ctx.hierarchyManager.getSubtree('Engineering');

// Move entity to new parent
await ctx.hierarchyManager.moveEntity('Junior Dev', 'Tech Lead');

// Cycle detection - throws CycleDetectedError
await ctx.hierarchyManager.setEntityParent('Senior Dev', 'Junior Dev'); // Error!
```

#### GraphTraversal (`src/core/GraphTraversal.ts`)

Graph algorithms:

```typescript
// Shortest path (BFS)
const path = await ctx.graphTraversal.findShortestPath('Alice', 'Bob');
// Returns: ['Alice', 'knows_Charlie', 'Charlie', 'knows_Bob', 'Bob']

// All paths (with depth limit)
const allPaths = await ctx.graphTraversal.findAllPaths('Alice', 'Bob', { maxDepth: 5 });

// Centrality metrics
const centrality = await ctx.graphTraversal.getCentrality({ algorithm: 'pagerank' });
// Algorithms: 'degree', 'betweenness', 'pagerank'

// Connected components
const components = await ctx.graphTraversal.getConnectedComponents();

// BFS/DFS traversal with visitor
await ctx.graphTraversal.bfs('Alice', (node, depth) => {
  console.log(`Visiting ${node} at depth ${depth}`);
});
```

#### Storage Layer

**GraphStorage (`src/core/GraphStorage.ts`)** - JSONL backend:
- Human-readable line-delimited JSON
- In-memory caching with write-through invalidation
- Atomic writes via temp file + rename
- Deep copy on reads (prevents mutation)

**SQLiteStorage (`src/core/SQLiteStorage.ts`)** - SQLite backend:
- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- ACID transactions
- 3-10x faster than JSONL for large graphs

```typescript
// Storage selection via file extension
const jsonlCtx = new ManagerContext('./memory.jsonl');  // JSONL
const sqliteCtx = new ManagerContext('./memory.db');    // SQLite

// Or via environment variable
// MEMORY_STORAGE_TYPE=sqlite
```

---

### Search Module

**Location**: `src/search/` (29 files)

The search module provides multiple search strategies from basic text matching to AI-powered semantic search.

#### SearchManager (`src/search/SearchManager.ts`)

Orchestrates all search types:

```typescript
// Basic substring search
const results = await ctx.searchManager.search('TypeScript', {
  tags: ['programming'],
  minImportance: 5
});

// TF-IDF ranked search
const ranked = await ctx.searchManager.searchRanked('TypeScript programming', {
  limit: 10,
  minScore: 0.5
});

// Boolean search with operators
const boolean = await ctx.searchManager.booleanSearch(
  'name:TypeScript AND (type:language OR observation:Microsoft)'
);

// Fuzzy search (typo-tolerant)
const fuzzy = await ctx.searchManager.fuzzySearch('Typscript', {
  threshold: 0.7  // 0.0-1.0, higher = stricter
});

// Smart search with query analysis
const smart = await ctx.searchManager.smartSearch('What languages compile to JavaScript?');
```

#### Search Strategies Comparison

| Strategy | Use Case | Algorithm | Performance |
|----------|----------|-----------|-------------|
| BasicSearch | Simple matching | Substring | O(n) |
| RankedSearch | Relevance ranking | TF-IDF | O(n log n) |
| BM25Search | Better relevance | BM25 | O(n log n) |
| BooleanSearch | Complex queries | AST evaluation | O(n × query) |
| FuzzySearch | Typo tolerance | Levenshtein | O(n × m) parallelized |
| SemanticSearch | Meaning-based | Vector similarity | O(n) |
| HybridSearch | Combined signals | Multi-layer | O(n × 3) |

#### HybridSearchManager (`src/search/HybridSearchManager.ts`)

Three-layer hybrid search combining multiple signals:

```typescript
const hybrid = await ctx.searchManager.hybridSearch('machine learning concepts', {
  weights: {
    semantic: 0.4,  // Vector similarity
    lexical: 0.4,   // TF-IDF text matching
    symbolic: 0.2   // Metadata filtering
  },
  filters: {
    tags: ['ai', 'ml'],
    minImportance: 3,
    entityTypes: ['concept', 'technology']
  },
  limit: 20,
  minScore: 0.3
});

// Results include layer breakdown
hybrid.results.forEach(r => {
  console.log(`${r.entity.name}: ${r.score}`);
  console.log(`  Semantic: ${r.layerScores.semantic}`);
  console.log(`  Lexical: ${r.layerScores.lexical}`);
  console.log(`  Symbolic: ${r.layerScores.symbolic}`);
});
```

#### SemanticSearch (`src/search/SemanticSearch.ts`)

Vector similarity search using embeddings:

```typescript
import { createEmbeddingService, createVectorStore } from '@danielsimonjr/memoryjs';

// Initialize embedding service
const embeddingService = await createEmbeddingService({
  provider: 'openai',  // 'openai' | 'local' | 'mock'
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize vector store
const vectorStore = createVectorStore('memory', storage);

// Create semantic search
const semanticSearch = new SemanticSearch(storage, embeddingService, vectorStore);

// Index all entities
await semanticSearch.indexAll();

// Search by meaning
const results = await semanticSearch.search('functional programming paradigms');

// Find similar entities
const similar = await semanticSearch.findSimilar('TypeScript', { limit: 5 });
```

#### TFIDFIndexManager (`src/search/TFIDFIndexManager.ts`)

TF-IDF index management with event-driven updates:

```typescript
// Index is automatically synchronized via TFIDFEventSync
// When entities change, the index updates reactively

// Manual index operations
const indexManager = new TFIDFIndexManager(storage);
await indexManager.buildIndex();

// Get term frequencies
const tfidf = indexManager.getTFIDF('typescript');
```

#### QueryAnalyzer (`src/search/QueryAnalyzer.ts`)

Natural language query understanding:

```typescript
const analyzer = new QueryAnalyzer();
const analysis = analyzer.analyze('What projects did Alice work on in 2024?');

console.log(analysis);
// {
//   extractedEntities: [{ name: 'Alice', type: 'person' }],
//   temporalReferences: [{ year: 2024 }],
//   questionType: 'what',
//   complexity: 'moderate',
//   suggestedSearchMethods: ['hybrid', 'semantic']
// }
```

---

### Features Module

**Location**: `src/features/` (9 files)

#### IOManager (`src/features/IOManager.ts`)

Import, export, and backup functionality:

```typescript
// Export to various formats
const json = await ctx.ioManager.exportGraph('json');
const csv = await ctx.ioManager.exportGraph('csv');
const graphml = await ctx.ioManager.exportGraph('graphml');
const mermaid = await ctx.ioManager.exportGraph('mermaid');

// Export formats: json, csv, graphml, gexf, dot, markdown, mermaid

// Export with filters and compression
const filtered = await ctx.ioManager.exportGraph('json', {
  filter: { tags: ['important'], minImportance: 7 },
  compress: true  // Brotli compression
});

// Import data
const importResult = await ctx.ioManager.importGraph('json', jsonData, {
  mergeStrategy: 'merge',  // 'merge' | 'replace' | 'skip' | 'fail'
  dryRun: true  // Preview changes without applying
});

console.log(importResult);
// { entitiesCreated: 5, entitiesUpdated: 2, entitiesSkipped: 1, errors: [] }

// Backup management
const backup = await ctx.ioManager.createBackup({ compress: true });
const backups = await ctx.ioManager.listBackups();
await ctx.ioManager.restoreBackup(backup.id);
await ctx.ioManager.deleteBackup(backup.id);
```

#### CompressionManager (`src/features/CompressionManager.ts`)

Duplicate detection and entity merging:

```typescript
// Find potential duplicates
const duplicates = await ctx.compressionManager.findDuplicates(0.8);
// Returns: [['Alice', 'alice'], ['TypeScript', 'Typescript']]

// Merge specific entities
const merged = await ctx.compressionManager.mergeEntities(
  ['Alice', 'alice'],
  'Alice'  // target name
);

// Auto-compress graph (find and merge all duplicates)
const result = await ctx.compressionManager.compressGraph(0.8, {
  dryRun: true  // Preview first
});
```

**Similarity Algorithm**:
```
score = (nameSimilarity × 0.4) + (typeSimilarity × 0.3) +
        (observationSimilarity × 0.2) + (tagSimilarity × 0.1)
```

#### ArchiveManager (`src/features/ArchiveManager.ts`)

Entity archival by criteria:

```typescript
const archived = await ctx.archiveManager.archiveEntities({
  olderThan: '2024-01-01',
  maxImportance: 2,
  tags: ['deprecated']
}, { dryRun: false });
```

#### AnalyticsManager (`src/features/AnalyticsManager.ts`)

Graph statistics and validation:

```typescript
// Get graph statistics
const stats = await ctx.analyticsManager.getGraphStats();
// {
//   entityCount: 150,
//   relationCount: 320,
//   entityTypes: { person: 50, project: 30, concept: 70 },
//   tagCounts: { important: 25, archived: 10 },
//   importanceDistribution: { 5: 20, 7: 15, 10: 5 }
// }

// Validate graph integrity
const validation = await ctx.analyticsManager.validateGraph();
// { issues: [], warnings: ['5 orphaned relations detected'] }
```

#### TagManager (`src/features/TagManager.ts`)

Tag aliases and synonyms:

```typescript
// Add alias (synonym mapping)
await ctx.tagManager.addTagAlias('ml', 'machine-learning', 'Abbreviation');
await ctx.tagManager.addTagAlias('ai', 'artificial-intelligence');

// Resolve tag to canonical form
const canonical = await ctx.tagManager.resolveTag('ml');
// Returns: 'machine-learning'

// List all aliases
const aliases = await ctx.tagManager.listTagAliases();

// Get all aliases for a canonical tag
const mlAliases = await ctx.tagManager.getAliasesForTag('machine-learning');
// Returns: ['ml']
```

---

### Utils Module

**Location**: `src/utils/` (18 files)

#### schemas.ts - Zod Validation

```typescript
import {
  EntitySchema,
  CreateEntitySchema,
  BatchCreateEntitiesSchema,
  validateWithSchema
} from '@danielsimonjr/memoryjs';

// Validate input
const result = validateWithSchema(CreateEntitySchema, {
  name: 'Alice',
  entityType: 'person',
  observations: ['Engineer']
});

if (!result.success) {
  console.error(result.errors);
}
```

#### searchAlgorithms.ts - Core Algorithms

```typescript
import {
  levenshteinDistance,
  calculateTF,
  calculateIDF,
  calculateTFIDF,
  tokenize
} from '@danielsimonjr/memoryjs';

// Levenshtein distance (edit distance)
const distance = levenshteinDistance('TypeScript', 'JavaScript');

// TF-IDF calculation
const tokens = tokenize('TypeScript is a typed programming language');
const tf = calculateTF('typescript', tokens);
const idf = calculateIDF('typescript', allDocuments);
const tfidf = calculateTFIDF('typescript', document, corpus);
```

#### BatchProcessor.ts - Batch Operations

```typescript
import { BatchProcessor, processBatch } from '@danielsimonjr/memoryjs';

// Process items in batches with progress
const results = await processBatch(items, async (item) => {
  return await processItem(item);
}, {
  batchSize: 100,
  onProgress: (completed, total) => {
    console.log(`Progress: ${completed}/${total}`);
  }
});
```

#### WorkerPoolManager.ts - Parallel Execution

```typescript
import { getWorkerPoolManager } from '@danielsimonjr/memoryjs';

// Get shared worker pool
const pool = getWorkerPoolManager();

// Execute parallel tasks
const results = await pool.exec('levenshteinDistance', [str1, str2]);

// Get pool statistics
const stats = pool.getStats();
// { activeTasks: 5, pendingTasks: 10, completedTasks: 100 }
```

#### MemoryMonitor.ts - Memory Tracking

```typescript
import { globalMemoryMonitor } from '@danielsimonjr/memoryjs';

// Get current memory usage
const usage = globalMemoryMonitor.getUsage();
// { heapUsed: 50MB, heapTotal: 100MB, external: 10MB }

// Register callback for memory alerts
globalMemoryMonitor.onAlert((alert) => {
  console.warn(`Memory alert: ${alert.message}`);
});
```

---

### Workers Module

**Location**: `src/workers/` (2 files)

CPU-intensive operations are offloaded to worker threads:

```typescript
// Levenshtein worker (used by FuzzySearch)
import { levenshteinDistance, similarity, searchEntities } from './workers';

// These run in a worker pool for parallel processing
const distance = await levenshteinDistance('TypeScript', 'JavaScript');
const sim = await similarity('TypeScript', 'Typescript');

// Search entities in parallel
const matches = await searchEntities(entities, 'Typscript', 0.7);
```

---

## Design Patterns

### 1. Context Pattern

The `ManagerContext` provides centralized access to all managers:

```typescript
// Single context for entire application
const ctx = new ManagerContext('./memory.jsonl');

// Access any manager through context
ctx.entityManager
ctx.searchManager
ctx.ioManager
```

### 2. Lazy Initialization

Managers are created only when first accessed:

```typescript
class ManagerContext {
  private _entityManager?: EntityManager;

  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }
}
```

**Benefits**:
- Faster startup (no upfront initialization)
- Reduced memory for unused features
- Cleaner separation of concerns

### 3. Dependency Injection

Storage is injected into all managers, enabling:
- Easy testing with mock storage
- Storage backend swapping
- Loose coupling between components

```typescript
// Production
const manager = new EntityManager(new GraphStorage('./data.jsonl'));

// Testing
const manager = new EntityManager(new MockStorage());
```

### 4. Event-Driven Architecture

`GraphEventEmitter` enables reactive updates:

```typescript
// TFIDFEventSync subscribes to entity changes
eventEmitter.on('entity:created', async (entities) => {
  await tfidfManager.addToIndex(entities);
});

eventEmitter.on('entity:deleted', async (names) => {
  await tfidfManager.removeFromIndex(names);
});
```

### 5. Strategy Pattern

Multiple implementations for same interface:

```typescript
// Storage strategies
interface IGraphStorage {
  loadGraph(): Promise<KnowledgeGraph>;
  saveGraph(graph: KnowledgeGraph): Promise<void>;
}

class GraphStorage implements IGraphStorage { }  // JSONL
class SQLiteStorage implements IGraphStorage { } // SQLite

// Embedding strategies
interface EmbeddingService {
  embed(text: string): Promise<number[]>;
}

class OpenAIEmbeddingService implements EmbeddingService { }
class LocalEmbeddingService implements EmbeddingService { }
class MockEmbeddingService implements EmbeddingService { }
```

### 6. Factory Pattern

Factories create appropriate implementations:

```typescript
// Storage factory
const storage = createStorageFromPath('./memory.db'); // Returns SQLiteStorage
const storage = createStorageFromPath('./memory.jsonl'); // Returns GraphStorage

// Embedding service factory
const service = await createEmbeddingService({ provider: 'openai' });

// Vector store factory
const store = createVectorStore('memory', storage);
```

### 7. Barrel Exports

Each module exports through `index.ts`:

```typescript
// src/core/index.ts
export { EntityManager } from './EntityManager.js';
export { RelationManager } from './RelationManager.js';
export { GraphStorage } from './GraphStorage.js';
// ...

// Main entry point re-exports all
// src/index.ts
export * from './core/index.js';
export * from './search/index.js';
export * from './features/index.js';
// ...
```

---

## Data Model

### Entity (Graph Node)

```typescript
interface Entity {
  name: string;              // Unique identifier (1-500 chars)
  entityType: string;        // Category (e.g., "person", "project")
  observations: string[];    // Free-form text descriptions
  parentId?: string;         // Hierarchical parent (optional)
  tags?: string[];           // Categories (lowercase, max 50)
  importance?: number;       // Priority 0-10 (optional)
  createdAt?: string;        // ISO 8601 timestamp (auto-generated)
  lastModified?: string;     // ISO 8601 timestamp (auto-updated)
}
```

### Relation (Graph Edge)

```typescript
interface Relation {
  from: string;              // Source entity name
  to: string;                // Target entity name
  relationType: string;      // Relationship type (active voice)
  createdAt?: string;        // ISO 8601 timestamp
  lastModified?: string;     // ISO 8601 timestamp
}
```

### Knowledge Graph

```typescript
interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}
```

### Naming Conventions

**Entity Types** (singular noun):
- `person`, `project`, `concept`, `technology`, `organization`

**Relation Types** (active voice verb phrase):
- `works_at`, `knows`, `manages`, `uses`, `depends_on`, `created`

**Tags** (lowercase, hyphenated):
- `important`, `archived`, `in-progress`, `machine-learning`

---

## Storage Backends

### JSONL Storage (Default)

**File Format**:
```jsonl
{"entities":[...],"relations":[...]}
```

**Characteristics**:
- Human-readable
- Easy debugging and manual editing
- Good for <2,000 entities
- Atomic writes via temp file + rename
- In-memory caching

**Configuration**:
```typescript
const ctx = new ManagerContext('./memory.jsonl');
```

### SQLite Storage

**Schema**:
```sql
CREATE TABLE entities (
  name TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  observations TEXT,  -- JSON array
  parent_id TEXT REFERENCES entities(name),
  tags TEXT,          -- JSON array
  importance INTEGER,
  created_at TEXT,
  last_modified TEXT
);

CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
  from_entity TEXT NOT NULL REFERENCES entities(name),
  to_entity TEXT NOT NULL REFERENCES entities(name),
  relation_type TEXT NOT NULL,
  created_at TEXT,
  last_modified TEXT,
  UNIQUE(from_entity, to_entity, relation_type)
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name, entity_type, observations,
  content='entities'
);
```

**Characteristics**:
- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- ACID transactions
- 3-10x faster search for large graphs
- Good for 2,000-50,000+ entities

**Configuration**:
```typescript
const ctx = new ManagerContext('./memory.db');
// Or: MEMORY_STORAGE_TYPE=sqlite
```

### Storage Comparison

| Feature | JSONL | SQLite |
|---------|-------|--------|
| File Format | Human-readable | Binary |
| Query Speed | O(n) scan | Indexed |
| Write Speed | Full rewrite | Incremental |
| Concurrent Access | Limited | WAL mode |
| Full-Text Search | In-memory | FTS5 BM25 |
| Best For | <2K entities | >2K entities |

---

## Search Implementation

### Search Flow

```
Query
  │
  ▼
┌─────────────────────────────────────────┐
│ 1. SearchManager.search(query, options) │
└─────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────┐
│ 2. Load Graph (cached if available)     │
└─────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────┐
│ 3. Execute Search Strategy              │
│    ├── BasicSearch (substring)          │
│    ├── RankedSearch (TF-IDF)            │
│    ├── BooleanSearch (AST)              │
│    ├── FuzzySearch (Levenshtein)        │
│    └── HybridSearch (multi-layer)       │
└─────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────┐
│ 4. Apply Filters (SearchFilterChain)    │
│    ├── Tags filter                      │
│    ├── Importance range                 │
│    ├── Entity type                      │
│    └── Date range                       │
└─────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────┐
│ 5. Collect Related Relations            │
└─────────────────────────────────────────┘
  │
  ▼
Return: KnowledgeGraph { entities, relations }
```

### Hybrid Search Architecture

```
Query: "machine learning frameworks"
  │
  ├──────────────────────────────────────────────────┐
  │                                                   │
  ▼                        ▼                          ▼
┌───────────┐        ┌───────────┐            ┌───────────┐
│ Semantic  │        │  Lexical  │            │ Symbolic  │
│   Layer   │        │   Layer   │            │   Layer   │
│           │        │           │            │           │
│ Vector    │        │  TF-IDF/  │            │ Metadata  │
│ Similarity│        │   BM25    │            │ Matching  │
│           │        │           │            │           │
│ Weight:   │        │ Weight:   │            │ Weight:   │
│   0.4     │        │   0.4     │            │   0.2     │
└─────┬─────┘        └─────┬─────┘            └─────┬─────┘
      │                    │                        │
      └────────────────────┴────────────────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │ Score Fusion  │
                   │               │
                   │ final = Σ     │
                   │ (score×weight)│
                   └───────────────┘
                           │
                           ▼
                  Ranked Results
```

### Boolean Query Syntax

```
# Basic operators
Alice AND Bob         # Both must match
Alice OR Bob          # Either must match
NOT archived          # Must not match

# Field prefixes
name:Alice            # Match in name field
type:person           # Match in entityType
observation:engineer  # Match in observations

# Grouping
(Alice OR Bob) AND project
name:Alice AND (type:person OR type:employee)

# Complex queries
(name:TypeScript OR observation:typed) AND type:language AND NOT tag:deprecated
```

---

## Performance Optimization

### Benchmarks

| Operation | 100 entities | 1,000 entities | 5,000 entities |
|-----------|--------------|----------------|----------------|
| Create entities | <50ms | <200ms | <1000ms |
| Basic search | <20ms | <100ms | <500ms |
| Ranked search | <50ms | <300ms | <1500ms |
| Fuzzy search | <30ms | <150ms | <750ms |
| Find duplicates | <100ms | <1000ms | <5000ms |

### Optimization Strategies

#### 1. Batch Operations

```typescript
// GOOD: Single I/O cycle
await ctx.entityManager.createEntities(entities);

// BAD: Multiple I/O cycles
for (const entity of entities) {
  await ctx.entityManager.createEntities([entity]);
}
```

#### 2. Caching

```typescript
// Graph is cached after first load
const results1 = await ctx.searchManager.search('query1'); // Loads from disk
const results2 = await ctx.searchManager.search('query2'); // Uses cache
```

#### 3. Filter Early

```typescript
// Apply filters to reduce processing
await ctx.searchManager.search('query', {
  tags: ['important'],
  minImportance: 5,
  entityType: 'project'
});
```

#### 4. Use SQLite for Large Graphs

```typescript
// Switch to SQLite for better performance with large datasets
const ctx = new ManagerContext('./memory.db');
```

#### 5. Parallel Processing

Fuzzy search automatically uses worker pool for parallel Levenshtein calculations.

### Memory Management

```typescript
import { globalMemoryMonitor } from '@danielsimonjr/memoryjs';

// Monitor memory usage
globalMemoryMonitor.onAlert((alert) => {
  if (alert.severity === 'high') {
    // Clear caches or reduce batch sizes
  }
});

// Use streaming for large exports
const exporter = new StreamingExporter(storage);
await exporter.exportToFile('./large-export.json', {
  chunkSize: 1000,
  onProgress: (processed, total) => {
    console.log(`${processed}/${total}`);
  }
});
```

---

## Testing Strategies

### Test Organization

```
tests/
├── unit/           # Per-module unit tests
│   ├── core/       # EntityManager, RelationManager, etc.
│   ├── search/     # Search implementations
│   ├── features/   # IOManager, CompressionManager, etc.
│   └── utils/      # Utility functions
├── integration/    # Cross-module workflows
├── performance/    # Benchmarks
└── edge-cases/     # Boundary conditions
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report

# Run single test file
npx vitest run tests/unit/core/EntityManager.test.ts
```

### Testing Patterns

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { existsSync, rmSync } from 'fs';

describe('EntityManager', () => {
  const testPath = './test-memory.jsonl';
  let ctx: ManagerContext;

  beforeEach(() => {
    ctx = new ManagerContext(testPath);
  });

  afterEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath);
    }
  });

  it('should create entities with timestamps', async () => {
    const entities = await ctx.entityManager.createEntities([
      { name: 'Test', entityType: 'test', observations: ['obs'] }
    ]);

    expect(entities[0].createdAt).toBeDefined();
    expect(entities[0].lastModified).toBeDefined();
  });

  it('should normalize tags to lowercase', async () => {
    const entities = await ctx.entityManager.createEntities([
      { name: 'Test', entityType: 'test', observations: [], tags: ['UPPER', 'Mixed'] }
    ]);

    expect(entities[0].tags).toEqual(['upper', 'mixed']);
  });
});
```

---

## Error Handling

### Custom Error Types

```typescript
import {
  EntityNotFoundError,
  ValidationError,
  CycleDetectedError,
  InvalidImportanceError,
  FileOperationError
} from '@danielsimonjr/memoryjs';

try {
  await ctx.entityManager.setImportance('NonExistent', 5);
} catch (error) {
  if (error instanceof EntityNotFoundError) {
    console.error(`Entity not found: ${error.entityName}`);
  } else if (error instanceof ValidationError) {
    console.error(`Validation failed: ${error.message}`);
  }
}
```

### Error Hierarchy

```
KnowledgeGraphError (base)
├── EntityNotFoundError
├── RelationNotFoundError
├── DuplicateEntityError
├── ValidationError
├── CycleDetectedError
├── InvalidImportanceError
├── FileOperationError
├── ImportError
├── ExportError
├── InsufficientEntitiesError
└── OperationCancelledError
```

### Validation with Zod

```typescript
import { BatchCreateEntitiesSchema, formatZodErrors } from '@danielsimonjr/memoryjs';

const result = BatchCreateEntitiesSchema.safeParse(entities);

if (!result.success) {
  const errors = formatZodErrors(result.error);
  // ["entities.0.name: Required", "entities.2.importance: Must be <= 10"]
}
```

---

## Security Considerations

### Input Validation

All inputs are validated using Zod schemas:

```typescript
const EntitySchema = z.object({
  name: z.string().min(1).max(500).trim(),
  entityType: z.string().min(1).max(100).trim(),
  observations: z.array(z.string().min(1).max(5000)),
  tags: z.array(z.string().min(1).max(100)).max(50).optional(),
  importance: z.number().int().min(0).max(10).optional(),
});
```

### Path Traversal Protection

```typescript
import { validateFilePath } from '@danielsimonjr/memoryjs';

// Validates path is within allowed directory
validateFilePath('./data/memory.jsonl', './data');
// Throws SecurityError for '../../../etc/passwd'
```

### SQL Injection Prevention

SQLite storage uses parameterized queries:

```typescript
// Safe - parameterized
db.prepare('SELECT * FROM entities WHERE name = ?').get(name);

// Never used - string concatenation
// db.prepare(`SELECT * FROM entities WHERE name = '${name}'`);
```

---

## Extension Points

### Custom Storage Backend

```typescript
import { IGraphStorage, KnowledgeGraph } from '@danielsimonjr/memoryjs';

class RedisStorage implements IGraphStorage {
  async loadGraph(): Promise<KnowledgeGraph> {
    const data = await redis.get('knowledge-graph');
    return JSON.parse(data);
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await redis.set('knowledge-graph', JSON.stringify(graph));
  }
}

// Use with ManagerContext
const storage = new RedisStorage();
const entityManager = new EntityManager(storage);
```

### Custom Embedding Provider

```typescript
import { EmbeddingService } from '@danielsimonjr/memoryjs';

class HuggingFaceEmbeddingService implements EmbeddingService {
  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.huggingface.co/embed', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    return response.json();
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

### Custom Search Strategy

```typescript
import { GraphStorage, KnowledgeGraph, SearchFilters } from '@danielsimonjr/memoryjs';

class RegexSearch {
  constructor(private storage: GraphStorage) {}

  async search(pattern: string, filters?: SearchFilters): Promise<KnowledgeGraph> {
    const graph = await this.storage.loadGraph();
    const regex = new RegExp(pattern, 'i');

    const entities = graph.entities.filter(e =>
      regex.test(e.name) ||
      regex.test(e.entityType) ||
      e.observations.some(o => regex.test(o))
    );

    const entityNames = new Set(entities.map(e => e.name));
    const relations = graph.relations.filter(r =>
      entityNames.has(r.from) || entityNames.has(r.to)
    );

    return { entities, relations };
  }
}
```

---

## Best Practices

### 1. Use Batch Operations

```typescript
// GOOD
await ctx.entityManager.createEntities(entities);
await ctx.relationManager.createRelations(relations);

// BAD - Multiple I/O cycles
for (const e of entities) {
  await ctx.entityManager.createEntities([e]);
}
```

### 2. Handle Errors Properly

```typescript
try {
  await ctx.entityManager.setImportance(name, importance);
} catch (error) {
  if (error instanceof EntityNotFoundError) {
    // Handle missing entity
  } else if (error instanceof InvalidImportanceError) {
    // Handle invalid importance
  } else {
    throw error; // Re-throw unexpected errors
  }
}
```

### 3. Use Appropriate Search Strategy

| Need | Strategy |
|------|----------|
| Simple text match | `search()` |
| Relevance ranking | `searchRanked()` |
| Complex logic | `booleanSearch()` |
| Typo tolerance | `fuzzySearch()` |
| Semantic meaning | `semanticSearch()` (requires embeddings) |
| Combined signals | `hybridSearch()` |

### 4. Index for Semantic Search

```typescript
// Index entities before semantic search
await ctx.semanticSearch.indexAll();

// Or index incrementally
await ctx.semanticSearch.indexEntity(newEntity);
```

### 5. Use Dry-Run for Destructive Operations

```typescript
// Preview before executing
const preview = await ctx.compressionManager.compressGraph(0.8, { dryRun: true });
console.log(`Would merge: ${preview.mergedGroups.length} groups`);

// Execute if satisfied
await ctx.compressionManager.compressGraph(0.8, { dryRun: false });
```

### 6. Choose Right Storage Backend

```typescript
// Small graphs (<2,000 entities): JSONL
const ctx = new ManagerContext('./memory.jsonl');

// Large graphs (>2,000 entities): SQLite
const ctx = new ManagerContext('./memory.db');
```

### 7. Monitor Performance

```typescript
console.time('search');
const results = await ctx.searchManager.search(query);
console.timeEnd('search');

// Use memory monitor for large operations
globalMemoryMonitor.onAlert(alert => {
  console.warn(`Memory: ${alert.message}`);
});
```

---

## Troubleshooting

### Common Issues

#### 1. Entity Not Found

```typescript
// Problem
await ctx.entityManager.setImportance('NonExistent', 5);
// Error: EntityNotFoundError

// Solution - Check if entity exists first
const entity = await ctx.entityManager.getEntityByName('NonExistent');
if (entity) {
  await ctx.entityManager.setImportance('NonExistent', 5);
}
```

#### 2. Circular Dependency in Hierarchy

```typescript
// Problem
await ctx.hierarchyManager.setEntityParent('A', 'B');
await ctx.hierarchyManager.setEntityParent('B', 'A');
// Error: CycleDetectedError

// Solution - Check for cycles before setting parent
const ancestors = await ctx.hierarchyManager.getAncestors('B');
if (!ancestors.some(a => a.name === 'A')) {
  await ctx.hierarchyManager.setEntityParent('B', 'A');
}
```

#### 3. Import Conflicts

```typescript
// Problem - Import fails due to existing entities
await ctx.ioManager.importGraph('json', data);
// Error: DuplicateEntityError

// Solution - Use merge strategy
await ctx.ioManager.importGraph('json', data, {
  mergeStrategy: 'merge'  // or 'skip', 'replace'
});
```

#### 4. Memory Issues with Large Graphs

```typescript
// Problem - Out of memory with large exports

// Solution - Use streaming export
const exporter = new StreamingExporter(storage);
await exporter.exportToFile('./export.json', {
  chunkSize: 500  // Process in smaller chunks
});
```

#### 5. Slow Search Performance

```typescript
// Problem - Search takes too long

// Solutions:
// 1. Switch to SQLite for FTS5
const ctx = new ManagerContext('./memory.db');

// 2. Add filters to reduce result set
await ctx.searchManager.search(query, {
  tags: ['relevant'],
  minImportance: 5
});

// 3. Use limit parameter
await ctx.searchManager.searchRanked(query, { limit: 10 });
```

---

## Appendix: File Quick Reference

| File | Purpose |
|------|---------|
| `src/core/ManagerContext.ts` | Central facade, lazy manager init |
| `src/core/EntityManager.ts` | Entity CRUD operations |
| `src/core/RelationManager.ts` | Relation CRUD operations |
| `src/core/GraphStorage.ts` | JSONL storage backend |
| `src/core/SQLiteStorage.ts` | SQLite storage backend |
| `src/core/GraphTraversal.ts` | Graph algorithms |
| `src/search/SearchManager.ts` | Search orchestrator |
| `src/search/HybridSearchManager.ts` | Multi-layer search |
| `src/search/SemanticSearch.ts` | Vector similarity search |
| `src/search/TFIDFIndexManager.ts` | TF-IDF index management |
| `src/features/IOManager.ts` | Import/export/backup |
| `src/features/CompressionManager.ts` | Duplicate detection |
| `src/utils/schemas.ts` | Zod validation schemas |
| `src/utils/searchAlgorithms.ts` | Levenshtein, TF-IDF |
| `src/types/types.ts` | TypeScript interfaces |

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
**Generated From**: Dependency Graph Analysis & Codebase Exploration
