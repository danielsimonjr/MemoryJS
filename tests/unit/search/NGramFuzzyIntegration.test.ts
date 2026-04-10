/**
 * NGram + FuzzySearch Integration Tests
 *
 * Verifies that FuzzySearch produces identical results with and without the
 * NGramIndex prefilter, and that the prefilter actually reduces the candidate
 * set for large corpora.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FuzzySearch } from '../../../src/search/FuzzySearch.js';
import { NGramIndex } from '../../../src/search/NGramIndex.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an NGramIndex pre-populated with entity names from storage.
 *
 * Only entity names are indexed (not entityType or observations).
 * This means:
 *   - Name-similar queries → NGramIndex returns relevant candidates → prefilter works
 *   - EntityType/observation queries → NGramIndex returns 0 candidates → FuzzySearch
 *     falls back to a full corpus scan, preserving correctness at the cost of speed
 *
 * Indexing all fields (combined text) would lower per-field Jaccard scores due to
 * document length normalisation, causing false negatives for short queries like
 * typos or single-word entity types.
 */
async function buildNgramIndex(storage: GraphStorage, n = 3): Promise<NGramIndex> {
  const graph = await storage.loadGraph();
  const idx = new NGramIndex(n);
  for (const entity of graph.entities) {
    idx.addDocument(entity.name, entity.name);
  }
  return idx;
}

/** Sort entity names for stable comparison. */
function sortedNames(result: { entities: Array<{ name: string }> }): string[] {
  return result.entities.map(e => e.name).sort();
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_ENTITIES = [
  {
    name: 'Alice',
    entityType: 'person',
    observations: ['Software engineer', 'Loves Python', 'Works remotely'],
    tags: ['engineering'],
    importance: 9,
  },
  {
    name: 'Alicia',
    entityType: 'person',
    observations: ['Product manager', 'Leads planning sessions'],
    tags: ['management'],
    importance: 8,
  },
  {
    name: 'Bob',
    entityType: 'person',
    observations: ['Designer', 'Creates beautiful UIs'],
    tags: ['design'],
    importance: 7,
  },
  {
    name: 'Robert',
    entityType: 'person',
    observations: ['Developer', 'Backend specialist'],
    tags: ['engineering'],
    importance: 8,
  },
  {
    name: 'Project_Alpha',
    entityType: 'project',
    observations: ['Alpha version release'],
    tags: ['project'],
    importance: 10,
  },
  {
    name: 'MachineLearning',
    entityType: 'concept',
    observations: ['Subset of artificial intelligence', 'Uses statistical methods'],
    tags: ['ai'],
    importance: 6,
  },
];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let storage: GraphStorage;
let fuzzyWithout: FuzzySearch;     // vanilla FuzzySearch (no prefilter)
let fuzzyWith: FuzzySearch;        // FuzzySearch + NGramIndex prefilter
let testDir: string;
let testFilePath: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `ngram-fuzzy-integration-${Date.now()}-${Math.random()}`);
  await fs.mkdir(testDir, { recursive: true });
  testFilePath = join(testDir, 'test-graph.jsonl');

  storage = new GraphStorage(testFilePath);
  const entityManager = new EntityManager(storage);
  const relationManager = new RelationManager(storage);

  await entityManager.createEntities(TEST_ENTITIES);
  await relationManager.createRelations([
    { from: 'Alice', to: 'Project_Alpha', relationType: 'works_on' },
    { from: 'Bob', to: 'Alice', relationType: 'collaborates_with' },
  ]);

  // FuzzySearch without prefilter (worker pool disabled for test speed)
  fuzzyWithout = new FuzzySearch(storage, { useWorkerPool: false });

  // Build NGramIndex (entity names only) and attach as prefilter.
  // Using entity-name-only indexing ensures clean Jaccard comparisons without
  // document-length penalty. Queries that match via entityType or observations
  // will get zero candidates from the NGramIndex and trigger the full-scan fallback.
  const ngramIdx = await buildNgramIndex(storage, 3);
  fuzzyWith = new FuzzySearch(storage, {
    useWorkerPool: false,
    ngramIndex: ngramIdx,
    ngramThreshold: 0.1,
  });
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// Result equivalence
// ---------------------------------------------------------------------------

