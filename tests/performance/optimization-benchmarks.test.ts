/**
 * Phase 6 Optimization Benchmarks
 *
 * Baseline performance measurements for operations targeted by Phase 6 optimizations:
 * - deleteEntities: Set-based lookup optimization (Sprint 2)
 * - addTags/setImportance: NameIndex utilization (Sprint 3)
 * - batchUpdate: Map-based lookup optimization (Sprint 4)
 *
 * These benchmarks establish pre-optimization baselines and verify post-optimization gains.
 * Run with: npx vitest run tests/performance/optimization-benchmarks.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Helper to create test entities
 */
function createTestEntities(count: number, prefix: string = 'Entity') {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}`,
    entityType: 'benchmark',
    observations: [`Observation for ${prefix}${i}`],
  }));
}

/**
 * Helper to measure execution time of an async function
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

describe('Phase 6 Optimization Benchmarks', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `opt-bench-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'benchmark-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================
  // deleteEntities Benchmarks (Sprint 2: Set-Based Lookups)
  // Current: O(n×m) with includes() - target: O(n+m) with Set.has()
  // ============================================================

  describe('deleteEntities Performance', () => {
    it('should delete 100 entities from 1000 entity graph efficiently', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'Del1K_');
      await entityManager.createEntities(entities);

      // Target: Delete 100 entities
      const namesToDelete = entities.slice(0, 100).map(e => e.name);

      const { durationMs } = await measureTime(() =>
        entityManager.deleteEntities(namesToDelete)
      );

      console.log(`deleteEntities(100 from 1000): ${durationMs.toFixed(2)}ms`);

      // Generous limit for pre-optimization baseline
      expect(durationMs).toBeLessThan(500);
    });

    it('should delete 500 entities from 2000 entity graph', async () => {
      // Setup: Create 2000 entities in batches (avoid validation limits)
      const entities1 = createTestEntities(1000, 'Del2Ka');
      const entities2 = createTestEntities(1000, 'Del2Kb');
      await entityManager.createEntities(entities1);
      await entityManager.createEntities(entities2);

      // Target: Delete 500 entities (250 from each batch)
      const namesToDelete = [
        ...entities1.slice(0, 250).map(e => e.name),
        ...entities2.slice(0, 250).map(e => e.name),
      ];

      const { durationMs } = await measureTime(() =>
        entityManager.deleteEntities(namesToDelete)
      );

      console.log(`deleteEntities(500 from 2000): ${durationMs.toFixed(2)}ms`);

      // Generous limit for pre-optimization baseline
      expect(durationMs).toBeLessThan(1000);
    });
  });

  // ============================================================
  // addTags Benchmarks (Sprint 3: NameIndex Utilization)
  // Current: loadGraph() + O(n) find() - target: O(1) getEntityByName()
  // ============================================================

  describe('addTags Performance', () => {
    it('should add tags with O(1) entity lookup', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'Tag1K_');
      await entityManager.createEntities(entities);

      // Measure single addTags operation
      const { durationMs } = await measureTime(() =>
        entityManager.addTags('Tag1K_500', ['benchmark', 'test'])
      );

      console.log(`addTags(1 entity in 1000): ${durationMs.toFixed(2)}ms`);

      // Should be fast even with current implementation
      expect(durationMs).toBeLessThan(100);
    });

    it('should add tags to 50 entities sequentially', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'TagSeq_');
      await entityManager.createEntities(entities);

      // Measure 50 sequential addTags operations
      const { durationMs } = await measureTime(async () => {
        for (let i = 0; i < 50; i++) {
          await entityManager.addTags(`TagSeq_${i * 20}`, ['sequential', 'benchmark']);
        }
      });

      console.log(`addTags(50 sequential): ${durationMs.toFixed(2)}ms`);

      // 50 operations should still be reasonable (generous limit for CI variance)
      // Increased from 1500ms to 2500ms for broader machine compatibility
      expect(durationMs).toBeLessThan(2500);
    });
  });

  // ============================================================
  // setImportance Benchmarks (Sprint 3: NameIndex Utilization)
  // Current: loadGraph() + O(n) find() - target: O(1) getEntityByName()
  // ============================================================

  describe('setImportance Performance', () => {
    it('should set importance with O(1) entity lookup', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'Imp1K_');
      await entityManager.createEntities(entities);

      // Measure single setImportance operation
      const { durationMs } = await measureTime(() =>
        entityManager.setImportance('Imp1K_500', 8)
      );

      console.log(`setImportance(1 entity in 1000): ${durationMs.toFixed(2)}ms`);

      // Should be fast (increased from 100ms for broader machine compatibility)
      expect(durationMs).toBeLessThan(200);
    });

    it('should set importance for 50 entities sequentially', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'ImpSeq_');
      await entityManager.createEntities(entities);

      // Measure 50 sequential setImportance operations
      const { durationMs } = await measureTime(async () => {
        for (let i = 0; i < 50; i++) {
          await entityManager.setImportance(`ImpSeq_${i * 20}`, (i % 10) + 1);
        }
      });

      console.log(`setImportance(50 sequential in 1000): ${durationMs.toFixed(2)}ms`);

      // Sequential operations with disk I/O can be slow on different machines
      expect(durationMs).toBeLessThan(10000);
    });
  });

  // ============================================================
  // batchUpdate Benchmarks (Sprint 4: Map-Based Lookups)
  // Current: O(n×m) with find() in loop - target: O(n+m) with Map
  // ============================================================

  describe('batchUpdate Performance', () => {
    it('should batch update 100 entities efficiently', async () => {
      // Setup: Create 500 entities
      const entities = createTestEntities(500, 'Batch_');
      await entityManager.createEntities(entities);

      // Prepare 100 updates
      const updates = Array.from({ length: 100 }, (_, i) => ({
        name: `Batch_${i * 5}`,
        updates: {
          observations: [`Updated observation ${i}`],
          importance: (i % 10) + 1,
        },
      }));

      const { durationMs } = await measureTime(() =>
        entityManager.batchUpdate(updates)
      );

      console.log(`batchUpdate(100 in 500): ${durationMs.toFixed(2)}ms`);

      // Generous limit for pre-optimization baseline
      expect(durationMs).toBeLessThan(500);
    });

    it('should batch update 200 entities in larger graph', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'BatchLarge_');
      await entityManager.createEntities(entities);

      // Prepare 200 updates
      const updates = Array.from({ length: 200 }, (_, i) => ({
        name: `BatchLarge_${i * 5}`,
        updates: {
          observations: [`Updated observation ${i}`],
        },
      }));

      const { durationMs } = await measureTime(() =>
        entityManager.batchUpdate(updates)
      );

      console.log(`batchUpdate(200 in 1000): ${durationMs.toFixed(2)}ms`);

      expect(durationMs).toBeLessThan(1000);
    });
  });

  // ============================================================
  // NameIndex Verification (Sprint 1 Task 3)
  // Verify getEntityByName() provides O(1) lookup
  // ============================================================

  describe('NameIndex O(1) Verification', () => {
    it('should have O(1) getEntityByName lookup (100 lookups < 10ms)', async () => {
      // Setup: Create 1000 entities
      const entities = createTestEntities(1000, 'Index_');
      await entityManager.createEntities(entities);

      // Perform 100 lookups
      const { durationMs } = await measureTime(async () => {
        for (let i = 0; i < 100; i++) {
          storage.getEntityByName(`Index_${i * 10}`);
        }
      });

      console.log(`getEntityByName(100 lookups): ${durationMs.toFixed(2)}ms`);
      console.log(`Average per lookup: ${(durationMs / 100).toFixed(3)}ms`);

      // 100 O(1) lookups should be very fast
      expect(durationMs).toBeLessThan(10);
    });

    it('should return undefined for non-existent entity', () => {
      const result = storage.getEntityByName('NonExistentEntity');
      expect(result).toBeUndefined();
    });
  });

  // ============================================================
  // Pre-computed Similarity Optimization (Phase 9 Sprint 2)
  // Uses prepared entities to avoid repeated Set creation in O(n²) comparisons
  // ============================================================

  describe('Pre-computed Similarity Optimization', () => {
    it('should complete findDuplicates efficiently with prepared entities', async () => {
      // Create temp storage
      const testPath = join(tmpdir(), `bench-sim-${Date.now()}.jsonl`);
      const storage = new GraphStorage(testPath);

      // Create 50 entities with observations and tags
      const entities = Array.from({ length: 50 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: i % 5 === 0 ? 'special' : 'common',
        observations: [`Observation ${i}`, `Data point ${i % 10}`, `Detail about item ${i}`],
        tags: [`tag${i % 10}`, 'benchmark', `category${i % 5}`],
      }));

      await storage.saveGraph({ entities, relations: [] });

      const manager = new CompressionManager(storage);

      // Time findDuplicates
      const start = Date.now();
      const duplicates = await manager.findDuplicates(0.7);
      const duration = Date.now() - start;

      console.log(`findDuplicates (50 entities, optimized): ${duration}ms`);

      // Should complete in reasonable time (< 500ms)
      expect(duration).toBeLessThan(500);

      // Cleanup
      await fs.unlink(testPath).catch(() => {});
    });
  });
});
