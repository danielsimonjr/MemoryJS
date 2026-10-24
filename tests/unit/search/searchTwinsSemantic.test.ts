/**
 * Pin tests for SemanticSearch.search and SemanticSearch.findSimilar.
 *
 * Golden values were recorded from the code before the shared store tail
 * was extracted. The two methods ask the vector store for different counts,
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
