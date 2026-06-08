/**
 * Query Plan Cache
 *
 * Phase 12 Sprint 4: Caches query analysis and planning results
 * with LRU eviction for improved performance.
 *
 * @module search/QueryPlanCache
 */

import type { QueryAnalysis, QueryPlan } from '../types/index.js';

/**
 * Cached query entry with metadata.
 */
export interface CachedQueryEntry {
  /** Normalized query string */
  normalizedQuery: string;
  /** Original query string */
  originalQuery: string;
  /** Cached analysis result */
  analysis: QueryAnalysis;
  /** Cached plan result (if available) */
  plan?: QueryPlan;
  /** Cache entry creation time */
  createdAt: number;
  /** Last access time for LRU */
  lastAccessed: number;
  /** Number of times this entry was accessed */
  hitCount: number;
}

/**
 * Cache statistics for monitoring.
 */
export interface QueryPlanCacheStats {
  /** Total cache entries */
  size: number;
  /** Maximum cache size */
  maxSize: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total evictions */
  evictions: number;
  /** Average entry age in milliseconds */
  averageEntryAgeMs: number;
}

/**
 * Options for the query plan cache.
 */
export interface QueryPlanCacheOptions {
  /** Maximum number of entries (default: 1000) */
  maxSize?: number;
  /** Entry TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
  /** Whether to normalize queries for better hit rate (default: true) */
  normalizeQueries?: boolean;
  /** Whether to enable cache statistics (default: true) */
  enableStats?: boolean;
}

/**
 * Default cache options.
 */
const DEFAULT_OPTIONS: Required<QueryPlanCacheOptions> = {
  maxSize: 1000,
  ttlMs: 5 * 60 * 1000, // 5 minutes
  normalizeQueries: true,
  enableStats: true,
};

/**
 * Query Plan Cache with LRU eviction.
 *
 * Caches query analysis and planning results to avoid redundant computation.
 * Uses LRU (Least Recently Used) eviction when cache is full.
 *
 * @example
 * ```typescript
 * const cache = new QueryPlanCache({ maxSize: 500 });
 *
 * // Cache an analysis
 * cache.setAnalysis('Find Alice', analysis);
 *
 * // Retrieve cached analysis
 * const cached = cache.getAnalysis('Find Alice');
 * if (cached) {
 *   console.log('Cache hit!', cached);
 * }
 *
 * // Get statistics
 * const stats = cache.getStats();
 * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
 * ```
 */
export class QueryPlanCache {
  private cache: Map<string, CachedQueryEntry>;
  private options: Required<QueryPlanCacheOptions>;

