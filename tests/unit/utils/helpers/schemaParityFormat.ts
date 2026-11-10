/**
 * Canonical encoding shared by the Zod parity recorder and its replay test.
 *
 * A `safeParse` result is compared as a JSON string so that object key order,
 * which Zod's `.strip()` and default-application preserve, is part of the
 * contract. Values JSON cannot carry (`undefined`, `NaN`, `Infinity`,
 * `-Infinity`, bigint, symbol, function) are tagged so the encoding stays
 * lossless.
 *
 * This module imports nothing, so both the recorder (which still imports Zod
 * while the fixture is produced) and the test (which imports the in-repo
 * replacement) can use it.
 */

/** Fields of a normalized issue, in the order they are emitted. */
const ISSUE_FIELDS = [
  'code',
  'path',
  'message',
  'expected',
  'received',
  'origin',
  'inclusive',
  'exact',
  'minimum',
  'maximum',
  'values',
  'keys',
  'options',
  'discriminator',
  'note',
  'pattern',
  'format',
  'errors',
] as const;

/**
 * Encode a parsed value as a JSON-safe structure, preserving key order.
 *
 * @param value - Value produced by `safeParse`.
 * @returns A JSON-serializable equivalent.
 */
export function encodeValue(value: unknown): unknown {
  if (value === undefined) return { $encoded: 'undefined' };
  if (value === null) return null;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $encoded: 'NaN' };
    if (value === Infinity) return { $encoded: 'Infinity' };
    if (value === -Infinity) return { $encoded: '-Infinity' };
    if (Object.is(value, -0)) return { $encoded: '-0' };
    return value;
  }
  if (typeof value === 'bigint') return { $encoded: `bigint:${value.toString()}` };
  if (typeof value === 'symbol') return { $encoded: `symbol:${String(value)}` };
  if (typeof value === 'function') return { $encoded: 'function' };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = encodeValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Normalize a list of Zod issues to the fields the parity claim covers.
 *
 * @param issues - Issues from a `ZodError` (Zod's or the replacement's).
 * @returns Plain objects with a stable field order.
 */
export function normalizeIssues(issues: readonly unknown[]): unknown[] {
  return issues.map((raw) => {
    const issue = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of ISSUE_FIELDS) {
      const value = issue[field];
      if (value === undefined) continue;
      if (field === 'errors' && Array.isArray(value)) {
        out.errors = value.map((branch) => normalizeIssues(branch as readonly unknown[]));
        continue;
      }
      out[field] = field === 'path' && Array.isArray(value) ? [...value] : value;
    }
    return out;
  });
}

/**
 * JSON text of a normalized result, for direct string comparison.
 *
 * @param result - `{ ok, data }` or `{ ok, issues }`.
 * @returns Stable JSON.
 */
export function stringifyResult(result: unknown): string {
  return JSON.stringify(result);
}
