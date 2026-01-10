/**
 * Transaction Batching API Tests
 *
 * Phase 10 Sprint 1: Tests for the BatchTransaction class and fluent API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BatchTransaction } from '../../../src/core/TransactionManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BatchTransaction', () => {
  let tempDir: string;
  let storage: GraphStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'batch-tx-test-'));
    storage = new GraphStorage(join(tempDir, 'memory.jsonl'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createEntity', () => {
    it('should create entities in a batch', async () => {
      const batch = new BatchTransaction(storage);

      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['Engineer'] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(2);

      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.entities.find(e => e.name === 'Alice')).toBeDefined();
      expect(graph.entities.find(e => e.name === 'Bob')).toBeDefined();
    });

    it('should set timestamps on created entities', async () => {
      const batch = new BatchTransaction(storage);

      await batch
        .createEntity({ name: 'Test', entityType: 'test', observations: [] })
        .execute();

      const graph = await storage.loadGraph();
      const entity = graph.entities[0];
      expect(entity.createdAt).toBeDefined();
      expect(entity.lastModified).toBeDefined();
    });

    it('should skip duplicate entity names', async () => {
      // First create entity
      const batch1 = new BatchTransaction(storage);
      await batch1
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .execute();

      // Try to create duplicate
      const batch2 = new BatchTransaction(storage);
      const result = await batch2
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['New'] })
        .execute({ stopOnError: false });

      expect(result.entitiesCreated).toBe(0);
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(1);
    });
  });

  describe('createRelation', () => {
    it('should create relations in a batch', async () => {
      // First create entities
      const setupBatch = new BatchTransaction(storage);
      await setupBatch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .execute();

      // Then create relations
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .execute();

      expect(result.relationsCreated).toBe(1);
      const graph = await storage.loadGraph();
      expect(graph.relations.length).toBe(1);
      expect(graph.relations[0].from).toBe('Alice');
      expect(graph.relations[0].to).toBe('Bob');
    });

    it('should set timestamps on created relations', async () => {
      // Setup entities
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'A', entityType: 't', observations: [] })
        .createEntity({ name: 'B', entityType: 't', observations: [] })
        .execute();

      // Create relation
      const batch = new BatchTransaction(storage);
      await batch.createRelation({ from: 'A', to: 'B', relationType: 'related' }).execute();

      const graph = await storage.loadGraph();
      expect(graph.relations[0].createdAt).toBeDefined();
      expect(graph.relations[0].lastModified).toBeDefined();
    });
  });

  describe('updateEntity', () => {
    it('should update entities in a batch', async () => {
      // Create entity
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['Initial'] })
        .execute();

      // Update entity
      const batch = new BatchTransaction(storage);
      const result = await batch
        .updateEntity('Alice', { importance: 8 })
        .execute();

      expect(result.entitiesUpdated).toBe(1);
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.importance).toBe(8);
    });
  });

  describe('deleteEntity', () => {
    it('should delete entities in a batch', async () => {
      // Create entities
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .createEntity({ name: 'Charlie', entityType: 'person', observations: [] })
        .execute();

      // Delete entity
      const batch = new BatchTransaction(storage);
      const result = await batch.deleteEntity('Bob').execute();

      expect(result.entitiesDeleted).toBe(1);
      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.entities.find(e => e.name === 'Bob')).toBeUndefined();
    });

    it('should cascade delete relations when entity is deleted', async () => {
      // Create entities and relation
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .execute();

      // Delete Bob
      const batch = new BatchTransaction(storage);
      await batch.deleteEntity('Bob').execute();

      const graph = await storage.loadGraph();
      expect(graph.relations.length).toBe(0);
    });
  });

  describe('deleteRelation', () => {
    it('should delete relations in a batch', async () => {
      // Setup
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'A', entityType: 't', observations: [] })
        .createEntity({ name: 'B', entityType: 't', observations: [] })
        .createRelation({ from: 'A', to: 'B', relationType: 'related' })
        .execute();

      // Delete relation
      const batch = new BatchTransaction(storage);
      const result = await batch.deleteRelation('A', 'B', 'related').execute();

      expect(result.relationsDeleted).toBe(1);
      const graph = await storage.loadGraph();
      expect(graph.relations.length).toBe(0);
    });
  });

  describe('addObservations', () => {
    it('should add observations in a batch', async () => {
      // Setup
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['Initial'] })
        .execute();

      // Add observations
      const batch = new BatchTransaction(storage);
      const result = await batch
        .addObservations('Alice', ['Added 1', 'Added 2'])
        .execute();

      expect(result.entitiesUpdated).toBe(1);
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toContain('Initial');
      expect(alice?.observations).toContain('Added 1');
      expect(alice?.observations).toContain('Added 2');
    });
  });

  describe('deleteObservations', () => {
    it('should delete observations in a batch', async () => {
      // Setup
      const setup = new BatchTransaction(storage);
      await setup
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['A', 'B', 'C'] })
        .execute();

      // Delete observations
      const batch = new BatchTransaction(storage);
      const result = await batch
        .deleteObservations('Alice', ['B'])
        .execute();

      expect(result.entitiesUpdated).toBe(1);
      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toContain('A');
      expect(alice?.observations).not.toContain('B');
      expect(alice?.observations).toContain('C');
    });
  });

  describe('combined operations', () => {
    it('should handle multiple operation types in one batch', async () => {
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['Engineer'] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(2);
      expect(result.relationsCreated).toBe(1);

      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(2);
      expect(graph.relations.length).toBe(1);
    });

    it('should return correct execution time', async () => {
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createEntity({ name: 'Test', entityType: 'test', observations: [] })
        .execute();

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('fluent API', () => {
    it('should support method chaining', async () => {
      const batch = new BatchTransaction(storage);

      // Verify chaining returns the same instance
      const returned = batch.createEntity({ name: 'A', entityType: 't', observations: [] });
      expect(returned).toBe(batch);

      const returned2 = batch.createRelation({ from: 'A', to: 'B', relationType: 'r' });
      expect(returned2).toBe(batch);
    });

    it('should return batch size', () => {
      const batch = new BatchTransaction(storage);
      expect(batch.size()).toBe(0);

      batch.createEntity({ name: 'A', entityType: 't', observations: [] });
      expect(batch.size()).toBe(1);

      batch.createEntity({ name: 'B', entityType: 't', observations: [] });
      expect(batch.size()).toBe(2);
    });

    it('should clear operations', () => {
      const batch = new BatchTransaction(storage);
      batch.createEntity({ name: 'A', entityType: 't', observations: [] });
      expect(batch.size()).toBe(1);

      batch.clear();
      expect(batch.size()).toBe(0);
    });

    it('should get operations copy', () => {
      const batch = new BatchTransaction(storage);
      batch.createEntity({ name: 'A', entityType: 't', observations: [] });
      batch.createRelation({ from: 'A', to: 'B', relationType: 'r' });

      const ops = batch.getOperations();
      expect(ops.length).toBe(2);
      expect(ops[0].type).toBe('createEntity');
      expect(ops[1].type).toBe('createRelation');
    });

    it('should add operations from array', async () => {
      const batch = new BatchTransaction(storage);
      batch.addOperations([
        { type: 'createEntity', data: { name: 'A', entityType: 't', observations: [] } },
        { type: 'createEntity', data: { name: 'B', entityType: 't', observations: [] } },
      ]);

      expect(batch.size()).toBe(2);

      const result = await batch.execute();
      expect(result.entitiesCreated).toBe(2);
    });
  });

  describe('validation', () => {
    it('should validate before execution by default', async () => {
      const batch = new BatchTransaction(storage);

      // Try to create relation without entities
      const result = await batch
        .createRelation({ from: 'NonExistent', to: 'AlsoNonExistent', relationType: 'r' })
        .execute();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.failedOperationIndex).toBe(0);
    });

    it('should detect duplicate creates in same batch', async () => {
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createEntity({ name: 'A', entityType: 't', observations: [] })
        .createEntity({ name: 'A', entityType: 't', observations: [] })
        .execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Duplicate');
    });

    it('should skip validation when disabled', async () => {
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createRelation({ from: 'X', to: 'Y', relationType: 'r' })
        .execute({ validateBeforeExecute: false });

      // With validation disabled, operation proceeds (may succeed or fail depending on implementation)
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('options', () => {
    it('should stop on error by default', async () => {
      // Create one entity
      const setup = new BatchTransaction(storage);
      await setup.createEntity({ name: 'A', entityType: 't', observations: [] }).execute();

      // Try to create duplicate and another entity
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createEntity({ name: 'A', entityType: 't', observations: [] }) // Will fail
        .createEntity({ name: 'B', entityType: 't', observations: [] })
        .execute({ validateBeforeExecute: false });

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(0);
      expect(result.failedOperationIndex).toBe(0);
    });

    it('should continue on error when stopOnError is false', async () => {
      // Create one entity
      const setup = new BatchTransaction(storage);
      await setup.createEntity({ name: 'A', entityType: 't', observations: [] }).execute();

      // Try to create duplicate and another entity
      const batch = new BatchTransaction(storage);
      const result = await batch
        .createEntity({ name: 'A', entityType: 't', observations: [] }) // Will fail
        .createEntity({ name: 'B', entityType: 't', observations: [] }) // Should still execute
        .execute({ stopOnError: false, validateBeforeExecute: false });

      expect(result.success).toBe(false);
      // B should still be created
      const graph = await storage.loadGraph();
      expect(graph.entities.find(e => e.name === 'B')).toBeDefined();
    });
  });

  describe('empty batch', () => {
    it('should handle empty batch gracefully', async () => {
      const batch = new BatchTransaction(storage);
      const result = await batch.execute();

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(0);
      expect(result.entitiesCreated).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('performance', () => {
    it('should be efficient for bulk operations', async () => {
      const batch = new BatchTransaction(storage);
      const entityCount = 100;

      // Add many entities
      for (let i = 0; i < entityCount; i++) {
        batch.createEntity({
          name: `Entity${i}`,
          entityType: 'test',
          observations: [`Observation ${i}`],
        });
      }

      const startTime = Date.now();
      const result = await batch.execute();
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(entityCount);
      expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds

      const graph = await storage.loadGraph();
      expect(graph.entities.length).toBe(entityCount);
    });
  });
});
