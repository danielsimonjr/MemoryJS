### Task 1.4: Propagate projectId through SearchManager + integration test

**Files:**
- Modify: `src/search/SearchManager.ts`
- Test: `tests/integration/search/project-scope-isolation.test.ts` (create)

- [x] **Step 1: Write the failing test**

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

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/search/project-scope-isolation.test.ts`
Expected: FAIL — search methods don't accept `projectId` in options yet.

- [x] **Step 3: Add projectId to SearchManager options and thread through**

In `src/search/SearchManager.ts`:
- Add `projectId?: string` to `SearchOptionsWithTracking` (or the corresponding options type used by search methods)
- In `searchNodes`, `searchNodesRanked`, `booleanSearch`, `fuzzySearch`: where a `SearchFilters` object is constructed from options, include `projectId: options?.projectId`

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/search/project-scope-isolation.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Run full test suite**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all tests pass.

- [x] **Step 6: Commit**

Message: `feat(search): Propagate projectId through all SearchManager methods`

---
