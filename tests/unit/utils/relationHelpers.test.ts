/**
 * Tests for Relation Helper Utilities
 *
 * Tests the type guards and RelationBuilder in src/utils/relationHelpers.ts
 */

import { describe, it, expect } from 'vitest';
import {
  isWeightedRelation,
  isTemporalRelation,
  isBidirectionalRelation,
  hasConfidence,
  isCurrentlyValid,
  RelationBuilder,
} from '../../../src/utils/relationHelpers.js';
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

// ==================== Type Guard Tests ====================

describe('isWeightedRelation', () => {
  it('should return true for relation with numeric weight', () => {
    const rel = createRelation({ weight: 0.5 });
    expect(isWeightedRelation(rel)).toBe(true);
  });

  it('should return true for weight of 0', () => {
    const rel = createRelation({ weight: 0 });
    expect(isWeightedRelation(rel)).toBe(true);
  });

  it('should return true for weight of 1', () => {
    const rel = createRelation({ weight: 1 });
    expect(isWeightedRelation(rel)).toBe(true);
  });

  it('should return false for relation without weight', () => {
    const rel = createRelation();
    expect(isWeightedRelation(rel)).toBe(false);
  });

  it('should return false for undefined weight', () => {
    const rel = createRelation({ weight: undefined });
    expect(isWeightedRelation(rel)).toBe(false);
  });
});

describe('isTemporalRelation', () => {
  it('should return true for relation with validFrom', () => {
    const rel = createRelation({
      properties: { validFrom: '2024-01-01T00:00:00Z' },
    });
    expect(isTemporalRelation(rel)).toBe(true);
  });

  it('should return false for relation without properties', () => {
    const rel = createRelation();
    expect(isTemporalRelation(rel)).toBe(false);
  });

  it('should return false for relation with empty properties', () => {
    const rel = createRelation({ properties: {} });
    expect(isTemporalRelation(rel)).toBe(false);
  });

  it('should return false for relation with only validUntil', () => {
    const rel = createRelation({
      properties: { validUntil: '2024-12-31T23:59:59Z' },
    });
    expect(isTemporalRelation(rel)).toBe(false);
  });
});

describe('isBidirectionalRelation', () => {
  it('should return true for bidirectional relation', () => {
    const rel = createRelation({
      properties: { bidirectional: true },
    });
    expect(isBidirectionalRelation(rel)).toBe(true);
  });

  it('should return false when bidirectional is false', () => {
    const rel = createRelation({
      properties: { bidirectional: false },
    });
    expect(isBidirectionalRelation(rel)).toBe(false);
  });

  it('should return false for relation without properties', () => {
    const rel = createRelation();
    expect(isBidirectionalRelation(rel)).toBe(false);
  });

  it('should return false when bidirectional not specified', () => {
    const rel = createRelation({
      properties: { source: 'test' },
    });
    expect(isBidirectionalRelation(rel)).toBe(false);
  });
});

describe('hasConfidence', () => {
  it('should return true for relation with numeric confidence', () => {
    const rel = createRelation({ confidence: 0.9 });
    expect(hasConfidence(rel)).toBe(true);
  });

  it('should return true for confidence of 0', () => {
    const rel = createRelation({ confidence: 0 });
    expect(hasConfidence(rel)).toBe(true);
  });

  it('should return false for relation without confidence', () => {
    const rel = createRelation();
    expect(hasConfidence(rel)).toBe(false);
  });

  it('should return false for undefined confidence', () => {
    const rel = createRelation({ confidence: undefined });
    expect(hasConfidence(rel)).toBe(false);
  });
});

