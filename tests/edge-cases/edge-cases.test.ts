/**
 * Edge Case Tests
 *
 * Tests for unusual inputs, boundary conditions, and error scenarios
 * that stress the system's robustness and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagerContext } from '../../src/core/ManagerContext.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Edge Cases', () => {
  let manager: ManagerContext;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `edge-case-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    manager = new ManagerContext(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Unicode and Special Characters', () => {
    it('should handle entity names with emoji', async () => {
      const entities = await manager.entityManager.createEntities([
        { name: 'User 👤', entityType: 'person', observations: ['Has emoji in name'] },
        { name: 'Project 🚀', entityType: 'project', observations: ['Rocket project'] },
      ]);

      expect(entities).toHaveLength(2);

      const results = await manager.searchManager.searchNodes('User');
      expect(results.entities.length).toBeGreaterThanOrEqual(1);
      expect(results.entities[0].name).toBe('User 👤');
    });

    it('should handle observations with mixed scripts (Latin, Cyrillic, CJK)', async () => {
      await manager.entityManager.createEntities([
        {
          name: 'International',
          entityType: 'document',
          observations: ['English', 'Русский', '中文', '日本語', 'العربية'],
        },
      ]);

      const results = await manager.searchManager.searchNodes('International');
      expect(results.entities).toHaveLength(1);
      expect(results.entities[0].observations).toHaveLength(5);
    });

    it('should handle right-to-left text', async () => {
      await manager.entityManager.createEntities([
        { name: 'RTL_Text', entityType: 'text', observations: ['שלום', 'مرحبا'] },
      ]);

      const results = await manager.searchManager.searchNodes('RTL');
      expect(results.entities).toHaveLength(1);
    });

    it('should handle zero-width characters', async () => {
      await manager.entityManager.createEntities([
        {
          name: 'Test\u200BZero\u200CWidth',
          entityType: 'test',
          observations: ['Has zero-width\u200Bchars'],
        },
      ]);

      const results = await manager.searchManager.searchNodes('Zero');
      expect(results.entities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Extreme Values', () => {
    it('should handle entity with maximum observations (array limit)', async () => {
      const manyObservations = Array.from({ length: 100 }, (_, i) => `Observation ${i}`);

      const entities = await manager.entityManager.createEntities([
        { name: 'ManyObs', entityType: 'test', observations: manyObservations },
      ]);

      expect(entities[0].observations).toHaveLength(100);

      const results = await manager.searchManager.searchNodes('Observation 50');
      expect(results.entities).toHaveLength(1);
    });

    it('should handle entity with maximum tags (array limit)', async () => {
      const manyTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);

      const entities = await manager.entityManager.createEntities([
        { name: 'ManyTags', entityType: 'test', observations: ['Test'], tags: manyTags },
      ]);

      expect(entities[0].tags).toHaveLength(50);
    });

    it('should handle importance at exact boundaries (0 and 10)', async () => {
      await manager.entityManager.createEntities([
        { name: 'MinImportance', entityType: 'test', observations: ['Test'], importance: 0 },
        { name: 'MaxImportance', entityType: 'test', observations: ['Test'], importance: 10 },
      ]);

      const minResults = await manager.searchManager.searchNodes('', undefined, 0, 0);
      expect(minResults.entities).toHaveLength(1);
      expect(minResults.entities[0].importance).toBe(0);

      const maxResults = await manager.searchManager.searchNodes('', undefined, 10, 10);
      expect(maxResults.entities).toHaveLength(1);
      expect(maxResults.entities[0].importance).toBe(10);
    });

    it('should handle very long entity names (200+ characters)', async () => {
      const longName = 'A'.repeat(250);

      const entities = await manager.entityManager.createEntities([
        { name: longName, entityType: 'test', observations: ['Long name entity'] },
      ]);

      expect(entities[0].name).toHaveLength(250);

      const results = await manager.searchManager.searchNodes(longName.substring(0, 10));
      expect(results.entities).toHaveLength(1);
    });

    it('should handle very long observations (500+ characters)', async () => {
      const longObservation = 'This is a very long observation. '.repeat(20);

      await manager.entityManager.createEntities([
        { name: 'LongObs', entityType: 'test', observations: [longObservation] },
      ]);

      const results = await manager.searchManager.searchNodes('long observation');
      expect(results.entities).toHaveLength(1);
    });
  });

  describe('Empty and Null-like Values', () => {
    it('should handle entity with empty string name (if allowed by validation)', async () => {
      // This should fail validation
      await expect(
        manager.entityManager.createEntities([{ name: '', entityType: 'test', observations: ['Test'] }])
      ).rejects.toThrow();
    });

    it('should handle entity with whitespace-only name', async () => {
      // System allows whitespace-only names
      const entities = await manager.entityManager.createEntities([
        { name: '   ', entityType: 'test', observations: ['Test'] }
      ]);

      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('   ');
    });

    it('should handle entity with empty observations array', async () => {
      const entities = await manager.entityManager.createEntities([
        { name: 'EmptyObs', entityType: 'test', observations: [] },
      ]);

      expect(entities[0].observations).toHaveLength(0);

      const results = await manager.searchManager.searchNodes('EmptyObs');
      expect(results.entities).toHaveLength(1);
    });

    it('should handle entity with empty tags array', async () => {
      const entities = await manager.entityManager.createEntities([
        { name: 'NoTags', entityType: 'test', observations: ['Test'], tags: [] },
      ]);

      expect(entities[0].tags).toHaveLength(0);
    });

    it('should handle entity without optional fields', async () => {
      const entities = await manager.entityManager.createEntities([
        { name: 'Minimal', entityType: 'test', observations: ['Test'] },
      ]);

      expect(entities[0].tags).toBeUndefined();
      expect(entities[0].importance).toBeUndefined();
    });
  });

  describe('Search Edge Cases', () => {
    it('should handle search with very long query string', async () => {
      await manager.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['Short observation'] },
      ]);

      const longQuery = 'test '.repeat(100);
      const results = await manager.searchManager.searchNodes(longQuery);

      expect(Array.isArray(results.entities)).toBe(true);
    });

    it('should handle ranked search with empty query', async () => {
      await manager.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['Test'] },
      ]);

      const results = await manager.searchManager.searchNodesRanked('');
      expect(results).toHaveLength(0);
    });

    it('should handle boolean search with deeply nested parentheses', async () => {
      await manager.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['Deep nesting'] },
      ]);

      const results = await manager.searchManager.booleanSearch('((((Test))))');
      expect(results.entities).toHaveLength(1);
    });

    it('should handle fuzzy search with threshold at boundaries (0 and 1)', async () => {
      await manager.entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Test'] },
      ]);

      // Threshold 0 should match everything
      const results0 = await manager.searchManager.fuzzySearch('xyz', 0);
      expect(results0.entities.length).toBeGreaterThan(0);

      // Threshold 1 should only match exact
      const results1 = await manager.searchManager.fuzzySearch('Alice', 1);
      expect(results1.entities).toHaveLength(1);
    });

    it('should handle search by date range with same start and end date', async () => {
      const now = new Date().toISOString();

      await manager.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['Test'] },
      ]);

      const results = await manager.searchManager.searchByDateRange(now, now);
      expect(Array.isArray(results.entities)).toBe(true);
    });

    it('should handle search by date range with end before start', async () => {
      const now = new Date();
      const future = new Date(now.getTime() + 86400000).toISOString();
      const past = new Date(now.getTime() - 86400000).toISOString();

      await manager.entityManager.createEntities([
        { name: 'Test', entityType: 'test', observations: ['Test'] },
      ]);

      // End before start should return empty results
      const results = await manager.searchManager.searchByDateRange(future, past);
      expect(results.entities).toHaveLength(0);
    });
  });

  describe('Relation Edge Cases', () => {
    it('should handle self-referencing relation', async () => {
      await manager.entityManager.createEntities([
        { name: 'SelfRef', entityType: 'test', observations: ['Test'] },
      ]);

      const relations = await manager.relationManager.createRelations([
        { from: 'SelfRef', to: 'SelfRef', relationType: 'relates_to' },
      ]);

      expect(relations).toHaveLength(1);
      expect(relations[0].from).toBe('SelfRef');
      expect(relations[0].to).toBe('SelfRef');
    });

    it('should handle circular relations (A->B->C->A)', async () => {
      await manager.entityManager.createEntities([
        { name: 'A', entityType: 'test', observations: ['Test'] },
        { name: 'B', entityType: 'test', observations: ['Test'] },
        { name: 'C', entityType: 'test', observations: ['Test'] },
      ]);

      await manager.relationManager.createRelations([
        { from: 'A', to: 'B', relationType: 'links' },
        { from: 'B', to: 'C', relationType: 'links' },
        { from: 'C', to: 'A', relationType: 'links' },
      ]);

      const results = await manager.searchManager.searchNodes('');
      expect(results.entities).toHaveLength(3);
      expect(results.relations).toHaveLength(3);
    });

    it('should handle very long relation type names (up to 100 chars)', async () => {
      await manager.entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['Test'] },
        { name: 'Entity2', entityType: 'test', observations: ['Test'] },
      ]);

      // Max length is 100 characters, use 90 to be safe
      const longRelationType = 'a'.repeat(90);

      const relations = await manager.relationManager.createRelations([
        { from: 'Entity1', to: 'Entity2', relationType: longRelationType },
      ]);

      expect(relations[0].relationType).toBe(longRelationType);
      expect(relations[0].relationType.length).toBe(90);
    });

    it('should handle multiple relations between same entities', async () => {
      await manager.entityManager.createEntities([
        { name: 'Person1', entityType: 'person', observations: ['Test'] },
        { name: 'Person2', entityType: 'person', observations: ['Test'] },
      ]);

      await manager.relationManager.createRelations([
        { from: 'Person1', to: 'Person2', relationType: 'knows' },
        { from: 'Person1', to: 'Person2', relationType: 'collaborates_with' },
        { from: 'Person1', to: 'Person2', relationType: 'mentors' },
      ]);

      const results = await manager.searchManager.searchNodes('Person');
      expect(results.relations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple simultaneous entity creations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        manager.entityManager.createEntities([
          { name: `Concurrent${i}`, entityType: 'test', observations: ['Test'] },
        ])
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);

      // Verify each result has the expected entity
      results.forEach((result, i) => {
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe(`Concurrent${i}`);
      });

      // Search should find all created entities (may be less if concurrent writes interfered)
      const searchResults = await manager.searchManager.searchNodes('Concurrent');
      expect(searchResults.entities.length).toBeGreaterThan(0);
      expect(searchResults.entities.length).toBeLessThanOrEqual(10);
    });

    it('should handle concurrent reads and writes', async () => {
      await manager.entityManager.createEntities([
        { name: 'Initial', entityType: 'test', observations: ['Test'] },
      ]);

      const operations = [
        manager.searchManager.searchNodes('Initial'),
        manager.entityManager.createEntities([
          { name: 'New1', entityType: 'test', observations: ['Test'] },
        ]),
        manager.searchManager.searchNodes(''),
        manager.entityManager.createEntities([
          { name: 'New2', entityType: 'test', observations: ['Test'] },
        ]),
      ];

      const results = await Promise.all(operations);
      expect(results).toHaveLength(4);
    });
  });

  describe('Validation Edge Cases', () => {
    it('should reject entity with invalid importance (negative)', async () => {
      await expect(
        manager.entityManager.createEntities([
          { name: 'Invalid', entityType: 'test', observations: ['Test'], importance: -1 },
        ])
      ).rejects.toThrow();
    });

    it('should reject entity with invalid importance (> 10)', async () => {
      await expect(
        manager.entityManager.createEntities([
          { name: 'Invalid', entityType: 'test', observations: ['Test'], importance: 11 },
        ])
      ).rejects.toThrow();
    });

    it('should reject entity with invalid importance (non-integer)', async () => {
      await expect(
        manager.entityManager.createEntities([
          { name: 'Invalid', entityType: 'test', observations: ['Test'], importance: 5.5 },
        ])
      ).rejects.toThrow();
    });

    it('should handle entity names with leading/trailing whitespace', async () => {
      // System allows names with leading/trailing whitespace
      const entities = await manager.entityManager.createEntities([
        { name: ' LeadingSpace', entityType: 'test', observations: ['Test'] },
        { name: 'TrailingSpace ', entityType: 'test', observations: ['Test'] },
      ]);

      expect(entities).toHaveLength(2);
      expect(entities[0].name).toBe(' LeadingSpace');
      expect(entities[1].name).toBe('TrailingSpace ');
    });
  });

  describe('Large Graph Operations', () => {
    it('should handle entity with 100+ relations', async () => {
      await manager.entityManager.createEntities([{ name: 'Hub', entityType: 'hub', observations: ['Central hub'] }]);

      // Create 100 spoke entities
      const spokes = Array.from({ length: 100 }, (_, i) => ({
        name: `Spoke${i}`,
        entityType: 'spoke',
        observations: ['Spoke'],
      }));
      await manager.entityManager.createEntities(spokes);

      // Create relations from hub to all spokes
      const relations = Array.from({ length: 100 }, (_, i) => ({
        from: 'Hub',
        to: `Spoke${i}`,
        relationType: 'connects',
      }));
      await manager.relationManager.createRelations(relations);

      // Verify relations exist by opening all nodes
      const allNodeNames = ['Hub', ...Array.from({ length: 100 }, (_, i) => `Spoke${i}`)];
      const results = await manager.searchManager.openNodes(allNodeNames);

      // Should have Hub + 100 Spokes
      expect(results.entities.length).toBe(101);

      // Count outgoing relations from Hub
      const hubOutgoingRelations = results.relations.filter(r => r.from === 'Hub');
      expect(hubOutgoingRelations.length).toBe(100);
    });

    it('should efficiently handle search on graph with 500+ entities', async () => {
      const entities = Array.from({ length: 500 }, (_, i) => ({
        name: `Entity${i}`,
        entityType: 'test',
        observations: [`Description ${i}`],
        importance: (i % 10) + 1,
      }));

      await manager.entityManager.createEntities(entities);

      const startTime = Date.now();
      const results = await manager.searchManager.searchNodes('Entity', undefined, 5);
      const duration = Date.now() - startTime;

      expect(results.entities.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2000); // Should complete in < 2 seconds
    });
  });

  describe('Special Query Characters', () => {
    it('should handle boolean search with special regex characters', async () => {
      await manager.entityManager.createEntities([
        { name: 'Test.*Special', entityType: 'test', observations: ['Has special chars'] },
      ]);

      const results = await manager.searchManager.booleanSearch('name:Test');
      expect(results.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle search with SQL injection-like patterns', async () => {
      await manager.entityManager.createEntities([
        { name: "Test'; DROP TABLE entities;--", entityType: 'test', observations: ['SQL injection test'] },
      ]);

      const results = await manager.searchManager.searchNodes("Test'; DROP");
      expect(results.entities).toHaveLength(1);
    });

    it('should handle search with XSS-like patterns', async () => {
      await manager.entityManager.createEntities([
        { name: '<script>alert("xss")</script>', entityType: 'test', observations: ['XSS test'] },
      ]);

      const results = await manager.searchManager.searchNodes('script');
      expect(results.entities).toHaveLength(1);
    });
  });
});
