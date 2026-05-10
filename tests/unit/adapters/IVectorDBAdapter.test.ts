/**
 * IVectorDBAdapter Smoke Tests (against InMemoryVectorAdapter)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVectorAdapter } from '../../../src/adapters/IVectorDBAdapter.js';

describe('InMemoryVectorAdapter', () => {
  let adapter: InMemoryVectorAdapter;

  beforeEach(async () => {
    adapter = new InMemoryVectorAdapter();
    await adapter.connect();
  });

  it('upsert + query returns the most-similar vector first', async () => {
    await adapter.upsert([
      { id: 'cat', vector: [1, 0, 0] },
      { id: 'dog', vector: [0.9, 0.1, 0] },
      { id: 'plane', vector: [0, 0, 1] },
    ]);
    const matches = await adapter.query([1, 0, 0], { topK: 2 });
    expect(matches[0]!.id).toBe('cat');
    expect(matches[1]!.id).toBe('dog');
  });

  it('topK caps the number of results', async () => {
    await adapter.upsert([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0.9, 0.1] },
      { id: 'c', vector: [0.8, 0.2] },
    ]);
    const matches = await adapter.query([1, 0], { topK: 1 });
    expect(matches).toHaveLength(1);
  });

  it('minScore filters out low-similarity matches', async () => {
    await adapter.upsert([
      { id: 'close', vector: [1, 0] },
      { id: 'far', vector: [-1, 0] },
    ]);
    const matches = await adapter.query([1, 0], { topK: 5, minScore: 0.5 });
    expect(matches.map((m) => m.id)).toEqual(['close']);
  });

  it('filter narrows by exact-match metadata', async () => {
    await adapter.upsert([
      { id: 'a', vector: [1, 0], metadata: { tag: 'red' } },
      { id: 'b', vector: [0.9, 0.1], metadata: { tag: 'blue' } },
    ]);
    const matches = await adapter.query([1, 0], { topK: 5, filter: { tag: 'blue' } });
    expect(matches.map((m) => m.id)).toEqual(['b']);
  });

  it('remove drops vectors by id and reports the count', async () => {
    await adapter.upsert([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0, 1] },
    ]);
    expect(await adapter.remove(['a', 'missing'])).toBe(1);
    const matches = await adapter.query([1, 0], { topK: 5 });
    expect(matches.map((m) => m.id)).toEqual(['b']);
  });

  it('stats reports vector count and dimensions', async () => {
    await adapter.upsert([
      { id: 'a', vector: [0.1, 0.2, 0.3] },
      { id: 'b', vector: [0.4, 0.5, 0.6] },
    ]);
    const s = await adapter.stats();
    expect(s.vectorCount).toBe(2);
    expect(s.dimensions).toBe(3);
  });

  it('throws on operations before connect()', async () => {
    const fresh = new InMemoryVectorAdapter();
    await expect(fresh.upsert([])).rejects.toThrow(/not connected/);
  });

  it('disconnect clears state', async () => {
    await adapter.upsert([{ id: 'x', vector: [1, 0] }]);
    await adapter.disconnect();
    await adapter.connect();
    const s = await adapter.stats();
    expect(s.vectorCount).toBe(0);
  });

  it('returns score 0 for orthogonal vectors', async () => {
    await adapter.upsert([{ id: 'orth', vector: [1, 0] }]);
    const matches = await adapter.query([0, 1], { topK: 5 });
    expect(matches[0]!.score).toBeCloseTo(0, 5);
  });
});
