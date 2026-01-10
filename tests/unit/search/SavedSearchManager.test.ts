/**
 * SavedSearchManager Unit Tests
 *
 * Tests for saved search CRUD operations and usage tracking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SavedSearchManager } from '../../../src/search/SavedSearchManager.js';
import { BasicSearch } from '../../../src/search/BasicSearch.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SavedSearchManager', () => {
  let storage: GraphStorage;
  let basicSearch: BasicSearch;
  let manager: SavedSearchManager;
  let testDir: string;
  let graphFilePath: string;
  let savedSearchesFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `saved-search-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    graphFilePath = join(testDir, 'test-memory.jsonl');
    savedSearchesFilePath = join(testDir, 'test-saved-searches.jsonl');
    storage = new GraphStorage(graphFilePath);
    basicSearch = new BasicSearch(storage);
    manager = new SavedSearchManager(savedSearchesFilePath, basicSearch);

    // Set up test data
    await storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['Developer'], tags: ['team-a'], importance: 8 },
        { name: 'Bob', entityType: 'person', observations: ['Manager'], tags: ['team-b'], importance: 7 },
        { name: 'Project X', entityType: 'project', observations: ['Important project'], tags: ['active'] },
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

  describe('saveSearch', () => {
    it('should save a new search', async () => {
      const saved = await manager.saveSearch({
        name: 'My Search',
        query: 'test',
      });

      expect(saved.name).toBe('My Search');
      expect(saved.query).toBe('test');
      expect(saved.createdAt).toBeDefined();
      expect(saved.useCount).toBe(0);
    });

    it('should include optional fields', async () => {
      const saved = await manager.saveSearch({
        name: 'Tagged Search',
        query: 'developer',
        tags: ['team-a'],
        minImportance: 5,
        maxImportance: 10,
        description: 'Find developers',
      });

      expect(saved.tags).toEqual(['team-a']);
      expect(saved.minImportance).toBe(5);
      expect(saved.maxImportance).toBe(10);
      expect(saved.description).toBe('Find developers');
    });

    it('should throw error for duplicate name', async () => {
      await manager.saveSearch({ name: 'Unique', query: 'test' });

      await expect(manager.saveSearch({ name: 'Unique', query: 'other' })).rejects.toThrow(
        'Saved search with name "Unique" already exists'
      );
    });

    it('should persist to file', async () => {
      await manager.saveSearch({ name: 'Persistent', query: 'test' });

      const content = await fs.readFile(savedSearchesFilePath, 'utf-8');
      expect(content).toContain('Persistent');
      expect(content).toContain('test');
    });
  });

  describe('listSavedSearches', () => {
    it('should return empty array when no searches exist', async () => {
      const searches = await manager.listSavedSearches();
      expect(searches).toEqual([]);
    });

    it('should return all saved searches', async () => {
      await manager.saveSearch({ name: 'Search1', query: 'q1' });
      await manager.saveSearch({ name: 'Search2', query: 'q2' });
      await manager.saveSearch({ name: 'Search3', query: 'q3' });

      const searches = await manager.listSavedSearches();
      expect(searches).toHaveLength(3);
    });

    it('should include all properties', async () => {
      await manager.saveSearch({
        name: 'Full Search',
        query: 'test',
        tags: ['a', 'b'],
        description: 'desc',
      });

      const searches = await manager.listSavedSearches();
      expect(searches[0].name).toBe('Full Search');
      expect(searches[0].query).toBe('test');
      expect(searches[0].tags).toEqual(['a', 'b']);
      expect(searches[0].description).toBe('desc');
    });
  });

  describe('getSavedSearch', () => {
    it('should return search by name', async () => {
      await manager.saveSearch({ name: 'Find Me', query: 'test' });

      const search = await manager.getSavedSearch('Find Me');
      expect(search).not.toBeNull();
      expect(search?.name).toBe('Find Me');
    });

    it('should return null for non-existent search', async () => {
      const search = await manager.getSavedSearch('NonExistent');
      expect(search).toBeNull();
    });
  });

  describe('executeSavedSearch', () => {
    it('should execute search and return results', async () => {
      await manager.saveSearch({ name: 'Dev Search', query: 'Developer' });

      const results = await manager.executeSavedSearch('Dev Search');

      expect(results.entities).toHaveLength(1);
      expect(results.entities[0].name).toBe('Alice');
    });

    it('should update useCount after execution', async () => {
      await manager.saveSearch({ name: 'Counter', query: 'test' });

      await manager.executeSavedSearch('Counter');
      await manager.executeSavedSearch('Counter');
      await manager.executeSavedSearch('Counter');

      const search = await manager.getSavedSearch('Counter');
      expect(search?.useCount).toBe(3);
    });

    it('should update lastUsed after execution', async () => {
      await manager.saveSearch({ name: 'Timestamp', query: 'test' });

      const beforeExec = new Date().toISOString();
      await manager.executeSavedSearch('Timestamp');
      const afterExec = new Date().toISOString();

      const search = await manager.getSavedSearch('Timestamp');
      expect(search?.lastUsed).toBeDefined();
      expect(search?.lastUsed! >= beforeExec).toBe(true);
      expect(search?.lastUsed! <= afterExec).toBe(true);
    });

    it('should throw error for non-existent search', async () => {
      await expect(manager.executeSavedSearch('Missing')).rejects.toThrow(
        'Saved search "Missing" not found'
      );
    });

    it('should apply tag filters', async () => {
      await manager.saveSearch({
        name: 'Team A',
        query: 'person',
        tags: ['team-a'],
      });

      const results = await manager.executeSavedSearch('Team A');
      expect(results.entities).toHaveLength(1);
      expect(results.entities[0].name).toBe('Alice');
    });

    it('should apply importance filters', async () => {
      await manager.saveSearch({
        name: 'Important',
        query: 'person',
        minImportance: 8,
      });

      const results = await manager.executeSavedSearch('Important');
      expect(results.entities).toHaveLength(1);
      expect(results.entities[0].name).toBe('Alice');
    });
  });

  describe('deleteSavedSearch', () => {
    it('should delete existing search', async () => {
      await manager.saveSearch({ name: 'ToDelete', query: 'test' });

      const result = await manager.deleteSavedSearch('ToDelete');
      expect(result).toBe(true);

      const search = await manager.getSavedSearch('ToDelete');
      expect(search).toBeNull();
    });

    it('should return false for non-existent search', async () => {
      const result = await manager.deleteSavedSearch('NonExistent');
      expect(result).toBe(false);
    });

    it('should not affect other searches', async () => {
      await manager.saveSearch({ name: 'Keep1', query: 'a' });
      await manager.saveSearch({ name: 'Delete', query: 'b' });
      await manager.saveSearch({ name: 'Keep2', query: 'c' });

      await manager.deleteSavedSearch('Delete');

      const searches = await manager.listSavedSearches();
      expect(searches).toHaveLength(2);
      expect(searches.map(s => s.name)).toContain('Keep1');
      expect(searches.map(s => s.name)).toContain('Keep2');
    });
  });

  describe('updateSavedSearch', () => {
    it('should update query', async () => {
      await manager.saveSearch({ name: 'Update Me', query: 'old' });

      const updated = await manager.updateSavedSearch('Update Me', { query: 'new' });

      expect(updated.query).toBe('new');
      expect(updated.name).toBe('Update Me');
    });

    it('should update tags', async () => {
      await manager.saveSearch({ name: 'Tags', query: 'test', tags: ['old'] });

      const updated = await manager.updateSavedSearch('Tags', { tags: ['new1', 'new2'] });

      expect(updated.tags).toEqual(['new1', 'new2']);
    });

    it('should update importance range', async () => {
      await manager.saveSearch({ name: 'Importance', query: 'test' });

      const updated = await manager.updateSavedSearch('Importance', {
        minImportance: 3,
        maxImportance: 9,
      });

      expect(updated.minImportance).toBe(3);
      expect(updated.maxImportance).toBe(9);
    });

    it('should preserve unchanged fields', async () => {
      await manager.saveSearch({
        name: 'Preserve',
        query: 'original',
        tags: ['keep'],
        description: 'keep this',
      });

      await manager.updateSavedSearch('Preserve', { query: 'updated' });

      const search = await manager.getSavedSearch('Preserve');
      expect(search?.query).toBe('updated');
      expect(search?.tags).toEqual(['keep']);
      expect(search?.description).toBe('keep this');
    });

    it('should throw error for non-existent search', async () => {
      await expect(
        manager.updateSavedSearch('Missing', { query: 'test' })
      ).rejects.toThrow('Saved search "Missing" not found');
    });
  });

  describe('Persistence', () => {
    it('should persist across manager instances', async () => {
      await manager.saveSearch({ name: 'Persistent', query: 'test' });

      // Create new manager instance
      const newManager = new SavedSearchManager(savedSearchesFilePath, basicSearch);
      const searches = await newManager.listSavedSearches();

      expect(searches).toHaveLength(1);
      expect(searches[0].name).toBe('Persistent');
    });

    it('should handle empty file', async () => {
      await fs.writeFile(savedSearchesFilePath, '');

      const searches = await manager.listSavedSearches();
      expect(searches).toEqual([]);
    });

    it('should handle non-existent file', async () => {
      const searches = await manager.listSavedSearches();
      expect(searches).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in search name', async () => {
      await manager.saveSearch({ name: 'Test "quoted" & <special>', query: 'test' });

      const search = await manager.getSavedSearch('Test "quoted" & <special>');
      expect(search?.name).toBe('Test "quoted" & <special>');
    });

    it('should handle unicode in search name', async () => {
      await manager.saveSearch({ name: '日本語検索', query: 'test' });

      const search = await manager.getSavedSearch('日本語検索');
      expect(search?.name).toBe('日本語検索');
    });

    it('should handle empty query', async () => {
      await manager.saveSearch({ name: 'Empty Query', query: '' });

      const search = await manager.getSavedSearch('Empty Query');
      expect(search?.query).toBe('');
    });

    it('should handle very long query', async () => {
      const longQuery = 'a'.repeat(10000);
      await manager.saveSearch({ name: 'Long Query', query: longQuery });

      const search = await manager.getSavedSearch('Long Query');
      expect(search?.query).toBe(longQuery);
    });
  });
});
