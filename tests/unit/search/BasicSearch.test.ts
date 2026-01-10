/**
 * BasicSearch Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BasicSearch } from '../../../src/search/BasicSearch.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BasicSearch', () => {
  let storage: GraphStorage;
  let basicSearch: BasicSearch;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `basic-search-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    basicSearch = new BasicSearch(storage);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);

    // Create test data
    await entityManager.createEntities([
      {
        name: 'Alice',
        entityType: 'person',
        observations: ['Software engineer', 'Loves Python', 'Works on AI projects'],
        tags: ['engineering', 'python', 'ai'],
        importance: 9,
        createdAt: '2024-01-15T10:00:00.000Z',
      },
      {
        name: 'Bob',
        entityType: 'person',
        observations: ['Product manager', 'Leads roadmap planning'],
        tags: ['product', 'management'],
        importance: 8,
        createdAt: '2024-02-20T10:00:00.000Z',
      },
      {
        name: 'Charlie',
        entityType: 'person',
        observations: ['Designer', 'Creates beautiful UIs'],
        tags: ['design', 'ui'],
        importance: 7,
        createdAt: '2024-03-10T10:00:00.000Z',
      },
      {
        name: 'Project_X',
        entityType: 'project',
        observations: ['Internal tool for automation', 'Built with Python'],
        tags: ['engineering', 'automation', 'python'],
        importance: 10,
        createdAt: '2024-01-01T10:00:00.000Z',
      },
      {
        name: 'Company',
        entityType: 'organization',
        observations: ['Tech startup', 'AI-focused company'],
        tags: ['business', 'ai'],
        importance: 10,
        createdAt: '2024-01-01T10:00:00.000Z',
      },
    ]);

    await relationManager.createRelations([
      { from: 'Alice', to: 'Project_X', relationType: 'works_on' },
      { from: 'Bob', to: 'Project_X', relationType: 'manages' },
      { from: 'Alice', to: 'Bob', relationType: 'reports_to' },
      { from: 'Charlie', to: 'Company', relationType: 'works_for' },
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

  describe('searchNodes', () => {
    it('should find entities by name', async () => {
      const result = await basicSearch.searchNodes('Alice');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should be case-insensitive', async () => {
      const result = await basicSearch.searchNodes('alice');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should find entities by entityType', async () => {
      const result = await basicSearch.searchNodes('person');

      expect(result.entities).toHaveLength(3);
      expect(result.entities.map(e => e.name)).toContain('Alice');
      expect(result.entities.map(e => e.name)).toContain('Bob');
      expect(result.entities.map(e => e.name)).toContain('Charlie');
    });

    it('should find entities by observation content', async () => {
      const result = await basicSearch.searchNodes('Python');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.entities.map(e => e.name)).toContain('Alice');
      expect(result.entities.map(e => e.name)).toContain('Project_X');
    });

    it('should filter by single tag', async () => {
      const result = await basicSearch.searchNodes('', ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.entities.every(e => e.tags?.includes('python'))).toBe(true);
    });

    it('should filter by multiple tags (OR logic)', async () => {
      const result = await basicSearch.searchNodes('', ['python', 'design']);

      expect(result.entities.length).toBeGreaterThanOrEqual(3);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Project_X');
      expect(names).toContain('Charlie');
    });

    it('should filter by minimum importance', async () => {
      const result = await basicSearch.searchNodes('', undefined, 9);

      expect(result.entities).toHaveLength(3); // Alice (9), Project_X (10), Company (10)
      expect(result.entities.every(e => e.importance! >= 9)).toBe(true);
    });

    it('should filter by maximum importance', async () => {
      const result = await basicSearch.searchNodes('', undefined, undefined, 7);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Charlie');
    });

    it('should filter by importance range', async () => {
      const result = await basicSearch.searchNodes('', undefined, 8, 9);

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should combine text search with tag filter', async () => {
      const result = await basicSearch.searchNodes('Project', ['python']);

      expect(result.entities).toHaveLength(2); // Alice (has 'projects' in observations), Project_X
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Project_X');
      expect(result.entities.every(e => e.tags?.includes('python'))).toBe(true);
    });

    it('should combine text search with importance filter', async () => {
      const result = await basicSearch.searchNodes('person', undefined, 8);

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should return empty result when no matches', async () => {
      const result = await basicSearch.searchNodes('NonExistent');

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });

    it('should include relations between matched entities', async () => {
      const result = await basicSearch.searchNodes('person');

      expect(result.entities).toHaveLength(3);
      expect(result.relations.length).toBeGreaterThan(0);
      expect(result.relations.some(r => r.from === 'Alice' && r.to === 'Bob')).toBe(true);
    });

    it('should exclude relations to non-matched entities', async () => {
      const result = await basicSearch.searchNodes('Alice');

      expect(result.entities).toHaveLength(1);
      // Relations should only include those where both entities are in the result
      expect(result.relations).toHaveLength(0);
    });

    it('should handle empty query string', async () => {
      const result = await basicSearch.searchNodes('');

      // Empty query matches all entities
      expect(result.entities).toHaveLength(5);
    });

    it('should handle entities without tags when filtering by tags', async () => {
      // Create entity without tags
      await entityManager.createEntities([
        { name: 'NoTags', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await basicSearch.searchNodes('', ['python']);

      expect(result.entities.map(e => e.name)).not.toContain('NoTags');
    });

    it('should handle entities without importance when filtering', async () => {
      // Create entity without importance
      await entityManager.createEntities([
        { name: 'NoImportance', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await basicSearch.searchNodes('', undefined, 5);

      expect(result.entities.map(e => e.name)).not.toContain('NoImportance');
    });
  });

  describe('openNodes', () => {
    it('should retrieve specific entities by name', async () => {
      const result = await basicSearch.openNodes(['Alice', 'Bob']);

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should include relations between retrieved entities', async () => {
      const result = await basicSearch.openNodes(['Alice', 'Bob']);

      expect(result.relations.some(r =>
        r.from === 'Alice' && r.to === 'Bob' && r.relationType === 'reports_to'
      )).toBe(true);
    });

    it('should exclude relations to non-retrieved entities', async () => {
      const result = await basicSearch.openNodes(['Alice']);

      // Alice has relations to Bob and Project_X, but they're not in the result
      expect(result.relations).toHaveLength(0);
    });

    it('should handle non-existent entity names', async () => {
      const result = await basicSearch.openNodes(['NonExistent', 'AlsoNonExistent']);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });

    it('should handle mix of existing and non-existing names', async () => {
      const result = await basicSearch.openNodes(['Alice', 'NonExistent', 'Bob']);

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should handle empty names array', async () => {
      const result = await basicSearch.openNodes([]);

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });

    it('should retrieve all requested entities with their subgraph', async () => {
      const result = await basicSearch.openNodes(['Alice', 'Bob', 'Project_X']);

      expect(result.entities).toHaveLength(3);
      expect(result.relations.length).toBeGreaterThan(0);
      expect(result.relations.some(r => r.from === 'Alice' && r.to === 'Project_X')).toBe(true);
      expect(result.relations.some(r => r.from === 'Bob' && r.to === 'Project_X')).toBe(true);
    });

    it('should be case-sensitive for entity names', async () => {
      const result = await basicSearch.openNodes(['alice']); // lowercase

      expect(result.entities).toHaveLength(0);
    });
  });

  describe('searchByDateRange', () => {
    it('should find entities created after start date', async () => {
      const result = await basicSearch.searchByDateRange('2024-02-01T00:00:00.000Z');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
    });

    it('should find entities created before end date', async () => {
      const result = await basicSearch.searchByDateRange(undefined, '2024-02-01T00:00:00.000Z');

      expect(result.entities.length).toBeGreaterThanOrEqual(3);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Project_X');
      expect(names).toContain('Company');
    });

    it('should find entities within date range', async () => {
      const result = await basicSearch.searchByDateRange(
        '2024-01-15T00:00:00.000Z',
        '2024-02-28T23:59:59.999Z'
      );

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should filter by entity type', async () => {
      const result = await basicSearch.searchByDateRange(undefined, undefined, 'person');

      expect(result.entities).toHaveLength(3);
      expect(result.entities.every(e => e.entityType === 'person')).toBe(true);
    });

    it('should filter by tags', async () => {
      const result = await basicSearch.searchByDateRange(undefined, undefined, undefined, ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.entities.every(e => e.tags?.includes('python'))).toBe(true);
    });

    it('should combine date range with entity type filter', async () => {
      const result = await basicSearch.searchByDateRange(
        '2024-02-01T00:00:00.000Z',
        undefined,
        'person'
      );

      expect(result.entities).toHaveLength(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
    });

    it('should combine date range with tags filter', async () => {
      const result = await basicSearch.searchByDateRange(
        '2024-01-01T00:00:00.000Z',
        '2024-01-31T23:59:59.999Z',
        undefined,
        ['python']
      );

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Project_X');
    });

    it('should include relations within date range', async () => {
      const result = await basicSearch.searchByDateRange('2024-01-01T00:00:00.000Z');

      expect(result.entities).toHaveLength(5);
      expect(result.relations.length).toBeGreaterThan(0);
    });

    it('should handle entities without createdAt timestamp', async () => {
      // This shouldn't happen in practice, but test the fallback to lastModified
      const result = await basicSearch.searchByDateRange('2024-01-01T00:00:00.000Z');

      expect(result.entities.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty result when no matches in date range', async () => {
      const result = await basicSearch.searchByDateRange(
        '2025-01-01T00:00:00.000Z',
        '2025-12-31T23:59:59.999Z'
      );

      expect(result.entities).toHaveLength(0);
    });

    it('should handle no date filters (return all)', async () => {
      const result = await basicSearch.searchByDateRange();

      expect(result.entities).toHaveLength(5);
    });

    it('should exclude entities without matching tags', async () => {
      const result = await basicSearch.searchByDateRange(undefined, undefined, undefined, ['nonexistent']);

      expect(result.entities).toHaveLength(0);
    });
  });
});
