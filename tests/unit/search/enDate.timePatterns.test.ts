/**
 * Time-pattern reject rules of `ENTimeExpressionParser`, pinned through the public parser.
 *
 * The two chrono-name checkers share a tail (a dotted ending must look like `\d(\.\d{2})+$`, and
 * an ending over 24 is rejected). These cases exercise both the bare and the range path, so a
 * shared `checkAndReturnTimePattern` that widened or narrowed either reject would fail here.
 *
 * @module tests/unit/search/enDate.timePatterns
 */

import { describe, it, expect } from 'vitest';
import { parseEnDate } from '../../../src/search/enDate/parseEnDate.js';

const REF = new Date('2026-01-15T12:00:00.000Z');
const parse = (text: string) => parseEnDate(text, REF);

describe('bare time rejections', () => {
  it('rejects a single digit', () => {
    expect(parse('5')).toEqual([]);
  });

  it('rejects four or more digits', () => {
    expect(parse('1234')).toEqual([]);
  });

  it('rejects a meridiem suffix attached without a space', () => {
    // `/^\d[apAP]$/` — "7p" alone is rejected; "7pm" parses.
    expect(parse('at 1234')).toEqual([]);
    expect(parse('7pm')).toHaveLength(1);
  });

  it('rejects an ending over 24', () => {
    expect(parse('25')).toEqual([]);
    expect(parse('24')).toEqual([]);
  });

  it('rejects a dotted ending that is not cents-like', () => {
    // `23.59` has a two-digit group so it is accepted by the cents test, then rejected by > 24.
    expect(parse('23.59')).toEqual([]);
    expect(parse('12.50')).toEqual([]);
  });
});

describe('range rejections', () => {
  it('rejects a bare `N-M` range', () => {
    expect(parse('1-2')).toEqual([]);
  });

  it('rejects a range whose end is over 24', () => {
    expect(parse('25-26')).toEqual([]);
  });

  it('rejects a range whose start is over 24', () => {
    // The range path adds the `startingNumbers > 24` reject that the bare path has not.
    expect(parse('at 25-3')).toEqual([]);
  });

  it('accepts in-range clock ranges', () => {
    expect(parse('at 5-6')).toHaveLength(1);
    expect(parse('at 10-11')).toHaveLength(1);
    expect(parse('10:00-11:00')).toHaveLength(1);
    expect(parse('at 12.30-13.45')).toHaveLength(1);
  });
});
