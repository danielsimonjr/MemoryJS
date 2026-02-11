/**
 * Write Performance Tests
 *
 * Validates O(1) append operations and compaction behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { EntityManager } from '../../src/core/EntityManager.js';
import { ObservationManager } from '../../src/core/ObservationManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Entity } from '../../src/types/index.js';

describe('Write Performance', () => {
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let observationManager: ObservationManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `write-perf-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');
    storage = new GraphStorage(testFilePath);
    entityManager = new EntityManager(storage);
    observationManager = new ObservationManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('appendEntity performance', () => {
    it('should add single entity using append operation', async () => {
      // Create a graph first
      const timestamp = new Date().toISOString();
      const initialEntities: Entity[] = [];
      for (let i = 0; i < 100; i++) {
        initialEntities.push({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Observation for entity ${i}`],
          createdAt: timestamp,
          lastModified: timestamp,
        });
      }

      // Save the initial graph
      await storage.saveGraph({ entities: initialEntities, relations: [] });
      expect(storage.getPendingAppends()).toBe(0);

      // Append a single entity
      await storage.appendEntity({
        name: 'NewEntity',
        entityType: 'test',
        observations: ['New observation'],
        createdAt: timestamp,
        lastModified: timestamp,
      });

      // Verify entity was added and append counter incremented
      expect(storage.getPendingAppends()).toBe(1);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(101);
      expect(graph.entities.find(e => e.name === 'NewEntity')).toBeDefined();
    });

    it('should update cache in-place after append', async () => {
      const timestamp = new Date().toISOString();

      // Start with empty graph
      await storage.saveGraph({ entities: [], relations: [] });

      // Append entity
      await storage.appendEntity({
        name: 'TestEntity',
        entityType: 'test',
        observations: ['Test'],
        createdAt: timestamp,
        lastModified: timestamp,
      });

      // Cache should be updated without re-reading file
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('TestEntity');
    });

    it('should persist appended entity to file', async () => {
      const timestamp = new Date().toISOString();

      await storage.appendEntity({
        name: 'PersistedEntity',
        entityType: 'test',
        observations: ['Persisted'],
        createdAt: timestamp,
        lastModified: timestamp,
      });

      // Clear cache and reload from disk
      storage.clearCache();
      const graph = await storage.loadGraph();

      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('PersistedEntity');
    });
  });

  describe('updateEntity performance', () => {
    it('should update entity and increment pending appends', async () => {
      const timestamp = new Date().toISOString();

      // Create entities using bulk save (starts at 0 pending appends)
      const entities: Entity[] = [];
      for (let i = 0; i < 10; i++) {
        entities.push({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Initial observation ${i}`],
          createdAt: timestamp,
          lastModified: timestamp,
        });
      }
      await storage.saveGraph({ entities, relations: [] });
      expect(storage.getPendingAppends()).toBe(0);

      // Update should increment pending appends
      await storage.updateEntity('Entity5', {
        observations: ['Updated observation'],
        importance: 5,
      });
      expect(storage.getPendingAppends()).toBe(1);

      // Verify update was applied
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'Entity5');
      expect(entity?.observations).toContain('Updated observation');
      expect(entity?.importance).toBe(5);
    });

    it('should update entity in cache immediately', async () => {
      const timestamp = new Date().toISOString();

      // Create an entity
      await storage.saveGraph({
        entities: [{
          name: 'TestEntity',
          entityType: 'test',
          observations: ['Initial'],
          createdAt: timestamp,
          lastModified: timestamp,
        }],
        relations: [],
      });

      // Update should be reflected in cache immediately
      await storage.updateEntity('TestEntity', {
        observations: ['Updated'],
        importance: 8,
      });

      // Load graph (from cache) should show update
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'TestEntity');
      expect(entity?.observations).toContain('Updated');
      expect(entity?.importance).toBe(8);
    });

    it('should persist updates to file', async () => {
      const timestamp = new Date().toISOString();

      await storage.saveGraph({
        entities: [{
          name: 'PersistTest',
          entityType: 'test',
          observations: ['Before'],
          createdAt: timestamp,
          lastModified: timestamp,
        }],
        relations: [],
      });

      await storage.updateEntity('PersistTest', {
        observations: ['After'],
      });

      // Clear cache and reload from disk
      storage.clearCache();
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'PersistTest');
      expect(entity?.observations).toContain('After');
    });

    it('should return false for non-existent entity', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      const result = await storage.updateEntity('NonExistent', { importance: 5 });
      expect(result).toBe(false);
    });
  });

  describe('compaction behavior', () => {
    it('should track pending appends correctly', async () => {
      const timestamp = new Date().toISOString();

      expect(storage.getPendingAppends()).toBe(0);

      await storage.appendEntity({
        name: 'Entity1',
        entityType: 'test',
        observations: [],
        createdAt: timestamp,
        lastModified: timestamp,
      });
      expect(storage.getPendingAppends()).toBe(1);

      await storage.appendEntity({
        name: 'Entity2',
        entityType: 'test',
        observations: [],
        createdAt: timestamp,
        lastModified: timestamp,
      });
      expect(storage.getPendingAppends()).toBe(2);
    });

    it('should reset pending appends after saveGraph', async () => {
      const timestamp = new Date().toISOString();

      await storage.appendEntity({
        name: 'Entity1',
        entityType: 'test',
        observations: [],
        createdAt: timestamp,
        lastModified: timestamp,
      });
      expect(storage.getPendingAppends()).toBe(1);

      // Full save should trigger compaction
      const graph = await storage.getGraphForMutation();
      await storage.saveGraph(graph);
      expect(storage.getPendingAppends()).toBe(0);
    });

    it('should compact and produce clean file', async () => {
      const timestamp = new Date().toISOString();

      // Create entities with bulk save (no pending appends)
      const entities: Entity[] = [];
      for (let i = 0; i < 10; i++) {
        entities.push({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Obs ${i}`],
          createdAt: timestamp,
          lastModified: timestamp,
        });
      }
      await storage.saveGraph({ entities, relations: [] });
      expect(storage.getPendingAppends()).toBe(0);

      // Add some appends
      for (let i = 10; i < 15; i++) {
        await storage.appendEntity({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Obs ${i}`],
          createdAt: timestamp,
          lastModified: timestamp,
        });
      }
      expect(storage.getPendingAppends()).toBe(5);

      // Force compaction
      await storage.compact();
      expect(storage.getPendingAppends()).toBe(0);

      // Read file content to verify it's clean
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter(l => l.trim());

      // Should have exactly 15 entities
      expect(lines).toHaveLength(15);

      // Verify all entities are present
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(15);
    });

    it('should maintain data integrity after compaction', async () => {
      const timestamp = new Date().toISOString();

      // Create entities with bulk save
      const entities: Entity[] = [];
      for (let i = 0; i < 10; i++) {
        entities.push({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Initial${i}`],
          tags: [`tag${i}`],
          importance: i % 10,
          createdAt: timestamp,
          lastModified: timestamp,
        });
      }
      await storage.saveGraph({ entities, relations: [] });

      // Update some entities (adds more lines to file via append)
      for (let i = 0; i < 5; i++) {
        await storage.updateEntity(`Entity${i}`, {
          observations: [`Updated${i}`],
        });
      }

      // Force compaction
      await storage.compact();

      // Verify data integrity
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(10);

      // Verify updated entities (0-4) have updated observations
      for (let i = 0; i < 5; i++) {
        const entity = graph.entities.find(e => e.name === `Entity${i}`);
        expect(entity).toBeDefined();
        expect(entity?.observations).toContain(`Updated${i}`);
        expect(entity?.tags).toContain(`tag${i}`);
        expect(entity?.importance).toBe(i % 10);
      }

      // Verify non-updated entities (5-9) retain original observations
      for (let i = 5; i < 10; i++) {
        const entity = graph.entities.find(e => e.name === `Entity${i}`);
        expect(entity).toBeDefined();
        expect(entity?.observations).toContain(`Initial${i}`);
      }
    });
  });

  describe('EntityManager with append operations', () => {
    it('should create single entity correctly', async () => {
      // Create a single entity
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: [] },
      ]);

      // Add another single entity
      await entityManager.createEntities([
        { name: 'Entity2', entityType: 'test', observations: [] },
      ]);

      // Verify entities exist
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(2);
    });

    it('should create multiple entities using bulk save', async () => {
      // Create multiple entities - should use bulk save
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: [] },
        { name: 'Entity2', entityType: 'test', observations: [] },
        { name: 'Entity3', entityType: 'test', observations: [] },
      ]);

      // Bulk save resets pending appends
      expect(storage.getPendingAppends()).toBe(0);

      // Verify all entities exist
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(3);
    });

    it('should add observations atomically using saveGraph', async () => {
      // Use bulk create so pending appends starts at 0
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: ['Initial'] },
        { name: 'OtherEntity', entityType: 'test', observations: [] },
      ]);
      expect(storage.getPendingAppends()).toBe(0);

      await observationManager.addObservations([
        { entityName: 'TestEntity', contents: ['New observation'] },
      ]);

      // addObservations now uses atomic saveGraph which resets pending appends
      expect(storage.getPendingAppends()).toBe(0);

      // Verify observation added
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.observations).toContain('New observation');
    });

    it('should set importance using updateEntity', async () => {
      // Use bulk create so pending appends starts at 0
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: [] },
        { name: 'OtherEntity', entityType: 'test', observations: [] },
      ]);
      expect(storage.getPendingAppends()).toBe(0);

      await entityManager.setImportance('TestEntity', 8);

      // Should have incremented pending appends
      expect(storage.getPendingAppends()).toBe(1);

      // Verify importance set
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.importance).toBe(8);
    });

    it('should add tags using updateEntity', async () => {
      // Use bulk create so pending appends starts at 0
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: [] },
        { name: 'OtherEntity', entityType: 'test', observations: [] },
      ]);
      expect(storage.getPendingAppends()).toBe(0);

      await entityManager.addTags('TestEntity', ['tag1', 'tag2']);

      // Should have incremented pending appends
      expect(storage.getPendingAppends()).toBe(1);

      // Verify tags added
      const entity = await entityManager.getEntity('TestEntity');
      expect(entity?.tags).toContain('tag1');
      expect(entity?.tags).toContain('tag2');
    });
  });

  describe('ObservationManager.addObservations with atomic operations', () => {
    it('should add observations atomically using saveGraph', async () => {
      // Use bulk create so pending appends starts at 0
      await entityManager.createEntities([
        { name: 'TestEntity', entityType: 'test', observations: ['Initial'] },
        { name: 'OtherEntity', entityType: 'test', observations: [] },
      ]);
      expect(storage.getPendingAppends()).toBe(0);

      await observationManager.addObservations([
        { entityName: 'TestEntity', contents: ['Obs1', 'Obs2'] },
      ]);

      // addObservations now uses atomic saveGraph which resets pending appends
      expect(storage.getPendingAppends()).toBe(0);

      // Verify observations added
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'TestEntity');
      expect(entity?.observations).toContain('Obs1');
      expect(entity?.observations).toContain('Obs2');
    });
  });
});
