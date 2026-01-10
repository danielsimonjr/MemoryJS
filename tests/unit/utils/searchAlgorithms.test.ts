/**
 * Search Algorithms Unit Tests
 *
 * Tests for Levenshtein distance and TF-IDF algorithms.
 * Consolidated from levenshtein.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  calculateTF,
  calculateIDF,
  calculateIDFFromTokenSets,
  calculateTFIDF,
  tokenize,
} from '../../../src/utils/index.js';

describe('searchAlgorithms', () => {
  // =============================================================================
  // Levenshtein Distance
  // =============================================================================

  describe('levenshteinDistance', () => {
    describe('identical strings', () => {
      it('should return 0 for identical strings', () => {
        expect(levenshteinDistance('hello', 'hello')).toBe(0);
        expect(levenshteinDistance('test', 'test')).toBe(0);
        expect(levenshteinDistance('', '')).toBe(0);
      });
    });

    describe('empty strings', () => {
      it('should return length when one string is empty', () => {
        expect(levenshteinDistance('', 'hello')).toBe(5);
        expect(levenshteinDistance('world', '')).toBe(5);
        expect(levenshteinDistance('', '')).toBe(0);
      });
    });

    describe('single character difference', () => {
      it('should return 1 for single insertion', () => {
        expect(levenshteinDistance('cat', 'cats')).toBe(1);
      });

      it('should return 1 for single deletion', () => {
        expect(levenshteinDistance('cats', 'cat')).toBe(1);
      });

      it('should return 1 for single substitution', () => {
        expect(levenshteinDistance('cat', 'bat')).toBe(1);
      });
    });

    describe('multiple edits', () => {
      it('should calculate distance for multiple edits', () => {
        expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
        expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
        expect(levenshteinDistance('book', 'back')).toBe(2);
      });
    });

    describe('completely different strings', () => {
      it('should handle completely different strings', () => {
        expect(levenshteinDistance('abc', 'xyz')).toBe(3);
        expect(levenshteinDistance('hello', 'world')).toBe(4);
      });
    });

    describe('different lengths', () => {
      it('should handle strings of different lengths', () => {
        expect(levenshteinDistance('short', 'muchlonger')).toBe(8);
        expect(levenshteinDistance('a', 'abc')).toBe(2);
      });
    });

    describe('case sensitivity', () => {
      it('should be case-sensitive', () => {
        expect(levenshteinDistance('Hello', 'hello')).toBe(1);
        expect(levenshteinDistance('WORLD', 'world')).toBe(5);
      });
    });

    describe('unicode characters', () => {
      it('should handle unicode characters', () => {
        expect(levenshteinDistance('cafe', 'cafe')).toBe(0);
        expect(levenshteinDistance('test', 'test')).toBe(0);
      });

      it('should handle accented characters', () => {
        // Note: JS string comparison is by code point
        expect(levenshteinDistance('cafe', 'caff')).toBe(1);
      });
    });

    describe('performance edge cases', () => {
      it('should handle long strings efficiently', () => {
        const longStr1 = 'a'.repeat(100);
        const longStr2 = 'b'.repeat(100);

        // Should complete without timeout
        const distance = levenshteinDistance(longStr1, longStr2);
        expect(distance).toBe(100);
      });

      it('should handle moderately long similar strings', () => {
        const str1 = 'abcdefghij'.repeat(10);
        const str2 = 'abcdefghik'.repeat(10);

        // Last char different in each repeat
        const distance = levenshteinDistance(str1, str2);
        expect(distance).toBe(10);
      });
    });

    describe('space optimization', () => {
      it('should swap strings for optimal space usage', () => {
        // Algorithm should swap to ensure shorter string is str1
        const short = 'ab';
        const long = 'abcdefghij';

        // Should work regardless of argument order
        expect(levenshteinDistance(short, long)).toBe(8);
        expect(levenshteinDistance(long, short)).toBe(8);
      });
    });
  });

  // =============================================================================
  // Tokenize
  // =============================================================================

  describe('tokenize', () => {
    it('should split text into lowercase tokens', () => {
      expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });

    it('should remove punctuation', () => {
      expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
    });

    it('should handle multiple spaces', () => {
      expect(tokenize('Hello   World')).toEqual(['hello', 'world']);
    });

    it('should handle empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('should handle only punctuation', () => {
      expect(tokenize('..., !!!')).toEqual([]);
    });

    it('should convert to lowercase', () => {
      expect(tokenize('HELLO WORLD')).toEqual(['hello', 'world']);
    });

    it('should handle mixed content', () => {
      expect(tokenize('Hello, World! How are you?')).toEqual([
        'hello', 'world', 'how', 'are', 'you'
      ]);
    });

    it('should handle numbers', () => {
      expect(tokenize('Test 123 Document')).toEqual(['test', '123', 'document']);
    });
  });

  // =============================================================================
  // Term Frequency (TF)
  // =============================================================================

  describe('calculateTF', () => {
    it('should calculate term frequency correctly', () => {
      const doc = 'the quick brown fox jumps over the lazy dog';
      // 'the' appears 2 times out of 9 tokens
      expect(calculateTF('the', doc)).toBeCloseTo(2 / 9);
    });

    it('should return 0 for term not in document', () => {
      const doc = 'hello world';
      expect(calculateTF('cat', doc)).toBe(0);
    });

    it('should return 0 for empty document', () => {
      expect(calculateTF('test', '')).toBe(0);
    });

    it('should be case-insensitive', () => {
      const doc = 'Hello HELLO hello';
      expect(calculateTF('hello', doc)).toBeCloseTo(1); // All 3 tokens are 'hello'
      expect(calculateTF('HELLO', doc)).toBeCloseTo(1);
    });

    it('should handle single word document', () => {
      expect(calculateTF('word', 'word')).toBe(1);
    });

    it('should handle repeated term', () => {
      const doc = 'test test test other';
      expect(calculateTF('test', doc)).toBeCloseTo(0.75);
    });
  });

  // =============================================================================
  // Inverse Document Frequency (IDF)
  // =============================================================================

  describe('calculateIDF', () => {
    it('should calculate IDF correctly', () => {
      const docs = [
        'the quick brown fox',
        'the lazy dog',
        'quick brown dog',
      ];
      // 'the' appears in 2 of 3 documents
      expect(calculateIDF('the', docs)).toBeCloseTo(Math.log(3 / 2));
    });

    it('should return higher IDF for rare terms', () => {
      const docs = [
        'the quick brown fox',
        'the lazy dog',
        'the happy cat',
      ];
      // 'fox' appears in 1 document, 'the' appears in 3
      const foxIDF = calculateIDF('fox', docs);
      const theIDF = calculateIDF('the', docs);
      expect(foxIDF).toBeGreaterThan(theIDF);
    });

    it('should return 0 for term not in any document', () => {
      const docs = ['hello world', 'foo bar'];
      expect(calculateIDF('xyz', docs)).toBe(0);
    });

    it('should return 0 for empty documents array', () => {
      expect(calculateIDF('test', [])).toBe(0);
    });

    it('should return 0 when term appears in all documents', () => {
      const docs = ['the cat', 'the dog', 'the bird'];
      // log(3/3) = log(1) = 0
      expect(calculateIDF('the', docs)).toBe(0);
    });

    it('should be case-insensitive', () => {
      const docs = ['Hello world', 'HELLO there'];
      expect(calculateIDF('hello', docs)).toBe(0); // Appears in all 2 docs
    });
  });

  describe('calculateIDFFromTokenSets', () => {
    it('should calculate IDF from pre-tokenized documents', () => {
      const tokenSets = [
        new Set(['the', 'quick', 'brown', 'fox']),
        new Set(['the', 'lazy', 'dog']),
        new Set(['quick', 'brown', 'dog']),
      ];
      // 'the' appears in 2 of 3 documents
      expect(calculateIDFFromTokenSets('the', tokenSets)).toBeCloseTo(Math.log(3 / 2));
    });

    it('should return 0 for term not in any document', () => {
      const tokenSets = [
        new Set(['hello', 'world']),
        new Set(['foo', 'bar']),
      ];
      expect(calculateIDFFromTokenSets('xyz', tokenSets)).toBe(0);
    });

    it('should return 0 for empty token sets array', () => {
      expect(calculateIDFFromTokenSets('test', [])).toBe(0);
    });

    it('should be more efficient than calculateIDF for bulk operations', () => {
      // This test verifies the optimization works correctly
      const docs = ['hello world', 'world peace', 'hello peace'];
      const tokenSets = docs.map(d => new Set(tokenize(d)));

      // Both should give same result
      const idf1 = calculateIDF('hello', docs);
      const idf2 = calculateIDFFromTokenSets('hello', tokenSets);
      expect(idf1).toBeCloseTo(idf2);
    });

    it('should be case-insensitive (expects lowercase input)', () => {
      const tokenSets = [
        new Set(['hello', 'world']),
        new Set(['hello', 'there']),
      ];
      // Input should be lowercase for proper matching
      expect(calculateIDFFromTokenSets('hello', tokenSets)).toBe(0);
      expect(calculateIDFFromTokenSets('HELLO'.toLowerCase(), tokenSets)).toBe(0);
    });
  });

  // =============================================================================
  // TF-IDF
  // =============================================================================

  describe('calculateTFIDF', () => {
    it('should calculate TF-IDF score', () => {
      const docs = [
        'the quick brown fox',
        'the lazy dog',
        'brown fox jumps',
      ];
      const doc = docs[0];

      // TF('fox', doc) = 1/4 = 0.25
      // IDF('fox', docs) = log(3/2) since fox appears in 2 docs
      const tfidf = calculateTFIDF('fox', doc, docs);
      expect(tfidf).toBeGreaterThan(0);
    });

    it('should return 0 for term not in document', () => {
      const docs = ['hello world', 'foo bar'];
      expect(calculateTFIDF('xyz', docs[0], docs)).toBe(0);
    });

    it('should return 0 for term not in corpus', () => {
      const docs = ['hello world', 'foo bar'];
      expect(calculateTFIDF('xyz', 'xyz appears here', docs)).toBe(0);
    });

    it('should give higher score to rare terms', () => {
      const docs = [
        'common common rare',
        'common common',
        'common word',
      ];

      const rareScore = calculateTFIDF('rare', docs[0], docs);
      const commonScore = calculateTFIDF('common', docs[0], docs);

      // 'rare' appears in 1 document (higher IDF), 'common' appears in all 3 (IDF=0)
      expect(rareScore).toBeGreaterThan(0);
      expect(commonScore).toBe(0); // common appears in all docs, IDF=0
    });

    it('should handle single document corpus', () => {
      const docs = ['hello world'];
      const tfidf = calculateTFIDF('hello', docs[0], docs);
      // IDF = log(1/1) = 0, so TF-IDF = 0
      expect(tfidf).toBe(0);
    });

    it('should handle empty document', () => {
      const docs = ['hello world', 'foo bar'];
      expect(calculateTFIDF('hello', '', docs)).toBe(0);
    });
  });

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('Edge Cases', () => {
    it('should handle documents with only punctuation', () => {
      expect(calculateTF('word', '..., !!!')).toBe(0);
    });

    it('should handle unicode in documents', () => {
      const doc = 'hello world';
      expect(calculateTF('hello', doc)).toBeCloseTo(0.5);
    });

    it('should handle very long documents', () => {
      const longDoc = Array(1000).fill('word').join(' ');
      expect(calculateTF('word', longDoc)).toBe(1);
    });

    it('should handle documents with newlines', () => {
      const doc = 'hello\nworld\ntest';
      expect(tokenize(doc)).toEqual(['hello', 'world', 'test']);
    });

    it('should handle hyphenated words', () => {
      const doc = 'state-of-the-art';
      // Hyphens are treated as separators
      expect(tokenize(doc)).toEqual(['state', 'of', 'the', 'art']);
    });

    it('should handle apostrophes', () => {
      const doc = "it's a test";
      // Apostrophes are removed
      expect(tokenize(doc)).toEqual(['it', 's', 'a', 'test']);
    });
  });
});
