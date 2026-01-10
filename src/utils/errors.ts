/**
 * Custom Error Types
 *
 * Defines custom error classes for better error handling and debugging.
 *
 * @module utils/errors
 */

/**
 * Base error class for all knowledge graph errors.
 * Extends the native Error class with additional context.
 */
export class KnowledgeGraphError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'KnowledgeGraphError';
    // Maintains proper stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when an entity is not found.
 */
export class EntityNotFoundError extends KnowledgeGraphError {
  constructor(entityName: string) {
    super(`Entity "${entityName}" not found`, 'ENTITY_NOT_FOUND');
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Error thrown when a relation is not found.
 */
export class RelationNotFoundError extends KnowledgeGraphError {
  constructor(from: string, to: string, relationType?: string) {
    const desc = relationType
      ? `Relation "${from}" --[${relationType}]--> "${to}"`
      : `Relation from "${from}" to "${to}"`;
    super(`${desc} not found`, 'RELATION_NOT_FOUND');
    this.name = 'RelationNotFoundError';
  }
}

/**
 * Error thrown when attempting to create a duplicate entity.
 */
export class DuplicateEntityError extends KnowledgeGraphError {
  constructor(entityName: string) {
    super(`Entity "${entityName}" already exists`, 'DUPLICATE_ENTITY');
    this.name = 'DuplicateEntityError';
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends KnowledgeGraphError {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when a cycle is detected in hierarchies.
 */
export class CycleDetectedError extends KnowledgeGraphError {
  constructor(entityName: string, parentName: string) {
    super(
      `Setting parent "${parentName}" for entity "${entityName}" would create a cycle`,
      'CYCLE_DETECTED'
    );
    this.name = 'CycleDetectedError';
  }
}

/**
 * Error thrown when an invalid importance value is provided.
 */
export class InvalidImportanceError extends KnowledgeGraphError {
  constructor(value: number, min: number = 0, max: number = 10) {
    super(
      `Importance must be between ${min} and ${max}, got ${value}`,
      'INVALID_IMPORTANCE'
    );
    this.name = 'InvalidImportanceError';
  }
}

/**
 * Error thrown when a file operation fails.
 */
export class FileOperationError extends KnowledgeGraphError {
  constructor(
    operation: string,
    filePath: string,
    cause?: Error
  ) {
    super(
      `Failed to ${operation} file: ${filePath}${cause ? ` - ${cause.message}` : ''}`,
      'FILE_OPERATION_ERROR'
    );
    this.name = 'FileOperationError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Error thrown when an import operation fails.
 */
export class ImportError extends KnowledgeGraphError {
  constructor(format: string, message: string) {
    super(`Import failed (${format}): ${message}`, 'IMPORT_ERROR');
    this.name = 'ImportError';
  }
}

/**
 * Error thrown when an export operation fails.
 */
export class ExportError extends KnowledgeGraphError {
  constructor(format: string, message: string) {
    super(`Export failed (${format}): ${message}`, 'EXPORT_ERROR');
    this.name = 'ExportError';
  }
}

/**
 * Error thrown when insufficient entities are provided for an operation.
 */
export class InsufficientEntitiesError extends KnowledgeGraphError {
  constructor(operation: string, required: number, provided: number) {
    super(
      `${operation} requires at least ${required} entities, got ${provided}`,
      'INSUFFICIENT_ENTITIES'
    );
    this.name = 'InsufficientEntitiesError';
  }
}

/**
 * Phase 9B: Error thrown when an operation is cancelled via AbortSignal.
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * try {
 *   await manager.createEntities(entities, { signal: controller.signal });
 * } catch (error) {
 *   if (error instanceof OperationCancelledError) {
 *     console.log('Operation was cancelled');
 *   }
 * }
 * ```
 */
export class OperationCancelledError extends KnowledgeGraphError {
  constructor(operation?: string) {
    const message = operation
      ? `Operation '${operation}' was cancelled`
      : 'Operation was cancelled';
    super(message, 'OPERATION_CANCELLED');
    this.name = 'OperationCancelledError';
  }
}
