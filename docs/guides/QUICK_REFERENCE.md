# MemoryJS Quick Reference

**Last refreshed**: 2026-07-24 (v2.9.0)

A concise cheat sheet for common MemoryJS operations.

> **Cheat sheet for features shipped through v2.9.0:**
>
> - **Bitemporal**: `entityManager.invalidateEntity(name, ended?)` / `entityAsOf(name, asOf)` / `entityTimeline(name)`; `observationManager.invalidateObservation(entity, content, ended?)` / `observationsAsOf(entity, asOf)` (η.4.4)
> - **OCC**: `updateEntity(name, updates, { expectedVersion })` — throws `VersionConflictError` (η.5.5.c)
> - **RDF export**: `ioManager.exportGraph(g, 'turtle' | 'rdf-xml' | 'json-ld')` (η.5.4)
> - **Active retrieval**: `ctx.activeRetrieval.adaptiveRetrieve({ query })` (3B.5)
> - **Causal**: `ctx.causalReasoner.findEffects(cause, candidates)` / `findCauses` / `counterfactual` / `detectCycles` (3B.6)
> - **Procedures**: `ctx.procedureManager.addProcedure({ steps })` / `matchProcedure(context, candidates)` / `refineProcedure(id, { succeeded })` (3B.4)
> - **World model**: `ctx.worldModelManager.getCurrentState()` / `validateFact()` / `predictOutcome()` / `detectStateChange(before, after)` (3B.7)
> - **RBAC**: `ctx.rbacMiddleware.checkPermission(agentId, 'write', 'entity')` + `ctx.roleAssignmentStore.assign({ agentId, role })` (η.6.1)
> - **PII**: `new PiiRedactor().redactGraph(graph)` / `redactWithStats(text)` (η.6.3)
> - **Conflict resolution**: `synth.resolveConflicts(result, { strategy: 'highest_confidence' })` (η.5.5.a)
> - **Audit attribution**: `new CollaborationAuditEnforcer(em, log).updateEntity(name, updates, agentId)` (η.5.5.d)
> - **Visibility**: `AgentEntity.allowedRoles` + `visibleFrom` / `visibleUntil` (η.5.5.b)
> - **Rename**: `entityManager.renameEntity(oldName, newName)` — rewrites relations/parentId/version-chain, emits `entity:renamed` (v2.9.0)
> - **List entities**: `entityManager.listEntities({ entityType? })` (v2.9.0)
> - **Graph-ranked search**: `ctx.hybridSearchManager.search(graph, query, { graphWeight })` / `ctx.graphRankPrior.getScores(names)` / `rankedSearch.setGraphPrior(prior, boost)` (v2.9.0, `@experimental`)

> **Cheat sheet for Unreleased (post-v2.9.0) additions:**
>
> - **Subpath imports**: `@danielsimonjr/memoryjs/{core,search,agent,features,utils,types,adapters,security,sqlite}` — tree-shakeable, `sideEffects: false`
> - **Event reification**: `ctx.eventManager.recordEvent({ action, actor, target?, occurredAt?, flowKey? })` / `queryEvents(filter)` / `getFlow(key)` / `whoDidWhat(filter)` (R1, `@experimental`)
> - **Evidence paths**: `ctx.hybridSearchManager.search(graph, query, { explain: true })` → results gain `evidencePaths` / `evidenceTruncated` (R2)
> - **NL-guided traversal**: `ctx.graphTraversal.getNeighborsWithRelations(name, { lookFor: 'text', semanticSearch? })` / `findPathWithin(a, b, maxDepth)` (R7)
> - **Relation consolidation**: `new RelationConsolidator(ctx.relationManager, ctx.entityManager, { embedding?, llm? }).consolidate({ apply: true })` (R3, `@experimental`)
> - **Ingest provenance**: `ctx.ioManager.ingest(input, { mode: 'accurate' | 'balanced' | 'lightweight' })` → `result.manifestEntity` / `result.tokenUsage` (R4b/R5)
> - **CLI provenance/preflight**: `memory audit log|history|verify|stats` / `memory doctor [--json]`
> - **Governance now enforced**: `MEMORY_GOVERNANCE_ENABLED=true` wires policy + audit into every `EntityManager` mutation (`GovernanceError` on denial) — previously a no-op
> - **Audit tamper-evidence**: `new AuditLog(path).verifyChain()` — hash-chained (`seq`/`prevHash`), exit 1 from `memory audit verify` on a broken chain

