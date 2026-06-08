/**
 * Result<T, E> — discriminated-union return type for operations with
 * *expected* domain failures.
 *
 * Per the MemoryJS error-handling policy (see CONTRIBUTING.md > Error
 * Handling):
 * - **throw** for programmer errors — bad arguments, invariant violations,
 *   "this should never happen" states;
 * - **return `Result<T, E>`** for expected, recoverable failures the caller
 *   is meant to branch on (not found, validation failed, conflict, ...);
 * - never swallow an error silently.
 *
 * The discriminant is the `ok` boolean, so call sites narrow with a plain
 * `if (result.ok)` — no type guard import required for the common case.
 *
 * @example
 * ```typescript
 * function parsePort(raw: string): Result<number, string> {
 *   const n = Number(raw);
 *   if (!Number.isInteger(n) || n < 1 || n > 65535) {
 *     return err(`invalid port: ${raw}`);
 *   }
 *   return ok(n);
 * }
 *
 * const r = parsePort(input);
 * if (r.ok) {
 *   listen(r.value);
 * } else {
 *   logger.warn(r.error);
 * }
 * ```
 *
 * @module types/result
 */

/**
 * A value that is either a success (`ok: true` carrying `value`) or a
 * failure (`ok: false` carrying `error`). `E` defaults to `Error`.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a success `Result`. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct a failure `Result`. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard: narrows a `Result` to its success variant. */
export function isOk<T, E>(
  result: Result<T, E>
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Type guard: narrows a `Result` to its failure variant. */
export function isErr<T, E>(
  result: Result<T, E>
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Return the success value, or **throw** the error.
 *
 * Use only when a failure is genuinely unexpected at the call site — i.e.
 * you are deliberately converting a domain `Result` back into a thrown
 * programmer error. A non-`Error` error value is wrapped in an `Error`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error
    ? result.error
    : new Error(String(result.error));
}

/** Return the success value, or `fallback` on failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Map the success value with `fn`, passing failures through unchanged.
 */
export function mapOk<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
