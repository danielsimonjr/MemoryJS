/**
 * Timing Helpers Unit Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoalescingTimer, createTimeout, sleep, withTimeout } from '../../../src/utils/timing.js';
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

describe('sleep', () => {
  it('resolves after the delay and leaves no timer behind', async () => {
    vi.useFakeTimers();
    let done = false;

    const pending = sleep(100).then(() => {
      done = true;
    });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    await pending;

    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('CoalescingTimer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs at once and opens no window when runNow is true', () => {
    const timer = new CoalescingTimer();
    const run = vi.fn();
    timer.schedule(50, run, true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(timer.cancel()).toBe(false);
  });

  it('runs once when the window closes and coalesces repeat requests', () => {
    vi.useFakeTimers();
    const timer = new CoalescingTimer();
    const run = vi.fn();
    timer.schedule(50, run, false);
    timer.schedule(50, run, false);
    timer.schedule(50, run, false);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('unreferences the window timer', () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const timer = new CoalescingTimer();
    timer.schedule(50, () => undefined, false);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('accepts a new request from inside the callback', () => {
    vi.useFakeTimers();
    const timer = new CoalescingTimer();
    const calls: string[] = [];
    const run = (): void => {
      calls.push('run');
      if (calls.length === 1) timer.schedule(50, run, false);
    };
    timer.schedule(50, run, false);
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(50);
    expect(calls).toHaveLength(2);
  });

  it('cancel clears an open window so the callback does not run', () => {
    vi.useFakeTimers();
    const timer = new CoalescingTimer();
    const run = vi.fn();
    timer.schedule(50, run, false);
    expect(timer.cancel()).toBe(true);
    vi.advanceTimersByTime(50);
    expect(run).not.toHaveBeenCalled();
    expect(timer.cancel()).toBe(false);
  });
});
