/**
 * Query Plan Cache Tests
 *
 * Phase 12 Sprint 4: Tests for query plan caching with LRU eviction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryPlanCache } from '../../../src/search/QueryPlanCache.js';
import type { QueryAnalysis, QueryPlan } from '../../../src/types/index.js';

describe('QueryPlanCache', () => {
  let cache: QueryPlanCache;

  const createAnalysis = (query: string): QueryAnalysis => ({
    query,
    entities: [],
    persons: [],
    locations: [],
    organizations: [],
    temporalRange: null,
    questionType: 'factual',
    complexity: 'low',
    confidence: 0.8,
    requiredInfoTypes: [],
  });

  const createPlan = (query: string): QueryPlan => ({
    originalQuery: query,
    subQueries: [
      {
        id: '1',
        query,
        targetLayer: 'hybrid',
        priority: 1,
      },
    ],
    executionStrategy: 'iterative',
    mergeStrategy: 'weighted',
    estimatedComplexity: 3,
  });

  beforeEach(() => {
    cache = new QueryPlanCache();
  });

  describe('basic operations', () => {
    it('should cache and retrieve analysis', () => {
      const analysis = createAnalysis('Find Alice');
      cache.setAnalysis('Find Alice', analysis);

      const cached = cache.getAnalysis('Find Alice');
      expect(cached).toEqual(analysis);
    });

    it('should cache and retrieve plan with analysis', () => {
      const analysis = createAnalysis('Find Alice');
      const plan = createPlan('Find Alice');

      cache.setPlan('Find Alice', analysis, plan);

      const cachedAnalysis = cache.getAnalysis('Find Alice');
      const cachedPlan = cache.getPlan('Find Alice');

      expect(cachedAnalysis).toEqual(analysis);
      expect(cachedPlan).toEqual(plan);
    });

    it('should return undefined for non-existent entry', () => {
      expect(cache.getAnalysis('non-existent')).toBeUndefined();
      expect(cache.getPlan('non-existent')).toBeUndefined();
    });

    it('should check if query is cached', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      expect(cache.has('Find Alice')).toBe(true);
      expect(cache.has('non-existent')).toBe(false);
    });

    it('should invalidate specific entry', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));
      cache.setAnalysis('Find Bob', createAnalysis('Find Bob'));

      const removed = cache.invalidate('Find Alice');

      expect(removed).toBe(true);
      expect(cache.has('Find Alice')).toBe(false);
      expect(cache.has('Find Bob')).toBe(true);
    });

    it('should return false when invalidating non-existent entry', () => {
      const removed = cache.invalidate('non-existent');
      expect(removed).toBe(false);
    });

    it('should clear all entries', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));
      cache.setAnalysis('Find Bob', createAnalysis('Find Bob'));

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('Find Alice')).toBe(false);
      expect(cache.has('Find Bob')).toBe(false);
    });
  });

  describe('query normalization', () => {
    it('should normalize queries for better cache hits', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      // Same query with different case should hit
      expect(cache.getAnalysis('find alice')).toBeDefined();
      expect(cache.getAnalysis('FIND ALICE')).toBeDefined();
    });

    it('should normalize whitespace', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      expect(cache.getAnalysis('Find  Alice')).toBeDefined();
      expect(cache.getAnalysis(' Find Alice ')).toBeDefined();
    });

    it('should normalize boolean operators', () => {
      cache.setAnalysis('Find AND Search', createAnalysis('Find AND Search'));

      expect(cache.getAnalysis('find and search')).toBeDefined();
    });

    it('should remove trailing punctuation', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      expect(cache.getAnalysis('Find Alice.')).toBeDefined();
      expect(cache.getAnalysis('Find Alice?')).toBeDefined();
    });

    it('should allow disabling normalization', () => {
      const noNormCache = new QueryPlanCache({ normalizeQueries: false });
      noNormCache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      expect(noNormCache.getAnalysis('find alice')).toBeUndefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      vi.useFakeTimers();
      const smallCache = new QueryPlanCache({ maxSize: 3 });

      vi.setSystemTime(1000);
      smallCache.setAnalysis('query1', createAnalysis('query1'));

      vi.setSystemTime(2000);
      smallCache.setAnalysis('query2', createAnalysis('query2'));

      vi.setSystemTime(3000);
      smallCache.setAnalysis('query3', createAnalysis('query3'));

      // Access query1 to make it recently used
      vi.setSystemTime(4000);
      smallCache.getAnalysis('query1');

      // Add query4, should evict query2 (least recently used at 2000)
      vi.setSystemTime(5000);
      smallCache.setAnalysis('query4', createAnalysis('query4'));

      expect(smallCache.has('query1')).toBe(true); // Accessed at 4000
      expect(smallCache.has('query2')).toBe(false); // Evicted (2000)
      expect(smallCache.has('query3')).toBe(true); // 3000
      expect(smallCache.has('query4')).toBe(true); // 5000
      vi.useRealTimers();
    });

    it('should update access time on get', () => {
      vi.useFakeTimers();
      const smallCache = new QueryPlanCache({ maxSize: 2 });

      vi.setSystemTime(1000);
      smallCache.setAnalysis('query1', createAnalysis('query1'));

      vi.setSystemTime(2000);
      smallCache.setAnalysis('query2', createAnalysis('query2'));

      // Access query1 - updates its lastAccessed to a newer time
      vi.setSystemTime(3000);
      smallCache.getAnalysis('query1');

      // Add query3, should evict query2 (oldest lastAccessed at 2000)
      vi.setSystemTime(4000);
      smallCache.setAnalysis('query3', createAnalysis('query3'));

      expect(smallCache.has('query1')).toBe(true);
      expect(smallCache.has('query2')).toBe(false);
      vi.useRealTimers();
    });

    it('should track eviction count in stats', () => {
      const smallCache = new QueryPlanCache({ maxSize: 2 });

      smallCache.setAnalysis('query1', createAnalysis('query1'));
      smallCache.setAnalysis('query2', createAnalysis('query2'));
      smallCache.setAnalysis('query3', createAnalysis('query3'));
      smallCache.setAnalysis('query4', createAnalysis('query4'));

      const stats = smallCache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTTLCache = new QueryPlanCache({ ttlMs: 50 });

      shortTTLCache.setAnalysis('test', createAnalysis('test'));
      expect(shortTTLCache.has('test')).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(shortTTLCache.has('test')).toBe(false);
    });

    it('should not return expired entries on get', async () => {
      const shortTTLCache = new QueryPlanCache({ ttlMs: 50 });

      shortTTLCache.setAnalysis('test', createAnalysis('test'));

      await new Promise(resolve => setTimeout(resolve, 60));

      expect(shortTTLCache.getAnalysis('test')).toBeUndefined();
    });

    it('should clean up expired entries', async () => {
      const shortTTLCache = new QueryPlanCache({ ttlMs: 50 });

      shortTTLCache.setAnalysis('test1', createAnalysis('test1'));
      shortTTLCache.setAnalysis('test2', createAnalysis('test2'));

      await new Promise(resolve => setTimeout(resolve, 60));

      const removed = shortTTLCache.cleanup();
      expect(removed).toBe(2);
      expect(shortTTLCache.size).toBe(0);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.setAnalysis('test', createAnalysis('test'));

      cache.getAnalysis('test'); // Hit
      cache.getAnalysis('test'); // Hit
      cache.getAnalysis('non-existent'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate', () => {
      cache.setAnalysis('test', createAnalysis('test'));

      cache.getAnalysis('test'); // Hit
      cache.getAnalysis('test'); // Hit
      cache.getAnalysis('non-existent'); // Miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should report cache size', () => {
      cache.setAnalysis('test1', createAnalysis('test1'));
      cache.setAnalysis('test2', createAnalysis('test2'));

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });

    it('should report max size', () => {
      const smallCache = new QueryPlanCache({ maxSize: 5 });
      const stats = smallCache.getStats();
      expect(stats.maxSize).toBe(5);
    });

    it('should calculate average entry age', async () => {
      cache.setAnalysis('test', createAnalysis('test'));

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = cache.getStats();
      expect(stats.averageEntryAgeMs).toBeGreaterThan(0);
    });

    it('should reset stats on clear', () => {
      cache.setAnalysis('test', createAnalysis('test'));
      cache.getAnalysis('test'); // Hit
      cache.getAnalysis('non-existent'); // Miss

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.evictions).toBe(0);
    });

    it('should allow disabling stats', () => {
      const noStatsCache = new QueryPlanCache({ enableStats: false });

      noStatsCache.setAnalysis('test', createAnalysis('test'));
      noStatsCache.getAnalysis('test');
      noStatsCache.getAnalysis('non-existent');

      const stats = noStatsCache.getStats();
      // Stats should still be zero when disabled
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('pattern invalidation', () => {
    it('should invalidate entries matching pattern', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));
      cache.setAnalysis('Find Bob', createAnalysis('Find Bob'));
      cache.setAnalysis('Search projects', createAnalysis('Search projects'));

      const count = cache.invalidatePattern(/^Find/i);

      expect(count).toBe(2);
      expect(cache.has('Find Alice')).toBe(false);
      expect(cache.has('Find Bob')).toBe(false);
      expect(cache.has('Search projects')).toBe(true);
    });

    it('should return 0 when no entries match', () => {
      cache.setAnalysis('Find Alice', createAnalysis('Find Alice'));

      const count = cache.invalidatePattern(/^Search/);
      expect(count).toBe(0);
    });
  });

  describe('update existing entries', () => {
    it('should update analysis for existing entry', () => {
      const analysis1 = createAnalysis('test');
      const analysis2 = createAnalysis('test');
      analysis2.complexity = 'high';

      cache.setAnalysis('test', analysis1);
      cache.setAnalysis('test', analysis2);

      const cached = cache.getAnalysis('test');
      expect(cached?.complexity).toBe('high');
    });

    it('should update plan for existing entry', () => {
      const analysis = createAnalysis('test');
      const plan1 = createPlan('test');
      const plan2 = createPlan('test');
      plan2.estimatedComplexity = 10;

      cache.setPlan('test', analysis, plan1);
      cache.setPlan('test', analysis, plan2);

      const cached = cache.getPlan('test');
      expect(cached?.estimatedComplexity).toBe(10);
    });
  });

  describe('entry management', () => {
    it('should get full entry with metadata', () => {
      cache.setAnalysis('test', createAnalysis('test'));

      const entry = cache.getEntry('test');

      expect(entry).toBeDefined();
      expect(entry?.normalizedQuery).toBeDefined();
      expect(entry?.originalQuery).toBe('test');
      expect(entry?.analysis).toBeDefined();
      expect(entry?.createdAt).toBeGreaterThan(0);
      expect(entry?.lastAccessed).toBeGreaterThan(0);
      expect(entry?.hitCount).toBe(1); // getEntry increments hitCount
    });

    it('should increment hit count on access', () => {
      cache.setAnalysis('test', createAnalysis('test'));

      cache.getEntry('test');
      cache.getEntry('test');
      cache.getEntry('test');

      const entry = cache.getEntry('test');
      expect(entry?.hitCount).toBe(4); // 4 total getEntry calls
    });

    it('should list all cache keys', () => {
      cache.setAnalysis('test1', createAnalysis('test1'));
      cache.setAnalysis('test2', createAnalysis('test2'));

      const keys = cache.keys();
      expect(keys.length).toBe(2);
    });
  });

  describe('preload and export/import', () => {
    it('should preload cache with queries', () => {
      const queries = [
        { query: 'test1', analysis: createAnalysis('test1') },
        { query: 'test2', analysis: createAnalysis('test2'), plan: createPlan('test2') },
      ];

      cache.preload(queries);

      expect(cache.has('test1')).toBe(true);
      expect(cache.has('test2')).toBe(true);
      expect(cache.getPlan('test2')).toBeDefined();
    });

    it('should export cache entries', () => {
      cache.setAnalysis('test1', createAnalysis('test1'));
      cache.setAnalysis('test2', createAnalysis('test2'));

      const entries = cache.export();

      expect(entries.length).toBe(2);
      expect(entries[0].originalQuery).toBeDefined();
      expect(entries[0].analysis).toBeDefined();
    });

    it('should not export expired entries', async () => {
      const shortTTLCache = new QueryPlanCache({ ttlMs: 50 });
      shortTTLCache.setAnalysis('test', createAnalysis('test'));

      await new Promise(resolve => setTimeout(resolve, 60));

      const entries = shortTTLCache.export();
      expect(entries.length).toBe(0);
    });

    it('should import cache entries', () => {
      const entries = [
        {
          normalizedQuery: 'test1',
          originalQuery: 'Test1',
          analysis: createAnalysis('test1'),
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          hitCount: 5,
        },
        {
          normalizedQuery: 'test2',
          originalQuery: 'Test2',
          analysis: createAnalysis('test2'),
          plan: createPlan('test2'),
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          hitCount: 10,
        },
      ];

      cache.import(entries);

      expect(cache.has('test1')).toBe(true);
      expect(cache.has('test2')).toBe(true);
    });

    it('should preserve timestamps on import when requested', () => {
      const oldTimestamp = Date.now() - 1000;
      const entries = [
        {
          normalizedQuery: 'test',
          originalQuery: 'test',
          analysis: createAnalysis('test'),
          createdAt: oldTimestamp,
          lastAccessed: oldTimestamp,
          hitCount: 5,
        },
      ];

      cache.import(entries, true);

      const entry = cache.getEntry('test');
      // Access updates lastAccessed, but createdAt should be preserved
      expect(entry?.createdAt).toBe(oldTimestamp);
    });

    it('should skip expired entries on import', () => {
      const expiredTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const entries = [
        {
          normalizedQuery: 'test',
          originalQuery: 'test',
          analysis: createAnalysis('test'),
          createdAt: expiredTimestamp,
          lastAccessed: expiredTimestamp,
          hitCount: 5,
        },
      ];

      cache.import(entries, true); // Preserve timestamps to keep them expired

      // With default 5 minute TTL, this should be expired
      expect(cache.has('test')).toBe(false);
    });
  });
});