describe('isCurrentlyValid', () => {
  it('should return true for relation without temporal constraints', () => {
    const rel = createRelation();
    expect(isCurrentlyValid(rel)).toBe(true);
  });

  it('should return true for relation with empty properties', () => {
    const rel = createRelation({ properties: {} });
    expect(isCurrentlyValid(rel)).toBe(true);
  });

  it('should return true when reference date is after validFrom', () => {
    const rel = createRelation({
      properties: { validFrom: '2020-01-01T00:00:00Z' },
    });
    const refDate = new Date('2024-01-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(true);
  });

  it('should return false when reference date is before validFrom', () => {
    const rel = createRelation({
      properties: { validFrom: '2024-06-01T00:00:00Z' },
    });
    const refDate = new Date('2024-01-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(false);
  });

  it('should return true when reference date is before validUntil', () => {
    const rel = createRelation({
      properties: { validUntil: '2025-12-31T23:59:59Z' },
    });
    const refDate = new Date('2024-01-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(true);
  });

  it('should return false when reference date is after validUntil', () => {
    const rel = createRelation({
      properties: { validUntil: '2023-12-31T23:59:59Z' },
    });
    const refDate = new Date('2024-01-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(false);
  });

  it('should return true when reference date is within valid range', () => {
    const rel = createRelation({
      properties: {
        validFrom: '2024-01-01T00:00:00Z',
        validUntil: '2024-12-31T23:59:59Z',
      },
    });
    const refDate = new Date('2024-06-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(true);
  });

  it('should return false when reference date is outside valid range', () => {
    const rel = createRelation({
      properties: {
        validFrom: '2024-01-01T00:00:00Z',
        validUntil: '2024-12-31T23:59:59Z',
      },
    });
    const refDate = new Date('2025-06-15T00:00:00Z');
    expect(isCurrentlyValid(rel, refDate)).toBe(false);
  });

  it('should use current date when no reference date provided', () => {
    const futureRel = createRelation({
      properties: { validFrom: '2099-01-01T00:00:00Z' },
    });
    expect(isCurrentlyValid(futureRel)).toBe(false);

    const pastRel = createRelation({
      properties: { validFrom: '2000-01-01T00:00:00Z' },
    });
    expect(isCurrentlyValid(pastRel)).toBe(true);
  });
});

// ==================== RelationBuilder Tests ====================

describe('RelationBuilder', () => {
  describe('Constructor', () => {
    it('should create builder with from, to, relationType', () => {
      const builder = new RelationBuilder('Alice', 'Bob', 'knows');
      const rel = builder.build();

      expect(rel.from).toBe('Alice');
      expect(rel.to).toBe('Bob');
      expect(rel.relationType).toBe('knows');
    });

    it('should set createdAt on build', () => {
      const rel = new RelationBuilder('A', 'B', 'type').build();

      expect(rel.createdAt).toBeDefined();
      expect(new Date(rel.createdAt!).toISOString()).toBe(rel.createdAt);
    });
  });

  describe('withWeight', () => {
    it('should set weight value', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withWeight(0.5)
        .build();

      expect(rel.weight).toBe(0.5);
    });

    it('should accept weight of 0', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withWeight(0)
        .build();

      expect(rel.weight).toBe(0);
    });

    it('should accept weight of 1', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withWeight(1)
        .build();

      expect(rel.weight).toBe(1);
    });

    it('should throw for weight below 0', () => {
      expect(() => {
        new RelationBuilder('A', 'B', 'type').withWeight(-0.1);
      }).toThrow('Weight must be between 0 and 1');
    });

    it('should throw for weight above 1', () => {
      expect(() => {
        new RelationBuilder('A', 'B', 'type').withWeight(1.1);
      }).toThrow('Weight must be between 0 and 1');
    });

    it('should return this for chaining', () => {
      const builder = new RelationBuilder('A', 'B', 'type');
      const result = builder.withWeight(0.5);

      expect(result).toBe(builder);
    });
  });

  describe('withConfidence', () => {
    it('should set confidence value', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withConfidence(0.95)
        .build();

      expect(rel.confidence).toBe(0.95);
    });

    it('should accept confidence of 0', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withConfidence(0)
        .build();

      expect(rel.confidence).toBe(0);
    });

    it('should accept confidence of 1', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withConfidence(1)
        .build();

      expect(rel.confidence).toBe(1);
    });

    it('should throw for confidence below 0', () => {
      expect(() => {
        new RelationBuilder('A', 'B', 'type').withConfidence(-0.1);
      }).toThrow('Confidence must be between 0 and 1');
    });

    it('should throw for confidence above 1', () => {
      expect(() => {
        new RelationBuilder('A', 'B', 'type').withConfidence(1.5);
      }).toThrow('Confidence must be between 0 and 1');
    });
  });

  describe('bidirectional', () => {
    it('should set bidirectional to true by default', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .bidirectional()
        .build();

      expect(rel.properties?.bidirectional).toBe(true);
    });

    it('should set bidirectional to false when specified', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .bidirectional(false)
        .build();

      expect(rel.properties?.bidirectional).toBe(false);
    });

    it('should preserve existing properties', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withSource('test')
        .bidirectional()
        .build();

      expect(rel.properties?.source).toBe('test');
      expect(rel.properties?.bidirectional).toBe(true);
    });
  });

  describe('validFrom', () => {
    it('should set validFrom date', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .validFrom('2024-01-01T00:00:00Z')
        .build();

      expect(rel.properties?.validFrom).toBe('2024-01-01T00:00:00Z');
    });

    it('should preserve existing properties', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .bidirectional()
        .validFrom('2024-01-01')
        .build();

      expect(rel.properties?.bidirectional).toBe(true);
      expect(rel.properties?.validFrom).toBe('2024-01-01');
    });
  });

  describe('validUntil', () => {
    it('should set validUntil date', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .validUntil('2024-12-31T23:59:59Z')
        .build();

      expect(rel.properties?.validUntil).toBe('2024-12-31T23:59:59Z');
    });
  });

  describe('withSource', () => {
    it('should set source', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withSource('manual_entry')
        .build();

      expect(rel.properties?.source).toBe('manual_entry');
    });
  });

  describe('withMethod', () => {
    it('should set method', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withMethod('inferred')
        .build();

      expect(rel.properties?.method).toBe('inferred');
    });
  });

  describe('withMetadata', () => {
    it('should set metadata', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withMetadata({ key: 'value' })
        .build();

      expect(rel.metadata?.key).toBe('value');
    });

    it('should merge metadata on multiple calls', () => {
      const rel = new RelationBuilder('A', 'B', 'type')
        .withMetadata({ key1: 'value1' })
        .withMetadata({ key2: 'value2' })
        .build();

      expect(rel.metadata?.key1).toBe('value1');
      expect(rel.metadata?.key2).toBe('value2');
    });
  });

  describe('build', () => {
    it('should return a copy of the relation', () => {
      const builder = new RelationBuilder('A', 'B', 'type');
      const rel1 = builder.build();
      const rel2 = builder.build();

      expect(rel1).not.toBe(rel2);
      expect(rel1.from).toBe(rel2.from);
    });

    it('should support full method chaining', () => {
      const rel = new RelationBuilder('Alice', 'Bob', 'collaborates_with')
        .withWeight(0.8)
        .withConfidence(0.95)
        .bidirectional()
        .validFrom('2024-01-01')
        .validUntil('2024-12-31')
        .withSource('observation')
        .withMethod('observed')
        .withMetadata({ context: 'work project' })
        .build();

      expect(rel.from).toBe('Alice');
      expect(rel.to).toBe('Bob');
      expect(rel.relationType).toBe('collaborates_with');
      expect(rel.weight).toBe(0.8);
      expect(rel.confidence).toBe(0.95);
      expect(rel.properties?.bidirectional).toBe(true);
      expect(rel.properties?.validFrom).toBe('2024-01-01');
      expect(rel.properties?.validUntil).toBe('2024-12-31');
      expect(rel.properties?.source).toBe('observation');
      expect(rel.properties?.method).toBe('observed');
      expect(rel.metadata?.context).toBe('work project');
      expect(rel.createdAt).toBeDefined();
    });
  });
});
