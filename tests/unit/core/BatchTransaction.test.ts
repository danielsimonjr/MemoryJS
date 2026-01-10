/**
 * BatchTransaction Unit Tests
 *
 * Phase 10 Sprint 1: Tests for the BatchTransaction fluent API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { BatchTransaction } from '../../../src/core/TransactionManager.js';
import type { BatchOperation, BatchResult } from '../../../src/types/types.js';

describe('BatchTransaction', () => {
  let tempDir: string;
  let storage: GraphStorage;
  let batch: BatchTransaction;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-tx-test-'));
    const memoryFile = path.join(tempDir, 'memory.jsonl');
    storage = new GraphStorage(memoryFile);
    batch = new BatchTransaction(storage);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      const result = batch
        .createEntity({ name: 'A', entityType: 'test', observations: [] })
        .createEntity({ name: 'B', entityType: 'test', observations: [] })
        .createRelation({ from: 'A', to: 'B', relationType: 'knows' })
        .updateEntity('A', { importance: 5 });

      expect(result).toBe(batch);
      expect(batch.size()).toBe(4);
    });

    it('should track operation count', () => {
      expect(batch.size()).toBe(0);

      batch.createEntity({ name: 'Test', entityType: 'test', observations: [] });
      expect(batch.size()).toBe(1);

      batch.deleteEntity('Test');
      expect(batch.size()).toBe(2);
    });

    it('should clear operations', () => {
      batch.createEntity({ name: 'Test', entityType: 'test', observations: [] });
      expect(batch.size()).toBe(1);

      batch.clear();
      expect(batch.size()).toBe(0);
    });

    it('should return copy of operations', () => {
      batch.createEntity({ name: 'Test', entityType: 'test', observations: [] });

      const ops = batch.getOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('createEntity');

      // Modifying returned array shouldn't affect batch
      ops.push({ type: 'deleteEntity', data: { name: 'Fake' } });
      expect(batch.size()).toBe(1);
    });
  });

  describe('Entity Operations', () => {
    it('should create entities', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: ['Developer'] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: ['Designer'] })
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(2);
      expect(result.operationsExecuted).toBe(2);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(2);
      expect(graph.entities.find(e => e.name === 'Alice')).toBeDefined();
      expect(graph.entities.find(e => e.name === 'Bob')).toBeDefined();
    });

    it('should update entities', async () => {
      // First create an entity
      await batch.createEntity({ name: 'Alice', entityType: 'person', observations: [] }).execute();

      // Now update it
      batch.clear();
      const result = await batch.updateEntity('Alice', { importance: 8 }).execute();

      expect(result.success).toBe(true);
      expect(result.entitiesUpdated).toBe(1);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.importance).toBe(8);
    });

    it('should delete entities and their relations', async () => {
      // Setup
      await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .execute();

      // Delete Alice
      batch.clear();
      const result = await batch.deleteEntity('Alice').execute();

      expect(result.success).toBe(true);
      expect(result.entitiesDeleted).toBe(1);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.relations).toHaveLength(0); // Relation should be deleted too
    });
  });

  describe('Relation Operations', () => {
    beforeEach(async () => {
      await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .execute();
      batch.clear();
    });

    it('should create relations', async () => {
      const result = await batch
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .createRelation({ from: 'Bob', to: 'Alice', relationType: 'knows' })
        .execute();

      expect(result.success).toBe(true);
      expect(result.relationsCreated).toBe(2);

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(2);
    });

    it('should delete relations', async () => {
      await batch.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' }).execute();
      batch.clear();

      const result = await batch.deleteRelation('Alice', 'Bob', 'knows').execute();

      expect(result.success).toBe(true);
      expect(result.relationsDeleted).toBe(1);

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(0);
    });
  });

  describe('Observation Operations', () => {
    beforeEach(async () => {
      await batch.createEntity({ name: 'Alice', entityType: 'person', observations: ['Initial'] }).execute();
      batch.clear();
    });

    it('should add observations', async () => {
      const result = await batch.addObservations('Alice', ['New fact 1', 'New fact 2']).execute();

      expect(result.success).toBe(true);
      expect(result.entitiesUpdated).toBe(1);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toContain('Initial');
      expect(alice?.observations).toContain('New fact 1');
      expect(alice?.observations).toContain('New fact 2');
    });

    it('should not duplicate existing observations', async () => {
      const result = await batch.addObservations('Alice', ['Initial', 'New fact']).execute();

      expect(result.success).toBe(true);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toHaveLength(2); // Initial + New fact
    });

    it('should delete observations', async () => {
      await batch.addObservations('Alice', ['Fact 1', 'Fact 2']).execute();
      batch.clear();

      const result = await batch.deleteObservations('Alice', ['Initial', 'Fact 1']).execute();

      expect(result.success).toBe(true);

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.observations).toEqual(['Fact 2']);
    });
  });

  describe('Validation', () => {
    it('should fail when creating duplicate entity', async () => {
      await batch.createEntity({ name: 'Alice', entityType: 'person', observations: [] }).execute();
      batch.clear();

      const result = await batch.createEntity({ name: 'Alice', entityType: 'person', observations: [] }).execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
      expect(result.failedOperationIndex).toBe(0);
    });

    it('should fail when updating non-existent entity', async () => {
      const result = await batch.updateEntity('NonExistent', { importance: 5 }).execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when deleting non-existent entity', async () => {
      const result = await batch.deleteEntity('NonExistent').execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when creating relation with missing source', async () => {
      await batch.createEntity({ name: 'Bob', entityType: 'person', observations: [] }).execute();
      batch.clear();

      const result = await batch.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' }).execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Source entity');
    });

    it('should fail when creating relation with missing target', async () => {
      await batch.createEntity({ name: 'Alice', entityType: 'person', observations: [] }).execute();
      batch.clear();

      const result = await batch.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' }).execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Target entity');
    });

    it('should detect duplicate creates in same batch', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .execute();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Duplicate create');
      expect(result.failedOperationIndex).toBe(1);
    });
  });

  describe('Complex Workflows', () => {
    it('should handle create -> update in same batch', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .updateEntity('Alice', { importance: 8 })
        .addObservations('Alice', ['Developer'])
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(1);
      expect(result.entitiesUpdated).toBe(2); // update + addObservations

      const graph = await storage.loadGraph();
      const alice = graph.entities.find(e => e.name === 'Alice');
      expect(alice?.importance).toBe(8);
      expect(alice?.observations).toContain('Developer');
    });

    it('should handle create -> delete in same batch', async () => {
      const result = await batch
        .createEntity({ name: 'Temp', entityType: 'temp', observations: [] })
        .deleteEntity('Temp')
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(1);
      expect(result.entitiesDeleted).toBe(1);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(0);
    });

    it('should handle create entities then create relations', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .createEntity({ name: 'Charlie', entityType: 'person', observations: [] })
        .createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' })
        .createRelation({ from: 'Bob', to: 'Charlie', relationType: 'knows' })
        .execute();

      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(3);
      expect(result.relationsCreated).toBe(2);
    });
  });

  describe('Batch Options', () => {
    it('should stop on first error by default (with validation disabled)', async () => {
      // Need to disable pre-validation to test execution-time error handling
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .updateEntity('NonExistent', { importance: 5 })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .execute({ validateBeforeExecute: false });

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(1); // Only Alice was created
      expect(result.failedOperationIndex).toBe(1);

      // Graph should NOT be saved when stopOnError is true (default)
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(0);
    });

    it('should continue on error when stopOnError is false', async () => {
      // Need to disable pre-validation to test execution-time error handling
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .updateEntity('NonExistent', { importance: 5 })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .execute({ stopOnError: false, validateBeforeExecute: false });

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(2); // Alice and Bob created

      // Graph IS saved when stopOnError is false
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(2);
    });

    it('should fail early with validation when validateBeforeExecute is true', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .updateEntity('NonExistent', { importance: 5 })
        .createEntity({ name: 'Bob', entityType: 'person', observations: [] })
        .execute({ validateBeforeExecute: true }); // Default, but explicit

      expect(result.success).toBe(false);
      expect(result.operationsExecuted).toBe(0); // No operations executed due to validation failure
      expect(result.failedOperationIndex).toBe(1);
      expect(result.error).toContain('not found');

      // Graph should NOT be modified
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(0);
    });

    it('should skip validation when validateBeforeExecute is false', async () => {
      // This creates a scenario where validation would catch an error
      // but we skip validation and let execution handle it
      await batch.createEntity({ name: 'Alice', entityType: 'person', observations: [] }).execute();
      batch.clear();

      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .execute({ validateBeforeExecute: false });

      // Validation didn't run, but execution still fails
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('addOperations', () => {
    it('should add multiple operations at once', async () => {
      const operations: BatchOperation[] = [
        { type: 'createEntity', data: { name: 'A', entityType: 'test', observations: [] } },
        { type: 'createEntity', data: { name: 'B', entityType: 'test', observations: [] } },
        { type: 'createRelation', data: { from: 'A', to: 'B', relationType: 'linked' } },
      ];

      batch.addOperations(operations);
      expect(batch.size()).toBe(3);

      const result = await batch.execute();
      expect(result.success).toBe(true);
      expect(result.entitiesCreated).toBe(2);
      expect(result.relationsCreated).toBe(1);
    });
  });

  describe('Empty Batch', () => {
    it('should handle empty batch gracefully', async () => {
      const result = await batch.execute();

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Execution Time Tracking', () => {
    it('should track execution time', async () => {
      const result = await batch
        .createEntity({ name: 'Alice', entityType: 'person', observations: [] })
        .execute();

      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTimeMs).toBe('number');
    });
  });

  describe('GraphStorage.transaction() factory', () => {
    it('should create BatchTransaction via storage.transaction()', async () => {
      const tx = storage.transaction();
      expect(tx).toBeInstanceOf(BatchTransaction);

      const result = await tx
        .createEntity({ name: 'Test', entityType: 'test', observations: [] })
        .execute();

      expect(result.success).toBe(true);
    });
  });
});
