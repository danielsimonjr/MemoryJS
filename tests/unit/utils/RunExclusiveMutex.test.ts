/**
 * Tests for `RunExclusiveMutex`.
 *
 * The pinned expectations below, including the settle-turn counts, were recorded
 * from a differential test against the previous mutex package (0.5.0) while it
 * was still installed. This file no longer imports it: the dependency is gone, so
 * the observations are pinned as literals.
 */

import { describe, expect, it, vi } from 'vitest';
import { RunExclusiveMutex } from '../../../src/utils/RunExclusiveMutex.js';
import { microtaskTicks } from '../../test-utils/microtask-ticks.js';

/** Flush pending microtasks so queued critical sections get a chance to start. */
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('RunExclusiveMutex', () => {
  it('runs critical sections one at a time, in call order', async () => {
    const mutex = new RunExclusiveMutex();
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = mutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = () => {
            order.push(1);
            resolve();
          };
        })
    );
    const second = mutex.runExclusive(async () => {
      order.push(2);
    });
    await flushMicrotasks();
    expect(order).toEqual([]);
    releaseFirst!();
    await first;
    await second;
    expect(order).toEqual([1, 2]);
  });

  it('does not run the callback synchronously while the mutex is free', async () => {
    const mutex = new RunExclusiveMutex();
    let ran = false;
    const promise = mutex.runExclusive(() => {
      ran = true;
      return 'value';
    });
    expect(ran).toBe(false);
    await expect(promise).resolves.toBe('value');
    expect(ran).toBe(true);
  });

  it('passes the callback return value through', async () => {
    const mutex = new RunExclusiveMutex();
    const object = { id: 7 };
    await expect(mutex.runExclusive(() => 42)).resolves.toBe(42);
    await expect(mutex.runExclusive(async () => object)).resolves.toBe(object);
    await expect(mutex.runExclusive(() => undefined)).resolves.toBeUndefined();
  });

  it('releases the mutex when the callback throws synchronously', async () => {
    const mutex = new RunExclusiveMutex();
    await expect(
      mutex.runExclusive(() => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    await expect(mutex.runExclusive(() => 'after')).resolves.toBe('after');
  });

  it('releases the mutex when the callback rejects asynchronously', async () => {
    const mutex = new RunExclusiveMutex();
    await expect(
      mutex.runExclusive(async () => {
        await Promise.resolve();
        throw new Error('async boom');
      })
    ).rejects.toThrow('async boom');
    await expect(mutex.runExclusive(async () => 'after')).resolves.toBe('after');
  });

  it('propagates the callback error to its own caller only', async () => {
    const mutex = new RunExclusiveMutex();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = mutex.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        })
    );
    const failing = mutex.runExclusive(async () => {
      order.push('failing');
      throw new Error('mine');
    });
    const following = mutex.runExclusive(async () => {
      order.push('following');
      return 'ok';
    });

    await flushMicrotasks();
    releaseFirst!();
    await first;
    await expect(failing).rejects.toThrow('mine');
    await expect(following).resolves.toBe('ok');
    expect(order).toEqual(['failing', 'following']);
  });

  it('keeps FIFO order across a long synchronous burst of callers', async () => {
    const mutex = new RunExclusiveMutex();
    const seen: number[] = [];
    const queued = Array.from({ length: 100 }, (_, index) =>
      mutex.runExclusive(() => {
        seen.push(index);
      })
    );
    await Promise.all(queued);
    expect(seen).toEqual(Array.from({ length: 100 }, (_, index) => index));
  });

  it('never runs two critical sections at once under interleaved load', async () => {
    const mutex = new RunExclusiveMutex();
    let active = 0;
    let maxActive = 0;
    const runs = Array.from({ length: 50 }, (_, index) =>
      mutex.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, index % 3));
        active -= 1;
        return index;
      })
    );
    const results = await Promise.all(runs);
    expect(maxActive).toBe(1);
    expect(results).toEqual(Array.from({ length: 50 }, (_, index) => index));
  });

  it('does not arm a timeout timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    try {
      const mutex = new RunExclusiveMutex();
      let releaseFirst: (() => void) | undefined;
      const first = mutex.runExclusive(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
      );
      const second = mutex.runExclusive(async () => 'ok');
      await vi.advanceTimersByTimeAsync(60_000);
      let settled = false;
      void second.then(() => {
        settled = true;
      });
      await flushMicrotasks();
      expect(settled).toBe(false);
      releaseFirst!();
      await first;
      await expect(second).resolves.toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles in the same number of microtask turns as the previous mutex', async () => {
    // Recorded from the previous mutex package with the same helper while it was
    // still installed. Storage code and its tests pin these settle timings, so the
    // swap must not shift them.
    const freeSync = new RunExclusiveMutex();
    expect(await microtaskTicks(freeSync.runExclusive(() => 1))).toBe(3);

    const freeAsync = new RunExclusiveMutex();
    expect(await microtaskTicks(freeAsync.runExclusive(async () => 1))).toBe(3);

    const freeAsyncAwait = new RunExclusiveMutex();
    expect(
      await microtaskTicks(
        freeAsyncAwait.runExclusive(async () => {
          await undefined;
          return 1;
        })
      )
    ).toBe(4);

    const queued = new RunExclusiveMutex();
    let releaseHeld: (() => void) | undefined;
    const holding = queued.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseHeld = resolve;
        })
    );
    await flushMicrotasks();
    const waiter = microtaskTicks(queued.runExclusive(() => 2));
    releaseHeld!();
    expect(await waiter).toBe(5);
    await holding;

    const queuedAwait = new RunExclusiveMutex();
    let releaseHeld2: (() => void) | undefined;
    const holding2 = queuedAwait.runExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseHeld2 = resolve;
        })
    );
    await flushMicrotasks();
    const waiter2 = microtaskTicks(
      queuedAwait.runExclusive(async () => {
        await undefined;
        return 2;
      })
    );
    releaseHeld2!();
    expect(await waiter2).toBe(6);
    await holding2;
  });

  it('does not let a nested runExclusive run before the outer one finishes', async () => {
    const mutex = new RunExclusiveMutex();
    let innerRan = false;
    await mutex.runExclusive(async () => {
      void mutex.runExclusive(() => {
        innerRan = true;
      });
      await flushMicrotasks();
      expect(innerRan).toBe(false);
    });
    await flushMicrotasks(20);
    expect(innerRan).toBe(true);
  });
});
