/**
 * Tests for estimateTokensFromText (CL-3): ceil(wordCount * multiplier).
 */
import { describe, it, expect } from 'vitest';
import { estimateTokensFromText } from '../../../src/utils/tokenEstimate.js';
import * as utilsBarrel from '../../../src/utils/index.js';

describe('estimateTokensFromText', () => {
  const cases: Array<[string, string, number, number]> = [
    ['three words at 1.3 rounds up', 'one two three', 1.3, 4],
    ['exact integer product', 'a b c d', 0.5, 2],
    ['empty text is zero', '', 1.3, 0],
    ['whitespace-only text is zero', '   \n\t  ', 1.3, 0],
    ['single word at multiplier 1', 'a', 1, 1],
    ['zero multiplier is zero', 'a b', 0, 0],
    ['float artifact rounds up (3 * 1.1)', '3 words here', 1.1, 4],
    ['float artifact rounds up (7 * 1.1)', 'a b c d e f g', 1.1, 8],
    ['mixed separators counted as words', 'x  y\tz\nw', 1.3, 6],
    ['leading and trailing whitespace ignored', ' a b ', 1.3, 3],
    ['fractional product rounds up', 'hello', 2.5, 3],
    ['unicode words counted by whitespace', 'café naïve 日本語', 1, 3],
    ['punctuation does not split words', 'foo-bar, baz!', 1, 2],
  ];

  it.each(cases)('%s', (_label, text, multiplier, expected) => {
    expect(estimateTokensFromText(text, multiplier)).toBe(expected);
  });

  it('returns an integer for any multiplier', () => {
    for (const m of [0, 0.1, 1, 1.3, 2.7]) {
      const n = estimateTokensFromText('alpha beta gamma', m);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('is exported from the utils barrel', () => {
    expect(utilsBarrel.estimateTokensFromText).toBe(estimateTokensFromText);
  });
});
