/**
 * schemas.validateEntity / validateRelation (CL-18 runSchemaValidation)
 */

import { describe, it, expect } from 'vitest';
import { validateEntity, validateRelation } from '../../../src/utils/schemas.js';

describe('schemas.validateEntity', () => {
  it('returns the exact success shape for a valid entity', () => {
    const result = validateEntity({
      name: 'Alice',
      entityType: 'person',
      observations: ['likes tea'],
    });
    expect(result).toStrictEqual({ valid: true, errors: [] });
  });

  it('returns valid false with formatted string errors for an invalid entity', () => {
    const result = validateEntity({ name: '', entityType: 'person', observations: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => typeof e === 'string')).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateEntity('not an entity');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('schemas.validateRelation', () => {
  it('returns the exact success shape for a valid relation', () => {
    const result = validateRelation({ from: 'a', to: 'b', relationType: 'knows' });
    expect(result).toStrictEqual({ valid: true, errors: [] });
  });

  it('returns valid false with formatted errors for a blank endpoint', () => {
    const result = validateRelation({ from: '   ', to: 'b', relationType: 'knows' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Must be a non-empty string');
  });

  it('rejects a relation missing relationType', () => {
    const result = validateRelation({ from: 'a', to: 'b' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
