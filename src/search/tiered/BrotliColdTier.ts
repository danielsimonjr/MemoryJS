/**
 * BrotliColdTier — Brotli-compressed JSONL shard `IIndexTier<string, V>`
 *
 * Third tier in the tiered index. Stores the long tail of evicted entries
 * in a *single* Brotli-compressed file on disk. Reads decompress the whole
 * shard once (cached in memory afterwards). Writes recompress and rewrite the
 * entire file via temp+fsync+rename. The cold tier holds rarely read entries,
 * so the cost of a full rewrite is paid for by the smaller file.
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
import { compress, decompress } from '../../utils/compressionUtil.js';
import { durableWriteFile } from '../../utils/durableWriteFile.js';
import { MapFileTier } from './MapFileTier.js';

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

/**
 * Brotli-compressed cold tier. The whole shard is a single
 * brotli-compressed JSONL stream. Mutations recompress + rewrite the
 * entire file; reads decompress once and cache the parsed map.
 *
 * Assumes a single writer at a time — concurrent mutations from
 * separate processes against the same shard path will produce lost
 * writes. In-process operations are serialized across all keys, including reads
 * and reloads, so overlapping callers observe only committed state.
 *
 * @example
 * ```typescript
 * const tier = new BrotliColdTier<PostingList>({ filePath: './index-cold.br' });
 * await tier.put('alice', postingList);
 * const got = await tier.get('alice');
 * const bytes = await tier.compressedBytes();
 * ```
 */
export class BrotliColdTier<V> extends MapFileTier<V> {
  readonly name: string;
  protected readonly filePath: string;
  private readonly quality: number;

  constructor(options: BrotliColdTierOptions) {
    super();
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

  async put(key: string, value: V): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const cache = await this.ensureLoaded();
      // A failed flush restores the previous value of the key, so the cache
      // matches the file.
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
    });
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

  protected warnPrefix(): string {
    return 'BrotliColdTier';
  }

  /**
   * Reads and decompresses the shard. A missing file gives null, and a zero-byte
   * file gives an empty text. Neither case invokes the decoder.
   */
  protected async readContent(): Promise<string | null> {
    let compressed: Buffer;
    try {
      compressed = await fs.readFile(this.filePath);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
    if (compressed.length === 0) {
      return '';
    }
    const decompressed = await decompress(compressed);
    return decompressed.toString('utf-8');
  }

  /**
   * Compresses the JSONL text as one stream and writes it durably. Empty
   * text becomes a zero-byte file, so that `compressedBytes()` reports 0 and
   * the reader does not invoke the decoder.
   */
  protected async writeContent(content: string): Promise<void> {
    let payload: Buffer;
    if (content.length === 0) {
      payload = Buffer.alloc(0);
    } else {
      const result = await compress(content, { quality: this.quality });
      payload = result.compressed;
    }
    await durableWriteFile(this.filePath, payload);
  }
}
