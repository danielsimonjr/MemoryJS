/**
 * Unit tests for forEachSearchCache (CL-14) and the helpers rebuilt on it:
 * clearAllSearchCaches, cleanupAllCaches and getAllCacheStats.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  forEachSearchCache,
  clearAllSearchCaches,
  cleanupAllCaches,
  getAllCacheStats,
  searchCaches,
} from '../../../src/utils/searchCache.js';

afterEach(() => {
  vi.useRealTimers();
  clearAllSearchCaches();
});

describe('forEachSearchCache', () => {
  it('visits every global cache once, in basic, ranked, boolean, fuzzy order', () => {
    const names: string[] = [];
    const seen: unknown[] = [];

    forEachSearchCache((cache, name) => {
      names.push(name);
      seen.push(cache);
    });

    expect(names).toEqual(['basic', 'ranked', 'boolean', 'fuzzy']);
    expect(seen).toEqual([
      searchCaches.basic,
      searchCaches.ranked,
      searchCaches.boolean,
      searchCaches.fuzzy,
    ]);
  });
});

describe('clearAllSearchCaches via forEachSearchCache', () => {
  it('empties every global cache', () => {
    searchCaches.basic.set({ q: 'a' }, { entities: [], relations: [] } as never);
    searchCaches.ranked.set({ q: 'a' }, []);
    searchCaches.boolean.set({ q: 'a' }, { entities: [], relations: [] } as never);
    searchCaches.fuzzy.set({ q: 'a' }, { entities: [], relations: [] } as never);

    clearAllSearchCaches();

    expect(searchCaches.basic.size).toBe(0);
    expect(searchCaches.ranked.size).toBe(0);
    expect(searchCaches.boolean.size).toBe(0);
    expect(searchCaches.fuzzy.size).toBe(0);
  });
});

describe('cleanupAllCaches via forEachSearchCache', () => {
  it('removes expired entries from every global cache and keeps live ones', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    searchCaches.ranked.set({ q: 'old' }, []);
    searchCaches.fuzzy.set({ q: 'old' }, { entities: [], relations: [] } as never);

    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    searchCaches.ranked.set({ q: 'fresh' }, []);

    cleanupAllCaches();

    expect(searchCaches.ranked.has({ q: 'old' })).toBe(false);
    expect(searchCaches.ranked.has({ q: 'fresh' })).toBe(true);
    expect(searchCaches.fuzzy.size).toBe(0);
  });
});

describe('getAllCacheStats via forEachSearchCache', () => {
  it('reports stats for each cache keyed by name, in the historical key order', () => {
    clearAllSearchCaches();
    searchCaches.basic.get({ miss: 1 });

    const stats = getAllCacheStats();

    expect(Object.keys(stats)).toEqual(['basic', 'ranked', 'boolean', 'fuzzy']);
    expect(stats.basic).toEqual({ hits: 0, misses: 1, size: 0, hitRate: 0 });
    expect(stats.ranked).toEqual({ hits: 0, misses: 0, size: 0, hitRate: 0 });
  });
});
