/**
 * English date parser — inventory of phrases MemoryJS already accepts.
 *
 * Every phrase here is handled today by `TemporalQueryParser`, either by its
 * own custom patterns or by the chrono-node 2.9.1 fallback. The expected ISO
 * strings are frozen: they were recorded from the chrono-backed parser at
 * reference `2026-01-15T12:00:00.000Z` with `TZ=UTC` before chrono-node was
 * removed, so this file keeps guarding behaviour without the dependency.
 *
 * Custom phrases (`last hour`, `this week`, `3 days ago`, ...) are pinned to
 * today's `TemporalQueryParser` output, not to chrono, because their ranges
 * exist precisely because chrono does not produce them.
 */

import { describe, expect, it } from 'vitest';
import { TemporalQueryParser } from '../../../src/search/TemporalQueryParser.js';

const REF = new Date('2026-01-15T12:00:00.000Z');

interface Pinned {
  phrase: string;
  start: string;
  end: string;
}

/** Ranges produced by the `parseCustomPattern` branch. */
const CUSTOM_PHRASES: Pinned[] = [
  { phrase: 'last hour', start: '2026-01-15T11:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'past hour', start: '2026-01-15T11:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'the last hour', start: '2026-01-15T11:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'last week', start: '2026-01-08T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'past week', start: '2026-01-08T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'last month', start: '2025-12-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'past month', start: '2025-12-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'last year', start: '2025-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'past year', start: '2025-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'past 3 days', start: '2026-01-12T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'last 2 hours', start: '2026-01-15T10:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'in the past 5 minutes', start: '2026-01-15T11:55:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'this week', start: '2026-01-11T00:00:00.000Z', end: '2026-01-17T23:59:59.999Z' },
  { phrase: 'this month', start: '2026-01-01T00:00:00.000Z', end: '2026-01-31T23:59:59.999Z' },
  { phrase: 'this year', start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.999Z' },
  { phrase: 'today', start: '2026-01-15T00:00:00.000Z', end: '2026-01-15T23:59:59.999Z' },
  { phrase: 'yesterday', start: '2026-01-14T00:00:00.000Z', end: '2026-01-14T23:59:59.999Z' },
  { phrase: '3 days ago', start: '2026-01-12T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: '1 hour ago', start: '2026-01-15T11:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
];

/**
 * Phrases that reach the chrono fallback (`since`, `between`/`to`, casual,
 * relative, ISO, month-name). The ranges are frozen chrono-node 2.9.1 output
 * after `TemporalQueryParser`'s own single-result and multi-result assembly.
 */
const FALLBACK_PHRASES: Pinned[] = [
  { phrase: 'since yesterday', start: '2026-01-14T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'since January 1', start: '2026-01-01T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'since 2026-01-01', start: '2026-01-01T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'between Monday and Wednesday', start: '2026-01-12T12:00:00.000Z', end: '2026-01-14T12:00:00.000Z' },
  { phrase: 'Jan 1 to Jan 7', start: '2026-01-01T12:00:00.000Z', end: '2026-01-07T12:00:00.000Z' },
  { phrase: 'tomorrow', start: '2026-01-15T12:00:00.000Z', end: '2026-01-16T12:00:00.000Z' },
  { phrase: 'tonight', start: '2026-01-15T12:00:00.000Z', end: '2026-01-15T22:00:00.000Z' },
  { phrase: 'noon', start: '2026-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'next Friday', start: '2026-01-15T12:00:00.000Z', end: '2026-01-23T12:00:00.000Z' },
  { phrase: '3 days from now', start: '2026-01-15T12:00:00.000Z', end: '2026-01-18T12:00:00.000Z' },
  { phrase: '2026-01-15', start: '2026-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: '2026-01-15T12:00:00Z', start: '2026-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
  { phrase: 'January 15, 2026', start: '2026-01-15T12:00:00.000Z', end: '2026-01-15T12:00:00.000Z' },
];

const UNPARSEABLE = ['not a date', '', '   '];

describe('enDate inventory', () => {
  const parser = new TemporalQueryParser();

  it.each(CUSTOM_PHRASES)('keeps the custom range for "$phrase"', ({ phrase, start, end }) => {
    const range = parser.parseTemporalExpression(phrase, REF);
    expect(range, phrase).toBeDefined();
    expect(range!.start.toISOString()).toBe(start);
    expect(range!.end.toISOString()).toBe(end);
    expect(range!.originalExpression).toBe(phrase);
  });

  it.each(FALLBACK_PHRASES)('keeps the fallback range for "$phrase"', ({ phrase, start, end }) => {
    const range = parser.parseTemporalExpression(phrase, REF);
    expect(range, phrase).toBeDefined();
    expect(range!.start.toISOString()).toBe(start);
    expect(range!.end.toISOString()).toBe(end);
  });

  it.each(UNPARSEABLE)('returns undefined for unparseable input %j', (phrase) => {
    expect(parser.parseTemporalExpression(phrase, REF)).toBeUndefined();
  });
});
