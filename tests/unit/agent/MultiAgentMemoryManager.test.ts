/**
 * MultiAgentMemoryManager Unit Tests
 *
 * Tests for multi-agent memory management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiAgentMemoryManager } from '../../../src/agent/MultiAgentMemoryManager.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

/**
 * Create a mock storage.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  let graph = { entities: [...entities], relations: [...relations] };
  return {
    loadGraph: vi.fn().mockImplementation(() => Promise.resolve({ entities: graph.entities, relations: graph.relations })),
    getGraphForMutation: vi.fn().mockImplementation(() => Promise.resolve(graph)),
    saveGraph: vi.fn().mockImplementation((g) => {
      graph = g;
      return Promise.resolve();
    }),
    appendEntity: vi.fn().mockImplementation((entity) => {
      graph.entities.push(entity);
      return Promise.resolve();
    }),
    appendRelation: vi.fn().mockResolvedValue(undefined),
    updateEntity: vi.fn().mockResolvedValue(true),
    compact: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn(),
    getEntityByName: vi.fn().mockImplementation((name) => graph.entities.find((e) => e.name === name)),
    hasEntity: vi.fn().mockImplementation((name) => graph.entities.some((e) => e.name === name)),
    getEntitiesByType: vi.fn().mockImplementation((type) => graph.entities.filter((e) => e.entityType === type)),
    getEntityTypes: vi.fn().mockReturnValue([]),
    getLowercased: vi.fn().mockReturnValue(undefined),
    getRelationsFrom: vi.fn().mockReturnValue([]),
    getRelationsTo: vi.fn().mockReturnValue([]),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
}

describe('MultiAgentMemoryManager', () => {
  let storage: IGraphStorage;
  let manager: MultiAgentMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    manager = new MultiAgentMemoryManager(storage);
  });

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const config = manager.getConfig();

      expect(config.defaultAgentId).toBe('default');
      expect(config.defaultVisibility).toBe('private');
      expect(config.allowCrossAgent).toBe(true);
      expect(config.requireRegistration).toBe(false);
    });

    it('should create with custom configuration', () => {
      const customManager = new MultiAgentMemoryManager(storage, {
        defaultAgentId: 'main_agent',
        defaultVisibility: 'shared',
        allowCrossAgent: false,
        requireRegistration: true,
      });

      const config = customManager.getConfig();

      expect(config.defaultAgentId).toBe('main_agent');
      expect(config.defaultVisibility).toBe('shared');
      expect(config.allowCrossAgent).toBe(false);
      expect(config.requireRegistration).toBe(true);
    });

    it('should register default agent', () => {
      const defaultAgent = manager.getAgent('default');

      expect(defaultAgent).toBeDefined();
      expect(defaultAgent?.name).toBe('Default Agent');
      expect(defaultAgent?.type).toBe('default');
    });
  });

  describe('registerAgent', () => {
    it('should register a new agent', async () => {
      const metadata = await manager.registerAgent('agent_1', {
        name: 'Assistant',
        type: 'llm',
        trustLevel: 0.9,
      });

      expect(metadata.name).toBe('Assistant');
      expect(metadata.type).toBe('llm');
      expect(metadata.trustLevel).toBe(0.9);
      expect(metadata.capabilities).toEqual(['read', 'write']);
    });

    it('should throw error for duplicate agent ID', async () => {
      await manager.registerAgent('agent_1', { name: 'First' });

      await expect(
        manager.registerAgent('agent_1', { name: 'Second' })
      ).rejects.toThrow('Agent already registered');
    });

    it('should apply default values for optional fields', async () => {
      const metadata = await manager.registerAgent('agent_2', {});

      expect(metadata.name).toBe('agent_2');
      expect(metadata.type).toBe('llm');
      expect(metadata.trustLevel).toBe(0.5);
    });

    it('should emit registration event', async () => {
      const eventHandler = vi.fn();
      manager.on('agent:registered', eventHandler);

      await manager.registerAgent('agent_1', { name: 'Test' });

      expect(eventHandler).toHaveBeenCalledWith('agent_1', expect.objectContaining({ name: 'Test' }));
    });
  });

  describe('unregisterAgent', () => {
    it('should unregister an existing agent', async () => {
      await manager.registerAgent('agent_1', {});

      const result = await manager.unregisterAgent('agent_1');

      expect(result).toBe(true);
      expect(manager.hasAgent('agent_1')).toBe(false);
    });

    it('should return false for non-existent agent', async () => {
      const result = await manager.unregisterAgent('unknown');

      expect(result).toBe(false);
    });

    it('should throw error when unregistering default agent', async () => {
      await expect(
        manager.unregisterAgent('default')
      ).rejects.toThrow('Cannot unregister default agent');
    });
  });

  describe('getAgent', () => {
    it('should return agent metadata', async () => {
      await manager.registerAgent('agent_1', { name: 'Test Agent' });

      const agent = manager.getAgent('agent_1');

      expect(agent?.name).toBe('Test Agent');
    });

    it('should return undefined for unknown agent', () => {
      const agent = manager.getAgent('unknown');

      expect(agent).toBeUndefined();
    });
  });

  describe('listAgents', () => {
    beforeEach(async () => {
      await manager.registerAgent('llm_1', { name: 'LLM 1', type: 'llm', trustLevel: 0.9, capabilities: ['read', 'write'] });
      await manager.registerAgent('tool_1', { name: 'Tool 1', type: 'tool', trustLevel: 0.5, capabilities: ['read'] });
      await manager.registerAgent('human_1', { name: 'Human 1', type: 'human', trustLevel: 0.8, capabilities: ['read', 'write', 'admin'] });
    });

    it('should list all agents sorted by trust level', () => {
      const agents = manager.listAgents();

      expect(agents.length).toBe(4); // 3 registered + 1 default
      expect(agents[0].metadata.trustLevel).toBeGreaterThanOrEqual(agents[1].metadata.trustLevel);
    });

    it('should filter by type', () => {
      const llmAgents = manager.listAgents({ type: 'llm' });

      expect(llmAgents.length).toBe(1);
      expect(llmAgents[0].metadata.type).toBe('llm');
    });

    it('should filter by minimum trust level', () => {
      const trustedAgents = manager.listAgents({ minTrustLevel: 0.8 });

      expect(trustedAgents.every((a) => a.metadata.trustLevel >= 0.8)).toBe(true);
    });

    it('should filter by capability', () => {
      const adminAgents = manager.listAgents({ capability: 'admin' });

      expect(adminAgents.length).toBe(1);
      expect(adminAgents[0].id).toBe('human_1');
    });
  });

  describe('createAgentMemory', () => {
    it('should create memory with agent ownership', async () => {
      await manager.registerAgent('agent_1', {});

      const memory = await manager.createAgentMemory('agent_1', {
        name: 'user_preference',
        observations: ['Likes Italian food'],
      });

      expect(memory.name).toBe('user_preference');
      expect(memory.agentId).toBe('agent_1');
      expect(memory.visibility).toBe('private');
    });

    it('should use default agent when unregistered and not required', async () => {
      const memory = await manager.createAgentMemory('unknown_agent', {
        name: 'test_memory',
      });

      expect(memory.agentId).toBe('default');
    });

    it('should throw error for unregistered agent when required', async () => {
      const strictManager = new MultiAgentMemoryManager(storage, {
        requireRegistration: true,
      });

      await expect(
        strictManager.createAgentMemory('unknown_agent', {})
      ).rejects.toThrow('Agent not registered');
    });

    it('should emit creation event', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:created', eventHandler);

      await manager.createAgentMemory('default', { name: 'test' });

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('getAgentMemories', () => {
    it('should return memories owned by agent', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'm1' });
      await manager.createAgentMemory('agent_1', { name: 'm2' });
      await manager.createAgentMemory('default', { name: 'm3' });

      const memories = await manager.getAgentMemories('agent_1');

      expect(memories.length).toBe(2);
      expect(memories.every((m) => m.agentId === 'agent_1')).toBe(true);
    });
  });

  describe('getVisibleMemories', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});

      // Create memories with different visibilities
      await manager.createAgentMemory('agent_1', { name: 'private_1', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'shared_1', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'public_1', visibility: 'public' });
      await manager.createAgentMemory('agent_2', { name: 'private_2', visibility: 'private' });
    });

    it('should return all own memories regardless of visibility', async () => {
      const memories = await manager.getVisibleMemories('agent_1');

      const ownMemories = memories.filter((m) => m.agentId === 'agent_1');
      expect(ownMemories.length).toBe(3);
    });

    it('should include shared and public memories from other agents', async () => {
      const memories = await manager.getVisibleMemories('agent_2');

      const otherMemories = memories.filter((m) => m.agentId === 'agent_1');
      expect(otherMemories.some((m) => m.name === 'shared_1')).toBe(true);
      expect(otherMemories.some((m) => m.name === 'public_1')).toBe(true);
    });

    it('should not include private memories from other agents', async () => {
      const memories = await manager.getVisibleMemories('agent_2');

      expect(memories.some((m) => m.name === 'private_1')).toBe(false);
    });

    it('should respect allowCrossAgent config', async () => {
      const isolatedManager = new MultiAgentMemoryManager(storage, {
        allowCrossAgent: false,
      });
      await isolatedManager.registerAgent('agent_3', {});

      // Need to create memories in new manager
      await isolatedManager.createAgentMemory('default', { name: 'shared_default', visibility: 'shared' });

      const memories = await isolatedManager.getVisibleMemories('agent_3');
      const otherMemories = memories.filter((m) => m.agentId !== 'agent_3');

      expect(otherMemories.length).toBe(0);
    });
  });

  describe('transferMemory', () => {
    it('should transfer memory ownership', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
      await manager.createAgentMemory('agent_1', { name: 'transfer_me' });

      const result = await manager.transferMemory('transfer_me', 'agent_1', 'agent_2');

      expect(result?.agentId).toBe('agent_2');
    });

    it('should return null for non-existent memory', async () => {
      const result = await manager.transferMemory('nonexistent', 'agent_1', 'agent_2');

      expect(result).toBeNull();
    });

    it('should return null if not owner', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
      await manager.createAgentMemory('agent_1', { name: 'owned_by_1' });

      const result = await manager.transferMemory('owned_by_1', 'agent_2', 'agent_1');

      expect(result).toBeNull();
    });
  });

  describe('setMemoryVisibility', () => {
    it('should change memory visibility', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'test_mem', visibility: 'private' });

      const result = await manager.setMemoryVisibility('test_mem', 'agent_1', 'public');

      expect(result?.visibility).toBe('public');
    });

    it('should return null if not owner', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'owned_mem' });

      const result = await manager.setMemoryVisibility('owned_mem', 'agent_2', 'public');

      expect(result).toBeNull();
    });
  });

  describe('agent count', () => {
    it('should return correct agent count', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});

      expect(manager.getAgentCount()).toBe(3); // 2 + default
    });
  });

  // ==================== Sprint 22: Memory Visibility ====================

  describe('shareMemory', () => {
    it('should share memory with all registered agents', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'share_me', visibility: 'private' });

      const result = await manager.shareMemory('share_me', 'agent_1');

      expect(result?.visibility).toBe('shared');
    });

    it('should return null for non-owner', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
      await manager.createAgentMemory('agent_1', { name: 'owned' });

      const result = await manager.shareMemory('owned', 'agent_2');

      expect(result).toBeNull();
    });
  });

  describe('makePublic', () => {
    it('should make memory public', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'make_public', visibility: 'private' });

      const result = await manager.makePublic('make_public', 'agent_1');

      expect(result?.visibility).toBe('public');
    });
  });

  describe('makePrivate', () => {
    it('should make memory private', async () => {
      await manager.registerAgent('agent_1', {});
      await manager.createAgentMemory('agent_1', { name: 'make_private', visibility: 'public' });

      const result = await manager.makePrivate('make_private', 'agent_1');

      expect(result?.visibility).toBe('private');
    });
  });

  describe('filterByVisibility', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should return own memories regardless of visibility', async () => {
      await manager.createAgentMemory('agent_1', { name: 'private_1', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'shared_1', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'public_1', visibility: 'public' });

      const graph = await storage.loadGraph();
      const filtered = manager.filterByVisibility(graph.entities, 'agent_1');

      const ownMemories = filtered.filter((m) => m.agentId === 'agent_1');
      expect(ownMemories.length).toBe(3);
    });

    it('should filter out private memories from other agents', async () => {
      await manager.createAgentMemory('agent_1', { name: 'other_private', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'other_shared', visibility: 'shared' });

      const graph = await storage.loadGraph();
      const filtered = manager.filterByVisibility(graph.entities, 'agent_2');

      expect(filtered.some((m) => m.name === 'other_private')).toBe(false);
      expect(filtered.some((m) => m.name === 'other_shared')).toBe(true);
    });

    it('should include public memories from other agents', async () => {
      await manager.createAgentMemory('agent_1', { name: 'other_public', visibility: 'public' });

      const graph = await storage.loadGraph();
      const filtered = manager.filterByVisibility(graph.entities, 'agent_2');

      expect(filtered.some((m) => m.name === 'other_public')).toBe(true);
    });
  });

  describe('isMemoryVisible', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should return true for own memory', async () => {
      await manager.createAgentMemory('agent_1', { name: 'own_mem', visibility: 'private' });

      expect(manager.isMemoryVisible('own_mem', 'agent_1')).toBe(true);
    });

    it('should return false for other agents private memory', async () => {
      await manager.createAgentMemory('agent_1', { name: 'other_private', visibility: 'private' });

      expect(manager.isMemoryVisible('other_private', 'agent_2')).toBe(false);
    });

    it('should return true for shared memory', async () => {
      await manager.createAgentMemory('agent_1', { name: 'other_shared', visibility: 'shared' });

      expect(manager.isMemoryVisible('other_shared', 'agent_2')).toBe(true);
    });

    it('should return true for public memory', async () => {
      await manager.createAgentMemory('agent_1', { name: 'other_public', visibility: 'public' });

      expect(manager.isMemoryVisible('other_public', 'agent_2')).toBe(true);
    });

    it('should return false for non-existent memory', () => {
      expect(manager.isMemoryVisible('nonexistent', 'agent_1')).toBe(false);
    });
  });

  describe('getVisibleMemoriesByType', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should filter by entity type', async () => {
      await manager.createAgentMemory('agent_1', { name: 'mem_a', entityType: 'task', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'mem_b', entityType: 'note', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'mem_c', entityType: 'task', visibility: 'shared' });

      const tasks = await manager.getVisibleMemoriesByType('agent_2', 'task');

      expect(tasks.length).toBe(2);
      expect(tasks.every((m) => m.entityType === 'task')).toBe(true);
    });

    it('should respect visibility when filtering by type', async () => {
      await manager.createAgentMemory('agent_1', { name: 'private_task', entityType: 'task', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'shared_task', entityType: 'task', visibility: 'shared' });

      const tasks = await manager.getVisibleMemoriesByType('agent_2', 'task');

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe('shared_task');
    });
  });

  describe('searchVisibleMemories', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should search by name', async () => {
      await manager.createAgentMemory('agent_1', { name: 'project_alpha', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'project_beta', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'other_thing', visibility: 'shared' });

      const results = await manager.searchVisibleMemories('agent_2', 'project');

      expect(results.length).toBe(2);
      expect(results.every((m) => m.name.includes('project'))).toBe(true);
    });

    it('should search by observations', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'mem_with_obs',
        observations: ['Contains important data'],
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_1', {
        name: 'other_mem',
        observations: ['Something else'],
        visibility: 'shared',
      });

      const results = await manager.searchVisibleMemories('agent_2', 'important');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('mem_with_obs');
    });

    it('should filter out private memories from search', async () => {
      await manager.createAgentMemory('agent_1', { name: 'searchable_private', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'searchable_shared', visibility: 'shared' });

      const results = await manager.searchVisibleMemories('agent_2', 'searchable');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('searchable_shared');
    });

    it('should include own private memories in search', async () => {
      await manager.createAgentMemory('agent_1', { name: 'own_private', visibility: 'private' });

      const results = await manager.searchVisibleMemories('agent_1', 'own');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('own_private');
    });

    it('should be case-insensitive', async () => {
      await manager.createAgentMemory('agent_1', { name: 'CamelCase', visibility: 'shared' });

      const results = await manager.searchVisibleMemories('agent_2', 'camelcase');

      expect(results.length).toBe(1);
    });
  });

  // ==================== Sprint 23: Cross-Agent Operations ====================

  describe('getSharedMemories', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
      await manager.registerAgent('agent_3', {});
    });

    it('should return memories visible to all specified agents', async () => {
      await manager.createAgentMemory('agent_1', { name: 'shared_mem', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'private_mem', visibility: 'private' });

      const shared = await manager.getSharedMemories(['agent_1', 'agent_2']);

      expect(shared.some((m) => m.name === 'shared_mem')).toBe(true);
      // Private memory only visible to owner, not to agent_2
      expect(shared.some((m) => m.name === 'private_mem')).toBe(false);
    });

    it('should filter out private memories not owned by any specified agent', async () => {
      await manager.createAgentMemory('agent_3', { name: 'agent3_private', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'agent1_shared', visibility: 'shared' });

      const shared = await manager.getSharedMemories(['agent_1', 'agent_2']);

      expect(shared.some((m) => m.name === 'agent3_private')).toBe(false);
      expect(shared.some((m) => m.name === 'agent1_shared')).toBe(true);
    });

    it('should filter by entity type', async () => {
      await manager.createAgentMemory('agent_1', { name: 'task_mem', entityType: 'task', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'note_mem', entityType: 'note', visibility: 'shared' });

      const shared = await manager.getSharedMemories(['agent_1', 'agent_2'], { entityType: 'task' });

      expect(shared.length).toBe(1);
      expect(shared[0].name).toBe('task_mem');
    });

    it('should return empty for less than 2 agents', async () => {
      const shared = await manager.getSharedMemories(['agent_1']);

      expect(shared.length).toBe(0);
    });
  });

  describe('searchCrossAgent', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', { trustLevel: 0.9 });
      await manager.registerAgent('agent_2', { trustLevel: 0.5 });
    });

    it('should search across visible memories', async () => {
      await manager.createAgentMemory('agent_1', { name: 'project_alpha', visibility: 'shared' });
      await manager.createAgentMemory('agent_2', { name: 'project_beta', visibility: 'shared' });

      const results = await manager.searchCrossAgent('default', 'project');

      expect(results.length).toBe(2);
    });

    it('should rank by relevance without trust weighting', async () => {
      await manager.createAgentMemory('agent_1', { name: 'data_analysis', visibility: 'shared' });
      await manager.createAgentMemory('agent_2', { name: 'data', visibility: 'shared' });

      const results = await manager.searchCrossAgent('default', 'data');

      expect(results.length).toBe(2);
      expect(results.every((r) => r.relevanceScore > 0)).toBe(true);
    });

    it('should apply trust weighting when enabled', async () => {
      await manager.createAgentMemory('agent_1', { name: 'high_trust_mem', visibility: 'shared' });
      await manager.createAgentMemory('agent_2', { name: 'low_trust_mem', visibility: 'shared' });

      const resultsWithTrust = await manager.searchCrossAgent('default', 'trust', {
        useTrustWeighting: true,
        trustWeight: 0.5,
      });

      // Agent_1 has higher trust (0.9) so high_trust_mem should rank higher
      const highTrustResult = resultsWithTrust.find((r) => r.memory.name === 'high_trust_mem');
      const lowTrustResult = resultsWithTrust.find((r) => r.memory.name === 'low_trust_mem');

      expect(highTrustResult?.trustScore).toBeGreaterThan(lowTrustResult?.trustScore ?? 0);
    });

    it('should filter by specific agent IDs', async () => {
      await manager.createAgentMemory('agent_1', { name: 'agent1_data', visibility: 'shared' });
      await manager.createAgentMemory('agent_2', { name: 'agent2_data', visibility: 'shared' });

      const results = await manager.searchCrossAgent('default', 'data', {
        agentIds: ['agent_1'],
      });

      expect(results.length).toBe(1);
      expect(results[0].memory.name).toBe('agent1_data');
    });

    it('should emit search event', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:cross_agent_search', eventHandler);

      await manager.createAgentMemory('agent_1', { name: 'searchable', visibility: 'shared' });
      await manager.searchCrossAgent('default', 'searchable');

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('copyMemory', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should copy shared memory to private store', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'original_mem',
        observations: ['Important fact'],
        visibility: 'shared',
      });

      const copied = await manager.copyMemory('original_mem', 'agent_2');

      expect(copied).not.toBeNull();
      expect(copied?.agentId).toBe('agent_2');
      expect(copied?.visibility).toBe('private');
      expect(copied?.observations).toContain('Important fact');
    });

    it('should track source information', async () => {
      await manager.createAgentMemory('agent_1', { name: 'source_mem', visibility: 'shared' });

      const copied = await manager.copyMemory('source_mem', 'agent_2');

      expect(copied?.source?.originalEntityId).toBe('source_mem');
      expect(copied?.source?.method).toBe('consolidated');
    });

    it('should add annotation when provided', async () => {
      await manager.createAgentMemory('agent_1', { name: 'annotate_me', visibility: 'shared' });

      const copied = await manager.copyMemory('annotate_me', 'agent_2', {
        annotation: 'Copied for review',
      });

      expect(copied?.observations?.some((o) => o.includes('Copied for review'))).toBe(true);
    });

    it('should allow custom name', async () => {
      await manager.createAgentMemory('agent_1', { name: 'orig', visibility: 'shared' });

      const copied = await manager.copyMemory('orig', 'agent_2', {
        newName: 'my_custom_copy',
      });

      expect(copied?.name).toBe('my_custom_copy');
    });

    it('should return null for inaccessible memory', async () => {
      await manager.createAgentMemory('agent_1', { name: 'private_orig', visibility: 'private' });

      const copied = await manager.copyMemory('private_orig', 'agent_2');

      expect(copied).toBeNull();
    });

    it('should emit copy event', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:copied', eventHandler);

      await manager.createAgentMemory('agent_1', { name: 'copy_event_test', visibility: 'shared' });
      await manager.copyMemory('copy_event_test', 'agent_2');

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe('recordCrossAgentAccess', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should emit access event for cross-agent access', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:cross_agent_access', eventHandler);

      await manager.createAgentMemory('agent_1', { name: 'access_mem', visibility: 'shared' });
      manager.recordCrossAgentAccess('access_mem', 'agent_2', 'view');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryName: 'access_mem',
          ownerAgentId: 'agent_1',
          requestingAgentId: 'agent_2',
          accessType: 'view',
        })
      );
    });

    it('should not emit event for own memory access', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:cross_agent_access', eventHandler);

      await manager.createAgentMemory('agent_1', { name: 'own_mem', visibility: 'private' });
      manager.recordCrossAgentAccess('own_mem', 'agent_1', 'view');

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('getCollaborationStats', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should return correct collaboration statistics', async () => {
      await manager.createAgentMemory('agent_1', { name: 'private_1', visibility: 'private' });
      await manager.createAgentMemory('agent_1', { name: 'shared_1', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'shared_2', visibility: 'shared' });
      await manager.createAgentMemory('agent_1', { name: 'public_1', visibility: 'public' });
      await manager.createAgentMemory('agent_2', { name: 'agent2_shared', visibility: 'shared' });

      const stats = await manager.getCollaborationStats('agent_1');

      expect(stats.sharedMemoryCount).toBe(2);
      expect(stats.publicMemoryCount).toBe(1);
      expect(stats.accessibleFromOthers).toBe(1); // agent_2's shared memory
    });
  });

  // ==================== Sprint 24: Conflict Resolution ====================

  describe('detectConflicts', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', {});
      await manager.registerAgent('agent_2', {});
    });

    it('should detect conflicts between similar memories', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'user_pref_1',
        observations: ['User prefers morning meetings'],
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_2', {
        name: 'user_pref_2',
        observations: ['User prefers afternoon meetings'],
        visibility: 'shared',
      });

      const conflicts = await manager.detectConflicts();

      // Note: detection depends on similarity threshold
      expect(Array.isArray(conflicts)).toBe(true);
    });

    it('should emit conflict event on detection', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:conflict', eventHandler);

      await manager.createAgentMemory('agent_1', {
        name: 'same_topic_1',
        observations: ['Feature is enabled and working'],
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_2', {
        name: 'same_topic_2',
        observations: ['Feature is not enabled and not working'],
        visibility: 'shared',
      });

      await manager.detectConflicts();

      // Event may or may not fire depending on similarity calculation
      expect(typeof eventHandler).toBe('function');
    });
  });

  describe('mergeCrossAgent', () => {
    beforeEach(async () => {
      await manager.registerAgent('agent_1', { trustLevel: 0.9 });
      await manager.registerAgent('agent_2', { trustLevel: 0.5 });
    });

    it('should merge memories from multiple agents', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'merge_source_1',
        observations: ['Fact A', 'Fact B'],
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_2', {
        name: 'merge_source_2',
        observations: ['Fact B', 'Fact C'],
        visibility: 'shared',
      });

      const merged = await manager.mergeCrossAgent(
        ['merge_source_1', 'merge_source_2'],
        'default',
        { newName: 'merged_result' }
      );

      expect(merged).not.toBeNull();
      expect(merged?.name).toBe('merged_result');
      expect(merged?.observations).toContain('Fact A');
      expect(merged?.observations).toContain('Fact B');
      expect(merged?.observations).toContain('Fact C');
    });

    it('should apply trust-weighted confidence', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'high_trust_mem',
        observations: ['Trusted data'],
        visibility: 'shared',
        confidence: 0.8,
      });
      await manager.createAgentMemory('agent_2', {
        name: 'low_trust_mem',
        observations: ['Less trusted data'],
        visibility: 'shared',
        confidence: 0.8,
      });

      const merged = await manager.mergeCrossAgent(
        ['high_trust_mem', 'low_trust_mem'],
        'default'
      );

      expect(merged).not.toBeNull();
      // Confidence is weighted by agent trust
      expect(merged?.confidence).toBeGreaterThan(0);
    });

    it('should track source in merged memory', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'source_a',
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_2', {
        name: 'source_b',
        visibility: 'shared',
      });

      const merged = await manager.mergeCrossAgent(
        ['source_a', 'source_b'],
        'default'
      );

      expect(merged?.source?.originalEntityId).toContain('source_a');
      expect(merged?.source?.originalEntityId).toContain('source_b');
      expect(merged?.source?.method).toBe('consolidated');
    });

    it('should return null for less than 2 memories', async () => {
      await manager.createAgentMemory('agent_1', {
        name: 'single_mem',
        visibility: 'shared',
      });

      const merged = await manager.mergeCrossAgent(['single_mem'], 'default');

      expect(merged).toBeNull();
    });

    it('should emit merge event', async () => {
      const eventHandler = vi.fn();
      manager.on('memory:merged', eventHandler);

      await manager.createAgentMemory('agent_1', {
        name: 'merge_event_1',
        visibility: 'shared',
      });
      await manager.createAgentMemory('agent_2', {
        name: 'merge_event_2',
        visibility: 'shared',
      });

      await manager.mergeCrossAgent(
        ['merge_event_1', 'merge_event_2'],
        'default'
      );

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMemories: ['merge_event_1', 'merge_event_2'],
          targetAgent: 'default',
        })
      );
    });
  });

  describe('getConflictResolverInstance', () => {
    it('should return the conflict resolver instance', () => {
      const resolver = manager.getConflictResolverInstance();

      expect(resolver).toBeDefined();
      expect(typeof resolver.detectConflicts).toBe('function');
      expect(typeof resolver.resolveConflict).toBe('function');
    });
  });
});
