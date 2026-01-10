/**
 * BatchProcessor Unit Tests
 *
 * Phase 12 Sprint 2: Tests for generic batch processing utility.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BatchProcessor,
  processBatch,
  processWithRetry,
  chunkArray,
  parallelLimit,
  mapParallel,
  filterParallel,
  type BatchProgress,
  type BatchProcessResult,
} from '../../../src/utils/BatchProcessor.js';

describe('BatchProcessor', () => {
  describe('Basic Processing', () => {
    it('should process all items successfully', async () => {
      const processor = new BatchProcessor<number, number>();
      const items = [1, 2, 3, 4, 5];

      const result = await processor.process(items, async (item) => item * 2);

      expect(result.succeeded).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.allSucceeded).toBe(true);
      expect(result.results.map(r => r.result)).toEqual([2, 4, 6, 8, 10]);
    });

    it('should preserve order of results', async () => {
      const processor = new BatchProcessor<number, number>({ concurrency: 2 });
      const items = [1, 2, 3, 4, 5];

      // Add random delays to test ordering
      const result = await processor.process(items, async (item) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        return item * 2;
      });

      expect(result.results.map(r => r.index)).toEqual([0, 1, 2, 3, 4]);
      expect(result.results.map(r => r.result)).toEqual([2, 4, 6, 8, 10]);
    });

    it('should track processing duration', async () => {
      const processor = new BatchProcessor<number, number>();

      const result = await processor.process([1], async (item) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return item;
      });

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(50);
      expect(result.results[0].durationMs).toBeGreaterThanOrEqual(50);
    });

    it('should handle empty array', async () => {
      const processor = new BatchProcessor<number, number>();

      const result = await processor.process([], async (item) => item);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.allSucceeded).toBe(true);
      expect(result.results).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should continue processing on error by default', async () => {
      const processor = new BatchProcessor<number, number>();
      const items = [1, 2, 3, 4, 5];

      const result = await processor.process(items, async (item) => {
        if (item === 3) throw new Error('Item 3 failed');
        return item * 2;
      });

      expect(result.succeeded).toBe(4);
      expect(result.failed).toBe(1);
      expect(result.allSucceeded).toBe(false);
      expect(result.errors.has(2)).toBe(true); // Index 2 (item 3) failed
    });

    it('should stop on error when configured', async () => {
      const processor = new BatchProcessor<number, number>({
        continueOnError: false,
        concurrency: 1,
      });
      const items = [1, 2, 3, 4, 5];

      const result = await processor.process(items, async (item) => {
        if (item === 3) throw new Error('Item 3 failed');
        return item * 2;
      });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      // Items 4 and 5 were not processed
      expect(result.results[3]).toBeUndefined();
      expect(result.results[4]).toBeUndefined();
    });

    it('should collect errors with index mapping', async () => {
      const processor = new BatchProcessor<number, number>();
      const items = [1, 2, 3, 4, 5];

      const result = await processor.process(items, async (item, index) => {
        if (index === 1 || index === 3) throw new Error(`Failed at ${index}`);
        return item;
      });

      expect(result.errors.size).toBe(2);
      expect(result.errors.get(1)?.message).toBe('Failed at 1');
      expect(result.errors.get(3)?.message).toBe('Failed at 3');
    });

    it('should convert non-Error throws to Error', async () => {
      const processor = new BatchProcessor<number, number>();

      const result = await processor.process([1], async () => {
        throw 'string error';
      });

      expect(result.errors.get(0)).toBeInstanceOf(Error);
      expect(result.errors.get(0)?.message).toBe('string error');
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed items', async () => {
      const processor = new BatchProcessor<number, number>({
        maxRetries: 2,
        retryDelayMs: 10,
      });
      let attempts = 0;

      const result = await processor.process([1], async () => {
        attempts++;
        if (attempts < 2) throw new Error('Retry me');
        return 42;
      });

      expect(result.succeeded).toBe(1);
      expect(result.results[0].attempts).toBe(2);
    });

    it('should fail after max retries', async () => {
      const processor = new BatchProcessor<number, number>({
        maxRetries: 2,
        retryDelayMs: 10,
      });
      const processorFn = vi.fn().mockRejectedValue(new Error('Always fails'));

      const result = await processor.process([1], processorFn);

      expect(result.failed).toBe(1);
      expect(result.results[0].attempts).toBe(3); // Initial + 2 retries
      expect(processorFn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const processor = new BatchProcessor<number, number>({
        maxRetries: 2,
        retryDelayMs: 50,
        retryBackoffMultiplier: 2,
      });

      let attempts = 0;
      const timestamps: number[] = [];

      const result = await processor.process([1], async () => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts < 3) throw new Error('Retry me');
        return 42;
      });

      // Check delays increase (roughly)
      const delay1 = timestamps[1] - timestamps[0];
      const delay2 = timestamps[2] - timestamps[1];

      expect(delay1).toBeGreaterThanOrEqual(40); // ~50ms
      expect(delay2).toBeGreaterThanOrEqual(80); // ~100ms (50 * 2)
    });

    it('should respect max retry delay', async () => {
      const processor = new BatchProcessor<number, number>({
        maxRetries: 3,
        retryDelayMs: 100,
        retryBackoffMultiplier: 10,
        maxRetryDelayMs: 150,
      });

      let attempts = 0;
      const timestamps: number[] = [];

      await processor.process([1], async () => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts < 4) throw new Error('Retry me');
        return 42;
      });

      // Third delay should be capped at 150ms, not 1000ms
      const delay3 = timestamps[3] - timestamps[2];
      expect(delay3).toBeLessThanOrEqual(200); // Some tolerance
    });
  });

  describe('Progress Callbacks', () => {
    it('should call progress callback', async () => {
      const onProgress = vi.fn();
      const processor = new BatchProcessor<number, number>({
        batchSize: 2,
        onProgress,
      });

      await processor.process([1, 2, 3, 4, 5], async (item) => item);

      expect(onProgress).toHaveBeenCalled();
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
      expect(lastCall.completed).toBe(5);
      expect(lastCall.total).toBe(5);
      expect(lastCall.percentage).toBe(100);
    });

    it('should report correct progress values', async () => {
      const progressReports: BatchProgress[] = [];
      const processor = new BatchProcessor<number, number>({
        batchSize: 2,
        concurrency: 2,
        onProgress: (p) => progressReports.push({ ...p }),
      });

      await processor.process([1, 2, 3, 4, 5], async (item) => item);

      expect(progressReports.length).toBeGreaterThan(0);
      expect(progressReports[progressReports.length - 1].succeeded).toBe(5);
      expect(progressReports[progressReports.length - 1].failed).toBe(0);
    });

    it('should track batch index', async () => {
      const progressReports: BatchProgress[] = [];
      const processor = new BatchProcessor<number, number>({
        batchSize: 2,
        concurrency: 2,
        onProgress: (p) => progressReports.push({ ...p }),
      });

      await processor.process([1, 2, 3, 4, 5], async (item) => item);

      // Should have reports for batches 0, 1, 2
      expect(progressReports.some(p => p.batchIndex === 0)).toBe(true);
      expect(progressReports.some(p => p.batchIndex === 1)).toBe(true);
      expect(progressReports.some(p => p.batchIndex === 2)).toBe(true);
    });
  });

  describe('Timeout', () => {
    it('should timeout slow items', async () => {
      const processor = new BatchProcessor<number, number>({
        itemTimeoutMs: 50,
      });

      const result = await processor.process([1], async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 42;
      });

      expect(result.failed).toBe(1);
      expect(result.errors.get(0)?.message).toContain('timeout');
    }, 10000);

    it('should not timeout fast items', async () => {
      const processor = new BatchProcessor<number, number>({
        itemTimeoutMs: 1000,
      });

      const result = await processor.process([1], async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 42;
      });

      expect(result.succeeded).toBe(1);
    });
  });

  describe('Cancellation', () => {
    it('should abort on signal', async () => {
      const controller = new AbortController();
      const processor = new BatchProcessor<number, number>({
        signal: controller.signal,
        concurrency: 1,
      });

      // Abort after first item starts
      const processPromise = processor.process([1, 2, 3, 4, 5], async (item) => {
        if (item === 2) controller.abort();
        return item;
      });

      await expect(processPromise).rejects.toThrow('cancelled');
    });

    it('should mark item as cancelled on abort during retry', async () => {
      const controller = new AbortController();
      const processor = new BatchProcessor<number, number>({
        signal: controller.signal,
        maxRetries: 5,
        retryDelayMs: 100,
      });

      let attempts = 0;
      const result = await processor.process([1], async () => {
        attempts++;
        if (attempts === 2) controller.abort();
        throw new Error('Keep retrying');
      });

      // Item should be marked as failed with cancelled error
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error?.message).toContain('cancelled');
    });
  });

  describe('Concurrency', () => {
    it('should respect concurrency limit', async () => {
      const processor = new BatchProcessor<number, number>({
        concurrency: 2,
      });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      await processor.process([1, 2, 3, 4, 5], async (item) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(resolve => setTimeout(resolve, 50));
        currentConcurrent--;
        return item;
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should process faster with higher concurrency', async () => {
      const items = [1, 2, 3, 4];
      const delay = 50;

      // Sequential
      const seqProcessor = new BatchProcessor<number, number>({ concurrency: 1 });
      const seqStart = Date.now();
      await seqProcessor.process(items, async (item) => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return item;
      });
      const seqTime = Date.now() - seqStart;

      // Parallel
      const parProcessor = new BatchProcessor<number, number>({ concurrency: 4 });
      const parStart = Date.now();
      await parProcessor.process(items, async (item) => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return item;
      });
      const parTime = Date.now() - parStart;

      // Parallel should be significantly faster
      expect(parTime).toBeLessThan(seqTime);
    });
  });

  describe('getOptions', () => {
    it('should return configured options', () => {
      const processor = new BatchProcessor<number, number>({
        concurrency: 8,
        maxRetries: 5,
      });

      const options = processor.getOptions();

      expect(options.concurrency).toBe(8);
      expect(options.maxRetries).toBe(5);
    });
  });
});

describe('Convenience Functions', () => {
  describe('processBatch', () => {
    it('should process items with options', async () => {
      const result = await processBatch(
        [1, 2, 3],
        async (item) => item * 2,
        { concurrency: 2 }
      );

      expect(result.succeeded).toBe(3);
      expect(result.results.map(r => r.result)).toEqual([2, 4, 6]);
    });
  });

  describe('processWithRetry', () => {
    it('should retry with progress callback', async () => {
      const progressCalls: BatchProgress[] = [];
      let attempt = 0;

      const result = await processWithRetry(
        [1],
        async () => {
          attempt++;
          if (attempt < 2) throw new Error('Retry');
          return 42;
        },
        3,
        (p) => progressCalls.push({ ...p })
      );

      expect(result.succeeded).toBe(1);
      expect(result.results[0].attempts).toBe(2);
    });
  });

  describe('chunkArray', () => {
    it('should chunk array evenly', () => {
      const result = chunkArray([1, 2, 3, 4], 2);

      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it('should handle uneven chunks', () => {
      const result = chunkArray([1, 2, 3, 4, 5], 2);

      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should handle single item chunks', () => {
      const result = chunkArray([1, 2, 3], 1);

      expect(result).toEqual([[1], [2], [3]]);
    });

    it('should handle chunk larger than array', () => {
      const result = chunkArray([1, 2], 5);

      expect(result).toEqual([[1, 2]]);
    });

    it('should throw on invalid chunk size', () => {
      expect(() => chunkArray([1, 2], 0)).toThrow('Chunk size must be greater than 0');
      expect(() => chunkArray([1, 2], -1)).toThrow('Chunk size must be greater than 0');
    });
  });

  describe('parallelLimit', () => {
    it('should execute tasks with concurrency limit', async () => {
      const tasks = [
        () => Promise.resolve(1),
        () => Promise.resolve(2),
        () => Promise.resolve(3),
      ];

      const results = await parallelLimit(tasks, 2);

      expect(results.filter(r => r.success).map(r => (r as any).value)).toEqual([1, 2, 3]);
    });

    it('should capture errors', async () => {
      const tasks = [
        () => Promise.resolve(1),
        () => Promise.reject(new Error('Failed')),
        () => Promise.resolve(3),
      ];

      const results = await parallelLimit(tasks, 2);

      expect(results[0]).toEqual({ success: true, value: 1 });
      expect(results[1].success).toBe(false);
      expect((results[1] as any).error.message).toBe('Failed');
      expect(results[2]).toEqual({ success: true, value: 3 });
    });
  });

  describe('mapParallel', () => {
    it('should map items in parallel', async () => {
      const results = await mapParallel(
        [1, 2, 3, 4, 5],
        async (item) => item * 2,
        2
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    it('should preserve order', async () => {
      const results = await mapParallel(
        [5, 4, 3, 2, 1],
        async (item) => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return item * 2;
        },
        3
      );

      expect(results).toEqual([10, 8, 6, 4, 2]);
    });

    it('should pass index to mapper', async () => {
      const results = await mapParallel(
        ['a', 'b', 'c'],
        async (item, index) => `${item}${index}`,
        2
      );

      expect(results).toEqual(['a0', 'b1', 'c2']);
    });
  });

  describe('filterParallel', () => {
    it('should filter items in parallel', async () => {
      const results = await filterParallel(
        [1, 2, 3, 4, 5],
        async (item) => item % 2 === 0,
        2
      );

      expect(results).toEqual([2, 4]);
    });

    it('should preserve order', async () => {
      const results = await filterParallel(
        [1, 2, 3, 4, 5, 6],
        async (item) => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return item > 3;
        },
        3
      );

      expect(results).toEqual([4, 5, 6]);
    });

    it('should pass index to predicate', async () => {
      const results = await filterParallel(
        ['a', 'b', 'c', 'd'],
        async (item, index) => index % 2 === 0,
        2
      );

      expect(results).toEqual(['a', 'c']);
    });
  });
});
