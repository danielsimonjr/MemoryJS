/**
 * Sprint 5 build-review challenger pins (2026-11-10).
 *
 * These lock intentional deviations from chrono-node 2.9.1 found during
 * differential review (PR #307). Each case documents chrono's output, our
 * output, and why we kept ours. The sat-june control must keep matching chrono.
 *
 * Reference: `2026-09-05T20:52:32.304Z` (Saturday), `TZ=UTC`.
 */

import { describe, expect, it } from 'vitest';
import { parseEnDate } from '../../../src/search/enDate/parseEnDate.js';

const REF = new Date('2026-09-05T20:52:32.304Z');

describe('Sprint 5 enDate challenger pins', () => {
  describe('F1: PM day-part + bare 0/00 clock (intentional deviation)', () => {
    /**
     * chrono-node: casual `night`/`evening`/`afternoon` sets PM, then bare `00`
     * is read in 12-hour form as noon (12:00). Ours: `00` is 24-hour midnight and
     * is not shifted to noon under a PM day-part. The midnight reading matches the
     * clock value and the day-part semantics better than chrono's noon.
     */
    const cases: Array<[string, string]> = [
      ['night 00', '2026-09-05T00:00:00.000Z'],
      ['night 0:30', '2026-09-05T00:30:00.000Z'],
      ['evening 00', '2026-09-05T00:00:00.000Z'],
      ['evening 00:30', '2026-09-05T00:30:00.000Z'],
      ['afternoon 00', '2026-09-05T00:00:00.000Z'],
      ['night 00 edt', '2026-09-05T04:00:00.000Z'],
      ['night 00 on monday', '2026-09-07T00:00:00.000Z'],
    ];

    for (const [text, ourISO] of cases) {
      it(`pins our result for ${JSON.stringify(text)} (chrono would use noon)`, () => {
        const results = parseEnDate(text, REF);
        expect(results).toHaveLength(1);
        expect(results[0].start.toISOString()).toBe(ourISO);
      });
    }

    it('forwardDate: night 00 rolls to next-day midnight (chrono would keep same-day noon)', () => {
      const results = parseEnDate('night 00', new Date('2026-09-05T00:52:32.304Z'), {
        forwardDate: true,
      });
      expect(results[0].start.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    });
  });

  describe('F2: hyphenated weekday-month with May (intentional deviation)', () => {
    /**
     * chrono-node: `sat-may` becomes a range from Saturday noon to 1 May noon
     * (treating `may` as the month). At this review reference that is
     * 2026-09-05T12:00:00.000Z → 2027-05-01T12:00:00.000Z. At the parity
     * reference (2026-01-15) chrono instead yields 2026-01-17 → 2026-05-01.
     * Ours: `may` is lexically ambiguous (modal vs month); we only resolve
     * the weekday (`sat`). Unambiguous months still range-match chrono
     * (see sat-june control).
     */
    it('pins sat-may as weekday-only (chrono range: 2026-09-05 → 2027-05-01 noon)', () => {
      const results = parseEnDate('sat-may', REF);
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('sat');
      expect(results[0].start.toISOString()).toBe('2026-09-05T12:00:00.000Z');
      expect(results[0].end).toBeUndefined();
    });

    it('control: sat-june range still matches chrono-node 2.9.1', () => {
      const results = parseEnDate('sat-june', REF);
      expect(results).toHaveLength(1);
      expect(results[0].start.toISOString()).toBe('2026-09-05T12:00:00.000Z');
      expect(results[0].end?.toISOString()).toBe('2027-06-01T12:00:00.000Z');
    });
  });
});
