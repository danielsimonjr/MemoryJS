/**
 * pagination — offset/limit + next-cursor helpers for REST handlers.
 *
 * Composable utility — handlers parse query params with
 * `parsePaginationParams`, slice their result with `paginate`, and
 * return `{ page, total, nextCursor? }` to the client. Cursor is a
 * stringified next-offset for v1 simplicity; opaque-cursor encoding
 * (HMAC over offset+filters) is a future hardening if drift / scan
 * cost becomes an issue.
 *
 * @module adapters/pagination
 */

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface ParsePaginationOptions {
  /** Cap on `limit`. Default 200. */
  maxLimit?: number;
  /** Default `limit` when none supplied. Default 50. */
  defaultLimit?: number;
}

export interface PaginatedResult<T> {
  page: T[];
  /** Total items in the source array (before slicing). */
  total: number;
  /** Stringified next-offset when more items remain; absent on final page. */
  nextCursor?: string;
}

/**
 * Parse `limit` and `offset` from a query-params record. Garbage input
 * falls back to defaults silently — REST clients shouldn't get a 400
 * for a stray query value. Negative / non-finite numbers are treated
 * as garbage.
 */
export function parsePaginationParams(
  query: Record<string, string | undefined>,
  options: ParsePaginationOptions = {},
): PaginationParams {
  const maxLimit = options.maxLimit ?? 200;
  const defaultLimit = options.defaultLimit ?? 50;

  let limit = defaultLimit;
  const limitRaw = query.limit;
  if (typeof limitRaw === 'string') {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
      limit = Math.min(n, maxLimit);
    }
  }

  let offset = 0;
  const offsetRaw = query.offset;
  if (typeof offsetRaw === 'string') {
    const n = Number(offsetRaw);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      offset = n;
    }
  }

  return { limit, offset };
}

/**
 * Slice `items` into a page. Reports `total` (full-source count) so
 * clients can size their UI. Emits `nextCursor` only when more items
 * remain after the current page.
 */
export function paginate<T>(
  items: readonly T[],
  params: PaginationParams,
): PaginatedResult<T> {
  const total = items.length;
  const start = Math.min(params.offset, total);
  const end = Math.min(start + params.limit, total);
  const page = items.slice(start, end);
  const nextOffset = end;
  const result: PaginatedResult<T> = { page, total };
  if (nextOffset < total) result.nextCursor = String(nextOffset);
  return result;
}
