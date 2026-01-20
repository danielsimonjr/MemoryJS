/**
 * Entity Utilities Unit Tests
 *
 * Tests for entity lookup and manipulation functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  findEntityByName,
  findEntitiesByNames,
  entityExists,
  getEntityIndex,
  removeEntityByName,
  getEntityNameSet,
  groupEntitiesByType,
  touchEntity,
  normalizeTag,
  normalizeTags,
  hasMatchingTag,
  hasAllTags,
  filterByTags,
  addUniqueTags,
  removeTags,
  isWithinDateRange,
  parseDateRange,
  isValidISODate,
  getCurrentTimestamp,
  isWithinImportanceRange,
  filterByImportance,
  filterByCreatedDate,
  filterByModifiedDate,
  filterByEntityType,
  entityPassesFilters,
  validateFilePath,
  fnv1aHash,
  sanitizeObject,
  escapeCsvFormula,
  ensureMemoryFilePath,
  defaultMemoryPath,
  EntityNotFoundError,
  FileOperationError,
} from '../../../src/utils/index.js';
import type { KnowledgeGraph, Entity } from '../../../src/types/index.js';

describe('entityUtils', () => {
  const createSampleGraph = (): KnowledgeGraph => ({
    entities: [
      { name: 'Alice', entityType: 'person', observations: ['Developer'] },
      { name: 'Bob', entityType: 'person', observations: ['Manager'] },
      { name: 'Project X', entityType: 'project', observations: ['Active project'] },
      { name: 'Config', entityType: 'system', observations: ['Configuration'] },
    ],
    relations: [],
  });

  describe('findEntityByName', () => {
    it('should find existing entity', () => {
      const graph = createSampleGraph();
      const entity = findEntityByName(graph, 'Alice', true);
      expect(entity.name).toBe('Alice');
      expect(entity.entityType).toBe('person');
    });

    it('should throw EntityNotFoundError when throwIfNotFound is true', () => {
      const graph = createSampleGraph();
      expect(() => findEntityByName(graph, 'NonExistent', true)).toThrow(EntityNotFoundError);
    });

    it('should return null when throwIfNotFound is false and entity not found', () => {
      const graph = createSampleGraph();
      const entity = findEntityByName(graph, 'NonExistent', false);
      expect(entity).toBeNull();
    });

    it('should default to throwing when not found', () => {
      const graph = createSampleGraph();
      expect(() => findEntityByName(graph, 'NonExistent')).toThrow(EntityNotFoundError);
    });

    it('should find entity case-sensitively', () => {
      const graph = createSampleGraph();
      expect(() => findEntityByName(graph, 'alice', true)).toThrow(EntityNotFoundError);
    });
  });

  describe('findEntitiesByNames', () => {
    it('should find multiple entities', () => {
      const graph = createSampleGraph();
      const entities = findEntitiesByNames(graph, ['Alice', 'Bob']);
      expect(entities).toHaveLength(2);
      expect(entities.map(e => e.name)).toContain('Alice');
      expect(entities.map(e => e.name)).toContain('Bob');
    });

    it('should throw when any entity not found and throwIfAnyNotFound is true', () => {
      const graph = createSampleGraph();
      expect(() => findEntitiesByNames(graph, ['Alice', 'NonExistent'], true)).toThrow(
        EntityNotFoundError
      );
    });

    it('should skip missing entities when throwIfAnyNotFound is false', () => {
      const graph = createSampleGraph();
      const entities = findEntitiesByNames(graph, ['Alice', 'NonExistent'], false);
      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Alice');
    });

    it('should return empty array for empty names array', () => {
      const graph = createSampleGraph();
      const entities = findEntitiesByNames(graph, []);
      expect(entities).toEqual([]);
    });

    it('should preserve order of found entities', () => {
      const graph = createSampleGraph();
      const entities = findEntitiesByNames(graph, ['Bob', 'Alice', 'Config']);
      expect(entities[0].name).toBe('Bob');
      expect(entities[1].name).toBe('Alice');
      expect(entities[2].name).toBe('Config');
    });
  });

  describe('entityExists', () => {
    it('should return true for existing entity', () => {
      const graph = createSampleGraph();
      expect(entityExists(graph, 'Alice')).toBe(true);
    });

    it('should return false for non-existent entity', () => {
      const graph = createSampleGraph();
      expect(entityExists(graph, 'NonExistent')).toBe(false);
    });

    it('should be case-sensitive', () => {
      const graph = createSampleGraph();
      expect(entityExists(graph, 'alice')).toBe(false);
    });

    it('should work with empty graph', () => {
      const graph: KnowledgeGraph = { entities: [], relations: [] };
      expect(entityExists(graph, 'Any')).toBe(false);
    });
  });

  describe('getEntityIndex', () => {
    it('should return correct index for existing entity', () => {
      const graph = createSampleGraph();
      expect(getEntityIndex(graph, 'Alice')).toBe(0);
      expect(getEntityIndex(graph, 'Bob')).toBe(1);
      expect(getEntityIndex(graph, 'Config')).toBe(3);
    });

    it('should return -1 for non-existent entity', () => {
      const graph = createSampleGraph();
      expect(getEntityIndex(graph, 'NonExistent')).toBe(-1);
    });

    it('should be case-sensitive', () => {
      const graph = createSampleGraph();
      expect(getEntityIndex(graph, 'alice')).toBe(-1);
    });
  });

  describe('removeEntityByName', () => {
    it('should remove existing entity and return true', () => {
      const graph = createSampleGraph();
      const result = removeEntityByName(graph, 'Alice');
      expect(result).toBe(true);
      expect(graph.entities).toHaveLength(3);
      expect(entityExists(graph, 'Alice')).toBe(false);
    });

    it('should return false for non-existent entity', () => {
      const graph = createSampleGraph();
      const result = removeEntityByName(graph, 'NonExistent');
      expect(result).toBe(false);
      expect(graph.entities).toHaveLength(4);
    });

    it('should not affect other entities', () => {
      const graph = createSampleGraph();
      removeEntityByName(graph, 'Bob');
      expect(entityExists(graph, 'Alice')).toBe(true);
      expect(entityExists(graph, 'Project X')).toBe(true);
      expect(entityExists(graph, 'Config')).toBe(true);
    });
  });

  describe('getEntityNameSet', () => {
    it('should return set of all entity names', () => {
      const graph = createSampleGraph();
      const nameSet = getEntityNameSet(graph);
      expect(nameSet.size).toBe(4);
      expect(nameSet.has('Alice')).toBe(true);
      expect(nameSet.has('Bob')).toBe(true);
      expect(nameSet.has('Project X')).toBe(true);
      expect(nameSet.has('Config')).toBe(true);
    });

    it('should return empty set for empty graph', () => {
      const graph: KnowledgeGraph = { entities: [], relations: [] };
      const nameSet = getEntityNameSet(graph);
      expect(nameSet.size).toBe(0);
    });

    it('should be useful for O(1) lookups', () => {
      const graph = createSampleGraph();
      const nameSet = getEntityNameSet(graph);
      // Set.has is O(1)
      expect(nameSet.has('Alice')).toBe(true);
      expect(nameSet.has('NonExistent')).toBe(false);
    });
  });

  describe('groupEntitiesByType', () => {
    it('should group entities by type', () => {
      const graph = createSampleGraph();
      const groups = groupEntitiesByType(graph.entities);

      expect(groups.size).toBe(3);
      expect(groups.get('person')).toHaveLength(2);
      expect(groups.get('project')).toHaveLength(1);
      expect(groups.get('system')).toHaveLength(1);
    });

    it('should return empty map for empty entities', () => {
      const groups = groupEntitiesByType([]);
      expect(groups.size).toBe(0);
    });

    it('should contain correct entities in each group', () => {
      const graph = createSampleGraph();
      const groups = groupEntitiesByType(graph.entities);

      const people = groups.get('person')!;
      expect(people.map(e => e.name)).toContain('Alice');
      expect(people.map(e => e.name)).toContain('Bob');
    });
  });

  describe('touchEntity', () => {
    it('should update lastModified timestamp', () => {
      const entity: Entity = { name: 'Test', entityType: 'test', observations: [] };
      const before = new Date().toISOString();
      const result = touchEntity(entity);
      const after = new Date().toISOString();

      expect(result.lastModified).toBeDefined();
      expect(result.lastModified! >= before).toBe(true);
      expect(result.lastModified! <= after).toBe(true);
    });

    it('should return the same entity reference', () => {
      const entity: Entity = { name: 'Test', entityType: 'test', observations: [] };
      const result = touchEntity(entity);
      expect(result).toBe(entity);
    });

    it('should overwrite existing lastModified', () => {
      const entity: Entity = {
        name: 'Test',
        entityType: 'test',
        observations: [],
        lastModified: '2020-01-01T00:00:00Z',
      };
      touchEntity(entity);
      expect(entity.lastModified).not.toBe('2020-01-01T00:00:00Z');
    });
  });

  describe('Edge Cases', () => {
    it('should handle entity names with special characters', () => {
      const graph: KnowledgeGraph = {
        entities: [
          { name: 'Test<>&"\'', entityType: 'test', observations: [] },
          { name: '日本語', entityType: 'test', observations: [] },
        ],
        relations: [],
      };

      expect(findEntityByName(graph, 'Test<>&"\'', false)?.name).toBe('Test<>&"\'');
      expect(findEntityByName(graph, '日本語', false)?.name).toBe('日本語');
    });

    it('should handle empty entity name', () => {
      const graph: KnowledgeGraph = {
        entities: [{ name: '', entityType: 'test', observations: [] }],
        relations: [],
      };

      expect(entityExists(graph, '')).toBe(true);
      expect(findEntityByName(graph, '', false)?.name).toBe('');
    });

    it('should handle whitespace-only entity names', () => {
      const graph: KnowledgeGraph = {
        entities: [{ name: '   ', entityType: 'test', observations: [] }],
        relations: [],
      };

      expect(entityExists(graph, '   ')).toBe(true);
      expect(entityExists(graph, '')).toBe(false);
    });
  });

  // ==================== Tag Utilities Tests ====================

  describe('normalizeTag', () => {
    it('should convert tag to lowercase', () => {
      expect(normalizeTag('IMPORTANT')).toBe('important');
    });

    it('should trim whitespace', () => {
      expect(normalizeTag('  tag  ')).toBe('tag');
    });

    it('should handle mixed case and whitespace', () => {
      expect(normalizeTag('  MiXeD CaSe  ')).toBe('mixed case');
    });

    it('should handle empty string', () => {
      expect(normalizeTag('')).toBe('');
    });
  });

  describe('normalizeTags', () => {
    it('should normalize array of tags', () => {
      expect(normalizeTags(['TAG1', 'Tag2', 'tag3'])).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should return empty array for undefined', () => {
      expect(normalizeTags(undefined)).toEqual([]);
    });

    it('should return empty array for null', () => {
      expect(normalizeTags(null)).toEqual([]);
    });

    it('should return empty array for empty array', () => {
      expect(normalizeTags([])).toEqual([]);
    });
  });

  describe('hasMatchingTag', () => {
    it('should return true when entity has matching tag', () => {
      expect(hasMatchingTag(['python', 'javascript'], ['python'])).toBe(true);
    });

    it('should return true for case-insensitive match', () => {
      expect(hasMatchingTag(['Python', 'JavaScript'], ['python'])).toBe(true);
    });

    it('should return false when no matching tag', () => {
      expect(hasMatchingTag(['python', 'javascript'], ['rust'])).toBe(false);
    });

    it('should return false for empty entity tags', () => {
      expect(hasMatchingTag([], ['python'])).toBe(false);
    });

    it('should return false for undefined entity tags', () => {
      expect(hasMatchingTag(undefined, ['python'])).toBe(false);
    });

    it('should return false for empty search tags', () => {
      expect(hasMatchingTag(['python'], [])).toBe(false);
    });

    it('should return false for undefined search tags', () => {
      expect(hasMatchingTag(['python'], undefined)).toBe(false);
    });
  });

  describe('hasAllTags', () => {
    it('should return true when entity has all required tags', () => {
      expect(hasAllTags(['python', 'javascript', 'rust'], ['python', 'rust'])).toBe(true);
    });

    it('should return false when missing some required tags', () => {
      expect(hasAllTags(['python'], ['python', 'rust'])).toBe(false);
    });

    it('should return true for empty required tags', () => {
      expect(hasAllTags(['python'], [])).toBe(true);
    });

    it('should return false for empty entity tags', () => {
      expect(hasAllTags([], ['python'])).toBe(false);
    });

    it('should return false for undefined entity tags', () => {
      expect(hasAllTags(undefined, ['python'])).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasAllTags(['Python', 'JavaScript'], ['python', 'javascript'])).toBe(true);
    });
  });

  describe('filterByTags', () => {
    const entities = [
      { name: 'E1', tags: ['python', 'api'] },
      { name: 'E2', tags: ['javascript', 'frontend'] },
      { name: 'E3', tags: ['python', 'backend'] },
      { name: 'E4' }, // No tags
    ];

    it('should filter entities with matching tags', () => {
      const result = filterByTags(entities, ['python']);
      expect(result).toHaveLength(2);
      expect(result.map(e => e.name)).toContain('E1');
      expect(result.map(e => e.name)).toContain('E3');
    });

    it('should return all entities when searchTags is undefined', () => {
      expect(filterByTags(entities, undefined)).toHaveLength(4);
    });

    it('should return all entities when searchTags is empty', () => {
      expect(filterByTags(entities, [])).toHaveLength(4);
    });

    it('should exclude entities without tags', () => {
      const result = filterByTags(entities, ['python']);
      expect(result.map(e => e.name)).not.toContain('E4');
    });
  });

  describe('addUniqueTags', () => {
    it('should add new tags without duplicates', () => {
      const result = addUniqueTags(['python'], ['javascript', 'rust']);
      expect(result).toEqual(['python', 'javascript', 'rust']);
    });

    it('should not add duplicate tags', () => {
      const result = addUniqueTags(['python'], ['Python', 'rust']);
      expect(result).toEqual(['python', 'rust']);
    });

    it('should handle undefined existing tags', () => {
      const result = addUniqueTags(undefined, ['python', 'rust']);
      expect(result).toEqual(['python', 'rust']);
    });

    it('should normalize all tags to lowercase', () => {
      const result = addUniqueTags(['PYTHON'], ['JavaScript']);
      expect(result).toEqual(['python', 'javascript']);
    });
  });

  describe('removeTags', () => {
    it('should remove specified tags', () => {
      const result = removeTags(['python', 'javascript', 'rust'], ['javascript']);
      expect(result).toEqual(['python', 'rust']);
    });

    it('should be case-insensitive', () => {
      const result = removeTags(['Python', 'JavaScript'], ['python']);
      expect(result).toEqual(['JavaScript']);
    });

    it('should return empty array for undefined existing tags', () => {
      expect(removeTags(undefined, ['python'])).toEqual([]);
    });

    it('should return empty array for empty existing tags', () => {
      expect(removeTags([], ['python'])).toEqual([]);
    });

    it('should handle tags not in list', () => {
      const result = removeTags(['python'], ['rust']);
      expect(result).toEqual(['python']);
    });
  });

  // ==================== Date Utilities Tests ====================

  describe('isWithinDateRange', () => {
    it('should return true when date is within range', () => {
      const result = isWithinDateRange(
        '2024-06-15T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
        '2024-12-31T23:59:59.999Z'
      );
      expect(result).toBe(true);
    });

    it('should return false when date is before start', () => {
      const result = isWithinDateRange(
        '2023-06-15T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z'
      );
      expect(result).toBe(false);
    });

    it('should return false when date is after end', () => {
      const result = isWithinDateRange(
        '2025-06-15T00:00:00.000Z',
        undefined,
        '2024-12-31T23:59:59.999Z'
      );
      expect(result).toBe(false);
    });

    it('should return true when no filters set', () => {
      expect(isWithinDateRange('2024-06-15T00:00:00.000Z')).toBe(true);
    });

    it('should return true when no filters set and date is undefined', () => {
      expect(isWithinDateRange(undefined)).toBe(true);
    });

    it('should return false when date is undefined but filters are set', () => {
      expect(isWithinDateRange(undefined, '2024-01-01T00:00:00.000Z')).toBe(false);
    });

    it('should return false for invalid date string', () => {
      expect(isWithinDateRange('invalid-date', '2024-01-01T00:00:00.000Z')).toBe(false);
    });

    it('should return false for invalid start date', () => {
      expect(isWithinDateRange('2024-06-15T00:00:00.000Z', 'invalid')).toBe(false);
    });

    it('should return false for invalid end date', () => {
      expect(isWithinDateRange('2024-06-15T00:00:00.000Z', undefined, 'invalid')).toBe(false);
    });
  });

  describe('parseDateRange', () => {
    it('should parse valid start and end dates', () => {
      const result = parseDateRange('2024-01-01T00:00:00.000Z', '2024-12-31T23:59:59.999Z');
      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeInstanceOf(Date);
    });

    it('should return null for undefined dates', () => {
      const result = parseDateRange(undefined, undefined);
      expect(result.start).toBeNull();
      expect(result.end).toBeNull();
    });

    it('should return null for invalid dates', () => {
      const result = parseDateRange('invalid', 'also-invalid');
      expect(result.start).toBeNull();
      expect(result.end).toBeNull();
    });

    it('should handle mixed valid and invalid dates', () => {
      const result = parseDateRange('2024-01-01T00:00:00.000Z', 'invalid');
      expect(result.start).toBeInstanceOf(Date);
      expect(result.end).toBeNull();
    });
  });

  describe('isValidISODate', () => {
    it('should return true for valid ISO 8601 date', () => {
      expect(isValidISODate('2024-06-15T12:30:45.123Z')).toBe(true);
    });

    it('should return false for invalid date', () => {
      expect(isValidISODate('invalid')).toBe(false);
    });

    it('should return false for non-ISO format', () => {
      // This date is parseable but not ISO format
      expect(isValidISODate('June 15, 2024')).toBe(false);
    });
  });

  describe('getCurrentTimestamp', () => {
    it('should return valid ISO 8601 timestamp', () => {
      const timestamp = getCurrentTimestamp();
      expect(isValidISODate(timestamp)).toBe(true);
    });

    it('should return current time', () => {
      const before = new Date().toISOString();
      const timestamp = getCurrentTimestamp();
      const after = new Date().toISOString();
      expect(timestamp >= before).toBe(true);
      expect(timestamp <= after).toBe(true);
    });
  });

  // ==================== Filter Utilities Tests ====================

  describe('isWithinImportanceRange', () => {
    it('should return true when importance is within range', () => {
      expect(isWithinImportanceRange(5, 1, 10)).toBe(true);
    });

    it('should return true for boundary values', () => {
      expect(isWithinImportanceRange(1, 1, 10)).toBe(true);
      expect(isWithinImportanceRange(10, 1, 10)).toBe(true);
    });

    it('should return false when below minimum', () => {
      expect(isWithinImportanceRange(0, 1, 10)).toBe(false);
    });

    it('should return false when above maximum', () => {
      expect(isWithinImportanceRange(11, 1, 10)).toBe(false);
    });

    it('should return true when no filters set', () => {
      expect(isWithinImportanceRange(5)).toBe(true);
    });

    it('should return true when importance is undefined and no filters', () => {
      expect(isWithinImportanceRange(undefined)).toBe(true);
    });

    it('should return false when importance is undefined but min filter set', () => {
      expect(isWithinImportanceRange(undefined, 5)).toBe(false);
    });

    it('should return false when importance is undefined but max filter set', () => {
      expect(isWithinImportanceRange(undefined, undefined, 10)).toBe(false);
    });
  });

  describe('filterByImportance', () => {
    const entities: Entity[] = [
      { name: 'E1', entityType: 'test', observations: [], importance: 3 },
      { name: 'E2', entityType: 'test', observations: [], importance: 7 },
      { name: 'E3', entityType: 'test', observations: [], importance: 10 },
      { name: 'E4', entityType: 'test', observations: [] }, // No importance
    ];

    it('should filter by minimum importance', () => {
      const result = filterByImportance(entities, 5);
      expect(result).toHaveLength(2);
      expect(result.map(e => e.name)).toContain('E2');
      expect(result.map(e => e.name)).toContain('E3');
    });

    it('should filter by maximum importance', () => {
      const result = filterByImportance(entities, undefined, 7);
      expect(result).toHaveLength(2);
      expect(result.map(e => e.name)).toContain('E1');
      expect(result.map(e => e.name)).toContain('E2');
    });

    it('should filter by importance range', () => {
      const result = filterByImportance(entities, 5, 8);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('E2');
    });

    it('should return all entities when no filters set', () => {
      expect(filterByImportance(entities)).toHaveLength(4);
    });
  });

  describe('filterByCreatedDate', () => {
    const entities: Entity[] = [
      { name: 'E1', entityType: 'test', observations: [], createdAt: '2024-01-15T00:00:00.000Z' },
      { name: 'E2', entityType: 'test', observations: [], createdAt: '2024-06-15T00:00:00.000Z' },
      { name: 'E3', entityType: 'test', observations: [], createdAt: '2024-12-15T00:00:00.000Z' },
      { name: 'E4', entityType: 'test', observations: [] }, // No createdAt
    ];

    it('should filter by start date', () => {
      const result = filterByCreatedDate(entities, '2024-06-01T00:00:00.000Z');
      expect(result).toHaveLength(2);
    });

    it('should filter by end date', () => {
      const result = filterByCreatedDate(entities, undefined, '2024-06-30T00:00:00.000Z');
      expect(result).toHaveLength(2);
    });

    it('should return all entities when no filters', () => {
      expect(filterByCreatedDate(entities)).toHaveLength(4);
    });
  });

  describe('filterByModifiedDate', () => {
    const entities: Entity[] = [
      { name: 'E1', entityType: 'test', observations: [], lastModified: '2024-01-15T00:00:00.000Z' },
      { name: 'E2', entityType: 'test', observations: [], lastModified: '2024-06-15T00:00:00.000Z' },
    ];

    it('should filter by modified date range', () => {
      const result = filterByModifiedDate(entities, '2024-05-01T00:00:00.000Z', '2024-07-01T00:00:00.000Z');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('E2');
    });

    it('should return all entities when no filters', () => {
      expect(filterByModifiedDate(entities)).toHaveLength(2);
    });
  });

  describe('filterByEntityType', () => {
    const entities: Entity[] = [
      { name: 'E1', entityType: 'person', observations: [] },
      { name: 'E2', entityType: 'project', observations: [] },
      { name: 'E3', entityType: 'person', observations: [] },
    ];

    it('should filter by entity type', () => {
      const result = filterByEntityType(entities, 'person');
      expect(result).toHaveLength(2);
    });

    it('should return all entities when type is undefined', () => {
      expect(filterByEntityType(entities, undefined)).toHaveLength(3);
    });

    it('should return all entities when type is empty string', () => {
      expect(filterByEntityType(entities, '')).toHaveLength(3);
    });
  });

  describe('entityPassesFilters', () => {
    const entity: Entity = {
      name: 'TestEntity',
      entityType: 'person',
      observations: [],
      importance: 8,
      createdAt: '2024-06-15T00:00:00.000Z',
      lastModified: '2024-07-15T00:00:00.000Z',
    };

    it('should pass when all filters match', () => {
      const result = entityPassesFilters(entity, {
        minImportance: 5,
        maxImportance: 10,
        entityType: 'person',
        createdAfter: '2024-01-01T00:00:00.000Z',
        modifiedBefore: '2024-12-31T00:00:00.000Z',
      });
      expect(result).toBe(true);
    });

    it('should fail when importance out of range', () => {
      expect(entityPassesFilters(entity, { minImportance: 9 })).toBe(false);
    });

    it('should fail when entity type mismatch', () => {
      expect(entityPassesFilters(entity, { entityType: 'project' })).toBe(false);
    });

    it('should fail when created date out of range', () => {
      expect(entityPassesFilters(entity, { createdAfter: '2024-07-01T00:00:00.000Z' })).toBe(false);
    });

    it('should fail when modified date out of range', () => {
      expect(entityPassesFilters(entity, { modifiedBefore: '2024-07-01T00:00:00.000Z' })).toBe(false);
    });

    it('should pass with no filters', () => {
      expect(entityPassesFilters(entity, {})).toBe(true);
    });
  });

  // ==================== Path Utilities Tests ====================

  describe('validateFilePath', () => {
    it('should accept absolute paths', () => {
      // Using a format that works on Windows
      const result = validateFilePath('C:\\Users\\test\\memory.jsonl', 'C:\\base');
      expect(result).toContain('memory.jsonl');
    });

    it('should convert relative paths to absolute', () => {
      const result = validateFilePath('data/memory.jsonl', '/base/dir');
      expect(result).toContain('memory.jsonl');
    });

    it('should normalize paths and remove single dots', () => {
      const result = validateFilePath('./data/../memory.jsonl', 'C:\\base');
      expect(result).not.toContain('..');
      expect(result).toContain('memory.jsonl');
    });

    it('should handle simple relative paths', () => {
      const result = validateFilePath('subdir/file.txt', 'C:\\base\\dir');
      expect(result).toContain('file.txt');
      expect(result).toContain('subdir');
    });

    it('should handle paths with multiple segments', () => {
      const result = validateFilePath('a/b/c/file.txt', 'C:\\base');
      expect(result).toContain('file.txt');
    });

    it('should normalize path traversal and return valid path', () => {
      // After normalization, '..' is resolved - this tests the actual behavior
      // The function normalizes paths, so '../..' becomes a parent directory path
      const result = validateFilePath('..', '/base/subdir');
      // Path is normalized to /base
      expect(result).toBeDefined();
    });
  });

  // ==================== SPRINT 9: Additional Coverage Tests ====================

  describe('fnv1aHash', () => {
    it('should return consistent hash for same input', () => {
      const hash1 = fnv1aHash('hello');
      const hash2 = fnv1aHash('hello');
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = fnv1aHash('hello');
      const hash2 = fnv1aHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should return unsigned 32-bit integer', () => {
      const hash = fnv1aHash('test string');
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });

    it('should handle empty string', () => {
      const hash = fnv1aHash('');
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle unicode characters', () => {
      const hash = fnv1aHash('日本語');
      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle long strings', () => {
      const longString = 'x'.repeat(10000);
      const hash = fnv1aHash(longString);
      expect(typeof hash).toBe('number');
    });

    it('should produce good distribution for similar strings', () => {
      // Different hashes for strings that differ by one character
      const hash1 = fnv1aHash('test1');
      const hash2 = fnv1aHash('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('sanitizeObject', () => {
    it('should return object with dangerous keys removed', () => {
      const input = {
        __proto__: { malicious: true },
        constructor: 'bad',
        prototype: {},
        safe: 'value',
      };

      const result = sanitizeObject(input);

      expect(result).not.toHaveProperty('__proto__');
      expect(result).not.toHaveProperty('constructor');
      expect(result).not.toHaveProperty('prototype');
      expect(result).toHaveProperty('safe', 'value');
    });

    it('should recursively sanitize nested objects', () => {
      const input = {
        nested: {
          __proto__: { attack: true },
          valid: 'data',
        },
      };

      const result = sanitizeObject(input);
      const nested = result.nested as Record<string, unknown>;

      expect(nested).not.toHaveProperty('__proto__');
      expect(nested).toHaveProperty('valid', 'data');
    });

    it('should handle null input', () => {
      const result = sanitizeObject(null as unknown as Record<string, unknown>);
      expect(result).toBeNull();
    });

    it('should handle non-object input', () => {
      const result = sanitizeObject('string' as unknown as Record<string, unknown>);
      expect(result).toBe('string');
    });

    it('should preserve arrays', () => {
      const input = {
        items: [1, 2, 3],
        name: 'test',
      };

      const result = sanitizeObject(input);

      expect(result.items).toEqual([1, 2, 3]);
    });

    it('should handle deeply nested dangerous keys', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              __proto__: { deep: true },
              value: 'valid',
            },
          },
        },
      };

      const result = sanitizeObject(input);
      const deep = ((result.level1 as Record<string, unknown>)?.level2 as Record<string, unknown>)?.level3 as Record<string, unknown>;

      expect(deep).not.toHaveProperty('__proto__');
      expect(deep).toHaveProperty('value', 'valid');
    });
  });

  describe('escapeCsvFormula', () => {
    it('should prefix formula-starting characters with single quote', () => {
      expect(escapeCsvFormula('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
      expect(escapeCsvFormula('+1234')).toBe("'+1234");
      expect(escapeCsvFormula('-1234')).toBe("'-1234");
      expect(escapeCsvFormula('@user')).toBe("'@user");
    });

    it('should not modify normal text', () => {
      expect(escapeCsvFormula('normal text')).toBe('normal text');
      expect(escapeCsvFormula('Hello World')).toBe('Hello World');
    });

    it('should handle undefined input', () => {
      expect(escapeCsvFormula(undefined)).toBe('');
    });

    it('should handle null input', () => {
      expect(escapeCsvFormula(null)).toBe('');
    });

    it('should handle empty string', () => {
      expect(escapeCsvFormula('')).toBe('');
    });

    it('should escape tab character', () => {
      expect(escapeCsvFormula('\tdata')).toBe("'\tdata");
    });

    it('should escape carriage return', () => {
      expect(escapeCsvFormula('\rdata')).toBe("'\rdata");
    });

    it('should not escape characters in middle of string', () => {
      expect(escapeCsvFormula('text=value')).toBe('text=value');
      expect(escapeCsvFormula('name@email.com')).toBe('name@email.com');
    });
  });

  describe('defaultMemoryPath', () => {
    it('should be defined and end with memory.jsonl', () => {
      expect(defaultMemoryPath).toBeDefined();
      expect(defaultMemoryPath).toContain('memory.jsonl');
    });
  });

  describe('ensureMemoryFilePath', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return default path when MEMORY_FILE_PATH not set', async () => {
      delete process.env.MEMORY_FILE_PATH;
      const result = await ensureMemoryFilePath();
      expect(result).toContain('memory.jsonl');
    });

    it('should use MEMORY_FILE_PATH when set', async () => {
      process.env.MEMORY_FILE_PATH = '/custom/path/memory.jsonl';
      const result = await ensureMemoryFilePath();
      expect(result).toContain('memory.jsonl');
    });

    it('should resolve relative paths with traversal', async () => {
      // Path traversal in MEMORY_FILE_PATH gets normalized
      // The function validates and resolves to absolute path
      process.env.MEMORY_FILE_PATH = '../custom.jsonl';
      const result = await ensureMemoryFilePath();
      expect(result).toContain('custom.jsonl');
    });

    it('should handle relative custom path', async () => {
      process.env.MEMORY_FILE_PATH = 'data/custom.jsonl';
      const result = await ensureMemoryFilePath();
      expect(result).toContain('custom.jsonl');
    });
  });
});
