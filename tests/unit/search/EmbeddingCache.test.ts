/**
 * EmbeddingCache Unit Tests
 *
 * Phase 12 Sprint 5: Embedding Performance
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  EmbeddingCache,
  DEFAULT_EMBEDDING_CACHE_OPTIONS,
} from '../../../src/search/EmbeddingCache.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  const createEmbedding = (size: number = 384): number[] => {
    return Array.from({ length: size }, () => Math.random());
  };

  beforeEach(() => {
    cache = new EmbeddingCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Configuration', () => {
    it('should use default options', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should accept custom options', () => {
      const customCache = new EmbeddingCache({
        maxSize: 500,
        ttlMs: 30000,
        dimensions: 768,
      });

      expect(customCache.size()).toBe(0);
    });

    it('should update options dynamically', () => {
      cache.updateOptions({ maxSize: 200 });
      // Options updated, but won't affect existing entries
      expect(cache.size()).toBe(0);
    });
  });

  describe('Basic Operations', () => {
    it('should set and get embeddings', () => {
      const embedding = createEmbedding();
      cache.set('entity1', 'text content', embedding);

      const result = cache.get('entity1', 'text content');
      expect(result).toEqual(embedding);
    });

    it('should return null for missing keys', () => {
      const result = cache.get('nonexistent', 'any text');
      expect(result).toBeNull();
    });

    it('should check if key exists', () => {
      cache.set('entity1', 'text', createEmbedding());

      expect(cache.has('entity1')).toBe(true);
      expect(cache.has('entity2')).toBe(false);
    });

    it('should delete entries', () => {
      cache.set('entity1', 'text', createEmbedding());
      const deleted = cache.delete('entity1');

      expect(deleted).toBe(true);
      expect(cache.has('entity1')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('entity1', 'text1', createEmbedding());
      cache.set('entity2', 'text2', createEmbedding());

      cache.clear();

      expect(cache.size()).toBe(0);
    });

    it('should return all keys', () => {
      cache.set('entity1', 'text1', createEmbedding());
      cache.set('entity2', 'text2', createEmbedding());

      const keys = cache.keys();
      expect(keys).toContain('entity1');
      expect(keys).toContain('entity2');
    });
  });

  describe('Text Hash Invalidation', () => {
    it('should invalidate on text change', () => {
      const embedding = createEmbedding();
      cache.set('entity1', 'original text', embedding);

      // Different text should cause cache miss
      const result = cache.get('entity1', 'modified text');
      expect(result).toBeNull();
    });

    it('should return cached value when text matches', () => {
      const embedding = createEmbedding();
      const text = 'consistent text';
      cache.set('entity1', text, embedding);

      const result = cache.get('entity1', text);
      expect(result).toEqual(embedding);
    });

    it('should delete stale entries on text mismatch', () => {
      cache.set('entity1', 'original', createEmbedding());

      // Access with different text triggers deletion
      cache.get('entity1', 'changed');

      expect(cache.has('entity1')).toBe(false);
    });
  });

  describe('TTL (Time-To-Live)', () => {
    it('should expire entries after TTL', () => {
      const shortTtlCache = new EmbeddingCache({ ttlMs: 1000 });
      shortTtlCache.set('entity1', 'text', createEmbedding());

      // Fast-forward time past TTL
      vi.advanceTimersByTime(1500);

      const result = shortTtlCache.get('entity1', 'text');
      expect(result).toBeNull();
    });

    it('should not expire entries before TTL', () => {
      const embedding = createEmbedding();
      const shortTtlCache = new EmbeddingCache({ ttlMs: 10000 });
      shortTtlCache.set('entity1', 'text', embedding);

      // Fast-forward time but not past TTL
      vi.advanceTimersByTime(5000);

      const result = shortTtlCache.get('entity1', 'text');
      expect(result).toEqual(embedding);
    });

    it('should prune expired entries', () => {
      const shortTtlCache = new EmbeddingCache({ ttlMs: 1000 });
      shortTtlCache.set('entity1', 'text1', createEmbedding());
      shortTtlCache.set('entity2', 'text2', createEmbedding());

      vi.advanceTimersByTime(1500);

      const removed = shortTtlCache.pruneExpired();
      expect(removed).toBe(2);
      expect(shortTtlCache.size()).toBe(0);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict LRU entry when at capacity', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });

      smallCache.set('entity1', 'text1', createEmbedding());
      vi.advanceTimersByTime(10);
      smallCache.set('entity2', 'text2', createEmbedding());
      vi.advanceTimersByTime(10);

      // Access entity1 to make entity2 the LRU
      smallCache.get('entity1', 'text1');
      vi.advanceTimersByTime(10);

      // Add entity3, should evict entity2 (oldest lastAccess)
      smallCache.set('entity3', 'text3', createEmbedding());

      expect(smallCache.has('entity1')).toBe(true);
      expect(smallCache.has('entity2')).toBe(false);
      expect(smallCache.has('entity3')).toBe(true);
    });

    it('should not evict when updating existing key', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });

      smallCache.set('entity1', 'text1', createEmbedding());
      smallCache.set('entity2', 'text2', createEmbedding());

      // Update entity1 (not a new entry)
      smallCache.set('entity1', 'updated text1', createEmbedding());

      expect(smallCache.size()).toBe(2);
      expect(smallCache.has('entity1')).toBe(true);
      expect(smallCache.has('entity2')).toBe(true);
    });

    it('should update last access time on get', () => {
      const smallCache = new EmbeddingCache({ maxSize: 2 });

      smallCache.set('entity1', 'text1', createEmbedding());
      vi.advanceTimersByTime(100);

      smallCache.set('entity2', 'text2', createEmbedding());
      vi.advanceTimersByTime(100);

      // Access entity1 to update its lastAccess (making it more recent than entity2)
      smallCache.get('entity1', 'text1');
      vi.advanceTimersByTime(100);

      // Add entity3 - should evict entity2 (oldest lastAccess)
      smallCache.set('entity3', 'text3', createEmbedding());

      expect(smallCache.has('entity1')).toBe(true);
      expect(smallCache.has('entity2')).toBe(false);
      expect(smallCache.has('entity3')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', () => {
      cache.set('entity1', 'text', createEmbedding());

      cache.get('entity1', 'text'); // hit
      cache.get('entity1', 'text'); // hit
      cache.get('entity2', 'text'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('entity1', 'text', createEmbedding());

      cache.get('entity1', 'text'); // hit
      cache.get('entity1', 'text'); // hit
      cache.get('entity2', 'text'); // miss
      cache.get('entity3', 'text'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.5); // 2 hits / 4 total
    });

    it('should handle zero requests for hit rate', () => {
      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
    });

    it('should estimate memory usage', () => {
      cache.set('entity1', 'text1', createEmbedding(384));
      cache.set('entity2', 'text2', createEmbedding(384));

      const stats = cache.getStats();
      expect(stats.memoryBytes).toBeGreaterThan(0);
      expect(stats.size).toBe(2);
    });

    it('should reset statistics', () => {
      cache.set('entity1', 'text', createEmbedding());
      cache.get('entity1', 'text');
      cache.get('entity2', 'text');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should count miss on TTL expiration', () => {
      const shortTtlCache = new EmbeddingCache({ ttlMs: 100 });
      shortTtlCache.set('entity1', 'text', createEmbedding());

      vi.advanceTimersByTime(200);

      shortTtlCache.get('entity1', 'text'); // expired = miss

      const stats = shortTtlCache.getStats();
      expect(stats.misses).toBe(1);
    });

    it('should count miss on text hash mismatch', () => {
      cache.set('entity1', 'original', createEmbedding());

      cache.get('entity1', 'changed'); // hash mismatch = miss

      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      const embedding = createEmbedding();
      cache.set('entity1', '', embedding);

      const result = cache.get('entity1', '');
      expect(result).toEqual(embedding);
    });

    it('should handle special characters in text', () => {
      const embedding = createEmbedding();
      const text = 'Special: !@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./ 日本語 🎉';
      cache.set('entity1', text, embedding);

      const result = cache.get('entity1', text);
      expect(result).toEqual(embedding);
    });

    it('should handle large embeddings', () => {
      const largeEmbedding = createEmbedding(1536); // GPT-3 embedding size
      cache.set('entity1', 'text', largeEmbedding);

      const result = cache.get('entity1', 'text');
      expect(result).toHaveLength(1536);
    });

    it('should handle empty embedding vector', () => {
      cache.set('entity1', 'text', []);

      const result = cache.get('entity1', 'text');
      expect(result).toEqual([]);
    });
  });
});
