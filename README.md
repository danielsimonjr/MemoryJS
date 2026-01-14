# MemoryJS

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/danielsimonjr/memoryjs)
[![NPM](https://img.shields.io/npm/v/@danielsimonjr/memoryjs.svg)](https://www.npmjs.com/package/@danielsimonjr/memoryjs)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

A **TypeScript knowledge graph library** for managing entities, relations, and observations with **advanced search capabilities**, **hierarchical organization**, and **multiple storage backends**.

> **Core library** powering [@danielsimonjr/memory-mcp](https://www.npmjs.com/package/@danielsimonjr/memory-mcp). Provides **93 TypeScript files**, **~41K lines of code**, dual storage backends (JSONL/SQLite), sophisticated search algorithms (BM25, TF-IDF, fuzzy, semantic, hybrid), and a complete **Agent Memory System** for AI agents.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Storage Options](#storage-options)
- [Search Capabilities](#search-capabilities)
- [Graph Algorithms](#graph-algorithms)
- [Agent Memory System](#agent-memory-system)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Development](#development)
- [Documentation](#documentation)
- [License](#license)

## Features

### Core Capabilities

- **Knowledge Graph Storage**: Entity-Relation-Observation model for structured data
- **Dual Storage Backends**: JSONL (human-readable) or SQLite (FTS5, 3-10x faster)
- **Full CRUD Operations**: Create, read, update, delete entities and relations
- **Hierarchical Nesting**: Parent-child relationships for tree structures
- **Timestamps**: Automatic createdAt and lastModified tracking

### Advanced Features

| Category | Description |
|----------|-------------|
| **Search Algorithms** | Basic, TF-IDF ranked, BM25, Boolean (AND/OR/NOT), Fuzzy (Levenshtein), Semantic (embeddings), Hybrid |
| **Graph Algorithms** | Shortest path (BFS), all paths, centrality metrics (degree, betweenness, PageRank), connected components |
| **Hierarchical Nesting** | Parent-child relationships, ancestor/descendant traversal, subtree operations |
| **Duplicate Detection** | Intelligent compression with similarity scoring |
| **Tag Management** | Tags, aliases, bulk operations, importance scores (0-10) |
| **Import/Export** | JSON, CSV, GraphML formats with Brotli compression |
| **Analytics** | Graph statistics, validation, integrity checks |

### Module Statistics

| Module | Files | Key Components |
|--------|-------|----------------|
| `agent/` | 19 | AgentMemoryManager, SessionManager, DecayEngine, WorkingMemoryManager |
| `core/` | 12 | EntityManager, GraphStorage, SQLiteStorage, TransactionManager |
| `search/` | 29 | SearchManager, BM25Search, HybridScorer, VectorStore, QueryPlanner |
| `features/` | 9 | IOManager, ArchiveManager, CompressionManager, StreamingExporter |
| `utils/` | 18 | BatchProcessor, CompressedCache, WorkerPoolManager, MemoryMonitor |
| `types/` | 3 | Entity, Relation, AgentEntity, SessionEntity interfaces |
| `workers/` | 2 | Levenshtein distance calculations |

**Total:** 93 TypeScript files | ~41,000 lines of code | 657 exports | 91 classes | 216 interfaces

## Installation

```bash
npm install @danielsimonjr/memoryjs
```

### Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.0 (for development)

## Quick Start

### 1. Initialize Storage

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default, human-readable)
const ctx = new ManagerContext({
  storagePath: './memory.jsonl'
});

// Or SQLite storage (faster, FTS5 search)
const ctx = new ManagerContext({
  storageType: 'sqlite',
  storagePath: './memory.db'
});
```

### 2. Create Entities

```typescript
await ctx.entityManager.createEntities([
  {
    name: 'TypeScript',
    entityType: 'language',
    observations: ['A typed superset of JavaScript'],
    tags: ['programming', 'frontend'],
    importance: 8
  },
  {
    name: 'Node.js',
    entityType: 'runtime',
    observations: ['JavaScript runtime built on V8'],
    tags: ['backend', 'server']
  }
]);
```

### 3. Create Relations

```typescript
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'Node.js', relationType: 'runs_on' }
]);
```

### 4. Search

```typescript
// Basic search
const results = await ctx.searchManager.search('JavaScript');

// Ranked search (TF-IDF scoring)
const ranked = await ctx.searchManager.searchRanked('runtime environment', { limit: 10 });

// Boolean search
const filtered = await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// Fuzzy search (typo-tolerant)
const fuzzy = await ctx.searchManager.fuzzySearch('Typscript', { threshold: 0.7 });
```

## Core Concepts

### Entities

Primary nodes in the knowledge graph.

```typescript
interface Entity {
  name: string;           // Unique identifier
  entityType: string;     // Classification (person, project, concept)
  observations: string[]; // Facts about the entity
  parentId?: string;      // Parent entity for hierarchical nesting
  tags?: string[];        // Lowercase tags for categorization
  importance?: number;    // 0-10 scale for prioritization
  createdAt?: string;     // ISO 8601 timestamp
  lastModified?: string;  // ISO 8601 timestamp
}
```

### Relations

Directed connections between entities.

```typescript
interface Relation {
  from: string;           // Source entity name
  to: string;             // Target entity name
  relationType: string;   // Relationship type (active voice)
}
```

### Observations

Discrete facts about entities. Each observation should be atomic and independently manageable. Use `addObservations()` to append new facts without overwriting existing ones.

### ManagerContext

Central access point for all managers with lazy initialization:

```typescript
ctx.entityManager    // Entity CRUD + hierarchy
ctx.relationManager  // Relation management
ctx.searchManager    // All search operations
ctx.tagManager       // Tag aliases and bulk operations
ctx.ioManager        // Import/export/backup
ctx.graphTraversal   // Graph algorithms
ctx.semanticSearch   // Vector similarity search (optional)
```

## Storage Options

### Comparison

| Feature | JSONL (Default) | SQLite (better-sqlite3) |
|---------|-----------------|-------------------------|
| Format | Human-readable text | Native binary database |
| Transactions | Basic | Full ACID with WAL mode |
| Full-Text Search | Basic | FTS5 with BM25 ranking |
| Performance | Good | 3-10x faster |
| Concurrency | Single-threaded | Thread-safe with async-mutex |
| Best For | Small graphs, debugging | Large graphs (10k+ entities) |

### JSONL Storage

```typescript
const ctx = new ManagerContext({
  storagePath: './memory.jsonl'
});
```

Features:
- Human-readable line-delimited JSON
- In-memory caching with write-through invalidation
- Atomic writes via temp file + rename
- Backward compatibility for legacy formats

### SQLite Storage

```typescript
const ctx = new ManagerContext({
  storageType: 'sqlite',
  storagePath: './memory.db'
});
```

Features:
- FTS5 full-text search with BM25 ranking
- WAL mode for better concurrency
- Referential integrity with ON DELETE CASCADE
- ACID transactions

### Storage Files

When using JSONL, related files are automatically created:

```
/your/data/directory/
├── memory.jsonl                    # Main knowledge graph
├── memory-saved-searches.jsonl     # Saved search queries
├── memory-tag-aliases.jsonl        # Tag synonym mappings
└── .backups/                       # Timestamped backups
```

## Search Capabilities

### Search Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `search()` | Basic substring matching | Simple queries |
| `searchRanked()` | TF-IDF relevance scoring | Finding most relevant results |
| `booleanSearch()` | AND/OR/NOT operators | Complex filtering |
| `fuzzySearch()` | Levenshtein distance | Typo tolerance |
| `hybridSearch()` | Semantic + lexical + symbolic | Multi-signal ranking |

### Basic Search

```typescript
const results = await ctx.searchManager.search('TypeScript');
```

### Ranked Search (TF-IDF)

```typescript
const ranked = await ctx.searchManager.searchRanked('JavaScript runtime', {
  limit: 10,
  minScore: 0.1
});
```

### Boolean Search

```typescript
// AND - both terms must match
const results = await ctx.searchManager.booleanSearch('TypeScript AND runtime');

// OR - either term matches
const results = await ctx.searchManager.booleanSearch('frontend OR backend');

// NOT - exclude term
const results = await ctx.searchManager.booleanSearch('JavaScript NOT browser');

// Parentheses for grouping
const results = await ctx.searchManager.booleanSearch('(TypeScript OR JavaScript) AND server');
```

### Fuzzy Search

```typescript
// Typo-tolerant search with threshold (0-1, higher = stricter)
const results = await ctx.searchManager.fuzzySearch('Typscript', {
  threshold: 0.7
});
```

### Hybrid Search

Combines three signal layers for sophisticated ranking:

```typescript
const results = await ctx.searchManager.hybridSearch('programming concepts', {
  weights: {
    semantic: 0.5,   // Vector similarity (requires embeddings)
    lexical: 0.3,    // TF-IDF text matching
    symbolic: 0.2    // Metadata (tags, importance, type)
  },
  filters: {
    entityTypes: ['concept'],
    minImportance: 5,
    tags: ['programming']
  }
});
```

## Graph Algorithms

### Path Finding

```typescript
// Shortest path between entities (BFS)
const path = await ctx.graphTraversal.findShortestPath('A', 'Z');
// Returns: ['A', 'B', 'C', 'Z']

// All paths with max depth
const paths = await ctx.graphTraversal.findAllPaths('A', 'Z', { maxDepth: 5 });
// Returns: [['A', 'B', 'Z'], ['A', 'C', 'D', 'Z'], ...]
```

### Centrality Analysis

```typescript
// Calculate importance metrics
const centrality = await ctx.graphTraversal.getCentrality({
  algorithm: 'pagerank'  // or 'degree', 'betweenness'
});
// Returns: Map<string, number> with entity scores
```

### Connected Components

```typescript
// Find isolated subgraphs
const components = await ctx.graphTraversal.getConnectedComponents();
// Returns: [['A', 'B', 'C'], ['X', 'Y'], ...]
```

### Traversal

```typescript
// Breadth-first traversal
await ctx.graphTraversal.bfs('startNode', (node) => {
  console.log('Visited:', node.name);
});

// Depth-first traversal
await ctx.graphTraversal.dfs('startNode', (node) => {
  console.log('Visited:', node.name);
});
```

## Agent Memory System

A complete memory system for AI agents with working memory, episodic memory, decay mechanisms, and multi-agent support.

### Key Components

| Component | Description |
|-----------|-------------|
| **AgentMemoryManager** | Unified facade for all agent memory operations |
| **SessionManager** | Session lifecycle management |
| **WorkingMemoryManager** | Short-term memory with promotion to long-term |
| **EpisodicMemoryManager** | Timeline-based episodic memory |
| **DecayEngine** | Time-based memory importance decay |
| **SalienceEngine** | Context-aware memory scoring |
| **MultiAgentMemoryManager** | Shared memory with visibility controls |
| **ConflictResolver** | Resolution strategies for concurrent updates |

### Quick Start

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');
const agent = ctx.agentMemory();

// Start a session
const session = await agent.startSession({ agentId: 'my-agent' });

// Add working memory
await agent.addWorkingMemory({
  sessionId: session.name,
  content: 'User prefers dark mode',
  importance: 7
});

// Create episodic memory
await agent.createEpisode('Completed onboarding flow', {
  sessionId: session.name,
  importance: 8
});

// Retrieve context for LLM prompt
const context = await agent.retrieveForContext({
  maxTokens: 2000,
  includeEpisodic: true
});

// End session
await agent.endSession(session.name);
```

### Memory Types

```typescript
type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
```

- **Working Memory**: Short-term, session-scoped memories that may be promoted
- **Episodic Memory**: Timeline-based event memories with temporal ordering
- **Semantic Memory**: Long-term factual knowledge
- **Procedural Memory**: Learned behaviors and patterns

### Decay System

Memories naturally decay over time unless reinforced:

```typescript
// Configure decay behavior
const agent = ctx.agentMemory({
  decay: {
    halfLifeHours: 168,  // 1 week half-life
    minImportance: 0.1   // Never fully forget
  },
  enableAutoDecay: true
});

// Reinforce important memories
await agent.confirmMemory('memory_name', 0.1);  // Boost confidence
await agent.promoteMemory('memory_name', 'episodic');  // Promote to long-term
```

### Multi-Agent Support

```typescript
// Register agents
agent.registerAgent('agent_1', {
  name: 'Research Agent',
  type: 'llm',
  trustLevel: 0.8,
  capabilities: ['read', 'write']
});

// Create memories with visibility controls
await agent.addWorkingMemory({
  sessionId: session.name,
  content: 'Shared insight',
  visibility: 'shared',  // 'private' | 'shared' | 'public'
  ownerAgentId: 'agent_1'
});

// Cross-agent search
const results = await agent.searchCrossAgent('agent_2', 'query');
```

## API Reference

### EntityManager

| Method | Description |
|--------|-------------|
| `createEntities(entities)` | Create multiple entities |
| `deleteEntities(names)` | Delete entities by name |
| `getEntityByName(name)` | Get single entity |
| `addObservations(name, observations)` | Add observations to entity |
| `deleteObservations(name, observations)` | Remove specific observations |
| `addTags(name, tags)` | Add tags to entity |
| `removeTags(name, tags)` | Remove tags from entity |
| `setImportance(name, score)` | Set importance (0-10) |
| `setEntityParent(name, parentName)` | Set/remove parent |
| `getChildren(name)` | Get immediate children |
| `getAncestors(name)` | Get ancestor chain |
| `getDescendants(name)` | Get all descendants |

### RelationManager

| Method | Description |
|--------|-------------|
| `createRelations(relations)` | Create multiple relations |
| `getRelations(entityName)` | Get incoming/outgoing relations |
| `deleteRelations(relations)` | Delete specific relations |

### SearchManager

| Method | Description |
|--------|-------------|
| `search(query, options)` | Basic substring search |
| `searchRanked(query, options)` | TF-IDF ranked search |
| `booleanSearch(query, options)` | Boolean operators (AND/OR/NOT) |
| `fuzzySearch(query, options)` | Levenshtein-based typo tolerance |
| `hybridSearch(query, options)` | Multi-signal search |
| `smartSearch(query, options)` | AI-assisted refinement |

### IOManager

| Method | Description |
|--------|-------------|
| `exportGraph(format, options)` | Export to JSON/CSV/GraphML |
| `importGraph(format, data, options)` | Import with merge strategies |
| `createBackup(options)` | Create timestamped backup |
| `restoreBackup(path)` | Restore from backup |

### GraphTraversal

| Method | Description |
|--------|-------------|
| `findShortestPath(from, to)` | BFS shortest path |
| `findAllPaths(from, to, options)` | All paths with max depth |
| `getCentrality(options)` | Centrality metrics |
| `getConnectedComponents()` | Find isolated subgraphs |
| `bfs(start, visitor)` | Breadth-first traversal |
| `dfs(start, visitor)` | Depth-first traversal |

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEMORY_STORAGE_TYPE` | Storage backend: `jsonl` or `sqlite` | `jsonl` |
| `EMBEDDING_PROVIDER` | Embedding provider: `openai`, `local`, or `none` | `none` |
| `OPENAI_API_KEY` | OpenAI API key (required if provider is `openai`) | - |

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- TypeScript 5.0+

### Build Commands

```bash
npm install           # Install dependencies
npm run build         # Build TypeScript to dist/
npm run build:watch   # Watch mode compilation
npm test              # Run all tests
npm run test:watch    # Watch mode testing
npm run test:coverage # Run with coverage report
npm run typecheck     # Type checking without emit
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: ManagerContext (Central Facade)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Lazy-initialized access to all managers               │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  Layer 2: Specialized Managers                              │
│  • EntityManager     (CRUD + hierarchy + archive)           │
│  • RelationManager   (relation CRUD)                        │
│  • SearchManager     (search + compression + analytics)     │
│  • IOManager         (import + export + backup)             │
│  • TagManager        (tag aliases)                          │
│  • GraphTraversal    (path finding, centrality)             │
│  • SemanticSearch    (embeddings, similarity)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  Layer 3: Storage Layer                                     │
│  GraphStorage (JSONL) or SQLiteStorage (better-sqlite3)     │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
memoryjs/
├── src/                            # Source (93 TypeScript files)
│   ├── index.ts                    # Entry point
│   ├── agent/                      # Agent Memory System (19 files)
│   │   ├── AgentMemoryManager.ts       # Unified facade
│   │   ├── SessionManager.ts           # Session lifecycle
│   │   ├── WorkingMemoryManager.ts     # Working memory
│   │   ├── EpisodicMemoryManager.ts    # Episodic memory
│   │   ├── DecayEngine.ts              # Memory decay
│   │   ├── SalienceEngine.ts           # Context scoring
│   │   ├── MultiAgentMemoryManager.ts  # Multi-agent support
│   │   ├── ConflictResolver.ts         # Conflict resolution
│   │   └── ...
│   ├── core/                       # Core managers (12 files)
│   │   ├── ManagerContext.ts           # Context holder (lazy init)
│   │   ├── EntityManager.ts            # Entity CRUD + hierarchy
│   │   ├── RelationManager.ts          # Relation CRUD
│   │   ├── GraphStorage.ts             # JSONL I/O + caching
│   │   ├── SQLiteStorage.ts            # SQLite with better-sqlite3
│   │   ├── TransactionManager.ts       # ACID transactions
│   │   └── ...
│   ├── search/                     # Search implementations (29 files)
│   │   ├── SearchManager.ts            # Search orchestrator
│   │   ├── BasicSearch.ts              # Text matching
│   │   ├── RankedSearch.ts             # TF-IDF scoring
│   │   ├── BooleanSearch.ts            # AND/OR/NOT logic
│   │   ├── FuzzySearch.ts              # Typo tolerance
│   │   ├── SemanticSearch.ts           # Embedding-based
│   │   ├── HybridSearchManager.ts      # Multi-layer search
│   │   └── ...
│   ├── features/                   # Advanced capabilities (9 files)
│   │   ├── IOManager.ts                # Import/export/backup
│   │   ├── TagManager.ts               # Tag aliases
│   │   ├── ArchiveManager.ts           # Entity archival
│   │   ├── CompressionManager.ts       # Duplicate detection
│   │   └── ...
│   ├── types/                      # TypeScript definitions (3 files)
│   ├── utils/                      # Shared utilities (18 files)
│   └── workers/                    # Worker pool (2 files)
├── tests/                          # Test suite (3600+ tests)
│   ├── unit/                       # Unit tests
│   ├── integration/                # Integration tests
│   └── performance/                # Benchmarks
├── docs/                           # Documentation
│   └── architecture/               # Architecture docs
├── tools/                          # Development utilities
│   ├── chunking-for-files/         # File splitting tool
│   └── create-dependency-graph/    # Dependency analyzer
└── README.md                       # This file
```

## Documentation

Comprehensive architecture documentation in `docs/architecture/`:

- [OVERVIEW.md](docs/architecture/OVERVIEW.md) - High-level project overview
- [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) - Technical architecture and design
- [COMPONENTS.md](docs/architecture/COMPONENTS.md) - Component breakdown
- [DATAFLOW.md](docs/architecture/DATAFLOW.md) - Data flow patterns
- [API.md](docs/architecture/API.md) - Complete API documentation
- [DEPENDENCY_GRAPH.md](docs/architecture/DEPENDENCY_GRAPH.md) - Module dependencies

## License

**MIT License** - see [LICENSE](LICENSE)

## Related

- [@danielsimonjr/memory-mcp](https://github.com/danielsimonjr/memory-mcp) - MCP server built on this library

---

**Repository:** https://github.com/danielsimonjr/memoryjs
**NPM:** https://www.npmjs.com/package/@danielsimonjr/memoryjs
**Issues:** https://github.com/danielsimonjr/memoryjs/issues
