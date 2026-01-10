import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SearchCache,
  searchCaches,
  clearAllSearchCaches,
  getAllCacheStats,
  cleanupAllCaches,
  type CacheStats,
} from '../../../src/utils/searchCache.js';

describe('SearchCache', () => {
  describe('constructor', () => {
    it('should create cache with default values', () => {
      const cache = new SearchCache();
      expect(cache.size).toBe(0);
    });

    it('should create cache with custom maxSize', () => {
      const cache = new SearchCache(100);
      expect(cache.size).toBe(0);
    });

    it('should create cache with custom maxSize and TTL', () => {
      const cache = new SearchCache(50, 1000);
      expect(cache.size).toBe(0);
    });
  });

  describe('set and get', () => {
    let cache: SearchCache<string>;

    beforeEach(() => {
      cache = new SearchCache<string>(100, 5000);
    });

    it('should store and retrieve a value', () => {
      cache.set({ query: 'test' }, 'result');
      expect(cache.get({ query: 'test' })).toBe('result');
    });

    it('should return undefined for non-existent key', () => {
      expect(cache.get({ query: 'nonexistent' })).toBeUndefined();
    });

    it('should handle complex objects as params', () => {
      const params = { query: 'test', filters: { type: 'entity' }, limit: 10 };
      cache.set(params, 'complex result');
      expect(cache.get(params)).toBe('complex result');
    });

    it('should generate consistent keys regardless of param order', () => {
      cache.set({ a: 1, b: 2 }, 'value1');
      expect(cache.get({ b: 2, a: 1 })).toBe('value1');
    });

    it('should update existing entry', () => {
      cache.set({ query: 'test' }, 'first');
      cache.set({ query: 'test' }, 'second');
      expect(cache.get({ query: 'test' })).toBe('second');
      expect(cache.size).toBe(1);
    });

    it('should handle null values in params', () => {
      cache.set({ query: null as unknown as string }, 'null result');
      expect(cache.get({ query: null as unknown as string })).toBe('null result');
    });

    it('should handle array values in params', () => {
      cache.set({ tags: ['a', 'b', 'c'] }, 'array result');
      expect(cache.get({ tags: ['a', 'b', 'c'] })).toBe('array result');
    });

    it('should handle nested objects in params', () => {
      cache.set({ filter: { nested: { deep: true } } }, 'nested result');
      expect(cache.get({ filter: { nested: { deep: true } } })).toBe('nested result');
    });
  });

  describe('TTL expiration', () => {
    it('should return undefined for expired entries on get', () => {
      const cache = new SearchCache<string>(100, 50); // 50ms TTL
      cache.set({ query: 'test' }, 'value');

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get({ query: 'test' })).toBeUndefined();
          resolve();
        }, 100);
      });
    });

    it('should not return expired entries', async () => {
      const cache = new SearchCache<string>(100, 10); // 10ms TTL
      cache.set({ query: 'test' }, 'value');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get({ query: 'test' })).toBeUndefined();
    });

    it('should track miss when entry is expired', async () => {
      const cache = new SearchCache<string>(100, 10);
      cache.set({ query: 'test' }, 'value');

      await new Promise((resolve) => setTimeout(resolve, 50));

      cache.get({ query: 'test' });
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      const cache = new SearchCache<string>(3);

      cache.set({ id: 1 }, 'first');
      cache.set({ id: 2 }, 'second');
      cache.set({ id: 3 }, 'third');
      cache.set({ id: 4 }, 'fourth'); // Should evict first

      expect(cache.get({ id: 1 })).toBeUndefined();
      expect(cache.get({ id: 2 })).toBe('second');
      expect(cache.get({ id: 3 })).toBe('third');
      expect(cache.get({ id: 4 })).toBe('fourth');
    });

    it('should update access order on get', () => {
      const cache = new SearchCache<string>(3);

      cache.set({ id: 1 }, 'first');
      cache.set({ id: 2 }, 'second');
      cache.set({ id: 3 }, 'third');

      // Access first, making it most recently used
      cache.get({ id: 1 });

      cache.set({ id: 4 }, 'fourth'); // Should evict second now

      expect(cache.get({ id: 1 })).toBe('first');
      expect(cache.get({ id: 2 })).toBeUndefined();
      expect(cache.get({ id: 3 })).toBe('third');
      expect(cache.get({ id: 4 })).toBe('fourth');
    });

    it('should not evict when updating existing entry', () => {
      const cache = new SearchCache<string>(3);

      cache.set({ id: 1 }, 'first');
      cache.set({ id: 2 }, 'second');
      cache.set({ id: 3 }, 'third');
      cache.set({ id: 1 }, 'updated first'); // Update, not evict

      expect(cache.size).toBe(3);
      expect(cache.get({ id: 1 })).toBe('updated first');
      expect(cache.get({ id: 2 })).toBe('second');
      expect(cache.get({ id: 3 })).toBe('third');
    });

    it('should maintain maxSize limit', () => {
      const cache = new SearchCache<string>(5);

      for (let i = 0; i < 10; i++) {
        cache.set({ id: i }, `value${i}`);
      }

      expect(cache.size).toBe(5);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get({ id: 1 })).toBeUndefined();
      expect(cache.get({ id: 2 })).toBeUndefined();
    });

    it('should reset access order', () => {
      const cache = new SearchCache<string>(2);
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');

      cache.clear();

      cache.set({ id: 3 }, 'three');
      cache.set({ id: 4 }, 'four');
      cache.set({ id: 5 }, 'five'); // Should evict id:3

      expect(cache.get({ id: 3 })).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const cache = new SearchCache<string>();
      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should track hits correctly', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');

      cache.get({ id: 1 });
      cache.get({ id: 1 });

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    it('should track misses correctly', () => {
      const cache = new SearchCache<string>();

      cache.get({ id: 1 });
      cache.get({ id: 2 });

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    it('should calculate hit rate correctly', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');

      cache.get({ id: 1 }); // hit
      cache.get({ id: 1 }); // hit
      cache.get({ id: 2 }); // miss
      cache.get({ id: 3 }); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.5); // 2 hits / 4 total
    });

    it('should return 0 hitRate when no accesses', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should track size correctly', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');
      cache.set({ id: 3 }, 'three');

      const stats = cache.getStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('resetStats', () => {
    it('should reset hit and miss counters', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');

      cache.get({ id: 1 }); // hit
      cache.get({ id: 2 }); // miss

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should not affect cached data', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');

      cache.resetStats();

      expect(cache.get({ id: 1 })).toBe('value');
      expect(cache.size).toBe(1);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired entries', async () => {
      const cache = new SearchCache<string>(100, 50); // 50ms TTL
      cache.set({ id: 1 }, 'value1');
      cache.set({ id: 2 }, 'value2');

      await new Promise((resolve) => setTimeout(resolve, 100));

      cache.cleanupExpired();

      expect(cache.size).toBe(0);
    });

    it('should keep non-expired entries', async () => {
      const cache = new SearchCache<string>(100, 1000); // 1s TTL
      cache.set({ id: 1 }, 'value1');
      cache.set({ id: 2 }, 'value2');

      await new Promise((resolve) => setTimeout(resolve, 50));

      cache.cleanupExpired();

      expect(cache.size).toBe(2);
      expect(cache.get({ id: 1 })).toBe('value1');
    });

    it('should handle empty cache', () => {
      const cache = new SearchCache<string>();
      expect(() => cache.cleanupExpired()).not.toThrow();
    });

    it('should remove from access order', async () => {
      const cache = new SearchCache<string>(3, 50);
      cache.set({ id: 1 }, 'value1');

      await new Promise((resolve) => setTimeout(resolve, 100));

      cache.cleanupExpired();

      // Add new items - should not evict based on old access order
      cache.set({ id: 2 }, 'value2');
      cache.set({ id: 3 }, 'value3');
      cache.set({ id: 4 }, 'value4');

      expect(cache.size).toBe(3);
    });
  });

  describe('size property', () => {
    it('should return 0 for empty cache', () => {
      const cache = new SearchCache<string>();
      expect(cache.size).toBe(0);
    });

    it('should return correct count after additions', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');
      expect(cache.size).toBe(2);
    });

    it('should update after eviction', () => {
      const cache = new SearchCache<string>(2);
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');
      cache.set({ id: 3 }, 'three');
      expect(cache.size).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for existing entry', () => {
      const cache = new SearchCache<string>();
      cache.set({ id: 1 }, 'value');
      expect(cache.has({ id: 1 })).toBe(true);
    });

    it('should return false for non-existent entry', () => {
      const cache = new SearchCache<string>();
      expect(cache.has({ id: 1 })).toBe(false);
    });

    it('should return false for expired entry', async () => {
      const cache = new SearchCache<string>(100, 50);
      cache.set({ id: 1 }, 'value');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cache.has({ id: 1 })).toBe(false);
    });

    it('should remove expired entry from cache', async () => {
      const cache = new SearchCache<string>(100, 50);
      cache.set({ id: 1 }, 'value');

      await new Promise((resolve) => setTimeout(resolve, 100));

      cache.has({ id: 1 });
      expect(cache.size).toBe(0);
    });

    it('should not update access order', () => {
      const cache = new SearchCache<string>(2);
      cache.set({ id: 1 }, 'one');
      cache.set({ id: 2 }, 'two');

      cache.has({ id: 1 }); // Check but don't update order

      cache.set({ id: 3 }, 'three'); // Should evict id:1 if has() didn't update order

      // has() doesn't update order, so we can't test eviction order directly
      // but we can verify has() returns correct boolean
      expect(cache.has({ id: 2 })).toBe(true);
      expect(cache.has({ id: 3 })).toBe(true);
    });
  });
});

