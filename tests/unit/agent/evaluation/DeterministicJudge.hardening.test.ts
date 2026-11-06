/**
 * DeterministicJudge hardening: sign handling (S3), word-boundary and folded matching (N1),
 * invalid tolerance notes (N4), comma-containing set members (N5).
 */
import { describe, it, expect } from 'vitest';
import { extractFirstNumber, judgeCriterion } from '../../../../src/agent/evaluation/DeterministicJudge.js';
import type { Criterion } from '../../../../src/types/learning.js';

const crit = (c: Partial<Criterion>): Criterion => ({ id: 'c', text: 't', kind: 'fact', ...c }) as Criterion;

describe('extractFirstNumber signs (S3)', () => {
  it.each([
    ['COVID-19 cases', 19],
    ['x+5', 5],
    ['-3 degrees', -3],
    ['(-2.5) offset', -2.5],
    ['range 4 -1', 4],
    ['delta: -7', -7],
    ['score\t+8', 8],
    ['1e3 metres', 1],
    ['3/4 cup', 3],
    ['- 5', 5],
  ])('%j -> %d', (text, expected) => {
    expect(extractFirstNumber(text)).toBe(expected);
  });
});

describe('fact and document matching (N1)', () => {
  it.each([
    ['art does not match start', 'fact', 'art', 'we start now', false],
    ['art matches as a word', 'fact', 'art', 'modern art, mostly', true],
    ['document word boundary', 'document', 'doc', 'see docs/guide', false],
    ['document whole name', 'document', 'guide.md', 'read GUIDE.md first', true],
    ['café equals cafe', 'fact', 'café', 'the CAFE opened', true],
    ['U.S.A. equals USA', 'fact', 'U.S.A.', 'made in the USA', true],
    ['USA equals U.S.A.', 'fact', 'USA', 'made in the U.S.A. today', true],
    ['multi-word phrase', 'fact', 'New York', 'in new york city', true],
  ] as const)('%s', (_name, kind, expected, answer, pass) => {
    expect(judgeCriterion(crit({ kind, expected }), answer).pass).toBe(pass);
  });
});

describe('invalid tolerance (N4)', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('tolerance %d is replaced by 0 with a note', (tolerance) => {
    const exact = judgeCriterion(crit({ kind: 'number', expected: 10, tolerance }), '10');
    expect(exact).toEqual({ criterionId: 'c', pass: true, note: 'invalid tolerance; using 0' });
    const off = judgeCriterion(crit({ kind: 'number', expected: 10, tolerance }), '11');
    expect(off.pass).toBe(false);
    expect(off.note).toBe('invalid tolerance; using 0');
  });

  it('a valid tolerance has no note', () => {
    expect(judgeCriterion(crit({ kind: 'number', expected: 10, tolerance: 1 }), '11')).toEqual({ criterionId: 'c', pass: true });
  });
});

describe('set members containing commas (N5)', () => {
  const c = crit({ kind: 'set-exact', expected: ['Washington, D.C.', 'Boston'] });
  it('matches when the answer separates items with semicolons', () => {
    expect(judgeCriterion(c, 'Washington, D.C.; Boston').pass).toBe(true);
    expect(judgeCriterion(c, 'Boston\nWashington, D.C.').pass).toBe(true);
  });
  it('does not match a comma-separated answer', () => {
    expect(judgeCriterion(c, 'Washington, D.C., Boston').pass).toBe(false);
  });
});
