/**
 * Embedding Cache
 *
 * Phase 12 Sprint 5: LRU cache for embedding vectors with hit/miss tracking,
 * auto-invalidation on text hash changes, and TTL support.
 *
 * @module search/EmbeddingCache
 */

import { createHash } from 'crypto';

/**
 * Cache entry for embedding vectors.
 */
interface CacheEntry {
  /** The embedding vector */
  vector: number[];
  /** Hash of the original text for invalidation */
  textHash: string;
  /** Timestamp when the entry was created (for TTL) */
  createdAt: number;
  /** Timestamp of last access (for LRU) */
  lastAccess: number;
}

/**
 * Statistics for the embedding cache.
 */
export interface EmbeddingCacheStats {
  /** Number of entries in the cache */
  size: number;
  /** Estimated memory usage in bytes */
  memoryBytes: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
}

/**
 * Options for EmbeddingCache.
 */
export interface EmbeddingCacheOptions {
  /** Maximum number of entries in the cache (default: 1000) */
  maxSize?: number;
  /** Time-to-live in milliseconds (default: 3600000 = 1 hour) */
  ttlMs?: number;
  /** Dimensions of embedding vectors for memory estimation (default: 384) */
  dimensions?: number;
}

/**
 * Default cache options.
 */
export const DEFAULT_EMBEDDING_CACHE_OPTIONS: Required<EmbeddingCacheOptions> = {
  maxSize: 1000,
  ttlMs: 3600000, // 1 hour
  dimensions: 384,
};

/**
 * LRU cache for embedding vectors with hit/miss tracking.
 *
 * Features:
 * - LRU eviction when max size is reached
 * - Text hash-based invalidation (detects stale entries)
 * - TTL support for automatic expiration
 * - Hit/miss statistics tracking
 *
 * @example
 * ```typescript
 * const cache = new EmbeddingCache({ maxSize: 500, ttlMs: 60000 });
 *
 * // Cache an embedding
 * cache.set('entity1', 'Original text content', [0.1, 0.2, ...]);
 *
 * // Retrieve from cache
 * const result = cache.get('entity1', 'Original text content');
 * if (result) {
 *   console.log('Cache hit!', result);
 * }
 *
 * // Check stats
 * console.log(cache.getStats()); // { size, memoryBytes, hitRate, hits, misses }
 * ```
 */
export class EmbeddingCache {
  private cache: Map<string, CacheEntry>;
  private options: Required<EmbeddingCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  /**
   * Create a new embedding cache.
   *
   * @param options - Cache configuration options
   */
  constructor(options?: EmbeddingCacheOptions) {
    this.options = { ...DEFAULT_EMBEDDING_CACHE_OPTIONS, ...options };
    this.cache = new Map();
  }

  /**
   * Hash a text string for cache invalidation.
   *
   * @param text - Text to hash
   * @returns MD5 hash of the text
   */
  private hashText(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  /**
   * Check if an entry is expired based on TTL.
   *
   * @param entry - Cache entry to check
   * @returns True if expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt > this.options.ttlMs;
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Get an embedding from the cache.
   *
   * Returns null if:
   * - Key not found
   * - Entry is expired (TTL)
   * - Text hash doesn't match (content changed)
   *
   * @param key - Cache key (typically entity name)
   * @param text - Current text content (for hash validation)
   * @returns Embedding vector if found and valid, null otherwise
   */
  get(key: string, text: string): number[] | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Check text hash for invalidation
    const currentHash = this.hashText(text);
    if (entry.textHash !== currentHash) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Update last access time
    entry.lastAccess = Date.now();
    this.hits++;

    return entry.vector;
  }

  /**
   * Set an embedding in the cache.
   *
   * Automatically evicts LRU entries if max size is reached.
   *
   * @param key - Cache key (typically entity name)
   * @param text - Text content (used for hash-based invalidation)
   * @param vector - Embedding vector to cache
   */
  set(key: string, text: string, vector: number[]): void {
    // Evict if at capacity and not updating existing key
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      vector,
      textHash: this.hashText(text),
      createdAt: now,
      lastAccess: now,
    });
  }

  /**
   * Check if a key exists in the cache (without affecting hit/miss stats).
   *
   * @param key - Cache key to check
   * @returns True if key exists (may be expired or stale)
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete an entry from the cache.
   *
   * @param key - Cache key to delete
   * @returns True if entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics including size, memory usage, and hit rate
   */
  getStats(): EmbeddingCacheStats {
    const size = this.cache.size;
    // Estimate memory: each entry has vector (dimensions * 8 bytes for float64)
    // plus overhead for hash (~32 bytes), timestamps (~16 bytes), and Map overhead (~50 bytes)
    const memoryPerEntry = this.options.dimensions * 8 + 32 + 16 + 50;
    const memoryBytes = size * memoryPerEntry;

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      size,
      memoryBytes,
      hitRate,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Reset hit/miss statistics (useful for benchmarks).
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Remove expired entries from the cache.
   *
   * Called automatically during get operations, but can be
   * manually triggered for maintenance.
   *
   * @returns Number of entries removed
   */
  pruneExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get the current cache size.
   *
   * @returns Number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all cached keys.
   *
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Update options dynamically.
   *
   * Note: Reducing maxSize will not immediately evict entries.
   *
   * @param options - New options to apply
   */
  updateOptions(options: Partial<EmbeddingCacheOptions>): void {
    this.options = { ...this.options, ...options };
  }
}
