/**
 * Async Mutex
 *
 * Promise-based mutual exclusion for serializing async operations.
 *
 * **Scope:** one instance coordinates callers inside ONE process. It cannot
 * coordinate a second process that opens the same file.
 *
 * @module utils/AsyncMutex
 */

export interface AsyncMutexOptions {
  /** Maximum queue length before rejecting new acquire calls (default: 1000) */
  maxQueueLength?: number;
  /** Timeout in ms for acquiring the lock (default: 30000). 0 = no timeout. */
  timeoutMs?: number;
}

/** Options for a single {@link AsyncMutex.acquire} call. */
export interface AcquireOptions {
  /**
   * Cancels the request while it waits in the queue. A cancelled request is
   * removed from the queue and never gets the lock. The signal has no effect
   * after the lock is granted: the holder decides when its operation ends.
   */
  signal?: AbortSignal;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * FIFO promise mutex with a bounded queue, a head-of-queue timeout,
 * per-request cancellation and idempotent release functions.
 */
export class AsyncMutex {
  private queue: Array<Waiter> = [];
  private locked = false;
  private readonly maxQueueLength: number;
  private readonly timeoutMs: number;

  constructor(options?: AsyncMutexOptions) {
    this.maxQueueLength = options?.maxQueueLength ?? 1000;
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  /**
   * Acquire the lock. Returns a release function.
   * If the lock is held, waits in a FIFO queue.
   * Rejects if the queue is full, if `options.signal` aborts while the request
   * is queued, or if the waiter spends longer than `timeoutMs` at the HEAD of
   * the queue.
   *
   * The returned release function is idempotent: only its first call releases
   * the lock, so a duplicate call cannot release a later holder's lock.
   *
   * The deadline bounds **one critical section** - the time from becoming next
   * in line to being granted the lock - not the whole drain ahead of the
   * waiter. Arming it at enqueue instead (the behaviour before 2026-09-13) made
   * the effective budget `timeoutMs / queueDepth`, which contradicted this
   * class's own defaults: at `maxQueueLength` 1000 a full queue allowed 30 ms
   * per operation, so a slow CI runner timed out on work that was progressing
   * normally. Per-op cost is flat (~5 ms measured at depths 10-200), so a
   * stalled holder - not a deep queue - is the condition worth reporting.
   */
  async acquire(options?: AcquireOptions): Promise<() => void> {
    const signal = options?.signal;
    if (signal?.aborted) throw abortError();

    if (!this.locked) {
      this.locked = true;
      return this.grant();
    }

    if (this.queue.length >= this.maxQueueLength) {
      throw new Error(`AsyncMutex queue full (max ${this.maxQueueLength})`);
    }

    return new Promise<() => void>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.dequeue(entry)) entry.reject(abortError());
      };
      const entry: Waiter = {
        resolve: (release: () => void) => {
          this.disarm(entry);
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
        reject: (err: Error) => {
          this.disarm(entry);
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(entry);
      this.armHead();
    });
  }

  /**
   * Start the deadline for whoever is next in line, if it is not already
   * running. Called whenever the head changes, so each waiter is timed only
   * for the single critical section it is actually waiting on.
   */
  private armHead(): void {
    if (this.timeoutMs <= 0) return;
    const head = this.queue[0];
    if (!head || head.timer) return;

    head.timer = setTimeout(() => {
      head.timer = undefined;
      // The lock is still held by whoever stalled; dequeue re-arms the next waiter.
      if (this.dequeue(head)) {
        head.reject(new Error(`AsyncMutex acquire timeout (${this.timeoutMs}ms)`));
      }
    }, this.timeoutMs);
  }

  /** Remove a waiter from the queue. Returns false when it already left. */
  private dequeue(entry: Waiter): boolean {
    const idx = this.queue.indexOf(entry);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    if (idx === 0) this.armHead();
    return true;
  }

  private disarm(entry: Waiter): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  /** Create a release function that acts only on its first call. */
  private grant(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve(this.grant());
      this.armHead();
    } else {
      this.locked = false;
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}

function abortError(): Error {
  const err = new Error('AsyncMutex acquire aborted before the lock was granted');
  err.name = 'AbortError';
  return err;
}
