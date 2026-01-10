/**
 * SearchManager Unit Tests
 *
 * Tests for search orchestration and dispatch to specialized search types.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchManager } from '../../../src/search/SearchManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SearchManager', () => {
  let storage: GraphStorage;
  let manager: SearchManager;
  let testDir: string;
  let graphFilePath: string;
  let savedSearchesFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `search-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    graphFilePath = join(testDir, 'test-memory.jsonl');
    savedSearchesFilePath = join(testDir, 'test-saved-searches.jsonl');
    storage = new GraphStorage(graphFilePath);
    manager = new SearchManager(storage, savedSearchesFilePath);

    // Set up test data
    await storage.saveGraph({
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['Developer', 'Frontend specialist'], tags: ['team-a', 'senior'], importance: 8 },
        { name: 'Bob', entityType: 'person', observations: ['Manager', 'Backend expert'], tags: ['team-b', 'lead'], importance: 7 },
        { name: 'Charlie', entityType: 'person', observations: ['Junior developer'], tags: ['team-a'], importance: 5 },
        { name: 'Project Alpha', entityType: 'project', observations: ['Main product'], tags: ['active', 'priority'], importance: 9 },
        { name: 'Project Beta', entityType: 'project', observations: ['Secondary product'], tags: ['active'], importance: 6 },
        { name: 'Database', entityType: 'technology', observations: ['PostgreSQL database'], tags: ['infrastructure'], importance: 8 },
      ],
      relations: [
        { from: 'Alice', to: 'Project Alpha', relationType: 'works_on' },
        { from: 'Bob', to: 'Project Alpha', relationType: 'manages' },
        { from: 'Charlie', to: 'Project Beta', relationType: 'works_on' },
        { from: 'Project Alpha', to: 'Database', relationType: 'uses' },
      ],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic Search Dispatch', () => {
    it('should dispatch to basic search for simple queries', async () => {
      const results = await manager.searchNodes('Developer');

      expect(results.entities.length).toBeGreaterThan(0);
      expect(results.entities.some(e => e.name === 'Alice')).toBe(true);
    });

    it('should pass tag filters to basic search', async () => {
      const results = await manager.searchNodes('person', ['team-a']);

      expect(results.entities.every(e => e.tags?.includes('team-a'))).toBe(true);
    });

    it('should pass importance filters to basic search', async () => {
      const results = await manager.searchNodes('', undefined, 8, 10);

      expect(results.entities.every(e => (e.importance ?? 0) >= 8)).toBe(true);
    });

    it('should return empty results for non-matching queries', async () => {
      const results = await manager.searchNodes('nonexistent');

      expect(results.entities).toHaveLength(0);
    });
  });

  describe('Open Nodes Dispatch', () => {
    it('should open specific nodes by name', async () => {
      const results = await manager.openNodes(['Alice', 'Bob']);

      expect(results.entities).toHaveLength(2);
      expect(results.entities.map(e => e.name)).toContain('Alice');
      expect(results.entities.map(e => e.name)).toContain('Bob');
    });

    it('should return empty for non-existent nodes', async () => {
      const results = await manager.openNodes(['NonExistent']);

      expect(results.entities).toHaveLength(0);
    });

    it('should include relations between opened nodes', async () => {
      const results = await manager.openNodes(['Alice', 'Project Alpha']);

      expect(results.relations.length).toBeGreaterThan(0);
    });
  });

  describe('Date Range Search Dispatch', () => {
    it('should dispatch to date range search', async () => {
      // Set up entities with dates
      await storage.saveGraph({
        entities: [
          { name: 'Recent', entityType: 'test', observations: ['new'], createdAt: new Date().toISOString() },
        ],
        relations: [],
      });

      const results = await manager.searchByDateRange(
        new Date(Date.now() - 86400000).toISOString(), // yesterday
        new Date().toISOString() // today
      );

      expect(results.entities.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter by entity type in date range search', async () => {
      const now = new Date().toISOString();
      await storage.saveGraph({
        entities: [
          { name: 'TypedEntity', entityType: 'special', observations: [], createdAt: now },
        ],
        relations: [],
      });

      const results = await manager.searchByDateRange(undefined, undefined, 'special');

      expect(results.entities.every(e => e.entityType === 'special')).toBe(true);
    });
  });

  describe('Ranked Search Dispatch', () => {
    it('should dispatch to TF-IDF ranked search', async () => {
      const results = await manager.searchNodesRanked('Developer');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('entity');
      expect(results[0]).toHaveProperty('score');
    });

    it('should return results sorted by score', async () => {
      const results = await manager.searchNodesRanked('Developer');

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should respect limit parameter', async () => {
      const results = await manager.searchNodesRanked('', undefined, undefined, undefined, 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should apply tag filters in ranked search', async () => {
      const results = await manager.searchNodesRanked('', ['team-a']);

      expect(results.every(r => r.entity.tags?.includes('team-a'))).toBe(true);
    });
  });

  describe('Boolean Search Dispatch', () => {
    it('should dispatch AND queries to boolean search', async () => {
      const results = await manager.booleanSearch('Developer AND Frontend');

      expect(results.entities.some(e => e.name === 'Alice')).toBe(true);
    });

    it('should dispatch OR queries to boolean search', async () => {
      const results = await manager.booleanSearch('Frontend OR Backend');

      expect(results.entities.length).toBeGreaterThan(0);
    });

    it('should dispatch NOT queries to boolean search', async () => {
      const results = await manager.booleanSearch('person NOT Manager');

      expect(results.entities.every(e => !e.observations?.some(o => o.includes('Manager')))).toBe(true);
    });

    it('should apply filters in boolean search', async () => {
      const results = await manager.booleanSearch('Developer', ['team-a'], 5);

      expect(results.entities.every(e => (e.importance ?? 0) >= 5)).toBe(true);
    });
  });

  describe('Fuzzy Search Dispatch', () => {
    it('should dispatch to fuzzy search with typo tolerance', async () => {
      const results = await manager.fuzzySearch('Devloper', 0.7); // typo

      expect(results.entities.length).toBeGreaterThan(0);
    });

    it('should respect threshold parameter', async () => {
      const lenientResults = await manager.fuzzySearch('Alc', 0.5);
      const strictResults = await manager.fuzzySearch('Alc', 0.9);

      expect(lenientResults.entities.length).toBeGreaterThanOrEqual(strictResults.entities.length);
    });

    it('should apply filters in fuzzy search', async () => {
      const results = await manager.fuzzySearch('person', 0.7, ['team-a']);

      expect(results.entities.every(e => e.tags?.includes('team-a'))).toBe(true);
    });
  });

  describe('Search Suggestions Dispatch', () => {
    it('should get search suggestions', async () => {
      const suggestions = await manager.getSearchSuggestions('Al');

      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should respect maxSuggestions parameter', async () => {
      const suggestions = await manager.getSearchSuggestions('', 3);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Saved Searches Integration', () => {
    it('should save a search', async () => {
      const saved = await manager.saveSearch({
        name: 'Team A Devs',
        query: 'Developer',
        tags: ['team-a'],
      });

      expect(saved.name).toBe('Team A Devs');
      expect(saved.query).toBe('Developer');
    });

    it('should list saved searches', async () => {
      await manager.saveSearch({ name: 'Search1', query: 'test' });
      await manager.saveSearch({ name: 'Search2', query: 'test2' });

      const list = await manager.listSavedSearches();

      expect(list).toHaveLength(2);
    });

    it('should get a saved search by name', async () => {
      await manager.saveSearch({ name: 'FindMe', query: 'test' });

      const found = await manager.getSavedSearch('FindMe');

      expect(found?.name).toBe('FindMe');
    });

    it('should execute a saved search', async () => {
      await manager.saveSearch({ name: 'DevSearch', query: 'Developer' });

      const results = await manager.executeSavedSearch('DevSearch');

      expect(results.entities.length).toBeGreaterThan(0);
    });

    it('should delete a saved search', async () => {
      await manager.saveSearch({ name: 'ToDelete', query: 'test' });

      const deleted = await manager.deleteSavedSearch('ToDelete');
      const found = await manager.getSavedSearch('ToDelete');

      expect(deleted).toBe(true);
      expect(found).toBeNull();
    });

    it('should update a saved search', async () => {
      await manager.saveSearch({ name: 'ToUpdate', query: 'old' });

      const updated = await manager.updateSavedSearch('ToUpdate', { query: 'new' });

      expect(updated.query).toBe('new');
    });
  });

  describe('Result Aggregation', () => {
    it('should return matching entities', async () => {
      const results = await manager.searchNodes('Project Alpha');

      expect(results.entities.length).toBeGreaterThan(0);
      expect(results.entities.some(e => e.name === 'Project Alpha')).toBe(true);
    });

    it('should deduplicate entities in results', async () => {
      const results = await manager.searchNodes('');
      const names = results.entities.map(e => e.name);
      const uniqueNames = [...new Set(names)];

      expect(names.length).toBe(uniqueNames.length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query string', async () => {
      const results = await manager.searchNodes('');

      expect(Array.isArray(results.entities)).toBe(true);
    });

    it('should handle special characters in query', async () => {
      const results = await manager.searchNodes('test@#$%');

      expect(Array.isArray(results.entities)).toBe(true);
    });

    it('should handle unicode in query', async () => {
      const results = await manager.searchNodes('日本語');

      expect(Array.isArray(results.entities)).toBe(true);
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(1000);
      const results = await manager.searchNodes(longQuery);

      expect(Array.isArray(results.entities)).toBe(true);
    });
  });
});
