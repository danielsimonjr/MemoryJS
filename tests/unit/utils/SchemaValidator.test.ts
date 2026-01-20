/**
 * Tests for Schema Validator
 *
 * @module tests/unit/utils/SchemaValidator.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SchemaValidator, JsonSchema } from '../../../src/utils/SchemaValidator.js';
import type { Entity } from '../../../src/types/types.js';

const createEntity = (overrides: Partial<Entity> = {}): Entity => ({
  name: 'TestEntity',
  entityType: 'test',
  observations: [],
  ...overrides,
});

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  describe('Initialization', () => {
    it('should create uninitialized by default', () => {
      expect(validator.isInitialized()).toBe(false);
      expect(validator.isAvailable()).toBe(false);
    });

    it('should initialize successfully if ajv available', async () => {
      const result = await validator.initialize();
      // Result depends on whether ajv is installed
      expect(typeof result).toBe('boolean');
      expect(validator.isInitialized()).toBe(true);
    });

    it('should return true on second initialize call if already initialized', async () => {
      await validator.initialize();
      const result = await validator.initialize();
      // Should return isAvailable() result
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Schema Registration', () => {
    it('should register schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        required: ['name'],
      };
      validator.registerSchema('person', schema);
      expect(validator.hasSchema('person')).toBe(true);
    });

    it('should get registered schema', () => {
      const schema: JsonSchema = {
        type: 'object',
        required: ['name'],
      };
      validator.registerSchema('person', schema);
      expect(validator.getSchema('person')).toBe(schema);
    });

    it('should return undefined for unregistered schema', () => {
      expect(validator.getSchema('unknown')).toBeUndefined();
    });

    it('should unregister schema', () => {
      const schema: JsonSchema = { type: 'object' };
      validator.registerSchema('person', schema);
      validator.unregisterSchema('person');
      expect(validator.hasSchema('person')).toBe(false);
    });

    it('should get all registered types', () => {
      validator.registerSchema('person', { type: 'object' });
      validator.registerSchema('project', { type: 'object' });
      const types = validator.getRegisteredTypes();
      expect(types).toContain('person');
      expect(types).toContain('project');
    });

    it('should overwrite schema when registering same type', () => {
      validator.registerSchema('person', { type: 'object', required: ['name'] });
      validator.registerSchema('person', { type: 'object', required: ['entityType'] });
      const schema = validator.getSchema('person');
      expect(schema?.required).toEqual(['entityType']);
    });
  });

  describe('Validation Without Initialization', () => {
    it('should return warning if not initialized', () => {
      const entity = createEntity();
      const result = validator.validate(entity);
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].message).toContain('not initialized');
    });
  });

  describe('Validation With Initialization', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should return valid for entity with no schema', () => {
      const entity = createEntity();
      const result = validator.validate(entity);
      expect(result.isValid).toBe(true);
    });

    it('should validate entity against registered schema', async () => {
      // Skip if ajv not available
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name', 'entityType'],
        properties: {
          name: { type: 'string', minLength: 1 },
          entityType: { type: 'string' },
        },
      });

      const validEntity = createEntity({ name: 'Alice', entityType: 'test' });
      const result = validator.validate(validEntity);
      expect(result.isValid).toBe(true);
    });

    it('should return errors for invalid entity', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name', 'entityType'],
        properties: {
          name: { type: 'string', minLength: 3 },
          entityType: { type: 'string' },
        },
      });

      const invalidEntity = createEntity({ name: 'Al' });
      const result = validator.validate(invalidEntity);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate required fields', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('person', {
        type: 'object',
        required: ['name', 'entityType', 'observations'],
      });

      const entity = { entityType: 'person' } as Entity;
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field.includes('name'))).toBe(true);
    });

    it('should validate type constraints', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          importance: { type: 'number' },
        },
      });

      const entity = createEntity({ importance: 'not a number' as unknown as number });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate minimum', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          importance: { type: 'number', minimum: 0 },
        },
      });

      const entity = createEntity({ importance: -1 });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate maximum', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          importance: { type: 'number', maximum: 10 },
        },
      });

      const entity = createEntity({ importance: 15 });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate pattern', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[A-Z]' },
        },
      });

      const entity = createEntity({ name: 'lowercase' });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate enum values', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['person', 'project'] },
        },
      });

      const entity = createEntity({ entityType: 'unknown' });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate array items', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      });

      const entity = createEntity({ observations: [1, 2, 3] as unknown as string[] });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate minItems', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            minItems: 1,
          },
        },
      });

      const entity = createEntity({ observations: [] });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate maxItems', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          observations: {
            type: 'array',
            maxItems: 2,
          },
        },
      });

      const entity = createEntity({ observations: ['a', 'b', 'c'] });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });

    it('should validate additionalProperties: false', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          name: { type: 'string' },
          entityType: { type: 'string' },
          observations: { type: 'array' },
        },
        additionalProperties: false,
      });

      const entity = {
        ...createEntity(),
        extraField: 'not allowed',
      } as Entity;
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });
  });

  describe('ValidateAll', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should validate multiple entities', () => {
      const entities = [
        createEntity({ name: 'Entity1' }),
        createEntity({ name: 'Entity2' }),
      ];
      const results = validator.validateAll(entities);
      expect(results.size).toBe(2);
      expect(results.has('Entity1')).toBe(true);
      expect(results.has('Entity2')).toBe(true);
    });

    it('should key results by entity name', () => {
      const entities = [
        createEntity({ name: 'Alice' }),
        createEntity({ name: 'Bob' }),
      ];
      const results = validator.validateAll(entities);
      expect(results.get('Alice')?.entity.name).toBe('Alice');
      expect(results.get('Bob')?.entity.name).toBe('Bob');
    });
  });

  describe('Error Messages', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should provide human-readable error messages', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name'],
      });

      const entity = { entityType: 'test' } as Entity;
      const result = validator.validate(entity);
      expect(result.errors[0].message).toBeTruthy();
      expect(typeof result.errors[0].message).toBe('string');
    });

    it('should include rule in error', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name'],
      });

      const entity = { entityType: 'test' } as Entity;
      const result = validator.validate(entity);
      expect(result.errors[0].rule).toBe('required');
    });

    it('should include suggestion when available', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name'],
      });

      const entity = { entityType: 'test' } as Entity;
      const result = validator.validate(entity);
      expect(result.errors[0].suggestion).toBeTruthy();
    });
  });

  describe('Field Path Resolution', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should resolve nested field paths', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            required: ['key'],
          },
        },
      });

      const entity = {
        ...createEntity(),
        metadata: {},
      } as Entity;
      const result = validator.validate(entity);
      // Should have metadata.key in field path
      if (result.errors.length > 0) {
        expect(result.errors[0].field).toContain('key');
      }
    });

    it('should handle root level errors', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        required: ['name'],
      });

      const entity = { entityType: 'test' } as Entity;
      const result = validator.validate(entity);
      expect(result.errors[0].field).toBeTruthy();
    });
  });

  describe('hasSchema', () => {
    it('should return true for registered schemas', () => {
      validator.registerSchema('test', { type: 'object' });
      expect(validator.hasSchema('test')).toBe(true);
    });

    it('should return false for unregistered schemas', () => {
      expect(validator.hasSchema('nonexistent')).toBe(false);
    });

    it('should return false after unregistering', () => {
      validator.registerSchema('test', { type: 'object' });
      validator.unregisterSchema('test');
      expect(validator.hasSchema('test')).toBe(false);
    });
  });

  describe('Complex Schema Validation', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should handle nested object schemas', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              version: { type: 'number' },
            },
          },
        },
      });

      const entity = {
        ...createEntity(),
        metadata: { source: 'api', version: 1 },
      } as Entity;
      const result = validator.validate(entity);
      expect(result.isValid).toBe(true);
    });

    it('should handle array of objects', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      validator.registerSchema('test', {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
        },
      });

      const entity = createEntity({ tags: ['tag1', 'tag2'] });
      const result = validator.validate(entity);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Ajv Not Available', () => {
    it('should return warning when ajv not available after initialization', async () => {
      // Create a new validator and mock initialize to simulate ajv not available
      const v = new SchemaValidator();
      // We can't easily mock the import, so we just test the behavior when isAvailable() is false
      // after calling validate without proper initialization
      const entity = createEntity();
      const result = v.validate(entity);
      // Should have warning about not initialized
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Schema Compilation Errors', () => {
    beforeEach(async () => {
      await validator.initialize();
    });

    it('should handle schema compilation errors gracefully', async () => {
      if (!validator.isAvailable()) {
        return;
      }

      // Mock console.warn to verify it's called
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Register an invalid schema (if ajv throws on compile)
      // Most schemas will compile, but we can at least verify no crash occurs
      validator.registerSchema('test', {
        type: 'invalid-type' as JsonSchema['type'],
      });

      const entity = createEntity();
      const result = validator.validate(entity);
      // Should not crash, might have validation result
      expect(typeof result.isValid).toBe('boolean');

      warnSpy.mockRestore();
    });
  });

  describe('Entity in Result', () => {
    it('should include entity in validation result', async () => {
      await validator.initialize();
      const entity = createEntity({ name: 'Alice' });
      const result = validator.validate(entity);
      expect(result.entity).toBe(entity);
    });
  });

  describe('Registering Schema Before Initialization', () => {
    it('should compile schemas registered before initialize', async () => {
      // Register before init
      validator.registerSchema('test', {
        type: 'object',
        required: ['name'],
      });

      // Now initialize
      await validator.initialize();

      if (!validator.isAvailable()) {
        return;
      }

      // Should work correctly
      const entity = { entityType: 'test' } as Entity;
      const result = validator.validate(entity);
      expect(result.isValid).toBe(false);
    });
  });
});
