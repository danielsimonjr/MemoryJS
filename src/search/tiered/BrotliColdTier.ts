/**
 * BrotliColdTier — Brotli-compressed JSONL shard `IIndexTier<string, V>`
 *
 * Phase 9 task 72 (§1.5) — third tier in the tiered index breakdown.
 * Stores the long tail of evicted entries in a *single* Brotli-
 * compressed file on disk. Reads decompress the whole shard once
 * (cached in memory afterwards); writes recompress + rewrite the
 * entire file via temp+fsync+rename. This deliberately trades write
 * efficiency for compactness — the cold tier is supposed to hold
 * rarely-touched entries, so amortised over many reads the per-write
 * cost is acceptable.
 *
 * Wire format (after Brotli decompression):
 *
 * ```jsonl
 * {"k":"alice","v":[...]}
 * {"k":"bob","v":[...]}
 * ```
 *
 * Each line is a `{ k: string, v: V }` JSON record. The *entire*
 * concatenated JSONL stream is fed to one `compress()` call so we
 * benefit from cross-line dictionary reuse — per-line compression
 * would defeat the point.
 *
 * **No external deps.** Uses `compress` / `decompress` from
 * `src/utils/compressionUtil.ts` (which wraps Node's built-in
 * `zlib.brotliCompress` / `zlib.brotliDecompress`).
 *
 * @module search/tiered/BrotliColdTier
 * @experimental Wire format may grow new optional fields (e.g.
 *   per-entry compression metadata) in non-breaking ways. Existing
 *   shards stay readable. Single-writer only — concurrent processes
 *   against the same shard path will lose writes.
 */

import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import { compress, decompress } from '../../utils/compressionUtil.js';
import type { IIndexTier } from './ITieredIndex.js';

/**
 * Configuration for `BrotliColdTier`.
 */
export interface BrotliColdTierOptions {
  /** Path to the compressed shard file. */
  filePath: string;
  /** Stable name for diagnostics. Default: `'cold'`. */
  name?: string;
  /**
   * Brotli compression quality (0-11). Higher = smaller files,
   * slower writes. Default: 6 (matches
   * `COMPRESSION_CONFIG.BROTLI_QUALITY_BATCH` — a balanced
   * compression-ratio / speed point used elsewhere in the codebase).
   */
  quality?: number;
}

/** One on-disk record after decompression. */
interface ShardLine<V> {
  k: string;
  v: V;
}

/**
 * Brotli-compressed cold tier. The whole shard is a single
 * brotli-compressed JSONL stream. Mutations recompress + rewrite the
 * entire file; reads decompress once and cache the parsed map.
 *
 * Assumes a single writer at a time — concurrent mutations from
 * separate processes against the same shard path will produce lost
 * writes. In-process callers are fine because every mutation is
 * awaited end-to-end.
 *
 * @example
 * ```typescript
 * const tier = new BrotliColdTier<PostingList>({ filePath: './index-cold.br' });
 * await tier.put('alice', postingList);
 * const got = await tier.get('alice');
 * const bytes = await tier.compressedBytes();
 * ```
 */
export class BrotliColdTier<V> implements IIndexTier<string, V> {
  readonly name: string;
  private readonly filePath: string;
  private readonly quality: number;

  // Lazy cache: null = not yet loaded; populated on first read/write.
  // Once loaded, the map IS the in-memory view of the shard. Flushes
  // rewrite the file from this map.
  private cache: Map<string, V> | null = null;

