# MemoryJS Migration Guide

**Version**: 1.1.1
**Last Updated**: 2026-01-12

Guide for migrating between versions, storage backends, and from other knowledge graph solutions.

---

## Table of Contents

1. [Version Migration](#version-migration)
2. [Storage Backend Migration](#storage-backend-migration)
3. [Data Format Migration](#data-format-migration)
4. [Migrating from Other Solutions](#migrating-from-other-solutions)
5. [Breaking Changes Reference](#breaking-changes-reference)
6. [Migration Scripts](#migration-scripts)
7. [Rollback Procedures](#rollback-procedures)
8. [Testing Migrations](#testing-migrations)

---

## Version Migration

### Checking Current Version

```typescript
import { version } from '@danielsimonjr/memoryjs/package.json';
console.log(`Current version: ${version}`);
```

### Version Compatibility

| From Version | To Version | Migration Required | Notes |
|--------------|------------|-------------------|-------|
| 1.0.x | 1.1.x | No | Fully compatible |
| 1.1.0 | 1.1.1 | No | Security patch only |

### Upgrade Process

```bash
# 1. Backup current data
npm run backup  # or manual backup

# 2. Update package
npm update @danielsimonjr/memoryjs

# 3. Run any migration scripts (if needed)
npx memoryjs-migrate

# 4. Verify installation
npm test
```

### Pre-Upgrade Checklist

- [ ] Create full backup of data files
- [ ] Note current version number
- [ ] Review changelog for breaking changes
- [ ] Run tests on current version
- [ ] Plan rollback strategy
- [ ] Schedule maintenance window (for production)

---

## Storage Backend Migration

### JSONL to SQLite Migration

Use the built-in migration tool:

```bash
# Using the migration tool
npx tsx tools/migrate-from-jsonl-to-sqlite/index.ts \
  --input ./memory.jsonl \
  --output ./memory.db \
  --verify
```

Or programmatically:

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { GraphStorage, SQLiteStorage } from '@danielsimonjr/memoryjs';

async function migrateJSONLtoSQLite(jsonlPath: string, sqlitePath: string) {
  // 1. Load from JSONL
  const jsonlStorage = new GraphStorage(jsonlPath);
  const graph = await jsonlStorage.loadGraph();

  console.log(`Loaded ${graph.entities.length} entities, ${graph.relations.length} relations`);

  // 2. Create SQLite storage
  const sqliteStorage = new SQLiteStorage(sqlitePath);

  // 3. Save to SQLite
  await sqliteStorage.saveGraph(graph);

  // 4. Verify migration
  const verifyGraph = await sqliteStorage.loadGraph();

  if (verifyGraph.entities.length !== graph.entities.length) {
    throw new Error('Entity count mismatch after migration');
  }

  if (verifyGraph.relations.length !== graph.relations.length) {
    throw new Error('Relation count mismatch after migration');
  }

  console.log('Migration completed and verified successfully');

  return {
    entities: graph.entities.length,
    relations: graph.relations.length
  };
}

// Usage
await migrateJSONLtoSQLite('./memory.jsonl', './memory.db');
```

### SQLite to JSONL Migration

```typescript
import { GraphStorage, SQLiteStorage } from '@danielsimonjr/memoryjs';

async function migrateSQLiteToJSONL(sqlitePath: string, jsonlPath: string) {
  // 1. Load from SQLite
  const sqliteStorage = new SQLiteStorage(sqlitePath);
  const graph = await sqliteStorage.loadGraph();

  // 2. Save to JSONL
  const jsonlStorage = new GraphStorage(jsonlPath);
  await jsonlStorage.saveGraph(graph);

  // 3. Verify
  const verifyGraph = await jsonlStorage.loadGraph();

  console.log(`Migrated ${verifyGraph.entities.length} entities`);

  // 4. Close SQLite connection
  sqliteStorage.close();
}
```

### Migration with Progress Tracking

```typescript
async function migrateWithProgress(sourcePath: string, targetPath: string) {
  const sourceStorage = createStorageFromPath(sourcePath);
  const targetStorage = createStorageFromPath(targetPath);

  console.log('Loading source data...');
  const graph = await sourceStorage.loadGraph();

  console.log(`Found ${graph.entities.length} entities`);
  console.log(`Found ${graph.relations.length} relations`);

  // Batch migrate for large datasets
  const batchSize = 1000;
  const batches = Math.ceil(graph.entities.length / batchSize);

  for (let i = 0; i < batches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, graph.entities.length);
    const progress = ((i + 1) / batches * 100).toFixed(1);

    console.log(`Processing batch ${i + 1}/${batches} (${progress}%)`);

    // Process batch...
  }

  console.log('Saving to target...');
  await targetStorage.saveGraph(graph);

  console.log('Migration complete!');
}
```

---

## Data Format Migration

### Adding Missing Fields

If upgrading from an older format that's missing new fields:

```typescript
import { ManagerContext, Entity } from '@danielsimonjr/memoryjs';

async function addMissingFields(storagePath: string) {
  const ctx = new ManagerContext(storagePath);
  const graph = await ctx.storage.loadGraph();

  let updated = 0;

  for (const entity of graph.entities) {
    let modified = false;

    // Add createdAt if missing
    if (!entity.createdAt) {
      entity.createdAt = new Date().toISOString();
      modified = true;
    }

    // Add lastModified if missing
    if (!entity.lastModified) {
      entity.lastModified = entity.createdAt || new Date().toISOString();
      modified = true;
    }

    // Initialize tags array if missing
    if (!entity.tags) {
      entity.tags = [];
      modified = true;
    }

    // Set default importance if missing
    if (entity.importance === undefined) {
      entity.importance = 5;
      modified = true;
    }

    if (modified) updated++;
  }

  // Same for relations
  for (const relation of graph.relations) {
    if (!relation.createdAt) {
      relation.createdAt = new Date().toISOString();
    }
    if (!relation.lastModified) {
      relation.lastModified = relation.createdAt;
    }
  }

  await ctx.storage.saveGraph(graph);

  console.log(`Updated ${updated} entities with missing fields`);
}
```

### Tag Normalization Migration

If tags need to be normalized to lowercase:

```typescript
async function normalizeAllTags(storagePath: string) {
  const ctx = new ManagerContext(storagePath);
  const graph = await ctx.storage.loadGraph();

  let normalized = 0;

  for (const entity of graph.entities) {
    if (entity.tags && entity.tags.length > 0) {
      const originalTags = [...entity.tags];
      entity.tags = entity.tags.map(tag => tag.toLowerCase().trim());

      // Remove duplicates after normalization
      entity.tags = [...new Set(entity.tags)];

      if (JSON.stringify(originalTags) !== JSON.stringify(entity.tags)) {
        normalized++;
      }
    }
  }

  await ctx.storage.saveGraph(graph);

  console.log(`Normalized tags in ${normalized} entities`);
}
```

### Observation Deduplication

Remove duplicate observations:

```typescript
async function deduplicateObservations(storagePath: string) {
  const ctx = new ManagerContext(storagePath);
  const graph = await ctx.storage.loadGraph();

  let deduped = 0;

  for (const entity of graph.entities) {
    const originalCount = entity.observations.length;
    entity.observations = [...new Set(entity.observations)];

    if (entity.observations.length < originalCount) {
      deduped += originalCount - entity.observations.length;
    }
  }

  await ctx.storage.saveGraph(graph);

  console.log(`Removed ${deduped} duplicate observations`);
}
```

---

## Migrating from Other Solutions

### From Neo4j

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import neo4j from 'neo4j-driver';

async function migrateFromNeo4j(
  neo4jUri: string,
  neo4jUser: string,
  neo4jPassword: string,
  targetPath: string
) {
  // 1. Connect to Neo4j
  const driver = neo4j.driver(neo4jUri, neo4j.auth.basic(neo4jUser, neo4jPassword));
  const session = driver.session();

  const ctx = new ManagerContext(targetPath);

  try {
    // 2. Export nodes
    console.log('Exporting nodes...');
    const nodesResult = await session.run(`
      MATCH (n)
      RETURN n, labels(n) as labels
    `);

    const entities = nodesResult.records.map(record => {
      const node = record.get('n');
      const labels = record.get('labels');

      return {
        name: node.properties.name || node.properties.id || `node_${node.identity.toString()}`,
        entityType: labels[0] || 'node',
        observations: Object.entries(node.properties)
          .filter(([key]) => key !== 'name' && key !== 'id')
          .map(([key, value]) => `${key}: ${value}`),
        tags: labels.map((l: string) => l.toLowerCase()),
        importance: 5
      };
    });

    await ctx.entityManager.createEntities(entities);
    console.log(`Migrated ${entities.length} nodes`);

    // 3. Export relationships
    console.log('Exporting relationships...');
    const relsResult = await session.run(`
      MATCH (a)-[r]->(b)
      RETURN a.name as from, b.name as to, type(r) as type
    `);

    const relations = relsResult.records.map(record => ({
      from: record.get('from'),
      to: record.get('to'),
      relationType: record.get('type').toLowerCase()
    }));

    await ctx.relationManager.createRelations(relations);
    console.log(`Migrated ${relations.length} relationships`);

  } finally {
    await session.close();
    await driver.close();
  }
}
```

### From JSON-LD

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

interface JsonLdNode {
  '@id': string;
  '@type'?: string | string[];
  [key: string]: unknown;
}

async function migrateFromJsonLd(jsonLdPath: string, targetPath: string) {
  const data = JSON.parse(await fs.readFile(jsonLdPath, 'utf-8'));
  const ctx = new ManagerContext(targetPath);

  const nodes: JsonLdNode[] = Array.isArray(data['@graph']) ? data['@graph'] : [data];

  // Extract entities
  const entities = nodes.map(node => {
    const typeArray = Array.isArray(node['@type']) ? node['@type'] : [node['@type'] || 'Thing'];

    return {
      name: node['@id'],
      entityType: typeArray[0],
      observations: Object.entries(node)
        .filter(([key]) => !key.startsWith('@'))
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
      tags: typeArray.map(t => t.toLowerCase())
    };
  });

  await ctx.entityManager.createEntities(entities);

  // Extract relations from properties that are references
  const relations: Array<{ from: string; to: string; relationType: string }> = [];

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('@')) continue;

      // Check if value is a reference
      if (typeof value === 'object' && value !== null && '@id' in value) {
        relations.push({
          from: node['@id'],
          to: (value as { '@id': string })['@id'],
          relationType: key
        });
      }
    }
  }

  await ctx.relationManager.createRelations(relations);

  console.log(`Migrated ${entities.length} entities and ${relations.length} relations`);
}
```

### From RDF/Turtle

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { Parser, Store, Quad } from 'n3';

async function migrateFromRdf(rdfPath: string, targetPath: string) {
  const rdfData = await fs.readFile(rdfPath, 'utf-8');
  const parser = new Parser();
  const store = new Store();

  // Parse RDF
  const quads = parser.parse(rdfData);
  store.addQuads(quads);

  const ctx = new ManagerContext(targetPath);

  // Get unique subjects
  const subjects = new Set<string>();
  for (const quad of store.getQuads(null, null, null, null)) {
    subjects.add(quad.subject.value);
  }

  // Create entities from subjects
  const entities = [];
  for (const subject of subjects) {
    const predicates = store.getQuads(subject, null, null, null);

    // Find type
    const typeQuad = predicates.find(q =>
      q.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
    );
    const entityType = typeQuad?.object.value.split(/[#\/]/).pop() || 'Thing';

    // Collect observations
    const observations = predicates
      .filter(q => q.predicate.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
      .filter(q => q.object.termType === 'Literal')
      .map(q => {
        const predName = q.predicate.value.split(/[#\/]/).pop();
        return `${predName}: ${q.object.value}`;
      });

    entities.push({
      name: subject.split(/[#\/]/).pop() || subject,
      entityType,
      observations
    });
  }

  await ctx.entityManager.createEntities(entities);

  // Create relations from object properties
  const relations = [];
  for (const quad of store.getQuads(null, null, null, null)) {
    if (quad.object.termType === 'NamedNode' &&
        quad.predicate.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
      relations.push({
        from: quad.subject.value.split(/[#\/]/).pop() || quad.subject.value,
        to: quad.object.value.split(/[#\/]/).pop() || quad.object.value,
        relationType: quad.predicate.value.split(/[#\/]/).pop() || 'related_to'
      });
    }
  }

  await ctx.relationManager.createRelations(relations);

  console.log(`Migrated ${entities.length} entities and ${relations.length} relations`);
}
```

### From Notion

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { Client } from '@notionhq/client';

async function migrateFromNotion(
  notionToken: string,
  databaseId: string,
  targetPath: string
) {
  const notion = new Client({ auth: notionToken });
  const ctx = new ManagerContext(targetPath);

  // Query all pages from database
  let hasMore = true;
  let startCursor: string | undefined;
  const allPages: any[] = [];

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor
    });

    allPages.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }

  // Convert to entities
  const entities = allPages.map(page => {
    const properties = page.properties;

    // Extract title
    const titleProp = Object.values(properties).find((p: any) => p.type === 'title') as any;
    const title = titleProp?.title?.[0]?.plain_text || page.id;

    // Extract other properties as observations
    const observations: string[] = [];
    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      if (prop.type === 'title') continue;

      let value: string | null = null;

      switch (prop.type) {
        case 'rich_text':
          value = prop.rich_text?.[0]?.plain_text;
          break;
        case 'number':
          value = prop.number?.toString();
          break;
        case 'select':
          value = prop.select?.name;
          break;
        case 'multi_select':
          value = prop.multi_select?.map((s: any) => s.name).join(', ');
          break;
        case 'date':
          value = prop.date?.start;
          break;
        case 'checkbox':
          value = prop.checkbox?.toString();
          break;
      }

      if (value) {
        observations.push(`${key}: ${value}`);
      }
    }

    // Extract tags from multi-select properties
    const tags: string[] = [];
    for (const [key, prop] of Object.entries(properties) as [string, any][]) {
      if (prop.type === 'multi_select') {
        tags.push(...prop.multi_select.map((s: any) => s.name.toLowerCase()));
      }
    }

    return {
      name: title,
      entityType: 'notion_page',
      observations,
      tags: ['notion', ...tags]
    };
  });

  await ctx.entityManager.createEntities(entities);

  console.log(`Migrated ${entities.length} pages from Notion`);
}
```

---

## Breaking Changes Reference

### Version 1.1.0

No breaking changes from 1.0.x.

### Version 1.0.0

Initial release - no prior versions.

### Future Breaking Changes

When breaking changes occur, they will be documented here with:

1. Description of the change
2. Reason for the change
3. Migration path
4. Code examples

---

## Migration Scripts

### Complete Migration Script Template

```typescript
#!/usr/bin/env tsx
/**
 * Migration Script Template
 * Usage: npx tsx migrate.ts --source ./old.jsonl --target ./new.db
 */

