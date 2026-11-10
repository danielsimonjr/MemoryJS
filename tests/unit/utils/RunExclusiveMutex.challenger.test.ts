/**
 * Challenger edge-case pins for `RunExclusiveMutex`.
 *
 * Every expectation in this file was verified differentially against the previous
 * mutex package (0.5.0) on the day it was written: the same scenario was run
 * through both implementations and both observed the same result, including the
 * microtask turn counts (measured with `microtaskTicks`). The package is no
 * longer installed, so the observations are pinned as literals.
 */

import { describe, expect, it, vi } from 'vitest';
import { RunExclusiveMutex } from '../../../src/utils/RunExclusiveMutex.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

/** Flush pending microtasks so queued critical sections get a chance to start. */
async function flushMicrotasks(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('RunExclusiveMutex challenger pins', () => {
  it('stays FIFO when callers queue while earlier sections are still running', async () => {
    const mutex = new RunExclusiveMutex();
    const seen: number[] = [];
    let release: (() => void) | undefined;
    const holding = mutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await flushMicrotasks(5);
    const queued = Array.from({ length: 100 }, (_, index) =>
      mutex.runExclusive(async () => {
        seen.push(index);
        if (index % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        return index;
      })
    );
    release!();
    await Promise.all(queued);
    expect(seen).toEqual(Array.from({ length: 100 }, (_, index) => index));
    await holding;
  });

  it('rejects with a non-Error throw value untouched, and releases', async () => {
    const mutex = new RunExclusiveMutex();
    const sentinel = { code: 42 };
    await expect(
      mutex.runExclusive(() => {
        throw 'plain string';
      })
    ).rejects.toBe('plain string');
    await expect(
      mutex.runExclusive(async () => {
        await undefined;
        throw sentinel;
      })
    ).rejects.toBe(sentinel);
    await expect(mutex.runExclusive(() => 'after')).resolves.toBe('after');
  });

  it('rejects in the same number of microtask turns as the previous mutex', async () => {
    const mutex = new RunExclusiveMutex();
    expect(await microtaskTicks(mutex.runExclusive(() => { throw new Error('sync'); }))).toBe(2);
    expect(
      await microtaskTicks(
        mutex.runExclusive(async () => {
          await undefined;
          throw new Error('async');
        })
      )
    ).toBe(4);
  });

  it('settles a waiter after a throwing section in the same number of turns as the previous mutex', async () => {
    const mutex = new RunExclusiveMutex();
    let release: (() => void) | undefined;
    const holding = mutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await flushMicrotasks(5);
    const failing = mutex.runExclusive(() => {
      throw new Error('section failed');
    });
    const waiter = microtaskTicks(mutex.runExclusive(() => 'ok'));
    release!();
    expect(await waiter).toBe(6);
    await expect(failing).rejects.toThrow('section failed');
    await holding;
  });

  it('a caught section rejection never surfaces as an unhandledRejection', async () => {
    const mutex = new RunExclusiveMutex();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const rejected = mutex.runExclusive(async () => {
        await undefined;
        throw new Error('handled by caller');
      });
      rejected.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('a nested runExclusive runs after the outer section ends, in queue order', async () => {
    const mutex = new RunExclusiveMutex();
    const order: string[] = [];
    let inner: Promise<unknown> | undefined;
    await mutex.runExclusive(async () => {
      order.push('outer-start');
      inner = mutex.runExclusive(() => {
        order.push('inner');
        return 'inner-result';
      });
      await flushMicrotasks(50);
      expect(order).toEqual(['outer-start']);
      order.push('outer-end');
    });
    await expect(inner).resolves.toBe('inner-result');
    expect(order).toEqual(['outer-start', 'outer-end', 'inner']);
  });

  it('an awaited nested runExclusive deadlocks, matching the previous mutex', async () => {
    const mutex = new RunExclusiveMutex();
    let inner: Promise<unknown> | undefined;
    const outer = mutex.runExclusive(async () => {
      inner = mutex.runExclusive(() => 'inner');
      await inner;
    });
    await flushMicrotasks(500);
    let settled = false;
    void outer.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await flushMicrotasks(500);
    expect(settled).toBe(false);
  });

  it('does not retain the waiter chain across 20,000 sequential sections', async () => {
    const mutex = new RunExclusiveMutex();
    for (let i = 0; i < 20_000; i++) await mutex.runExclusive(() => i);
    const gc = globalThis.gc;
    if (typeof gc === 'function') gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20_000; i++) await mutex.runExclusive(() => i);
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
  });

  it('does not arm a timer under contention either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      const mutex = new RunExclusiveMutex();
      let release: (() => void) | undefined;
      const holding = mutex.runExclusive(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      await flushMicrotasks(5);
      const waiter = mutex.runExclusive(() => 'ok');
      let settled = false;
      void waiter.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(settled).toBe(false);
      release!();
      await holding;
      await expect(waiter).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});
