/**
 * LSH Unit Tests
 *
 * Covers Phase 5 step 51: random-hyperplane LSH for cosine ANN.
 */

import { describe, it, expect } from 'vitest';
import { LSHIndex } from '../../../src/search/LSH.js';

function randomUnit(dim: number, rng: () => number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = rng() - 0.5;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i]! /= norm;
  return v;
}

function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('LSHIndex', () => {
  it('throws on dimension mismatch in add', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    expect(() => lsh.add('a', new Float32Array(4))).toThrow();
  });

  it('throws on dimension mismatch in query', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    lsh.add('a', new Float32Array(8));
    expect(() => lsh.query(new Float32Array(4))).toThrow();
  });

  it('size() reflects added vectors', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    lsh.add('a', randomUnit(8, makeSeededRng(1)));
    lsh.add('b', randomUnit(8, makeSeededRng(2)));
    expect(lsh.size()).toBe(2);
  });

  it('remove() drops the vector and is idempotent', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    const v = randomUnit(8, makeSeededRng(1));
    lsh.add('a', v);
    lsh.remove('a');
    lsh.remove('a'); // no-op
    expect(lsh.size()).toBe(0);
    expect(lsh.query(v).map((r) => r.id)).not.toContain('a');
  });

  it('returns the exact match for a vector at the top of its query', () => {
    const rng = makeSeededRng(42);
    const lsh = new LSHIndex({ dimensions: 32, numTables: 20, hyperplanesPerTable: 6, seed: 7 });
    const vecs = new Map<string, Float32Array>();
    for (let i = 0; i < 100; i++) {
      const v = randomUnit(32, rng);
      vecs.set(`v${i}`, v);
      lsh.add(`v${i}`, v);
    }
    const target = vecs.get('v42')!;
    const top = lsh.query(target, 5);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]!.id).toBe('v42');
    expect(top[0]!.score).toBeCloseTo(1.0, 5);
  });

  it('reasonable recall@10 for clustered query (vs linear scan)', () => {
    const rng = makeSeededRng(11);
    const dim = 32;
    // Cluster of vectors around an anchor; LSH should rank cluster members high.
    const anchor = randomUnit(dim, rng);
    const lsh = new LSHIndex({ dimensions: dim, numTables: 20, hyperplanesPerTable: 6, seed: 5 });
    const allVecs = new Map<string, Float32Array>();

    // 20 in-cluster vectors close to anchor.
    for (let i = 0; i < 20; i++) {
      const v = new Float32Array(dim);
      for (let d = 0; d < dim; d++) v[d] = anchor[d]! + (rng() - 0.5) * 0.05;
      l2(v);
      allVecs.set(`c${i}`, v);
      lsh.add(`c${i}`, v);
    }
    // 200 noise vectors.
    for (let i = 0; i < 200; i++) {
      const v = randomUnit(dim, rng);
      allVecs.set(`n${i}`, v);
      lsh.add(`n${i}`, v);
    }

    const trueTop = linearTopK(anchor, allVecs, 10);
    const lshTop = lsh.query(anchor, 10);
    const trueIds = new Set(trueTop.map((r) => r.id));
    const overlap = lshTop.filter((r) => trueIds.has(r.id)).length;
    expect(overlap).toBeGreaterThanOrEqual(5);
  });

  it('replacing a vector with same id updates its bucket', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    const v1 = randomUnit(8, makeSeededRng(1));
    const v2 = randomUnit(8, makeSeededRng(99));
    lsh.add('a', v1);
    lsh.add('a', v2); // replace
    expect(lsh.size()).toBe(1);
    const top = lsh.query(v2);
    expect(top[0]?.id).toBe('a');
  });

  it('throws on dimensions <= 0', () => {
    expect(() => new LSHIndex({ dimensions: 0 })).toThrow();
    expect(() => new LSHIndex({ dimensions: -4 })).toThrow();
    expect(() => new LSHIndex({ dimensions: 8.5 })).toThrow();
  });

  it('throws on hyperplanesPerTable > 63', () => {
    expect(() => new LSHIndex({ dimensions: 8, hyperplanesPerTable: 64 })).toThrow();
    expect(() => new LSHIndex({ dimensions: 8, hyperplanesPerTable: 100 })).toThrow();
    expect(() => new LSHIndex({ dimensions: 8, hyperplanesPerTable: 0 })).toThrow();
  });

  it('add() is idempotent on the same id (same size, retrievable)', () => {
    const lsh = new LSHIndex({ dimensions: 8, seed: 1 });
    const v = randomUnit(8, makeSeededRng(1));
    lsh.add('a', v);
    lsh.add('a', v);
    lsh.add('a', v);
    expect(lsh.size()).toBe(1);
    expect(lsh.query(v)[0]?.id).toBe('a');
  });

  it('bucketStats() returns one entry per table', () => {
    const lsh = new LSHIndex({ dimensions: 8, numTables: 4, seed: 1 });
    const rng = makeSeededRng(7);
    for (let i = 0; i < 20; i++) lsh.add(`v${i}`, randomUnit(8, rng));
    const stats = lsh.bucketStats();
    expect(stats).toHaveLength(4);
    for (const s of stats) {
      expect(s.buckets).toBeGreaterThan(0);
      expect(s.avgBucketSize).toBeGreaterThan(0);
    }
  });
});

function l2(v: Float32Array): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  if (n === 0) return;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
}

function linearTopK(
  target: Float32Array,
  vecs: Map<string, Float32Array>,
  k: number,
): Array<{ id: string; score: number }> {
  const results: Array<{ id: string; score: number }> = [];
  for (const [id, v] of vecs) {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += target[i]! * v[i]!;
    results.push({ id, score: dot });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}
