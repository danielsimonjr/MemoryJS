/**
 * NGramIndex Unit Tests
 *
 * Tests for src/search/NGramIndex.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NGramIndex } from '../../../src/search/NGramIndex.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIndex(n = 3): NGramIndex {
  return new NGramIndex(n);
}

// ---------------------------------------------------------------------------
// Constructor / validation
// ---------------------------------------------------------------------------

describe('NGramIndex constructor', () => {
  it('creates a trigram index by default', () => {
    const idx = new NGramIndex();
    const s = idx.stats();
    expect(s.totalDocuments).toBe(0);
  });

  it('accepts a custom n value', () => {
    expect(() => new NGramIndex(2)).not.toThrow();
    expect(() => new NGramIndex(4)).not.toThrow();
    expect(() => new NGramIndex(1)).not.toThrow();
  });

  it('throws for n = 0', () => {
    expect(() => new NGramIndex(0)).toThrow(RangeError);
  });

  it('throws for negative n', () => {
    expect(() => new NGramIndex(-1)).toThrow(RangeError);
  });

  it('throws for non-integer n', () => {
    expect(() => new NGramIndex(2.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// generateNgrams (internal, tested via the public API indirectly)
// ---------------------------------------------------------------------------

describe('NGramIndex.generateNgrams', () => {
  it('generates correct trigrams for a short string', () => {
    const idx = makeIndex(3);
    const ngrams = idx.generateNgrams('abc');
    expect(ngrams).toEqual(['abc']);
  });

  it('generates sliding-window trigrams', () => {
    const idx = makeIndex(3);
    const ngrams = idx.generateNgrams('abcd');
    expect(ngrams).toEqual(['abc', 'bcd']);
  });

  it('lowercases input', () => {
    const idx = makeIndex(3);
    const ngrams = idx.generateNgrams('ABC');
    expect(ngrams).toEqual(['abc']);
  });

  it('collapses multiple spaces to single space', () => {
    const idx = makeIndex(3);
    const ngrams = idx.generateNgrams('a  b'); // two spaces
    expect(ngrams).toContain('a b');
  });

  it('returns empty array for empty string', () => {
    const idx = makeIndex(3);
    expect(idx.generateNgrams('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    const idx = makeIndex(3);
    expect(idx.generateNgrams('   ')).toEqual([]);
  });

  it('returns single n-gram for string shorter than n', () => {
    const idx = makeIndex(5);
    const ngrams = idx.generateNgrams('hi');
    expect(ngrams).toEqual(['hi']);
  });

  it('handles Unicode emoji correctly (code-point aware)', () => {
    const idx = makeIndex(2);
    // "😀!" should be treated as 2 chars (emoji + !) → 1 bigram "😀!"
    const ngrams = idx.generateNgrams('😀!');
    expect(ngrams).toEqual(['😀!']);
  });

  it('handles multibyte Unicode characters', () => {
    const idx = makeIndex(2);
    const ngrams = idx.generateNgrams('日本語');
    // 3 code points → 2 bigrams
    expect(ngrams).toEqual(['日本', '本語']);
  });
});

// ---------------------------------------------------------------------------
// addDocument + query round-trip
// ---------------------------------------------------------------------------

describe('NGramIndex addDocument + query', () => {
  let idx: NGramIndex;

  beforeEach(() => {
    idx = makeIndex(3);
  });

  it('returns the added document on an exact match', () => {
    idx.addDocument('doc1', 'hello world');
    const results = idx.query('hello world', 0.0);
    expect(results).toContain('doc1');
  });

  it('scores an exact match as 1.0 (highest Jaccard)', () => {
    idx.addDocument('doc1', 'hello world');
    idx.addDocument('doc2', 'goodbye world');
    const results = idx.query('hello world', 0.0);
    // doc1 should rank above doc2
    expect(results[0]).toBe('doc1');
  });

  it('returns empty array for empty index', () => {
    expect(idx.query('hello', 0.0)).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    idx.addDocument('doc1', 'hello world');
    expect(idx.query('', 0.0)).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    idx.addDocument('doc1', 'hello world');
    expect(idx.query('   ', 0.0)).toEqual([]);
  });

  it('does not return documents below the threshold', () => {
    idx.addDocument('veryDifferent', 'xyz xyz xyz');
    const results = idx.query('hello world', 0.9);
    expect(results).not.toContain('veryDifferent');
  });
});

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

describe('NGramIndex similarity scoring', () => {
  it('scores similar strings higher than dissimilar strings', () => {
    const idx = makeIndex(3);
    idx.addDocument('similar', 'hello world');
    idx.addDocument('dissimilar', 'quantum physics');

    // "hello worl" differs from "hello world" by one character → should score high
    const results = idx.query('hello worl', 0.0);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toBe('similar');
  });

  it('"hello world" vs "hello worl" scores above 0.3', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'hello world');

    // At threshold 0.3, it should still appear
    const results = idx.query('hello worl', 0.3);
    expect(results).toContain('a');
  });

  it('"hello world" vs a completely different phrase scores below 0.1', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'hello world');

    // Very high threshold — no shared n-grams means 0 Jaccard
    const results = idx.query('zxqvbnm', 0.5);
    expect(results).not.toContain('a');
  });

  it('identical documents have Jaccard = 1', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'abcdef');
    // 'a' should appear at very high threshold because it is identical
    const results = idx.query('abcdef', 0.99);
    expect(results).toContain('a');
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('NGramIndex remove', () => {
  it('removes the document so it no longer appears in query results', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc1', 'hello world');
    idx.remove('doc1');

    const results = idx.query('hello world', 0.0);
    expect(results).not.toContain('doc1');
  });

  it('does not affect other documents when one is removed', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc1', 'hello world');
    idx.addDocument('doc2', 'hello earth');
    idx.remove('doc1');

    const results = idx.query('hello earth', 0.0);
    expect(results).toContain('doc2');
    expect(results).not.toContain('doc1');
  });

  it('is a no-op for a document that does not exist', () => {
    const idx = makeIndex(3);
    expect(() => idx.remove('nonexistent')).not.toThrow();
  });

  it('cleans up orphaned n-gram entries in the inverted index', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc1', 'unique_ngram_text_xyz');
    const statsBefore = idx.stats();
    idx.remove('doc1');
    const statsAfter = idx.stats();
    expect(statsAfter.totalNgrams).toBeLessThan(statsBefore.totalNgrams);
    expect(statsAfter.totalDocuments).toBe(0);
  });

  it('decrements totalDocuments in stats', () => {
    const idx = makeIndex(3);
    idx.addDocument('d1', 'apple');
    idx.addDocument('d2', 'banana');
    idx.remove('d1');
    expect(idx.stats().totalDocuments).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------

describe('NGramIndex clear', () => {
  it('empties the index so queries return no results', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc1', 'hello world');
    idx.addDocument('doc2', 'foo bar baz');
    idx.clear();

    expect(idx.query('hello world', 0.0)).toEqual([]);
    expect(idx.query('foo', 0.0)).toEqual([]);
  });

  it('resets stats to zero', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc1', 'hello world');
    idx.clear();
    const s = idx.stats();
    expect(s.totalDocuments).toBe(0);
    expect(s.totalNgrams).toBe(0);
    expect(s.averageNgramsPerDoc).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stats()
// ---------------------------------------------------------------------------

describe('NGramIndex stats', () => {
  it('returns zero stats on empty index', () => {
    const idx = makeIndex(3);
    const s = idx.stats();
    expect(s.totalDocuments).toBe(0);
    expect(s.totalNgrams).toBe(0);
    expect(s.averageNgramsPerDoc).toBe(0);
  });

  it('reports correct document count', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'hello');
    idx.addDocument('b', 'world');
    expect(idx.stats().totalDocuments).toBe(2);
  });

  it('reports totalNgrams as unique n-gram count (de-duped across docs)', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'abc');  // → 'abc'
    idx.addDocument('b', 'abc');  // same n-gram → should NOT inflate count
    // Both docs share the n-gram 'abc'; total unique n-grams = 1
    expect(idx.stats().totalNgrams).toBe(1);
  });

  it('averageNgramsPerDoc is consistent with per-doc n-gram counts', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'abcdef');  // 'abc','bcd','cde','def' = 4 n-grams
    idx.addDocument('b', 'xyz');     // 'xyz' = 1 n-gram
    const s = idx.stats();
    expect(s.totalDocuments).toBe(2);
    // averageNgramsPerDoc = (4 + 1) / 2 = 2.5
    expect(s.averageNgramsPerDoc).toBeCloseTo(2.5, 5);
  });

  it('re-adding an existing document updates but does not double-count', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'hello');
    idx.addDocument('a', 'world'); // replaces 'hello'
    const s = idx.stats();
    expect(s.totalDocuments).toBe(1); // still just one document
  });
});

// ---------------------------------------------------------------------------
// Unicode handling
// ---------------------------------------------------------------------------

describe('NGramIndex Unicode handling', () => {
  it('indexes Chinese text', () => {
    const idx = makeIndex(2);
    idx.addDocument('chinese', '机器学习');
    const results = idx.query('机器学习', 0.0);
    expect(results).toContain('chinese');
  });

  it('indexes Arabic text', () => {
    const idx = makeIndex(2);
    idx.addDocument('arabic', 'مرحبا');
    const results = idx.query('مرحبا', 0.0);
    expect(results).toContain('arabic');
  });

  it('handles emoji in document text', () => {
    const idx = makeIndex(2);
    idx.addDocument('emoji', '😀😂🎉');
    const results = idx.query('😀😂🎉', 0.0);
    expect(results).toContain('emoji');
  });

  it('is case-insensitive (lowercases both sides)', () => {
    const idx = makeIndex(3);
    idx.addDocument('doc', 'Hello World');
    const results = idx.query('HELLO WORLD', 0.0);
    expect(results).toContain('doc');
  });
});

// ---------------------------------------------------------------------------
// Short strings (shorter than n)
// ---------------------------------------------------------------------------

describe('NGramIndex short strings', () => {
  it('indexes a string shorter than n without error', () => {
    const idx = makeIndex(5);
    expect(() => idx.addDocument('short', 'hi')).not.toThrow();
  });

  it('retrieves a document whose text is shorter than n', () => {
    const idx = makeIndex(5);
    idx.addDocument('short', 'hi');
    const results = idx.query('hi', 0.0);
    expect(results).toContain('short');
  });

  it('uses whole-string n-gram for strings shorter than n', () => {
    const idx = makeIndex(4);
    idx.addDocument('a', 'ab'); // shorter than n=4 → treated as n-gram 'ab'
    const results = idx.query('ab', 0.0);
    expect(results).toContain('a');
  });

  it('empty document text still adds without error', () => {
    const idx = makeIndex(3);
    expect(() => idx.addDocument('empty', '')).not.toThrow();
  });

  it('empty document does not appear in any query results', () => {
    const idx = makeIndex(3);
    idx.addDocument('empty', '');
    // The document has no n-grams so can never be a candidate
    const results = idx.query('hello', 0.0);
    expect(results).not.toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// Threshold filtering
// ---------------------------------------------------------------------------

describe('NGramIndex threshold filtering', () => {
  it('threshold 0.0 returns all candidates with any shared n-gram', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'abcdef');
    idx.addDocument('b', 'abcxyz');
    idx.addDocument('c', 'uvwxyz');

    // 'a' and 'b' share 'abc' with query 'abcdef'; 'c' does not
    const results = idx.query('abcdef', 0.0);
    expect(results).toContain('a');
    expect(results).toContain('b');
  });

  it('higher threshold cuts off less-similar candidates', () => {
    const idx = makeIndex(3);
    idx.addDocument('close', 'hello world');
    idx.addDocument('far', 'hello xyz');

    const strictResults = idx.query('hello world', 0.6);
    // 'close' should pass, 'far' should not
    expect(strictResults).toContain('close');
    expect(strictResults).not.toContain('far');
  });

  it('threshold 1.0 returns only documents with Jaccard = 1 (identical n-gram set)', () => {
    const idx = makeIndex(3);
    idx.addDocument('a', 'hello world');
    idx.addDocument('b', 'hello world extra');

    const results = idx.query('hello world', 1.0);
    expect(results).toContain('a');
    expect(results).not.toContain('b');
  });
});

// ---------------------------------------------------------------------------
// Benchmark (skipped when SKIP_BENCHMARKS=true)
// ---------------------------------------------------------------------------

describe('NGramIndex benchmark', () => {
  const SKIP = process.env.SKIP_BENCHMARKS === 'true';

  it('querying 1000 documents should complete in <10ms', { skip: SKIP }, () => {
    const idx = makeIndex(3);

    // Populate with 1000 unique documents
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta', 'iota', 'kappa', 'lambda'];
    for (let i = 0; i < 1000; i++) {
      const word1 = words[i % words.length];
      const word2 = words[(i + 3) % words.length];
      idx.addDocument(`doc${i}`, `${word1} ${word2} entity number ${i}`);
    }

    const start = Date.now();
    const results = idx.query('alpha beta', 0.1);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);
    // Should return at least some results
    expect(results.length).toBeGreaterThan(0);
  });
});
