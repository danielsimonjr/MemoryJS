/**
 * Compressed Cache Utility
 *
 * Provides an LRU cache with automatic compression of old entries.
 * Reduces memory footprint for large knowledge graphs (50k+ entities).
 *
 * Uses synchronous brotli compression/decompression for cache operations
 * to avoid async complexity in hot paths.
 *
 * Phase 3 Sprint 5: Archive & Cache Compression
 *
 * @module utils/compressedCache
 */

import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';
import type { Entity } from '../types/index.js';
import { COMPRESSION_CONFIG } from './constants.js';

/**
 * Internal cache entry structure.
 */
interface CacheEntry {
  /** The entity data (null if compressed) */
  entity: Entity | null;
  /** Whether this entry is compressed */
  compressed: boolean;
  /** Compressed data buffer (only present if compressed) */
  compressedData?: Buffer;
  /** Size of original entity JSON in bytes (for stats) */
  originalSize: number;
  /** Timestamp of last access for LRU eviction */
  lastAccessed: number;
}

/**
 * Options for CompressedCache configuration.
 */
export interface CompressedCacheOptions {
  /**
   * Maximum number of uncompressed (hot) entries to keep.
   * Entries beyond this limit may be compressed.
   * @default 1000
   */
  maxUncompressed?: number;

  /**
   * Time in milliseconds before an entry is eligible for compression.
   * Entries accessed within this time window stay uncompressed.
   * @default 300000 (5 minutes)
   */
  compressionThresholdMs?: number;

  /**
   * Whether to enable automatic compression.
   * If false, entries are never automatically compressed.
   * @default true
   */
  autoCompress?: boolean;

  /**
   * Minimum entry size in bytes before compression is applied.
   * Entries smaller than this are not compressed (overhead exceeds benefit).
   * Phase 12 Sprint 6: Adaptive compression.
   * @default 256
   */
  minCompressionSize?: number;

  /**
   * Minimum compression ratio to keep entry compressed.
   * If compression achieves less than this ratio, entry stays uncompressed.
   * Phase 12 Sprint 6: Adaptive compression.
   * @default 0.7 (30% reduction minimum)
   */
  minCompressionRatio?: number;
}

/**
 * Statistics about the cache state.
 */
export interface CompressedCacheStats {
  /** Total number of entries in the cache */
  total: number;
  /** Number of compressed entries */
  compressed: number;
  /** Number of uncompressed (hot) entries */
  uncompressed: number;
  /** Estimated memory saved by compression in bytes */
  memorySaved: number;
  /** Total original size of all entries in bytes */
  totalOriginalSize: number;
  /** Total compressed size in bytes */
  totalCompressedSize: number;
  /** Cache hit count since creation */
  hits: number;
  /** Cache miss count since creation */
  misses: number;
  /** Number of compressions performed */
  compressions: number;
  /** Number of decompressions performed */
  decompressions: number;
  /** Phase 12 Sprint 6: Number of entries skipped due to size */
  skippedSmallEntries: number;
  /** Phase 12 Sprint 6: Number of entries skipped due to poor ratio */
  skippedPoorRatio: number;
  /** Phase 12 Sprint 6: Average compression ratio (0-1) */
  avgCompressionRatio: number;
  /** Phase 12 Sprint 6: Estimated memory usage in bytes */
  estimatedMemoryBytes: number;
}

/**
 * LRU cache with automatic compression of old entries.
 *
 * Reduces memory footprint by compressing infrequently accessed entries
 * using brotli compression. Hot (recently accessed) entries stay
 * uncompressed for fast access.
 *
 * @example
 * ```typescript
 * const cache = new CompressedCache({
 *   maxUncompressed: 500,
 *   compressionThresholdMs: 60000 // 1 minute
 * });
 *
 * // Store entity
 * cache.set('Alice', { name: 'Alice', entityType: 'person', observations: [] });
 *
 * // Retrieve entity (decompresses if needed)
 * const entity = cache.get('Alice');
 *
 * // Check stats
 * const stats = cache.getStats();
 * console.log(`Memory saved: ${stats.memorySaved} bytes`);
 * ```
 */
