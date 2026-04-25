### Task 1.3: Auto-stamp projectId on entity creation

**Files:**
- Modify: `src/core/EntityManager.ts`
- Modify: `src/core/ManagerContext.ts` (pass option to EntityManager constructor)
- Test: `tests/unit/core/entity-manager-project-stamping.test.ts` (create)

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-project-stamping.test.ts`
Expected: FAIL.

- [x] **Step 3: Accept options in EntityManager constructor**

In `src/core/EntityManager.ts`:
- Add exported `EntityManagerOptions` interface with `defaultProjectId?: string`
- Add optional second constructor parameter `options?: EntityManagerOptions`
- Store `this.defaultProjectId = options?.defaultProjectId`

- [x] **Step 4: Pass the option from ManagerContext**

In `src/core/ManagerContext.ts`, update the `entityManager` lazy getter to pass `{ defaultProjectId: this.defaultProjectId }` as the second argument to the EntityManager constructor.

- [x] **Step 5: Stamp projectId in createEntities**

In `src/core/EntityManager.ts`, in `createEntities` around line 190, inside the loop that builds new entities (around line 232), before pushing to `newEntities`:

```typescript
      if (entity.projectId === undefined && this.defaultProjectId !== undefined) {
        entity.projectId = this.defaultProjectId;
      }
```

- [x] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/entity-manager-project-stamping.test.ts`
Expected: PASS (3 tests).

- [x] **Step 7: Run full EntityManager test suite + typecheck**

Run: `npx vitest run tests/unit/core/EntityManager.test.ts && npm run typecheck`
Expected: all tests pass, no errors.

- [x] **Step 8: Commit**

Message: `feat(core): Auto-stamp projectId on entity creation`

---
