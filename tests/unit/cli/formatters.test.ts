/**
 * Tests for CLI Output Formatters
 *
 * @module tests/unit/cli/formatters.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatEntities,
  formatRelations,
  formatSearchResults,
  formatEntityDetail,
  formatSuccess,
  formatError,
} from '../../../src/cli/formatters.js';
import type { Entity, Relation } from '../../../src/types/types.js';

describe('CLI Formatters', () => {
  // Sample test data
  const sampleEntities: Entity[] = [
    {
      name: 'Entity1',
      entityType: 'person',
      observations: ['Observation 1', 'Observation 2'],
      tags: ['tag1', 'tag2'],
    },
    {
      name: 'Entity2',
      entityType: 'organization',
      observations: ['Observation A'],
      tags: [],
    },
  ];

  const sampleRelations: Relation[] = [
    {
      from: 'Entity1',
      to: 'Entity2',
      relationType: 'works_for',
    },
    {
      from: 'Entity2',
      to: 'Entity3',
      relationType: 'owns',
    },
  ];

  describe('formatEntities', () => {
    describe('JSON format', () => {
      it('should format entities as JSON', () => {
        const result = formatEntities(sampleEntities, 'json');
        const parsed = JSON.parse(result);
        expect(parsed).toEqual(sampleEntities);
      });

      it('should return empty array for no entities', () => {
        const result = formatEntities([], 'json');
        expect(result).toBe('[]');
      });

      it('should pretty-print JSON with indentation', () => {
        const result = formatEntities(sampleEntities, 'json');
        expect(result).toContain('\n');
        expect(result).toContain('  '); // 2-space indentation
      });

      it('should handle entities with special characters', () => {
        const entities: Entity[] = [{
          name: 'Test "Entity"',
          entityType: 'type',
          observations: ['Line 1\nLine 2'],
          tags: [],
        }];
        const result = formatEntities(entities, 'json');
        expect(() => JSON.parse(result)).not.toThrow();
      });

      it('should handle entities with undefined observations', () => {
        const entities: Entity[] = [{
          name: 'Test',
          entityType: 'type',
          observations: undefined as unknown as string[],
          tags: undefined as unknown as string[],
        }];
        const result = formatEntities(entities, 'json');
        expect(() => JSON.parse(result)).not.toThrow();
      });
    });

    describe('Table format', () => {
      it('should format entities as table', () => {
        const result = formatEntities(sampleEntities, 'table');
        expect(result).toContain('Entity1');
        expect(result).toContain('person');
        expect(result).toContain('Entity2');
        // Note: 'organization' may be truncated to 'organiza...' in narrow columns
        expect(result).toMatch(/organiza/);
      });

      it('should return message for no entities', () => {
        const result = formatEntities([], 'table');
        expect(result).toBe('No entities found.');
      });

      it('should truncate long observation lists', () => {
        const entities: Entity[] = [{
          name: 'Test',
          entityType: 'type',
          observations: ['Obs1', 'Obs2', 'Obs3', 'Obs4', 'Obs5'],
          tags: [],
        }];
        const result = formatEntities(entities, 'table');
        // Should show first 3 and ellipsis
        expect(result).toContain('...');
      });

      it('should join tags with commas', () => {
        const result = formatEntities(sampleEntities, 'table');
        expect(result).toContain('tag1, tag2');
      });

      it('should handle entities without tags', () => {
        const entities: Entity[] = [{
          name: 'Test',
          entityType: 'type',
          observations: [],
          tags: [],
        }];
        const result = formatEntities(entities, 'table');
        expect(result).toContain('Test');
      });
    });

    describe('CSV format', () => {
      it('should format entities as CSV', () => {
        const result = formatEntities(sampleEntities, 'csv');
        const lines = result.split('\n');
        expect(lines[0]).toBe('name,entityType,observations,tags');
        expect(lines.length).toBe(3); // header + 2 entities
      });

      it('should return header only for no entities', () => {
        const result = formatEntities([], 'csv');
        expect(result).toBe('No entities found.');
      });

      it('should escape commas in values', () => {
        const entities: Entity[] = [{
          name: 'Entity, Inc',
          entityType: 'organization',
          observations: [],
          tags: [],
        }];
        const result = formatEntities(entities, 'csv');
        expect(result).toContain('"Entity, Inc"');
      });

      it('should escape quotes in values', () => {
        const entities: Entity[] = [{
          name: 'Entity "Test"',
          entityType: 'type',
          observations: [],
          tags: [],
        }];
        const result = formatEntities(entities, 'csv');
        expect(result).toContain('"Entity ""Test"""');
      });

      it('should escape newlines in values', () => {
        const entities: Entity[] = [{
          name: 'Entity',
          entityType: 'type',
          observations: ['Line 1\nLine 2'],
          tags: [],
        }];
        const result = formatEntities(entities, 'csv');
        expect(result).toContain('"Line 1\nLine 2"');
      });

      it('should join observations with semicolons', () => {
        const result = formatEntities(sampleEntities, 'csv');
        expect(result).toContain('Observation 1; Observation 2');
      });
    });
  });

  describe('formatRelations', () => {
    describe('JSON format', () => {
      it('should format relations as JSON', () => {
        const result = formatRelations(sampleRelations, 'json');
        const parsed = JSON.parse(result);
        expect(parsed).toEqual(sampleRelations);
      });

      it('should return empty array for no relations', () => {
        const result = formatRelations([], 'json');
        expect(result).toBe('[]');
      });

      it('should pretty-print JSON', () => {
        const result = formatRelations(sampleRelations, 'json');
        expect(result).toContain('\n');
      });
    });

    describe('Table format', () => {
      it('should format relations as table', () => {
        const result = formatRelations(sampleRelations, 'table');
        expect(result).toContain('Entity1');
        expect(result).toContain('works_for');
        expect(result).toContain('Entity2');
      });

      it('should return message for no relations', () => {
        const result = formatRelations([], 'table');
        expect(result).toBe('No relations found.');
      });

      it('should display all relation columns', () => {
        const result = formatRelations(sampleRelations, 'table');
        expect(result).toContain('From');
        expect(result).toContain('Relation');
        expect(result).toContain('To');
      });
    });

    describe('CSV format', () => {
      it('should format relations as CSV', () => {
        const result = formatRelations(sampleRelations, 'csv');
        const lines = result.split('\n');
        expect(lines[0]).toBe('from,relationType,to');
        expect(lines.length).toBe(3);
      });

      it('should return message for no relations', () => {
        const result = formatRelations([], 'csv');
        expect(result).toBe('No relations found.');
      });

      it('should escape special characters', () => {
        const relations: Relation[] = [{
          from: 'Entity, Inc',
          to: 'Target "Corp"',
          relationType: 'owns',
        }];
        const result = formatRelations(relations, 'csv');
        expect(result).toContain('"Entity, Inc"');
        expect(result).toContain('"Target ""Corp"""');
      });
    });
  });

  describe('formatSearchResults', () => {
    const sampleResults = [
      { entity: sampleEntities[0], score: 0.95 },
      { entity: sampleEntities[1], score: 0.75 },
    ];

    describe('JSON format', () => {
      it('should format search results as JSON', () => {
        const result = formatSearchResults(sampleResults, 'json');
        const parsed = JSON.parse(result);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].score).toBe(0.95);
      });

      it('should return empty array for no results', () => {
        const result = formatSearchResults([], 'json');
        expect(result).toBe('[]');
      });
    });

    describe('Table format', () => {
      it('should format search results as table', () => {
        const result = formatSearchResults(sampleResults, 'table');
        expect(result).toContain('Entity1');
        expect(result).toContain('0.950');
      });

      it('should return message for no results', () => {
        const result = formatSearchResults([], 'table');
        expect(result).toBe('No results found.');
      });

      it('should show dash for missing score', () => {
        const results = [{ entity: sampleEntities[0] }];
        const result = formatSearchResults(results, 'table');
        expect(result).toContain('-');
      });

      it('should truncate long observations', () => {
        const results = [{
          entity: {
            ...sampleEntities[0],
            observations: ['Obs1', 'Obs2', 'Obs3', 'Obs4'],
          },
          score: 1.0,
        }];
        const result = formatSearchResults(results, 'table');
        expect(result).toContain('...');
      });
    });

    describe('CSV format', () => {
      it('should format search results as CSV', () => {
        const result = formatSearchResults(sampleResults, 'csv');
        const lines = result.split('\n');
        expect(lines[0]).toBe('name,entityType,score,observations');
        expect(lines.length).toBe(3);
      });

      it('should return message for no results', () => {
        const result = formatSearchResults([], 'csv');
        expect(result).toBe('No results found.');
      });

      it('should format scores with 3 decimal places', () => {
        const result = formatSearchResults(sampleResults, 'csv');
        expect(result).toContain('0.950');
        expect(result).toContain('0.750');
      });

      it('should handle missing score', () => {
        const results = [{ entity: sampleEntities[0] }];
        const result = formatSearchResults(results, 'csv');
        const lines = result.split('\n');
        // Score field should be empty
        expect(lines[1]).toMatch(/,,[^,]*$/); // empty score between commas
      });
    });
  });

  describe('formatEntityDetail', () => {
    describe('JSON format', () => {
      it('should format single entity as JSON', () => {
        const result = formatEntityDetail(sampleEntities[0], 'json');
        const parsed = JSON.parse(result);
        expect(parsed.name).toBe('Entity1');
      });

      it('should return null for missing entity', () => {
        const result = formatEntityDetail(null, 'json');
        expect(result).toBe('null');
      });
    });

    describe('Table format', () => {
      it('should format entity details', () => {
        const entity: Entity = {
          name: 'TestEntity',
          entityType: 'person',
          importance: 8,
          tags: ['important', 'verified'],
          parentId: 'ParentEntity',
          createdAt: '2024-01-01',
          lastModified: '2024-01-02',
          observations: ['First observation', 'Second observation'],
        };

        const result = formatEntityDetail(entity, 'table');
        expect(result).toContain('Name:');
        expect(result).toContain('TestEntity');
        expect(result).toContain('Type:');
        expect(result).toContain('person');
        expect(result).toContain('Importance:');
        expect(result).toContain('8');
        expect(result).toContain('Tags:');
        expect(result).toContain('important, verified');
        expect(result).toContain('Parent:');
        expect(result).toContain('ParentEntity');
        expect(result).toContain('Observations:');
        expect(result).toContain('1. First observation');
        expect(result).toContain('2. Second observation');
      });

      it('should return message for missing entity', () => {
        const result = formatEntityDetail(null, 'table');
        expect(result).toBe('Entity not found.');
      });

      it('should show N/A for missing importance', () => {
        const entity: Entity = {
          name: 'Test',
          entityType: 'type',
          observations: [],
        };
        const result = formatEntityDetail(entity, 'table');
        expect(result).toContain('N/A');
      });

      it('should show None for missing tags', () => {
        const entity: Entity = {
          name: 'Test',
          entityType: 'type',
          tags: [],
          observations: [],
        };
        const result = formatEntityDetail(entity, 'table');
        expect(result).toMatch(/Tags:.*None/);
      });

      it('should show None for missing parent', () => {
        const entity: Entity = {
          name: 'Test',
          entityType: 'type',
          observations: [],
        };
        const result = formatEntityDetail(entity, 'table');
        expect(result).toMatch(/Parent:.*None/);
      });
    });

    describe('CSV format', () => {
      it('should format entity as CSV fields', () => {
        const result = formatEntityDetail(sampleEntities[0], 'csv');
        const lines = result.split('\n');
        expect(lines[0]).toBe('field,value');
        expect(lines).toContainEqual(expect.stringContaining('name,Entity1'));
        expect(lines).toContainEqual(expect.stringContaining('entityType,person'));
      });

      it('should return message for missing entity', () => {
        const result = formatEntityDetail(null, 'csv');
        expect(result).toBe('Entity not found.');
      });

      it('should escape special characters in observations', () => {
        const entity: Entity = {
          name: 'Test',
          entityType: 'type',
          observations: ['Obs with, comma', 'Obs with "quotes"'],
        };
        const result = formatEntityDetail(entity, 'csv');
        expect(result).toContain('"Obs with, comma; Obs with ""quotes"""');
      });
    });
  });

  describe('formatSuccess', () => {
    it('should format success message with checkmark', () => {
      const result = formatSuccess('Operation completed');
      expect(result).toContain('✓');
      expect(result).toContain('Operation completed');
    });

    it('should handle empty message', () => {
      const result = formatSuccess('');
      expect(result).toContain('✓');
    });
  });

  describe('formatError', () => {
    it('should format error message with X mark', () => {
      const result = formatError('Operation failed');
      expect(result).toContain('✗');
      expect(result).toContain('Operation failed');
    });

    it('should handle empty message', () => {
      const result = formatError('');
      expect(result).toContain('✗');
    });
  });

  describe('Terminal width handling', () => {
    let originalColumns: number | undefined;

    beforeEach(() => {
      originalColumns = process.stdout.columns;
    });

    afterEach(() => {
      if (originalColumns !== undefined) {
        Object.defineProperty(process.stdout, 'columns', {
          value: originalColumns,
          configurable: true,
        });
      }
    });

    it('should handle narrow terminal width', () => {
      Object.defineProperty(process.stdout, 'columns', {
        value: 40,
        configurable: true,
      });

      // Should not throw with narrow terminal
      expect(() => formatEntities(sampleEntities, 'table')).not.toThrow();
    });

    it('should handle wide terminal width', () => {
      Object.defineProperty(process.stdout, 'columns', {
        value: 200,
        configurable: true,
      });

      // Should not throw with wide terminal
      expect(() => formatEntities(sampleEntities, 'table')).not.toThrow();
    });

    it('should handle undefined terminal width', () => {
      Object.defineProperty(process.stdout, 'columns', {
        value: undefined,
        configurable: true,
      });

      // Should fall back to default width (80)
      expect(() => formatEntities(sampleEntities, 'table')).not.toThrow();
    });
  });
});
