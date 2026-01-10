/**
 * BooleanSearch Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BooleanSearch } from '../../../src/search/BooleanSearch.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BooleanSearch', () => {
  let storage: GraphStorage;
  let booleanSearch: BooleanSearch;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `boolean-search-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    booleanSearch = new BooleanSearch(storage);
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);

    // Create test data
    await entityManager.createEntities([
      {
        name: 'Alice',
        entityType: 'person',
        observations: ['Software engineer', 'Loves Python programming', 'Works on AI projects'],
        tags: ['engineering', 'python', 'ai'],
        importance: 9,
      },
      {
        name: 'Bob',
        entityType: 'person',
        observations: ['Product manager', 'Leads roadmap planning'],
        tags: ['product', 'management'],
        importance: 8,
      },
      {
        name: 'Charlie',
        entityType: 'person',
        observations: ['Designer', 'Creates beautiful UIs', 'Expert in Figma'],
        tags: ['design', 'ui'],
        importance: 7,
      },
      {
        name: 'Project_X',
        entityType: 'project',
        observations: ['Internal automation tool', 'Built with Python'],
        tags: ['engineering', 'automation', 'python'],
        importance: 10,
      },
      {
        name: 'Company',
        entityType: 'organization',
        observations: ['Tech startup', 'AI-focused company'],
        tags: ['business', 'ai'],
        importance: 10,
      },
    ]);

    await relationManager.createRelations([
      { from: 'Alice', to: 'Project_X', relationType: 'works_on' },
      { from: 'Bob', to: 'Project_X', relationType: 'manages' },
      { from: 'Alice', to: 'Bob', relationType: 'reports_to' },
    ]);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('AND Operator', () => {
    it('should find entities matching all AND terms', async () => {
      const result = await booleanSearch.booleanSearch('Python AND engineer');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should support explicit AND operator', async () => {
      const result = await booleanSearch.booleanSearch('person AND manager');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Bob');
    });

    it('should support implicit AND (adjacent terms)', async () => {
      const result = await booleanSearch.booleanSearch('engineer python');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should return empty results when no entities match all terms', async () => {
      const result = await booleanSearch.booleanSearch('engineer AND designer');

      // Alice is engineer, Charlie is designer, but none is both
      expect(result.entities).toHaveLength(0);
    });

    it('should handle multiple AND operators', async () => {
      const result = await booleanSearch.booleanSearch('person AND engineer AND Python');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });
  });

  describe('OR Operator', () => {
    it('should find entities matching any OR term', async () => {
      const result = await booleanSearch.booleanSearch('engineer OR designer');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
    });

    it('should support multiple OR operators', async () => {
      const result = await booleanSearch.booleanSearch('Alice OR Bob OR Charlie');

      expect(result.entities).toHaveLength(3);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
    });

    it('should handle OR with partial matches', async () => {
      const result = await booleanSearch.booleanSearch('Python OR Figma');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      // Alice and Project_X have Python, Charlie has Figma
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
    });
  });

  describe('NOT Operator', () => {
    it('should exclude entities matching NOT term', async () => {
      const result = await booleanSearch.booleanSearch('person AND NOT manager');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
      expect(names).not.toContain('Bob'); // Bob is manager
    });

    it('should handle NOT with specific field', async () => {
      const result = await booleanSearch.booleanSearch('NOT type:project');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('Project_X');
    });

    it('should support double NOT', async () => {
      const result = await booleanSearch.booleanSearch('NOT NOT Alice');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });
  });

  describe('Parentheses Grouping', () => {
    it('should support parentheses for precedence', async () => {
      const result = await booleanSearch.booleanSearch('person AND (Python OR Figma)');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice'); // person with Python
      expect(names).toContain('Charlie'); // person with Figma
      expect(names).not.toContain('Project_X'); // not a person
    });

    it('should handle nested parentheses', async () => {
      const result = await booleanSearch.booleanSearch('(person OR project) AND (Python OR automation)');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice'); // person with Python
      expect(names).toContain('Project_X'); // project with Python and automation
    });

    it('should handle NOT with parentheses', async () => {
      const result = await booleanSearch.booleanSearch('person AND NOT (manager OR designer)');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice'); // Only person who isn't manager or designer
    });
  });

  describe('Field-Specific Queries', () => {
    it('should support name field query', async () => {
      const result = await booleanSearch.booleanSearch('name:Alice');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should support type field query', async () => {
      const result = await booleanSearch.booleanSearch('type:person');

      expect(result.entities).toHaveLength(3);
      result.entities.forEach(e => {
        expect(e.entityType).toBe('person');
      });
    });

    it('should support entitytype field query', async () => {
      const result = await booleanSearch.booleanSearch('entitytype:organization');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].entityType).toBe('organization');
    });

    it('should support observation field query', async () => {
      const result = await booleanSearch.booleanSearch('observation:engineer');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should support observations field query', async () => {
      const result = await booleanSearch.booleanSearch('observations:manager');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Bob');
    });

    it('should support tag field query', async () => {
      const result = await booleanSearch.booleanSearch('tag:python');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      result.entities.forEach(e => {
        expect(e.tags).toContain('python');
      });
    });

    it('should support tags field query', async () => {
      const result = await booleanSearch.booleanSearch('tags:ai');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      result.entities.forEach(e => {
        expect(e.tags).toContain('ai');
      });
    });

    it('should combine multiple field queries', async () => {
      const result = await booleanSearch.booleanSearch('type:person AND tag:python');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should handle unknown field gracefully', async () => {
      const result = await booleanSearch.booleanSearch('unknownfield:test');

      // Should fallback to general search across all fields
      expect(Array.isArray(result.entities)).toBe(true);
    });

    it('should handle field query with colon in value', async () => {
      await entityManager.createEntities([
        { name: 'URL_Entity', entityType: 'test', observations: ['https://example.com'] },
      ]);

      const result = await booleanSearch.booleanSearch('observation:https');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('URL_Entity');
    });
  });

  describe('Tag Filtering', () => {
    it('should filter by single tag', async () => {
      const result = await booleanSearch.booleanSearch('engineer', ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.tags).toContain('python');
      });
    });

    it('should filter by multiple tags (OR logic)', async () => {
      const result = await booleanSearch.booleanSearch('person', ['python', 'design']);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      result.entities.forEach(e => {
        const hasPython = e.tags?.includes('python');
        const hasDesign = e.tags?.includes('design');
        expect(hasPython || hasDesign).toBe(true);
      });
    });

    it('should combine boolean query with tag filter', async () => {
      const result = await booleanSearch.booleanSearch('person OR project', ['python']);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Project_X');
    });

    it('should exclude entities without matching tags', async () => {
      const result = await booleanSearch.booleanSearch('person', ['nonexistent']);

      expect(result.entities).toHaveLength(0);
    });
  });

  describe('Importance Filtering', () => {
    it('should filter by minimum importance', async () => {
      const result = await booleanSearch.booleanSearch('person OR project', undefined, 9);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance).toBeGreaterThanOrEqual(9);
      });
    });

    it('should filter by maximum importance', async () => {
      const result = await booleanSearch.booleanSearch('person', undefined, undefined, 8);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance!).toBeLessThanOrEqual(8);
      });
    });

    it('should filter by importance range', async () => {
      const result = await booleanSearch.booleanSearch('person OR project', undefined, 8, 9);

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      result.entities.forEach(e => {
        expect(e.importance!).toBeGreaterThanOrEqual(8);
        expect(e.importance!).toBeLessThanOrEqual(9);
      });
    });

    it('should combine boolean query with importance filter', async () => {
      const result = await booleanSearch.booleanSearch('Python', undefined, 10);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Project_X');
      // Company doesn't have Python, Alice has importance 9
    });
  });

  describe('Relations', () => {
    it('should include relations between matched entities', async () => {
      const result = await booleanSearch.booleanSearch('Alice OR Bob');

      expect(result.entities).toHaveLength(2);
      expect(result.relations.length).toBeGreaterThan(0);
      expect(result.relations.some(r => r.from === 'Alice' && r.to === 'Bob')).toBe(true);
    });

    it('should exclude relations to non-matched entities', async () => {
      const result = await booleanSearch.booleanSearch('name:Alice');

      expect(result.entities).toHaveLength(1);
      // Alice has relations to Bob and Project_X, but they're not in the result
      expect(result.relations).toHaveLength(0);
    });

    it('should include all relations in matched subgraph', async () => {
      const result = await booleanSearch.booleanSearch('Alice OR Bob OR Project_X');

      expect(result.entities).toHaveLength(3);
      expect(result.relations.length).toBeGreaterThan(0);
      expect(result.relations.some(r => r.from === 'Alice' && r.to === 'Project_X')).toBe(true);
      expect(result.relations.some(r => r.from === 'Bob' && r.to === 'Project_X')).toBe(true);
    });
  });

  describe('Case Sensitivity', () => {
    it('should be case-insensitive for terms', async () => {
      const result = await booleanSearch.booleanSearch('ALICE');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should be case-insensitive for field queries', async () => {
      const result = await booleanSearch.booleanSearch('TYPE:PERSON');

      expect(result.entities).toHaveLength(3);
    });

    it('should be case-insensitive for operators', async () => {
      const result = await booleanSearch.booleanSearch('alice or bob');

      expect(result.entities).toHaveLength(2);
    });
  });

  describe('Quoted Strings', () => {
    it('should support quoted strings for multi-word searches', async () => {
      const result = await booleanSearch.booleanSearch('"Software engineer"');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });

    it('should combine quoted strings with operators', async () => {
      const result = await booleanSearch.booleanSearch('"Product manager" OR "Software engineer"');

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('should support quoted strings in field queries', async () => {
      const result = await booleanSearch.booleanSearch('observation:"beautiful UIs"');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Charlie');
    });
  });

  describe('Edge Cases', () => {
    it('should handle single term query', async () => {
      const result = await booleanSearch.booleanSearch('Alice');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Alice');
    });

    it('should handle entities with empty observations', async () => {
      await entityManager.createEntities([
        { name: 'EmptyObs', entityType: 'test', observations: [] },
      ]);

      const result = await booleanSearch.booleanSearch('type:test');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('EmptyObs');
    });

    it('should handle entities without tags', async () => {
      await entityManager.createEntities([
        { name: 'NoTags', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await booleanSearch.booleanSearch('test');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle entities without importance', async () => {
      await entityManager.createEntities([
        { name: 'NoImportance', entityType: 'test', observations: ['Test'] },
      ]);

      const result = await booleanSearch.booleanSearch('test', undefined, 5);

      const names = result.entities.map(e => e.name);
      expect(names).not.toContain('NoImportance');
    });

    it('should throw error on malformed query (unclosed parenthesis)', async () => {
      await expect(
        booleanSearch.booleanSearch('(person AND manager')
      ).rejects.toThrow();
    });

    it('should throw error on malformed query (unexpected token)', async () => {
      await expect(
        booleanSearch.booleanSearch('person) AND manager')
      ).rejects.toThrow();
    });

    it('should throw error on empty query', async () => {
      await expect(
        booleanSearch.booleanSearch('')
      ).rejects.toThrow();
    });

    it('should handle complex nested query', async () => {
      const result = await booleanSearch.booleanSearch(
        '(type:person AND (tag:python OR tag:design)) OR (type:project AND tag:automation)'
      );

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      const names = result.entities.map(e => e.name);
      // Alice (person with python tag), Charlie (person with design tag), Project_X (project with automation tag)
      expect(names).toContain('Alice');
      expect(names).toContain('Charlie');
      expect(names).toContain('Project_X');
    });

    it('should handle whitespace in query', async () => {
      const result = await booleanSearch.booleanSearch('  person   AND   engineer  ');

      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map(e => e.name);
      expect(names).toContain('Alice');
    });
  });

  describe('Return Value Structure', () => {
    it('should return KnowledgeGraph with entities and relations', async () => {
      const result = await booleanSearch.booleanSearch('person');

      expect(result).toHaveProperty('entities');
      expect(result).toHaveProperty('relations');
      expect(Array.isArray(result.entities)).toBe(true);
      expect(Array.isArray(result.relations)).toBe(true);
    });

    it('should return complete entity objects', async () => {
      const result = await booleanSearch.booleanSearch('Alice');

      expect(result.entities[0]).toHaveProperty('name');
      expect(result.entities[0]).toHaveProperty('entityType');
      expect(result.entities[0]).toHaveProperty('observations');
      expect(result.entities[0]).toHaveProperty('tags');
      expect(result.entities[0]).toHaveProperty('importance');
    });
  });
});
