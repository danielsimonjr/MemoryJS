/**
 * QuantizedVectorStore Unit Tests
 *
 * Phase 12 Sprint 6: Tests for 8-bit scalar quantization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QuantizedVectorStore } from '../../../src/search/QuantizedVectorStore.js';

describe('QuantizedVectorStore', () => {
  let store: QuantizedVectorStore;

  const createVector = (dimension: number, seed: number = 0): number[] => {
    return Array.from({ length: dimension }, (_, i) => Math.sin(seed + i) * 0.5 + 0.5);
  };

  beforeEach(() => {
    store = new QuantizedVectorStore({ minVectorsForQuantization: 5 });
  });

  describe('basic operations', () => {
    it('should add and retrieve vectors', () => {
      const vector = createVector(128, 1);
      store.add('entity1', vector);

      expect(store.has('entity1')).toBe(true);
      expect(store.size()).toBe(1);

      const retrieved = store.get('entity1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.length).toBe(128);
    });

    it('should remove vectors', () => {
      store.add('entity1', createVector(64));
      expect(store.has('entity1')).toBe(true);

      const removed = store.remove('entity1');
      expect(removed).toBe(true);
      expect(store.has('entity1')).toBe(false);
    });

    it('should clear all vectors', () => {
      store.add('entity1', createVector(64));
      store.add('entity2', createVector(64));
      expect(store.size()).toBe(2);

      store.clear();
      expect(store.size()).toBe(0);
    });

    it('should handle non-existent entities', () => {
      expect(store.has('nonexistent')).toBe(false);
      expect(store.get('nonexistent')).toBeUndefined();
      expect(store.remove('nonexistent')).toBe(false);
    });
  });

  describe('quantization', () => {
    it('should not quantize below threshold', () => {
      // Add only 3 vectors (below threshold of 5)
      store.add('entity1', createVector(64, 1));
      store.add('entity2', createVector(64, 2));
      store.add('entity3', createVector(64, 3));

      expect(store.isUsingQuantization()).toBe(false);
    });

    it('should auto-quantize at threshold', () => {
      // Add 5 vectors (at threshold)
      for (let i = 0; i < 5; i++) {
        store.add(`entity${i}`, createVector(64, i));
      }

      expect(store.isUsingQuantization()).toBe(true);
    });

    it('should force quantization', () => {
      store.add('entity1', createVector(64, 1));
      store.add('entity2', createVector(64, 2));
      expect(store.isUsingQuantization()).toBe(false);

      store.quantize();
      expect(store.isUsingQuantization()).toBe(true);
    });

    it('should achieve 4x memory reduction', () => {
      // Add enough vectors to trigger quantization
      for (let i = 0; i < 10; i++) {
        store.add(`entity${i}`, createVector(64, i));
      }

      const stats = store.getStats();
      expect(stats.memoryReductionRatio).toBeCloseTo(4, 1);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Add vectors
      for (let i = 0; i < 10; i++) {
        store.add(`entity${i}`, createVector(64, i));
      }
    });

    it('should find similar vectors', () => {
      const query = createVector(64, 0); // Same as entity0
      const results = store.search(query, 3);

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('entity0');
      expect(results[0].similarity).toBeGreaterThan(0.9);
    });

    it('should respect k parameter', () => {
      const query = createVector(64, 5);
      const results = store.search(query, 2);

      expect(results.length).toBe(2);
    });

    it('should sort by similarity descending', () => {
      const query = createVector(64, 0);
      const results = store.search(query, 5);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should compute similarity for specific entity', () => {
      const query = createVector(64, 0);
      const similarity = store.computeSimilarity(query, 'entity0');

      expect(similarity).toBeDefined();
      expect(similarity).toBeGreaterThan(0.9);
    });

    it('should return undefined for non-existent entity', () => {
      const query = createVector(64, 0);
      const similarity = store.computeSimilarity(query, 'nonexistent');

      expect(similarity).toBeUndefined();
    });
  });

  describe('accuracy', () => {
    it('should maintain accuracy with quantization', () => {
      const storeWithAccuracy = new QuantizedVectorStore({
        minVectorsForQuantization: 5,
        trackAccuracy: true,
      });

      // Add vectors
      for (let i = 0; i < 10; i++) {
        storeWithAccuracy.add(`entity${i}`, createVector(64, i));
      }

      const stats = storeWithAccuracy.getStats();
      // Quantization error should be small (< 0.1)
      expect(stats.avgQuantizationError).toBeLessThan(0.1);
    });

    it('should use asymmetric similarity by default', () => {
      for (let i = 0; i < 10; i++) {
        store.add(`entity${i}`, createVector(64, i));
      }

      const query = createVector(64, 0);
      const results = store.search(query, 3);

      // Results should be marked as quantized
      expect(results[0].quantized).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should report correct stats', () => {
      for (let i = 0; i < 10; i++) {
        store.add(`entity${i}`, createVector(64, i));
      }

      const stats = store.getStats();

      expect(stats.vectorCount).toBe(10);
      expect(stats.dimension).toBe(64);
      expect(stats.fullPrecisionBytes).toBe(10 * 64 * 4);
      expect(stats.quantizedBytes).toBe(10 * 64 * 1);
    });

    it('should report zero stats when empty', () => {
      const stats = store.getStats();

      expect(stats.vectorCount).toBe(0);
      expect(stats.dimension).toBe(0);
      expect(stats.memoryReductionRatio).toBe(1);
    });
  });

  describe('import/export', () => {
    it('should export all vectors', () => {
      store.add('entity1', createVector(64, 1));
      store.add('entity2', createVector(64, 2));

      const exported = store.export();
      expect(exported.size).toBe(2);
      expect(exported.has('entity1')).toBe(true);
      expect(exported.has('entity2')).toBe(true);
    });

    it('should import vectors', () => {
      const vectors = new Map<string, number[]>();
      vectors.set('entity1', createVector(64, 1));
      vectors.set('entity2', createVector(64, 2));

      store.import(vectors, false);

      expect(store.size()).toBe(2);
      expect(store.has('entity1')).toBe(true);
      expect(store.has('entity2')).toBe(true);
    });

    it('should quantize after import', () => {
      const vectors = new Map<string, number[]>();
      for (let i = 0; i < 10; i++) {
        vectors.set(`entity${i}`, createVector(64, i));
      }

      store.import(vectors, true);

      expect(store.isUsingQuantization()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle single dimension vectors', () => {
      store.add('entity1', [0.5]);
      store.add('entity2', [0.3]);
      store.add('entity3', [0.7]);
      store.add('entity4', [0.1]);
      store.add('entity5', [0.9]);

      const results = store.search([0.5], 3);
      expect(results.length).toBe(3);
      expect(results[0].id).toBe('entity1');
    });

    it('should handle high-dimensional vectors', () => {
      for (let i = 0; i < 10; i++) {
        store.add(`entity${i}`, createVector(1024, i));
      }

      const stats = store.getStats();
      expect(stats.dimension).toBe(1024);

      const results = store.search(createVector(1024, 0), 3);
      expect(results.length).toBe(3);
    });

    it('should handle empty store search', () => {
      const results = store.search(createVector(64, 0), 3);
      expect(results.length).toBe(0);
    });

    it('should handle search with k larger than store size', () => {
      store.add('entity1', createVector(64, 1));
      store.add('entity2', createVector(64, 2));

      const results = store.search(createVector(64, 0), 10);
      expect(results.length).toBe(2);
    });
  });
});
