/**
 * English date parser — parity with chrono-node 2.9.1.
 *
 * This file ran while chrono-node was still installed, comparing our parser
 * with `chrono.parse` at a fixed UTC reference date. The assertions were then
 * frozen to the ISO strings chrono produced, so the corpus keeps guarding
 * behaviour after the dependency was removed.
 *
 * The corpus covers the phrases MemoryJS sends to the chrono fallback:
 * `since` clauses, `between`/`to` ranges, casual words, relative offsets,
 * ISO dates and instants, month-name dates, weekday forms, and clock times.
 * `forwardDate` is exercised on the phrases where it changes the answer, and
 * one phrase (`Monday and Wednesday`) is a two-result input that
 * `TemporalQueryParser` assembles into a first-start/last-start span.
 */

import { describe, expect, it } from 'vitest';
import { parseEnDate, parseEnDateStart } from '../../../src/search/enDate/parseEnDate.js';
import { TemporalQueryParser } from '../../../src/search/TemporalQueryParser.js';

const REF = new Date('2026-01-15T12:00:00.000Z');

interface Case {
  phrase: string;
  /** `parseEnDate` start with `forwardDate: false`. */
  start: string;
  /** `parseEnDate` end with `forwardDate: false`, or null when there is none. */
  end: string | null;
}

/**
 * Frozen chrono-node 2.9.1 output for `chrono.parse(phrase, REF, {
 * forwardDate: false })`.
 */
const CORPUS: Case[] = [
  // Casual words
  { phrase: 'today', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'tomorrow', start: '2026-01-16T12:00:00.000Z', end: null },
  { phrase: 'yesterday', start: '2026-01-14T12:00:00.000Z', end: null },
  { phrase: 'tonight', start: '2026-01-15T22:00:00.000Z', end: null },
  { phrase: 'noon', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'midnight', start: '2026-01-16T00:00:00.000Z', end: null },
  { phrase: 'morning', start: '2026-01-15T06:00:00.000Z', end: null },
  { phrase: 'evening', start: '2026-01-15T20:00:00.000Z', end: null },
  { phrase: 'now', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'last night', start: '2026-01-14T00:00:00.000Z', end: null },

  // Relative offsets
  { phrase: '3 days from now', start: '2026-01-18T12:00:00.000Z', end: null },
  { phrase: 'in 3 days', start: '2026-01-18T12:00:00.000Z', end: null },
  { phrase: '2 hours ago', start: '2026-01-15T10:00:00.000Z', end: null },
  { phrase: '3 weeks ago', start: '2025-12-25T12:00:00.000Z', end: null },
  { phrase: 'in 2 weeks', start: '2026-01-29T12:00:00.000Z', end: null },
  { phrase: 'next week', start: '2026-01-22T12:00:00.000Z', end: null },
  { phrase: 'last week', start: '2026-01-08T12:00:00.000Z', end: null },
  { phrase: 'next month', start: '2026-02-15T12:00:00.000Z', end: null },
  { phrase: 'last month', start: '2025-12-15T12:00:00.000Z', end: null },
  { phrase: 'next year', start: '2027-01-15T12:00:00.000Z', end: null },
  { phrase: 'last year', start: '2025-01-15T12:00:00.000Z', end: null },
  { phrase: 'this week', start: '2026-01-11T12:00:00.000Z', end: null },
  { phrase: 'this month', start: '2026-01-01T12:00:00.000Z', end: null },
  { phrase: 'this year', start: '2026-01-01T12:00:00.000Z', end: null },

  // Weekdays
  { phrase: 'Monday', start: '2026-01-12T12:00:00.000Z', end: null },
  { phrase: 'Friday', start: '2026-01-16T12:00:00.000Z', end: null },
  { phrase: 'next Friday', start: '2026-01-23T12:00:00.000Z', end: null },
  { phrase: 'last Friday', start: '2026-01-09T12:00:00.000Z', end: null },
  { phrase: 'this Friday', start: '2026-01-16T12:00:00.000Z', end: null },

  // ISO and absolute
  { phrase: '2026-01-15', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: '2026-01-15T12:00:00Z', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'January 15, 2026', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'Jan 1', start: '2026-01-01T12:00:00.000Z', end: null },
  { phrase: 'January 1', start: '2026-01-01T12:00:00.000Z', end: null },
  { phrase: 'Feb 3, 2026', start: '2026-02-03T12:00:00.000Z', end: null },
  { phrase: 'December 25', start: '2025-12-25T12:00:00.000Z', end: null },

  // Clock times
  { phrase: '5pm', start: '2026-01-15T17:00:00.000Z', end: null },
  { phrase: '17:00', start: '2026-01-15T17:00:00.000Z', end: null },
  { phrase: '12 pm', start: '2026-01-15T12:00:00.000Z', end: null },
  { phrase: 'today at 5pm', start: '2026-01-15T17:00:00.000Z', end: null },
  { phrase: 'tomorrow at 3pm', start: '2026-01-16T15:00:00.000Z', end: null },
  { phrase: 'Monday at 5pm', start: '2026-01-12T17:00:00.000Z', end: null },

  // Explicit ranges
  { phrase: 'Jan 1 to Jan 7', start: '2026-01-01T12:00:00.000Z', end: '2026-01-07T12:00:00.000Z' },
  { phrase: 'January 1 to March 5', start: '2026-01-01T12:00:00.000Z', end: '2026-03-05T12:00:00.000Z' },
  { phrase: 'from 10am to 2pm', start: '2026-01-15T10:00:00.000Z', end: '2026-01-15T14:00:00.000Z' },
];

