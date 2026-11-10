import { describe, expect, it } from 'vitest';
import { InMemoryVectorStore } from '../../../src/search/VectorStore.js';
import { LSHVectorStore } from '../../../src/search/LSHVectorStore.js';

function randomSource(): () => number {
  let state = 17;
  return () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
}

describe('LSHVectorStore', () => {
  it('matches exact search for small corpora and preserves replacement tie order', () => {
    const exact = new InMemoryVectorStore();
    const ann = new LSHVectorStore();
    for (const store of [exact, ann]) {
      store.add('a', [1, 0]); store.add('b', [1, 0]); store.add('c', [0, 1]);
      store.add('a', [1, 0]);
    }
    expect(ann.search([1, 0], 3)).toEqual(exact.search([1, 0], 3));
    expect(ann.search([1, 0], Infinity)).toEqual(exact.search([1, 0], Infinity));
  });

  it('owns vectors and updates buckets, hashes, deletion, dimensions and clear', () => {
    const ann = new LSHVectorStore({ exactThreshold: 0 });
    const vector = [1, 0]; ann.add('a', vector, 'old'); vector[0] = -1;
    expect(ann.get('a')).toEqual([1, 0]);
    ann.get('a')![0] = -1;
    expect(ann.get('a')).toEqual([1, 0]);
    ann.add('a', [0, 1], 'new');
    expect(ann.search([0, 1], 1)[0]).toEqual({ name: 'a', score: 1 });
    expect(ann.getContentHash('a')).toBe('new');
    ann.add('a', [1, 0, 0]);
    expect(ann.search([0, 1], 1)).toEqual([]);
    expect(ann.getContentHash('a')).toBeUndefined();
    expect(ann.remove('a')).toBe(true);
    expect(ann.remove('a')).toBe(false);
    expect(ann.size()).toBe(0);
    ann.add('b', [0, 0]); expect(ann.search([0, 0], 1)[0].score).toBe(0);
    ann.clear(); expect(ann.size()).toBe(0); expect(ann.getLastCandidateCount()).toBe(0);
  });

  it('validates configuration and nonfinite vectors, with harmless empty limits', () => {
    expect(() => new LSHVectorStore({ bits: 21 })).toThrow(RangeError);
    expect(() => new LSHVectorStore({ tables: 0 })).toThrow(RangeError);
    const ann = new LSHVectorStore();
    expect(() => ann.add('x', [NaN])).toThrow(RangeError);
    expect(() => ann.add('x', [])).toThrow(RangeError);
    ann.add('x', [1]);
    expect(() => ann.search([Infinity], 1)).toThrow(RangeError);
    expect(ann.search([1], 0)).toEqual([]);
    expect(ann.search([1], NaN)).toEqual([]);
    expect(ann.search([1], 0.5)).toEqual([]);
  });

  it('retrieves high-recall clustered neighbors with fewer cosine evaluations', () => {
    const rand = randomSource();
    const exact = new InMemoryVectorStore();
    const ann = new LSHVectorStore({ exactThreshold: 0, seed: 42 });
    const dimension = 32;
    const centers = Array.from({ length: 20 }, () => Array.from({ length: dimension }, () => rand() * 2 - 1));
    for (let i = 0; i < 2000; i++) {
      const vector = centers[i % centers.length].map(x => x + (rand() - 0.5) * 0.15);
      exact.add(String(i), vector); ann.add(String(i), vector);
    }
    let found = 0, evaluated = 0;
    for (const center of centers) {
      const query = center.map(x => x + (rand() - 0.5) * 0.15);
      const truth = new Set(exact.search(query, 10).map(x => x.name));
      const result = ann.search(query, 10);
      found += result.filter(x => truth.has(x.name)).length;
      evaluated += ann.getLastCandidateCount();
      expect(result.every((x, i) => i === 0 || result[i - 1].score >= x.score)).toBe(true);
    }
    expect(found / 200).toBeGreaterThanOrEqual(0.95);
    expect(evaluated / centers.length).toBeLessThan(1500);
  });
});
