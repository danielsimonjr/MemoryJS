/**
 * AgentMemoryFacade — lazy agent-memory managers behind ManagerContext.
 * Verifies once-only construction, identity, env-read timing, and that
 * agentMemory(config) invalidates the derived caches it feeds.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentMemoryFacade, type AgentMemoryFacadeDeps } from '../../../../src/core/context/AgentMemoryFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { GraphTraversal } from '../../../../src/core/GraphTraversal.js';
import { RefIndex } from '../../../../src/core/RefIndex.js';
import { SearchManager } from '../../../../src/search/SearchManager.js';
import { HybridSearchManager } from '../../../../src/search/HybridSearchManager.js';
import { RankedSearch } from '../../../../src/search/RankedSearch.js';
import { CompressionManager } from '../../../../src/features/CompressionManager.js';
import { ExclusionManager } from '../../../../src/agent/ExclusionManager.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';
import type { AgentMemoryConfig } from '../../../../src/agent/AgentMemoryConfig.js';

const FLAGS = ['MEMORY_AUTO_DECAY', 'MEMORY_BACKEND', 'MEMORY_CONTEXT_HYBRID_RANKING'] as const;

afterEach(() => {
  for (const flag of FLAGS) vi.unstubAllEnvs();
  cleanupTempDirs();
});

/** Builds a facade over real storage with spied sibling accessors. */
function makeFacade() {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const searchManager = new SearchManager(storage, makeTempJsonlPath() + '.saved');
  const graphTraversal = new GraphTraversal(storage);
  const hybrid = new HybridSearchManager(null, new RankedSearch(storage));
  const deps: AgentMemoryFacadeDeps = {
    storage,
    getEntityManager: vi.fn(() => entityManager),
    getSearchManager: vi.fn(() => searchManager),
    getGraphTraversal: vi.fn(() => graphTraversal),
    getSemanticSearch: vi.fn(() => null),
    getHybridSearchManager: vi.fn(() => hybrid),
    getCompressionManager: vi.fn(() => new CompressionManager(storage)),
    getExclusionManager: vi.fn(() => new ExclusionManager(storage, entityManager)),
    getRefIndex: vi.fn(() => new RefIndex(makeTempJsonlPath() + '.refs')),
  };
  return { facade: new AgentMemoryFacade(deps), deps };
}

describe('AgentMemoryFacade', () => {
  it('returns the same instance for every lazy member on repeated access', () => {
    const { facade } = makeFacade();
    expect(facade.memoryEngine).toBe(facade.memoryEngine);
    expect(facade.memoryBackend).toBe(facade.memoryBackend);
    expect(facade.decayEngine).toBe(facade.decayEngine);
    expect(facade.salienceEngine).toBe(facade.salienceEngine);
    expect(facade.contextWindowManager).toBe(facade.contextWindowManager);
    expect(facade.memoryFormatter).toBe(facade.memoryFormatter);
    expect(facade.artifactManager).toBe(facade.artifactManager);
    expect(facade.accessTracker).toBe(facade.accessTracker);
  });

  it('constructs no sibling accessor until a member that needs it is touched', () => {
    const { facade, deps } = makeFacade();
    expect(deps.getSearchManager).not.toHaveBeenCalled();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    void facade.memoryFormatter;
    expect(deps.getSearchManager).not.toHaveBeenCalled();
    void facade.accessTracker;
    expect(deps.getSearchManager).toHaveBeenCalledTimes(1);
    expect(deps.getGraphTraversal).toHaveBeenCalledTimes(1);
    expect(deps.getEntityManager).toHaveBeenCalledTimes(1);
  });

  it('agentMemory(config) re-instantiates and invalidates the memory engine and backend', () => {
    const { facade } = makeFacade();
    const engineBefore = facade.memoryEngine;
    const backendBefore = facade.memoryBackend;
    const agentBefore = facade.agentMemory();
    expect(facade.agentMemory()).toBe(agentBefore);
    expect(facade.memoryEngine).toBe(engineBefore);

    const agentAfter = facade.agentMemory({} as AgentMemoryConfig);
    expect(agentAfter).not.toBe(agentBefore);
    expect(facade.memoryEngine).not.toBe(engineBefore);
    expect(facade.memoryBackend).not.toBe(backendBefore);
  });

  it('decayScheduler is undefined while auto-decay is off and is not cached, so a later env flip takes effect', () => {
    const { facade } = makeFacade();
    expect(facade.decayScheduler).toBeUndefined();
    vi.stubEnv('MEMORY_AUTO_DECAY', 'true');
    const scheduler = facade.decayScheduler;
    expect(scheduler).toBeDefined();
    expect(facade.decayScheduler).toBe(scheduler);
  });

  it('wires the hybrid search manager into the context window only when the switch is the literal true', () => {
    const off = makeFacade();
    void off.facade.contextWindowManager;
    expect(off.deps.getHybridSearchManager).not.toHaveBeenCalled();

    vi.stubEnv('MEMORY_CONTEXT_HYBRID_RANKING', 'true');
    const on = makeFacade();
    void on.facade.contextWindowManager;
    expect(on.deps.getHybridSearchManager).toHaveBeenCalledTimes(1);
  });

  it('dreamEngine() with a config always rebuilds, and without one reuses the cached engine', () => {
    const { facade } = makeFacade();
    const first = facade.dreamEngine();
    expect(facade.dreamEngine()).toBe(first);
    expect(facade.dreamEngine({ intervalMs: 1000 })).not.toBe(first);
  });
});
