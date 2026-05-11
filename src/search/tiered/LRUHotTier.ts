/**
 * LRU Hot Tier
 *
 * Phase 9 task 70 (§1.5) — second task in the tiered index breakdown.
 * In-memory `IIndexTier` with LRU eviction triggered by either an
 * entry-count bound or an approximate-bytes bound. Built on top of
 * `Map` insertion order: a get-hit deletes-and-reinserts the entry to
 * move it to the most-recently-used end, and eviction always pulls
 * from the front (least-recently-used).
 *
 * Wraps a single `Map<K, V>`; no external deps. The eviction callback
 * (`onEvict`) is what lets task 73 wire this into a 3-tier composer:
 * evicted entries can be handed off to a warm tier instead of dropped.
 *
 * @module search/tiered/LRUHotTier
 * @experimental Bounds + eviction policy may grow new knobs (e.g.
 *   time-decay, frequency-weighted) in non-breaking ways.
 */

import type { IIndexTier } from './ITieredIndex.js';

export interface LRUHotTierOptions<K, V> {
  /** Max entries before LRU eviction kicks in. Default: 10_000. */
  maxEntries?: number;
  /** Max approximate bytes before LRU eviction kicks in. Default: unbounded. */
  maxBytes?: number;
  /** Callback fired on each eviction. The orchestrator wires this to a warm tier. */
  onEvict?: (key: K, value: V) => void;
  /**
   * How to estimate bytes for a (key, value) pair. Default: rough
   * `JSON.stringify` length × 2 (UTF-16). Callers with knowledge of
   * their V shape can pass a tighter estimator.
   */
  estimateBytes?: (key: K, value: V) => number;
  /** Stable name for diagnostics. Default: `'hot'`. */
  name?: string;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const CIRCULAR_FALLBACK_BYTES = 100;

function defaultEstimateBytes<K, V>(key: K, value: V): number {
  try {
    // UTF-16 ≈ 2 bytes per char; JSON.stringify is a rough size proxy.
    return (JSON.stringify(key)?.length ?? 0) * 2 + (JSON.stringify(value)?.length ?? 0) * 2;
  } catch {
    return CIRCULAR_FALLBACK_BYTES;
  }
}

export class LRUHotTier<K, V> implements IIndexTier<K, V> {
  readonly name: string;

  private readonly data: Map<K, V> = new Map();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly onEvict?: (key: K, value: V) => void;
  private readonly estimateBytesFn: (key: K, value: V) => number;
  private readonly perEntryBytes: Map<K, number> = new Map();
  private bytes = 0;
  private evictionCount = 0;

  constructor(options: LRUHotTierOptions<K, V> = {}) {
    this.name = options.name ?? 'hot';
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    this.onEvict = options.onEvict;
    this.estimateBytesFn = options.estimateBytes ?? defaultEstimateBytes;
  }

  async get(key: K): Promise<V | undefined> {
    if (!this.data.has(key)) return undefined;
    const value = this.data.get(key) as V;
    // Promote to most-recently-used end via delete-then-reinsert.
    this.data.delete(key);
    this.data.set(key, value);
    return value;
  }

  async put(key: K, value: V): Promise<void> {
    if (this.data.has(key)) {
      const prevBytes = this.perEntryBytes.get(key) ?? 0;
      this.bytes -= prevBytes;
      this.data.delete(key);
      this.perEntryBytes.delete(key);
    }
    const entryBytes = this.estimateBytesFn(key, value);

    // Short-circuit when a single entry exceeds `maxBytes`: don't
    // insert it, just demote directly via onEvict. Inserting it
    // would force `evictUntilWithinBounds` to drop every other
    // entry trying to make room — nuking the entire hot tier for
    // one oversized value (review #4). This way the hot tier
    // protects its working set and the caller's value still
    // reaches the next tier.
    if (this.maxBytes !== undefined && entryBytes > this.maxBytes) {
      this.evictionCount++;
      if (this.onEvict) this.onEvict(key, value);
      return;
    }

    this.data.set(key, value);
    this.perEntryBytes.set(key, entryBytes);
    this.bytes += entryBytes;
    this.evictUntilWithinBounds();
  }

  async delete(key: K): Promise<boolean> {
    if (!this.data.has(key)) return false;
    const entryBytes = this.perEntryBytes.get(key) ?? 0;
    this.bytes -= entryBytes;
    this.perEntryBytes.delete(key);
    return this.data.delete(key);
  }

  async has(key: K): Promise<boolean> {
    return this.data.has(key);
  }

  async size(): Promise<number> {
    return this.data.size;
  }

  async clear(): Promise<void> {
    this.data.clear();
    this.perEntryBytes.clear();
    this.bytes = 0;
  }

  /** Current approximate-bytes accounting. Useful for tests + diagnostics. */
  approximateBytes(): number {
    return this.bytes;
  }

  /** Total number of LRU evictions since construction. */
  getEvictionCount(): number {
    return this.evictionCount;
  }

  private evictUntilWithinBounds(): void {
    while (this.data.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestEntry = this.data.entries().next();
      if (oldestEntry.done) break;
      const [oldestKey, oldestValue] = oldestEntry.value;
      const entryBytes = this.perEntryBytes.get(oldestKey) ?? 0;
      this.data.delete(oldestKey);
      this.perEntryBytes.delete(oldestKey);
      this.bytes -= entryBytes;
      this.evictionCount++;
      if (this.onEvict) this.onEvict(oldestKey, oldestValue);
    }
  }
}
