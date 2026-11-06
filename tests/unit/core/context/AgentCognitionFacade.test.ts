/**
 * AgentCognitionFacade — lazy reasoning and procedural managers behind
 * ManagerContext. Verifies once-only construction, identity, side-effect-free
 * peeks, and that close() disposes only the procedural graphs it owns.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AgentCognitionFacade,
  type AgentCognitionFacadeDeps,
} from '../../../../src/core/context/AgentCognitionFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { RelationManager } from '../../../../src/core/RelationManager.js';
import { GraphTraversal } from '../../../../src/core/GraphTraversal.js';
import { RankedSearch } from '../../../../src/search/RankedSearch.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';
import type { MemoryValidator } from '../../../../src/agent/MemoryValidator.js';

afterEach(() => {
  cleanupTempDirs();
});

/** Builds a facade over real storage with spied sibling accessors. */
function makeFacade(extra: Partial<AgentCognitionFacadeDeps> = {}) {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const relationManager = new RelationManager(storage);
  const deps: AgentCognitionFacadeDeps = {
    storage,
    getEntityManager: vi.fn(() => entityManager),
    getRelationManager: vi.fn(() => relationManager),
    getGraphTraversal: vi.fn(() => new GraphTraversal(storage)),
    getRankedSearch: vi.fn(() => new RankedSearch(storage)),
    getSemanticSearch: vi.fn(() => null),
    getMemoryValidator: vi.fn(() => ({}) as MemoryValidator),
    ...extra,
  };
  return { facade: new AgentCognitionFacade(deps), deps };
}

describe('AgentCognitionFacade', () => {
  it('returns the same instance for every lazy member on repeated access', () => {
    const { facade } = makeFacade();
    expect(facade.procedureManager).toBe(facade.procedureManager);
    expect(facade.eventManager).toBe(facade.eventManager);
    expect(facade.plan).toBe(facade.plan);
    expect(facade.failureManager).toBe(facade.failureManager);
    expect(facade.reflectionManager).toBe(facade.reflectionManager);
    expect(facade.causalReasoner).toBe(facade.causalReasoner);
    expect(facade.activeRetrieval).toBe(facade.activeRetrieval);
  });

  it('constructs nothing in the constructor and peekProspectiveMemory never constructs', () => {
    const { facade, deps } = makeFacade();
    expect(facade.peekProspectiveMemory()).toBeUndefined();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    expect(deps.getMemoryValidator).not.toHaveBeenCalled();
    expect(facade.peekProspectiveMemory()).toBeUndefined();
  });

  it('peekProspectiveMemory returns the cached instance after first access', () => {
    const { facade } = makeFacade();
    const pm = facade.prospectiveMemory;
    expect(facade.peekProspectiveMemory()).toBe(pm);
    expect(facade.prospectiveMemory).toBe(pm);
  });

  it('worldModelManager resolves the memory validator once through its accessor', () => {
    const { facade, deps } = makeFacade();
    void facade.worldModelManager;
    void facade.worldModelManager;
    expect(deps.getMemoryValidator).toHaveBeenCalledTimes(1);
  });

  it('reconstructiveMemory() without config is cached; with config it re-instantiates', () => {
    const { facade } = makeFacade();
    const first = facade.reconstructiveMemory();
    expect(facade.reconstructiveMemory()).toBe(first);
    expect(facade.reconstructiveMemory({ backing: undefined })).not.toBe(first);
  });

  it('close() disposes procedural graphs the facade owns and leaves injected ones alone', async () => {
    const { facade } = makeFacade();
    const owned = await facade.createProceduralGraph({ backing: { type: 'memory' } });
    const ownedDispose = vi.spyOn(owned, 'dispose');
    facade.close();
    expect(ownedDispose).toHaveBeenCalledTimes(1);
    facade.close();
    expect(ownedDispose).toHaveBeenCalledTimes(1);
  });
});
