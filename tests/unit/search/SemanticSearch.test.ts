/**
 * Semantic Search Tests
 *
 * Phase 4 Sprint 12: Tests for semantic search functionality.
 *
 * @module __tests__/unit/search/SemanticSearch.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SemanticSearch,
  entityToText,
  MockEmbeddingService,
  InMemoryVectorStore,
} from '../../../src/search/index.js';
import type { Entity, KnowledgeGraph } from '../../../src/types/index.js';

// Helper to create test entities
function createTestEntity(name: string, type: string, observations: string[] = [], tags: string[] = []): Entity {
  return {
    name,
    entityType: type,
    observations,
    tags: tags.length > 0 ? tags : undefined,
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
}

// Helper to create test graph
function createTestGraph(entities: Entity[]): KnowledgeGraph {
  return {
    entities,
    relations: [],
  };
}

describe('entityToText', () => {
  it('should include name and type', () => {
    const entity = createTestEntity('Alice', 'person');
    const text = entityToText(entity);
    expect(text).toContain('Alice');
    expect(text).toContain('person');
  });

  it('should include observations', () => {
    const entity = createTestEntity('Alice', 'person', ['Works at Acme', 'Lives in NYC']);
    const text = entityToText(entity);
    expect(text).toContain('Works at Acme');
    expect(text).toContain('Lives in NYC');
  });

  it('should include tags', () => {
    const entity = createTestEntity('Alice', 'person', [], ['engineering', 'leadership']);
    const text = entityToText(entity);
    expect(text).toContain('Tags:');
    expect(text).toContain('engineering');
    expect(text).toContain('leadership');
  });

  it('should limit observations to 10', () => {
    const observations = Array.from({ length: 20 }, (_, i) => `Observation ${i}`);
    const entity = createTestEntity('Alice', 'person', observations);
    const text = entityToText(entity);
    expect(text).toContain('Observation 0');
    expect(text).toContain('Observation 9');
    expect(text).not.toContain('Observation 10');
  });

  it('should handle entity without observations or tags', () => {
    const entity = createTestEntity('Alice', 'person');
    const text = entityToText(entity);
    expect(text).toBe('Alice (person)');
  });
});

describe('SemanticSearch', () => {
  let mockEmbeddingService: MockEmbeddingService;
  let vectorStore: InMemoryVectorStore;
  let semanticSearch: SemanticSearch;

  beforeEach(() => {
    mockEmbeddingService = new MockEmbeddingService(384);
    vectorStore = new InMemoryVectorStore();
    semanticSearch = new SemanticSearch(mockEmbeddingService, vectorStore);
  });

  describe('indexAll', () => {
    it('should index all entities', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
        createTestEntity('Acme', 'company'),
      ]);

      const result = await semanticSearch.indexAll(graph);

      expect(result.indexed).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      expect(semanticSearch.getIndexedCount()).toBe(3);
    });

    it('should skip already indexed entities', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
      ]);

      await semanticSearch.indexAll(graph);
      const result = await semanticSearch.indexAll(graph);

      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(2);
    });

    it('should force reindex when specified', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
      ]);

      await semanticSearch.indexAll(graph);
      const result = await semanticSearch.indexAll(graph, { forceReindex: true });

      expect(result.indexed).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should call progress callback', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
        createTestEntity('Charlie', 'person'),
      ]);

      const progressCalls: [number, number][] = [];
      await semanticSearch.indexAll(graph, {
        onProgress: (current, total) => progressCalls.push([current, total]),
        batchSize: 1,
      });

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1][0]).toBe(3);
    });
  });

  describe('indexEntity', () => {
    it('should index a single entity', async () => {
      const entity = createTestEntity('Alice', 'person');
      const result = await semanticSearch.indexEntity(entity);

      expect(result).toBe(true);
      expect(vectorStore.has('Alice')).toBe(true);
    });

    it('should update existing entity embedding', async () => {
      const entity = createTestEntity('Alice', 'person', ['Old observation']);
      await semanticSearch.indexEntity(entity);

      const updatedEntity = createTestEntity('Alice', 'person', ['New observation']);
      await semanticSearch.indexEntity(updatedEntity);

      expect(vectorStore.size()).toBe(1);
    });
  });

  describe('removeEntity', () => {
    it('should remove entity from index', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
      ]);
      await semanticSearch.indexAll(graph);

      const removed = semanticSearch.removeEntity('Alice');

      expect(removed).toBe(true);
      expect(vectorStore.has('Alice')).toBe(false);
    });

    it('should return false for non-existent entity', () => {
      const removed = semanticSearch.removeEntity('NonExistent');
      expect(removed).toBe(false);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const graph = createTestGraph([
        createTestEntity('Machine Learning Project', 'project', ['Uses neural networks']),
        createTestEntity('Deep Learning Model', 'model', ['CNN architecture']),
        createTestEntity('Database Schema', 'schema', ['SQL tables']),
        createTestEntity('REST API', 'api', ['HTTP endpoints']),
      ]);
      await semanticSearch.indexAll(graph);
    });

    it('should return results sorted by similarity', async () => {
      const graph = createTestGraph([
        createTestEntity('Machine Learning Project', 'project'),
        createTestEntity('Deep Learning Model', 'model'),
        createTestEntity('Database Schema', 'schema'),
        createTestEntity('REST API', 'api'),
      ]);

      const results = await semanticSearch.search(graph, 'machine learning', 10);

      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by similarity (descending)
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it('should respect limit parameter', async () => {
      // Clear and create fresh index
      semanticSearch.clearIndex();
      const graph = createTestGraph([
        createTestEntity('Similar Entity A', 'type', ['This is about testing']),
        createTestEntity('Similar Entity B', 'type', ['This is about testing']),
        createTestEntity('Similar Entity C', 'type', ['This is about testing']),
        createTestEntity('Similar Entity D', 'type', ['This is about testing']),
      ]);
      await semanticSearch.indexAll(graph);

      const results = await semanticSearch.search(graph, 'testing', 2);

      // Should return at most 2 results
      expect(results.length).toBeLessThanOrEqual(2);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by minimum similarity', async () => {
      const graph = createTestGraph([
        createTestEntity('Machine Learning', 'topic'),
        createTestEntity('Cooking Recipe', 'topic'),
      ]);
      await semanticSearch.indexAll(graph);

      const results = await semanticSearch.search(graph, 'machine learning', 10, 0.9);

      // With high threshold, should only get very similar results
      results.forEach(r => {
        expect(r.similarity).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should return empty array for empty graph', async () => {
      const emptyGraph = createTestGraph([]);
      const results = await semanticSearch.search(emptyGraph, 'test', 10);
      expect(results).toEqual([]);
    });
  });

  describe('findSimilar', () => {
    beforeEach(async () => {
      const graph = createTestGraph([
        createTestEntity('Python', 'language', ['Programming language']),
        createTestEntity('JavaScript', 'language', ['Scripting language']),
        createTestEntity('Rust', 'language', ['Systems programming']),
        createTestEntity('Recipe Book', 'book', ['Cooking recipes']),
      ]);
      await semanticSearch.indexAll(graph);
    });

    it('should find similar entities', async () => {
      const graph = createTestGraph([
        createTestEntity('Python', 'language'),
        createTestEntity('JavaScript', 'language'),
        createTestEntity('Rust', 'language'),
        createTestEntity('Recipe Book', 'book'),
      ]);

      const results = await semanticSearch.findSimilar(graph, 'Python', 3);

      expect(results.length).toBeLessThanOrEqual(3);
      // Should not include the entity itself
      expect(results.some(r => r.entity.name === 'Python')).toBe(false);
    });

    it('should return empty for non-existent entity', async () => {
      const graph = createTestGraph([]);
      const results = await semanticSearch.findSimilar(graph, 'NonExistent', 10);
      expect(results).toEqual([]);
    });

    it('should index entity if not already indexed', async () => {
      const newEntity = createTestEntity('Java', 'language', ['OOP language']);
      const graph = createTestGraph([
        newEntity,
        createTestEntity('Python', 'language'),
      ]);

      // Clear and start fresh
      semanticSearch.clearIndex();
      await semanticSearch.indexEntity(createTestEntity('Python', 'language'));

      // findSimilar should index Java automatically
      const results = await semanticSearch.findSimilar(graph, 'Java', 10);

      expect(vectorStore.has('Java')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
      ]);
      await semanticSearch.indexAll(graph);

      const stats = semanticSearch.getStats();

      expect(stats.indexed).toBe(true);
      expect(stats.indexedCount).toBe(2);
      expect(stats.provider).toBe('mock');
      expect(stats.model).toBe('mock-model');
      expect(stats.dimensions).toBe(384);
    });

    it('should report not indexed initially', () => {
      const stats = semanticSearch.getStats();
      expect(stats.indexed).toBe(false);
      expect(stats.indexedCount).toBe(0);
    });
  });

  describe('clearIndex', () => {
    it('should clear all indexed entities', async () => {
      const graph = createTestGraph([
        createTestEntity('Alice', 'person'),
        createTestEntity('Bob', 'person'),
      ]);
      await semanticSearch.indexAll(graph);

      semanticSearch.clearIndex();

      expect(semanticSearch.isIndexed()).toBe(false);
      expect(semanticSearch.getIndexedCount()).toBe(0);
      expect(vectorStore.size()).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('should return true when embedding service is ready', async () => {
      expect(await semanticSearch.isAvailable()).toBe(true);
    });
  });

  describe('getEmbeddingService', () => {
    it('should return the embedding service', () => {
      expect(semanticSearch.getEmbeddingService()).toBe(mockEmbeddingService);
    });
  });

  describe('getVectorStore', () => {
    it('should return the vector store', () => {
      expect(semanticSearch.getVectorStore()).toBe(vectorStore);
    });
  });
});

describe('SemanticSearch with default vector store', () => {
  it('should create with default InMemoryVectorStore', () => {
    const embeddingService = new MockEmbeddingService();
    const semanticSearch = new SemanticSearch(embeddingService);

    expect(semanticSearch.getVectorStore()).toBeInstanceOf(InMemoryVectorStore);
  });
});