---

## Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default)
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage (for larger graphs)
const ctx = new ManagerContext('./memory.db');

// Subpath imports (Unreleased) — tree-shakeable, avoids loading unused
// managers (e.g. `/core` skips chrono-node and the SQLite native addon)
import { EntityManager } from '@danielsimonjr/memoryjs/core';
import { SQLiteStorage } from '@danielsimonjr/memoryjs/sqlite';
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

// List (v2.9.0) — filter uses an O(k) TypeIndex fast path
const all = await ctx.entityManager.listEntities();
const people = await ctx.entityManager.listEntities({ entityType: 'person' });

// Rename (v2.9.0) — rewrites relations, parentId, version-chain fields;
// emits entity:renamed then entity:deleted/entity:created
await ctx.entityManager.renameEntity('Alice', 'Alice Smith');
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
| `searchManager.searchNodes()` | Basic substring matching |
| `searchManager.searchNodesRanked()` | TF-IDF relevance ranking |
| `searchManager.booleanSearch()` | AND/OR/NOT operators |
| `searchManager.fuzzySearch()` | Typo tolerance |
| `hybridSearchManager.search()` | Combined semantic+lexical+symbolic(+graph) |

```typescript
// Basic search with filters
const results = await ctx.searchManager.searchNodes('query', {
  tags: ['important'],
  minImportance: 5,
  maxImportance: 10,
  entityType: 'person'
});

// Ranked search (TF-IDF)
const ranked = await ctx.searchManager.searchNodesRanked('query', {
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

// Hybrid search (multi-layer) — note: this is ctx.hybridSearchManager, not
// ctx.searchManager; graph first, then query
const graph = await ctx.entityManager.getAllEntities().then(entities => ({ entities, relations: [] }));
const hybrid = await ctx.hybridSearchManager.search(graph, 'query', {
  semanticWeight: 0.4,
  lexicalWeight: 0.4,
  symbolicWeight: 0.2,
  symbolic: { tags: ['ai'], importance: { min: 3 } }
});

// Graph-connectivity boost (v2.9.0, @experimental, all default off)
const ranked2 = await ctx.searchManager.searchNodesRanked('query'); // ctx.rankedSearch auto-boosts when MEMORY_RANKED_GRAPH_BOOST > 0
const scores = await ctx.graphRankPrior.getScores(['Alice', 'Bob']);

// Evidence paths (Unreleased, R2) — off by default, zero cost unless requested
const explained = await ctx.hybridSearchManager.search(graph, 'deployment failure', {
  explain: true,
});
explained[0]?.evidencePaths;      // anchor -> result shortest paths
explained[0]?.evidenceTruncated;  // true if a depth/count cap bit
```

---

## Graph Algorithms