  // Statistics
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: QueryPlanCacheOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.cache = new Map();
  }

  /**
   * Get cached analysis for a query.
   *
   * @param query - The search query
   * @returns Cached analysis or undefined if not found
   */
  getAnalysis(query: string): QueryAnalysis | undefined {
    const entry = this.getEntry(query);
    return entry?.analysis;
  }

  /**
   * Get cached plan for a query.
   *
   * @param query - The search query
   * @returns Cached plan or undefined if not found
   */
  getPlan(query: string): QueryPlan | undefined {
    const entry = this.getEntry(query);
    return entry?.plan;
  }

  /**
   * Get full cached entry for a query.
   *
   * @param query - The search query
   * @returns Cached entry or undefined if not found
   */
  getEntry(query: string): CachedQueryEntry | undefined {
    const key = this.normalizeQuery(query);
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.options.enableStats) this.misses++;
      return undefined;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      if (this.options.enableStats) this.misses++;
      return undefined;
    }

    // Update access time and count
    entry.lastAccessed = Date.now();
    entry.hitCount++;

    if (this.options.enableStats) this.hits++;

    return entry;
  }

  /**
   * Cache analysis results for a query.
   *
   * @param query - The search query
   * @param analysis - The analysis result to cache
   */
  setAnalysis(query: string, analysis: QueryAnalysis): void {
    const key = this.normalizeQuery(query);
    const now = Date.now();

    const existing = this.cache.get(key);
    if (existing) {
      // Update existing entry
      existing.analysis = analysis;
      existing.lastAccessed = now;
    } else {
      // Evict if necessary
      this.evictIfNeeded();

      // Create new entry
      this.cache.set(key, {
        normalizedQuery: key,
        originalQuery: query,
        analysis,
        createdAt: now,
        lastAccessed: now,
        hitCount: 0,
      });
    }
  }

  /**
   * Cache plan results for a query.
   *
   * @param query - The search query
   * @param analysis - The analysis result to cache
   * @param plan - The plan result to cache
   */
  setPlan(query: string, analysis: QueryAnalysis, plan: QueryPlan): void {
    const key = this.normalizeQuery(query);
    const now = Date.now();

    const existing = this.cache.get(key);
    if (existing) {
      // Update existing entry
      existing.analysis = analysis;
      existing.plan = plan;
      existing.lastAccessed = now;
    } else {
      // Evict if necessary
      this.evictIfNeeded();

      // Create new entry
      this.cache.set(key, {
        normalizedQuery: key,
        originalQuery: query,
        analysis,
        plan,
        createdAt: now,
        lastAccessed: now,
        hitCount: 0,
      });
    }
  }

  /**
   * Check if a query is cached.
   *
   * @param query - The search query
   * @returns True if cached (and not expired)
   */
  has(query: string): boolean {
    const key = this.normalizeQuery(query);
    const entry = this.cache.get(key);

    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Invalidate a specific query from cache.
   *
   * @param query - The search query to invalidate
   * @returns True if entry was found and removed
   */
  invalidate(query: string): boolean {
    const key = this.normalizeQuery(query);
    return this.cache.delete(key);
  }

  /**
   * Invalidate all entries matching a pattern.
   *
   * @param pattern - Regex pattern to match against queries
   * @returns Number of entries invalidated
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (pattern.test(entry.originalQuery) || pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache statistics
   */
  getStats(): QueryPlanCacheStats {
    const now = Date.now();
    let totalAge = 0;

    for (const entry of this.cache.values()) {
      totalAge += now - entry.createdAt;
    }

    const total = this.hits + this.misses;

    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      averageEntryAgeMs: this.cache.size > 0 ? totalAge / this.cache.size : 0,
    };
  }

  /**
   * Get the current cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Normalize a query for cache lookup.
   *
   * Normalization helps improve cache hit rate by treating
   * similar queries as equivalent.
   *
   * @param query - The query to normalize
   * @returns Normalized query string
   */
  normalizeQuery(query: string): string {
    if (!this.options.normalizeQueries) {
      return query;
    }

    return query
      .toLowerCase()
      .trim()
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove punctuation that doesn't affect meaning
      .replace(/[.,!?;:]+$/g, '')
      // Sort operators for consistent matching
      .replace(/\b(AND|OR|NOT)\b/gi, match => match.toUpperCase());
  }

  /**
   * Check if an entry has expired.
   * @private
   */
  private isExpired(entry: CachedQueryEntry): boolean {
    return Date.now() - entry.createdAt > this.options.ttlMs;
  }

  /**
   * Evict entries if cache is at capacity.
   * Uses LRU (Least Recently Used) eviction.
   * @private
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.options.maxSize) {
      return;
    }

    // Find the least recently used entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      // Also check for expired entries during eviction
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        if (this.options.enableStats) this.evictions++;
        if (this.cache.size < this.options.maxSize) return;
        continue;
      }

      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    // Evict the oldest entry
    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.options.enableStats) this.evictions++;
    }
  }

  /**
   * Clean up expired entries.
   *
   * Call this periodically to remove stale entries.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Get all cache keys (for debugging).
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Preload cache with common queries.
   *
   * @param queries - Array of query-analysis pairs to preload
   */
  preload(queries: Array<{ query: string; analysis: QueryAnalysis; plan?: QueryPlan }>): void {
    for (const { query, analysis, plan } of queries) {
      if (plan) {
        this.setPlan(query, analysis, plan);
      } else {
        this.setAnalysis(query, analysis);
      }
    }
  }

  /**
   * Export cache entries for persistence.
   *
   * @returns Array of cache entries
   */
  export(): CachedQueryEntry[] {
    const entries: CachedQueryEntry[] = [];
    for (const entry of this.cache.values()) {
      if (!this.isExpired(entry)) {
        entries.push({ ...entry });
      }
    }
    return entries;
  }

  /**
   * Import cache entries from persistence.
   *
   * @param entries - Array of cache entries to import
   * @param preserveTimestamps - Whether to preserve original timestamps
   */
  import(entries: CachedQueryEntry[], preserveTimestamps = false): void {
    const now = Date.now();
    for (const entry of entries) {
      if (!preserveTimestamps) {
        entry.createdAt = now;
        entry.lastAccessed = now;
      }

      // Skip if expired
      if (this.isExpired(entry)) continue;

      // Evict if needed
      this.evictIfNeeded();

      this.cache.set(entry.normalizedQuery, entry);
    }
  }
}
