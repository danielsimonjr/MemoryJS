/**
 * AgentBookkeepingFacade — lazy record-keeping managers behind ManagerContext.
 * Verifies once-only construction, identity, and that the semantic search is
 * resolved only by the members that need it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AgentBookkeepingFacade,
  type AgentBookkeepingFacadeDeps,
} from '../../../../src/core/context/AgentBookkeepingFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { ObservationManager } from '../../../../src/core/ObservationManager.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';

afterEach(() => {
  cleanupTempDirs();
});

/** Builds a facade over real storage with spied sibling accessors. */
function makeFacade() {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const observationManager = new ObservationManager(storage);
  const deps: AgentBookkeepingFacadeDeps = {
    storage,
    getEntityManager: vi.fn(() => entityManager),
    getObservationManager: vi.fn(() => observationManager),
    getSemanticSearch: vi.fn(() => null),
  };
  return { facade: new AgentBookkeepingFacade(deps), deps };
}

describe('AgentBookkeepingFacade', () => {
  it('returns the same instance for every lazy member on repeated access', () => {
    const { facade } = makeFacade();
    expect(facade.memoryValidator).toBe(facade.memoryValidator);
    expect(facade.exclusionManager).toBe(facade.exclusionManager);
    expect(facade.heuristicManager).toBe(facade.heuristicManager);
    expect(facade.decisionManager).toBe(facade.decisionManager);
    expect(facade.spellChecker).toBe(facade.spellChecker);
    expect(facade.toolCallObserver).toBe(facade.toolCallObserver);
    expect(facade.semanticForget).toBe(facade.semanticForget);
  });

  it('constructs nothing in the constructor', () => {
    const { deps } = makeFacade();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    expect(deps.getSemanticSearch).not.toHaveBeenCalled();
  });

  it('resolves the semantic search only when a member that needs it is touched', () => {
    const { facade, deps } = makeFacade();
    void facade.exclusionManager;
    expect(deps.getSemanticSearch).not.toHaveBeenCalled();
    void facade.memoryValidator;
    void facade.memoryValidator;
    expect(deps.getSemanticSearch).toHaveBeenCalledTimes(1);
  });

  it('toolCallObserver wires the tool affordance manager it observes through', () => {
    const { facade } = makeFacade();
    expect(facade.toolCallObserver).toBeDefined();
    expect(facade.toolAffordanceManager).toBeDefined();
  });
});
