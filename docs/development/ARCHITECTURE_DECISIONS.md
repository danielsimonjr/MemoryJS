# Architecture Decision Records (ADRs)

This document captures key architectural decisions made during MemoryJS development, including context, alternatives considered, and rationale.

## Table of Contents

1. [ADR-001: Dual Storage Backends](#adr-001-dual-storage-backends)
2. [ADR-002: Lazy Manager Initialization](#adr-002-lazy-manager-initialization)
3. [ADR-003: Event-Driven TF-IDF Sync](#adr-003-event-driven-tf-idf-sync)
4. [ADR-004: Worker Pool for Fuzzy Search](#adr-004-worker-pool-for-fuzzy-search)
5. [ADR-005: Deferred Referential Integrity](#adr-005-deferred-referential-integrity)
6. [ADR-006: Zod Schema Validation](#adr-006-zod-schema-validation)
7. [ADR-007: Entity-Centric Data Model](#adr-007-entity-centric-data-model)
8. [ADR-008: Barrel Export Pattern](#adr-008-barrel-export-pattern)
9. [ADR-009: In-Memory Cache Strategy](#adr-009-in-memory-cache-strategy)
10. [ADR-010: Hybrid Search Architecture](#adr-010-hybrid-search-architecture)

---

## ADR-001: Dual Storage Backends

**Status**: Accepted
**Date**: 2024-Q1

### Context

Users have different needs for knowledge graph storage:
- Small projects need simple, debuggable storage
- Large projects need indexed search and ACID transactions
- Some deployments can't use native modules

### Decision

Support two storage backends via `IGraphStorage` interface:
1. **JSONL** (default): Human-readable, no native dependencies
2. **SQLite**: FTS5 full-text search, indexed queries, ACID

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| JSONL only | Simple, portable | Poor performance at scale |
| SQLite only | Fast, indexed | Native dependency, harder to debug |
| MongoDB | Scalable, flexible | Heavy dependency, overkill |
| LevelDB | Fast key-value | No full-text search |

### Consequences

**Positive:**
- Users choose appropriate backend for their scale
- JSONL for development, SQLite for production
- No native dependencies for basic usage

**Negative:**
- Two code paths to maintain
- Feature parity challenges (FTS5 vs manual search)
- Slightly larger codebase

### Implementation Notes

```typescript
// Storage selection via factory
const storage = createStorageFromPath('./data.jsonl');  // JSONL
const storage = createStorageFromPath('./data.db');      // SQLite

// Or explicit type
const storage = createStorage({ path: './data', type: 'sqlite' });
```

---

## ADR-002: Lazy Manager Initialization

**Status**: Accepted
**Date**: 2024-Q1

### Context

ManagerContext provides access to 7+ specialized managers. Initializing all at startup:
- Wastes memory if not all are used
- Increases startup time
- Loads unnecessary dependencies

### Decision

Use lazy initialization via TypeScript getters with nullish coalescing assignment (`??=`).

```typescript
class ManagerContext {
  private _entityManager?: EntityManager;

  get entityManager(): EntityManager {
    return (this._entityManager ??= new EntityManager(this.storage));
  }
}
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Eager init | Simple, predictable | Wasted resources |
| Manual init | Full control | Poor DX, boilerplate |
| Lazy getters | On-demand, clean API | Slight first-access latency |
| Factory pattern | Flexible | More complex |

### Consequences

**Positive:**
- Fast startup (only storage initialized)
- Memory efficient (unused managers not created)
- Clean API (just access property)
- No breaking changes if new managers added

**Negative:**
- First access has initialization cost
- Slightly more complex context implementation
- Must handle undefined in private fields

---

## ADR-003: Event-Driven TF-IDF Sync

**Status**: Accepted
**Date**: 2024-Q2

### Context

TF-IDF search requires an index of term frequencies across all documents. When entities change:
- Index must be updated to reflect changes
- Manual sync is error-prone
- Stale index gives wrong results

### Decision

Use `GraphEventEmitter` to automatically trigger TF-IDF index updates on entity changes.

```typescript
// Events emitted by EntityManager
this.eventEmitter.emit('entity:created', entities);
this.eventEmitter.emit('entity:updated', entity);
this.eventEmitter.emit('entity:deleted', names);

// TFIDFEventSync subscribes and updates index
eventEmitter.on('entity:created', (entities) => {
  for (const entity of entities) {
    this.indexManager.addDocument(entity);
  }
});
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Manual sync | Full control | Error-prone, forgotten updates |
| Rebuild on search | Always fresh | Poor performance |
| Event-driven | Automatic, efficient | Coupling via events |
| Scheduled rebuild | Predictable | Stale between rebuilds |

### Consequences

**Positive:**
- Index always current
- Decoupled architecture
- No manual sync required
- Efficient incremental updates

**Negative:**
- Event system complexity
- Must ensure all mutations emit events
- Harder to reason about data flow

---

## ADR-004: Worker Pool for Fuzzy Search

**Status**: Accepted
**Date**: 2024-Q2

### Context

Levenshtein distance calculation is CPU-intensive:
- O(n*m) per comparison where n,m are string lengths
- Blocks main thread during search
- Poor UX for large datasets

### Decision

Use `@danielsimonjr/workerpool` to offload Levenshtein calculations to worker threads.

```typescript
// Worker performs calculation
export function levenshteinDistance(s1: string, s2: string): number {
  // O(n*m) algorithm
}

// Main thread delegates
const pool = workerpool.pool('./levenshteinWorker.js');
const results = await pool.exec('searchEntities', [query, entities, threshold]);
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Main thread | Simple | Blocks UI, poor perf |
| Web Workers | Browser support | Not Node.js native |
| Worker threads | Node native | Manual pool management |
| Workerpool | Managed pool | External dependency |
| WASM | Fast | Complex build |

### Consequences

**Positive:**
- Non-blocking fuzzy search
- Parallel processing
- Scalable to multiple cores
- Graceful pool management

**Negative:**
- External dependency
- Worker serialization overhead
- More complex error handling
- Build complexity for workers

---

## ADR-005: Deferred Referential Integrity

**Status**: Accepted
**Date**: 2024-Q1

### Context

Relations connect entities by name. Strict integrity would:
- Require entities to exist before relations
- Complicate import/export
- Fail on partial data

### Decision

Allow relations to reference non-existent entities ("deferred integrity").

```typescript
// This is allowed even if "Bob" doesn't exist yet
await relationManager.createRelations([
  { from: 'Alice', to: 'Bob', relationType: 'knows' }
]);
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Strict integrity | Data consistency | Inflexible, import issues |
| Deferred integrity | Flexible, import-friendly | Orphan relations possible |
| Soft references | Best of both | Complex implementation |
| Validation mode | User choice | Inconsistent behavior |

### Consequences

**Positive:**
- Import order doesn't matter
- Partial graph operations work
- Simpler implementation
- Better import/export support

**Negative:**
- Relations may reference non-existent entities
- `validateGraph()` needed to find issues
- No automatic cleanup of orphans

### Mitigation

```typescript
// Use analytics to find issues
const report = await ctx.analyticsManager.validateGraph();
if (report.orphanedRelations.length > 0) {
  // Handle orphans
}
```

---

## ADR-006: Zod Schema Validation

**Status**: Accepted
**Date**: 2024-Q1

### Context

Input validation is critical for:
- Preventing invalid data in storage
- Clear error messages for users
- Type safety at runtime

### Decision

Use [Zod](https://zod.dev/) for runtime validation with TypeScript type inference.

```typescript
const EntitySchema = z.object({
  name: z.string().min(1).max(500),
  entityType: z.string().min(1).max(100),
  observations: z.array(z.string().max(5000)),
  tags: z.array(z.string().max(100)).optional(),
  importance: z.number().int().min(0).max(10).optional(),
});

type Entity = z.infer<typeof EntitySchema>;
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Manual validation | No deps | Verbose, error-prone |
| Joi | Mature | No TS inference |
| Yup | Popular | Weaker TS support |
| Zod | TS-first, inference | Newer library |
| io-ts | FP style | Steeper learning curve |

### Consequences

**Positive:**
- Types derived from schemas (single source of truth)
- Excellent error messages
- Runtime + compile-time safety
- Composable schemas

**Negative:**
- Additional dependency
- Learning curve for Zod API
- Schema/type sync required

---

## ADR-007: Entity-Centric Data Model

**Status**: Accepted
**Date**: 2024-Q1

### Context

Knowledge graphs need a core data model. Options:
- Triple stores (subject-predicate-object)
- Property graphs (nodes with properties)
- Document stores (JSON documents)

### Decision

Use entity-centric model with observations:

```typescript
interface Entity {
  name: string;           // Unique identifier
  entityType: string;     // Classification
  observations: string[]; // Facts/notes (free text)
  tags?: string[];        // Categories
  importance?: number;    // Priority (0-10)
  parentId?: string;      // Hierarchy
}

interface Relation {
  from: string;           // Source entity
  to: string;             // Target entity
  relationType: string;   // Relationship type
}
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| RDF triples | Standard, queryable | Verbose, complex |
| Property graph | Flexible | Schema-less issues |
| Document store | Simple | No relations |
| Entity + observations | Balanced | Custom model |

### Consequences

**Positive:**
- Simple, intuitive model
- Observations capture free-form knowledge
- Relations are first-class
- Easy to understand and query

**Negative:**
- Not RDF/SPARQL compatible
- Custom export needed for graph tools
- No relation properties (yet)

---

## ADR-008: Barrel Export Pattern

**Status**: Accepted
**Date**: 2024-Q1

### Context

Module organization needs clean boundaries:
- Internal implementation details should be hidden
- Public API should be clear
- Imports should be simple

### Decision

Each module uses `index.ts` barrel exports:

```typescript
// src/core/index.ts
export { EntityManager } from './EntityManager.js';
export { RelationManager } from './RelationManager.js';
export type { ManagerOptions } from './types.js';

// Usage
import { EntityManager } from './core/index.js';
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Direct imports | Explicit | Verbose, exposes internals |
| Barrel exports | Clean API | Circular dep risk |
| Package.json exports | Modern | Complex config |
| Single entry point | Simple | Large bundles |

### Consequences

**Positive:**
- Clean public API
- Refactoring flexibility (move files without breaking imports)
- Clear module boundaries
- Tree-shaking friendly

**Negative:**
- Potential circular dependency issues
- Extra `index.ts` files to maintain
- Must be careful about what to export

---

## ADR-009: In-Memory Cache Strategy

**Status**: Accepted
**Date**: 2024-Q1

### Context

Storage operations need optimization:
- Repeated reads are expensive
- Graph should be consistent
- Memory vs. disk trade-off

### Decision

JSONL storage uses write-through cache:
- Cache populated on first `loadGraph()`
- Cache invalidated on every `saveGraph()`
- Deep copy returned to prevent mutation

```typescript
class GraphStorage {
  private cache: KnowledgeGraph | null = null;

  async loadGraph(): Promise<KnowledgeGraph> {
    if (!this.cache) {
      this.cache = await this.readFromDisk();
    }
    return JSON.parse(JSON.stringify(this.cache)); // Deep copy
  }

  async saveGraph(graph: KnowledgeGraph): Promise<void> {
    await this.writeToDisk(graph);
    this.cache = null; // Invalidate
  }
}
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| No cache | Simple, consistent | Poor read performance |
| Read-through | Fast reads | Stale data risk |
| Write-through | Consistent | Memory overhead |
| Write-back | Fast writes | Durability risk |
| LRU cache | Memory efficient | Complexity |

### Consequences

**Positive:**
- Fast repeated reads
- Always consistent with disk
- Simple invalidation logic

**Negative:**
- Full graph in memory
- Deep copy overhead
- Not suitable for very large graphs (>10K entities)

---

## ADR-010: Hybrid Search Architecture

**Status**: Accepted
**Date**: 2024-Q3

### Context

Single search strategies have limitations:
- Keyword search misses semantic meaning
- Semantic search misses exact matches
- Metadata filtering needs structure

### Decision

Three-layer hybrid search combining:
1. **Semantic**: Vector similarity (embeddings)
2. **Lexical**: TF-IDF/BM25 text matching
3. **Symbolic**: Metadata filtering (tags, importance)

```typescript
interface HybridSearchOptions {
  weights?: {
    semantic?: number;   // Default: 0.4
    lexical?: number;    // Default: 0.4
    symbolic?: number;   // Default: 0.2
  };
}

// Score fusion
finalScore = (semantic * 0.4) + (lexical * 0.4) + (symbolic * 0.2);
```

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Keyword only | Simple, fast | No semantic understanding |
| Semantic only | Understands meaning | Misses exact matches |
| Cascade | Efficient | Order-dependent |
| Hybrid fusion | Best of all | Complex, tuning needed |

### Consequences

**Positive:**
- Best retrieval quality
- Handles diverse queries
- Configurable weights
- Graceful degradation (works without embeddings)

**Negative:**
- Three search systems to maintain
- Weight tuning required
- Higher latency than single strategy
- Embedding provider dependency for semantic

---

## Template for New ADRs

```markdown
## ADR-XXX: Title

**Status**: Proposed | Accepted | Deprecated | Superseded
**Date**: YYYY-MM

### Context

What is the issue we're addressing?

### Decision

What did we decide to do?

### Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Option 1 | ... | ... |
| Option 2 | ... | ... |

### Consequences

**Positive:**
- Benefit 1
- Benefit 2

**Negative:**
- Drawback 1
- Drawback 2

### Implementation Notes

Code examples or links to implementation.
```

---

## See Also

- [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - Full architecture documentation
- [../architecture/DATAFLOW.md](../architecture/DATAFLOW.md) - Data flow diagrams
- [../architecture/DEPENDENCY_GRAPH.md](../architecture/DEPENDENCY_GRAPH.md) - Module dependencies
