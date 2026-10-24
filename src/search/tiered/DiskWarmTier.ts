/**
 * DiskWarmTier — JSONL-sidecar-backed `IIndexTier<string, V>`
 *
 * Middle tier in the three-tier index chain. Persists every (key, value)
 * pair as a single JSONL line in a sidecar file. The whole sidecar is
 * rewritten on every mutation via temp-file + fsync + rename, the same
 * trade-off as `JsonlColumnStore`. Per-entry append with periodic
 * compaction is not implemented.
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
import { MapFileTier } from './MapFileTier.js';

/**
 * Options for `DiskWarmTier`: sidecar file path, name, entry bound and eviction callback.
 */
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
export class DiskWarmTier<V> extends MapFileTier<V> {
  readonly name: string;
  protected readonly filePath: string;
  private readonly maxEntries: number | undefined;
  private readonly onEvict: ((key: string, value: V) => void) | undefined;
  private evictionCount = 0;

  constructor(options: DiskWarmTierOptions<V>) {
    super();
    if (options.maxEntries !== undefined &&
        (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 0)) {
      throw new RangeError('DiskWarmTier: maxEntries must be a non-negative safe integer');
    }
    this.filePath = options.filePath;
    this.name = options.name ?? 'warm';
    this.maxEntries = options.maxEntries;
    this.onEvict = options.onEvict;
  }

  async put(key: string, value: V): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      // The whole map is copied before any change. A copy restores the
      // entries and their insertion order byte for byte when the flush fails.
      const snapshot = new Map(cache);

      const hadPrior = cache.has(key);
      // Re-inserting moves the key to the end of the insertion order, so that
      // LRU eviction targets the oldest key.
      if (hadPrior) cache.delete(key);
      cache.set(key, value);

      // Collect the evicted entries before the flush. Their callbacks run after
      // the flush has landed. A failed flush then leaves them in the tier.
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
    });
  }

  /** Eviction count for diagnostics. */
  getEvictionCount(): number {
    return this.evictionCount;
  }

  protected warnPrefix(): string {
    return `DiskWarmTier(${this.name})`;
  }

  protected async readContent(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  protected async writeContent(content: string): Promise<void> {
    await durableWriteFile(this.filePath, content);
  }
}
