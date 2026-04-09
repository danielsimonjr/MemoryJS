# Supermemory Gap-Closing (Sprint 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four features to memoryjs that close the Sprint 1 MUST gap with supermemory: Project Scoping, Memory Versioning with Contradiction Resolution, Semantic Forget, and User Profile — while preserving memoryjs's local-first architecture.

**Architecture:** Feature-vertical approach (B). Each feature is implemented end-to-end in dependency order: Scoping → Versioning → Forget → Profile. All four features share Entity model additions that land first. Each feature is independently testable, committable, and releasable as a minor version bump.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, async-mutex, tsup, Zod. Target Node.js >=18. Base branch `feature/must-have-8`, target version v1.8.0.

**Source spec:** `docs/superpowers/specs/2026-04-09-supermemory-gap-closing-design.md`

---

## Prerequisites

Before starting, verify:
- Current branch is `feature/must-have-8` (or a worktree off it)
- `npm install` has been run
- `npm run typecheck` passes on the baseline
- `SKIP_BENCHMARKS=true npm test` passes on the baseline

See the "Phase 0" section below for the actual starting tasks.

---

## Phase 0: Entity Model Foundation

This phase adds the shared fields on the `Entity` type that all four features depend on. It is the only phase with no user-facing functionality; its job is to make the data model ready without breaking anything.

### Task 0.1: Add version + scoping fields to Entity type

**Files:**
- Modify: `src/types/types.ts` (Entity interface, around line 88)
- Test: `tests/unit/types/entity-new-fields.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types/entity-new-fields.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Entity } from '../../../src/types/types.js';

describe('Entity new fields (v1.8.0)', () => {
  it('accepts projectId field', () => {
    const e: Entity = {
      name: 'test',
      entityType: 'thing',
      observations: [],
      projectId: 'proj-1',
    };
    expect(e.projectId).toBe('proj-1');
  });

  it('accepts version chain fields', () => {
    const e: Entity = {
      name: 'test-v2',
      entityType: 'thing',
      observations: [],
      version: 2,
      parentEntityName: 'test',
      rootEntityName: 'test',
      isLatest: true,
    };
    expect(e.version).toBe(2);
    expect(e.parentEntityName).toBe('test');
    expect(e.rootEntityName).toBe('test');
    expect(e.isLatest).toBe(true);
  });

  it('accepts supersededBy field', () => {
    const e: Entity = {
      name: 'old',
      entityType: 'thing',
      observations: [],
      isLatest: false,
      supersededBy: 'new',
    };
    expect(e.supersededBy).toBe('new');
    expect(e.isLatest).toBe(false);
  });

  it('allows all new fields to be omitted (back-compat)', () => {
    const e: Entity = {
      name: 'legacy',
      entityType: 'thing',
      observations: [],
    };
    expect(e.projectId).toBeUndefined();
    expect(e.version).toBeUndefined();
    expect(e.isLatest).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types/entity-new-fields.test.ts`
Expected: FAIL with TypeScript errors about unknown properties.

- [ ] **Step 3: Add fields to Entity interface**

In `src/types/types.ts`, after the `expiresAt?: string;` field (around line 87), add:

```typescript
  // ==================== v1.8.0: Project Scoping ====================

  /** Project/container scope identifier. Undefined = global/unscoped. */
  projectId?: string;

  // ==================== v1.8.0: Memory Versioning ====================

  /** Version number in the contradiction-resolution chain. Starts at 1. */
  version?: number;

  /** Name of the immediate parent version (previous version). */
  parentEntityName?: string;

  /** Name of the root entity in the version chain. */
  rootEntityName?: string;

  /** Whether this is the latest version in its chain. Default: true. */
  isLatest?: boolean;

  /** Name of the entity that superseded this one. */
  supersededBy?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/types/entity-new-fields.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

Stage `src/types/types.ts` and `tests/unit/types/entity-new-fields.test.ts`, commit with message:

```
feat(types): Add projectId and version chain fields to Entity

Adds optional fields for v1.8.0 Sprint 1 features:
- projectId: project scoping (Feature 1)
- version, parentEntityName, rootEntityName, isLatest, supersededBy:
  memory versioning (Feature 2)

All fields are optional for backwards compatibility.
```

---

### Task 0.2: Update GraphStorage (JSONL) to persist new fields

**Files:**
- Modify: `src/core/GraphStorage.ts` (three serialization blocks)
- Test: `tests/integration/storage/graph-storage-new-fields.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/storage/graph-storage-new-fields.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity } from '../../../src/types/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GraphStorage persists new v1.8.0 fields', () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: GraphStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-test-'));
    storagePath = path.join(tmpDir, 'memory.jsonl');
    storage = new GraphStorage(storagePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips projectId', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      projectId: 'proj-1',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].projectId).toBe('proj-1');
  });

  it('round-trips version chain fields', async () => {
    const entity: Entity = {
      name: 'alice-v2',
      entityType: 'person',
      observations: ['fact'],
      version: 2,
      parentEntityName: 'alice',
      rootEntityName: 'alice',
      isLatest: true,
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].version).toBe(2);
    expect(g.entities[0].parentEntityName).toBe('alice');
    expect(g.entities[0].rootEntityName).toBe('alice');
    expect(g.entities[0].isLatest).toBe(true);
  });

  it('round-trips supersededBy on old versions', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      isLatest: false,
      supersededBy: 'alice-v2',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });

    const storage2 = new GraphStorage(storagePath);
    const g = await storage2.loadGraph();
    expect(g.entities[0].isLatest).toBe(false);
    expect(g.entities[0].supersededBy).toBe('alice-v2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/storage/graph-storage-new-fields.test.ts`
Expected: FAIL — fields are not persisted.

- [ ] **Step 3: Add field serialization to `appendEntity`**

In `src/core/GraphStorage.ts`, locate `appendEntity()`. Find where `parentId` is conditionally added to `entityData`. Add immediately after it:

```typescript
    if (entity.parentId !== undefined) entityData.parentId = entity.parentId;
    if (entity.projectId !== undefined) entityData.projectId = entity.projectId;
    if (entity.version !== undefined) entityData.version = entity.version;
    if (entity.parentEntityName !== undefined) entityData.parentEntityName = entity.parentEntityName;
    if (entity.rootEntityName !== undefined) entityData.rootEntityName = entity.rootEntityName;
    if (entity.isLatest !== undefined) entityData.isLatest = entity.isLatest;
    if (entity.supersededBy !== undefined) entityData.supersededBy = entity.supersededBy;
```

- [ ] **Step 4: Add the same block to `saveGraphInternal` and `updateEntity`**

Find the same `parentId` serialization pattern in both methods. Add the same six conditional lines after each occurrence.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/storage/graph-storage-new-fields.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full storage test suite**

Run: `npx vitest run tests/integration/storage/`
Expected: all existing storage tests still pass.

- [ ] **Step 7: Commit**

Message:

```
feat(storage): Persist new v1.8.0 Entity fields in JSONL

Extends GraphStorage serialization to handle projectId and version
chain fields alongside existing parentId.
```

---

### Task 0.3: Update SQLiteStorage to persist new fields

**Files:**
- Modify: `src/core/SQLiteStorage.ts` (schema, migration, INSERT/UPDATE bindings)
- Test: `tests/integration/storage/sqlite-storage-new-fields.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/storage/sqlite-storage-new-fields.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import type { Entity } from '../../../src/types/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SQLiteStorage persists new v1.8.0 fields', () => {
  let tmpDir: string;
  let dbPath: string;
  let storage: SQLiteStorage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sqlite-test-'));
    dbPath = path.join(tmpDir, 'memory.db');
    storage = new SQLiteStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips projectId', async () => {
    const entity: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: ['fact'],
      projectId: 'proj-1',
    };
    await storage.saveGraph({ entities: [entity], relations: [] });
    const g = await storage.loadGraph();
    expect(g.entities[0].projectId).toBe('proj-1');
  });

  it('round-trips version chain', async () => {
    const entity: Entity = {
      name: 'alice-v2',
      entityType: 'person',
      observations: ['fact'],
      version: 2,
      parentEntityName: 'alice',
      rootEntityName: 'alice',
      isLatest: true,
    };
    await storage.saveGraph({ entities: [entity], relations: [] });
    const g = await storage.loadGraph();
    expect(g.entities[0].version).toBe(2);
    expect(g.entities[0].parentEntityName).toBe('alice');
    expect(g.entities[0].rootEntityName).toBe('alice');
    expect(g.entities[0].isLatest).toBe(true);
  });

  it('creates indexes on projectId and isLatest', () => {
    const db = (storage as any).db;
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entities'")
      .all()
      .map((r: any) => r.name);
    expect(rows).toContain('idx_entities_projectId');
    expect(rows).toContain('idx_entities_isLatest');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/storage/sqlite-storage-new-fields.test.ts`
Expected: FAIL — columns do not exist in schema.

- [ ] **Step 3: Update schema in `createTables()`**

In `src/core/SQLiteStorage.ts`, find the `CREATE TABLE entities` statement. Add these columns after `parentId`:

```
projectId TEXT,
version INTEGER DEFAULT 1,
parentEntityName TEXT,
rootEntityName TEXT,
isLatest INTEGER DEFAULT 1,
supersededBy TEXT,
```

After the table creation, add two new index creation statements using `this.db.exec()` (better-sqlite3 Database method, not child_process):

- `CREATE INDEX IF NOT EXISTS idx_entities_projectId ON entities(projectId)`
- `CREATE INDEX IF NOT EXISTS idx_entities_isLatest ON entities(isLatest)`

- [ ] **Step 4: Add migration method**

Add a private `migrateEntitiesTable()` method that uses PRAGMA table_info to detect existing columns, then issues ALTER TABLE ADD COLUMN for any missing columns from the list in Step 3. Call it from the constructor after `createTables()`.

Reference: the existing `migrateRelationsTable` method in the same file shows the exact pattern to follow.

- [ ] **Step 5: Update INSERT/UPDATE prepared statements**

Find all `INSERT INTO entities` and `UPDATE entities SET` prepared statements. Add the new columns to the column list and bind parameters with these values:

```typescript
entity.projectId ?? null,
entity.version ?? 1,
entity.parentEntityName ?? null,
entity.rootEntityName ?? null,
entity.isLatest === false ? 0 : 1,
entity.supersededBy ?? null,
```

- [ ] **Step 6: Update row-to-Entity mapper**

Find the private method that maps a DB row to an Entity. Add:

```typescript
if (row.projectId != null) entity.projectId = row.projectId;
if (row.version != null) entity.version = row.version;
if (row.parentEntityName != null) entity.parentEntityName = row.parentEntityName;
if (row.rootEntityName != null) entity.rootEntityName = row.rootEntityName;
if (row.isLatest != null) entity.isLatest = row.isLatest === 1;
if (row.supersededBy != null) entity.supersededBy = row.supersededBy;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/integration/storage/sqlite-storage-new-fields.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Run full SQLite test suite + typecheck**

Run: `npx vitest run tests/integration/storage/ && npm run typecheck`
Expected: all tests pass, no typecheck errors.

- [ ] **Step 9: Commit**

Message:

```
feat(storage): Persist new v1.8.0 Entity fields in SQLite

Adds columns, indexes, and migration for projectId and version
chain fields. Existing databases are migrated additively via
ALTER TABLE ADD COLUMN.
```

---

## Phase 1: Feature 1 — Project Scoping

### Task 1.1: Add projectId to SearchFilterChain

**Files:**
- Modify: `src/search/SearchFilterChain.ts`
- Test: `tests/unit/search/search-filter-chain-project.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/search/search-filter-chain-project.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SearchFilterChain } from '../../../src/search/SearchFilterChain.js';
import type { Entity } from '../../../src/types/types.js';

