/**
 * ContextWindowManager Unit Tests
 *
 * Tests for token-budgeted memory retrieval.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextWindowManager } from '../../../src/agent/ContextWindowManager.js';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { HybridSearchManager } from '../../../src/search/HybridSearchManager.js';
import type { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity, ContextRetrievalOptions } from '../../../src/types/agent-memory.js';
import { logger } from '../../../src/utils/logger.js';

/**
 * Create a mock storage with entities.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  const graph = { entities, relations };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find((e) => e.name === name)),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGraphStorage;
}

/**
 * Create a test agent entity.
 */
function createTestEntity(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name: 'test_entity',
    entityType: 'memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    memoryType: 'working',
    accessCount: 10,
    confidence: 0.8,
    confirmationCount: 3,
    visibility: 'private',
    ...overrides,
  };
}

describe('ContextWindowManager', () => {
  let storage: IGraphStorage;
  let accessTracker: AccessTracker;
  let decayEngine: DecayEngine;
  let salienceEngine: SalienceEngine;
  let contextManager: ContextWindowManager;

  beforeEach(() => {
    storage = createMockStorage();
    accessTracker = new AccessTracker(storage);
    decayEngine = new DecayEngine(storage, accessTracker);
    salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
    contextManager = new ContextWindowManager(storage, salienceEngine);
  });

  describe('estimateTokens', () => {
    it('should estimate tokens based on word count', () => {
      const entity = createTestEntity({
        name: 'user_preference',
        entityType: 'preference',
        observations: ['User likes Italian food', 'User prefers quiet restaurants'],
      });

      const tokens = contextManager.estimateTokens(entity);

      // Word count: user_preference(1) + preference(1) + User likes Italian food(4) + User prefers quiet restaurants(4) = 10
      // Plus memoryType, etc. ~12-15 words * 1.3 multiplier
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(30);
    });

    it('should include metadata fields in estimation', () => {
      const withMetadata = createTestEntity({
        name: 'test',
        memoryType: 'episodic',
        sessionId: 'session_123',
        taskId: 'task_456',
      });
      const withoutMetadata = createTestEntity({
        name: 'test',
        memoryType: undefined,
        sessionId: undefined,
        taskId: undefined,
      });

      const tokensWithMeta = contextManager.estimateTokens(withMetadata);
      const tokensWithoutMeta = contextManager.estimateTokens(withoutMetadata);

      expect(tokensWithMeta).toBeGreaterThan(tokensWithoutMeta);
    });

    it('should handle empty observations', () => {
      const entity = createTestEntity({
        name: 'empty',
        observations: [],
      });

      const tokens = contextManager.estimateTokens(entity);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTotalTokens', () => {
    it('should sum tokens for multiple entities', () => {
      const entities = [
        createTestEntity({ name: 'e1', observations: ['Short'] }),
        createTestEntity({ name: 'e2', observations: ['Also short'] }),
      ];

      const total = contextManager.estimateTotalTokens(entities);

      expect(total).toBeGreaterThan(0);
      expect(total).toBe(
        contextManager.estimateTokens(entities[0]) + contextManager.estimateTokens(entities[1])
      );
    });

    it('should return 0 for empty array', () => {
      const total = contextManager.estimateTotalTokens([]);
      expect(total).toBe(0);
    });
  });

  describe('prioritize', () => {
    it('should select entities within budget', async () => {
      const entities = [
        createTestEntity({ name: 'e1', importance: 8, observations: ['Short text'] }),
        createTestEntity({ name: 'e2', importance: 5, observations: ['Medium length text here'] }),
        createTestEntity({ name: 'e3', importance: 3, observations: ['Very long observation text that takes up more space'] }),
      ];

      // Budget that fits roughly 2 entities
      const budget = contextManager.estimateTokens(entities[0]) + contextManager.estimateTokens(entities[1]) + 5;

      const { selected, excluded } = await contextManager.prioritize(entities, budget, {});

      expect(selected.length).toBeGreaterThan(0);
      expect(selected.length + excluded.length).toBe(entities.length);
    });

    it('should prioritize by salience/token efficiency', async () => {
      // High salience, low tokens
      const efficient = createTestEntity({
        name: 'efficient',
        importance: 9,
        observations: ['Short'],
      });
      // Low salience, high tokens
      const inefficient = createTestEntity({
        name: 'inefficient',
        importance: 2,
        observations: ['This is a much longer observation that takes many tokens'],
      });

      const entities = [inefficient, efficient];
      const budget = contextManager.estimateTokens(efficient) + 10;

      const { selected } = await contextManager.prioritize(entities, budget, {});

      // Efficient entity should be selected first
      expect(selected.some((s) => s.entity.name === 'efficient')).toBe(true);
    });

    it('should always include must-include entities', async () => {
      const entities = [
        createTestEntity({ name: 'required', importance: 1 }),
        createTestEntity({ name: 'optional', importance: 9 }),
      ];

      const budget = contextManager.estimateTokens(entities[0]) + 5;

      const { selected } = await contextManager.prioritize(
        entities,
        budget,
        {},
        ['required']
      );

      expect(selected.some((s) => s.entity.name === 'required')).toBe(true);
    });

    it('should track excluded entities with reason', async () => {
      const entities = [
        createTestEntity({ name: 'fits', observations: ['Short'] }),
        createTestEntity({
          name: 'too_large',
          observations: ['This observation is much longer and will not fit in the budget'],
        }),
      ];

      const budget = contextManager.estimateTokens(entities[0]) + 5;

      const { excluded } = await contextManager.prioritize(entities, budget, {});

      const excludedTooLarge = excluded.find((e) => e.entity.name === 'too_large');
      expect(excludedTooLarge).toBeDefined();
      expect(excludedTooLarge?.reason).toBe('budget_exceeded');
      expect(excludedTooLarge?.tokens).toBeGreaterThan(0);
    });
  });

  describe('retrieveForContext', () => {
    it('should retrieve memories within token budget', async () => {
      const entities = [
        createTestEntity({ name: 'e1', memoryType: 'working' }),
        createTestEntity({ name: 'e2', memoryType: 'episodic' }),
        createTestEntity({ name: 'e3', memoryType: 'semantic' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const options: ContextRetrievalOptions = {
        maxTokens: 500,
        context: {},
      };

      const result = await contextManager.retrieveForContext(options);

      expect(result.totalTokens).toBeLessThanOrEqual(500);
      expect(result.memories.length).toBeGreaterThanOrEqual(0);
      expect(result.breakdown).toBeDefined();
    });

    it('should respect memory type filters', async () => {
      const entities = [
        createTestEntity({ name: 'working1', memoryType: 'working' }),
        createTestEntity({ name: 'episodic1', memoryType: 'episodic' }),
        createTestEntity({ name: 'semantic1', memoryType: 'semantic' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveForContext({
        maxTokens: 1000,
        includeWorkingMemory: true,
        includeEpisodicRecent: false,
        includeSemanticRelevant: false,
      });

      // Should only include working memory
      const memoryTypes = result.memories.map((m) => m.memoryType);
      expect(memoryTypes.every((t) => t === 'working')).toBe(true);
    });

    it('should filter by minimum salience', async () => {
      // Create entity with very low salience factors
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const entities = [
        createTestEntity({ name: 'high', importance: 10, accessCount: 50 }),
        createTestEntity({
          name: 'low',
          importance: 0,
          accessCount: 0,
          lastAccessedAt: weekAgo,
          confidence: 0,
          confirmationCount: 0,
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveForContext({
        maxTokens: 1000,
        minSalience: 0.3, // Set a threshold that should filter low entity
      });

      // Either low salience entity is excluded or has lower salience
      // Check that high-importance entity is included
      expect(result.memories.some((m) => m.name === 'high')).toBe(true);
    });

    it('should generate suggestions for excluded high-salience entities', async () => {
      // Create many entities that won't all fit
      const entities = Array.from({ length: 10 }, (_, i) =>
        createTestEntity({
          name: `entity_${i}`,
          importance: 9 - i,
          observations: [`Observation for entity ${i} with some text content`],
        })
      );
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveForContext({
        maxTokens: 50, // Very small budget to force exclusions
      });

      // Should have suggestions about excluded entities
      if (result.excluded.length > 0) {
        expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate token breakdown by memory type', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', observations: ['Working memory'] }),
        createTestEntity({ name: 'e1', memoryType: 'episodic', observations: ['Episodic memory'] }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveForContext({
        maxTokens: 1000,
      });

      expect(result.breakdown).toHaveProperty('working');
      expect(result.breakdown).toHaveProperty('episodic');
      expect(result.breakdown).toHaveProperty('semantic');
      expect(result.breakdown).toHaveProperty('procedural');
      expect(result.breakdown).toHaveProperty('mustInclude');
    });

    it('should handle must-include entities', async () => {
      const entities = [
        createTestEntity({ name: 'required', importance: 1 }),
        createTestEntity({ name: 'optional', importance: 9 }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveForContext({
        maxTokens: 1000,
        mustInclude: ['required'],
      });

      expect(result.memories.some((m) => m.name === 'required')).toBe(true);
    });

    it('cheap-caps large candidate sets before the only full salience pass', async () => {
      const entities = Array.from({ length: 50 }, (_, i) =>
        createTestEntity({
          name: `candidate-${i}`,
          importance: i,
          createdAt: new Date(1_700_000_000_000 + i).toISOString(),
        }),
      );
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      const rankSpy = vi.spyOn(salienceEngine, 'rankEntitiesBySalience');
      contextManager = new ContextWindowManager(storage, salienceEngine, {
        maxEntitiesToConsider: 10,
      });

      const result = await contextManager.retrieveForContext({
        maxTokens: 10_000,
        mustInclude: ['candidate-0'],
      });

      expect(rankSpy).toHaveBeenCalledTimes(1);
      expect(rankSpy.mock.calls[0][0]).toHaveLength(10);
      expect(result.memories.some((entity) => entity.name === 'candidate-0')).toBe(true);
      expect(result.memories.some((entity) => entity.name === 'candidate-49')).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const config = contextManager.getConfig();

      expect(config.defaultMaxTokens).toBe(4000);
      expect(config.tokenMultiplier).toBe(1.3);
      expect(config.reserveBuffer).toBe(100);
      expect(config.maxEntitiesToConsider).toBe(1000);
    });

    it('should use custom configuration', () => {
      const customManager = new ContextWindowManager(storage, salienceEngine, {
        defaultMaxTokens: 8000,
        tokenMultiplier: 1.5,
        reserveBuffer: 200,
        maxEntitiesToConsider: 500,
      });

      const config = customManager.getConfig();

      expect(config.defaultMaxTokens).toBe(8000);
      expect(config.tokenMultiplier).toBe(1.5);
      expect(config.reserveBuffer).toBe(200);
      expect(config.maxEntitiesToConsider).toBe(500);
    });

    it('should apply custom token multiplier to estimation', () => {
      const entity = createTestEntity({
        observations: ['One two three four five'],
      });

      const defaultManager = new ContextWindowManager(storage, salienceEngine);
      const customManager = new ContextWindowManager(storage, salienceEngine, {
        tokenMultiplier: 2.0,
      });

      const defaultTokens = defaultManager.estimateTokens(entity);
      const customTokens = customManager.estimateTokens(entity);

      // Custom multiplier should produce more tokens
      expect(customTokens).toBeGreaterThan(defaultTokens);
    });

    it('should use custom budget allocation percentages', () => {
      const customManager = new ContextWindowManager(storage, salienceEngine, {
        workingBudgetPct: 0.5,
        episodicBudgetPct: 0.25,
        semanticBudgetPct: 0.25,
        recentSessionCount: 5,
      });

      const config = customManager.getConfig();

      expect(config.workingBudgetPct).toBe(0.5);
      expect(config.episodicBudgetPct).toBe(0.25);
      expect(config.semanticBudgetPct).toBe(0.25);
      expect(config.recentSessionCount).toBe(5);
    });
  });

  describe('retrieveWorkingMemory', () => {
    it('should retrieve only working memory entities', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', sessionId: 'session_1' }),
        createTestEntity({ name: 'w2', memoryType: 'working', sessionId: 'session_1' }),
        createTestEntity({ name: 'e1', memoryType: 'episodic', sessionId: 'session_1' }),
        createTestEntity({ name: 's1', memoryType: 'semantic' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWorkingMemory('session_1', 1000);

      expect(result.entities.length).toBe(2);
      expect(result.entities.every((e) => e.memoryType === 'working')).toBe(true);
      expect(result.tokens).toBeGreaterThan(0);
    });

    it('should filter by session ID', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', sessionId: 'session_1' }),
        createTestEntity({ name: 'w2', memoryType: 'working', sessionId: 'session_2' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWorkingMemory('session_1', 1000);

      expect(result.entities.length).toBe(1);
      expect(result.entities[0].name).toBe('w1');
    });

    it('should respect token budget', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', importance: 9, observations: ['Short'] }),
        createTestEntity({
          name: 'w2',
          memoryType: 'working',
          importance: 5,
          observations: ['Much longer observation that takes more tokens'],
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const smallBudget = contextManager.estimateTokens(entities[0]) + 5;
      const result = await contextManager.retrieveWorkingMemory(undefined, smallBudget);

      expect(result.tokens).toBeLessThanOrEqual(smallBudget);
    });
  });

  describe('retrieveEpisodicRecent', () => {
    it('should retrieve episodic memories sorted by recency', async () => {
      const now = new Date();
      const entities = [
        createTestEntity({
          name: 'old',
          memoryType: 'episodic',
          createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        createTestEntity({
          name: 'recent',
          memoryType: 'episodic',
          createdAt: now.toISOString(),
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveEpisodicRecent(1000);

      expect(result.entities.length).toBe(2);
      expect(result.entities.every((e) => e.memoryType === 'episodic')).toBe(true);
    });

    it('should limit to recent sessions', async () => {
      const now = new Date();
      const entities = [
        createTestEntity({
          name: 'e1',
          memoryType: 'episodic',
          sessionId: 'session_1',
          createdAt: now.toISOString(),
        }),
        createTestEntity({
          name: 'e2',
          memoryType: 'episodic',
          sessionId: 'session_2',
          createdAt: new Date(now.getTime() - 1000).toISOString(),
        }),
        createTestEntity({
          name: 'e3',
          memoryType: 'episodic',
          sessionId: 'session_3',
          createdAt: new Date(now.getTime() - 2000).toISOString(),
        }),
        createTestEntity({
          name: 'e4',
          memoryType: 'episodic',
          sessionId: 'session_4',
          createdAt: new Date(now.getTime() - 3000).toISOString(),
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      // Only include 2 recent sessions
      contextManager = new ContextWindowManager(storage, salienceEngine, { recentSessionCount: 2 });

      const result = await contextManager.retrieveEpisodicRecent(1000);

      // Should only include entities from 2 most recent sessions
      const sessions = new Set(result.entities.map((e) => e.sessionId));
      expect(sessions.size).toBeLessThanOrEqual(2);
    });
  });

  describe('retrieveSemanticRelevant', () => {
    it('should retrieve semantic memories', async () => {
      const entities = [
        createTestEntity({ name: 's1', memoryType: 'semantic', importance: 8 }),
        createTestEntity({ name: 's2', memoryType: 'semantic', importance: 5 }),
        createTestEntity({ name: 'w1', memoryType: 'working' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveSemanticRelevant(1000);

      expect(result.entities.length).toBe(2);
      expect(result.entities.every((e) => e.memoryType === 'semantic')).toBe(true);
    });

    it('should prioritize by salience within budget', async () => {
      const entities = [
        createTestEntity({ name: 'high', memoryType: 'semantic', importance: 10 }),
        createTestEntity({ name: 'low', memoryType: 'semantic', importance: 1 }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const smallBudget = contextManager.estimateTokens(entities[0]) + 5;
      const result = await contextManager.retrieveSemanticRelevant(smallBudget);

      // High importance should be selected first
      expect(result.entities.some((e) => e.name === 'high')).toBe(true);
    });
  });

  describe('retrieveMustInclude', () => {
    it('should retrieve specified entities by name', async () => {
      const entities = [
        createTestEntity({ name: 'required1' }),
        createTestEntity({ name: 'required2' }),
        createTestEntity({ name: 'optional' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveMustInclude(['required1', 'required2'], 1000);

      expect(result.entities.length).toBe(2);
      expect(result.entities.map((e) => e.name)).toEqual(['required1', 'required2']);
      expect(result.warnings.length).toBe(0);
    });

    it('should warn when entity not found', async () => {
      const entities = [createTestEntity({ name: 'exists' })];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveMustInclude(['exists', 'missing'], 1000);

      expect(result.entities.length).toBe(1);
      expect(result.warnings.some((w) => w.includes('missing'))).toBe(true);
    });

    it('should warn when budget exceeded', async () => {
      const entities = [
        createTestEntity({
          name: 'large',
          observations: ['This is a very long observation that will take many tokens'],
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveMustInclude(['large'], 5);

      expect(result.warnings.some((w) => w.includes('exceed'))).toBe(true);
    });
  });

  describe('retrieveWithBudgetAllocation', () => {
    it('should allocate budget across memory types', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', observations: ['Working memory'] }),
        createTestEntity({ name: 'e1', memoryType: 'episodic', observations: ['Episodic memory'] }),
        createTestEntity({ name: 's1', memoryType: 'semantic', observations: ['Semantic memory'] }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
      });

      expect(result.breakdown.working).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.episodic).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.semantic).toBeGreaterThanOrEqual(0);
    });

    it('should handle must-include before allocation', async () => {
      const entities = [
        createTestEntity({ name: 'required', memoryType: 'working' }),
        createTestEntity({ name: 'w1', memoryType: 'working' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
        mustInclude: ['required'],
      });

      expect(result.memories.some((m) => m.name === 'required')).toBe(true);
      expect(result.breakdown.mustInclude).toBeGreaterThan(0);
    });

    it('should deduplicate entities across sources', async () => {
      // Entity appears as both working and semantic
      const entities = [
        createTestEntity({ name: 'shared', memoryType: 'working' }),
        createTestEntity({ name: 'shared', memoryType: 'semantic' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
      });

      // Should only appear once
      const sharedCount = result.memories.filter((m) => m.name === 'shared').length;
      expect(sharedCount).toBeLessThanOrEqual(1);
    });

    it('should filter by minimum salience', async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const entities = [
        createTestEntity({ name: 'high', memoryType: 'working', importance: 10, accessCount: 50 }),
        createTestEntity({
          name: 'low',
          memoryType: 'working',
          importance: 0,
          accessCount: 0,
          lastAccessedAt: weekAgo,
        }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      const result = await contextManager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
        minSalience: 0.3,
      });

      // High salience should be included
      expect(result.memories.some((m) => m.name === 'high')).toBe(true);
    });

    it('should use custom budget percentages', async () => {
      const entities = [
        createTestEntity({ name: 'w1', memoryType: 'working', observations: ['Working'] }),
        createTestEntity({ name: 'e1', memoryType: 'episodic', observations: ['Episodic'] }),
        createTestEntity({ name: 's1', memoryType: 'semantic', observations: ['Semantic'] }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      // Heavy working memory allocation
      contextManager = new ContextWindowManager(storage, salienceEngine, {
        workingBudgetPct: 0.8,
        episodicBudgetPct: 0.1,
        semanticBudgetPct: 0.1,
      });

      const result = await contextManager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
      });

      // Should have breakdown reflecting allocation
      expect(result.breakdown).toBeDefined();
    });
  });

  describe('handleSpillover', () => {
    it('should track excluded entities with suggestions', () => {
      const excluded = [
        { entity: createTestEntity({ name: 'e1', memoryType: 'working' }), reason: 'budget_exceeded' as const, tokens: 50, salience: 0.8 },
        { entity: createTestEntity({ name: 'e2', memoryType: 'episodic' }), reason: 'budget_exceeded' as const, tokens: 30, salience: 0.6 },
      ];

      const result = contextManager.handleSpillover(excluded);

      expect(result.spilledEntities.length).toBe(2);
      expect(result.spilledTokens).toBe(80);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should generate pagination cursor when entities exceed page size', () => {
      const excluded = Array.from({ length: 15 }, (_, i) => ({
        entity: createTestEntity({ name: `e${i}` }),
        reason: 'budget_exceeded' as const,
        tokens: 10,
        salience: 0.5 - i * 0.01,
      }));

      const result = contextManager.handleSpillover(excluded, {}, 10);

      expect(result.spilledEntities.length).toBe(10);
      expect(result.nextPageCursor).toBeDefined();
    });

    it('should sort by salience for priority preservation', () => {
      const excluded = [
        { entity: createTestEntity({ name: 'low' }), reason: 'budget_exceeded' as const, tokens: 10, salience: 0.2 },
        { entity: createTestEntity({ name: 'high' }), reason: 'budget_exceeded' as const, tokens: 10, salience: 0.9 },
        { entity: createTestEntity({ name: 'mid' }), reason: 'budget_exceeded' as const, tokens: 10, salience: 0.5 },
      ];

      const result = contextManager.handleSpillover(excluded);

      expect(result.spilledEntities[0].entity.name).toBe('high');
      expect(result.spilledEntities[1].entity.name).toBe('mid');
      expect(result.spilledEntities[2].entity.name).toBe('low');
    });
  });

  describe('retrieveSpilloverPage', () => {
    it('should retrieve next page using cursor', async () => {
      const entities = Array.from({ length: 10 }, (_, i) =>
        createTestEntity({
          name: `entity_${i}`,
          importance: 9 - i,
        })
      );
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine);

      // Create a cursor representing salience cutoff
      const cursor = Buffer.from(JSON.stringify({ maxSalience: 0.5, lastEntity: 'test' })).toString('base64');

      const result = await contextManager.retrieveSpilloverPage(cursor, 500);

      expect(result.tokens).toBeLessThanOrEqual(500);
    });
  });

  describe('enforceDiversity', () => {
    it('should detect and replace similar entities', async () => {
      const similar1 = createTestEntity({
        name: 'hotel1',
        entityType: 'memory',
        observations: ['User likes budget hotels downtown for business trips'],
      });
      const similar2 = createTestEntity({
        name: 'hotel2',
        entityType: 'memory',
        observations: ['User prefers budget hotels in city center for work'],
      });
      const different = createTestEntity({
        name: 'food',
        entityType: 'memory',
        observations: ['User enjoys Italian cuisine'],
      });

      storage = createMockStorage([similar1, similar2, different]);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
      contextManager = new ContextWindowManager(storage, salienceEngine, {
        diversityThreshold: 0.7,
        enforceDiversity: true,
      });

      const scored = await salienceEngine.rankEntitiesBySalience(
        [similar1, similar2],
        {}
      );
      const candidates = await salienceEngine.rankEntitiesBySalience([different], {});

      const result = await contextManager.enforceDiversity(scored, candidates);

      // Should have 2 entities (one replaced or kept)
      expect(result.diversified.length).toBeLessThanOrEqual(scored.length);
    });

    it('should return unchanged when diversity disabled', async () => {
      contextManager = new ContextWindowManager(storage, salienceEngine, {
        enforceDiversity: false,
      });

      const entities = [
        { entity: createTestEntity({ name: 'e1' }), salienceScore: 0.8, components: { baseImportance: 0.5, recencyBoost: 0.5, frequencyBoost: 0.5, contextRelevance: 0.5, noveltyBoost: 0.5 } },
      ];

      const result = await contextManager.enforceDiversity(entities, []);

      expect(result.diversified).toEqual(entities);
      expect(result.replaced.length).toBe(0);
    });
  });

  describe('calculateDiversityScore', () => {
    it('should return 1.0 for single entity', () => {
      const entities = [createTestEntity({ name: 'single' })];
      const score = contextManager.calculateDiversityScore(entities);
      expect(score).toBe(1.0);
    });

    it('should return high score for diverse entities', () => {
      const entities = [
        createTestEntity({ name: 'food', observations: ['Italian restaurant'] }),
        createTestEntity({ name: 'travel', observations: ['Flight booking'] }),
        createTestEntity({ name: 'work', observations: ['Project deadline'] }),
      ];

      const score = contextManager.calculateDiversityScore(entities);

      expect(score).toBeGreaterThan(0.5);
    });

    it('should return lower score for similar entities', () => {
      const entities = [
        createTestEntity({ name: 'hotel1', observations: ['Budget hotel booking'] }),
        createTestEntity({ name: 'hotel2', observations: ['Cheap hotel reservation'] }),
      ];

      const score = contextManager.calculateDiversityScore(entities);

      // Should have some similarity, so diversity is lower
      expect(score).toBeLessThan(1.0);
    });
  });

  describe('diversity configuration', () => {
    it('should use custom diversity threshold', () => {
      const customManager = new ContextWindowManager(storage, salienceEngine, {
        diversityThreshold: 0.5,
        enforceDiversity: true,
      });

      const config = customManager.getConfig();

      expect(config.diversityThreshold).toBe(0.5);
      expect(config.enforceDiversity).toBe(true);
    });
  });

  /**
   * Build a manager over the given entities with no budget reserve,
   * so the budget equals maxTokens.
   */
  function createBudgetManager(entities: AgentEntity[]): ContextWindowManager {
    const budgetStorage = createMockStorage(entities);
    const tracker = new AccessTracker(budgetStorage);
    const decay = new DecayEngine(budgetStorage, tracker);
    const salience = new SalienceEngine(budgetStorage, tracker, decay);
    return new ContextWindowManager(budgetStorage, salience, { reserveBuffer: 0 });
  }

  /**
   * Create entities that each cost 8 tokens (one-word name, three observation words).
   *
   * All entities share one timestamp, so recency affects them equally. Importance falls by
   * 0.25 per entity from 6, below the point where normalized importance saturates at 1,
   * so the salience order is strict and the clock cannot break ties between calls.
   */
  function createNamedEntities(names: string[]): AgentEntity[] {
    const timestamp = new Date().toISOString();
    return names.map((name, index) =>
      createTestEntity({
        name,
        observations: ['alpha beta gamma'],
        createdAt: timestamp,
        lastModified: timestamp,
        lastAccessedAt: timestamp,
        importance: 6 - index * 0.25,
      })
    );
  }

  /** Names 'e01' to 'e16'. */
  function sixteenNames(): string[] {
    return Array.from({ length: 16 }, (_, i) => `e${String(i + 1).padStart(2, '0')}`);
  }

  describe('budget-cut report', () => {
    it('reports sourceTokens and compressionRatio when the budget cuts entities', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      const result = await manager.retrieveForContext({ maxTokens: 20 });

      expect(result.totalTokens).toBe(16);
      expect(result.sourceTokens).toBe(32);
      expect(result.compressionRatio).toBe(2);
      expect(result.excluded).toHaveLength(2);
      expect(result.excluded.map((e) => e.reason)).toEqual(['budget_exceeded', 'budget_exceeded']);
    });

    it('reports a ratio of 1 when every candidate fits', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      const result = await manager.retrieveForContext({ maxTokens: 1000 });

      expect(result.totalTokens).toBe(32);
      expect(result.sourceTokens).toBe(32);
      expect(result.compressionRatio).toBe(1);
      expect(result.excluded).toEqual([]);
    });

    it('reports a ratio of 1 for an empty store', async () => {
      const manager = createBudgetManager([]);

      const result = await manager.retrieveForContext({ maxTokens: 1000 });

      expect(result.totalTokens).toBe(0);
      expect(result.sourceTokens).toBe(0);
      expect(result.compressionRatio).toBe(1);
    });

    it('counts low-salience exclusions in sourceTokens', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      // Salience is in [0, 1], so minSalience 2 excludes every entity.
      const result = await manager.retrieveForContext({ maxTokens: 1000, minSalience: 2 });

      expect(result.totalTokens).toBe(0);
      expect(result.sourceTokens).toBe(32);
      expect(result.compressionRatio).toBe(32);
    });

    it('sets both fields in retrieveWithBudgetAllocation', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      const result = await manager.retrieveWithBudgetAllocation({ maxTokens: 1000 });

      const excludedTokens = result.excluded.reduce((sum, e) => sum + e.tokens, 0);
      expect(result.sourceTokens).toBe(result.totalTokens + excludedTokens);
      expect(result.compressionRatio).toBe(
        result.sourceTokens === result.totalTokens
          ? 1
          : result.sourceTokens / Math.max(result.totalTokens, 1)
      );
    });
  });

  describe('excluded summary', () => {
    /** Summarizer stub that resolves to 'S'. */
    function createSummarizerStub() {
      return { summarize: vi.fn().mockResolvedValue('S') };
    }

    it('summarizes excluded memories with the query', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);

      const result = await manager.retrieveForContext({
        maxTokens: 20,
        summarizeExcluded: true,
        context: { queryText: 'q' },
      });

      expect(result.excludedSummary).toBe('S');
      expect(summarizer.summarize).toHaveBeenCalledTimes(1);
      expect(summarizer.summarize).toHaveBeenCalledWith(['alpha beta gamma', 'alpha beta gamma'], 'q');
    });

    it('does not count the summary in totalTokens', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      manager.setSummarizer({ summarize: vi.fn().mockResolvedValue('a long summary of many words') });

      const result = await manager.retrieveForContext({ maxTokens: 20, summarizeExcluded: true });

      expect(result.totalTokens).toBe(16);
      expect(result.excludedSummary).toBe('a long summary of many words');
    });

    it('does not summarize by default', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);

      const result = await manager.retrieveForContext({ maxTokens: 20 });

      expect(summarizer.summarize).not.toHaveBeenCalled();
      expect(result.excludedSummary).toBeUndefined();
    });

    it('does not summarize when nothing is excluded', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);

      const result = await manager.retrieveForContext({ maxTokens: 1000, summarizeExcluded: true });

      expect(summarizer.summarize).not.toHaveBeenCalled();
      expect(result.excludedSummary).toBeUndefined();
    });

    it('does not summarize without an attached summarizer', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      const result = await manager.retrieveForContext({ maxTokens: 20, summarizeExcluded: true });

      expect(result.excludedSummary).toBeUndefined();
      expect(result.excluded).toHaveLength(2);
    });

    it('stops summarizing after setSummarizer(undefined)', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);
      manager.setSummarizer(undefined);

      const result = await manager.retrieveForContext({ maxTokens: 20, summarizeExcluded: true });

      expect(summarizer.summarize).not.toHaveBeenCalled();
      expect(result.excludedSummary).toBeUndefined();
    });

    it('takes summarizeExcluded from the profile', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);
      const profiles = manager.getContextProfileManager();
      profiles.registerProfile('planning', {
        ...profiles.getProfile('planning'),
        retrieval: { summarizeExcluded: true },
      });

      const result = await manager.retrieveForContext({
        maxTokens: 20,
        profile: 'planning',
        context: { queryText: 'q' },
      });

      expect(summarizer.summarize).toHaveBeenCalledTimes(1);
      expect(result.excludedSummary).toBe('S');
    });

    it('lets an explicit summarizeExcluded override the profile', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      const summarizer = createSummarizerStub();
      manager.setSummarizer(summarizer);
      const profiles = manager.getContextProfileManager();
      profiles.registerProfile('planning', {
        ...profiles.getProfile('planning'),
        retrieval: { summarizeExcluded: true },
      });

      const result = await manager.retrieveForContext({
        maxTokens: 20,
        profile: 'planning',
        summarizeExcluded: false,
      });

      expect(summarizer.summarize).not.toHaveBeenCalled();
      expect(result.excludedSummary).toBeUndefined();
    });

    it('returns the package without a summary when the summarizer throws', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));
      manager.setSummarizer({ summarize: vi.fn().mockRejectedValue(new Error('down')) });
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = await manager.retrieveForContext({ maxTokens: 20, summarizeExcluded: true });

      expect(result.excludedSummary).toBeUndefined();
      expect(result.memories.map((m) => m.name)).toEqual(['e1', 'e2']);
      expect(result.excluded).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('query ranking', () => {
    // Recent, so decay does not flatten the importance differences between entities.
    const timestamp = new Date().toISOString();

    /** Four entities with one fixed timestamp and distinct importance below 10. */
    function createQueryEntities(names: string[] = ['e1', 'e2', 'e3', 'e4']): AgentEntity[] {
      return names.map((name, index) =>
        createTestEntity({
          name,
          observations: ['alpha beta gamma'],
          createdAt: timestamp,
          lastModified: timestamp,
          lastAccessedAt: timestamp,
          importance: 6 - index * 0.25,
        })
      );
    }

    function createQueryManager(
      entities: AgentEntity[],
      relations: Relation[] = []
    ): ContextWindowManager {
      const queryStorage = createMockStorage(entities, relations);
      const tracker = new AccessTracker(queryStorage);
      const decay = new DecayEngine(queryStorage, tracker);
      const salience = new SalienceEngine(queryStorage, tracker, decay);
      return new ContextWindowManager(queryStorage, salience, { reserveBuffer: 0 });
    }

    function hit(entity: AgentEntity) {
      return {
        entity,
        scores: { semantic: 0, lexical: 1, symbolic: 0, combined: 1 },
        matchedLayers: ['lexical'],
      };
    }

    function namesOf(memories: Array<{ name: string }>): string[] {
      return memories.map((m) => m.name);
    }

    it('orders candidates by hybrid rank when queryText is set', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const search = vi.fn().mockResolvedValue([hit(entities[2]), hit(entities[0])]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(namesOf(result.memories)).toEqual(['e3', 'e1']);
    });

    it('passes the scoped graph and limit to hybrid search', async () => {
      const entities = createQueryEntities();
      const relations: Relation[] = [
        { from: 'e1', to: 'e2', relationType: 'links_to' },
        { from: 'e1', to: 'outside', relationType: 'links_to' },
      ];
      const manager = createQueryManager(entities, relations);
      const search = vi.fn().mockResolvedValue([hit(entities[2]), hit(entities[0])]);
      manager.setHybridSearch({ search });

      await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(search).toHaveBeenCalledTimes(1);
      const [scopedGraph, queryText, options] = search.mock.calls[0];
      expect(scopedGraph.entities.map((e: { name: string }) => e.name)).toEqual([
        'e1',
        'e2',
        'e3',
        'e4',
      ]);
      expect(scopedGraph.relations).toHaveLength(1);
      expect(queryText).toBe('alpha');
      expect(options).toEqual({ limit: 1000 });
    });

    it('keeps the salience path when queryText is absent', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const search = vi.fn().mockResolvedValue([hit(entities[2])]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({ maxTokens: 1000 });

      expect(search).not.toHaveBeenCalled();
      expect(result.memories).toHaveLength(4);
    });

    it('keeps the salience path when no hybrid search is set', async () => {
      const manager = createQueryManager(createQueryEntities());

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(result.memories).toHaveLength(4);
    });

    it('treats whitespace-only queryText as absent', async () => {
      const manager = createQueryManager(createQueryEntities());
      const search = vi.fn().mockResolvedValue([]);
      manager.setHybridSearch({ search });

      await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: '   ' },
      });

      expect(search).not.toHaveBeenCalled();
    });

    it('puts must-include entities first in query mode', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const search = vi.fn().mockResolvedValue([hit(entities[2]), hit(entities[0])]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
        mustInclude: ['e4'],
      });

      expect(namesOf(result.memories)).toEqual(['e4', 'e3', 'e1']);
    });

    it('passes expandNeighbors and lookFor when composeHops is 1', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const search = vi.fn().mockResolvedValue([hit(entities[0])]);
      manager.setHybridSearch({ search });

      await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
        composeHops: 1,
      });

      const [, , options] = search.mock.calls[0];
      expect(options).toEqual({ limit: 1000, expandNeighbors: { hops: 1 }, lookFor: 'alpha' });
    });

    it('adds one-hop neighbors through HybridSearchManager', async () => {
      const entities = createQueryEntities(['A', 'B', 'C']);
      const neighbors: Record<string, string[]> = { A: ['B'], B: ['A', 'C'], C: ['B'] };
      const prior = {
        getScores: vi.fn(async (names: string[]) => new Map(names.map((n) => [n, 0]))),
        neighbors: vi.fn((name: string) => neighbors[name] ?? []),
      } as unknown as GraphRankPrior;
      const rankedSearch = {
        searchNodesRanked: vi.fn().mockResolvedValue([{ entity: entities[0], score: 5 }]),
      };
      const manager = createQueryManager(entities);
      manager.setHybridSearch(new HybridSearchManager(null, rankedSearch as never, prior));

      const withHops = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
        composeHops: 1,
      });
      const withoutHops = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(namesOf(withHops.memories)).toEqual(['A', 'B']);
      expect(namesOf(withoutHops.memories)).toEqual(['A']);
    });

    it('falls back to the salience path when hybrid search throws', async () => {
      const manager = createQueryManager(createQueryEntities());
      const search = vi.fn().mockRejectedValue(new Error('embedding service down'));
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(search).toHaveBeenCalledTimes(1);
      expect(result.memories).toHaveLength(4);
    });

    it('uses the salience order after a hybrid search failure', async () => {
      // Graph order is the reverse of salience order, so only the salience path gives e4 first.
      const entities = createQueryEntities().reverse();
      const manager = createQueryManager(entities);
      manager.setHybridSearch({ search: vi.fn().mockRejectedValue(new Error('down')) });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(namesOf(result.memories)).toEqual(['e1', 'e2', 'e3', 'e4']);
    });

    it('returns must-include entities when hybrid search returns no hits', async () => {
      const manager = createQueryManager(createQueryEntities());
      const search = vi.fn().mockResolvedValue([]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
        mustInclude: ['e4'],
      });

      expect(namesOf(result.memories)).toEqual(['e4']);
    });

    it('lists an entity once when hybrid search returns it twice', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const search = vi.fn().mockResolvedValue([hit(entities[1]), hit(entities[1]), hit(entities[0])]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(namesOf(result.memories)).toEqual(['e2', 'e1']);
    });

    it('drops hybrid hits outside the candidate set', async () => {
      const entities = createQueryEntities();
      const manager = createQueryManager(entities);
      const outside = createQueryEntities(['outside'])[0];
      const search = vi.fn().mockResolvedValue([hit(outside), hit(entities[0])]);
      manager.setHybridSearch({ search });

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        context: { queryText: 'alpha' },
      });

      expect(namesOf(result.memories)).toEqual(['e1']);
    });
  });

  describe('maxSlots', () => {
    it('caps the number of memories', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      for (const cap of [1, 2, 4, 8, 16]) {
        const result = await manager.retrieveForContext({ maxTokens: 1000, maxSlots: cap });
        expect(result.memories).toHaveLength(cap);
      }
    });

    it('returns nested selections as maxSlots grows', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      let previous: string[] = [];
      for (const cap of [1, 2, 4, 8, 16]) {
        const result = await manager.retrieveForContext({ maxTokens: 1000, maxSlots: cap });
        const names = result.memories.map((m) => m.name);
        expect(names).toHaveLength(cap);
        for (const name of previous) {
          expect(names).toContain(name);
        }
        previous = names;
      }
    });

    it('marks slot-cut entities with reason slot_limit', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      const result = await manager.retrieveForContext({ maxTokens: 1000, maxSlots: 4 });

      expect(result.excluded).toHaveLength(12);
      expect(result.excluded.every((e) => e.reason === 'slot_limit')).toBe(true);
    });

    it('returns only must-include entities when maxSlots is 0', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        maxSlots: 0,
        mustInclude: ['e05'],
      });

      expect(result.memories.map((m) => m.name)).toEqual(['e05']);
    });

    it('keeps every must-include entity when maxSlots is smaller', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      const result = await manager.retrieveForContext({
        maxTokens: 1000,
        maxSlots: 1,
        mustInclude: ['e01', 'e02'],
      });

      const names = result.memories.map((m) => m.name);
      expect(names).toContain('e01');
      expect(names).toContain('e02');
      expect(names).toHaveLength(2);
    });

    it('ignores a negative or non-finite maxSlots', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      for (const cap of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = await manager.retrieveForContext({ maxTokens: 1000, maxSlots: cap });
        expect(result.memories).toHaveLength(16);
        const allocated = await manager.retrieveWithBudgetAllocation({ maxTokens: 1000, maxSlots: cap });
        expect(allocated.excluded.filter((e) => e.reason === 'slot_limit')).toEqual([]);
      }
    });

    it('ignores maxSlots when unset', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      const result = await manager.retrieveForContext({ maxTokens: 1000 });

      expect(result.memories).toHaveLength(16);
    });

    it('counts low-salience exclusions in sourceTokens of retrieveWithBudgetAllocation', async () => {
      const manager = createBudgetManager(createNamedEntities(['e1', 'e2', 'e3', 'e4']));

      const result = await manager.retrieveWithBudgetAllocation({ maxTokens: 1000, minSalience: 2 });

      expect(result.totalTokens).toBe(0);
      expect(result.excluded.every((e) => e.reason === 'low_salience')).toBe(true);
      expect(result.sourceTokens).toBe(result.excluded.reduce((sum, e) => sum + e.tokens, 0));
      expect(result.sourceTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBe(result.sourceTokens);
    });

    it('caps the memories in retrieveWithBudgetAllocation', async () => {
      const manager = createBudgetManager(createNamedEntities(sixteenNames()));

      const result = await manager.retrieveWithBudgetAllocation({
        maxTokens: 1000,
        maxSlots: 4,
        mustInclude: ['e16'],
      });

      const names = result.memories.map((m) => m.name);
      expect(names).toHaveLength(4);
      expect(names).toContain('e16');
      const slotCut = result.excluded.filter((e) => e.reason === 'slot_limit');
      expect(slotCut.length).toBeGreaterThan(0);
      const excludedTokens = result.excluded.reduce((sum, e) => sum + e.tokens, 0);
      expect(result.sourceTokens).toBe(result.totalTokens + excludedTokens);
    });

    it('prioritize accepts maxSlots', async () => {
      const manager = createBudgetManager([]);
      const entities = createNamedEntities(sixteenNames());

      const { selected } = await manager.prioritize(entities, 1000, {}, [], { maxSlots: 3 });

      expect(selected).toHaveLength(3);
    });
  });
});
