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
/**
 * Pending coalesced index operation. Stored per-entity-name so consecutive
 * events on the same entity collapse to a single final operation.
 */
type PendingOp =
  | { op: 'upsert'; name: string; entityType: string; observations: string[] }
  | { op: 'delete'; name: string };

export class TFIDFEventSync {
  private indexManager: TFIDFIndexManager;
  private eventEmitter: GraphEventEmitter;
  private storage: IGraphStorage;
  private unsubscribers: Array<() => void> = [];
  private enabled: boolean = false;

  /**
   * Coalescing window in ms. Reads `MEMORY_INDEX_COALESCE_MS` (default 50).
   * Set to 0 to disable coalescing — operations apply synchronously.
   */
  private readonly coalesceMs: number;

  /** Pending op per entity name. Last op wins. */
  private pendingOps: Map<string, PendingOp> = new Map();

  /** Timer ref for the next scheduled flush, or null when no flush pending. */
  private flushTimer: NodeJS.Timeout | null = null;

  /** beforeExit handler — fires `flushNow()` if the process is winding down with pending ops. */
  private readonly beforeExitHandler: () => void = () => this.flushNow();

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

    const raw = process.env.MEMORY_INDEX_COALESCE_MS;
    const parsed = raw === undefined ? 50 : parseInt(raw, 10);
    this.coalesceMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
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

    // Drain any pending coalesced ops before the process exits — without
    // this, a process that stops between event arrival and the coalesce
    // window silently loses index updates.
    process.on('beforeExit', this.beforeExitHandler);

    this.enabled = true;
  }

  /**
   * Disable automatic index synchronization.
   *
   * Unsubscribes from all events. Any pending coalesced operations are
   * applied synchronously before returning so the index is not left in a
   * stale state.
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
    process.removeListener('beforeExit', this.beforeExitHandler);
    this.flushNow();
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
   * Drain all pending coalesced operations into the underlying index
   * manager. Idempotent. Safe to call from tests, from `disable()`, and
   * on demand.
   */
  flushNow(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingOps.size === 0) return;
    if (!this.indexManager.isInitialized()) {
      // Nothing useful to do — drop the queue silently rather than try to
      // apply against an un-built index.
      this.pendingOps.clear();
      return;
    }
    const ops = [...this.pendingOps.values()];
    this.pendingOps.clear();
    for (const op of ops) {
      if (op.op === 'delete') {
        this.indexManager.removeDocument(op.name);
      } else {
        this.indexManager.updateDocument({
          name: op.name,
          entityType: op.entityType,
          observations: op.observations,
        });
      }
    }
  }

  /**
   * Schedule a flush within the coalescing window. If `coalesceMs` is 0,
   * the flush runs synchronously here and the queue is drained immediately.
   */
  private scheduleFlush(): void {
    if (this.coalesceMs === 0) {
      this.flushNow();
      return;
    }
    if (this.flushTimer !== null) return; // a flush is already pending
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, this.coalesceMs);
    // Don't keep the event loop alive for a coalesce timer — schedulers
    // and CLI processes should exit cleanly when their work is done.
    this.flushTimer.unref?.();
  }

  /**
   * Handle entity:created event.
   * @private
   */
  private handleEntityCreated(event: EntityCreatedEvent): void {
    if (!this.indexManager.isInitialized()) {
      return;
    }
    this.pendingOps.set(event.entity.name, {
      op: 'upsert',
      name: event.entity.name,
      entityType: event.entity.entityType,
      observations: event.entity.observations,
    });
    this.scheduleFlush();
  }

  /**
   * Handle entity:updated event.
   * @private
   */
  private async handleEntityUpdated(event: EntityUpdatedEvent): Promise<void> {
    if (!this.indexManager.isInitialized()) {
      return;
    }
    // Fetch the current entity state.
    const graph = await this.storage.loadGraph();
    const entity = graph.entities.find(e => e.name === event.entityName);
    if (!entity) return;
    this.pendingOps.set(entity.name, {
      op: 'upsert',
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations,
    });
    this.scheduleFlush();
  }

  /**
   * Handle entity:deleted event.
   * @private
   */
  private handleEntityDeleted(event: EntityDeletedEvent): void {
    if (!this.indexManager.isInitialized()) {
      return;
    }
    this.pendingOps.set(event.entityName, { op: 'delete', name: event.entityName });
    this.scheduleFlush();
  }
}
