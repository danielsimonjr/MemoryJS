import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsyncMutex } from '../../../src/utils/AsyncMutex.js';

describe('AsyncMutex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default values', () => {
    const mutex = new AsyncMutex();
    expect(mutex.isLocked).toBe(false);
    expect(mutex.queueLength).toBe(0);
  });

  it('should acquire lock and update isLocked', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);
    release();
    expect(mutex.isLocked).toBe(false);
  });

  it('should enforce mutual exclusion', async () => {
    const mutex = new AsyncMutex();
    const executionOrder: number[] = [];

    const task1 = async () => {
      const release = await mutex.acquire();
      executionOrder.push(1);
      await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate async work
      executionOrder.push(2);
      release();
    };

    const task2 = async () => {
      const release = await mutex.acquire();
      executionOrder.push(3);
      release();
    };

    const p1 = task1();
    const p2 = task2();

    // Fast-forward timers to resolve the async wait
    await vi.runAllTimersAsync();

    await Promise.all([p1, p2]);

    expect(executionOrder).toEqual([1, 2, 3]);
    expect(mutex.isLocked).toBe(false);
  });

  it('should reject when maxQueueLength is exceeded', async () => {
    const mutex = new AsyncMutex({ maxQueueLength: 2, timeoutMs: 0 });

    // Acquire the lock
    const release = await mutex.acquire();

    // Queue 2 more items (reaches maxQueueLength)
    const p1 = mutex.acquire();
    const p2 = mutex.acquire();

    expect(mutex.queueLength).toBe(2);

    // 3rd queued item should reject
    await expect(mutex.acquire()).rejects.toThrow('AsyncMutex queue full (max 2)');

    release();
    const release1 = await p1;
    release1();
    const release2 = await p2;
    release2();
  });

  it('should timeout if lock is not acquired within timeoutMs', async () => {
    const mutex = new AsyncMutex({ timeoutMs: 50 });

    // Acquire the lock
    const release = await mutex.acquire();

    // Attempt to acquire again, which will wait in the queue.
    // We attach a catch to handle the rejection gracefully.
    let error: Error | undefined;
    const p1 = mutex.acquire().catch(e => {
        error = e;
    });

    // Fast-forward timers by 50ms
    await vi.advanceTimersByTimeAsync(50);

    // Ensure the awaited promise resolved with catching the error
    await p1;

    // The queued acquire should reject
    expect(error?.message).toBe('AsyncMutex acquire timeout (50ms)');

    // The queue should be empty because the rejected item was removed
    expect(mutex.queueLength).toBe(0);

    release();
  });

  it('should not timeout if timeoutMs is 0', async () => {
    const mutex = new AsyncMutex({ timeoutMs: 0 });

    // Acquire the lock
    const release = await mutex.acquire();

    // Attempt to acquire again, which will wait in the queue
    let acquired = false;
    const p1 = mutex.acquire().then((rel) => {
      acquired = true;
      rel();
    });

    // Fast-forward timers significantly
    await vi.advanceTimersByTimeAsync(100000);

    // Should still not be acquired, and still in queue
    expect(acquired).toBe(false);
    expect(mutex.queueLength).toBe(1);

    release();
    await vi.runAllTimersAsync();
    await p1;

    expect(acquired).toBe(true);
  });
});
