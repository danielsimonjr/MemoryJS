### Task 1.1: Add projectId to SearchFilterChain

**Files:**
- Modify: `src/search/SearchFilterChain.ts`
- Test: `tests/unit/search/search-filter-chain-project.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/search/search-filter-chain-project.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SearchFilterChain } from '../../../src/search/SearchFilterChain.js';
import type { Entity } from '../../../src/types/types.js';

const E = (name: string, projectId?: string): Entity => ({
  name,
  entityType: 'thing',
  observations: [],
  projectId,
});

describe('SearchFilterChain projectId filter', () => {
  const entities: Entity[] = [
    E('a', 'proj-1'),
    E('b', 'proj-2'),
    E('c', undefined),
    E('d', 'proj-1'),
  ];

  it('returns only entities in the specified project', () => {
    const result = SearchFilterChain.applyFilters(entities, { projectId: 'proj-1' });
    expect(result.map(e => e.name)).toEqual(['a', 'd']);
  });

  it('excludes global entities when projectId is set', () => {
    const result = SearchFilterChain.applyFilters(entities, { projectId: 'proj-2' });
    expect(result.map(e => e.name)).toEqual(['b']);
  });

  it('returns all entities when projectId filter is undefined', () => {
    const result = SearchFilterChain.applyFilters(entities, {});
    expect(result.map(e => e.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('hasActiveFilters returns true when projectId is set', () => {
    expect(SearchFilterChain.hasActiveFilters({ projectId: 'proj-1' })).toBe(true);
  });

  it('composes with other filters (AND semantics)', () => {
    const mixed: Entity[] = [
      { ...E('a', 'proj-1'), tags: ['x'] },
      { ...E('b', 'proj-1'), tags: ['y'] },
      { ...E('c', 'proj-2'), tags: ['x'] },
    ];
    const result = SearchFilterChain.applyFilters(mixed, {
      projectId: 'proj-1',
      tags: ['x'],
    });
    expect(result.map(e => e.name)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/search/search-filter-chain-project.test.ts`
Expected: FAIL — `projectId` is not a recognized field on `SearchFilters`.

- [ ] **Step 3: Add projectId to SearchFilters interface**

In `src/search/SearchFilterChain.ts`, add to the `SearchFilters` interface (after `modifiedBefore`):

```typescript
  /** Project scope (exact match). Undefined = match all projects. */
  projectId?: string;
```

- [ ] **Step 4: Add check to entityPassesFilters**

In `entityPassesFilters`, before the final `return true;`:

```typescript
    // Project scope filter
    if (filters.projectId !== undefined && entity.projectId !== filters.projectId) {
      return false;
    }

    return true;
```

- [ ] **Step 5: Add projectId to hasActiveFilters**

In `hasActiveFilters`, add `|| filters.projectId !== undefined` to the OR chain.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/search/search-filter-chain-project.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

Message:

```
feat(search): Add projectId filter to SearchFilterChain

Project scope filter propagates to all search methods via the
centralized filter chain.
```

---
