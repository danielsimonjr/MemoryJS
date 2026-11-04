/**
 * DiskWarmTier — JSONL-sidecar-backed `IIndexTier<string, V>`
 *
 * Middle tier in the three-tier index chain. Persists every (key, value)
 * pair as a single JSONL line in a sidecar file.
 *
 * By default the whole sidecar is rewritten on every mutation via temp-file +
 * fsync + rename. With `compactEvery` set, a `put` or `delete` appends one
 * line (fsynced) instead, and the full rewrite runs once every `compactEvery`
 * appended records to reclaim superseded lines.
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
 * **Append mode (`compactEvery`).** A `put` appends `{"k":key,"v":value}`; a
 * `delete` or an eviction appends a tombstone `{"k":key,"d":1}`. The loader
 * applies lines in order, so the last write wins and a tombstone removes the
 * key. The file after a full rewrite is the same bytes as the default mode
 * writes for the same entries. A crash can leave a torn final line. The loader
 * skips it, and the next append starts on a new line so it cannot merge with
 * the torn text. Between full rewrites the appended lines are durable (fsynced)
 * but a crash can lose the last unacknowledged append.
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
import { durableAppendFile, durableWriteFile } from '../../utils/durableWriteFile.js';
import { MapFileTier, TOMBSTONE_FIELD } from './MapFileTier.js';

/** One `{"k","v"}` line, in the same shape `serializeJsonlMap` writes. */
function serializeRecord<V>(key: string, value: V): string {
  return JSON.stringify({ k: key, v: value });
}

/** One tombstone line that removes `key` on load. */
function tombstone(key: string): string {
  return JSON.stringify({ k: key, [TOMBSTONE_FIELD]: 1 });
}

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
  /**
   * Append mode. When set to a positive integer, writes append one record and
   * a full rewrite runs once `compactEvery` records have been appended since
   * the last rewrite. Default: `undefined`, which rewrites the whole file on
   * every mutation.
   */
  compactEvery?: number;
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
  private readonly compactEvery: number | undefined;
  private evictionCount = 0;
  /** Records appended since the last full rewrite (plus superseded lines found on load). */
  private appendedRecords = 0;
  /** Non-blank line count of the file as last read. Used to seed `appendedRecords`. */
  private loadedLineCount = 0;
  /** True when the file's last byte is not a newline (a torn tail). */
  private tailNeedsNewline = false;

  constructor(options: DiskWarmTierOptions<V>) {
    super();
    if (options.maxEntries !== undefined &&
        (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 0)) {
      throw new RangeError('DiskWarmTier: maxEntries must be a non-negative safe integer');
    }
    if (options.compactEvery !== undefined &&
        (!Number.isSafeInteger(options.compactEvery) || options.compactEvery < 1)) {
      throw new RangeError('DiskWarmTier: compactEvery must be a positive safe integer');
    }
    this.filePath = options.filePath;
    this.name = options.name ?? 'warm';
    this.maxEntries = options.maxEntries;
    this.onEvict = options.onEvict;
    this.compactEvery = options.compactEvery;
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
        if (this.compactEvery === undefined) {
          await this.flush(cache);
        } else {
          const records = [serializeRecord(key, value), ...evicted.map(e => tombstone(e.k))];
          await this.appendOrCompact(cache, records);
        }
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

  protected override async persistDelete(cache: Map<string, V>, key: string): Promise<void> {
    if (this.compactEvery === undefined) {
      await this.flush(cache);
      return;
    }
    await this.appendOrCompact(cache, [tombstone(key)]);
  }

  /**
   * Appends `records` to the file, or rewrites the whole file from `cache`
   * when the append would reach `compactEvery`. Caller holds the lock and
   * restores `cache` if this throws.
   */
  private async appendOrCompact(cache: Map<string, V>, records: string[]): Promise<void> {
    const limit = this.compactEvery!;
    if (this.appendedRecords + records.length >= limit) {
      // The rewrite already holds the new state, so the records are not written.
      await this.flush(cache);
      return;
    }
    const prefix = this.tailNeedsNewline ? '\n' : '';
    try {
      await durableAppendFile(this.filePath, prefix + records.map(r => r + '\n').join(''));
    } catch (err) {
      // A failed append can leave a partial line, so the next append starts a new line.
      this.tailNeedsNewline = true;
      throw err;
    }
    this.tailNeedsNewline = false;
    this.appendedRecords += records.length;
  }

  /** Eviction count for diagnostics. */
  getEvictionCount(): number {
    return this.evictionCount;
  }

  protected warnPrefix(): string {
    return `DiskWarmTier(${this.name})`;
  }

  protected async readContent(): Promise<string | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.tailNeedsNewline = false;
        this.loadedLineCount = 0;
        return null;
      }
      throw error;
    }
    this.tailNeedsNewline = raw.length > 0 && !raw.endsWith('\n');
    this.loadedLineCount = raw.split('\n').filter(line => line.trim() !== '').length;
    return raw;
  }

  protected override async ensureLoaded(): Promise<Map<string, V>> {
    const wasLoaded = this.cache !== null;
    const cache = await super.ensureLoaded();
    if (!wasLoaded) {
      // Lines beyond the live entries are superseded records that a rewrite would drop.
      this.appendedRecords = Math.max(0, this.loadedLineCount - cache.size);
    }
    return cache;
  }

  protected async writeContent(content: string): Promise<void> {
    await durableWriteFile(this.filePath, content);
    this.appendedRecords = 0;
    this.tailNeedsNewline = false;
  }
}
