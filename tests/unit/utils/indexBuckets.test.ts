/**
 * Unit tests for the Set-bucket helpers (CL-11): addToSetBucket and removeFromSetBucket.
 * TypeIndex and RefIndex both depend on them, so their bucket-removal behaviour is
 * checked here as well.
 */

import { describe, it, expect } from 'vitest';
import {
  addToSetBucket,
  removeFromSetBucket,
  TypeIndex,
} from '../../../src/utils/indexes.js';
import { RefIndex } from '../../../src/core/RefIndex.js';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('addToSetBucket', () => {
  it('creates the bucket on first add and appends to it afterwards', () => {
    const map = new Map<string, Set<number>>();

    addToSetBucket(map, 'k', 1);
    addToSetBucket(map, 'k', 2);
    addToSetBucket(map, 'k', 1);

    expect([...map.get('k')!]).toEqual([1, 2]);
    expect(map.size).toBe(1);
  });

  it('keeps insertion order of the keys', () => {
    const map = new Map<string, Set<string>>();
    addToSetBucket(map, 'b', 'x');
    addToSetBucket(map, 'a', 'x');
    expect([...map.keys()]).toEqual(['b', 'a']);
  });
});

describe('removeFromSetBucket', () => {
  it('removes only the given value and keeps a non-empty bucket', () => {
    const map = new Map<string, Set<string>>([['k', new Set(['x', 'y'])]]);

    removeFromSetBucket(map, 'k', 'x');

    expect([...map.get('k')!]).toEqual(['y']);
  });

  it('deletes the key when the bucket becomes empty', () => {
    const map = new Map<string, Set<string>>([['k', new Set(['x'])]]);

    removeFromSetBucket(map, 'k', 'x');

    expect(map.has('k')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('does nothing for a missing key or a value that is not in the bucket', () => {
    const map = new Map<string, Set<string>>([['k', new Set(['x'])]]);

    removeFromSetBucket(map, 'absent', 'x');
    removeFromSetBucket(map, 'k', 'nope');

    expect([...map.get('k')!]).toEqual(['x']);
    expect(map.size).toBe(1);
  });
});

describe('TypeIndex bucket behaviour through the shared helpers', () => {
  it('drops a type bucket when its last name moves to another type', () => {
    const index = new TypeIndex();
    index.add({ name: 'a', entityType: 'Person', observations: [] });
    index.add({ name: 'a', entityType: 'Place', observations: [] });

    expect(index.getTypes()).toEqual(['place']);
    expect([...index.getNames('place')]).toEqual(['a']);
  });
});

describe('RefIndex reverse-index bucket behaviour through the shared helpers', () => {
  it('removes the entity bucket once its last ref is deregistered', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'refindex-cl11-'));
    try {
      const index = new RefIndex(path.join(dir, 'refs.jsonl'));
      await index.register('r1', 'Alice');
      await index.register('r2', 'Alice');

      expect(await index.refsForEntity('Alice')).toEqual(['r1', 'r2']);

      await index.deregister('r1');
      await index.deregister('r2');

      expect(await index.refsForEntity('Alice')).toEqual([]);
      expect(await index.stats()).toMatchObject({ totalRefs: 0 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
