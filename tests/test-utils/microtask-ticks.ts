/**
 * Shared test helper - count the microtask turns until a promise settles
 *
 * Two async functions can return equal values and still settle in a different
 * number of microtask turns. For example, an async method that returns the promise
 * of another async method settles later than a method that awaits the work itself.
 * A test that pins the turn count keeps the settle timing of the code under test.
 *
 * Call it in the same turn as the call under test, before any other await. The
 * count includes the one turn that the helper uses to observe the promise, so only
 * compare counts that come from this helper.
 *
 * @example
 * ```typescript
 * import { microtaskTicks } from '../../test-utils/microtask-ticks.js';
 *
 * it('settles in the same number of turns', async () => {
 *   expect(await microtaskTicks(manager.complete(id))).toBe(3);
 * });
 * ```
 */

/** Upper bound for the count; a promise that needs more turns is treated as hung. */
const MAX_TICKS = 1000;

/** Returns the number of microtask turns before `promise` settles (fulfilled or rejected). */
export async function microtaskTicks(promise: Promise<unknown>): Promise<number> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  let ticks = 0;
  while (!settled) {
    await undefined;
    ticks++;
    if (ticks > MAX_TICKS) {
      throw new Error(`Promise did not settle within ${MAX_TICKS} microtask turns`);
    }
  }
  return ticks;
}
