/**
 * Tests for the shared token-set helpers (CL-1 / CL-2):
 * tokenizeUnicodeToSet, tokenSetWithoutStopwords and ENGLISH_STOPWORDS_SMALL.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenizeUnicodeToSet,
  tokenSetWithoutStopwords,
  ENGLISH_STOPWORDS_SMALL,
} from '../../../src/utils/textSimilarity.js';
import * as utilsBarrel from '../../../src/utils/index.js';

describe('tokenizeUnicodeToSet', () => {
  const cases: Array<[string, string, string[]]> = [
    ['ascii words', 'Hello World', ['hello', 'world']],
    ['accented latin letters', 'naïve café', ['naïve', 'café']],
    ['uppercase non-ascii lowercased', 'Ünïcödé Straße', ['ünïcödé', 'straße']],
    ['cjk letters kept whole', '日本語 テキスト', ['日本語', 'テキスト']],
    ['digits kept', 'version 2 build 30', ['version', '2', 'build', '30']],
    ['unicode digits kept (\\p{N})', '١٢٣ abc', ['١٢٣', 'abc']],
    ['punctuation replaced by space', 'version 2.0 & rc3', ['version', '2', '0', 'rc3']],
    ['apostrophe splits word', "don't", ['don', 't']],
    ['hyphen splits word', 'foo-bar', ['foo', 'bar']],
    ['symbols only', '!!! ??? ---', []],
    ['empty string', '', []],
    ['spaces only', '     ', []],
    ['tabs and newlines only', '\t\n \r\n', []],
    ['repeated token collapses', 'go go GO Go', ['go']],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(tokenizeUnicodeToSet(input)).toEqual(new Set(expected));
  });

  it('returns a fresh Set on every call', () => {
    const a = tokenizeUnicodeToSet('alpha');
    a.add('mutated');
    expect(tokenizeUnicodeToSet('alpha')).toEqual(new Set(['alpha']));
  });
});

describe('ENGLISH_STOPWORDS_SMALL', () => {
  it.each([
    ['the', true],
    ['is', true],
    ['those', true],
    ['its', true],
    ['pr', false],
    ['ai', false],
    ['go', false],
    ['main', false],
  ])('contains %s -> %s', (word, expected) => {
    expect(ENGLISH_STOPWORDS_SMALL.has(word)).toBe(expected);
  });

  it('has exactly 27 entries', () => {
    expect(ENGLISH_STOPWORDS_SMALL.size).toBe(27);
  });
});

describe('tokenSetWithoutStopwords', () => {
  const cases: Array<[string, string, number, string[]]> = [
    ['drops stopwords and short tokens', 'The PR is in the main branch', 2, ['pr', 'main', 'branch']],
    ['keeps length-2 tokens at minLength 2', 'a b go AI x', 2, ['go', 'ai']],
    ['lowercases before matching stopwords', 'THE cat', 2, ['cat']],
    ['minLength 1 keeps single letters', 'q z', 1, ['q', 'z']],
    ['minLength 3 drops length-2 tokens', 'go main ai branch', 3, ['main', 'branch']],
    ['splits on non-ascii (ascii-only tokens)', 'naïve café', 2, ['na', 've', 'caf']],
    ['punctuation splits tokens', 'foo-bar, baz!', 2, ['foo', 'bar', 'baz']],
    ['digits kept', 'v2 build 30', 2, ['v2', 'build', '30']],
    ['empty string', '', 2, []],
    ['whitespace only', '   \t  ', 2, []],
    ['only stopwords', 'the a an is', 2, []],
  ];

  it.each(cases)('%s', (_label, input, minLength, expected) => {
    expect(tokenSetWithoutStopwords(input, ENGLISH_STOPWORDS_SMALL, minLength)).toEqual(
      new Set(expected),
    );
  });

  it('honours a custom stopword set', () => {
    const custom = new Set(['main']);
    expect(tokenSetWithoutStopwords('the main branch', custom, 2)).toEqual(
      new Set(['the', 'branch']),
    );
  });

  it('is exported from the utils barrel', () => {
    expect(utilsBarrel.tokenSetWithoutStopwords).toBe(tokenSetWithoutStopwords);
    expect(utilsBarrel.tokenizeUnicodeToSet).toBe(tokenizeUnicodeToSet);
    expect(utilsBarrel.ENGLISH_STOPWORDS_SMALL).toBe(ENGLISH_STOPWORDS_SMALL);
  });
});
