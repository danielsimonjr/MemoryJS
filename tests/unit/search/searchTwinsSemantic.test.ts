/**
 * Pin tests for SemanticSearch.search and SemanticSearch.findSimilar.
 *
 * Each golden value is the output of one method on a fixed vector store.
 * The two methods ask the vector store for different counts,
 * and each count is pinned here.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SemanticSearch,
  MockEmbeddingService,
  InMemoryVectorStore,
} from '../../../src/search/index.js';
import type { Entity, KnowledgeGraph } from '../../../src/types/index.js';

const entities: Entity[] = [
  { name: 'Alice', entityType: 'person', observations: ['Works at Acme on databases'] },
  { name: 'Bob', entityType: 'person', observations: ['Works at Acme on frontend'] },
  { name: 'Carol', entityType: 'person', observations: ['Lives in Paris and bakes bread'] },
  { name: 'Dave', entityType: 'person', observations: ['Sails boats on weekends'] },
];
const graph: KnowledgeGraph = { entities, relations: [] };

const createIndexed = async () => {
  const store = new InMemoryVectorStore();
  const semantic = new SemanticSearch(new MockEmbeddingService(), store);
  await semantic.indexAll(graph);
  return { store, semantic };
};

describe('SemanticSearch.search pins', () => {
  it('returns the golden ranked results for a query', async () => {
    const { semantic } = await createIndexed();

    const results = await semantic.search(graph, 'databases at Acme', 2);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Alice', 0.9845857294500711],
      ['Carol', 0.7991982176902288],
    ]);
  });

  it('asks the vector store for twice the limit', async () => {
    const { store, semantic } = await createIndexed();
    const searchSpy = vi.spyOn(store, 'search');

    await semantic.search(graph, 'databases at Acme', 2);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0][1]).toBe(4);
  });

  it('drops results below minSimilarity and returns the golden result', async () => {
    const { semantic } = await createIndexed();

    const results = await semantic.search(graph, 'Acme', 2, 0.9);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Bob', 0.9819155972660354],
    ]);
  });

  it('returns no result when every score is below minSimilarity', async () => {
    const { semantic } = await createIndexed();

    const results = await semantic.search(graph, 'Acme', 2, 2);

    expect(results).toStrictEqual([]);
  });

  it('keeps a result that clears a low minSimilarity', async () => {
    const { semantic } = await createIndexed();

    const results = await semantic.search(graph, 'bread in Paris', 1, 0.2);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Carol', 0.9807659625419505],
    ]);
  });
});

describe('SemanticSearch.findSimilar pins', () => {
  it('excludes the entity itself and returns the golden results', async () => {
    const { semantic } = await createIndexed();

    const results = await semantic.findSimilar(graph, 'Alice', 2);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Carol', 0.89200747633589],
    ]);
  });

  it('asks the vector store for the limit plus one', async () => {
    const { store, semantic } = await createIndexed();
    const searchSpy = vi.spyOn(store, 'search');

    await semantic.findSimilar(graph, 'Alice', 2);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0][1]).toBe(3);
  });

  it('returns an empty list and does not search for an unknown name', async () => {
    const { store, semantic } = await createIndexed();
    const getSpy = vi.spyOn(store, 'get');
    const searchSpy = vi.spyOn(store, 'search');

    const results = await semantic.findSimilar(graph, 'Nobody', 2);

    expect(results).toStrictEqual([]);
    expect(getSpy).toHaveBeenCalledWith('Nobody');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('indexes a graph entity that is missing from the store, then searches', async () => {
    const store = new InMemoryVectorStore();
    const semantic = new SemanticSearch(new MockEmbeddingService(), store);
    await semantic.indexEntity(entities[0]);
    await semantic.indexEntity(entities[3]);

    const results = await semantic.findSimilar(graph, 'Carol', 3);

    expect(store.get('Carol')).toBeDefined();
    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Alice', 0.89200747633589],
    ]);
  });

  it('applies the limit and minSimilarity after the self-skip', async () => {
    const store = new InMemoryVectorStore();
    const semantic = new SemanticSearch(new MockEmbeddingService(), store);
    await semantic.indexEntity(entities[0]);
    await semantic.indexEntity(entities[2]);

    const results = await semantic.findSimilar(graph, 'Alice', 1, 0.5);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Carol', 0.89200747633589],
    ]);
  });
});

describe('SemanticSearch member lookups', () => {
  /** Wrap a search object so that each string member that a call reads is logged. */
  const withLookupLog = (semantic: SemanticSearch) => {
    const log: string[] = [];
    const proxy = new Proxy(semantic, {
      get(target, property, receiver) {
        if (typeof property === 'string') log.push(property);
        return Reflect.get(target, property, receiver);
      },
    });
    return { proxy, log };
  };

  it('search reads these members of this, in this order', async () => {
    const { semantic } = await createIndexed();
    const { proxy, log } = withLookupLog(semantic);

    await proxy.search(graph, 'databases at Acme', 2);

    expect(log).toStrictEqual([
      'search',
      'ensureStoreReady',
      'storeReady',
      'storeReady',
      'embedCached',
      'embeddingCache',
      'embeddingService',
      'embeddingCache',
      'vectorStore',
      'buildEntityMap',
    ]);
  });

  it('findSimilar reads these members of this, in this order', async () => {
    const { semantic } = await createIndexed();
    const { proxy, log } = withLookupLog(semantic);

    await proxy.findSimilar(graph, 'Alice', 2);

    expect(log).toStrictEqual([
      'findSimilar',
      'ensureStoreReady',
      'storeReady',
      'storeReady',
      'vectorStore',
      'vectorStore',
      'buildEntityMap',
    ]);
  });
});

