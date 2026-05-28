/**
 * Utility functions for simple inline validation.
 */

/**
 * Validates that a given value is a non-empty string.
 * Throws an error if the value is not a string or is an empty string after trimming.
 *
 * @param value The value to validate.
 * @param fieldName The name of the field being validated, used in the error message.
 * @param context Optional context name (e.g. 'DecisionManager') to prefix the error message.
 */
export function validateNonEmpty(value: unknown, fieldName: string, context?: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const received =
      typeof value === 'string'
        ? `string of length ${value.length} (${JSON.stringify(value.slice(0, 40))})`
        : `${typeof value} (${value === null ? 'null' : String(value).slice(0, 40)})`;
    const prefix = context ? `${context}: ` : '';
    throw new Error(`${prefix}'${fieldName}' must be a non-empty string; received ${received}`);
  }
}

/**
 * Validates that a given value is a non-empty array.
 * Throws an error if the value is not an array or has length 0.
 *
 * @param value The value to validate.
 * @param fieldName The name of the field being validated, used in the error message.
 * @param context Optional context name (e.g. 'ReflectionManager') to prefix the error message.
 */
export function validateNonEmptyArray(value: unknown, fieldName: string, context?: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    const prefix = context ? `${context}: ` : '';
    throw new Error(`${prefix}'${fieldName}' must be a non-empty array`);
  }
}
