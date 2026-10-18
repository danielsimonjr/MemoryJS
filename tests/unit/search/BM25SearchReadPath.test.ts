/**
 * BM25Search read path
 *
 * `search` must not reload the whole graph for each query, must build matched fields for the
 * returned hits only, and must still return exactly what the earlier implementation returned:
 * same entities, same scores, same matched fields, same order, the same read-view guard.
 *
 * The earlier implementation is kept here as `legacySearch`, the reference for the parity tests.
 * Both backends run every test: JSONL (no storage-native full-text search) and SQLite (FTS5).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BM25Search } from '../../../src/search/BM25Search.js';
import type { BM25Index } from '../../../src/search/BM25Search.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { SEARCH_LIMITS } from '../../../src/utils/constants.js';
import type { Entity, IGraphStorage, SearchResult } from '../../../src/types/index.js';

type AnyStorage = GraphStorage | SQLiteStorage;

/** The search of the earlier implementation, run against the same index and storage. */
async function legacySearch(bm25: BM25Search, storage: AnyStorage, query: string, limit: number): Promise<SearchResult[]> {
  const effectiveLimit = Math.min(limit, SEARCH_LIMITS.MAX);
  const index = (bm25 as unknown as { index: BM25Index }).index;
  if (index.documents.size === 0) return [];
  const graph = await storage.loadGraph();
  const entityMap = new Map(graph.entities.map(e => [e.name, e]));
  const queryTerms = bm25.tokenize(query);
  if (queryTerms.length === 0) return [];
  // The earlier candidate query: ranked, with a limit of the corpus size. The oracle must not
  // call the new candidate query, or it could not see a difference between the two.
  const ranked = await (storage as IGraphStorage).fullTextSearch?.(query, { limit: Math.max(graph.entities.length, 1) });
  const candidateNames = ranked ? new Set(ranked.map(match => match.name)) : null;
  if (candidateNames?.size === 0) return [];
  const { k1, b } = bm25.getConfig();
  const { documents, documentFrequency, avgDocLength, totalDocs } = index;
  const results: SearchResult[] = [];
  for (const [entityName, docEntry] of documents) {
    if (candidateNames !== null && !candidateNames.has(entityName)) continue;
    const entity = entityMap.get(entityName);
    if (!entity) continue;
    let score = 0;
    const matchedFields: SearchResult['matchedFields'] = {};
    for (const term of queryTerms) {
      const tf = docEntry.termFreqs.get(term) || 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(term) || 0;
      const idf = df > 0 ? Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1) : 0;
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docEntry.docLength / avgDocLength));
      score += idf * (numerator / denominator);
      if (entity.name.toLowerCase().includes(term)) matchedFields.name = true;
      if (entity.entityType.toLowerCase().includes(term)) matchedFields.entityType = true;
      const matchedObs = entity.observations.filter(o => o.toLowerCase().includes(term));
      if (matchedObs.length > 0) matchedFields.observations = matchedObs;
    }
    if (score > 0) results.push({ entity, score, matchedFields });
  }
  return results.sort((x, y) => y.score - x.score).slice(0, effectiveLimit);
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'omega', 'sigma', 'kappa', 'theta'];

/** A synthetic corpus with a spread of scores, ties, repeated terms and mixed case. */
function corpus(): Array<{ name: string; entityType: string; observations: string[] }> {
  const out = [];
  for (let i = 0; i < 70; i++) {
    const a = WORDS[i % WORDS.length];
    const b = WORDS[(i * 3 + 1) % WORDS.length];
    const c = WORDS[(i * 7 + 2) % WORDS.length];
    out.push({
      name: `Doc_${String(i).padStart(2, '0')}_${a}`,
      entityType: i % 4 === 0 ? 'Report' : 'note',
      observations: [
        `${a} ${b} appear together in this ${i % 2 === 0 ? 'Long' : 'short'} entry`,
        i % 3 === 0 ? `${c} ${c} ${c} repeated three times` : `plain filler line number ${i}`,
      ],
    });
  }
  // Five identical documents: their scores tie exactly.
  for (let i = 0; i < 5; i++) {
    out.push({ name: `Tie_${i}`, entityType: 'tie', observations: ['quartz feldspar mica'] });
  }
  return out;
}

