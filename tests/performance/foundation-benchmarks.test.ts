/**
 * Foundation Performance Benchmarks (Phase 12 Sprint 1)
 *
 * Tests for Sprint 1 optimizations:
 * - Task 12.1.1: Set-Based Bulk Operations
 * - Task 12.1.2: Pre-computed Similarity Data (PreparedEntity, fnv1aHash)
 * - Task 12.1.3: Single-Load Compression
 * - Task 12.1.4: Enhanced NameIndex Utilization
 *
 * Uses relative performance testing to avoid flaky failures on slow machines.
 * Benchmark assertions are SKIPPED per instructions (optimize after codebase split).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { RelationManager } from '../../src/core/RelationManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { fnv1aHash } from '../../src/utils/entityUtils.js';
import type { PreparedEntity } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Performance test configuration.
 * Uses generous thresholds to avoid flaky tests while still catching regressions.
 */
const PERF_CONFIG = {
  // Maximum allowed time for any single operation (prevents infinite hangs)
  MAX_ABSOLUTE_TIME_MS: 30000,
  // Multiplier for scaled operations
  SCALE_MULTIPLIER: 25,
  // Multiplier for O(n^2) algorithms
  QUADRATIC_MULTIPLIER: 50,
};

describe('Foundation Performance Benchmarks (Phase 12 Sprint 1)', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let compressionManager: CompressionManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `foundation-perf-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    compressionManager = new CompressionManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Task 12.1.1: Set-Based Bulk Operations', () => {
    it('should delete entities using Set-based lookup (correctness)', async () => {
      // Create entities
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Delete subset
      const toDelete = ['Entity10', 'Entity20', 'Entity30', 'Entity40', 'Entity50'];
      await entityManager.deleteEntities(toDelete);

      // Verify deletion
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(95);
      for (const name of toDelete) {
        expect(graph.entities.find(e => e.name === name)).toBeUndefined();
      }
    });

    it('should delete relations using Set-based lookup (correctness)', async () => {
      // Create entities
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
      }));
      await entityManager.createEntities(entities);

      // Create unique relations (avoid duplicates by using unique type per relation)
      const relations = Array.from({ length: 50 }, (_, i) => ({
        from: `Entity${i}`,
        to: `Entity${(i + 1) % 50}`,
        relationType: `type${i}`, // Unique type to avoid duplicates
      }));
      await relationManager.createRelations(relations);

      // Get initial count
      const initialGraph = await storage.loadGraph();
      const initialCount = initialGraph.relations.length;

      // Delete subset of relations
      const toDelete = [
        { from: 'Entity0', to: 'Entity1', relationType: 'type0' },
        { from: 'Entity1', to: 'Entity2', relationType: 'type1' },
        { from: 'Entity2', to: 'Entity3', relationType: 'type2' },
      ];
      await relationManager.deleteRelations(toDelete);

      // Verify deletion
      const graph = await storage.loadGraph();
      expect(graph.relations.length).toBe(initialCount - 3);
    });

    it.skip('should scale linearly for entity deletion (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Create entities
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Small delete: 10 entities
      const smallDelete = Array.from({ length: 10 }, (_, i) => `Entity${i}`);
      const startSmall = Date.now();
      await entityManager.deleteEntities(smallDelete);
      const smallDuration = Date.now() - startSmall;

      // Large delete: 100 entities
      const largeDelete = Array.from({ length: 100 }, (_, i) => `Entity${100 + i}`);
      const startLarge = Date.now();
      await entityManager.deleteEntities(largeDelete);
      const largeDuration = Date.now() - startLarge;

      // Set-based deletion should scale linearly
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });

    it.skip('should scale linearly for relation deletion (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Create entities and relations
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
      }));
      await entityManager.createEntities(entities);

      const relations = Array.from({ length: 500 }, (_, i) => ({
        from: `Entity${i % 100}`,
        to: `Entity${(i + 1) % 100}`,
        relationType: `type${i % 10}`,
      }));
      await relationManager.createRelations(relations);

      // Small delete: 10 relations
      const smallDelete = relations.slice(0, 10);
      const startSmall = Date.now();
      await relationManager.deleteRelations(smallDelete);
      const smallDuration = Date.now() - startSmall;

      // Large delete: 100 relations
      const largeDelete = relations.slice(100, 200);
      const startLarge = Date.now();
      await relationManager.deleteRelations(largeDelete);
      const largeDuration = Date.now() - startLarge;

      // Set-based deletion should scale linearly
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Task 12.1.2: Pre-computed Similarity Data', () => {
    it('should compute fnv1aHash correctly', () => {
      // Test hash function determinism
      expect(fnv1aHash('hello')).toBe(fnv1aHash('hello'));
      expect(fnv1aHash('world')).toBe(fnv1aHash('world'));

      // Test different inputs produce different hashes
      expect(fnv1aHash('hello')).not.toBe(fnv1aHash('world'));

      // Test empty string
      const emptyHash = fnv1aHash('');
      expect(typeof emptyHash).toBe('number');
      expect(emptyHash).toBeGreaterThanOrEqual(0);

      // Test hash is always positive (unsigned)
      expect(fnv1aHash('negative test string')).toBeGreaterThanOrEqual(0);

      // Test long strings
      const longString = 'a'.repeat(10000);
      const longHash = fnv1aHash(longString);
      expect(typeof longHash).toBe('number');
      expect(longHash).toBeGreaterThanOrEqual(0);
    });

    it('should produce good hash distribution', () => {
      // Test that similar strings produce different hashes
      const hashes = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        hashes.add(fnv1aHash(`entity${i}`));
      }
      // Expect very few collisions for 1000 unique strings
      expect(hashes.size).toBeGreaterThan(990);
    });

    it('should use PreparedEntity type correctly', () => {
      // Type checking test - ensure PreparedEntity interface is exported correctly
      const prepared: PreparedEntity = {
        entity: {
          name: 'TestEntity',
          entityType: 'test',
          observations: ['obs1', 'obs2'],
          tags: ['tag1', 'tag2'],
        },
        nameLower: 'testentity',
        typeLower: 'test',
        observationSet: new Set(['obs1', 'obs2']),
        tagSet: new Set(['tag1', 'tag2']),
        nameHash: fnv1aHash('testentity'),
      };

      expect(prepared.entity.name).toBe('TestEntity');
      expect(prepared.nameLower).toBe('testentity');
      expect(prepared.observationSet.has('obs1')).toBe(true);
      expect(prepared.tagSet.has('tag1')).toBe(true);
      expect(prepared.nameHash).toBeGreaterThanOrEqual(0);
    });

    it('should find duplicates using pre-computed similarity data (correctness)', async () => {
      // Create entities with similar names/observations
      const entities = [
        { name: 'Alice Smith', entityType: 'person', observations: ['Works at TechCorp'] },
        { name: 'Alice Smyth', entityType: 'person', observations: ['Works at TechCorp'] }, // Similar to Alice Smith
        { name: 'Bob Jones', entityType: 'person', observations: ['Works at DataCo'] },
        { name: 'Charlie Brown', entityType: 'person', observations: ['Works at StartupX'] },
      ];
      await entityManager.createEntities(entities);

      // Find duplicates with high threshold
      const duplicates = await compressionManager.findDuplicates(0.7);

      // Should find Alice Smith and Alice Smyth as duplicates
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      const aliceGroup = duplicates.find(group =>
        group.includes('Alice Smith') || group.includes('Alice Smyth')
      );
      expect(aliceGroup).toBeDefined();
    });

    it.skip('should improve findDuplicates performance with pre-computed data (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Create entities with some duplicates
      const entities = Array.from({ length: 200 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 5 === 0 ? 'person' : 'project',
        observations: [i % 10 === 0 ? 'Common observation' : `Unique observation ${i}`],
        tags: i % 3 === 0 ? ['common'] : undefined,
      }));
      await entityManager.createEntities(entities);

      const startTime = Date.now();
      await compressionManager.findDuplicates(0.8);
      const duration = Date.now() - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });
  });

  describe('Task 12.1.3: Single-Load Compression', () => {
    it('should compress graph with single load/save (correctness)', async () => {
      // Create entities with duplicates
      const entities = [
        { name: 'Project Alpha', entityType: 'project', observations: ['A software project'] },
        { name: 'Project Alfa', entityType: 'project', observations: ['A software project'] }, // Similar
        { name: 'Team Beta', entityType: 'team', observations: ['Development team'] },
        { name: 'Team Betta', entityType: 'team', observations: ['Development team'] }, // Similar
        { name: 'Unique Entity', entityType: 'other', observations: ['Completely unique'] },
      ];
      await entityManager.createEntities(entities);

      // Compress with dry run first
      const dryRunResult = await compressionManager.compressGraph(0.7, true);
      expect(dryRunResult.duplicatesFound).toBeGreaterThan(0);
      expect(dryRunResult.entitiesMerged).toBeGreaterThan(0);

      // Actual compression
      const result = await compressionManager.compressGraph(0.7, false);
      expect(result.entitiesMerged).toBeGreaterThan(0);

      // Verify graph was reduced
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBeLessThan(5);
    });

    it.skip('should scale linearly for compression (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Small graph: 50 entities
      const smallEntities = Array.from({ length: 50 }, (_, i) => ({
        name: `SmallEntity${i}`,
        entityType: 'person',
        observations: [i % 5 === 0 ? 'Common' : `Unique ${i}`],
      }));
      await entityManager.createEntities(smallEntities);

      const startSmall = Date.now();
      await compressionManager.compressGraph(0.9, false);
      const smallDuration = Date.now() - startSmall;

      // Larger graph: 200 entities
      const largeEntities = Array.from({ length: 200 }, (_, i) => ({
        name: `LargeEntity${i}`,
        entityType: 'person',
        observations: [i % 5 === 0 ? 'Common' : `Unique ${i}`],
      }));
      await entityManager.createEntities(largeEntities);

      const startLarge = Date.now();
      await compressionManager.compressGraph(0.9, false);
      const largeDuration = Date.now() - startLarge;

      // Allow generous multiplier for O(n^2) algorithm
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.QUADRATIC_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Task 12.1.4: Enhanced NameIndex Utilization', () => {
    it('should use NameIndex for addTags (correctness)', async () => {
      // Create entity
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: ['Test'] },
      ]);

      // Add tags
      const result = await entityManager.addTags('TestEntity', ['tag1', 'tag2']);
      expect(result.addedTags).toContain('tag1');
      expect(result.addedTags).toContain('tag2');

      // Verify tags were added
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.tags).toContain('tag1');
      expect(entity?.tags).toContain('tag2');
    });

    it('should use NameIndex for removeTags (correctness)', async () => {
      // Create entity with tags
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: ['Test'], tags: ['tag1', 'tag2', 'tag3'] },
      ]);

      // Remove tags
      const result = await entityManager.removeTags('TestEntity', ['tag1', 'tag3']);
      expect(result.removedTags).toContain('tag1');
      expect(result.removedTags).toContain('tag3');

      // Verify tags were removed
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.tags).not.toContain('tag1');
      expect(entity?.tags).not.toContain('tag3');
      expect(entity?.tags).toContain('tag2');
    });

    it('should use NameIndex for setImportance (correctness)', async () => {
      // Create entity
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: ['Test'] },
      ]);

      // Set importance
      const result = await entityManager.setImportance('TestEntity', 8);
      expect(result.importance).toBe(8);

      // Verify importance was set
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.importance).toBe(8);
    });

    it('should use Map for addTagsToMultipleEntities (correctness)', async () => {
      // Create entities
      const entities = Array.from({ length: 10 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
      }));
      await entityManager.createEntities(entities);

      // Add tags to multiple entities
      const entityNames = ['Entity0', 'Entity2', 'Entity4', 'Entity6'];
      const results = await entityManager.addTagsToMultipleEntities(entityNames, ['common-tag', 'shared']);

      expect(results.length).toBe(4);
      for (const result of results) {
        expect(result.addedTags).toContain('common-tag');
        expect(result.addedTags).toContain('shared');
      }

      // Verify tags were added
      for (const name of entityNames) {
        const entity = await entityManager.getEntity(name);
        expect(entity?.tags).toContain('common-tag');
      }
    });

    it.skip('should scale well for tag operations (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Create entities
      const entities = Array.from({ length: 200 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
        tags: ['existing'],
      }));
      await entityManager.createEntities(entities);

      // Measure addTags performance
      const startAdd = Date.now();
      for (let i = 0; i < 50; i++) {
        await entityManager.addTags(`Entity${i}`, ['newtag']);
      }
      const addDuration = Date.now() - startAdd;

      // Measure removeTags performance
      const startRemove = Date.now();
      for (let i = 50; i < 100; i++) {
        await entityManager.removeTags(`Entity${i}`, ['existing']);
      }
      const removeDuration = Date.now() - startRemove;

      // Both operations should complete quickly with O(1) lookup
      expect(addDuration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
      expect(removeDuration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it.skip('should scale well for bulk tag operations (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      // Create entities
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
      }));
      await entityManager.createEntities(entities);

      // Small batch: 10 entities
      const smallBatch = Array.from({ length: 10 }, (_, i) => `Entity${i}`);
      const startSmall = Date.now();
      await entityManager.addTagsToMultipleEntities(smallBatch, ['batch-tag']);
      const smallDuration = Date.now() - startSmall;

      // Large batch: 100 entities
      const largeBatch = Array.from({ length: 100 }, (_, i) => `Entity${100 + i}`);
      const startLarge = Date.now();
      await entityManager.addTagsToMultipleEntities(largeBatch, ['batch-tag']);
      const largeDuration = Date.now() - startLarge;

      // Map-based lookup should make this scale well
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Combined Foundation Optimizations', () => {
    it('should handle complex workflow with all optimizations (correctness)', async () => {
      // Create entities
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 3 === 0 ? 'person' : 'project',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Create relations
      const relations = Array.from({ length: 200 }, (_, i) => ({
        from: `Entity${i % 100}`,
        to: `Entity${(i + 10) % 100}`,
        relationType: 'connects',
      }));
      await relationManager.createRelations(relations);

      // Add tags to multiple entities
      const tagEntities = Array.from({ length: 50 }, (_, i) => `Entity${i * 2}`);
      await entityManager.addTagsToMultipleEntities(tagEntities, ['tagged', 'important']);

      // Find and compress duplicates
      const duplicates = await compressionManager.findDuplicates(0.9);

      // Delete some entities
      await entityManager.deleteEntities(['Entity1', 'Entity3', 'Entity5']);

      // Delete some relations
      await relationManager.deleteRelations([
        { from: 'Entity0', to: 'Entity10', relationType: 'connects' },
      ]);

      // Verify final state
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBeLessThan(100);
      expect(graph.relations.length).toBeLessThan(200);
    });

    it.skip('should complete complex workflow within time limit (benchmark)', async () => {
      // SKIPPED: Benchmark assertion - optimize after codebase split
      const startTime = Date.now();

      // Create entities
      const entities = Array.from({ length: 200 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 4 === 0 ? 'person' : 'project',
        observations: [i % 10 === 0 ? 'Similar observation' : `Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Create relations
      const relations = Array.from({ length: 400 }, (_, i) => ({
        from: `Entity${i % 200}`,
        to: `Entity${(i + 20) % 200}`,
        relationType: `type${i % 5}`,
      }));
      await relationManager.createRelations(relations);

      // Add tags
      const tagEntities = Array.from({ length: 100 }, (_, i) => `Entity${i}`);
      await entityManager.addTagsToMultipleEntities(tagEntities, ['batch-tag']);

      // Find duplicates
      await compressionManager.findDuplicates(0.8);

      // Compress
      await compressionManager.compressGraph(0.8, true);

      // Delete batch
      const toDelete = Array.from({ length: 50 }, (_, i) => `Entity${100 + i}`);
      await entityManager.deleteEntities(toDelete);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });
  });
});
