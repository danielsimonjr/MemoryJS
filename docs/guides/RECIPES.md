# MemoryJS Recipes

> **Code samples.** Samples assume `const ctx = new ManagerContext('./memory.jsonl')` and the placeholders `graph: KnowledgeGraph` (from `await ctx.storage.loadGraph()`), `entities: Entity[]` and `storage: IGraphStorage`. Every other name in a sample is imported or declared in it.

**Verified against 4.5.0**

> Problem → solution → notes recipes for common tasks. Every code block is
> type-checked against the 4.5.0 source (`src/`), and each call was checked
> against its implementation and the tests in `tests/`. Import from the public package, `@danielsimonjr/memoryjs`
> (subpaths: `/utils`, `/search`, `/agent`, `/features`, `/core`, `/adapters`,
> `/sqlite`).
>
> Runnable companions live in `examples/` (see [Where to go next](#where-to-go-next)).
> Use cases with longer narratives are in [USE_CASES.md](./USE_CASES.md).

## Table of Contents

1. [Setup and conventions](#setup-and-conventions)
2. [Entity recipes](#entity-recipes)
3. [Relation recipes](#relation-recipes)
4. [Search recipes](#search-recipes)
5. [Batch operations](#batch-operations)
6. [Import, export and backup](#import-export-and-backup)
7. [Hierarchy patterns](#hierarchy-patterns)
8. [Tagging patterns](#tagging-patterns)
9. [Analytics and graph algorithms](#analytics-and-graph-algorithms)
10. [Caching](#caching)
11. [Error handling](#error-handling)
12. [Agent memory recipes](#agent-memory-recipes)
13. [Recursa recipes (skills, learning, bootstrapping)](#recursa-recipes)
14. [Reconstructive memory Q&A](#reconstructive-memory-qa)
15. [Quick reference](#quick-reference)

---

## Setup and conventions

> Examples: `examples/01-quick-start.ts`.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

// JSONL storage (default). Pass a path; the sidecar files sit next to it.
const ctx = new ManagerContext('./memory.jsonl');

// SQLite storage: use a .db path with MEMORY_STORAGE_TYPE=sqlite,
// or pass storageType explicitly.
const sqlite = new ManagerContext({ storagePath: './memory.db', storageType: 'sqlite' });

await ctx.close(); // release file handles and timers
```

Conventions used throughout:

- **Entities are addressed by `name`.** Relations are `{ from, to, relationType }`
  and observations are `{ entityName, contents }`. Most writes take arrays.
- **Writes return the created or changed records.** Reads of a missing entity
  return `null`, not an exception.
- **Search results come in three shapes.** `searchNodes`, `booleanSearch`,
  `fuzzySearch` and `searchByTime` return entities or a `KnowledgeGraph`.
  `searchNodesRanked` returns `SearchResult[]` (`{ entity, score, matchedFields }`).
  `hybridSearchManager.search` returns scored results with `entity` and `scores`.

---

## Entity recipes

> Examples: `examples/01-quick-start.ts`.

### Create an entity with full metadata

**Problem.** Create an entity with tags, importance and a parent in one call.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function createProject(ctx: ManagerContext) {
  const [project] = await ctx.entityManager.createEntities([
    {
      name: 'project-alpha',
      entityType: 'Project',
      observations: ['Started Q1 2024', 'Budget: $50,000', 'Team size: 5'],
      tags: ['active', 'high-priority', 'q1-2024'],
      importance: 8,
      parentId: 'department-engineering',
    },
  ]);
  return project;
}
```

**Notes.** `name` is the public key and must be unique (a duplicate throws
`DuplicateEntityError`). `parentId` is the name of an existing entity; use
`ctx.hierarchyManager.setEntityParent` if you need the parent to be validated
at the same time. `createEntities` also accepts a `LongRunningOperationOptions`
object (`signal`) as its second argument.

### Find or create

**Problem.** Return an entity if it exists, otherwise create it.

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

async function findOrCreate(
  ctx: ManagerContext,
  name: string,
  entityType: string,
  observations: string[] = [],
): Promise<Entity> {
  const existing = await ctx.entityManager.getEntity(name);
  if (existing) return existing;
  const [created] = await ctx.entityManager.createEntities([{ name, entityType, observations }]);
  return created!;
}

async function demoFindOrCreate(ctx: ManagerContext) {
  return findOrCreate(ctx, 'john-doe', 'User', ['New user']);
}
```

**Notes.** Between the read and the write another writer can create the same
name. Catch `DuplicateEntityError` and re-read if that matters for you.

### Upsert observations and fields

**Problem.** Add new facts to an entity, create it if missing, and update tags
or importance only when they change.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function upsertEntity(
  ctx: ManagerContext,
  name: string,
  entityType: string,
  observations: string[],
  tags: string[] = [],
  importance?: number,
) {
  const existing = await ctx.entityManager.getEntity(name);
  if (!existing) {
    await ctx.entityManager.createEntities([{ name, entityType, observations, tags, importance }]);
    return;
  }

  // addObservations skips duplicates by default only when dedup is enabled;
  // filter first so the write is a no-op for facts already present.
  const fresh = observations.filter((o) => !existing.observations.includes(o));
  if (fresh.length > 0) {
    await ctx.observationManager.addObservations([{ entityName: name, contents: fresh }]);
  }

  const mergedTags = [...new Set([...(existing.tags ?? []), ...tags])];
  const patch: { tags?: string[]; importance?: number } = {};
  if (mergedTags.length !== (existing.tags ?? []).length) patch.tags = mergedTags;
  if (importance !== undefined && importance > (existing.importance ?? 0)) patch.importance = importance;
  if (Object.keys(patch).length > 0) await ctx.entityManager.updateEntity(name, patch);
}
```

**Notes.** `updateEntity(name, patch)` merges the patch into the entity. Pass
`{ expectedVersion }` as the third argument for optimistic concurrency; it
throws `VersionConflictError` on a mismatch. Set `MEMORY_OBSERVATION_DEDUP=true`
to have observation writes de-duplicate without the explicit filter.

### Rename an entity

**Problem.** Change an entity's name without breaking its relations or children.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function rename(ctx: ManagerContext, oldName: string, newName: string) {
  return ctx.entityManager.renameEntity(oldName, newName);
}
```

**Notes.** `renameEntity` atomically rewrites relation endpoints, child
`parentId` values and version-chain fields, and emits `entity:renamed`. Use it
instead of create-plus-delete, which would lose the relations.

### Clone an entity

**Problem.** Copy an entity's type, observations, tags and importance under a new name.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function cloneEntity(ctx: ManagerContext, sourceName: string, newName: string) {
  const source = await ctx.entityManager.getEntity(sourceName);
  if (!source) throw new Error(`Entity '${sourceName}' not found`);

  const [copy] = await ctx.entityManager.createEntities([
    {
      name: newName,
      entityType: source.entityType,
      observations: [...source.observations],
      tags: [...(source.tags ?? [])],
      importance: source.importance,
    },
  ]);
  return copy;
}
```

**Notes.** Relations are not copied. Create them explicitly with
`createRelations` if the clone should keep them.

### Archive stale entities

**Problem.** Move entities that have not changed for N days into an archive.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function archiveStale(ctx: ManagerContext, olderThan: string) {
  // archiveEntities writes a compressed archive file and removes the entities.
  // dryRun reports the candidates without touching storage.
  const preview = await ctx.archiveManager.archiveEntities(
    { olderThan, importanceLessThan: 3 },
    { dryRun: true },
  );
  return preview.entityNames;
}
```

**Notes.** `archiveEntities(criteria, options)` takes `olderThan` (an ISO date
string), `importanceLessThan` and `tags`. Run the dry run first. Drop
`dryRun` to archive for real; `listArchives()` lists what was written. For a
softer option that keeps the entity in the graph, tag it instead with
`ctx.entityManager.addTags(name, ['archived'])`.

### Delete entities

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function removeEntities(ctx: ManagerContext, names: string[]) {
  // Deletes the entities and the relations that touch them.
  await ctx.entityManager.deleteEntities(names);
}
```

**Notes.** `deleteEntities` takes an array of names. Check governance policy
(`GovernanceError`) first if `MEMORY_GOVERNANCE_ENABLED=true`.

---

## Relation recipes

> Examples: `examples/01-quick-start.ts`.

### Create a bidirectional relation

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function linkBoth(ctx: ManagerContext, a: string, b: string) {
  return ctx.relationManager.createRelations([
    { from: a, to: b, relationType: 'friend_of' },
    { from: b, to: a, relationType: 'friend_of' },
  ]);
}
```

**Notes.** Relations are directed. Write both directions when the link is
symmetric. `createRelations` returns the relations it wrote.

### Read neighbours

**Problem.** List the entities linked to a given entity, in both directions.

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

async function neighbours(ctx: ManagerContext, name: string): Promise<Entity[]> {
  // getRelations returns every relation that touches the entity.
  const rels = await ctx.relationManager.getRelations(name);
  const others = new Set(rels.map((r) => (r.from === name ? r.to : r.from)));

  const out: Entity[] = [];
  for (const other of others) {
    const e = await ctx.entityManager.getEntity(other);
    if (e) out.push(e);
  }
  return out;
}
```

**Notes.** `getRelations` is O(1) through the relation index. There is no
`getRelationsFrom`/`getRelationsTo` pair; filter `from === name` or
`to === name` as above.

### Shortest path between two entities

**Problem.** Find how two entities are connected.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function connect(ctx: ManagerContext, from: string, to: string) {
  const path = await ctx.graphTraversal.findShortestPath(from, to);
  return path ? path.path : null; // ['alice', 'bob', 'david'] or null
}
```

**Notes.** `findShortestPath` returns `PathResult | null` (`path`, `length`,
`relations`). It follows relation direction. For every path up to a limit, use
`findAllPaths`.

### Delete orphaned relations

**Problem.** Remove relations whose endpoints no longer exist (for example after
an import with `skip`).

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function deleteOrphanedRelations(ctx: ManagerContext): Promise<number> {
  const graph = await ctx.storage.loadGraph();
  const names = new Set(graph.entities.map((e) => e.name));
  const orphans = graph.relations.filter((r) => !names.has(r.from) || !names.has(r.to));
  if (orphans.length > 0) await ctx.relationManager.deleteRelations(orphans);
  return orphans.length;
}
```

**Notes.** `deleteRelations` takes the relation objects, not triples.

### Temporal relations: end, query as of a date, timeline

**Problem.** Record that an employment ended, and answer "who did Bob work for in
March?".

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function temporal(ctx: ManagerContext) {
  await ctx.relationManager.createRelations([
    { from: 'bob', to: 'acme', relationType: 'works_at', createdAt: '2023-01-10T00:00:00Z' },
  ]);

  // Mark the relation as ended. The record is kept, so history survives.
  await ctx.relationManager.invalidateRelation('bob', 'works_at', 'acme', '2024-06-30T00:00:00Z');

  const inMarch = await ctx.relationManager.queryAsOf('bob', '2024-03-15', { direction: 'outgoing' });
  const history = await ctx.relationManager.timeline('bob', { direction: 'outgoing' });
  return { inMarch, history };
}
```

**Notes.** `queryAsOf` expects an ISO 8601 date (the check is on the leading
`YYYY-MM-DD`). `timeline` returns the relations in chronological order.
Entities have the same pattern: `entityAsOf` and `entityTimeline` on
`ctx.entityManager`, and `observationsAsOf` on `ctx.observationManager`.

### Event timeline (`@experimental`)

**Problem.** Flat `actor → action → target` relations lose "who, what, when,
where" once several actions touch the same entities. `ctx.eventManager`
reifies each action as its own event entity.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function recordDeployment(ctx: ManagerContext) {
  const flowKey = 'deploy-42';
  await ctx.eventManager.recordEvent({
    action: 'approved', actor: 'agent-alice', target: 'deployment-42', context: 'production', flowKey,
  });
  await ctx.eventManager.recordEvent({
    action: 'deployed', actor: 'agent-bob', target: 'deployment-42', context: 'production', flowKey,
  });
  await ctx.eventManager.recordEvent({
    action: 'rolled-back', actor: 'agent-bob', target: 'deployment-42', context: 'production', flowKey,
    detail: 'error rate exceeded 5% within 10 minutes',
  });

  const flow = await ctx.eventManager.getFlow(flowKey); // chronological
  const who = await ctx.eventManager.whoDidWhat({ target: 'deployment-42' });
  return { flow, who };
}
```

**Notes.** Actors, targets and contexts that do not exist yet are created as
stub entities. Use this when you need replayable sequences. For a plain
"who linked to what" question, relations are enough.

---

## Search recipes

> Examples: `examples/02-search.ts`.

### Ranked search

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function topMatches(ctx: ManagerContext, query: string) {
  // searchNodesRanked(query, tags?, minImportance?, maxImportance?, limit?)
  const results = await ctx.searchManager.searchNodesRanked(query, undefined, undefined, undefined, 10);
  return results.map((r) => ({ name: r.entity.name, score: r.score }));
}
```

**Notes.** This is TF-IDF/BM25 through `ctx.rankedSearch`. There is no
`rankedSearch(query, limit)` call on `searchManager`; `rankedSearch` is a getter
that returns the ranking engine.

### Multi-strategy search

**Problem.** Exact match first, then ranked, then fuzzy for typos. Merge results
without duplicates.

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

interface Hit {
  entity: Entity;
  score: number;
  matchType: 'exact' | 'ranked' | 'fuzzy';
}

async function multiStrategySearch(ctx: ManagerContext, query: string, limit = 10): Promise<Hit[]> {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const add = (entity: Entity, score: number, matchType: Hit['matchType']) => {
    if (seen.has(entity.name)) return;
    seen.add(entity.name);
    hits.push({ entity, score, matchType });
  };

  const exact = await ctx.entityManager.getEntity(query);
  if (exact) add(exact, 1.0, 'exact');

  for (const r of await ctx.searchManager.searchNodesRanked(query, undefined, undefined, undefined, limit)) {
    add(r.entity, r.score * 0.8, 'ranked');
  }

  if (hits.length < limit) {
    // fuzzySearch(query, threshold): a number between 0 and 1 (default 0.7).
    const fuzzy = await ctx.searchManager.fuzzySearch(query, 0.6);
    for (const e of fuzzy.entities) add(e, 0.5, 'fuzzy');
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

**Notes.** `fuzzySearch` takes the threshold as its second argument, not an
options object. Pass `{ tags, minImportance }` as a number-or-options argument
only if your call site has that shape; the number form is the documented one.

### Filtered search

**Problem.** Full-text search restricted by tag and importance.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function filteredSearch(ctx: ManagerContext, query: string) {
  const graph = await ctx.searchManager.searchNodes(query, {
    tags: ['ai'],
    minImportance: 5,
  });
  return graph.entities;
}
```

**Notes.** `searchNodes` takes either `(query, tags[], minImportance?, maxImportance?)`
or `(query, options)`. Options accept `tags`, `minImportance`, `maxImportance`,
`projectId` and access-tracking fields. `searchNodes` returns a `KnowledgeGraph`,
so read `.entities`.

### Boolean query

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function booleanQuery(ctx: ManagerContext) {
  // Supports AND, OR, NOT, parentheses and field:value terms.
  const graph = await ctx.searchManager.booleanSearch(
    'typescript AND (api OR rest) AND NOT deprecated',
  );
  return graph.entities.map((e) => e.name);
}
```

**Notes.** `booleanSearch` returns a `KnowledgeGraph`, not scored results.
Field terms look like `type:person` or `observation:coding`.

### Natural-language time search

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function lastQuarter(ctx: ManagerContext) {
  // chrono-node parses the phrase into a time range.
  return ctx.searchManager.searchByTime('changes made last quarter');
}
```

**Notes.** `searchByTime(query, options?)` returns `Entity[]`. Pass
`{ field: ... }` in `options` to choose which timestamp is filtered.

### Let the engine choose the method

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function autoSearchExample(ctx: ManagerContext) {
  const out = await ctx.searchManager.autoSearch('database optimization', 10);
  console.log(out.selectedMethod, out.selectionReason);
  return out.results; // SearchResult[]
}
```

**Notes.** `autoSearch` returns `{ results, selectedMethod, selectionReason, estimates }`.
Read `results` directly; there is no `.entities` on this return.

### Hybrid search (semantic + lexical + symbolic)

**Problem.** Blend embedding similarity, keyword matching and metadata filters.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function hybrid(ctx: ManagerContext, query: string) {
  const graph = await ctx.storage.loadGraph();
  const results = await ctx.hybridSearchManager.search(graph, query, {
    semanticWeight: 0.5,
    lexicalWeight: 0.3,
    symbolicWeight: 0.2,
    symbolic: { tags: ['note'], importance: { min: 3 } },
    limit: 5,
  });
  return results.map((r) => ({ name: r.entity.name, scores: r.scores }));
}
```

**Notes.** Without an embedding provider the semantic channel contributes
nothing and the other two still work. Set `MEMORY_EMBEDDING_PROVIDER=none` to
turn embeddings off on purpose. The default provider is `local` (Transformers.js,
needs the optional `@huggingface/transformers` peer).

### Semantic search with an explicit embedding service

**Problem.** Build the embedding service and vector store by hand, for example
to use the OpenAI provider.

```typescript
import {
  createEmbeddingService,
  createVectorStore,
  SemanticSearch,
  type KnowledgeGraph,
} from '@danielsimonjr/memoryjs';

async function semanticDemo(graph: KnowledgeGraph) {
  // Reads MEMORY_EMBEDDING_PROVIDER and MEMORY_OPENAI_API_KEY (not OPENAI_API_KEY).
  // Returns null when the provider is 'none'. The openai provider throws without a key.
  const embeddings = createEmbeddingService({ provider: 'openai' });
  if (!embeddings) return [];

  const store = createVectorStore('jsonl'); // or createVectorStore('sqlite', storage)
  const semantic = new SemanticSearch(embeddings, store, {});
  await semantic.indexAll(graph);
  // search(graph, query, limit?, minSimilarity?)
  return semantic.search(graph, 'reducing cloud spend', 5);
}
```

**Notes.** `createEmbeddingService` is synchronous. It returns `null` when the
provider is `none`, so check for that. With `provider: 'openai'` and no
`MEMORY_OPENAI_API_KEY` it throws instead. `createVectorStore('sqlite', storage)`
needs a SQLite storage object; with JSONL use `'jsonl'`. `new SemanticSearch`
takes the embedding service first, then an optional vector store, then options.
Inside a `ManagerContext`, use `ctx.semanticSearch` (null when embeddings are off).

### Graph-aware ranking (opt-in)

**Problem.** Let well-connected entities rank higher.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function graphAware(ctx: ManagerContext, query: string) {
  // Option 1: boost ranked results by normalised PageRank (score × (1 + boost × pr)).
  // Equivalent env var: MEMORY_RANKED_GRAPH_BOOST=0.5
  ctx.rankedSearch.setGraphPrior(ctx.graphRankPrior, 0.5);

  // Option 2: a graph channel plus one-hop neighbour expansion in hybrid search.
  // Equivalent env var: MEMORY_HYBRID_GRAPH_WEIGHT=0.15
  const graph = await ctx.storage.loadGraph();
  return ctx.hybridSearchManager.search(graph, query, {
    semanticWeight: 0.4,
    lexicalWeight: 0.4,
    symbolicWeight: 0.2,
    graphWeight: 0.15,
    expandNeighbors: { hops: 1, topK: 10 },
  });
}
```

**Notes.** Both are off by default. The `GraphRankPrior` is not built until a
weight or boost asks for it, and it invalidates itself when the graph changes.

### Explainable retrieval

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function explain(ctx: ManagerContext, query: string) {
  const graph = await ctx.storage.loadGraph();
  // explain: true attaches the evidence paths that connect each hit to the query.
  const results = await ctx.hybridSearchManager.search(graph, query, { limit: 5, explain: true });
  return results.map((r) => ({ name: r.entity.name, evidence: r.evidencePaths ?? [] }));
}
```

**Notes.** `explain` is additive. Leave it out and the call is the plain hybrid
search. Build the citation text for your prompt from `evidencePaths`.

---

## Batch operations

### Bulk create

**Problem.** Load thousands of entities without one write per entity.

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';

async function bulkCreate(ctx: ManagerContext, entities: Entity[]) {
  // One call takes the whole array. Use it for dedupe and validation in one pass.
  return ctx.entityManager.createEntities(entities);
}
```

**Notes.** For very large inputs (tens of thousands of rows), slice the array and
call `createEntities` once per slice so each write stays a manageable size. Do not
wrap single creates in `Promise.all`: one array call is the supported bulk path.

### Mixed writes in one batch

**Problem.** Create entities, relations and observations and apply them together
or not at all.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function importBatch(ctx: ManagerContext) {
  const result = await ctx.batch((b) => {
    b.createEntity({ name: 'Alice', entityType: 'person', observations: ['Engineer'] });
    b.createEntity({ name: 'Acme', entityType: 'org', observations: [] });
    b.createRelation({ from: 'Alice', to: 'Acme', relationType: 'works_at' });
    b.addObservations('Acme', ['Founded 2011']);
  });
  // result: { success, operationsExecuted, entitiesCreated, ... }
  return result;
}
```

**Notes.** The callback only queues operations. The batch runs once when the
callback returns, in a single load/apply/save. If the callback throws, nothing
is applied. With the default `stopOnError: true`, nothing is saved after the
first failing operation. Use `ctx.batch(fn, { stopOnError: false })` to keep
going past failures.

### Bulk tag update

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function tagMany(ctx: ManagerContext, names: string[], tag: string) {
  // addTagsToMultipleEntities applies one lock for the whole list.
  return ctx.entityManager.addTagsToMultipleEntities(names, [tag]);
}
```

**Notes.** It returns one `{ entityName, addedTags }` row per entity. Use
`removeTags(name, tags)` for the inverse on a single entity.

### Bulk delete

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function bulkDelete(ctx: ManagerContext, names: string[]) {
  // Relations touching the deleted entities are removed with them.
  await ctx.entityManager.deleteEntities(names);
}
```

---

## Import, export and backup

> Examples: `examples/04-import-export.ts`.

### Export to Markdown or Mermaid

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function exportNotes(ctx: ManagerContext): Promise<string> {
  const graph = await ctx.storage.loadGraph();
  const notes = {
    entities: graph.entities.filter((e) => e.entityType === 'note'),
    relations: graph.relations,
  };
  return ctx.ioManager.exportGraph(notes, 'markdown');
}

async function exportDiagram(ctx: ManagerContext): Promise<string> {
  const graph = await ctx.storage.loadGraph();
  return ctx.ioManager.exportGraph(graph, 'mermaid');
}
```

**Notes.** `exportGraph(graph, format, options?)` is synchronous and returns a
string. The graph argument is required. Formats: `json`, `csv`, `graphml`,
`gexf`, `dot`, `markdown`, `mermaid`, `turtle`, `rdf-xml`, `json-ld`. Pass
`{ redactPii: true }` to scrub PII from the output (the stored graph is not
changed).

### Import CSV with a dry run

**Problem.** Check what an import would do before writing anything.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { readFileSync } from 'node:fs';

async function previewCsv(ctx: ManagerContext, path: string) {
  const data = readFileSync(path, 'utf8');
  // importGraph(format, data, mergeStrategy, dryRun)
  const preview = await ctx.ioManager.importGraph('csv', data, 'skip', true);
  console.log(preview.entitiesAdded, preview.entitiesSkipped, preview.errors);

  if (preview.errors.length === 0) {
    return ctx.ioManager.importGraph('csv', data, 'skip', false);
  }
  return preview;
}
```

**Notes.** Merge strategies: `skip` (keep existing), `replace`, `merge`, `fail`.
The result is an `ImportResult` with `entitiesAdded`, `entitiesSkipped`,
`entitiesUpdated`, `relationsAdded`, `relationsSkipped` and `errors`. Import
formats are `json`, `csv` and `graphml`.

### Backup and restore

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function backupThenRestore(ctx: ManagerContext) {
  const backup = await ctx.ioManager.createBackup();
  console.log(backup.path, backup.entityCount);

  // Later, or on another machine with the same file:
  await ctx.ioManager.restoreFromBackup(backup.path);

  await ctx.ioManager.cleanOldBackups(10); // keep the 10 newest
}
```

**Notes.** `createBackup(options)` also takes a string (a label) or a
`BackupOptions` object. `listBackups()` lists them, `deleteBackup(path)` removes one.

### Sync between instances (copy the diff)

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function pullFrom(target: ManagerContext, sourceExport: string) {
  // Merge a JSON export from another instance. 'merge' keeps both sides' observations.
  return target.ioManager.importGraph('json', sourceExport, 'merge', false);
}
```

**Notes.** Run `importGraph` with `dryRun: true` first. Two-way sync needs
your own conflict policy; `merge` is a union, not a version history.

---

## Hierarchy patterns

### Build a category tree

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function buildTree(ctx: ManagerContext) {
  await ctx.entityManager.createEntities([
    { name: 'Engineering', entityType: 'dept', observations: [] },
    { name: 'Backend', entityType: 'team', observations: [] },
    { name: 'Payments', entityType: 'team', observations: [] },
  ]);
  await ctx.hierarchyManager.setEntityParent('Backend', 'Engineering');
  await ctx.hierarchyManager.setEntityParent('Payments', 'Backend');
}
```

**Notes.** `setEntityParent(child, parent)` rejects cycles with
`CycleDetectedError`. Pass `null` as the parent to make an entity a root.

### Descendants, ancestors and depth

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function treeInfo(ctx: ManagerContext) {
  const descendants = await ctx.hierarchyManager.getDescendants('Engineering');
  const ancestors = await ctx.hierarchyManager.getAncestors('Payments');
  const depth = await ctx.hierarchyManager.getEntityDepth('Payments');
  const roots = await ctx.hierarchyManager.getRootEntities();
  return { descendants, ancestors, depth, roots };
}
```

**Notes.** These return `Entity[]` (or a number for depth). `getSubtree(name)`
returns a `KnowledgeGraph` you can export.

### Move an entity (reparent)

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function reparent(ctx: ManagerContext, name: string, newParent: string | null) {
  return ctx.hierarchyManager.moveEntity(name, newParent);
}
```

---

## Tagging patterns

### Tag aliases

**Problem.** Treat `js`, `javascript` and `JS` as one tag.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function aliases(ctx: ManagerContext) {
  await ctx.tagManager.addTagAlias('js', 'javascript', 'Short form');
  await ctx.tagManager.addTagAlias('JS', 'javascript');
  const canonical = await ctx.tagManager.resolveTag('js'); // 'javascript'
  return canonical;
}
```

**Notes.** Aliases are stored in a sidecar file. `listTagAliases()` and
`getAliasesForTag(canonical)` show them, and `removeTagAlias(alias)` deletes one.

### Rename or merge a tag across the graph

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function consolidateTags(ctx: ManagerContext) {
  // replaceTag: every entity with 'wip' gets 'in-progress' instead.
  await ctx.entityManager.replaceTag('wip', 'in-progress');
  // mergeTags: entities holding either tag end up with the target tag.
  await ctx.entityManager.mergeTags('todo', 'backlog', 'backlog');
}
```

### Tag suggestions from content

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function suggestTags(ctx: ManagerContext, name: string): Promise<string[]> {
  const entity = await ctx.entityManager.getEntity(name);
  if (!entity) return [];
  const text = entity.observations.join(' ').toLowerCase();
  // Candidate tags: the tags of entities whose observations share words with this one.
  const graph = await ctx.storage.loadGraph();
  const counts = new Map<string, number>();
  for (const other of graph.entities) {
    if (other.name === name) continue;
    if (!other.observations.some((o) => text.includes(o.toLowerCase().slice(0, 12)))) continue;
    for (const t of other.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const have = new Set(entity.tags ?? []);
  return [...counts.entries()]
    .filter(([t]) => !have.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);
}
```

**Notes.** This is a deliberately simple heuristic. Review suggestions before
writing them, and use `addTagsToMultipleEntities` to apply the ones you keep.

---

## Analytics and graph algorithms

> Examples: `examples/03-graph-algorithms.ts`.

### Graph statistics

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function stats(ctx: ManagerContext) {
  const s = await ctx.analyticsManager.getGraphStats();
  // GraphStats: totalEntities, totalRelations, entityTypesCounts,
  // relationTypesCounts, plus optional date ranges and cache stats.
  return {
    entities: s.totalEntities,
    relations: s.totalRelations,
    byType: s.entityTypesCounts,
  };
}
```

**Notes.** Pass a preloaded graph as the first argument to avoid a second load.

### Validate the graph

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function health(ctx: ManagerContext) {
  const report = await ctx.analyticsManager.validateGraph();
  // ValidationReport: isValid, issues[], warnings[], summary
  if (!report.isValid) console.error(report.summary, report.issues.slice(0, 5));
  return report.isValid;
}
```

### Find duplicates and merge

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function dedupe(ctx: ManagerContext) {
  // Groups of entity names whose similarity is at least 0.9.
  const groups = await ctx.compressionManager.findDuplicates(0.9);
  for (const group of groups) {
    // mergeEntities(names, targetName) folds the group into the target name.
    await ctx.compressionManager.mergeEntities(group, group[0]);
  }
  return groups.length;
}
```

**Notes.** Review the groups before merging. `findDuplicates` is a similarity
scan, so it can flag entities that are only related.

### Centrality and paths

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function influence(ctx: ManagerContext) {
  // CentralityResult: scores (Map), topEntities [{ name, score }], algorithm
  const pr = await ctx.graphTraversal.calculatePageRank(0.85, 100, 1e-6, 10);
  const degree = await ctx.graphTraversal.calculateDegreeCentrality('both', 10);
  return {
    pagerank: pr.topEntities,
    degree: degree.topEntities,
  };
}

async function components(ctx: ManagerContext) {
  const cc = await ctx.graphTraversal.findConnectedComponents();
  return { count: cc.count, largest: cc.largestComponentSize };
}
```

**Notes.** `calculateBetweennessCentrality` and `calculateHITS` return the same
`CentralityResult` shape. These walk the whole graph, so cache the result if you
call them often.

### Stale and expired entities

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function staleReport(ctx: ManagerContext) {
  // Uses each entity's ttl and confidence. Threshold is optional.
  const stale = await ctx.freshnessManager.getStaleEntities(ctx.storage);
  const expired = await ctx.freshnessManager.getExpiredEntities(ctx.storage);
  return { stale: stale.map((e) => e.name), expired: expired.map((e) => e.name) };
}
```

---

## Caching

### Use the library's SearchCache

**Problem.** Avoid re-running the same expensive search within a few minutes.

**Solution.** `SearchCache` is exported from `@danielsimonjr/memoryjs/utils`. It is
a TTL cache with LRU eviction, keyed by a params object.

```typescript
import { ManagerContext, type Entity } from '@danielsimonjr/memoryjs';
import { SearchCache } from '@danielsimonjr/memoryjs/utils';

// 200 entries, 60 second TTL
const cache = new SearchCache<Entity[]>(200, 60_000);

async function cachedSearch(ctx: ManagerContext, query: string): Promise<Entity[]> {
  const key = { op: 'nodes', query };
  const hit = cache.get(key);
  if (hit) return hit;

  const graph = await ctx.searchManager.searchNodes(query);
  cache.set(key, graph.entities);
  return graph.entities;
}

// After a write that could change results, drop everything.
function onWrite() {
  cache.clear();
}
```

**Notes.** Any write can change search results, so either clear on write or keep
the TTL short. Use a plain `Map` only for values that never change.

### Memoise a derived value

For a value computed from the graph (not a search), a `Map` with a timestamp is
enough:

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const memo = new Map<string, { value: number; at: number }>();

async function cachedStats(ctx: ManagerContext, ttlMs = 30_000): Promise<number> {
  const hit = memo.get('entityCount');
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const s = await ctx.analyticsManager.getGraphStats();
  memo.set('entityCount', { value: s.totalEntities, at: Date.now() });
  return s.totalEntities;
}
```

---

## Error handling

> Examples: `examples/07-governance-rbac.ts`.

### Catch the typed errors

Most library errors extend `KnowledgeGraphError` and carry a stable `code`.
The ones exported from the root include `EntityNotFoundError`,
`DuplicateEntityError`, `RelationNotFoundError`, `ValidationError`,
`CycleDetectedError`, `OperationCancelledError` and `GovernanceError` (when
governance is enabled), `VersionConflictError` (stale `expectedVersion`) and
`AttributionRequiredError` (strict `CollaborationAuditEnforcer` without an agent id).

```typescript
import {
  ManagerContext, DuplicateEntityError, ValidationError, VersionConflictError, AttributionRequiredError,
} from '@danielsimonjr/memoryjs';

async function safeUpdate(ctx: ManagerContext, name: string, importance: number, version: number) {
  try {
    return await ctx.entityManager.updateEntity(name, { importance }, { expectedVersion: version });
  } catch (err) {
    if (err instanceof VersionConflictError) return `stale: expected v${err.expected}, found v${err.actual}`;
    if (err instanceof AttributionRequiredError) return 'missing agent id';
    if (err instanceof ValidationError) return `invalid: ${err.message}`;
    if (err instanceof DuplicateEntityError) return 'already exists';
    throw err;
  }
}
```

### Retry transient failures

```typescript
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 100): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
```

**Notes.** Retry only operations that are safe to repeat (reads, or writes with
`expectedVersion`). Do not retry `VersionConflictError` blindly; re-read first.

### Abort a long operation

```typescript
import { ManagerContext, OperationCancelledError } from '@danielsimonjr/memoryjs';

async function importWithTimeout(ctx: ManagerContext, data: string, ms = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await ctx.ioManager.importGraph('json', data, 'skip', true, { signal: controller.signal });
  } catch (err) {
    if (err instanceof OperationCancelledError) return 'cancelled';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
```

---

## Agent memory recipes

> Examples: `examples/05-agent-memory.ts`.

### Wake-up context for a new session

**Problem.** Build a compact system-prompt prefix (about 600 tokens) from memory
at the start of a session.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function systemPrefix(ctx: ManagerContext, projectId?: string): Promise<string> {
  const amm = ctx.agentMemory();
  const wake = await amm.wakeUp({ projectId, maxL0Tokens: 100, maxL1Tokens: 500 });
  // wake.l0 (identity), wake.l1_5 (pending intentions), wake.l1 (key facts)
  return [wake.projectContext, wake.l0, wake.l1_5, wake.l1].filter(Boolean).join('\n\n');
}
```

**Notes.** `wakeUp` budgets each layer separately; the layers are trimmed to the
token limits you pass. Use `compress: true` to load a token-efficient form.

### Knowledge-aware wake-up

**Problem.** Include the learned instructions and skills that match the current
task, not just the memories.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function taskPrefix(ctx: ManagerContext, taskHint: string): Promise<string> {
  const amm = ctx.agentMemory();
  // knowledge: shared instructions extend L0; skills matched to taskHint extend L1.
  const wake = await amm.wakeUp({
    knowledge: ctx.knowledgeRepository,
    taskHint,
    maxL0Tokens: 200,
    maxL1Tokens: 600,
  });
  return [wake.l0, wake.l1].filter(Boolean).join('\n\n');
}
```

**Notes.** Knowledge is bounded by each layer's remaining budget, so long skill
libraries do not crowd out memories. `AgentMemoryManager.setKnowledgeRepository`
sets the default so you can omit `knowledge` on later calls.

### Sessions and working memory

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function sessionFlow(ctx: ManagerContext) {
  const amm = ctx.agentMemory();
  const session = await amm.startSession({ goalDescription: 'Fix the flaky test' });
  const sessionId = session.sessionId;
  if (!sessionId) throw new Error('startSession did not return a session id');
  await amm.addWorkingMemory({
    sessionId,
    content: 'The failure only reproduces under load',
    importance: 7,
    ttlHours: 24,
  });
  await amm.endSession(sessionId, 'completed');
}
```

**Notes.** `addWorkingMemory` takes the `sessionId` from `startSession`. Working
memories expire after `ttlHours`. `confirmMemory` boosts one, and `promoteMemory`
moves it to episodic or semantic memory.

### Turn-level memory with deduplication

**Problem.** Store a chat transcript without writing the same message twice.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function recordTurn(ctx: ManagerContext, sessionId: string, role: 'user' | 'assistant', text: string) {
  const result = await ctx.memoryEngine.addTurn(text, { sessionId, role });
  if (result.duplicateDetected) return { stored: false, duplicateOf: result.duplicateOf };
  return { stored: true, importance: result.importanceScore };
}

async function transcript(ctx: ManagerContext, sessionId: string) {
  return ctx.memoryEngine.getSessionTurns(sessionId, { limit: 50 });
}
```

**Notes.** `addTurn` runs four dedup tiers (exact hash, prefix overlap, token
Jaccard, optional semantic). `getRepeatedTurnCount(sessionId)` reports how many
were rejected in this process; the count is not persisted.

### Per-agent diary

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function diary(ctx: ManagerContext) {
  const amm = ctx.agentMemory();
  // agentId: letters, digits, '-' and '_' only.
  await amm.writeDiary('planner-1', 'Split the migration into three phases.', { topic: 'migration' });
}
```

---

## Recursa recipes

> Examples: `examples/09-recursa-skills-knowledge.ts`, `examples/10-recursa-learning.ts`,
> `examples/11-recursa-bootstrap.ts`, `examples/12-harness-tools.ts`.

Recursa is the self-improvement layer: a knowledge repository of skills and
instructions, a learning loop that edits that knowledge from failures, and a
bootstrapper that builds a first task set from a corpus. All of it is
`@experimental`. The signatures below are the 4.5.0 ones.

### Teach a skill and publish SKILL.md

**Problem.** Record a procedure the agent learned and publish it as a
`SKILL.md` directory that other tools can read.

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function teachAndPublish(ctx: ManagerContext) {
  const id = await ctx.skillManager.add({
    name: 'Refund over limit',
    description: 'Use when a refund request exceeds the standard limit of 500 dollars.',
    kind: 'procedure',
    scope: { domains: ['billing'], tasks: ['refund-escalation'] },
    uncertainty: 0.2,
    body: '1. Confirm the order is older than 30 days.\n2. Route to a supervisor queue.',
  });

  // publish confines the output directory to skillPublishRoot (default: cwd).
  const report = await ctx.skillPublisher.publish('./published-skills');
  return { id, skillCount: report.skillCount, dir: report.dir };
}
```

**Notes.** `add` returns the existing id when the same name and body are added
again. `retire(id, reason)` stops a skill from matching without deleting it.
`ctx.skillPublisher.importSkills(dir)` loads a published tree into a fresh context.

### Load knowledge for a task

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

async function solverContext(ctx: ManagerContext, task: string): Promise<string> {
  const loaded = await ctx.knowledgeRepository.loadForContext({
    role: 'solver',
    taskHint: task,
    budgetTokens: 1500,
  });
  // Markdown: instructions, then matched skills, then failure lessons, trimmed to budget.
  return loaded.markdown;
}
```

**Notes.** `role` is `'solver'`, `'learner'` or `'shared'`. `sections` restricts the
parts loaded, and `includeSkillIds` forces specific skills in.

### Run one learning round

**Problem.** Give the agent a small task set with rubrics, let the loop diagnose the
failures and add skills, then see whether the failures went away.

```typescript
import { ManagerContext, DeterministicJudge, type LearningSolver, type TaskRecord } from '@danielsimonjr/memoryjs';

async function oneRound(ctx: ManagerContext) {
  const tasks: TaskRecord[] = [
    {
      id: 'refund-limit',
      input: 'What is the refund limit?',
      category: 'billing',
      rubric: [{ id: 'c1', text: 'states 500', kind: 'fact', expected: '500' }],
    },
  ];

  // The solver answers using the knowledge it is given. Replace the body with your model call.
  const solver: LearningSolver = {
    async solve(task, knowledge) {
      const answer = knowledge.markdown.includes('500') ? '500' : 'unknown';
      return { answer, traceAddrs: [] };
    },
  };

  const loop = ctx.learningLoop({ solver, judge: new DeterministicJudge(), publishDir: './published-skills' });
  const result = await loop.learn({
    taskIds: tasks.map((t) => t.id),
    tasks,
    budget: { maxRounds: 1 },
  });
  return { stoppedBecause: result.stoppedBecause, before: result.before.allPass, after: result.after.allPass };
}
```

**Notes.** `learn` runs the leaf learner for small task sets and switches to the
recursive learner above `MEMORY_LEARNING_LEAF_THRESHOLD` (default 20). The solver
is the only thing you must supply. A deterministic judge covers `fact`, `number`
and `set-*` criteria; use `LLMRubricJudge` for `free` criteria. Set
`interactionLog` on the loop to make diagnosis read the solver's trace.

### Bootstrap from a document folder

**Problem.** Turn a folder of Markdown files into exploration notes, practice tasks
and, optionally, a first learning pass.

```typescript
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManagerContext, type LearningSolver } from '@danielsimonjr/memoryjs';
import type { CorpusSource } from '@danielsimonjr/memoryjs';

function loadCorpus(dir: string): CorpusSource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ ref: f, title: f, text: readFileSync(join(dir, f), 'utf8') }));
}

async function bootstrapDocs(ctx: ManagerContext, dir: string, solver?: LearningSolver) {
  const boot = await ctx.bootstrapper({ learning: { publishDir: './published-skills' } }).run({
    sources: loadCorpus(dir),
    corpusLabel: 'docs',
    budget: { maxRounds: 2 },
    // Without a solver the run maps the corpus and writes notes and tasks, but no learning pass.
    ...(solver ? { solver } : {}),
  });
  return { tasks: boot.taskIds.length, notesSkillId: boot.notesSkillId, learned: boot.learn?.stoppedBecause };
}
```

**Notes.** Each `CorpusSource` has a `ref` and either inline `text` or an async
`loader`. A loader defers the read until the mapper reaches the document.
Bootstrap is `@experimental`; the notes skill it writes is named from `corpusLabel`.

### Wire the Recursa tools into an MCP server (shape only)

**Problem.** Expose the 14 Recursa operations (`recursa.knowledge.*`,
`recursa.skills.*`, `recursa.learn.*`, `recursa.log.*`, `recursa.eval.run`) to an
agent harness.

`createRecursaTools` returns a stateless set. `list()` gives the descriptors and
`call(name, args)` returns `{ ok, result }` or `{ ok: false, error: { code, message } }`.
It never throws.

```typescript
import { ManagerContext, createRecursaTools, InteractionLog } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./agent.jsonl');
const tools = createRecursaTools(ctx, {
  publishDir: './published-skills',           // required for recursa.skills.*
  interactionLog: new InteractionLog('./agent.jsonl'), // required for recursa.log.*
  maxBytes: 64 * 1024,
});

// Pseudo-server: register every descriptor with your MCP framework.
// The handler forwards the JSON arguments and returns the JSON result.
const server = {
  tool(name: string, description: string, inputSchema: Record<string, unknown>, handler: (args: unknown) => Promise<unknown>) {
    void name; void description; void inputSchema; void handler; // replace with your SDK's registration call
  },
};

for (const d of tools.list()) {
  server.tool(d.name, d.description, d.inputSchema, (args) => tools.call(d.name, args));
}
```

**Notes.** This is the shape, not a runnable server: swap `server.tool` for your
SDK's registration call. Arguments are validated with strict schemas, so unknown
keys are an `invalid_args` error. The skills tools accept only a relative `dir`
below `publishDir`. See the harness-tools example listed under
[Where to go next](#where-to-go-next).

---

## Reconstructive memory Q&A

> Examples: `examples/13-reconstructive-memory.ts`.

**Problem.** Answer questions about a long conversation by rebuilding the relevant
evidence from a cue-tag-content graph, instead of retrieving one chunk.

```typescript
import { ManagerContext, type DialogueTurn } from '@danielsimonjr/memoryjs';

async function askConversation(ctx: ManagerContext, turns: DialogueTurn[], question: string) {
  // The default backing writes episodes, facts and topics into the context's
  // entity, relation and semantic stores, so they stay durable and searchable.
  const memory = ctx.reconstructiveMemory();
  await memory.ingest(turns);

  const result = await memory.reconstruct(question, { maxSteps: 4, evidenceTarget: 5 });
  return {
    answer: result.answer ?? '(no answer)',
    confidence: result.confidence,
    evidence: result.evidence.map((e) => `${e.layer}: ${e.text}`),
    stoppedEarly: result.stoppedEarly,
  };
}
```

**Notes.** `DialogueTurn` is `{ id, text, speaker?, timestamp? }`. Without an
`llmProvider` the distiller and the answer step use deterministic heuristics; add
one in the config to use the paper's prompts. Pass `backing: undefined` to keep the
graph in memory only. `memory.stats()` and `memory.toSnapshot()` let you inspect or
persist it.

---

## Quick reference

| Task | Call |
|------|------|
| Create entities | `ctx.entityManager.createEntities([{ name, entityType, observations }])` |
| Get one | `ctx.entityManager.getEntity(name)` → `Entity \| null` |
| List by type | `ctx.entityManager.listEntities({ entityType })` |
| Update fields | `ctx.entityManager.updateEntity(name, patch, { expectedVersion? })` |
| Rename | `ctx.entityManager.renameEntity(oldName, newName)` |
| Delete | `ctx.entityManager.deleteEntities([names])` |
| Add facts | `ctx.observationManager.addObservations([{ entityName, contents }])` |
| Remove facts | `ctx.observationManager.deleteObservations([{ entityName, observations }])` |
| Create relations | `ctx.relationManager.createRelations([{ from, to, relationType }])` |
| Relations of an entity | `ctx.relationManager.getRelations(name)` |
| End / as-of / timeline | `invalidateRelation`, `queryAsOf`, `timeline` on `relationManager` |
| Ranked search | `ctx.searchManager.searchNodesRanked(q, tags?, min?, max?, limit?)` |
| Fuzzy | `ctx.searchManager.fuzzySearch(q, threshold)` |
| Boolean | `ctx.searchManager.booleanSearch('a AND (b OR c) NOT d')` |
| Natural-language time | `ctx.searchManager.searchByTime(q)` |
| Auto method | `ctx.searchManager.autoSearch(q, limit)` → `{ results, selectedMethod }` |
| Hybrid | `ctx.hybridSearchManager.search(graph, q, { semanticWeight, lexicalWeight, symbolicWeight, symbolic })` |
| Shortest path | `ctx.graphTraversal.findShortestPath(a, b)` |
| Centrality | `ctx.graphTraversal.calculatePageRank()` → `CentralityResult` |
| Stats | `ctx.analyticsManager.getGraphStats()` |
| Validate | `ctx.analyticsManager.validateGraph()` |
| Export | `ctx.ioManager.exportGraph(graph, 'mermaid' \| 'markdown' \| …)` |
| Import (dry run) | `ctx.ioManager.importGraph('csv', data, 'skip', true)` |
| Backup / restore | `ctx.ioManager.createBackup()` / `restoreFromBackup(path)` |
| Batch | `ctx.batch(b => { b.createEntity(...); b.createRelation(...); })` |
| Agent memory | `ctx.agentMemory()` → `wakeUp`, `startSession`, `addWorkingMemory` |
| Turn memory | `ctx.memoryEngine.addTurn(text, { sessionId, role })` |
| Skills | `ctx.skillManager.add`, `ctx.skillPublisher.publish(dir)` |
| Knowledge | `ctx.knowledgeRepository.loadForContext({ role, taskHint })` |
| Learning | `ctx.learningLoop({ solver, judge }).learn({ taskIds, tasks, budget })` |
| Bootstrap | `ctx.bootstrapper(deps).run({ sources, corpusLabel, budget })` |
| Tool surface | `createRecursaTools(ctx, deps).list()` / `.call(name, args)` |
| Reconstruction | `ctx.reconstructiveMemory().ingest(turns)` / `.reconstruct(q)` |

---

## Where to go next

- **Runnable examples** (`examples/`, one file per topic):
  - `01-quick-start.ts`: entities, relations, observations
  - `02-search.ts`: ranked, fuzzy, boolean, temporal and hybrid search
  - `03-graph-algorithms.ts`: paths, centrality, components
  - `04-import-export.ts`: export formats (including RDF), backups, skill publishing
  - `05-agent-memory.ts`: sessions, working memory, wake-up
  - `06-multi-agent.ts`: visibility, collaborative synthesis, conflict resolution
  - `07-governance-rbac.ts`: governance, RBAC, attribution, PII redaction
  - `08-versioning-causal.ts`: bitemporal versioning, temporal relations, causal reasoning, world-state diffs
  - `09-recursa-skills-knowledge.ts`: skills, knowledge, SKILL.md
  - `10-recursa-learning.ts`: learning loop (run-to-completion and step-wise)
  - `11-recursa-bootstrap.ts`: bootstrapping from a corpus
  - `12-harness-tools.ts`: interaction log and tool adapter
  - `13-reconstructive-memory.ts`: cue-tag-content reconstruction
  - `14-procedural-graph.ts`: procedural graph with guidance per step
  - `15-sqlite.ts`: SQLite storage, full-text search and the SQLite-only features
- **Use cases**: [USE_CASES.md](./USE_CASES.md) puts these recipes together into
  complete applications.
- **API reference**: [API_REFERENCE.md](./API_REFERENCE.md).
