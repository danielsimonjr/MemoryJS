/**
 * Tests for Error Suggestions
 *
 * @module tests/unit/utils/errorSuggestions.test
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions, getQuickHint } from '../../../src/utils/errorSuggestions.js';
import { ErrorCode } from '../../../src/utils/errors.js';

describe('errorSuggestions', () => {
  describe('generateSuggestions', () => {
    describe('Entity Errors', () => {
      it('should generate suggestions for ENTITY_NOT_FOUND', () => {
        const suggestions = generateSuggestions(ErrorCode.ENTITY_NOT_FOUND);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('spelled'))).toBe(true);
        expect(suggestions.some(s => s.includes('search'))).toBe(true);
      });

      it('should include entity name in ENTITY_NOT_FOUND when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.ENTITY_NOT_FOUND, {
          entityName: 'Alice',
        });

        expect(suggestions.some(s => s.includes('Alice'))).toBe(true);
      });

      it('should generate suggestions for DUPLICATE_ENTITY', () => {
        const suggestions = generateSuggestions(ErrorCode.DUPLICATE_ENTITY);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('different'))).toBe(true);
        expect(suggestions.some(s => s.includes('update'))).toBe(true);
      });
    });

    describe('Relation Errors', () => {
      it('should generate suggestions for RELATION_NOT_FOUND', () => {
        const suggestions = generateSuggestions(ErrorCode.RELATION_NOT_FOUND);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('entities'))).toBe(true);
        expect(suggestions.some(s => s.includes('relation'))).toBe(true);
      });
    });

    describe('Storage Errors', () => {
      it('should generate suggestions for STORAGE_READ_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.STORAGE_READ_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('file'))).toBe(true);
        expect(suggestions.some(s => s.includes('permission'))).toBe(true);
      });

      it('should include path in STORAGE_READ_FAILED when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.STORAGE_READ_FAILED, {
          path: '/data/memory.jsonl',
        });

        expect(suggestions.some(s => s.includes('/data/memory.jsonl'))).toBe(true);
      });

      it('should generate suggestions for STORAGE_WRITE_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.STORAGE_WRITE_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('permission'))).toBe(true);
        expect(suggestions.some(s => s.includes('disk space'))).toBe(true);
      });

      it('should generate suggestions for STORAGE_CORRUPTED', () => {
        const suggestions = generateSuggestions(ErrorCode.STORAGE_CORRUPTED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('backup'))).toBe(true);
        expect(suggestions.some(s => s.includes('corruption'))).toBe(true);
      });
    });

    describe('Search Errors', () => {
      it('should generate suggestions for INVALID_QUERY', () => {
        const suggestions = generateSuggestions(ErrorCode.INVALID_QUERY);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('syntax'))).toBe(true);
        expect(suggestions.some(s => s.includes('quotes'))).toBe(true);
      });

      it('should include query in INVALID_QUERY when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.INVALID_QUERY, {
          query: 'broken "query',
        });

        expect(suggestions.some(s => s.includes('broken "query'))).toBe(true);
      });

      it('should generate suggestions for SEARCH_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.SEARCH_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('index'))).toBe(true);
        expect(suggestions.some(s => s.includes('simpler'))).toBe(true);
      });

      it('should generate suggestions for INDEX_NOT_READY', () => {
        const suggestions = generateSuggestions(ErrorCode.INDEX_NOT_READY);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('indexing'))).toBe(true);
        expect(suggestions.some(s => s.includes('initialize'))).toBe(true);
      });
    });

    describe('Embedding Errors', () => {
      it('should generate suggestions for EMBEDDING_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.EMBEDDING_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('MEMORY_EMBEDDING_PROVIDER'))).toBe(true);
        expect(suggestions.some(s => s.includes('API key'))).toBe(true);
      });
    });

    describe('Dependency Errors', () => {
      it('should generate suggestions for MISSING_DEPENDENCY', () => {
        const suggestions = generateSuggestions(ErrorCode.MISSING_DEPENDENCY);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('npm install'))).toBe(true);
        expect(suggestions.some(s => s.includes('peer dependencies'))).toBe(true);
      });

      it('should include dependency name when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.MISSING_DEPENDENCY, {
          dependency: 'ajv',
        });

        expect(suggestions.some(s => s.includes('ajv'))).toBe(true);
      });

      it('should generate suggestions for UNSUPPORTED_FEATURE', () => {
        const suggestions = generateSuggestions(ErrorCode.UNSUPPORTED_FEATURE);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('configuration'))).toBe(true);
        expect(suggestions.some(s => s.includes('documentation'))).toBe(true);
      });
    });

    describe('Validation Errors', () => {
      it('should generate suggestions for VALIDATION_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.VALIDATION_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('validation errors'))).toBe(true);
        expect(suggestions.some(s => s.includes('required fields'))).toBe(true);
      });

      it('should generate suggestions for SCHEMA_VALIDATION_FAILED', () => {
        const suggestions = generateSuggestions(ErrorCode.SCHEMA_VALIDATION_FAILED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('JSON Schema'))).toBe(true);
        expect(suggestions.some(s => s.includes('properties'))).toBe(true);
      });

      it('should generate suggestions for INVALID_IMPORTANCE', () => {
        const suggestions = generateSuggestions(ErrorCode.INVALID_IMPORTANCE);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('0 and 10'))).toBe(true);
      });

      it('should generate suggestions for CYCLE_DETECTED', () => {
        const suggestions = generateSuggestions(ErrorCode.CYCLE_DETECTED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('parent-child'))).toBe(true);
        expect(suggestions.some(s => s.includes('ancestor'))).toBe(true);
      });
    });

    describe('Import/Export Errors', () => {
      it('should generate suggestions for IMPORT_ERROR', () => {
        const suggestions = generateSuggestions(ErrorCode.IMPORT_ERROR);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('format'))).toBe(true);
        expect(suggestions.some(s => s.includes('syntax'))).toBe(true);
      });

      it('should include format in IMPORT_ERROR when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.IMPORT_ERROR, {
          format: 'json',
        });

        expect(suggestions.some(s => s.includes('json'))).toBe(true);
      });

      it('should generate suggestions for EXPORT_ERROR', () => {
        const suggestions = generateSuggestions(ErrorCode.EXPORT_ERROR);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('permission'))).toBe(true);
        expect(suggestions.some(s => s.includes('disk space'))).toBe(true);
      });

      it('should include format in EXPORT_ERROR when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.EXPORT_ERROR, {
          format: 'csv',
        });

        expect(suggestions.some(s => s.includes('csv'))).toBe(true);
      });
    });

    describe('File Operation Errors', () => {
      it('should generate suggestions for FILE_OPERATION_ERROR', () => {
        const suggestions = generateSuggestions(ErrorCode.FILE_OPERATION_ERROR);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('permission'))).toBe(true);
        expect(suggestions.some(s => s.includes('file path'))).toBe(true);
      });

      it('should include operation and path when provided', () => {
        const suggestions = generateSuggestions(ErrorCode.FILE_OPERATION_ERROR, {
          operation: 'read',
          path: '/data/file.json',
        });

        expect(suggestions.some(s => s.includes('read'))).toBe(true);
        expect(suggestions.some(s => s.includes('/data/file.json'))).toBe(true);
      });
    });

    describe('Config Errors', () => {
      it('should generate suggestions for INVALID_CONFIG', () => {
        const suggestions = generateSuggestions(ErrorCode.INVALID_CONFIG);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('configuration'))).toBe(true);
        expect(suggestions.some(s => s.includes('typos'))).toBe(true);
      });
    });

    describe('Other Errors', () => {
      it('should generate suggestions for OPERATION_CANCELLED', () => {
        const suggestions = generateSuggestions(ErrorCode.OPERATION_CANCELLED);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('cancelled'))).toBe(true);
        expect(suggestions.some(s => s.includes('Retry'))).toBe(true);
      });

      it('should generate suggestions for INSUFFICIENT_ENTITIES', () => {
        const suggestions = generateSuggestions(ErrorCode.INSUFFICIENT_ENTITIES);

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('entities'))).toBe(true);
      });
    });

    describe('Unknown Errors', () => {
      it('should generate default suggestions for unknown error code', () => {
        const suggestions = generateSuggestions('UNKNOWN_ERROR_CODE');

        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some(s => s.includes('error message'))).toBe(true);
        expect(suggestions.some(s => s.includes('documentation'))).toBe(true);
      });

      it('should handle null context', () => {
        const suggestions = generateSuggestions(ErrorCode.ENTITY_NOT_FOUND);
        expect(suggestions.length).toBeGreaterThan(0);
      });

      it('should handle empty context', () => {
        const suggestions = generateSuggestions(ErrorCode.ENTITY_NOT_FOUND, {});
        expect(suggestions.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getQuickHint', () => {
    it('should return hint for ENTITY_NOT_FOUND', () => {
      const hint = getQuickHint(ErrorCode.ENTITY_NOT_FOUND);

      expect(hint).toBeTruthy();
      expect(hint).toContain('does not exist');
    });

    it('should return hint for RELATION_NOT_FOUND', () => {
      const hint = getQuickHint(ErrorCode.RELATION_NOT_FOUND);

      expect(hint).toBeTruthy();
      expect(hint).toContain('does not exist');
    });

    it('should return hint for DUPLICATE_ENTITY', () => {
      const hint = getQuickHint(ErrorCode.DUPLICATE_ENTITY);

      expect(hint).toBeTruthy();
      expect(hint).toContain('already exists');
    });

    it('should return hint for VALIDATION_FAILED', () => {
      const hint = getQuickHint(ErrorCode.VALIDATION_FAILED);

      expect(hint).toBeTruthy();
      expect(hint).toContain('Invalid data');
    });

    it('should return hint for CYCLE_DETECTED', () => {
      const hint = getQuickHint(ErrorCode.CYCLE_DETECTED);

      expect(hint).toBeTruthy();
      expect(hint).toContain('Circular');
    });

    it('should return hint for OPERATION_CANCELLED', () => {
      const hint = getQuickHint(ErrorCode.OPERATION_CANCELLED);

      expect(hint).toBeTruthy();
      expect(hint).toContain('cancelled');
    });

    it('should return default hint for unknown error code', () => {
      const hint = getQuickHint('UNKNOWN_ERROR');

      expect(hint).toBeTruthy();
      expect(hint).toContain('error occurred');
    });

    it('should return concise single-line hints', () => {
      const codes = [
        ErrorCode.ENTITY_NOT_FOUND,
        ErrorCode.DUPLICATE_ENTITY,
        ErrorCode.VALIDATION_FAILED,
        ErrorCode.CYCLE_DETECTED,
      ];

      for (const code of codes) {
        const hint = getQuickHint(code);
        expect(hint.split('\n').length).toBe(1);
        expect(hint.length).toBeLessThan(100);
      }
    });
  });

  describe('Suggestions Quality', () => {
    it('should provide actionable suggestions', () => {
      const suggestions = generateSuggestions(ErrorCode.STORAGE_READ_FAILED);

      // Suggestions should be actionable (contain verbs)
      const actionWords = ['Check', 'Verify', 'Ensure', 'Use', 'Try', 'Review'];
      const hasActionable = suggestions.some(s =>
        actionWords.some(word => s.includes(word))
      );

      expect(hasActionable).toBe(true);
    });

    it('should not have duplicate suggestions', () => {
      const codes = Object.values(ErrorCode);

      for (const code of codes) {
        const suggestions = generateSuggestions(code);
        const uniqueSuggestions = new Set(suggestions);
        expect(suggestions.length).toBe(uniqueSuggestions.size);
      }
    });

    it('should have non-empty suggestions', () => {
      const codes = Object.values(ErrorCode);

      for (const code of codes) {
        const suggestions = generateSuggestions(code);
        for (const suggestion of suggestions) {
          expect(suggestion.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });
});
