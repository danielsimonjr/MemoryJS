/** Custom error types for knowledge graph operations. */

export enum ErrorCode {
  // Validation errors
  VALIDATION_FAILED = 'VALIDATION_ERROR',
  REQUIRED_FIELD_MISSING = 'REQUIRED_FIELD_MISSING',
  INVALID_FIELD_VALUE = 'INVALID_FIELD_VALUE',
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',

  // Storage errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  ENTITY_NOT_FOUND = 'ENTITY_NOT_FOUND',
  RELATION_NOT_FOUND = 'RELATION_NOT_FOUND',
  DUPLICATE_ENTITY = 'DUPLICATE_ENTITY',
  STORAGE_CORRUPTED = 'STORAGE_CORRUPTED',
  FILE_OPERATION_ERROR = 'FILE_OPERATION_ERROR',

  // Search errors
  SEARCH_FAILED = 'SEARCH_FAILED',
  INVALID_QUERY = 'INVALID_QUERY',
  INDEX_NOT_READY = 'INDEX_NOT_READY',
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',

  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_DEPENDENCY = 'MISSING_DEPENDENCY',
  UNSUPPORTED_FEATURE = 'UNSUPPORTED_FEATURE',

  // Operation errors
  CYCLE_DETECTED = 'CYCLE_DETECTED',
  INVALID_IMPORTANCE = 'INVALID_IMPORTANCE',
  INSUFFICIENT_ENTITIES = 'INSUFFICIENT_ENTITIES',
  OPERATION_CANCELLED = 'OPERATION_CANCELLED',
  IMPORT_ERROR = 'IMPORT_ERROR',
  EXPORT_ERROR = 'EXPORT_ERROR',

  // Generic
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ErrorOptions {
  context?: Record<string, unknown>;
  suggestions?: string[];
  cause?: Error;
}

/** Base error class for all knowledge graph errors. */
export class KnowledgeGraphError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;
  readonly suggestions: string[];

