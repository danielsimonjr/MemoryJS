/**
 * HierarchyManager Unit Tests
 *
 * Tests for entity hierarchy operations (parent-child relationships).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HierarchyManager } from '../../../src/core/HierarchyManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityNotFoundError, CycleDetectedError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('HierarchyManager', () => {
  let storage: GraphStorage;
  let hierarchyManager: HierarchyManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `hierarchy-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
    hierarchyManager = new HierarchyManager(storage);

    // Create a hierarchy for testing:
    // Root1
    //   ├── Child1
    //   │     └── Grandchild1
    //   └── Child2
    // Root2
    await storage.saveGraph({
      entities: [
        { name: 'Root1', entityType: 'folder', observations: [] },
        { name: 'Root2', entityType: 'folder', observations: [] },
        { name: 'Child1', entityType: 'folder', observations: [], parentId: 'Root1' },
        { name: 'Child2', entityType: 'folder', observations: [], parentId: 'Root1' },
        { name: 'Grandchild1', entityType: 'file', observations: [], parentId: 'Child1' },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('setEntityParent', () => {
    it('should set parent for an entity', async () => {
      const result = await hierarchyManager.setEntityParent('Root2', 'Root1');
      expect(result.parentId).toBe('Root1');
      expect(result.lastModified).toBeDefined();
    });

    it('should remove parent when setting to null', async () => {
      const result = await hierarchyManager.setEntityParent('Child1', null);
      expect(result.parentId).toBeUndefined();
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.setEntityParent('NonExistent', 'Root1')
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw EntityNotFoundError for non-existent parent', async () => {
      await expect(
        hierarchyManager.setEntityParent('Root2', 'NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw CycleDetectedError when setting parent would create cycle', async () => {
      // Try to set Root1 as child of its own grandchild
      await expect(
        hierarchyManager.setEntityParent('Root1', 'Grandchild1')
      ).rejects.toThrow(CycleDetectedError);
    });

    it('should throw CycleDetectedError for direct self-reference', async () => {
      await expect(
        hierarchyManager.setEntityParent('Root1', 'Root1')
      ).rejects.toThrow(CycleDetectedError);
    });

    it('should allow moving entity to different branch', async () => {
      // Move Grandchild1 to be child of Child2
      const result = await hierarchyManager.setEntityParent('Grandchild1', 'Child2');
      expect(result.parentId).toBe('Child2');
    });
  });

  describe('getChildren', () => {
    it('should return immediate children', async () => {
      const children = await hierarchyManager.getChildren('Root1');
      expect(children).toHaveLength(2);
      expect(children.map(c => c.name)).toContain('Child1');
      expect(children.map(c => c.name)).toContain('Child2');
    });

    it('should return empty array for leaf node', async () => {
      const children = await hierarchyManager.getChildren('Grandchild1');
      expect(children).toHaveLength(0);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getChildren('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should not include grandchildren', async () => {
      const children = await hierarchyManager.getChildren('Root1');
      expect(children.map(c => c.name)).not.toContain('Grandchild1');
    });
  });

  describe('getParent', () => {
    it('should return parent entity', async () => {
      const parent = await hierarchyManager.getParent('Child1');
      expect(parent).not.toBeNull();
      expect(parent!.name).toBe('Root1');
    });

    it('should return null for root entity', async () => {
      const parent = await hierarchyManager.getParent('Root1');
      expect(parent).toBeNull();
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getParent('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('getAncestors', () => {
    it('should return all ancestors in order', async () => {
      const ancestors = await hierarchyManager.getAncestors('Grandchild1');
      expect(ancestors).toHaveLength(2);
      expect(ancestors[0].name).toBe('Child1'); // Immediate parent first
      expect(ancestors[1].name).toBe('Root1'); // Grandparent second
    });

    it('should return empty array for root entity', async () => {
      const ancestors = await hierarchyManager.getAncestors('Root1');
      expect(ancestors).toHaveLength(0);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getAncestors('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('getDescendants', () => {
    it('should return all descendants using BFS', async () => {
      const descendants = await hierarchyManager.getDescendants('Root1');
      expect(descendants).toHaveLength(3);
      expect(descendants.map(d => d.name)).toContain('Child1');
      expect(descendants.map(d => d.name)).toContain('Child2');
      expect(descendants.map(d => d.name)).toContain('Grandchild1');
    });

    it('should return empty array for leaf node', async () => {
      const descendants = await hierarchyManager.getDescendants('Grandchild1');
      expect(descendants).toHaveLength(0);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getDescendants('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should return correct partial tree', async () => {
      const descendants = await hierarchyManager.getDescendants('Child1');
      expect(descendants).toHaveLength(1);
      expect(descendants[0].name).toBe('Grandchild1');
    });
  });

  describe('getSubtree', () => {
    it('should return entity and all descendants', async () => {
      const subtree = await hierarchyManager.getSubtree('Root1');
      expect(subtree.entities).toHaveLength(4); // Root1 + 3 descendants
      expect(subtree.entities.map(e => e.name)).toContain('Root1');
      expect(subtree.entities.map(e => e.name)).toContain('Child1');
      expect(subtree.entities.map(e => e.name)).toContain('Child2');
      expect(subtree.entities.map(e => e.name)).toContain('Grandchild1');
    });

    it('should include relations between subtree entities', async () => {
      // Add a relation within the subtree
      const graph = await storage.getGraphForMutation();
      graph.relations.push({ from: 'Child1', to: 'Child2', relationType: 'sibling' });
      graph.relations.push({ from: 'Root1', to: 'Root2', relationType: 'external' }); // Outside subtree
      await storage.saveGraph(graph);

      const subtree = await hierarchyManager.getSubtree('Root1');
      expect(subtree.relations).toHaveLength(1);
      expect(subtree.relations[0].relationType).toBe('sibling');
    });

    it('should return single entity for leaf node', async () => {
      const subtree = await hierarchyManager.getSubtree('Grandchild1');
      expect(subtree.entities).toHaveLength(1);
      expect(subtree.entities[0].name).toBe('Grandchild1');
      expect(subtree.relations).toHaveLength(0);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getSubtree('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('getRootEntities', () => {
    it('should return all entities without parents', async () => {
      const roots = await hierarchyManager.getRootEntities();
      expect(roots).toHaveLength(2);
      expect(roots.map(r => r.name)).toContain('Root1');
      expect(roots.map(r => r.name)).toContain('Root2');
    });

    it('should return empty array when all entities have parents', async () => {
      // Make Root1 and Root2 children of a new root
      await storage.appendEntity({ name: 'SuperRoot', entityType: 'folder', observations: [] });
      await hierarchyManager.setEntityParent('Root1', 'SuperRoot');
      await hierarchyManager.setEntityParent('Root2', 'SuperRoot');

      const roots = await hierarchyManager.getRootEntities();
      expect(roots).toHaveLength(1);
      expect(roots[0].name).toBe('SuperRoot');
    });
  });

  describe('getEntityDepth', () => {
    it('should return 0 for root entities', async () => {
      const depth = await hierarchyManager.getEntityDepth('Root1');
      expect(depth).toBe(0);
    });

    it('should return 1 for immediate children', async () => {
      const depth = await hierarchyManager.getEntityDepth('Child1');
      expect(depth).toBe(1);
    });

    it('should return 2 for grandchildren', async () => {
      const depth = await hierarchyManager.getEntityDepth('Grandchild1');
      expect(depth).toBe(2);
    });

    it('should throw EntityNotFoundError for non-existent entity', async () => {
      await expect(
        hierarchyManager.getEntityDepth('NonExistent')
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('moveEntity', () => {
    it('should move entity to new parent (alias for setEntityParent)', async () => {
      const result = await hierarchyManager.moveEntity('Child2', 'Child1');
      expect(result.parentId).toBe('Child1');
    });

    it('should move entity to root level', async () => {
      const result = await hierarchyManager.moveEntity('Grandchild1', null);
      expect(result.parentId).toBeUndefined();
    });

    it('should throw CycleDetectedError when move would create cycle', async () => {
      await expect(
        hierarchyManager.moveEntity('Child1', 'Grandchild1')
      ).rejects.toThrow(CycleDetectedError);
    });
  });

  describe('Edge Cases', () => {
    it('should handle deep hierarchies', async () => {
      // Create a deep hierarchy: Level0 -> Level1 -> ... -> Level9
      let prevLevel = 'Root1';
      for (let i = 0; i < 10; i++) {
        const levelName = `DeepLevel${i}`;
        await storage.appendEntity({
          name: levelName,
          entityType: 'folder',
          observations: [],
          parentId: prevLevel,
        });
        prevLevel = levelName;
      }

      const depth = await hierarchyManager.getEntityDepth('DeepLevel9');
      expect(depth).toBe(10); // 10 levels deep from Root1

      const ancestors = await hierarchyManager.getAncestors('DeepLevel9');
      expect(ancestors).toHaveLength(10);
    });

    it('should handle wide hierarchies', async () => {
      // Create many children under Root1
      for (let i = 0; i < 50; i++) {
        await storage.appendEntity({
          name: `WideChild${i}`,
          entityType: 'file',
          observations: [],
          parentId: 'Root1',
        });
      }

      const children = await hierarchyManager.getChildren('Root1');
      expect(children.length).toBeGreaterThanOrEqual(52); // Original 2 + 50 new
    });

    it('should handle entity with special characters in name', async () => {
      await storage.appendEntity({
        name: 'Special <>&"\' Entity',
        entityType: 'file',
        observations: [],
      });

      const result = await hierarchyManager.setEntityParent('Special <>&"\' Entity', 'Root1');
      expect(result.parentId).toBe('Root1');

      const children = await hierarchyManager.getChildren('Root1');
      expect(children.map(c => c.name)).toContain('Special <>&"\' Entity');
    });

    it('should handle parent reference to deleted entity gracefully', async () => {
      // This tests getParent when parentId points to non-existent entity
      const graph = await storage.getGraphForMutation();
      graph.entities.push({
        name: 'Orphan',
        entityType: 'file',
        observations: [],
        parentId: 'DeletedParent', // Parent doesn't exist
      });
      await storage.saveGraph(graph);

      const parent = await hierarchyManager.getParent('Orphan');
      expect(parent).toBeNull(); // Should return null, not throw
    });
  });
});
