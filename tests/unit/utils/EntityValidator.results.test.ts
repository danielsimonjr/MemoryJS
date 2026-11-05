/**
 * EntityValidator result assembly (CL-20 issueFor / errorIssueFor / buildResult)
 *
 * Pins the exact issue and result shapes for async validate() and sync validateSync().
 */

import { describe, it, expect } from 'vitest';
import {
  EntityValidator,
  type EntityValidationRule,
} from '../../../src/utils/EntityValidator.js';
import { required, asWarning, customSync } from '../../../src/utils/validators.js';
import type { Entity } from '../../../src/types/types.js';

const entity = { name: '', entityType: 'person', observations: [] } as unknown as Entity;

const failing = (name: string, field: string, message: string): EntityValidationRule => ({
  name,
  field,
  message,
  validate: () => ({ valid: false }),
});

describe('EntityValidator issue shape', () => {
  it('builds an error issue with field, message, severity, value and rule', async () => {
    const v = new EntityValidator({ rules: [required('name')] });
    const result = await v.validate(entity);
    expect(result.isValid).toBe(false);
    expect(result.errors).toStrictEqual([
      {
        field: 'name',
        message: 'name is required',
        severity: 'error',
        value: '',
        rule: 'required',
      },
    ]);
    expect(result.warnings).toStrictEqual([]);
    expect(result.entity).toBe(entity);
  });

  it('prefers a result message over the rule message, and falls back on empty string', async () => {
    const withOverride: EntityValidationRule = {
      name: 'r',
      field: 'name',
      message: 'rule message',
      validate: () => ({ valid: false, message: 'result message' }),
    };
    const withEmpty: EntityValidationRule = {
      name: 'r2',
      field: 'name',
      message: 'rule fallback',
      validate: () => ({ valid: false, message: '' }),
    };
    const v = new EntityValidator({ rules: [withOverride, withEmpty] });
    const result = await v.validate(entity);
    expect(result.errors.map((e) => e.message)).toEqual(['result message', 'rule fallback']);
  });

  it('routes warnings to warnings and only makes them invalid in strict mode', async () => {
    const warn = asWarning(failing('w', 'name', 'soft'));
    const loose = await new EntityValidator({ rules: [warn] }).validate(entity);
    expect(loose.isValid).toBe(true);
    expect(loose.warnings).toStrictEqual([
      { field: 'name', message: 'soft', severity: 'warning', value: '', rule: 'w' },
    ]);

    const strict = await new EntityValidator({ rules: [warn], strict: true }).validate(entity);
    expect(strict.isValid).toBe(false);
    expect(strict.warnings).toHaveLength(1);
  });

  it('wraps a thrown error as an error issue with no value key', async () => {
    const throwing: EntityValidationRule = {
      name: 'boom',
      field: 'name',
      message: 'unused',
      validate: () => {
        throw new Error('kaput');
      },
    };
    const result = await new EntityValidator({ rules: [throwing] }).validate(entity);
    expect(result.errors).toStrictEqual([
      { field: 'name', message: 'Validation error: kaput', severity: 'error', rule: 'boom' },
    ]);
    expect(result.isValid).toBe(false);
  });

  it('honours failFast in both validate and validateSync', async () => {
    const rules = [failing('a', 'name', 'first'), failing('b', 'name', 'second')];
    const v = new EntityValidator({ rules, failFast: true });
    expect((await v.validate(entity)).errors).toHaveLength(1);
    expect(v.validateSync(entity).errors).toHaveLength(1);
  });
});

describe('EntityValidator.validateSync parity', () => {
  it('produces the same result as validate() for sync rules', async () => {
    const rules = [
      required('name'),
      asWarning(customSync('entityType', (v) => v === 'org', 'must be org')),
      failing('f', 'observations', 'obs bad'),
    ];
    const v = new EntityValidator({ rules });
    expect(v.validateSync(entity)).toStrictEqual(await v.validate(entity));
  });

  it('reports a rejected async rule as an error issue with the async message', () => {
    const asyncRule: EntityValidationRule = {
      name: 'slow',
      field: 'name',
      message: 'unused',
      validate: () => Promise.resolve({ valid: false }),
    };
    const result = new EntityValidator({ rules: [asyncRule] }).validateSync(entity);
    expect(result.isValid).toBe(false);
    expect(result.errors).toStrictEqual([
      {
        field: 'name',
        message:
          'Validation error: Rule "slow" is async. Use validate() instead of validateSync()',
        severity: 'error',
        rule: 'slow',
      },
    ]);
  });
});
