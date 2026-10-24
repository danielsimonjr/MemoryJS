/**
 * Pin tests for the FTS candidate lookup shared by BM25Search and RankedSearch.
 *
 * Each golden value is the output of one caller on a fixed corpus.
 * A change to these values is a behaviour change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { BM25Search } from '../../../src/search/BM25Search.js';
import { RankedSearch } from '../../../src/search/RankedSearch.js';
import { getFtsCandidateNames } from '../../../src/search/ftsCandidates.js';
import type { IGraphStorage } from '../../../src/types/index.js';

describe('FTS candidate lookup pins', () => {
  let storage: SQLiteStorage;
  let testDir: string;
  let dbFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `search-twins-fts-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    dbFile = join(testDir, 'memory.db');
    storage = new SQLiteStorage(dbFile);
    await storage.saveGraph({
      entities: [
        { name: 'Needle', entityType: 'note', observations: ['singular zephyr'] },
        { name: 'Haystack', entityType: 'note', observations: ['ordinary content zephyr zephyr'] },
        { name: 'Archive', entityType: 'note', observations: ['historical records'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    storage.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('RankedSearch returns the golden ranked list on a clean index', async () => {
    const ranked = await new RankedSearch(storage).searchNodesRanked('zephyr');

    expect(ranked).toStrictEqual([
      {
        entity: {
          name: 'Haystack',
          entityType: 'note',
          observations: ['ordinary content zephyr zephyr'],
        },
        score: 0.13515503603605478,
        matchedFields: { observations: ['ordinary content zephyr zephyr'] },
      },
      {
        entity: { name: 'Needle', entityType: 'note', observations: ['singular zephyr'] },
        score: 0.1013662770270411,
        matchedFields: { observations: ['singular zephyr'] },
      },
    ]);
  });

  it('BM25Search returns the golden ranked list on a clean index', async () => {
    const results = await new BM25Search(storage).search('zephyr');

    expect(results).toStrictEqual([
      {
        entity: {
          name: 'Haystack',
          entityType: 'note',
          observations: ['ordinary content zephyr zephyr'],
        },
        score: 0.5981864372218453,
        matchedFields: { observations: ['ordinary content zephyr zephyr'] },
      },
      {
        entity: { name: 'Needle', entityType: 'note', observations: ['singular zephyr'] },
        score: 0.4991762683023675,
        matchedFields: { observations: ['singular zephyr'] },
      },
    ]);
  });

  it('both callers return no results when no entity matches', async () => {
    expect(await new RankedSearch(storage).searchNodesRanked('nothingmatches')).toStrictEqual([]);
    expect(await new BM25Search(storage).search('nothingmatches')).toStrictEqual([]);
  });

  it('BM25Search asks the storage for unranked candidates with the full corpus limit', async () => {
    const ftsSpy = vi.spyOn(storage, 'fullTextSearch');

    await new BM25Search(storage).search('zephyr');

    expect(ftsSpy).toHaveBeenCalledTimes(1);
    expect(ftsSpy.mock.calls[0][0]).toBe('zephyr');
    expect(ftsSpy.mock.calls[0][1]).toStrictEqual({ limit: 3, rank: false });
    expect(Object.keys(ftsSpy.mock.calls[0][1]!)).toEqual(['limit', 'rank']);
  });

  it('RankedSearch asks the storage for unranked candidates with the full corpus limit', async () => {
    const ftsSpy = vi.spyOn(storage, 'fullTextSearch');

    await new RankedSearch(storage).searchNodesRanked('zephyr');

    expect(ftsSpy).toHaveBeenCalledTimes(1);
    expect(ftsSpy.mock.calls[0][0]).toBe('zephyr');
    expect(ftsSpy.mock.calls[0][1]).toStrictEqual({ limit: 3, rank: false });
    expect(Object.keys(ftsSpy.mock.calls[0][1]!)).toEqual(['limit', 'rank']);
  });

  // Simulate a stale posting: drop the delete trigger, then delete the row.
  // The FTS table keeps the posting of 'Needle' with no entities row.
  function makeStalePosting(): void {
    const raw = new Database(dbFile);
    raw.exec('DROP TRIGGER entities_ad');
    raw.prepare("DELETE FROM entities WHERE name = 'Needle'").run();
    raw.close();
  }

  it('a stale FTS posting is excluded by BM25Search and by RankedSearch', async () => {
    makeStalePosting();

    const bm25 = await new BM25Search(storage).search('zephyr');
    const ranked = await new RankedSearch(storage).searchNodesRanked('zephyr');

    // Both callers use unranked candidates: the stale posting is skipped, the live match stays.
    expect(bm25.map(result => result.entity.name)).toStrictEqual(['Haystack']);
    expect(ranked).toStrictEqual([
      {
        entity: {
          name: 'Haystack',
          entityType: 'note',
          observations: ['ordinary content zephyr zephyr'],
        },
        score: 0.13515503603605478,
        matchedFields: { observations: ['ordinary content zephyr zephyr'] },
      },
    ]);
  });

  it('the FTS lookup on a stale posting returns no candidates when it ranks', async () => {
    makeStalePosting();

    expect(await getFtsCandidateNames.call({ storage }, 'zephyr', 3, true)).toStrictEqual(new Set());
  });

  it('the FTS lookup on a stale posting returns the live match when it does not rank', async () => {
    makeStalePosting();

    expect(await getFtsCandidateNames.call({ storage }, 'zephyr', 3, false)).toStrictEqual(
      new Set(['Haystack']),
    );
  });

  // appendEntity replaces an existing name with INSERT OR REPLACE.
  // The replace does not fire the delete trigger, so the old posting stays in the FTS table.
  async function replaceThroughAppendEntity(): Promise<void> {
    await storage.appendEntity({
      name: 'Needle',
      entityType: 'note',
      observations: ['singular zephyr updated'],
    });
    const raw = new Database(dbFile, { readonly: true });
    const stale = raw
      .prepare(
        'SELECT d.id FROM entities_fts_docsize d LEFT JOIN entities e ON e.rowid = d.id WHERE e.rowid IS NULL',
      )
      .all();
    raw.close();
    expect(stale).toHaveLength(1);
  }

  it('RankedSearch returns the live matches after appendEntity replaces an entity', async () => {
    await replaceThroughAppendEntity();

    const ranked = await new RankedSearch(storage).searchNodesRanked('zephyr');

    expect(ranked.map(result => [result.entity.name, result.score])).toStrictEqual([
      ['Haystack', 0.13515503603605478],
      ['Needle', 0.08109302162163289],
    ]);
    expect(ranked[1].entity.observations).toStrictEqual(['singular zephyr updated']);
  });

  it('BM25Search returns the live matches after appendEntity replaces an entity', async () => {
    await replaceThroughAppendEntity();

    const bm25 = await new BM25Search(storage).search('zephyr');

    expect(bm25.map(result => [result.entity.name, result.score])).toStrictEqual([
      ['Haystack', 0.6118390439885316],
      ['Needle', 0.4700036292457356],
    ]);
  });
});

describe('FTS lookup error text, read order and read counts', () => {
  const entities = [
    { name: 'A', entityType: 'note', observations: ['zephyr alpha'] },
    { name: 'B', entityType: 'note', observations: ['zephyr beta'] },
  ];
  const graph = { entities, relations: [] };
  /** A structural test double: only the members that the two searches read. */
  const fakeStorage = (overrides: Record<string, unknown>): IGraphStorage =>
    ({
      loadGraph: async () => graph,
      ensureLoaded: async () => {},
      cachedGraph: graph,
      ...overrides,
    }) as unknown as IGraphStorage;
  /** Count the reads of the private `storage` field of a search object. */
  const countStorageReads = (search: object, storage: IGraphStorage): (() => number) => {
    let reads = 0;
    Object.defineProperty(search, 'storage', {
      get() {
        reads++;
        return storage;
      },
    });
    return () => reads;
  };

  it('BM25Search names the call expression when fullTextSearch is not callable', async () => {
    const search = new BM25Search(fakeStorage({ fullTextSearch: 5 }));

    await expect(search.search('zephyr')).rejects.toThrow(
      new TypeError('this.storage.fullTextSearch is not a function'),
    );
  });

  it('RankedSearch names the call expression when fullTextSearch is not callable', async () => {
    const search = new RankedSearch(fakeStorage({ fullTextSearch: 5 }));

    await expect(search.searchNodesRanked('zephyr')).rejects.toThrow(
      new TypeError('this.storage.fullTextSearch is not a function'),
    );
  });

  it('RankedSearch names the call expression when ensureLoaded is missing', async () => {
    const search = new RankedSearch(
      fakeStorage({ ensureLoaded: undefined, fullTextSearch: async () => [] }),
    );

    await expect(search.searchNodesRanked('zephyr')).rejects.toThrow(
      new TypeError('this.storage.ensureLoaded is not a function'),
    );
  });

  it('RankedSearch reads its storage field four times when the lookup finds nothing', async () => {
    const storage = fakeStorage({ fullTextSearch: async () => [] });
    const search = new RankedSearch(storage);
    const reads = countStorageReads(search, storage);

    expect(await search.searchNodesRanked('zephyr')).toStrictEqual([]);
    expect(reads()).toBe(4);
  });

  it('BM25Search reads its storage field five times when the lookup finds nothing', async () => {
    const storage = fakeStorage({ fullTextSearch: async () => [] });
    const search = new BM25Search(storage);
    await search.buildIndex();
    const reads = countStorageReads(search, storage);

    expect(await search.search('zephyr')).toStrictEqual([]);
    expect(reads()).toBe(5);
  });

  it('BM25Search reads the storage members and the limit in the golden order', async () => {
    const log: string[] = [];
    const limit = {
      valueOf() {
        log.push('limit.valueOf');
        return 2;
      },
    };
    const storage = {
      loadGraph: async () => graph,
      get ensureLoaded() {
        log.push('read ensureLoaded');
        return async () => {};
      },
      get cachedGraph() {
        log.push('read cachedGraph');
        return { entities: { length: limit }, relations: [] };
      },
      get fullTextSearch() {
        log.push('read fullTextSearch');
        return async (query: string, options: unknown) => {
          log.push(`fullTextSearch ${query} ${JSON.stringify(options)}`);
          return [];
        };
      },
    } as unknown as IGraphStorage;
    const search = new BM25Search(storage);
    await search.buildIndex();
    log.length = 0;

    await search.search('zephyr');

    expect(log).toStrictEqual([
      'read ensureLoaded',
      'read cachedGraph',
      'read fullTextSearch',
      'read ensureLoaded',
      'read fullTextSearch',
      'limit.valueOf',
      'fullTextSearch zephyr {"limit":2,"rank":false}',
    ]);
  });

  /** Run both searches over a corpus of `size` entities and collect the limit of each lookup. */
  const lookupLimits = async (size: number): Promise<unknown[]> => {
    const asked: unknown[] = [];
    const sized = {
      entities: Array.from({ length: size }, (_, i) => ({
        name: `E${i}`,
        entityType: 'note',
        observations: ['zephyr'],
      })),
      relations: [],
    };
    const storage = fakeStorage({
      loadGraph: async () => sized,
      cachedGraph: sized,
      fullTextSearch: async (_query: string, options: { limit?: number }) => {
        asked.push(options.limit);
        return [];
      },
    });
    const bm25 = new BM25Search(storage);
    await bm25.buildIndex();
    await bm25.search('zephyr');
    await new RankedSearch(storage).searchNodesRanked('zephyr');
    return asked;
  };

  it.each([
    [1, 1],
    [2, 2],
    [5, 5],
  ])('a corpus of %i entities asks both searches for the limit %i', async (size, limit) => {
    expect(await lookupLimits(size)).toStrictEqual([limit, limit]);
  });

  it('the helper passes no rank key when it ranks', async () => {
    const asked: unknown[] = [];
    const storage = fakeStorage({
      fullTextSearch: async (_query: string, options: unknown) => {
        asked.push(options);
        return [];
      },
    });

    await getFtsCandidateNames.call({ storage }, 'zephyr', 3, true);

    expect(asked).toStrictEqual([{ limit: 3 }]);
    expect(Object.keys(asked[0] as object)).toStrictEqual(['limit']);
  });
});
