/**
 * ManagerContext Unit Tests
 *
 * Tests for the central context implementation, lazy initialization,
 * path derivation, and manager accessor verification.
 *
 * Note: Uses KnowledgeGraphManager alias for backward compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeGraphManager } from '../../../src/core/index.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { HierarchyManager } from '../../../src/core/HierarchyManager.js';
import { SearchManager } from '../../../src/search/SearchManager.js';
import { IOManager } from '../../../src/features/IOManager.js';
import { TagManager } from '../../../src/features/TagManager.js';
import { AnalyticsManager } from '../../../src/features/AnalyticsManager.js';
import { CompressionManager } from '../../../src/features/CompressionManager.js';
import { ArchiveManager } from '../../../src/features/ArchiveManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('KnowledgeGraphManager (ManagerContext)', () => {
  let manager: KnowledgeGraphManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `kgm-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-memory.jsonl');
    manager = new KnowledgeGraphManager(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Constructor and File Path Derivation', () => {
    it('should create manager with file path', () => {
      expect(manager).toBeDefined();
      expect(manager).toBeInstanceOf(KnowledgeGraphManager);
    });

    it('should derive saved-searches file path correctly', async () => {
      // Create a saved search to trigger file creation
      const saved = await manager.searchManager.saveSearch({ name: 'test', query: 'test' });
      expect(saved).toBeDefined();

      const expectedPath = join(testDir, 'test-memory-saved-searches.jsonl');
      const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should derive tag-aliases file path correctly', async () => {
      // Create a tag alias to trigger file creation
      const alias = await manager.tagManager.addTagAlias('js', 'javascript');
      expect(alias).toBeDefined();

      const expectedPath = join(testDir, 'test-memory-tag-aliases.jsonl');
      const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle paths with different extensions', async () => {
      const customPath = join(testDir, 'custom-graph.json');
      const customManager = new KnowledgeGraphManager(customPath);

      await customManager.searchManager.saveSearch({ name: 'test', query: 'custom' });

      const expectedPath = join(testDir, 'custom-graph-saved-searches.jsonl');
      const exists = await fs.access(expectedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle paths without extension', async () => {
      const noExtPath = join(testDir, 'no-ext-memory');
      const noExtManager = new KnowledgeGraphManager(noExtPath);

      await noExtManager.entityManager.createEntities([{ name: 'Test', entityType: 'test', observations: [] }]);
      const graph = await noExtManager.storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });
  });

  describe('Manager Accessor Verification', () => {
    it('should have entityManager accessor that returns EntityManager', () => {
      const entityMgr = manager.entityManager;
      expect(entityMgr).toBeDefined();
      expect(entityMgr).toBeInstanceOf(EntityManager);
    });

    it('should have relationManager accessor that returns RelationManager', () => {
      const relationMgr = manager.relationManager;
      expect(relationMgr).toBeDefined();
      expect(relationMgr).toBeInstanceOf(RelationManager);
    });

    it('should have observationManager accessor that returns ObservationManager', () => {
      const obsMgr = manager.observationManager;
      expect(obsMgr).toBeDefined();
      expect(obsMgr).toBeInstanceOf(ObservationManager);
    });

    it('should have hierarchyManager accessor that returns HierarchyManager', () => {
      const hierarchyMgr = manager.hierarchyManager;
      expect(hierarchyMgr).toBeDefined();
      expect(hierarchyMgr).toBeInstanceOf(HierarchyManager);
    });

    it('should have searchManager accessor that returns SearchManager', () => {
      const searchMgr = manager.searchManager;
      expect(searchMgr).toBeDefined();
      expect(searchMgr).toBeInstanceOf(SearchManager);
    });

    it('should have ioManager accessor that returns IOManager', () => {
      const ioMgr = manager.ioManager;
      expect(ioMgr).toBeDefined();
      expect(ioMgr).toBeInstanceOf(IOManager);
    });

    it('should have tagManager accessor that returns TagManager', () => {
      const tagMgr = manager.tagManager;
      expect(tagMgr).toBeDefined();
      expect(tagMgr).toBeInstanceOf(TagManager);
    });

    it('should have analyticsManager accessor that returns AnalyticsManager', () => {
      const analyticsMgr = manager.analyticsManager;
      expect(analyticsMgr).toBeDefined();
      expect(analyticsMgr).toBeInstanceOf(AnalyticsManager);
    });

    it('should have compressionManager accessor that returns CompressionManager', () => {
      const compressionMgr = manager.compressionManager;
      expect(compressionMgr).toBeDefined();
      expect(compressionMgr).toBeInstanceOf(CompressionManager);
    });

    it('should have archiveManager accessor that returns ArchiveManager', () => {
      const archiveMgr = manager.archiveManager;
      expect(archiveMgr).toBeDefined();
      expect(archiveMgr).toBeInstanceOf(ArchiveManager);
    });
  });

  describe('Lazy Manager Initialization', () => {
    it('should not create files until operations are performed', async () => {
      // Just creating manager shouldn't create any files
      const lazyManager = new KnowledgeGraphManager(join(testDir, 'lazy-test.jsonl'));

      const mainExists = await fs.access(join(testDir, 'lazy-test.jsonl')).then(() => true).catch(() => false);
      const savedSearchesExists = await fs.access(join(testDir, 'lazy-test-saved-searches.jsonl')).then(() => true).catch(() => false);

      expect(mainExists).toBe(false);
      expect(savedSearchesExists).toBe(false);

      // Now do an operation
      await lazyManager.storage.loadGraph();

      // Main file still may not exist if empty, but manager is now initialized
      expect(lazyManager).toBeDefined();
    });

    it('should initialize entityManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'entity-init.jsonl'));
      const entityMgr = newManager.entityManager;
      expect(entityMgr).toBeDefined();
      expect(entityMgr).toBeInstanceOf(EntityManager);
    });

    it('should initialize relationManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'relation-init.jsonl'));
      const relationMgr = newManager.relationManager;
      expect(relationMgr).toBeDefined();
      expect(relationMgr).toBeInstanceOf(RelationManager);
    });

    it('should initialize searchManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'search-init.jsonl'));
      const searchMgr = newManager.searchManager;
      expect(searchMgr).toBeDefined();
      expect(searchMgr).toBeInstanceOf(SearchManager);
    });

    it('should initialize ioManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'io-init.jsonl'));
      const ioMgr = newManager.ioManager;
      expect(ioMgr).toBeDefined();
      expect(ioMgr).toBeInstanceOf(IOManager);
    });

    it('should initialize tagManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'tag-init.jsonl'));
      const tagMgr = newManager.tagManager;
      expect(tagMgr).toBeDefined();
      expect(tagMgr).toBeInstanceOf(TagManager);
    });

    it('should return same instance on subsequent accesses (entityManager)', () => {
      const first = manager.entityManager;
      const second = manager.entityManager;
      expect(first).toBe(second);
    });

    it('should return same instance on subsequent accesses (searchManager)', () => {
      const first = manager.searchManager;
      const second = manager.searchManager;
      expect(first).toBe(second);
    });

    it('should return same instance on subsequent accesses (tagManager)', () => {
      const first = manager.tagManager;
      const second = manager.tagManager;
      expect(first).toBe(second);
    });
  });

  describe('Manager Operations Through Accessors', () => {
    it('should perform entity operations through entityManager', async () => {
      const entities = await manager.entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: ['Engineer'] }
      ]);
      expect(entities[0].name).toBe('Alice');
      expect(entities[0].createdAt).toBeDefined();

      const graph = await manager.storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });

    it('should perform relation operations through relationManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Alice', entityType: 'person', observations: [] },
        { name: 'Bob', entityType: 'person', observations: [] }
      ]);

      const relations = await manager.relationManager.createRelations([
        { from: 'Alice', to: 'Bob', relationType: 'knows' }
      ]);

      expect(relations).toHaveLength(1);
      expect(relations[0].from).toBe('Alice');
    });

    it('should perform observation operations through observationManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Entity', entityType: 'test', observations: [] }
      ]);

      const result = await manager.observationManager.addObservations([
        { entityName: 'Entity', contents: ['new observation'] }
      ]);

      expect(result[0].addedObservations).toContain('new observation');
    });

    it('should perform hierarchy operations through hierarchyManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Root', entityType: 'folder', observations: [] },
        { name: 'Child', entityType: 'folder', observations: [] }
      ]);

      const result = await manager.hierarchyManager.setEntityParent('Child', 'Root');
      expect(result.parentId).toBe('Root');

      const children = await manager.hierarchyManager.getChildren('Root');
      expect(children.length).toBe(1);
      expect(children[0].name).toBe('Child');
    });

    it('should perform search operations through searchManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'JavaScript', entityType: 'language', observations: ['Web development'] }
      ]);

      const result = await manager.searchManager.searchNodes('JavaScript');
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it('should perform tag operations through tagManager', async () => {
      const alias = await manager.tagManager.addTagAlias('js', 'javascript');
      expect(alias.alias).toBe('js');
      expect(alias.canonical).toBe('javascript');

      const resolved = await manager.tagManager.resolveTag('js');
      expect(resolved).toBe('javascript');
    });

    it('should perform analytics operations through analyticsManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'A', entityType: 'type1', observations: [] },
        { name: 'B', entityType: 'type2', observations: [] }
      ]);

      const stats = await manager.analyticsManager.getGraphStats();
      expect(stats.totalEntities).toBe(2);
      expect(stats.totalRelations).toBe(0);

      const report = await manager.analyticsManager.validateGraph();
      expect(report.isValid).toBeDefined();
      expect(report.issues).toBeDefined();
    });

    it('should perform compression operations through compressionManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Item1', entityType: 'test', observations: ['same data'] },
        { name: 'Item2', entityType: 'test', observations: ['same data'] }
      ]);

      const duplicates = await manager.compressionManager.findDuplicates(0.8);
      expect(Array.isArray(duplicates)).toBe(true);
    });

    it('should perform archive operations through archiveManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Old', entityType: 'test', observations: [] }
      ]);

      const result = await manager.archiveManager.archiveEntities(
        { importanceLessThan: 5 },
        true // dry run
      );

      expect(result.archived).toBeDefined();
      expect(result.entityNames).toBeDefined();
    });

    it('should perform import/export operations through ioManager', async () => {
      await manager.entityManager.createEntities([
        { name: 'Export', entityType: 'test', observations: ['data'] }
      ]);

      const graph = await manager.storage.loadGraph();
      const json = manager.ioManager.exportGraph(graph, 'json');
      expect(json).toContain('Export');

      const jsonData = JSON.stringify({
        entities: [{ name: 'Imported', entityType: 'test', observations: [] }],
        relations: []
      });

      const result = await manager.ioManager.importGraph('json', jsonData, 'merge');
      expect(result.entitiesAdded).toBeGreaterThanOrEqual(0);
      expect(result.entitiesSkipped).toBeDefined();
    });
  });

  describe('Integration: Cross-Manager Operations', () => {
    it('should handle workflow across multiple managers', async () => {
      // Create entities (EntityManager)
      await manager.entityManager.createEntities([
        { name: 'Project', entityType: 'project', observations: ['Main project'] },
        { name: 'Task1', entityType: 'task', observations: ['First task'] },
        { name: 'Task2', entityType: 'task', observations: ['Second task'] }
      ]);

      // Create hierarchy (HierarchyManager)
      await manager.hierarchyManager.setEntityParent('Task1', 'Project');
      await manager.hierarchyManager.setEntityParent('Task2', 'Project');

      // Create relations (RelationManager)
      await manager.relationManager.createRelations([
        { from: 'Task1', to: 'Task2', relationType: 'depends_on' }
      ]);

      // Add tags (EntityManager)
      await manager.entityManager.addTags('Project', ['active']);

      // Search (SearchManager)
      const results = await manager.searchManager.searchNodes('task');
      expect(results.entities.length).toBe(2);

      // Get stats (AnalyticsManager)
      const stats = await manager.analyticsManager.getGraphStats();
      expect(stats.totalEntities).toBe(3);
      expect(stats.totalRelations).toBe(1);

      // Export (IOManager)
      const graph = await manager.storage.loadGraph();
      const exported = manager.ioManager.exportGraph(graph, 'json');
      expect(exported).toContain('Project');

      // Validate (AnalyticsManager)
      const validation = await manager.analyticsManager.validateGraph();
      expect(validation.isValid).toBe(true);
    });

    it('should maintain consistency across operations', async () => {
      // Create
      await manager.entityManager.createEntities([
        { name: 'Consistent', entityType: 'test', observations: [] }
      ]);

      // Modify via different managers
      await manager.entityManager.addTags('Consistent', ['tag1']);
      await manager.entityManager.setImportance('Consistent', 7);
      await manager.observationManager.addObservations([
        { entityName: 'Consistent', contents: ['obs'] }
      ]);

      // Verify via different read paths
      const bySearch = await manager.searchManager.searchNodes('Consistent');
      const byOpen = await manager.searchManager.openNodes(['Consistent']);
      const byGraph = await manager.storage.loadGraph();

      expect(bySearch.entities[0].tags).toContain('tag1');
      expect(byOpen.entities[0].importance).toBe(7);
      expect(byGraph.entities[0].observations).toContain('obs');
    });

    it('should share storage across all managers', async () => {
      // Create through entityManager
      await manager.entityManager.createEntities([
        { name: 'Shared', entityType: 'test', observations: ['initial'] }
      ]);

      // Read through searchManager
      const searchResult = await manager.searchManager.searchNodes('Shared');
      expect(searchResult.entities.length).toBe(1);

      // Read through storage
      const graph = await manager.storage.loadGraph();
      expect(graph.entities.length).toBe(1);

      // Both should see the same data
      expect(searchResult.entities[0].name).toBe(graph.entities[0].name);
    });

    it('should handle complex multi-manager workflow', async () => {
      // Setup: Create entities and relationships
      await manager.entityManager.createEntities([
        { name: 'System', entityType: 'system', observations: ['Root system'], tags: ['infrastructure'] },
        { name: 'Service1', entityType: 'service', observations: ['Auth service'], tags: ['backend'] },
        { name: 'Service2', entityType: 'service', observations: ['API service'], tags: ['backend'] }
      ]);

      await manager.hierarchyManager.setEntityParent('Service1', 'System');
      await manager.hierarchyManager.setEntityParent('Service2', 'System');

      await manager.relationManager.createRelations([
        { from: 'Service1', to: 'Service2', relationType: 'calls' }
      ]);

      // Analysis: Use analytics and search
      const stats = await manager.analyticsManager.getGraphStats();
      expect(stats.totalEntities).toBe(3);
      expect(stats.totalRelations).toBe(1);

      const backendServices = await manager.searchManager.searchNodes('service');
      expect(backendServices.entities.length).toBe(2);

      const children = await manager.hierarchyManager.getChildren('System');
      expect(children.length).toBe(2);

      // Export and verify
      const graph = await manager.storage.loadGraph();
      const exported = manager.ioManager.exportGraph(graph, 'json');
      expect(exported).toContain('System');
      expect(exported).toContain('Service1');
      expect(exported).toContain('Service2');

      // Validate integrity
      const validation = await manager.analyticsManager.validateGraph();
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });
  });
});
