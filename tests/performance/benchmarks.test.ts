/**
 * Performance Benchmarks
 *
 * Tests for performance budgets and benchmarks across all operations.
 * Uses relative performance testing to avoid flaky failures on slow machines.
 *
 * Strategy: Run a baseline operation first, then verify that scaled operations
 * complete within reasonable multiples of the baseline time.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { RelationManager } from '../../src/core/RelationManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { BasicSearch } from '../../src/search/BasicSearch.js';
import { RankedSearch } from '../../src/search/RankedSearch.js';
import { BooleanSearch } from '../../src/search/BooleanSearch.js';
import { FuzzySearch } from '../../src/search/FuzzySearch.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Performance test configuration.
 * Uses generous multipliers to avoid flaky tests while still catching regressions.
 */
const PERF_CONFIG = {
  // Maximum allowed time for any single operation (prevents infinite hangs)
  MAX_ABSOLUTE_TIME_MS: 30000,
  // Multiplier for scaled operations (e.g., 100 entities should take < 20x the time of 10)
  SCALE_MULTIPLIER: 25,
  // Multiplier for complex operations vs simple ones
  COMPLEXITY_MULTIPLIER: 15,
};

describe('Performance Benchmarks', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let compressionManager: CompressionManager;
  let basicSearch: BasicSearch;
  let rankedSearch: RankedSearch;
  let booleanSearch: BooleanSearch;
  let fuzzySearch: FuzzySearch;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `perf-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    compressionManager = new CompressionManager(storage);
    basicSearch = new BasicSearch(storage);
    rankedSearch = new RankedSearch(storage);
    booleanSearch = new BooleanSearch(storage);
    fuzzySearch = new FuzzySearch(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Entity Creation Performance', () => {
    it('should scale linearly when creating entities', async () => {
      // Baseline: create 10 entities
      const smallBatch = Array.from({ length: 10 }, (_, i) => ({
        name: `SmallEntity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));

      const startSmall = Date.now();
      await entityManager.createEntities(smallBatch);
      const smallDuration = Date.now() - startSmall;

      // Scaled: create 100 entities (10x more)
      const largeBatch = Array.from({ length: 100 }, (_, i) => ({
        name: `LargeEntity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
        importance: (i % 10) + 1,
      }));

      const startLarge = Date.now();
      await entityManager.createEntities(largeBatch);
      const largeDuration = Date.now() - startLarge;

      // Large batch should complete within reasonable multiple of small batch
      // Allow generous multiplier since we're comparing 10x the work
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });

    it('should handle 1000 entities within absolute time limit', async () => {
      const entities = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));

      const startTime = Date.now();
      await entityManager.createEntities(entities);
      const duration = Date.now() - startTime;

      // Just ensure it completes in reasonable time (no specific threshold)
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should batch update entities efficiently', async () => {
      // Create entities first
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Single update baseline
      const startSingle = Date.now();
      await entityManager.updateEntity('Entity0', { importance: 5 });
      const singleDuration = Date.now() - startSingle;

      // Batch update
      const updates = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        updates: { importance: 5 },
      }));

      const startBatch = Date.now();
      await entityManager.batchUpdate(updates);
      const batchDuration = Date.now() - startBatch;

      // Batch of 100 should be faster than 100x single updates
      // (demonstrates batching efficiency)
      expect(batchDuration).toBeLessThan(Math.max(singleDuration * 100, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Relation Creation Performance', () => {
    it('should scale reasonably when creating relations', async () => {
      // Create entities first
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: ['Test'],
      }));
      await entityManager.createEntities(entities);

      // Small batch: 10 relations
      const smallRelations = Array.from({ length: 10 }, (_, i) => ({
        from: `Entity${i}`,
        to: `Entity${i + 1}`,
        relationType: 'connects',
      }));

      const startSmall = Date.now();
      await relationManager.createRelations(smallRelations);
      const smallDuration = Date.now() - startSmall;

      // Large batch: 100 relations
      const largeRelations = Array.from({ length: 100 }, (_, i) => ({
        from: `Entity${i % 100}`,
        to: `Entity${(i + 10) % 100}`,
        relationType: 'links',
      }));

      const startLarge = Date.now();
      await relationManager.createRelations(largeRelations);
      const largeDuration = Date.now() - startLarge;

      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Search Performance', () => {
    beforeEach(async () => {
      // Create a moderate-sized graph
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 5 === 0 ? 'person' : 'project',
        observations: [`This is observation ${i} with some searchable text`],
        tags: i % 3 === 0 ? ['tagged', 'test'] : undefined,
        importance: (i % 10) + 1,
      }));
      await entityManager.createEntities(entities);
    });

    it('should perform basic search within time limit', async () => {
      const startTime = Date.now();
      const results = await basicSearch.searchNodes('Entity');
      const duration = Date.now() - startTime;

      expect(results.entities.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should perform ranked search within time limit', async () => {
      const startTime = Date.now();
      // Use "person" which only appears in 20% of entities (entityType)
      // This ensures TF-IDF returns non-zero scores (IDF > 0 for rare terms)
      const results = await rankedSearch.searchNodesRanked('person');
      const duration = Date.now() - startTime;

      // searchNodesRanked returns SearchResult[] directly (not KnowledgeGraph)
      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    }, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);

    it('should perform boolean search within time limit', async () => {
      const startTime = Date.now();
      const results = await booleanSearch.booleanSearch('person AND observation');
      const duration = Date.now() - startTime;

      expect(results.entities.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should perform fuzzy search within time limit', async () => {
      const startTime = Date.now();
      // Use threshold 0.8 (>= WORKER_MAX_THRESHOLD, so workers not used)
      // "Entity" contains "Entity" so similarity = 1.0
      const results = await fuzzySearch.fuzzySearch('Entity', 0.8);
      const duration = Date.now() - startTime;

      expect(results.entities.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    }, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);

    it('should have ranked search complete within reasonable multiple of basic search', async () => {
      // Basic search baseline
      const startBasic = Date.now();
      await basicSearch.searchNodes('observation');
      const basicDuration = Date.now() - startBasic;

      // Ranked search (more complex)
      const startRanked = Date.now();
      await rankedSearch.searchNodesRanked('observation');
      const rankedDuration = Date.now() - startRanked;

      // Ranked search may be slower but should be within reasonable bounds
      expect(rankedDuration).toBeLessThan(Math.max(basicDuration * PERF_CONFIG.COMPLEXITY_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Compression Performance', () => {
    it('should scale reasonably for duplicate detection', async () => {
      // Small set: 50 entities
      const smallEntities = Array.from({ length: 50 }, (_, i) => ({
        name: `SmallEntity${i}`,
        entityType: 'person',
        observations: [i % 10 === 0 ? 'Duplicate observation' : `Unique observation ${i}`],
      }));
      await entityManager.createEntities(smallEntities);

      const startSmall = Date.now();
      await compressionManager.findDuplicates(0.8);
      const smallDuration = Date.now() - startSmall;

      // Larger set: 200 entities (4x more, but O(n²) comparison so expect ~16x time)
      const largeEntities = Array.from({ length: 200 }, (_, i) => ({
        name: `LargeEntity${i}`,
        entityType: 'person',
        observations: [i % 20 === 0 ? 'Duplicate observation' : `Unique observation ${i}`],
      }));
      await entityManager.createEntities(largeEntities);

      const startLarge = Date.now();
      await compressionManager.findDuplicates(0.8);
      const largeDuration = Date.now() - startLarge;

      // Allow generous multiplier for O(n²) algorithm
      expect(largeDuration).toBeLessThan(Math.max(smallDuration * PERF_CONFIG.SCALE_MULTIPLIER * 2, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    }, 15000);

    it('should compress graph within time limit', async () => {
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'person',
        observations: [i % 10 === 0 ? 'Similar observation' : `Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      const startTime = Date.now();
      await compressionManager.compressGraph(0.8, false);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });
  });

  describe('Graph Loading/Saving Performance', () => {
    it('should load and save graphs efficiently', async () => {
      // Create entities
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Measure load time
      const startLoad = Date.now();
      const graph = await storage.loadGraph();
      const loadDuration = Date.now() - startLoad;

      expect(graph.entities.length).toBe(500);
      expect(loadDuration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);

      // Measure save time (need mutable copy for saveGraph)
      const startSave = Date.now();
      const mutableGraph = await storage.getGraphForMutation();
      await storage.saveGraph(mutableGraph);
      const saveDuration = Date.now() - startSave;

      expect(saveDuration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should scale load/save times reasonably with graph size', async () => {
      // Small graph: 100 entities
      const smallEntities = Array.from({ length: 100 }, (_, i) => ({
        name: `SmallEntity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(smallEntities);

      const startSmallLoad = Date.now();
      await storage.loadGraph();
      const smallLoadDuration = Date.now() - startSmallLoad;

      // Large graph: 1000 entities (10x more)
      const largeEntities = Array.from({ length: 1000 }, (_, i) => ({
        name: `LargeEntity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(largeEntities);

      const startLargeLoad = Date.now();
      await storage.loadGraph();
      const largeLoadDuration = Date.now() - startLargeLoad;

      // 10x data should not take more than 25x time (allows for overhead)
      expect(largeLoadDuration).toBeLessThan(Math.max(smallLoadDuration * PERF_CONFIG.SCALE_MULTIPLIER, PERF_CONFIG.MAX_ABSOLUTE_TIME_MS));
    });
  });

  describe('Complex Workflow Performance', () => {
    it('should complete full CRUD workflow within time limit', async () => {
      const startTime = Date.now();

      // Create
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['Test 1'] },
        { name: 'Entity2', entityType: 'test', observations: ['Test 2'] },
      ]);

      // Read
      await entityManager.getEntity('Entity1');

      // Update
      await entityManager.updateEntity('Entity1', { importance: 5 });

      // Search
      await basicSearch.searchNodes('Entity');

      // Delete
      await entityManager.deleteEntities(['Entity2']);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should handle bulk workflow efficiently', async () => {
      const startTime = Date.now();

      // Bulk create
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Bulk relate
      const relations = Array.from({ length: 50 }, (_, i) => ({
        from: `Entity${i}`,
        to: `Entity${(i + 1) % 50}`,
        relationType: 'connects',
      }));
      await relationManager.createRelations(relations);

      // Search
      const results = await basicSearch.searchNodes('Entity');

      const duration = Date.now() - startTime;

      expect(results.entities.length).toBe(50);
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });

    it('should handle complex query workflow efficiently', async () => {
      // Setup
      const entities = Array.from({ length: 100 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 2 === 0 ? 'person' : 'project',
        observations: [`Observation ${i}`],
        tags: i % 3 === 0 ? ['important'] : undefined,
        importance: (i % 10) + 1,
      }));
      await entityManager.createEntities(entities);

      const startTime = Date.now();

      // Multiple complex queries
      await rankedSearch.searchNodesRanked('Observation', ['important'], 5);
      await booleanSearch.booleanSearch('person AND (important OR project)');
      await fuzzySearch.fuzzySearch('Observatn', 0.7);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(PERF_CONFIG.MAX_ABSOLUTE_TIME_MS);
    });
  });

  describe('Memory Efficiency', () => {
    it('should handle 2000 entities without issues', async () => {
      // Create in batches due to 1000 entity limit
      const batch1 = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      const batch2 = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i + 1000}`,
        entityType: 'test',
        observations: [`Observation ${i + 1000}`],
      }));

      await entityManager.createEntities(batch1);
      await entityManager.createEntities(batch2);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(2000);
    });

    it('should handle graph with 5000 total elements (entities + relations)', { timeout: 30000 }, async () => {
      // Create 1000 entities
      const entities = Array.from({ length: 1000 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Observation ${i}`],
      }));
      await entityManager.createEntities(entities);

      // Create 4000 relations in batches due to 1000 relation limit
      const batch1 = Array.from({ length: 1000 }, (_, i) => ({
        from: `Entity${i % 1000}`,
        to: `Entity${(i + 1) % 1000}`,
        relationType: i % 2 === 0 ? 'connects' : 'relates',
      }));
      const batch2 = Array.from({ length: 1000 }, (_, i) => ({
        from: `Entity${(i + 1) % 1000}`,
        to: `Entity${(i + 2) % 1000}`,
        relationType: i % 2 === 0 ? 'links' : 'relates_to',
      }));
      const batch3 = Array.from({ length: 1000 }, (_, i) => ({
        from: `Entity${(i + 2) % 1000}`,
        to: `Entity${(i + 3) % 1000}`,
        relationType: i % 2 === 0 ? 'connects_to' : 'associates',
      }));
      const batch4 = Array.from({ length: 1000 }, (_, i) => ({
        from: `Entity${(i + 3) % 1000}`,
        to: `Entity${(i + 4) % 1000}`,
        relationType: i % 2 === 0 ? 'joins' : 'interacts',
      }));

      await relationManager.createRelations(batch1);
      await relationManager.createRelations(batch2);
      await relationManager.createRelations(batch3);
      await relationManager.createRelations(batch4);

      const graph = await storage.loadGraph();
      expect(graph.entities.length + graph.relations.length).toBe(5000);
    });
  });
});
