/**
 * Shared validation helpers for runtime argument guards.
 *
 * @module utils/validation
 */

/**
 * Assert that a value is a string with at least one non-whitespace character.
 *
 * Throws a plain `Error` with the message
 * `<context>: <label> must be a non-empty string; received <received>`, where
 * `<received>` is the quoted string value (`'value'`) for strings and the
 * `typeof` result otherwise.
 *
 * @param value - Value to check
 * @param label - Argument name shown in the message (e.g. `sessionId`)
 * @param context - Qualified caller name shown as the message prefix (e.g. `ReflectionStage.runOnSessionEnd`)
 * @throws Error when `value` is not a string or is blank after trimming
 */
export function assertNonEmptyString(value: unknown, label: string, context: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `${context}: ${label} must be a non-empty string; received ${
        typeof value === 'string' ? `'${value}'` : typeof value
      }`
    );
  }
}
