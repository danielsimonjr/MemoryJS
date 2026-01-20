/**
 * Error Suggestion Generator
 *
 * Provides context-specific suggestions for error recovery.
 * Phase 1 Sprint 10: Progress Callbacks and Error Improvements.
 *
 * @module utils/errorSuggestions
 */

import { ErrorCode } from './errors.js';

/**
 * Generate context-specific suggestions based on error code and context.
 */
export function generateSuggestions(
  code: ErrorCode | string,
  context?: Record<string, unknown>
): string[] {
  const suggestions: string[] = [];

  switch (code) {
    case ErrorCode.ENTITY_NOT_FOUND:
      suggestions.push(
        'Check that the entity name is spelled correctly',
        'Use searchManager.search() to find similar entities',
        'Verify the entity was created before accessing it'
      );
      if (context?.entityName) {
        suggestions.push(`Searched for: "${context.entityName}"`);
      }
      break;

    case ErrorCode.RELATION_NOT_FOUND:
      suggestions.push(
        'Verify both entities exist before creating relations',
        'Check the relation type spelling',
        'Use relationManager.getRelations() to list existing relations'
      );
      break;

    case ErrorCode.DUPLICATE_ENTITY:
      suggestions.push(
        'Use a different entity name',
        'Use updateEntity() to modify the existing entity',
        'Delete the existing entity first if replacement is intended'
      );
      break;

    case ErrorCode.STORAGE_READ_FAILED:
      suggestions.push(
        'Check that the storage file exists at the specified path',
        'Verify read permissions on the file and parent directory',
        'Ensure the file is not locked by another process'
      );
      if (context?.path) {
        suggestions.push(`Path: ${context.path}`);
      }
      break;

    case ErrorCode.STORAGE_WRITE_FAILED:
      suggestions.push(
        'Check write permissions on the storage directory',
        'Ensure sufficient disk space is available',
        'Verify the file is not read-only'
      );
      break;

    case ErrorCode.STORAGE_CORRUPTED:
      suggestions.push(
        'Try restoring from a backup file',
        'Check for file corruption (unexpected characters)',
        'Consider creating a new storage file and re-importing data'
      );
      break;

    case ErrorCode.INVALID_QUERY:
      suggestions.push(
        'Check query syntax for unmatched quotes or parentheses',
        'Escape special characters if searching literal text',
        'Use simpler query terms to isolate the issue'
      );
      if (context?.query) {
        suggestions.push(`Query: "${context.query}"`);
      }
      break;

    case ErrorCode.SEARCH_FAILED:
      suggestions.push(
        'Verify the search index is up to date',
        'Try a simpler search query',
        'Check for special characters that may need escaping'
      );
      break;

    case ErrorCode.INDEX_NOT_READY:
      suggestions.push(
        'Wait for indexing to complete',
        'Call initialize() before performing searches',
        'Check if background indexing is in progress'
      );
      break;

    case ErrorCode.EMBEDDING_FAILED:
      suggestions.push(
        'Verify MEMORY_EMBEDDING_PROVIDER is set correctly',
        'Check that the API key is valid (MEMORY_OPENAI_API_KEY)',
        'Ensure network connectivity to the embedding service'
      );
      break;

    case ErrorCode.MISSING_DEPENDENCY:
      suggestions.push(
        'Install the required dependency: npm install <package>',
        'Check that peer dependencies are installed',
        'Review the feature documentation for requirements'
      );
      if (context?.dependency) {
        suggestions.push(`Missing: ${context.dependency}`);
      }
      break;

    case ErrorCode.UNSUPPORTED_FEATURE:
      suggestions.push(
        'Check if the feature requires additional configuration',
        'Verify the feature is available in your version',
        'Review the documentation for feature requirements'
      );
      break;

    case ErrorCode.CYCLE_DETECTED:
      suggestions.push(
        'Review the parent-child relationship being created',
        'Check for existing ancestor relationships',
        'Use getAncestors() to verify hierarchy before setting parent'
      );
      break;

    case ErrorCode.INVALID_IMPORTANCE:
      suggestions.push(
        'Importance values must be between 0 and 10',
        'Use a decimal value like 7.5 for fine-grained control',
        'Default importance is 5 if not specified'
      );
      break;

    case ErrorCode.INSUFFICIENT_ENTITIES:
      suggestions.push(
        'Ensure you have created enough entities before the operation',
        'Check the minimum entity requirements for this operation',
        'Create additional entities if needed'
      );
      break;

    case ErrorCode.VALIDATION_FAILED:
      suggestions.push(
        'Check the validation errors for specific field issues',
        'Ensure all required fields are provided',
        'Verify field values match expected types and constraints'
      );
      break;

    case ErrorCode.SCHEMA_VALIDATION_FAILED:
      suggestions.push(
        'Review the JSON Schema for the entity type',
        'Check that all required properties are present',
        'Verify property types match the schema'
      );
      break;

    case ErrorCode.OPERATION_CANCELLED:
      suggestions.push(
        'The operation was cancelled via AbortSignal',
        'Retry the operation if cancellation was unintended',
        'Check for timeout settings that may have triggered cancellation'
      );
      break;

    case ErrorCode.IMPORT_ERROR:
      suggestions.push(
        'Verify the import data format is correct',
        'Check for syntax errors in the import file',
        'Ensure all required fields are present in imported data'
      );
      if (context?.format) {
        suggestions.push(`Format: ${context.format}`);
      }
      break;

    case ErrorCode.EXPORT_ERROR:
      suggestions.push(
        'Check write permissions for the export path',
        'Verify sufficient disk space is available',
        'Try a different export format'
      );
      if (context?.format) {
        suggestions.push(`Format: ${context.format}`);
      }
      break;

    case ErrorCode.FILE_OPERATION_ERROR:
      suggestions.push(
        'Check file permissions (read/write)',
        'Verify the file path is valid',
        'Ensure the file is not locked by another process'
      );
      if (context?.operation) {
        suggestions.push(`Operation: ${context.operation}`);
      }
      if (context?.path) {
        suggestions.push(`Path: ${context.path}`);
      }
      break;

    case ErrorCode.INVALID_CONFIG:
      suggestions.push(
        'Review configuration options in the documentation',
        'Check for typos in configuration keys',
        'Verify configuration values are of the correct type'
      );
      break;

    default:
      suggestions.push(
        'Check the error message for details',
        'Review the documentation for the operation',
        'Report the issue if the error persists'
      );
  }

  return suggestions;
}

/**
 * Get a single-line recovery hint for an error code.
 */
export function getQuickHint(code: ErrorCode | string): string {
  switch (code) {
    case ErrorCode.ENTITY_NOT_FOUND:
      return 'Entity does not exist - check spelling or create it first';
    case ErrorCode.RELATION_NOT_FOUND:
      return 'Relation does not exist - verify entities and relation type';
    case ErrorCode.DUPLICATE_ENTITY:
      return 'Entity already exists - use update or choose different name';
    case ErrorCode.VALIDATION_FAILED:
      return 'Invalid data - check required fields and value constraints';
    case ErrorCode.CYCLE_DETECTED:
      return 'Circular reference - cannot create parent-child cycle';
    case ErrorCode.OPERATION_CANCELLED:
      return 'Operation was cancelled - retry if needed';
    default:
      return 'An error occurred - see details above';
  }
}