import { ManagerContext, createStorageFromPath } from '@danielsimonjr/memoryjs';
import { parseArgs } from 'util';
import { existsSync, copyFileSync } from 'fs';

interface MigrationOptions {
  source: string;
  target: string;
  dryRun?: boolean;
  backup?: boolean;
}

async function migrate(options: MigrationOptions) {
  console.log('=== MemoryJS Migration ===\n');

  // Validate source exists
  if (!existsSync(options.source)) {
    throw new Error(`Source file not found: ${options.source}`);
  }

  // Create backup if requested
  if (options.backup) {
    const backupPath = `${options.source}.backup.${Date.now()}`;
    copyFileSync(options.source, backupPath);
    console.log(`Backup created: ${backupPath}`);
  }

  // Load source data
  console.log(`Loading from: ${options.source}`);
  const sourceStorage = createStorageFromPath(options.source);
  const graph = await sourceStorage.loadGraph();

  console.log(`  Entities: ${graph.entities.length}`);
  console.log(`  Relations: ${graph.relations.length}`);

  // Apply migrations
  console.log('\nApplying migrations...');

  // Migration 1: Normalize tags
  let tagsNormalized = 0;
  for (const entity of graph.entities) {
    if (entity.tags) {
      const original = [...entity.tags];
      entity.tags = entity.tags.map(t => t.toLowerCase().trim());
      entity.tags = [...new Set(entity.tags)];
      if (JSON.stringify(original) !== JSON.stringify(entity.tags)) {
        tagsNormalized++;
      }
    }
  }
  console.log(`  Tags normalized: ${tagsNormalized} entities`);

  // Migration 2: Add missing timestamps
  let timestampsAdded = 0;
  const now = new Date().toISOString();
  for (const entity of graph.entities) {
    if (!entity.createdAt) {
      entity.createdAt = now;
      timestampsAdded++;
    }
    if (!entity.lastModified) {
      entity.lastModified = entity.createdAt;
    }
  }
  console.log(`  Timestamps added: ${timestampsAdded} entities`);

  // Dry run check
  if (options.dryRun) {
    console.log('\n[DRY RUN] No changes written');
    return;
  }

  // Save to target
  console.log(`\nSaving to: ${options.target}`);
  const targetStorage = createStorageFromPath(options.target);
  await targetStorage.saveGraph(graph);

  // Verify
  console.log('Verifying...');
  const verify = await targetStorage.loadGraph();

  if (verify.entities.length !== graph.entities.length) {
    throw new Error('Entity count mismatch!');
  }
  if (verify.relations.length !== graph.relations.length) {
    throw new Error('Relation count mismatch!');
  }

  console.log('\n✓ Migration completed successfully');
}

