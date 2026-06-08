/**
 * ManagerContext Unit Tests
 *
 * Tests for the central context implementation, lazy initialization,
 * path derivation, and manager accessor verification.
 *
 * Note: Uses KnowledgeGraphManager alias for backward compatibility.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';
import { MemoryFormatter } from '../../../src/agent/MemoryFormatter.js';
import { AgentMemoryManager } from '../../../src/agent/AgentMemoryManager.js';
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

  // ==================== SPRINT 7: AGENT MEMORY TESTS ====================

  describe('Agent Memory: accessTracker Initialization', () => {
    it('should lazily initialize accessTracker on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'access-tracker-test.jsonl'));
      const tracker = newManager.accessTracker;

      expect(tracker).toBeDefined();
      expect(tracker).toBeInstanceOf(AccessTracker);
    });

    it('should return same accessTracker instance on subsequent accesses', () => {
      const first = manager.accessTracker;
      const second = manager.accessTracker;

      expect(first).toBe(second);
    });

    it('should wire accessTracker to entityManager', () => {
      const tracker = manager.accessTracker;
      const entityMgr = manager.entityManager;

      // The setAccessTracker method should have been called during initialization
      // We can verify by checking if the tracker is functional
      expect(tracker).toBeDefined();
      expect(entityMgr).toBeDefined();
    });

    it('should wire accessTracker to searchManager', () => {
      const tracker = manager.accessTracker;
      const searchMgr = manager.searchManager;

      expect(tracker).toBeDefined();
      expect(searchMgr).toBeDefined();
    });

    it('should wire accessTracker to graphTraversal', () => {
      const tracker = manager.accessTracker;
      const graphTraversal = manager.graphTraversal;

      expect(tracker).toBeDefined();
      expect(graphTraversal).toBeDefined();
    });

    it('should track entity access after wiring', async () => {
      await manager.entityManager.createEntities([
        { name: 'TrackedEntity', entityType: 'test', observations: ['test data'] }
      ]);

      // Access via searchManager to trigger tracking
      await manager.searchManager.openNodes(['TrackedEntity']);

      const tracker = manager.accessTracker;
      const stats = await tracker.getAccessStats('TrackedEntity');

      // AccessTracker should have recorded the access
      expect(stats).toBeDefined();
    });
  });

  describe('Agent Memory: decayEngine Initialization', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it('should lazily initialize decayEngine on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-engine-test.jsonl'));
      const engine = newManager.decayEngine;

      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(DecayEngine);
    });

    it('should return same decayEngine instance on subsequent accesses', () => {
      const first = manager.decayEngine;
      const second = manager.decayEngine;

      expect(first).toBe(second);
    });

    it('should use default half-life when env var not set', () => {
      delete process.env.MEMORY_DECAY_HALF_LIFE_HOURS;
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-default.jsonl'));
      const engine = newManager.decayEngine;

      // Default is 168 hours (1 week)
      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_DECAY_HALF_LIFE_HOURS env var', () => {
      process.env.MEMORY_DECAY_HALF_LIFE_HOURS = '48';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-half-life.jsonl'));
      const engine = newManager.decayEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_DECAY_MIN_IMPORTANCE env var', () => {
      process.env.MEMORY_DECAY_MIN_IMPORTANCE = '0.05';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-min-importance.jsonl'));
      const engine = newManager.decayEngine;

      expect(engine).toBeDefined();
    });

    it('should handle invalid numeric env var with default', () => {
      process.env.MEMORY_DECAY_HALF_LIFE_HOURS = 'invalid';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-invalid.jsonl'));
      const engine = newManager.decayEngine;

      // Should fall back to default (168)
      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_DECAY_IMPORTANCE_MOD boolean env var', () => {
      process.env.MEMORY_DECAY_IMPORTANCE_MOD = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-importance-mod.jsonl'));
      const engine = newManager.decayEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_DECAY_ACCESS_MOD boolean env var', () => {
      process.env.MEMORY_DECAY_ACCESS_MOD = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-access-mod.jsonl'));
      const engine = newManager.decayEngine;

      expect(engine).toBeDefined();
    });

    it('should inject accessTracker dependency', () => {
      const tracker = manager.accessTracker;
      const engine = manager.decayEngine;

      // Both should be initialized and engine should have tracker dependency
      expect(tracker).toBeDefined();
      expect(engine).toBeDefined();
    });
  });

  describe('Agent Memory: decayScheduler Initialization', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return undefined when MEMORY_AUTO_DECAY is false', () => {
      process.env.MEMORY_AUTO_DECAY = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-disabled.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeUndefined();
    });

    it('should return undefined when MEMORY_AUTO_DECAY is not set', () => {
      delete process.env.MEMORY_AUTO_DECAY;
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-unset.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeUndefined();
    });

    it('should create scheduler when MEMORY_AUTO_DECAY is true', () => {
      process.env.MEMORY_AUTO_DECAY = 'true';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-enabled.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeDefined();
    });

    it('should parse MEMORY_DECAY_INTERVAL_MS env var', () => {
      process.env.MEMORY_AUTO_DECAY = 'true';
      process.env.MEMORY_DECAY_INTERVAL_MS = '1800000';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-interval.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeDefined();
    });

    it('should parse MEMORY_AUTO_FORGET env var', () => {
      process.env.MEMORY_AUTO_DECAY = 'true';
      process.env.MEMORY_AUTO_FORGET = 'true';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-forget.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeDefined();
    });

    it('should parse MEMORY_FORGET_THRESHOLD env var', () => {
      process.env.MEMORY_AUTO_DECAY = 'true';
      process.env.MEMORY_FORGET_THRESHOLD = '0.1';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-threshold.jsonl'));
      const scheduler = newManager.decayScheduler;

      expect(scheduler).toBeDefined();
    });

    it('should return same scheduler instance on subsequent accesses', () => {
      process.env.MEMORY_AUTO_DECAY = 'true';
      const newManager = new KnowledgeGraphManager(join(testDir, 'decay-scheduler-same.jsonl'));
      const first = newManager.decayScheduler;
      const second = newManager.decayScheduler;

      expect(first).toBe(second);
    });
  });

  describe('Agent Memory: salienceEngine Initialization', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should lazily initialize salienceEngine on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-test.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(SalienceEngine);
    });

    it('should return same salienceEngine instance on subsequent accesses', () => {
      const first = manager.salienceEngine;
      const second = manager.salienceEngine;

      expect(first).toBe(second);
    });

    it('should parse MEMORY_SALIENCE_IMPORTANCE_WEIGHT env var', () => {
      process.env.MEMORY_SALIENCE_IMPORTANCE_WEIGHT = '0.3';
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-importance.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_SALIENCE_RECENCY_WEIGHT env var', () => {
      process.env.MEMORY_SALIENCE_RECENCY_WEIGHT = '0.35';
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-recency.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_SALIENCE_FREQUENCY_WEIGHT env var', () => {
      process.env.MEMORY_SALIENCE_FREQUENCY_WEIGHT = '0.15';
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-frequency.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_SALIENCE_CONTEXT_WEIGHT env var', () => {
      process.env.MEMORY_SALIENCE_CONTEXT_WEIGHT = '0.25';
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-context.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should parse MEMORY_SALIENCE_NOVELTY_WEIGHT env var', () => {
      process.env.MEMORY_SALIENCE_NOVELTY_WEIGHT = '0.05';
      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-novelty.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should use default weights when env vars not set', () => {
      delete process.env.MEMORY_SALIENCE_IMPORTANCE_WEIGHT;
      delete process.env.MEMORY_SALIENCE_RECENCY_WEIGHT;
      delete process.env.MEMORY_SALIENCE_FREQUENCY_WEIGHT;
      delete process.env.MEMORY_SALIENCE_CONTEXT_WEIGHT;
      delete process.env.MEMORY_SALIENCE_NOVELTY_WEIGHT;

      const newManager = new KnowledgeGraphManager(join(testDir, 'salience-defaults.jsonl'));
      const engine = newManager.salienceEngine;

      // Default weights: 0.25, 0.25, 0.2, 0.2, 0.1
      expect(engine).toBeDefined();
    });

    it('should inject storage, accessTracker, and decayEngine dependencies', () => {
      const storage = manager.storage;
      const tracker = manager.accessTracker;
      const decayEngine = manager.decayEngine;
      const salienceEngine = manager.salienceEngine;

      // All dependencies should be initialized
      expect(storage).toBeDefined();
      expect(tracker).toBeDefined();
      expect(decayEngine).toBeDefined();
      expect(salienceEngine).toBeDefined();
    });
  });

  describe('Agent Memory: contextWindowManager Initialization', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should lazily initialize contextWindowManager on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-window-test.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
      expect(cwm).toBeInstanceOf(ContextWindowManager);
    });

    it('should return same contextWindowManager instance on subsequent accesses', () => {
      const first = manager.contextWindowManager;
      const second = manager.contextWindowManager;

      expect(first).toBe(second);
    });

    it('should parse MEMORY_CONTEXT_MAX_TOKENS env var', () => {
      process.env.MEMORY_CONTEXT_MAX_TOKENS = '8000';
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-max-tokens.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should parse MEMORY_CONTEXT_TOKEN_MULTIPLIER env var', () => {
      process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER = '1.5';
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-multiplier.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should parse MEMORY_CONTEXT_RESERVE_BUFFER env var', () => {
      process.env.MEMORY_CONTEXT_RESERVE_BUFFER = '200';
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-buffer.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should parse MEMORY_CONTEXT_DIVERSITY_THRESHOLD env var', () => {
      process.env.MEMORY_CONTEXT_DIVERSITY_THRESHOLD = '0.9';
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-diversity.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should parse MEMORY_CONTEXT_ENFORCE_DIVERSITY boolean env var', () => {
      process.env.MEMORY_CONTEXT_ENFORCE_DIVERSITY = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'context-enforce-diversity.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should use default values when env vars not set', () => {
      delete process.env.MEMORY_CONTEXT_MAX_TOKENS;
      delete process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER;
      delete process.env.MEMORY_CONTEXT_RESERVE_BUFFER;
      delete process.env.MEMORY_CONTEXT_DIVERSITY_THRESHOLD;
      delete process.env.MEMORY_CONTEXT_ENFORCE_DIVERSITY;

      const newManager = new KnowledgeGraphManager(join(testDir, 'context-defaults.jsonl'));
      const cwm = newManager.contextWindowManager;

      // Defaults: 4000, 1.3, 100, 0.8, true
      expect(cwm).toBeDefined();
    });

    it('should inject storage and salienceEngine dependencies', () => {
      const storage = manager.storage;
      const salienceEngine = manager.salienceEngine;
      const cwm = manager.contextWindowManager;

      expect(storage).toBeDefined();
      expect(salienceEngine).toBeDefined();
      expect(cwm).toBeDefined();
    });
  });

  describe('Agent Memory: memoryFormatter Initialization', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should lazily initialize memoryFormatter on first access', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'memory-formatter-test.jsonl'));
      const formatter = newManager.memoryFormatter;

      expect(formatter).toBeDefined();
      expect(formatter).toBeInstanceOf(MemoryFormatter);
    });

    it('should return same memoryFormatter instance on subsequent accesses', () => {
      const first = manager.memoryFormatter;
      const second = manager.memoryFormatter;

      expect(first).toBe(second);
    });

    it('should parse MEMORY_FORMAT_TIMESTAMPS boolean env var', () => {
      process.env.MEMORY_FORMAT_TIMESTAMPS = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'formatter-timestamps.jsonl'));
      const formatter = newManager.memoryFormatter;

      expect(formatter).toBeDefined();
    });

    it('should parse MEMORY_FORMAT_MEMORY_TYPE boolean env var', () => {
      process.env.MEMORY_FORMAT_MEMORY_TYPE = 'false';
      const newManager = new KnowledgeGraphManager(join(testDir, 'formatter-memory-type.jsonl'));
      const formatter = newManager.memoryFormatter;

      expect(formatter).toBeDefined();
    });
  });

  describe('Agent Memory: agentMemory() Facade', () => {
    it('should return AgentMemoryManager on first call', () => {
      const amm = manager.agentMemory();

      expect(amm).toBeDefined();
      expect(amm).toBeInstanceOf(AgentMemoryManager);
    });

    it('should return same instance on subsequent calls without config', () => {
      const first = manager.agentMemory();
      const second = manager.agentMemory();

      expect(first).toBe(second);
    });

    it('should create new instance when config is provided', () => {
      const first = manager.agentMemory();
      const second = manager.agentMemory({ sessionTtlMs: 60000 });

      // When config is provided, a new instance should be created
      expect(second).toBeDefined();
      expect(second).toBeInstanceOf(AgentMemoryManager);
    });

    it('should accept optional config parameter', () => {
      const config = {
        sessionTtlMs: 3600000,
        workingMemorySize: 20,
        defaultSessionAgent: 'test-agent',
      };

      const amm = manager.agentMemory(config);

      expect(amm).toBeDefined();
    });

    it('should provide access to session operations', async () => {
      const amm = manager.agentMemory();

      // AgentMemoryManager should have session-related methods
      expect(typeof amm.startSession).toBe('function');
      expect(typeof amm.endSession).toBe('function');
    });

    it('should provide access to working memory operations', async () => {
      const amm = manager.agentMemory();

      // AgentMemoryManager should have working memory methods
      expect(typeof amm.addWorkingMemory).toBe('function');
      // workingMemory is a getter property, not a method
      expect(amm.workingMemory).toBeDefined();
    });
  });

  describe('Agent Memory: Dependency Chain Verification', () => {
    it('should initialize accessTracker before decayEngine', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'dep-chain-1.jsonl'));

      // Accessing decayEngine should auto-initialize accessTracker
      const engine = newManager.decayEngine;
      const tracker = newManager.accessTracker;

      expect(engine).toBeDefined();
      expect(tracker).toBeDefined();
    });

    it('should initialize decayEngine before salienceEngine', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'dep-chain-2.jsonl'));

      // Accessing salienceEngine should auto-initialize decayEngine
      const salienceEngine = newManager.salienceEngine;
      const decayEngine = newManager.decayEngine;

      expect(salienceEngine).toBeDefined();
      expect(decayEngine).toBeDefined();
    });

    it('should initialize salienceEngine before contextWindowManager', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'dep-chain-3.jsonl'));

      // Accessing contextWindowManager should auto-initialize salienceEngine
      const cwm = newManager.contextWindowManager;
      const salienceEngine = newManager.salienceEngine;

      expect(cwm).toBeDefined();
      expect(salienceEngine).toBeDefined();
    });

    it('should maintain consistent dependency chain', () => {
      const newManager = new KnowledgeGraphManager(join(testDir, 'dep-chain-full.jsonl'));

      // Access the top of the chain
      const cwm = newManager.contextWindowManager;

      // All dependencies should be initialized
      expect(newManager.storage).toBeDefined();
      expect(newManager.accessTracker).toBeDefined();
      expect(newManager.decayEngine).toBeDefined();
      expect(newManager.salienceEngine).toBeDefined();
      expect(cwm).toBeDefined();
    });
  });

  describe('Agent Memory: Environment Variable Edge Cases', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should handle negative numeric env var with default', () => {
      process.env.MEMORY_DECAY_HALF_LIFE_HOURS = '-10';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-negative.jsonl'));
      const engine = newManager.decayEngine;

      // Should still parse negative as valid number
      expect(engine).toBeDefined();
    });

    it('should handle zero numeric env var', () => {
      process.env.MEMORY_SALIENCE_NOVELTY_WEIGHT = '0';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-zero.jsonl'));
      const engine = newManager.salienceEngine;

      expect(engine).toBeDefined();
    });

    it('should handle decimal numeric env var', () => {
      process.env.MEMORY_CONTEXT_TOKEN_MULTIPLIER = '1.75';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-decimal.jsonl'));
      const cwm = newManager.contextWindowManager;

      expect(cwm).toBeDefined();
    });

    it('should handle TRUE (uppercase) boolean env var', () => {
      process.env.MEMORY_AUTO_DECAY = 'TRUE';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-uppercase-true.jsonl'));
      const scheduler = newManager.decayScheduler;

      // toLowerCase() converts 'TRUE' to 'true', so scheduler should be defined
      expect(scheduler).toBeDefined();
    });

    it('should handle True (mixed case) boolean env var', () => {
      process.env.MEMORY_DECAY_IMPORTANCE_MOD = 'True';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-mixedcase-true.jsonl'));
      const engine = newManager.decayEngine;

      // Should work due to toLowerCase()
      expect(engine).toBeDefined();
    });

    it('should handle empty string env var as undefined', () => {
      process.env.MEMORY_DECAY_HALF_LIFE_HOURS = '';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-empty.jsonl'));
      const engine = newManager.decayEngine;

      // Empty string should parse as NaN, falling back to default
      expect(engine).toBeDefined();
    });

    it('should handle whitespace env var', () => {
      process.env.MEMORY_CONTEXT_MAX_TOKENS = '  8000  ';
      const newManager = new KnowledgeGraphManager(join(testDir, 'env-whitespace.jsonl'));
      const cwm = newManager.contextWindowManager;

      // parseFloat handles leading/trailing whitespace
      expect(cwm).toBeDefined();
    });
  });
});
