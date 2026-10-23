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
