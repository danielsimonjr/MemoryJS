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
});
