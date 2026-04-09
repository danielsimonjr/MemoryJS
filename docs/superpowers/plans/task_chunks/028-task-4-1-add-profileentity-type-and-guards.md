### Task 4.1: Add ProfileEntity type and guards

**Files:**
- Modify: `src/types/agent-memory.ts`
- Test: `tests/unit/types/profile-entity.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types/profile-entity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isProfileEntity } from '../../../src/types/agent-memory.js';
import type { Entity } from '../../../src/types/types.js';

describe('ProfileEntity type guard', () => {
  it('identifies profile entities', () => {
    const e: Entity = {
      name: 'profile-global',
      entityType: 'profile',
      observations: ['[static] Prefers TypeScript'],
    };
    expect(isProfileEntity(e)).toBe(true);
  });

  it('rejects non-profile entities', () => {
    const e: Entity = {
      name: 'alice',
      entityType: 'person',
      observations: [],
    };
    expect(isProfileEntity(e)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types/profile-entity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add type and guard**

In `src/types/agent-memory.ts`, near other type guards like `isSessionEntity`:

```typescript
import type { Entity } from './types.js';

/**
 * Profile entity: Entity with entityType='profile'.
 * Observations are prefixed [static] or [dynamic] to classify facts.
 */
export interface ProfileEntity extends Entity {
  entityType: 'profile';
}

/** Type guard for profile entities. */
export function isProfileEntity(entity: Entity): entity is ProfileEntity {
  return entity.entityType === 'profile';
}
```

- [ ] **Step 4: Run test + commit**

Run: `npx vitest run tests/unit/types/profile-entity.test.ts`
Expected: PASS.

Message: `feat(types): Add ProfileEntity type and isProfileEntity guard`

---
