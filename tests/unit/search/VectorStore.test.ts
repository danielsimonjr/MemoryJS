/**
 * Vector Store Tests
 *
 * Phase 4 Sprint 11: Tests for vector store implementations.
 *
 * @module __tests__/unit/search/VectorStore.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryVectorStore,
  SQLiteVectorStore,
  createVectorStore,
  cosineSimilarity,
} from '../../../src/search/VectorStore.js';

describe('cosineSimilarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const v = [0.1, 0.2, 0.3, 0.4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return 1.0 for parallel vectors', () => {
    const v1 = [1, 2, 3];
    const v2 = [2, 4, 6];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const v1 = [1, 0, 0];
    const v2 = [-1, 0, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1, 5);
  });

  it('should throw on dimension mismatch', () => {
    const v1 = [1, 2, 3];
    const v2 = [1, 2];
    expect(() => cosineSimilarity(v1, v2)).toThrow('Vector dimensions mismatch');
  });

  it('should return 0 for zero vectors', () => {
    const v1 = [0, 0, 0];
    const v2 = [1, 2, 3];
    expect(cosineSimilarity(v1, v2)).toBe(0);
  });

  it('should handle high dimensional vectors', () => {
    const v1 = new Array(1536).fill(0).map(() => Math.random());
    const v2 = new Array(1536).fill(0).map(() => Math.random());
    const result = cosineSimilarity(v1, v2);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it('should add vectors', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    expect(store.size()).toBe(1);
    expect(store.has('entity1')).toBe(true);
  });

  it('should get vectors', () => {
    const vector = [0.1, 0.2, 0.3];
    store.add('entity1', vector);
    expect(store.get('entity1')).toEqual(vector);
  });

  it('should return undefined for missing vectors', () => {
    expect(store.get('nonexistent')).toBeUndefined();
    expect(store.has('nonexistent')).toBe(false);
  });

  it('should remove vectors', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    expect(store.remove('entity1')).toBe(true);
    expect(store.has('entity1')).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('should return false when removing non-existent vector', () => {
    expect(store.remove('nonexistent')).toBe(false);
  });

  it('should clear all vectors', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    store.add('entity2', [0.4, 0.5, 0.6]);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('should search for similar vectors', () => {
    store.add('entity1', [1, 0, 0]);
    store.add('entity2', [0, 1, 0]);
    store.add('entity3', [0.9, 0.1, 0]);

    const results = store.search([1, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('entity1');
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results[1].name).toBe('entity3');
  });

  it('should return empty array for empty store', () => {
    const results = store.search([1, 0, 0], 10);
    expect(results).toEqual([]);
  });

  it('should limit results to k', () => {
    for (let i = 0; i < 20; i++) {
      store.add(`entity${i}`, [Math.random(), Math.random(), Math.random()]);
    }

    const results = store.search([0.5, 0.5, 0.5], 5);
    expect(results).toHaveLength(5);
  });

  it('should update existing vectors', () => {
    store.add('entity1', [1, 0, 0]);
    store.add('entity1', [0, 1, 0]);

    expect(store.size()).toBe(1);
    expect(store.get('entity1')).toEqual([0, 1, 0]);
  });

  it('should get entity names', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    store.add('entity2', [0.4, 0.5, 0.6]);

    const names = store.getEntityNames();
    expect(names).toHaveLength(2);
    expect(names).toContain('entity1');
    expect(names).toContain('entity2');
  });

  it('should load from entries', () => {
    const entries: [string, number[]][] = [
      ['entity1', [0.1, 0.2, 0.3]],
      ['entity2', [0.4, 0.5, 0.6]],
    ];

    store.loadFrom(entries);

    expect(store.size()).toBe(2);
    expect(store.get('entity1')).toEqual([0.1, 0.2, 0.3]);
  });

  it('should skip vectors with dimension mismatch during search', () => {
    store.add('entity1', [1, 0, 0]);
    store.add('entity2', [0, 1]); // Different dimensions

    const results = store.search([1, 0, 0], 10);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('entity1');
  });
});

describe('SQLiteVectorStore', () => {
  let store: SQLiteVectorStore;

  beforeEach(() => {
    // Create SQLite store without actual storage (uses in-memory only)
    store = new SQLiteVectorStore(undefined, 'test-model');
  });

  it('should add vectors to memory cache', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    expect(store.size()).toBe(1);
    expect(store.has('entity1')).toBe(true);
  });

  it('should get vectors', () => {
    const vector = [0.1, 0.2, 0.3];
    store.add('entity1', vector);
    expect(store.get('entity1')).toEqual(vector);
  });

  it('should remove vectors', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    expect(store.remove('entity1')).toBe(true);
    expect(store.has('entity1')).toBe(false);
  });

  it('should clear all vectors', () => {
    store.add('entity1', [0.1, 0.2, 0.3]);
    store.add('entity2', [0.4, 0.5, 0.6]);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('should search for similar vectors', () => {
    store.add('entity1', [1, 0, 0]);
    store.add('entity2', [0, 1, 0]);

    const results = store.search([1, 0, 0], 2);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('entity1');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('should allow setting embedding model', () => {
    store.setEmbeddingModel('new-model');
    // Verify by adding a vector (model is used when persisting)
    store.add('entity1', [0.1, 0.2, 0.3]);
    expect(store.has('entity1')).toBe(true);
  });
});

describe('createVectorStore factory', () => {
  it('should create InMemoryVectorStore for jsonl', () => {
    const store = createVectorStore('jsonl');
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should create SQLiteVectorStore for sqlite', () => {
    const store = createVectorStore('sqlite');
    expect(store).toBeInstanceOf(SQLiteVectorStore);
  });

  it('should default to InMemoryVectorStore', () => {
    const store = createVectorStore();
    expect(store).toBeInstanceOf(InMemoryVectorStore);
  });

  it('should pass embedding model to SQLiteVectorStore', () => {
    const store = createVectorStore('sqlite', undefined, 'test-model');
    expect(store).toBeInstanceOf(SQLiteVectorStore);
  });
});

describe('VectorStore performance', () => {
  it('should handle 1000 vectors efficiently', () => {
    const store = new InMemoryVectorStore();
    const dimensions = 384;

    // Add 1000 vectors
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const vector = new Array(dimensions).fill(0).map(() => Math.random());
      store.add(`entity${i}`, vector);
    }
    const addTime = Date.now() - start;

    expect(store.size()).toBe(1000);
    expect(addTime).toBeLessThan(1000); // Should complete in under 1 second

    // Search should also be fast
    const queryVector = new Array(dimensions).fill(0).map(() => Math.random());
    const searchStart = Date.now();
    const results = store.search(queryVector, 10);
    const searchTime = Date.now() - searchStart;

    expect(results).toHaveLength(10);
    expect(searchTime).toBeLessThan(500); // Search should be fast
  });

  it('should handle high-dimensional vectors (1536)', () => {
    const store = new InMemoryVectorStore();
    const dimensions = 1536; // OpenAI embedding dimensions

    // Add 100 high-dimensional vectors
    for (let i = 0; i < 100; i++) {
      const vector = new Array(dimensions).fill(0).map(() => Math.random());
      store.add(`entity${i}`, vector);
    }

    expect(store.size()).toBe(100);

    // Search should work correctly
    const queryVector = new Array(dimensions).fill(0).map(() => Math.random());
    const results = store.search(queryVector, 5);

    expect(results).toHaveLength(5);
    results.forEach(r => {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });
});
