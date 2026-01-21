/**
 * Tests for Relation Validation Utilities
 *
 * Tests the validation functions in src/utils/relationValidation.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validateRelationMetadata,
  validateRelationsMetadata,
  allRelationsValidMetadata,
} from '../../../src/utils/relationValidation.js';
import type { Relation } from '../../../src/types/types.js';

// ==================== Test Fixtures ====================

function createRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    from: 'Alice',
    to: 'Bob',
    relationType: 'knows',
    ...overrides,
  };
}

// ==================== validateRelationMetadata Tests ====================

describe('validateRelationMetadata', () => {
  describe('Required Fields', () => {
    it('should pass for valid relation with required fields', () => {
      const result = validateRelationMetadata(createRelation());

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for missing from field', () => {
      const rel = createRelation({ from: '' });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'from')).toBe(true);
    });

    it('should fail for missing to field', () => {
      const rel = createRelation({ to: '' });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'to')).toBe(true);
    });

    it('should fail for missing relationType field', () => {
      const rel = createRelation({ relationType: '' });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'relationType')).toBe(true);
    });

    it('should fail for non-string from', () => {
      const rel = createRelation({ from: 123 as unknown as string });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'from')).toBe(true);
    });

    it('should fail for non-string to', () => {
      const rel = createRelation({ to: null as unknown as string });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'to')).toBe(true);
    });

    it('should fail for non-string relationType', () => {
      const rel = createRelation({ relationType: true as unknown as string });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'relationType')).toBe(true);
    });
  });

  describe('Weight Validation', () => {
    it('should pass for valid weight', () => {
      const rel = createRelation({ weight: 0.5 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for weight of 0', () => {
      const rel = createRelation({ weight: 0 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for weight of 1', () => {
      const rel = createRelation({ weight: 1 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should fail for weight below 0', () => {
      const rel = createRelation({ weight: -0.1 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'weight')).toBe(true);
      expect(result.errors.some(e => e.message.includes('between 0 and 1'))).toBe(true);
    });

    it('should fail for weight above 1', () => {
      const rel = createRelation({ weight: 1.5 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'weight')).toBe(true);
    });

    it('should fail for non-numeric weight', () => {
      const rel = createRelation({ weight: 'high' as unknown as number });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'weight' && e.message.includes('must be a number'))).toBe(true);
    });

    it('should fail for NaN weight', () => {
      const rel = createRelation({ weight: NaN });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'weight' && e.message.includes('NaN'))).toBe(true);
    });
  });

  describe('Confidence Validation', () => {
    it('should pass for valid confidence', () => {
      const rel = createRelation({ confidence: 0.9 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for confidence of 0', () => {
      const rel = createRelation({ confidence: 0 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for confidence of 1', () => {
      const rel = createRelation({ confidence: 1 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should fail for confidence below 0', () => {
      const rel = createRelation({ confidence: -0.5 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('should fail for confidence above 1', () => {
      const rel = createRelation({ confidence: 1.2 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence')).toBe(true);
    });

    it('should fail for non-numeric confidence', () => {
      const rel = createRelation({ confidence: 'high' as unknown as number });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence' && e.message.includes('must be a number'))).toBe(true);
    });

    it('should fail for NaN confidence', () => {
      const rel = createRelation({ confidence: NaN });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'confidence' && e.message.includes('NaN'))).toBe(true);
    });
  });

  describe('Temporal Validation', () => {
    it('should pass for valid validFrom', () => {
      const rel = createRelation({
        properties: { validFrom: '2024-01-01T00:00:00Z' },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for valid validUntil', () => {
      const rel = createRelation({
        properties: { validUntil: '2024-12-31T23:59:59Z' },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should fail for invalid validFrom date', () => {
      const rel = createRelation({
        properties: { validFrom: 'not-a-date' },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.validFrom')).toBe(true);
    });

    it('should fail for invalid validUntil date', () => {
      const rel = createRelation({
        properties: { validUntil: 'invalid' },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.validUntil')).toBe(true);
    });

    it('should fail when validFrom is after validUntil', () => {
      const rel = createRelation({
        properties: {
          validFrom: '2024-12-31',
          validUntil: '2024-01-01',
        },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.validFrom/validUntil')).toBe(true);
    });

    it('should pass when validFrom equals validUntil', () => {
      const rel = createRelation({
        properties: {
          validFrom: '2024-06-15',
          validUntil: '2024-06-15',
        },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Count Validation', () => {
    it('should pass for valid confirmationCount', () => {
      const rel = createRelation({
        properties: { confirmationCount: 5 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should pass for confirmationCount of 0', () => {
      const rel = createRelation({
        properties: { confirmationCount: 0 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should fail for negative confirmationCount', () => {
      const rel = createRelation({
        properties: { confirmationCount: -1 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.confirmationCount')).toBe(true);
    });

    it('should fail for non-integer confirmationCount', () => {
      const rel = createRelation({
        properties: { confirmationCount: 2.5 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.confirmationCount')).toBe(true);
    });

    it('should fail for non-numeric confirmationCount', () => {
      const rel = createRelation({
        properties: { confirmationCount: 'many' as unknown as number },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.confirmationCount')).toBe(true);
    });

    it('should pass for valid contradictionCount', () => {
      const rel = createRelation({
        properties: { contradictionCount: 2 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
    });

    it('should fail for negative contradictionCount', () => {
      const rel = createRelation({
        properties: { contradictionCount: -3 },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === 'properties.contradictionCount')).toBe(true);
    });
  });

  describe('Warnings', () => {
    it('should warn for self-referential relation', () => {
      const rel = createRelation({ from: 'Alice', to: 'Alice' });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.field === 'from/to' && w.message.includes('self-referential'))).toBe(true);
    });

    it('should warn for low confidence', () => {
      const rel = createRelation({ confidence: 0.3 });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.field === 'confidence' && w.message.includes('low confidence'))).toBe(true);
    });

    it('should not warn for high confidence', () => {
      const rel = createRelation({ confidence: 0.8 });
      const result = validateRelationMetadata(rel);

      expect(result.warnings.filter(w => w.field === 'confidence')).toHaveLength(0);
    });

    it('should include suggestion in warning', () => {
      const rel = createRelation({ from: 'A', to: 'A' });
      const result = validateRelationMetadata(rel);

      const selfRefWarning = result.warnings.find(w => w.field === 'from/to');
      expect(selfRefWarning?.suggestion).toBeDefined();
    });
  });

  describe('Error Details', () => {
    it('should include value in error', () => {
      const rel = createRelation({ weight: 1.5 });
      const result = validateRelationMetadata(rel);

      const weightError = result.errors.find(e => e.field === 'weight');
      expect(weightError?.value).toBe(1.5);
    });

    it('should include object value for temporal error', () => {
      const rel = createRelation({
        properties: {
          validFrom: '2024-12-31',
          validUntil: '2024-01-01',
        },
      });
      const result = validateRelationMetadata(rel);

      const temporalError = result.errors.find(e => e.field === 'properties.validFrom/validUntil');
      expect(temporalError?.value).toEqual({
        validFrom: '2024-12-31',
        validUntil: '2024-01-01',
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should collect multiple errors', () => {
      const rel = {
        from: '',
        to: '',
        relationType: '',
        weight: 2,
        confidence: -1,
      };
      const result = validateRelationMetadata(rel as Relation);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
    });

    it('should pass for fully valid relation', () => {
      const rel = createRelation({
        weight: 0.8,
        confidence: 0.95,
        properties: {
          validFrom: '2024-01-01',
          validUntil: '2024-12-31',
          bidirectional: true,
          confirmationCount: 3,
          contradictionCount: 0,
        },
      });
      const result = validateRelationMetadata(rel);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// ==================== validateRelationsMetadata Tests ====================

describe('validateRelationsMetadata', () => {
  it('should validate array of relations', () => {
    const relations = [
      createRelation(),
      createRelation({ from: 'Charlie', to: 'Dave' }),
      createRelation({ weight: 1.5 }), // Invalid
    ];

    const results = validateRelationsMetadata(relations);

    expect(results).toHaveLength(3);
    expect(results[0].isValid).toBe(true);
    expect(results[1].isValid).toBe(true);
    expect(results[2].isValid).toBe(false);
  });

  it('should return results in same order as input', () => {
    const relations = [
      createRelation({ from: 'A', to: 'B' }),
      createRelation({ from: 'C', to: 'D' }),
    ];

    const results = validateRelationsMetadata(relations);

    expect(results[0].isValid).toBe(true);
    expect(results[1].isValid).toBe(true);
  });

  it('should handle empty array', () => {
    const results = validateRelationsMetadata([]);

    expect(results).toHaveLength(0);
  });
});

// ==================== allRelationsValidMetadata Tests ====================

describe('allRelationsValidMetadata', () => {
  it('should return true when all relations are valid', () => {
    const relations = [
      createRelation(),
      createRelation({ from: 'Charlie', to: 'Dave', weight: 0.5 }),
      createRelation({ from: 'Eve', to: 'Frank', confidence: 0.9 }),
    ];

    expect(allRelationsValidMetadata(relations)).toBe(true);
  });

  it('should return false when any relation is invalid', () => {
    const relations = [
      createRelation(),
      createRelation({ weight: 1.5 }), // Invalid
      createRelation({ from: 'Eve', to: 'Frank' }),
    ];

    expect(allRelationsValidMetadata(relations)).toBe(false);
  });

  it('should return true for empty array', () => {
    expect(allRelationsValidMetadata([])).toBe(true);
  });

  it('should return false when first relation is invalid', () => {
    const relations = [
      createRelation({ from: '' }), // Invalid
      createRelation(),
    ];

    expect(allRelationsValidMetadata(relations)).toBe(false);
  });

  it('should return false when last relation is invalid', () => {
    const relations = [
      createRelation(),
      createRelation({ relationType: '' }), // Invalid
    ];

    expect(allRelationsValidMetadata(relations)).toBe(false);
  });
});