describe('SemanticSearch result tail pins', () => {
  it('search keeps a hit whose score equals minSimilarity', async () => {
    const { store, semantic } = await createIndexed();
    vi.spyOn(store, 'search').mockReturnValue([
      { name: 'Alice', score: 0.5 },
      { name: 'Bob', score: 0.4999999 },
      { name: 'Carol', score: 0.5 },
    ]);

    const results = await semantic.search(graph, 'databases', 10, 0.5);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Alice', 0.5],
      ['Carol', 0.5],
    ]);
  });

  it('findSimilar keeps a hit whose score equals minSimilarity', async () => {
    const { store, semantic } = await createIndexed();
    vi.spyOn(store, 'search').mockReturnValue([
      { name: 'Bob', score: 0.5 },
      { name: 'Carol', score: 0.4999999 },
      { name: 'Dave', score: 0.5 },
    ]);

    const results = await semantic.findSimilar(graph, 'Alice', 10, 0.5);

    expect(results.map(result => [result.entity.name, result.similarity])).toStrictEqual([
      ['Bob', 0.5],
      ['Dave', 0.5],
    ]);
  });

  it('findSimilar excludes the exact name only, with no trimming', async () => {
    const spaced: Entity[] = [
      { name: ' Alice ', entityType: 'person', observations: ['spaced name'] },
      { name: 'Alice', entityType: 'person', observations: ['plain name'] },
      { name: 'Bob', entityType: 'person', observations: ['other name'] },
    ];
    const spacedGraph: KnowledgeGraph = { entities: spaced, relations: [] };
    const store = new InMemoryVectorStore();
    const semantic = new SemanticSearch(new MockEmbeddingService(), store);
    await semantic.indexAll(spacedGraph);
    vi.spyOn(store, 'search').mockReturnValue([
      { name: ' Alice ', score: 0.9 },
      { name: 'Alice', score: 0.8 },
      { name: 'Bob', score: 0.7 },
    ]);

    const results = await semantic.findSimilar(spacedGraph, ' Alice ', 5, 0);

    expect(results.map(result => result.entity.name)).toStrictEqual(['Alice', 'Bob']);
  });
});
