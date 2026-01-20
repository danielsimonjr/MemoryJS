/**
 * Tests for Entity Validator
 *
 * @module tests/unit/utils/EntityValidator.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EntityValidator,
  EntityValidationRule,
  EntityRuleResult,
} from '../../../src/utils/EntityValidator.js';
import { required, minLength, maxLength, asWarning, range } from '../../../src/utils/validators.js';
import type { Entity } from '../../../src/types/types.js';

const createEntity = (overrides: Partial<Entity> = {}): Entity => ({
  name: 'TestEntity',
  entityType: 'test',
  observations: [],
  ...overrides,
});

describe('EntityValidator', () => {
  let validator: EntityValidator;

  beforeEach(() => {
    validator = new EntityValidator();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const v = new EntityValidator();
      expect(v.getRules()).toHaveLength(0);
    });

    it('should create with rules', () => {
      const v = new EntityValidator({
        rules: [required('name')],
      });
      expect(v.getRules()).toHaveLength(1);
    });

    it('should create with failFast option', async () => {
      const v = new EntityValidator({
        rules: [required('name'), required('entityType')],
        failFast: true,
      });
      const entity = createEntity({ name: '', entityType: '' });
      const result = await v.validate(entity);
      // With failFast, should stop after first error
      expect(result.errors.length).toBe(1);
    });

    it('should create with strict option', async () => {
      const v = new EntityValidator({
        rules: [asWarning(required('importance'))],
        strict: true,
      });
      const entity = createEntity();
      const result = await v.validate(entity);
      // With strict, warnings count as invalid
      expect(result.isValid).toBe(false);
    });
  });

  describe('Rule Management', () => {
    it('should add single rule', () => {
      validator.addRule(required('name'));
      expect(validator.getRules()).toHaveLength(1);
    });

    it('should chain addRule calls', () => {
      validator.addRule(required('name')).addRule(minLength('name', 3));
      expect(validator.getRules()).toHaveLength(2);
    });

    it('should add multiple rules', () => {
      validator.addRules([required('name'), minLength('name', 3), maxLength('name', 50)]);
      expect(validator.getRules()).toHaveLength(3);
    });

    it('should return copy of rules from getRules', () => {
      validator.addRule(required('name'));
      const rules = validator.getRules();
      rules.push(required('entityType'));
      expect(validator.getRules()).toHaveLength(1);
    });

    it('should clear all rules', () => {
      validator.addRules([required('name'), minLength('name', 3)]);
      validator.clearRules();
      expect(validator.getRules()).toHaveLength(0);
    });

    it('should chain clearRules', () => {
      const result = validator.addRule(required('name')).clearRules();
      expect(result).toBe(validator);
    });
  });

  describe('Validate', () => {
    it('should return valid for empty rules', async () => {
      const entity = createEntity();
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid for passing rules', async () => {
      validator.addRules([required('name'), minLength('name', 3)]);
      const entity = createEntity({ name: 'Alice' });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(true);
    });

    it('should return invalid for failing rules', async () => {
      validator.addRule(required('name'));
      const entity = createEntity({ name: '' });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should collect multiple errors', async () => {
      validator.addRules([required('name'), required('entityType')]);
      const entity = createEntity({ name: '', entityType: '' });
      const result = await validator.validate(entity);
      expect(result.errors.length).toBe(2);
    });

    it('should include entity in result', async () => {
      const entity = createEntity({ name: 'Alice' });
      const result = await validator.validate(entity);
      expect(result.entity).toBe(entity);
    });

    it('should include field value in error', async () => {
      validator.addRule(minLength('name', 5));
      const entity = createEntity({ name: 'Al' });
      const result = await validator.validate(entity);
      expect(result.errors[0].value).toBe('Al');
    });

    it('should include rule name in error', async () => {
      validator.addRule(required('name'));
      const entity = createEntity({ name: '' });
      const result = await validator.validate(entity);
      expect(result.errors[0].rule).toBe('required');
    });
  });

  describe('Severity Handling', () => {
    it('should separate errors and warnings', async () => {
      validator.addRules([
        required('name'),
        asWarning(required('importance')),
      ]);
      const entity = createEntity({ name: '', importance: undefined });
      const result = await validator.validate(entity);
      expect(result.errors.length).toBe(1);
      expect(result.warnings.length).toBe(1);
    });

    it('should be valid with only warnings', async () => {
      validator.addRule(asWarning(required('importance')));
      const entity = createEntity({ importance: undefined });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBe(1);
    });

    it('should be invalid with errors and warnings', async () => {
      validator.addRules([
        required('name'),
        asWarning(required('importance')),
      ]);
      const entity = createEntity({ name: '', importance: undefined });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Async Validation', () => {
    it('should handle async rules', async () => {
      const asyncRule: EntityValidationRule = {
        name: 'asyncCheck',
        field: 'name',
        message: 'Async validation failed',
        validate: async (entity: Entity): Promise<EntityRuleResult> => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { valid: (entity.name?.length || 0) > 3 };
        },
      };
      validator.addRule(asyncRule);
      const entity = createEntity({ name: 'Alice' });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(true);
    });

    it('should handle mixed sync and async rules', async () => {
      const asyncRule: EntityValidationRule = {
        name: 'asyncCheck',
        field: 'name',
        message: 'Async check',
        validate: async (): Promise<EntityRuleResult> => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { valid: true };
        },
      };
      validator.addRules([required('name'), asyncRule]);
      const entity = createEntity({ name: 'Alice' });
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should catch validation errors', async () => {
      const throwingRule: EntityValidationRule = {
        name: 'throwing',
        field: 'name',
        message: 'Will throw',
        validate: (): EntityRuleResult => {
          throw new Error('Validation exploded');
        },
      };
      validator.addRule(throwingRule);
      const entity = createEntity();
      const result = await validator.validate(entity);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('Validation exploded');
    });

    it('should continue after error in non-failFast mode', async () => {
      const throwingRule: EntityValidationRule = {
        name: 'throwing',
        field: 'name',
        message: 'Will throw',
        validate: (): EntityRuleResult => {
          throw new Error('Boom');
        },
      };
      validator.addRules([throwingRule, required('entityType')]);
      const entity = createEntity({ entityType: '' });
      const result = await validator.validate(entity);
      // Should have both errors
      expect(result.errors.length).toBe(2);
    });
  });

  describe('FailFast Mode', () => {
    it('should stop on first error when failFast', async () => {
      const v = new EntityValidator({ failFast: true });
      v.addRules([
        required('name'),
        required('entityType'),
        required('observations'),
      ]);
      const entity = createEntity({ name: '', entityType: '', observations: [] });
      const result = await v.validate(entity);
      expect(result.errors.length).toBe(1);
    });

    it('should not stop on warnings when failFast', async () => {
      const v = new EntityValidator({ failFast: true });
      v.addRules([
        asWarning(required('importance')),
        required('name'),
      ]);
      const entity = createEntity({ importance: undefined, name: '' });
      const result = await v.validate(entity);
      // Warning should not stop, error should be collected
      expect(result.errors.length).toBe(1);
      expect(result.warnings.length).toBe(1);
    });
  });

  describe('Strict Mode', () => {
    it('should treat warnings as errors in strict mode', async () => {
      const v = new EntityValidator({ strict: true });
      v.addRule(asWarning(required('importance')));
      const entity = createEntity({ importance: undefined });
      const result = await v.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should be valid when no warnings or errors in strict mode', async () => {
      const v = new EntityValidator({ strict: true });
      v.addRules([required('name'), asWarning(range('importance', 0, 10))]);
      const entity = createEntity({ name: 'Alice', importance: 5 });
      const result = await v.validate(entity);
      expect(result.isValid).toBe(true);
    });
  });

  describe('ValidateAll', () => {
    it('should validate multiple entities', async () => {
      validator.addRule(required('name'));
      const entities = [
        createEntity({ name: 'Alice' }),
        createEntity({ name: '' }),
        createEntity({ name: 'Charlie' }),
      ];
      const results = await validator.validateAll(entities);
      expect(results.size).toBe(3);
      expect(results.get('Alice')?.isValid).toBe(true);
      expect(results.get('')?.isValid).toBe(false);
      expect(results.get('Charlie')?.isValid).toBe(true);
    });

    it('should key results by entity name', async () => {
      const entities = [
        createEntity({ name: 'Entity1' }),
        createEntity({ name: 'Entity2' }),
      ];
      const results = await validator.validateAll(entities);
      expect(results.has('Entity1')).toBe(true);
      expect(results.has('Entity2')).toBe(true);
    });
  });

  describe('ValidateSync', () => {
    it('should validate synchronously', () => {
      validator.addRules([required('name'), minLength('name', 3)]);
      const entity = createEntity({ name: 'Alice' });
      const result = validator.validateSync(entity);
      expect(result.isValid).toBe(true);
    });

    it('should fail for invalid entity', () => {
      validator.addRule(required('name'));
      const entity = createEntity({ name: '' });
      const result = validator.validateSync(entity);
      expect(result.isValid).toBe(false);
    });

    it('should throw for async rules', () => {
      const asyncRule: EntityValidationRule = {
        name: 'async',
        field: 'name',
        message: 'Async',
        validate: async (): Promise<EntityRuleResult> => ({ valid: true }),
      };
      validator.addRule(asyncRule);
      const entity = createEntity();
      const result = validator.validateSync(entity);
      // Should catch the async error
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('async');
    });

    it('should handle failFast in sync mode', () => {
      const v = new EntityValidator({ failFast: true });
      v.addRules([required('name'), required('entityType')]);
      const entity = createEntity({ name: '', entityType: '' });
      const result = v.validateSync(entity);
      expect(result.errors.length).toBe(1);
    });

    it('should handle strict mode in sync', () => {
      const v = new EntityValidator({ strict: true });
      v.addRule(asWarning(required('importance')));
      const entity = createEntity({ importance: undefined });
      const result = v.validateSync(entity);
      expect(result.isValid).toBe(false);
    });

    it('should catch throwing rules in sync', () => {
      const throwingRule: EntityValidationRule = {
        name: 'throwing',
        field: 'name',
        message: 'Will throw',
        validate: (): EntityRuleResult => {
          throw new Error('Sync boom');
        },
      };
      validator.addRule(throwingRule);
      const entity = createEntity();
      const result = validator.validateSync(entity);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('Sync boom');
    });
  });

  describe('Custom Message Override', () => {
    it('should use rule result message if provided', async () => {
      const ruleWithMessage: EntityValidationRule = {
        name: 'custom',
        field: 'name',
        message: 'Default message',
        validate: (): EntityRuleResult => ({
          valid: false,
          message: 'Custom error message',
        }),
      };
      validator.addRule(ruleWithMessage);
      const entity = createEntity();
      const result = await validator.validate(entity);
      expect(result.errors[0].message).toBe('Custom error message');
    });

    it('should use rule message if result has no message', async () => {
      validator.addRule(required('name'));
      const entity = createEntity({ name: '' });
      const result = await validator.validate(entity);
      expect(result.errors[0].message).toBe('name is required');
    });
  });

  describe('Field Value Access', () => {
    it('should access nested object fields', async () => {
      const customRule: EntityValidationRule = {
        name: 'custom',
        field: 'metadata.key',
        message: 'Required',
        validate: (): EntityRuleResult => ({ valid: false }),
      };
      validator.addRule(customRule);
      const entity = {
        ...createEntity(),
        metadata: { key: 'value' },
      } as Entity;
      const result = await validator.validate(entity);
      expect(result.errors[0].value).toBe('value');
    });

    it('should access array elements', async () => {
      const customRule: EntityValidationRule = {
        name: 'custom',
        field: 'observations.0',
        message: 'Required',
        validate: (): EntityRuleResult => ({ valid: false }),
      };
      validator.addRule(customRule);
      const entity = createEntity({ observations: ['first', 'second'] });
      const result = await validator.validate(entity);
      expect(result.errors[0].value).toBe('first');
    });

    it('should return undefined for missing path', async () => {
      const customRule: EntityValidationRule = {
        name: 'custom',
        field: 'deeply.nested.missing',
        message: 'Required',
        validate: (): EntityRuleResult => ({ valid: false }),
      };
      validator.addRule(customRule);
      const entity = createEntity();
      const result = await validator.validate(entity);
      expect(result.errors[0].value).toBeUndefined();
    });
  });
});
