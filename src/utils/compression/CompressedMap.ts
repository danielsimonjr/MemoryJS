/**
 * CompressedMap<K, V> — Hot/Cold Tiered Map with Compression
 *
 * Phase 10 task 76 (§3.4). A Map-like container that keeps a small
 * working set ("hot") uncompressed for fast access and compresses
 * the rest ("cold") via an `ICompressionAdapter`. Cold entries are
 * decompressed lazily on `get` and promoted back to the hot tier.
 *
 * **Why two tiers?** Compress/decompress is cheap but not free.
 * A naive "compress everything" map pays a CPU hit on every
 * read; a "compress nothing" map gives up the memory savings
 * that are the whole point. The hot tier bounds the number of
 * uncompressed entries while letting the working set live
 * uncompressed.
 *
 * **LRU policy.** Hot eviction uses Map insertion order — the
 * oldest-inserted entry is demoted to cold. `set(k, v)` for an
 * existing hot key moves it to the end (most-recent) by
 * deleting + re-inserting; `get(k)` of a cold key promotes it.
 * Pure-read recency is *not* tracked separately; this matches
 * the spec ("oldest by insertion order — Map iteration order")
 * and keeps the implementation honest about what insertion
 * order actually means.
 *
 * @module utils/compression/CompressedMap
 * @experimental Hot-threshold defaults and promotion policy may
 *   tune based on Phase 10 task 77 benchmark results.
 */

import {
  type ICompressionAdapter,
  ZlibCompressionAdapter,
} from './ICompressionAdapter.js';

export interface CompressedMapOptions<V = unknown> {
  /** Number of recent unique keys to keep uncompressed. Default: 1000. */
  hotThreshold?: number;
  /** Adapter for compressing cold entries. Default: ZlibCompressionAdapter. */
  adapter?: ICompressionAdapter;
  /**
   * Function that serializes V to a string before compression. Default:
   * JSON.stringify. Callers with knowledge of their V (e.g. already-
   * serialized strings) can pass `(v) => v as string` to skip the
   * extra JSON round-trip.
   */
  serialize?: (value: V) => string;
  /** Reverse of `serialize`. Default: JSON.parse. */
  deserialize?: (raw: string) => V;
}

export class CompressedMap<K, V> {
  private readonly hot: Map<K, V> = new Map();
  private readonly cold: Map<K, Buffer> = new Map();
  private readonly hotThreshold: number;
  private readonly adapter: ICompressionAdapter;
  private readonly serialize: (value: V) => string;
  private readonly deserialize: (raw: string) => V;

  // Maintained incrementally to keep `stats()` O(1). Without this we'd
  // have to walk `cold` and sum buffer lengths on every diagnostic call.
  private coldBytesTotal = 0;

  constructor(options: CompressedMapOptions<V> = {}) {
    const threshold = options.hotThreshold ?? 1000;
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new Error(
        `CompressedMap: hotThreshold must be a positive integer, got ${threshold}`,
      );
    }
    this.hotThreshold = threshold;
    this.adapter = options.adapter ?? new ZlibCompressionAdapter();
    this.serialize =
      options.serialize ?? ((v: V): string => JSON.stringify(v));
    this.deserialize =
      options.deserialize ?? ((raw: string): V => JSON.parse(raw) as V);
  }

  get size(): number {
    return this.hot.size + this.cold.size;
  }

  has(key: K): boolean {
    return this.hot.has(key) || this.cold.has(key);
  }

  get(key: K): V | undefined {
    if (this.hot.has(key)) {
      return this.hot.get(key);
    }
    const compressed = this.cold.get(key);
    if (compressed === undefined) {
      return undefined;
    }
    // Promote: decompress, drop from cold, insert into hot. The hot
    // insertion may trip the threshold and demote some other entry.
    const value = this.deserializeBuffer(compressed);
    this.cold.delete(key);
    this.coldBytesTotal -= compressed.length;
    this.hot.set(key, value);
    this.enforceHotBudget();
    return value;
  }

  set(key: K, value: V): this {
    // A key lives at exactly one tier — drop any prior cold copy
    // before inserting into hot.
    const stale = this.cold.get(key);
    if (stale !== undefined) {
      this.cold.delete(key);
      this.coldBytesTotal -= stale.length;
    }
    // Re-set in hot pushes the key to the back of insertion order,
    // matching the "most recently written" intuition for LRU eviction.
    if (this.hot.has(key)) {
      this.hot.delete(key);
    }
    this.hot.set(key, value);
    this.enforceHotBudget();
    return this;
  }

  delete(key: K): boolean {
    if (this.hot.delete(key)) {
      return true;
    }
    const compressed = this.cold.get(key);
    if (compressed === undefined) {
      return false;
    }
    this.cold.delete(key);
    this.coldBytesTotal -= compressed.length;
    return true;
  }

  clear(): void {
    this.hot.clear();
    this.cold.clear();
    this.coldBytesTotal = 0;
  }

  /** Diagnostic snapshot: counts of hot vs cold entries + approx-bytes savings. */
  stats(): {
    hotCount: number;
    coldCount: number;
    coldBytes: number;
    uncompressedBytesEstimate: number;
  } {
    // Estimate uncompressed size by re-serializing hot values and
    // assuming cold entries would have averaged the same per-entry
    // size if held in hot. This is an estimate, not an audit — the
    // exact pre-compression size is not retained.
    let hotBytes = 0;
    for (const value of this.hot.values()) {
      hotBytes += Buffer.byteLength(this.serialize(value), 'utf8');
    }
    const avgHotEntry = this.hot.size > 0 ? hotBytes / this.hot.size : 0;
    const uncompressedColdEstimate = avgHotEntry * this.cold.size;
    return {
      hotCount: this.hot.size,
      coldCount: this.cold.size,
      coldBytes: this.coldBytesTotal,
      uncompressedBytesEstimate: hotBytes + uncompressedColdEstimate,
    };
  }

  *entries(): IterableIterator<[K, V]> {
    for (const entry of this.hot) {
      yield entry;
    }
    for (const [key, compressed] of this.cold) {
      yield [key, this.deserializeBuffer(compressed)];
    }
  }

  *keys(): IterableIterator<K> {
    for (const key of this.hot.keys()) {
      yield key;
    }
    for (const key of this.cold.keys()) {
      yield key;
    }
  }

  *values(): IterableIterator<V> {
    for (const value of this.hot.values()) {
      yield value;
    }
    for (const compressed of this.cold.values()) {
      yield this.deserializeBuffer(compressed);
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * If the hot tier is over capacity, demote oldest-inserted entries
   * to cold one at a time until back within budget. The loop handles
   * the edge case where multiple promotions / sets stacked up.
   */
  private enforceHotBudget(): void {
    while (this.hot.size > this.hotThreshold) {
      const oldest = this.hot.keys().next();
      if (oldest.done) {
        return;
      }
      const key = oldest.value;
      const value = this.hot.get(key) as V;
      this.hot.delete(key);
      const compressed = this.adapter.compress(
        Buffer.from(this.serialize(value), 'utf8'),
      );
      this.cold.set(key, compressed);
      this.coldBytesTotal += compressed.length;
    }
  }

  private deserializeBuffer(compressed: Buffer): V {
    return this.deserialize(this.adapter.decompress(compressed).toString('utf8'));
  }
}
