/**
 * Characterization tests for the imply/assign similar-field copies in `enDate/components`.
 *
 * The chrono-node export names stay; both must keep going through one internal writer, so a
 * known field is left alone by `imply` (and its implied value untouched) while `assign` replaces
 * it and clears the implied entry. All four wrappers are pinned, including the date siblings that
 * were not in the clone report.
 *
 * @module tests/unit/search/enDate.similarFields
 */

import { describe, it, expect } from 'vitest';
import {
  assignSimilarDate,
  assignSimilarTime,
  implySimilarDate,
  implySimilarTime,
} from '../../../src/search/enDate/components.js';
import { MERIDIEM_AM, MERIDIEM_PM, type Components } from '../../../src/search/enDate/types.js';

const REF = new Date('2026-03-04T09:30:15.250Z');
const PM_REF = new Date('2026-03-04T21:30:15.250Z');

function fresh(): Components {
  return { known: {}, implied: {}, tags: new Set<string>() };
}

describe('implySimilarTime', () => {
  it('writes all five time fields as implied values', () => {
    const c = implySimilarTime(fresh(), REF);
    expect(c.implied).toMatchObject({ hour: 9, minute: 30, second: 15, millisecond: 250, meridiem: MERIDIEM_AM });
    expect(c.known).toEqual({});
    expect(c.implied.implied).toBeUndefined();
  });

  it('derives meridiem from the hour (PM)', () => {
    expect(implySimilarTime(fresh(), PM_REF).implied.meridiem).toBe(MERIDIEM_PM);
  });

  it('leaves a known field alone and does not delete its implied value', () => {
    const c = fresh();
    c.known.hour = 3;
    c.implied.hour = 4;
    implySimilarTime(c, REF);
    expect(c.known.hour).toBe(3);
    expect(c.implied.hour).toBe(4);
    // other fields still get implied
    expect(c.implied.minute).toBe(30);
  });
});

describe('assignSimilarTime', () => {
  it('writes all five time fields as known values', () => {
    const c = assignSimilarTime(fresh(), REF);
    expect(c.known).toMatchObject({ hour: 9, minute: 30, second: 15, millisecond: 250, meridiem: MERIDIEM_AM });
    expect(c.implied).toEqual({});
  });

  it('replaces a known field and clears its implied value', () => {
    const c = fresh();
    c.known.hour = 3;
    c.implied.hour = 4;
    assignSimilarTime(c, REF);
    expect(c.known.hour).toBe(9);
    expect(c.implied.hour).toBeUndefined();
  });

  it('derives meridiem from the hour (PM)', () => {
    expect(assignSimilarTime(fresh(), PM_REF).known.meridiem).toBe(MERIDIEM_PM);
  });
});

describe('implySimilarDate', () => {
  it('writes day, month and year as implied values', () => {
    const c = implySimilarDate(fresh(), REF);
    expect(c.implied).toMatchObject({ day: 4, month: 3, year: 2026 });
    expect(c.known).toEqual({});
  });

  it('leaves a known field alone without deleting its implied value', () => {
    const c = fresh();
    c.known.month = 12;
    c.implied.month = 11;
    implySimilarDate(c, REF);
    expect(c.known.month).toBe(12);
    expect(c.implied.month).toBe(11);
    expect(c.implied.day).toBe(4);
  });
});

describe('assignSimilarDate', () => {
  it('writes day, month and year as known values', () => {
    const c = assignSimilarDate(fresh(), REF);
    expect(c.known).toMatchObject({ day: 4, month: 3, year: 2026 });
    expect(c.implied).toEqual({});
  });

  it('replaces a known field and clears its implied value', () => {
    const c = fresh();
    c.known.month = 12;
    c.implied.month = 11;
    assignSimilarDate(c, REF);
    expect(c.known.month).toBe(3);
    expect(c.implied.month).toBeUndefined();
  });
});

describe('imply and assign stay distinct', () => {
  it('imply never writes known, assign never writes implied', () => {
    const implied = implySimilarTime(fresh(), REF);
    const assigned = assignSimilarTime(fresh(), REF);
    expect(Object.keys(implied.known)).toEqual([]);
    expect(Object.keys(assigned.implied)).toEqual([]);
    expect(Object.keys(implied.implied).sort()).toEqual(Object.keys(assigned.known).sort());
  });
});
