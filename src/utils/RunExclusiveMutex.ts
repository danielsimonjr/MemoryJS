/**
 * FIFO mutex whose `runExclusive` has no timeout and no queue cap.
 *
 * The release happens in a `finally`, so a throw or a rejection frees the next
 * waiter, the callback's return value passes through, and a waiter settles in
 * the same number of microtask turns as the previous mutex (pinned in
 * `tests/unit/utils/RunExclusiveMutex.test.ts`), so callers and their tests
 * cannot observe the swap. It is not reentrant: a nested `runExclusive` on the
 * same instance waits for the outer section to finish.
 *
 * This is deliberately separate from {@link AsyncMutex}, which bounds the queue
 * and times out a waiter that stalls at the head. Storage writers depend on the
 * unbounded behavior, so they use this class.
 *
 * @module utils/RunExclusiveMutex
 */

export class RunExclusiveMutex {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run `fn` with the mutex held and resolve with its result.
   *
   * Callers run one at a time in call order. A throw or rejection from `fn`
   * releases the mutex and rejects the caller's own promise without affecting
   * later waiters.
   */
  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return (async () => {
      await previous;
      try {
        return await fn();
      } finally {
        release();
      }
    })();
  }
}