  constructor(options: BrotliColdTierOptions) {
    if (typeof options.filePath !== 'string' || options.filePath.length === 0) {
      throw new Error('BrotliColdTier: `filePath` is required');
    }
    const quality = options.quality ?? 6;
    if (!Number.isInteger(quality) || quality < 0 || quality > 11) {
      throw new Error(
        `BrotliColdTier: invalid quality ${quality}. Must be an integer 0-11.`,
      );
    }
    this.filePath = options.filePath;
    this.name = options.name ?? 'cold';
    this.quality = quality;
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
    // Snapshot prior state so the cache rolls back if the disk flush
    // fails — without this, the in-memory cache would be the new
    // value while disk holds the old one, and a process restart
    // (which re-reads disk) would silently lose the write.
    const hadPrior = cache.has(key);
    const priorValue = hadPrior ? cache.get(key)! : undefined;
    cache.set(key, value);
    try {
      await this.flush(cache);
    } catch (err) {
      if (hadPrior) cache.set(key, priorValue!);
      else cache.delete(key);
      throw err;
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
    // Snapshot the whole map so a flush failure restores every
    // entry. Matches the rollback semantics of `put` and `delete`.
    const priorSnapshot = new Map(cache);
    cache.clear();
    try {
      await this.flush(cache);
    } catch (err) {
      for (const [k, v] of priorSnapshot) cache.set(k, v);
      throw err;
    }
  }

  /**
   * Drop the in-memory cache so the next read pulls from disk. Used
   * by callers that know an external process modified the shard
   * while we held a stale snapshot. Cheap — the next `ensureLoaded`
   * call re-reads + re-decompresses lazily.
   */
  async reload(): Promise<void> {
    this.cache = null;
  }

  /**
   * Number of bytes the on-disk shard takes after the last flush.
   * Returns `0` when the shard file does not yet exist (no writes
   * have been flushed). Useful for monitoring + tests that assert
   * compression effectiveness.
   */
  async compressedBytes(): Promise<number> {
    try {
      const stat = await fs.stat(this.filePath);
      return stat.size;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Lazy-load the shard on first read/write. After load the cache
   * is the authoritative in-memory view — subsequent calls return
   * it directly without touching disk.
   */
  private async ensureLoaded(): Promise<Map<string, V>> {
    if (this.cache !== null) {
      return this.cache;
    }
    this.cache = await this.loadFromDisk();
    return this.cache;
  }

  /**
   * Read the compressed shard, decompress it, and parse the JSONL.
   * Missing file = empty map (no throw — the caller's first write
   * will create the file). Malformed lines are warned about and
   * skipped so a single bad record can't poison the whole tier.
   */
  private async loadFromDisk(): Promise<Map<string, V>> {
    const map = new Map<string, V>();
    let compressed: Buffer;
    try {
      compressed = await fs.readFile(this.filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return map;
      }
      throw error;
    }
    if (compressed.length === 0) {
      return map;
    }
    const decompressed = await decompress(compressed);
    const raw = decompressed.toString('utf-8');
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as ShardLine<V>;
        if (typeof parsed.k !== 'string') {
          logger.warn(
            `BrotliColdTier: skipping line with non-string key in ${this.filePath}`,
          );
          continue;
        }
        map.set(parsed.k, parsed.v);
      } catch {
        logger.warn(
          `BrotliColdTier: skipping malformed line in ${this.filePath}`,
        );
      }
    }
    return map;
  }

  /**
   * Serialise the cache to JSONL, brotli-compress the whole stream
   * as a unit (so adjacent lines share dictionary state), and
   * durably write it to disk via temp+fsync+rename.
   */
  private async flush(cache: Map<string, V>): Promise<void> {
    const lines: string[] = [];
    for (const [k, v] of cache) {
      lines.push(JSON.stringify({ k, v }));
    }
    const content = lines.length === 0 ? '' : lines.join('\n') + '\n';
    let payload: Buffer;
    if (content.length === 0) {
      // Compressing empty input still produces a non-empty brotli
      // frame; we'd rather write a zero-byte file for the empty
      // case so `compressedBytes()` reports 0 and `loadFromDisk`'s
      // short-circuit catches it without invoking the decoder.
      payload = Buffer.alloc(0);
    } else {
      const result = await compress(content, { quality: this.quality });
      payload = result.compressed;
    }
    await this.durableWriteFile(payload);
  }

  /**
   * Atomic write via temp file + fsync + rename. Mirrors
   * `JsonlColumnStore.durableWriteFile`, including the Windows EPERM
   * fallback that writes directly to the target if rename fails
   * (Dropbox / antivirus can hold a brief lock on the temp file
   * making `fs.rename` reject with EPERM).
   */
  private async durableWriteFile(content: Buffer): Promise<void> {
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
    const fd = await fs.open(tmpPath, 'w');
    try {
      await fd.write(content);
      await fd.sync();
    } finally {
      await fd.close();
    }
    try {
      await fs.rename(tmpPath, this.filePath);
    } catch {
      // Windows fallback — direct write to the target. Matches the
      // `JsonlColumnStore` recovery path so any caller that tested
      // their flush-failure handling against that store sees the
      // same shape here.
      const fallbackFd = await fs.open(this.filePath, 'w');
      try {
        await fallbackFd.write(content);
        await fallbackFd.sync();
      } finally {
        await fallbackFd.close();
      }
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* ignore — best-effort cleanup of the orphan tmp file */
      }
    }
  }
}
