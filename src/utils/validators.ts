/**
 * Built-in Validators
 *
 * Factory functions for common validation rules.
 * Phase 1 Sprint 9: Entity Validation Helpers.
 *
 * @module utils/validators
 */

import type { Entity } from '../types/types.js';
import type { EntityValidationRule, EntityRuleResult } from './EntityValidator.js';

// Helper to get nested field value
function getField(entity: Entity, field: string): unknown {
  const parts = field.split('.');
  let value: unknown = entity;

  for (const part of parts) {
    if (value && typeof value === 'object') {
      if (/^\d+$/.test(part)) {
        value = (value as unknown[])[parseInt(part, 10)];
      } else {
        value = (value as Record<string, unknown>)[part];
      }
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Require a field to have a value.
 */
export function required(field: string, message?: string): EntityValidationRule {
  return {
    name: 'required',
    field,
    message: message ?? `${field} is required`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      const valid = value !== undefined && value !== null && value !== '';
      return { valid };
    },
  };
}

/**
 * Require a string field to have minimum length.
 */
export function minLength(field: string, min: number, message?: string): EntityValidationRule {
  return {
    name: 'minLength',
    field,
    message: message ?? `${field} must be at least ${min} characters`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true }; // Skip if not string
      return { valid: value.length >= min };
    },
  };
}

/**
 * Require a string field to have maximum length.
 */
export function maxLength(field: string, max: number, message?: string): EntityValidationRule {
  return {
    name: 'maxLength',
    field,
    message: message ?? `${field} must be at most ${max} characters`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true };
      return { valid: value.length <= max };
    },
  };
}

/**
 * Require a string field to match a pattern.
 */
export function pattern(
  field: string,
  regex: RegExp,
  description?: string,
  message?: string
): EntityValidationRule {
  return {
    name: 'pattern',
    field,
    message: message ?? `${field} must match ${description || regex.toString()}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true };
      return { valid: regex.test(value) };
    },
  };
}

/**
 * Require a numeric field to be within range.
 */
export function range(field: string, min: number, max: number, message?: string): EntityValidationRule {
  return {
    name: 'range',
    field,
    message: message ?? `${field} must be between ${min} and ${max}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'number') return { valid: true };
      return { valid: value >= min && value <= max };
    },
  };
}

/**
 * Require a numeric field to be at least a minimum value.
 */
export function min(field: string, minValue: number, message?: string): EntityValidationRule {
  return {
    name: 'min',
    field,
    message: message ?? `${field} must be at least ${minValue}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'number') return { valid: true };
      return { valid: value >= minValue };
    },
  };
}

/**
 * Require a numeric field to be at most a maximum value.
 */
export function max(field: string, maxValue: number, message?: string): EntityValidationRule {
  return {
    name: 'max',
    field,
    message: message ?? `${field} must be at most ${maxValue}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'number') return { valid: true };
      return { valid: value <= maxValue };
    },
  };
}

/**
 * Require a field to be one of specified values.
 */
export function oneOf<T>(field: string, values: T[], message?: string): EntityValidationRule {
  return {
    name: 'oneOf',
    field,
    message: message ?? `${field} must be one of: ${values.join(', ')}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      return { valid: values.includes(value as T) };
    },
  };
}

/**
 * Require array field to have minimum items.
 */
export function minItems(field: string, minCount: number, message?: string): EntityValidationRule {
  return {
    name: 'minItems',
    field,
    message: message ?? `${field} must have at least ${minCount} items`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (!Array.isArray(value)) return { valid: true };
      return { valid: value.length >= minCount };
    },
  };
}

/**
 * Require array field to have maximum items.
 */
export function maxItems(field: string, maxCount: number, message?: string): EntityValidationRule {
  return {
    name: 'maxItems',
    field,
    message: message ?? `${field} must have at most ${maxCount} items`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (!Array.isArray(value)) return { valid: true };
      return { valid: value.length <= maxCount };
    },
  };
}

/**
 * Require a field to be a valid email address.
 */
export function email(field: string, message?: string): EntityValidationRule {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    name: 'email',
    field,
    message: message ?? `${field} must be a valid email address`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true };
      return { valid: emailRegex.test(value) };
    },
  };
}

/**
 * Require a field to be a valid URL.
 */
export function url(field: string, message?: string): EntityValidationRule {
  return {
    name: 'url',
    field,
    message: message ?? `${field} must be a valid URL`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true };
      try {
        new URL(value);
        return { valid: true };
      } catch {
        return { valid: false };
      }
    },
  };
}

/**
 * Require a field to be a valid ISO 8601 date string.
 */
export function isoDate(field: string, message?: string): EntityValidationRule {
  return {
    name: 'isoDate',
    field,
    message: message ?? `${field} must be a valid ISO 8601 date`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (typeof value !== 'string') return { valid: true };
      const date = new Date(value);
      return { valid: !isNaN(date.getTime()) };
    },
  };
}

/**
 * Require a field to be of a specific type.
 */
export function typeOf(
  field: string,
  expectedType: 'string' | 'number' | 'boolean' | 'object' | 'array',
  message?: string
): EntityValidationRule {
  return {
    name: 'typeOf',
    field,
    message: message ?? `${field} must be of type ${expectedType}`,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      if (value === undefined || value === null) return { valid: true };

      if (expectedType === 'array') {
        return { valid: Array.isArray(value) };
      }

      return { valid: typeof value === expectedType };
    },
  };
}

/**
 * Custom validator with user-provided function.
 */
export function custom(
  field: string,
  validator: (value: unknown, entity: Entity) => boolean | Promise<boolean>,
  message: string
): EntityValidationRule {
  return {
    name: 'custom',
    field,
    message,
    validate: async (entity: Entity): Promise<EntityRuleResult> => {
      const value = getField(entity, field);
      const valid = await validator(value, entity);
      return { valid };
    },
  };
}

/**
 * Synchronous custom validator.
 */
export function customSync(
  field: string,
  validator: (value: unknown, entity: Entity) => boolean,
  message: string
): EntityValidationRule {
  return {
    name: 'customSync',
    field,
    message,
    validate: (entity: Entity): EntityRuleResult => {
      const value = getField(entity, field);
      const valid = validator(value, entity);
      return { valid };
    },
  };
}

/**
 * Create a warning (non-blocking) version of a rule.
 */
export function asWarning(rule: EntityValidationRule): EntityValidationRule {
  return { ...rule, severity: 'warning' };
}

/**
 * Combine multiple rules for the same field.
 */
export function all(...rules: EntityValidationRule[]): EntityValidationRule[] {
  return rules;
}

/**
 * Conditionally apply a rule based on a predicate.
 */
export function when(
  predicate: (entity: Entity) => boolean,
  rule: EntityValidationRule
): EntityValidationRule {
  return {
    ...rule,
    name: `conditional:${rule.name}`,
    validate: (entity: Entity): EntityRuleResult | Promise<EntityRuleResult> => {
      if (!predicate(entity)) {
        return { valid: true }; // Skip validation if predicate is false
      }
      return rule.validate(entity);
    },
  };
}
