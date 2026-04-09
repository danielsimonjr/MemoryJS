### Task 4.2: Reserve profile-* namespace in EntityManager

**Files:**
- Modify: `src/core/EntityManager.ts`
- Test: `tests/unit/core/entity-manager-profile-namespace.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/entity-manager-profile-namespace.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ValidationError } from '../../../src/utils/errors.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('EntityManager reserves profile-* namespace', () => {
  let tmpDir: string;
  let ctx: ManagerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-pn-test-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws when user creates non-profile entity with profile-* name', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-myproject', entityType: 'person', observations: [] },
      ])
    ).rejects.toThrow(ValidationError);
  });

  it('allows entities with entityType=profile in the reserved namespace', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'profile-global', entityType: 'profile', observations: [] },
      ])
    ).resolves.toBeDefined();
  });

  it('allows non-matching names', async () => {
    await expect(
      ctx.entityManager.createEntities([
        { name: 'alice', entityType: 'person', observations: [] },
      ])
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/entity-manager-profile-namespace.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add namespace check**

In `src/core/EntityManager.ts`, in `createEntities` after input validation:

```typescript
    for (const e of input) {
      if (e.name.startsWith('profile-') && e.entityType !== 'profile') {
        throw new ValidationError(
          `Entity name '${e.name}' is reserved for the profile system. ` +
          `Use entityType='profile' or choose a different name.`
        );
      }
    }
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/core/entity-manager-profile-namespace.test.ts`
Expected: PASS.

Message: `feat(core): Reserve profile-* entity namespace`

---
