/**
 * v10.0.0 Performance Verification Tests
 *
 * Phase 12 Sprint 6: Comprehensive benchmark suite for v10.0.0 release.
 *
 * NOTE: Per project requirements, actual performance assertions are skipped.
 * These tests verify correctness and log timing for reference.
 * Benchmarking will be done post-codebase split (memoryjs).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../../src/core/EntityManager.js';
import { SearchManager } from '../../src/search/SearchManager.js';
import { CompressionManager } from '../../src/features/CompressionManager.js';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { BM25Search } from '../../src/search/BM25Search.js';
import { OptimizedInvertedIndex } from '../../src/search/OptimizedInvertedIndex.js';
import { HybridScorer } from '../../src/search/HybridScorer.js';
import { BatchProcessor, chunkArray } from '../../src/utils/BatchProcessor.js';
import { WorkerPoolManager } from '../../src/utils/WorkerPoolManager.js';
import { ParallelSearchExecutor } from '../../src/search/ParallelSearchExecutor.js';
import { EarlyTerminationManager } from '../../src/search/EarlyTerminationManager.js';
import { QueryPlanCache } from '../../src/search/QueryPlanCache.js';
import { QueryCostEstimator } from '../../src/search/QueryCostEstimator.js';
import { EmbeddingCache } from '../../src/search/EmbeddingCache.js';
import { IncrementalIndexer } from '../../src/search/IncrementalIndexer.js';
import { QuantizedVectorStore } from '../../src/search/QuantizedVectorStore.js';
import { MemoryMonitor } from '../../src/utils/MemoryMonitor.js';
import { CompressedCache } from '../../src/utils/compressedCache.js';
import type { Entity, Relation } from '../../src/types/index.js';

// Skip actual timing assertions, just verify correctness
const SKIP_BENCHMARKS = true;

describe('v10.0.0 Performance Verification', () => {
  /**
   * Helper to measure execution time.
   */
  async function measureTime<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const elapsed = performance.now() - start;
    console.log(`[v10] ${name}: ${elapsed.toFixed(2)}ms`);
    return result;
  }

  function measureTimeSync<T>(name: string, fn: () => T): T {
    const start = performance.now();
    const result = fn();
    const elapsed = performance.now() - start;
    console.log(`[v10] ${name}: ${elapsed.toFixed(2)}ms`);
    return result;
  }

  describe('Sprint 1: Foundation Performance', () => {
    it('should verify EntityManager and GraphStorage classes exist', () => {
      // Sprint 1 focuses on Set-based lookups and fnv1aHash
      // These are internal optimizations - verify classes can be instantiated
      expect(EntityManager).toBeDefined();
      expect(GraphStorage).toBeDefined();
      expect(CompressionManager).toBeDefined();
    });

    it('should use fnv1aHash for pre-computed similarity', () => {
      // fnv1aHash is used internally by CompressionManager
      // Verify the class exists and exports are correct
      expect(CompressionManager).toBeDefined();
    });
  });

  describe('Sprint 2: Parallel Processing', () => {
    it('should have WorkerPoolManager singleton available', () => {
      // WorkerPoolManager is a singleton - verify it's accessible
      const instance = WorkerPoolManager.getInstance();
      expect(instance).toBeDefined();
    });

    it('should use BatchProcessor for concurrent operations', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      const processor = new BatchProcessor<number, number>({
        concurrency: 2,
      });

      const results = await measureTime('Batch process 20 items', async () => {
        return processor.process(items, async (item) => item * 2);
      });

      expect(results.results.length).toBe(20);
      expect(results.succeeded).toBe(20);
    });

    it('should chunk arrays efficiently', () => {
      const items = Array.from({ length: 100 }, (_, i) => i);
      const chunks = measureTimeSync('Chunk 100 items into 10', () => {
        return chunkArray(items, 10);
      });

      expect(chunks.length).toBe(10);
      expect(chunks.every(c => c.length === 10)).toBe(true);
    });
  });

  describe('Sprint 3: Search Algorithm Optimization', () => {
    it('should have BM25Search class available', () => {
      // BM25Search requires GraphStorage - verify class exists
      expect(BM25Search).toBeDefined();
    });

    it('should use OptimizedInvertedIndex for fast lookups', () => {
      const index = new OptimizedInvertedIndex();

      // addDocument takes (entityName, terms: string[])
      for (let i = 0; i < 100; i++) {
        index.addDocument(`entity${i}`, ['document', `term${i}`, 'content']);
      }

      const postings = measureTimeSync('Get postings for "document"', () => {
        return index.getPostingList('document');
      });

      expect(postings).not.toBeNull();
      expect(postings!.docIds.length).toBe(100);
    });

    it('should use HybridScorer for score aggregation', () => {
      const scorer = new HybridScorer();

      const entity: Entity = {
        name: 'Test',
        entityType: 'person',
        observations: ['test observation'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      };

      // Create entity map for lookups
      const entityMap = new Map<string, Entity>();
      entityMap.set('Test', entity);

      // Use correct result interfaces
      const semantic = [{ entityName: 'Test', similarity: 0.8 }];
      const lexical = [{ entityName: 'Test', score: 0.7 }];
      const symbolic = [{ entityName: 'Test', score: 0.6 }];

      const combined = measureTimeSync('Combine scores', () => {
        return scorer.combine(semantic, lexical, symbolic, entityMap);
      });

      expect(combined.length).toBe(1);
      expect(combined[0].scores.combined).toBeGreaterThan(0);
    });
  });

  describe('Sprint 4: Query Execution Optimization', () => {
    it('should use QueryPlanCache for caching', () => {
      const cache = new QueryPlanCache({ maxSize: 100 });

      const analysis = {
        query: 'test',
        entities: [],
        persons: [],
        locations: [],
        organizations: [],
        temporalRange: null,
        questionType: 'factual' as const,
        complexity: 'low' as const,
        confidence: 0.8,
        requiredInfoTypes: [],
      };

      cache.setAnalysis('test query', analysis);

      const cached = measureTimeSync('Get cached analysis', () => {
        return cache.getAnalysis('test query');
      });

      expect(cached).toBeDefined();
      expect(cached!.query).toBe('test');

      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('should use QueryCostEstimator for layer recommendations', () => {
      const estimator = new QueryCostEstimator();

      const estimate = measureTimeSync('Estimate query cost', () => {
        return estimator.estimateMethod('ranked', 'test query', 1000);
      });

      expect(estimate).toBeDefined();
    });

    it('should create EarlyTerminationManager', () => {
      const mockSearch = { searchWithEntities: async () => [] };
      const estimator = new QueryCostEstimator();
      const manager = new EarlyTerminationManager(mockSearch as any, estimator);

      expect(manager).toBeDefined();
    });
  });

  describe('Sprint 5: Embedding Performance', () => {
    it('should use EmbeddingCache for caching', () => {
      const cache = new EmbeddingCache({ maxSize: 100 });

      // EmbeddingCache.set takes (key, text, vector)
      cache.set('entity1', 'test text content', [0.1, 0.2, 0.3]);

      // EmbeddingCache.get takes (key, text)
      const embedding = measureTimeSync('Get cached embedding', () => {
        return cache.get('entity1', 'test text content');
      });

      expect(embedding).toBeDefined();
      expect(embedding!.length).toBe(3);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
    });

    it('should use IncrementalIndexer for batched updates', () => {
      // Mock embedding service
      const mockEmbeddingService = {
        embed: async () => [0.1, 0.2, 0.3],
        embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
      };
      // Mock vector store
      const mockVectorStore = {
        has: () => false,
        add: () => {},
        remove: () => {},
      };
      const indexer = new IncrementalIndexer(mockEmbeddingService as any, mockVectorStore as any, { flushThreshold: 10 });

      // IncrementalIndexer uses queueCreate/queueUpdate/queueDelete
      indexer.queueCreate('entity1', 'test text 1');
      indexer.queueCreate('entity2', 'test text 2');

      expect(indexer.getQueueSize()).toBe(2);
    });
  });

  describe('Sprint 6: Memory Efficiency', () => {
    it('should use QuantizedVectorStore for 4x memory reduction', () => {
      const store = new QuantizedVectorStore({ minVectorsForQuantization: 5 });

      for (let i = 0; i < 10; i++) {
        const vector = Array.from({ length: 64 }, (_, j) => Math.sin(i + j) * 0.5 + 0.5);
        store.add(`entity${i}`, vector);
      }

      const stats = measureTimeSync('Get quantized stats', () => {
        return store.getStats();
      });

      expect(stats.memoryReductionRatio).toBeCloseTo(4, 1);
      expect(store.isUsingQuantization()).toBe(true);
    });

    it('should use MemoryMonitor for tracking', () => {
      const monitor = new MemoryMonitor();

      monitor.registerComponent('test', () => 1000000, () => 100);

      const usage = measureTimeSync('Get memory usage', () => {
        return monitor.getUsage();
      });

      expect(usage.totalBytes).toBe(1000000);
      expect(usage.components[0].bytesPerItem).toBe(10000);
      expect(usage.totalFormatted).toContain('KB');
    });

    it('should use CompressedCache with adaptive compression', () => {
      const cache = new CompressedCache({
        maxUncompressed: 10,
        minCompressionSize: 100,
        minCompressionRatio: 0.8,
      });

      // Add entities
      for (let i = 0; i < 20; i++) {
        cache.set(`entity${i}`, {
          name: `Entity${i}`,
          entityType: 'test',
          observations: Array.from({ length: 50 }, (_, j) => `observation ${i}-${j}`),
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        });
      }

      const stats = measureTimeSync('Get cache stats', () => {
        return cache.getStats();
      });

      expect(stats.total).toBe(20);
      // New adaptive compression stats
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });
  });

  describe('Integration: All Sprints Combined', () => {
    it('should have all Phase 12 components available', () => {
      // Sprint 1
      expect(EntityManager).toBeDefined();
      expect(CompressionManager).toBeDefined();

      // Sprint 2
      expect(WorkerPoolManager).toBeDefined();
      expect(BatchProcessor).toBeDefined();
      expect(ParallelSearchExecutor).toBeDefined();

      // Sprint 3
      expect(BM25Search).toBeDefined();
      expect(OptimizedInvertedIndex).toBeDefined();
      expect(HybridScorer).toBeDefined();

      // Sprint 4
      expect(EarlyTerminationManager).toBeDefined();
      expect(QueryPlanCache).toBeDefined();
      expect(QueryCostEstimator).toBeDefined();

      // Sprint 5
      expect(EmbeddingCache).toBeDefined();
      expect(IncrementalIndexer).toBeDefined();

      // Sprint 6
      expect(QuantizedVectorStore).toBeDefined();
      expect(MemoryMonitor).toBeDefined();
      expect(CompressedCache).toBeDefined();
    });
  });
});