describe('enDate parity corpus', () => {
  it.each(CORPUS)('matches chrono-node 2.9.1 for "$phrase"', ({ phrase, start, end }) => {
    const results = parseEnDate(phrase, REF, { forwardDate: false });
    expect(results.length, phrase).toBeGreaterThan(0);
    expect(results[0].start.toISOString()).toBe(start);
    expect(results[0].end?.toISOString() ?? null).toBe(end);
  });

  it.each(CORPUS)('matches the recorded match text and index for "$phrase"', ({ phrase, start }) => {
    const [result] = parseEnDate(phrase, REF, { forwardDate: false });
    expect(result.start.toISOString()).toBe(start);
    expect(phrase.substring(result.index, result.index + result.text.length)).toBe(result.text);
  });

  it.each([
    ['since yesterday', 'yesterday'],
    ['between Monday and Wednesday', 'Monday'],
    ['Jan 1 to Jan 7', 'Jan 1 to Jan 7'],
    ['2026-01-15', '2026-01-15'],
  ])('reports the matched slice for %j', (phrase, expectedText) => {
    const [result] = parseEnDate(phrase, REF, { forwardDate: false });
    expect(result.text).toBe(expectedText);
  });

  it('returns no result where chrono finds none', () => {
    for (const phrase of ['not a date', 'hello world', '12345', 'foo bar baz qux']) {
      expect(parseEnDate(phrase, REF, { forwardDate: false }), phrase).toEqual([]);
      expect(parseEnDateStart(phrase, REF, { forwardDate: false }), phrase).toBeUndefined();
    }
  });

  it('finds two results for "Monday and Wednesday"', () => {
    const results = parseEnDate('Monday and Wednesday', REF, { forwardDate: false });
    expect(results.map((r) => r.start.toISOString())).toEqual([
      '2026-01-12T12:00:00.000Z',
      '2026-01-14T12:00:00.000Z',
    ]);
  });

  it('resolves "between 2024-06-01 and 2024-06-10" to two results', () => {
    const results = parseEnDate('between 2024-06-01 and 2024-06-10', REF, { forwardDate: false });
    expect(results.map((r) => r.start.toISOString())).toEqual([
      '2024-06-01T12:00:00.000Z',
      '2024-06-10T12:00:00.000Z',
    ]);
  });

  it('matches parseDate for since-clauses', () => {
    expect(parseEnDateStart('January 1', REF, { forwardDate: false })?.toISOString()).toBe(
      '2026-01-01T12:00:00.000Z'
    );
    expect(parseEnDateStart('yesterday', REF, { forwardDate: false })?.toISOString()).toBe(
      '2026-01-14T12:00:00.000Z'
    );
  });

  it('applies forwardDate to a clock time that already passed', () => {
    expect(parseEnDateStart('9am', REF, { forwardDate: false })?.toISOString()).toBe(
      '2026-01-15T09:00:00.000Z'
    );
    expect(parseEnDateStart('9am', REF, { forwardDate: true })?.toISOString()).toBe(
      '2026-01-16T09:00:00.000Z'
    );
  });

  it('applies forwardDate to a month with no stated year', () => {
    expect(parseEnDateStart('December 25', REF, { forwardDate: false })?.toISOString()).toBe(
      '2025-12-25T12:00:00.000Z'
    );
    expect(parseEnDateStart('December 25', REF, { forwardDate: true })?.toISOString()).toBe(
      '2026-12-25T12:00:00.000Z'
    );
  });

  it('returns no result for a date that does not exist', () => {
    expect(parseEnDate('Feb 30', REF, { forwardDate: false })).toEqual([]);
    expect(parseEnDate('2026-02-30', REF, { forwardDate: false })).toEqual([]);
  });
});

describe('enDate parity through TemporalQueryParser', () => {
  const parser = new TemporalQueryParser();

  it.each([
    ['between Monday and Wednesday', '2026-01-12T12:00:00.000Z', '2026-01-14T12:00:00.000Z'],
    ['Jan 1 to Jan 7', '2026-01-01T12:00:00.000Z', '2026-01-07T12:00:00.000Z'],
    ['2026-02-01 to 2026-01-01', '2026-01-01T12:00:00.000Z', '2026-02-01T12:00:00.000Z'],
    ['tomorrow', '2026-01-15T12:00:00.000Z', '2026-01-16T12:00:00.000Z'],
    ['next Friday', '2026-01-15T12:00:00.000Z', '2026-01-23T12:00:00.000Z'],
    ['3 days from now', '2026-01-15T12:00:00.000Z', '2026-01-18T12:00:00.000Z'],
    ['since yesterday', '2026-01-14T12:00:00.000Z', '2026-01-15T12:00:00.000Z'],
    ['since January 1', '2026-01-01T12:00:00.000Z', '2026-01-15T12:00:00.000Z'],
    ['2026-01-15', '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z'],
    ['January 15, 2026', '2026-01-15T12:00:00.000Z', '2026-01-15T12:00:00.000Z'],
  ])('assembles the chrono range for %j', (phrase, start, end) => {
    const range = parser.parseTemporalExpression(phrase, REF);
    expect(range, phrase).toBeDefined();
    expect(range!.start.toISOString()).toBe(start);
    expect(range!.end.toISOString()).toBe(end);
  });

  it('uses the first start and the last start for a two-result phrase', () => {
    const range = parser.parseTemporalExpression('between 2024-06-01 and 2024-06-10', REF);
    expect(range!.start.toISOString()).toBe('2024-06-01T12:00:00.000Z');
    expect(range!.end.toISOString()).toBe('2024-06-10T12:00:00.000Z');
  });

  it('falls back to the forwardDate retry only when the first pass is empty', () => {
    const range = parser.parseTemporalExpression('9am', REF);
    expect(range!.start.toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(range!.end.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });
});
