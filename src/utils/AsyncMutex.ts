/**
 * Async Mutex
 *
 * Promise-based mutual exclusion for serializing async operations.
 *
 * @module utils/AsyncMutex
 */

export interface AsyncMutexOptions {
  /** Maximum queue length before rejecting new acquire calls (default: 1000) */
  maxQueueLength?: number;
  /** Timeout in ms for acquiring the lock (default: 30000). 0 = no timeout. */
  timeoutMs?: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

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
   * Rejects if the queue is full, or if the waiter spends longer than
   * `timeoutMs` at the HEAD of the queue.
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
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueueLength) {
      throw new Error(`AsyncMutex queue full (max ${this.maxQueueLength})`);
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: Waiter = {
        resolve: (release: () => void) => {
          this.disarm(entry);
          resolve(release);
        },
        reject: (err: Error) => {
          this.disarm(entry);
          reject(err);
        },
      };

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
      const idx = this.queue.indexOf(head);
      if (idx !== -1) this.queue.splice(idx, 1);
      head.reject(new Error(`AsyncMutex acquire timeout (${this.timeoutMs}ms)`));
      // The lock is still held by whoever stalled; the next waiter now leads.
      this.armHead();
    }, this.timeoutMs);
  }

  private disarm(entry: Waiter): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve(() => this.release());
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
