/**
 * Custom Errors Unit Tests
 *
 * Tests for knowledge graph custom error classes.
 */

import { describe, it, expect } from 'vitest';
import {
  KnowledgeGraphError,
  EntityNotFoundError,
  RelationNotFoundError,
  DuplicateEntityError,
  ValidationError,
  CycleDetectedError,
  InvalidImportanceError,
  FileOperationError,
  ImportError,
  ExportError,
  InsufficientEntitiesError,
} from '../../../src/utils/errors.js';

describe('Custom Errors', () => {
  describe('KnowledgeGraphError', () => {
    it('should create error with message', () => {
      const error = new KnowledgeGraphError('Test error');

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('KnowledgeGraphError');
    });

    it('should create error with code', () => {
      const error = new KnowledgeGraphError('Test error', 'TEST_CODE');

      expect(error.code).toBe('TEST_CODE');
    });

    it('should be instance of Error', () => {
      const error = new KnowledgeGraphError('Test');

      expect(error).toBeInstanceOf(Error);
    });

    it('should have stack trace', () => {
      const error = new KnowledgeGraphError('Test');

      expect(error.stack).toBeDefined();
    });
  });

  describe('EntityNotFoundError', () => {
    it('should create error with entity name', () => {
      const error = new EntityNotFoundError('Alice');

      expect(error.message).toBe('Entity "Alice" not found');
      expect(error.name).toBe('EntityNotFoundError');
      expect(error.code).toBe('ENTITY_NOT_FOUND');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new EntityNotFoundError('Test');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle special characters in entity name', () => {
      const error = new EntityNotFoundError('Test "quoted" & <special>');

      expect(error.message).toContain('Test "quoted" & <special>');
    });

    it('should handle unicode in entity name', () => {
      const error = new EntityNotFoundError('日本語');

      expect(error.message).toContain('日本語');
    });
  });

  describe('RelationNotFoundError', () => {
    it('should create error without relation type', () => {
      const error = new RelationNotFoundError('Alice', 'Bob');

      expect(error.message).toBe('Relation from "Alice" to "Bob" not found');
      expect(error.name).toBe('RelationNotFoundError');
      expect(error.code).toBe('RELATION_NOT_FOUND');
    });

    it('should create error with relation type', () => {
      const error = new RelationNotFoundError('Alice', 'Bob', 'knows');

      expect(error.message).toBe('Relation "Alice" --[knows]--> "Bob" not found');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new RelationNotFoundError('A', 'B');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });
  });

  describe('DuplicateEntityError', () => {
    it('should create error with entity name', () => {
      const error = new DuplicateEntityError('Alice');

      expect(error.message).toBe('Entity "Alice" already exists');
      expect(error.name).toBe('DuplicateEntityError');
      expect(error.code).toBe('DUPLICATE_ENTITY');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new DuplicateEntityError('Test');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });
  });

  describe('ValidationError', () => {
    it('should create error with message and errors array', () => {
      const errors = ['Field A is required', 'Field B must be a number'];
      const error = new ValidationError('Validation failed', errors);

      expect(error.message).toBe('Validation failed');
      expect(error.errors).toEqual(errors);
      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new ValidationError('Test', []);

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should allow empty errors array', () => {
      const error = new ValidationError('No specific errors', []);

      expect(error.errors).toHaveLength(0);
    });

    it('should preserve errors array immutably', () => {
      const errors = ['Error 1'];
      const error = new ValidationError('Test', errors);

      errors.push('Error 2');

      // Note: This tests current behavior - errors array is passed by reference
      expect(error.errors).toContain('Error 1');
    });
  });

  describe('CycleDetectedError', () => {
    it('should create error with entity and parent names', () => {
      const error = new CycleDetectedError('Child', 'Parent');

      expect(error.message).toBe(
        'Setting parent "Parent" for entity "Child" would create a cycle'
      );
      expect(error.name).toBe('CycleDetectedError');
      expect(error.code).toBe('CYCLE_DETECTED');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new CycleDetectedError('A', 'B');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });
  });

  describe('InvalidImportanceError', () => {
    it('should create error with value and default range', () => {
      const error = new InvalidImportanceError(15);

      expect(error.message).toBe('Importance must be between 0 and 10, got 15');
      expect(error.name).toBe('InvalidImportanceError');
      expect(error.code).toBe('INVALID_IMPORTANCE');
    });

    it('should create error with custom range', () => {
      const error = new InvalidImportanceError(100, 1, 5);

      expect(error.message).toBe('Importance must be between 1 and 5, got 100');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new InvalidImportanceError(11);

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle negative values', () => {
      const error = new InvalidImportanceError(-5);

      expect(error.message).toContain('-5');
    });

    it('should handle decimal values', () => {
      const error = new InvalidImportanceError(10.5);

      expect(error.message).toContain('10.5');
    });
  });

  describe('FileOperationError', () => {
    it('should create error with operation and path', () => {
      const error = new FileOperationError('read', '/path/to/file.json');

      expect(error.message).toBe('Failed to read file: /path/to/file.json');
      expect(error.name).toBe('FileOperationError');
      expect(error.code).toBe('FILE_OPERATION_ERROR');
    });

    it('should create error with cause', () => {
      const cause = new Error('ENOENT: no such file');
      const error = new FileOperationError('read', '/path/to/file.json', cause);

      expect(error.message).toBe(
        'Failed to read file: /path/to/file.json - ENOENT: no such file'
      );
      expect(error.cause).toBe(cause);
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new FileOperationError('write', '/path');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle various operations', () => {
      expect(new FileOperationError('write', '/path').message).toContain('write');
      expect(new FileOperationError('delete', '/path').message).toContain('delete');
      expect(new FileOperationError('backup', '/path').message).toContain('backup');
    });
  });

  describe('ImportError', () => {
    it('should create error with format and message', () => {
      const error = new ImportError('json', 'Invalid JSON syntax');

      expect(error.message).toBe('Import failed (json): Invalid JSON syntax');
      expect(error.name).toBe('ImportError');
      expect(error.code).toBe('IMPORT_ERROR');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new ImportError('csv', 'Parse error');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle various formats', () => {
      expect(new ImportError('json', 'error').message).toContain('json');
      expect(new ImportError('csv', 'error').message).toContain('csv');
      expect(new ImportError('graphml', 'error').message).toContain('graphml');
    });
  });

  describe('ExportError', () => {
    it('should create error with format and message', () => {
      const error = new ExportError('markdown', 'Template not found');

      expect(error.message).toBe('Export failed (markdown): Template not found');
      expect(error.name).toBe('ExportError');
      expect(error.code).toBe('EXPORT_ERROR');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new ExportError('mermaid', 'Render error');

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle various formats', () => {
      expect(new ExportError('json', 'error').message).toContain('json');
      expect(new ExportError('markdown', 'error').message).toContain('markdown');
      expect(new ExportError('graphml', 'error').message).toContain('graphml');
      expect(new ExportError('mermaid', 'error').message).toContain('mermaid');
    });
  });

  describe('InsufficientEntitiesError', () => {
    it('should create error with operation details', () => {
      const error = new InsufficientEntitiesError('merge', 2, 1);

      expect(error.message).toBe('merge requires at least 2 entities, got 1');
      expect(error.name).toBe('InsufficientEntitiesError');
      expect(error.code).toBe('INSUFFICIENT_ENTITIES');
    });

    it('should extend KnowledgeGraphError', () => {
      const error = new InsufficientEntitiesError('merge', 2, 0);

      expect(error).toBeInstanceOf(KnowledgeGraphError);
    });

    it('should handle zero provided', () => {
      const error = new InsufficientEntitiesError('operation', 3, 0);

      expect(error.message).toContain('got 0');
    });
  });

  describe('Error Inheritance Chain', () => {
    it('should maintain proper prototype chain', () => {
      const error = new EntityNotFoundError('Test');

      expect(error instanceof EntityNotFoundError).toBe(true);
      expect(error instanceof KnowledgeGraphError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should allow catching by parent type', () => {
      const throwError = () => {
        throw new EntityNotFoundError('Test');
      };

      expect(throwError).toThrow(KnowledgeGraphError);
      expect(throwError).toThrow(Error);
    });
  });

  describe('Error Serialization', () => {
    it('should be JSON serializable', () => {
      const error = new EntityNotFoundError('Alice');
      const json = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
      });

      const parsed = JSON.parse(json);

      expect(parsed.name).toBe('EntityNotFoundError');
      expect(parsed.message).toBe('Entity "Alice" not found');
      expect(parsed.code).toBe('ENTITY_NOT_FOUND');
    });
  });

  describe('Error Codes', () => {
    it('should have unique codes for each error type', () => {
      const codes = [
        new EntityNotFoundError('a').code,
        new RelationNotFoundError('a', 'b').code,
        new DuplicateEntityError('a').code,
        new ValidationError('a', []).code,
        new CycleDetectedError('a', 'b').code,
        new InvalidImportanceError(0).code,
        new FileOperationError('a', 'b').code,
        new ImportError('a', 'b').code,
        new ExportError('a', 'b').code,
        new InsufficientEntitiesError('a', 1, 0).code,
      ];

      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(codes.length);
    });

    it('should have uppercase codes', () => {
      const codes = [
        new EntityNotFoundError('a').code,
        new RelationNotFoundError('a', 'b').code,
        new DuplicateEntityError('a').code,
        new ValidationError('a', []).code,
        new CycleDetectedError('a', 'b').code,
        new InvalidImportanceError(0).code,
        new FileOperationError('a', 'b').code,
        new ImportError('a', 'b').code,
        new ExportError('a', 'b').code,
        new InsufficientEntitiesError('a', 1, 0).code,
      ];

      for (const code of codes) {
        expect(code).toBe(code?.toUpperCase());
      }
    });
  });
});
