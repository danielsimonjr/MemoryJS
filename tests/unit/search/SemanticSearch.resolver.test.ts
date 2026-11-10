import { describe, expect, it, vi } from 'vitest';
import { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import { InMemoryVectorStore } from '../../../src/search/VectorStore.js';
import { MockEmbeddingService } from '../../../src/search/EmbeddingService.js';
import type { Entity, KnowledgeGraph } from '../../../src/types/index.js';

describe('SemanticSearch entity resolution', () => {
  it('resolves only hits through the supplied authoritative lookup', async () => {
    const embedding = new MockEmbeddingService(8);
    const store = new InMemoryVectorStore();
    store.add('a', await embedding.embed('query', 'query'));
    const entity: Entity = { name: 'a', entityType: 'test', observations: [] };
    const graph: KnowledgeGraph = { entities: [], relations: [] };
    const resolver = vi.fn((name: string, supplied: KnowledgeGraph) => {
      expect(supplied).toBe(graph); return name === 'a' ? entity : undefined;
    });
    const search = new SemanticSearch(embedding, store, { resolveEntity: resolver });
    expect((await search.search(graph, 'query', 1))[0].entity).toBe(entity);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('keeps default resolution fresh when the same graph object changes', async () => {
    const embedding = new MockEmbeddingService(8);
    const store = new InMemoryVectorStore();
    store.add('a', await embedding.embed('query', 'query'));
    const graph: KnowledgeGraph = { entities: [{ name: 'a', entityType: 'old', observations: [] }], relations: [] };
    const search = new SemanticSearch(embedding, store);
    expect((await search.search(graph, 'query', 1))[0].entity.entityType).toBe('old');
    graph.entities[0] = { name: 'a', entityType: 'new', observations: [] };
    expect((await search.search(graph, 'query', 1))[0].entity.entityType).toBe('new');
    graph.entities = [];
    expect(await search.search(graph, 'query', 1)).toEqual([]);
  });
});

describe('SemanticSearch findSimilar failed indexing', () => {
  it('returns without retrying recursively when embedding fails', async () => {
    const embedding = new MockEmbeddingService(8);
    const embed = vi.spyOn(embedding, 'embed').mockRejectedValue(new Error('provider unavailable'));
    const graph: KnowledgeGraph = { entities: [{ name: 'a', entityType: 'test', observations: [] }], relations: [] };
    const search = new SemanticSearch(embedding, new InMemoryVectorStore());
    expect(await search.findSimilar(graph, 'a')).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(1);
  });
});


describe('SemanticSearch empty result limits', () => {
  it('returns no other entity for findSimilar with a zero limit', async () => {
    const embedding = new MockEmbeddingService(8);
    const store = new InMemoryVectorStore();
    store.add('a', [1, 0]); store.add('b', [1, 0]);
    const graph: KnowledgeGraph = { entities: [
      { name: 'a', entityType: 'test', observations: [] },
      { name: 'b', entityType: 'test', observations: [] },
    ], relations: [] };
    const search = new SemanticSearch(embedding, store);
    expect(await search.findSimilar(graph, 'b', 0)).toEqual([]);
    expect(await search.findSimilar(graph, 'b', NaN)).toEqual([]);
  });
});
