### Task 3.3: Wire SemanticForget into ManagerContext

**Files:**
- Modify: `src/core/ManagerContext.ts`
- Modify: `src/index.ts` (add exports)
- Test: `tests/integration/core/manager-context-semantic-forget.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/core/manager-context-semantic-forget.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ManagerContext exposes SemanticForget', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-mcsf-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    await ctx.entityManager.createEntities([
      { name: 'alice', entityType: 'person', observations: ['Lives in NYC'] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('semanticForget getter returns a SemanticForget instance', () => {
    expect(ctx.semanticForget).toBeDefined();
    expect(typeof ctx.semanticForget.forgetByContent).toBe('function');
  });

  it('forgetByContent works via context', async () => {
    const result = await ctx.semanticForget.forgetByContent('Lives in NYC');
    expect(result.method).toBe('exact');
    expect(result.deletedObservations).toHaveLength(1);
  });

  it('lazy getter returns same instance', () => {
    expect(ctx.semanticForget).toBe(ctx.semanticForget);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/core/manager-context-semantic-forget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add lazy getter to ManagerContext**

In `src/core/ManagerContext.ts`, add import and lazy getter alongside other feature getters:

```typescript
import { SemanticForget } from '../features/SemanticForget.js';

// in the class:
private _semanticForget?: SemanticForget;

get semanticForget(): SemanticForget {
  return (this._semanticForget ??= new SemanticForget(
    this.storage,
    this.observationManager,
    this.entityManager,
    this.semanticSearch,
    this.governanceManager?.auditLog
  ));
}
```

(Check the exact accessor for `auditLog` — may be `this.auditLog` directly or on a different manager.)

- [ ] **Step 4: Export from index.ts**

In `src/index.ts`, add alongside existing `features/*` exports:

```typescript
export { SemanticForget } from './features/SemanticForget.js';
export type { ForgetResult, ForgetOptions } from './features/SemanticForget.js';
```

- [ ] **Step 5: Run test + typecheck + full suite**

Run: `npx vitest run tests/integration/core/manager-context-semantic-forget.test.ts && npm run typecheck && SKIP_BENCHMARKS=true npm test 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 6: Commit**

Message: `feat(core): Expose SemanticForget via ManagerContext`

---
