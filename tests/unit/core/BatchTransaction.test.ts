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
import type { BatchOperation, BatchResult, KnowledgeGraph } from '../../../src/types/types.js';

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

describe('BatchTransaction operation pins', () => {
  const TS = '2026-01-01T00:00:00.000Z';

  function applyOp(graph: KnowledgeGraph, operation: BatchOperation, result: BatchResult): void {
    const batch = new BatchTransaction(new GraphStorage(path.join(os.tmpdir(), 'pin-unused.jsonl')));
    (batch as unknown as {
      applyBatchOperation(g: KnowledgeGraph, o: BatchOperation, ts: string, r: BatchResult): void;
    }).applyBatchOperation(graph, operation, TS, result);
  }

  function emptyResult(): BatchResult {
    return {
      success: true,
      operationsExecuted: 0,
      entitiesCreated: 0,
      entitiesUpdated: 0,
      entitiesDeleted: 0,
      relationsCreated: 0,
      relationsDeleted: 0,
      executionTimeMs: 0,
    };
  }

  function baseGraph(): KnowledgeGraph {
    return {
      entities: [
        { name: 'a', entityType: 'node', observations: ['x'] },
        { name: 'b', entityType: 'node', observations: [] },
      ],
      relations: [{ from: 'a', to: 'b', relationType: 'knows' }],
    };
  }

  function errorOf(action: () => void): { code: string; message: string } {
    try {
      action();
    } catch (error) {
      const failure = error as { code: string; message: string };
      return { code: failure.code, message: failure.message };
    }
    throw new Error('expected the operation to throw');
  }

  it('createEntity adds the entity and counts it', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'createEntity', data: { name: 'c', entityType: 'node', observations: ['y'] } }, result);
    expect(graph.entities[2]).toEqual({ name: 'c', entityType: 'node', observations: ['y'], createdAt: TS, lastModified: TS });
    expect(result).toEqual({ ...emptyResult(), entitiesCreated: 1 });
  });

  it('updateEntity merges the updates and counts an update', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'updateEntity', data: { name: 'a', updates: { entityType: 'topic' } } }, result);
    expect(graph.entities[0]).toEqual({ name: 'a', entityType: 'topic', observations: ['x'], lastModified: TS });
    expect(result).toEqual({ ...emptyResult(), entitiesUpdated: 1 });
  });

  it('deleteEntity removes the entity with its relations and counts it', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'deleteEntity', data: { name: 'a' } }, result);
    expect(graph).toEqual({ entities: [{ name: 'b', entityType: 'node', observations: [] }], relations: [] });
    expect(result).toEqual({ ...emptyResult(), entitiesDeleted: 1 });
  });

  it('createRelation adds the relation and counts it', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'createRelation', data: { from: 'b', to: 'a', relationType: 'knows' } }, result);
    expect(graph.relations[1]).toEqual({ from: 'b', to: 'a', relationType: 'knows', createdAt: TS, lastModified: TS });
    expect(result).toEqual({ ...emptyResult(), relationsCreated: 1 });
  });

  it('deleteRelation removes the relation and counts it', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'deleteRelation', data: { from: 'a', to: 'b', relationType: 'knows' } }, result);
    expect(graph.relations).toEqual([]);
    expect(result).toEqual({ ...emptyResult(), relationsDeleted: 1 });
  });

  it('addObservations appends only the new observations and counts an update', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'addObservations', data: { name: 'a', observations: ['x', 'z'] } }, result);
    expect(graph.entities[0]).toEqual({ name: 'a', entityType: 'node', observations: ['x', 'z'], lastModified: TS });
    expect(result).toEqual({ ...emptyResult(), entitiesUpdated: 1 });
  });

  it('deleteObservations removes the listed observations and counts an update', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'deleteObservations', data: { name: 'a', observations: ['x'] } }, result);
    expect(graph.entities[0]).toEqual({ name: 'a', entityType: 'node', observations: [], lastModified: TS });
    expect(result).toEqual({ ...emptyResult(), entitiesUpdated: 1 });
  });

  it('createRelation accepts a different type or target and rejects an exact copy', () => {
    const graph = baseGraph();
    const result = emptyResult();
    applyOp(graph, { type: 'createRelation', data: { from: 'a', to: 'b', relationType: 'likes' } }, result);
    applyOp(graph, { type: 'createRelation', data: { from: 'a', to: 'a', relationType: 'knows' } }, result);
    expect(graph.relations.map(r => `${r.from}>${r.to}:${r.relationType}`)).toEqual([
      'a>b:knows',
      'a>b:likes',
      'a>a:knows',
    ]);
    expect(result).toEqual({ ...emptyResult(), relationsCreated: 2 });

    const copy: BatchOperation = { type: 'createRelation', data: { from: 'a', to: 'a', relationType: 'knows' } };
    expect(errorOf(() => applyOp(graph, copy, result)).code).toBe('DUPLICATE_RELATION');
    expect(graph.relations).toHaveLength(3);
  });

  it('updateEntity drops the keys that would change the prototype', () => {
    const graph = baseGraph();
    const updates = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"x":1},"entityType":"topic"}');
    applyOp(graph, { type: 'updateEntity', data: { name: 'a', updates } }, emptyResult());
    const entity = graph.entities[0]!;
    expect(Object.getPrototypeOf(entity)).toBe(Object.prototype);
    expect(entity).toEqual({ name: 'a', entityType: 'topic', observations: ['x'], lastModified: TS });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reports the error code and message of each failing operation and counts nothing', () => {
    const failures: Array<[BatchOperation, { code: string; message: string }]> = [
      [
        { type: 'createEntity', data: { name: 'a', entityType: 'node', observations: [] } },
        { code: 'DUPLICATE_ENTITY', message: 'Entity "a" already exists' },
      ],
      [
        { type: 'updateEntity', data: { name: 'zz', updates: {} } },
        { code: 'ENTITY_NOT_FOUND', message: 'Entity "zz" not found' },
      ],
      [
        { type: 'deleteEntity', data: { name: 'zz' } },
        { code: 'ENTITY_NOT_FOUND', message: 'Entity "zz" not found' },
      ],
      [
        { type: 'createRelation', data: { from: 'a', to: 'b', relationType: 'knows' } },
        { code: 'DUPLICATE_RELATION', message: 'Relation "a" -> "b" (knows) already exists' },
      ],
      [
        { type: 'deleteRelation', data: { from: 'b', to: 'a', relationType: 'knows' } },
        { code: 'RELATION_NOT_FOUND', message: 'Relation "b" -> "a" (knows) not found' },
      ],
      [
        { type: 'addObservations', data: { name: 'zz', observations: ['q'] } },
        { code: 'ENTITY_NOT_FOUND', message: 'Entity "zz" not found' },
      ],
      [
        { type: 'deleteObservations', data: { name: 'zz', observations: ['q'] } },
        { code: 'ENTITY_NOT_FOUND', message: 'Entity "zz" not found' },
      ],
    ];
    for (const [op, expected] of failures) {
      const result = emptyResult();
      expect(errorOf(() => applyOp(baseGraph(), op, result))).toEqual(expected);
      expect(result).toEqual(emptyResult());
    }
  });

  it('applies a mixed batch of seven operations to the final graph and counts them', () => {
    const graph = baseGraph();
    const result = emptyResult();
    const ops: BatchOperation[] = [
      { type: 'createEntity', data: { name: 'c', entityType: 'node', observations: [] } },
      { type: 'updateEntity', data: { name: 'a', updates: { entityType: 'topic' } } },
      { type: 'addObservations', data: { name: 'a', observations: ['z'] } },
      { type: 'deleteObservations', data: { name: 'a', observations: ['x'] } },
      { type: 'createRelation', data: { from: 'b', to: 'c', relationType: 'links' } },
      { type: 'deleteRelation', data: { from: 'a', to: 'b', relationType: 'knows' } },
      { type: 'deleteEntity', data: { name: 'c' } },
    ];
    for (const op of ops) applyOp(graph, op, result);
    expect(graph).toEqual({
      entities: [
        { name: 'a', entityType: 'topic', observations: ['z'], lastModified: TS },
        { name: 'b', entityType: 'node', observations: [] },
      ],
      relations: [],
    });
    expect(result).toEqual({
      success: true,
      operationsExecuted: 0,
      entitiesCreated: 1,
      entitiesUpdated: 3,
      entitiesDeleted: 1,
      relationsCreated: 1,
      relationsDeleted: 1,
      executionTimeMs: 0,
    });
  });

  it('reads operation.type once and operation.data once for every operation type', () => {
    const data: Array<[string, unknown]> = [
      ['createEntity', { name: 'c', entityType: 'node', observations: [] }],
      ['updateEntity', { name: 'a', updates: { entityType: 'topic' } }],
      ['deleteEntity', { name: 'b' }],
      ['createRelation', { from: 'b', to: 'a', relationType: 'new' }],
      ['deleteRelation', { from: 'a', to: 'b', relationType: 'knows' }],
      ['addObservations', { name: 'a', observations: ['z'] }],
      ['deleteObservations', { name: 'a', observations: ['x'] }],
    ];
    const reads: Array<{ type: string; typeReads: number; dataReads: number }> = [];
    for (const [type, payload] of data) {
      let typeReads = 0;
      let dataReads = 0;
      const operation = {
        get type() {
          typeReads++;
          return type;
        },
        get data() {
          dataReads++;
          return payload;
        },
      } as unknown as BatchOperation;
      applyOp(baseGraph(), operation, emptyResult());
      reads.push({ type, typeReads, dataReads });
    }
    expect(reads).toEqual(data.map(([type]) => ({ type, typeReads: 1, dataReads: 1 })));
  });

  it('names the operation data in the error when the data of a graph operation is missing', () => {
    const messages = (['updateEntity', 'deleteEntity', 'deleteRelation'] as const).map(type => {
      const operation = { type, data: undefined } as unknown as BatchOperation;
      return errorOf(() => applyOp(baseGraph(), operation, emptyResult())).message;
    });
    expect(messages).toEqual([
      "Cannot destructure property 'name' of 'operation.data' as it is undefined.",
      "Cannot destructure property 'name' of 'operation.data' as it is undefined.",
      "Cannot destructure property 'from' of 'operation.data' as it is undefined.",
    ]);
  });
});
