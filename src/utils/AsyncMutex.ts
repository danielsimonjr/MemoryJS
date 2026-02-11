/**
 * Async Mutex
 *
 * Promise-based mutual exclusion for serializing async operations.
 *
 * @module utils/AsyncMutex
 */

export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the lock. Returns a release function.
   * If the lock is held, waits in a FIFO queue.
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }

    return new Promise<() => void>(resolve => {
      this.queue.push(() => resolve(() => this.release()));
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
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