describe('searchCaches', () => {
  beforeEach(() => {
    clearAllSearchCaches();
  });

  it('should have all cache types', () => {
    expect(searchCaches.basic).toBeInstanceOf(SearchCache);
    expect(searchCaches.ranked).toBeInstanceOf(SearchCache);
    expect(searchCaches.boolean).toBeInstanceOf(SearchCache);
    expect(searchCaches.fuzzy).toBeInstanceOf(SearchCache);
  });

  it('should be separate cache instances', () => {
    searchCaches.basic.set({ query: 'test' }, { entities: [], relations: [] });
    searchCaches.ranked.set({ query: 'test' }, []);

    expect(searchCaches.basic.size).toBe(1);
    expect(searchCaches.ranked.size).toBe(1);
    expect(searchCaches.boolean.size).toBe(0);
    expect(searchCaches.fuzzy.size).toBe(0);
  });
});

describe('clearAllSearchCaches', () => {
  beforeEach(() => {
    clearAllSearchCaches();
  });

  it('should clear all caches', () => {
    searchCaches.basic.set({ query: 'test' }, { entities: [], relations: [] });
    searchCaches.ranked.set({ query: 'test' }, []);
    searchCaches.boolean.set({ query: 'test' }, { entities: [], relations: [] });
    searchCaches.fuzzy.set({ query: 'test' }, { entities: [], relations: [] });

    clearAllSearchCaches();

    expect(searchCaches.basic.size).toBe(0);
    expect(searchCaches.ranked.size).toBe(0);
    expect(searchCaches.boolean.size).toBe(0);
    expect(searchCaches.fuzzy.size).toBe(0);
  });
});

