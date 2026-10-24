/**
 * Top-k selection pins for InMemoryVectorStore.search.
 *
 * The search keeps the best k results in a bounded heap. Equal scores rank by
 * insertion order. These tests fix the selected items, their order and their scores
 * at the k boundary, for runs of equal scores, for NaN scores and for skipped vectors.
 * Every expected value comes from the source before the shared heap.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryVectorStore } from '../../../src/search/VectorStore.js';

/** Query direction. The cosine of each level below against it is exact and repeatable. */
const QUERY = [1, 0];

/** Stored vector for each score level; `bad` has a wrong dimension and is skipped. */
const LEVELS: Record<string, number[]> = {
  hi: [1, 0],
  mid: [1, 1],
  lo: [0, 1],
  neg: [-1, 0],
  nan: [Number.NaN, 0],
  bad: [1, 0, 0],
};

const MID = 0.7071067811865475;

/** Builds a store with one vector per pattern entry, named v0, v1, and so on. */
function storeOf(pattern: string[]): InMemoryVectorStore {
  const store = new InMemoryVectorStore();
  pattern.forEach((level, i) => store.add(`v${i}`, LEVELS[level]));
  return store;
}

function namesOf(pattern: string[], k: number): string[] {
  return storeOf(pattern)
    .search(QUERY, k)
    .map(r => r.name);
}

