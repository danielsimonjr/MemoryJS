/**
 * Timing Helpers Unit Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTimeout, withTimeout } from '../../../src/utils/timing.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

describe('timing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withTimeout', () => {
    it('resolves with the work value and clears the timer', async () => {
      vi.useFakeTimers();

      const result = await withTimeout(Promise.resolve(7), 1000, 'Timed out');

      expect(result).toBe(7);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects with the given message after the timeout and clears the timer', async () => {
      vi.useFakeTimers();

      const pending = withTimeout(new Promise<number>(() => {}), 50, 'Timed out');
      vi.advanceTimersByTime(50);

      await expect(pending).rejects.toThrow('Timed out');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects with the work error and clears the timer when the work fails first', async () => {
      vi.useFakeTimers();

      await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'Timed out')).rejects.toThrow(
        'boom'
      );
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps a plain value in the race as Promise.race does', async () => {
      vi.useFakeTimers();

      const result = await withTimeout(5 as unknown as Promise<number>, 1000, 'Timed out');

      expect(result).toBe(5);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('settles in the same microtask turns as a bare Promise.race', async () => {
      const bare = await microtaskTicks(Promise.race([Promise.resolve(1), new Promise<never>(() => {})]));
      const wrapped = await microtaskTicks(withTimeout(Promise.resolve(1), 1000, 'Timed out'));

      expect(wrapped).toBe(bare);
    });
  });

  describe('createTimeout', () => {
    it('clear cancels the pending timer', () => {
      vi.useFakeTimers();

      const timeout = createTimeout<never>(100, 'Late');
      timeout.clear();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects with the given message when the delay passes', async () => {
      vi.useFakeTimers();

      const timeout = createTimeout<never>(100, 'Late');
      vi.advanceTimersByTime(100);

      await expect(timeout.promise).rejects.toThrow('Late');
    });
  });
});
