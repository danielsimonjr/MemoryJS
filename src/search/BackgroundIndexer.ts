/**
 * Background Indexer
 *
 * Decouples index updates from the write path. Storage write events
 * mark per-index "dirty entity" sets; a background timer drains them
 * in batches via the registered `IndexUpdater`s. Searches against
 * dirty indexes can use a "pending changes" overlay (callers consult
 * `pendingFor(entityName)` before falling back to the index).
 *
 * Phase 3 step 31 — opt-in via `MEMORY_INDEX_UPDATE_MODE`. Default is
 * the existing synchronous behaviour; setting the env var to `async`
 * activates this background drainer.
 *
 * @module search/BackgroundIndexer
 */

import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';
import type { IGraphStorage } from '../types/index.js';
import { logger } from '../utils/logger.js';
import type { TFIDFIndexManager } from './TFIDFIndexManager.js';

/** Per-index updater contract. Implementations register with the indexer. */
export interface IndexUpdater {
  /** Stable name (e.g. 'tfidf', 'bm25', 'embedding'). */
  name: string;
  /**
   * Apply an upsert to the underlying index. Implementation handles
   * its own internal state — the indexer doesn't track per-entity
   * data, only that "this entity may have changed". Implementations
   * fetch the live entity content from storage themselves.
   */
  applyUpsert(entityName: string, storage: IGraphStorage): Promise<void> | void;
  /** Apply a delete. */
  applyDelete(entityName: string): Promise<void> | void;
}

/** Operation type for the per-entity dirty record. */
type DirtyOp = 'upsert' | 'delete';

/** Background indexer options. */
export interface BackgroundIndexerOptions {
  /** Drain interval in ms. Default 200 ms. */
  intervalMs?: number;
  /** Force-drain when pending count exceeds this. Default 200. */
  maxBatchSize?: number;
  /** Read this env var to gate activation. Default `'MEMORY_INDEX_UPDATE_MODE'`. */
  envVar?: string;
}

/**
 * Coordinates lazy index updates across multiple `IndexUpdater`s.
 *
 * @example
 * ```typescript
 * const indexer = new BackgroundIndexer(storage, eventEmitter);
 * indexer.registerUpdater(tfidfUpdater);
 * indexer.start();          // attaches event listeners + timer
 * // ... entity events arrive, get queued, drained on the timer
 * await indexer.flush();    // force-drain (e.g., before tests assert)
 * indexer.stop();
 * ```
 */
export class BackgroundIndexer {
  private readonly intervalMs: number;
  private readonly maxBatchSize: number;
  private readonly envVar: string;
  private readonly updaters: IndexUpdater[] = [];
  private readonly dirty: Map<string, DirtyOp> = new Map();

  private interval: NodeJS.Timeout | null = null;
  private unsubscribers: Array<() => void> = [];
  private running = false;

  /**
   * In-flight flush, if any. A second concurrent `flush()` awaits this
   * promise instead of returning 0, so callers always get back the
   * count of (entity, updater) pairs actually applied since their
   * call landed. After the in-flight flush finishes, if more dirty
   * entries accumulated during it, a follow-up flush is chained
   * automatically — prevents starvation under sustained writes.
   */
  private flushPromise: Promise<number> | null = null;

  /** True when the env var enables async mode. */
  readonly enabled: boolean;

  constructor(
    private storage: IGraphStorage,
    private events: GraphEventEmitter,
    options: BackgroundIndexerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 200;
    this.maxBatchSize = options.maxBatchSize ?? 200;
    this.envVar = options.envVar ?? 'MEMORY_INDEX_UPDATE_MODE';
    this.enabled = process.env[this.envVar] === 'async';
  }

  /** Register an index that should receive batched updates. Idempotent on name. */
  registerUpdater(updater: IndexUpdater): void {
    const idx = this.updaters.findIndex((u) => u.name === updater.name);
    if (idx >= 0) {
      this.updaters[idx] = updater;
    } else {
      this.updaters.push(updater);
    }
  }

  /** Drop a registered updater by name. */
  unregisterUpdater(name: string): void {
    const idx = this.updaters.findIndex((u) => u.name === name);
    if (idx >= 0) this.updaters.splice(idx, 1);
  }

  /** Number of entities currently waiting for an index update. */
  pendingSize(): number {
    return this.dirty.size;
  }

  /**
   * Pending operation for a specific entity, or `undefined` if none. A
   * search-side overlay can consult this when serving reads against a
   * dirty index.
   */
  pendingFor(entityName: string): DirtyOp | undefined {
    return this.dirty.get(entityName);
  }

