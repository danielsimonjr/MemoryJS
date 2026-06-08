/**
 * pagination — offset/limit + next-cursor helpers for REST handlers.
 *
 * Covers:
 * - default limit when none supplied
 * - clamps limit to max
 * - offset slicing
 * - emits nextCursor only when more items remain
 * - parsePaginationParams: missing/invalid params fall back to defaults
 */

import { describe, it, expect } from 'vitest';
import { paginate, parsePaginationParams } from '../../../src/adapters/pagination.js';

describe('parsePaginationParams', () => {
  it('returns defaults when no params supplied', () => {
    expect(parsePaginationParams({})).toEqual({ limit: 50, offset: 0 });
  });

  it('parses numeric limit + offset', () => {
    expect(parsePaginationParams({ limit: '20', offset: '40' })).toEqual({
      limit: 20,
      offset: 40,
    });
  });

  it('falls back to defaults on garbage input', () => {
    expect(parsePaginationParams({ limit: 'banana', offset: '-5' })).toEqual({
      limit: 50,
      offset: 0,
    });
  });

  it('clamps limit to the configured max', () => {
    expect(parsePaginationParams({ limit: '9999' }, { maxLimit: 100 })).toEqual({
      limit: 100,
      offset: 0,
    });
  });
});

describe('paginate', () => {
  it('returns the full list when items fit within the limit', () => {
    const result = paginate([1, 2, 3], { limit: 10, offset: 0 });
    expect(result.page).toEqual([1, 2, 3]);
    expect(result.total).toBe(3);
    expect(result.nextCursor).toBeUndefined();
  });

  it('slices to the limit and emits nextCursor when more remain', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const result = paginate(items, { limit: 20, offset: 0 });
    expect(result.page).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(result.total).toBe(100);
    expect(result.nextCursor).toBe('20');
  });

  it('respects offset', () => {
    const items = [0, 1, 2, 3, 4];
    const result = paginate(items, { limit: 2, offset: 2 });
    expect(result.page).toEqual([2, 3]);
    expect(result.nextCursor).toBe('4');
  });

  it('returns no nextCursor when on the final page', () => {
    const items = [0, 1, 2, 3, 4];
    const result = paginate(items, { limit: 5, offset: 0 });
    expect(result.nextCursor).toBeUndefined();
  });

  it('handles empty input', () => {
    expect(paginate([], { limit: 10, offset: 0 })).toEqual({
      page: [],
      total: 0,
    });
  });
});
