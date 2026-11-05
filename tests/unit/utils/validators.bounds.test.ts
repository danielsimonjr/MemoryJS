/**
 * validators.min / validators.max (CL-19 numericBoundRule)
 */

import { describe, it, expect } from 'vitest';
import { min, max } from '../../../src/utils/validators.js';
import type { Entity } from '../../../src/types/types.js';

const entity = (fields: Record<string, unknown>): Entity =>
  ({ name: 'e', entityType: 't', observations: [], ...fields }) as unknown as Entity;

describe('validators.min', () => {
  it('has the name, field and default message', () => {
    const rule = min('score', 3);
    expect(rule.name).toBe('min');
    expect(rule.field).toBe('score');
    expect(rule.message).toBe('score must be at least 3');
    expect(Object.keys(rule)).toEqual(['name', 'field', 'message', 'validate']);
  });

  it('passes at and above the bound, fails below', async () => {
    const rule = min('score', 3);
    expect(await rule.validate(entity({ score: 3 }))).toEqual({ valid: true });
    expect(await rule.validate(entity({ score: 10 }))).toEqual({ valid: true });
    expect(await rule.validate(entity({ score: 2.99 }))).toEqual({ valid: false });
  });

  it('passes non-numeric and missing values', async () => {
    const rule = min('score', 3);
    expect(await rule.validate(entity({ score: '1' }))).toEqual({ valid: true });
    expect(await rule.validate(entity({}))).toEqual({ valid: true });
    expect(await rule.validate(entity({ score: null }))).toEqual({ valid: true });
  });

  it('uses a custom message when given', () => {
    expect(min('score', 3, 'too low').message).toBe('too low');
  });

  it('resolves dot paths', async () => {
    const rule = min('stats.rank', 2);
    expect(await rule.validate(entity({ stats: { rank: 1 } }))).toEqual({ valid: false });
  });
});

describe('validators.max', () => {
  it('has the name, field and default message', () => {
    const rule = max('score', 7);
    expect(rule.name).toBe('max');
    expect(rule.field).toBe('score');
    expect(rule.message).toBe('score must be at most 7');
    expect(Object.keys(rule)).toEqual(['name', 'field', 'message', 'validate']);
  });

  it('passes at and below the bound, fails above', async () => {
    const rule = max('score', 7);
    expect(await rule.validate(entity({ score: 7 }))).toEqual({ valid: true });
    expect(await rule.validate(entity({ score: -100 }))).toEqual({ valid: true });
    expect(await rule.validate(entity({ score: 7.01 }))).toEqual({ valid: false });
  });

  it('passes non-numeric and missing values', async () => {
    const rule = max('score', 7);
    expect(await rule.validate(entity({ score: true }))).toEqual({ valid: true });
    expect(await rule.validate(entity({}))).toEqual({ valid: true });
  });

  it('uses a custom message when given', () => {
    expect(max('score', 7, 'too high').message).toBe('too high');
  });
});
