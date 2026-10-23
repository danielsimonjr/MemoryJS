/**
 * Tests for Built-in Validators
 *
 * @module tests/unit/utils/validators.test
 */

import { describe, it, expect } from 'vitest';
import {
  required,
  minLength,
  maxLength,
  pattern,
  range,
  min,
  max,
  oneOf,
  minItems,
  maxItems,
  email,
  url,
  isoDate,
  typeOf,
  custom,
  customSync,
  asWarning,
  all,
  when,
} from '../../../src/utils/validators.js';
import type { Entity } from '../../../src/types/types.js';

const createEntity = (overrides: Partial<Entity> = {}): Entity => ({
  name: 'TestEntity',
  entityType: 'test',
  observations: [],
  ...overrides,
});

describe('validators', () => {
  describe('required', () => {
    it('should pass for non-empty string', () => {
      const rule = required('name');
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for empty string', () => {
      const rule = required('name');
      const entity = createEntity({ name: '' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should fail for undefined', () => {
      const rule = required('parentId');
      const entity = createEntity({ parentId: undefined });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should fail for null', () => {
      const rule = required('parentId');
      const entity = createEntity({ parentId: null as unknown as string });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should pass for zero', () => {
      const rule = required('importance');
      const entity = createEntity({ importance: 0 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use custom message', () => {
      const rule = required('name', 'Name cannot be blank');
      expect(rule.message).toBe('Name cannot be blank');
    });

    it('should use default message', () => {
      const rule = required('name');
      expect(rule.message).toBe('name is required');
    });

    it('should access nested fields', () => {
      const rule = required('tags.0');
      const entity = createEntity({ tags: ['tag1'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for missing nested field', () => {
      const rule = required('tags.0');
      const entity = createEntity({ tags: [] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });
  });

  describe('minLength', () => {
    it('should pass when string meets minimum', () => {
      const rule = minLength('name', 3);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when string equals minimum', () => {
      const rule = minLength('name', 3);
      const entity = createEntity({ name: 'Bob' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when string below minimum', () => {
      const rule = minLength('name', 3);
      const entity = createEntity({ name: 'Al' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = minLength('importance', 3);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use default message', () => {
      const rule = minLength('name', 5);
      expect(rule.message).toBe('name must be at least 5 characters');
    });
  });

  describe('maxLength', () => {
    it('should pass when string meets maximum', () => {
      const rule = maxLength('name', 10);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when string equals maximum', () => {
      const rule = maxLength('name', 5);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when string exceeds maximum', () => {
      const rule = maxLength('name', 3);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = maxLength('importance', 3);
      const entity = createEntity({ importance: 999 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use custom message', () => {
      const rule = maxLength('name', 10, 'Too long!');
      expect(rule.message).toBe('Too long!');
    });
  });

  describe('pattern', () => {
    it('should pass when string matches pattern', () => {
      const rule = pattern('name', /^[A-Z]/);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when string does not match', () => {
      const rule = pattern('name', /^[A-Z]/);
      const entity = createEntity({ name: 'alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = pattern('importance', /^\d+$/);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use description in message', () => {
      const rule = pattern('name', /^[A-Z]/, 'uppercase start');
      expect(rule.message).toBe('name must match uppercase start');
    });

    it('should use regex in message if no description', () => {
      const rule = pattern('name', /^[A-Z]/);
      expect(rule.message).toContain('/^[A-Z]/');
    });
  });

  describe('range', () => {
    it('should pass when number within range', () => {
      const rule = range('importance', 0, 10);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when number equals minimum', () => {
      const rule = range('importance', 0, 10);
      const entity = createEntity({ importance: 0 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when number equals maximum', () => {
      const rule = range('importance', 0, 10);
      const entity = createEntity({ importance: 10 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when number below range', () => {
      const rule = range('importance', 0, 10);
      const entity = createEntity({ importance: -1 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should fail when number above range', () => {
      const rule = range('importance', 0, 10);
      const entity = createEntity({ importance: 11 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-number values', () => {
      const rule = range('name', 0, 10);
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use default message', () => {
      const rule = range('importance', 1, 5);
      expect(rule.message).toBe('importance must be between 1 and 5');
    });
  });

  describe('min', () => {
    it('should pass when number meets minimum', () => {
      const rule = min('importance', 5);
      const entity = createEntity({ importance: 7 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when number equals minimum', () => {
      const rule = min('importance', 5);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when number below minimum', () => {
      const rule = min('importance', 5);
      const entity = createEntity({ importance: 3 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-number values', () => {
      const rule = min('name', 5);
      const entity = createEntity({ name: 'test' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('max', () => {
    it('should pass when number meets maximum', () => {
      const rule = max('importance', 5);
      const entity = createEntity({ importance: 3 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when number equals maximum', () => {
      const rule = max('importance', 5);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when number exceeds maximum', () => {
      const rule = max('importance', 5);
      const entity = createEntity({ importance: 7 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });
  });

  describe('oneOf', () => {
    it('should pass when value in allowed list', () => {
      const rule = oneOf('entityType', ['person', 'project', 'technology']);
      const entity = createEntity({ entityType: 'person' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when value not in allowed list', () => {
      const rule = oneOf('entityType', ['person', 'project']);
      const entity = createEntity({ entityType: 'unknown' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should work with numbers', () => {
      const rule = oneOf('importance', [1, 5, 10]);
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should use default message', () => {
      const rule = oneOf('entityType', ['a', 'b']);
      expect(rule.message).toBe('entityType must be one of: a, b');
    });
  });

  describe('minItems', () => {
    it('should pass when array has minimum items', () => {
      const rule = minItems('observations', 1);
      const entity = createEntity({ observations: ['obs1', 'obs2'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when array equals minimum', () => {
      const rule = minItems('observations', 2);
      const entity = createEntity({ observations: ['obs1', 'obs2'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when array below minimum', () => {
      const rule = minItems('observations', 3);
      const entity = createEntity({ observations: ['obs1'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-array values', () => {
      const rule = minItems('name', 3);
      const entity = createEntity({ name: 'test' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('maxItems', () => {
    it('should pass when array within maximum', () => {
      const rule = maxItems('observations', 5);
      const entity = createEntity({ observations: ['obs1', 'obs2'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass when array equals maximum', () => {
      const rule = maxItems('observations', 2);
      const entity = createEntity({ observations: ['obs1', 'obs2'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail when array exceeds maximum', () => {
      const rule = maxItems('observations', 1);
      const entity = createEntity({ observations: ['obs1', 'obs2', 'obs3'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });
  });

  describe('email', () => {
    it('should pass for valid email', () => {
      const rule = email('name');
      const entity = createEntity({ name: 'test@example.com' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for invalid email', () => {
      const rule = email('name');
      const entity = createEntity({ name: 'invalid-email' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should fail for email without domain', () => {
      const rule = email('name');
      const entity = createEntity({ name: 'test@' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = email('importance');
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('url', () => {
    it('should pass for valid URL', () => {
      const rule = url('name');
      const entity = createEntity({ name: 'https://example.com/path' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for invalid URL', () => {
      const rule = url('name');
      const entity = createEntity({ name: 'not-a-url' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = url('importance');
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('isoDate', () => {
    it('should pass for valid ISO date', () => {
      const rule = isoDate('createdAt');
      const entity = createEntity({ createdAt: '2024-01-15T10:30:00Z' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for invalid date', () => {
      const rule = isoDate('createdAt');
      const entity = createEntity({ createdAt: 'not-a-date' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip non-string values', () => {
      const rule = isoDate('importance');
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('typeOf', () => {
    it('should pass for correct string type', () => {
      const rule = typeOf('name', 'string');
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for incorrect string type', () => {
      const rule = typeOf('importance', 'string');
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should pass for correct number type', () => {
      const rule = typeOf('importance', 'number');
      const entity = createEntity({ importance: 5 });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass for correct boolean type', () => {
      const rule = typeOf('importance', 'boolean');
      const entity = createEntity({ importance: true as unknown as number });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should pass for correct array type', () => {
      const rule = typeOf('observations', 'array');
      const entity = createEntity({ observations: ['test'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail for non-array when expecting array', () => {
      const rule = typeOf('name', 'array');
      const entity = createEntity({ name: 'test' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should pass for correct object type', () => {
      const rule = typeOf('parentId', 'object');
      const entity = createEntity({ parentId: {} as unknown as string });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should skip undefined values', () => {
      const rule = typeOf('parentId', 'string');
      const entity = createEntity();
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should skip null values', () => {
      const rule = typeOf('parentId', 'string');
      const entity = createEntity({ parentId: null as unknown as string });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('custom', () => {
    it('should pass with sync validator', async () => {
      const rule = custom('name', (value) => (value as string).startsWith('A'), 'Must start with A');
      const entity = createEntity({ name: 'Alice' });
      const result = await rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail with sync validator', async () => {
      const rule = custom('name', (value) => (value as string).startsWith('A'), 'Must start with A');
      const entity = createEntity({ name: 'Bob' });
      const result = await rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should work with async validator', async () => {
      const rule = custom('name', async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return (value as string).length > 0;
      }, 'Must not be empty');
      const entity = createEntity({ name: 'Alice' });
      const result = await rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should receive entity in validator', async () => {
      const rule = custom('name', (value, entity) => {
        return entity.entityType === 'test' && typeof value === 'string';
      }, 'Custom check');
      const entity = createEntity({ name: 'Alice' });
      const result = await rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('customSync', () => {
    it('should pass with validator', () => {
      const rule = customSync('name', (value) => (value as string).length > 3, 'Too short');
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should fail with validator', () => {
      const rule = customSync('name', (value) => (value as string).length > 3, 'Too short');
      const entity = createEntity({ name: 'Al' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should receive entity in validator', () => {
      const rule = customSync('name', (_value, entity) => entity.observations.length > 0, 'No observations');
      const entity = createEntity({ observations: ['obs1'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });
  });

  describe('asWarning', () => {
    it('should convert rule to warning severity', () => {
      const rule = asWarning(required('name'));
      expect(rule.severity).toBe('warning');
    });

    it('should preserve rule functionality', () => {
      const rule = asWarning(required('name'));
      const entity = createEntity({ name: 'Alice' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should preserve message', () => {
      const rule = asWarning(required('name', 'Custom message'));
      expect(rule.message).toBe('Custom message');
    });
  });

  describe('all', () => {
    it('should return array of rules', () => {
      const rules = all(required('name'), minLength('name', 3), maxLength('name', 50));
      expect(rules).toHaveLength(3);
    });

    it('should preserve rule order', () => {
      const rules = all(required('name'), minLength('name', 3));
      expect(rules[0].name).toBe('required');
      expect(rules[1].name).toBe('minLength');
    });
  });

  describe('when', () => {
    it('should apply rule when predicate is true', () => {
      const rule = when(
        (entity) => entity.entityType === 'person',
        required('importance')
      );
      const entity = createEntity({ entityType: 'person', importance: undefined });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should skip rule when predicate is false', () => {
      const rule = when(
        (entity) => entity.entityType === 'person',
        required('importance')
      );
      const entity = createEntity({ entityType: 'project', importance: undefined });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should prefix rule name with conditional', () => {
      const rule = when(
        () => true,
        required('name')
      );
      expect(rule.name).toBe('conditional:required');
    });
  });

  describe('nested field access', () => {
    it('should access nested object fields', () => {
      const rule = required('metadata.key');
      const entity = {
        ...createEntity(),
        metadata: { key: 'value' },
      } as Entity;
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should return undefined for missing nested path', () => {
      const rule = required('metadata.missing.deep');
      const entity = {
        ...createEntity(),
        metadata: {},
      } as Entity;
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });

    it('should access array indices', () => {
      const rule = required('observations.0');
      const entity = createEntity({ observations: ['first'] });
      const result = rule.validate(entity);
      expect(result.valid).toBe(true);
    });

    it('should handle non-object in path', () => {
      const rule = required('name.nested');
      const entity = createEntity({ name: 'test' });
      const result = rule.validate(entity);
      expect(result.valid).toBe(false);
    });
  });

  describe('field path getter (pinned before the extraction)', () => {
    const withExtra = (extra: Record<string, unknown>): Entity => ({ ...createEntity(), ...extra }) as Entity;

    it('reads a top-level field', () => {
      expect(required('name').validate(createEntity()).valid).toBe(true);
    });

    it('reads a three-level path', () => {
      expect(required('a.b.c').validate(withExtra({ a: { b: { c: 'x' } } })).valid).toBe(true);
    });

    it('reads an array index inside the range', () => {
      expect(required('tags.0').validate(withExtra({ tags: ['t0', 't1'] })).valid).toBe(true);
    });

    it('returns undefined for an array index outside the range', () => {
      expect(required('tags.10').validate(withExtra({ tags: ['t0', 't1'] })).valid).toBe(false);
    });

    it('reads a segment that is not all digits as an object key', () => {
      expect(required('a.0b').validate(withExtra({ a: { '0b': 'x' } })).valid).toBe(true);
    });

    it('returns undefined when the path passes through a primitive', () => {
      expect(required('name.length').validate(createEntity({ name: 'test' })).valid).toBe(false);
    });

    it('returns undefined for an empty path', () => {
      expect(required('').validate(createEntity()).valid).toBe(false);
    });
  });

  describe('rule builders (pinned before the extraction)', () => {
    const withField = (value: unknown): Entity => ({ ...createEntity(), f: value }) as Entity;

    it('names each of the seven builders', () => {
      expect(minLength('f', 1).name).toBe('minLength');
      expect(maxLength('f', 1).name).toBe('maxLength');
      expect(pattern('f', /x/).name).toBe('pattern');
      expect(range('f', 0, 1).name).toBe('range');
      expect(minItems('f', 1).name).toBe('minItems');
      expect(maxItems('f', 1).name).toBe('maxItems');
      expect(email('f').name).toBe('email');
    });

    it('builds the default messages', () => {
      expect(minLength('f', 3).message).toBe('f must be at least 3 characters');
      expect(maxLength('f', 3).message).toBe('f must be at most 3 characters');
      expect(pattern('f', /^x$/).message).toBe('f must match /^x$/');
      expect(pattern('f', /^x$/, 'a single x').message).toBe('f must match a single x');
      expect(pattern('f', /^x$/, '').message).toBe('f must match /^x$/');
      expect(range('f', 1, 5).message).toBe('f must be between 1 and 5');
      expect(minItems('f', 2).message).toBe('f must have at least 2 items');
      expect(maxItems('f', 2).message).toBe('f must have at most 2 items');
      expect(email('f').message).toBe('f must be a valid email address');
    });

    it('uses a given message instead of the default', () => {
      expect(minLength('f', 3, 'too short').message).toBe('too short');
      expect(email('f', 'bad mail').message).toBe('bad mail');
    });

    it('returns valid for a value of the wrong type', () => {
      expect(minLength('f', 3).validate(withField(5)).valid).toBe(true);
      expect(maxLength('f', 3).validate(withField(5)).valid).toBe(true);
      expect(pattern('f', /^x$/).validate(withField(5)).valid).toBe(true);
      expect(range('f', 1, 5).validate(withField('7')).valid).toBe(true);
      expect(minItems('f', 2).validate(withField('abc')).valid).toBe(true);
      expect(maxItems('f', 2).validate(withField({ length: 9 })).valid).toBe(true);
      expect(email('f').validate(withField(5)).valid).toBe(true);
    });

    it('returns valid when the field is missing', () => {
      const entity = createEntity();
      expect(minLength('f', 3).validate(entity).valid).toBe(true);
      expect(maxLength('f', 3).validate(entity).valid).toBe(true);
      expect(pattern('f', /^x$/).validate(entity).valid).toBe(true);
      expect(range('f', 1, 5).validate(entity).valid).toBe(true);
      expect(minItems('f', 2).validate(entity).valid).toBe(true);
      expect(maxItems('f', 2).validate(entity).valid).toBe(true);
      expect(email('f').validate(entity).valid).toBe(true);
    });

    it('checks the boundary values', () => {
      expect(minLength('f', 3).validate(withField('abc')).valid).toBe(true);
      expect(minLength('f', 3).validate(withField('ab')).valid).toBe(false);
      expect(maxLength('f', 3).validate(withField('abc')).valid).toBe(true);
      expect(maxLength('f', 3).validate(withField('abcd')).valid).toBe(false);
      expect(pattern('f', /^[A-Z]+$/).validate(withField('ABC')).valid).toBe(true);
      expect(pattern('f', /^[A-Z]+$/).validate(withField('abc')).valid).toBe(false);
      expect(range('f', 1, 5).validate(withField(1)).valid).toBe(true);
      expect(range('f', 1, 5).validate(withField(5)).valid).toBe(true);
      expect(range('f', 1, 5).validate(withField(0)).valid).toBe(false);
      expect(range('f', 1, 5).validate(withField(6)).valid).toBe(false);
      expect(minItems('f', 2).validate(withField(['a', 'b'])).valid).toBe(true);
      expect(minItems('f', 2).validate(withField(['a'])).valid).toBe(false);
      expect(maxItems('f', 2).validate(withField(['a', 'b'])).valid).toBe(true);
      expect(maxItems('f', 2).validate(withField(['a', 'b', 'c'])).valid).toBe(false);
      expect(email('f').validate(withField('a@b.co')).valid).toBe(true);
      expect(email('f').validate(withField('nope')).valid).toBe(false);
    });

    it('keeps the lastIndex state of a global pattern between calls', () => {
      const rule = pattern('f', /a/g);
      expect(rule.validate(withField('a')).valid).toBe(true);
      expect(rule.validate(withField('a')).valid).toBe(false);
      expect(rule.validate(withField('a')).valid).toBe(true);
    });
  });
});
