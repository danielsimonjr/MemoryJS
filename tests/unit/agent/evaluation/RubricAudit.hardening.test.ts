/**
 * RubricAudit hardening: inherited-property category names (S4) and `contradicts`
 * false positives from citations, code and filenames (S5).
 */
import { describe, it, expect } from 'vitest';
import { auditRubrics } from '../../../../src/agent/evaluation/RubricAudit.js';
import type { Criterion, TaskRecord } from '../../../../src/types/learning.js';

const crit = (id: string, text: string, extra: Partial<Criterion> = {}): Criterion =>
  ({ id, text, kind: 'fact', ...extra }) as Criterion;
const task = (input: string, rubric: Criterion[], category?: string): TaskRecord => ({
  id: 't', input, rubric, ...(category !== undefined ? { category } : {}),
});

describe('auditRubrics category exclusions (S4)', () => {
  const setCrit = crit('c1', 'Lists Mercury', { kind: 'set-exact', expected: ['Mercury'] });
  for (const category of ['toString', '__proto__', 'constructor']) {
    it(`does not throw for category ${category} without an exclusion`, () => {
      expect(() => auditRubrics([task('Mercury', [setCrit], category)], { excludedByCategory: { other: ['x'] } })).not.toThrow();
      expect(auditRubrics([task('Mercury', [setCrit], category)], { excludedByCategory: {} })).toEqual([]);
    });
  }

  it('still applies an own exclusion named __proto__', () => {
    const exclusions = Object.fromEntries([['__proto__', ['Mercury']]]) as Record<string, string[]>;
    const issues = auditRubrics([task('Mercury', [setCrit], '__proto__')], { excludedByCategory: exclusions });
    expect(issues.map((i) => i.kind)).toEqual(['admits']);
  });
});

describe('auditRubrics contradicts is advisory and skips non-concepts (S5)', () => {
  const input = 'Summarise the almanac orbital data and mention the code sample.';
  it.each([
    'Cites the almanac [Smith 2020]',
    'Summarises the almanac [3 items]',
    'Summarises the almanac [see Table 1]',
    'README.md must mention orbital data',
    'Explains `parseOrbitalTable()` orbital data',
    'use a[0] code',
    'Summarises 1,234 orbital data in 2020',
  ])('no contradicts issue for %j', (text) => {
    const issues = auditRubrics([task(input, [crit('c1', text)])]);
    expect(issues.filter((i) => i.kind === 'contradicts')).toEqual([]);
  });

  it('still flags a genuine missing concept', () => {
    const issues = auditRubrics([task(input, [crit('c1', 'Explains photosynthesis [Smith 2020] in README.md')])]);
    const hit = issues.find((i) => i.kind === 'contradicts');
    expect(hit?.detail).toContain('photosynthesis');
    expect(hit?.detail).not.toMatch(/smith|readme/i);
  });
});