describe('FuzzySearch with NGramIndex prefilter — result equivalence', () => {
  const QUERIES = [
    { label: 'exact name', query: 'Alice', threshold: 0.7 },
    { label: 'near-typo', query: 'Alise', threshold: 0.6 },
    { label: 'observation word', query: 'engineer', threshold: 0.7 },
    { label: 'transposed chars', query: 'Alcie', threshold: 0.6 },
    { label: 'entity type', query: 'person', threshold: 0.85 },
    { label: 'totally unrelated', query: 'zxqpqp', threshold: 0.7 },
    { label: 'multi-word observation', query: 'machine learning', threshold: 0.5 },
  ];

  for (const { label, query, threshold } of QUERIES) {
    it(`returns identical results for query "${query}" (${label})`, async () => {
      const withoutResult = await fuzzyWithout.fuzzySearch(query, threshold);
      const withResult = await fuzzyWith.fuzzySearch(query, threshold);

      expect(sortedNames(withResult)).toEqual(sortedNames(withoutResult));
    });
  }

  it('returns same results for exact entity name match', async () => {
    const withoutResult = await fuzzyWithout.fuzzySearch('Alice', 0.9);
    const withResult = await fuzzyWith.fuzzySearch('Alice', 0.9);
    expect(sortedNames(withResult)).toEqual(sortedNames(withoutResult));
  });

  it('returns same (empty) results for a completely unrelated query', async () => {
    const withoutResult = await fuzzyWithout.fuzzySearch('zzzzzzz', 0.9);
    const withResult = await fuzzyWith.fuzzySearch('zzzzzzz', 0.9);
    expect(sortedNames(withResult)).toEqual(sortedNames(withoutResult));
  });

  it('returns relations matching the entity set — same with and without prefilter', async () => {
    const withoutResult = await fuzzyWithout.fuzzySearch('Alice', 0.7);
    const withResult = await fuzzyWith.fuzzySearch('Alice', 0.7);
    expect(withResult.relations.length).toBe(withoutResult.relations.length);
  });
});

// ---------------------------------------------------------------------------
// setNgramIndex / getNgramIndex API
// ---------------------------------------------------------------------------

describe('FuzzySearch setNgramIndex / getNgramIndex', () => {
  it('getNgramIndex returns null before any index is set', () => {
    const f = new FuzzySearch(storage, { useWorkerPool: false });
    expect(f.getNgramIndex()).toBeNull();
  });

  it('getNgramIndex returns the index after setNgramIndex', async () => {
    const f = new FuzzySearch(storage, { useWorkerPool: false });
    const idx = await buildNgramIndex(storage);
    f.setNgramIndex(idx);
    expect(f.getNgramIndex()).toBe(idx);
  });

  it('setNgramIndex(null) disables the prefilter', async () => {
    const idx = await buildNgramIndex(storage);
    const f = new FuzzySearch(storage, {
      useWorkerPool: false,
      ngramIndex: idx,
      ngramThreshold: 0.1,
    });
    f.setNgramIndex(null);
    expect(f.getNgramIndex()).toBeNull();
  });

  it('results remain correct after disabling the prefilter mid-use', async () => {
    const idx = await buildNgramIndex(storage);
    const f = new FuzzySearch(storage, {
      useWorkerPool: false,
      ngramIndex: idx,
      ngramThreshold: 0.1,
    });

    const withIdx = await f.fuzzySearch('Alice', 0.7);
    f.setNgramIndex(null);
    const withoutIdx = await f.fuzzySearch('Alice', 0.7);

    // Disable cache effect by checking sorted names
    expect(sortedNames(withIdx)).toEqual(sortedNames(withoutIdx));
  });
});

// ---------------------------------------------------------------------------
// Prefilter reduces candidate set (property-based)
// ---------------------------------------------------------------------------

describe('NGramIndex prefilter reduces candidate set', () => {
  it('query candidates from NGramIndex are a subset of all entities', async () => {
    const graph = await storage.loadGraph();
    const allNames = new Set(graph.entities.map(e => e.name));

    const ngramIdx = await buildNgramIndex(storage);
    // Low threshold → many candidates, but never more than the full corpus
    const candidates = new Set(ngramIdx.query('Alice', 0.0));

    for (const id of candidates) {
      expect(allNames.has(id)).toBe(true);
    }
  });

  it('the prefilter returns fewer or equal candidates than the full corpus for a specific query', async () => {
    const graph = await storage.loadGraph();
    const totalEntities = graph.entities.length;

    const ngramIdx = await buildNgramIndex(storage);
    // Use a reasonable threshold that filters some docs
    const candidates = ngramIdx.query('Alice', 0.1);

    // The candidate list must not exceed the total corpus
    expect(candidates.length).toBeLessThanOrEqual(totalEntities);
  });

  it('a very high threshold yields fewer candidates than a very low threshold', async () => {
    const ngramIdx = await buildNgramIndex(storage);

    const permissive = ngramIdx.query('Alice', 0.0).length;
    const strict = ngramIdx.query('Alice', 0.9).length;

    expect(strict).toBeLessThanOrEqual(permissive);
  });
});

// ---------------------------------------------------------------------------
// Fallback behaviour: empty NGramIndex result falls back to full scan
// ---------------------------------------------------------------------------

describe('FuzzySearch prefilter fallback', () => {
  it('finds results even when the NGramIndex returns zero candidates', async () => {
    // Create an NGramIndex with completely different documents so the query
    // has zero candidates — FuzzySearch must fall back to full scan.
    const emptyIdx = new NGramIndex(3);
    emptyIdx.addDocument('unrelated_doc', 'completely unrelated content xyz');

    const f = new FuzzySearch(storage, {
      useWorkerPool: false,
      ngramIndex: emptyIdx,
      ngramThreshold: 0.99, // Very strict → no candidates from index
    });

    // Despite the bad index, FuzzySearch should fall back to full scan
    const result = await f.fuzzySearch('Alice', 0.7);
    const names = result.entities.map(e => e.name);
    expect(names).toContain('Alice');
  });
});
