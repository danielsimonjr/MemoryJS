/**
 * Lazy-once identity for `ctx.freshnessManager` (AgentBookkeepingFacade) and
 * `ctx.temporalSearch` (SearchFacade), plus the ManagerContext delegates.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SearchFacade, type SearchFacadeDeps } from '../../../../src/core/context/SearchFacade.js';
import {
  AgentBookkeepingFacade,
  type AgentBookkeepingFacadeDeps,
} from '../../../../src/core/context/AgentBookkeepingFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import { ObservationManager } from '../../../../src/core/ObservationManager.js';
import { GraphTraversal } from '../../../../src/core/GraphTraversal.js';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { TemporalSearch } from '../../../../src/search/TemporalSearch.js';
import { FreshnessManager } from '../../../../src/features/FreshnessManager.js';
import { CachePressureCoordinator } from '../../../../src/utils/CachePressureCoordinator.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTempDirs();
});

function makeSearchFacade(): SearchFacade {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const deps: SearchFacadeDeps = {
    storage,
    cachePressure: new CachePressureCoordinator(),
    savedSearchesFilePath: makeTempJsonlPath() + '.saved',
    getEntityManager: () => entityManager,
    getRelationManager: () => new RelationManager(storage),
    getObservationManager: () => new ObservationManager(storage),
    getGraphTraversal: () => new GraphTraversal(storage),
    getBloomPreScreener: () => null,
  };
  return new SearchFacade(deps);
}

function makeBookkeepingFacade(): AgentBookkeepingFacade {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const deps: AgentBookkeepingFacadeDeps = {
    storage,
    getEntityManager: () => new EntityManager(storage),
    getObservationManager: () => new ObservationManager(storage),
    getSemanticSearch: () => null,
  } as AgentBookkeepingFacadeDeps;
  return new AgentBookkeepingFacade(deps);
}

describe('SearchFacade.temporalSearch', () => {
  it('constructs a TemporalSearch once and returns the same instance', () => {
    const facade = makeSearchFacade();
    const first = facade.temporalSearch;
    expect(first).toBeInstanceOf(TemporalSearch);
    expect(facade.temporalSearch).toBe(first);
  });
});

describe('AgentBookkeepingFacade.freshnessManager', () => {
  it('constructs a FreshnessManager once and returns the same instance', () => {
    const facade = makeBookkeepingFacade();
    const first = facade.freshnessManager;
    expect(first).toBeInstanceOf(FreshnessManager);
    expect(facade.freshnessManager).toBe(first);
  });
});

describe('ManagerContext delegates', () => {
  it('exposes freshnessManager and temporalSearch with stable identity', () => {
    const ctx = new ManagerContext(makeTempJsonlPath());
    expect(ctx.freshnessManager).toBeInstanceOf(FreshnessManager);
    expect(ctx.freshnessManager).toBe(ctx.freshnessManager);
    expect(ctx.temporalSearch).toBeInstanceOf(TemporalSearch);
    expect(ctx.temporalSearch).toBe(ctx.temporalSearch);
  });
});
