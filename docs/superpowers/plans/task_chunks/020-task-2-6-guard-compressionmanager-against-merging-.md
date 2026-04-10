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
