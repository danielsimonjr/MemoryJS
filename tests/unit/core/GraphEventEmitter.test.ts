/**
 * GraphEventEmitter Unit Tests
 *
 * Phase 10 Sprint 2: Tests for graph change event system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import type {
  GraphEvent,
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  RelationCreatedEvent,
  RelationDeletedEvent,
  ObservationAddedEvent,
  ObservationDeletedEvent,
  GraphSavedEvent,
  GraphLoadedEvent,
} from '../../../src/types/types.js';

describe('GraphEventEmitter', () => {
  let emitter: GraphEventEmitter;

  beforeEach(() => {
    emitter = new GraphEventEmitter();
  });

  describe('Event Subscription', () => {
    it('should register and invoke listener for specific event type', () => {
      const listener = vi.fn();
      emitter.on('entity:created', listener);

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'entity:created',
          entity: expect.objectContaining({ name: 'Test' }),
        })
      );
    });

    it('should not invoke listener for different event type', () => {
      const listener = vi.fn();
      emitter.on('entity:deleted', listener);

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners for same event type', () => {
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

    it('should unsubscribe listener using returned function', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on('entity:created', listener);

      unsubscribe();

      emitter.emitEntityCreated({
        name: 'Test',
        entityType: 'test',
        observations: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should unsubscribe listener using off()', () => {
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
  });

  describe('Wildcard Listeners', () => {
    it('should receive all events with onAny()', () => {
      const listener = vi.fn();
      emitter.onAny(listener);

      emitter.emitEntityCreated({ name: 'A', entityType: 'test', observations: [] });
      emitter.emitEntityDeleted('B');
      emitter.emitRelationCreated({ from: 'A', to: 'B', relationType: 'knows' });

      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should unsubscribe wildcard listener', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.onAny(listener);

      unsubscribe();

      emitter.emitEntityCreated({ name: 'A', entityType: 'test', observations: [] });

      expect(listener).not.toHaveBeenCalled();
    });

    it('should unsubscribe wildcard listener using offAny()', () => {
      const listener = vi.fn();
      emitter.onAny(listener);
      emitter.offAny(listener);

      emitter.emitEntityCreated({ name: 'A', entityType: 'test', observations: [] });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Once Listener', () => {
    it('should only invoke listener once', () => {
      const listener = vi.fn();
      emitter.once('entity:created', listener);

      emitter.emitEntityCreated({ name: 'A', entityType: 'test', observations: [] });
      emitter.emitEntityCreated({ name: 'B', entityType: 'test', observations: [] });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: expect.objectContaining({ name: 'A' }),
        })
      );
    });

    it('should allow cancellation before event occurs', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.once('entity:created', listener);

      unsubscribe();

      emitter.emitEntityCreated({ name: 'A', entityType: 'test', observations: [] });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Event Data', () => {
    it('should include timestamp in all events', () => {
      const listener = vi.fn();
      emitter.on('entity:created', listener);

      emitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });

      const event = listener.mock.calls[0][0] as EntityCreatedEvent;
      expect(event.timestamp).toBeDefined();
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });

    it('should include entity in entity:created event', () => {
      const listener = vi.fn();
      emitter.on('entity:created', listener);

      const entity = { name: 'Test', entityType: 'test', observations: ['Fact'] };
      emitter.emitEntityCreated(entity);

      const event = listener.mock.calls[0][0] as EntityCreatedEvent;
      expect(event.entity).toEqual(entity);
    });

    it('should include changes and previous values in entity:updated event', () => {
      const listener = vi.fn();
      emitter.on('entity:updated', listener);

      const changes = { importance: 8 };
      const previous = { importance: 5 };
      emitter.emitEntityUpdated('Test', changes, previous);

      const event = listener.mock.calls[0][0] as EntityUpdatedEvent;
      expect(event.entityName).toBe('Test');
      expect(event.changes).toEqual(changes);
      expect(event.previousValues).toEqual(previous);
    });

    it('should include entity name in entity:deleted event', () => {
      const listener = vi.fn();
      emitter.on('entity:deleted', listener);

      emitter.emitEntityDeleted('Test');

      const event = listener.mock.calls[0][0] as EntityDeletedEvent;
      expect(event.entityName).toBe('Test');
    });

    it('should include relation in relation:created event', () => {
      const listener = vi.fn();
      emitter.on('relation:created', listener);

      const relation = { from: 'A', to: 'B', relationType: 'knows' };
      emitter.emitRelationCreated(relation);

      const event = listener.mock.calls[0][0] as RelationCreatedEvent;
      expect(event.relation).toEqual(relation);
    });

    it('should include relation details in relation:deleted event', () => {
      const listener = vi.fn();
      emitter.on('relation:deleted', listener);

      emitter.emitRelationDeleted('A', 'B', 'knows');

      const event = listener.mock.calls[0][0] as RelationDeletedEvent;
      expect(event.from).toBe('A');
      expect(event.to).toBe('B');
      expect(event.relationType).toBe('knows');
    });

    it('should include observations in observation:added event', () => {
      const listener = vi.fn();
      emitter.on('observation:added', listener);

      emitter.emitObservationAdded('Test', ['Fact 1', 'Fact 2']);

      const event = listener.mock.calls[0][0] as ObservationAddedEvent;
      expect(event.entityName).toBe('Test');
      expect(event.observations).toEqual(['Fact 1', 'Fact 2']);
    });

    it('should not emit observation:added for empty array', () => {
      const listener = vi.fn();
      emitter.on('observation:added', listener);

      emitter.emitObservationAdded('Test', []);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should include counts in graph:saved event', () => {
      const listener = vi.fn();
      emitter.on('graph:saved', listener);

      emitter.emitGraphSaved(10, 20);

      const event = listener.mock.calls[0][0] as GraphSavedEvent;
      expect(event.entityCount).toBe(10);
      expect(event.relationCount).toBe(20);
    });

    it('should include counts in graph:loaded event', () => {
      const listener = vi.fn();
      emitter.on('graph:loaded', listener);

      emitter.emitGraphLoaded(5, 8);

      const event = listener.mock.calls[0][0] as GraphLoadedEvent;
      expect(event.entityCount).toBe(5);
      expect(event.relationCount).toBe(8);
    });
  });

  describe('Listener Management', () => {
    it('should report correct listener count', () => {
      expect(emitter.listenerCount('entity:created')).toBe(0);

      emitter.on('entity:created', () => {});
      expect(emitter.listenerCount('entity:created')).toBe(1);

      emitter.on('entity:created', () => {});
      expect(emitter.listenerCount('entity:created')).toBe(2);
    });

    it('should include wildcard listeners in count', () => {
      emitter.on('entity:created', () => {});
      emitter.onAny(() => {});

      expect(emitter.listenerCount('entity:created')).toBe(2);
    });

    it('should remove all listeners', () => {
      emitter.on('entity:created', () => {});
      emitter.on('entity:deleted', () => {});
      emitter.onAny(() => {});

      emitter.removeAllListeners();

      expect(emitter.listenerCount()).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should suppress listener errors by default', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });
      const goodListener = vi.fn();

      emitter.on('entity:created', errorListener);
      emitter.on('entity:created', goodListener);

      // Should not throw
      expect(() => {
        emitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      }).not.toThrow();

      // Both listeners should be called
      expect(errorListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    it('should propagate errors when suppressListenerErrors is false', () => {
      const errorEmitter = new GraphEventEmitter({ suppressListenerErrors: false });
      const errorListener = vi.fn(() => {
        throw new Error('Test error');
      });

      errorEmitter.on('entity:created', errorListener);

      expect(() => {
        errorEmitter.emitEntityCreated({ name: 'Test', entityType: 'test', observations: [] });
      }).toThrow('Test error');
    });
  });
});

describe('GraphStorage Event Integration', () => {
  let tempDir: string;
  let storage: GraphStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-events-test-'));
    const memoryFile = path.join(tempDir, 'memory.jsonl');
    storage = new GraphStorage(memoryFile);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should expose event emitter via events property', () => {
    expect(storage.events).toBeInstanceOf(GraphEventEmitter);
  });

  it('should emit entity:created when appending entity', async () => {
    const listener = vi.fn();
    storage.events.on('entity:created', listener);

    await storage.appendEntity({
      name: 'Test',
      entityType: 'test',
      observations: ['Fact'],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'entity:created',
        entity: expect.objectContaining({ name: 'Test' }),
      })
    );
  });

  it('should emit relation:created when appending relation', async () => {
    const listener = vi.fn();
    storage.events.on('relation:created', listener);

    // Create entities first
    await storage.appendEntity({
      name: 'A',
      entityType: 'test',
      observations: [],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    });
    await storage.appendEntity({
      name: 'B',
      entityType: 'test',
      observations: [],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    });

    await storage.appendRelation({
      from: 'A',
      to: 'B',
      relationType: 'knows',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'relation:created',
        relation: expect.objectContaining({ from: 'A', to: 'B' }),
      })
    );
  });

  it('should emit entity:updated when updating entity', async () => {
    const listener = vi.fn();
    storage.events.on('entity:updated', listener);

    await storage.appendEntity({
      name: 'Test',
      entityType: 'test',
      observations: [],
      importance: 5,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    });

    await storage.updateEntity('Test', { importance: 8 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'entity:updated',
        entityName: 'Test',
        changes: { importance: 8 },
        previousValues: expect.objectContaining({ importance: 5 }),
      })
    );
  });

  it('should emit graph:saved when saving graph', async () => {
    const listener = vi.fn();
    storage.events.on('graph:saved', listener);

    await storage.saveGraph({
      entities: [
        { name: 'A', entityType: 'test', observations: [] },
        { name: 'B', entityType: 'test', observations: [] },
      ],
      relations: [{ from: 'A', to: 'B', relationType: 'knows' }],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'graph:saved',
        entityCount: 2,
        relationCount: 1,
      })
    );
  });

  it('should emit graph:loaded when loading graph', async () => {
    // First save some data
    await storage.saveGraph({
      entities: [{ name: 'Test', entityType: 'test', observations: [] }],
      relations: [],
    });

    // Clear cache to force reload
    storage.clearCache();

    const listener = vi.fn();
    storage.events.on('graph:loaded', listener);

    // Load the graph
    await storage.loadGraph();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'graph:loaded',
        entityCount: 1,
        relationCount: 0,
      })
    );
  });

  it('should emit graph:loaded for empty graph', async () => {
    const listener = vi.fn();
    storage.events.on('graph:loaded', listener);

    // Load empty graph (file doesn't exist)
    await storage.loadGraph();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'graph:loaded',
        entityCount: 0,
        relationCount: 0,
      })
    );
  });
});
