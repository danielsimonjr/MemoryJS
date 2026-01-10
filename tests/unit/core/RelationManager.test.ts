/**
 * RelationManager Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { ValidationError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('RelationManager', () => {
  let storage: GraphStorage;
  let relationManager: RelationManager;
  let entityManager: EntityManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `relation-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    relationManager = new RelationManager(storage);
    entityManager = new EntityManager(storage);

    // Create test entities for relation tests
    await entityManager.createEntities([
      { name: 'Alice', entityType: 'person', observations: ['Software engineer'] },
      { name: 'Bob', entityType: 'person', observations: ['Product manager'] },
      { name: 'Charlie', entityType: 'person', observations: ['Designer'] },
      { name: 'Project_X', entityType: 'project', observations: ['Internal tool'] },
      { name: 'Company', entityType: 'organization', observations: ['Tech startup'] },
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

  describe('createRelations', () => {
    it('should create a single relation with timestamps', async () => {
      const relations = await relationManager.createRelations([
        {
          from: 'Alice',
          to: 'Bob',
          relationType: 'works_with',
        },
      ]);

      expect(relations).toHaveLength(1);
      expect(relations[0].from).toBe('Alice');
      expect(relations[0].to).toBe('Bob');
      expect(relations[0].relationType).toBe('works_with');
      expect(relations[0].createdAt).toBeDefined();
      expect(relations[0].lastModified).toBeDefined();
    });

    it('should create multiple relations in batch', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
        { from: 'Bob', to: 'Project_X', relationType: 'leads' },
      ]);

      expect(relations).toHaveLength(3);
      expect(relations.map(r => r.relationType)).toEqual([
        'works_with',
        'contributes_to',
        'leads',
      ]);
    });

    it('should filter out duplicate relations', async () => {
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      const result = await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' }, // Duplicate
        { from: 'Bob', to: 'Charlie', relationType: 'works_with' }, // New
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].from).toBe('Bob');
      expect(result[0].to).toBe('Charlie');
    });

    it('should allow same entities with different relation types', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alice', to: 'Bob', relationType: 'mentors' },
        { from: 'Alice', to: 'Bob', relationType: 'friends_with' },
      ]);

      expect(relations).toHaveLength(3);
    });

    it('should throw ValidationError for invalid relation data', async () => {
      await expect(
        relationManager.createRelations([
          {
            from: '', // Invalid: empty string
            to: 'Bob',
            relationType: 'works_with',
          } as any,
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('should preserve custom timestamps if provided', async () => {
      const customTimestamp = '2024-01-01T00:00:00.000Z';
      const relations = await relationManager.createRelations([
        {
          from: 'Alice',
          to: 'Bob',
          relationType: 'works_with',
          createdAt: customTimestamp,
          lastModified: customTimestamp,
        },
      ]);

      expect(relations[0].createdAt).toBe(customTimestamp);
      expect(relations[0].lastModified).toBe(customTimestamp);
    });

    it('should handle relations between same entity type', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'reports_to' },
        { from: 'Bob', to: 'Charlie', relationType: 'reports_to' },
      ]);

      expect(relations).toHaveLength(2);
    });

    it('should handle relations across different entity types', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
        { from: 'Project_X', to: 'Company', relationType: 'owned_by' },
      ]);

      expect(relations).toHaveLength(2);
    });
  });

  describe('deleteRelations', () => {
    beforeEach(async () => {
      // Create some test relations
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
        { from: 'Bob', to: 'Project_X', relationType: 'leads' },
        { from: 'Charlie', to: 'Alice', relationType: 'reports_to' },
      ]);
    });

    it('should delete a single relation', async () => {
      await relationManager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      const aliceRelations = await relationManager.getRelations('Alice');
      expect(aliceRelations.some(r =>
        r.from === 'Alice' && r.to === 'Bob' && r.relationType === 'works_with'
      )).toBe(false);
    });

    it('should delete multiple relations in batch', async () => {
      await relationManager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
      ]);

      const aliceRelations = await relationManager.getRelations('Alice');
      expect(aliceRelations).toHaveLength(1); // Only 'reports_to' from Charlie remains
      expect(aliceRelations[0].from).toBe('Charlie');
    });

    it('should update lastModified for affected entities', async () => {
      const beforeDelete = await entityManager.getEntity('Alice');
      const originalTimestamp = beforeDelete!.lastModified;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await relationManager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      const afterDelete = await entityManager.getEntity('Alice');
      expect(afterDelete!.lastModified).not.toBe(originalTimestamp);

      const bobAfter = await entityManager.getEntity('Bob');
      expect(bobAfter!.lastModified).not.toBe(originalTimestamp);
    });

    it('should silently ignore non-existent relations', async () => {
      await expect(
        relationManager.deleteRelations([
          { from: 'NonExistent', to: 'AlsoNonExistent', relationType: 'fake' },
        ])
      ).resolves.not.toThrow();
    });

    it('should handle partial deletion (some exist, some don\'t)', async () => {
      await relationManager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' }, // Exists
        { from: 'Alice', to: 'Bob', relationType: 'fake_relation' }, // Doesn't exist
      ]);

      const aliceRelations = await relationManager.getRelations('Alice');
      expect(aliceRelations.some(r =>
        r.from === 'Alice' && r.to === 'Bob' && r.relationType === 'works_with'
      )).toBe(false);
    });

    it('should throw ValidationError for invalid relation data', async () => {
      await expect(
        relationManager.deleteRelations([
          {
            from: '', // Invalid
            to: 'Bob',
            relationType: 'works_with',
          } as any,
        ])
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getRelations', () => {
    beforeEach(async () => {
      // Create test relations
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
        { from: 'Alice', to: 'Project_X', relationType: 'contributes_to' },
        { from: 'Bob', to: 'Project_X', relationType: 'leads' },
        { from: 'Charlie', to: 'Alice', relationType: 'reports_to' },
      ]);
    });

    it('should get all relations for an entity (incoming and outgoing)', async () => {
      const aliceRelations = await relationManager.getRelations('Alice');
      expect(aliceRelations).toHaveLength(3);
    });

    it('should return outgoing relations', async () => {
      const relations = await relationManager.getRelations('Alice');
      const outgoing = relations.filter(r => r.from === 'Alice');
      expect(outgoing).toHaveLength(2);
      expect(outgoing.map(r => r.to)).toEqual(
        expect.arrayContaining(['Bob', 'Project_X'])
      );
    });

    it('should return incoming relations', async () => {
      const relations = await relationManager.getRelations('Alice');
      const incoming = relations.filter(r => r.to === 'Alice');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].from).toBe('Charlie');
    });

    it('should return empty array for entity with no relations', async () => {
      const relations = await relationManager.getRelations('Company');
      expect(relations).toEqual([]);
    });

    it('should be case-sensitive for entity names', async () => {
      const relations = await relationManager.getRelations('alice'); // lowercase
      expect(relations).toEqual([]);
    });

    it('should handle entity that doesn\'t exist', async () => {
      const relations = await relationManager.getRelations('NonExistentEntity');
      expect(relations).toEqual([]);
    });

    it('should return all relation types for an entity', async () => {
      await relationManager.createRelations([
        { from: 'Bob', to: 'Alice', relationType: 'mentors' },
        { from: 'Bob', to: 'Alice', relationType: 'friends_with' },
      ]);

      const relations = await relationManager.getRelations('Alice');
      const typesWithBob = relations
        .filter(r => (r.from === 'Bob' && r.to === 'Alice') || (r.from === 'Alice' && r.to === 'Bob'))
        .map(r => r.relationType);

      expect(typesWithBob).toContain('works_with');
      expect(typesWithBob).toContain('mentors');
      expect(typesWithBob).toContain('friends_with');
    });
  });

  describe('graph integrity', () => {
    it('should maintain referential integrity after relation operations', async () => {
      await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      await relationManager.deleteRelations([
        { from: 'Alice', to: 'Bob', relationType: 'works_with' },
      ]);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(5); // All entities still exist
      expect(graph.relations).toHaveLength(0); // Relation deleted
    });

    it('should allow circular relations', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'helps' },
        { from: 'Bob', to: 'Charlie', relationType: 'helps' },
        { from: 'Charlie', to: 'Alice', relationType: 'helps' },
      ]);

      expect(relations).toHaveLength(3);
    });

    it('should allow self-referential relations', async () => {
      const relations = await relationManager.createRelations([
        { from: 'Alice', to: 'Alice', relationType: 'self_reference' },
      ]);

      expect(relations).toHaveLength(1);
      expect(relations[0].from).toBe('Alice');
      expect(relations[0].to).toBe('Alice');
    });
  });
});
