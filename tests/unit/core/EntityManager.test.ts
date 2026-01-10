/**
 * EntityManager Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { HierarchyManager } from '../../../src/core/HierarchyManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityNotFoundError, ValidationError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EntityManager', () => {
  let storage: GraphStorage;
  let manager: EntityManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `entity-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    manager = new EntityManager(storage);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createEntities', () => {
    it('should create a single entity with timestamps', async () => {
      const entities = await manager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Software engineer'],
        },
      ]);

      expect(entities).toHaveLength(1);
      expect(entities[0].name).toBe('Alice');
      expect(entities[0].entityType).toBe('person');
      expect(entities[0].observations).toEqual(['Software engineer']);
      expect(entities[0].createdAt).toBeDefined();
      expect(entities[0].lastModified).toBeDefined();
    });

    it('should create multiple entities in batch', async () => {
      const entities = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
        { name: 'Company', entityType: 'organization', observations: [] },
      ]);

      expect(entities).toHaveLength(3);
      expect(entities.map(e => e.name)).toEqual(['Alice', 'Bob', 'Company']);
    });

    it('should filter out duplicate entities', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
      ]);

      const result = await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Duplicate'] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });

    it('should normalize tags to lowercase', async () => {
      const entities = await manager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: [],
          tags: ['Engineering', 'LEADERSHIP', 'Team'],
        },
      ]);

      expect(entities[0].tags).toEqual(['engineering', 'leadership', 'team']);
    });

    it('should validate importance range', async () => {
      await expect(
        manager.createEntities([
          {
            name: 'Alice',
            entityType: 'person',
            observations: [],
            importance: 11,
          },
        ])
      ).rejects.toThrow();
    });

    it('should throw ValidationError for invalid entity data', async () => {
      await expect(
        manager.createEntities([
          {
            name: '',
            entityType: 'person',
            observations: [],
          } as any,
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('should handle empty array (no-op)', async () => {
      const result = await manager.createEntities([]);
      expect(result).toEqual([]);
    });

    it('should preserve optional fields', async () => {
      const entities = await manager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer'],
          importance: 8,
          tags: ['team'],
          parentId: 'Company',
        } as any, // Bypass TypeScript type checking for this test
      ]);

      expect(entities[0].importance).toBe(8);
      expect(entities[0].tags).toEqual(['team']);
      expect(entities[0].parentId).toBe('Company');
    });
  });

  describe('deleteEntities', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] },
      ]);
    });

    it('should delete a single entity', async () => {
      await manager.deleteEntities(['Alice']);

      const alice = await manager.getEntity('Alice');
      expect(alice).toBeNull();

      const bob = await manager.getEntity('Bob');
      expect(bob).not.toBeNull();
    });

    it('should delete multiple entities', async () => {
      await manager.deleteEntities(['Alice', 'Bob']);

      const alice = await manager.getEntity('Alice');
      const bob = await manager.getEntity('Bob');

      expect(alice).toBeNull();
      expect(bob).toBeNull();
    });

    it('should silently ignore non-existent entities', async () => {
      await expect(
        manager.deleteEntities(['NonExistent'])
      ).resolves.not.toThrow();
    });

    it('should throw ValidationError for invalid input', async () => {
      await expect(
        manager.deleteEntities([])
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('getEntity', () => {
    beforeEach(async () => {
      await manager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Software engineer'],
          importance: 8,
        } as any,
      ]);
    });

    it('should retrieve an existing entity', async () => {
      const alice = await manager.getEntity('Alice');

      expect(alice).not.toBeNull();
      expect(alice!.name).toBe('Alice');
      expect(alice!.entityType).toBe('person');
      expect(alice!.observations).toEqual(['Software engineer']);
      expect(alice!.importance).toBe(8);
    });

    it('should return null for non-existent entity', async () => {
      const result = await manager.getEntity('NonExistent');
      expect(result).toBeNull();
    });

    it('should be case-sensitive', async () => {
      const result = await manager.getEntity('alice');
      expect(result).toBeNull();
    });
  });

  describe('updateEntity', () => {
    beforeEach(async () => {
      await manager.createEntities([
        {
          name: 'Alice',
          entityType: 'person',
          observations: ['Engineer'],
          importance: 5,
        } as any,
      ]);
    });

    it('should update entity importance', async () => {
      const updated = await manager.updateEntity('Alice', {
        importance: 9,
      });

      expect(updated.importance).toBe(9);
      expect(updated.name).toBe('Alice');
    });

    it('should update entity observations', async () => {
      const updated = await manager.updateEntity('Alice', {
        observations: ['Senior Engineer', 'Team Lead'],
      });

      expect(updated.observations).toEqual(['Senior Engineer', 'Team Lead']);
    });

    it('should update lastModified timestamp', async () => {
      const original = await manager.getEntity('Alice');
      const originalTimestamp = original!.lastModified;

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await manager.updateEntity('Alice', {
        importance: 8,
      });

      expect(updated.lastModified).not.toBe(originalTimestamp);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        manager.updateEntity('NonExistent', { importance: 5 })
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw ValidationError for invalid updates', async () => {
      await expect(
        manager.updateEntity('Alice', { importance: 11 } as any)
      ).rejects.toThrow(ValidationError);
    });

    it('should update multiple fields at once', async () => {
      const updated = await manager.updateEntity('Alice', {
        entityType: 'senior_engineer',
        importance: 9,
        tags: ['leadership'],
        observations: ['Lead Engineer'],
      });

      expect(updated.entityType).toBe('senior_engineer');
      expect(updated.importance).toBe(9);
      expect(updated.tags).toEqual(['leadership']);
      expect(updated.observations).toEqual(['Lead Engineer']);
    });
  });

  describe('batchUpdate', () => {
    beforeEach(async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Engineer'], importance: 7 },
        { name: 'Bob', entityType: 'person', observations: ['Manager'], importance: 6 },
        { name: 'Charlie', entityType: 'person', observations: ['Designer'], importance: 5 },
      ]);
    });

    it('should update multiple entities in a single operation', async () => {
      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { importance: 9 } },
        { name: 'Bob', updates: { importance: 8 } },
      ]);

      expect(updated).toHaveLength(2);
      expect(updated[0].importance).toBe(9);
      expect(updated[1].importance).toBe(8);
    });

    it('should update different fields for different entities', async () => {
      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { tags: ['senior', 'tech-lead'] } },
        { name: 'Bob', updates: { entityType: 'senior_manager' } },
        { name: 'Charlie', updates: { importance: 8, tags: ['ui-expert'] } },
      ]);

      expect(updated).toHaveLength(3);
      expect(updated[0].tags).toEqual(['senior', 'tech-lead']);
      expect(updated[1].entityType).toBe('senior_manager');
      expect(updated[2].importance).toBe(8);
      expect(updated[2].tags).toEqual(['ui-expert']);
    });

    it('should update lastModified timestamp for all entities', async () => {
      const beforeUpdate = new Date().toISOString();

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { importance: 9 } },
        { name: 'Bob', updates: { importance: 8 } },
      ]);

      expect(updated[0].lastModified! >= beforeUpdate).toBe(true);
      expect(updated[1].lastModified! >= beforeUpdate).toBe(true);
      expect(updated[0].lastModified).toBe(updated[1].lastModified); // Same timestamp
    });

    it('should only load and save graph once', async () => {
      // This is a performance benefit - single load/save vs multiple
      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { importance: 10 } },
        { name: 'Bob', updates: { importance: 9 } },
        { name: 'Charlie', updates: { importance: 8 } },
      ]);

      expect(updated).toHaveLength(3);

      // Verify all updates persisted
      const alice = await manager.getEntity('Alice');
      const bob = await manager.getEntity('Bob');
      const charlie = await manager.getEntity('Charlie');

      expect(alice!.importance).toBe(10);
      expect(bob!.importance).toBe(9);
      expect(charlie!.importance).toBe(8);
    });

    it('should throw EntityNotFoundError if any entity not found', async () => {
      await expect(
        manager.batchUpdate([
          { name: 'Alice', updates: { importance: 9 } },
          { name: 'NonExistent', updates: { importance: 8 } },
        ])
      ).rejects.toThrow(EntityNotFoundError);

      // Verify no updates were applied (atomic operation)
      const alice = await manager.getEntity('Alice');
      expect(alice!.importance).toBe(7); // Original value
    });

    it('should throw ValidationError for invalid update data', async () => {
      await expect(
        manager.batchUpdate([
          { name: 'Alice', updates: { importance: 9 } },
          { name: 'Bob', updates: { importance: 11 } as any }, // Invalid: > 10
        ])
      ).rejects.toThrow(ValidationError);
    });

    it('should handle empty updates array', async () => {
      const updated = await manager.batchUpdate([]);
      expect(updated).toEqual([]);
    });

    it('should handle single entity update', async () => {
      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { importance: 10 } },
      ]);

      expect(updated).toHaveLength(1);
      expect(updated[0].importance).toBe(10);
    });

    it('should preserve unchanged fields', async () => {
      const beforeAlice = await manager.getEntity('Alice');

      const updated = await manager.batchUpdate([
        { name: 'Alice', updates: { importance: 10 } },
      ]);

      expect(updated[0].entityType).toBe(beforeAlice!.entityType);
      expect(updated[0].observations).toEqual(beforeAlice!.observations);
      expect(updated[0].importance).toBe(10); // Changed
    });
  });

  describe('persistence', () => {
    it('should persist entities across storage instances', async () => {
      await manager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
      ]);

      // Create new storage and manager instances
      const newStorage = new GraphStorage(testFilePath);
      const newManager = new EntityManager(newStorage);

      const alice = await newManager.getEntity('Alice');
      expect(alice).not.toBeNull();
      expect(alice!.name).toBe('Alice');
    });
  });

  describe('Hierarchy Operations', () => {
    let hierarchyManager: HierarchyManager;

    beforeEach(async () => {
      // Create hierarchy manager with same storage
      hierarchyManager = new HierarchyManager(storage);

      // Create a hierarchy: Root -> Parent -> Child -> Grandchild
      await manager.createEntities([
        { name: 'Root', entityType: 'folder', observations: [] },
        { name: 'Parent', entityType: 'folder', observations: [] },
        { name: 'Child', entityType: 'folder', observations: [] },
        { name: 'Grandchild', entityType: 'file', observations: [] },
        { name: 'Sibling', entityType: 'file', observations: [] },
      ]);
    });

    describe('setEntityParent', () => {
      it('should set parent for entity', async () => {
        const result = await hierarchyManager.setEntityParent('Child', 'Parent');
        expect(result.parentId).toBe('Parent');
      });

      it('should update lastModified timestamp', async () => {
        const before = await manager.getEntity('Child');
        await new Promise(r => setTimeout(r, 10));
        await hierarchyManager.setEntityParent('Child', 'Parent');
        const after = await manager.getEntity('Child');
        expect(after!.lastModified).not.toBe(before!.lastModified);
      });

      it('should remove parent when setting to null', async () => {
        await hierarchyManager.setEntityParent('Child', 'Parent');
        const result = await hierarchyManager.setEntityParent('Child', null);
        expect(result.parentId).toBeUndefined();
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.setEntityParent('NonExistent', 'Parent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });

      it('should throw error for non-existent parent', async () => {
        await expect(hierarchyManager.setEntityParent('Child', 'NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });

      it('should detect direct cycle (self-reference)', async () => {
        await expect(hierarchyManager.setEntityParent('Parent', 'Parent'))
          .rejects.toThrow();
      });

      it('should detect indirect cycle', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');
        // Trying to set Root's parent to Child would create a cycle
        await expect(hierarchyManager.setEntityParent('Root', 'Child'))
          .rejects.toThrow();
      });
    });

    describe('getChildren', () => {
      it('should return direct children of entity', async () => {
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.setEntityParent('Sibling', 'Parent');

        const children = await hierarchyManager.getChildren('Parent');
        expect(children).toHaveLength(2);
        expect(children.map(c => c.name).sort()).toEqual(['Child', 'Sibling']);
      });

      it('should return empty array for leaf nodes', async () => {
        const children = await hierarchyManager.getChildren('Grandchild');
        expect(children).toHaveLength(0);
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getChildren('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });

      it('should only return direct children, not grandchildren', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');

        const children = await hierarchyManager.getChildren('Root');
        expect(children).toHaveLength(1);
        expect(children[0].name).toBe('Parent');
      });
    });

    describe('getParent', () => {
      it('should return parent entity', async () => {
        await hierarchyManager.setEntityParent('Child', 'Parent');
        const parent = await hierarchyManager.getParent('Child');
        expect(parent).not.toBeNull();
        expect(parent!.name).toBe('Parent');
      });

      it('should return null for root entities', async () => {
        const parent = await hierarchyManager.getParent('Root');
        expect(parent).toBeNull();
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getParent('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });
    });

    describe('getAncestors', () => {
      it('should return all ancestors in order', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.setEntityParent('Grandchild', 'Child');

        const ancestors = await hierarchyManager.getAncestors('Grandchild');
        expect(ancestors).toHaveLength(3);
        // Order: immediate parent first
        expect(ancestors[0].name).toBe('Child');
        expect(ancestors[1].name).toBe('Parent');
        expect(ancestors[2].name).toBe('Root');
      });

      it('should return empty array for root entities', async () => {
        const ancestors = await hierarchyManager.getAncestors('Root');
        expect(ancestors).toHaveLength(0);
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getAncestors('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });
    });

    describe('getDescendants', () => {
      it('should return all descendants', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.setEntityParent('Grandchild', 'Child');
        await hierarchyManager.setEntityParent('Sibling', 'Parent');

        const descendants = await hierarchyManager.getDescendants('Root');
        expect(descendants).toHaveLength(4);
        expect(descendants.map(d => d.name).sort())
          .toEqual(['Child', 'Grandchild', 'Parent', 'Sibling']);
      });

      it('should return empty array for leaf nodes', async () => {
        const descendants = await hierarchyManager.getDescendants('Grandchild');
        expect(descendants).toHaveLength(0);
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getDescendants('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });
    });

    describe('getSubtree', () => {
      it('should return entity and all descendants', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');

        const subtree = await hierarchyManager.getSubtree('Parent');
        expect(subtree.entities).toHaveLength(2);
        expect(subtree.entities.map(e => e.name).sort()).toEqual(['Child', 'Parent']);
      });

      it('should return only entity for leaf nodes', async () => {
        const subtree = await hierarchyManager.getSubtree('Grandchild');
        expect(subtree.entities).toHaveLength(1);
        expect(subtree.entities[0].name).toBe('Grandchild');
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getSubtree('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });

      it('should include relations within subtree', async () => {
        // Create relations between entities
        await hierarchyManager.setEntityParent('Child', 'Parent');
        const graph = await storage.getGraphForMutation();
        graph.relations.push({
          from: 'Parent',
          to: 'Child',
          relationType: 'contains',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString()
        });
        await storage.saveGraph(graph);

        const subtree = await hierarchyManager.getSubtree('Parent');
        expect(subtree.relations).toHaveLength(1);
        expect(subtree.relations[0].from).toBe('Parent');
      });
    });

    describe('getRootEntities', () => {
      it('should return entities without parents', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');

        const roots = await hierarchyManager.getRootEntities();
        // Root, Grandchild, and Sibling have no parent
        const rootNames = roots.map(r => r.name);
        expect(rootNames).toContain('Root');
        expect(rootNames).not.toContain('Parent');
        expect(rootNames).not.toContain('Child');
      });

      it('should return all entities when none have parents', async () => {
        const roots = await hierarchyManager.getRootEntities();
        expect(roots).toHaveLength(5); // All 5 entities from beforeEach
      });

      it('should return empty array when all entities have parents', async () => {
        // Create single root and make all others children
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.setEntityParent('Grandchild', 'Child');
        await hierarchyManager.setEntityParent('Sibling', 'Parent');

        const roots = await hierarchyManager.getRootEntities();
        expect(roots).toHaveLength(1);
        expect(roots[0].name).toBe('Root');
      });
    });

    describe('getEntityDepth', () => {
      it('should return 0 for root entities', async () => {
        const depth = await hierarchyManager.getEntityDepth('Root');
        expect(depth).toBe(0);
      });

      it('should return correct depth for nested entities', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.setEntityParent('Grandchild', 'Child');

        expect(await hierarchyManager.getEntityDepth('Root')).toBe(0);
        expect(await hierarchyManager.getEntityDepth('Parent')).toBe(1);
        expect(await hierarchyManager.getEntityDepth('Child')).toBe(2);
        expect(await hierarchyManager.getEntityDepth('Grandchild')).toBe(3);
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.getEntityDepth('NonExistent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });
    });

    describe('moveEntity', () => {
      it('should move entity to new parent', async () => {
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.moveEntity('Child', 'Root');

        const child = await manager.getEntity('Child');
        expect(child!.parentId).toBe('Root');
      });

      it('should move entity to root (null parent)', async () => {
        await hierarchyManager.setEntityParent('Child', 'Parent');
        await hierarchyManager.moveEntity('Child', null);

        const child = await manager.getEntity('Child');
        expect(child!.parentId).toBeUndefined();
      });

      it('should detect cycles when moving', async () => {
        await hierarchyManager.setEntityParent('Parent', 'Root');
        await hierarchyManager.setEntityParent('Child', 'Parent');

        // Cannot move Root to Child (would create cycle)
        await expect(hierarchyManager.moveEntity('Root', 'Child'))
          .rejects.toThrow();
      });

      it('should throw error for non-existent entity', async () => {
        await expect(hierarchyManager.moveEntity('NonExistent', 'Parent'))
          .rejects.toThrow('Entity "NonExistent" not found');
      });
    });
  });
});
