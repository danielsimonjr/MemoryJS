/**
 * Operation Utilities Tests
 *
 * Phase 9B: Tests for long-running operation utilities including
 * progress tracking, cancellation, and batch processing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkCancellation,
  createProgressReporter,
  createProgress,
  executeWithPhases,
  processBatchesWithProgress,
} from '../../../src/utils/operationUtils.js';
import { OperationCancelledError } from '../../../src/utils/errors.js';

describe('operationUtils', () => {
  describe('checkCancellation', () => {
    it('should not throw when signal is undefined', () => {
      expect(() => checkCancellation(undefined, 'test')).not.toThrow();
    });

    it('should not throw when signal is not aborted', () => {
      const controller = new AbortController();
      expect(() => checkCancellation(controller.signal, 'test')).not.toThrow();
    });

    it('should throw OperationCancelledError when signal is aborted', () => {
      const controller = new AbortController();
      controller.abort();
      expect(() => checkCancellation(controller.signal, 'test')).toThrow(OperationCancelledError);
    });

    it('should include operation name in error message', () => {
      const controller = new AbortController();
      controller.abort();
      try {
        checkCancellation(controller.signal, 'myOperation');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(OperationCancelledError);
        expect((error as Error).message).toContain('myOperation');
      }
    });

    it('should work without operation name', () => {
      const controller = new AbortController();
      controller.abort();
      expect(() => checkCancellation(controller.signal)).toThrow(OperationCancelledError);
    });
  });

  describe('createProgressReporter', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should return undefined when no callback is provided', () => {
      const reporter = createProgressReporter(undefined);
      expect(reporter).toBeUndefined();
    });

    it('should return a function when callback is provided', () => {
      const callback = vi.fn();
      const reporter = createProgressReporter(callback);
      expect(reporter).toBeInstanceOf(Function);
    });

    it('should call callback for 0% progress', () => {
      const callback = vi.fn();
      const reporter = createProgressReporter(callback, 100);
      reporter!({ completed: 0, total: 100, percentage: 0 });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should call callback for 100% progress', () => {
      const callback = vi.fn();
      const reporter = createProgressReporter(callback, 100);
      reporter!({ completed: 100, total: 100, percentage: 100 });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should throttle intermediate calls', () => {
      const callback = vi.fn();
      const reporter = createProgressReporter(callback, 100);

      // Call multiple times rapidly
      reporter!({ completed: 10, total: 100, percentage: 10 });
      reporter!({ completed: 20, total: 100, percentage: 20 });
      reporter!({ completed: 30, total: 100, percentage: 30 });

      // Only first call should go through immediately
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should allow calls after throttle period', () => {
      const callback = vi.fn();
      const reporter = createProgressReporter(callback, 50);

      reporter!({ completed: 10, total: 100, percentage: 10 });
      expect(callback).toHaveBeenCalledTimes(1);

      // Advance time past throttle
      vi.advanceTimersByTime(60);

      reporter!({ completed: 50, total: 100, percentage: 50 });
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('createProgress', () => {
    it('should create progress object with correct percentage', () => {
      const progress = createProgress(50, 100);
      expect(progress).toEqual({
        completed: 50,
        total: 100,
        percentage: 50,
        currentTaskId: undefined,
      });
    });

    it('should handle zero total', () => {
      const progress = createProgress(0, 0);
      expect(progress.percentage).toBe(0);
    });

    it('should include currentTaskId when provided', () => {
      const progress = createProgress(50, 100, 'processing');
      expect(progress.currentTaskId).toBe('processing');
    });

    it('should round percentage to nearest integer', () => {
      const progress = createProgress(33, 100);
      expect(progress.percentage).toBe(33);

      const progress2 = createProgress(1, 3);
      expect(progress2.percentage).toBe(33);
    });
  });

  describe('executeWithPhases', () => {
    it('should execute all phases in order', async () => {
      const executionOrder: string[] = [];

      const results = await executeWithPhases([
        {
          name: 'phase1',
          weight: 30,
          execute: async () => {
            executionOrder.push('phase1');
            return 'result1';
          },
        },
        {
          name: 'phase2',
          weight: 70,
          execute: async () => {
            executionOrder.push('phase2');
            return 'result2';
          },
        },
      ]);

      expect(executionOrder).toEqual(['phase1', 'phase2']);
      expect(results).toEqual(['result1', 'result2']);
    });

    it('should report progress correctly across phases', async () => {
      const progressUpdates: number[] = [];

      await executeWithPhases(
        [
          {
            name: 'phase1',
            weight: 50,
            execute: async (reportPhaseProgress) => {
              reportPhaseProgress(0);
              reportPhaseProgress(100);
              return null;
            },
          },
          {
            name: 'phase2',
            weight: 50,
            execute: async (reportPhaseProgress) => {
              reportPhaseProgress(0);
              reportPhaseProgress(100);
              return null;
            },
          },
        ],
        (p) => progressUpdates.push(p.percentage)
      );

      // Should include progress at phase boundaries
      expect(progressUpdates).toContain(0);
      expect(progressUpdates).toContain(50);
      expect(progressUpdates).toContain(100);
    });

    it('should throw OperationCancelledError when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        executeWithPhases(
          [
            {
              name: 'phase1',
              weight: 100,
              execute: async () => 'result',
            },
          ],
          undefined,
          controller.signal
        )
      ).rejects.toThrow(OperationCancelledError);
    });

    it('should cancel between phases', async () => {
      const controller = new AbortController();
      const executionOrder: string[] = [];

      const promise = executeWithPhases(
        [
          {
            name: 'phase1',
            weight: 50,
            execute: async () => {
              executionOrder.push('phase1');
              controller.abort();
              return 'result1';
            },
          },
          {
            name: 'phase2',
            weight: 50,
            execute: async () => {
              executionOrder.push('phase2');
              return 'result2';
            },
          },
        ],
        undefined,
        controller.signal
      );

      await expect(promise).rejects.toThrow(OperationCancelledError);
      expect(executionOrder).toEqual(['phase1']);
    });
  });

  describe('processBatchesWithProgress', () => {
    it('should process all items in batches', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const processedBatches: number[][] = [];

      const results = await processBatchesWithProgress(
        items,
        3,
        async (batch) => {
          processedBatches.push(batch);
          return batch.reduce((a, b) => a + b, 0);
        }
      );

      expect(processedBatches).toHaveLength(4);
      expect(processedBatches[0]).toEqual([1, 2, 3]);
      expect(processedBatches[1]).toEqual([4, 5, 6]);
      expect(processedBatches[2]).toEqual([7, 8, 9]);
      expect(processedBatches[3]).toEqual([10]);
      expect(results).toEqual([6, 15, 24, 10]);
    });

    it('should report progress correctly', async () => {
      const items = [1, 2, 3, 4, 5];
      const progressUpdates: number[] = [];

      await processBatchesWithProgress(
        items,
        2,
        async (batch) => batch.length,
        (p) => progressUpdates.push(p.percentage)
      );

      // Should include 0% and 100%
      expect(progressUpdates).toContain(0);
      expect(progressUpdates).toContain(100);
    });

    it('should handle empty items array', async () => {
      const results = await processBatchesWithProgress(
        [],
        10,
        async (batch) => batch.length
      );

      expect(results).toEqual([]);
    });

    it('should throw OperationCancelledError when cancelled', async () => {
      const controller = new AbortController();
      const items = [1, 2, 3, 4, 5];
      let batchCount = 0;

      await expect(
        processBatchesWithProgress(
          items,
          2,
          async (batch) => {
            batchCount++;
            if (batchCount === 2) {
              controller.abort();
            }
            return batch.length;
          },
          undefined,
          controller.signal
        )
      ).rejects.toThrow(OperationCancelledError);
    });

    it('should include operation name in progress', async () => {
      const items = [1, 2, 3];
      let capturedTaskId: string | undefined;

      await processBatchesWithProgress(
        items,
        2,
        async (batch) => batch.length,
        (p) => {
          capturedTaskId = p.currentTaskId;
        },
        undefined,
        'myBatchOp'
      );

      expect(capturedTaskId).toBe('myBatchOp');
    });
  });
});

describe('OperationCancelledError', () => {
  it('should have correct error code', () => {
    const error = new OperationCancelledError('test');
    expect(error.code).toBe('OPERATION_CANCELLED');
  });

  it('should have correct name', () => {
    const error = new OperationCancelledError('test');
    expect(error.name).toBe('OperationCancelledError');
  });

  it('should include operation in message', () => {
    const error = new OperationCancelledError('myOperation');
    expect(error.message).toContain('myOperation');
  });

  it('should have generic message without operation', () => {
    const error = new OperationCancelledError();
    expect(error.message).toBe('Operation was cancelled');
  });
});
