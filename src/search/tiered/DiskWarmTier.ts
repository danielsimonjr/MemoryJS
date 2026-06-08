/**
 * DiskWarmTier — JSONL-sidecar-backed `IIndexTier<string, V>`
 *
 * Phase 9 task 71 (§1.5) — middle tier in the three-tier index chain.
 * Persists every (key, value) pair as a single JSONL line in a sidecar
 * file. The whole sidecar is rewritten on every mutation via temp-file
 * + fsync + rename — same correctness/efficiency trade-off as
 * `JsonlColumnStore` (Phase 8 task 65). Per-entry append + periodic
 * compaction is a follow-up if profiling demands it.
 *
 * Wire format (one JSON object per line):
 *
 * ```jsonl
 * {"k":"alice","v":{"postings":[1,4,7]}}
 * {"k":"bob","v":{"postings":[2]}}
 * ```
 *
 * `v` is `V` JSON-encoded — first user is the inverted-index posting
 * list shape, but the class is generic over V.
 *
 * **Keys are `string` only.** The warm tier is keyed by stringified
 * entity name / search term throughout the inverted-index callers, and
 * supporting generic `K` would require a serialization adapter we
 * don't have yet. Lift this to generic `K` if a future caller needs
 * non-string keys.
 *
 * **Eviction wires to the cold tier.** When `maxEntries` is set, the
 * oldest entry (by Map insertion order) is dropped via `onEvict` once
 * a `put` pushes the tier over its bound. Callers wire `onEvict` to
 * the cold tier's `put` to spill the long tail.
 *
 * @module search/tiered/DiskWarmTier
 * @experimental Wire format may grow new optional sidecar fields
 *   (e.g. per-entry timestamps for true on-disk LRU) in non-breaking
 *   ways. Existing sidecars stay readable. Single-writer only —
 *   concurrent processes against the same sidecar are not supported.
 */

import { promises as fs } from 'fs';
import { logger } from '../../utils/logger.js';
import { durableWriteFile } from '../../utils/durableWriteFile.js';
import type { IIndexTier } from './ITieredIndex.js';

interface SidecarLine<V> {
  k: string;
  v: V;
}

export interface DiskWarmTierOptions<V> {
  /** Sidecar file path. */
  filePath: string;
  /** Stable name for diagnostics. Default: `'warm'`. */
  name?: string;
  /**
   * Optional bound on entries kept in the warm tier. When set,
   * `put` evicts the oldest (by insertion order) entries via
   * `onEvict` once over the bound. Default: unbounded.
   */
  maxEntries?: number;
  /** Eviction callback (wires to cold tier). */
  onEvict?: (key: string, value: V) => void;
}

/**
 * Durable JSONL-backed warm tier.
 *
 * @example
 * ```typescript
 * const warm = new DiskWarmTier<number[]>({
 *   filePath: './memory-warm.jsonl',
 *   maxEntries: 10_000,
 *   onEvict: (k, v) => cold.put(k, v),
 * });
 * await warm.put('alice', [1, 4, 7]);
 * const posting = await warm.get('alice');
 * ```
 */
export class DiskWarmTier<V> implements IIndexTier<string, V> {
  readonly name: string;
  private readonly filePath: string;
  private readonly maxEntries: number | undefined;
  private readonly onEvict: ((key: string, value: V) => void) | undefined;
  private cache: Map<string, V> | null = null;
  private evictionCount = 0;

  constructor(options: DiskWarmTierOptions<V>) {
    this.filePath = options.filePath;
    this.name = options.name ?? 'warm';
    this.maxEntries = options.maxEntries;
    this.onEvict = options.onEvict;
  }

  async get(key: string): Promise<V | undefined> {
    const cache = await this.ensureLoaded();
    return cache.get(key);
  }

  async has(key: string): Promise<boolean> {
    const cache = await this.ensureLoaded();
    return cache.has(key);
  }

