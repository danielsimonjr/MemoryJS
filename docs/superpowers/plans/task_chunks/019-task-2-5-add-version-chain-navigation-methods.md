### Task 2.5: Add version chain navigation methods

**Files:**
- Modify: `src/core/EntityManager.ts`
- Test: `tests/unit/core/entity-manager-version-chain.test.ts` (create)

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-version-chain.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement methods**

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

- [x] **Step 4: Run test + typecheck + commit**

Run: `npx vitest run tests/unit/core/entity-manager-version-chain.test.ts && npm run typecheck`
Expected: PASS.

Message: `feat(core): Add getVersionChain and getLatestVersion`

---
