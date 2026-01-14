/**
 * SalienceEngine Unit Tests
 *
 * Tests for context-aware memory relevance scoring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalienceEngine } from '../../../src/agent/SalienceEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import type { IGraphStorage, Entity, Relation } from '../../../src/types/types.js';
import type { AgentEntity, SalienceContext } from '../../../src/types/agent-memory.js';

/**
 * Create a mock storage with entities.
 */
function createMockStorage(entities: Entity[] = [], relations: Relation[] = []): IGraphStorage {
  const graph = { entities, relations };
  return {
    loadGraph: vi.fn().mockResolvedValue(graph),
    saveGraph: vi.fn().mockResolvedValue(undefined),
    getEntityByName: vi.fn((name: string) => entities.find(e => e.name === name)),
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

describe('SalienceEngine', () => {
  let storage: IGraphStorage;
  let accessTracker: AccessTracker;
  let decayEngine: DecayEngine;
  let salienceEngine: SalienceEngine;

  beforeEach(() => {
    storage = createMockStorage();
    accessTracker = new AccessTracker(storage);
    decayEngine = new DecayEngine(storage, accessTracker);
    salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);
  });

  describe('calculateSalience', () => {
    it('should calculate salience with all components', async () => {
      const entity = createTestEntity();
      const context: SalienceContext = {};

      const result = await salienceEngine.calculateSalience(entity, context);

      expect(result.entity).toBe(entity);
      expect(result.salienceScore).toBeGreaterThanOrEqual(0);
      expect(result.salienceScore).toBeLessThanOrEqual(1);
      expect(result.components).toHaveProperty('baseImportance');
      expect(result.components).toHaveProperty('recencyBoost');
      expect(result.components).toHaveProperty('frequencyBoost');
      expect(result.components).toHaveProperty('contextRelevance');
      expect(result.components).toHaveProperty('noveltyBoost');
    });

    it('should return higher salience for higher importance', async () => {
      const lowImportance = createTestEntity({ name: 'low', importance: 2 });
      const highImportance = createTestEntity({ name: 'high', importance: 9 });
      const context: SalienceContext = {};

      const lowResult = await salienceEngine.calculateSalience(lowImportance, context);
      const highResult = await salienceEngine.calculateSalience(highImportance, context);

      expect(highResult.components.baseImportance).toBeGreaterThan(
        lowResult.components.baseImportance
      );
    });

    it('should return higher salience for recently accessed entities', async () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const recent = createTestEntity({ name: 'recent', lastAccessedAt: hourAgo });
      const old = createTestEntity({ name: 'old', lastAccessedAt: weekAgo });
      const context: SalienceContext = {};

      const recentResult = await salienceEngine.calculateSalience(recent, context);
      const oldResult = await salienceEngine.calculateSalience(old, context);

      expect(recentResult.components.recencyBoost).toBeGreaterThan(
        oldResult.components.recencyBoost
      );
    });

    it('should boost context relevance for matching task', async () => {
      const taskEntity = createTestEntity({ name: 'task_match', taskId: 'booking' });
      const otherEntity = createTestEntity({ name: 'other', taskId: 'other' });
      const context: SalienceContext = { currentTask: 'booking' };

      const taskResult = await salienceEngine.calculateSalience(taskEntity, context);
      const otherResult = await salienceEngine.calculateSalience(otherEntity, context);

      expect(taskResult.components.contextRelevance).toBeGreaterThan(
        otherResult.components.contextRelevance
      );
    });

    it('should boost context relevance for matching session', async () => {
      const sessionEntity = createTestEntity({ name: 'session_match', sessionId: 'session_123' });
      const otherEntity = createTestEntity({ name: 'other', sessionId: 'other' });
      const context: SalienceContext = { currentSession: 'session_123' };

      const sessionResult = await salienceEngine.calculateSalience(sessionEntity, context);
      const otherResult = await salienceEngine.calculateSalience(otherEntity, context);

      expect(sessionResult.components.contextRelevance).toBeGreaterThan(
        otherResult.components.contextRelevance
      );
    });

    it('should boost context relevance for query text match in name', async () => {
      const matchEntity = createTestEntity({
        name: 'hotel_booking_preferences',
        observations: ['User searches for hotel bookings'],
      });
      const noMatchEntity = createTestEntity({
        name: 'flight_booking_preferences',
        observations: ['User searches for flight bookings'],
      });
      // Use longer query for better TF-IDF similarity
      const context: SalienceContext = { queryText: 'hotel booking' };

      const matchResult = await salienceEngine.calculateSalience(matchEntity, context);
      const noMatchResult = await salienceEngine.calculateSalience(noMatchEntity, context);

      expect(matchResult.components.contextRelevance).toBeGreaterThan(
        noMatchResult.components.contextRelevance
      );
    });

    it('should boost context relevance for query text match in observations', async () => {
      const matchEntity = createTestEntity({
        name: 'preference_1',
        observations: ['User prefers budget hotels near downtown area'],
      });
      const noMatchEntity = createTestEntity({
        name: 'preference_2',
        observations: ['User prefers quick direct flights to destination'],
      });
      // Use longer query for better TF-IDF similarity
      const context: SalienceContext = { queryText: 'budget hotels downtown' };

      const matchResult = await salienceEngine.calculateSalience(matchEntity, context);
      const noMatchResult = await salienceEngine.calculateSalience(noMatchEntity, context);

      expect(matchResult.components.contextRelevance).toBeGreaterThan(
        noMatchResult.components.contextRelevance
      );
    });
  });

  describe('rankEntitiesBySalience', () => {
    it('should rank entities by salience score descending', async () => {
      const entities: AgentEntity[] = [
        createTestEntity({ name: 'low', importance: 2 }),
        createTestEntity({ name: 'high', importance: 9 }),
        createTestEntity({ name: 'medium', importance: 5 }),
      ];
      const context: SalienceContext = {};

      const ranked = await salienceEngine.rankEntitiesBySalience(entities, context);

      expect(ranked.length).toBe(3);
      // Scores should be descending
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].salienceScore).toBeGreaterThanOrEqual(ranked[i].salienceScore);
      }
    });

    it('should return empty array for empty input', async () => {
      const context: SalienceContext = {};
      const ranked = await salienceEngine.rankEntitiesBySalience([], context);
      expect(ranked).toEqual([]);
    });
  });

  describe('getTopSalient', () => {
    it('should return top N entities by salience', async () => {
      const entities: AgentEntity[] = [
        createTestEntity({ name: 'e1', importance: 3 }),
        createTestEntity({ name: 'e2', importance: 8 }),
        createTestEntity({ name: 'e3', importance: 5 }),
        createTestEntity({ name: 'e4', importance: 9 }),
        createTestEntity({ name: 'e5', importance: 1 }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);

      const context: SalienceContext = {};
      const top = await salienceEngine.getTopSalient(context, 3);

      expect(top.length).toBe(3);
      // Verify descending order
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].salienceScore).toBeGreaterThanOrEqual(top[i].salienceScore);
      }
    });

    it('should return all entities if limit exceeds count', async () => {
      const entities: AgentEntity[] = [
        createTestEntity({ name: 'e1' }),
        createTestEntity({ name: 'e2' }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);

      const context: SalienceContext = {};
      const top = await salienceEngine.getTopSalient(context, 10);

      expect(top.length).toBe(2);
    });
  });

  describe('temporal focus', () => {
    it('should boost recency with recent temporal focus', async () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({ lastAccessedAt: hourAgo });

      const balancedResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'balanced',
      });
      const recentResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'recent',
      });

      // Recent focus should boost recency for recently accessed entities
      expect(recentResult.components.recencyBoost).toBeGreaterThan(
        balancedResult.components.recencyBoost
      );
    });

    it('should reduce recency with historical temporal focus', async () => {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({ lastAccessedAt: hourAgo });

      const balancedResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'balanced',
      });
      const historicalResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'historical',
      });

      // Historical focus should reduce recency boost
      expect(historicalResult.components.recencyBoost).toBeLessThan(
        balancedResult.components.recencyBoost
      );
    });

    it('should boost novelty with historical temporal focus', async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({ lastAccessedAt: weekAgo });

      const balancedResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'balanced',
      });
      const historicalResult = await salienceEngine.calculateSalience(entity, {
        temporalFocus: 'historical',
      });

      // Historical focus should boost novelty for older entities
      expect(historicalResult.components.noveltyBoost).toBeGreaterThanOrEqual(
        balancedResult.components.noveltyBoost
      );
    });
  });

  describe('novelty calculation', () => {
    it('should return high novelty for never accessed entities', async () => {
      const entity = createTestEntity({
        lastAccessedAt: undefined,
        createdAt: undefined,
        accessCount: 0, // Zero access count for max frequency novelty
      });
      const context: SalienceContext = {};

      const result = await salienceEngine.calculateSalience(entity, context);

      // Novelty is now a weighted combination: time (0.5), frequency (0.3), uniqueness (0.2)
      // With accessCount=0: timeNovelty=1.0, frequencyNovelty=1.0, uniqueness=1.0
      // Total = 0.5*1.0 + 0.3*1.0 + 0.2*1.0 = 1.0
      expect(result.components.noveltyBoost).toBe(1);
    });

    it('should reduce novelty for recently accessed entities', async () => {
      const justNow = new Date().toISOString();
      const entity = createTestEntity({ lastAccessedAt: justNow });
      const context: SalienceContext = {};

      const result = await salienceEngine.calculateSalience(entity, context);

      expect(result.components.noveltyBoost).toBeLessThan(0.5);
    });

    it('should reduce novelty for entities in recentEntities context', async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const entity = createTestEntity({ name: 'recent_context', lastAccessedAt: weekAgo });

      const withoutContext = await salienceEngine.calculateSalience(entity, {});
      const withContext = await salienceEngine.calculateSalience(entity, {
        recentEntities: ['recent_context'],
      });

      expect(withContext.components.noveltyBoost).toBeLessThan(
        withoutContext.components.noveltyBoost
      );
    });
  });

  describe('frequency boost', () => {
    it('should return higher frequency boost for higher access count', async () => {
      const entities: AgentEntity[] = [
        createTestEntity({ name: 'low', accessCount: 5 }),
        createTestEntity({ name: 'high', accessCount: 100 }),
      ];
      storage = createMockStorage(entities);
      accessTracker = new AccessTracker(storage);
      decayEngine = new DecayEngine(storage, accessTracker);
      salienceEngine = new SalienceEngine(storage, accessTracker, decayEngine);

      const lowResult = await salienceEngine.calculateSalience(entities[0], {});
      const highResult = await salienceEngine.calculateSalience(entities[1], {});

      expect(highResult.components.frequencyBoost).toBeGreaterThan(
        lowResult.components.frequencyBoost
      );
    });

    it('should return zero frequency boost for zero access count', async () => {
      const entity = createTestEntity({ accessCount: 0 });
      const result = await salienceEngine.calculateSalience(entity, {});
      expect(result.components.frequencyBoost).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should use default weights', () => {
      const config = salienceEngine.getConfig();

      expect(config.importanceWeight).toBe(0.25);
      expect(config.recencyWeight).toBe(0.25);
      expect(config.frequencyWeight).toBe(0.2);
      expect(config.contextWeight).toBe(0.2);
      expect(config.noveltyWeight).toBe(0.1);
    });

    it('should use custom weights', () => {
      const customEngine = new SalienceEngine(storage, accessTracker, decayEngine, {
        importanceWeight: 0.5,
        recencyWeight: 0.3,
        frequencyWeight: 0.1,
        contextWeight: 0.05,
        noveltyWeight: 0.05,
      });

      const config = customEngine.getConfig();

      expect(config.importanceWeight).toBe(0.5);
      expect(config.recencyWeight).toBe(0.3);
      expect(config.frequencyWeight).toBe(0.1);
      expect(config.contextWeight).toBe(0.05);
      expect(config.noveltyWeight).toBe(0.05);
    });

    it('should apply custom weights to calculation', async () => {
      // Create engine with only importance weight
      const importanceOnlyEngine = new SalienceEngine(storage, accessTracker, decayEngine, {
        importanceWeight: 1.0,
        recencyWeight: 0,
        frequencyWeight: 0,
        contextWeight: 0,
        noveltyWeight: 0,
      });

      const highImportance = createTestEntity({ name: 'high', importance: 10 });
      const lowImportance = createTestEntity({ name: 'low', importance: 1 });

      const highResult = await importanceOnlyEngine.calculateSalience(highImportance, {});
      const lowResult = await importanceOnlyEngine.calculateSalience(lowImportance, {});

      // With only importance weight, score should be directly proportional to importance
      expect(highResult.salienceScore).toBeGreaterThan(lowResult.salienceScore * 5);
    });
  });

  describe('context relevance with user intent', () => {
    it('should boost relevance when observations match user intent', async () => {
      const matchEntity = createTestEntity({
        name: 'match',
        observations: ['User wants to book a hotel'],
      });
      const noMatchEntity = createTestEntity({
        name: 'nomatch',
        observations: ['User prefers quick flights'],
      });
      const context: SalienceContext = { userIntent: 'book' };

      const matchResult = await salienceEngine.calculateSalience(matchEntity, context);
      const noMatchResult = await salienceEngine.calculateSalience(noMatchEntity, context);

      expect(matchResult.components.contextRelevance).toBeGreaterThan(
        noMatchResult.components.contextRelevance
      );
    });
  });

  describe('recent entities context', () => {
    it('should boost relevance for entities in recentEntities', async () => {
      const recentEntity = createTestEntity({ name: 'recent_entity' });
      const otherEntity = createTestEntity({ name: 'other_entity' });
      const context: SalienceContext = { recentEntities: ['recent_entity'] };

      const recentResult = await salienceEngine.calculateSalience(recentEntity, context);
      const otherResult = await salienceEngine.calculateSalience(otherEntity, context);

      expect(recentResult.components.contextRelevance).toBeGreaterThan(
        otherResult.components.contextRelevance
      );
    });
  });

  describe('Sprint 17: enhanced context relevance', () => {
    it('should calculate task relevance using TF-IDF similarity', async () => {
      const entity = createTestEntity({
        name: 'travel_booking',
        observations: ['User wants to book a hotel for vacation trip'],
      });

      // Test direct method access
      const relevance = salienceEngine.calculateTaskRelevance(entity, 'hotel vacation booking');

      expect(relevance).toBeGreaterThan(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('should return 1.0 for exact task ID match', async () => {
      const entity = createTestEntity({
        name: 'task_memory',
        taskId: 'booking_task',
      });

      const relevance = salienceEngine.calculateTaskRelevance(entity, 'booking_task');

      expect(relevance).toBe(1.0);
    });

    it('should calculate query relevance using TF-IDF similarity', async () => {
      const entity = createTestEntity({
        name: 'preference_entity',
        observations: ['User prefers budget accommodation near city center'],
      });

      const relevance = salienceEngine.calculateQueryRelevance(entity, 'budget accommodation city');

      expect(relevance).toBeGreaterThan(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('should apply configurable session boost factor', async () => {
      const customEngine = new SalienceEngine(storage, accessTracker, decayEngine, {
        sessionBoostFactor: 0.5,
      });

      const entity = createTestEntity({
        name: 'session_entity',
        sessionId: 'session_123',
      });

      const relevance = customEngine.calculateSessionRelevance(entity, 'session_123');

      expect(relevance).toBe(0.5);
    });

    it('should calculate intent relevance using TF-IDF similarity', async () => {
      const entity = createTestEntity({
        name: 'intent_entity',
        observations: ['User wants to purchase airline tickets for travel'],
      });

      const relevance = salienceEngine.calculateIntentRelevance(entity, 'purchase airline tickets');

      expect(relevance).toBeGreaterThan(0);
      expect(relevance).toBeLessThanOrEqual(1);
    });

    it('should use keyword matching when semantic similarity disabled', async () => {
      const keywordEngine = new SalienceEngine(storage, accessTracker, decayEngine, {
        useSemanticSimilarity: false,
      });

      const entity = createTestEntity({
        name: 'hotel_preferences',
        observations: ['User likes hotels'],
      });

      // Keyword match in name should work
      const relevance = keywordEngine.calculateQueryRelevance(entity, 'hotel');

      // With keyword matching, name match returns 1.0
      expect(relevance).toBe(1.0);
    });
  });

  describe('Sprint 17: enhanced novelty calculation', () => {
    it('should consider observation uniqueness in novelty', async () => {
      // Entity with completely unique/unrelated observations
      const uniqueEntity = createTestEntity({
        name: 'unique_obs',
        observations: [
          'The weather is sunny and warm today',
          'Python is a programming language',
          'Mount Everest is the tallest mountain',
        ],
        accessCount: 0,
        lastAccessedAt: undefined,
        createdAt: undefined,
      });

      // Entity with nearly identical observations (high similarity)
      const similarEntity = createTestEntity({
        name: 'similar_obs',
        observations: [
          'User likes Italian food very much',
          'User likes Italian food a lot',
          'User likes Italian food greatly',
        ],
        accessCount: 0,
        lastAccessedAt: undefined,
        createdAt: undefined,
      });

      const uniqueResult = await salienceEngine.calculateSalience(uniqueEntity, {});
      const similarResult = await salienceEngine.calculateSalience(similarEntity, {});

      // Unique observations should have higher novelty
      expect(uniqueResult.components.noveltyBoost).toBeGreaterThan(
        similarResult.components.noveltyBoost
      );
    });

    it('should factor in access frequency for novelty', async () => {
      // Low access count = more novel
      const rareEntity = createTestEntity({
        name: 'rare',
        accessCount: 1,
        lastAccessedAt: undefined,
        createdAt: undefined,
      });

      // High access count = less novel
      const frequentEntity = createTestEntity({
        name: 'frequent',
        accessCount: 100,
        lastAccessedAt: undefined,
        createdAt: undefined,
      });

      const rareResult = await salienceEngine.calculateSalience(rareEntity, {});
      const frequentResult = await salienceEngine.calculateSalience(frequentEntity, {});

      expect(rareResult.components.noveltyBoost).toBeGreaterThan(
        frequentResult.components.noveltyBoost
      );
    });
  });

  describe('Sprint 17: configurable boost factors', () => {
    it('should apply custom recent entity boost factor', async () => {
      const customEngine = new SalienceEngine(storage, accessTracker, decayEngine, {
        recentEntityBoostFactor: 0.9,
      });

      const config = customEngine.getConfig();

      expect(config.recentEntityBoostFactor).toBe(0.9);
    });

    it('should have all new configuration options', () => {
      const config = salienceEngine.getConfig();

      expect(config).toHaveProperty('sessionBoostFactor');
      expect(config).toHaveProperty('recentEntityBoostFactor');
      expect(config).toHaveProperty('useSemanticSimilarity');
      expect(config).toHaveProperty('uniquenessThreshold');
    });
  });
});