// CLI interface
const { values } = parseArgs({
  options: {
    source: { type: 'string', short: 's' },
    target: { type: 'string', short: 't' },
    'dry-run': { type: 'boolean' },
    backup: { type: 'boolean', short: 'b' }
  }
});

if (!values.source || !values.target) {
  console.error('Usage: npx tsx migrate.ts --source <path> --target <path> [--dry-run] [--backup]');
  process.exit(1);
}

migrate({
  source: values.source,
  target: values.target,
  dryRun: values['dry-run'],
  backup: values.backup
}).catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
```

---

## Rollback Procedures

### Automatic Backup Restore

```typescript
async function rollback(ctx: ManagerContext, backupId: string) {
  console.log(`Rolling back to backup: ${backupId}`);

  // List available backups
  const backups = await ctx.ioManager.listBackups();
  const backup = backups.find(b => b.id === backupId);

  if (!backup) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  // Create a backup of current state before rollback
  const preRollbackBackup = await ctx.ioManager.createBackup({
    description: `Pre-rollback backup before restoring ${backupId}`
  });

  console.log(`Pre-rollback backup created: ${preRollbackBackup.id}`);

  // Restore
  await ctx.ioManager.restoreBackup(backupId);

  console.log('Rollback completed');
}
```

### Manual Rollback

```typescript
import { copyFileSync, existsSync } from 'fs';

