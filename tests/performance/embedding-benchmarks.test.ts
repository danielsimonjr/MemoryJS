/**
 * Embedding Performance Benchmarks
 *
 * Phase 12 Sprint 5: Benchmark suite for embedding cache, batch embedding,
 * and incremental indexing performance.
 *
 * NOTE: Actual benchmark assertions are SKIPPED pending codebase split.
 * These tests verify functionality, not performance thresholds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingCache, type EmbeddingCacheStats } from '../../src/search/EmbeddingCache.js';
import {
  IncrementalIndexer,
  type FlushResult,
} from '../../src/search/IncrementalIndexer.js';
import {
  MockEmbeddingService,
  l2Normalize,
  QUERY_PREFIX,
  DOCUMENT_PREFIX,
  type EmbeddingProgressCallback,
} from '../../src/search/EmbeddingService.js';
import { InMemoryVectorStore } from '../../src/search/VectorStore.js';

describe('Embedding Performance Benchmarks', () => {
  describe('l2Normalize', () => {
    it('should normalize a vector to unit length', () => {
      const vector = [3, 4]; // 3-4-5 triangle
      const normalized = l2Normalize(vector);

      // Should be [0.6, 0.8]
      expect(normalized[0]).toBeCloseTo(0.6);
      expect(normalized[1]).toBeCloseTo(0.8);

      // Magnitude should be 1
      const magnitude = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
      expect(magnitude).toBeCloseTo(1);
    });

    it('should handle zero vector', () => {
      const vector = [0, 0, 0];
      const normalized = l2Normalize(vector);
      expect(normalized).toEqual([0, 0, 0]);
    });

    it('should handle already normalized vector', () => {
      const vector = [0.6, 0.8];
      const normalized = l2Normalize(vector);
      expect(normalized[0]).toBeCloseTo(0.6);
      expect(normalized[1]).toBeCloseTo(0.8);
    });

    it('should handle negative values', () => {
      const vector = [-3, 4];
      const normalized = l2Normalize(vector);
      expect(normalized[0]).toBeCloseTo(-0.6);
      expect(normalized[1]).toBeCloseTo(0.8);
    });
  });

  describe('Query/Document Prefixes', () => {
    it('should have correct prefix values', () => {
      expect(QUERY_PREFIX).toBe('query: ');
      expect(DOCUMENT_PREFIX).toBe('passage: ');
    });
  });

  describe('MockEmbeddingService with mode parameter', () => {
    let service: MockEmbeddingService;

    beforeEach(() => {
      service = new MockEmbeddingService(128);
    });

    it('should generate different embeddings for query vs document mode', async () => {
      const text = 'test text';

      const queryEmbedding = await service.embed(text, 'query');
      const documentEmbedding = await service.embed(text, 'document');

      // Embeddings should be different due to different prefixes
      expect(queryEmbedding).not.toEqual(documentEmbedding);
    });

    it('should default to document mode', async () => {
      const text = 'test text';

      const defaultEmbedding = await service.embed(text);
      const documentEmbedding = await service.embed(text, 'document');

      expect(defaultEmbedding).toEqual(documentEmbedding);
    });

    it('should support batch embedding with mode', async () => {
      const texts = ['text1', 'text2', 'text3'];

      const queryEmbeddings = await service.embedBatch(texts, 'query');
      const documentEmbeddings = await service.embedBatch(texts, 'document');

      expect(queryEmbeddings).toHaveLength(3);
      expect(documentEmbeddings).toHaveLength(3);

      // Each query embedding should differ from corresponding document embedding
      for (let i = 0; i < texts.length; i++) {
        expect(queryEmbeddings[i]).not.toEqual(documentEmbeddings[i]);
      }
    });

    it('should support batch embedding with progress callback', async () => {
      const texts = ['text1', 'text2', 'text3', 'text4', 'text5'];
      const progressUpdates: Array<{ current: number; total: number; percentage: number }> = [];

      const callback: EmbeddingProgressCallback = (progress) => {
        progressUpdates.push({ ...progress });
      };

      const embeddings = await service.embedBatchWithProgress(texts, 'document', callback);

      expect(embeddings).toHaveLength(5);
      expect(progressUpdates).toHaveLength(5);
      expect(progressUpdates[0].current).toBe(1);
      expect(progressUpdates[0].total).toBe(5);
      expect(progressUpdates[4].current).toBe(5);
      expect(progressUpdates[4].percentage).toBe(100);
    });
  });

  describe('EmbeddingCache', () => {
    let cache: EmbeddingCache;

    beforeEach(() => {
      cache = new EmbeddingCache({ maxSize: 100, ttlMs: 60000 });
    });

    it('should store and retrieve embeddings', () => {
      const embedding = [0.1, 0.2, 0.3];
      cache.set('entity1', 'Original text', embedding);

      const retrieved = cache.get('entity1', 'Original text');
      expect(retrieved).toEqual(embedding);
    });

    it('should track hit/miss statistics', () => {
      const embedding = [0.1, 0.2, 0.3];
      cache.set('entity1', 'Original text', embedding);

      // Miss
      cache.get('nonexistent', 'text');

      // Hit
      cache.get('entity1', 'Original text');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('should invalidate on text hash change', () => {
      const embedding = [0.1, 0.2, 0.3];
      cache.set('entity1', 'Original text', embedding);

      // Should miss with different text
      const retrieved = cache.get('entity1', 'Modified text');
      expect(retrieved).toBeNull();
    });

    it('should evict LRU entries when at capacity', async () => {
      cache = new EmbeddingCache({ maxSize: 3 });

      cache.set('entity1', 'text1', [0.1]);
      await new Promise(resolve => setTimeout(resolve, 5)); // Ensure different timestamps
      cache.set('entity2', 'text2', [0.2]);
      await new Promise(resolve => setTimeout(resolve, 5));
      cache.set('entity3', 'text3', [0.3]);

      // Access entity1 to make it more recently used
      await new Promise(resolve => setTimeout(resolve, 5));
      cache.get('entity1', 'text1');

      // Add another entry, should evict entity2 (LRU - oldest lastAccess after entity1 was accessed)
      await new Promise(resolve => setTimeout(resolve, 5));
      cache.set('entity4', 'text4', [0.4]);

      expect(cache.get('entity1', 'text1')).not.toBeNull();
      expect(cache.get('entity2', 'text2')).toBeNull(); // Evicted
      expect(cache.get('entity3', 'text3')).not.toBeNull();
      expect(cache.get('entity4', 'text4')).not.toBeNull();
    });

    it('should support TTL expiration', async () => {
      cache = new EmbeddingCache({ maxSize: 100, ttlMs: 50 });

      cache.set('entity1', 'text', [0.1]);

      // Should be present immediately
      expect(cache.get('entity1', 'text')).not.toBeNull();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be expired
      expect(cache.get('entity1', 'text')).toBeNull();
    });

    it('should reset statistics', () => {
      cache.set('entity1', 'text', [0.1]);
      cache.get('entity1', 'text'); // Hit
      cache.get('nonexistent', 'text'); // Miss

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.resetStats();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should prune expired entries', async () => {
      cache = new EmbeddingCache({ maxSize: 100, ttlMs: 50 });

      cache.set('entity1', 'text1', [0.1]);
      cache.set('entity2', 'text2', [0.2]);

      await new Promise(resolve => setTimeout(resolve, 100));

      const removed = cache.pruneExpired();
      expect(removed).toBe(2);
      expect(cache.size()).toBe(0);
    });

    it('should report memory estimation', () => {
      cache = new EmbeddingCache({ dimensions: 128 });

      cache.set('entity1', 'text1', new Array(128).fill(0.1));
      cache.set('entity2', 'text2', new Array(128).fill(0.2));

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.memoryBytes).toBeGreaterThan(0);
    });
  });

  describe('IncrementalIndexer', () => {
    let indexer: IncrementalIndexer;
    let embeddingService: MockEmbeddingService;
    let vectorStore: InMemoryVectorStore;

    beforeEach(() => {
      embeddingService = new MockEmbeddingService(128);
      vectorStore = new InMemoryVectorStore();
      indexer = new IncrementalIndexer(embeddingService, vectorStore, {
        flushThreshold: 10,
        flushIntervalMs: 60000, // Long interval to prevent auto-flush during tests
      });
    });

    afterEach(async () => {
      if (!indexer.isShutdownComplete()) {
        await indexer.shutdown();
      }
    });

    it('should queue and flush create operations', async () => {
      indexer.queueCreate('entity1', 'text content 1');
      indexer.queueCreate('entity2', 'text content 2');

      expect(indexer.getQueueSize()).toBe(2);

      const result = await indexer.flush();

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(indexer.getQueueSize()).toBe(0);

      // Verify vectors were added
      expect(vectorStore.has('entity1')).toBe(true);
      expect(vectorStore.has('entity2')).toBe(true);
    });

    it('should queue and flush update operations', async () => {
      // First create
      indexer.queueCreate('entity1', 'original text');
      await indexer.flush();

      // Then update
      indexer.queueUpdate('entity1', 'updated text');
      const result = await indexer.flush();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(vectorStore.has('entity1')).toBe(true);
    });

    it('should queue and flush delete operations', async () => {
      // First create
      indexer.queueCreate('entity1', 'text');
      await indexer.flush();
      expect(vectorStore.has('entity1')).toBe(true);

      // Then delete
      indexer.queueDelete('entity1');
      const result = await indexer.flush();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(vectorStore.has('entity1')).toBe(false);
    });

    it('should deduplicate operations for same entity', () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueUpdate('entity1', 'text2');
      indexer.queueDelete('entity1');

      // Should only have the latest operation
      expect(indexer.getQueueSize()).toBe(1);

      const queue = indexer.getQueue();
      expect(queue[0].type).toBe('delete');
    });

    it('should auto-flush at threshold', async () => {
      // Set up a smaller threshold
      indexer = new IncrementalIndexer(embeddingService, vectorStore, {
        flushThreshold: 3,
        flushIntervalMs: 60000,
      });

      // Queue operations to trigger auto-flush
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');
      indexer.queueCreate('entity3', 'text3');

      // Wait for auto-flush (triggered by setImmediate)
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 100));

      // Queue should be flushed
      expect(indexer.getQueueSize()).toBe(0);
      expect(vectorStore.size()).toBe(3);

      await indexer.shutdown();
    });

    it('should track progress during flush', async () => {
      const progressUpdates: Array<{ current: number; total: number }> = [];

      indexer = new IncrementalIndexer(embeddingService, vectorStore, {
        flushThreshold: 100,
        flushIntervalMs: 60000,
        onProgress: (progress) => {
          progressUpdates.push({ current: progress.current, total: progress.total });
        },
      });

      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      await indexer.flush();

      // Progress should have been reported
      expect(progressUpdates.length).toBeGreaterThan(0);

      await indexer.shutdown();
    });

    it('should handle graceful shutdown', async () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const result = await indexer.shutdown();

      expect(result.processed).toBe(2);
      expect(indexer.isShutdownComplete()).toBe(true);

      // Should throw after shutdown
      expect(() => indexer.queueCreate('entity3', 'text3')).toThrow('Indexer is shutdown');
    });

    it('should clear queue without processing', async () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const cleared = indexer.clearQueue();

      expect(cleared).toBe(2);
      expect(indexer.getQueueSize()).toBe(0);
    });

    it('should report busy status during flush', async () => {
      expect(indexer.isBusy()).toBe(false);

      // Note: Due to the async nature, we can't easily test the "during flush" state
      // without more complex mocking. This is a basic verification.
    });
  });

  describe('Benchmark: Cache Performance', () => {
    it.skip('BENCHMARK: Cache operations should be fast (SKIPPED pending codebase split)', () => {
      const cache = new EmbeddingCache({ maxSize: 10000 });
      const embedding = new Array(384).fill(0.1);

      // Benchmark: 10000 set operations
      const setStart = Date.now();
      for (let i = 0; i < 10000; i++) {
        cache.set(`entity${i}`, `text${i}`, embedding);
      }
      const setDuration = Date.now() - setStart;

      // Benchmark: 10000 get operations (hits)
      const getStart = Date.now();
      for (let i = 0; i < 10000; i++) {
        cache.get(`entity${i}`, `text${i}`);
      }
      const getDuration = Date.now() - getStart;

      console.log(`Set 10000 entries: ${setDuration}ms`);
      console.log(`Get 10000 entries: ${getDuration}ms`);

      // These are informational; actual thresholds would be set based on requirements
    });
  });

  describe('Benchmark: Batch Embedding', () => {
    it.skip('BENCHMARK: Batch embedding should be efficient (SKIPPED pending codebase split)', async () => {
      const service = new MockEmbeddingService(384);
      const texts = Array.from({ length: 1000 }, (_, i) => `Sample text content ${i}`);

      const start = Date.now();
      const embeddings = await service.embedBatch(texts);
      const duration = Date.now() - start;

      console.log(`Batch embed 1000 texts: ${duration}ms`);
      expect(embeddings).toHaveLength(1000);
    });
  });

  describe('Benchmark: Incremental Indexing', () => {
    it.skip('BENCHMARK: Incremental indexing throughput (SKIPPED pending codebase split)', async () => {
      const embeddingService = new MockEmbeddingService(384);
      const vectorStore = new InMemoryVectorStore();
      const indexer = new IncrementalIndexer(embeddingService, vectorStore, {
        flushThreshold: 100,
        flushIntervalMs: 60000,
      });

      // Queue 500 operations
      const queueStart = Date.now();
      for (let i = 0; i < 500; i++) {
        indexer.queueCreate(`entity${i}`, `Text content for entity ${i}`);
      }
      const queueDuration = Date.now() - queueStart;

      // Flush all
      const flushStart = Date.now();
      const result = await indexer.flush();
      const flushDuration = Date.now() - flushStart;

      console.log(`Queue 500 operations: ${queueDuration}ms`);
      console.log(`Flush 500 operations: ${flushDuration}ms`);
      console.log(`Total succeeded: ${result.succeeded}`);

      await indexer.shutdown();
    });
  });
});
