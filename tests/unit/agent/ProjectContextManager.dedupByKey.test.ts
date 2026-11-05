/**
 * Direct tests for `dedupByKey` (CL-7). Last item wins for a key, while the
 * key keeps the position of its first occurrence (Map insertion semantics).
 */

import { describe, it, expect } from 'vitest';
import { dedupByKey } from '../../../src/agent/ProjectContextManager.js';

interface Item {
  key: string;
  value: number;
}

const keyOf = (item: Item): string => item.key;

describe('dedupByKey (CL-7)', () => {
  it('returns an empty array for empty input', () => {
    expect(dedupByKey<Item>([], keyOf)).toEqual([]);
  });

  it('keeps distinct items in input order', () => {
    const items: Item[] = [{ key: 'b', value: 1 }, { key: 'a', value: 2 }];
    expect(dedupByKey(items, keyOf)).toEqual(items);
  });

  it('keeps the last item for a duplicate key', () => {
    const result = dedupByKey<Item>(
      [{ key: 'a', value: 1 }, { key: 'a', value: 2 }],
      keyOf,
    );
    expect(result).toEqual([{ key: 'a', value: 2 }]);
  });

  it('places a duplicated key at its first-occurrence position', () => {
    const result = dedupByKey<Item>(
      [
        { key: 'x', value: 1 },
        { key: 'y', value: 2 },
        { key: 'x', value: 3 },
        { key: 'z', value: 4 },
      ],
      keyOf,
    );
    expect(result).toEqual([
      { key: 'x', value: 3 },
      { key: 'y', value: 2 },
      { key: 'z', value: 4 },
    ]);
  });

  it('does not mutate the input array', () => {
    const items: Item[] = [{ key: 'a', value: 1 }, { key: 'a', value: 2 }];
    const snapshot = [...items];
    dedupByKey(items, keyOf);
    expect(items).toEqual(snapshot);
    expect(items).toHaveLength(2);
  });

  it('uses exact key equality (case-sensitive)', () => {
    const result = dedupByKey<Item>(
      [{ key: 'A', value: 1 }, { key: 'a', value: 2 }],
      keyOf,
    );
    expect(result).toHaveLength(2);
  });
});
