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

export class AsyncMutex {
  private queue: Array<{ resolve: (release: () => void) => void; reject: (err: Error) => void }> = [];
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
   * Rejects if queue is full or timeout is exceeded.
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
      const entry = {
        resolve: (release: () => void) => {
          if (timer) clearTimeout(timer);
          resolve(release);
        },
        reject,
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          reject(new Error(`AsyncMutex acquire timeout (${this.timeoutMs}ms)`));
        }, this.timeoutMs);
      }

      this.queue.push(entry);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.resolve(() => this.release());
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
