/**
 * Byte-budget helpers of the Recursa tool adapter: every successful result passes through
 * {@link boundResult} unless the tool is exempt (`recursa.learn.next`).
 *
 * @module adapters/recursaToolBounds
 * @experimental Internal to `RecursaToolAdapter` and `AmrToolAdapter`.
 */

/** Default byte budget of a bounded tool result. */
export const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * Byte length of the JSON form of a value.
 *
 * @param value - Any JSON-compatible value.
 * @returns UTF-8 byte length.
 */
export function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
}

/**
 * Cut a string to at most `maxBytes` UTF-8 bytes, on a character boundary.
 *
 * @param text - Input text.
 * @param maxBytes - Byte budget (negative is treated as zero).
 * @returns The prefix that fits.
 */
function sliceBytes(text: string, maxBytes: number): string {
  const cap = Math.max(0, maxBytes);
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  const buf = Buffer.from(text, 'utf8');
  // Cut on a character boundary: never keep the first bytes of a cut character.
  let end = cap;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/**
 * Cut a string so that its JSON form (quotes and escapes included) fits `cap` bytes.
 *
 * @param text - Input text.
 * @param cap - Byte budget of the JSON form.
 * @returns The prefix that fits, or `''` when not even the quotes fit.
 */
function sliceJsonString(text: string, cap: number): string {
  let out = sliceBytes(text, cap - 2);
  for (let over = byteSize(out) - cap; over > 0 && out !== ''; over = byteSize(out) - cap) {
    out = sliceBytes(out, Buffer.byteLength(out, 'utf8') - over);
  }
  return out;
}

/**
 * Shrink a value so its JSON form fits `cap` bytes, keeping its structure where it can. Strings
 * are cut, arrays keep a prefix of their items, and object fields share the budget equally
 * (small fields are kept whole first). Brackets, commas, keys and escapes count toward the budget.
 * A value whose bare structure does not fit (for example, many keys) can still exceed `cap`;
 * {@link boundResult} checks the final size.
 *
 * @param value - Value to shrink.
 * @param cap - Byte budget.
 * @returns A shrunk copy.
 */
function shrinkTo(value: unknown, cap: number): unknown {
  if (typeof value === 'string') return sliceJsonString(value, cap);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let left = cap - 2; // the brackets
    for (const item of value) {
      const comma = out.length > 0 ? 1 : 0;
      const size = byteSize(item) + comma;
      if (size <= left) {
        out.push(item);
        left -= size;
        continue;
      }
      if (left - comma > 64) out.push(shrinkTo(item, left - comma));
      break;
    }
    return out;
  }
  if (value !== null && typeof value === 'object') return shrinkObject(value as Record<string, unknown>, cap);
  return value;
}

/**
 * Shrink an object field by field within `cap` bytes, keeping the original key order.
 *
 * @param obj - Object to shrink.
 * @param cap - Byte budget.
 * @returns A shrunk copy with the same keys.
 */
function shrinkObject(obj: Record<string, unknown>, cap: number): Record<string, unknown> {
  const keys = Object.keys(obj);
  const sized = keys.map((key) => ({ key, value: obj[key], size: byteSize(obj[key]) }));
  const order = [...sized].sort((a, b) => a.size - b.size);
  const done = new Map<string, unknown>();
  // The braces, and for each field its key, the colon and the comma.
  const frame = 2 + keys.reduce((sum, key, i) => sum + byteSize(key) + 1 + (i > 0 ? 1 : 0), 0);
  let left = Math.max(0, cap - frame);
  order.forEach((field, i) => {
    const share = Math.floor(left / (order.length - i));
    if (field.size <= share) {
      done.set(field.key, field.value);
      left -= field.size;
    } else {
      const shrunk = shrinkTo(field.value, share);
      done.set(field.key, shrunk);
      left = Math.max(0, left - byteSize(shrunk));
    }
  });
  return Object.fromEntries(keys.map((key) => [key, done.get(key)]));
}

/**
 * Bound a successful result to `maxBytes`. A result that already fits is returned unchanged.
 * Otherwise it is shrunk and marked `truncated: true`; a result that still does not fit becomes a
 * `preview` string. The returned JSON never exceeds `maxBytes` when `maxBytes` is at least 64.
 *
 * @param value - Result to bound.
 * @param maxBytes - Byte budget.
 * @returns The original value or a truncated copy with a `truncated` marker.
 */
export function boundResult(value: unknown, maxBytes: number): unknown {
  if (byteSize(value) <= maxBytes) return value;
  let cap = Math.max(0, maxBytes - 64);
  // A shrunk value can still exceed its cap (keys of a wide object); retry with a smaller cap.
  for (let round = 0; round < 4 && cap > 0; round++) {
    const shrunk = shrinkTo(value, cap);
    const marked =
      shrunk !== null && typeof shrunk === 'object' && !Array.isArray(shrunk)
        ? { ...(shrunk as Record<string, unknown>), truncated: true }
        : { value: shrunk, truncated: true };
    const over = byteSize(marked) - maxBytes;
    if (over <= 0) return marked;
    cap -= over;
  }
  return { truncated: true, preview: sliceJsonString(JSON.stringify(value) ?? 'null', Math.max(0, maxBytes - 64)) };
}
