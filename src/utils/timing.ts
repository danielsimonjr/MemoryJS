/**
 * Timing Helpers
 *
 * Sleep, timeout and coalescing helpers shared by the utilities and the search layer.
 * This module imports nothing. It is not re-exported from the package barrel.
 *
 * @module utils/timing
 */

/**
 * Resolves after the given number of milliseconds.
 *
 * @param ms - Delay in milliseconds.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a promise that rejects with an Error after a delay.
 * The clear function cancels the pending timer.
 * Call clear when the racing work settles to release the timer.
 * The returned object contains the promise and the clear function.
 *
 * @param ms - Milliseconds to wait before rejecting.
 * @param message - Message of the rejection error.
 * @returns An object with the promise and a clear function.
 */
export function createTimeout<T>(ms: number, message: string): { promise: Promise<T>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

/**
 * Races a work promise against a timeout timer.
 * The timer clears automatically when the race settles.
 * The result settles with the outcome of work if work settles first.
 * The result rejects with an Error whose message is the given message if the timer fires first.
 *
 * @param work - The promise to race against the timeout.
 * @param ms - Maximum time in milliseconds to allow.
 * @param message - Message of the error if the timeout expires.
 * @returns A promise that resolves or rejects based on the race outcome.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  const timeout = createTimeout<never>(ms, message);
  const race = Promise.race([work, timeout.promise]);
  void race.then(timeout.clear, timeout.clear);
  return race;
}

/**
 * Runs a callback once for a burst of schedule requests.
 *
 * The first request opens a window of delayMs. Requests inside the window do nothing,
 * unless runNow is true: then the callback runs at once and the window stays open.
 * The timer is unreferenced, so it does not keep the process alive.
 */
export class CoalescingTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Runs the callback at once when runNow is true. Otherwise opens a window of delayMs.
   * The stored handle clears before the callback runs, so the callback can schedule again.
   *
   * @param delayMs - Window in milliseconds.
   * @param run - Callback to run when the window closes.
   * @param runNow - When true, run at once. A window that is already open stays open.
   */
  schedule(delayMs: number, run: () => void, runNow: boolean): void {
    if (runNow) {
      run();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, delayMs);
    // Do not keep the event loop alive for a coalescing timer.
    this.timer.unref?.();
  }

  /**
   * Clears the open window, if any.
   *
   * @returns True when a window was open and is now cleared.
   */
  cancel(): boolean {
    if (this.timer === null) return false;
    clearTimeout(this.timer);
    this.timer = null;
    return true;
  }
}
