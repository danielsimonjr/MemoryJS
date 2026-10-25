/**
 * Semantic Search Tests
 *
 * Phase 4 Sprint 12: Tests for semantic search functionality.
 *
 * @module __tests__/unit/search/SemanticSearch.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SemanticSearch,
  entityToText,
  MockEmbeddingService,
  InMemoryVectorStore,
} from '../../../src/search/index.js';
import { SQLiteVectorStore } from '../../../src/search/VectorStore.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
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

/** One open "process": its own storage, embedding service, vector store and search. */
interface SearchProcess {
  storage: SQLiteStorage;
  embedding: MockEmbeddingService;
  store: SQLiteVectorStore;
  search: SemanticSearch;
}

describe('SemanticSearch with SQLiteVectorStore', () => {
  let dir: string;
  let open: SearchProcess[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'semantic-search-'));
    open = [];
  });

  afterEach(() => {
    for (const proc of open) {
      proc.storage.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function openProcess(): SearchProcess {
    const storage = new SQLiteStorage(join(dir, 'memory.db'));
    const embedding = new MockEmbeddingService(8);
    const store = new SQLiteVectorStore(storage, 'mock-model');
    const proc = { storage, embedding, store, search: new SemanticSearch(embedding, store) };
    open.push(proc);
    return proc;
  }

  function closeProcess(proc: SearchProcess): void {
    proc.storage.close();
    open.splice(open.indexOf(proc), 1);
  }

  /** Save entities and load them back, so each entity carries its stored contentHash. */
  async function saveAndLoad(storage: SQLiteStorage, entities: Entity[]) {
    await storage.saveGraph({ entities, relations: [] });
    return storage.loadGraph();
  }

  it('skips unchanged entities in a second process', async () => {
    const first = openProcess();
    const graph = await saveAndLoad(first.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    expect(await first.search.indexAll(graph)).toEqual({ indexed: 1, skipped: 0, errors: 0 });
    closeProcess(first);

    const second = openProcess();
    const embedSpy = vi.spyOn(second.embedding, 'embedBatch');
    const reloaded = await second.storage.loadGraph();
    expect(await second.search.indexAll(reloaded)).toEqual({ indexed: 0, skipped: 1, errors: 0 });
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('re-embeds once when the contentHash changes', async () => {
    const proc = openProcess();
    const graph = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    expect(await proc.search.indexAll(graph)).toMatchObject({ indexed: 1 });

    const changed = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h2' },
    ]);
    expect(await proc.search.indexAll(changed)).toMatchObject({ indexed: 1 });
    expect(await proc.search.indexAll(changed)).toMatchObject({ skipped: 1 });
  });

  it('re-embeds a row that has no stored hash once', async () => {
    const proc = openProcess();
    const graph = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    proc.store.add('a', [1, 0, 0, 0, 0, 0, 0, 0]);
    expect(await proc.search.indexAll(graph)).toMatchObject({ indexed: 1 });
    expect(await proc.search.indexAll(graph)).toMatchObject({ skipped: 1 });
  });

  it('replaces a row that another model wrote, with one re-embed under its own model', async () => {
    // Turn embeddings of older releases carry the model 'unknown' (PR 207 fixed new writes only).
    // The store keeps such a row in SQLite but not in memory, so indexAll embeds the entity again
    // and the write replaces the row. No separate migration has to run.
    const proc = openProcess();
    const graph = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    proc.storage.storeEmbedding('a', [1, 0, 0, 0, 0, 0, 0, 0], 'unknown', 'h1');
    await proc.store.initialize();
    expect(proc.store.has('a')).toBe(false);

    expect(await proc.search.indexAll(graph)).toEqual({ indexed: 1, skipped: 0, errors: 0 });
    const rows = await proc.storage.loadEmbeddingMetadata();
    expect(rows).toEqual([{ entityName: 'a', embeddingModel: 'mock-model', contentHash: 'h1' }]);
    expect(await proc.search.indexAll(graph)).toEqual({ indexed: 0, skipped: 1, errors: 0 });
  });

  it('hashes the text of an entity without contentHash, and re-embeds it once after an edit', async () => {
    const first = openProcess();
    const graph = await saveAndLoad(first.storage, [createTestEntity('a', 'thing', ['alpha'])]);
    expect(await first.search.indexAll(graph)).toMatchObject({ indexed: 1 });
    closeProcess(first);

    const second = openProcess();
    const reloaded = await second.storage.loadGraph();
    expect(await second.search.indexAll(reloaded)).toEqual({ indexed: 0, skipped: 1, errors: 0 });

    const edited = await saveAndLoad(second.storage, [createTestEntity('a', 'thing', ['alpha', 'beta'])]);
    expect(await second.search.indexAll(edited)).toMatchObject({ indexed: 1, skipped: 0 });
    expect(await second.search.indexAll(edited)).toMatchObject({ indexed: 0, skipped: 1 });
  });

  it('stores the text hash when indexEntity gets an entity without contentHash', async () => {
    const proc = openProcess();
    const entity = createTestEntity('a', 'thing', ['alpha']);
    await proc.storage.saveGraph({ entities: [entity], relations: [] });
    expect(await proc.search.indexEntity(entity)).toBe(true);
    expect(proc.store.getContentHash('a')).toMatch(/^[0-9a-f]{64}$/);
    expect(await proc.search.indexAll({ entities: [entity], relations: [] })).toMatchObject({ skipped: 1 });
  });

  it('does not leave a vector behind or count an entity twice when the store write fails', async () => {
    const proc = openProcess();
    await proc.storage.saveGraph({ entities: [createTestEntity('a', 'thing', ['alpha'])], relations: [] });
    const graph = {
      entities: [
        createTestEntity('a', 'thing', ['alpha']),
        createTestEntity('ghost', 'thing', ['x']),
        createTestEntity('z', 'thing', ['y']),
      ],
      relations: [],
    };
    expect(await proc.search.indexAll(graph)).toEqual({ indexed: 1, skipped: 0, errors: 2 });
    expect(proc.store.has('ghost')).toBe(false);
    expect(proc.store.size()).toBe(1);
  });

  it('search before indexAll finds persisted vectors', async () => {
    const first = openProcess();
    const graph = await saveAndLoad(first.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    await first.search.indexAll(graph);
    closeProcess(first);

    const second = openProcess();
    const reloaded = await second.storage.loadGraph();
    const results = await second.search.search(reloaded, 'x', 10, -1);
    expect(results.map(r => r.entity.name)).toContain('a');
  });

  it('loads the store once for concurrent first calls', async () => {
    const proc = openProcess();
    const graph = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    const initSpy = vi.spyOn(proc.store, 'initialize');

    await Promise.all([
      proc.search.search(graph, 'x', 10, -1),
      proc.search.indexAll(graph),
      proc.search.search(graph, 'y', 10, -1),
    ]);

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('retries the load after the store initialize rejects once', async () => {
    const proc = openProcess();
    const graph = await saveAndLoad(proc.storage, [
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    const realInit = proc.store.initialize.bind(proc.store);
    const initSpy = vi
      .spyOn(proc.store, 'initialize')
      .mockRejectedValueOnce(new Error('disk busy'))
      .mockImplementation(realInit);

    await expect(proc.search.indexAll(graph)).rejects.toThrow('disk busy');
    expect(await proc.search.indexAll(graph)).toMatchObject({ indexed: 1 });
    expect(initSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the old behavior with InMemoryVectorStore', async () => {
    const embedding = new MockEmbeddingService(8);
    const search = new SemanticSearch(embedding, new InMemoryVectorStore());
    const graph = createTestGraph([
      { ...createTestEntity('a', 'thing', ['alpha']), contentHash: 'h1' },
    ]);
    expect(await search.indexAll(graph)).toMatchObject({ indexed: 1 });
    expect(await search.indexAll(graph)).toMatchObject({ skipped: 1 });
  });
});