export class CompressedCache {
  private _entryMap: Map<string, CacheEntry> = new Map();
  private readonly maxUncompressed: number;
  private readonly compressionThresholdMs: number;
  private readonly autoCompress: boolean;
  // Phase 12 Sprint 6: Adaptive compression options
  private readonly minCompressionSize: number;
  private readonly minCompressionRatio: number;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private compressions: number = 0;
  private decompressions: number = 0;
  // Phase 12 Sprint 6: Adaptive compression stats
  private skippedSmallEntries: number = 0;
  private skippedPoorRatio: number = 0;
  private compressionRatios: number[] = [];

  constructor(options: CompressedCacheOptions = {}) {
    this.maxUncompressed = options.maxUncompressed ?? 1000;
    this.compressionThresholdMs = options.compressionThresholdMs ?? 5 * 60 * 1000;
    this.autoCompress = options.autoCompress ?? true;
    // Phase 12 Sprint 6: Adaptive compression defaults
    this.minCompressionSize = options.minCompressionSize ?? 256;
    this.minCompressionRatio = options.minCompressionRatio ?? 0.7;
  }

  /**
   * Get an entity from the cache.
   *
   * If the entity is compressed, it will be decompressed on access.
   * The entry is marked as recently accessed to prevent re-compression.
   *
   * @param name - Entity name to retrieve
   * @returns The entity if found, undefined otherwise
   */
  get(name: string): Entity | undefined {
    const entry = this._entryMap.get(name);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    this.hits++;
    entry.lastAccessed = Date.now();

    if (entry.compressed && entry.compressedData) {
      // Decompress on access
      try {
        const decompressed = brotliDecompressSync(entry.compressedData);
        entry.entity = JSON.parse(decompressed.toString('utf-8'));
        entry.compressed = false;
        entry.compressedData = undefined;
        this.decompressions++;
      } catch {
        // Decompression failed - remove corrupt entry
        this._entryMap.delete(name);
        return undefined;
      }
    }

    return entry.entity ?? undefined;
  }

  /**
   * Store an entity in the cache.
   *
   * Entries are stored uncompressed initially. Old entries may be
   * compressed automatically based on cache settings.
   *
   * @param name - Entity name (key)
   * @param entity - Entity to store
   */
  set(name: string, entity: Entity): void {
    const jsonStr = JSON.stringify(entity);
    const originalSize = Buffer.byteLength(jsonStr, 'utf-8');

    this._entryMap.set(name, {
      entity,
      compressed: false,
      originalSize,
      lastAccessed: Date.now(),
    });

    if (this.autoCompress) {
      this.maybeCompressOldEntries();
    }
  }

  /**
   * Check if an entity exists in the cache.
   *
   * @param name - Entity name to check
   * @returns True if entity exists in cache
   */
  has(name: string): boolean {
    return this._entryMap.has(name);
  }

  /**
   * Delete an entity from the cache.
   *
   * @param name - Entity name to delete
   * @returns True if entity was deleted, false if not found
   */
  delete(name: string): boolean {
    return this._entryMap.delete(name);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this._entryMap.clear();
    // Don't reset statistics - they track lifetime totals
  }

  /**
   * Get the number of entries in the cache.
   */
  get size(): number {
    return this._entryMap.size;
  }

  /**
   * Get all entity names in the cache.
   */
  keys(): IterableIterator<string> {
    return this._entryMap.keys();
  }

  /**
   * Get comprehensive cache statistics.
   *
   * @returns Statistics about cache state and performance
   */
  getStats(): CompressedCacheStats {
    let compressed = 0;
    let uncompressed = 0;
    let memorySaved = 0;
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    let estimatedMemoryBytes = 0;

    for (const entry of this._entryMap.values()) {
      totalOriginalSize += entry.originalSize;

      if (entry.compressed && entry.compressedData) {
        compressed++;
        totalCompressedSize += entry.compressedData.length;
        estimatedMemoryBytes += entry.compressedData.length;
        // Memory saved = original size - compressed size
        memorySaved += entry.originalSize - entry.compressedData.length;
      } else {
        uncompressed++;
        estimatedMemoryBytes += entry.originalSize;
      }
    }

    // Calculate average compression ratio
    const avgCompressionRatio = this.compressionRatios.length > 0
      ? this.compressionRatios.reduce((a, b) => a + b, 0) / this.compressionRatios.length
      : 0;

    return {
      total: this._entryMap.size,
      compressed,
      uncompressed,
      memorySaved: Math.max(0, memorySaved),
      totalOriginalSize,
      totalCompressedSize,
      hits: this.hits,
      misses: this.misses,
      compressions: this.compressions,
      decompressions: this.decompressions,
      // Phase 12 Sprint 6: Adaptive compression stats
      skippedSmallEntries: this.skippedSmallEntries,
      skippedPoorRatio: this.skippedPoorRatio,
      avgCompressionRatio,
      estimatedMemoryBytes,
    };
  }