const E = (name: string, projectId?: string): Entity => ({
  name,
  entityType: 'thing',
  observations: [],
  projectId,
});

describe('SearchFilterChain projectId filter', () => {
  const entities: Entity[] = [
    E('a', 'proj-1'),
    E('b', 'proj-2'),
    E('c', undefined),
    E('d', 'proj-1'),
  ];

  it('returns only entities in the specified project', () => {
    const result = SearchFilterChain.applyFilters(entities, { projectId: 'proj-1' });
    expect(result.map(e => e.name)).toEqual(['a', 'd']);
  });

  it('excludes global entities when projectId is set', () => {
    const result = SearchFilterChain.applyFilters(entities, { projectId: 'proj-2' });
    expect(result.map(e => e.name)).toEqual(['b']);
  });

  it('returns all entities when projectId filter is undefined', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    expect(result.map(e => e.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hasActiveFilters returns true when projectId is set', () => {
    expect(SearchFilterChain.hasActiveFilters({ projectId: 'proj-1' })).toBe(true);
  });

  it('composes with other filters (AND semantics)', () => {
    const mixed: Entity[] = [
      { ...E('a', 'proj-1'), tags: ['x'] },
      { ...E('b', 'proj-1'), tags: ['y'] },
      { ...E('c', 'proj-2'), tags: ['x'] },
    ];
    const result = SearchFilterChain.applyFilters(mixed, {
      projectId: 'proj-1',
      tags: ['x'],
    });
    expect(result.map(e => e.name)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/search/search-filter-chain-project.test.ts`
Expected: FAIL — `projectId` is not a recognized field on `SearchFilters`.

- [ ] **Step 3: Add projectId to SearchFilters interface**

In `src/search/SearchFilterChain.ts`, add to the `SearchFilters` interface (after `modifiedBefore`):

```typescript
  /** Project scope (exact match). Undefined = match all projects. */
  projectId?: string;
```

- [ ] **Step 4: Add check to entityPassesFilters**

In `entityPassesFilters`, before the final `return true;`:

```typescript
    // Project scope filter
    if (filters.projectId !== undefined && entity.projectId !== filters.projectId) {
      return false;
    }

    return true;
```

- [ ] **Step 5: Add projectId to hasActiveFilters**

In `hasActiveFilters`, add `|| filters.projectId !== undefined` to the OR chain.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/search/search-filter-chain-project.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

Message:

```
feat(search): Add projectId filter to SearchFilterChain

Project scope filter propagates to all search methods via the
centralized filter chain.
```

---

### Task 1.2: Wire defaultProjectId into ManagerContext

**Files:**
- Modify: `src/core/ManagerContext.ts`
- Test: `tests/unit/core/manager-context-project.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/manager-context-project.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ManagerContext defaultProjectId option', () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-mc-test-'));
    storagePath = path.join(tmpDir, 'memory.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts string path (legacy)', () => {
    const ctx = new ManagerContext(storagePath);
    expect(ctx.defaultProjectId).toBeUndefined();
  });

  it('accepts options object with defaultProjectId', () => {
    const ctx = new ManagerContext({
      storagePath,
      defaultProjectId: 'my-project',
    });
    expect(ctx.defaultProjectId).toBe('my-project');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/manager-context-project.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update ManagerContext constructor**

Add an exported `ManagerContextOptions` interface (if not already present) with a new optional `defaultProjectId?: string` field. Update the constructor to accept `string | ManagerContextOptions` (union), extract options from either form, and store `defaultProjectId` as a public readonly property.

Do NOT alter existing constructor logic beyond adding the new field extraction and the union type on the parameter.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/manager-context-project.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full ManagerContext test suite**

Run: `npx vitest run tests/unit/core/`
Expected: all existing tests pass.

- [ ] **Step 6: Commit**

Message: `feat(core): Add defaultProjectId option to ManagerContext`

---

### Task 1.3: Auto-stamp projectId on entity creation

**Files:**
- Modify: `src/core/EntityManager.ts`
- Modify: `src/core/ManagerContext.ts` (pass option to EntityManager constructor)
- Test: `tests/unit/core/entity-manager-project-stamping.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/entity-manager-project-stamping.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager auto-stamps projectId from context default', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-em-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stamps defaultProjectId on new entities without explicit projectId', async () => {
    const ctx = new ManagerContext({
      storagePath: path.join(tmpDir, 'memory.jsonl'),
      defaultProjectId: 'proj-1',
    });
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: [] },
    ]);
    const entity = await ctx.entityManager.getEntity('alice');
    expect(entity?.projectId).toBe('proj-1');
  });

  it('does not overwrite explicit projectId', async () => {
    const ctx = new ManagerContext({
      storagePath: path.join(tmpDir, 'memory2.jsonl'),
      defaultProjectId: 'proj-1',
    });
    await ctx.entityManager.createEntities([
      { name: 'bob', entityType: 'person', observations: [], projectId: 'proj-2' },
    ]);
    const entity = await ctx.entityManager.getEntity('bob');
    expect(entity?.projectId).toBe('proj-2');
  });

  it('leaves projectId undefined when no default is set', async () => {
    const ctx = new ManagerContext(path.join(tmpDir, 'memory3.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: [] },
    ]);
    const entity = await ctx.entityManager.getEntity('carol');
    expect(entity?.projectId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-project-stamping.test.ts`
Expected: FAIL.

- [ ] **Step 3: Accept options in EntityManager constructor**

In `src/core/EntityManager.ts`:
- Add exported `EntityManagerOptions` interface with `defaultProjectId?: string`
- Add optional second constructor parameter `options?: EntityManagerOptions`
- Store `this.defaultProjectId = options?.defaultProjectId`

- [ ] **Step 4: Pass the option from ManagerContext**

In `src/core/ManagerContext.ts`, update the `entityManager` lazy getter to pass `{ defaultProjectId: this.defaultProjectId }` as the second argument to the EntityManager constructor.

- [ ] **Step 5: Stamp projectId in createEntities**

In `src/core/EntityManager.ts`, in `createEntities` around line 190, inside the loop that builds new entities (around line 232), before pushing to `newEntities`:

```typescript
      if (entity.projectId === undefined && this.defaultProjectId !== undefined) {
        entity.projectId = this.defaultProjectId;
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/entity-manager-project-stamping.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run full EntityManager test suite + typecheck**

Run: `npx vitest run tests/unit/core/EntityManager.test.ts && npm run typecheck`
Expected: all tests pass, no errors.

- [ ] **Step 8: Commit**

Message: `feat(core): Auto-stamp projectId on entity creation`

---

### Task 1.4: Propagate projectId through SearchManager + integration test

**Files:**
- Modify: `src/search/SearchManager.ts`
- Test: `tests/integration/search/project-scope-isolation.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/search/project-scope-isolation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Project scope isolates search across all search methods', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-proj-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));

    await ctx.entityManager.createEntities([
      { name: 'alpha', entityType: 'thing', observations: ['foo bar'], projectId: 'p1' },
      { name: 'beta', entityType: 'thing', observations: ['foo bar'], projectId: 'p2' },
      { name: 'gamma', entityType: 'thing', observations: ['foo bar'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searchNodes respects projectId filter', async () => {
    const results = await ctx.searchManager.searchNodes('foo', { projectId: 'p1' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
    expect(names).not.toContain('gamma');
  });

  it('searchNodes without projectId returns all', async () => {
    const results = await ctx.searchManager.searchNodes('foo');
    expect(results.entities.length).toBe(3);
  });

  it('fuzzySearch respects projectId filter', async () => {
    const results = await ctx.searchManager.fuzzySearch('foo', { projectId: 'p2' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('beta');
    expect(names).not.toContain('alpha');
  });

  it('booleanSearch respects projectId filter', async () => {
    const results = await ctx.searchManager.booleanSearch('foo AND bar', { projectId: 'p1' });
    const names = results.entities.map(e => e.name);
    expect(names).toContain('alpha');
    expect(names).not.toContain('beta');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/search/project-scope-isolation.test.ts`
Expected: FAIL — search methods don't accept `projectId` in options yet.

- [ ] **Step 3: Add projectId to SearchManager options and thread through**

In `src/search/SearchManager.ts`:
- Add `projectId?: string` to `SearchOptionsWithTracking` (or the corresponding options type used by search methods)
- In `searchNodes`, `searchNodesRanked`, `booleanSearch`, `fuzzySearch`: where a `SearchFilters` object is constructed from options, include `projectId: options?.projectId`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/search/project-scope-isolation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run full test suite**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 6: Commit**

Message: `feat(search): Propagate projectId through all SearchManager methods`

---

### Task 1.5: Add listProjects method to EntityManager

**Files:**
- Modify: `src/core/EntityManager.ts`
- Test: `tests/unit/core/entity-manager-list-projects.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/entity-manager-list-projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager.listProjects', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-lp-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'a', entityType: 'thing', observations: [], projectId: 'p1' },
      { name: 'b', entityType: 'thing', observations: [], projectId: 'p2' },
      { name: 'c', entityType: 'thing', observations: [], projectId: 'p1' },
      { name: 'd', entityType: 'thing', observations: [] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns distinct projectId values', async () => {
    const projects = await ctx.entityManager.listProjects();
    expect(projects.sort()).toEqual(['p1', 'p2']);
  });

  it('excludes global (undefined) projects', async () => {
    const projects = await ctx.entityManager.listProjects();
    expect(projects).not.toContain(undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-list-projects.test.ts`
Expected: FAIL — method does not exist.

- [ ] **Step 3: Implement listProjects**

Add to `src/core/EntityManager.ts`:

```typescript
  /**
   * List all distinct project IDs in the graph (excluding global entities).
   */
  async listProjects(): Promise<string[]> {
    const graph = await this.storage.loadGraph();
    const projects = new Set<string>();
    for (const entity of graph.entities) {
      if (entity.projectId) {
        projects.add(entity.projectId);
      }
    }
    return Array.from(projects).sort();
  }
```

- [ ] **Step 4: Run test + typecheck + commit**

Run: `npx vitest run tests/unit/core/entity-manager-list-projects.test.ts && npm run typecheck`
Expected: PASS.

Commit message: `feat(core): Add EntityManager.listProjects() method`

---

### Task 1.6: Phase 1 verification gate

- [ ] Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20` → all pass
- [ ] Run: `npm run typecheck` → no errors
- [ ] Run: `git log --oneline -10` → confirm commits for tasks 0.1-1.5

**Phase 1 complete. Feature 1 (Project Scoping) is shippable as v1.8.0-alpha.1.**

---

## Phase 2: Feature 2 — Memory Versioning / Contradiction Resolution

### Task 2.1: Create ContradictionDetector class (detection only)

**Files:**
- Create: `src/features/ContradictionDetector.ts`
- Test: `tests/unit/features/contradiction-detector-detect.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/contradiction-detector-detect.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import type { Entity } from '../../../src/types/types.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';

function mockSemanticSearch(similarityMap: Record<string, number>): SemanticSearch {
  return {
    calculateSimilarity: vi.fn(async (a: string, b: string) => {
      return similarityMap[`${a}|${b}`] ?? 0;
    }),
  } as unknown as SemanticSearch;
}

describe('ContradictionDetector.detect', () => {
  const entity: Entity = {
    name: 'alice',
    entityType: 'person',
    observations: ['Lives in NYC', 'Works at TechCorp'],
  };

  it('detects high-similarity contradiction', async () => {
    const sem = mockSemanticSearch({
      'Lives in SF|Lives in NYC': 0.92,
      'Lives in SF|Works at TechCorp': 0.1,
    });
    const detector = new ContradictionDetector(sem, 0.85);
    const results = await detector.detect(entity, ['Lives in SF']);
    expect(results).toHaveLength(1);
    expect(results[0].existingObservation).toBe('Lives in NYC');
    expect(results[0].newObservation).toBe('Lives in SF');
    expect(results[0].similarity).toBe(0.92);
  });

  it('does not flag low-similarity additions', async () => {
    const sem = mockSemanticSearch({
      'Enjoys hiking|Lives in NYC': 0.05,
      'Enjoys hiking|Works at TechCorp': 0.1,
    });
    const detector = new ContradictionDetector(sem, 0.85);
    const results = await detector.detect(entity, ['Enjoys hiking']);
    expect(results).toHaveLength(0);
  });

  it('respects custom threshold', async () => {
    const sem = mockSemanticSearch({
      'Kinda similar|Lives in NYC': 0.75,
      'Kinda similar|Works at TechCorp': 0.2,
    });
    const low = new ContradictionDetector(sem, 0.7);
    expect(await low.detect(entity, ['Kinda similar'])).toHaveLength(1);

    const high = new ContradictionDetector(sem, 0.9);
    expect(await high.detect(entity, ['Kinda similar'])).toHaveLength(0);
  });

  it('returns empty when entity has no observations', async () => {
    const empty: Entity = { name: 'empty', entityType: 'x', observations: [] };
    const sem = mockSemanticSearch({});
    const detector = new ContradictionDetector(sem, 0.85);
    expect(await detector.detect(empty, ['foo'])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/contradiction-detector-detect.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create ContradictionDetector**

Create `src/features/ContradictionDetector.ts`:

```typescript
/**
 * Contradiction Detector
 *
 * Detects when new observations contradict existing ones using semantic
 * similarity. Feature 2 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/ContradictionDetector
 */

import type { Entity } from '../types/types.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';

export interface Contradiction {
  existingObservation: string;
  newObservation: string;
  similarity: number;
}

export class ContradictionDetector {
  constructor(
    private semanticSearch: SemanticSearch,
    private threshold: number = 0.85
  ) {}

  async detect(
    entity: Entity,
    newObservations: string[]
  ): Promise<Contradiction[]> {
    if (entity.observations.length === 0) return [];
    if (newObservations.length === 0) return [];

    const contradictions: Contradiction[] = [];

    for (const newObs of newObservations) {
      for (const existingObs of entity.observations) {
        if (newObs === existingObs) continue;
        const similarity = await this.semanticSearch.calculateSimilarity(
          newObs,
          existingObs
        );
        if (similarity >= this.threshold) {
          contradictions.push({
            existingObservation: existingObs,
            newObservation: newObs,
            similarity,
          });
        }
      }
    }

    return contradictions;
  }
}
```

- [ ] **Step 4: Ensure SemanticSearch has calculateSimilarity method**

Check `src/search/SemanticSearch.ts`. If a `calculateSimilarity(a: string, b: string): Promise<number>` method does not exist, add one that embeds both strings via `this.embeddingService.embed()` and returns cosine similarity. Reuse any existing `cosineSimilarity` helper in the module.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/contradiction-detector-detect.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

Message: `feat(features): Add ContradictionDetector.detect() with semantic similarity`

---

### Task 2.2: Implement ContradictionDetector.supersede

**Files:**
- Modify: `src/features/ContradictionDetector.ts`
- Test: `tests/integration/features/contradiction-detector-supersede.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/features/contradiction-detector-supersede.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mockSearch = (): SemanticSearch => ({
  calculateSimilarity: async () => 0.9,
} as unknown as SemanticSearch);

describe('ContradictionDetector.supersede', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Likes coffee'],
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new entity version with incremented version number', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const old = (await ctx.entityManager.getEntity('alice'))!;
    const updated = await detector.supersede(
      old,
      ['Lives in SF'],
      ctx.entityManager
    );
    expect(updated.name).toBe('alice-v2');
    expect(updated.version).toBe(2);
    expect(updated.parentEntityName).toBe('alice');
    expect(updated.rootEntityName).toBe('alice');
    expect(updated.isLatest).toBe(true);
  });

  it('marks old entity as superseded', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const old = (await ctx.entityManager.getEntity('alice'))!;
    await detector.supersede(old, ['Lives in SF'], ctx.entityManager);
    const oldReloaded = (await ctx.entityManager.getEntity('alice'))!;
    expect(oldReloaded.isLatest).toBe(false);
    expect(oldReloaded.supersededBy).toBe('alice-v2');
  });

  it('preserves rootEntityName across multiple supersessions', async () => {
    const detector = new ContradictionDetector(mockSearch(), 0.85);
    const v1 = (await ctx.entityManager.getEntity('alice'))!;
    const v2 = await detector.supersede(v1, ['Lives in SF'], ctx.entityManager);
    const v3 = await detector.supersede(v2, ['Lives in LA'], ctx.entityManager);
    expect(v3.name).toBe('alice-v3');
    expect(v3.version).toBe(3);
    expect(v3.parentEntityName).toBe('alice-v2');
    expect(v3.rootEntityName).toBe('alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/features/contradiction-detector-supersede.test.ts`
Expected: FAIL — `supersede` does not exist.

- [ ] **Step 3: Implement supersede**

Add to `src/features/ContradictionDetector.ts`:

```typescript
import type { EntityManager } from '../core/EntityManager.js';

// ... inside the class:

  async supersede(
    oldEntity: Entity,
    newObservations: string[],
    entityManager: EntityManager
  ): Promise<Entity> {
    const currentVersion = oldEntity.version ?? 1;
    const nextVersion = currentVersion + 1;
    const rootName = oldEntity.rootEntityName ?? oldEntity.name;
    const newName = `${rootName}-v${nextVersion}`;

    const contradictions = await this.detect(oldEntity, newObservations);
    const contradictedSet = new Set(
      contradictions.map(c => c.existingObservation)
    );
    const preserved = oldEntity.observations.filter(
      o => !contradictedSet.has(o)
    );

    const newEntity: Entity = {
      name: newName,
      entityType: oldEntity.entityType,
      observations: [...preserved, ...newObservations],
      tags: oldEntity.tags ? [...oldEntity.tags] : undefined,
      importance: oldEntity.importance,
      parentId: oldEntity.parentId,
      projectId: oldEntity.projectId,
      version: nextVersion,
      parentEntityName: oldEntity.name,
      rootEntityName: rootName,
      isLatest: true,
    };

    await entityManager.createEntities([newEntity]);

    await entityManager.updateEntity(oldEntity.name, {
      isLatest: false,
      supersededBy: newName,
    });

    return newEntity;
  }
```

- [ ] **Step 4: Verify update schema allows isLatest/supersededBy**

Check `src/utils/schemas*.ts` (or wherever `UpdateEntitySchema` lives) and ensure the Zod schema permits `isLatest` and `supersededBy` as optional fields. If not, extend the schema.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/features/contradiction-detector-supersede.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

Message: `feat(features): Implement ContradictionDetector.supersede()`

---

### Task 2.3: Filter superseded entities by default

**Files:**
- Modify: `src/search/SearchFilterChain.ts`
- Test: `tests/unit/search/search-filter-chain-versioning.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/search/search-filter-chain-versioning.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SearchFilterChain } from '../../../src/search/SearchFilterChain.js';
import type { Entity } from '../../../src/types/types.js';

const makeEntity = (name: string, isLatest: boolean | undefined): Entity => ({
  name,
  entityType: 'thing',
  observations: [],
  isLatest,
});

describe('SearchFilterChain default versioning behavior', () => {
  const entities: Entity[] = [
    makeEntity('a', true),
    makeEntity('b', false),
    makeEntity('c', undefined),
    makeEntity('d', true),
  ];

  it('excludes superseded entities by default', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    const names = result.map(e => e.name).sort();
    expect(names).toEqual(['a', 'c', 'd']);
    expect(names).not.toContain('b');
  });

  it('includeSuperseded=true returns all', () => {
    const result = SearchFilterChain.applyFilters(entities, {
      includeSuperseded: true,
    });
    expect(result.map(e => e.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('legacy entities (isLatest undefined) are included by default', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    expect(result.map(e => e.name)).toContain('c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/search/search-filter-chain-versioning.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add includeSuperseded to SearchFilters interface**

In `src/search/SearchFilterChain.ts`, add to `SearchFilters`:

```typescript
  /** Include superseded entity versions. Default false. */
  includeSuperseded?: boolean;
```

- [ ] **Step 4: Add versioning check in entityPassesFilters**

Before the final `return true;`:

```typescript
    // Versioning filter: exclude superseded entities by default
    if (!filters.includeSuperseded && entity.isLatest === false) {
      return false;
    }

    return true;
```

- [ ] **Step 5: Remove the early-return optimization in applyFilters**

The early-return based on `hasActiveFilters` must not skip the versioning filter. Simplest fix: always run the filter loop:

```typescript
  static applyFilters(entities: readonly Entity[], filters: SearchFilters): Entity[] {
    const normalizedSearchTags = filters.tags?.length
      ? normalizeTags(filters.tags)
      : undefined;

    return entities.filter(entity =>
      this.entityPassesFilters(entity, filters, normalizedSearchTags)
    );
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/search/search-filter-chain-versioning.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run full search test suite**

Run: `npx vitest run tests/unit/search/`
Expected: all tests pass.

- [ ] **Step 8: Commit**

Message: `feat(search): Filter superseded entity versions by default`

---

### Task 2.4: Hook ContradictionDetector into ObservationManager

**Files:**
- Modify: `src/core/ObservationManager.ts`
- Modify: `src/core/ManagerContext.ts`
- Test: `tests/integration/core/observation-manager-contradiction.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/core/observation-manager-contradiction.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ObservationManager triggers contradiction detection', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-om-cd-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    const mockDetector = new ContradictionDetector(
      { calculateSimilarity: async () => 0.95 } as any,
      0.85
    );
    ctx.observationManager.setContradictionDetector(mockDetector, ctx.entityManager);

    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates new version instead of appending when contradiction detected', async () => {
    await ctx.observationManager.addObservations([
      { entityName: 'alice', contents: ['Lives in SF'] },
    ]);

    const newVersion = await ctx.entityManager.getEntity('alice-v2');
    expect(newVersion).toBeDefined();
    expect(newVersion!.observations).toContain('Lives in SF');

    const oldVersion = await ctx.entityManager.getEntity('alice');
    expect(oldVersion!.isLatest).toBe(false);
    expect(oldVersion!.supersededBy).toBe('alice-v2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/core/observation-manager-contradiction.test.ts`
Expected: FAIL — `setContradictionDetector` does not exist.

- [ ] **Step 3: Add setter and detection hook to ObservationManager**

In `src/core/ObservationManager.ts`:

```typescript
import type { ContradictionDetector } from '../features/ContradictionDetector.js';
import type { EntityManager } from './EntityManager.js';

export class ObservationManager {
  private contradictionDetector?: ContradictionDetector;
  private linkedEntityManager?: EntityManager;

  // ... existing constructor ...

  setContradictionDetector(
    detector: ContradictionDetector,
    entityManager: EntityManager
  ): void {
    this.contradictionDetector = detector;
    this.linkedEntityManager = entityManager;
  }
}
```

In `addObservations`, around line 67 (after the `newObservations` filter, before `entity.observations.push(...)`):

```typescript
      if (this.contradictionDetector && this.linkedEntityManager) {
        const contradictions = await this.contradictionDetector.detect(
          entity,
          newObservations
        );
        if (contradictions.length > 0) {
          await this.contradictionDetector.supersede(
            entity,
            newObservations,
            this.linkedEntityManager
          );
          continue;
        }
      }
```

- [ ] **Step 4: Wire detector in ManagerContext when enabled**

In `src/core/ManagerContext.ts`:
- Add `enableContradictionDetection?: boolean` and `contradictionThreshold?: number` to `ManagerContextOptions`
- Add a private `initContradictionDetection()` method that, when the option is set and `semanticSearch` is configured, constructs a `ContradictionDetector` and calls `observationManager.setContradictionDetector(detector, this.entityManager)`
- Call `initContradictionDetection()` once during first access to observationManager, or eagerly in the constructor if safe

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/core/observation-manager-contradiction.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 7: Commit**

Message: `feat(core): Hook ContradictionDetector into ObservationManager`

---

### Task 2.5: Add version chain navigation methods

**Files:**
- Modify: `src/core/EntityManager.ts`
- Test: `tests/unit/core/entity-manager-version-chain.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/entity-manager-version-chain.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager version chain navigation', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-vc-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC'],
        version: 1,
        rootEntityName: 'alice',
        isLatest: false,
        supersededBy: 'alice-v2',
      },
      {
        name: 'alice-v2',
        entityType: 'person',
        observations: ['Lives in SF'],
        version: 2,
        parentEntityName: 'alice',
        rootEntityName: 'alice',
        isLatest: false,
        supersededBy: 'alice-v3',
      },
      {
        name: 'alice-v3',
        entityType: 'person',
        observations: ['Lives in LA'],
        version: 3,
        parentEntityName: 'alice-v2',
        rootEntityName: 'alice',
        isLatest: true,
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getVersionChain returns all versions in order', async () => {
    const chain = await ctx.entityManager.getVersionChain('alice');
    expect(chain.map(e => e.name)).toEqual(['alice', 'alice-v2', 'alice-v3']);
  });

  it('getVersionChain works from any entity in chain', async () => {
    const chain = await ctx.entityManager.getVersionChain('alice-v2');
    expect(chain.map(e => e.name)).toEqual(['alice', 'alice-v2', 'alice-v3']);
  });

  it('getLatestVersion returns the latest', async () => {
    const latest = await ctx.entityManager.getLatestVersion('alice');
    expect(latest?.name).toBe('alice-v3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-version-chain.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement methods**

Add to `src/core/EntityManager.ts`:

```typescript
  /**
   * Return all entities in a version chain sorted by version ascending.
   * Accepts any entity in the chain; resolves to the root via rootEntityName.
   */
  async getVersionChain(entityName: string): Promise<Entity[]> {
    const entity = await this.getEntity(entityName);
    if (!entity) return [];

    const rootName = entity.rootEntityName ?? entity.name;
    const graph = await this.storage.loadGraph();
    const chain = graph.entities.filter(
      e => (e.rootEntityName ?? e.name) === rootName
    );
    chain.sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
    return chain;
  }

  /** Return the latest version of an entity. */
  async getLatestVersion(entityName: string): Promise<Entity | null> {
    const chain = await this.getVersionChain(entityName);
    if (chain.length === 0) return null;
    return chain.find(e => e.isLatest !== false) ?? chain[chain.length - 1];
  }
```

- [ ] **Step 4: Run test + typecheck + commit**

Run: `npx vitest run tests/unit/core/entity-manager-version-chain.test.ts && npm run typecheck`
Expected: PASS.

Message: `feat(core): Add getVersionChain and getLatestVersion`

---

### Task 2.6: Guard CompressionManager against merging across version chains

**Files:**
- Modify: `src/features/CompressionManager.ts`
- Test: `tests/unit/features/compression-manager-versioning-guard.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/compression-manager-versioning-guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('CompressionManager respects version chains', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-cm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC'],
        rootEntityName: 'alice',
        version: 1,
        isLatest: false,
        supersededBy: 'alice-v2',
      },
      {
        name: 'alice-v2',
        entityType: 'person',
        observations: ['Lives in SF'],
        parentEntityName: 'alice',
        rootEntityName: 'alice',
        version: 2,
        isLatest: true,
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('findDuplicates excludes superseded entities', async () => {
    const dupes = await ctx.compressionManager.findDuplicates(0.5);
    const names = dupes.flatMap(d => d.entities.map(e => e.name));
    expect(names).not.toContain('alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/compression-manager-versioning-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add guard to findDuplicates and mergeEntities**

In `src/features/CompressionManager.ts`:

- In `findDuplicates`, filter `graph.entities` to exclude `e.isLatest === false` before processing.
- In `mergeEntities`, throw `ValidationError` if any target entity has `isLatest === false` with message: `"Cannot merge superseded entity '<name>'. Use the latest version."`

- [ ] **Step 4: Run test + full compression suite**

Run: `npx vitest run tests/unit/features/compression-manager-versioning-guard.test.ts tests/unit/features/CompressionManager.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `fix(features): CompressionManager skips superseded entity versions`

---

### Task 2.7: Phase 2 verification gate

- [ ] Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20` → all pass
- [ ] Run: `npm run typecheck` → no errors

**Phase 2 complete. Feature 2 (Memory Versioning) is shippable as v1.8.0-alpha.2.**

---

## Phase 3: Feature 3 — Semantic Forget

### Task 3.1: Create SemanticForget class (exact-match path)

**Files:**
- Create: `src/features/SemanticForget.ts`
- Test: `tests/unit/features/semantic-forget-exact.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/semantic-forget-exact.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SemanticForget } from '../../../src/features/SemanticForget.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticForget exact match path', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let forget: SemanticForget;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Lives in NYC', 'Likes coffee'],
      },
      {
        name: 'bob',
        entityType: 'person',
        observations: ['Lives in NYC', 'Hates tea'],
      },
    ]);
    forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes exact-matching observation across all entities', async () => {
    const result = await forget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);
    expect(result.deletedObservations.map(d => d.entityName).sort()).toEqual(['alice', 'bob']);
  });

  it('returns not_found for missing content', async () => {
    const result = await forget.forgetByContent('Lives in Mars');
    expect(result.method).toBe('not_found');
    expect(result.deletedObservations).toHaveLength(0);
  });

  it('dryRun does not mutate storage', async () => {
    const result = await forget.forgetByContent('Lives in NYC', { dryRun: true });
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(2);

    const alice = await ctx.entityManager.getEntity('alice');
    expect(alice!.observations).toContain('Lives in NYC');
  });

  it('deletes entity when all observations are removed', async () => {
    await ctx.entityManager.createEntities([
      { name: 'carol', entityType: 'person', observations: ['Only fact'] },
    ]);
    const result = await forget.forgetByContent('Only fact');
    expect(result.deletedEntities).toContain('carol');

    const carol = await ctx.entityManager.getEntity('carol');
    expect(carol).toBeNull();
  });

  it('respects projectId filter', async () => {
    await ctx.entityManager.createEntities([
      { name: 'dan', entityType: 'person', observations: ['Lives in NYC'], projectId: 'p1' },
    ]);
    const result = await forget.forgetByContent('Lives in NYC', { projectId: 'p1' });
    expect(result.deletedObservations).toHaveLength(1);
    expect(result.deletedObservations[0].entityName).toBe('dan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/semantic-forget-exact.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create SemanticForget module**

Create `src/features/SemanticForget.ts`:

```typescript
/**
 * Semantic Forget
 *
 * Two-tier deletion: exact match first, then semantic search fallback.
 * Feature 3 of the v1.8.0 supermemory gap-closing effort.
 *
 * @module features/SemanticForget
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { SemanticSearch } from '../search/SemanticSearch.js';
import type { AuditLog } from './AuditLog.js';
import type { Entity } from '../types/types.js';

export interface ForgetResult {
  method: 'exact' | 'semantic' | 'not_found';
  deletedObservations: { entityName: string; observation: string }[];
  deletedEntities: string[];
  similarity?: number;
}

export interface ForgetOptions {
  threshold?: number;
  projectId?: string;
  dryRun?: boolean;
  agentId?: string;
}

export class SemanticForget {
  constructor(
    private storage: GraphStorage,
    private observationManager: ObservationManager,
    private entityManager: EntityManager,
    private semanticSearch?: SemanticSearch,
    private auditLog?: AuditLog
  ) {}

  async forgetByContent(
    content: string,
    options: ForgetOptions = {}
  ): Promise<ForgetResult> {
    const projectId = options.projectId;
    const dryRun = options.dryRun ?? false;

    const graph = await this.storage.loadGraph();
    const candidates = graph.entities.filter(e =>
      (projectId === undefined || e.projectId === projectId) &&
      e.observations.includes(content)
    );

    if (candidates.length > 0) {
      return this.executeDelete(candidates, content, 'exact', dryRun, options);
    }

    if (this.semanticSearch) {
      return this.semanticFallback(content, options);
    }

    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }

  private async executeDelete(
    entities: Entity[],
    content: string,
    method: 'exact' | 'semantic',
    dryRun: boolean,
    options: ForgetOptions,
    similarity?: number
  ): Promise<ForgetResult> {
    const deletedObservations: { entityName: string; observation: string }[] = [];
    const deletedEntities: string[] = [];

    for (const entity of entities) {
      deletedObservations.push({ entityName: entity.name, observation: content });

      if (dryRun) continue;

      const before = { ...entity, observations: [...entity.observations] };

      await this.observationManager.deleteObservations([
        { entityName: entity.name, observations: [content] },
      ]);

      const reloaded = await this.entityManager.getEntity(entity.name);
      if (reloaded && reloaded.observations.length === 0) {
        await this.entityManager.deleteEntities([entity.name]);
        deletedEntities.push(entity.name);
      }

      if (this.auditLog) {
        await this.auditLog.append({
          operation: 'delete',
          entityName: entity.name,
          agentId: options.agentId,
          before,
          after: undefined,
          status: 'committed',
        });
      }
    }

    return {
      method,
      deletedObservations,
      deletedEntities,
      ...(similarity !== undefined && { similarity }),
    };
  }

  private async semanticFallback(
    content: string,
    options: ForgetOptions
  ): Promise<ForgetResult> {
    // Implemented in Task 3.2
    return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/features/semantic-forget-exact.test.ts && npm run typecheck`
Expected: PASS (5 tests), no type errors.

- [ ] **Step 5: Commit**

Message: `feat(features): Add SemanticForget with exact-match path`

---

### Task 3.2: Implement semantic fallback path

**Files:**
- Modify: `src/features/SemanticForget.ts`
- Test: `tests/unit/features/semantic-forget-semantic.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/semantic-forget-semantic.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { SemanticForget } from '../../../src/features/SemanticForget.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticForget semantic fallback path', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-sfs-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      {
        name: 'alice',
        entityType: 'person',
        observations: ['Resides in New York City', 'Enjoys espresso'],
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds and deletes semantically similar observation', async () => {
    const mockSearch = {
      search: vi.fn(async () => [
        { entity: { name: 'alice', observations: ['Resides in New York City', 'Enjoys espresso'] }, similarity: 0.89 },
      ]),
      calculateSimilarity: vi.fn(async (a: string, b: string) => {
        if (a === 'Lives in NYC' && b === 'Resides in New York City') return 0.91;
        if (a === 'Lives in NYC' && b === 'Enjoys espresso') return 0.05;
        return 0;
      }),
    } as unknown as SemanticSearch;

    const forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager,
      mockSearch
    );

    const result = await forget.forgetByContent('Lives in NYC', { threshold: 0.85 });
    expect(result.method).toBe('semantic');
    expect(result.deletedObservations).toHaveLength(1);
    expect(result.deletedObservations[0].observation).toBe('Resides in New York City');
    expect(result.similarity).toBeCloseTo(0.91, 2);
  });

  it('returns not_found when no observation passes threshold', async () => {
    const mockSearch = {
      search: vi.fn(async () => [
        { entity: { name: 'alice', observations: ['Resides in New York City'] }, similarity: 0.4 },
      ]),
      calculateSimilarity: vi.fn(async () => 0.4),
    } as unknown as SemanticSearch;

    const forget = new SemanticForget(
      ctx.storage,
      ctx.observationManager,
      ctx.entityManager,
      mockSearch
    );

    const result = await forget.forgetByContent('Lives in Mars', { threshold: 0.85 });
    expect(result.method).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/semantic-forget-semantic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement semanticFallback**

Replace the stub in `src/features/SemanticForget.ts`:

```typescript
  private async semanticFallback(
    content: string,
    options: ForgetOptions
  ): Promise<ForgetResult> {
    if (!this.semanticSearch) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    const threshold = options.threshold ?? 0.85;
    const graph = await this.storage.loadGraph();

    const searchResults = await this.semanticSearch.search(
      graph,
      content,
      5,
      threshold
    );

    if (searchResults.length === 0) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    let bestMatch: { entity: Entity; observation: string; similarity: number } | null = null;

    for (const result of searchResults) {
      const entity = result.entity;
      if (options.projectId !== undefined && entity.projectId !== options.projectId) {
        continue;
      }
      for (const obs of entity.observations) {
        const sim = await this.semanticSearch.calculateSimilarity(content, obs);
        if (sim >= threshold && (!bestMatch || sim > bestMatch.similarity)) {
          bestMatch = { entity, observation: obs, similarity: sim };
        }
      }
    }

    if (!bestMatch) {
      return { method: 'not_found', deletedObservations: [], deletedEntities: [] };
    }

    return this.executeDelete(
      [bestMatch.entity],
      bestMatch.observation,
      'semantic',
      options.dryRun ?? false,
      options,
      bestMatch.similarity
    );
  }
```

- [ ] **Step 4: Run test + full SemanticForget suite**

Run: `npx vitest run tests/unit/features/semantic-forget-*.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `feat(features): Implement SemanticForget semantic fallback`

---

### Task 3.3: Wire SemanticForget into ManagerContext

**Files:**
- Modify: `src/core/ManagerContext.ts`
- Modify: `src/index.ts` (add exports)
- Test: `tests/integration/core/manager-context-semantic-forget.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/core/manager-context-semantic-forget.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ManagerContext exposes SemanticForget', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-mcsf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('semanticForget getter returns a SemanticForget instance', () => {
    expect(ctx.semanticForget).toBeDefined();
    expect(typeof ctx.semanticForget.forgetByContent).toBe('function');
  });

  it('forgetByContent works via context', async () => {
    const result = await ctx.semanticForget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(1);
  });

  it('lazy getter returns same instance', () => {
    expect(ctx.semanticForget).toBe(ctx.semanticForget);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/core/manager-context-semantic-forget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add lazy getter to ManagerContext**

In `src/core/ManagerContext.ts`, add import and lazy getter alongside other feature getters:

```typescript
import { SemanticForget } from '../features/SemanticForget.js';

// in the class:
private _semanticForget?: SemanticForget;

get semanticForget(): SemanticForget {
  return (this._semanticForget ??= new SemanticForget(
    this.storage,
    this.observationManager,
    this.entityManager,
    this.semanticSearch,
    this.governanceManager?.auditLog
  ));
}
```

(Check the exact accessor for `auditLog` — may be `this.auditLog` directly or on a different manager.)

- [ ] **Step 4: Export from index.ts**

In `src/index.ts`, add alongside existing `features/*` exports:

```typescript
export { SemanticForget } from './features/SemanticForget.js';
export type { ForgetResult, ForgetOptions } from './features/SemanticForget.js';
```

- [ ] **Step 5: Run test + typecheck + full suite**

Run: `npx vitest run tests/integration/core/manager-context-semantic-forget.test.ts && npm run typecheck && SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 6: Commit**

Message: `feat(core): Expose SemanticForget via ManagerContext`

---

### Task 3.4: Phase 3 verification gate

- [ ] Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20` → all pass
- [ ] Run: `npm run typecheck` → no errors

**Phase 3 complete. Feature 3 (Semantic Forget) is shippable as v1.8.0-alpha.3.**

---

## Phase 4: Feature 4 — User Profile (Entity-Backed)

### Task 4.1: Add ProfileEntity type and guards

**Files:**
- Modify: `src/types/agent-memory.ts`
- Test: `tests/unit/types/profile-entity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types/profile-entity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isProfileEntity } from '../../../src/types/agent-memory.js';
import type { Entity } from '../../../src/types/types.js';

describe('ProfileEntity type guard', () => {
  it('identifies profile entities', () => {
    const e: Entity = {
      name: 'profile-global',
      entityType: 'profile',
      observations: ['[static] Prefers TypeScript'],
    };
    expect(isProfileEntity(e)).toBe(true);
  });

  it('rejects non-profile entities', () => {
    const e: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: [],
    };
    expect(isProfileEntity(e)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types/profile-entity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add type and guard**

In `src/types/agent-memory.ts`, near other type guards like `isSessionEntity`:

```typescript
import type { Entity } from './types.js';

/**
 * Profile entity: Entity with entityType='profile'.
 * Observations are prefixed [static] or [dynamic] to classify facts.
 */
export interface ProfileEntity extends Entity {
  entityType: 'profile';
}

/** Type guard for profile entities. */
export function isProfileEntity(entity: Entity): entity is ProfileEntity {
  return entity.entityType === 'profile';
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/types/profile-entity.test.ts`
Expected: PASS.

Message: `feat(types): Add ProfileEntity type and isProfileEntity guard`

---

### Task 4.2: Reserve profile-* namespace in EntityManager

**Files:**
- Modify: `src/core/EntityManager.ts`
- Test: `tests/unit/core/entity-manager-profile-namespace.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/entity-manager-profile-namespace.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ValidationError } from '../../../src/utils/errors.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager reserves profile-* namespace', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pn-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when user creates non-profile entity with profile-* name', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-myproject', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow(ValidationError);
  });

  it('allows entities with entityType=profile in the reserved namespace', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-global', entityType: 'profile', observations: [] },
      ])
    ).resolves.toBeDefined();
  });

  it('allows non-matching names', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'alice', entityType: 'person', observations: [] },
      ])
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-profile-namespace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add namespace check**

In `src/core/EntityManager.ts`, in `createEntities` after input validation:

```typescript
    for (const e of input) {
      if (e.name.startsWith('profile-') && e.entityType !== 'profile') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the profile system. ` +
          `Use entityType='profile' or choose a different name.`
        );
      }
    }
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/core/entity-manager-profile-namespace.test.ts`
Expected: PASS.

Message: `feat(core): Reserve profile-* entity namespace`

---

### Task 4.3: Create ProfileManager (getProfile + addFact + promoteFact)

**Files:**
- Create: `src/agent/ProfileManager.ts`
- Test: `tests/unit/agent/profile-manager-basics.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent/profile-manager-basics.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager basics', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let pm: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      undefined,
      undefined,
      {}
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty profile when entity does not exist', async () => {
    const result = await pm.getProfile();
    expect(result.static).toEqual([]);
    expect(result.dynamic).toEqual([]);
    expect(result.entityName).toBe('profile-global');
  });

  it('addFact creates profile entity if missing', async () => {
    await pm.addFact('Prefers TypeScript', 'static');
    const entity = await ctx.entityManager.getEntity('profile-global');
    expect(entity).toBeDefined();
    expect(entity!.entityType).toBe('profile');
    expect(entity!.observations).toContain('[static] Prefers TypeScript');
  });

  it('getProfile parses static/dynamic prefixes', async () => {
    await pm.addFact('Stable fact', 'static');
    await pm.addFact('Recent fact', 'dynamic');
    const result = await pm.getProfile();
    expect(result.static).toEqual(['Stable fact']);
    expect(result.dynamic).toEqual(['Recent fact']);
  });

  it('uses sanitized projectId in entity name', async () => {
    await pm.addFact('Fact', 'static', { projectId: 'My Project!' });
    const entity = await ctx.entityManager.getEntity('profile-my-project-');
    expect(entity).toBeDefined();
  });

  it('isolates profiles by project', async () => {
    await pm.addFact('Global fact', 'static');
    await pm.addFact('Project fact', 'static', { projectId: 'p1' });

    const global = await pm.getProfile();
    const scoped = await pm.getProfile({ projectId: 'p1' });

    expect(global.static).toEqual(['Global fact']);
    expect(scoped.static).toEqual(['Project fact']);
  });

  it('promoteFact moves dynamic to static', async () => {
    await pm.addFact('Growing fact', 'dynamic');
    await pm.promoteFact('Growing fact');
    const result = await pm.getProfile();
    expect(result.dynamic).not.toContain('Growing fact');
    expect(result.static).toContain('Growing fact');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/profile-manager-basics.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create ProfileManager**

Create `src/agent/ProfileManager.ts`:

```typescript
/**
 * Profile Manager
 *
 * Manages user profiles stored as Entity instances with entityType 'profile'.
 * Observations are tagged [static] or [dynamic] to classify facts.
 *
 * @module agent/ProfileManager
 */

import type { GraphStorage } from '../core/GraphStorage.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { ObservationManager } from '../core/ObservationManager.js';
import type { SessionManager } from './SessionManager.js';
import type { SalienceEngine } from './SalienceEngine.js';

const STATIC_PREFIX = '[static] ';
const DYNAMIC_PREFIX = '[dynamic] ';

export interface ProfileResponse {
  static: string[];
  dynamic: string[];
  entityName: string;
}

export interface ProfileManagerConfig {
  staticThreshold?: number;
  dynamicRecencyThreshold?: number;
  maxDynamicFacts?: number;
  autoExtract?: boolean;
}

export interface ProfileOptions {
  projectId?: string;
  agentId?: string;
}

export class ProfileManager {
  constructor(
    private storage: GraphStorage,
    private entityManager: EntityManager,
    private observationManager: ObservationManager,
    private sessionManager?: SessionManager,
    private salienceEngine?: SalienceEngine,
    private config: ProfileManagerConfig = {}
  ) {}

  getProfileEntityName(projectId?: string): string {
    if (!projectId) return 'profile-global';
    const sanitized = projectId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `profile-${sanitized}`;
  }

  async getProfile(options: ProfileOptions = {}): Promise<ProfileResponse> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);

    if (!entity) {
      return { static: [], dynamic: [], entityName };
    }

    const staticFacts: string[] = [];
    const dynamicFacts: string[] = [];

    for (const obs of entity.observations) {
      if (obs.startsWith(STATIC_PREFIX)) {
        staticFacts.push(obs.slice(STATIC_PREFIX.length));
      } else if (obs.startsWith(DYNAMIC_PREFIX)) {
        dynamicFacts.push(obs.slice(DYNAMIC_PREFIX.length));
      }
    }

    return { static: staticFacts, dynamic: dynamicFacts, entityName };
  }

  async addFact(
    content: string,
    type: 'static' | 'dynamic',
    options: ProfileOptions = {}
  ): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const prefix = type === 'static' ? STATIC_PREFIX : DYNAMIC_PREFIX;
    const prefixed = prefix + content;

    const existing = await this.entityManager.getEntity(entityName);
    if (!existing) {
      await this.entityManager.createEntities([
        {
          name: entityName,
          entityType: 'profile',
          observations: [prefixed],
          importance: 10,
          projectId: options.projectId,
        },
      ]);
      return;
    }

    if (existing.observations.includes(prefixed)) return;

    await this.observationManager.addObservations([
      { entityName, contents: [prefixed] },
    ]);

    if (type === 'dynamic') {
      await this.trimDynamicFacts(entityName);
    }
  }

  async promoteFact(content: string, options: ProfileOptions = {}): Promise<void> {
    const entityName = this.getProfileEntityName(options.projectId);
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicTagged = DYNAMIC_PREFIX + content;
    if (!entity.observations.includes(dynamicTagged)) return;

    await this.observationManager.deleteObservations([
      { entityName, observations: [dynamicTagged] },
    ]);
    await this.observationManager.addObservations([
      { entityName, contents: [STATIC_PREFIX + content] },
    ]);
  }

  private async trimDynamicFacts(entityName: string): Promise<void> {
    const max = this.config.maxDynamicFacts ?? 20;
    const entity = await this.entityManager.getEntity(entityName);
    if (!entity) return;

    const dynamicFacts = entity.observations.filter(o => o.startsWith(DYNAMIC_PREFIX));
    if (dynamicFacts.length <= max) return;

    const toRemove = dynamicFacts.slice(0, dynamicFacts.length - max);
    await this.observationManager.deleteObservations([
      { entityName, observations: toRemove },
    ]);
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/unit/agent/profile-manager-basics.test.ts && npm run typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

Message: `feat(agent): Add ProfileManager with getProfile/addFact/promoteFact`

---

### Task 4.4: Add session-based fact extraction

**Files:**
- Modify: `src/agent/ProfileManager.ts`
- Test: `tests/unit/agent/profile-manager-extraction.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/agent/profile-manager-extraction.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ProfileManager } from '../../../src/agent/ProfileManager.js';
import type { SessionManager } from '../../../src/agent/SessionManager.js';
import type { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProfileManager.extractFromSession', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pme-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies high-importance low-recency facts as static', async () => {
    const mockSession = {
      getSession: vi.fn(async () => ({
        id: 'sess-1',
        observations: ['User prefers TypeScript', 'Currently debugging auth'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async (obs: string) => {
        if (obs === 'User prefers TypeScript') {
          return { components: { baseImportance: 0.8, recencyBoost: 0.1 } };
        }
        return { components: { baseImportance: 0.3, recencyBoost: 0.7 } };
      }),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience,
      { staticThreshold: 0.6, dynamicRecencyThreshold: 0.5 }
    );

    await pm.extractFromSession('sess-1');
    const profile = await pm.getProfile();
    expect(profile.static).toContain('User prefers TypeScript');
    expect(profile.dynamic).toContain('Currently debugging auth');
  });

  it('dedupes against existing profile facts', async () => {
    const mockSession = {
      getSession: vi.fn(async () => ({
        id: 'sess-1',
        observations: ['Fact A'],
      })),
    } as unknown as SessionManager;

    const mockSalience = {
      calculateSalience: vi.fn(async () => ({
        components: { baseImportance: 0.8, recencyBoost: 0.1 },
      })),
    } as unknown as SalienceEngine;

    const pm = new ProfileManager(
      ctx.storage,
      ctx.entityManager,
      ctx.observationManager,
      mockSession,
      mockSalience
    );

    await pm.addFact('Fact A', 'static');
    await pm.extractFromSession('sess-1');

    const profile = await pm.getProfile();
    expect(profile.static.filter(f => f === 'Fact A')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/agent/profile-manager-extraction.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement extractFromSession**

Add to `src/agent/ProfileManager.ts`:

```typescript
  async extractFromSession(sessionId: string): Promise<string[]> {
    if (!this.sessionManager || !this.salienceEngine) {
      return [];
    }

    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return [];

    const observations = (session as any).observations ?? [];
    const staticThreshold = this.config.staticThreshold ?? 0.6;
    const dynamicRecencyThreshold = this.config.dynamicRecencyThreshold ?? 0.5;

    const existing = await this.getProfile();
    const existingSet = new Set([...existing.static, ...existing.dynamic]);

    const added: string[] = [];
    for (const obs of observations) {
      if (existingSet.has(obs)) continue;

      const salience = await this.salienceEngine.calculateSalience(obs, {
        temporalFocus: 'recent' as any,
      });
      const components = (salience as any).components ?? {};
      const baseImportance = components.baseImportance ?? 0;
      const recencyBoost = components.recencyBoost ?? 0;

      let type: 'static' | 'dynamic';
      if (baseImportance >= staticThreshold && recencyBoost < 0.2) {
        type = 'static';
      } else if (recencyBoost >= dynamicRecencyThreshold) {
        type = 'dynamic';
      } else {
        continue;
      }

      await this.addFact(obs, type);
      added.push(obs);
    }

    return added;
  }
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/agent/profile-manager-extraction.test.ts`
Expected: PASS (2 tests).

Message: `feat(agent): Add ProfileManager.extractFromSession`

---

### Task 4.5: Wire ProfileManager into AgentMemoryManager

**Files:**
- Modify: `src/agent/AgentMemoryManager.ts`
- Modify: `src/agent/AgentMemoryConfig.ts`
- Modify: `src/index.ts` (add exports)
- Test: `tests/integration/agent/agent-memory-manager-profile.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/agent/agent-memory-manager-profile.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentMemoryManager exposes ProfileManager', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-amm-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('profileManager getter returns a ProfileManager instance', () => {
    const amm = ctx.agentMemory();
    expect(amm.profileManager).toBeDefined();
    expect(typeof amm.profileManager.getProfile).toBe('function');
  });

  it('getProfile works via facade', async () => {
    const amm = ctx.agentMemory();
    await amm.profileManager.addFact('Prefers TypeScript', 'static');
    const profile = await amm.profileManager.getProfile();
    expect(profile.static).toContain('Prefers TypeScript');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/agent/agent-memory-manager-profile.test.ts`
Expected: FAIL — `profileManager` getter does not exist.

- [ ] **Step 3: Add config slice**

In `src/agent/AgentMemoryConfig.ts`:

```typescript
import type { ProfileManagerConfig } from './ProfileManager.js';

// In the AgentMemoryConfig interface:
profile?: ProfileManagerConfig;
```

- [ ] **Step 4: Add ProfileManager getter in AgentMemoryManager**

In `src/agent/AgentMemoryManager.ts`:

```typescript
import { ProfileManager } from './ProfileManager.js';

// Alongside other private lazy fields (around line 145):
private _profileManager?: ProfileManager;

// Alongside other getters (around line 278):
get profileManager(): ProfileManager {
  return (this._profileManager ??= new ProfileManager(
    this.storage,
    this.entityManager,
    this.observationManager,
    this.sessionManager,
    this.salienceEngine,
    this.config.profile ?? {}
  ));
}
```

Note: `AgentMemoryManager` needs references to `entityManager` and `observationManager`. If these are not already accessible via `this.storage` context, add them as constructor parameters from `ManagerContext`.

- [ ] **Step 5: Add session:ended auto-extract hook**

In `src/agent/AgentMemoryManager.ts`, in the constructor (after event emitter setup):

```typescript
  private wireProfileAutoExtract(): void {
    if (this.config.profile?.autoExtract === false) return;
    this.on('session:ended', async (session: any) => {
      try {
        await this.profileManager.extractFromSession(session.id);
      } catch (err) {
        console.error('ProfileManager auto-extract failed:', err);
      }
    });
  }
```

Call `this.wireProfileAutoExtract()` at the end of the constructor.

- [ ] **Step 6: Export ProfileManager from index.ts**

In `src/index.ts`:

```typescript
export { ProfileManager } from './agent/ProfileManager.js';
export type { ProfileResponse, ProfileManagerConfig, ProfileOptions } from './agent/ProfileManager.js';
export { isProfileEntity } from './types/agent-memory.js';
export type { ProfileEntity } from './types/agent-memory.js';
```

- [ ] **Step 7: Run test + typecheck**

Run: `npx vitest run tests/integration/agent/agent-memory-manager-profile.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

Message: `feat(agent): Wire ProfileManager into AgentMemoryManager facade`

---

### Task 4.6: Phase 4 verification gate

- [ ] Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -30` → all pass, ~50+ new tests
- [ ] Run: `npm run typecheck` → no errors
- [ ] Run: `npm run build` → builds cleanly (ESM + CJS + CLI + workers)
- [ ] Run: `git log --oneline -30` → ~20 commits since baseline

**Phase 4 complete. Feature 4 (User Profile) is shippable as v1.8.0-alpha.4.**

---

## Phase 5: Release Prep

### Task 5.1: Update CHANGELOG and bump version

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`

- [ ] **Step 1: Bump version**

In `package.json`, change `"version"` to `"1.8.0"`.

- [ ] **Step 2: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, add:

```markdown
## [1.8.0] - 2026-04-09

### Added
- **Project Scoping** — `projectId` field on Entity enables multi-tenant/project isolation. `SearchFilterChain` propagates project filter to all search methods. `ManagerContext` accepts `defaultProjectId` option for auto-stamping. New `EntityManager.listProjects()` method.
- **Memory Versioning** — Version chain fields on Entity (`version`, `parentEntityName`, `rootEntityName`, `isLatest`, `supersededBy`). New `ContradictionDetector` uses semantic similarity (default 0.85) to detect contradicting observations. On contradiction, creates a new entity version via `supersede()`. `EntityManager.getVersionChain()` and `getLatestVersion()` navigate chains. `CompressionManager` guards against merging superseded entities. Opt-in via `enableContradictionDetection` option.
- **Semantic Forget** — New `SemanticForget` class with `forgetByContent()` method. Two-tier deletion: exact match first, then semantic search fallback. Supports `dryRun`, `projectId` scoping, audit logging. Auto-deletes entities with zero remaining observations.
- **User Profile** — New `ProfileManager` class via `AgentMemoryManager.profileManager`. Profiles stored as Entity with `entityType='profile'` and observations tagged `[static]`/`[dynamic]`. Auto-extraction from session observations using `SalienceEngine` classification. Project-scoped profiles via sanitized entity names. New `ProfileEntity` type and `isProfileEntity()` guard.

### Changed
- `Entity` gains 6 optional fields. All backwards-compatible.
- `ManagerContext` constructor now accepts either a string path (legacy) or an options object.
- `SearchFilterChain` excludes superseded entity versions by default. Use `includeSuperseded: true` to see version history.
- `EntityManager.createEntities` throws `ValidationError` when a non-profile entity uses a `profile-*` name.

### Storage
- SQLite: Added new columns and indexes. Existing databases are migrated additively via ALTER TABLE ADD COLUMN.
- JSONL: New fields serialized alongside existing optional fields.

### Related
- Design spec: `docs/superpowers/specs/2026-04-09-supermemory-gap-closing-design.md`
- Gap analysis: `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`
```

- [ ] **Step 3: Update gap analysis status**

In `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`, update the "Recommended Implementation Order" table. For rows #1-#4 (Profile, Semantic Forget, Versioning, Project Scoping), change Status column from "Not started" to "✅ v1.8.0".

- [ ] **Step 4: Final verification**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20 && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

Message:

```
chore(release): Bump version to 1.8.0

Sprint 1 supermemory gap-closing complete:
- Project Scoping
- Memory Versioning / Contradiction Resolution
- Semantic Forget
- User Profile (Entity-backed)
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every section of the design spec has a task. Phase 0 = Entity model. Phase 1 = Project Scoping. Phase 2 = Memory Versioning. Phase 3 = Semantic Forget. Phase 4 = User Profile. Phase 5 = Release prep.
- [ ] **No placeholders:** Every code step has actual code. No "TBD" or "TODO".
- [ ] **Type consistency:** `Contradiction[]` in Task 2.1 matches usage in 2.2 and 2.4. `ForgetResult` stable from 3.1. `ProfileResponse` stable from 4.3.
- [ ] **TDD:** Every task has Test → Fail → Implement → Pass → Commit.
- [ ] **Frequent commits:** ~20 commits across the plan, one per task.
- [ ] **YAGNI:** No features beyond the spec.
- [ ] **Feature-vertical:** Phases 1-4 each independently shippable as v1.8.0-alpha.N.

