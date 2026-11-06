/**
 * SearchFacade — lazy search-layer managers behind ManagerContext.
 * Verifies once-only construction, identity, side-effect-free peeks, and that
 * close() detaches the Bloom pre-screener from the fuzzy searcher.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SearchFacade, type SearchFacadeDeps } from '../../../../src/core/context/SearchFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import { ObservationManager } from '../../../../src/core/ObservationManager.js';
import { GraphTraversal } from '../../../../src/core/GraphTraversal.js';
import { FuzzySearch } from '../../../../src/search/FuzzySearch.js';
import { CachePressureCoordinator } from '../../../../src/utils/CachePressureCoordinator.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';

const FLAGS = ['MEMORY_EMBEDDING_PROVIDER', 'MEMORY_FUZZY_BLOOM_PRESCREEN', 'MEMORY_RANKED_GRAPH_BOOST'] as const;

afterEach(() => {
  for (const flag of FLAGS) vi.unstubAllEnvs();
  cleanupTempDirs();
});

/** Builds a facade over real storage with spied sibling accessors. */
function makeFacade(overrides: Partial<SearchFacadeDeps> = {}) {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const relationManager = new RelationManager(storage);
  const observationManager = new ObservationManager(storage);
  const graphTraversal = new GraphTraversal(storage);
  const deps: SearchFacadeDeps = {
    storage,
    cachePressure: new CachePressureCoordinator(),
    savedSearchesFilePath: makeTempJsonlPath() + '.saved',
    getEntityManager: vi.fn(() => entityManager),
    getRelationManager: vi.fn(() => relationManager),
    getObservationManager: vi.fn(() => observationManager),
    getGraphTraversal: vi.fn(() => graphTraversal),
    getBloomPreScreener: vi.fn(() => null),
    ...overrides,
  };
  return { facade: new SearchFacade(deps), deps };
}

describe('SearchFacade', () => {
  it('returns the same searchManager instance on repeated access', () => {
    const { facade } = makeFacade();
    const first = facade.searchManager;
    expect(facade.searchManager).toBe(first);
    expect(facade.peekSearchManager()).toBe(first);
  });

  it('returns the same rankedSearch and hybridSearchManager on repeated access', () => {
    const { facade } = makeFacade();
    expect(facade.rankedSearch).toBe(facade.rankedSearch);
    expect(facade.hybridSearchManager).toBe(facade.hybridSearchManager);
  });

  it('constructs nothing in the constructor and nothing through peek methods', () => {
    const { facade, deps } = makeFacade();
    expect(facade.peekSearchManager()).toBeUndefined();
    expect(facade.peekRankedSearch()).toBeUndefined();
    expect(facade.peekSemanticSearch()).toBeUndefined();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    expect(deps.getGraphTraversal).not.toHaveBeenCalled();
    expect(deps.getBloomPreScreener).not.toHaveBeenCalled();
    expect(facade.peekSearchManager()).toBeUndefined();
  });

  it('peekSemanticSearch reports null when no embedding provider is configured, after resolution', () => {
    vi.stubEnv('MEMORY_EMBEDDING_PROVIDER', 'none');
    const { facade } = makeFacade();
    expect(facade.peekSemanticSearch()).toBeUndefined();
    expect(facade.semanticSearch).toBeNull();
    expect(facade.peekSemanticSearch()).toBeNull();
  });

  it('factExtractor reaches the entity and relation accessors lazily, once', () => {
    const { facade, deps } = makeFacade();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    const first = facade.factExtractor;
    expect(facade.factExtractor).toBe(first);
    expect(deps.getEntityManager).toHaveBeenCalledTimes(1);
    expect(deps.getRelationManager).toHaveBeenCalledTimes(1);
  });

  it('attaches the Bloom pre-screener at construction only when the env flag is the literal true', () => {
    const screener = { name: 'bloom' } as never;
    const off = makeFacade({ getBloomPreScreener: vi.fn(() => screener) });
    void off.facade.searchManager;
    expect(off.deps.getBloomPreScreener).not.toHaveBeenCalled();

    vi.stubEnv('MEMORY_FUZZY_BLOOM_PRESCREEN', 'true');
    const attach = vi.spyOn(FuzzySearch.prototype, 'setBloomPreScreener');
    const on = makeFacade({ getBloomPreScreener: vi.fn(() => screener) });
    void on.facade.searchManager;
    expect(on.deps.getBloomPreScreener).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(screener);
  });

  it('close() detaches the Bloom pre-screener from an existing fuzzy searcher and is idempotent', () => {
    const { facade } = makeFacade();
    const detach = vi.spyOn(facade.searchManager.fuzzySearcher, 'setBloomPreScreener');
    facade.close();
    facade.close();
    expect(detach).toHaveBeenCalledTimes(2);
    expect(detach).toHaveBeenLastCalledWith(null);
  });

  it('close() before any search manager exists is a harmless no-op', () => {
    const { facade } = makeFacade();
    expect(() => facade.close()).not.toThrow();
    expect(facade.peekSearchManager()).toBeUndefined();
  });
});