describe('InMemoryVectorStore.search top-k pins', () => {
  describe('all scores equal', () => {
    const pattern = ['mid', 'mid', 'mid', 'mid', 'mid', 'mid'];

    it.each([
      [0, []],
      [1, ['v0']],
      [3, ['v0', 'v1', 'v2']],
      [5, ['v0', 'v1', 'v2', 'v3', 'v4']],
      [6, ['v0', 'v1', 'v2', 'v3', 'v4', 'v5']],
      [7, ['v0', 'v1', 'v2', 'v3', 'v4', 'v5']],
    ])('k = %i keeps the first k in insertion order', (k, expected) => {
      expect(namesOf(pattern, k)).toEqual(expected);
    });

    it('floors a fractional k on equal scores', () => {
      expect(namesOf(pattern, 2.9)).toEqual(['v0', 'v1']);
    });

    it('returns the exact equal score for every kept item', () => {
      const results = storeOf(pattern).search(QUERY, 3);
      expect(results.map(r => r.score)).toEqual([MID, MID, MID]);
    });
  });

  describe('a run of equal scores across the k boundary', () => {
    const pattern = ['hi', 'mid', 'mid', 'mid', 'mid', 'lo'];

    it.each([
      [1, ['v0']],
      [2, ['v0', 'v1']],
      [3, ['v0', 'v1', 'v2']],
      [4, ['v0', 'v1', 'v2', 'v3']],
      [5, ['v0', 'v1', 'v2', 'v3', 'v4']],
      [6, ['v0', 'v1', 'v2', 'v3', 'v4', 'v5']],
    ])('k = %i takes the earliest of the tied items', (k, expected) => {
      expect(namesOf(pattern, k)).toEqual(expected);
    });
  });

  describe('ties with the better items inserted late', () => {
    const pattern = ['mid', 'hi', 'mid', 'lo', 'mid', 'mid', 'hi'];

    it.each([
      [1, ['v1']],
      [2, ['v1', 'v6']],
      [3, ['v1', 'v6', 'v0']],
      [4, ['v1', 'v6', 'v0', 'v2']],
      [5, ['v1', 'v6', 'v0', 'v2', 'v4']],
      [6, ['v1', 'v6', 'v0', 'v2', 'v4', 'v5']],
      [7, ['v1', 'v6', 'v0', 'v2', 'v4', 'v5', 'v3']],
      [8, ['v1', 'v6', 'v0', 'v2', 'v4', 'v5', 'v3']],
    ])('k = %i ranks by score, then by insertion order', (k, expected) => {
      expect(namesOf(pattern, k)).toEqual(expected);
    });

    it('returns each kept score unchanged', () => {
      const results = storeOf(pattern).search(QUERY, 7);
      expect(results.map(r => r.score)).toEqual([1, 1, MID, MID, MID, MID, 0]);
    });
  });

  describe('NaN scores', () => {
    it('keeps a NaN first candidate at the root, so no later candidate replaces it', () => {
      const pattern = ['nan', 'mid', 'hi', 'hi'];
      expect(namesOf(pattern, 1)).toEqual(['v0']);
      const results = storeOf(pattern).search(QUERY, 2);
      expect(results.map(r => r.name)).toEqual(['v0', 'v1']);
      expect(Number.isNaN(results[0].score)).toBe(true);
      expect(results[1].score).toBe(MID);
    });

    it('keeps a NaN candidate that arrives before the heap is full', () => {
      const results = storeOf(['hi', 'nan', 'lo']).search(QUERY, 3);
      expect(results.map(r => r.name)).toEqual(['v0', 'v1', 'v2']);
      expect(Number.isNaN(results[1].score)).toBe(true);
      expect(namesOf(['hi', 'nan', 'lo'], 4)).toEqual(['v0', 'v1', 'v2']);
    });

    it('rejects a NaN candidate that arrives after the heap is full', () => {
      expect(namesOf(['hi', 'lo', 'nan', 'mid'], 2)).toEqual(['v0', 'v3']);
    });

    it('keeps insertion order when every score is NaN', () => {
      expect(namesOf(['nan', 'nan', 'nan', 'nan'], 2)).toEqual(['v0', 'v1']);
      expect(namesOf(['nan', 'nan', 'nan', 'nan'], 9)).toEqual(['v0', 'v1', 'v2', 'v3']);
    });
  });

  describe('vectors with a wrong dimension', () => {
    const pattern = ['mid', 'bad', 'mid', 'bad', 'hi', 'mid'];

    it.each([
      [1, ['v4']],
      [2, ['v4', 'v0']],
      [3, ['v4', 'v0', 'v2']],
      [4, ['v4', 'v0', 'v2', 'v5']],
      [6, ['v4', 'v0', 'v2', 'v5']],
    ])('k = %i skips them and keeps the tie order of the rest', (k, expected) => {
      expect(namesOf(pattern, k)).toEqual(expected);
    });

    it('caps k at the store size, not at the number of scored vectors', () => {
      expect(namesOf(['bad', 'bad', 'mid'], 1)).toEqual(['v2']);
      expect(namesOf(['bad', 'bad', 'bad'], 2)).toEqual([]);
    });
  });

  describe('odd k values', () => {
    const pattern = ['lo', 'hi', 'mid', 'neg'];

    it.each([
      [0, []],
      [-0, []],
      [-1, []],
      [Number.NEGATIVE_INFINITY, []],
      [Number.NaN, []],
      [0.5, []],
      [1.5, ['v1']],
      [3, ['v1', 'v2', 'v0']],
      [4, ['v1', 'v2', 'v0', 'v3']],
      [5, ['v1', 'v2', 'v0', 'v3']],
      [Number.POSITIVE_INFINITY, ['v1', 'v2', 'v0', 'v3']],
    ])('k = %d', (k, expected) => {
      expect(namesOf(pattern, k)).toEqual(expected);
    });

    it('returns nothing from an empty store', () => {
      expect(new InMemoryVectorStore().search(QUERY, 3)).toEqual([]);
    });
  });

  describe('seeded patterns against a stable-sort model', () => {
    /** Small linear congruential generator, so the patterns repeat on every run. */
    function lcg(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }

    /** Model: drop skipped vectors, sort by score (stable, so ties keep insertion order), take k. */
    function model(pattern: string[], k: number): string[] {
      const scored = pattern
        .map((level, i) => ({ name: `v${i}`, level }))
        .filter(e => e.level !== 'bad')
        .map(e => ({ name: e.name, score: LEVELS[e.level][0] / Math.hypot(...LEVELS[e.level]) }));
      const limit = Math.min(pattern.length, Math.floor(k));
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(e => e.name);
    }

    it('matches the model for 60 patterns and every k from 0 to n + 1', () => {
      const next = lcg(20261024);
      const choices = ['hi', 'mid', 'mid', 'lo', 'lo', 'neg', 'bad'];
      let checked = 0;
      for (let p = 0; p < 60; p++) {
        const n = 1 + Math.floor(next() * 24);
        const pattern = Array.from({ length: n }, () => choices[Math.floor(next() * choices.length)]);
        for (let k = 0; k <= n + 1; k++) {
          expect(namesOf(pattern, k), `pattern ${pattern.join(',')} k ${k}`).toEqual(model(pattern, k));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(600);
    });
  });
});
