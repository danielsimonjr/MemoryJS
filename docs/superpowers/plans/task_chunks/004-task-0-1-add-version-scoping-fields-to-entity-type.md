### Task 0.1: Add version + scoping fields to Entity type

**Files:**
- Modify: `src/types/types.ts` (Entity interface, around line 88)
- Test: `tests/unit/types/entity-new-fields.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types/entity-new-fields.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Entity } from '../../../src/types/types.js';

describe('Entity new fields (v1.8.0)', () => {
  it('accepts projectId field', () => {
    const e: Entity = {
      name: 'test',
      entityType: 'thing',
      observations: [],
      projectId: 'proj-1',
    };
    expect(e.projectId).toBe('proj-1');
  });

  it('accepts version chain fields', () => {
    const e: Entity = {
      name: 'test-v2',
      entityType: 'thing',
      observations: [],
      version: 2,
      parentEntityName: 'test',
      rootEntityName: 'test',
      isLatest: true,
    };
    expect(e.version).toBe(2);
    expect(e.parentEntityName).toBe('test');
    expect(e.rootEntityName).toBe('test');
    expect(e.isLatest).toBe(true);
  });

  it('accepts supersededBy field', () => {
    const e: Entity = {
      name: 'old',
      entityType: 'thing',
      observations: [],
      isLatest: false,
      supersededBy: 'new',
    };
    expect(e.supersededBy).toBe('new');
    expect(e.isLatest).toBe(false);
  });

  it('allows all new fields to be omitted (back-compat)', () => {
    const e: Entity = {
      name: 'legacy',
      entityType: 'thing',
      observations: [],
    };
    expect(e.projectId).toBeUndefined();
    expect(e.version).toBeUndefined();
    expect(e.isLatest).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types/entity-new-fields.test.ts`
Expected: FAIL with TypeScript errors about unknown properties.

- [ ] **Step 3: Add fields to Entity interface**

In `src/types/types.ts`, after the `expiresAt?: string;` field (around line 87), add:

```typescript
  // ==================== v1.8.0: Project Scoping ====================

  /** Project/container scope identifier. Undefined = global/unscoped. */
  projectId?: string;

  // ==================== v1.8.0: Memory Versioning ====================

  /** Version number in the contradiction-resolution chain. Starts at 1. */
  version?: number;

  /** Name of the immediate parent version (previous version). */
  parentEntityName?: string;

  /** Name of the root entity in the version chain. */
  rootEntityName?: string;

  /** Whether this is the latest version in its chain. Default: true. */
  isLatest?: boolean;

  /** Name of the entity that superseded this one. */
  supersededBy?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/types/entity-new-fields.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

Stage `src/types/types.ts` and `tests/unit/types/entity-new-fields.test.ts`, commit with message:

```
feat(types): Add projectId and version chain fields to Entity

Adds optional fields for v1.8.0 Sprint 1 features:
- projectId: project scoping (Feature 1)
- version, parentEntityName, rootEntityName, isLatest, supersededBy:
  memory versioning (Feature 2)

All fields are optional for backwards compatibility.
```

---
