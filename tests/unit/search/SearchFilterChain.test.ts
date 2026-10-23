/**
 * SearchFilterChain Unit Tests
 *
 * Tests for centralized filter logic used across all search types.
 */

import { describe, it, expect } from 'vitest';
import { SearchFilterChain, type SearchFilters } from '../../../src/search/SearchFilterChain.js';
import type { Entity } from '../../../src/types/index.js';

describe('SearchFilterChain', () => {
  const sampleEntities: Entity[] = [
    {
      name: 'Alice',
      entityType: 'person',
      observations: ['Developer'],
      tags: ['backend', 'senior'],
      importance: 8,
      createdAt: '2024-01-15T10:00:00Z',
      lastModified: '2024-02-01T10:00:00Z',
    },
    {
      name: 'Bob',
      entityType: 'person',
      observations: ['Manager'],
      tags: ['leadership'],
      importance: 7,
      createdAt: '2024-01-10T10:00:00Z',
      lastModified: '2024-01-20T10:00:00Z',
    },
    {
      name: 'Project X',
      entityType: 'project',
      observations: ['Important project'],
      tags: ['active', 'priority'],
      importance: 9,
      createdAt: '2024-02-01T10:00:00Z',
    },
    {
      name: 'NoTags',
      entityType: 'misc',
      observations: ['Entity without tags'],
    },
    {
      name: 'NoImportance',
      entityType: 'misc',
      observations: ['Entity without importance'],
      tags: ['test'],
    },
  ];

  describe('applyFilters', () => {
    it('should return all entities when no filters applied', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {});
      expect(result).toHaveLength(5);
    });

    it('should filter by single tag', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { tags: ['backend'] });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    it('should filter by multiple tags (OR logic)', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        tags: ['backend', 'leadership'],
      });
      expect(result).toHaveLength(2);
    });

    it('should filter by minImportance', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { minImportance: 8 });
      expect(result).toHaveLength(2);
      expect(result.map(e => e.name)).toContain('Alice');
      expect(result.map(e => e.name)).toContain('Project X');
    });

    it('should filter by maxImportance', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { maxImportance: 7 });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });

    it('should filter by importance range', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        minImportance: 7,
        maxImportance: 8,
      });
      expect(result).toHaveLength(2);
    });

    it('should filter by entityType', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { entityType: 'project' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Project X');
    });

    it('should filter by createdAfter', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        createdAfter: '2024-01-14T00:00:00Z',
      });
      expect(result).toHaveLength(2);
      expect(result.map(e => e.name)).toContain('Alice');
      expect(result.map(e => e.name)).toContain('Project X');
    });

    it('should filter by createdBefore', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        createdBefore: '2024-01-12T00:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });

    it('should filter by modifiedAfter', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        modifiedAfter: '2024-01-25T00:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    it('should filter by modifiedBefore', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        modifiedBefore: '2024-01-25T00:00:00Z',
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });

    it('should combine multiple filters (AND logic)', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        entityType: 'person',
        minImportance: 8,
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    it('should exclude entities without tags when filtering by tags', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { tags: ['test'] });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('NoImportance');
    });

    it('should exclude entities without createdAt when filtering by created date', () => {
      const entitiesWithMissingDates: Entity[] = [
        { name: 'NoDate', entityType: 'test', observations: [] },
        ...sampleEntities,
      ];
      const result = SearchFilterChain.applyFilters(entitiesWithMissingDates, {
        createdAfter: '2024-01-01T00:00:00Z',
      });
      expect(result.map(e => e.name)).not.toContain('NoDate');
    });

    it('should be case-insensitive for tag matching', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, { tags: ['BACKEND'] });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });
  });

  describe('entityPassesFilters', () => {
    it('should return true when entity passes all filters', () => {
      const filters: SearchFilters = { tags: ['backend'], minImportance: 5 };
      const result = SearchFilterChain.entityPassesFilters(sampleEntities[0], filters, ['backend']);
      expect(result).toBe(true);
    });

    it('should return false when entity fails tag filter', () => {
      const filters: SearchFilters = { tags: ['nonexistent'] };
      const result = SearchFilterChain.entityPassesFilters(
        sampleEntities[0],
        filters,
        ['nonexistent']
      );
      expect(result).toBe(false);
    });

    it('should return false when entity fails importance filter', () => {
      const filters: SearchFilters = { minImportance: 10 };
      const result = SearchFilterChain.entityPassesFilters(sampleEntities[0], filters);
      expect(result).toBe(false);
    });

    it('should return false when entity fails entity type filter', () => {
      const filters: SearchFilters = { entityType: 'project' };
      const result = SearchFilterChain.entityPassesFilters(sampleEntities[0], filters);
      expect(result).toBe(false);
    });
  });

  describe('hasActiveFilters', () => {
    it('should return false for empty filters', () => {
      expect(SearchFilterChain.hasActiveFilters({})).toBe(false);
    });

    it('should return false for empty tags array', () => {
      expect(SearchFilterChain.hasActiveFilters({ tags: [] })).toBe(false);
    });

    it('should return true when tags specified', () => {
      expect(SearchFilterChain.hasActiveFilters({ tags: ['test'] })).toBe(true);
    });

    it('should return true when minImportance specified', () => {
      expect(SearchFilterChain.hasActiveFilters({ minImportance: 5 })).toBe(true);
    });

    it('should return true when maxImportance specified', () => {
      expect(SearchFilterChain.hasActiveFilters({ maxImportance: 8 })).toBe(true);
    });

    it('should return true when entityType specified', () => {
      expect(SearchFilterChain.hasActiveFilters({ entityType: 'person' })).toBe(true);
    });

    it('should return true when date filters specified', () => {
      expect(SearchFilterChain.hasActiveFilters({ createdAfter: '2024-01-01' })).toBe(true);
      expect(SearchFilterChain.hasActiveFilters({ createdBefore: '2024-12-31' })).toBe(true);
      expect(SearchFilterChain.hasActiveFilters({ modifiedAfter: '2024-01-01' })).toBe(true);
      expect(SearchFilterChain.hasActiveFilters({ modifiedBefore: '2024-12-31' })).toBe(true);
    });
  });

  describe('validatePagination', () => {
    it('should return default values', () => {
      const pagination = SearchFilterChain.validatePagination();
      expect(pagination.offset).toBe(0);
      expect(pagination.limit).toBeGreaterThan(0);
    });

    it('should accept offset parameter', () => {
      const pagination = SearchFilterChain.validatePagination(10);
      expect(pagination.offset).toBe(10);
    });

    it('should accept limit parameter', () => {
      const pagination = SearchFilterChain.validatePagination(0, 25);
      expect(pagination.limit).toBe(25);
    });

    it('should handle zero offset', () => {
      const pagination = SearchFilterChain.validatePagination(0, 50);
      expect(pagination.offset).toBe(0);
    });
  });

  describe('paginate', () => {
    it('should return subset based on pagination', () => {
      const pagination = SearchFilterChain.validatePagination(0, 2);
      const result = SearchFilterChain.paginate([...sampleEntities], pagination);
      expect(result).toHaveLength(2);
    });

    it('should apply offset correctly', () => {
      const pagination = SearchFilterChain.validatePagination(2, 2);
      const result = SearchFilterChain.paginate([...sampleEntities], pagination);
      expect(result[0].name).toBe('Project X');
    });

    it('should handle offset beyond array length', () => {
      const pagination = SearchFilterChain.validatePagination(100, 10);
      const result = SearchFilterChain.paginate([...sampleEntities], pagination);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterAndPaginate', () => {
    it('should apply both filters and pagination', () => {
      const result = SearchFilterChain.filterAndPaginate(
        sampleEntities,
        { entityType: 'person' },
        0,
        1
      );
      expect(result).toHaveLength(1);
      expect(result[0].entityType).toBe('person');
    });

    it('should filter first, then paginate', () => {
      const result = SearchFilterChain.filterAndPaginate(
        sampleEntities,
        { entityType: 'person' },
        1,
        1
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });
  });

  describe('filterByTags', () => {
    it('should filter by tags only', () => {
      const result = SearchFilterChain.filterByTags(sampleEntities, ['backend']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Alice');
    });

    it('should return all entities when no tags provided', () => {
      const result = SearchFilterChain.filterByTags(sampleEntities, undefined);
      expect(result).toHaveLength(5);
    });

    it('should return all entities for empty tags array', () => {
      const result = SearchFilterChain.filterByTags(sampleEntities, []);
      expect(result).toHaveLength(5);
    });

    it('should exclude entities without tags', () => {
      const result = SearchFilterChain.filterByTags(sampleEntities, ['active']);
      expect(result.map(e => e.name)).not.toContain('NoTags');
    });
  });

  describe('filterByImportance', () => {
    it('should filter by minimum importance', () => {
      const result = SearchFilterChain.filterByImportance(sampleEntities, 8, undefined);
      expect(result).toHaveLength(2);
    });

    it('should filter by maximum importance', () => {
      const result = SearchFilterChain.filterByImportance(sampleEntities, undefined, 7);
      expect(result).toHaveLength(1);
    });

    it('should filter by range', () => {
      const result = SearchFilterChain.filterByImportance(sampleEntities, 7, 8);
      expect(result).toHaveLength(2);
    });

    it('should return all entities when no importance filters', () => {
      const result = SearchFilterChain.filterByImportance(sampleEntities, undefined, undefined);
      expect(result).toHaveLength(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty entity array', () => {
      const result = SearchFilterChain.applyFilters([], { tags: ['test'] });
      expect(result).toEqual([]);
    });

    it('should handle filters with undefined values', () => {
      const filters: SearchFilters = {
        tags: undefined,
        minImportance: undefined,
        maxImportance: undefined,
      };
      const result = SearchFilterChain.applyFilters(sampleEntities, filters);
      expect(result).toHaveLength(5);
    });

    it('should handle entity with empty tags array', () => {
      const entities: Entity[] = [
        { name: 'EmptyTags', entityType: 'test', observations: [], tags: [] },
      ];
      const result = SearchFilterChain.applyFilters(entities, { tags: ['test'] });
      expect(result).toHaveLength(0);
    });

    it('should handle importance of 0', () => {
      const entities: Entity[] = [
        { name: 'ZeroImportance', entityType: 'test', observations: [], importance: 0 },
      ];
      const result = SearchFilterChain.applyFilters(entities, { minImportance: 0 });
      expect(result).toHaveLength(1);
    });

    it('should handle boundary dates', () => {
      const result = SearchFilterChain.applyFilters(sampleEntities, {
        createdAfter: '2024-01-15T10:00:00Z',
        createdBefore: '2024-01-15T10:00:00Z',
      });
      // Exact match should be included
      expect(result.map(e => e.name)).toContain('Alice');
    });
  });

  describe('unparseable entity dates', () => {
    const badDates: Entity = {
      name: 'BadDates',
      entityType: 'misc',
      observations: [],
      createdAt: 'not-a-date',
      lastModified: 'not-a-date',
    };

    it('excludes an entity whose createdAt cannot be parsed when a created bound is set', () => {
      const result = SearchFilterChain.applyFilters([badDates], { createdAfter: '2020-01-01' });
      expect(result).toEqual([]);
    });

    it('excludes an entity whose lastModified cannot be parsed when a modified bound is set', () => {
      const result = SearchFilterChain.applyFilters([badDates], { modifiedBefore: '2030-01-01' });
      expect(result).toEqual([]);
    });

    it('excludes an unparseable entity date even when the bound is also unparseable', () => {
      const result = SearchFilterChain.applyFilters([badDates], { createdAfter: 'garbage' });
      expect(result).toEqual([]);
    });

    it('keeps the entities with a parseable date', () => {
      const result = SearchFilterChain.applyFilters([sampleEntities[0], badDates], {
        createdAfter: '2020-01-01',
      });
      expect(result.map(e => e.name)).toEqual(['Alice']);
    });
  });

  describe('date bounds that cannot be parsed', () => {
    const boundEntities: Entity[] = [
      { name: 'A', entityType: 'misc', observations: [], createdAt: '2020-06-01T00:00:00Z', lastModified: '2020-06-01T00:00:00Z' },
      { name: 'B', entityType: 'misc', observations: [], createdAt: '2022-06-01T00:00:00Z', lastModified: '2022-06-01T00:00:00Z' },
      { name: 'C', entityType: 'misc', observations: [] },
    ];

    it.each([
      [{ createdAfter: 'garbage' }, ['A', 'B']],
      [{ createdAfter: 'garbage', createdBefore: '2021-01-01' }, ['A']],
      [{ createdAfter: '' }, ['A', 'B', 'C']],
      [{ modifiedAfter: 'garbage' }, ['A', 'B']],
      [{ modifiedAfter: 'garbage', modifiedBefore: '2021-01-01' }, ['A']],
      [{ modifiedAfter: '' }, ['A', 'B', 'C']],
    ] as Array<[SearchFilters, string[]]>)(
      'skips an unparseable bound, keeps the valid one, and fails an entity with no date (%j)',
      (filters, expected) => {
        const result = SearchFilterChain.applyFilters(boundEntities, filters);
        expect(result.map(e => e.name)).toEqual(expected);
      }
    );
  });

  describe('filter results over a mixed table', () => {
    // Golden values were recorded before the delegation to entityUtils.
    const table: Entity[] = [
      { name: 'E01', entityType: 'person', observations: [], tags: ['Backend'], importance: 8, createdAt: '2020-03-01T00:00:00Z', lastModified: '2024-01-10T00:00:00Z', projectId: 'p1', lifecycleStatus: 'published' },
      { name: 'E02', entityType: 'project', observations: [], tags: ['frontend'], importance: 3, createdAt: '2021-06-15T00:00:00Z', lastModified: '2022-02-01T00:00:00Z', projectId: 'p2', isLatest: false },
      { name: 'E03', entityType: 'person', observations: [], importance: 5, createdAt: '2022-12-31T23:59:59Z', lastModified: '2023-05-05T00:00:00Z', lifecycleStatus: 'draft' },
      { name: 'E04', entityType: 'misc', observations: [], tags: [], importance: 10, createdAt: '2023-01-01T00:00:00Z', lastModified: '2025-01-01T00:00:00Z', projectId: 'p1', lifecycleStatus: 'archived' },
      { name: 'E05', entityType: 'person', observations: [], tags: ['BACKEND', 'api'], createdAt: '2019-07-04T12:00:00Z', lastModified: '2021-07-04T12:00:00Z' },
      { name: 'E06', entityType: 'misc', observations: [] },
      { name: 'E07', entityType: 'project', observations: [], tags: ['infra'], importance: 0, createdAt: '2024-02-29T00:00:00Z', lastModified: '2024-02-29T00:00:00Z', projectId: 'p1', lifecycleStatus: 'draft', isLatest: false },
      { name: 'E08', entityType: 'person', observations: [], tags: ['api'], importance: 7, createdAt: '2021-01-01T00:00:00Z', lastModified: '2021-12-31T23:59:59Z', lifecycleStatus: 'published' },
      { name: 'E09', entityType: 'misc', observations: [], tags: ['backend'], importance: 6, createdAt: 'not-a-date', lastModified: '2022-06-01T00:00:00Z' },
      { name: 'E10', entityType: 'person', observations: [], tags: ['frontend', 'Backend'], importance: 4, createdAt: '2022-03-03T00:00:00Z', projectId: 'p2' },
      { name: 'E11', entityType: 'project', observations: [], tags: ['infra'], importance: 9, createdAt: '2025-05-05T00:00:00Z', lastModified: '2025-06-06T00:00:00Z', lifecycleStatus: 'published', projectId: 'p2' },
      { name: 'E12', entityType: 'misc', observations: [], tags: [], importance: 2, lastModified: '2023-08-08T00:00:00Z', isLatest: true },
    ];

    it.each([
      [{ tags: ['Backend'] }, ['E01', 'E05', 'E09', 'E10']],
      [{ minImportance: 3, maxImportance: 7 }, ['E08', 'E09', 'E10']],
      [{ entityType: 'person' }, ['E01', 'E05', 'E08', 'E10']],
      [{ createdAfter: '2021-01-01T00:00:00Z', createdBefore: '2023-01-01T00:00:00Z' }, ['E08', 'E10']],
      [{ modifiedAfter: '2022-01-01T00:00:00Z' }, ['E01', 'E09', 'E11', 'E12']],
      [{ projectId: 'p1', includeSuperseded: true }, ['E01']],
      [{ lifecycleStatus: ['draft', 'published', 'archived'] }, ['E01', 'E03', 'E04', 'E05', 'E06', 'E08', 'E09', 'E10', 'E11', 'E12']],
      [{ createdAfter: 'garbage', modifiedBefore: '2024-06-01T00:00:00Z', minImportance: 1 }, ['E01', 'E08']],
    ] as Array<[SearchFilters, string[]]>)('returns the recorded names for %j', (filters, expected) => {
      expect(SearchFilterChain.applyFilters(table, filters).map(e => e.name)).toEqual(expected);
    });

    it('ignores the tag filter when the caller passes no normalized tags', () => {
      const untagged: Entity = { name: 'T', entityType: 'misc', observations: [], tags: ['y'] };
      expect(SearchFilterChain.entityPassesFilters(untagged, { tags: ['x'] })).toBe(true);
    });
  });
});
