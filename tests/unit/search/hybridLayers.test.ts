/**
 * Direct unit tests for hybrid layer score mapping helpers (CMP-5).
 */

import { describe, it, expect } from 'vitest';
import {
  addSimilarityScores,
  addNormalizedLexicalScores,
  addSymbolicScores,
} from '../../../src/search/hybridLayers.js';
import type { Entity, SearchResult, SemanticSearchResult } from '../../../src/types/index.js';
import type { SymbolicResult } from '../../../src/search/SymbolicSearch.js';

const ent = (name: string): Entity => ({ name, entityType: 't', observations: [] });

describe('hybridLayers', () => {
  describe('addSimilarityScores', () => {
    it('maps each entity name to its similarity', () => {
      const scores = new Map<string, number>();
      const results: SemanticSearchResult[] = [
        { entity: ent('a'), similarity: 0.9 },
        { entity: ent('b'), similarity: 0.25 },
      ];
      addSimilarityScores(scores, results);
      expect(scores.get('a')).toBe(0.9);
      expect(scores.get('b')).toBe(0.25);
      expect(scores.size).toBe(2);
    });

    it('overwrites an existing entry for the same entity', () => {
      const scores = new Map<string, number>([['a', 0.1]]);
      addSimilarityScores(scores, [{ entity: ent('a'), similarity: 0.7 }]);
      expect(scores.get('a')).toBe(0.7);
    });

    it('is a no-op for empty input', () => {
      const scores = new Map<string, number>();
      addSimilarityScores(scores, []);
      expect(scores.size).toBe(0);
    });
  });

  describe('addNormalizedLexicalScores', () => {
    it('divides every score by the maximum so the top score becomes 1', () => {
      const scores = new Map<string, number>();
      const results: SearchResult[] = [
        { entity: ent('a'), score: 4 },
        { entity: ent('b'), score: 2 },
        { entity: ent('c'), score: 1 },
      ];
      addNormalizedLexicalScores(scores, results);
      expect(scores.get('a')).toBe(1);
      expect(scores.get('b')).toBe(0.5);
      expect(scores.get('c')).toBe(0.25);
    });

    it('keeps all normalized values within [0, 1] when the max exceeds 1', () => {
      const scores = new Map<string, number>();
      addNormalizedLexicalScores(scores, [
        { entity: ent('x'), score: 10 },
        { entity: ent('y'), score: 0 },
      ]);
      for (const v of scores.values()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('uses a divisor of at least 1 so scores at or below 1 keep their raw value', () => {
      const scores = new Map<string, number>();
      addNormalizedLexicalScores(scores, [
        { entity: ent('a'), score: 0.5 },
        { entity: ent('b'), score: 0.2 },
      ]);
      expect(scores.get('a')).toBe(0.5);
      expect(scores.get('b')).toBe(0.2);
    });

    it('is a no-op for empty input', () => {
      const scores = new Map<string, number>();
      addNormalizedLexicalScores(scores, []);
      expect(scores.size).toBe(0);
    });
  });

  describe('addSymbolicScores', () => {
    it('maps each entity name to its score unchanged', () => {
      const scores = new Map<string, number>();
      const results: SymbolicResult[] = [
        { entity: ent('a'), score: 3, matchedFilters: ['tag'] },
        { entity: ent('b'), score: 0.4, matchedFilters: [] },
      ];
      addSymbolicScores(scores, results);
      expect(scores.get('a')).toBe(3);
      expect(scores.get('b')).toBe(0.4);
    });

    it('keeps entries written before an error thrown mid-loop', () => {
      const scores = new Map<string, number>();
      const bad = {
        get entity(): Entity {
          throw new Error('boom');
        },
        score: 1,
        matchedFilters: [],
      } as unknown as SymbolicResult;
      const results: SymbolicResult[] = [
        { entity: ent('ok'), score: 2, matchedFilters: [] },
        bad,
        { entity: ent('after'), score: 5, matchedFilters: [] },
      ];
      expect(() => addSymbolicScores(scores, results)).toThrow('boom');
      expect(scores.get('ok')).toBe(2);
      expect(scores.has('after')).toBe(false);
    });
  });
});
