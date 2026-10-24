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

  it('RankedSearch asks the storage for ranked candidates with no rank key', async () => {
    const ftsSpy = vi.spyOn(storage, 'fullTextSearch');

    await new RankedSearch(storage).searchNodesRanked('zephyr');

    expect(ftsSpy).toHaveBeenCalledTimes(1);
    expect(ftsSpy.mock.calls[0][0]).toBe('zephyr');
    expect(ftsSpy.mock.calls[0][1]).toStrictEqual({ limit: 3 });
    expect(Object.keys(ftsSpy.mock.calls[0][1]!)).toEqual(['limit']);
  });

  it('a stale FTS posting is excluded by BM25Search and wipes RankedSearch results', async () => {
    // Simulate a stale posting: drop the delete trigger, then delete the row.
    // The FTS table keeps the posting of 'Needle' with no entities row.
    const raw = new Database(dbFile);
    raw.exec('DROP TRIGGER entities_ad');
    raw.prepare("DELETE FROM entities WHERE name = 'Needle'").run();
    raw.close();

    const bm25 = await new BM25Search(storage).search('zephyr');
    const ranked = await new RankedSearch(storage).searchNodesRanked('zephyr');

    // BM25 uses unranked candidates: the stale posting is skipped, the live match stays.
    expect(bm25.map(result => result.entity.name)).toStrictEqual(['Haystack']);
    // RankedSearch uses ranked FTS: the stale posting raises inside the query,
    // the adapter catches it and returns no candidates at all.
    expect(ranked).toStrictEqual([]);
  });
});
