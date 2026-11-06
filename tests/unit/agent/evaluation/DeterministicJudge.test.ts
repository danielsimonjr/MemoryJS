/**
 * Unit tests for the deterministic rubric judge and its text helpers.
 *
 * @module tests/unit/agent/evaluation/DeterministicJudge
 */

import { describe, it, expect } from 'vitest';
import {
  DeterministicJudge,
  extractFirstNumber,
  extractSet,
  judgeCriterion,
  normalizeText,
} from '../../../../src/agent/evaluation/DeterministicJudge.js';
import type { Criterion, TaskRecord } from '../../../../src/types/learning.js';

const crit = (over: Partial<Criterion> & Pick<Criterion, 'kind'>): Criterion => ({
  id: 'c',
  text: 'criterion',
  ...over,
});

describe('normalizeText', () => {
  it.each([
    ['Hello, World!', 'hello world'],
    ['  many   spaces\tand\nlines ', 'many spaces and lines'],
    ['ﬁnance', 'finance'], // NFKC ligature
    ['Ｆｕｌｌ', 'full'], // fullwidth letters
    ['Café', 'cafe'],
    ['cafe\u0301', 'cafe'], // diacritics fold under NFKD + mark removal
    ['U.S.A.', 'usa'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('extractFirstNumber', () => {
  it.each([
    ['1,234.5 km', 1234.5],
    ['about 1,234,567 people', 1234567],
    ['-3 degrees', -3],
    ['value is 42.', 42],
    ['−18 below zero', -18],
    ['no digits here', undefined],
  ])('extracts from %j', (input, expected) => {
    expect(extractFirstNumber(input)).toBe(expected);
  });
});

describe('extractSet', () => {
  it('splits on semicolons, newlines and "and", case-insensitively, collapsing duplicates', () => {
    const set = extractSet('Apple; banana; Apple\nCherry AND cherry');
    expect([...set].sort()).toEqual(['apple', 'banana', 'cherry']);
    expect([...extractSet('Apple, banana, apple and Cherry')].sort()).toEqual(['apple', 'banana', 'cherry']);
    expect([...extractSet('Paris, France; Rome')].sort()).toEqual(['paris france', 'rome']);
  });

  it('strips list markers', () => {
    expect([...extractSet('- red\n- blue\n2. green')].sort()).toEqual(['blue', 'green', 'red']);
  });

  it('returns an empty set for empty text', () => {
    expect(extractSet('  ,  ').size).toBe(0);
  });
});

describe('judgeCriterion', () => {
  type Row = [string, Criterion, string, boolean];
  const rows: Row[] = [
    ['fact matches ignoring case and punctuation', crit({ kind: 'fact', expected: 'New York City' }), 'It is new-york, city!', true],
    ['fact fails when absent', crit({ kind: 'fact', expected: 'Paris' }), 'Lyon', false],
    ['fact with diacritics matches composed form', crit({ kind: 'fact', expected: 'Café' }), 'the café closed', true],
    ['fact with diacritics folds to plain letters', crit({ kind: 'fact', expected: 'Café' }), 'the cafe closed', true],
    ['fact with array expected matches any', crit({ kind: 'fact', expected: ['alpha', 'beta'] }), 'BETA release', true],
    ['number exact', crit({ kind: 'number', expected: 42 }), 'The answer is 42.', true],
    ['number with unit and thousands separator', crit({ kind: 'number', expected: 1234.5 }), '1,234.5 km', true],
    ['number outside tolerance', crit({ kind: 'number', expected: 10, tolerance: 0.5 }), '10.6', false],
    ['number inside tolerance', crit({ kind: 'number', expected: 10, tolerance: 0.5 }), '10.4 units', true],
    ['number uses first number only', crit({ kind: 'number', expected: 5 }), '7 then 5', false],
    ['number missing', crit({ kind: 'number', expected: 5 }), 'five', false],
    ['set-exact equal with duplicates and case', crit({ kind: 'set-exact', expected: ['Red', 'Blue'] }), 'blue, RED, red', true],
    ['set-exact missing member', crit({ kind: 'set-exact', expected: ['red', 'blue'] }), 'red', false],
    ['set-exact extra member', crit({ kind: 'set-exact', expected: ['red'] }), 'red and blue', false],
    ['set-precision subset with duplicates and case', crit({ kind: 'set-precision', expected: 'Red; Blue; Green' }), 'green, GREEN, red', true],
    ['set-precision rejects non-member', crit({ kind: 'set-precision', expected: 'red, blue' }), 'red, pink', false],
    ['set-precision rejects empty answer', crit({ kind: 'set-precision', expected: 'red' }), '  ', false],
    ['document mentions reference', crit({ kind: 'document', expected: 'doc-7' }), 'See Doc-7 for details', true],
    ['document any of array', crit({ kind: 'document', expected: ['spec-1', 'spec-2'] }), 'uses spec-2', true],
    ['document absent', crit({ kind: 'document', expected: 'spec-9' }), 'uses spec-2', false],
    ['free never passes even when answer repeats text', crit({ kind: 'free', text: 'sounds good', expected: 'good' }), 'good good good', false],
  ];

  it.each(rows)('%s', (_name, criterion, answer, pass) => {
    expect(judgeCriterion(criterion, answer).pass).toBe(pass);
  });

  it('free criteria carry the needs-judge note', () => {
    expect(judgeCriterion(crit({ kind: 'free', id: 'f' }), 'anything')).toEqual({
      criterionId: 'f',
      pass: false,
      note: 'needs judge',
    });
  });

  it('a set criterion with no expected members fails with a note', () => {
    const result = judgeCriterion(crit({ kind: 'set-exact', id: 'z' }), 'red');
    expect(result.pass).toBe(false);
    expect(result.note).toBe('no expected set');
  });
});

describe('DeterministicJudge.judge', () => {
  it('returns one result per rubric criterion in rubric order', async () => {
    const task: TaskRecord = {
      id: 't1',
      input: 'q',
      rubric: [
        { id: 'a', text: 'a', kind: 'fact', expected: 'paris' },
        { id: 'b', text: 'b', kind: 'number', expected: 3 },
        { id: 'c', text: 'c', kind: 'free' },
      ],
    };
    const results = await new DeterministicJudge().judge(task, 'Paris, 3');
    expect(results.map((r) => [r.criterionId, r.pass])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ]);
  });
});
