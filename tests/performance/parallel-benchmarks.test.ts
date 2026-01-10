/**
 * Parallel Processing Benchmarks
 *
 * Phase 12 Sprint 2: Performance benchmarks for parallel processing utilities.
 *
 * NOTE: Actual performance assertions are SKIPPED per task requirements.
 * These tests focus on correctness with benchmark-style structure.
 * Performance optimization will happen after codebase split.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkerPoolManager,
  getWorkerPoolManager,
} from '../../src/utils/WorkerPoolManager.js';
import {
  BatchProcessor,
  processBatch,
  mapParallel,
  filterParallel,
  chunkArray,
} from '../../src/utils/BatchProcessor.js';
import {
  ParallelSearchExecutor,
  type LayerTiming,
} from '../../src/search/ParallelSearchExecutor.js';
import type { Entity, ReadonlyKnowledgeGraph } from '../../src/types/index.js';

// Skip benchmark environment variable
const SKIP_BENCHMARKS = process.env.SKIP_BENCHMARKS === 'true';

/**
 * Helper to create test entities.
 */
function createEntity(
  name: string,
  type: string,
  observations: string[] = [],
  tags: string[] = [],
  importance = 5
): Entity {
  return {
    name,
    entityType: type,
    observations,
    tags,
    importance,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
}

/**
 * Generate test entities for benchmarks.
 */
function generateEntities(count: number): Entity[] {
  const entities: Entity[] = [];
  const types = ['person', 'company', 'project', 'concept', 'location'];
  const tagOptions = ['tech', 'finance', 'health', 'education', 'entertainment'];

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const tags = [tagOptions[i % tagOptions.length], tagOptions[(i + 1) % tagOptions.length]];
    entities.push(
      createEntity(
        `Entity_${i}`,
        type,
        [`Observation 1 for entity ${i}`, `Observation 2 for entity ${i}`],
        tags,
        (i % 10) + 1
      )
    );
  }
  return entities;
}

