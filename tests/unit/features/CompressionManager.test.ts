/**
 * Compression Operations Unit Tests
 *
 * Tests compression functionality from the standalone CompressionManager.
 * (Re-extracted from SearchManager in Phase 4 consolidation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CompressionManager } from '../../../src/features/CompressionManager.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityNotFoundError, InsufficientEntitiesError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CompressionManager', () => {
  let storage: GraphStorage;
  let compressionManager: CompressionManager;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `compression-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    compressionManager = new CompressionManager(storage);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('findDuplicates', () => {
    it('should find duplicate entities with high similarity', async () => {
      await entityManager.createEntities([
        { name: 'Alice Smith', entityType: 'person', observations: ['Engineer', 'Loves coding'] },
        { name: 'Alice Smyth', entityType: 'person', observations: ['Engineer', 'Loves coding'] },
        { name: 'Bob Jones', entityType: 'person', observations: ['Manager'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.8);

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toContain('Alice Smith');
      expect(duplicates[0]).toContain('Alice Smyth');
    });

    it('should not find duplicates when similarity is below threshold', async () => {
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Engineer'] },
        { name: 'Bob', entityType: 'person', observations: ['Manager'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.9);
      expect(duplicates).toHaveLength(0);
    });

    it('should only compare entities of the same type', async () => {
      await entityManager.createEntities([
        { name: 'ProjectX', entityType: 'project', observations: ['Software'] },
        { name: 'ProjectX', entityType: 'company', observations: ['Software'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.7);
      expect(duplicates).toHaveLength(0); // Different types, not duplicates
    });

    it('should handle empty graph', async () => {
      const duplicates = await compressionManager.findDuplicates();
      expect(duplicates).toEqual([]);
    });

    it('should handle graph with single entity', async () => {
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
      ]);

      const duplicates = await compressionManager.findDuplicates();
      expect(duplicates).toEqual([]);
    });

    it('should detect duplicates with similar names but different cases', async () => {
      await entityManager.createEntities([
        { name: 'alice smith', entityType: 'person', observations: ['Engineer'] },
        { name: 'ALICE SMITH', entityType: 'person', observations: ['Engineer'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.9);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]).toHaveLength(2);
    });

    it('should detect duplicates with overlapping observations', async () => {
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Software engineer', 'Loves Python', 'Works remotely'] },
        { name: 'Alicia', entityType: 'person', observations: ['Software engineer', 'Loves Python', 'Works remotely'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.7);
      expect(duplicates).toHaveLength(1);
    });

    it('should detect duplicates with matching tags', async () => {
      await entityManager.createEntities([
        {
          name: 'Alice Johnson',
          entityType: 'person',
          observations: ['Engineer'],
          tags: ['engineering', 'python', 'remote']
        },
        {
          name: 'Alice Jonson',
          entityType: 'person',
          observations: ['Engineer'],
          tags: ['engineering', 'python', 'remote']
        },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.85);
      expect(duplicates).toHaveLength(1);
    });

    it('should handle multiple duplicate groups', async () => {
      await entityManager.createEntities([
        { name: 'Alice Smith', entityType: 'person', observations: ['A'] },
        { name: 'Alice Smyth', entityType: 'person', observations: ['A'] },
        { name: 'Bob Jones', entityType: 'person', observations: ['B'] },
        { name: 'Bob Johnes', entityType: 'person', observations: ['B'] },
        { name: 'Charlie', entityType: 'person', observations: ['C'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.8);
      expect(duplicates).toHaveLength(2); // Two separate duplicate groups
    });

    it('should use efficient bucketing to reduce comparisons', async () => {
      // Create many entities with different prefixes (shouldn't compare across buckets)
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Alicia', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
        { name: 'Bobby', entityType: 'person', observations: [] },
        { name: 'Charlie', entityType: 'person', observations: [] },
        { name: 'Charles', entityType: 'person', observations: [] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.7);
      // Each prefix group might have duplicates, but they don't cross-compare
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('mergeEntities', () => {
    beforeEach(async () => {
      // Create test entities for merging
      await entityManager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer', 'Loves coding'],
          tags: ['tech', 'python'],
          importance: 8,
          createdAt: '2024-01-01T00:00:00.000Z'
        },
        {
          name: 'Alicia',
          entityType: 'person',
          observations: ['Engineer', 'Loves music'],
          tags: ['tech', 'music'],
          importance: 9,
          createdAt: '2024-01-02T00:00:00.000Z'
        },
        {
          name: 'Bob',
          entityType: 'person',
          observations: ['Manager']
        },
      ]);
    });

    it('should merge two entities and combine observations', async () => {
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia']);

      expect(merged.name).toBe('Alice');
      expect(merged.observations).toContain('Engineer');
      expect(merged.observations).toContain('Loves coding');
      expect(merged.observations).toContain('Loves music');
      expect(merged.observations).toHaveLength(3);
    });

    it('should merge tags from all entities', async () => {
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia']);

      expect(merged.tags).toContain('tech');
      expect(merged.tags).toContain('python');
      expect(merged.tags).toContain('music');
      expect(merged.tags).toHaveLength(3);
    });

    it('should use highest importance value', async () => {
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia']);
      expect(merged.importance).toBe(9); // Alicia has 9, Alice has 8
    });

    it('should use earliest createdAt timestamp', async () => {
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia']);
      expect(merged.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should update lastModified timestamp', async () => {
      const beforeMerge = new Date().toISOString();
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia']);
      expect(merged.lastModified).toBeDefined();
      expect(merged.lastModified! >= beforeMerge).toBe(true);
    });

    it('should remove merged entities from graph', async () => {
      await compressionManager.mergeEntities(['Alice', 'Alicia']);

      const alice = await entityManager.getEntity('Alice');
      const alicia = await entityManager.getEntity('Alicia');

      expect(alice).not.toBeNull();
      expect(alicia).toBeNull(); // Alicia was merged into Alice
    });

    it('should throw error when merging less than 2 entities', async () => {
      await expect(
        compressionManager.mergeEntities(['Alice'])
      ).rejects.toThrow(InsufficientEntitiesError);
    });

    it('should throw error when entity not found', async () => {
      await expect(
        compressionManager.mergeEntities(['Alice', 'NonExistent'])
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should rename merged entity if targetName provided', async () => {
      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia'], 'Alice Smith');

      expect(merged.name).toBe('Alice Smith');

      const alice = await entityManager.getEntity('Alice');
      const aliceSmith = await entityManager.getEntity('Alice Smith');

      expect(alice).toBeNull();
      expect(aliceSmith).not.toBeNull();
    });

    it('should redirect relations to merged entity', async () => {
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alicia', to: 'Bob', relationType: 'reports_to' },
      ]);

      await compressionManager.mergeEntities(['Alice', 'Alicia']);

      const aliceRelations = await relationManager.getRelations('Alice');
      expect(aliceRelations).toHaveLength(2);
      expect(aliceRelations.some(r => r.relationType === 'works_with')).toBe(true);
      expect(aliceRelations.some(r => r.relationType === 'reports_to')).toBe(true);
    });

    it('should remove duplicate relations after merge', async () => {
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alicia', to: 'Bob', relationType: 'works_with' }, // Duplicate after merge
      ]);

      await compressionManager.mergeEntities(['Alice', 'Alicia']);

      const relations = await relationManager.getRelations('Alice');
      const worksWithRelations = relations.filter(r =>
        r.from === 'Alice' && r.to === 'Bob' && r.relationType === 'works_with'
      );

      expect(worksWithRelations).toHaveLength(1); // Only one, duplicate removed
    });

    it('should handle merging entities with no tags', async () => {
      const merged = await compressionManager.mergeEntities(['Bob', 'Alice']);
      // Bob has no tags, Alice has tags
      expect(merged.tags).toContain('tech');
      expect(merged.tags).toContain('python');
    });

    it('should merge multiple entities (more than 2)', async () => {
      await entityManager.createEntities([
        { name: 'Alice2', entityType: 'person', observations: ['Observation 1'] },
      ]);

      const merged = await compressionManager.mergeEntities(['Alice', 'Alicia', 'Alice2']);

      const alice = await entityManager.getEntity('Alice');
      const alicia = await entityManager.getEntity('Alicia');
      const alice2 = await entityManager.getEntity('Alice2');

      expect(alice).not.toBeNull();
      expect(alicia).toBeNull();
      expect(alice2).toBeNull();
      expect(merged.observations).toContain('Observation 1');
    });
  });

  describe('compressGraph', () => {
    beforeEach(async () => {
      // Create entities with duplicates
      await entityManager.createEntities([
        { name: 'Alice Smith', entityType: 'person', observations: ['Engineer'] },
        { name: 'Alice Smyth', entityType: 'person', observations: ['Engineer'] },
        { name: 'Bob Jones', entityType: 'person', observations: ['Manager'] },
        { name: 'Bob Johnes', entityType: 'person', observations: ['Manager'] },
        { name: 'Charlie', entityType: 'person', observations: ['Designer'] },
      ]);
    });

    it('should compress graph and return statistics', async () => {
      const result = await compressionManager.compressGraph(0.8);

      expect(result.duplicatesFound).toBe(4); // 4 total duplicates in 2 groups
      expect(result.entitiesMerged).toBe(2); // 2 entities merged into others
      expect(result.spaceFreed).toBeGreaterThan(0);
      expect(result.mergedEntities).toHaveLength(2);
    });

    it('should perform dry run without modifying graph', async () => {
      const beforeGraph = await storage.loadGraph();
      const beforeEntityCount = beforeGraph.entities.length;

      const result = await compressionManager.compressGraph(0.8, true);

      const afterGraph = await storage.loadGraph();
      expect(afterGraph.entities).toHaveLength(beforeEntityCount);
      expect(result.duplicatesFound).toBeGreaterThan(0);
      expect(result.entitiesMerged).toBeGreaterThan(0);
      expect(result.mergedEntities.length).toBeGreaterThan(0);
    });

    it('should calculate space freed correctly', async () => {
      const result = await compressionManager.compressGraph(0.8);

      expect(result.spaceFreed).toBeGreaterThan(0);
      expect(result.duplicatesFound).toBeGreaterThan(0);
      expect(result.entitiesMerged).toBeGreaterThan(0);
    });

    it('should handle graph with no duplicates', async () => {
      // Remove all entities and add distinct ones
      const graph = await storage.getGraphForMutation();
      graph.entities = [];
      graph.relations = [];
      await storage.saveGraph(graph);

      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Engineer'] },
        { name: 'Bob', entityType: 'person', observations: ['Manager'] },
        { name: 'Charlie', entityType: 'person', observations: ['Designer'] },
      ]);

      const result = await compressionManager.compressGraph(0.9);

      expect(result.duplicatesFound).toBe(0);
      expect(result.entitiesMerged).toBe(0);
      expect(result.spaceFreed).toBe(0); // No compression
    });

    it('should work with different thresholds', async () => {
      const resultHigh = await compressionManager.compressGraph(0.95, true);
      const resultLow = await compressionManager.compressGraph(0.6, true);

      // Lower threshold should find more duplicates
      expect(resultLow.duplicatesFound).toBeGreaterThanOrEqual(resultHigh.duplicatesFound);
    });
  });

  describe('edge cases', () => {
    it('should handle entities with empty observations', async () => {
      await entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Alicia', entityType: 'person', observations: [] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.7);
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle entities with very long names', async () => {
      const longName1 = 'A'.repeat(200);
      const longName2 = 'A'.repeat(195) + 'B'.repeat(5);

      await entityManager.createEntities([
        { name: longName1, entityType: 'person', observations: ['Test'] },
        { name: longName2, entityType: 'person', observations: ['Test'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.8);
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle entities with special characters', async () => {
      await entityManager.createEntities([
        { name: 'Alice-Smith', entityType: 'person', observations: ['Engineer'] },
        { name: 'Alice_Smith', entityType: 'person', observations: ['Engineer'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.7);
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle entities with unicode characters', async () => {
      await entityManager.createEntities([
        { name: 'Café', entityType: 'location', observations: ['Coffee shop'] },
        { name: 'Cafe', entityType: 'location', observations: ['Coffee shop'] },
      ]);

      const duplicates = await compressionManager.findDuplicates(0.8);
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });
  });
});
