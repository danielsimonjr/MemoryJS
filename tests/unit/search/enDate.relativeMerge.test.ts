/**
 * Relative date-merge refiners, pinned through the public parser.
 *
 * `MergeRelativeAfterDateRefiner` joins a date with a following `+2 days` / `-1 week`.
 * `MergeRelativeFollowByDateRefiner` joins `2 days after` / `3 days before` with a following date.
 * Both go through `mergeAdjacent` and `createRelativeFromReference`; these cases fail if either
 * duration sign, duration source, or reference date is swapped between the two.
 *
 * @module tests/unit/search/enDate.relativeMerge
 */

import { describe, it, expect } from 'vitest';
import { parseEnDate } from '../../../src/search/enDate/parseEnDate.js';

const REF = new Date('2026-01-15T12:00:00.000Z');
const parse = (text: string) => parseEnDate(text, REF);

describe('MergeRelativeAfterDateRefiner', () => {
  it('adds a following +duration onto a date', () => {
    const [result] = parse('January 15, 2026 +2 days');
    expect(result?.text).toBe('January 15, 2026 +2 days');
    expect(result?.start.toISOString()).toBe('2026-01-17T12:00:00.000Z');
  });

  it('subtracts a following -duration from a date', () => {
    const [result] = parse('January 15, 2026 -1 week');
    expect(result?.text).toBe('January 15, 2026 -1 week');
    expect(result?.start.toISOString()).toBe('2026-01-08T12:00:00.000Z');
  });
});

describe('MergeRelativeFollowByDateRefiner', () => {
  it('adds a leading "after" duration onto a following date', () => {
    const [result] = parse('2 days after January 15, 2026');
    expect(result?.text).toBe('2 days after January 15, 2026');
    expect(result?.start.toISOString()).toBe('2026-01-17T12:00:00.000Z');
  });

  it('subtracts a leading "before" duration from a following date', () => {
    const [result] = parse('3 days before January 15, 2026');
    expect(result?.text).toBe('3 days before January 15, 2026');
    expect(result?.start.toISOString()).toBe('2026-01-12T12:00:00.000Z');
  });
});
