/**
 * IncrementalIndexer Unit Tests
 *
 * Phase 12 Sprint 5: Embedding Performance
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  IncrementalIndexer,
  DEFAULT_INDEXER_OPTIONS,
  type IndexOperation,
} from '../../../src/search/IncrementalIndexer.js';
import type { EmbeddingService, IVectorStore, EmbeddingMode } from '../../../src/types/index.js';

describe('IncrementalIndexer', () => {
  let indexer: IncrementalIndexer;
  let mockEmbeddingService: EmbeddingService;
  let mockVectorStore: IVectorStore;

  const createMockEmbeddingService = (): EmbeddingService => ({
    isConfigured: () => true,
    getDimensions: () => 384,
    embed: vi.fn().mockResolvedValue(Array(384).fill(0.1)),
    embedBatch: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => Array(384).fill(0.1)))
    ),
    getProviderName: () => 'mock',
    getModelName: () => 'mock-model',
  });

  const createMockVectorStore = (): IVectorStore => ({
    add: vi.fn(),
    remove: vi.fn(),
    findNearest: vi.fn().mockReturnValue([]),
    has: vi.fn().mockReturnValue(false),
    size: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    getMemoryUsage: vi.fn().mockReturnValue({
      vectorBytes: 0,
      metadataBytes: 0,
      totalBytes: 0,
      vectorCount: 0,
    }),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockEmbeddingService = createMockEmbeddingService();
    mockVectorStore = createMockVectorStore();
    indexer = new IncrementalIndexer(mockEmbeddingService, mockVectorStore, {
      flushThreshold: 5,
      flushIntervalMs: 1000,
    });
  });

  afterEach(async () => {
    // Shutdown the indexer to clean up timers
    await indexer.shutdown();
    vi.useRealTimers();
  });

  describe('Queue Operations', () => {
    it('should queue create operations', () => {
      indexer.queueCreate('entity1', 'text content');

      expect(indexer.getQueueSize()).toBe(1);
      const queue = indexer.getQueue();
      expect(queue[0].type).toBe('create');
      expect(queue[0].entityName).toBe('entity1');
      expect(queue[0].text).toBe('text content');
    });

    it('should queue update operations', () => {
      indexer.queueUpdate('entity1', 'updated text');

      expect(indexer.getQueueSize()).toBe(1);
      const queue = indexer.getQueue();
      expect(queue[0].type).toBe('update');
    });

    it('should queue delete operations', () => {
      indexer.queueDelete('entity1');

      expect(indexer.getQueueSize()).toBe(1);
      const queue = indexer.getQueue();
      expect(queue[0].type).toBe('delete');
      expect(queue[0].text).toBeUndefined();
    });

    it('should replace existing operations for same entity', () => {
      indexer.queueCreate('entity1', 'original text');
      indexer.queueUpdate('entity1', 'updated text');

      expect(indexer.getQueueSize()).toBe(1);
      const queue = indexer.getQueue();
      expect(queue[0].type).toBe('update');
      expect(queue[0].text).toBe('updated text');
    });

    it('should clear queue', () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const cleared = indexer.clearQueue();

      expect(cleared).toBe(2);
      expect(indexer.getQueueSize()).toBe(0);
    });
  });

  describe('Flush Operations', () => {
    it('should flush and process queued operations', async () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const result = await indexer.flush();

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should process delete operations first', async () => {
      const callOrder: string[] = [];
      mockVectorStore.remove = vi.fn().mockImplementation(() => {
        callOrder.push('remove');
      });
      mockVectorStore.add = vi.fn().mockImplementation(() => {
        callOrder.push('add');
      });

      indexer.queueCreate('entity1', 'text');
      indexer.queueDelete('entity2');

      await indexer.flush();

      // Remove should be called before add
      expect(callOrder[0]).toBe('remove');
    });

    it('should batch embedding operations', async () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');
      indexer.queueCreate('entity3', 'text3');

      await indexer.flush();

      // Should call embedBatch once with all texts
      expect(mockEmbeddingService.embedBatch).toHaveBeenCalledTimes(1);
      expect(mockEmbeddingService.embedBatch).toHaveBeenCalledWith(
        ['text1', 'text2', 'text3'],
        'document'
      );
    });

    it('should handle failed operations', async () => {
      mockVectorStore.add = vi.fn().mockImplementation((name: string) => {
        if (name === 'entity2') {
          throw new Error('Storage error');
        }
      });

      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');
      indexer.queueCreate('entity3', 'text3');

      const result = await indexer.flush();

      expect(result.processed).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].entityName).toBe('entity2');
    });

    it('should handle batch embedding failure', async () => {
      mockEmbeddingService.embedBatch = vi.fn().mockRejectedValue(new Error('API error'));

      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const result = await indexer.flush();

      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should return empty result when already flushing', async () => {
      // Simulate slow embedding
      mockEmbeddingService.embedBatch = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([[0.1]]), 100))
      );

      indexer.queueCreate('entity1', 'text1');

      // Start first flush
      const firstFlush = indexer.flush();

      // Try second flush immediately
      const secondResult = await indexer.flush();

      expect(secondResult.processed).toBe(0);

      // Wait for first flush to complete
      vi.advanceTimersByTime(200);
      await firstFlush;
    });
  });

  describe('Auto-Flush', () => {
    it('should auto-flush when threshold reached', async () => {
      // Use real timers for this test to avoid setImmediate issues
      vi.useRealTimers();

      const realIndexer = new IncrementalIndexer(mockEmbeddingService, mockVectorStore, {
        flushThreshold: 3,
        flushIntervalMs: 60000, // Long interval to avoid timer flush
      });

      realIndexer.queueCreate('entity1', 'text1');
      realIndexer.queueCreate('entity2', 'text2');
      realIndexer.queueCreate('entity3', 'text3'); // Should trigger auto-flush

      // Wait for setImmediate to execute
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockEmbeddingService.embedBatch).toHaveBeenCalled();

      await realIndexer.shutdown();
      vi.useFakeTimers();
    });

    it('should flush on timer interval', async () => {
      // Use real timers for this test
      vi.useRealTimers();

      const shortIntervalIndexer = new IncrementalIndexer(mockEmbeddingService, mockVectorStore, {
        flushThreshold: 100, // High threshold to avoid auto-flush
        flushIntervalMs: 50, // Short interval for test
      });

      shortIntervalIndexer.queueCreate('entity1', 'text1');

      // Wait for interval to fire
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockEmbeddingService.embedBatch).toHaveBeenCalled();

      await shortIntervalIndexer.shutdown();
      vi.useFakeTimers();
    });
  });

  describe('Shutdown', () => {
    it('should flush remaining operations on shutdown', async () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const result = await indexer.shutdown();

      expect(result.processed).toBe(2);
      expect(indexer.isShutdownComplete()).toBe(true);
    });

    it('should reject new operations after shutdown', async () => {
      await indexer.shutdown();

      expect(() => indexer.queueCreate('entity1', 'text')).toThrow('Indexer is shutdown');
      expect(() => indexer.queueUpdate('entity1', 'text')).toThrow('Indexer is shutdown');
      expect(() => indexer.queueDelete('entity1')).toThrow('Indexer is shutdown');
    });

    it('should wait for in-progress flush before shutdown', async () => {
      let flushComplete = false;
      mockEmbeddingService.embedBatch = vi.fn().mockImplementation(
        () => new Promise(resolve => {
          setTimeout(() => {
            flushComplete = true;
            resolve([[0.1]]);
          }, 100);
        })
      );

      indexer.queueCreate('entity1', 'text1');

      // Start flush
      indexer.flush();

      // Shutdown should wait
      const shutdownPromise = indexer.shutdown();

      // Advance timers to complete flush
      vi.advanceTimersByTime(200);
      await vi.runAllTimersAsync();

      await shutdownPromise;

      expect(flushComplete).toBe(true);
    });
  });

  describe('Status Methods', () => {
    it('should report queue size', () => {
      expect(indexer.getQueueSize()).toBe(0);

      indexer.queueCreate('entity1', 'text');

      expect(indexer.getQueueSize()).toBe(1);
    });

    it('should report busy state', async () => {
      expect(indexer.isBusy()).toBe(false);

      // Create a promise that we can control
      let resolveFlush: (value: number[][]) => void;
      mockEmbeddingService.embedBatch = vi.fn().mockImplementation(
        () => new Promise(resolve => {
          resolveFlush = resolve;
        })
      );

      indexer.queueCreate('entity1', 'text');
      const flushPromise = indexer.flush();

      expect(indexer.isBusy()).toBe(true);

      // Complete the flush
      resolveFlush!([[0.1]]);
      await flushPromise;

      expect(indexer.isBusy()).toBe(false);
    });

    it('should return queue copy', () => {
      indexer.queueCreate('entity1', 'text1');
      indexer.queueCreate('entity2', 'text2');

      const queue = indexer.getQueue();

      expect(queue).toHaveLength(2);

      // Modifying returned queue should not affect internal queue
      queue.pop();

      expect(indexer.getQueueSize()).toBe(2);
    });
  });

  describe('Options Update', () => {
    it('should update options', () => {
      indexer.updateOptions({ flushThreshold: 10 });

      // Queue more than original threshold but less than new
      for (let i = 0; i < 8; i++) {
        indexer.queueCreate(`entity${i}`, `text${i}`);
      }

      // Should not auto-flush yet (new threshold is 10)
      expect(indexer.getQueueSize()).toBe(8);
    });

    it('should restart timer when interval changes', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      indexer.updateOptions({ flushIntervalMs: 5000 });

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty flush', async () => {
      const result = await indexer.flush();

      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should include timestamps in queued operations', () => {
      const before = Date.now();
      indexer.queueCreate('entity1', 'text');
      const after = Date.now();

      const queue = indexer.getQueue();
      expect(queue[0].queuedAt).toBeGreaterThanOrEqual(before);
      expect(queue[0].queuedAt).toBeLessThanOrEqual(after);
    });

    it('should handle concurrent queue operations', async () => {
      // Use real timers for this test to avoid timer issues
      vi.useRealTimers();

      const concurrentIndexer = new IncrementalIndexer(mockEmbeddingService, mockVectorStore, {
        flushThreshold: 20,
        flushIntervalMs: 60000, // Long interval
      });

      // Queue many operations rapidly
      for (let i = 0; i < 50; i++) {
        concurrentIndexer.queueCreate(`entity${i}`, `text${i}`);
      }

      // Wait for auto-flush to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Due to threshold (20), auto-flush should have been triggered
      expect(mockEmbeddingService.embedBatch).toHaveBeenCalled();

      await concurrentIndexer.shutdown();
      vi.useFakeTimers();
    });
  });

  describe('Progress Callback', () => {
    it('should pass progress callback to embedding service if available', async () => {
      const progressCallback = vi.fn();

      // Create indexer with progress callback
      const indexerWithProgress = new IncrementalIndexer(
        mockEmbeddingService,
        mockVectorStore,
        {
          onProgress: progressCallback,
        }
      );

      // Mock embedBatchWithProgress
      const mockWithProgress = {
        ...mockEmbeddingService,
        embedBatchWithProgress: vi.fn().mockResolvedValue([[0.1], [0.2]]),
      };

      const indexerWithMethod = new IncrementalIndexer(
        mockWithProgress as unknown as EmbeddingService,
        mockVectorStore,
        { onProgress: progressCallback }
      );

      indexerWithMethod.queueCreate('entity1', 'text1');
      await indexerWithMethod.flush();

      expect(mockWithProgress.embedBatchWithProgress).toHaveBeenCalledWith(
        ['text1'],
        'document',
        progressCallback
      );

      await indexerWithProgress.shutdown();
      await indexerWithMethod.shutdown();
    });
  });
});
