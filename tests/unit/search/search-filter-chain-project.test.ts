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
