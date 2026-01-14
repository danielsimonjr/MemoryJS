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
});
