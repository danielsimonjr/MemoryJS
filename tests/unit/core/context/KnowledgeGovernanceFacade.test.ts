/**
 * KnowledgeGovernanceFacade — lazy governance, ledger, skill, and RBAC managers
 * behind ManagerContext. Verifies identity, the env-gated hook object, the
 * once-only ledger resolution, and side-effect-free peeks.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  KnowledgeGovernanceFacade,
  type KnowledgeGovernanceFacadeDeps,
} from '../../../../src/core/context/KnowledgeGovernanceFacade.js';
import { createStorageFromPath } from '../../../../src/core/StorageFactory.js';
import { EntityManager } from '../../../../src/core/EntityManager.js';
import { FailureManager } from '../../../../src/agent/FailureManager.js';
import { makeTempJsonlPath, cleanupTempDirs } from '../../../helpers/tempStorage.js';
import type { GraphStorage } from '../../../../src/core/GraphStorage.js';
import type { SemanticSearch } from '../../../../src/search/SemanticSearch.js';

const FLAGS = ['MEMORY_GOVERNANCE_ENABLED', 'MEMORY_TRANSITION_LEDGER', 'MEMORY_AUDIT_LOG_FILE'] as const;

afterEach(() => {
  for (const flag of FLAGS) vi.unstubAllEnvs();
  cleanupTempDirs();
});

/** Builds a facade over real storage with spied sibling accessors. */
function makeFacade(extra: Partial<KnowledgeGovernanceFacadeDeps> = {}) {
  const storage = createStorageFromPath(makeTempJsonlPath()) as GraphStorage;
  const entityManager = new EntityManager(storage);
  const deps: KnowledgeGovernanceFacadeDeps = {
    storage,
    getEntityManager: vi.fn(() => entityManager),
    getFailureManager: vi.fn(() => new FailureManager(storage, entityManager, {} as never)),
    peekSemanticSearch: vi.fn((): SemanticSearch | null | undefined => undefined),
    ...extra,
  };
  return { facade: new KnowledgeGovernanceFacade(deps), deps };
}

describe('KnowledgeGovernanceFacade', () => {
  it('returns the same instance for every lazy member on repeated access', () => {
    const { facade } = makeFacade();
    expect(facade.governanceManager).toBe(facade.governanceManager);
    expect(facade.skillManager).toBe(facade.skillManager);
    expect(facade.instructionSets).toBe(facade.instructionSets);
    expect(facade.knowledgeRepository).toBe(facade.knowledgeRepository);
    expect(facade.skillPublisher).toBe(facade.skillPublisher);
    expect(facade.roleAssignmentStore).toBe(facade.roleAssignmentStore);
    expect(facade.rbacMiddleware).toBe(facade.rbacMiddleware);
  });

  it('peek methods report undefined before access and never construct', () => {
    const { facade, deps } = makeFacade();
    expect(facade.peekSkillManager()).toBeUndefined();
    expect(facade.peekInstructionSets()).toBeUndefined();
    expect(facade.peekKnowledgeRepository()).toBeUndefined();
    expect(facade.peekSkillPublisher()).toBeUndefined();
    expect(deps.getEntityManager).not.toHaveBeenCalled();
    expect(deps.getFailureManager).not.toHaveBeenCalled();
  });

  it('peekSkillManager returns the cached skill manager after first access', () => {
    const { facade } = makeFacade();
    const skills = facade.skillManager;
    expect(facade.peekSkillManager()).toBe(skills);
  });

  it('blends semantic search into skills only from the peek, never by constructing it', () => {
    const { facade, deps } = makeFacade();
    void facade.skillManager;
    expect(deps.peekSemanticSearch).toHaveBeenCalled();
    expect(deps.getFailureManager).not.toHaveBeenCalled();
  });

  it('knowledgeRepository resolves the failure manager once, on first access', () => {
    const { facade, deps } = makeFacade();
    void facade.knowledgeRepository;
    void facade.knowledgeRepository;
    expect(deps.getFailureManager).toHaveBeenCalledTimes(1);
  });

  it('getGovernanceHooks is undefined while the flag is off and a stable object once it is on', () => {
    const { facade } = makeFacade();
    expect(facade.getGovernanceHooks()).toBeUndefined();
    vi.stubEnv('MEMORY_GOVERNANCE_ENABLED', 'true');
    const hooks = facade.getGovernanceHooks();
    expect(hooks).toBeDefined();
    expect(typeof hooks?.canCreate).toBe('function');
    expect(facade.getGovernanceHooks()).toBe(hooks);
  });

  it('transitionLedger caches its env-gated result, so a later flag flip has no effect', () => {
    const { facade } = makeFacade();
    expect(facade.transitionLedger).toBeNull();
    vi.stubEnv('MEMORY_TRANSITION_LEDGER', 'true');
    expect(facade.transitionLedger).toBeNull();
  });
});
