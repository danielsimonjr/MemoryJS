/**
 * Sprint 5 challenger tests (PR review, 2026-11-10).
 *
 * These assert chrono-node 2.9.1 parity for two input families where the
 * in-repo parser (`src/search/enDate`) currently diverges from live
 * chrono-node 2.9.1. They are EXPECTED TO FAIL against the PR as written;
 * each test names the divergence and notes where the in-repo behaviour is
 * arguably the more correct one, so the owner can either fix the parser or
 * record the deviation in the spec.
 *
 * Findings (both verified against live chrono-node 2.9.1):
 *
 * F1 (low) — a PM day-part word (`night`, `evening`, `afternoon`) followed
 *     by a bare `0`/`00` clock time. chrono resolves the merged result to
 *     noon (12:00/12:xx); ours resolves it to midnight (00:00/00:xx).
 *     Ours is arguably more correct ("night 0:30" as midnight), but the
 *     Sprint 5 acceptance criterion says fallback phrases match
 *     chrono-node 2.9.1, so this is recorded here either way.
 *
 * F2 (low) — a weekday and month name joined by a hyphen (`sat-may`).
 *     chrono builds a (semantically spurious) range from the weekday to
 *     May 1; ours keeps only the weekday and drops the month. Ours is
 *     arguably more correct, but it is a divergence from the frozen
 *     "fallback phrases match chrono" contract.
 *
 * Reference instants and expected values were produced by
 * `chrono-node@2.9.1` (`chrono.parse`) under `TZ=UTC`.
 */

import { describe, expect, it } from 'vitest';
import { parseEnDate } from '../../../src/search/enDate/parseEnDate.js';

const REF = new Date('2026-09-05T20:52:32.304Z'); // Saturday, 20:52 UTC

/** chrono-node 2.9.1 output for `text`, as recorded during the review. */
function chronoExpectation(
  index: number,
  text: string,
  startISO: string,
  endISO?: string
): { index: number; text: string; start: string; end?: string } {
  const expected: { index: number; text: string; start: string; end?: string } = {
    index,
    text,
    start: startISO,
  };
  if (endISO !== undefined) expected.end = endISO;
  return expected;
}

describe('Sprint 5 challenger — chrono 2.9.1 parity divergences (expected failures)', () => {
  describe('F1: PM day-part word followed by a bare 0/00 clock time', () => {
    const cases: Array<[string, string]> = [
      ['night 00', '2026-09-05T12:00:00.000Z'],
      ['night 0:30', '2026-09-05T12:30:00.000Z'],
      ['evening 00', '2026-09-05T12:00:00.000Z'],
      ['evening 00:30', '2026-09-05T12:30:00.000Z'],
      ['afternoon 00', '2026-09-05T12:00:00.000Z'],
      ['night 00 edt', '2026-09-05T16:00:00.000Z'],
      ['night 00 on monday', '2026-09-07T12:00:00.000Z'],
    ];

    for (const [text, chronoISO] of cases) {
      it(`chrono parity: ${JSON.stringify(text)} (ours gives midnight; chrono gives noon)`, () => {
        const results = parseEnDate(text, REF);
        expect(results).toHaveLength(1);
        const actual = {
          index: results[0].index,
          text: results[0].text,
          start: results[0].start.toISOString(),
        };
        expect(actual).toEqual(chronoExpectation(0, text, chronoISO));
      });
    }

    it('forwardDate variant: night 00 (ref before the phrase resolves)', () => {
      const results = parseEnDate('night 00', new Date('2026-09-05T00:52:32.304Z'), {
        forwardDate: true,
      });
      // chrono keeps the same-day noon even under forwardDate here.
      expect(results[0].start.toISOString()).toBe('2026-09-05T12:00:00.000Z');
    });
  });

  describe('F2: weekday and month name joined by a hyphen', () => {
    it('chrono parity: "sat-may" becomes a weekday→month range in chrono', () => {
      const results = parseEnDate('sat-may', REF);
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('sat-may');
      expect(results[0].start.toISOString()).toBe('2026-01-17T12:00:00.000Z');
      expect(results[0].end?.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    });

    it('chrono parity: "sat-june" range (control — already matches, must keep matching)', () => {
      // Sanity control: the adjacent form that already matches chrono must
      // not regress while F2 is being decided.
      const results = parseEnDate('sat-june', REF);
      expect(results).toHaveLength(1);
      expect(results[0].start.toISOString()).toBe('2026-09-05T12:00:00.000Z');
      expect(results[0].end?.toISOString()).toBe('2027-06-01T12:00:00.000Z');
    });
  });
});
