import { describe, expect, it, vi } from 'vitest';
import { BM25Search, type BM25Index } from '../../../src/search/BM25Search.js';
import { RankedSearch } from '../../../src/search/RankedSearch.js';
import type { Entity, IGraphStorage } from '../../../src/types/index.js';
import type { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';

function storageFor(entities: Entity[]): IGraphStorage {
  return {
    loadGraph: async () => ({ entities, relations: [] }),
    ensureLoaded: async () => {},
    getEntityByName: (name: string) => entities.find(e => e.name === name),
    getLowercased: () => undefined,
  } as unknown as IGraphStorage;
}

describe('lexical candidate selection', () => {
  it('visits rare-term postings without iterating the document map', async () => {
    const entities = Array.from({ length: 1000 }, (_, i) => ({
      name: `doc${i}`, entityType: 'note', observations: [i === 700 ? 'rareterm' : 'ordinary'],
    }));
    const search = new BM25Search(storageFor(entities));
    await search.buildIndex();
    const index = (search as unknown as { index: BM25Index }).index;
    const iterator = vi.spyOn(index.documents, Symbol.iterator).mockImplementation(() => { throw new Error('corpus scan'); });
    expect((await search.search('rareterm')).map(r => r.entity.name)).toEqual(['doc700']);
    expect(iterator).not.toHaveBeenCalled();
  });

  it('maintains postings through replacement, deletion, and changed-name update', async () => {
    const entities: Entity[] = [
      { name: 'first', entityType: 'note', observations: ['alpha'] },
      { name: 'second', entityType: 'note', observations: ['beta'] },
    ];
    const search = new BM25Search(storageFor(entities));
    await search.buildIndex();
    entities[0] = { ...entities[0], observations: ['gamma'] };
    search.updateDocument(entities[0]);
    expect(await search.search('alpha')).toEqual([]);
    expect((await search.search('gamma'))[0].entity.name).toBe('first');
    search.removeDocument('first');
    expect(await search.search('gamma')).toEqual([]);
    entities[1] = { ...entities[1], observations: ['delta'] };
    await search.update(new Set(['second']));
    expect(await search.search('beta')).toEqual([]);
    expect((await search.search('delta'))[0].entity.name).toBe('second');
  });

  it('does not exclude a graph-boosted winner below the old 200-hit lexical window', async () => {
    const entities: Entity[] = Array.from({ length: 205 }, (_, i) => ({
      name: `doc${i}`, entityType: 'note', observations: ['signal content'],
    }));
    entities.push({ name: 'background', entityType: 'other', observations: ['unrelated'] });
    const search = new RankedSearch(storageFor(entities));
    search.setGraphPrior({ getScores: async () => new Map([['doc204', 1]]) } as unknown as GraphRankPrior, 1);
    const results = await search.searchNodesRanked('signal', undefined, undefined, undefined, 1);
    expect(results[0].entity.name).toBe('doc204');
  });
});