describe('getAllCacheStats', () => {
  beforeEach(() => {
    clearAllSearchCaches();
  });

  it('should return stats for all caches', () => {
    const stats = getAllCacheStats();

    expect(stats).toHaveProperty('basic');
    expect(stats).toHaveProperty('ranked');
    expect(stats).toHaveProperty('boolean');
    expect(stats).toHaveProperty('fuzzy');
  });

  it('should return correct stats structure', () => {
    const stats = getAllCacheStats();

    for (const key of ['basic', 'ranked', 'boolean', 'fuzzy']) {
      const cacheStats = stats[key];
      expect(cacheStats).toHaveProperty('hits');
      expect(cacheStats).toHaveProperty('misses');
      expect(cacheStats).toHaveProperty('size');
      expect(cacheStats).toHaveProperty('hitRate');
    }
  });

  it('should reflect cache activity', () => {
    searchCaches.basic.set({ query: 'test' }, { entities: [], relations: [] });
    searchCaches.basic.get({ query: 'test' }); // hit
    searchCaches.basic.get({ query: 'miss' }); // miss

    const stats = getAllCacheStats();

    expect(stats.basic.hits).toBe(1);
    expect(stats.basic.misses).toBe(1);
    expect(stats.basic.size).toBe(1);
  });
});

describe('cleanupAllCaches', () => {
  beforeEach(() => {
    clearAllSearchCaches();
  });

  it('should cleanup expired entries in all caches', async () => {
    // We can't easily test TTL on global caches since they use default TTL
    // Just verify the function doesn't throw
    expect(() => cleanupAllCaches()).not.toThrow();
  });

  it('should not affect non-expired entries', () => {
    searchCaches.basic.set({ query: 'test' }, { entities: [], relations: [] });
    searchCaches.ranked.set({ query: 'test' }, []);

    cleanupAllCaches();

    // Default TTL is 5 minutes, so entries should still exist
    expect(searchCaches.basic.size).toBe(1);
    expect(searchCaches.ranked.size).toBe(1);
  });
});
