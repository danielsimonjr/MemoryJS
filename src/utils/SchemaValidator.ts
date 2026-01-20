/**
 * Schema Validator
 *
 * JSON Schema validation for entities using ajv.
 * Phase 1 Sprint 9: Entity Validation Helpers.
 *
 * @module utils/SchemaValidator
 */

import type { Entity } from '../types/types.js';
import type { EntityValidationResult, EntityValidationIssue } from './EntityValidator.js';

/**
 * JSON Schema type definition (simplified).
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: unknown[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  format?: string;
  default?: unknown;
  description?: string;
  $ref?: string;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  [key: string]: unknown;
}

/**
 * AJV error structure.
 */
interface AjvError {
  instancePath: string;
  message?: string;
  data?: unknown;
  keyword?: string;
  params?: {
    missingProperty?: string;
    additionalProperty?: string;
    limit?: number;
    pattern?: string;
    allowedValues?: unknown[];
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AjvInstance = any; // Dynamic import, type compatibility handled at runtime

/**
 * AJV validate function interface.
 */
interface ValidateFunction {
  (data: unknown): boolean;
  errors?: AjvError[] | null;
}

/**
 * Validates entities against JSON Schemas.
 * Requires ajv to be installed as optional peer dependency.
 *
 * @example
 * ```typescript
 * const validator = new SchemaValidator();
 * await validator.initialize(); // Load ajv dynamically
 *
 * validator.registerSchema('person', {
 *   type: 'object',
 *   required: ['name', 'entityType'],
 *   properties: {
 *     name: { type: 'string', minLength: 1 },
 *     entityType: { type: 'string', enum: ['person'] },
 *   },
 * });
 *
 * const result = validator.validate(entity);
 * ```
 */
export class SchemaValidator {
  private schemas: Map<string, JsonSchema> = new Map();
  private ajv: AjvInstance | null = null;
  private validators: Map<string, ValidateFunction> = new Map();
  private initialized = false;

  /**
   * Initialize the validator by loading ajv dynamically.
   * Call this before using validate() if you want schema validation.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return this.isAvailable();

    try {
      // Dynamic import to avoid bundling ajv if not used
      const AjvModule = await import('ajv');
      const Ajv = AjvModule.default;
      this.ajv = new Ajv({ allErrors: true, verbose: true });
      this.initialized = true;

      // Re-compile any schemas that were registered before initialization
      for (const [entityType, schema] of this.schemas) {
        this.compileSchema(entityType, schema);
      }

      return true;
    } catch {
      // ajv not installed
      this.initialized = true;
      return false;
    }
  }

  /**
   * Check if schema validation is available.
   */
  isAvailable(): boolean {
    return this.ajv !== null;
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Register a schema for an entity type.
   */
  registerSchema(entityType: string, schema: JsonSchema): void {
    this.schemas.set(entityType, schema);

    if (this.ajv) {
      this.compileSchema(entityType, schema);
    }
  }

  /**
   * Compile a schema using ajv.
   */
  private compileSchema(entityType: string, schema: JsonSchema): void {
    if (!this.ajv) return;

    try {
      const validate = this.ajv.compile(schema);
      this.validators.set(entityType, validate);
    } catch (error) {
      console.warn(`Failed to compile schema for "${entityType}": ${(error as Error).message}`);
    }
  }

  /**
   * Unregister a schema.
   */
  unregisterSchema(entityType: string): void {
    this.schemas.delete(entityType);
    this.validators.delete(entityType);
  }

  /**
   * Validate an entity against its type's schema.
   */
  validate(entity: Entity): EntityValidationResult {
    const errors: EntityValidationIssue[] = [];
    const warnings: EntityValidationIssue[] = [];

    if (!this.initialized) {
      warnings.push({
        field: '_schema',
        message: 'SchemaValidator not initialized. Call initialize() first.',
        severity: 'warning',
      });
      return { isValid: true, errors, warnings, entity };
    }

    if (!this.ajv) {
      warnings.push({
        field: '_schema',
        message: 'Schema validation unavailable: ajv not installed. Run: npm install ajv',
        severity: 'warning',
      });
      return { isValid: true, errors, warnings, entity };
    }

    const validate = this.validators.get(entity.entityType);
    if (!validate) {
      // No schema for this type - consider valid
      return { isValid: true, errors, warnings, entity };
    }

    const valid = validate(entity);

    if (!valid && validate.errors) {
      for (const error of validate.errors) {
        const field = this.getFieldPath(error);
        const message = this.getErrorMessage(error);

        errors.push({
          field,
          message,
          severity: 'error',
          value: error.data,
          rule: error.keyword,
          suggestion: this.getSuggestion(error),
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      entity,
    };
  }

  /**
   * Validate multiple entities.
   */
  validateAll(entities: Entity[]): Map<string, EntityValidationResult> {
    const results = new Map<string, EntityValidationResult>();

    for (const entity of entities) {
      results.set(entity.name, this.validate(entity));
    }

    return results;
  }

  /**
   * Get field path from AJV error.
   */
  private getFieldPath(error: AjvError): string {
    if (error.params?.missingProperty) {
      const basePath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return basePath ? `${basePath}.${error.params.missingProperty}` : error.params.missingProperty;
    }

    if (error.params?.additionalProperty) {
      const basePath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return basePath
        ? `${basePath}.${error.params.additionalProperty}`
        : error.params.additionalProperty;
    }

    return error.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'root';
  }

  /**
   * Get human-readable error message.
   */
  private getErrorMessage(error: AjvError): string {
    if (error.message) {
      return error.message;
    }

    switch (error.keyword) {
      case 'required':
        return `Missing required property: ${error.params?.missingProperty}`;
      case 'type':
        return 'Invalid type';
      case 'minLength':
        return `Must be at least ${error.params?.limit} characters`;
      case 'maxLength':
        return `Must be at most ${error.params?.limit} characters`;
      case 'minimum':
        return `Must be >= ${error.params?.limit}`;
      case 'maximum':
        return `Must be <= ${error.params?.limit}`;
      case 'pattern':
        return `Must match pattern: ${error.params?.pattern}`;
      case 'enum':
        return `Must be one of: ${error.params?.allowedValues?.join(', ')}`;
      default:
        return 'Validation failed';
    }
  }

  /**
   * Get suggestion for fixing the error.
   */
  private getSuggestion(error: AjvError): string | undefined {
    switch (error.keyword) {
      case 'required':
        return `Add the required property "${error.params?.missingProperty}"`;
      case 'type':
        return 'Check the value type';
      case 'minLength':
        return `Provide at least ${error.params?.limit} characters`;
      case 'maxLength':
        return `Reduce to at most ${error.params?.limit} characters`;
      case 'minimum':
        return `Use a value >= ${error.params?.limit}`;
      case 'maximum':
        return `Use a value <= ${error.params?.limit}`;
      case 'additionalProperties':
        return `Remove the extra property "${error.params?.additionalProperty}"`;
      default:
        return undefined;
    }
  }

  /**
   * Get registered schema for entity type.
   */
  getSchema(entityType: string): JsonSchema | undefined {
    return this.schemas.get(entityType);
  }

  /**
   * Get all registered entity types.
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Check if a schema is registered for an entity type.
   */
  hasSchema(entityType: string): boolean {
    return this.schemas.has(entityType);
  }
}
