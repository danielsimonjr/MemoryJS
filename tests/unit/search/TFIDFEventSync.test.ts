/**
 * TFIDFEventSync Unit Tests
 *
 * Tests for TF-IDF index synchronization with graph events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TFIDFEventSync } from '../../../src/search/TFIDFEventSync.js';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type { Entity, KnowledgeGraph } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TFIDFEventSync', () => {
  let sync: TFIDFEventSync;
  let indexManager: TFIDFIndexManager;
  let eventEmitter: GraphEventEmitter;
  let storage: GraphStorage;
  let testDir: string;
  let testFilePath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tfidf-sync-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'test-graph.jsonl');

    // Create storage, event emitter, and index manager
    storage = new GraphStorage(testFilePath);
    eventEmitter = new GraphEventEmitter();
    indexManager = new TFIDFIndexManager(testDir);

    // Build initial index
    const graph: KnowledgeGraph = {
      entities: [
        { name: 'Alice', entityType: 'person', observations: ['Developer'] },
        { name: 'Bob', entityType: 'person', observations: ['Designer'] },
      ],
      relations: [],
    };
    await indexManager.buildIndex(graph);

    // coalesceMs: 0 forces synchronous emit→apply (default 50 ms window
    // would defer assertions past the test body).
    sync = new TFIDFEventSync(indexManager, eventEmitter, storage, { coalesceMs: 0 });
  });

  afterEach(async () => {
    sync.disable();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create instance with provided dependencies', () => {
      expect(sync).toBeDefined();
      expect(sync.isEnabled()).toBe(false);
    });
  });

  describe('enable', () => {
    it('should enable synchronization', () => {
      sync.enable();
      expect(sync.isEnabled()).toBe(true);
    });

    it('should be idempotent when called multiple times', () => {
      sync.enable();
      sync.enable();
      expect(sync.isEnabled()).toBe(true);
    });

    it('should subscribe to entity:created events', () => {
      const initialCount = eventEmitter.listenerCount('entity:created');
      sync.enable();
      expect(eventEmitter.listenerCount('entity:created')).toBe(initialCount + 1);
    });

    it('should subscribe to entity:updated events', () => {
      const initialCount = eventEmitter.listenerCount('entity:updated');
      sync.enable();
      expect(eventEmitter.listenerCount('entity:updated')).toBe(initialCount + 1);
    });

    it('should subscribe to entity:deleted events', () => {
      const initialCount = eventEmitter.listenerCount('entity:deleted');
      sync.enable();
      expect(eventEmitter.listenerCount('entity:deleted')).toBe(initialCount + 1);
    });
  });

  describe('disable', () => {
    it('should disable synchronization', () => {
      sync.enable();
      sync.disable();
      expect(sync.isEnabled()).toBe(false);
    });

    it('should be idempotent when called multiple times', () => {
      sync.disable();
      sync.disable();
      expect(sync.isEnabled()).toBe(false);
    });

    it('should unsubscribe from all events', () => {
      sync.enable();
      const countBefore = eventEmitter.listenerCount('entity:created');
      sync.disable();
      expect(eventEmitter.listenerCount('entity:created')).toBe(countBefore - 1);
    });
  });

  describe('isEnabled', () => {
    it('should return false initially', () => {
      expect(sync.isEnabled()).toBe(false);
    });

    it('should return true after enable', () => {
      sync.enable();
      expect(sync.isEnabled()).toBe(true);
    });

    it('should return false after disable', () => {
      sync.enable();
      sync.disable();
      expect(sync.isEnabled()).toBe(false);
    });
  });

  describe('entity:created event handling', () => {
    it('should add document to index when entity is created', () => {
      sync.enable();
      const addDocumentSpy = vi.spyOn(indexManager, 'addDocument');

      const entity: Entity = {
        name: 'Charlie',
        entityType: 'person',
        observations: ['Manager'],
      };

      eventEmitter.emitEntityCreated(entity);

      expect(addDocumentSpy).toHaveBeenCalledWith({
        name: 'Charlie',
        entityType: 'person',
        observations: ['Manager'],
      });
    });

    it('should not add document when sync is disabled', () => {
      const addDocumentSpy = vi.spyOn(indexManager, 'addDocument');

      const entity: Entity = {
        name: 'Charlie',
        entityType: 'person',
        observations: ['Manager'],
      };

      eventEmitter.emitEntityCreated(entity);

      expect(addDocumentSpy).not.toHaveBeenCalled();
    });

    it('should not add document when index is not initialized', () => {
      // Create new uninitialized index manager
      const uninitializedManager = new TFIDFIndexManager(testDir);
      const uninitializedSync = new TFIDFEventSync(
        uninitializedManager,
        eventEmitter,
        storage,
        { coalesceMs: 0 },
      );

      uninitializedSync.enable();
      const addDocumentSpy = vi.spyOn(uninitializedManager, 'addDocument');

      const entity: Entity = {
        name: 'Charlie',
        entityType: 'person',
        observations: ['Manager'],
      };

      eventEmitter.emitEntityCreated(entity);

      expect(addDocumentSpy).not.toHaveBeenCalled();
      uninitializedSync.disable();
    });
  });

  describe('entity:updated event handling', () => {
    it('should update document in index when entity is updated', async () => {
      // Set up storage with entity
      const entity: Entity = {
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer', 'Team Lead'],
      };
      await storage.saveGraph({ entities: [entity], relations: [] });

      sync.enable();
      const updateDocumentSpy = vi.spyOn(indexManager, 'updateDocument');

      eventEmitter.emitEntityUpdated('Alice', { observations: ['Developer', 'Team Lead'] });

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(updateDocumentSpy).toHaveBeenCalledWith({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer', 'Team Lead'],
      });
    });

    it('should not update document when sync is disabled', async () => {
      const updateDocumentSpy = vi.spyOn(indexManager, 'updateDocument');

      eventEmitter.emitEntityUpdated('Alice', { observations: ['Updated'] });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(updateDocumentSpy).not.toHaveBeenCalled();
    });

    it('should not update document when entity not found in storage', async () => {
      await storage.saveGraph({ entities: [], relations: [] });

      sync.enable();
      const updateDocumentSpy = vi.spyOn(indexManager, 'updateDocument');

      eventEmitter.emitEntityUpdated('NonExistent', { observations: ['Updated'] });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(updateDocumentSpy).not.toHaveBeenCalled();
    });
  });

  describe('entity:deleted event handling', () => {
    it('should remove document from index when entity is deleted', () => {
      sync.enable();
      const removeDocumentSpy = vi.spyOn(indexManager, 'removeDocument');

      eventEmitter.emitEntityDeleted('Alice');

      expect(removeDocumentSpy).toHaveBeenCalledWith('Alice');
    });

    it('should not remove document when sync is disabled', () => {
      const removeDocumentSpy = vi.spyOn(indexManager, 'removeDocument');

      eventEmitter.emitEntityDeleted('Alice');

      expect(removeDocumentSpy).not.toHaveBeenCalled();
    });

    it('should not remove document when index is not initialized', () => {
      const uninitializedManager = new TFIDFIndexManager(testDir);
      const uninitializedSync = new TFIDFEventSync(
        uninitializedManager,
        eventEmitter,
        storage,
        { coalesceMs: 0 }
      );

      uninitializedSync.enable();
      const removeDocumentSpy = vi.spyOn(uninitializedManager, 'removeDocument');

      eventEmitter.emitEntityDeleted('Alice');

      expect(removeDocumentSpy).not.toHaveBeenCalled();
      uninitializedSync.disable();
    });
  });

  describe('lifecycle management', () => {
    it('should handle enable/disable cycles correctly', () => {
      // First cycle
      sync.enable();
      expect(sync.isEnabled()).toBe(true);
      sync.disable();
      expect(sync.isEnabled()).toBe(false);

      // Second cycle
      sync.enable();
      expect(sync.isEnabled()).toBe(true);

      // Verify listeners are attached
      const addDocumentSpy = vi.spyOn(indexManager, 'addDocument');
      const entity: Entity = {
        name: 'Test',
        entityType: 'test',
        observations: ['Test observation'],
      };
      eventEmitter.emitEntityCreated(entity);
      expect(addDocumentSpy).toHaveBeenCalled();
    });

    it('should clean up all subscriptions on disable', () => {
      sync.enable();

      const createdCount = eventEmitter.listenerCount('entity:created');
      const updatedCount = eventEmitter.listenerCount('entity:updated');
      const deletedCount = eventEmitter.listenerCount('entity:deleted');

      sync.disable();

      expect(eventEmitter.listenerCount('entity:created')).toBe(createdCount - 1);
      expect(eventEmitter.listenerCount('entity:updated')).toBe(updatedCount - 1);
      expect(eventEmitter.listenerCount('entity:deleted')).toBe(deletedCount - 1);
    });
  });

  describe('S5: batched IDF recalculation on flush', () => {
    type WithPrivateIdf = { recalculateAllIDF: () => void };

    it('should trigger exactly one IDF recalculation for a coalesced batch of B creates', () => {
      // Large coalesce window: ops queue up until the explicit flushNow().
      const batchedSync = new TFIDFEventSync(indexManager, eventEmitter, storage, {
        coalesceMs: 10_000,
      });
      batchedSync.enable();
      const idfSpy = vi.spyOn(indexManager as unknown as WithPrivateIdf, 'recalculateAllIDF');

      const B = 5;
      for (let i = 0; i < B; i++) {
        eventEmitter.emitEntityCreated({
          name: `Batch${i}`,
          entityType: 'person',
          observations: [`observation ${i}`],
        });
      }
      expect(idfSpy).not.toHaveBeenCalled(); // still queued

      batchedSync.flushNow();

      expect(idfSpy).toHaveBeenCalledTimes(1); // one pass for the whole batch
      expect(indexManager.getDocumentCount()).toBe(2 + B);
      batchedSync.disable();
    });

    it('should produce the same index as per-op flushes', async () => {
      const batchedSync = new TFIDFEventSync(indexManager, eventEmitter, storage, {
        coalesceMs: 10_000,
      });
      batchedSync.enable();
      for (let i = 0; i < 3; i++) {
        eventEmitter.emitEntityCreated({
          name: `Cmp${i}`,
          entityType: 'person',
          observations: [`compare observation ${i}`],
        });
      }
      eventEmitter.emitEntityDeleted('Bob');
      batchedSync.flushNow();
      batchedSync.disable();

      // Reference: a fresh index built from the equivalent final corpus.
      const reference = new TFIDFIndexManager(testDir);
      const entities = [
        { name: 'Alice', entityType: 'person', observations: ['Developer'] },
        ...Array.from({ length: 3 }, (_, i) => ({
          name: `Cmp${i}`,
          entityType: 'person',
          observations: [`compare observation ${i}`],
        })),
      ];
      const refIndex = await reference.buildIndex({ entities, relations: [] });
      const actual = indexManager.getIndex()!;
      expect([...actual.documents.keys()].sort()).toEqual(
        [...refIndex.documents.keys()].sort()
      );
      expect(actual.idf.size).toBe(refIndex.idf.size);
      for (const [term, value] of refIndex.idf) {
        expect(actual.idf.get(term)).toBe(value);
      }
    });
  });

  describe('S5: update handler uses O(1) entity lookup', () => {
    it('should use storage.getEntityByName instead of scanning loadGraph()', async () => {
      const entity: Entity = {
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer', 'Team Lead'],
      };
      await storage.saveGraph({ entities: [entity], relations: [] });

      sync.enable();
      const getByNameSpy = vi.spyOn(storage, 'getEntityByName');
      const loadGraphSpy = vi.spyOn(storage, 'loadGraph');
      const updateDocumentSpy = vi.spyOn(indexManager, 'updateDocument');

      eventEmitter.emitEntityUpdated('Alice', { observations: ['Developer', 'Team Lead'] });

      expect(getByNameSpy).toHaveBeenCalledWith('Alice');
      expect(loadGraphSpy).not.toHaveBeenCalled(); // no O(N) scan
      expect(updateDocumentSpy).toHaveBeenCalledWith({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer', 'Team Lead'],
      });
    });
  });

  describe('S5: graph:saved debounced full rebuild', () => {
    it('should reflect entities after a bare storage.saveGraph() with no per-entity events', async () => {
      // Subscribe to the STORAGE's own emitter — saveGraph emits only
      // graph:saved (no per-entity events), the exact staleness scenario.
      const storageSync = new TFIDFEventSync(indexManager, storage.events, storage, {
        coalesceMs: 0,
        rebuildDebounceMs: 10,
      });
      storageSync.enable();

      await storage.saveGraph({
        entities: [
          { name: 'Imported1', entityType: 'doc', observations: ['bulk imported one'] },
          { name: 'Imported2', entityType: 'doc', observations: ['bulk imported two'] },
        ],
        relations: [],
      });

      await storageSync.rebuildNow();

      const index = indexManager.getIndex()!;
      expect(index.documents.has('Imported1')).toBe(true);
      expect(index.documents.has('Imported2')).toBe(true);
      // Stale pre-save documents were replaced by the rebuild.
      expect(index.documents.has('Alice')).toBe(false);
      storageSync.disable();
    });

    it('should coalesce a storm of graph:saved events into a single rebuild', async () => {
      const stormSync = new TFIDFEventSync(indexManager, eventEmitter, storage, {
        coalesceMs: 0,
        rebuildDebounceMs: 25,
      });
      stormSync.enable();
      const buildSpy = vi.spyOn(indexManager, 'buildIndex');

      for (let i = 0; i < 5; i++) {
        eventEmitter.emitGraphSaved(i, 0);
      }

      await vi.waitFor(() => expect(buildSpy).toHaveBeenCalledTimes(1), {
        timeout: 2000,
      });
      // Give any (incorrect) extra rebuilds a chance to fire, then re-check.
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(buildSpy).toHaveBeenCalledTimes(1);
      stormSync.disable();
    });

    it('should ignore graph:saved when the index is not initialized', async () => {
      const uninitializedManager = new TFIDFIndexManager(testDir);
      const uninitializedSync = new TFIDFEventSync(
        uninitializedManager,
        eventEmitter,
        storage,
        { coalesceMs: 0, rebuildDebounceMs: 5 }
      );
      uninitializedSync.enable();
      const buildSpy = vi.spyOn(uninitializedManager, 'buildIndex');

      eventEmitter.emitGraphSaved(1, 0);
      await new Promise(resolve => setTimeout(resolve, 30));

      expect(buildSpy).not.toHaveBeenCalled();
      uninitializedSync.disable();
    });

    it('rebuildNow should resolve immediately when nothing is pending', async () => {
      sync.enable();
      await expect(sync.rebuildNow()).resolves.toBeUndefined();
    });
  });

  describe('multiple sync instances', () => {
    it('should allow multiple sync instances to operate independently', () => {
      const sync2 = new TFIDFEventSync(indexManager, eventEmitter, storage, { coalesceMs: 0 });

      sync.enable();
      sync2.enable();

      expect(sync.isEnabled()).toBe(true);
      expect(sync2.isEnabled()).toBe(true);

      sync.disable();

      expect(sync.isEnabled()).toBe(false);
      expect(sync2.isEnabled()).toBe(true);

      sync2.disable();
    });
  });
});
