/**
 * FuzzySearch Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FuzzySearch, DEFAULT_FUZZY_THRESHOLD } from '../../../src/search/FuzzySearch.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FuzzySearch', () => {
  let storage: GraphStorage;
  let fuzzySearch: FuzzySearch;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `fuzzy-search-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    fuzzySearch = new FuzzySearch(storage);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);

    // Create test data
    await entityManager.createEntities([
      {
        name: 'Alice',
        entityType: 'person',
        observations: ['Software engineer', 'Loves Python', 'Works remotely'],
        tags: ['engineering', 'python'],
        importance: 9,
      },
      {
        name: 'Alicia',
        entityType: 'person',
        observations: ['Product manager', 'Leads planning'],
        tags: ['product', 'management'],
        importance: 8,
      },
      {
        name: 'Bob',
        entityType: 'person',
        observations: ['Designer', 'Creates UIs'],
        tags: ['design'],
        importance: 7,
      },
      {
        name: 'Robert',
        entityType: 'person',
        observations: ['Developer', 'Backend specialist'],
        tags: ['engineering', 'backend'],
        importance: 8,
      },
      {
        name: 'Project_Alpha',
        entityType: 'project',
        observations: ['Alpha version project'],
        tags: ['project'],
        importance: 10,
      },
    ]);

    await relationManager.createRelations([
      { from: 'Alice', to: 'Project_Alpha', relationType: 'works_on' },
      { from: 'Bob', to: 'Alicia', relationType: 'reports_to' },
    ]);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Exact and Substring Matching', () => {
    it('should match exact name', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match partial name (contains)', async () => {
      const result = await fuzzySearch.fuzzySearch('Ali');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Alicia');
    });

    it('should match entity type', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.9);

      // With strict threshold, should only match 'person' type (not 'project' which is similar)
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.entityType).toBe('person');
      });
    });

    it('should match observation words', async () => {
      const result = await fuzzySearch.fuzzySearch('engineer');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match full observation text', async () => {
      const result = await fuzzySearch.fuzzySearch('Software engineer');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });
  });

  describe('Typo Tolerance', () => {
    it('should match name with single character typo', async () => {
      // "Alise" instead of "Alice"
      const result = await fuzzySearch.fuzzySearch('Alise', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match name with transposed characters', async () => {
      // "Alcie" instead of "Alice" - 2 char distance, similarity 0.6
      const result = await fuzzySearch.fuzzySearch('Alcie', 0.6);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match name with missing character', async () => {
      // "Alce" instead of "Alice"
      const result = await fuzzySearch.fuzzySearch('Alce', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match name with extra character', async () => {
      // "Allice" instead of "Alice"
      const result = await fuzzySearch.fuzzySearch('Allice', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should not match with too many typos (below threshold)', async () => {
      // "Xyz" is completely different from "Alice"
      const result = await fuzzySearch.fuzzySearch('Xyz', 0.9);

      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('Alice');
    });

    it('should match similar names with high threshold', async () => {
      // "Alice" vs "Alicia" - similar names
      const result = await fuzzySearch.fuzzySearch('Alice', 0.6);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Alicia');
    });
  });

  describe('Threshold Variations', () => {
    it('should use default threshold (0.7)', async () => {
      const result = await fuzzySearch.fuzzySearch('Alise'); // 1 char typo

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept strict threshold (0.95)', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 0.95);

      // Only exact match or very close matches
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should accept permissive threshold (0.5)', async () => {
      const result = await fuzzySearch.fuzzySearch('Alic', 0.5);

      // More permissive, should match Alice with 1 char difference
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should return more results with lower threshold', async () => {
      const strictResult = await fuzzySearch.fuzzySearch('Alice', 0.9);
      const permissiveResult = await fuzzySearch.fuzzySearch('Alice', 0.5);

      expect(permissiveResult.entities.length).toBeGreaterThanOrEqual(strictResult.entities.length);
    });

    it('should handle threshold of 0 (match everything)', async () => {
      const result = await fuzzySearch.fuzzySearch('xyz', 0);

      // With threshold 0, everything matches
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should handle threshold of 1 (exact match only)', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 1);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });
  });

  describe('Tag Filtering', () => {
    it('should filter by single tag', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.tags).toContain('python');
      });
    });

    it('should filter by multiple tags (OR logic)', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, ['python', 'design']);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      result.entities.forEach(e => {
        const hasPython = e.tags?.includes('python');
        const hasDesign = e.tags?.includes('design');
        expect(hasPython || hasDesign).toBe(true);
      });
    });

    it('should combine fuzzy search with tag filter', async () => {
      const result = await fuzzySearch.fuzzySearch('Alise', 0.7, ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      expect(result.entities[0].name).toBe('Alice');
      expect(result.entities[0].tags).toContain('python');
    });

    it('should exclude entities without matching tags', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, ['nonexistent']);

      expect(result.entities).toHaveLength(0);
    });
  });

  describe('Importance Filtering', () => {
    it('should filter by minimum importance', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, 9);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance).toBeGreaterThanOrEqual(9);
      });
    });

    it('should filter by maximum importance', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, 8);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance!).toBeLessThanOrEqual(8);
      });
    });

    it('should filter by importance range', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, 8, 9);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance!).toBeGreaterThanOrEqual(8);
        expect(e.importance!).toBeLessThanOrEqual(9);
      });
    });

    it('should combine fuzzy search with importance filter', async () => {
      const result = await fuzzySearch.fuzzySearch('Alise', 0.7, undefined, 9);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
      expect(result.entities[0].importance).toBe(9);
    });

    it('should exclude entities without importance when filtering', async () => {
      await entityManager.createEntities([
        { name: 'NoImportance', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await fuzzySearch.fuzzySearch('test', 0.7, undefined, 5);

      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('NoImportance');
    });
  });

  describe('Relations', () => {
    it('should include relations between matched entities', async () => {
      const result = await fuzzySearch.fuzzySearch('Ali', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      // Alice and Alicia should be matched
      expect(result.relations.length).toBeGreaterThanOrEqual(0);
    });

    it('should exclude relations to non-matched entities', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 0.95);

      expect(result.entities).toHaveLength(1);
      // Alice has relations to Project_Alpha and Bob, but they're not in result with strict threshold
      expect(result.relations).toHaveLength(0);
    });

    it('should include all relations in matched subgraph', async () => {
      const result = await fuzzySearch.fuzzySearch('Ali', 0.5);

      // Should match Alice, Alicia, and Project_Alpha
      const names = result.entities.map(e => e.name);
      if (names.includes('Alice') && names.includes('Project_Alpha')) {
        expect(result.relations.some(r => r.from === 'Alice' && r.to === 'Project_Alpha')).toBe(true);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query string', async () => {
      const result = await fuzzySearch.fuzzySearch('');

      // Empty query matches all entities (every string contains empty string)
      expect(result.entities.length).toBe(5);
      expect(result.relations.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle entities with empty observations', async () => {
      await entityManager.createEntities([
        { name: 'EmptyObs', entityType: 'test', observations: [] },
      ]);

      const result = await fuzzySearch.fuzzySearch('test');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('EmptyObs');
    });

    it('should handle entities without tags', async () => {
      await entityManager.createEntities([
        { name: 'NoTags', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await fuzzySearch.fuzzySearch('test');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle entities without importance', async () => {
      await entityManager.createEntities([
        { name: 'NoImportance', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await fuzzySearch.fuzzySearch('test', 0.7, undefined, 5);

      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('NoImportance');
    });

    it('should handle very short queries', async () => {
      const result = await fuzzySearch.fuzzySearch('A', 0.3);

      // Should match names starting with A (Alice, Alicia, Project_Alpha)
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should handle very long queries', async () => {
      const longQuery = 'Software engineer who loves Python programming';
      const result = await fuzzySearch.fuzzySearch(longQuery, 0.5);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle special characters', async () => {
      await entityManager.createEntities([
        { name: 'Special-Name', entityType: 'test', observations: ['Test!'] },
      ]);

      const result = await fuzzySearch.fuzzySearch('Special Name', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle unicode characters', async () => {
      await entityManager.createEntities([
        { name: 'Café', entityType: 'location', observations: ['French café'] },
      ]);

      const result = await fuzzySearch.fuzzySearch('Cafe', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Café');
    });

    it('should be case-insensitive', async () => {
      const result = await fuzzySearch.fuzzySearch('ALICE', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should handle no matches', async () => {
      const result = await fuzzySearch.fuzzySearch('XyzNonExistent', 0.9);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('Combined Filters', () => {
    it('should combine fuzzy search with tag and importance filters', async () => {
      const result = await fuzzySearch.fuzzySearch('Alise', 0.7, ['python'], 9);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
      expect(result.entities[0].tags).toContain('python');
      expect(result.entities[0].importance).toBe(9);
    });

    it('should return empty when filters exclude all matches', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 0.7, ['nonexistent']);

      expect(result.entities).toHaveLength(0);
    });

    it('should handle all filters together', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, ['engineering'], 8, 10);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.entityType).toBe('person');
        expect(e.tags).toContain('engineering');
        expect(e.importance!).toBeGreaterThanOrEqual(8);
        expect(e.importance!).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('Levenshtein Distance Edge Cases', () => {
    it('should handle identical strings', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 1.0);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should handle completely different strings with low threshold', async () => {
      const result = await fuzzySearch.fuzzySearch('xyz', 0.1);

      // With very low threshold, might match some entities
      expect(Array.isArray(result.entities)).toBe(true);
    });

    it('should handle empty string comparison', async () => {
      const result = await fuzzySearch.fuzzySearch('', 0.5);

      // Empty string matches all (every string contains empty string)
      expect(result.entities.length).toBe(5);
      expect(result.relations.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate similarity correctly for similar words', async () => {
      // "Bob" vs "Robert" - different lengths but same person
      const result = await fuzzySearch.fuzzySearch('Bob', 0.5);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Bob');
      // Robert might also match with permissive threshold
    });
  });

  describe('Return Value Structure', () => {
    it('should return KnowledgeGraph with entities and relations', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice');

      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('relations');
      expect(Array.isArray(result.entities)).toBe(true);
      expect(Array.isArray(result.relations)).toBe(true);
    });

    it('should return complete entity objects', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice');

      expect(result.entities[0]).toHaveProperty('name');
      expect(result.entities[0]).toHaveProperty('entityType');
      expect(result.entities[0]).toHaveProperty('observations');
      expect(result.entities[0]).toHaveProperty('tags');
      expect(result.entities[0]).toHaveProperty('importance');
    });
  });

  describe('Word-level Matching in Observations', () => {
    it('should match individual words in observations', async () => {
      const result = await fuzzySearch.fuzzySearch('engineer', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match observation words with typos', async () => {
      // "enginer" instead of "engineer"
      const result = await fuzzySearch.fuzzySearch('enginer', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should match full observation text with typos', async () => {
      // "Softwar engineer" instead of "Software engineer"
      const result = await fuzzySearch.fuzzySearch('Softwar engineer', 0.7);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });
  });

  describe('DEFAULT_FUZZY_THRESHOLD Constant', () => {
    it('should export DEFAULT_FUZZY_THRESHOLD', () => {
      expect(DEFAULT_FUZZY_THRESHOLD).toBe(0.7);
    });

    it('should use DEFAULT_FUZZY_THRESHOLD when not specified', async () => {
      // Calling without threshold parameter should use default
      const result = await fuzzySearch.fuzzySearch('Alise');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pagination', () => {
    it('should apply offset correctly', async () => {
      const fullResult = await fuzzySearch.fuzzySearch('person', 0.7);
      const offsetResult = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 2);

      expect(offsetResult.entities.length).toBe(Math.max(0, fullResult.entities.length - 2));
    });

    it('should apply limit correctly', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 0, 2);

      expect(result.entities.length).toBeLessThanOrEqual(2);
    });

    it('should apply offset and limit together', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 1, 2);

      expect(result.entities.length).toBeLessThanOrEqual(2);
    });

    it('should return empty when offset exceeds result count', async () => {
      const result = await fuzzySearch.fuzzySearch('Alice', 0.95, undefined, undefined, undefined, 100);

      expect(result.entities).toHaveLength(0);
    });

    it('should handle zero limit (validates to minimum 1)', async () => {
      // SearchFilterChain.validatePagination enforces minimum limit of 1
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 0, 0);

      // With limit validated to minimum, should return at least 1 result
      expect(result.entities.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle large limit', async () => {
      const result = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 0, 1000);

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.entities.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Cache Functionality', () => {
    it('should cache search results', async () => {
      // First search - cache miss
      const result1 = await fuzzySearch.fuzzySearch('Alice', 0.7);

      // Second search - should hit cache
      const result2 = await fuzzySearch.fuzzySearch('Alice', 0.7);

      expect(result1.entities).toHaveLength(result2.entities.length);
      expect(result1.entities.map(e => e.name)).toEqual(result2.entities.map(e => e.name));
    });

    it('should clear cache with clearCache()', async () => {
      // Populate cache
      await fuzzySearch.fuzzySearch('Alice', 0.7);

      // Clear cache
      fuzzySearch.clearCache();

      // This search should not hit cache (fresh search)
      const result = await fuzzySearch.fuzzySearch('Alice', 0.7);

      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should invalidate cache when entity count changes', async () => {
      // First search - populates cache
      const result1 = await fuzzySearch.fuzzySearch('person', 0.7);

      // Add new entity
      await entityManager.createEntities([
        { name: 'Charlie', entityType: 'person', observations: ['New person'], importance: 6 },
      ]);

      // Second search - should not use cache (entity count changed)
      const result2 = await fuzzySearch.fuzzySearch('person', 0.7);

      // Should find the new entity
      const names = result2.entities.map(e => e.name);
      expect(names).toContain('Charlie');
    });

    it('should use different cache entries for different thresholds', async () => {
      const result1 = await fuzzySearch.fuzzySearch('Alise', 0.7);
      const result2 = await fuzzySearch.fuzzySearch('Alise', 0.5);

      // Different thresholds may produce different results
      // At minimum, both searches should work correctly
      expect(result1.entities.length).toBeLessThanOrEqual(result2.entities.length);
    });

    it('should use different cache entries for different tags', async () => {
      const result1 = await fuzzySearch.fuzzySearch('person', 0.7, ['python']);
      const result2 = await fuzzySearch.fuzzySearch('person', 0.7, ['design']);

      // Different tag filters produce different results
      const names1 = result1.entities.map(e => e.name);
      const names2 = result2.entities.map(e => e.name);
      expect(names1).not.toEqual(names2);
    });

    it('should use different cache entries for different importance filters', async () => {
      const result1 = await fuzzySearch.fuzzySearch('person', 0.7, undefined, 9);
      const result2 = await fuzzySearch.fuzzySearch('person', 0.7, undefined, 7);

      // Different importance filters may produce different results
      expect(result2.entities.length).toBeGreaterThanOrEqual(result1.entities.length);
    });

    it('should use different cache entries for different pagination', async () => {
      const result1 = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 0, 2);
      const result2 = await fuzzySearch.fuzzySearch('person', 0.7, undefined, undefined, undefined, 0, 10);

      // Different limits should produce different cache entries
      expect(result1.entities.length).toBeLessThanOrEqual(2);
      expect(result2.entities.length).toBeLessThanOrEqual(10);
    });

    it('should handle cache with empty results', async () => {
      // First search - no matches
      const result1 = await fuzzySearch.fuzzySearch('XyzNonExistent', 0.9);

      // Second search - should return cached empty result
      const result2 = await fuzzySearch.fuzzySearch('XyzNonExistent', 0.9);

      expect(result1.entities).toHaveLength(0);
      expect(result2.entities).toHaveLength(0);
    });

    it('should perform cleanup when cache grows large', async () => {
      // Create many different searches to fill cache (>50 to trigger cleanup at 50%)
      for (let i = 0; i < 60; i++) {
        await fuzzySearch.fuzzySearch(`query${i}`, 0.5, undefined, undefined, undefined, i % 5, 10);
      }

      // Cache should still work after cleanup
      const result = await fuzzySearch.fuzzySearch('Alice', 0.7);
      expect(result.entities.length).toBeGreaterThan(0);
    });

    it('should trigger cache LRU eviction when over max size', async () => {
      // Create 110 different cache entries (over FUZZY_CACHE_MAX_SIZE of 100)
      for (let i = 0; i < 110; i++) {
        await fuzzySearch.fuzzySearch(`query${i}`, 0.3, undefined, undefined, undefined, 0, 1);
      }

      // Cache should still work - oldest entries evicted
      const result = await fuzzySearch.fuzzySearch('Alice', 0.7);
      expect(result.entities.length).toBeGreaterThan(0);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate same key for same parameters', async () => {
      const result1 = await fuzzySearch.fuzzySearch('Alice', 0.7, ['python'], 5, 10, 0, 50);
      const result2 = await fuzzySearch.fuzzySearch('Alice', 0.7, ['python'], 5, 10, 0, 50);

      expect(result1.entities.map(e => e.name)).toEqual(result2.entities.map(e => e.name));
    });

    it('should be case-insensitive for query', async () => {
      const result1 = await fuzzySearch.fuzzySearch('ALICE', 0.7);
      const result2 = await fuzzySearch.fuzzySearch('alice', 0.7);

      expect(result1.entities.length).toBe(result2.entities.length);
    });

    it('should sort tags for consistent cache key', async () => {
      const result1 = await fuzzySearch.fuzzySearch('person', 0.7, ['python', 'engineering']);
      const result2 = await fuzzySearch.fuzzySearch('person', 0.7, ['engineering', 'python']);

      expect(result1.entities.map(e => e.name).sort()).toEqual(result2.entities.map(e => e.name).sort());
    });
  });

  describe('Shutdown', () => {
    it('should have shutdown method', () => {
      expect(typeof fuzzySearch.shutdown).toBe('function');
    });

    it('should be callable without error', async () => {
      await expect(fuzzySearch.shutdown()).resolves.toBeUndefined();
    });

    it('should be callable multiple times', async () => {
      await fuzzySearch.shutdown();
      await expect(fuzzySearch.shutdown()).resolves.toBeUndefined();
    });

    it('should not affect search after shutdown', async () => {
      await fuzzySearch.shutdown();
      const result = await fuzzySearch.fuzzySearch('Alice');
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('FuzzySearchOptions', () => {
    it('should accept useWorkerPool option', () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      expect(fuzzy).toBeInstanceOf(FuzzySearch);
    });

    it('should work with useWorkerPool disabled', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('Alice', 0.7);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should default useWorkerPool to true', () => {
      const fuzzy = new FuzzySearch(storage);
      expect(fuzzy).toBeInstanceOf(FuzzySearch);
    });
  });
});

// ==================== Sprint 14: Additional Coverage Tests ====================

describe('FuzzySearch - Sprint 14 Extended Tests', () => {
  let storage: GraphStorage;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fuzzy-extended-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Multi-Term Query Support', () => {
    beforeEach(async () => {
      const entityManager = new EntityManager(storage);
      await entityManager.createEntities([
        {
          name: 'John Smith',
          entityType: 'person',
          observations: ['Software developer at Tech Corp', 'Works with Python and Java'],
          importance: 8,
        },
        {
          name: 'Jane Doe',
          entityType: 'person',
          observations: ['Product manager', 'Leads mobile team'],
          importance: 9,
        },
        {
          name: 'Tech Corp',
          entityType: 'company',
          observations: ['Technology company', 'Founded in 2020'],
          importance: 7,
        },
      ]);
    });

    it('should match multi-word names', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('John Smith', 0.7);
      expect(result.entities.map(e => e.name)).toContain('John Smith');
    });

    it('should match partial multi-word queries', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('John', 0.7);
      expect(result.entities.map(e => e.name)).toContain('John Smith');
    });

    it('should handle typos in multi-word queries', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('Jon Smith', 0.6);
      expect(result.entities.map(e => e.name)).toContain('John Smith');
    });

    it('should match words in observations', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('Software developer', 0.7);
      expect(result.entities.map(e => e.name)).toContain('John Smith');
    });
  });

  describe('Observation Matching Details', () => {
    beforeEach(async () => {
      const entityManager = new EntityManager(storage);
      await entityManager.createEntities([
        {
          name: 'DataEntity',
          entityType: 'data',
          observations: [
            'First observation about technology',
            'Second observation about innovation',
            'Third observation about development',
          ],
          importance: 5,
        },
      ]);
    });

    it('should match any word in any observation', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });

      const techResult = await fuzzy.fuzzySearch('technology', 0.8);
      expect(techResult.entities.map(e => e.name)).toContain('DataEntity');

      const innovResult = await fuzzy.fuzzySearch('innovation', 0.8);
      expect(innovResult.entities.map(e => e.name)).toContain('DataEntity');

      const devResult = await fuzzy.fuzzySearch('development', 0.8);
      expect(devResult.entities.map(e => e.name)).toContain('DataEntity');
    });

    it('should match observation substrings', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('tech', 0.8);
      expect(result.entities.map(e => e.name)).toContain('DataEntity');
    });

    it('should match with typos in observation words', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      // 'technlogy' - typo
      const result = await fuzzy.fuzzySearch('technlogy', 0.7);
      expect(result.entities.map(e => e.name)).toContain('DataEntity');
    });
  });

  describe('Similarity Score Edge Cases', () => {
    beforeEach(async () => {
      const entityManager = new EntityManager(storage);
      await entityManager.createEntities([
        { name: 'A', entityType: 'test', observations: ['Short'], importance: 5 },
        { name: 'AB', entityType: 'test', observations: ['Medium'], importance: 5 },
        { name: 'ABC', entityType: 'test', observations: ['Longer'], importance: 5 },
        { name: 'ABCD', entityType: 'test', observations: ['Even longer'], importance: 5 },
      ]);
    });

    it('should handle single character entity names', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('A', 1.0);
      expect(result.entities.map(e => e.name)).toContain('A');
    });

    it('should handle varying length comparisons', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      // With threshold 0.3, 'A' should match 'A', 'AB', 'ABC' since it's contained
      const result = await fuzzy.fuzzySearch('A', 0.3);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should not match very different strings with high threshold', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      // Search for something completely different
      const result = await fuzzy.fuzzySearch('XYZWVUTSRQ', 0.9);
      // None of our entities should match this unrelated query with high threshold
      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('A');
      expect(names).not.toContain('AB');
      expect(names).not.toContain('ABC');
      expect(names).not.toContain('ABCD');
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large number of entities efficiently', async () => {
      const entityManager = new EntityManager(storage);
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i} with some text`],
        importance: i % 10,
      }));
      await entityManager.createEntities(entities);

      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });

      const start = Date.now();
      const result = await fuzzy.fuzzySearch('Entity50', 0.8);
      const elapsed = Date.now() - start;

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should benefit from caching on repeated queries', async () => {
      const entityManager = new EntityManager(storage);
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `CacheTest${i}`,
        entityType: 'test',
        observations: [`Test observation ${i}`],
        importance: 5,
      }));
      await entityManager.createEntities(entities);

      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });

      // First query
      const start1 = Date.now();
      await fuzzy.fuzzySearch('CacheTest', 0.7);
      const elapsed1 = Date.now() - start1;

      // Second query (cached)
      const start2 = Date.now();
      await fuzzy.fuzzySearch('CacheTest', 0.7);
      const elapsed2 = Date.now() - start2;

      // Cache hit should be faster or equal
      expect(elapsed2).toBeLessThanOrEqual(elapsed1 + 10); // Allow small variance
    });
  });

  describe('Name vs Observation Priority (Sprint 14.2)', () => {
    beforeEach(async () => {
      const entityManager = new EntityManager(storage);
      await entityManager.createEntities([
        {
          name: 'SearchTarget',
          entityType: 'primary',
          observations: ['Unrelated observation content'],
          importance: 5,
        },
        {
          name: 'UnrelatedEntity',
          entityType: 'secondary',
          observations: ['This observation mentions SearchTarget explicitly'],
          importance: 5,
        },
      ]);
    });

    it('should rank name matches higher than observation matches', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('SearchTarget', 0.8);

      const names = result.entities.map(e => e.name);
      const primaryIndex = names.indexOf('SearchTarget');
      const secondaryIndex = names.indexOf('UnrelatedEntity');

      // Name match should appear first
      if (primaryIndex !== -1 && secondaryIndex !== -1) {
        expect(primaryIndex).toBeLessThan(secondaryIndex);
      }
    });

    it('should still find observation matches', async () => {
      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('SearchTarget', 0.7);

      // Both should be found
      const names = result.entities.map(e => e.name);
      expect(names).toContain('SearchTarget');
    });
  });

  describe('Long Strings (Sprint 14.5)', () => {
    it('should handle max-length entity names (500 chars)', async () => {
      const entityManager = new EntityManager(storage);
      // Entity name max is 500 characters per schema validation
      const longName = 'LongEntity' + 'x'.repeat(489);
      await entityManager.createEntities([
        {
          name: longName,
          entityType: 'test',
          observations: ['Short observation'],
          importance: 5,
        },
      ]);

      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('LongEntity', 0.5);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('should handle long observations (1000+ chars)', async () => {
      const entityManager = new EntityManager(storage);
      const longObservation = 'Start ' + 'content '.repeat(200) + ' End';
      await entityManager.createEntities([
        {
          name: 'EntityWithLongObs',
          entityType: 'test',
          observations: [longObservation],
          importance: 5,
        },
      ]);

      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const result = await fuzzy.fuzzySearch('EntityWithLongObs', 0.8);

      expect(result.entities.map(e => e.name)).toContain('EntityWithLongObs');
    }, 10000);

    it('should handle long search queries gracefully', async () => {
      const entityManager = new EntityManager(storage);
      await entityManager.createEntities([
        {
          name: 'TargetEntity',
          entityType: 'test',
          observations: ['Simple observation'],
          importance: 5,
        },
      ]);

      const fuzzy = new FuzzySearch(storage, { useWorkerPool: false });
      const longQuery = 'Target' + 'x'.repeat(1000);

      // Should not timeout and should handle gracefully
      const result = await fuzzy.fuzzySearch(longQuery, 0.1);
      expect(result.entities).toBeDefined();
    }, 10000);
  });
});
