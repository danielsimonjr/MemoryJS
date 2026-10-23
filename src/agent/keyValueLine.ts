/**
 * @module agent/keyValueLine
 *
 * Encodes and decodes one observation line of the form
 * `"<JSON key>"=<JSON value>`. Both sides of the `=` are JSON, so a key or
 * value that contains `=`, quotes or newlines survives the round trip.
 *
 * Shared by the observation-encoded stores (session checkpoints, work
 * threads, procedure steps). Each store keeps its own line prefix.
 */

/**
 * Encodes a key and a value as one `"<JSON key>"=<JSON value>` body.
 *
 * When `JSON.stringify(value)` returns `undefined` (for example for an
 * `undefined` or a function value), the result depends on `onUndefined`:
 * - `'literal'`: the body ends with the text `undefined`.
 * - `'skip'`: the function returns `null`. The caller omits the line.
 *
 * @param key - Key, encoded as a JSON string.
 * @param value - Value, encoded as JSON.
 * @param onUndefined - What to do when the value has no JSON form.
 * @returns The encoded body, or `null` when `onUndefined` is `'skip'` and the value has no JSON form.
 */
export function encodeKeyValueBody(key: string, value: unknown, onUndefined: 'literal'): string;
export function encodeKeyValueBody(key: string, value: unknown, onUndefined: 'skip'): string | null;
export function encodeKeyValueBody(
  key: string,
  value: unknown,
  onUndefined: 'skip' | 'literal'
): string | null {
  const json = JSON.stringify(value);
  if (json === undefined && onUndefined === 'skip') return null;
  return `${JSON.stringify(key)}=${String(json)}`;
}

/**
 * Decodes one `"<JSON key>"=<JSON value>` body into a key and a value.
 *
 * The scan finds the key's closing quote. A backslash escapes the next
 * character, so an escaped `"` inside the key does not end the key. The
 * `=` must follow that quote directly.
 *
 * @param body - The line without its observation prefix.
 * @returns The pair `[key, value]` with both sides parsed as JSON, or `null` when the body is malformed or the key is not a string.
 */
export function decodeKeyValueBody(body: string): [string, unknown] | null {
  if (!body.startsWith('"')) return null;
  let i = 1;
  while (i < body.length && body[i] !== '"') {
    i += body[i] === '\\' ? 2 : 1;
  }
  if (i >= body.length || body[i + 1] !== '=') return null;
  try {
    const key: unknown = JSON.parse(body.slice(0, i + 1));
    const value: unknown = JSON.parse(body.slice(i + 2));
    if (typeof key !== 'string') return null;
    return [key, value];
  } catch {
    return null;
  }
}
