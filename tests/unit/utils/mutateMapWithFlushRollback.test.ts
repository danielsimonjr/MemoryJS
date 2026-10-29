import { describe, expect, it, vi } from 'vitest';
import { mutateMapWithFlushRollback } from '../../../src/utils/mutateMapWithFlushRollback.js';

describe('mutateMapWithFlushRollback', () => {
  it('keeps the new value when flush succeeds', async () => {
    const cache = new Map<string, number>([['a', 1]]);
    await mutateMapWithFlushRollback(cache, 'b', 2, async () => undefined);
    expect([...cache.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('deletes a new key when flush fails', async () => {
    const cache = new Map<string, number>([['a', 1]]);
    const flush = vi.fn(async () => {
      throw new Error('disk full');
    });
    await expect(mutateMapWithFlushRollback(cache, 'b', 2, flush)).rejects.toThrow(/disk full/);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
  });

  it('restores the prior value when flush fails on an existing key', async () => {
    const cache = new Map<string, number>([['a', 1]]);
    await expect(
      mutateMapWithFlushRollback(cache, 'a', 99, async () => {
        throw new Error('flush failed');
      }),
    ).rejects.toThrow(/flush failed/);
    expect(cache.get('a')).toBe(1);
  });
});
