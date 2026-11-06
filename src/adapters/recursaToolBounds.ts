/**
 * Byte-budget helpers of the Recursa tool adapter: every successful result passes through
 * {@link boundResult} unless the tool is exempt (`recursa.learn.next`).
 *
 * @module adapters/recursaToolBounds
 * @experimental Internal to `RecursaToolAdapter`.
 */

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
 * Cut a string to at most `maxBytes` UTF-8 bytes.
 *
 * @param text - Input text.
 * @param maxBytes - Byte budget (negative is treated as zero).
 * @returns The prefix that fits.
 */
function sliceBytes(text: string, maxBytes: number): string {
  const cap = Math.max(0, maxBytes);
  if (Buffer.byteLength(text, 'utf8') <= cap) return text;
  return Buffer.from(text, 'utf8').subarray(0, cap).toString('utf8');
}

/**
 * Shrink a value so its JSON form fits `cap` bytes, keeping its structure where it can. Strings
 * are cut, arrays keep a prefix of their items, and object fields share the budget equally
 * (small fields are kept whole first).
 *
 * @param value - Value to shrink.
 * @param cap - Byte budget.
 * @returns A shrunk copy.
 */
function shrinkTo(value: unknown, cap: number): unknown {
  if (typeof value === 'string') return sliceBytes(value, cap);
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let left = cap;
    for (const item of value) {
      const size = byteSize(item);
      if (size <= left) {
        out.push(item);
        left -= size;
        continue;
      }
      if (left > 64) out.push(shrinkTo(item, left));
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
  let left = Math.max(0, cap);
  order.forEach((field, i) => {
    const share = Math.floor(left / (order.length - i));
    if (field.size <= share) {
      done.set(field.key, field.value);
      left -= field.size;
    } else {
      const shrunk = shrinkTo(field.value, share);
      done.set(field.key, shrunk);
      left -= byteSize(shrunk);
    }
  });
  return Object.fromEntries(keys.map((key) => [key, done.get(key)]));
}

/**
 * Bound a successful result to `maxBytes`. A result that already fits is returned unchanged.
 * Otherwise it is shrunk and marked `truncated: true`; a result that still does not fit becomes a
 * `preview` string.
 *
 * @param value - Result to bound.
 * @param maxBytes - Byte budget.
 * @returns The original value or a truncated copy with a `truncated` marker.
 */
export function boundResult(value: unknown, maxBytes: number): unknown {
  if (byteSize(value) <= maxBytes) return value;
  const cap = Math.max(0, maxBytes - 64);
  const shrunk = shrinkTo(value, cap);
  const marked =
    shrunk !== null && typeof shrunk === 'object' && !Array.isArray(shrunk)
      ? { ...(shrunk as Record<string, unknown>), truncated: true }
      : { value: shrunk, truncated: true };
  if (byteSize(marked) <= maxBytes) return marked;
  return { truncated: true, preview: sliceBytes(JSON.stringify(value) ?? 'null', cap) };
}
