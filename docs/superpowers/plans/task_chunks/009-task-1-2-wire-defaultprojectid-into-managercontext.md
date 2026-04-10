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
