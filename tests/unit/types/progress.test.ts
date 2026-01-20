/**
 * Tests for Progress Types
 *
 * Tests the progress utilities defined in src/types/progress.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createProgressInfo,
  createThrottledProgress,
  createDetailedProgressReporter,
  type ProgressInfo,
  type ProgressInfoCallback,
} from '../../../src/types/progress.js';

describe('createProgressInfo', () => {
  describe('Basic Progress Creation', () => {
    it('should create progress info with current and total', () => {
      const progress = createProgressInfo(5, 10);

      expect(progress.current).toBe(5);
      expect(progress.total).toBe(10);
      expect(progress.percentage).toBe(50);
      expect(progress.message).toBe('Processing 5/10 (50%)');
    });

    it('should calculate percentage correctly', () => {
      expect(createProgressInfo(0, 100).percentage).toBe(0);
      expect(createProgressInfo(25, 100).percentage).toBe(25);
      expect(createProgressInfo(50, 100).percentage).toBe(50);
      expect(createProgressInfo(75, 100).percentage).toBe(75);
      expect(createProgressInfo(100, 100).percentage).toBe(100);
    });

    it('should handle zero total gracefully', () => {
      const progress = createProgressInfo(0, 0);

      expect(progress.percentage).toBe(0);
      expect(progress.current).toBe(0);
      expect(progress.total).toBe(0);
    });

    it('should round percentage to nearest integer', () => {
      const progress = createProgressInfo(1, 3);

      expect(progress.percentage).toBe(33); // 33.33... rounds to 33
    });
  });

  describe('Optional Fields', () => {
    it('should include phase when provided', () => {
      const progress = createProgressInfo(5, 10, { phase: 'indexing' });

      expect(progress.phase).toBe('indexing');
    });

    it('should include currentItem when provided', () => {
      const progress = createProgressInfo(5, 10, { currentItem: 'entity_42' });

      expect(progress.currentItem).toBe('entity_42');
    });

    it('should include custom message when provided', () => {
      const progress = createProgressInfo(5, 10, { message: 'Custom message' });

      expect(progress.message).toBe('Custom message');
    });

    it('should include cancellable flag when provided', () => {
      const progress = createProgressInfo(5, 10, { cancellable: true });
      expect(progress.cancellable).toBe(true);

      const progress2 = createProgressInfo(5, 10, { cancellable: false });
      expect(progress2.cancellable).toBe(false);
    });

    it('should not include cancellable when not specified', () => {
      const progress = createProgressInfo(5, 10, { phase: 'test' });
      expect(progress.cancellable).toBeUndefined();
    });
  });

  describe('Time Estimation', () => {
    it('should calculate estimated remaining time', () => {
      const startedAt = new Date(Date.now() - 5000); // 5 seconds ago
      const progress = createProgressInfo(50, 100, { startedAt });

      // 5000ms for 50 items = 100ms per item
      // 50 remaining items * 100ms = ~5000ms
      expect(progress.estimatedRemainingMs).toBeDefined();
      expect(progress.estimatedRemainingMs).toBeGreaterThan(0);
    });

    it('should include startedAt ISO string', () => {
      const startedAt = new Date('2024-01-15T10:00:00Z');
      const progress = createProgressInfo(5, 10, { startedAt });

      expect(progress.startedAt).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should not estimate time when current is 0', () => {
      const startedAt = new Date(Date.now() - 1000);
      const progress = createProgressInfo(0, 100, { startedAt });

      // When current is 0, we can't estimate time per item
      expect(progress.estimatedRemainingMs).toBeUndefined();
    });
  });

  describe('Combined Options', () => {
    it('should handle all options together', () => {
      const startedAt = new Date(Date.now() - 2000);
      const progress = createProgressInfo(5, 10, {
        phase: 'processing',
        currentItem: 'item_5',
        message: 'Processing items',
        startedAt,
        cancellable: true,
      });

      expect(progress.current).toBe(5);
      expect(progress.total).toBe(10);
      expect(progress.percentage).toBe(50);
      expect(progress.phase).toBe('processing');
      expect(progress.currentItem).toBe('item_5');
      expect(progress.message).toBe('Processing items');
      expect(progress.cancellable).toBe(true);
      expect(progress.startedAt).toBeDefined();
      expect(progress.estimatedRemainingMs).toBeDefined();
    });
  });
});

describe('createThrottledProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should always emit first progress (current === 0)', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback, 100);

    throttled({ current: 0, total: 10, percentage: 0, message: 'Start' });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ current: 0 })
    );
  });

  it('should always emit last progress (current === total)', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback, 100);

    throttled({ current: 10, total: 10, percentage: 100, message: 'Complete' });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ current: 10 })
    );
  });

  it('should throttle intermediate updates', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback, 100);

    // First update
    throttled({ current: 0, total: 10, percentage: 0, message: 'Start' });
    expect(callback).toHaveBeenCalledTimes(1);

    // Rapid intermediate updates (should be throttled)
    throttled({ current: 1, total: 10, percentage: 10, message: '1' });
    throttled({ current: 2, total: 10, percentage: 20, message: '2' });
    throttled({ current: 3, total: 10, percentage: 30, message: '3' });

    // Only the first should have gone through immediately
    expect(callback).toHaveBeenCalledTimes(1);

    // Advance timer past throttle interval
    vi.advanceTimersByTime(100);

    // Now pending update should have flushed
    expect(callback).toHaveBeenCalledTimes(2);
    // Should be the last pending value
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 3 })
    );
  });

  it('should emit updates after interval passes', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback, 100);

    throttled({ current: 0, total: 10, percentage: 0, message: 'Start' });
    expect(callback).toHaveBeenCalledTimes(1);

    // Advance past interval
    vi.advanceTimersByTime(100);

    // Now intermediate update should emit immediately
    throttled({ current: 5, total: 10, percentage: 50, message: '5' });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should use default interval when not specified', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback);

    throttled({ current: 0, total: 10, percentage: 0, message: 'Start' });
    throttled({ current: 1, total: 10, percentage: 10, message: '1' });

    // Only first emitted due to default throttle (100ms)
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should cancel pending timeout when first/last progress received', () => {
    const callback = vi.fn();
    const throttled = createThrottledProgress(callback, 100);

    throttled({ current: 0, total: 10, percentage: 0, message: 'Start' });
    throttled({ current: 5, total: 10, percentage: 50, message: '5' });

    // Pending timeout scheduled
    // Now send final progress
    throttled({ current: 10, total: 10, percentage: 100, message: 'Done' });

    // Both first and last should emit immediately
    expect(callback).toHaveBeenCalledTimes(2);

    // Advance time - no additional calls should happen
    vi.advanceTimersByTime(200);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe('createDetailedProgressReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a reporter with report, complete, cancel methods', () => {
    const reporter = createDetailedProgressReporter(10);

    expect(typeof reporter.report).toBe('function');
    expect(typeof reporter.complete).toBe('function');
    expect(typeof reporter.cancel).toBe('function');
  });

  it('should report progress through callback', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback);

    reporter.report(0);
    reporter.report(5);

    expect(callback).toHaveBeenCalled();
  });

  it('should include phase in progress info', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback, { phase: 'indexing' });

    reporter.report(5);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'indexing' })
    );
  });

  it('should include current item in progress info', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback);

    reporter.report(5, 'entity_5');

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ currentItem: 'entity_5' })
    );
  });

  it('should include cancellable flag in progress info', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback, { cancellable: true });

    reporter.report(5);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ cancellable: true })
    );
  });

  it('should send complete message', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback);

    reporter.complete();

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        current: 10,
        total: 10,
        message: 'Complete',
      })
    );
  });

  it('should stop reporting after cancel', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback);

    reporter.report(0);
    expect(callback).toHaveBeenCalledTimes(1);

    reporter.cancel();

    reporter.report(5);
    reporter.complete();

    // No additional calls after cancel
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should work without callback', () => {
    const reporter = createDetailedProgressReporter(10);

    // Should not throw
    expect(() => {
      reporter.report(5);
      reporter.complete();
    }).not.toThrow();
  });

  it('should respect custom throttle interval', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback, { intervalMs: 50 });

    reporter.report(0);
    reporter.report(1);
    reporter.report(2);

    // Only first should emit immediately
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);

    // Now pending should flush
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should calculate time estimates', () => {
    const callback = vi.fn();
    const reporter = createDetailedProgressReporter(10, callback);

    reporter.report(0);

    // Advance time
    vi.advanceTimersByTime(1000);

    reporter.report(5);

    // Should have estimated remaining time
    const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
    expect(lastCall.startedAt).toBeDefined();
  });
});

describe('ProgressInfo Interface', () => {
  it('should have all required fields', () => {
    const progress: ProgressInfo = {
      current: 5,
      total: 10,
      percentage: 50,
      message: 'Processing',
    };

    expect(progress.current).toBe(5);
    expect(progress.total).toBe(10);
    expect(progress.percentage).toBe(50);
    expect(progress.message).toBe('Processing');
  });

  it('should support all optional fields', () => {
    const progress: ProgressInfo = {
      current: 5,
      total: 10,
      percentage: 50,
      message: 'Processing',
      phase: 'indexing',
      currentItem: 'item_5',
      estimatedRemainingMs: 5000,
      startedAt: '2024-01-15T10:00:00Z',
      cancellable: true,
    };

    expect(progress.phase).toBe('indexing');
    expect(progress.currentItem).toBe('item_5');
    expect(progress.estimatedRemainingMs).toBe(5000);
    expect(progress.startedAt).toBe('2024-01-15T10:00:00Z');
    expect(progress.cancellable).toBe(true);
  });
});
