/**
 * TransactionManager Unit Tests
 *
 * Tests for atomic transaction support, batch operations, and rollback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TransactionManager, OperationType } from '../../../src/core/TransactionManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { KnowledgeGraphError } from '../../../src/utils/errors.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TransactionManager', () => {
  let storage: GraphStorage;
  let txManager: TransactionManager;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tx-manager-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    storage = new GraphStorage(testFilePath);
    txManager = new TransactionManager(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Transaction Lifecycle', () => {
    describe('begin', () => {
      it('should begin a new transaction', () => {
        expect(txManager.isInTransaction()).toBe(false);
        txManager.begin();
        expect(txManager.isInTransaction()).toBe(true);
      });

      it('should throw error if transaction already in progress', () => {
        txManager.begin();
        expect(() => txManager.begin()).toThrow(KnowledgeGraphError);
        expect(() => txManager.begin()).toThrow('Transaction already in progress');
      });

      it('should reset operations when beginning new transaction', () => {
        txManager.begin();
        txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        expect(txManager.getOperationCount()).toBe(1);

        // After rollback, can begin new transaction
        txManager.rollback();
        txManager.begin();
        expect(txManager.getOperationCount()).toBe(0);
      });
    });

    describe('commit', () => {
      it('should commit transaction with single entity', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });

        const result = await txManager.commit();

        expect(result.success).toBe(true);
        expect(result.operationsExecuted).toBe(1);
        expect(txManager.isInTransaction()).toBe(false);
      });

      it('should commit transaction with multiple operations', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });

        const result = await txManager.commit();

        expect(result.success).toBe(true);
        expect(result.operationsExecuted).toBe(3);
      });

      it('should persist data after commit', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: ['Test'] });
        await txManager.commit();

        // Verify data is persisted
        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(1);
        expect(graph.entities[0].name).toBe('Alice');
      });

      it('should throw error if no transaction in progress', async () => {
        await expect(txManager.commit()).rejects.toThrow('No transaction in progress');
      });

      it('should clear operations after successful commit', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        await txManager.commit();

        expect(txManager.getOperationCount()).toBe(0);
      });
    });

    describe('rollback', () => {
      it('should discard staged operations on rollback', async () => {
        // Create initial data
        txManager.begin();
        txManager.createEntity({ name: 'Initial', entityType: 'test', observations: [] });
        await txManager.commit();

        // Begin new transaction and stage operations
        txManager.begin();
        txManager.createEntity({ name: 'ShouldNotExist', entityType: 'test', observations: [] });
        expect(txManager.getOperationCount()).toBe(1);

        // Rollback before commit (no backup exists yet, so success=false but state is cleared)
        await txManager.rollback();

        // Verify transaction state cleared
        expect(txManager.isInTransaction()).toBe(false);
        expect(txManager.getOperationCount()).toBe(0);

        // Since no commit happened, the staged entity was never written
        const graph = await storage.loadGraph();
        expect(graph.entities.map(e => e.name)).not.toContain('ShouldNotExist');
      });

      it('should restore original state after failed commit', async () => {
        // Create initial data
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await txManager.commit();

        // Begin transaction that will fail
        txManager.begin();
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] }); // Duplicate - will fail

        const result = await txManager.commit();

        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');

        // Verify original state preserved
        const graph = await storage.loadGraph();
        expect(graph.entities).toHaveLength(1);
        expect(graph.entities[0].name).toBe('Alice');
      });

      it('should return success false if no backup exists', async () => {
        txManager.begin();
        // Rollback immediately before any backup was created
        const result = await txManager.rollback();
        expect(result.success).toBe(false);
      });

      it('should clear transaction state after rollback', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        await txManager.rollback();

        expect(txManager.isInTransaction()).toBe(false);
        expect(txManager.getOperationCount()).toBe(0);
      });
    });
  });

  describe('Entity Operations', () => {
    describe('createEntity', () => {
      it('should stage create entity operation', () => {
        txManager.begin();
        txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        expect(txManager.getOperationCount()).toBe(1);
      });

      it('should add timestamps on commit', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await txManager.commit();

        const graph = await storage.loadGraph();
        expect(graph.entities[0].createdAt).toBeDefined();
        expect(graph.entities[0].lastModified).toBeDefined();
      });

      it('should throw error for duplicate entity names', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });

        const result = await txManager.commit();
        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');
      });

      it('should throw error if not in transaction', () => {
        expect(() => {
          txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        }).toThrow('No transaction in progress');
      });
    });

    describe('updateEntity', () => {
      it('should stage update entity operation', async () => {
        // Create entity first
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await txManager.commit();

        // Update in new transaction
        txManager.begin();
        txManager.updateEntity('Alice', { importance: 8 });
        expect(txManager.getOperationCount()).toBe(1);
      });

      it('should update entity properties', async () => {
        // Create entity
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: ['Initial'] });
        await txManager.commit();

        // Update entity
        txManager.begin();
        txManager.updateEntity('Alice', { importance: 9 });
        await txManager.commit();

        const graph = await storage.loadGraph();
        expect(graph.entities[0].importance).toBe(9);
      });

      it('should fail for non-existent entity', async () => {
        txManager.begin();
        txManager.updateEntity('NonExistent', { importance: 5 });

        const result = await txManager.commit();
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });

      it('should update lastModified timestamp', async () => {
        // Create entity
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        await txManager.commit();

        const graph1 = await storage.loadGraph();
        const originalModified = graph1.entities[0].lastModified;

        // Wait a bit to ensure timestamp difference
        await new Promise(r => setTimeout(r, 10));

        // Update entity
        txManager.begin();
        txManager.updateEntity('Alice', { importance: 5 });
        await txManager.commit();

        const graph2 = await storage.loadGraph();
        expect(graph2.entities[0].lastModified).not.toBe(originalModified);
      });
    });

    describe('deleteEntity', () => {
      it('should stage delete entity operation', () => {
        txManager.begin();
        txManager.deleteEntity('SomeEntity');
        expect(txManager.getOperationCount()).toBe(1);
      });

      it('should delete entity and its relations', async () => {
        // Create entities and relations
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
        await txManager.commit();

        // Delete entity
        txManager.begin();
        txManager.deleteEntity('Alice');
        await txManager.commit();

        const graph = await storage.loadGraph();
        expect(graph.entities.map(e => e.name)).not.toContain('Alice');
        expect(graph.relations).toHaveLength(0); // Relation should be deleted too
      });

      it('should fail for non-existent entity', async () => {
        txManager.begin();
        txManager.deleteEntity('NonExistent');

        const result = await txManager.commit();
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });
  });

  describe('Relation Operations', () => {
    describe('createRelation', () => {
      it('should stage create relation operation', () => {
        txManager.begin();
        txManager.createRelation({ from: 'A', to: 'B', relationType: 'knows' });
        expect(txManager.getOperationCount()).toBe(1);
      });

      it('should create relation with timestamps', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
        await txManager.commit();

        const graph = await storage.loadGraph();
        expect(graph.relations).toHaveLength(1);
        expect(graph.relations[0].createdAt).toBeDefined();
        expect(graph.relations[0].lastModified).toBeDefined();
      });

      it('should fail for duplicate relation', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });

        const result = await txManager.commit();
        expect(result.success).toBe(false);
        expect(result.error).toContain('already exists');
      });
    });

    describe('deleteRelation', () => {
      it('should stage delete relation operation', () => {
        txManager.begin();
        txManager.deleteRelation('A', 'B', 'knows');
        expect(txManager.getOperationCount()).toBe(1);
      });

      it('should delete existing relation', async () => {
        // Create entities and relation
        txManager.begin();
        txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
        txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
        txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
        await txManager.commit();

        // Delete relation
        txManager.begin();
        txManager.deleteRelation('Alice', 'Bob', 'knows');
        await txManager.commit();

        const graph = await storage.loadGraph();
        expect(graph.relations).toHaveLength(0);
      });

      it('should fail for non-existent relation', async () => {
        txManager.begin();
        txManager.deleteRelation('A', 'B', 'nonexistent');

        const result = await txManager.commit();
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
      });
    });
  });

  describe('Batch Operations', () => {
    it('should execute multiple operations atomically', async () => {
      txManager.begin();
      txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      txManager.createEntity({ name: 'Bob', entityType: 'person', observations: [] });
      txManager.createEntity({ name: 'Charlie', entityType: 'person', observations: [] });
      txManager.createRelation({ from: 'Alice', to: 'Bob', relationType: 'knows' });
      txManager.createRelation({ from: 'Bob', to: 'Charlie', relationType: 'knows' });

      const result = await txManager.commit();

      expect(result.success).toBe(true);
      expect(result.operationsExecuted).toBe(5);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(3);
      expect(graph.relations).toHaveLength(2);
    });

    it('should rollback all operations if one fails', async () => {
      // Create initial entity
      txManager.begin();
      txManager.createEntity({ name: 'Initial', entityType: 'test', observations: [] });
      await txManager.commit();

      // Try batch with failure in the middle
      txManager.begin();
      txManager.createEntity({ name: 'Valid1', entityType: 'test', observations: [] });
      txManager.createEntity({ name: 'Initial', entityType: 'test', observations: [] }); // Duplicate - fail
      txManager.createEntity({ name: 'Valid2', entityType: 'test', observations: [] });

      const result = await txManager.commit();

      expect(result.success).toBe(false);

      // All changes should be rolled back
      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].name).toBe('Initial');
    });

    it('should maintain operation order', async () => {
      txManager.begin();
      txManager.createEntity({ name: 'Alice', entityType: 'person', observations: [] });
      txManager.updateEntity('Alice', { importance: 5 });
      txManager.updateEntity('Alice', { importance: 10 });

      await txManager.commit();

      const graph = await storage.loadGraph();
      expect(graph.entities[0].importance).toBe(10);
    });
  });

  describe('Helper Methods', () => {
    describe('isInTransaction', () => {
      it('should return false when no transaction active', () => {
        expect(txManager.isInTransaction()).toBe(false);
      });

      it('should return true when transaction active', () => {
        txManager.begin();
        expect(txManager.isInTransaction()).toBe(true);
      });

      it('should return false after commit', async () => {
        txManager.begin();
        await txManager.commit();
        expect(txManager.isInTransaction()).toBe(false);
      });

      it('should return false after rollback', async () => {
        txManager.begin();
        await txManager.rollback();
        expect(txManager.isInTransaction()).toBe(false);
      });
    });

    describe('getOperationCount', () => {
      it('should return 0 when no operations staged', () => {
        txManager.begin();
        expect(txManager.getOperationCount()).toBe(0);
      });

      it('should count staged operations correctly', () => {
        txManager.begin();
        txManager.createEntity({ name: 'A', entityType: 'test', observations: [] });
        expect(txManager.getOperationCount()).toBe(1);

        txManager.createEntity({ name: 'B', entityType: 'test', observations: [] });
        expect(txManager.getOperationCount()).toBe(2);

        txManager.deleteEntity('A');
        expect(txManager.getOperationCount()).toBe(3);
      });

      it('should reset after commit', async () => {
        txManager.begin();
        txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
        await txManager.commit();
        expect(txManager.getOperationCount()).toBe(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should include error message in failed result', async () => {
      txManager.begin();
      txManager.deleteEntity('NonExistent');

      const result = await txManager.commit();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
    });

    it('should handle commit errors gracefully', async () => {
      txManager.begin();
      txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
      txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] }); // Duplicate

      // Should not throw, should return failure result
      const result = await txManager.commit();
      expect(result.success).toBe(false);
    });

    it('should allow new transaction after failed commit', async () => {
      txManager.begin();
      txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
      txManager.createEntity({ name: 'Test', entityType: 'test', observations: [] });
      await txManager.commit(); // This fails

      // Should be able to start new transaction
      expect(txManager.isInTransaction()).toBe(false);
      txManager.begin();
      expect(txManager.isInTransaction()).toBe(true);
    });
  });

  describe('OperationType enum', () => {
    it('should have all expected operation types', () => {
      expect(OperationType.CREATE_ENTITY).toBe('CREATE_ENTITY');
      expect(OperationType.UPDATE_ENTITY).toBe('UPDATE_ENTITY');
      expect(OperationType.DELETE_ENTITY).toBe('DELETE_ENTITY');
      expect(OperationType.CREATE_RELATION).toBe('CREATE_RELATION');
      expect(OperationType.DELETE_RELATION).toBe('DELETE_RELATION');
    });
  });
});
