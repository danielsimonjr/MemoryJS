/**
 * Pins for the shared Jaccard and cosine helpers. Each literal is the exact output for its input.
 * A trace lists the property reads that the function makes, in order.
 * A change in the number or order of reads fails a pin.
 */
import { describe, it, expect } from 'vitest';
import { cosineParts, cosineSimilarity, jaccard } from '../../../src/utils/textSimilarity.js';

/** Wraps an array so that every string property read is pushed to `trace`, in order. */
function traced(values: number[], trace: string[]): number[] {
  return new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string') trace.push(key);
      return (target as unknown as Record<string, unknown>)[key] as number;
    },
  });
}

describe('jaccard', () => {
  it('returns literal values for each set shape', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd', 'e']))).toBe(0.4);
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['x', 'y']))).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns the literal value for a plain pair', () => {
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBe(0.9746318461970762);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it('throws the dimension message on a length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('Vector dimensions mismatch: 2 vs 3');
  });

  it('gives the literal value for an array-like object', () => {
    const a = { length: 2, 0: 1, 1: 2 } as unknown as number[];
    const b = { length: 2, 0: 3, 1: 4 } as unknown as number[];
    expect(cosineSimilarity(a, b)).toBe(0.9838699100999074);
  });

  it('gives the plain-pair literal for an array-like with the same numbers', () => {
    const a = { length: 3, 0: 1, 1: 2, 2: 3 } as unknown as number[];
    const b = { length: 3, 0: 4, 1: 5, 2: 6 } as unknown as number[];
    expect(cosineSimilarity(a, b)).toBe(0.9746318461970762);
  });

  it('clamps a raw result above 1 to 1', () => {
    // The raw self-similarity of this vector is 1.0000000000000002.
    const v = [1.987643243273554, 1.0383844385102319, 1.0193700799808698, -0.48190593695356787];
    expect(cosineSimilarity(v, v)).toBe(1);
  });

  it('reads the length and each element in the recorded order', () => {
    const trace: string[] = [];
    const a = traced([1, 2, 3], trace);
    const b = traced([4, 5, 6], trace);
    expect(cosineSimilarity(a, b)).toBe(0.9746318461970762);
    expect(trace).toEqual([
      'length', 'length', 'length',
      '0', '0', '0', '0', '0', '0', 'length',
      '1', '1', '1', '1', '1', '1', 'length',
      '2', '2', '2', '2', '2', '2', 'length',
    ]);
  });
});

/** Wraps an array so that every string property read is pushed to `trace` as `<tag>.<key>`, in order. */
function tagged(values: number[], tag: string, trace: string[]): number[] {
  return new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string') trace.push(`${tag}.${key}`);
      return (target as unknown as Record<string, unknown>)[key] as number;
    },
  });
}

describe('cosineSimilarity (guard, formula and read order)', () => {
  it('throws the dimension message when the first vector is the longer one', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow('Vector dimensions mismatch: 3 vs 2');
  });

  it('divides by the product of the two square roots', () => {
    // sqrt(2) * sqrt(50) gives 0.7999999999999998; sqrt(2 * 50) would give 0.8.
    expect(cosineSimilarity([1, 1], [1, 7])).toBe(0.7999999999999998);
  });

  it('clamps a raw result below -1 to -1', () => {
    // The raw cosine of this vector and its negation is -1.0000000000000002.
    const v = [0.561574518942076, 0.5675604346057216, 1.7546017178122895];
    expect(cosineSimilarity(v, v.map((x) => -x))).toBe(-1);
  });

  it('reads the two arrays in the recorded interleaved order', () => {
    const trace: string[] = [];
    expect(cosineSimilarity(tagged([1, 2, 3], 'A', trace), tagged([4, 5, 6], 'B', trace))).toBe(0.9746318461970762);
    expect(trace).toEqual([
      'A.length', 'B.length',
      'A.length', 'A.0', 'B.0', 'A.0', 'A.0', 'B.0', 'B.0',
      'A.length', 'A.1', 'B.1', 'A.1', 'A.1', 'B.1', 'B.1',
      'A.length', 'A.2', 'B.2', 'A.2', 'A.2', 'B.2', 'B.2',
      'A.length',
    ]);
  });
});

describe('cosineParts', () => {
  it('sums the dot product and both squared norms', () => {
    expect(cosineParts([1, 2], [3, 4])).toEqual({ dot: 11, normA: 5, normB: 25 });
  });

  it('sums only the first n elements when n is given', () => {
    expect(cosineParts([1, 2], [3, 4], 1)).toEqual({ dot: 3, normA: 1, normB: 9 });
    expect(cosineParts([1, 2], [3, 4], 0)).toEqual({ dot: 0, normA: 0, normB: 0 });
  });

  it('takes the loop bound from the first array when n is absent', () => {
    const parts = cosineParts([1, 2, 3], [1, 2]);
    expect(parts.normA).toBe(14);
    expect(parts.dot).toBeNaN();
    expect(parts.normB).toBeNaN();
  });

  it('reads a.length on every step when n is absent, and never when n is given', () => {
    const withoutN: string[] = [];
    cosineParts(tagged([1, 2], 'A', withoutN), tagged([3, 4], 'B', withoutN));
    expect(withoutN).toEqual([
      'A.length', 'A.0', 'B.0', 'A.0', 'A.0', 'B.0', 'B.0',
      'A.length', 'A.1', 'B.1', 'A.1', 'A.1', 'B.1', 'B.1',
      'A.length',
    ]);
    const withN: string[] = [];
    cosineParts(tagged([1, 2], 'A', withN), tagged([3, 4], 'B', withN), 2);
    expect(withN).toEqual([
      'A.0', 'B.0', 'A.0', 'A.0', 'B.0', 'B.0',
      'A.1', 'B.1', 'A.1', 'A.1', 'B.1', 'B.1',
    ]);
  });
});