function manualRollback(currentPath: string, backupPath: string) {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  // Create safety backup
  const safetyPath = `${currentPath}.pre-rollback.${Date.now()}`;
  copyFileSync(currentPath, safetyPath);
  console.log(`Safety backup: ${safetyPath}`);

  // Restore from backup
  copyFileSync(backupPath, currentPath);
  console.log(`Restored from: ${backupPath}`);
}
```

---

## Testing Migrations

### Migration Test Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '@danielsimonjr/memoryjs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Migration Tests', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'migration-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true });
  });

  it('should migrate JSONL to SQLite preserving all data', async () => {
    const jsonlPath = join(testDir, 'source.jsonl');
    const sqlitePath = join(testDir, 'target.db');

    // Create source data
    const sourceCtx = new ManagerContext(jsonlPath);
    await sourceCtx.entityManager.createEntities([
      { name: 'Test1', entityType: 'test', observations: ['obs1'], tags: ['tag1'], importance: 5 },
      { name: 'Test2', entityType: 'test', observations: ['obs2'], tags: ['tag2'], importance: 7 }
    ]);
    await sourceCtx.relationManager.createRelations([
      { from: 'Test1', to: 'Test2', relationType: 'related' }
    ]);

    // Run migration
    await migrateJSONLtoSQLite(jsonlPath, sqlitePath);

    // Verify
    const targetCtx = new ManagerContext(sqlitePath);
    const entities = await targetCtx.entityManager.getAllEntities();
    const relations = await targetCtx.relationManager.getAllRelations();

    expect(entities).toHaveLength(2);
    expect(relations).toHaveLength(1);

    const test1 = entities.find(e => e.name === 'Test1');
    expect(test1?.observations).toContain('obs1');
    expect(test1?.tags).toContain('tag1');
    expect(test1?.importance).toBe(5);
  });

  it('should normalize tags during migration', async () => {
    const path = join(testDir, 'test.jsonl');

    // Create with mixed case tags
    const ctx = new ManagerContext(path);
    const graph = await ctx.storage.loadGraph();
    graph.entities.push({
      name: 'Test',
      entityType: 'test',
      observations: [],
      tags: ['TAG1', 'Tag2', 'tag1']  // Mixed case, duplicate
    });
    await ctx.storage.saveGraph(graph);

    // Run normalization
    await normalizeAllTags(path);

    // Verify
    const after = await ctx.storage.loadGraph();
    const entity = after.entities.find(e => e.name === 'Test');

    expect(entity?.tags).toEqual(['tag1', 'tag2']);  // Lowercase, deduplicated
  });
});
```

### Validation Checklist

After any migration, verify:

- [ ] Entity count matches
- [ ] Relation count matches
- [ ] All entity fields preserved (name, type, observations, tags, importance, timestamps)
- [ ] All relation fields preserved (from, to, type, timestamps)
- [ ] Search functionality works
- [ ] Hierarchy relationships intact
- [ ] Tag aliases preserved
- [ ] Saved searches work

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
