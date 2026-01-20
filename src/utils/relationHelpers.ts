/**
 * Relation Helper Utilities
 *
 * Type guards and builder pattern for working with relations.
 *
 * @module utils/relationHelpers
 */

import type {
  Relation,
  WeightedRelation,
  TemporalRelation,
  BidirectionalRelation,
  RelationProperties,
} from '../types/types.js';

/**
 * Type guard to check if a relation has a weight.
 *
 * @param relation - The relation to check
 * @returns True if the relation has a numeric weight
 *
 * @example
 * ```typescript
 * const rel: Relation = { from: 'A', to: 'B', relationType: 'knows', weight: 0.5 };
 * if (isWeightedRelation(rel)) {
 *   console.log(rel.weight); // TypeScript knows weight is number
 * }
 * ```
 */
export function isWeightedRelation(relation: Relation): relation is WeightedRelation {
  return typeof relation.weight === 'number';
}

/**
 * Type guard to check if a relation has temporal validity.
 *
 * @param relation - The relation to check
 * @returns True if the relation has a validFrom property
 *
 * @example
 * ```typescript
 * if (isTemporalRelation(rel)) {
 *   console.log(`Valid from: ${rel.properties.validFrom}`);
 * }
 * ```
 */
export function isTemporalRelation(relation: Relation): relation is TemporalRelation {
  return typeof relation.properties?.validFrom === 'string';
}

/**
 * Type guard to check if a relation is bidirectional.
 *
 * @param relation - The relation to check
 * @returns True if the relation is marked as bidirectional
 *
 * @example
 * ```typescript
 * if (isBidirectionalRelation(rel)) {
 *   // This relation implies the reverse relation exists
 * }
 * ```
 */
export function isBidirectionalRelation(relation: Relation): relation is BidirectionalRelation {
  return relation.properties?.bidirectional === true;
}

/**
 * Check if a relation has a confidence score.
 *
 * @param relation - The relation to check
 * @returns True if the relation has a confidence score
 */
export function hasConfidence(relation: Relation): boolean {
  return typeof relation.confidence === 'number';
}

/**
 * Check if a relation is currently valid based on temporal properties.
 *
 * @param relation - The relation to check
 * @param referenceDate - Date to check against (default: now)
 * @returns True if the relation is valid at the reference date
 */
export function isCurrentlyValid(relation: Relation, referenceDate: Date = new Date()): boolean {
  if (!relation.properties) {
    return true; // No temporal constraints means always valid
  }

  const { validFrom, validUntil } = relation.properties;

  if (validFrom) {
    const fromDate = new Date(validFrom);
    if (referenceDate < fromDate) {
      return false;
    }
  }

  if (validUntil) {
    const untilDate = new Date(validUntil);
    if (referenceDate > untilDate) {
      return false;
    }
  }

  return true;
}

/**
 * Fluent builder for constructing relations.
 *
 * Provides a convenient way to build relations with validation.
 *
 * @example
 * ```typescript
 * const relation = new RelationBuilder('Alice', 'Bob', 'knows')
 *   .withWeight(0.8)
 *   .withConfidence(0.95)
 *   .bidirectional()
 *   .validFrom('2024-01-01')
 *   .build();
 * ```
 */
export class RelationBuilder {
  private relation: Relation;

  /**
   * Create a new RelationBuilder.
   *
   * @param from - Source entity name
   * @param to - Target entity name
   * @param relationType - Type of relationship
   */
  constructor(from: string, to: string, relationType: string) {
    this.relation = { from, to, relationType };
  }

  /**
   * Set the weight for this relation.
   *
   * @param weight - Weight value (must be between 0 and 1)
   * @throws Error if weight is out of range
   */
  withWeight(weight: number): this {
    if (weight < 0 || weight > 1) {
      throw new Error('Weight must be between 0 and 1');
    }
    this.relation.weight = weight;
    return this;
  }

  /**
   * Set the confidence score for this relation.
   *
   * @param confidence - Confidence value (must be between 0 and 1)
   * @throws Error if confidence is out of range
   */
  withConfidence(confidence: number): this {
    if (confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
    this.relation.confidence = confidence;
    return this;
  }

  /**
   * Mark this relation as bidirectional.
   *
   * @param value - Whether the relation is bidirectional (default: true)
   */
  bidirectional(value: boolean = true): this {
    this.relation.properties = {
      ...this.relation.properties,
      bidirectional: value,
    };
    return this;
  }

  /**
   * Set when this relation becomes valid.
   *
   * @param date - ISO 8601 date string
   */
  validFrom(date: string): this {
    this.relation.properties = {
      ...this.relation.properties,
      validFrom: date,
    };
    return this;
  }

  /**
   * Set when this relation stops being valid.
   *
   * @param date - ISO 8601 date string
   */
  validUntil(date: string): this {
    this.relation.properties = {
      ...this.relation.properties,
      validUntil: date,
    };
    return this;
  }

  /**
   * Set the source/provenance of this relation.
   *
   * @param source - Source identifier
   */
  withSource(source: string): this {
    this.relation.properties = {
      ...this.relation.properties,
      source,
    };
    return this;
  }

  /**
   * Set how this relation was established.
   *
   * @param method - Establishment method
   */
  withMethod(method: RelationProperties['method']): this {
    this.relation.properties = {
      ...this.relation.properties,
      method,
    };
    return this;
  }

  /**
   * Add arbitrary metadata to the relation.
   *
   * @param metadata - Key-value pairs to add
   */
  withMetadata(metadata: Record<string, unknown>): this {
    this.relation.metadata = { ...this.relation.metadata, ...metadata };
    return this;
  }

  /**
   * Build the final relation object.
   *
   * Automatically sets createdAt timestamp if not already set.
   *
   * @returns The constructed relation
   */
  build(): Relation {
    this.relation.createdAt = new Date().toISOString();
    return { ...this.relation };
  }
}
