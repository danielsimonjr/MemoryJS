import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { BM25Search } from '../../../src/search/BM25Search.js';
import { HybridSearchManager } from '../../../src/search/HybridSearchManager.js';
import { RankedSearch } from '../../../src/search/RankedSearch.js';

describe('SQLite FTS search integration', () => {
  let storage: SQLiteStorage;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sqlite-fts-search-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new SQLiteStorage(join(testDir, 'memory.db'));
    await storage.saveGraph({
      entities: [
        { name: 'Needle', entityType: 'note', observations: ['singular zephyr'] },
        { name: 'Haystack', entityType: 'note', observations: ['ordinary content'] },
        { name: 'Archive', entityType: 'note', observations: ['historical records'] },
      ],
      relations: [],
    });
  });

  afterEach(async () => {
    storage.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('uses FTS candidates through the hybrid lexical channel', async () => {
    const ftsSpy = vi.spyOn(storage, 'fullTextSearch');
    const graph = await storage.loadGraph();
    const hybrid = new HybridSearchManager(null, new RankedSearch(storage));

    const results = await hybrid.search(graph, 'zephyr', {
      semanticWeight: 0,
      lexicalWeight: 1,
      symbolicWeight: 0,
    });

    expect(ftsSpy).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.entity.name)).toEqual(['Needle']);
  });

  it('uses FTS candidates before in-memory BM25 scoring', async () => {
    const ftsSpy = vi.spyOn(storage, 'fullTextSearch');
    const bm25 = new BM25Search(storage);

    const results = await bm25.search('zephyr');

    expect(ftsSpy).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.entity.name)).toEqual(['Needle']);
  });
});
