/**
 * Field Path
 *
 * Reads a value from a nested object with a dot-delimited path.
 *
 * @module utils/fieldPath
 */

/**
 * Reads a value from a nested object using a dot-delimited path.
 * The path splits on each dot.
 * A segment of digits reads an array index.
 * Any other segment reads an object key.
 * Returns undefined when a step meets a value that is not a non-null object.
 * An empty path reads the key named by the empty string.
 */
export function getFieldByDotPath(target: unknown, path: string): unknown {
  const parts = path.split('.');
  let value: unknown = target;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      if (/^\d+$/.test(part)) {
        value = (value as unknown[])[parseInt(part, 10)];
      } else {
        value = (value as Record<string, unknown>)[part];
      }
    } else {
      return undefined;
    }
  }

  return value;
}
