/**
 * Graph Event Emitter
 *
 * Phase 10 Sprint 2: Provides event-based notifications for graph changes.
 * Enables loose coupling between graph operations and dependent systems
 * like search indexes, analytics, and external integrations.
 *
 * @module core/GraphEventEmitter
 */

import type {
  GraphEventType,
  GraphEvent,
  GraphEventListener,
  GraphEventMap,
  Entity,
  Relation,
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
  RelationCreatedEvent,
  RelationDeletedEvent,
  ObservationAddedEvent,
  ObservationDeletedEvent,
  GraphSavedEvent,
  GraphLoadedEvent,
} from '../types/index.js';

/**
 * Phase 10 Sprint 2: Event emitter for graph change notifications.
 *
 * Provides a type-safe event system for subscribing to and emitting
 * graph change events. Supports wildcard listeners for all events.
 *
 * @example
 * ```typescript
 * const emitter = new GraphEventEmitter();
 *
 * // Listen to specific event types
 * emitter.on('entity:created', (event) => {
 *   console.log(`Entity ${event.entity.name} created`);
 * });
 *
 * // Listen to all events
 * emitter.onAny((event) => {
 *   console.log(`Event: ${event.type}`);
 * });
 *
 * // Emit an event
 * emitter.emitEntityCreated(entity);
 *
 * // Remove listener
 * const unsubscribe = emitter.on('entity:deleted', handler);
 * unsubscribe();
 * ```
 */
export class GraphEventEmitter {
  /**
   * Map of event types to their registered listeners.
   */
  private listeners: Map<GraphEventType, Set<GraphEventListener<any>>> = new Map();

  /**
   * Listeners that receive all events regardless of type.
   */
  private wildcardListeners: Set<GraphEventListener<GraphEvent>> = new Set();

  /**
   * Whether to suppress errors from listeners (default: true).
   * When true, listener errors are logged but don't stop event propagation.
   */
  private suppressListenerErrors: boolean = true;

  /**
   * Create a new GraphEventEmitter instance.
   *
   * @param options - Optional configuration
   */
  constructor(options?: { suppressListenerErrors?: boolean }) {
    if (options?.suppressListenerErrors !== undefined) {
      this.suppressListenerErrors = options.suppressListenerErrors;
    }
  }

  // ==================== Subscription Methods ====================

