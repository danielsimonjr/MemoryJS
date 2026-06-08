/**
 * Entity Validator
 *
 * Validates entities against configurable rules.
 * Types are embedded to avoid collision with ValidationIssue in types.ts
 * Phase 1 Sprint 9: Entity Validation Helpers.
 *
 * @module utils/EntityValidator
 */

import type { Entity } from '../types/types.js';

// ==================== Validation Types ====================
// Note: These are ENTITY validation types, distinct from graph ValidationIssue

/**
 * A validation rule for entities.
 */
export interface EntityValidationRule {
  /** Name of this rule for identification */
  name: string;
  /** Field path to validate (e.g., 'name', 'observations.0') */
  field: string;
  /** Validation function */
  validate: (entity: Entity) => EntityRuleResult | Promise<EntityRuleResult>;
  /** Error message if validation fails */
  message: string;
  /** Severity level */
  severity?: 'error' | 'warning';
}

/**
 * Result of a single rule validation.
 */
export interface EntityRuleResult {
  /** Whether validation passed */
  valid: boolean;
  /** Optional custom message override */
  message?: string;
}

/**
 * A validation issue found during entity validation.
 * Named distinctly from ValidationIssue in types.ts (which is for graph validation).
 */
export interface EntityValidationIssue {
  /** Field that failed validation */
  field: string;
  /** Error/warning message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
  /** Current value of the field */
  value?: unknown;
  /** Name of the rule that failed */
  rule?: string;
  /** Suggestion for fixing the issue */
  suggestion?: string;
}

/**
 * Complete validation result for an entity.
 */
export interface EntityValidationResult {
  /** Whether entity is valid */
  isValid: boolean;
  /** Validation errors */
  errors: EntityValidationIssue[];
  /** Validation warnings */
  warnings: EntityValidationIssue[];
  /** The entity that was validated */
  entity: Entity;
}

// ==================== Validator Class ====================

export interface EntityValidatorConfig {
  /** Rules to apply */
  rules?: EntityValidationRule[];
  /** Stop on first error */
  failFast?: boolean;
  /** Treat warnings as errors */
  strict?: boolean;
}

/**
 * Validates entities against configurable rules.
 *
 * @example
 * ```typescript
 * import { EntityValidator, required, minLength, pattern } from './EntityValidator.js';
 *
 * const validator = new EntityValidator({
 *   rules: [
 *     required('name'),
 *     minLength('name', 3),
 *     pattern('name', /^[a-zA-Z]/),
 *   ],
 * });
 *
 * const result = await validator.validate(entity);
 * if (!result.isValid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export class EntityValidator {
  private readonly config: Required<EntityValidatorConfig>;

  constructor(config: EntityValidatorConfig = {}) {
    this.config = {
      rules: config.rules ?? [],
      failFast: config.failFast ?? false,
      strict: config.strict ?? false,
    };
  }

  /**
   * Add a validation rule.
   */
  addRule(rule: EntityValidationRule): this {
    this.config.rules.push(rule);
    return this;
  }

  /**
   * Add multiple validation rules.
   */
  addRules(rules: EntityValidationRule[]): this {
    this.config.rules.push(...rules);
    return this;
  }

  /**
   * Get all registered rules.
   */
  getRules(): EntityValidationRule[] {
    return [...this.config.rules];
  }

  /**
   * Clear all rules.
   */
  clearRules(): this {
    this.config.rules.length = 0;
    return this;
  }

  /**
   * Validate an entity against all rules.
   */
  async validate(entity: Entity): Promise<EntityValidationResult> {
    const errors: EntityValidationIssue[] = [];
    const warnings: EntityValidationIssue[] = [];

    for (const rule of this.config.rules) {
      try {
        const result = await rule.validate(entity);

        if (!result.valid) {
          const issue: EntityValidationIssue = {
            field: rule.field,
            message: result.message || rule.message,
            severity: rule.severity || 'error',
            value: this.getFieldValue(entity, rule.field),
            rule: rule.name,
          };

          if (issue.severity === 'error') {
            errors.push(issue);
            if (this.config.failFast) break;
          } else {
            warnings.push(issue);
          }
        }
      } catch (error) {
        errors.push({
          field: rule.field,
          message: `Validation error: ${(error as Error).message}`,
          severity: 'error',
          rule: rule.name,
        });
        if (this.config.failFast) break;
      }
    }

    const isValid = errors.length === 0 && (!this.config.strict || warnings.length === 0);

    return {
      isValid,
      errors,
      warnings,
      entity,
    };
  }

  /**
   * Validate multiple entities.
   */
  async validateAll(entities: Entity[]): Promise<Map<string, EntityValidationResult>> {
    const results = new Map<string, EntityValidationResult>();

    for (const entity of entities) {
      const result = await this.validate(entity);
      results.set(entity.name, result);
    }

    return results;
  }

  /**
   * Validate an entity synchronously (only works if all rules are sync).
   */
  validateSync(entity: Entity): EntityValidationResult {
    const errors: EntityValidationIssue[] = [];
    const warnings: EntityValidationIssue[] = [];

    for (const rule of this.config.rules) {
      try {
        const result = rule.validate(entity);

        // Check if async (returns Promise)
        if (result instanceof Promise) {
          throw new Error(`Rule "${rule.name}" is async. Use validate() instead of validateSync()`);
        }

        if (!result.valid) {
          const issue: EntityValidationIssue = {
            field: rule.field,
            message: result.message || rule.message,
            severity: rule.severity || 'error',
            value: this.getFieldValue(entity, rule.field),
            rule: rule.name,
          };

          if (issue.severity === 'error') {
            errors.push(issue);
            if (this.config.failFast) break;
          } else {
            warnings.push(issue);
          }
        }
      } catch (error) {
        errors.push({
          field: rule.field,
          message: `Validation error: ${(error as Error).message}`,
          severity: 'error',
          rule: rule.name,
        });
        if (this.config.failFast) break;
      }
    }

    const isValid = errors.length === 0 && (!this.config.strict || warnings.length === 0);

    return {
      isValid,
      errors,
      warnings,
      entity,
    };
  }

  /**
   * Get a field value from entity using dot notation path.
   */
  private getFieldValue(entity: Entity, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = entity;

    for (const part of parts) {
      if (value && typeof value === 'object') {
        // Handle array index
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
}
