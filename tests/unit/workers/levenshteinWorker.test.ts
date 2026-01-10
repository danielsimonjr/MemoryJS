/**
 * Levenshtein Worker Unit Tests
 *
 * Tests the core functions exported by the levenshtein worker module.
 * These tests run synchronously without worker threads.
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  similarity,
  searchEntities,
  type WorkerInput,
  type MatchResult,
} from '../../../src/workers/levenshteinWorker.js';

describe('levenshteinWorker', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('test', 'test')).toBe(0);
    });

    it('should return length of other string when one is empty', () => {
      expect(levenshteinDistance('', 'hello')).toBe(5);
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'abc')).toBe(3);
      expect(levenshteinDistance('xyz', '')).toBe(3);
    });

    it('should calculate single character insertions', () => {
      expect(levenshteinDistance('hello', 'helloo')).toBe(1);
      expect(levenshteinDistance('cat', 'cats')).toBe(1);
      expect(levenshteinDistance('at', 'cat')).toBe(1);
    });

    it('should calculate single character deletions', () => {
      expect(levenshteinDistance('hello', 'helo')).toBe(1);
      expect(levenshteinDistance('cats', 'cat')).toBe(1);
      expect(levenshteinDistance('cat', 'at')).toBe(1);
    });

    it('should calculate single character substitutions', () => {
      expect(levenshteinDistance('hello', 'hallo')).toBe(1);
      expect(levenshteinDistance('cat', 'bat')).toBe(1);
      expect(levenshteinDistance('cat', 'cot')).toBe(1);
    });

    it('should calculate multiple edits', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
      expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });

    it('should be symmetric', () => {
      expect(levenshteinDistance('hello', 'hallo')).toBe(levenshteinDistance('hallo', 'hello'));
      expect(levenshteinDistance('abc', 'def')).toBe(levenshteinDistance('def', 'abc'));
      expect(levenshteinDistance('kitten', 'sitting')).toBe(levenshteinDistance('sitting', 'kitten'));
    });

    it('should handle case sensitivity', () => {
      expect(levenshteinDistance('Hello', 'hello')).toBe(1);
      expect(levenshteinDistance('ABC', 'abc')).toBe(3);
    });

    it('should handle special characters', () => {
      expect(levenshteinDistance('hello!', 'hello?')).toBe(1);
      expect(levenshteinDistance('test@123', 'test#123')).toBe(1);
    });

    it('should handle unicode characters', () => {
      expect(levenshteinDistance('café', 'cafe')).toBe(1);
      expect(levenshteinDistance('日本', '日本語')).toBe(1);
    });
  });

  describe('similarity', () => {
    it('should return 1.0 for identical strings', () => {
      expect(similarity('hello', 'hello')).toBe(1.0);
      expect(similarity('test', 'test')).toBe(1.0);
      expect(similarity('', '')).toBe(1.0);
    });

    it('should return 1.0 when one string contains the other', () => {
      expect(similarity('hello', 'ell')).toBe(1.0);
      expect(similarity('ell', 'hello')).toBe(1.0);
      expect(similarity('testing', 'test')).toBe(1.0);
      expect(similarity('test', 'testing')).toBe(1.0);
    });

    it('should return value between 0 and 1 for similar strings', () => {
      const score = similarity('hello', 'hallo');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
      expect(score).toBeCloseTo(0.8, 1); // 1 edit out of 5 chars
    });

    it('should return 0 for completely different strings of same length', () => {
      expect(similarity('abc', 'xyz')).toBe(0);
      expect(similarity('aaa', 'bbb')).toBe(0);
    });

    it('should return low score for very different strings', () => {
      const score = similarity('hello', 'world');
      expect(score).toBeLessThan(0.5);
    });

    it('should handle case sensitivity', () => {
      const score = similarity('Hello', 'hello');
      expect(score).toBeLessThan(1.0);
      expect(score).toBeCloseTo(0.8, 1);
    });

    it('should calculate correct similarity for known examples', () => {
      // kitten -> sitting = 3 edits, max length 7
      // similarity = 1 - 3/7 ≈ 0.571
      const score = similarity('kitten', 'sitting');
      expect(score).toBeCloseTo(0.571, 2);
    });
  });

  describe('searchEntities', () => {
    const testEntities = [
      { name: 'Alice', nameLower: 'alice', observations: ['software engineer', 'works at tech company'] },
      { name: 'Bob', nameLower: 'bob', observations: ['project manager', 'leads development team'] },
      { name: 'Charlie', nameLower: 'charlie', observations: ['data scientist', 'machine learning expert'] },
      { name: 'David', nameLower: 'david', observations: ['software developer', 'backend specialist'] },
    ];

    it('should find exact name matches', () => {
      const input: WorkerInput = {
        query: 'alice',
        entities: testEntities,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
      expect(results[0].score).toBe(1.0);
      expect(results[0].matchedIn).toBe('name');
    });

    it('should find fuzzy name matches', () => {
      const input: WorkerInput = {
        query: 'alise', // typo for alice
        entities: testEntities,
        threshold: 0.7,
      };

      const results = searchEntities(input);

      expect(results.some(r => r.name === 'Alice')).toBe(true);
      expect(results.find(r => r.name === 'Alice')?.matchedIn).toBe('name');
    });

    it('should find matches in observations', () => {
      const input: WorkerInput = {
        query: 'software',
        entities: testEntities,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      // Should match Alice and David (both have "software" in observations)
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some(r => r.name === 'Alice')).toBe(true);
      expect(results.some(r => r.name === 'David')).toBe(true);
    });

    it('should prefer name matches over observation matches', () => {
      const input: WorkerInput = {
        query: 'bob',
        entities: testEntities,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      const bobResult = results.find(r => r.name === 'Bob');
      expect(bobResult).toBeDefined();
      expect(bobResult?.matchedIn).toBe('name');
    });

    it('should respect threshold for filtering', () => {
      const input: WorkerInput = {
        query: 'xyz',
        entities: testEntities,
        threshold: 0.9,
      };

      const results = searchEntities(input);

      // Very strict threshold with unrelated query should return nothing
      expect(results).toHaveLength(0);
    });

    it('should be case insensitive', () => {
      const input: WorkerInput = {
        query: 'ALICE',
        entities: testEntities,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results.some(r => r.name === 'Alice')).toBe(true);
    });

    it('should handle empty entities array', () => {
      const input: WorkerInput = {
        query: 'test',
        entities: [],
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results).toHaveLength(0);
    });

    it('should handle empty query', () => {
      const input: WorkerInput = {
        query: '',
        entities: testEntities,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      // Empty query should match entities with empty-ish names
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle entities with empty observations', () => {
      const entitiesWithEmpty = [
        { name: 'Empty', nameLower: 'empty', observations: [] },
        { name: 'Test', nameLower: 'test', observations: ['has observation'] },
      ];

      const input: WorkerInput = {
        query: 'observation',
        entities: entitiesWithEmpty,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results.some(r => r.name === 'Test')).toBe(true);
      expect(results.every(r => r.name !== 'Empty')).toBe(true);
    });

    it('should only match first observation that exceeds threshold', () => {
      const entityWithMultipleMatches = [
        {
          name: 'MultiMatch',
          nameLower: 'multimatch',
          observations: ['software engineer', 'software developer', 'software architect'],
        },
      ];

      const input: WorkerInput = {
        query: 'software',
        entities: entityWithMultipleMatches,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      // Should only have one result (breaks after first match)
      expect(results).toHaveLength(1);
      expect(results[0].matchedIn).toBe('observation');
    });

    it('should handle special characters in query', () => {
      const entitiesWithSpecial = [
        { name: 'C++', nameLower: 'c++', observations: ['programming language'] },
        { name: 'C#', nameLower: 'c#', observations: ['dotnet language'] },
      ];

      const input: WorkerInput = {
        query: 'c++',
        entities: entitiesWithSpecial,
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results.some(r => r.name === 'C++')).toBe(true);
    });

    it('should return results with correct score values', () => {
      const input: WorkerInput = {
        query: 'alice',
        entities: testEntities,
        threshold: 0.5,
      };

      const results = searchEntities(input);

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('should handle very low threshold', () => {
      const input: WorkerInput = {
        query: 'a',
        entities: testEntities,
        threshold: 0.1,
      };

      const results = searchEntities(input);

      // With very low threshold, should match many entities
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle threshold of exactly 1.0', () => {
      const input: WorkerInput = {
        query: 'alice',
        entities: testEntities,
        threshold: 1.0,
      };

      const results = searchEntities(input);

      // Only exact matches should pass
      expect(results.every(r => r.score === 1.0)).toBe(true);
    });
  });

  describe('MatchResult interface', () => {
    it('should have correct structure', () => {
      const input: WorkerInput = {
        query: 'alice',
        entities: [{ name: 'Alice', nameLower: 'alice', observations: ['test'] }],
        threshold: 0.8,
      };

      const results = searchEntities(input);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('matchedIn');
      expect(typeof results[0].name).toBe('string');
      expect(typeof results[0].score).toBe('number');
      expect(['name', 'observation']).toContain(results[0].matchedIn);
    });
  });

  describe('edge cases and robustness', () => {
    it('should handle very long strings', () => {
      const longString = 'a'.repeat(1000);
      const distance = levenshteinDistance(longString, longString);
      expect(distance).toBe(0);
    });

    it('should handle strings with only whitespace', () => {
      expect(levenshteinDistance('   ', '   ')).toBe(0);
      expect(levenshteinDistance('  ', '   ')).toBe(1);
      expect(similarity('   ', '   ')).toBe(1.0);
    });

    it('should handle newlines and tabs', () => {
      expect(levenshteinDistance('hello\nworld', 'hello\nworld')).toBe(0);
      expect(levenshteinDistance('hello\tworld', 'hello world')).toBe(1);
    });

    it('should handle numeric strings', () => {
      expect(levenshteinDistance('12345', '12345')).toBe(0);
      expect(levenshteinDistance('12345', '12346')).toBe(1);
      expect(similarity('12345', '12345')).toBe(1.0);
    });

    it('should handle mixed content', () => {
      const distance = levenshteinDistance('abc123!@#', 'abc123!@#');
      expect(distance).toBe(0);
    });
  });
});
