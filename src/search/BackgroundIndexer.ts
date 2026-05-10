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
  private flushing = false;

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
   * concurrently — overlapping flushes coalesce. Returns the number of
   * (entity, updater) pairs applied.
   */
  async flush(): Promise<number> {
    if (this.dirty.size === 0 || this.flushing) return 0;
    this.flushing = true;
    try {
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
    } finally {
      this.flushing = false;
    }
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
    // Force-drain when over the batch size cap.
    if (this.dirty.size >= this.maxBatchSize) {
      this.flush().catch((err) => logger.error('[BackgroundIndexer] force-flush failed:', err));
    }
  }
}
