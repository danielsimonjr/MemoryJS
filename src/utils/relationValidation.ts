/**
 * Relation Validation Utilities
 *
 * Functions for validating relation properties.
 *
 * @module utils/relationValidation
 */

import type { Relation } from '../types/types.js';

/**
 * A validation error for relation fields.
 * Named distinctly from ValidationIssue in types.ts which is for graph validation.
 */
export interface RelationValidationError {
  /** Field that has the error */
  field: string;
  /** Error message */
  message: string;
  /** The invalid value (if applicable) */
  value?: unknown;
}

/**
 * A validation warning for relation fields.
 * Warnings don't make a relation invalid, but may indicate potential issues.
 */
export interface RelationValidationWarning {
  /** Field that has the warning */
  field: string;
  /** Warning message */
  message: string;
  /** Suggested fix (if applicable) */
  suggestion?: string;
}

/**
 * Result of relation validation.
 */
export interface RelationValidationResult {
  /** Whether the relation is valid (no errors) */
  isValid: boolean;
  /** List of validation errors */
  errors: RelationValidationError[];
  /** List of validation warnings */
  warnings: RelationValidationWarning[];
}

/**
 * Validate relation properties.
 *
 * Checks:
 * - Required fields (from, to, relationType)
 * - Weight range (0-1) if present
 * - Confidence range (0-1) if present
 * - Temporal consistency (validFrom <= validUntil) if both present
 * - Self-referential relations (warning)
 *
 * @param relation - The relation to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateRelationMetadata({
 *   from: 'Alice',
 *   to: 'Bob',
 *   relationType: 'knows',
 *   weight: 1.5, // Invalid - out of range
 * });
 *
 * if (!result.isValid) {
 *   console.log('Errors:', result.errors);
 * }
 * ```
 */
export function validateRelationMetadata(relation: Relation): RelationValidationResult {
  const errors: RelationValidationError[] = [];
  const warnings: RelationValidationWarning[] = [];

  // Required fields
  if (!relation.from || typeof relation.from !== 'string') {
    errors.push({
      field: 'from',
      message: 'from is required and must be a non-empty string',
      value: relation.from,
    });
  }

  if (!relation.to || typeof relation.to !== 'string') {
    errors.push({
      field: 'to',
      message: 'to is required and must be a non-empty string',
      value: relation.to,
    });
  }

  if (!relation.relationType || typeof relation.relationType !== 'string') {
    errors.push({
      field: 'relationType',
      message: 'relationType is required and must be a non-empty string',
      value: relation.relationType,
    });
  }

  // Weight validation (0-1 range)
  if (relation.weight !== undefined) {
    if (typeof relation.weight !== 'number') {
      errors.push({
        field: 'weight',
        message: 'weight must be a number',
        value: relation.weight,
      });
    } else if (isNaN(relation.weight)) {
      errors.push({
        field: 'weight',
        message: 'weight must not be NaN',
        value: relation.weight,
      });
    } else if (relation.weight < 0 || relation.weight > 1) {
      errors.push({
        field: 'weight',
        message: 'weight must be between 0 and 1',
        value: relation.weight,
      });
    }
  }

  // Confidence validation (0-1 range)
  if (relation.confidence !== undefined) {
    if (typeof relation.confidence !== 'number') {
      errors.push({
        field: 'confidence',
        message: 'confidence must be a number',
        value: relation.confidence,
      });
    } else if (isNaN(relation.confidence)) {
      errors.push({
        field: 'confidence',
        message: 'confidence must not be NaN',
        value: relation.confidence,
      });
    } else if (relation.confidence < 0 || relation.confidence > 1) {
      errors.push({
        field: 'confidence',
        message: 'confidence must be between 0 and 1',
        value: relation.confidence,
      });
    }
  }

  // Temporal validation
  if (relation.properties?.validFrom !== undefined) {
    const from = new Date(relation.properties.validFrom);
    if (isNaN(from.getTime())) {
      errors.push({
        field: 'properties.validFrom',
        message: 'validFrom must be a valid ISO 8601 date',
        value: relation.properties.validFrom,
      });
    }
  }

  if (relation.properties?.validUntil !== undefined) {
    const until = new Date(relation.properties.validUntil);
    if (isNaN(until.getTime())) {
      errors.push({
        field: 'properties.validUntil',
        message: 'validUntil must be a valid ISO 8601 date',
        value: relation.properties.validUntil,
      });
    }
  }

  // Temporal consistency check
  if (relation.properties?.validFrom && relation.properties?.validUntil) {
    const from = new Date(relation.properties.validFrom);
    const until = new Date(relation.properties.validUntil);

    if (!isNaN(from.getTime()) && !isNaN(until.getTime()) && from > until) {
      errors.push({
        field: 'properties.validFrom/validUntil',
        message: 'validFrom must be before or equal to validUntil',
        value: { validFrom: relation.properties.validFrom, validUntil: relation.properties.validUntil },
      });
    }
  }

  // Confirmation/contradiction counts validation
  if (relation.properties?.confirmationCount !== undefined) {
    if (typeof relation.properties.confirmationCount !== 'number' ||
        relation.properties.confirmationCount < 0 ||
        !Number.isInteger(relation.properties.confirmationCount)) {
      errors.push({
        field: 'properties.confirmationCount',
        message: 'confirmationCount must be a non-negative integer',
        value: relation.properties.confirmationCount,
      });
    }
  }

  if (relation.properties?.contradictionCount !== undefined) {
    if (typeof relation.properties.contradictionCount !== 'number' ||
        relation.properties.contradictionCount < 0 ||
        !Number.isInteger(relation.properties.contradictionCount)) {
      errors.push({
        field: 'properties.contradictionCount',
        message: 'contradictionCount must be a non-negative integer',
        value: relation.properties.contradictionCount,
      });
    }
  }

  // Self-referential warning
  if (relation.from && relation.to && relation.from === relation.to) {
    warnings.push({
      field: 'from/to',
      message: 'Relation is self-referential (from === to)',
      suggestion: 'Verify this is intentional. Self-referential relations are unusual but sometimes valid.',
    });
  }

  // Low confidence warning
  if (typeof relation.confidence === 'number' && relation.confidence < 0.5) {
    warnings.push({
      field: 'confidence',
      message: `Relation has low confidence (${relation.confidence})`,
      suggestion: 'Consider verifying this relation or marking it for review.',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate multiple relations at once.
 *
 * @param relations - Array of relations to validate
 * @returns Array of validation results (same order as input)
 */
export function validateRelationsMetadata(relations: Relation[]): RelationValidationResult[] {
  return relations.map(validateRelationMetadata);
}

/**
 * Check if all relations are valid.
 *
 * @param relations - Array of relations to check
 * @returns True if all relations are valid
 */
export function allRelationsValidMetadata(relations: Relation[]): boolean {
  return relations.every(rel => validateRelationMetadata(rel).isValid);
}
