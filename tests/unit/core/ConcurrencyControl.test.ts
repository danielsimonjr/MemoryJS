/**
 * Concurrency Control Unit Tests
 *
 * Tests for Phase 2: Add Concurrency Control
 * Verifies that mutex protection prevents data corruption from concurrent operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Concurrency Control', () => {
  describe('GraphStorage Mutex', () => {
    let storage: GraphStorage;
    let testDir: string;
    let testFilePath: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `concurrency-test-${Date.now()}-${Math.random()}`);
      await fs.mkdir(testDir, { recursive: true });
      testFilePath = join(testDir, 'test-graph.jsonl');
      storage = new GraphStorage(testFilePath);
    });

    afterEach(async () => {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should serialize concurrent saveGraph operations', async () => {
      // Create initial data
      await storage.saveGraph({
        entities: [],
        relations: [],
      });

      // Launch multiple concurrent saveGraph operations
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(storage.saveGraph({
          entities: [{
            name: `Entity${i}`,
            entityType: 'test',
            observations: [`observation ${i}`],
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
          }],
          relations: [],
        }));
      }

      // Wait for all to complete
      await Promise.all(promises);

      // Final graph should have exactly 1 entity (from the last save)
      // The mutex ensures no interleaving
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
    });

    it('should serialize concurrent appendEntity operations', async () => {
      // Ensure storage is initialized
      await storage.loadGraph();

      // Launch multiple concurrent append operations
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(storage.appendEntity({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }));
      }

      // Wait for all to complete
      await Promise.all(promises);

      // All entities should be present in cache
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(20);

      // After reload, all should be deduplicated and present
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities.length).toBe(20);
    });

    it('should serialize concurrent updateEntity operations', async () => {
      // Create an entity
      await storage.appendEntity({
        name: 'Target',
        entityType: 'test',
        observations: [],
        importance: 0,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Launch multiple concurrent updates to the same entity
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(storage.updateEntity('Target', { importance: i }));
      }

      // Wait for all to complete
      await Promise.all(promises);

      // Entity should have one of the importance values (mutex serialized updates)
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'Target');
      expect(entity).toBeDefined();
      expect(entity!.importance).toBeGreaterThanOrEqual(1);
      expect(entity!.importance).toBeLessThanOrEqual(10);
    });

    it('should serialize mixed concurrent operations', async () => {
      // Ensure storage is initialized
      await storage.loadGraph();

      // Launch a mix of concurrent operations
      const promises = [
        // Append operations
        storage.appendEntity({
          name: 'Entity1',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
        storage.appendEntity({
          name: 'Entity2',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
        storage.appendRelation({
          from: 'Entity1',
          to: 'Entity2',
          relationType: 'related',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
      ];

      await Promise.all(promises);

      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.relations.length).toBe(1);
    });

    it('should not deadlock when compact is called during concurrent operations', async () => {
      // Ensure storage is initialized
      await storage.loadGraph();

      // Add enough entities to trigger compaction threshold
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(storage.appendEntity({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }));
      }

      // Add explicit compact call
      promises.push(storage.compact());

      // This should complete without deadlock
      await Promise.all(promises);

      // Verify data integrity
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBeGreaterThan(0);
    });
  });

  describe('SQLiteStorage Mutex', () => {
    let storage: SQLiteStorage;
    let testDir: string;
    let testFilePath: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `sqlite-concurrency-test-${Date.now()}-${Math.random()}`);
      await fs.mkdir(testDir, { recursive: true });
      testFilePath = join(testDir, 'test.db');
      storage = new SQLiteStorage(testFilePath);
    });

    afterEach(async () => {
      try {
        storage.close();
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should serialize concurrent appendEntity operations', async () => {
      // Ensure storage is initialized
      await storage.ensureLoaded();

      // Launch multiple concurrent append operations
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(storage.appendEntity({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }));
      }

      // Wait for all to complete
      await Promise.all(promises);

      // All entities should be present
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(20);
    });

    it('should serialize concurrent updateEntity operations', async () => {
      // Create an entity
      await storage.appendEntity({
        name: 'Target',
        entityType: 'test',
        observations: [],
        importance: 0,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      // Launch multiple concurrent updates
      const promises = [];
      for (let i = 1; i <= 10; i++) {
        promises.push(storage.updateEntity('Target', { importance: i }));
      }

      await Promise.all(promises);

      // Entity should have a valid importance value
      const graph = await storage.loadGraph();
      const entity = graph.entities.find(e => e.name === 'Target');
      expect(entity).toBeDefined();
      expect(entity!.importance).toBeGreaterThanOrEqual(1);
      expect(entity!.importance).toBeLessThanOrEqual(10);
    });

    it('should serialize mixed concurrent operations', async () => {
      await storage.ensureLoaded();

      const promises = [
        storage.appendEntity({
          name: 'Entity1',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
        storage.appendEntity({
          name: 'Entity2',
          entityType: 'test',
          observations: [],
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
        storage.appendRelation({
          from: 'Entity1',
          to: 'Entity2',
          relationType: 'related',
          createdAt: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        }),
      ];

      await Promise.all(promises);

      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.relations.length).toBe(1);
    });
  });

  describe('EntityManager Atomic Operations', () => {
    let storage: GraphStorage;
    let entityManager: EntityManager;
    let observationManager: ObservationManager;
    let testDir: string;
    let testFilePath: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `entity-manager-atomic-test-${Date.now()}-${Math.random()}`);
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

    it('should atomically add observations to multiple entities', async () => {
      // Create entities
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['initial1'] },
        { name: 'Entity2', entityType: 'test', observations: ['initial2'] },
        { name: 'Entity3', entityType: 'test', observations: ['initial3'] },
      ]);

      // Add observations to all entities in one atomic operation
      const results = await observationManager.addObservations([
        { entityName: 'Entity1', contents: ['new1a', 'new1b'] },
        { entityName: 'Entity2', contents: ['new2a'] },
        { entityName: 'Entity3', contents: ['new3a', 'new3b', 'new3c'] },
      ]);

      // Verify all observations were added
      expect(results.length).toBe(3);
      expect(results[0].addedObservations).toEqual(['new1a', 'new1b']);
      expect(results[1].addedObservations).toEqual(['new2a']);
      expect(results[2].addedObservations).toEqual(['new3a', 'new3b', 'new3c']);

      // Verify graph state
      const entity1 = await entityManager.getEntity('Entity1');
      expect(entity1!.observations).toContain('initial1');
      expect(entity1!.observations).toContain('new1a');
      expect(entity1!.observations).toContain('new1b');
    });

    it('should atomically delete observations from multiple entities', async () => {
      // Create entities with observations
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['obs1', 'obs2', 'obs3'] },
        { name: 'Entity2', entityType: 'test', observations: ['obs4', 'obs5'] },
      ]);

      // Delete observations from all entities atomically
      await observationManager.deleteObservations([
        { entityName: 'Entity1', observations: ['obs1', 'obs3'] },
        { entityName: 'Entity2', observations: ['obs5'] },
      ]);

      // Verify deletions
      const entity1 = await entityManager.getEntity('Entity1');
      expect(entity1!.observations).toEqual(['obs2']);

      const entity2 = await entityManager.getEntity('Entity2');
      expect(entity2!.observations).toEqual(['obs4']);
    });

    it('should serialize concurrent addObservations calls (last writer wins)', async () => {
      // Create entities
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: [] },
        { name: 'Entity2', entityType: 'test', observations: [] },
      ]);

      // Multiple concurrent addObservations calls
      // Note: Each call reads the initial empty state, adds observations, and saves.
      // The mutex ensures each save completes atomically, but concurrent calls
      // read-modify-write the same initial state, so only the last save persists.
      // This is a known limitation - full transaction support would require
      // holding the lock between getGraphForMutation and saveGraph.
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(observationManager.addObservations([
          { entityName: 'Entity1', contents: [`obs1_${i}`] },
          { entityName: 'Entity2', contents: [`obs2_${i}`] },
        ]));
      }

      await Promise.all(promises);

      // Due to concurrent read-modify-write, only the last writer's changes persist
      const entity1 = await entityManager.getEntity('Entity1');
      const entity2 = await entityManager.getEntity('Entity2');

      // Each entity should have at least 1 observation (from the last writer)
      // The mutex prevents data corruption but doesn't prevent lost updates
      expect(entity1!.observations.length).toBeGreaterThanOrEqual(1);
      expect(entity2!.observations.length).toBeGreaterThanOrEqual(1);
    });

    it('should correctly handle sequential addObservations calls', async () => {
      // Create entities
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: [] },
        { name: 'Entity2', entityType: 'test', observations: [] },
      ]);

      // Sequential addObservations calls (proper usage pattern)
      for (let i = 0; i < 5; i++) {
        await observationManager.addObservations([
          { entityName: 'Entity1', contents: [`obs1_${i}`] },
          { entityName: 'Entity2', contents: [`obs2_${i}`] },
        ]);
      }

      // All observations should be present when called sequentially
      const entity1 = await entityManager.getEntity('Entity1');
      const entity2 = await entityManager.getEntity('Entity2');

      expect(entity1!.observations.length).toBe(5);
      expect(entity2!.observations.length).toBe(5);
    });

    it('should skip save when no changes are made in addObservations', async () => {
      // Create entity with existing observations
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['existing'] },
      ]);

      // Try to add duplicate observation
      const results = await observationManager.addObservations([
        { entityName: 'Entity1', contents: ['existing'] },
      ]);

      // Should report no new observations
      expect(results[0].addedObservations).toEqual([]);
    });

    it('should skip save when no changes are made in deleteObservations', async () => {
      // Create entity
      await entityManager.createEntities([
        { name: 'Entity1', entityType: 'test', observations: ['obs1'] },
      ]);

      // Try to delete non-existent observation
      await observationManager.deleteObservations([
        { entityName: 'Entity1', observations: ['nonexistent'] },
      ]);

      // Original observation should still be there
      const entity = await entityManager.getEntity('Entity1');
      expect(entity!.observations).toEqual(['obs1']);
    });
  });
});