  constructor(message: string, code?: string, options?: ErrorOptions) {
    super(message);
    this.name = 'KnowledgeGraphError';
    this.code = code || ErrorCode.UNKNOWN_ERROR;
    this.context = options?.context;
    this.suggestions = options?.suggestions || [];

    if (options?.cause) {
      this.cause = options.cause;
    }

    // Maintains proper stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Get a formatted error message with suggestions. */
  getDetailedMessage(): string {
    let msg = `[${this.code}] ${this.message}`;

    if (this.context && Object.keys(this.context).length > 0) {
      msg += `\nContext: ${JSON.stringify(this.context, null, 2)}`;
    }

    if (this.suggestions.length > 0) {
      msg += `\nSuggestions:\n${this.suggestions.map((s) => `  - ${s}`).join('\n')}`;
    }

    return msg;
  }

  /** Convert to a plain object for serialization. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      suggestions: this.suggestions,
      stack: this.stack,
    };
  }
}

/** Error thrown when an entity is not found. */
export class EntityNotFoundError extends KnowledgeGraphError {
  constructor(entityName: string) {
    super(`Entity "${entityName}" not found`, ErrorCode.ENTITY_NOT_FOUND, {
      context: { entityName },
      suggestions: [
        'Check that the entity name is spelled correctly',
        'Use searchManager.search() to find similar entities',
        'Verify the entity was created before accessing it',
      ],
    });
    this.name = 'EntityNotFoundError';
  }
}

/** Error thrown when a relation is not found. */
export class RelationNotFoundError extends KnowledgeGraphError {
  constructor(from: string, to: string, relationType?: string) {
    const desc = relationType
      ? `Relation "${from}" --[${relationType}]--> "${to}"`
      : `Relation from "${from}" to "${to}"`;
    super(`${desc} not found`, ErrorCode.RELATION_NOT_FOUND, {
      context: { from, to, relationType },
      suggestions: [
        'Verify both entities exist before creating relations',
        'Check the relation type spelling',
        'Use relationManager.getRelations() to list existing relations',
      ],
    });
    this.name = 'RelationNotFoundError';
  }
}

/** Error thrown when attempting to create a duplicate entity. */
export class DuplicateEntityError extends KnowledgeGraphError {
  constructor(entityName: string) {
    super(`Entity "${entityName}" already exists`, ErrorCode.DUPLICATE_ENTITY, {
      context: { entityName },
      suggestions: [
        'Use a different entity name',
        'Use updateEntity() to modify the existing entity',
        'Delete the existing entity first if replacement is intended',
      ],
    });
    this.name = 'DuplicateEntityError';
  }
}

/** Error thrown when validation fails. */
export class ValidationError extends KnowledgeGraphError {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(message, ErrorCode.VALIDATION_FAILED, {
      context: { validationErrors: errors },
      suggestions: [
        'Check the validation errors for specific field issues',
        'Ensure all required fields are provided',
        'Verify field values match expected types and constraints',
      ],
    });
    this.name = 'ValidationError';
  }
}

/** Error thrown when a cycle is detected in hierarchies. */
export class CycleDetectedError extends KnowledgeGraphError {
  constructor(entityName: string, parentName: string) {
    super(
      `Setting parent "${parentName}" for entity "${entityName}" would create a cycle`,
      ErrorCode.CYCLE_DETECTED,
      {
        context: { entityName, parentName },
        suggestions: [
          'Review the parent-child relationship being created',
          'Check for existing ancestor relationships',
          'Use getAncestors() to verify hierarchy before setting parent',
        ],
      }
    );
    this.name = 'CycleDetectedError';
  }
}

/** Error thrown when an invalid importance value is provided. */
export class InvalidImportanceError extends KnowledgeGraphError {
  constructor(value: number, min: number = 0, max: number = 10) {
    super(`Importance must be between ${min} and ${max}, got ${value}`, ErrorCode.INVALID_IMPORTANCE, {
      context: { value, min, max },
      suggestions: [
        'Importance values must be between 0 and 10',
        'Use a decimal value like 7.5 for fine-grained control',
        'Default importance is 5 if not specified',
      ],
    });
    this.name = 'InvalidImportanceError';
  }
}

/** Error thrown when a file operation fails. */
export class FileOperationError extends KnowledgeGraphError {
  constructor(operation: string, filePath: string, cause?: Error) {
    super(
      `Failed to ${operation} file: ${filePath}${cause ? ` - ${cause.message}` : ''}`,
      ErrorCode.FILE_OPERATION_ERROR,
      {
        context: { operation, filePath },
        suggestions: [
          'Check file permissions (read/write)',
          'Verify the file path is valid',
          'Ensure the file is not locked by another process',
        ],
        cause,
      }
    );
    this.name = 'FileOperationError';
  }
}

/** Error thrown when an import operation fails. */
export class ImportError extends KnowledgeGraphError {
  constructor(format: string, message: string) {
    super(`Import failed (${format}): ${message}`, ErrorCode.IMPORT_ERROR, {
      context: { format },
      suggestions: [
        'Verify the import data format is correct',
        'Check for syntax errors in the import file',
        'Ensure all required fields are present in imported data',
      ],
    });
    this.name = 'ImportError';
  }
}

/** Error thrown when an export operation fails. */
export class ExportError extends KnowledgeGraphError {
  constructor(format: string, message: string) {
    super(`Export failed (${format}): ${message}`, ErrorCode.EXPORT_ERROR, {
      context: { format },
      suggestions: [
        'Check write permissions for the export path',
        'Verify sufficient disk space is available',
        'Try a different export format',
      ],
    });
    this.name = 'ExportError';
  }
}

/** Error thrown when insufficient entities are provided. */
export class InsufficientEntitiesError extends KnowledgeGraphError {
  constructor(operation: string, required: number, provided: number) {
    super(
      `${operation} requires at least ${required} entities, got ${provided}`,
      ErrorCode.INSUFFICIENT_ENTITIES,
      {
        context: { operation, required, provided },
        suggestions: [
          'Ensure you have created enough entities before the operation',
          'Check the minimum entity requirements for this operation',
          'Create additional entities if needed',
        ],
      }
    );
    this.name = 'InsufficientEntitiesError';
  }
}

/** Error thrown when an operation is cancelled via AbortSignal. */
export class OperationCancelledError extends KnowledgeGraphError {
  constructor(operation?: string) {
    const message = operation
      ? `Operation '${operation}' was cancelled`
      : 'Operation was cancelled';
    super(message, ErrorCode.OPERATION_CANCELLED, {
      context: operation ? { operation } : undefined,
      suggestions: [
        'The operation was cancelled via AbortSignal',
        'Retry the operation if cancellation was unintended',
        'Check for timeout settings that may have triggered cancellation',
      ],
    });
    this.name = 'OperationCancelledError';
  }
}