const QUERIES = [
  'alpha',
  'alpha beta',
  'alpha alpha beta',
  'GAMMA delta',
  'repeated three times',
  'quartz',
  'quartz mica feldspar',
  'nonexistentterm',
  'the and of',
  '"alpha" AND beta*',
  'alpha:beta (gamma) {delta} ^omega ~sigma',
  'NEAR(alpha beta)',
  'alpha OR NOT beta',
  'Report',
  'tie',
  // A term that is only a substring of an indexed token has no frequency, so it matches no field.
  'beta alph',
  'gamma doc_',
  '',
  '   ',
];
const LIMITS = [1, 2, 3, 10, 50, 200, 500];

const backends: Array<{ label: string; fileName: string; make: (p: string) => AnyStorage }> = [
  { label: 'JSONL (GraphStorage)', fileName: 'graph.jsonl', make: p => new GraphStorage(p) },
  { label: 'SQLite (SQLiteStorage)', fileName: 'graph.db', make: p => new SQLiteStorage(p) },
];

for (const backend of backends) {
  describe(`BM25Search read path — ${backend.label}`, () => {
    let dir: string;
    let storage: AnyStorage;
    let entityManager: EntityManager;
    let bm25: BM25Search;

    beforeEach(async () => {
      dir = join(tmpdir(), `bm25-read-path-${Date.now()}-${Math.random()}`);
      await fs.mkdir(dir, { recursive: true });
      storage = backend.make(join(dir, backend.fileName));
      entityManager = new EntityManager(storage);
      await entityManager.createEntities(corpus());
      bm25 = new BM25Search(storage);
      await bm25.buildIndex();
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      if (storage instanceof SQLiteStorage) storage.close();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    for (const mode of ['development', 'production']) {
      it(`returns what the earlier implementation returned (NODE_ENV=${mode})`, async () => {
        vi.stubEnv('NODE_ENV', mode);
        let nonEmpty = 0;
        for (const query of QUERIES) {
          for (const limit of LIMITS) {
            const expected = await legacySearch(bm25, storage, query, limit);
            const actual = await bm25.search(query, limit);
            if (actual.length > 0) nonEmpty++;
            expect(actual.map(r => r.entity.name), `${query} @${limit}`).toEqual(expected.map(r => r.entity.name));
            expect(actual.map(r => r.score), `${query} @${limit}`).toEqual(expected.map(r => r.score));
            expect(actual.map(r => r.matchedFields), `${query} @${limit}`).toEqual(expected.map(r => r.matchedFields));
            expect(actual.map(r => r.entity), `${query} @${limit}`).toEqual(expected.map(r => r.entity));
          }
        }
        // The comparison is not vacuous.
        expect(nonEmpty).toBeGreaterThan(40);
      });
    }

    it('keeps index order at a tie that straddles the cutoff', async () => {
      const all = await bm25.search('quartz', 10);
      expect(all).toHaveLength(5);
      expect(new Set(all.map(r => r.score)).size).toBe(1);
      const three = await bm25.search('quartz', 3);
      expect(three.map(r => r.entity.name)).toEqual(all.slice(0, 3).map(r => r.entity.name));
      expect(three.map(r => r.entity.name)).toEqual((await legacySearch(bm25, storage, 'quartz', 3)).map(r => r.entity.name));
    });

    it('does not reload the graph for a query', async () => {
      const loadGraph = vi.spyOn(storage, 'loadGraph');
      await bm25.search('alpha', 10);
      await bm25.search('beta gamma', 50);
      await bm25.search('quartz', 3);
      expect(loadGraph).not.toHaveBeenCalled();
    });

    it('builds matched fields for the returned hits only', async () => {
      const matched = vi.spyOn(bm25 as unknown as { matchedFieldsOf: () => unknown }, 'matchedFieldsOf');
      const all = await legacySearch(bm25, storage, 'alpha', 500);
      expect(all.length).toBeGreaterThan(5);
      const hits = await bm25.search('alpha', 5);
      expect(hits).toHaveLength(5);
      expect(matched).toHaveBeenCalledTimes(5);
    });

    it('returns no results for a limit below 1 or not a number', async () => {
      expect(await bm25.search('alpha', 0)).toEqual([]);
      expect(await bm25.search('alpha', -3)).toEqual([]);
      expect(await bm25.search('alpha', Number.NaN)).toEqual([]);
    });

    it('truncates a fractional limit, and caps the limit at the library maximum', async () => {
      expect(await bm25.search('alpha', 2.9)).toHaveLength(2);
      const capped = await bm25.search('alpha', 10_000);
      expect(capped.length).toBeLessThanOrEqual(SEARCH_LIMITS.MAX);
      expect(capped.map(r => r.entity.name)).toEqual((await legacySearch(bm25, storage, 'alpha', 10_000)).map(r => r.entity.name));
    });

    it('skips an entity that left the storage since the index was built and fills its place', async () => {
      const before = await bm25.search('alpha', 4);
      expect(before).toHaveLength(4);
      await entityManager.deleteEntities([before[0].entity.name]);
      const after = await bm25.search('alpha', 4);
      expect(after).toHaveLength(4);
      expect(after.map(r => r.entity.name)).not.toContain(before[0].entity.name);
      expect(after.map(r => r.entity.name)).toEqual((await legacySearch(bm25, storage, 'alpha', 4)).map(r => r.entity.name));
    });

    it('does not return an entity that was added after the index was built', async () => {
      await entityManager.createEntities([{ name: 'Late_Arrival', entityType: 'note', observations: ['alpha alpha alpha alpha'] }]);
      const hits = await bm25.search('alpha', 100);
      expect(hits.map(r => r.entity.name)).not.toContain('Late_Arrival');
    });

    it('returns a frozen copy outside production, so a caller cannot change the storage', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const [hit] = await bm25.search('alpha', 1);
      expect(Object.isFrozen(hit.entity)).toBe(true);
      expect(Object.isFrozen(hit.entity.observations)).toBe(true);
      expect(() => { (hit.entity.observations as string[]).push('x'); }).toThrow(TypeError);
      expect(() => { (hit.entity as Entity).name = 'renamed'; }).toThrow(TypeError);
      // The storage entity is a different object and is not frozen.
      const live = storage.getEntityByName(hit.entity.name);
      expect(live).toBeDefined();
      expect(live).not.toBe(hit.entity);
      expect(Object.isFrozen(live)).toBe(false);
    });

    it('returns the live entity in production, like loadGraph does', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const [hit] = await bm25.search('alpha', 1);
      expect(hit.entity).toBe(storage.getEntityByName(hit.entity.name));
    });

    it('asks for every full-text match, unranked, up to the count the storage holds now', async () => {
      if (!(storage instanceof SQLiteStorage)) return;
      const fts = vi.spyOn(storage, 'fullTextSearch');
      await entityManager.createEntities([{ name: 'Extra_One', entityType: 'note', observations: ['filler'] }]);
      await bm25.search('alpha', 5);
      expect(fts).toHaveBeenCalledTimes(1);
      // The index scores the candidates, so their storage order is not used.
      expect(fts.mock.calls[0][1]).toEqual({ limit: 76, rank: false });
    });

    it('still finds entities after one is re-appended under its name', async () => {
      if (!(storage instanceof SQLiteStorage)) return;
      // The replaced row leaves an old posting in the full-text index. A query that reads the
      // name through the full-text table throws on it, and the earlier candidate query turned
      // that error into an empty result.
      const before = await bm25.search('alpha', 5);
      const [first] = before;
      await storage.appendEntity({ ...first.entity, observations: [...first.entity.observations] } as Entity);
      const after = await bm25.search('alpha', 5);
      expect(after.length).toBeGreaterThan(0);
      expect(after.map(r => r.entity.name)).toContain(first.entity.name);
    });

    it('builds the index on first use', async () => {
      const fresh = new BM25Search(storage);
      const hits = await fresh.search('quartz', 10);
      expect(hits).toHaveLength(5);
    });

    it('returns nothing on an empty graph', async () => {
      const emptyDir = join(dir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });
      const empty = backend.make(join(emptyDir, backend.fileName));
      try {
        expect(await new BM25Search(empty).search('alpha', 10)).toEqual([]);
      } finally {
        if (empty instanceof SQLiteStorage) empty.close();
      }
    });
  });
}
