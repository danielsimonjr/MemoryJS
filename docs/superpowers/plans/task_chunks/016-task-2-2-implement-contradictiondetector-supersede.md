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
