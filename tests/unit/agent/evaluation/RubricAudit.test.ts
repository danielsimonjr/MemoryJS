/**
 * RubricAudit unit tests (spec RS-26). Fixtures are synthetic.
 */

import { describe, it, expect } from 'vitest';
import { auditRubrics, RubricAudit } from '../../../../src/agent/evaluation/RubricAudit.js';
import type { Criterion, TaskRecord } from '../../../../src/types/learning.js';

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'rubric'>): TaskRecord {
  return {
    id: 'task-1',
    input: 'Compare Mercury, Venus, Earth and Mars from the almanac.',
    sources: [{ ref: 'almanac-2020', kind: 'document' }],
    ...overrides,
  };
}

function crit(id: string, text: string, extra: Partial<Criterion> = {}): Criterion {
  return { id, text, kind: 'fact', ...extra };
}

describe('auditRubrics: placeholder', () => {
  it.each(['[same … set]', '[see above]', '[the list]'])('flags back-reference %s', (ref) => {
    const issues = auditRubrics([task({ rubric: [crit('c1', `Covers the Mercury members ${ref}`)] })]);
    expect(issues).toContainEqual(expect.objectContaining({ taskId: 'task-1', criterionId: 'c1', kind: 'placeholder' }));
  });

  it('flags an empty bracket', () => {
    const issues = auditRubrics([task({ rubric: [crit('c1', 'Lists planets []')] })]);
    expect(issues.some((i) => i.kind === 'placeholder')).toBe(true);
  });
});

describe('auditRubrics: files', () => {
  it('flags a criterion that names only a filename', () => {
    const issues = auditRubrics([task({ rubric: [crit('c1', 'almanac.txt')] })]);
    expect(issues).toContainEqual(expect.objectContaining({ criterionId: 'c1', kind: 'files' }));
  });
});

describe('auditRubrics: contradicts', () => {
  it('flags a concept absent from the input and sources', () => {
    const issues = auditRubrics([task({ rubric: [crit('c1', 'Explains the photosynthesis mechanism')] })]);
    expect(issues).toContainEqual(expect.objectContaining({ criterionId: 'c1', kind: 'contradicts' }));
    expect(issues.find((i) => i.kind === 'contradicts')?.detail).toContain('photosynthesis');
  });
});

describe('auditRubrics: omits', () => {
  it('reports set members the sources and input do not reference', () => {
    const rubric = [
      crit('c1', 'Lists Mercury, Venus, Earth and Mars', {
        kind: 'set-exact',
        expected: ['Mercury', 'Venus', 'Earth', 'Pluto'],
      }),
    ];
    const issues = auditRubrics([task({ rubric })]);
    const omit = issues.find((i) => i.kind === 'omits');
    expect(omit).toBeDefined();
    expect(omit?.detail).toContain('Pluto');
    expect(omit?.detail).not.toContain('Mercury');
  });

  it('does not report members referenced only by a source ref', () => {
    const rubric = [crit('c1', 'Lists Mercury and Venus', { kind: 'set-precision', expected: ['Mercury', 'Venus'] })];
    const issues = auditRubrics([
      task({ input: 'Name the inner planets.', sources: [{ ref: 'mercury-venus-handbook', kind: 'document' }], rubric }),
    ]);
    expect(issues.some((i) => i.kind === 'omits')).toBe(false);
  });
});

describe('auditRubrics: admits', () => {
  it('reports set members the task category excludes', () => {
    const rubric = [
      crit('c1', 'Lists Mercury, Venus, Earth and Mars', {
        kind: 'set-exact',
        expected: ['Mercury', 'Venus', 'Earth', 'Mars'],
      }),
    ];
    const t = task({ category: 'inner-planets', rubric });
    const issues = auditRubrics([t], { excludedByCategory: { 'inner-planets': ['Mars'] } });
    const admit = issues.find((i) => i.kind === 'admits');
    expect(admit?.detail).toContain('Mars');
    expect(admit?.detail).not.toContain('Earth');
  });

  it('reports nothing when no exclusions are supplied', () => {
    const rubric = [crit('c1', 'Lists Mercury and Mars', { kind: 'set-exact', expected: ['Mercury', 'Mars'] })];
    const issues = auditRubrics([task({ category: 'inner-planets', rubric })]);
    expect(issues.some((i) => i.kind === 'admits')).toBe(false);
  });
});

describe('auditRubrics: false-positive guards', () => {
  it('keeps legitimate bracketed citations and numbers', () => {
    const t = task({
      input: 'Give the Mercury orbital period, citing Smith 2020.',
      sources: [],
      rubric: [crit('c1', 'Cites the orbital period for Mercury [Smith 2020]')],
    });
    expect(auditRubrics([t])).toEqual([]);
  });

  it('does not flag bracketed numbers as placeholders', () => {
    const t = task({
      input: 'Name three planets: 3 items expected.',
      sources: [],
      rubric: [crit('c1', 'Names three planets [3 items]')],
    });
    expect(auditRubrics([t]).some((i) => i.kind === 'placeholder')).toBe(false);
  });

  it('does not flag a criterion that names a file and describes its content', () => {
    const t = task({
      input: 'Summarise the orbital periods in the almanac.txt file.',
      sources: [],
      rubric: [crit('c1', 'Summarises the orbital periods in almanac.txt')],
    });
    expect(auditRubrics([t]).some((i) => i.kind === 'files')).toBe(false);
  });

  it('does not flag a concept that appears only in a source ref', () => {
    const t = task({
      input: 'Give the period.',
      sources: [{ ref: 'mercury-orbit-handbook', kind: 'document' }],
      rubric: [crit('c1', 'Reports the Mercury period')],
    });
    expect(auditRubrics([t]).some((i) => i.kind === 'contradicts')).toBe(false);
  });

  it('returns no issues for a clean rubric', () => {
    const t = task({
      input: 'Compare Mercury, Venus and Earth from the almanac orbital periods.',
      rubric: [
        crit('c1', 'Reports the orbital period of Mercury'),
        crit('c2', 'Lists Mercury, Venus and Earth', { kind: 'set-exact', expected: ['Mercury', 'Venus', 'Earth'] }),
      ],
    });
    expect(auditRubrics([t])).toEqual([]);
  });
});

describe('RubricAudit class', () => {
  it('matches the module function and merges constructor defaults', () => {
    const rubric = [crit('c1', 'Lists Mercury and Mars', { kind: 'set-exact', expected: ['Mercury', 'Mars'] })];
    const t = task({ category: 'inner', input: 'Compare Mercury and Mars.', rubric });
    const opts = { excludedByCategory: { inner: ['Mars'] } };
    expect(new RubricAudit(opts).auditRubrics([t])).toEqual(auditRubrics([t], opts));
    expect(new RubricAudit().auditRubrics([t], opts)).toEqual(auditRubrics([t], opts));
  });

  it('does not mutate the rubric', () => {
    const rubric = [crit('c1', 'Explains the photosynthesis mechanism')];
    const snapshot = JSON.stringify(rubric);
    auditRubrics([task({ rubric })]);
    expect(JSON.stringify(rubric)).toBe(snapshot);
  });
});
