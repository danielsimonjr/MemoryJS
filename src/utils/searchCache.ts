/**
 * Search Result Cache
 *
 * Simple LRU-style cache for search results with TTL support.
 * Improves performance for repeated queries without external dependencies.
 *
 * @module utils/searchCache
 */

import type { SearchResult, KnowledgeGraph } from '../types/index.js';

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number;
}

/**
 * Cache statistics for monitoring.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * Simple LRU cache implementation for search results.
 *
 * Features:
 * - Maximum size limit (LRU eviction when full)
 * - TTL-based expiration
 * - Cache statistics tracking
 * - Hash-based key generation from query parameters
 */
export class SearchCache<T = SearchResult[] | KnowledgeGraph> {
  // LRU order is tracked via the Map's own insertion order: the
  // least-recently-used key is the first key in iteration order, and
  // touching a key (delete + re-set) moves it to the end. This makes
  // get/set/cleanup O(1) per key instead of O(n) array splices.
  private cache: Map<string, CacheEntry<T>> = new Map();
  private hits = 0;
  private misses = 0;

  constructor(
    private maxSize: number = 500,
    private ttlMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {}

  /**
   * Generate cache key from query parameters.
   */
  private generateKey(params: Record<string, unknown>): string {
    // Sort keys for consistent hashing
    const sorted = Object.keys(params)
      .sort()
      .map(key => `${key}:${JSON.stringify(params[key])}`)
      .join('|');
    return sorted;
  }

  /**
   * Get value from cache.
   *
   * @param params - Query parameters to generate cache key
   * @returns Cached value or undefined if not found/expired
   */
  get(params: Record<string, unknown>): T | undefined {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check expiration
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access order (move to end = most recently used).
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;

    return entry.value;
  }

  /**
   * Set value in cache.
   *
   * @param params - Query parameters to generate cache key
   * @param value - Value to cache
   */
  set(params: Record<string, unknown>, value: T): void {
    const key = this.generateKey(params);

    // delete-then-set moves an existing key to the end of the Map's
    // insertion order, which is the LRU order. `delete` returns whether
    // the key existed.
    const hadKey = this.cache.delete(key);

    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize && !hadKey) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    // Add new entry
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Invalidate all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Reset cache statistics.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Clean up expired entries.
   *
   * Should be called periodically to prevent memory buildup.
   */
  cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Check if cache has entry for params.
   */
  has(params: Record<string, unknown>): boolean {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);

    if (!entry) return false;

    // Check expiration
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

/**
 * Global search caches for different search types.
 */
export const searchCaches = {
  basic: new SearchCache<KnowledgeGraph>(),
  ranked: new SearchCache<SearchResult[]>(),
  boolean: new SearchCache<KnowledgeGraph>(),
  fuzzy: new SearchCache<KnowledgeGraph>(),
};

/**
 * Clear all search caches.
 *
 * Should be called when graph is modified to ensure cache consistency.
 */
export function clearAllSearchCaches(): void {
  searchCaches.basic.clear();
  searchCaches.ranked.clear();
  searchCaches.boolean.clear();
  searchCaches.fuzzy.clear();
}

/**
 * Get combined statistics for all caches.
 */
export function getAllCacheStats(): Record<string, CacheStats> {
  return {
    basic: searchCaches.basic.getStats(),
    ranked: searchCaches.ranked.getStats(),
    boolean: searchCaches.boolean.getStats(),
    fuzzy: searchCaches.fuzzy.getStats(),
  };
}

/**
 * Clean up expired entries in all caches.
 */
export function cleanupAllCaches(): void {
  searchCaches.basic.cleanupExpired();
  searchCaches.ranked.cleanupExpired();
  searchCaches.boolean.cleanupExpired();
  searchCaches.fuzzy.cleanupExpired();
}
