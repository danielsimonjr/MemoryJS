# MemoryJS - Data Flow Documentation

**Version**: 1.0.0
**Last Updated**: 2026-01-10

---

## Table of Contents

1. [Overview](#overview)
2. [Request Processing Flow](#request-processing-flow)
3. [Entity Operations](#entity-operations)
4. [Relation Operations](#relation-operations)
5. [Search Operations](#search-operations)
6. [Hierarchy Operations](#hierarchy-operations)
7. [Compression Operations](#compression-operations)
8. [Import/Export Operations](#importexport-operations)
9. [Caching Strategy](#caching-strategy)
10. [Error Handling Flow](#error-handling-flow)

---

## Overview

Data flows through MemoryJS in a layered pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Code                                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: ManagerContext (Facade)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Lazy-initialized access to all managers                  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Manager Layer                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  EntityManager │ RelationManager │ SearchManager │ etc. │   │
│  └───────────────────────────┬─────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Storage Layer                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              GraphStorage / SQLiteStorage                │   │
│  │  ┌──────────────┐              ┌───────────────────┐    │   │
│  │  │ In-Memory    │◀────────────▶│   File System     │    │   │
│  │  │ Cache        │   read/write │   (JSONL/SQLite)  │    │   │
│  │  └──────────────┘              └───────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Processing Flow

### General Request Flow

```
1. Application calls ManagerContext method
        │
        ▼
2. ManagerContext lazy-initializes manager (if needed)
        │
        ▼
3. Manager validates input (Zod schemas)
        │
        ▼
4. Manager loads graph from storage
        │
        ▼
5. Manager processes request in memory
        │
        ▼
6. Manager saves graph (if modified)
        │
        ▼
7. Result returned to application
```

### Example: Create Entities

```typescript
// 1. Application calls
const ctx = new ManagerContext({ storagePath: './memory.jsonl' });
await ctx.entityManager.createEntities([
  { name: 'Alice', entityType: 'person', observations: ['Engineer'] }
]);

// 2. EntityManager processing
async createEntities(entities: Entity[]): Promise<Entity[]> {
  // Validate input
  const validated = BatchCreateEntitiesSchema.parse(entities);

  // Load graph
  const graph = await this.storage.loadGraph();

  // Filter duplicates
  const newEntities = validated.filter(e => !graph.entities.find(x => x.name === e.name));

  // Add timestamps and normalize
  const withTimestamps = newEntities.map(e => ({
    ...e,
    tags: e.tags?.map(t => t.toLowerCase()),
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString()
  }));

  // Add to graph
  graph.entities.push(...withTimestamps);

  // Save
  await this.storage.saveGraph(graph);

  // Emit events (for TF-IDF sync)
  this.eventEmitter?.emit('entity:created', withTimestamps);

  return withTimestamps;
}
```

---

## Entity Operations

### Create Entities Flow

```
createEntities(entities)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATION                                                │
│    BatchCreateEntitiesSchema.safeParse(entities)            │
│    └── Validates: name, entityType, observations, tags      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD GRAPH                                                │
│    storage.loadGraph()                                       │
│    └── Returns cached or loads from disk                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. FILTER DUPLICATES                                         │
│    entities.filter(e => !exists(e.name))                    │
│    └── Skip entities that already exist                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. TRANSFORM ENTITIES                                        │
│    For each entity:                                          │
│    ├── Add timestamps (createdAt, lastModified)              │
│    ├── Normalize tags to lowercase                           │
│    └── Validate importance (0-10)                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST                                                   │
│    graph.entities.push(...newEntities)                       │
│    storage.saveGraph(graph)                                  │
│    └── Writes to disk, invalidates cache                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. EMIT EVENTS                                               │
│    eventEmitter.emit('entity:created', newEntities)         │
│    └── Triggers TF-IDF index update                          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity[]
```

### Delete Entities Flow

```
deleteEntities(entityNames)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
│    storage.loadGraph()                                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. REMOVE ENTITIES                                           │
│    graph.entities = entities.filter(e => !toDelete(e.name)) │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. REMOVE ORPHANED RELATIONS                                 │
│    graph.relations = relations.filter(r =>                   │
│      !toDelete(r.from) && !toDelete(r.to))                   │
│    └── Cascading delete of related relations                 │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. EMIT EVENTS                                               │
│    eventEmitter.emit('entity:deleted', entityNames)         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: void
```

### Add Observations Flow

```
addObservations([{ entityName, contents }])
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FOR EACH OBSERVATION REQUEST                              │
│    ├── Find entity by name (throw if not found)              │
│    ├── Filter out duplicate observations                     │
│    ├── Push new observations to entity.observations          │
│    └── Update entity.lastModified                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PERSIST (single write for all updates)                    │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: { entityName, addedObservations }[]
```

---

## Relation Operations

### Create Relations Flow

```
createRelations(relations)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATION                                                │
│    BatchCreateRelationsSchema.safeParse(relations)          │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. FILTER DUPLICATES                                         │
│    Check for existing (from, to, relationType) combinations │
│    └── Note: Deferred integrity - entities may not exist     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ADD TIMESTAMPS                                            │
│    For each relation:                                        │
│    ├── Add createdAt                                         │
│    └── Add lastModified                                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST                                                   │
│    graph.relations.push(...newRelations)                     │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Relation[]
```

---

## Search Operations

### Basic Search Flow

```
search(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
│    storage.loadGraph() → cached if available                 │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TEXT MATCHING                                             │
│    For each entity:                                          │
│    ├── Match query against entity.name (case-insensitive)    │
│    ├── Match query against entity.entityType                 │
│    └── Match query against each observation                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. APPLY FILTERS (SearchFilterChain)                         │
│    SearchFilterChain.applyFilters(matches, {                 │
│      tags, minImportance, maxImportance                      │
│    })                                                        │
│    ├── Filter by tags (any match)                            │
│    └── Filter by importance range                            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. COLLECT RELATIONS                                         │
│    Find relations where from OR to matches filtered entities │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph { entities, relations }
```

### Ranked Search Flow (TF-IDF)

```
searchRanked(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD & FILTER                                             │
│    Load graph, apply SearchFilterChain filters               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUILD DOCUMENT CORPUS                                     │
│    For each entity, create searchable document:              │
│    document = name + ' ' + entityType + ' ' + observations   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. TOKENIZE QUERY                                            │
│    queryTerms = query.toLowerCase().split(/\s+/)            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CALCULATE TF-IDF SCORES                                   │
│    For each entity:                                          │
│    ├── For each query term:                                  │
│    │   ├── TF = term frequency in document                   │
│    │   ├── IDF = log(N / docs containing term)               │
│    │   └── score += TF × IDF                                 │
│    └── Total score = sum of term scores                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. SORT & LIMIT                                              │
│    results.sort((a, b) => b.score - a.score)                │
│    results.slice(0, limit)                                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: SearchResult[] { entity, score, matchedFields }
```

### Boolean Search Flow

```
booleanSearch("name:Alice AND (type:person OR observation:engineer)")
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. TOKENIZE QUERY                                            │
│    Tokens: ['name:Alice', 'AND', '(', 'type:person', 'OR',  │
│             'observation:engineer', ')']                     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PARSE TO AST                                              │
│    BooleanQueryNode tree:                                    │
│    AND                                                       │
│    ├── FIELD(name, Alice)                                    │
│    └── OR                                                    │
│        ├── FIELD(type, person)                               │
│        └── FIELD(observation, engineer)                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. EVALUATE AST                                              │
│    For each entity:                                          │
│    ├── Recursively evaluate AST nodes                        │
│    ├── AND: all children must match                          │
│    ├── OR: any child must match                              │
│    ├── NOT: child must not match                             │
│    └── FIELD: check specific field contains value            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. APPLY FILTERS & COLLECT RELATIONS                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph
```

### Fuzzy Search Flow

```
fuzzySearch(query, threshold=0.7)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD & FILTER                                             │
│    Load graph, apply tag/importance filters                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CALCULATE SIMILARITIES (worker pool)                      │
│    For each entity:                                          │
│    ├── For each searchable field (name, type, observations): │
│    │   ├── distance = levenshteinDistance(query, field)     │
│    │   ├── maxLen = max(query.length, field.length)         │
│    │   └── similarity = 1 - (distance / maxLen)             │
│    └── Match if any similarity >= threshold                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. COLLECT MATCHES & RELATIONS                               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: KnowledgeGraph
```

### Hybrid Search Flow

```
hybridSearch(query, options)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PARALLEL SEARCH EXECUTION                                 │
│    ├── Semantic: Vector similarity (embeddings)              │
│    ├── Lexical: TF-IDF/BM25 text matching                   │
│    └── Symbolic: Metadata filtering (tags, importance)       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SCORE FUSION                                              │
│    For each result:                                          │
│    finalScore = (semantic × 0.4) + (lexical × 0.4) +        │
│                 (symbolic × 0.2)                             │
│    └── Weights configurable via options                      │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RANK & RETURN                                             │
│    Sort by finalScore, apply limit                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: HybridSearchResult
```

---

## Hierarchy Operations

### Set Parent Flow

```
setEntityParent(entityName, parentName)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. VALIDATE ENTITY EXISTS                                    │
│    if (!entity) throw EntityNotFoundError                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. VALIDATE PARENT EXISTS (if not null)                      │
│    if (parentName && !parent) throw EntityNotFoundError     │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CYCLE DETECTION                                           │
│    wouldCreateCycle(graph, entityName, parentName):         │
│    ├── Start at parentName                                   │
│    ├── Walk up parent chain                                  │
│    ├── If we reach entityName → cycle detected              │
│    └── If we reach root (no parent) → no cycle              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. UPDATE ENTITY                                             │
│    entity.parentId = parentName || undefined                 │
│    entity.lastModified = timestamp                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity
```

### Get Descendants Flow (Recursive)

```
getDescendants(entityName)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH & FIND ENTITY                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RECURSIVE TRAVERSAL                                       │
│    function collectDescendants(name):                        │
│    ├── children = entities.filter(e => e.parentId === name) │
│    ├── For each child:                                       │
│    │   ├── Add child to results                              │
│    │   └── results.push(...collectDescendants(child.name))   │
│    └── Return results                                        │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity[] (all descendants, depth-first)
```

---

## Compression Operations

### Find Duplicates Flow

```
findDuplicates(threshold=0.8)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. LOAD GRAPH                                                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUCKET BY TYPE (Optimization)                             │
│    buckets = Map<entityType, Entity[]>                       │
│    └── Only compare entities of same type                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PAIRWISE SIMILARITY (within buckets)                      │
│    For each bucket:                                          │
│    ├── For each pair (e1, e2):                               │
│    │   └── similarity = calculateEntitySimilarity(e1, e2)   │
│    └── If similarity >= threshold → add to duplicate group   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SIMILARITY CALCULATION                                    │
│    score = (nameSim × 0.4) + (typeSim × 0.3)                │
│          + (obsSim × 0.2) + (tagSim × 0.1)                  │
│    ├── nameSim: 1 - levenshtein/maxLen                       │
│    ├── typeSim: 1 if exact match, 0 otherwise               │
│    ├── obsSim: Jaccard(observations1, observations2)         │
│    └── tagSim: Jaccard(tags1, tags2)                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: string[][] (groups of duplicate entity names)
```

### Merge Entities Flow

```
mergeEntities(entityNames, targetName?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. VALIDATE                                                  │
│    if (entityNames.length < 2) throw InsufficientEntities   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOAD & FIND ENTITIES                                      │
│    entities = entityNames.map(name => findEntity(name))     │
│    if (any missing) throw EntityNotFoundError               │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CREATE MERGED ENTITY                                      │
│    merged = {                                                │
│      name: targetName || entityNames[0],                     │
│      entityType: first.entityType,                           │
│      observations: unique(all observations),                 │
│      tags: unique(all tags),                                 │
│      importance: max(all importances),                       │
│      createdAt: earliest createdAt,                          │
│      lastModified: now()                                     │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. TRANSFER RELATIONS                                        │
│    For each relation involving merged entities:              │
│    ├── Update 'from' to point to merged entity              │
│    └── Update 'to' to point to merged entity                │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. REMOVE ORIGINAL ENTITIES                                  │
│    graph.entities = entities.filter(e =>                     │
│      !entityNames.includes(e.name) || e.name === merged.name │
│    )                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. PERSIST                                                   │
│    storage.saveGraph(graph)                                  │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: Entity (merged entity)
```

---

## Import/Export Operations

### Export Flow

```
exportGraph(format, options?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. GET GRAPH DATA                                            │
│    if (options.filter) {                                     │
│      graph = searchByDateRange(filter params)                │
│    } else {                                                  │
│      graph = loadGraph()                                     │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FORMAT CONVERSION                                         │
│    switch (format):                                          │
│    ├── 'json'     → JSON.stringify(graph, null, 2)          │
│    ├── 'csv'      → entities CSV + relations CSV             │
│    ├── 'graphml'  → XML graph format                         │
│    ├── 'gexf'     → Gephi exchange format                    │
│    ├── 'dot'      → Graphviz DOT                             │
│    ├── 'markdown' → Human-readable MD                        │
│    └── 'mermaid'  → Mermaid diagram syntax                   │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. OPTIONAL COMPRESSION                                      │
│    if (options.compress) {                                   │
│      content = brotliCompress(content)                      │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: string (formatted export)
```

### Import Flow

```
importGraph(format, data, options?)
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PARSE INPUT                                               │
│    switch (format):                                          │
│    ├── 'json'    → JSON.parse(data)                         │
│    ├── 'csv'     → parseCSV(data)                           │
│    └── 'graphml' → parseXML(data)                           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. VALIDATE PARSED DATA                                      │
│    Validate entities and relations against schemas           │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LOAD EXISTING GRAPH                                       │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. APPLY MERGE STRATEGY                                      │
│    For each imported entity:                                 │
│    ├── 'replace' → overwrite if exists                      │
│    ├── 'skip'    → ignore if exists                         │
│    ├── 'merge'   → combine observations/tags                │
│    └── 'fail'    → error if any conflict                    │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. PERSIST (unless dryRun)                                   │
│    if (!dryRun) storage.saveGraph(mergedGraph)              │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
   Return: ImportResult {
     entitiesCreated, entitiesUpdated, entitiesSkipped,
     relationsCreated, relationsSkipped, errors
   }
```

---

## Caching Strategy

### GraphStorage Cache Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     loadGraph()                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │  cache !== null ?     │
              └───────────┬───────────┘
                    ╱           ╲
                 YES              NO
                  │                │
                  ▼                ▼
         ┌────────────────┐  ┌────────────────────┐
         │ Return deep    │  │ Read from disk     │
         │ copy of cache  │  │ Parse JSONL        │
         └────────────────┘  │ Populate cache     │
                             │ Return deep copy   │
                             └────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     saveGraph()                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Write to disk         │
              │ (JSONL format)        │
              └───────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │ Invalidate cache      │
              │ cache = null          │
              └───────────────────────┘
```

### Cache Characteristics

| Aspect | Behavior |
|--------|----------|
| Cache Population | On first `loadGraph()` call |
| Cache Invalidation | On every `saveGraph()` call |
| Deep Copy | Always returns deep copy (prevents mutation) |
| Memory Impact | Full graph held in memory |

---

## Error Handling Flow

### Error Propagation

```
┌─────────────────────────────────────────────────────────────┐
│ Manager Layer Errors                                         │
│ ├── ValidationError (invalid input)                          │
│ ├── EntityNotFoundError (missing entity)                     │
│ ├── InvalidImportanceError (out of range)                    │
│ ├── CycleDetectedError (hierarchy cycle)                     │
│ └── InsufficientEntitiesError (merge < 2)                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Error propagates to application                              │
│ Application handles or re-throws                             │
└─────────────────────────────────────────────────────────────┘
```

### Validation Error Details

```typescript
// Zod validation provides detailed error paths
{
  "errors": [
    "entities.0.name: Required",
    "entities.0.entityType: String must contain at least 1 character",
    "entities.2.importance: Number must be less than or equal to 10"
  ]
}
```

---

## I/O Optimization Summary

| Operation | Read Ops | Write Ops | Total I/O |
|-----------|----------|-----------|-----------|
| create_entities (batch) | 1 | 1 | 2 |
| delete_entities | 1 | 1 | 2 |
| add_observations (batch) | 1 | 1 | 2 |
| search | 1 (cached) | 0 | 1 |
| search_ranked | 1 (cached) | 0 | 1 |
| find_duplicates | 1 (cached) | 0 | 1 |
| merge_entities | 1 | 1 | 2 |
| export_graph | 1 (cached) | 0 | 1 |
| import_graph | 1 | 1 | 2 |

**Key Optimization**: Batch operations use single read/write cycle regardless of batch size.

---

**Document Version**: 1.0
**Last Updated**: 2026-01-10
**Maintained By**: Daniel Simon Jr.