  /** Start listening to events and draining periodically. No-op when disabled. */
  start(): void {
    if (!this.enabled || this.running) return;
    this.running = true;
    this.unsubscribers.push(
      this.events.on('entity:created', (e) => this.markDirty(e.entity.name, 'upsert')),
    );
    this.unsubscribers.push(
      this.events.on('entity:updated', (e) => this.markDirty(e.entityName, 'upsert')),
    );
    this.unsubscribers.push(
      this.events.on('entity:deleted', (e) => this.markDirty(e.entityName, 'delete')),
    );
    this.interval = setInterval(() => {
      this.flush().catch((err) => logger.error('[BackgroundIndexer] flush failed:', err));
    }, this.intervalMs);
    // Don't keep the process alive solely for the indexer.
    this.interval.unref?.();
  }

  /**
   * Stop listening and drop the timer. Pending ops are NOT drained —
   * call `await flush()` first if you need that.
   */
  stop(): void {
    if (!this.running) return;
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.running = false;
  }

  /**
   * Drain every pending op into the registered updaters. Safe to call
   * concurrently — a second caller awaits the in-flight flush rather
   * than returning 0 prematurely. If new dirty entries accumulate
   * during a flush, a follow-up flush is chained automatically so a
   * caller's `await flush()` returns only when the queue is actually
   * empty.
   *
   * Returns the number of (entity, updater) pairs applied during the
   * caller's awaited flush window (including any chained follow-up
   * drains).
   */
  async flush(): Promise<number> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.drainOnce()
      .then(async (firstApplied) => {
        // Anything queued during the in-flight drain? Chain another
        // pass so the awaiting caller doesn't return with a stale
        // queue. Loop until the queue is genuinely empty.
        let total = firstApplied;
        while (this.dirty.size > 0) {
          total += await this.drainOnce();
        }
        return total;
      })
      .finally(() => {
        this.flushPromise = null;
      });
    return this.flushPromise;
  }

  /**
   * Single-pass drain. Internal helper used by `flush()` to apply one
   * snapshot of the dirty queue. Each call returns the number of
   * (entity, updater) pairs applied during that pass.
   */
  private async drainOnce(): Promise<number> {
    if (this.dirty.size === 0) return 0;
    const ops = [...this.dirty.entries()];
    this.dirty.clear();
    let applied = 0;
    for (const [name, op] of ops) {
      for (const updater of this.updaters) {
        try {
          if (op === 'delete') {
            await updater.applyDelete(name);
          } else {
            await updater.applyUpsert(name, this.storage);
          }
          applied++;
        } catch (err) {
          logger.error(`[BackgroundIndexer] ${updater.name} failed on ${name}:`, err);
        }
      }
    }
    return applied;
  }

  /**
   * Mark an entity dirty. Coalesces consecutive ops on the same entity
   * — `delete` always wins (a delete after upsert reverts to delete; a
   * delete before upsert means the entity was reinstated, so the
   * upsert wins).
   */
  private markDirty(entityName: string, op: DirtyOp): void {
    const existing = this.dirty.get(entityName);
    if (existing === 'delete' && op === 'upsert') {
      // Entity was deleted then recreated — upsert wins.
      this.dirty.set(entityName, 'upsert');
    } else {
      this.dirty.set(entityName, op);
    }
    // Force-drain when over the batch size cap. We're inside a
    // synchronous emit handler, so the force-flush is dispatched via
    // setImmediate — this lets the emit handler return promptly and
    // avoids re-entering `markDirty` from within the same tick.
    if (this.dirty.size >= this.maxBatchSize) {
      setImmediate(() => {
        this.flush().catch((err) => logger.error('[BackgroundIndexer] force-flush failed:', err));
      });
    }
  }
}

/**
 * Build an `IndexUpdater` that drives a `TFIDFIndexManager`. Convenience
 * factory so callers don't have to hand-roll the upsert/delete bridge.
 *
 * @example
 * ```typescript
 * const indexer = new BackgroundIndexer(storage, events);
 * indexer.registerUpdater(makeTFIDFUpdater(rankedSearch.indexManager));
 * indexer.start();
 * ```
 *
 * The updater fetches the live entity from storage on each upsert
 * (matches the `TFIDFEventSync` event-handler contract).
 */
export function makeTFIDFUpdater(indexManager: TFIDFIndexManager): IndexUpdater {
  return {
    name: 'tfidf',
    async applyUpsert(entityName, storage) {
      if (!indexManager.isInitialized()) return;
      const graph = await storage.loadGraph();
      const entity = graph.entities.find((e) => e.name === entityName);
      if (!entity) return;
      indexManager.updateDocument({
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
      });
    },
    applyDelete(entityName) {
      if (!indexManager.isInitialized()) return;
      indexManager.removeDocument(entityName);
    },
  };
}
