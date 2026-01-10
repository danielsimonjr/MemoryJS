/**
 * Graph Events Tests
 *
 * Phase 10 Sprint 2: Tests for GraphEventEmitter and GraphStorage event integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import type {
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  RelationCreatedEvent,
  GraphSavedEvent,
  GraphLoadedEvent,
  GraphEvent,
} from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('GraphEventEmitter', () => {
  let emitter: GraphEventEmitter;

  beforeEach(() => {
    emitter = new GraphEventEmitter();
  });

  describe('basic event handling', () => {
    it('should emit and receive events', () => {
      const listener = vi.fn();
      emitter.on('entity:created', listener);

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entity.name).toBe('Test');
    });

    it('should add timestamp to events automatically', () => {
      let receivedEvent: EntityCreatedEvent | null = null;
      emitter.on('entity:created', (event) => {
        receivedEvent = event;
      });

      const beforeEmit = Date.now();
      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });
      const afterEmit = Date.now();

      expect(receivedEvent?.timestamp).toBeDefined();
      const eventTime = new Date(receivedEvent!.timestamp).getTime();
      expect(eventTime).toBeGreaterThanOrEqual(beforeEmit);
      expect(eventTime).toBeLessThanOrEqual(afterEmit);
    });

    it('should support multiple listeners for same event', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on('entity:created', listener1);
      emitter.on('entity:created', listener2);

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should remove listeners with off()', () => {
      const listener = vi.fn();
      emitter.on('entity:created', listener);
      emitter.off('entity:created', listener);

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should support once() for single-use listeners', () => {
      const listener = vi.fn();
      emitter.once('entity:created', listener);

      emitter.emitEntityCreated({ name: 'Test1', entityType: 'test', observations: [] });
      emitter.emitEntityCreated({ name: 'Test2', entityType: 'test', observations: [] });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entity.name).toBe('Test1');
    });

    it('should return unsubscribe function from on()', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on('entity:created', listener);

      unsubscribe();

      emitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      expect(listener).not.toHaveBeenCalled();
    });

    it('should return listener count', () => {
      expect(emitter.listenerCount('entity:created')).toBe(0);

      emitter.on('entity:created', () => {});
      expect(emitter.listenerCount('entity:created')).toBe(1);

      emitter.on('entity:created', () => {});
      expect(emitter.listenerCount('entity:created')).toBe(2);
    });

    it('should remove all listeners', () => {
      emitter.on('entity:created', () => {});
      emitter.on('entity:deleted', () => {});
      emitter.on('entity:created', () => {});

      emitter.removeAllListeners();

      expect(emitter.listenerCount('entity:created')).toBe(0);
      expect(emitter.listenerCount('entity:deleted')).toBe(0);
    });
  });

  describe('wildcard listeners', () => {
    it('should receive all events with onAny()', () => {
      const listener = vi.fn();
      emitter.onAny(listener);

      emitter.emitEntityCreated({ name: 'A', entityType: 't', observations: [] });
      emitter.emitEntityDeleted('B');

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from onAny()', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.onAny(listener);

      unsubscribe();

      emitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('entity events', () => {
    it('should emit entityCreated with full entity', () => {
      let receivedEvent: EntityCreatedEvent | null = null;
      emitter.on('entity:created', (event) => {
        receivedEvent = event;
      });

      emitter.emitEntityCreated({
        name: 'Alice',
        entityType: 'person',
        observations: ['Developer'],
        importance: 8,
      });

      expect(receivedEvent?.type).toBe('entity:created');
      expect(receivedEvent?.entity.name).toBe('Alice');
      expect(receivedEvent?.entity.entityType).toBe('person');
      expect(receivedEvent?.entity.observations).toContain('Developer');
      expect(receivedEvent?.entity.importance).toBe(8);
    });

    it('should emit entityUpdated with changes and previousValues', () => {
      let receivedEvent: EntityUpdatedEvent | null = null;
      emitter.on('entity:updated', (event) => {
        receivedEvent = event;
      });

      emitter.emitEntityUpdated('Alice', { importance: 9 }, { importance: 8 });

      expect(receivedEvent?.type).toBe('entity:updated');
      expect(receivedEvent?.entityName).toBe('Alice');
      expect(receivedEvent?.changes.importance).toBe(9);
      expect(receivedEvent?.previousValues?.importance).toBe(8);
    });

    it('should emit entityDeleted with entity name', () => {
      let receivedEvent: EntityDeletedEvent | null = null;
      emitter.on('entity:deleted', (event) => {
        receivedEvent = event;
      });

      emitter.emitEntityDeleted('Alice', {
        name: 'Alice',
        entityType: 'person',
        observations: [],
      });

      expect(receivedEvent?.type).toBe('entity:deleted');
      expect(receivedEvent?.entityName).toBe('Alice');
      expect(receivedEvent?.entity?.name).toBe('Alice');
    });
  });

  describe('relation events', () => {
    it('should emit relationCreated', () => {
      let receivedEvent: RelationCreatedEvent | null = null;
      emitter.on('relation:created', (event) => {
        receivedEvent = event;
      });

      emitter.emitRelationCreated({
        from: 'Alice',
        to: 'Bob',
        relationType: 'knows',
      });

      expect(receivedEvent?.type).toBe('relation:created');
      expect(receivedEvent?.relation.from).toBe('Alice');
      expect(receivedEvent?.relation.to).toBe('Bob');
      expect(receivedEvent?.relation.relationType).toBe('knows');
    });

    it('should emit relationDeleted', () => {
      const listener = vi.fn();
      emitter.on('relation:deleted', listener);

      emitter.emitRelationDeleted('Alice', 'Bob', 'knows');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].from).toBe('Alice');
      expect(listener.mock.calls[0][0].to).toBe('Bob');
      expect(listener.mock.calls[0][0].relationType).toBe('knows');
    });
  });

  describe('observation events', () => {
    it('should emit observationAdded', () => {
      const listener = vi.fn();
      emitter.on('observation:added', listener);

      emitter.emitObservationAdded('Alice', ['New observation']);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entityName).toBe('Alice');
      expect(listener.mock.calls[0][0].observations).toContain('New observation');
    });

    it('should not emit observationAdded for empty array', () => {
      const listener = vi.fn();
      emitter.on('observation:added', listener);

      emitter.emitObservationAdded('Alice', []);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit observationDeleted', () => {
      const listener = vi.fn();
      emitter.on('observation:deleted', listener);

      emitter.emitObservationDeleted('Alice', ['Old observation']);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entityName).toBe('Alice');
      expect(listener.mock.calls[0][0].observations).toContain('Old observation');
    });
  });

  describe('graph lifecycle events', () => {
    it('should emit graphSaved with counts', () => {
      let receivedEvent: GraphSavedEvent | null = null;
      emitter.on('graph:saved', (event) => {
        receivedEvent = event;
      });

      emitter.emitGraphSaved(100, 50);

      expect(receivedEvent?.type).toBe('graph:saved');
      expect(receivedEvent?.entityCount).toBe(100);
      expect(receivedEvent?.relationCount).toBe(50);
    });

    it('should emit graphLoaded with counts', () => {
      let receivedEvent: GraphLoadedEvent | null = null;
      emitter.on('graph:loaded', (event) => {
        receivedEvent = event;
      });

      emitter.emitGraphLoaded(100, 50);

      expect(receivedEvent?.type).toBe('graph:loaded');
      expect(receivedEvent?.entityCount).toBe(100);
      expect(receivedEvent?.relationCount).toBe(50);
    });
  });

  describe('error suppression', () => {
    it('should suppress listener errors by default', () => {
      emitter.on('entity:created', () => {
        throw new Error('Listener error');
      });

      // Should not throw
      expect(() => {
        emitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      }).not.toThrow();
    });

    it('should propagate errors when suppression is disabled', () => {
      const strictEmitter = new GraphEventEmitter({ suppressListenerErrors: false });
      strictEmitter.on('entity:created', () => {
        throw new Error('Listener error');
      });

      expect(() => {
        strictEmitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      }).toThrow('Listener error');
    });
  });
});

describe('GraphStorage Events Integration', () => {
  let tempDir: string;
  let storage: GraphStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'events-test-'));
    storage = new GraphStorage(join(tempDir, 'memory.jsonl'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('events property', () => {
    it('should have events property', () => {
      expect(storage.events).toBeInstanceOf(GraphEventEmitter);
    });

    it('should return same emitter instance', () => {
      const events1 = storage.events;
      const events2 = storage.events;
      expect(events1).toBe(events2);
    });
  });

  describe('entity events', () => {
    it('should emit entityCreated when appending entity', async () => {
      const listener = vi.fn();
      storage.events.on('entity:created', listener);

      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: ['obs1'],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entity.name).toBe('Test');
    });

    it('should emit entityUpdated when updating entity', async () => {
      // Create entity first
      await storage.appendEntity({
        name: 'Test',
        entityType: 'test',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const listener = vi.fn();
      storage.events.on('entity:updated', listener);

      await storage.updateEntity('Test', { importance: 8 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entityName).toBe('Test');
      expect(listener.mock.calls[0][0].changes.importance).toBe(8);
    });
  });

  describe('relation events', () => {
    it('should emit relationCreated when appending relation', async () => {
      // Create entities first
      await storage.appendEntity({
        name: 'A',
        entityType: 't',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });
      await storage.appendEntity({
        name: 'B',
        entityType: 't',
        observations: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      const listener = vi.fn();
      storage.events.on('relation:created', listener);

      await storage.appendRelation({
        from: 'A',
        to: 'B',
        relationType: 'related',
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].relation.from).toBe('A');
      expect(listener.mock.calls[0][0].relation.to).toBe('B');
    });
  });

  describe('graph lifecycle events', () => {
    it('should emit graphSaved after saveGraph', async () => {
      const listener = vi.fn();
      storage.events.on('graph:saved', listener);

      await storage.saveGraph({
        entities: [
          { name: 'E1', entityType: 'test', observations: [] },
          { name: 'E2', entityType: 'test', observations: [] },
        ],
        relations: [{ from: 'E1', to: 'E2', relationType: 'related' }],
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entityCount).toBe(2);
      expect(listener.mock.calls[0][0].relationCount).toBe(1);
    });

    it('should emit graphLoaded when loading from disk', async () => {
      // First save some data
      await storage.saveGraph({
        entities: [{ name: 'Test', entityType: 'test', observations: [] }],
        relations: [],
      });

      // Create new storage instance to force load from disk
      const storage2 = new GraphStorage(join(tempDir, 'memory.jsonl'));
      const listener = vi.fn();
      storage2.events.on('graph:loaded', listener);

      await storage2.loadGraph();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].entityCount).toBe(1);
    });
  });

  describe('no overhead when unused', () => {
    it('should not throw when no listeners registered', async () => {
      // Don't access storage.events - this should not cause any overhead
      await storage.saveGraph({
        entities: [{ name: 'Test', entityType: 'test', observations: [] }],
        relations: [],
      });

      // If we get here without errors, the check for events works
      expect(true).toBe(true);
    });
  });
});