  async put(key: string, value: V): Promise<void> {
    const cache = await this.ensureLoaded();
    // Snapshot the WHOLE map before mutating. Restoring entry-by-
    // entry from collected diffs (the prior implementation) lost the
    // original LRU position of `key` when `hadPrior` was true — a
    // later eviction round would target the wrong oldest. A full
    // snapshot pays GC cost only on the rare error path but
    // guarantees byte-exact rollback including insertion order
    // (review #2).
    const snapshot = new Map(cache);

    const hadPrior = cache.has(key);
    // Re-inserting refreshes Map insertion order so LRU eviction
    // targets the genuinely-oldest key.
    if (hadPrior) cache.delete(key);
    cache.set(key, value);

    // Collect evictees before flush so we can fire their callbacks
    // post-flush (and so the snapshot rollback can leave them
    // un-evicted on failure).
    const evicted: Array<{ k: string; v: V }> = [];
    if (this.maxEntries !== undefined) {
      while (cache.size > this.maxEntries) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        const oldestValue = cache.get(oldest)!;
        cache.delete(oldest);
        evicted.push({ k: oldest, v: oldestValue });
      }
    }

    try {
      await this.flush(cache);
    } catch (err) {
      // Restore from the upfront snapshot — guarantees pre-mutation
      // LRU order, no entry-by-entry reconstruction needed.
      cache.clear();
      for (const [k, v] of snapshot) cache.set(k, v);
      throw err;
    }

    // Fire eviction callbacks only after the flush has durably landed.
    // If a callback throws we still count the eviction — disk is the
    // source of truth and the entry is gone for good.
    for (const { k, v } of evicted) {
      this.evictionCount++;
      if (this.onEvict) {
        try {
          this.onEvict(k, v);
        } catch (cbErr) {
          logger.warn(`DiskWarmTier(${this.name}): onEvict callback threw`, cbErr);
        }
      }
    }
  }

  async delete(key: string): Promise<boolean> {
    const cache = await this.ensureLoaded();
    if (!cache.has(key)) return false;
    const priorValue = cache.get(key)!;
    cache.delete(key);
    try {
      await this.flush(cache);
    } catch (err) {
      cache.set(key, priorValue);
      throw err;
    }
    return true;
  }

  async size(): Promise<number> {
    const cache = await this.ensureLoaded();
    return cache.size;
  }

  async clear(): Promise<void> {
    const cache = await this.ensureLoaded();
    if (cache.size === 0) return;
    const priorSnapshot = new Map(cache);
    cache.clear();
    try {
      await this.flush(cache);
    } catch (err) {
      for (const [k, v] of priorSnapshot) cache.set(k, v);
      throw err;
    }
  }

  /** Eviction count for diagnostics. */
  getEvictionCount(): number {
    return this.evictionCount;
  }

  /**
   * Drop the in-memory cache so the next read picks up external
   * edits. Cheap — `ensureLoaded` re-parses the sidecar lazily.
   */
  async reload(): Promise<void> {
    this.cache = null;
  }

  private async ensureLoaded(): Promise<Map<string, V>> {
    if (this.cache !== null) {
      return this.cache;
    }
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  private async loadFromDisk(): Promise<Map<string, V>> {
    const map = new Map<string, V>();
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return map;
      }
      throw error;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as SidecarLine<V>;
        if (typeof parsed.k !== 'string') {
          logger.warn(`DiskWarmTier(${this.name}): skipping line with non-string key in ${this.filePath}`);
          continue;
        }
        map.set(parsed.k, parsed.v);
      } catch {
        logger.warn(`DiskWarmTier(${this.name}): skipping malformed line in ${this.filePath}`);
      }
    }
    return map;
  }

  private async flush(cache: Map<string, V>): Promise<void> {
    const lines: string[] = [];
    for (const [k, v] of cache) {
      lines.push(JSON.stringify({ k, v }));
    }
    const content = lines.length === 0 ? '' : lines.join('\n') + '\n';
    await durableWriteFile(this.filePath, content);
  }
}
