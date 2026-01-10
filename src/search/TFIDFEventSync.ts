/**
 * TF-IDF Event Sync
 *
 * Phase 10 Sprint 3: Hooks TFIDFIndexManager to graph events for automatic
 * incremental index updates when entities change.
 *
 * @module search/TFIDFEventSync
 */

import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import type { TFIDFIndexManager } from './TFIDFIndexManager.js';
import type { IGraphStorage } from '../types/index.js';
import type {
  EntityCreatedEvent,
  EntityUpdatedEvent,
  EntityDeletedEvent,
} from '../types/types.js';

/**
 * Phase 10 Sprint 3: Synchronizes TF-IDF index with graph changes via events.
 *
 * Listens to graph events and triggers incremental index updates automatically.
 * More efficient than rebuilding the entire index on every change.
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('/data/memory.jsonl');
 * const indexManager = new TFIDFIndexManager('/data');
 *
 * // Load or build index
 * await indexManager.loadIndex();
 *
 * // Enable automatic sync
 * const sync = new TFIDFEventSync(indexManager, storage.events, storage);
 * sync.enable();
 *
 * // Now entities added to storage will automatically update the index
 * await storage.appendEntity({ name: 'New', entityType: 'test', observations: [] });
 *
 * // Disable when done
 * sync.disable();
 * ```
 */
export class TFIDFEventSync {
  private indexManager: TFIDFIndexManager;
  private eventEmitter: GraphEventEmitter;
  private storage: IGraphStorage;
  private unsubscribers: Array<() => void> = [];
  private enabled: boolean = false;

  /**
   * Create a new TFIDFEventSync instance.
   *
   * @param indexManager - TFIDFIndexManager to sync
   * @param eventEmitter - GraphEventEmitter to listen to
   * @param storage - Storage to fetch entity data from (for updates)
   */
  constructor(
    indexManager: TFIDFIndexManager,
    eventEmitter: GraphEventEmitter,
    storage: IGraphStorage
  ) {
    this.indexManager = indexManager;
    this.eventEmitter = eventEmitter;
    this.storage = storage;
  }

  /**
   * Enable automatic index synchronization.
   *
   * Subscribes to entity:created, entity:updated, and entity:deleted events.
   */
  enable(): void {
    if (this.enabled) {
      return;
    }

    // Subscribe to entity events
    this.unsubscribers.push(
      this.eventEmitter.on('entity:created', this.handleEntityCreated.bind(this))
    );

    this.unsubscribers.push(
      this.eventEmitter.on('entity:updated', this.handleEntityUpdated.bind(this))
    );

    this.unsubscribers.push(
      this.eventEmitter.on('entity:deleted', this.handleEntityDeleted.bind(this))
    );

    this.enabled = true;
  }

  /**
   * Disable automatic index synchronization.
   *
   * Unsubscribes from all events.
   */
  disable(): void {
    if (!this.enabled) {
      return;
    }

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.enabled = false;
  }

  /**
   * Check if synchronization is enabled.
   *
   * @returns True if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Handle entity:created event.
   * @private
   */
  private handleEntityCreated(event: EntityCreatedEvent): void {
    if (!this.indexManager.isInitialized()) {
      return;
    }

    this.indexManager.addDocument({
      name: event.entity.name,
      entityType: event.entity.entityType,
      observations: event.entity.observations,
    });
  }

  /**
   * Handle entity:updated event.
   * @private
   */
  private async handleEntityUpdated(event: EntityUpdatedEvent): Promise<void> {
    if (!this.indexManager.isInitialized()) {
      return;
    }

    // Fetch the current entity state
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === event.entityName);

    if (entity) {
      this.indexManager.updateDocument({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
      });
    }
  }

  /**
   * Handle entity:deleted event.
   * @private
   */
  private handleEntityDeleted(event: EntityDeletedEvent): void {
    if (!this.indexManager.isInitialized()) {
      return;
    }

    this.indexManager.removeDocument(event.entityName);
  }
}
