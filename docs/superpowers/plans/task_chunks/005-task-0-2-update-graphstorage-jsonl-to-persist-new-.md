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
