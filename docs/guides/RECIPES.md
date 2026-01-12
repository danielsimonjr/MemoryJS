# MemoryJS Recipes

> Ready-to-use code patterns and solutions for common tasks

## Table of Contents

1. [Entity Recipes](#entity-recipes)
2. [Relation Recipes](#relation-recipes)
3. [Search Recipes](#search-recipes)
4. [Batch Operations](#batch-operations)
5. [Import/Export Recipes](#importexport-recipes)
6. [Hierarchy Patterns](#hierarchy-patterns)
7. [Tagging Patterns](#tagging-patterns)
8. [Analytics Recipes](#analytics-recipes)
9. [Caching Strategies](#caching-strategies)
10. [Error Handling Patterns](#error-handling-patterns)

---

## Entity Recipes

### Create Entity with Full Metadata

```typescript
import { ManagerContext } from 'memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

// Full entity with all optional fields
const entity = await ctx.entityManager.createEntity(
  'project-alpha',           // name (unique)
  'Project',                 // entityType
  [                          // observations
    'Started Q1 2024',
    'Budget: $50,000',
    'Team size: 5 developers'
  ],
  {
    parentId: 'department-engineering',
    tags: ['active', 'high-priority', 'q1-2024'],
    importance: 8
  }
);
```

### Find or Create Pattern

```typescript
async function findOrCreate(
  ctx: ManagerContext,
  name: string,
  entityType: string,
  defaultObservations: string[] = []
): Promise<Entity> {
  const existing = await ctx.entityManager.getEntityByName(name);

  if (existing) {
    return existing;
  }

  return ctx.entityManager.createEntity(name, entityType, defaultObservations);
}

// Usage
const user = await findOrCreate(ctx, 'john-doe', 'User', ['New user']);
```

### Upsert Entity Pattern

```typescript
async function upsertEntity(
  ctx: ManagerContext,
  name: string,
  entityType: string,
  observations: string[],
  options: { tags?: string[]; importance?: number } = {}
): Promise<Entity> {
  const existing = await ctx.entityManager.getEntityByName(name);

  if (existing) {
    // Add new observations (deduplication handled automatically)
    for (const obs of observations) {
      await ctx.observationManager.addObservation(name, obs);
    }

    // Update tags if provided
    if (options.tags) {
      const newTags = [...new Set([...existing.tags, ...options.tags])];
      await ctx.entityManager.updateEntity(name, { tags: newTags });
    }

    // Update importance if higher
    if (options.importance && options.importance > existing.importance) {
      await ctx.entityManager.updateEntity(name, { importance: options.importance });
    }

    return ctx.entityManager.getEntityByName(name);
  }

  return ctx.entityManager.createEntity(name, entityType, observations, options);
}
```

### Clone Entity

```typescript
async function cloneEntity(
  ctx: ManagerContext,
  sourceName: string,
  newName: string
): Promise<Entity> {
  const source = await ctx.entityManager.getEntityByName(sourceName);
  if (!source) {
    throw new Error(`Entity '${sourceName}' not found`);
  }

  return ctx.entityManager.createEntity(
    newName,
    source.entityType,
    [...source.observations],
    {
      parentId: source.parentId,
      tags: [...source.tags],
      importance: source.importance
    }
  );
}
```

### Archive Old Entities

```typescript
async function archiveOldEntities(
  ctx: ManagerContext,
  daysOld: number,
  archiveTag: string = 'archived'
): Promise<string[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const allEntities = await ctx.entityManager.getAllEntities();
  const archived: string[] = [];

  for (const entity of allEntities) {
    const lastUpdated = new Date(entity.updatedAt || entity.createdAt);

    if (lastUpdated < cutoffDate && !entity.tags.includes(archiveTag)) {
      await ctx.entityManager.updateEntity(entity.name, {
        tags: [...entity.tags, archiveTag]
      });
      archived.push(entity.name);
    }
  }

  return archived;
}

// Usage: Archive entities not updated in 90 days
const archivedNames = await archiveOldEntities(ctx, 90);
console.log(`Archived ${archivedNames.length} entities`);
```

---

## Relation Recipes

### Create Bidirectional Relation

```typescript
async function createBidirectionalRelation(
  ctx: ManagerContext,
  entityA: string,
  entityB: string,
  relationTypeAB: string,
  relationTypeBA: string
): Promise<[Relation, Relation]> {
  const relAB = await ctx.relationManager.createRelation(
    entityA,
    entityB,
    relationTypeAB
  );

  const relBA = await ctx.relationManager.createRelation(
    entityB,
    entityA,
    relationTypeBA
  );

  return [relAB, relBA];
}

// Usage
const [friendship1, friendship2] = await createBidirectionalRelation(
  ctx,
  'alice',
  'bob',
  'friend_of',
  'friend_of'
);
```

### Get Entity Neighbors

```typescript
async function getNeighbors(
  ctx: ManagerContext,
  entityName: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both'
): Promise<{ outgoing: Entity[]; incoming: Entity[] }> {
  const outgoing: Entity[] = [];
  const incoming: Entity[] = [];

  if (direction === 'outgoing' || direction === 'both') {
    const outRels = await ctx.relationManager.getRelationsFrom(entityName);
    for (const rel of outRels) {
      const entity = await ctx.entityManager.getEntityByName(rel.to);
      if (entity) outgoing.push(entity);
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const inRels = await ctx.relationManager.getRelationsTo(entityName);
    for (const rel of inRels) {
      const entity = await ctx.entityManager.getEntityByName(rel.from);
      if (entity) incoming.push(entity);
    }
  }

  return { outgoing, incoming };
}
```

### Find Relation Chain

```typescript
async function findRelationChain(
  ctx: ManagerContext,
  start: string,
  end: string,
  maxDepth: number = 5
): Promise<string[] | null> {
  const visited = new Set<string>();
  const queue: { node: string; path: string[] }[] = [
    { node: start, path: [start] }
  ];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;

    if (path.length > maxDepth) continue;
    if (node === end) return path;
    if (visited.has(node)) continue;

    visited.add(node);

    const relations = await ctx.relationManager.getRelationsFrom(node);
    for (const rel of relations) {
      if (!visited.has(rel.to)) {
        queue.push({ node: rel.to, path: [...path, rel.to] });
      }
    }
  }

  return null;
}

// Usage
const path = await findRelationChain(ctx, 'alice', 'david');
// Returns: ['alice', 'bob', 'charlie', 'david'] or null
```

### Delete Orphaned Relations

```typescript
async function deleteOrphanedRelations(ctx: ManagerContext): Promise<number> {
  const allRelations = await ctx.relationManager.getAllRelations();
  const allEntityNames = new Set(
    (await ctx.entityManager.getAllEntities()).map(e => e.name)
  );

  let deleted = 0;

  for (const relation of allRelations) {
    if (!allEntityNames.has(relation.from) || !allEntityNames.has(relation.to)) {
      await ctx.relationManager.deleteRelation(
        relation.from,
        relation.to,
        relation.relationType
      );
      deleted++;
    }
  }

  return deleted;
}
```

---

## Search Recipes

### Multi-Strategy Search

```typescript
interface SearchResult {
  entity: Entity;
  score: number;
  matchType: 'exact' | 'fuzzy' | 'semantic' | 'ranked';
}

async function multiStrategySearch(
  ctx: ManagerContext,
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // 1. Exact match (highest priority)
  const exact = await ctx.entityManager.getEntityByName(query);
  if (exact) {
    results.push({ entity: exact, score: 1.0, matchType: 'exact' });
    seen.add(exact.name);
  }

  // 2. Ranked search (TF-IDF)
  const ranked = await ctx.searchManager.rankedSearch(query, limit);
  for (const item of ranked) {
    if (!seen.has(item.entity.name)) {
      results.push({ entity: item.entity, score: item.score * 0.8, matchType: 'ranked' });
      seen.add(item.entity.name);
    }
  }

  // 3. Fuzzy search for typo tolerance
  if (results.length < limit) {
    const fuzzy = await ctx.searchManager.fuzzySearch(query, limit, 2);
    for (const item of fuzzy) {
      if (!seen.has(item.entity.name)) {
        results.push({ entity: item.entity, score: item.score * 0.6, matchType: 'fuzzy' });
        seen.add(item.entity.name);
      }
    }
  }

  // Sort by score and limit
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
```

### Search with Filters

```typescript
interface SearchFilters {
  entityTypes?: string[];
  tags?: string[];
  minImportance?: number;
  parentId?: string;
  createdAfter?: Date;
}

async function filteredSearch(
  ctx: ManagerContext,
  query: string,
  filters: SearchFilters,
  limit: number = 20
): Promise<Entity[]> {
  // Get initial results (fetch more to account for filtering)
  const results = await ctx.searchManager.rankedSearch(query, limit * 3);

  return results
    .map(r => r.entity)
    .filter(entity => {
      // Entity type filter
      if (filters.entityTypes?.length &&
          !filters.entityTypes.includes(entity.entityType)) {
        return false;
      }

      // Tags filter (must have all specified tags)
      if (filters.tags?.length &&
          !filters.tags.every(tag => entity.tags.includes(tag))) {
        return false;
      }

      // Importance filter
      if (filters.minImportance !== undefined &&
          entity.importance < filters.minImportance) {
        return false;
      }

      // Parent filter
      if (filters.parentId && entity.parentId !== filters.parentId) {
        return false;
      }

      // Date filter
      if (filters.createdAfter &&
          new Date(entity.createdAt) < filters.createdAfter) {
        return false;
      }

      return true;
    })
    .slice(0, limit);
}

// Usage
const results = await filteredSearch(ctx, 'machine learning', {
  entityTypes: ['Article', 'Paper'],
  tags: ['ai'],
  minImportance: 5,
  createdAfter: new Date('2024-01-01')
});
```

### Boolean Query Builder

```typescript
class QueryBuilder {
  private parts: string[] = [];

  must(term: string): this {
    this.parts.push(term);
    return this;
  }

  should(term: string): this {
    if (this.parts.length > 0) {
      this.parts.push('OR');
    }
    this.parts.push(term);
    return this;
  }

  not(term: string): this {
    this.parts.push(`NOT ${term}`);
    return this;
  }

  group(builder: QueryBuilder): this {
    this.parts.push(`(${builder.build()})`);
    return this;
  }

  build(): string {
    return this.parts.join(' AND ');
  }
}

// Usage
const query = new QueryBuilder()
  .must('typescript')
  .must('api')
  .not('deprecated')
  .build();
// Result: "typescript AND api AND NOT deprecated"

const results = await ctx.searchManager.booleanSearch(query);
```

### Contextual Search (RAG-style)

```typescript
interface ContextualResult {
  entity: Entity;
  relevantObservations: string[];
  context: string;
}

async function contextualSearch(
  ctx: ManagerContext,
  query: string,
  maxResults: number = 5,
  contextWindow: number = 3
): Promise<ContextualResult[]> {
  const results = await ctx.searchManager.rankedSearch(query, maxResults);

  return results.map(result => {
    const entity = result.entity;

    // Score observations by relevance to query
    const scoredObs = entity.observations.map(obs => ({
      text: obs,
      score: calculateRelevance(obs, query)
    }));

    // Sort by relevance
    scoredObs.sort((a, b) => b.score - a.score);

    // Take top observations
    const relevantObservations = scoredObs
      .slice(0, contextWindow)
      .map(o => o.text);

    // Build context string
    const context = [
      `Entity: ${entity.name} (${entity.entityType})`,
      `Key facts:`,
      ...relevantObservations.map(o => `- ${o}`)
    ].join('\n');

    return { entity, relevantObservations, context };
  });
}

function calculateRelevance(text: string, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const textLower = text.toLowerCase();

  let matches = 0;
  for (const term of queryTerms) {
    if (textLower.includes(term)) matches++;
  }

  return matches / queryTerms.length;
}
```

---

## Batch Operations

### Batch Create Entities

```typescript
interface EntityInput {
  name: string;
  entityType: string;
  observations: string[];
  tags?: string[];
  importance?: number;
}

async function batchCreateEntities(
  ctx: ManagerContext,
  entities: EntityInput[],
  batchSize: number = 100
): Promise<{ created: number; errors: Array<{ name: string; error: string }> }> {
  const errors: Array<{ name: string; error: string }> = [];
  let created = 0;

  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (input) => {
        try {
          await ctx.entityManager.createEntity(
            input.name,
            input.entityType,
            input.observations,
            { tags: input.tags, importance: input.importance }
          );
          created++;
        } catch (error) {
          errors.push({
            name: input.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })
    );
  }

  return { created, errors };
}
```

### Batch Update Tags

```typescript
async function batchAddTag(
  ctx: ManagerContext,
  entityNames: string[],
  tag: string
): Promise<number> {
  let updated = 0;

  for (const name of entityNames) {
    const entity = await ctx.entityManager.getEntityByName(name);
    if (entity && !entity.tags.includes(tag)) {
      await ctx.entityManager.updateEntity(name, {
        tags: [...entity.tags, tag]
      });
      updated++;
    }
  }

  return updated;
}

async function batchRemoveTag(
  ctx: ManagerContext,
  entityNames: string[],
  tag: string
): Promise<number> {
  let updated = 0;

  for (const name of entityNames) {
    const entity = await ctx.entityManager.getEntityByName(name);
    if (entity && entity.tags.includes(tag)) {
      await ctx.entityManager.updateEntity(name, {
        tags: entity.tags.filter(t => t !== tag)
      });
      updated++;
    }
  }

  return updated;
}
```

### Batch Delete with Cascade

```typescript
async function batchDeleteWithCascade(
  ctx: ManagerContext,
  entityNames: string[]
): Promise<{ deleted: number; relationsRemoved: number }> {
  let deleted = 0;
  let relationsRemoved = 0;

  for (const name of entityNames) {
    // Remove all relations first
    const fromRels = await ctx.relationManager.getRelationsFrom(name);
    const toRels = await ctx.relationManager.getRelationsTo(name);

    for (const rel of fromRels) {
      await ctx.relationManager.deleteRelation(rel.from, rel.to, rel.relationType);
      relationsRemoved++;
    }

    for (const rel of toRels) {
      await ctx.relationManager.deleteRelation(rel.from, rel.to, rel.relationType);
      relationsRemoved++;
    }

    // Delete entity
    await ctx.entityManager.deleteEntity(name);
    deleted++;
  }

  return { deleted, relationsRemoved };
}
```

---

## Import/Export Recipes

### Export to Markdown

```typescript
async function exportToMarkdown(
  ctx: ManagerContext,
  entityType?: string
): Promise<string> {
  let entities = await ctx.entityManager.getAllEntities();

  if (entityType) {
    entities = entities.filter(e => e.entityType === entityType);
  }

  const lines: string[] = [
    '# Knowledge Graph Export',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total Entities: ${entities.length}`,
    '',
    '---',
    ''
  ];

  // Group by type
  const byType = new Map<string, Entity[]>();
  for (const entity of entities) {
    const list = byType.get(entity.entityType) || [];
    list.push(entity);
    byType.set(entity.entityType, list);
  }

  for (const [type, typeEntities] of byType) {
    lines.push(`## ${type}`);
    lines.push('');

    for (const entity of typeEntities) {
      lines.push(`### ${entity.name}`);
      lines.push('');

      if (entity.tags.length > 0) {
        lines.push(`**Tags:** ${entity.tags.join(', ')}`);
      }

      if (entity.importance > 0) {
        lines.push(`**Importance:** ${entity.importance}/10`);
      }

      lines.push('');
      lines.push('**Observations:**');
      for (const obs of entity.observations) {
        lines.push(`- ${obs}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
```

### Import from CSV

```typescript
async function importFromCSV(
  ctx: ManagerContext,
  csvContent: string,
  columnMap: {
    name: number;
    entityType: number;
    observations?: number;
    tags?: number;
  }
): Promise<{ imported: number; skipped: number }> {
  const lines = csvContent.split('\n').slice(1); // Skip header
  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    const columns = parseCSVLine(line);
    const name = columns[columnMap.name]?.trim();
    const entityType = columns[columnMap.entityType]?.trim();

    if (!name || !entityType) {
      skipped++;
      continue;
    }

    // Check if exists
    const existing = await ctx.entityManager.getEntityByName(name);
    if (existing) {
      skipped++;
      continue;
    }

    const observations = columnMap.observations !== undefined
      ? columns[columnMap.observations]?.split(';').map(s => s.trim()).filter(Boolean)
      : [];

    const tags = columnMap.tags !== undefined
      ? columns[columnMap.tags]?.split(';').map(s => s.trim()).filter(Boolean)
      : [];

    await ctx.entityManager.createEntity(name, entityType, observations, { tags });
    imported++;
  }

  return { imported, skipped };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}
```

### Sync Between Instances

```typescript
async function syncGraphs(
  source: ManagerContext,
  target: ManagerContext,
  options: { overwrite?: boolean } = {}
): Promise<{ entities: number; relations: number }> {
  let entitiesSynced = 0;
  let relationsSynced = 0;

  // Sync entities
  const sourceEntities = await source.entityManager.getAllEntities();

  for (const entity of sourceEntities) {
    const existing = await target.entityManager.getEntityByName(entity.name);

    if (!existing) {
      await target.entityManager.createEntity(
        entity.name,
        entity.entityType,
        entity.observations,
        {
          parentId: entity.parentId,
          tags: entity.tags,
          importance: entity.importance
        }
      );
      entitiesSynced++;
    } else if (options.overwrite) {
      await target.entityManager.updateEntity(entity.name, {
        entityType: entity.entityType,
        parentId: entity.parentId,
        tags: entity.tags,
        importance: entity.importance
      });

      // Sync observations
      for (const obs of entity.observations) {
        if (!existing.observations.includes(obs)) {
          await target.observationManager.addObservation(entity.name, obs);
        }
      }
      entitiesSynced++;
    }
  }

  // Sync relations
  const sourceRelations = await source.relationManager.getAllRelations();

  for (const relation of sourceRelations) {
    const existingRels = await target.relationManager.getRelationsFrom(relation.from);
    const exists = existingRels.some(
      r => r.to === relation.to && r.relationType === relation.relationType
    );

    if (!exists) {
      try {
        await target.relationManager.createRelation(
          relation.from,
          relation.to,
          relation.relationType
        );
        relationsSynced++;
      } catch {
        // Skip if entities don't exist in target
      }
    }
  }

  return { entities: entitiesSynced, relations: relationsSynced };
}
```

---

## Hierarchy Patterns

### Build Category Tree

```typescript
interface TreeNode {
  entity: Entity;
  children: TreeNode[];
}

async function buildCategoryTree(
  ctx: ManagerContext,
  rootName?: string
): Promise<TreeNode[]> {
  const allEntities = await ctx.entityManager.getAllEntities();
  const entityMap = new Map(allEntities.map(e => [e.name, e]));
  const childrenMap = new Map<string | undefined, Entity[]>();

  // Group by parent
  for (const entity of allEntities) {
    const parentId = entity.parentId || undefined;
    const children = childrenMap.get(parentId) || [];
    children.push(entity);
    childrenMap.set(parentId, children);
  }

  // Build tree recursively
  function buildNode(entity: Entity): TreeNode {
    const children = childrenMap.get(entity.name) || [];
    return {
      entity,
      children: children.map(buildNode)
    };
  }

  // Get root nodes
  const roots = childrenMap.get(rootName) || [];
  return roots.map(buildNode);
}

// Usage
const tree = await buildCategoryTree(ctx);
```

### Flatten Hierarchy Path

```typescript
async function getHierarchyPath(
  ctx: ManagerContext,
  entityName: string
): Promise<Entity[]> {
  const path: Entity[] = [];
  let current = await ctx.entityManager.getEntityByName(entityName);

  while (current) {
    path.unshift(current);
    if (current.parentId) {
      current = await ctx.entityManager.getEntityByName(current.parentId);
    } else {
      break;
    }
  }

  return path;
}

// Usage
const path = await getHierarchyPath(ctx, 'typescript-basics');
// Returns: [Programming, Languages, TypeScript, typescript-basics]
```

### Move Entity (Reparent)

```typescript
async function moveEntity(
  ctx: ManagerContext,
  entityName: string,
  newParentId: string | null
): Promise<void> {
  // Validate new parent exists (if specified)
  if (newParentId) {
    const parent = await ctx.entityManager.getEntityByName(newParentId);
    if (!parent) {
      throw new Error(`Parent entity '${newParentId}' not found`);
    }

    // Prevent circular references
    const parentPath = await getHierarchyPath(ctx, newParentId);
    if (parentPath.some(e => e.name === entityName)) {
      throw new Error('Cannot create circular parent-child relationship');
    }
  }

  await ctx.entityManager.updateEntity(entityName, {
    parentId: newParentId || undefined
  });
}
```

### Get All Descendants

```typescript
async function getAllDescendants(
  ctx: ManagerContext,
  parentName: string
): Promise<Entity[]> {
  const descendants: Entity[] = [];
  const allEntities = await ctx.entityManager.getAllEntities();

  // Build parent-children map
  const childrenMap = new Map<string, Entity[]>();
  for (const entity of allEntities) {
    if (entity.parentId) {
      const children = childrenMap.get(entity.parentId) || [];
      children.push(entity);
      childrenMap.set(entity.parentId, children);
    }
  }

  // BFS to collect descendants
  const queue = [parentName];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) || [];

    for (const child of children) {
      descendants.push(child);
      queue.push(child.name);
    }
  }

  return descendants;
}
```

---

## Tagging Patterns

### Tag Suggestions

```typescript
async function suggestTags(
  ctx: ManagerContext,
  entityName: string,
  maxSuggestions: number = 5
): Promise<string[]> {
  const entity = await ctx.entityManager.getEntityByName(entityName);
  if (!entity) return [];

  // Get similar entities
  const searchText = [entity.name, ...entity.observations].join(' ');
  const similar = await ctx.searchManager.rankedSearch(searchText, 20);

  // Collect tags from similar entities
  const tagCounts = new Map<string, number>();

  for (const result of similar) {
    if (result.entity.name === entityName) continue;

    for (const tag of result.entity.tags) {
      if (!entity.tags.includes(tag)) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + result.score);
      }
    }
  }

  // Sort by weighted frequency
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSuggestions)
    .map(([tag]) => tag);
}
```

### Tag Cloud Generation

```typescript
interface TagCloudItem {
  tag: string;
  count: number;
  weight: number; // 1-10 scale
}

async function generateTagCloud(ctx: ManagerContext): Promise<TagCloudItem[]> {
  const allEntities = await ctx.entityManager.getAllEntities();
  const tagCounts = new Map<string, number>();

  for (const entity of allEntities) {
    for (const tag of entity.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const counts = [...tagCounts.values()];
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const range = maxCount - minCount || 1;

  return [...tagCounts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      weight: Math.ceil(((count - minCount) / range) * 9) + 1
    }))
    .sort((a, b) => b.count - a.count);
}
```

### Auto-Tag Based on Content

```typescript
const TAG_RULES: Array<{
  pattern: RegExp;
  tag: string;
}> = [
  { pattern: /typescript|javascript|nodejs/i, tag: 'programming' },
  { pattern: /api|rest|graphql/i, tag: 'api' },
  { pattern: /database|sql|mongodb/i, tag: 'database' },
  { pattern: /security|auth|encryption/i, tag: 'security' },
  { pattern: /test|spec|coverage/i, tag: 'testing' },
  { pattern: /deploy|ci\/cd|docker|kubernetes/i, tag: 'devops' },
];

async function autoTagEntity(
  ctx: ManagerContext,
  entityName: string
): Promise<string[]> {
  const entity = await ctx.entityManager.getEntityByName(entityName);
  if (!entity) return [];

  const content = [entity.name, ...entity.observations].join(' ');
  const newTags: string[] = [];

  for (const rule of TAG_RULES) {
    if (rule.pattern.test(content) && !entity.tags.includes(rule.tag)) {
      newTags.push(rule.tag);
    }
  }

  if (newTags.length > 0) {
    await ctx.entityManager.updateEntity(entityName, {
      tags: [...entity.tags, ...newTags]
    });
  }

  return newTags;
}
```

---

## Analytics Recipes

### Generate Graph Statistics

```typescript
interface GraphStats {
  totalEntities: number;
  totalRelations: number;
  totalObservations: number;
  entitiesByType: Record<string, number>;
  avgObservationsPerEntity: number;
  avgRelationsPerEntity: number;
  topTags: Array<{ tag: string; count: number }>;
  orphanedEntities: number;
}

async function getGraphStatistics(ctx: ManagerContext): Promise<GraphStats> {
  const entities = await ctx.entityManager.getAllEntities();
  const relations = await ctx.relationManager.getAllRelations();

  // Count by type
  const entitiesByType: Record<string, number> = {};
  let totalObservations = 0;
  const tagCounts = new Map<string, number>();

  for (const entity of entities) {
    entitiesByType[entity.entityType] =
      (entitiesByType[entity.entityType] || 0) + 1;
    totalObservations += entity.observations.length;

    for (const tag of entity.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  // Find orphaned entities (no relations)
  const connectedEntities = new Set<string>();
  for (const rel of relations) {
    connectedEntities.add(rel.from);
    connectedEntities.add(rel.to);
  }
  const orphanedEntities = entities.filter(e => !connectedEntities.has(e.name)).length;

  // Top tags
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    totalEntities: entities.length,
    totalRelations: relations.length,
    totalObservations,
    entitiesByType,
    avgObservationsPerEntity: totalObservations / entities.length || 0,
    avgRelationsPerEntity: relations.length / entities.length || 0,
    topTags,
    orphanedEntities
  };
}
```

### Entity Activity Timeline

```typescript
interface ActivityItem {
  date: string;
  entityName: string;
  action: 'created' | 'updated';
}

async function getActivityTimeline(
  ctx: ManagerContext,
  days: number = 30
): Promise<ActivityItem[]> {
  const entities = await ctx.entityManager.getAllEntities();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const activities: ActivityItem[] = [];

  for (const entity of entities) {
    const created = new Date(entity.createdAt);
    const updated = entity.updatedAt ? new Date(entity.updatedAt) : null;

    if (created >= cutoff) {
      activities.push({
        date: entity.createdAt,
        entityName: entity.name,
        action: 'created'
      });
    }

    if (updated && updated >= cutoff && updated.getTime() !== created.getTime()) {
      activities.push({
        date: entity.updatedAt!,
        entityName: entity.name,
        action: 'updated'
      });
    }
  }

  return activities.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}
```

### Knowledge Gap Analysis

```typescript
interface KnowledgeGap {
  entityType: string;
  averageObservations: number;
  entitiesWithFewObservations: string[];
  suggestedAction: string;
}

async function analyzeKnowledgeGaps(
  ctx: ManagerContext,
  minObservations: number = 3
): Promise<KnowledgeGap[]> {
  const entities = await ctx.entityManager.getAllEntities();

  // Group by type
  const byType = new Map<string, Entity[]>();
  for (const entity of entities) {
    const list = byType.get(entity.entityType) || [];
    list.push(entity);
    byType.set(entity.entityType, list);
  }

  const gaps: KnowledgeGap[] = [];

  for (const [type, typeEntities] of byType) {
    const totalObs = typeEntities.reduce(
      (sum, e) => sum + e.observations.length,
      0
    );
    const avgObs = totalObs / typeEntities.length;

    const sparse = typeEntities
      .filter(e => e.observations.length < minObservations)
      .map(e => e.name);

    if (sparse.length > 0) {
      gaps.push({
        entityType: type,
        averageObservations: avgObs,
        entitiesWithFewObservations: sparse.slice(0, 10),
        suggestedAction: avgObs < minObservations
          ? `Add more observations to ${type} entities (avg: ${avgObs.toFixed(1)})`
          : `${sparse.length} ${type} entities need more details`
      });
    }
  }

  return gaps.sort((a, b) =>
    b.entitiesWithFewObservations.length - a.entitiesWithFewObservations.length
  );
}
```

---

## Caching Strategies

### Query Result Caching

```typescript
import { LRUCache } from 'memoryjs/utils';

class CachedSearchManager {
  private cache: LRUCache<string, any>;
  private ctx: ManagerContext;

  constructor(ctx: ManagerContext, maxSize: number = 100) {
    this.ctx = ctx;
    this.cache = new LRUCache<string, any>(maxSize);
  }

  private cacheKey(method: string, ...args: any[]): string {
    return `${method}:${JSON.stringify(args)}`;
  }

  async rankedSearch(query: string, limit: number = 10) {
    const key = this.cacheKey('ranked', query, limit);

    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.ctx.searchManager.rankedSearch(query, limit);
    this.cache.set(key, result);

    return result;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
```

### Prewarming Cache

```typescript
async function prewarmSearchCache(
  ctx: ManagerContext,
  commonQueries: string[]
): Promise<void> {
  console.log(`Prewarming cache with ${commonQueries.length} queries...`);

  for (const query of commonQueries) {
    await ctx.searchManager.rankedSearch(query, 20);
  }

  console.log('Cache prewarming complete');
}

// Usage at startup
await prewarmSearchCache(ctx, [
  'user preferences',
  'recent activities',
  'important tasks',
  'project status'
]);
```

---

## Error Handling Patterns

### Graceful Degradation

```typescript
async function safeSearch(
  ctx: ManagerContext,
  query: string,
  fallbackToBasic: boolean = true
): Promise<Entity[]> {
  try {
    // Try ranked search first
    const results = await ctx.searchManager.rankedSearch(query, 20);
    return results.map(r => r.entity);
  } catch (error) {
    console.warn('Ranked search failed, trying basic search:', error);

    if (fallbackToBasic) {
      try {
        return await ctx.searchManager.basicSearch(query, 20);
      } catch (basicError) {
        console.error('Basic search also failed:', basicError);
        return [];
      }
    }

    return [];
  }
}
```

### Retry with Backoff

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Usage
const entity = await withRetry(
  () => ctx.entityManager.createEntity('test', 'Type', ['obs']),
  3,
  100
);
```

### Transaction-like Pattern

```typescript
async function atomicUpdate(
  ctx: ManagerContext,
  updates: Array<{
    entityName: string;
    changes: Partial<Entity>;
  }>
): Promise<boolean> {
  // Snapshot current state
  const snapshots = new Map<string, Entity>();

  for (const update of updates) {
    const entity = await ctx.entityManager.getEntityByName(update.entityName);
    if (entity) {
      snapshots.set(update.entityName, { ...entity });
    }
  }

  try {
    // Apply all updates
    for (const update of updates) {
      await ctx.entityManager.updateEntity(update.entityName, update.changes);
    }
    return true;
  } catch (error) {
    // Rollback on failure
    console.error('Update failed, rolling back:', error);

    for (const [name, snapshot] of snapshots) {
      try {
        await ctx.entityManager.updateEntity(name, snapshot);
      } catch (rollbackError) {
        console.error(`Rollback failed for ${name}:`, rollbackError);
      }
    }

    return false;
  }
}
```

### Validation Wrapper

```typescript
import { z } from 'zod';

const EntityInputSchema = z.object({
  name: z.string().min(1).max(255),
  entityType: z.string().min(1).max(100),
  observations: z.array(z.string().max(10000)).max(1000),
  tags: z.array(z.string().max(100)).max(100).optional(),
  importance: z.number().min(0).max(10).optional()
});

async function createEntitySafe(
  ctx: ManagerContext,
  input: unknown
): Promise<Entity> {
  const validated = EntityInputSchema.parse(input);

  return ctx.entityManager.createEntity(
    validated.name,
    validated.entityType,
    validated.observations,
    {
      tags: validated.tags,
      importance: validated.importance
    }
  );
}
```

---

## Quick Reference

### Common Operations Cheat Sheet

```typescript
// Initialize
const ctx = new ManagerContext('./memory.jsonl');

// Create
await ctx.entityManager.createEntity('name', 'Type', ['obs']);

// Read
const entity = await ctx.entityManager.getEntityByName('name');
const all = await ctx.entityManager.getAllEntities();
const byType = await ctx.entityManager.getEntitiesByType('Type');

// Update
await ctx.entityManager.updateEntity('name', { importance: 8 });
await ctx.observationManager.addObservation('name', 'new obs');

// Delete
await ctx.entityManager.deleteEntity('name');
await ctx.observationManager.removeObservation('name', 'old obs');

// Relations
await ctx.relationManager.createRelation('a', 'b', 'relates_to');
const from = await ctx.relationManager.getRelationsFrom('a');
const to = await ctx.relationManager.getRelationsTo('b');

// Search
const basic = await ctx.searchManager.basicSearch('query');
const ranked = await ctx.searchManager.rankedSearch('query', 10);
const fuzzy = await ctx.searchManager.fuzzySearch('qeury', 10, 2);
const bool = await ctx.searchManager.booleanSearch('A AND B NOT C');

// Export/Import
await ctx.ioManager.exportToJSON('/path/export.json');
await ctx.ioManager.importFromJSON('/path/import.json');
```

---

## See Also

- [API Reference](./API_REFERENCE.md) - Complete method signatures
- [Configuration](./CONFIGURATION.md) - All configuration options
- [Performance Tuning](./PERFORMANCE_TUNING.md) - Optimization strategies
- [Security Guide](./SECURITY_GUIDE.md) - Production hardening
