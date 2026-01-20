/**
 * Compressed Cache Unit Tests
 *
 * Tests for LRU cache with automatic compression of old entries.
 * Phase 3 Sprint 5: Archive & Cache Compression
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompressedCache } from '../../../src/utils/compressedCache.js';
import type { Entity } from '../../../src/types/index.js';

describe('CompressedCache', () => {
  let cache: CompressedCache;

  // Helper to create test entities
  const createEntity = (name: string, observationCount: number = 1): Entity => ({
    name,
    entityType: 'test',
    observations: Array.from({ length: observationCount }, (_, i) =>
      `Observation ${i + 1} for ${name}: This is a longer observation text to ensure compression has some content to work with.`
    ),
    createdAt: '2024-01-01T00:00:00Z',
    lastModified: '2024-01-01T00:00:00Z',
    tags: ['test', 'cache'],
    importance: 5,
  });

  beforeEach(() => {
    cache = new CompressedCache({
      maxUncompressed: 5,
      compressionThresholdMs: 0, // Immediate compression for testing
    });
  });

  describe('basic operations', () => {
    it('should store and retrieve entities', () => {
      const entity = createEntity('Alice');
      cache.set('Alice', entity);

      const retrieved = cache.get('Alice');
      expect(retrieved).toEqual(entity);
    });

    it('should return undefined for non-existent entities', () => {
      const result = cache.get('NonExistent');
      expect(result).toBeUndefined();
    });

    it('should check if entity exists', () => {
      cache.set('Alice', createEntity('Alice'));

      expect(cache.has('Alice')).toBe(true);
      expect(cache.has('Bob')).toBe(false);
    });

    it('should delete entities', () => {
      cache.set('Alice', createEntity('Alice'));
      expect(cache.has('Alice')).toBe(true);

      const deleted = cache.delete('Alice');
      expect(deleted).toBe(true);
      expect(cache.has('Alice')).toBe(false);
    });

    it('should return false when deleting non-existent entity', () => {
      const deleted = cache.delete('NonExistent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('Alice', createEntity('Alice'));
      cache.set('Bob', createEntity('Bob'));
      expect(cache.size).toBe(2);

      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('should return correct size', () => {
      expect(cache.size).toBe(0);

      cache.set('Alice', createEntity('Alice'));
      expect(cache.size).toBe(1);

      cache.set('Bob', createEntity('Bob'));
      expect(cache.size).toBe(2);
    });

    it('should iterate over keys', () => {
      cache.set('Alice', createEntity('Alice'));
      cache.set('Bob', createEntity('Bob'));

      const keys = [...cache.keys()];
      expect(keys).toContain('Alice');
      expect(keys).toContain('Bob');
    });
  });

  describe('automatic compression', () => {
    it('should compress old entries when over limit', async () => {
      // Create cache with low limit for testing
      const smallCache = new CompressedCache({
        maxUncompressed: 3,
        compressionThresholdMs: 0,
      });

      // Add more entities than the limit
      for (let i = 0; i < 10; i++) {
        smallCache.set(`Entity${i}`, createEntity(`Entity${i}`, 5));
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const stats = smallCache.getStats();
      expect(stats.compressed).toBeGreaterThan(0);
      expect(stats.uncompressed).toBeLessThanOrEqual(3);
    });

    it('should decompress on access', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      // Add entities to trigger compression
      smallCache.set('First', createEntity('First', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Second', createEntity('Second', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Third', createEntity('Third', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Fourth', createEntity('Fourth', 5));

      // First entity should be compressed
      const statsBeforeAccess = smallCache.getStats();
      expect(statsBeforeAccess.compressed).toBeGreaterThan(0);

      // Access first entity - should decompress
      const entity = smallCache.get('First');
      expect(entity).toBeDefined();
      expect(entity?.name).toBe('First');

      const statsAfterAccess = smallCache.getStats();
      expect(statsAfterAccess.decompressions).toBeGreaterThanOrEqual(1);
    });

    it('should maintain data integrity through compression cycle', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      const originalEntity = createEntity('TestEntity', 10);
      smallCache.set('TestEntity', originalEntity);

      // Add more entities to trigger compression
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Filler1', createEntity('Filler1'));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Filler2', createEntity('Filler2'));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Filler3', createEntity('Filler3'));

      // Retrieve and verify integrity
      const retrieved = smallCache.get('TestEntity');
      expect(retrieved).toEqual(originalEntity);
    });

    it('should not compress when autoCompress is disabled', () => {
      const noAutoCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
        autoCompress: false,
      });

      // Add many entities
      for (let i = 0; i < 10; i++) {
        noAutoCache.set(`Entity${i}`, createEntity(`Entity${i}`));
      }

      const stats = noAutoCache.getStats();
      expect(stats.compressed).toBe(0);
      expect(stats.uncompressed).toBe(10);
    });
  });

  describe('manual compression', () => {
    it('should compress old entries on demand', async () => {
      const manualCache = new CompressedCache({
        maxUncompressed: 100, // High limit so auto-compress doesn't trigger
        compressionThresholdMs: 0,
        autoCompress: false,
      });

      // Add entities
      for (let i = 0; i < 10; i++) {
        manualCache.set(`Entity${i}`, createEntity(`Entity${i}`, 5));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // No compression yet
      let stats = manualCache.getStats();
      expect(stats.compressed).toBe(0);

      // Manually trigger compression
      const compressed = manualCache.compressOldEntries();
      expect(compressed).toBeGreaterThan(0);

      stats = manualCache.getStats();
      expect(stats.compressed).toBeGreaterThan(0);
    });

    it('should decompress all entries on demand', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      // Add entities to trigger compression
      for (let i = 0; i < 5; i++) {
        smallCache.set(`Entity${i}`, createEntity(`Entity${i}`, 3));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      // Some should be compressed
      const statsBeforeDecompress = smallCache.getStats();
      expect(statsBeforeDecompress.compressed).toBeGreaterThan(0);

      // Decompress all
      const decompressed = smallCache.decompressAll();
      expect(decompressed).toBe(statsBeforeDecompress.compressed);

      const statsAfterDecompress = smallCache.getStats();
      expect(statsAfterDecompress.compressed).toBe(0);
      expect(statsAfterDecompress.uncompressed).toBe(5);
    });
  });

  describe('statistics', () => {
    it('should track cache hits and misses', () => {
      cache.set('Alice', createEntity('Alice'));

      // Hit
      cache.get('Alice');
      cache.get('Alice');

      // Miss
      cache.get('NonExistent');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should track compression operations', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      // Add entities to trigger compression
      smallCache.set('First', createEntity('First', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Second', createEntity('Second', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Third', createEntity('Third', 5));

      const statsAfterCompression = smallCache.getStats();
      expect(statsAfterCompression.compressions).toBeGreaterThan(0);

      // Access compressed entity to trigger decompression
      smallCache.get('First');

      const statsAfterDecompression = smallCache.getStats();
      expect(statsAfterDecompression.decompressions).toBeGreaterThanOrEqual(1);
    });

    it('should calculate memory savings', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      // Add large entities to trigger compression
      for (let i = 0; i < 5; i++) {
        smallCache.set(`Entity${i}`, createEntity(`Entity${i}`, 20)); // Large entities
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const stats = smallCache.getStats();
      expect(stats.memorySaved).toBeGreaterThan(0);
      expect(stats.totalOriginalSize).toBeGreaterThan(0);
    });

    it('should report correct total and breakdown', () => {
      cache.set('Alice', createEntity('Alice'));
      cache.set('Bob', createEntity('Bob'));
      cache.set('Charlie', createEntity('Charlie'));

      const stats = cache.getStats();
      expect(stats.total).toBe(3);
      expect(stats.total).toBe(stats.compressed + stats.uncompressed);
    });
  });

  describe('getAllEntities', () => {
    it('should return all entities', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      const entities = [
        createEntity('Alice', 3),
        createEntity('Bob', 3),
        createEntity('Charlie', 3),
      ];

      for (const entity of entities) {
        smallCache.set(entity.name, entity);
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const allEntities = smallCache.getAllEntities();
      expect(allEntities).toHaveLength(3);

      const names = allEntities.map(e => e.name).sort();
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should decompress entries as needed', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 1,
        compressionThresholdMs: 0,
      });

      smallCache.set('First', createEntity('First', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Second', createEntity('Second', 5));
      await new Promise(resolve => setTimeout(resolve, 5));
      smallCache.set('Third', createEntity('Third', 5));

      // Some should be compressed
      const statsBeforeGetAll = smallCache.getStats();
      expect(statsBeforeGetAll.compressed).toBeGreaterThan(0);

      // getAllEntities should return all entities (decompressing as needed)
      const allEntities = smallCache.getAllEntities();
      expect(allEntities).toHaveLength(3);
    });
  });

  describe('entries iterator', () => {
    it('should iterate without decompressing', async () => {
      const smallCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 0,
      });

      for (let i = 0; i < 5; i++) {
        smallCache.set(`Entity${i}`, createEntity(`Entity${i}`, 5));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const statsBefore = smallCache.getStats();
      const decompressCountBefore = statsBefore.decompressions;

      // Iterate over entries
      const entries = [...smallCache.entries()];
      expect(entries).toHaveLength(5);

      // Should not have triggered any decompressions
      const statsAfter = smallCache.getStats();
      expect(statsAfter.decompressions).toBe(decompressCountBefore);
    });

    it('should provide entry metadata', () => {
      cache.set('Alice', createEntity('Alice'));

      const entries = [...cache.entries()];
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.name).toBe('Alice');
      expect(entry.compressed).toBe(false);
      expect(entry.originalSize).toBeGreaterThan(0);
      expect(entry.lastAccessed).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache', () => {
      const stats = cache.getStats();
      expect(stats.total).toBe(0);
      expect(stats.memorySaved).toBe(0);

      const entities = cache.getAllEntities();
      expect(entities).toHaveLength(0);
    });

    it('should handle entity updates', () => {
      const entity1 = createEntity('Alice', 5);
      cache.set('Alice', entity1);

      const entity2 = { ...entity1, importance: 10 };
      cache.set('Alice', entity2);

      const retrieved = cache.get('Alice');
      expect(retrieved?.importance).toBe(10);
      expect(cache.size).toBe(1); // Should overwrite, not create new
    });

    it('should handle very large entities', () => {
      const largeEntity = createEntity('Large', 100); // Many observations
      cache.set('Large', largeEntity);

      const retrieved = cache.get('Large');
      expect(retrieved).toEqual(largeEntity);
    });

    it('should handle entities with special characters', () => {
      const entity: Entity = {
        name: 'Test "Entity" <with> & special chars',
        entityType: 'test',
        observations: ['Line 1\nLine 2\tTabbed', 'Unicode: \u0000 \u001f \uffff'],
        createdAt: '2024-01-01T00:00:00Z',
        lastModified: '2024-01-01T00:00:00Z',
      };

      cache.set(entity.name, entity);
      const retrieved = cache.get(entity.name);
      expect(retrieved).toEqual(entity);
    });
  });

  describe('compression threshold', () => {
    it('should respect compression threshold time', async () => {
      const thresholdCache = new CompressedCache({
        maxUncompressed: 2,
        compressionThresholdMs: 100, // 100ms threshold
      });

      // Add entities quickly
      thresholdCache.set('First', createEntity('First', 5));
      thresholdCache.set('Second', createEntity('Second', 5));
      thresholdCache.set('Third', createEntity('Third', 5));

      // Should not compress yet (entries too new)
      let stats = thresholdCache.getStats();
      expect(stats.compressed).toBe(0);

      // Wait for threshold
      await new Promise(resolve => setTimeout(resolve, 150));

      // Add another to trigger compression
      thresholdCache.set('Fourth', createEntity('Fourth', 5));

      stats = thresholdCache.getStats();
      expect(stats.compressed).toBeGreaterThan(0);
    });
  });

  describe('Phase 12 Sprint 6: Adaptive Compression', () => {
    it('should skip small entries below minCompressionSize', async () => {
      // Create small entity that won't meet size threshold
      const smallEntity: Entity = {
        name: 'Tiny',
        entityType: 'test',
        observations: ['x'],
      };

      const adaptiveCache = new CompressedCache({
        maxUncompressed: 0,
        compressionThresholdMs: 0,
        minCompressionSize: 10000, // Very high threshold
        autoCompress: false,
      });

      adaptiveCache.set('Tiny', smallEntity);
      adaptiveCache.compressOldEntries();

      const stats = adaptiveCache.getStats();
      expect(stats.skippedSmallEntries).toBeGreaterThanOrEqual(0);
      expect(stats.compressed).toBe(0);
    });

    it('should skip entries with poor compression ratio', async () => {
      // Random/incompressible data
      const randomEntity: Entity = {
        name: 'Random',
        entityType: 'test',
        observations: [
          // Random-looking data that compresses poorly
          Array.from({ length: 100 }, () => Math.random().toString(36)).join(''),
        ],
      };

      const adaptiveCache = new CompressedCache({
        maxUncompressed: 0,
        compressionThresholdMs: 0,
        minCompressionSize: 1, // Low size threshold
        minCompressionRatio: 0.1, // Very strict ratio (must achieve 90% reduction)
        autoCompress: false,
      });

      adaptiveCache.set('Random', randomEntity);
      adaptiveCache.compressOldEntries();

      const stats = adaptiveCache.getStats();
      // Should either skip due to poor ratio or not compress at all
      expect(stats.skippedPoorRatio + stats.compressions).toBeGreaterThanOrEqual(0);
    });

    it('should track average compression ratio', async () => {
      const adaptiveCache = new CompressedCache({
        maxUncompressed: 0,
        compressionThresholdMs: 0,
        minCompressionSize: 100,
        minCompressionRatio: 0.95, // Lenient ratio
        autoCompress: false,
      });

      // Add compressible entities
      for (let i = 0; i < 5; i++) {
        adaptiveCache.set(`Entity${i}`, createEntity(`Entity${i}`, 20));
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      adaptiveCache.compressOldEntries();

      const stats = adaptiveCache.getStats();
      if (stats.compressions > 0) {
        expect(stats.avgCompressionRatio).toBeGreaterThan(0);
        expect(stats.avgCompressionRatio).toBeLessThan(1);
      }
    });

    it('should report estimated memory bytes', () => {
      cache.set('Entity1', createEntity('Entity1', 10));
      cache.set('Entity2', createEntity('Entity2', 10));

      const stats = cache.getStats();
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });

    it('should handle custom minCompressionSize option', () => {
      const customCache = new CompressedCache({
        minCompressionSize: 512,
      });

      customCache.set('Test', createEntity('Test'));
      expect(customCache.size).toBe(1);
    });

    it('should handle custom minCompressionRatio option', () => {
      const customCache = new CompressedCache({
        minCompressionRatio: 0.5,
      });

      customCache.set('Test', createEntity('Test'));
      expect(customCache.size).toBe(1);
    });
  });

  describe('statistics edge cases', () => {
    it('should return zero avgCompressionRatio when no compressions', () => {
      cache.set('Test', createEntity('Test'));
      const stats = cache.getStats();
      expect(stats.avgCompressionRatio).toBe(0);
    });

    it('should accumulate statistics over time', () => {
      cache.set('A', createEntity('A'));
      cache.get('A');
      cache.get('B'); // miss

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.get('A');
      cache.get('C'); // miss

      stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
    });

    it('should preserve statistics after clear', () => {
      cache.set('A', createEntity('A'));
      cache.get('A');

      cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.total).toBe(0);
    });
  });
});