  /**
   * Subscribe to a specific event type.
   *
   * @template K - The event type key
   * @param eventType - The event type to listen for
   * @param listener - Callback function to invoke when event occurs
   * @returns Unsubscribe function to remove the listener
   *
   * @example
   * ```typescript
   * const unsubscribe = emitter.on('entity:created', (event) => {
   *   console.log(`Created: ${event.entity.name}`);
   * });
   *
   * // Later: unsubscribe();
   * ```
   */
  on<K extends GraphEventType>(
    eventType: K,
    listener: GraphEventListener<GraphEventMap[K]>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.off(eventType, listener);
    };
  }

  /**
   * Unsubscribe from a specific event type.
   *
   * @template K - The event type key
   * @param eventType - The event type to unsubscribe from
   * @param listener - The listener function to remove
   */
  off<K extends GraphEventType>(
    eventType: K,
    listener: GraphEventListener<GraphEventMap[K]>
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Subscribe to all event types.
   *
   * @param listener - Callback function to invoke for any event
   * @returns Unsubscribe function to remove the listener
   *
   * @example
   * ```typescript
   * emitter.onAny((event) => {
   *   console.log(`Event: ${event.type} at ${event.timestamp}`);
   * });
   * ```
   */
  onAny(listener: GraphEventListener<GraphEvent>): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.offAny(listener);
    };
  }

  /**
   * Unsubscribe from all events.
   *
   * @param listener - The listener function to remove
   */
  offAny(listener: GraphEventListener<GraphEvent>): void {
    this.wildcardListeners.delete(listener);
  }

  /**
   * Subscribe to an event type, but only receive the first occurrence.
   *
   * @template K - The event type key
   * @param eventType - The event type to listen for once
   * @param listener - Callback function to invoke once
   * @returns Unsubscribe function to cancel before event occurs
   */
  once<K extends GraphEventType>(
    eventType: K,
    listener: GraphEventListener<GraphEventMap[K]>
  ): () => void {
    const wrappedListener = ((event: GraphEventMap[K]) => {
      this.off(eventType, wrappedListener);
      listener(event);
    }) as GraphEventListener<GraphEventMap[K]>;

    return this.on(eventType, wrappedListener);
  }

  /**
   * Remove all listeners for all event types.
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  /**
   * Get the count of listeners for a specific event type.
   *
   * @param eventType - The event type to count listeners for
   * @returns Number of listeners registered
   */
  listenerCount(eventType?: GraphEventType): number {
    if (eventType) {
      return (this.listeners.get(eventType)?.size ?? 0) + this.wildcardListeners.size;
    }
    // Count all listeners
    let count = this.wildcardListeners.size;
    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }
    return count;
  }

  // ==================== Emit Methods ====================

  /**
   * Emit an event to all registered listeners.
   *
   * @param event - The event to emit
   */
  emit(event: GraphEvent): void {
    // Notify type-specific listeners
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        this.invokeListener(listener, event);
      }
    }

    // Notify wildcard listeners
    for (const listener of this.wildcardListeners) {
      this.invokeListener(listener, event);
    }
  }

  /**
   * Emit an entity:created event.
   *
   * @param entity - The entity that was created
   */
  emitEntityCreated(entity: Entity): void {
    const event: EntityCreatedEvent = {
      type: 'entity:created',
      timestamp: new Date().toISOString(),
      entity,
    };
    this.emit(event);
  }

  /**
   * Emit an entity:updated event.
   *
   * @param entityName - Name of the updated entity
   * @param changes - The changes that were applied
   * @param previousValues - Optional previous values before update
   */
  emitEntityUpdated(
    entityName: string,
    changes: Partial<Entity>,
    previousValues?: Partial<Entity>
  ): void {
    const event: EntityUpdatedEvent = {
      type: 'entity:updated',
      timestamp: new Date().toISOString(),
      entityName,
      changes,
      previousValues,
    };
    this.emit(event);
  }

  /**
   * Emit an entity:deleted event.
   *
   * @param entityName - Name of the deleted entity
   * @param entity - Optional entity data before deletion
   */
  emitEntityDeleted(entityName: string, entity?: Entity): void {
    const event: EntityDeletedEvent = {
      type: 'entity:deleted',
      timestamp: new Date().toISOString(),
      entityName,
      entity,
    };
    this.emit(event);
  }

  /**
   * Emit a relation:created event.
   *
   * @param relation - The relation that was created
   */
  emitRelationCreated(relation: Relation): void {
    const event: RelationCreatedEvent = {
      type: 'relation:created',
      timestamp: new Date().toISOString(),
      relation,
    };
    this.emit(event);
  }

  /**
   * Emit a relation:deleted event.
   *
   * @param from - Source entity name
   * @param to - Target entity name
   * @param relationType - Type of the deleted relation
   */
  emitRelationDeleted(from: string, to: string, relationType: string): void {
    const event: RelationDeletedEvent = {
      type: 'relation:deleted',
      timestamp: new Date().toISOString(),
      from,
      to,
      relationType,
    };
    this.emit(event);
  }

  /**
   * Emit an observation:added event.
   *
   * @param entityName - Name of the entity
   * @param observations - Observations that were added
   */
  emitObservationAdded(entityName: string, observations: string[]): void {
    if (observations.length === 0) return;

    const event: ObservationAddedEvent = {
      type: 'observation:added',
      timestamp: new Date().toISOString(),
      entityName,
      observations,
    };
    this.emit(event);
  }

  /**
   * Emit an observation:deleted event.
   *
   * @param entityName - Name of the entity
   * @param observations - Observations that were deleted
   */
  emitObservationDeleted(entityName: string, observations: string[]): void {
    if (observations.length === 0) return;

    const event: ObservationDeletedEvent = {
      type: 'observation:deleted',
      timestamp: new Date().toISOString(),
      entityName,
      observations,
    };
    this.emit(event);
  }

  /**
   * Emit a graph:saved event.
   *
   * @param entityCount - Number of entities in the saved graph
   * @param relationCount - Number of relations in the saved graph
   */
  emitGraphSaved(entityCount: number, relationCount: number): void {
    const event: GraphSavedEvent = {
      type: 'graph:saved',
      timestamp: new Date().toISOString(),
      entityCount,
      relationCount,
    };
    this.emit(event);
  }

  /**
   * Emit a graph:loaded event.
   *
   * @param entityCount - Number of entities in the loaded graph
   * @param relationCount - Number of relations in the loaded graph
   */
  emitGraphLoaded(entityCount: number, relationCount: number): void {
    const event: GraphLoadedEvent = {
      type: 'graph:loaded',
      timestamp: new Date().toISOString(),
      entityCount,
      relationCount,
    };
    this.emit(event);
  }

  // ==================== Helper Methods ====================

  /**
   * Safely invoke a listener, optionally catching errors.
   * @private
   */
  private invokeListener(listener: GraphEventListener<any>, event: GraphEvent): void {
    if (this.suppressListenerErrors) {
      try {
        listener(event);
      } catch (error) {
        // Log but don't propagate errors from listeners
        console.error(`GraphEventEmitter: Listener error for ${event.type}:`, error);
      }
    } else {
      listener(event);
    }
  }
}
