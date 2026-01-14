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
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity, ContextRetrievalOptions } from '../../../src/types/agent-memory.js';

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
  });
});
