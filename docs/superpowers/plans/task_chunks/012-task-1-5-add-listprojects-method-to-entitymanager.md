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
