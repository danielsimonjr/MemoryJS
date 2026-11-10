import { describe, expect, it, vi } from 'vitest';
import { FuzzySearch } from '../../../src/search/FuzzySearch.js';
import type { Entity, LowercaseData } from '../../../src/types/index.js';
import type { GraphStorage } from '../../../src/core/GraphStorage.js';
import { NGramIndex } from '../../../src/search/NGramIndex.js';
import { BloomPreScreener } from '../../../src/search/BloomPreScreener.js';
import { bumpEntityGeneration } from '../../../src/utils/searchCache.js';
import type { WorkerInput } from '../../../src/workers/levenshteinWorker.js';

function fixture(entities: Entity[]) {
  const normalized = new Map<string, LowercaseData>();
  for (const e of entities) normalized.set(e.name, {
    name: e.name.toLowerCase(), entityType: e.entityType.toLowerCase(),
    observations: e.observations.map(o => o.toLowerCase()), tags: [],
  });
  const getLowercased = vi.fn((name: string) => normalized.get(name));
  const storage = { loadGraph: async () => ({ entities, relations: [] }), getLowercased,
    getRelationsFrom: () => [], getRelationsTo: () => [] } as unknown as GraphStorage;
  return { storage, normalized, getLowercased };
}

describe('fuzzy work reduction', () => {
  it('does not score entities excluded by metadata or lifecycle filters', async () => {
    const entities: Entity[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `target-${i}`, entityType: 'entry', observations: ['target'],
      tags: i === 37 ? ['eligible'] : ['other'], importance: i === 37 ? 9 : 1,
      projectId: i === 37 ? 'wanted' : 'other',
    }));
    const f = fixture(entities);
    const search = new FuzzySearch(f.storage, { useWorkerPool: false });
    const result = await search.fuzzySearch('target', 0.9, ['eligible'], 5, 10, 0, 50, 'wanted');
    expect(result.entities.map(e => e.name)).toEqual(['target-37']);
    expect(f.getLowercased).toHaveBeenCalledTimes(1);
    expect(f.getLowercased).toHaveBeenCalledWith('target-37');
  });

  it('invalidates a cached match after a same-size metadata update', async () => {
    const e: Entity = { name: 'target', entityType: 'entry', observations: [], tags: ['eligible'] };
    const f = fixture([e]);
    const search = new FuzzySearch(f.storage, { useWorkerPool: false });
    expect((await search.fuzzySearch('target', 0.9, ['eligible'])).entities).toHaveLength(1);
    e.tags = ['other'];
    bumpEntityGeneration(f.storage);
    expect((await search.fuzzySearch('target', 0.9, ['eligible'])).entities).toHaveLength(0);
  });

  it('preserves typo recall with a nonempty exact Bloom or selective n-gram index attached', async () => {
    const f = fixture([
      { name: 'Alise', entityType: 'entry', observations: [] },
      { name: 'Alice', entityType: 'entry', observations: [] },
    ]);
    const index = new NGramIndex(3);
    index.addDocument('Alise', 'Alise');
    const search = new FuzzySearch(f.storage, { useWorkerPool: false, ngramIndex: index });
    const bloom = { isBuilt: () => true, intersectCandidates: () => ['Alise'] } as unknown as BloomPreScreener;
    search.setBloomPreScreener(bloom);
    expect((await search.fuzzySearch('Alise', 0.7)).entities.map(e => e.name)).toEqual(['Alise', 'Alice']);
    const approximate = new FuzzySearch(f.storage, {
      useWorkerPool: false, ngramIndex: index, approximatePrefilter: true,
    });
    expect((await approximate.fuzzySearch('Alise', 0.7)).entities.map(e => e.name)).toEqual(['Alise']);
  });

  it('resolves published ancestors using draft heads outside the metadata scope', async () => {
    const f = fixture([
      { name: 'target-published', entityType: 'entry', observations: [], isLatest: false, tags: ['eligible'] },
      { name: 'draft-head', entityType: 'entry', observations: [], isLatest: true,
        lifecycleStatus: 'draft', parentEntityName: 'target-published', tags: ['other'] },
    ]);
    const result = await new FuzzySearch(f.storage, { useWorkerPool: false })
      .fuzzySearch('target', 0.9, ['eligible']);
    expect(result.entities.map(e => e.name)).toEqual(['target-published']);
  });

  it('reuses normalized payloads, invalidates on record replacement, and bounds tiny worker jobs', async () => {
    const entities: Entity[] = Array.from({ length: 500 }, (_, i) => ({
      name: `e${i}`, entityType: 'entry', observations: ['old'],
    }));
    const f = fixture(entities);
    const search = new FuzzySearch(f.storage, { useWorkerPool: false });
    const inputs: WorkerInput[] = [];
    const exec = vi.fn((_method: string, args: WorkerInput[]) => {
      inputs.push(args[0]);
      return { timeout: () => Promise.resolve([]) };
    });
    const internal = search as unknown as {
      workerPool: { exec: typeof exec };
      searchWithWorkers(query: string, threshold: number, entities: Entity[]): Promise<Entity[]>;
    };
    internal.workerPool = { exec };
    await internal.searchWithWorkers('old', 0.5, entities);
    await internal.searchWithWorkers('entry', 0.5, entities);
    expect(exec).toHaveBeenCalledTimes(2); // One chunk per tiny workload, regardless of host CPU count.
    expect(inputs[0].normalized).toBe(true);
    expect(inputs[0].entities[0]).toBe(inputs[1].entities[0]);
    f.normalized.set('e0', { name: 'e0', entityType: 'entry', observations: ['new'], tags: [] });
    await internal.searchWithWorkers('new', 0.5, entities);
    expect(inputs[2].entities[0]).not.toBe(inputs[1].entities[0]);
    expect(inputs[2].entities[0].observations).toEqual(['new']);
  });
});
