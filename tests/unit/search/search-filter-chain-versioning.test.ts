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
