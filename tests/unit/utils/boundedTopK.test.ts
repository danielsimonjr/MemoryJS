import { describe, expect, it } from 'vitest';
import { BoundedTopK } from '../../../src/utils/boundedTopK.js';

describe('BoundedTopK', () => {
  it('matches a stable full sort for ties, different capacities and insertion orders', () => {
    let seed = 319;
    const values = Array.from({ length: 1000 }, (_, id) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return { id, score: seed % 19 };
    });
    for (const limit of [0, 1, 7, 200, 2000, Infinity]) {
      const selected = new BoundedTopK<(typeof values)[number]>(limit, (a, b) => b.score - a.score);
      for (const value of values) selected.add(value);
      expect(selected.sorted()).toEqual([...values].sort((a, b) => b.score - a.score).slice(0, limit));
    }
  });
});
