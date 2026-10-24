/**
 * Top-k selection pins for QuantizedVectorStore.search.
 *
 * The search scores every vector, sorts by similarity and returns `slice(0, k)`.
 * The sort is stable, so equal similarities keep insertion order. `slice` gives the
 * k semantics: a negative k drops items from the end, and a fractional k truncates.
 * These tests fix that behaviour. Every expected value comes from the current source.
 * The order of a NaN similarity among finite ones depends on the sort algorithm of the
 * engine, so no test here fixes it.
 */

import { describe, it, expect } from 'vitest';
import { QuantizedVectorStore } from '../../../src/search/QuantizedVectorStore.js';

const QUERY = [1, 0];

const LEVELS: Record<string, number[]> = {
  hi: [1, 0],
  mid: [1, 1],
  lo: [0, 1],
  neg: [-1, 0],
  nan: [Number.NaN, 0],
  bad: [1, 0, 0],
};

function storeOf(pattern: string[], minVectorsForQuantization = 100): QuantizedVectorStore {
  const store = new QuantizedVectorStore({ minVectorsForQuantization });
  pattern.forEach((level, i) => store.add(`v${i}`, LEVELS[level]));
  return store;
}

function idsOf(pattern: string[], k: number, minVectorsForQuantization = 100): string[] {
  return storeOf(pattern, minVectorsForQuantization)
    .search(QUERY, k)
    .map(r => r.id);
}

describe('QuantizedVectorStore.search top-k pins', () => {
  describe('full precision', () => {
    it('keeps insertion order on equal similarities', () => {
      expect(idsOf(['mid', 'mid', 'hi', 'mid', 'mid'], 3)).toEqual(['v2', 'v0', 'v1']);
      expect(idsOf(['mid', 'mid', 'mid', 'mid'], 4)).toEqual(['v0', 'v1', 'v2', 'v3']);
    });

    it.each([
      [0, []],
      [1, ['v1']],
      [2.5, ['v1', 'v2']],
      [4, ['v1', 'v2', 'v0', 'v3']],
      [5, ['v1', 'v2', 'v0', 'v3']],
      [Number.POSITIVE_INFINITY, ['v1', 'v2', 'v0', 'v3']],
      [Number.NaN, []],
      [-1, ['v1', 'v2', 'v0']],
      [-2, ['v1', 'v2']],
      [-0.5, []],
      [-4, []],
      [-9, []],
      [Number.NEGATIVE_INFINITY, []],
    ])('k = %d follows slice(0, k)', (k, expected) => {
      expect(idsOf(['lo', 'hi', 'mid', 'neg'], k)).toEqual(expected);
    });

    it('scores a vector of another dimension as 0 and keeps it', () => {
      const results = storeOf(['neg', 'bad', 'hi']).search(QUERY, 3);
      expect(results.map(r => r.id)).toEqual(['v2', 'v1', 'v0']);
      expect(results.map(r => r.similarity)).toEqual([1, 0, -1]);
      expect(results.every(r => r.quantized === false)).toBe(true);
    });

    it('keeps insertion order when every similarity is NaN', () => {
      expect(idsOf(['nan', 'nan', 'nan'], 2)).toEqual(['v0', 'v1']);
    });

    it('returns nothing from an empty store', () => {
      expect(new QuantizedVectorStore().search(QUERY, 3)).toEqual([]);
    });
  });

  describe('quantized (asymmetric)', () => {
    it('keeps insertion order on equal quantized vectors', () => {
      const results = storeOf(['mid', 'lo', 'mid', 'hi', 'mid'], 2).search(QUERY, 4);
      expect(results.map(r => r.id)).toEqual(['v3', 'v0', 'v2', 'v4']);
      expect(results.every(r => r.quantized === true)).toBe(true);
    });

    it('follows slice(0, k) for a negative k', () => {
      expect(idsOf(['mid', 'lo', 'mid', 'hi', 'mid'], -2, 2)).toEqual(['v3', 'v0', 'v2']);
    });
  });
});
