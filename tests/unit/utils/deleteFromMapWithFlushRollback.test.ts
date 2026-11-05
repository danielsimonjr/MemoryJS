/**
 * Unit tests for deleteFromMapWithFlushRollback (CL-9).
 *
 * Covers the success path, the absent-key short circuit (no flush), and the
 * rollback on flush failure, which must restore both the contents and the
 * insertion order of the map.
 */

import { describe, it, expect, vi } from 'vitest';
import { deleteFromMapWithFlushRollback } from '../../../src/utils/mutateMapWithFlushRollback.js';

describe('deleteFromMapWithFlushRollback', () => {
  it('removes the key, flushes the post-delete map and returns true', async () => {
    const cache = new Map<string, number>([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    const flush = vi.fn(async (map: Map<string, number>) => {
      expect([...map.keys()]).toEqual(['a', 'c']);
    });

    const removed = await deleteFromMapWithFlushRollback(cache, 'b', flush);

    expect(removed).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
    expect([...cache.entries()]).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
  });

  it('returns false without flushing when the key is absent', async () => {
    const cache = new Map<string, number>([['a', 1]]);
    const flush = vi.fn(async () => {});

    const removed = await deleteFromMapWithFlushRollback(cache, 'missing', flush);

    expect(removed).toBe(false);
    expect(flush).not.toHaveBeenCalled();
    expect([...cache.entries()]).toEqual([['a', 1]]);
  });

  it('restores contents and insertion order when the flush fails', async () => {
    const cache = new Map<string, number>([
      ['x', 10],
      ['y', 20],
      ['z', 30],
    ]);
    const boom = new Error('disk full');

    await expect(
      deleteFromMapWithFlushRollback(cache, 'y', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect([...cache.entries()]).toEqual([
      ['x', 10],
      ['y', 20],
      ['z', 30],
    ]);
  });

  it('restores the removed key at its original position, not at the end', async () => {
    const cache = new Map<number, string>([
      [1, 'one'],
      [2, 'two'],
      [3, 'three'],
    ]);

    await expect(
      deleteFromMapWithFlushRollback(cache, 1, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    expect([...cache.keys()]).toEqual([1, 2, 3]);
  });
});
