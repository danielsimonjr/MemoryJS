/**
 * Pins for the shared Jaccard and cosine helpers. The literal values come from the
 * source before the similarity refactor. A trace lists the property reads that the
 * function makes, in order, so a change in the number or order of reads fails a pin.
 */
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, jaccard } from '../../../src/utils/textSimilarity.js';

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

  it('clamps a raw result above 1 to 1', () => {
    // The raw self-similarity of this vector is 1.0000000000000002 in the source before the refactor.
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
