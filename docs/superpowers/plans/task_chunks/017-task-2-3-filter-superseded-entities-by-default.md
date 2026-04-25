### Task 2.3: Filter superseded entities by default

**Files:**
- Modify: `src/search/SearchFilterChain.ts`
- Test: `tests/unit/search/search-filter-chain-versioning.test.ts` (create)

- [x] **Step 1: Write the failing test**

Create `tests/unit/search/search-filter-chain-versioning.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SearchFilterChain } from '../../../src/search/SearchFilterChain.js';
import type { Entity } from '../../../src/types/types.js';

const makeEntity = (name: string, isLatest: boolean | undefined): Entity => ({
  name,
  entityType: 'thing',
  observations: [],
  isLatest,
});

describe('SearchFilterChain default versioning behavior', () => {
  const entities: Entity[] = [
    makeEntity('a', true),
    makeEntity('b', false),
    makeEntity('c', undefined),
    makeEntity('d', true),
  ];

  it('excludes superseded entities by default', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    const names = result.map(e => e.name).sort();
    expect(names).toEqual(['a', 'c', 'd']);
    expect(names).not.toContain('b');
  });

  it('includeSuperseded=true returns all', () => {
    const result = SearchFilterChain.applyFilters(entities, {
      includeSuperseded: true,
    });
    expect(result.map(e => e.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('legacy entities (isLatest undefined) are included by default', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    expect(result.map(e => e.name)).toContain('c');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/search/search-filter-chain-versioning.test.ts`
Expected: FAIL.

- [x] **Step 3: Add includeSuperseded to SearchFilters interface**

In `src/search/SearchFilterChain.ts`, add to `SearchFilters`:

```typescript
  /** Include superseded entity versions. Default false. */
  includeSuperseded?: boolean;
```

- [x] **Step 4: Add versioning check in entityPassesFilters**

Before the final `return true;`:

```typescript
    // Versioning filter: exclude superseded entities by default
    if (!filters.includeSuperseded && entity.isLatest === false) {
      return false;
    }

    return true;
```

- [x] **Step 5: Remove the early-return optimization in applyFilters**

The early-return based on `hasActiveFilters` must not skip the versioning filter. Simplest fix: always run the filter loop:

```typescript
  static applyFilters(entities: readonly Entity[], filters: SearchFilters): Entity[] {
    const normalizedSearchTags = filters.tags?.length
      ? normalizeTags(filters.tags)
      : undefined;

    return entities.filter(entity =>
      this.entityPassesFilters(entity, filters, normalizedSearchTags)
    );
  }
```

- [x] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/search/search-filter-chain-versioning.test.ts`
Expected: PASS (3 tests).

- [x] **Step 7: Run full search test suite**

Run: `npx vitest run tests/unit/search/`
Expected: all tests pass.

- [x] **Step 8: Commit**

Message: `feat(search): Filter superseded entity versions by default`

---
