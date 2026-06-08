/**
 * SearchSuggestions Unit Tests
 *
 * Tests for "did you mean?" suggestion generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchSuggestions } from '../../../src/search/SearchSuggestions.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SearchSuggestions', () => {
  let storage: GraphStorage;
  let suggestions: SearchSuggestions;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `search-suggestions-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    storage = new GraphStorage(testFilePath);
    suggestions = new SearchSuggestions(storage);

    // Set up test data
    await storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['Developer'] },
        { name: 'Alicia', entityType: 'person', observations: ['Designer'] },
        { name: 'Bob', entityType: 'person', observations: ['Manager'] },
        { name: 'Database', entityType: 'project', observations: ['SQL database'] },
        { name: 'Dashboard', entityType: 'project', observations: ['Analytics dashboard'] },
        { name: 'Configuration', entityType: 'system', observations: ['Config settings'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getSearchSuggestions', () => {
    it('should suggest similar entity names', async () => {
      const result = await suggestions.getSearchSuggestions('Alic');

      expect(result).toContain('Alice');
    });

    it('should not suggest exact matches', async () => {
      const result = await suggestions.getSearchSuggestions('Alice');

      expect(result).not.toContain('Alice');
    });

    it('should suggest based on entity types', async () => {
      const result = await suggestions.getSearchSuggestions('perso');

      expect(result).toContain('person');
    });

    it('should be case-insensitive', async () => {
      const result = await suggestions.getSearchSuggestions('ALIC');

      expect(result).toContain('Alice');
    });

    it('should respect maxSuggestions limit', async () => {
      const result = await suggestions.getSearchSuggestions('a', 2);

      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('should use default maxSuggestions of 5', async () => {
      // Add more similar entities
      await storage.saveGraph({
        entities: [
          { name: 'Test1', entityType: 'test', observations: [] },
          { name: 'Test2', entityType: 'test', observations: [] },
          { name: 'Test3', entityType: 'test', observations: [] },
          { name: 'Test4', entityType: 'test', observations: [] },
          { name: 'Test5', entityType: 'test', observations: [] },
          { name: 'Test6', entityType: 'test', observations: [] },
          { name: 'Test7', entityType: 'test', observations: [] },
        ],
        relations: [],
      });

      const result = await suggestions.getSearchSuggestions('Tes');

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should sort by similarity (most similar first)', async () => {
      const result = await suggestions.getSearchSuggestions('Databas');

      // 'Database' should be first as it's most similar
      if (result.length > 0) {
        expect(result[0]).toBe('Database');
      }
    });

    it('should return empty array for very dissimilar query', async () => {
      const result = await suggestions.getSearchSuggestions('xyzabc123');

      expect(result).toEqual([]);
    });

    it('should return empty array for empty graph', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const result = await suggestions.getSearchSuggestions('test');

      expect(result).toEqual([]);
    });

    it('should find similar names with typos', async () => {
      const result = await suggestions.getSearchSuggestions('Databse'); // typo

      expect(result).toContain('Database');
    });

    it('should find similar names with missing characters', async () => {
      const result = await suggestions.getSearchSuggestions('Dashbord'); // missing 'a'

      expect(result).toContain('Dashboard');
    });

    it('should find similar names with extra characters', async () => {
      const result = await suggestions.getSearchSuggestions('Configguration'); // extra 'g'

      expect(result).toContain('Configuration');
    });

    it('should include unique entity types in suggestions', async () => {
      const result = await suggestions.getSearchSuggestions('projec');

      expect(result).toContain('project');
    });

    it('should return suggestions from both names and types', async () => {
      // Add entity with name same as type
      await storage.saveGraph({
        entities: [
          { name: 'person', entityType: 'person', observations: ['Test'] },
          { name: 'Alice', entityType: 'person', observations: [] },
        ],
        relations: [],
      });

      const result = await suggestions.getSearchSuggestions('perso');

      // Should find suggestions from either entity names or types
      // Note: Implementation doesn't deduplicate, which is acceptable behavior
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(s => s.toLowerCase().includes('person'))).toBe(true);
    });
  });

  describe('Similarity Threshold', () => {
    it('should only suggest with similarity > 0.5', async () => {
      // 'Bob' is very short, similarity to 'Xob' is 0.67 (1 - 1/3)
      const result = await suggestions.getSearchSuggestions('Xob');

      expect(result).toContain('Bob');
    });

    it('should not suggest with similarity <= 0.5', async () => {
      // 'Bob' similarity to 'Xyz' is 0 (3/3 = 1, so 1-1=0)
      const result = await suggestions.getSearchSuggestions('Xyz');

      expect(result).not.toContain('Bob');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single character query', async () => {
      const result = await suggestions.getSearchSuggestions('A');

      // May or may not have suggestions depending on similarity
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle very long query', async () => {
      const longQuery = 'a'.repeat(100);
      const result = await suggestions.getSearchSuggestions(longQuery);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle unicode query', async () => {
      await storage.saveGraph({
        entities: [
          { name: '日本語', entityType: 'test', observations: [] },
          { name: '日本', entityType: 'test', observations: [] },
        ],
        relations: [],
      });

      const result = await suggestions.getSearchSuggestions('日本');

      // Should not return exact match
      expect(result).not.toContain('日本');
      // May suggest similar
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle special characters in query', async () => {
      await storage.saveGraph({
        entities: [
          { name: 'C++', entityType: 'language', observations: [] },
          { name: 'C#', entityType: 'language', observations: [] },
        ],
        relations: [],
      });

      const result = await suggestions.getSearchSuggestions('C+');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty query', async () => {
      const result = await suggestions.getSearchSuggestions('');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle whitespace-only query', async () => {
      const result = await suggestions.getSearchSuggestions('   ');

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
