### Task 0.3: Update SQLiteStorage to persist new fields

**Files:**
- Modify: `src/core/SQLiteStorage.ts` (schema, migration, INSERT/UPDATE bindings)
- Test: `tests/integration/storage/sqlite-storage-new-fields.test.ts` (create)

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/storage/sqlite-storage-new-fields.test.ts`
Expected: FAIL — columns do not exist in schema.

- [x] **Step 3: Update schema in `createTables()`**

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

- [x] **Step 4: Add migration method**

Add a private `migrateEntitiesTable()` method that uses PRAGMA table_info to detect existing columns, then issues ALTER TABLE ADD COLUMN for any missing columns from the list in Step 3. Call it from the constructor after `createTables()`.

Reference: the existing `migrateRelationsTable` method in the same file shows the exact pattern to follow.

- [x] **Step 5: Update INSERT/UPDATE prepared statements**

Find all `INSERT INTO entities` and `UPDATE entities SET` prepared statements. Add the new columns to the column list and bind parameters with these values:

```typescript
entity.projectId ?? null,
entity.version ?? 1,
entity.parentEntityName ?? null,
entity.rootEntityName ?? null,
entity.isLatest === false ? 0 : 1,
entity.supersededBy ?? null,
```

- [x] **Step 6: Update row-to-Entity mapper**

Find the private method that maps a DB row to an Entity. Add:

```typescript
if (row.projectId != null) entity.projectId = row.projectId;
if (row.version != null) entity.version = row.version;
if (row.parentEntityName != null) entity.parentEntityName = row.parentEntityName;
if (row.rootEntityName != null) entity.rootEntityName = row.rootEntityName;
if (row.isLatest != null) entity.isLatest = row.isLatest === 1;
if (row.supersededBy != null) entity.supersededBy = row.supersededBy;
```

- [x] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/integration/storage/sqlite-storage-new-fields.test.ts`
Expected: PASS (3 tests).

- [x] **Step 8: Run full SQLite test suite + typecheck**

Run: `npx vitest run tests/integration/storage/ && npm run typecheck`
Expected: all tests pass, no typecheck errors.

- [x] **Step 9: Commit**

Message:

```
feat(storage): Persist new v1.8.0 Entity fields in SQLite

Adds columns, indexes, and migration for projectId and version
chain fields. Existing databases are migrated additively via
ALTER TABLE ADD COLUMN.
```

---
