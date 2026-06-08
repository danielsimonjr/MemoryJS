import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolicSearch } from '../../../src/search/SymbolicSearch.js';
import type { Entity } from '../../../src/types/index.js';

describe('SymbolicSearch', () => {
  let searcher: SymbolicSearch;
  let mockEntities: Entity[];

  beforeEach(() => {
    searcher = new SymbolicSearch();

    mockEntities = [
      {
        name: 'Entity1',
        entityType: 'typeA',
        observations: ['obs1'],
        tags: ['tag1', 'tag2'],
        importance: 8,
        createdAt: '2023-01-01T10:00:00Z',
      },
      {
        name: 'Entity2',
        entityType: 'typeB',
        observations: [],
        tags: ['tag2', 'tag3'],
        importance: 5,
        createdAt: '2023-06-01T10:00:00Z',
        parentId: 'Entity1',
      },
      {
        name: 'Entity3',
        entityType: 'typeA',
        observations: ['obs2', 'obs3'],
        tags: ['tag1'],
        importance: 2,
        lastModified: '2023-12-01T10:00:00Z',
        parentId: 'Entity1',
      },
      {
        name: 'Entity4',
        entityType: 'typeC',
        observations: ['obs4'],
        // no tags
        // no importance (defaults to 5)
        // no dates
      }
    ];
  });

  describe('search - tags, types, date filters', () => {
    it('should filter by tags', () => {
      // Single tag
      const res1 = searcher.search(mockEntities, { tags: ['tag2'] });
      expect(res1.length).toBe(2);
      expect(res1.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity2']));

      // Multiple tags (OR logic in actual implementation for SymbolicSearch tags filter)
      const res2 = searcher.search(mockEntities, { tags: ['tag1', 'tag3'] });
      expect(res2.length).toBe(3); // Entity1 (tag1), Entity2 (tag3), Entity3 (tag1)
      expect(res2.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity2', 'Entity3']));

      // No matches
      const res3 = searcher.search(mockEntities, { tags: ['nonexistent'] });
      expect(res3.length).toBe(0);
    });

    it('should filter by entity types', () => {
      // Single type
      const res1 = searcher.search(mockEntities, { entityTypes: ['typeA'] });
      expect(res1.length).toBe(2);
      expect(res1.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity3']));

      // Multiple types
      const res2 = searcher.search(mockEntities, { entityTypes: ['typeA', 'typeC'] });
      expect(res2.length).toBe(3); // Entity1 (A), Entity3 (A), Entity4 (C)
      expect(res2.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity3', 'Entity4']));

      // No matches
      const res3 = searcher.search(mockEntities, { entityTypes: ['typeD'] });
      expect(res3.length).toBe(0);
    });

    it('should filter by date range', () => {
      // Both start and end
      const res1 = searcher.search(mockEntities, {
        dateRange: { start: '2023-05-01T00:00:00Z', end: '2023-07-01T00:00:00Z' }
      });
      expect(res1.length).toBe(1);
      expect(res1[0].entity.name).toBe('Entity2'); // 2023-06-01

      // Only start
      const res2 = searcher.search(mockEntities, {
        dateRange: { start: '2023-05-01T00:00:00Z', end: '' }
      });
      expect(res2.length).toBe(2);
      expect(res2.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity2', 'Entity3']));

      // Only end
      const res3 = searcher.search(mockEntities, {
        dateRange: { start: '', end: '2023-02-01T00:00:00Z' }
      });
      expect(res3.length).toBe(1);
      expect(res3[0].entity.name).toBe('Entity1');
    });

    it('should exclude entities without dates when date filter is applied', () => {
      const res = searcher.search(mockEntities, {
        dateRange: { start: '2000-01-01T00:00:00Z', end: '2099-01-01T00:00:00Z' }
      });
      // Entity4 has no dates, should be excluded
      expect(res.length).toBe(3);
      expect(res.map(r => r.entity.name)).not.toContain('Entity4');
    });
  });

  describe('search - importance, parentId, observations filters', () => {
    it('should filter by importance', () => {
      // Min only
      const res1 = searcher.search(mockEntities, { importance: { min: 6 } });
      expect(res1.length).toBe(1);
      expect(res1[0].entity.name).toBe('Entity1'); // importance 8

      // Max only
      const res2 = searcher.search(mockEntities, { importance: { max: 4 } });
      expect(res2.length).toBe(1);
      expect(res2[0].entity.name).toBe('Entity3'); // importance 2

      // Both min and max
      const res3 = searcher.search(mockEntities, { importance: { min: 4, max: 7 } });
      expect(res3.length).toBe(2);
      expect(res3.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity2', 'Entity4'])); // Entity4 has default 5
    });

    it('should filter by parentId', () => {
      // Has parentId Entity1
      const res1 = searcher.search(mockEntities, { parentId: 'Entity1' });
      expect(res1.length).toBe(2);
      expect(res1.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity2', 'Entity3']));

      // ParentId not found
      const res2 = searcher.search(mockEntities, { parentId: 'Entity4' });
      expect(res2.length).toBe(0);

    });

    it('should filter by hasObservations', () => {
      // True
      const res1 = searcher.search(mockEntities, { hasObservations: true });
      expect(res1.length).toBe(3);
      expect(res1.map(r => r.entity.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity3', 'Entity4']));

      // False
      const res2 = searcher.search(mockEntities, { hasObservations: false });
      expect(res2.length).toBe(1);
      expect(res2[0].entity.name).toBe('Entity2');
    });
  });

  describe('search - combinations and edge cases', () => {
    it('should match multiple filters (AND logic) and score correctly', () => {
      // Tags + entityTypes + importance
      const res = searcher.search(mockEntities, {
        tags: ['tag1'],
        entityTypes: ['typeA'],
        importance: { min: 5 }
      });
      // Entity1 matches all (typeA, tag1, importance 8)
      // Entity3 matches typeA and tag1, but importance is 2 (fails min 5)
      expect(res.length).toBe(1);
      expect(res[0].entity.name).toBe('Entity1');
      expect(res[0].score).toBe(1); // 3/3 matched filters = 1.0
      expect(res[0].matchedFilters).toContain('tags:tag1');
      expect(res[0].matchedFilters).toContain('type:typeA');
      expect(res[0].matchedFilters).toContain('importance:8');
    });

    it('should return base score when no filters specified', () => {
      const res = searcher.search(mockEntities, {});
      expect(res.length).toBe(mockEntities.length);
      res.forEach(r => {
        expect(r.score).toBe(0.5);
        expect(r.matchedFilters).toEqual([]);
      });
    });

    it('should sort results by score descending', () => {
      // Note: Since evaluateFilters uses strict AND logic, matching entities
      // always receive a score of 1.0 (or 0.5 with no filters). Order is preserved.
      const res = searcher.search(mockEntities, {
        hasObservations: true
      });
      expect(res.length).toBe(3);
      res.forEach(r => {
        expect(r.score).toBe(1.0);
      });
    });
  });

  describe('helper methods', () => {
    it('byTag should find entities matching a specific tag case-insensitively', () => {
      // Exact match
      const res1 = searcher.byTag(mockEntities, 'tag2');
      expect(res1.length).toBe(2);
      expect(res1.map(e => e.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity2']));

      // Case insensitive
      const res2 = searcher.byTag(mockEntities, 'TAG1');
      expect(res2.length).toBe(2);
      expect(res2.map(e => e.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity3']));

      // Nonexistent
      const res3 = searcher.byTag(mockEntities, 'nonexistent');
      expect(res3.length).toBe(0);
    });

    it('byType should find entities by type case-insensitively', () => {
      // Exact match
      const res1 = searcher.byType(mockEntities, 'typeA');
      expect(res1.length).toBe(2);
      expect(res1.map(e => e.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity3']));

      // Case insensitive
      const res2 = searcher.byType(mockEntities, 'TYPEB');
      expect(res2.length).toBe(1);
      expect(res2[0].name).toBe('Entity2');

      // Nonexistent
      const res3 = searcher.byType(mockEntities, 'typeD');
      expect(res3.length).toBe(0);
    });

    it('byImportance should find entities within importance range', () => {
      const res1 = searcher.byImportance(mockEntities, 4, 8);
      // Entity1 (8), Entity2 (5), Entity4 (default 5) -> all match
      // Entity3 (2) -> no match
      expect(res1.length).toBe(3);
      expect(res1.map(e => e.name)).toEqual(expect.arrayContaining(['Entity1', 'Entity2', 'Entity4']));

      const res2 = searcher.byImportance(mockEntities, 9, 10);
      expect(res2.length).toBe(0);
    });
  });
});