  /**
   * Force compression of entries older than the threshold.
   *
   * Called automatically after set() when autoCompress is enabled.
   * Can be called manually to trigger compression on demand.
   *
   * @returns Number of entries compressed
   */
  compressOldEntries(): number {
    return this.maybeCompressOldEntries(true);
  }

  /**
   * Compress old entries if we're over the uncompressed limit.
   *
   * @param force - If true, compress regardless of limit
   * @returns Number of entries compressed
   */
  private maybeCompressOldEntries(force: boolean = false): number {
    // Count uncompressed entries
    let uncompressedCount = 0;
    for (const entry of this._entryMap.values()) {
      if (!entry.compressed) {
        uncompressedCount++;
      }
    }

    // Only compress if over limit (unless forced)
    if (!force && uncompressedCount <= this.maxUncompressed) {
      return 0;
    }

    const now = Date.now();
    let compressedCount = 0;

    // Sort uncompressed entries by last accessed time (oldest first)
    const sortedEntries = [...this._entryMap.entries()]
      .filter(([, e]) => !e.compressed && e.entity !== null)
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

    // Compress oldest entries until we're under the limit
    for (const [, entry] of sortedEntries) {
      // Stop if we've compressed enough
      if (!force && (uncompressedCount - compressedCount) <= this.maxUncompressed) {
        break;
      }

      // Only compress if entry is old enough
      if (now - entry.lastAccessed < this.compressionThresholdMs) {
        continue;
      }

      // Compress the entry
      if (entry.entity) {
        // Phase 12 Sprint 6: Skip small entries (adaptive compression)
        if (entry.originalSize < this.minCompressionSize) {
          this.skippedSmallEntries++;
          continue;
        }

        try {
          const jsonStr = JSON.stringify(entry.entity);
          const compressed = brotliCompressSync(Buffer.from(jsonStr, 'utf-8'), {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: COMPRESSION_CONFIG.BROTLI_QUALITY_CACHE,
            },
          });

          // Phase 12 Sprint 6: Check compression ratio
          const ratio = compressed.length / entry.originalSize;
          if (ratio > this.minCompressionRatio) {
            // Compression didn't achieve enough reduction
            this.skippedPoorRatio++;
            continue;
          }

          // Track compression ratio
          this.compressionRatios.push(ratio);

          entry.compressedData = compressed;
          entry.compressed = true;
          entry.entity = null; // Free memory
          this.compressions++;
          compressedCount++;
        } catch {
          // Compression failed - leave entry uncompressed
          continue;
        }
      }
    }

    return compressedCount;
  }

  /**
   * Decompress all entries in the cache.
   *
   * Useful when preparing for bulk operations or export.
   *
   * @returns Number of entries decompressed
   */
  decompressAll(): number {
    let decompressedCount = 0;

    for (const [name, entry] of this._entryMap) {
      if (entry.compressed && entry.compressedData) {
        try {
          const decompressed = brotliDecompressSync(entry.compressedData);
          entry.entity = JSON.parse(decompressed.toString('utf-8'));
          entry.compressed = false;
          entry.compressedData = undefined;
          this.decompressions++;
          decompressedCount++;
        } catch {
          // Decompression failed - remove corrupt entry
          this._entryMap.delete(name);
        }
      }
    }

    return decompressedCount;
  }

  /**
   * Get all entities from the cache (decompressing as needed).
   *
   * @returns Array of all entities in the cache
   */
  getAllEntities(): Entity[] {
    const entities: Entity[] = [];

    for (const [name] of this._entryMap) {
      const entity = this.get(name);
      if (entity) {
        entities.push(entity);
      }
    }

    return entities;
  }

  /**
   * Iterate over all entries with their compression status.
   *
   * Does not decompress entries - useful for inspection.
   *
   * @yields Entry information without decompressing
   */
  *entries(): IterableIterator<{
    name: string;
    compressed: boolean;
    originalSize: number;
    lastAccessed: number;
  }> {
    for (const [name, entry] of this._entryMap) {
      yield {
        name,
        compressed: entry.compressed,
        originalSize: entry.originalSize,
        lastAccessed: entry.lastAccessed,
      };
    }
  }
}
