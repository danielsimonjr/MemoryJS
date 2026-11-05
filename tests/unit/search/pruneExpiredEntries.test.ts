/**
 * Unit tests for pruneExpiredEntries (CL-12), used by EmbeddingCache.pruneExpired
 * and QueryPlanCache.cleanup.
 */

import { describe, it, expect } from 'vitest';
import { pruneExpiredEntries } from '../../../src/utils/searchCache.js';

describe('pruneExpiredEntries', () => {
  it('removes only the entries the predicate flags and returns their count', () => {
    const map = new Map<string, { expired: boolean }>([
      ['a', { expired: true }],
      ['b', { expired: false }],
      ['c', { expired: true }],
    ]);

    const removed = pruneExpiredEntries(map, e => e.expired);

    expect(removed).toBe(2);
    expect([...map.keys()]).toEqual(['b']);
  });

  it('keeps the insertion order of the surviving entries', () => {
    const map = new Map<number, number>([
      [3, 0],
      [1, 1],
      [2, 0],
      [4, 1],
    ]);

    pruneExpiredEntries(map, v => v === 0);

    expect([...map.keys()]).toEqual([1, 4]);
  });

  it('returns 0 and leaves the map unchanged when nothing is expired', () => {
    const map = new Map<string, number>([['a', 1]]);
    expect(pruneExpiredEntries(map, () => false)).toBe(0);
    expect([...map.entries()]).toEqual([['a', 1]]);
  });

  it('empties an empty map and returns 0 for an empty map', () => {
    const map = new Map<string, number>();
    expect(pruneExpiredEntries(map, () => true)).toBe(0);
    expect(map.size).toBe(0);
  });

  it('passes each entry value to the predicate', () => {
    const seen: string[] = [];
    const map = new Map<string, string>([
      ['k1', 'v1'],
      ['k2', 'v2'],
    ]);

    pruneExpiredEntries(map, v => {
      seen.push(v);
      return false;
    });

    expect(seen).toEqual(['v1', 'v2']);
  });
});
