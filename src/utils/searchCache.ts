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
 * Graph mutation generation counters (S6 — search-cache invalidation
 * granularity).
 *
 * Storages bump these monotonic counters on every logical mutation instead
 * of eagerly clearing every search cache:
 * - `bumpEntityGeneration()` — any write that changes entity data
 *   (create/update/delete, including entity timestamp bumps)
 * - `bumpRelationGeneration()` — any write that changes relation data
 *
 * `SearchCache` instances that declare `generationDeps` record the counter
 * values at insert time and lazily treat an entry as stale on `get()` when
 * a depended-on counter has moved. This lets e.g. relation-only writes
 * leave entity-text-only caches (ranked search) intact.
 *
 * Counters are module-global (like the `searchCaches` singletons they
 * guard), so multiple storage instances in one process over-invalidate
 * across each other — exactly the same behavior the previous global
 * `clearAllSearchCaches()` calls had.
 *
 * `clearAllSearchCaches()` is retained for explicit full clears
 * (full-graph saves, CLI cache clear, tests).
 */
export type GraphGenerationDependency = 'entity' | 'relation';

let entityGeneration = 0;
let relationGeneration = 0;

/** Bump the entity-data mutation generation (call on any entity write). */
export function bumpEntityGeneration(): void {
  entityGeneration++;
}

/** Bump the relation-data mutation generation (call on any relation write). */
export function bumpRelationGeneration(): void {
  relationGeneration++;
}

/** Current generation counter values (diagnostics / tests). */
export function getGraphGenerations(): { entity: number; relation: number } {
  return { entity: entityGeneration, relation: relationGeneration };
}

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number;
  /** Entity generation at insert (only set when the cache depends on it). */
  entityGen?: number;
  /** Relation generation at insert (only set when the cache depends on it). */
  relationGen?: number;
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

  /**
   * Which graph mutation generations this cache's entries depend on.
   * Empty (the default) means pure TTL semantics — identical to the
   * pre-S6 behavior for privately constructed caches. The global
   * `searchCaches` declare their dependencies explicitly.
   */
  private readonly generationDeps: ReadonlyArray<GraphGenerationDependency>;

  constructor(
    private maxSize: number = 500,
    private ttlMs: number = 5 * 60 * 1000, // 5 minutes default
    options?: { generationDeps?: GraphGenerationDependency[] }
  ) {
    this.generationDeps = options?.generationDeps ?? [];
  }

  /**
   * True when a depended-on graph generation has moved since the entry
   * was inserted (lazy invalidation — checked on read).
   */
  private isGenerationStale(entry: CacheEntry<T>): boolean {
    for (const dep of this.generationDeps) {
      if (dep === 'entity' && entry.entityGen !== entityGeneration) return true;
      if (dep === 'relation' && entry.relationGen !== relationGeneration) return true;
    }
    return false;
  }

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

    // Check graph-generation staleness (S6 lazy invalidation)
    if (this.isGenerationStale(entry)) {
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

    // Add new entry (recording the current graph generations when this
    // cache declares generation dependencies)
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    };
    for (const dep of this.generationDeps) {
      if (dep === 'entity') entry.entityGen = entityGeneration;
      if (dep === 'relation') entry.relationGen = relationGeneration;
    }
    this.cache.set(key, entry);
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

    // Check graph-generation staleness (S6 lazy invalidation)
    if (this.isGenerationStale(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

/**
 * Global search caches for different search types.
 *
 * Generation dependencies (S6):
 * - `basic` / `boolean` / `fuzzy` return `KnowledgeGraph` slices that embed
 *   both entities and relations → invalidated by either generation moving.
 * - `ranked` returns `SearchResult[]` scored purely from entity text
 *   (TF-IDF/BM25) → relation-only writes leave it valid.
 */
export const searchCaches = {
  basic: new SearchCache<KnowledgeGraph>(500, 5 * 60 * 1000, { generationDeps: ['entity', 'relation'] }),
  ranked: new SearchCache<SearchResult[]>(500, 5 * 60 * 1000, { generationDeps: ['entity'] }),
  boolean: new SearchCache<KnowledgeGraph>(500, 5 * 60 * 1000, { generationDeps: ['entity', 'relation'] }),
  fuzzy: new SearchCache<KnowledgeGraph>(500, 5 * 60 * 1000, { generationDeps: ['entity', 'relation'] }),
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
