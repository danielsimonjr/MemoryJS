## Task 1: Add `invalidateRelation` to RelationManager

**Files:**
- Modify: `src/core/RelationManager.ts`
- Test: `tests/unit/core/relation-manager-temporal.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/relation-manager-temporal.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('RelationManager.invalidateRelation', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-rt-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'kai', entityType: 'person', observations: [] },
      { name: 'orion', entityType: 'project', observations: [] },
    ]);
    await ctx.relationManager.createRelations([
      {
        from: 'kai',
        to: 'orion',
        relationType: 'works_on',
        properties: { validFrom: '2025-06-01' },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets validUntil on matching active relation', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBe('2026-03-01');
  });

  it('defaults ended to current ISO timestamp', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion');
    const rels = await ctx.relationManager.getRelations('kai');
    const r = rels.find(r => r.relationType === 'works_on');
    expect(r?.properties?.validUntil).toBeDefined();
    expect(r?.properties?.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws when no active relation found', async () => {
    await ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-03-01');
    await expect(
      ctx.relationManager.invalidateRelation('kai', 'works_on', 'orion', '2026-04-01')
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`

- [ ] **Step 3: Implement invalidateRelation**

Add to `src/core/RelationManager.ts`:

```typescript
  /**
   * Mark a relation as no longer valid by setting properties.validUntil.
   * Finds the matching active relation (no validUntil set) and stamps it.
   */
  async invalidateRelation(
    from: string,
    relationType: string,
    to: string,
    ended?: string
  ): Promise<void> {
    const graph = await this.storage.loadGraph();
    const match = graph.relations.find(
      r =>
        r.from === from &&
        r.relationType === relationType &&
        r.to === to &&
        !r.properties?.validUntil
    );
    if (!match) {
      throw new Error(
        `No active relation found: ${from} -[${relationType}]-> ${to}`
      );
    }
    if (!match.properties) {
      match.properties = {};
    }
    match.properties.validUntil = ended ?? new Date().toISOString();
    match.lastModified = new Date().toISOString();
    await this.storage.saveGraph(graph);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/relation-manager-temporal.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```
feat(core): Add RelationManager.invalidateRelation()

Marks a relation as no longer valid by setting properties.validUntil.
Temporal KG convenience method inspired by mempalace's KG.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