```typescript
// Shortest path (Dijkstra) — resolves to PathResult | null
const result = await ctx.graphTraversal.findShortestPath('A', 'B');
// result?.path, result?.relations, result?.length

// All paths
const paths = await ctx.graphTraversal.findAllPaths('A', 'B', 5); // maxDepth

// Centrality — three separate methods, no unified getCentrality()
const pageRank = await ctx.graphTraversal.calculatePageRank();
const degree = await ctx.graphTraversal.calculateDegreeCentrality('both');
const betweenness = await ctx.graphTraversal.calculateBetweennessCentrality();

// Connected components
const components = await ctx.graphTraversal.findConnectedComponents();

// Traversal — synchronous, options object (not a visitor callback)
const bfsResult = ctx.graphTraversal.bfs('Start');   // { nodes, depths, parents }
const dfsResult = ctx.graphTraversal.dfs('Start');
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

// Backup — BackupResult carries `path`, not `id`
const backup = await ctx.ioManager.createBackup({ compress: true });
await ctx.ioManager.restoreFromBackup(backup.path);
const backups = await ctx.ioManager.listBackups();
await ctx.ioManager.deleteBackup(backup.path);

// Ingest with provenance (Unreleased, R4b/R5) — mode dial + manifest entity
const ingested = await ctx.ioManager.ingest(
  { messages: conversationMessages, source: 'support-thread-42' },
  { mode: 'lightweight' }  // 'lightweight' | 'balanced' (default) | 'accurate'
);
ingested.manifestEntity;  // `ingest-<id>` — [chunk] observations, one per source chunk
ingested.tokenUsage;      // present only when the LLM ran (mode !== 'lightweight')
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

## Event Reification (Unreleased, `@experimental`)

```typescript
// Actions as first-class 'event' hub entities instead of flat triples
await ctx.eventManager.recordEvent({
  action: 'deployed',
  actor: 'alice',
  target: 'api-service',
  context: 'production',
  flowKey: 'release-42',       // groups events under tag `flow:release-42`
});

const flow = await ctx.eventManager.getFlow('release-42');           // chronological
const who = await ctx.eventManager.whoDidWhat({ target: 'api-service' });
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
import { createEmbeddingService, SemanticSearch } from '@danielsimonjr/memoryjs';

const embedding = createEmbeddingService({ provider: 'openai' });  // or use ctx.semanticSearch directly
const semantic = new SemanticSearch(embedding);   // vectorStore defaults to InMemoryVectorStore
const graph = { entities: await ctx.entityManager.getAllEntities(), relations: [] };

// Index entities
await semantic.indexAll(graph);

// Search by meaning
const results = await semantic.search(graph, 'functional programming');

// Find similar entities
const similar = await semantic.findSimilar(graph, 'TypeScript', 5);
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
| `MEMORY_EMBEDDING_PROVIDER` | `openai`, `local`, `none` | `local` |
| `MEMORY_OPENAI_API_KEY` | API key | - |
| `MEMORY_HYBRID_GRAPH_WEIGHT` | Number (0-1) | `0` (off) |
| `MEMORY_RANKED_GRAPH_BOOST` | Number (≥0) | `0` (off) |

See [CLAUDE.md](../../CLAUDE.md) for the complete environment-variable reference.

---

## Data Model

### Entity

```typescript
interface Entity {
  name: string;              // Unique key (1-500 chars)
  entityType: string;        // Category
  observations: string[];    // Facts
  parentId?: string;         // Hierarchy parent
  tags?: string[];           // Labels (lowercase)
  importance?: number;       // Priority (0-10)
  createdAt?: string;        // ISO timestamp
  lastModified?: string;     // ISO timestamp
  id?: string;               // Stable opaque UUID (v2.9.0) — assigned at creation,
                              // preserved across renames/updates; name stays the public key
  // ...plus freshness/versioning/bitemporal fields — see docs/architecture/API.md#entity
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

---

## CLI (Unreleased additions)

```bash
# Queryable audit trail (provenance) — R4a
memory audit log --entity Alice --since 2h        # filtered listing (--json to pipe)
memory audit history Alice                         # full chronological history for one entity
memory audit verify                                # hash-chain verification; exit 1 if broken
memory audit stats                                 # entry counts by operation + oldest/newest

# Preflight checks for the documented gotchas — R9
memory doctor [--json]                             # node version, better-sqlite3 ABI, workers
                                                     # built, storage-file sanity, env lint,
                                                     # embedding provider reachability
```
