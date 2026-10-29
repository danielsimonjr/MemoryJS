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

  it('when the latest version is draft, default filters return the published parent and omit the draft', () => {
    const chain: Entity[] = [
      {
        name: 'parent',
        entityType: 'concept',
        observations: ['keeps coffee'],
        version: 1,
        rootEntityName: 'parent',
        isLatest: false,
        lifecycleStatus: 'published',
        parentEntityName: undefined,
      },
      {
        name: 'parent-v2',
        entityType: 'concept',
        observations: ['trial tea'],
        version: 2,
        rootEntityName: 'parent',
        parentEntityName: 'parent',
        isLatest: true,
        lifecycleStatus: 'draft',
      },
    ];
    const result = SearchFilterChain.applyFilters(chain, {});
    expect(result.map(e => e.name)).toEqual(['parent']);
  });

  it('when the latest version is archived, default filters omit the head and the superseded parent', () => {
    const chain: Entity[] = [
      {
        name: 'parent',
        entityType: 'concept',
        observations: ['keeps coffee'],
        version: 1,
        rootEntityName: 'parent',
        isLatest: false,
        lifecycleStatus: 'published',
      },
      {
        name: 'parent-v2',
        entityType: 'concept',
        observations: ['trial tea'],
        version: 2,
        rootEntityName: 'parent',
        parentEntityName: 'parent',
        isLatest: true,
        lifecycleStatus: 'archived',
      },
    ];
    const result = SearchFilterChain.applyFilters(chain, {});
    expect(result).toHaveLength(0);
  });

  it('when the latest version is draft, default filters return the published grandparent only', () => {
    const chain: Entity[] = [
      {
        name: 'grandparent',
        entityType: 'concept',
        observations: ['trusted'],
        version: 1,
        rootEntityName: 'grandparent',
        isLatest: false,
        lifecycleStatus: 'published',
      },
      {
        name: 'grandparent-v2',
        entityType: 'concept',
        observations: ['trial one'],
        version: 2,
        rootEntityName: 'grandparent',
        parentEntityName: 'grandparent',
        isLatest: false,
        lifecycleStatus: 'draft',
      },
      {
        name: 'grandparent-v3',
        entityType: 'concept',
        observations: ['trial two'],
        version: 3,
        rootEntityName: 'grandparent',
        parentEntityName: 'grandparent-v2',
        isLatest: true,
        lifecycleStatus: 'draft',
      },
    ];
    const result = SearchFilterChain.applyFilters(chain, {});
    expect(result.map(e => e.name)).toEqual(['grandparent']);
  });

  it('a superseded entity with no draft head stays excluded', () => {
    const chain: Entity[] = [
      {
        name: 'old',
        entityType: 'concept',
        observations: ['a'],
        isLatest: false,
        lifecycleStatus: 'published',
      },
      {
        name: 'new',
        entityType: 'concept',
        observations: ['b'],
        isLatest: true,
        lifecycleStatus: 'published',
      },
    ];
    const result = SearchFilterChain.applyFilters(chain, {});
    expect(result.map(e => e.name)).toEqual(['new']);
  });
});
