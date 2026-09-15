/**
 * Search-cache isolation tests (wave 1, step 2, defect A).
 *
 * The BasicSearch result cache is a module singleton. Entries and
 * generation counters must be scoped to one storage instance, and cached
 * values handed to callers must not be able to poison later hits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { BasicSearch } from '../../../src/search/BasicSearch.js';
import { clearAllSearchCaches, searchCaches } from '../../../src/utils/searchCache.js';
import type { Entity } from '../../../src/types/types.js';

function makeEntity(name: string, observation: string): Entity {
  return {
    name,
    entityType: 'test',
    observations: [observation],
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
  };
}

type Backend = { label: string; make: (dir: string, id: string) => GraphStorage };

const backends: Backend[] = [
  { label: 'JSONL', make: (dir, id) => new GraphStorage(join(dir, `${id}.jsonl`)) },
  {
    label: 'SQLite',
    make: (dir, id) => new SQLiteStorage(join(dir, `${id}.db`)) as unknown as GraphStorage,
  },
];

describe.each(backends)('BasicSearch cache isolation ($label)', ({ make }) => {
  let dir: string;
  let storeA: GraphStorage;
  let storeB: GraphStorage;

  beforeEach(async () => {
    clearAllSearchCaches();
    dir = await fs.mkdtemp(join(tmpdir(), 'mjs-cache-iso-'));
    storeA = make(dir, 'a');
    storeB = make(dir, 'b');
    await storeA.appendEntity(makeEntity('AliceA', 'shared needle'));
    await storeB.appendEntity(makeEntity('BobB', 'shared needle'));
  });

  afterEach(async () => {
    for (const s of [storeA, storeB]) {
      const closable = s as unknown as { close?: () => void | Promise<void> };
      await closable.close?.();
    }
    clearAllSearchCaches();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('identical searchNodes queries against two stores return only their own records', async () => {
    const a = await new BasicSearch(storeA).searchNodes('needle');
    const b = await new BasicSearch(storeB).searchNodes('needle');
    expect(a.entities.map(e => e.name)).toEqual(['AliceA']);
    expect(b.entities.map(e => e.name)).toEqual(['BobB']);
  });

  it('identical searchByDateRange queries against two stores return only their own records', async () => {
    const a = await new BasicSearch(storeA).searchByDateRange('2000-01-01', '2100-01-01');
    const b = await new BasicSearch(storeB).searchByDateRange('2000-01-01', '2100-01-01');
    expect(a.entities.map(e => e.name)).toEqual(['AliceA']);
    expect(b.entities.map(e => e.name)).toEqual(['BobB']);
  });

  it('a write to store A does not invalidate cached results for store B', async () => {
    const searchB = new BasicSearch(storeB);
    await searchB.searchNodes('needle');
    const hitsBefore = searchCaches.basic.getStats().hits;

    await storeA.appendEntity(makeEntity('AliceA2', 'shared needle'));

    const b = await searchB.searchNodes('needle');
    expect(b.entities.map(e => e.name)).toEqual(['BobB']);
    expect(searchCaches.basic.getStats().hits).toBe(hitsBefore + 1);
  });

  it('a write to store A still invalidates cached results for store A', async () => {
    const searchA = new BasicSearch(storeA);
    await searchA.searchNodes('needle');
    await storeA.appendEntity(makeEntity('AliceA2', 'shared needle'));
    const a = await searchA.searchNodes('needle');
    expect(a.entities.map(e => e.name).sort()).toEqual(['AliceA', 'AliceA2']);
  });

  it('mutating a cached search result does not change a later identical search', async () => {
    const searchA = new BasicSearch(storeA);
    const first = await searchA.searchNodes('needle');
    const second = await searchA.searchNodes('needle'); // cache hit
    for (const r of [first, second]) {
      try {
        (r.entities as Entity[]).push(makeEntity('Injected', 'x'));
        (r.entities[0].observations as string[]).push('poison');
      } catch {
        // frozen results are also acceptable
      }
    }
    const third = await searchA.searchNodes('needle');
    expect(third.entities.map(e => e.name)).toEqual(['AliceA']);
    expect(third.entities[0].observations).toEqual(['shared needle']);
  });
});