describe('Parallel Processing Benchmarks', () => {
  let manager: WorkerPoolManager;

  beforeEach(() => {
    WorkerPoolManager.resetInstance();
    manager = WorkerPoolManager.getInstance();
  });

  afterEach(async () => {
    await manager.shutdownAll(true);
    WorkerPoolManager.resetInstance();
  });

  describe('WorkerPoolManager Performance', () => {
    it('should create pools quickly', () => {
      const startTime = Date.now();
      const poolCount = 5;

      for (let i = 0; i < poolCount; i++) {
        manager.getPool(`benchmark-pool-${i}`);
      }

      const duration = Date.now() - startTime;

      // Correctness check
      expect(manager.poolCount).toBe(poolCount);

      // Performance expectation (skipped assertion)
      if (!SKIP_BENCHMARKS) {
        console.log(`Created ${poolCount} pools in ${duration}ms`);
        // expect(duration).toBeLessThan(1000); // Skipped
      }
    });

    it('should track statistics accurately', () => {
      manager.getPool('stats-benchmark');

      const executionCount = 100;
      const avgTime = 10;

      for (let i = 0; i < executionCount; i++) {
        manager.recordTaskExecution('stats-benchmark', avgTime);
      }

      const stats = manager.getPoolStats('stats-benchmark');

      // Correctness checks
      expect(stats).toBeDefined();
      expect(stats!.totalTasksExecuted).toBe(executionCount);
      expect(stats!.totalExecutionTime).toBe(executionCount * avgTime);
      expect(stats!.averageExecutionTime).toBe(avgTime);
    });

    it('should handle concurrent pool access', async () => {
      const concurrentRequests = 10;
      const poolId = 'concurrent-test';

      // First create the pool
      manager.getPool(poolId);

      // Then make concurrent accesses
      const promises = Array(concurrentRequests)
        .fill(null)
        .map(() => Promise.resolve(manager.getPool(poolId)));

      const pools = await Promise.all(promises);

      // All should return the same pool instance
      const firstPool = pools[0];
      expect(pools.every(p => p === firstPool)).toBe(true);
    });
  });

  describe('BatchProcessor Performance', () => {
    it('should process items in batches correctly', async () => {
      const itemCount = 100;
      const items = Array.from({ length: itemCount }, (_, i) => i);
      const processor = new BatchProcessor<number, number>({ concurrency: 10 });

      const result = await processor.process(items, async item => item * 2);

      // Correctness checks
      expect(result.succeeded).toBe(itemCount);
      expect(result.failed).toBe(0);
      expect(result.results.every(r => r.success)).toBe(true);

      // Verify ordering preserved
      for (let i = 0; i < itemCount; i++) {
        expect(result.results[i].result).toBe(i * 2);
      }
    });

    it('should scale with concurrency', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      const delayMs = 10;

      // Sequential (concurrency: 1)
      const seqStart = Date.now();
      await processBatch(items, async item => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return item;
      }, { concurrency: 1 });
      const seqTime = Date.now() - seqStart;

      // Parallel (concurrency: 5)
      const parStart = Date.now();
      await processBatch(items, async item => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return item;
      }, { concurrency: 5 });
      const parTime = Date.now() - parStart;

      // Parallel should be faster
      // Note: This is a correctness test that parallel is faster, not a specific speedup target
      expect(parTime).toBeLessThan(seqTime);

      if (!SKIP_BENCHMARKS) {
        const speedup = seqTime / parTime;
        console.log(`Sequential: ${seqTime}ms, Parallel: ${parTime}ms, Speedup: ${speedup.toFixed(2)}x`);
      }
    });

    it('should handle errors without failing entire batch', async () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      const failIndices = [5, 15, 25, 35, 45];

      const result = await processBatch(items, async (item, index) => {
        if (failIndices.includes(index)) {
          throw new Error(`Failed at ${index}`);
        }
        return item * 2;
      }, { concurrency: 5 });

      // Correctness: Most should succeed
      expect(result.succeeded).toBe(45);
      expect(result.failed).toBe(5);
      expect(result.errors.size).toBe(5);

      // Verify failed indices
      for (const idx of failIndices) {
        expect(result.errors.has(idx)).toBe(true);
      }
    });

    it('should retry failed items correctly', async () => {
      const retryAttempts: Map<number, number> = new Map();
      const items = [1, 2, 3, 4, 5];

      const result = await processBatch(items, async (item, index) => {
        const attempts = (retryAttempts.get(index) ?? 0) + 1;
        retryAttempts.set(index, attempts);

        if (index === 2 && attempts < 2) {
          throw new Error('Retry me');
        }
        return item * 2;
      }, { maxRetries: 3, retryDelayMs: 10 });

      // All should eventually succeed
      expect(result.succeeded).toBe(5);

      // Item at index 2 should have been retried
      expect(retryAttempts.get(2)).toBe(2);
    });
  });

  describe('ParallelSearchExecutor Performance', () => {
    const mockSemanticSearch = {
      search: vi.fn(),
    };
    const mockRankedSearch = {
      searchNodesRanked: vi.fn(),
    };

    let executor: ParallelSearchExecutor;
    let testGraph: ReadonlyKnowledgeGraph;

    beforeEach(() => {
      vi.clearAllMocks();
      executor = new ParallelSearchExecutor(
        mockSemanticSearch as any,
        mockRankedSearch as any
      );

      // Create test graph with generated entities
      const entities = generateEntities(100);
      testGraph = { entities, relations: [] };

      // Mock search results
      mockSemanticSearch.search.mockResolvedValue(
        entities.slice(0, 10).map(e => ({ entity: e, similarity: Math.random() }))
      );
      mockRankedSearch.searchNodesRanked.mockResolvedValue(
        entities.slice(0, 20).map(e => ({ entity: e, score: Math.random() * 10 }))
      );
    });

    it('should execute all layers in parallel', async () => {
      const result = await executor.execute(testGraph, 'test query');

      // Correctness: All layers should execute
      expect(result.timings.length).toBe(3);
      expect(result.timings.map(t => t.layer).sort()).toEqual(['lexical', 'semantic', 'symbolic']);

      // All layers should have timing data
      for (const timing of result.timings) {
        expect(timing.durationMs).toBeGreaterThanOrEqual(0);
        expect(timing.resultCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('should demonstrate parallel speedup', async () => {
      // Add artificial delays to layers
      mockSemanticSearch.search.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return testGraph.entities.slice(0, 5).map(e => ({ entity: e, similarity: 0.8 }));
      });
      mockRankedSearch.searchNodesRanked.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return testGraph.entities.slice(0, 10).map(e => ({ entity: e, score: 5 }));
      });

      const result = await executor.execute(testGraph, 'test');

      const speedupStats = ParallelSearchExecutor.calculateSpeedup(result.timings);

      // Correctness: Parallel time should be less than sequential
      expect(speedupStats.parallelTime).toBeLessThanOrEqual(speedupStats.sequentialTime);

      if (!SKIP_BENCHMARKS) {
        console.log(`Sequential: ${speedupStats.sequentialTime}ms`);
        console.log(`Parallel: ${speedupStats.parallelTime}ms`);
        console.log(`Speedup: ${speedupStats.speedup.toFixed(2)}x`);
      }
    });

    it('should handle layer failures gracefully', async () => {
      mockSemanticSearch.search.mockRejectedValue(new Error('Semantic failure'));

      const result = await executor.execute(testGraph, 'test');

      // Should not fail entirely
      expect(result.allSucceeded).toBe(false);
      expect(result.failedLayers).toContain('semantic');

      // Other layers should still have results
      expect(result.lexicalResults.size).toBeGreaterThan(0);
      expect(result.symbolicResults.size).toBeGreaterThan(0);

      // Timing should include error info
      const semanticTiming = result.timings.find(t => t.layer === 'semantic');
      expect(semanticTiming?.success).toBe(false);
      expect(semanticTiming?.error).toBeDefined();
    });

    it('should format timing summary correctly', () => {
      const timings: LayerTiming[] = [
        {
          layer: 'semantic',
          startTime: 0,
          endTime: 100,
          durationMs: 100,
          success: true,
          resultCount: 10,
        },
        {
          layer: 'lexical',
          startTime: 0,
          endTime: 50,
          durationMs: 50,
          success: true,
          resultCount: 20,
        },
        {
          layer: 'symbolic',
          startTime: 0,
          endTime: 20,
          durationMs: 20,
          success: true,
          resultCount: 5,
        },
      ];

      const summary = ParallelSearchExecutor.formatTimingSummary(timings);

      // Correctness: Summary should contain expected info
      expect(summary).toContain('semantic');
      expect(summary).toContain('lexical');
      expect(summary).toContain('symbolic');
      expect(summary).toContain('100ms');
      expect(summary).toContain('50ms');
      expect(summary).toContain('20ms');
    });
  });

  describe('Utility Function Performance', () => {
    it('should chunk arrays correctly', () => {
      const items = Array.from({ length: 100 }, (_, i) => i);

      const chunks = chunkArray(items, 10);

      // Correctness
      expect(chunks.length).toBe(10);
      expect(chunks.every(c => c.length === 10)).toBe(true);

      // Verify content
      let index = 0;
      for (const chunk of chunks) {
        for (const item of chunk) {
          expect(item).toBe(index);
          index++;
        }
      }
    });

    it('should map in parallel correctly', async () => {
      const items = Array.from({ length: 50 }, (_, i) => i);

      const results = await mapParallel(items, async item => item * 2, 10);

      // Correctness
      expect(results.length).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(results[i]).toBe(i * 2);
      }
    });

    it('should filter in parallel correctly', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);

      const results = await filterParallel(items, async item => item % 2 === 0, 10);

      // Correctness
      expect(results.length).toBe(50);
      expect(results.every(n => n % 2 === 0)).toBe(true);

      // Verify order preserved
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]).toBeLessThan(results[i + 1]);
      }
    });
  });

  describe('Integration Benchmarks', () => {
    it('should process large batches without memory issues', async () => {
      const largeItemCount = 1000;
      const items = Array.from({ length: largeItemCount }, (_, i) => i);

      const result = await processBatch(items, async item => {
        // Simulate some work
        return item.toString().repeat(10);
      }, { concurrency: 50 });

      // Correctness
      expect(result.succeeded).toBe(largeItemCount);
      expect(result.failed).toBe(0);
    });

    it('should handle mixed success/failure patterns', async () => {
      const items = Array.from({ length: 100 }, (_, i) => i);

      // Fail every 7th item
      const result = await processBatch(items, async (item, index) => {
        if (index % 7 === 0) {
          throw new Error(`Failed at ${index}`);
        }
        return item * 2;
      }, { concurrency: 10 });

      // Calculate expected failures
      const expectedFailures = Math.floor(100 / 7) + 1; // Indices 0, 7, 14, ..., 98

      expect(result.failed).toBe(expectedFailures);
      expect(result.succeeded).toBe(100 - expectedFailures);
    });

    it('should report progress accurately', async () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      const progressReports: number[] = [];

      await processBatch(items, async item => item, {
        concurrency: 5,
        batchSize: 10,
        onProgress: p => progressReports.push(p.percentage),
      });

      // Should have multiple progress reports
      expect(progressReports.length).toBeGreaterThan(0);

      // Final progress should be 100%
      expect(progressReports[progressReports.length - 1]).toBe(100);

      // Progress should be increasing
      for (let i = 1; i < progressReports.length; i++) {
        expect(progressReports[i]).toBeGreaterThanOrEqual(progressReports[i - 1]);
      }
    });
  });
});
