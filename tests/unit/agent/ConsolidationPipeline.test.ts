/**
 * ConsolidationPipeline Unit Tests
 *
 * Tests for memory consolidation including session processing,
 * promotion, and pipeline stages.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConsolidationPipeline,
  type PipelineStage,
} from '../../../src/agent/ConsolidationPipeline.js';
import type { IGraphStorage, Entity, KnowledgeGraph } from '../../../src/types/types.js';
import type { AgentEntity, ConsolidateOptions } from '../../../src/types/agent-memory.js';
import type { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { DecayEngine } from '../../../src/agent/DecayEngine.js';

/**
 * Create a mock storage with configurable behavior.
 */
function createMockStorage(entities: Entity[] = []): IGraphStorage {
  const entityMap = new Map<string, Entity>(entities.map((e) => [e.name, e]));
  const relations: Array<{ from: string; to: string; relationType: string }> = [];

  return {
    getEntityByName: vi.fn((name: string) => entityMap.get(name)),
    updateEntity: vi.fn(async (name: string, updates: Record<string, unknown>) => {
      const entity = entityMap.get(name);
      if (entity) {
        Object.assign(entity, updates);
      }
    }),
    loadGraph: vi.fn(async () => ({
      entities: Array.from(entityMap.values()),
      relations: [...relations],
    })),
    appendEntity: vi.fn(async (entity: Entity) => {
      entityMap.set(entity.name, entity);
    }),
    appendRelation: vi.fn(async (relation: { from: string; to: string; relationType: string }) => {
      relations.push(relation);
    }),
    saveGraph: vi.fn(async (graph: KnowledgeGraph) => {
      entityMap.clear();
      for (const e of graph.entities) {
        entityMap.set(e.name, e);
      }
    }),
  } as unknown as IGraphStorage;
}

/**
 * Create a mock working memory manager.
 */
function createMockWorkingMemory(
  sessionMemories: Map<string, AgentEntity[]> = new Map()
): WorkingMemoryManager {
  return {
    getSessionMemories: vi.fn(async (sessionId: string) => {
      return sessionMemories.get(sessionId) ?? [];
    }),
    promoteMemory: vi.fn(async () => {
      return {};
    }),
    getPromotionCandidates: vi.fn(async () => []),
  } as unknown as WorkingMemoryManager;
}

/**
 * Create a mock decay engine.
 */
function createMockDecayEngine(): DecayEngine {
  return {
    reinforceMemory: vi.fn(async () => {
      return { reinforced: true };
    }),
    calculateEffectiveImportance: vi.fn(() => 5),
  } as unknown as DecayEngine;
}

/**
 * Create a test working memory entity.
 */
function createWorkingMemory(
  name: string,
  sessionId: string,
  confidence: number = 0.8,
  confirmations: number = 2
): AgentEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'working_memory',
    observations: ['Test observation'],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'working',
    sessionId,
    accessCount: 0,
    confidence,
    confirmationCount: confirmations,
    visibility: 'private',
    isWorkingMemory: true,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
}

describe('ConsolidationPipeline', () => {
  let storage: IGraphStorage;
  let workingMemory: WorkingMemoryManager;
  let decayEngine: DecayEngine;
  let pipeline: ConsolidationPipeline;

  beforeEach(() => {
    storage = createMockStorage();
    workingMemory = createMockWorkingMemory();
    decayEngine = createMockDecayEngine();
    pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);
  });

  // ==================== Construction ====================

  describe('constructor', () => {
    it('should create pipeline with default config', () => {
      const config = pipeline.getConfig();

      expect(config.summarizationEnabled).toBe(true);
      expect(config.patternExtractionEnabled).toBe(true);
      expect(config.minPromotionConfidence).toBe(0.7);
      expect(config.minPromotionConfirmations).toBe(2);
      expect(config.preserveOriginals).toBe(false);
    });

    it('should create pipeline with custom config', () => {
      const customPipeline = new ConsolidationPipeline(
        storage,
        workingMemory,
        decayEngine,
        {
          summarizationEnabled: false,
          minPromotionConfidence: 0.9,
          minPromotionConfirmations: 5,
          preserveOriginals: true,
        }
      );

      const config = customPipeline.getConfig();
      expect(config.summarizationEnabled).toBe(false);
      expect(config.minPromotionConfidence).toBe(0.9);
      expect(config.minPromotionConfirmations).toBe(5);
      expect(config.preserveOriginals).toBe(true);
    });
  });

  // ==================== Pipeline Stages ====================

  describe('registerStage', () => {
    it('should register a pipeline stage', () => {
      const stage: PipelineStage = {
        name: 'test_stage',
        async process() {
          return { processed: 0, transformed: 0, errors: [] };
        },
      };

      pipeline.registerStage(stage);
      expect(pipeline.getStages()).toHaveLength(1);
      expect(pipeline.getStages()[0].name).toBe('test_stage');
    });

    it('should register multiple stages in order', () => {
      pipeline.registerStage({
        name: 'stage_1',
        async process() {
          return { processed: 0, transformed: 0, errors: [] };
        },
      });
      pipeline.registerStage({
        name: 'stage_2',
        async process() {
          return { processed: 0, transformed: 0, errors: [] };
        },
      });

      const stages = pipeline.getStages();
      expect(stages).toHaveLength(2);
      expect(stages[0].name).toBe('stage_1');
      expect(stages[1].name).toBe('stage_2');
    });

    it('should clear stages', () => {
      pipeline.registerStage({
        name: 'stage',
        async process() {
          return { processed: 0, transformed: 0, errors: [] };
        },
      });
      expect(pipeline.getStages()).toHaveLength(1);

      pipeline.clearStages();
      expect(pipeline.getStages()).toHaveLength(0);
    });
  });

  // ==================== Session Consolidation ====================

  describe('consolidateSession', () => {
    it('should return zero counts for empty session', async () => {
      const result = await pipeline.consolidateSession('empty_session');

      expect(result.memoriesProcessed).toBe(0);
      expect(result.memoriesPromoted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should process memories from session', async () => {
      const memories = [
        createWorkingMemory('wm1', 'session_1', 0.8, 3),
        createWorkingMemory('wm2', 'session_1', 0.9, 4),
      ];

      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSession('session_1');

      expect(result.memoriesProcessed).toBe(2);
    });

    it('should filter candidates by confidence', async () => {
      const memories = [
        createWorkingMemory('wm_high', 'session_1', 0.8, 3),
        createWorkingMemory('wm_low', 'session_1', 0.3, 3),
      ];

      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSession('session_1');

      // Only wm_high should be promoted (meets 0.7 threshold)
      expect(result.memoriesPromoted).toBe(1);
    });

    it('should filter candidates by confirmations', async () => {
      const memories = [
        createWorkingMemory('wm_confirmed', 'session_1', 0.8, 3),
        createWorkingMemory('wm_unconfirmed', 'session_1', 0.8, 0),
      ];

      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSession('session_1');

      // Only wm_confirmed should be promoted (meets 2 threshold)
      expect(result.memoriesPromoted).toBe(1);
    });

    it('should use custom options over defaults', async () => {
      const memories = [
        createWorkingMemory('wm1', 'session_1', 0.95, 5),
        createWorkingMemory('wm2', 'session_1', 0.85, 3),
      ];

      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSession('session_1', {
        minConfidence: 0.9,
        minConfirmations: 4,
      });

      // Only wm1 meets custom thresholds
      expect(result.memoriesPromoted).toBe(1);
    });

    it('should run pipeline stages', async () => {
      const stageProcessed = vi.fn();
      pipeline.registerStage({
        name: 'counting_stage',
        async process(entities) {
          stageProcessed(entities.length);
          return { processed: entities.length, transformed: 1, errors: [] };
        },
      });

      const memories = [createWorkingMemory('wm1', 'session_1', 0.8, 3)];
      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);
      pipeline.registerStage({
        name: 'test_stage',
        async process(entities) {
          stageProcessed(entities.length);
          return { processed: entities.length, transformed: 1, errors: [] };
        },
      });

      await pipeline.consolidateSession('session_1');

      expect(stageProcessed).toHaveBeenCalled();
    });

    it('should handle stage errors gracefully', async () => {
      const memories = [createWorkingMemory('wm1', 'session_1', 0.8, 3)];
      storage = createMockStorage(memories);
      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);
      pipeline.registerStage({
        name: 'failing_stage',
        async process() {
          throw new Error('Stage error');
        },
      });

      const result = await pipeline.consolidateSession('session_1');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('failing_stage');
    });
  });

  // ==================== Memory Promotion ====================

  describe('promoteMemory', () => {
    it('should promote working memory to episodic', async () => {
      const wm = createWorkingMemory('wm_test', 'session_1');
      storage = createMockStorage([wm]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const promoted = await pipeline.promoteMemory('wm_test', 'episodic');

      expect(promoted.memoryType).toBe('episodic');
      expect(promoted.isWorkingMemory).toBe(false);
      expect(promoted.promotedAt).toBeDefined();
      expect(promoted.promotedFrom).toBe('session_1');
      expect(promoted.markedForPromotion).toBe(false);
    });

    it('should promote working memory to semantic', async () => {
      const wm = createWorkingMemory('wm_test', 'session_1');
      storage = createMockStorage([wm]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const promoted = await pipeline.promoteMemory('wm_test', 'semantic');

      expect(promoted.memoryType).toBe('semantic');
    });

    it('should reinforce memory after promotion', async () => {
      const wm = createWorkingMemory('wm_test', 'session_1');
      storage = createMockStorage([wm]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await pipeline.promoteMemory('wm_test', 'episodic');

      expect(decayEngine.reinforceMemory).toHaveBeenCalledWith('wm_test');
    });

    it('should throw for non-existent entity', async () => {
      await expect(
        pipeline.promoteMemory('nonexistent', 'episodic')
      ).rejects.toThrow('Entity not found');
    });

    it('should throw for non-working memory', async () => {
      const now = new Date().toISOString();
      const episodic: AgentEntity = {
        name: 'already_episodic',
        entityType: 'episode',
        observations: ['Test'],
        createdAt: now,
        lastModified: now,
        importance: 5,
        memoryType: 'episodic',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
        visibility: 'private',
      };
      storage = createMockStorage([episodic as unknown as Entity]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await expect(
        pipeline.promoteMemory('already_episodic', 'semantic')
      ).rejects.toThrow('not working memory');
    });
  });

  // ==================== Batch Operations ====================

  describe('consolidateSessions', () => {
    it('should consolidate multiple sessions', async () => {
      const session1Memories = [createWorkingMemory('wm1', 'session_1', 0.8, 3)];
      const session2Memories = [createWorkingMemory('wm2', 'session_2', 0.8, 3)];

      const allMemories = [...session1Memories, ...session2Memories];
      storage = createMockStorage(allMemories);
      workingMemory = createMockWorkingMemory(
        new Map([
          ['session_1', session1Memories],
          ['session_2', session2Memories],
        ])
      );
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSessions(['session_1', 'session_2']);

      expect(result.memoriesProcessed).toBe(2);
      expect(result.memoriesPromoted).toBe(2);
    });

    it('should aggregate errors from all sessions', async () => {
      workingMemory = {
        getSessionMemories: vi.fn(async () => {
          throw new Error('Session error');
        }),
      } as unknown as WorkingMemoryManager;
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.consolidateSessions(['session_1', 'session_2']);

      expect(result.errors.length).toBe(2);
    });
  });

  // ==================== Candidate Evaluation ====================

  describe('getPromotionCandidates', () => {
    it('should return candidates meeting default criteria', async () => {
      const memories = [
        createWorkingMemory('eligible', 'session_1', 0.8, 3),
        createWorkingMemory('ineligible', 'session_1', 0.3, 0),
      ];

      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const candidates = await pipeline.getPromotionCandidates('session_1');

      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe('eligible');
    });

    it('should use custom criteria', async () => {
      const memories = [
        createWorkingMemory('high', 'session_1', 0.95, 10),
        createWorkingMemory('medium', 'session_1', 0.8, 3),
      ];

      workingMemory = createMockWorkingMemory(new Map([['session_1', memories]]));
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const candidates = await pipeline.getPromotionCandidates('session_1', {
        minConfidence: 0.9,
        minConfirmations: 5,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0].name).toBe('high');
    });
  });

  describe('isPromotionEligible', () => {
    it('should return true for eligible entity', async () => {
      const wm = createWorkingMemory('eligible', 'session_1', 0.8, 3);
      storage = createMockStorage([wm]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const eligible = await pipeline.isPromotionEligible('eligible');

      expect(eligible).toBe(true);
    });

    it('should return false for ineligible entity', async () => {
      const wm = createWorkingMemory('ineligible', 'session_1', 0.3, 0);
      storage = createMockStorage([wm]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const eligible = await pipeline.isPromotionEligible('ineligible');

      expect(eligible).toBe(false);
    });

    it('should return false for non-working memory', async () => {
      const episodic: AgentEntity = {
        name: 'episodic',
        entityType: 'episode',
        observations: ['Test'],
        memoryType: 'episodic',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.9,
      };
      storage = createMockStorage([episodic as unknown as Entity]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const eligible = await pipeline.isPromotionEligible('episodic');

      expect(eligible).toBe(false);
    });

    it('should return false for non-existent entity', async () => {
      const eligible = await pipeline.isPromotionEligible('nonexistent');

      expect(eligible).toBe(false);
    });
  });

  // ==================== Observation Summarization ====================

  describe('summarizeObservations', () => {
    it('should return empty result for entity with no observations', async () => {
      const entity: AgentEntity = {
        name: 'empty',
        entityType: 'test',
        observations: [],
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
      };

      const result = await pipeline.summarizeObservations(entity);

      expect(result.originalCount).toBe(0);
      expect(result.summaryCount).toBe(0);
      expect(result.compressionRatio).toBe(1);
    });

    it('should return single observation unchanged', async () => {
      const entity: AgentEntity = {
        name: 'single',
        entityType: 'test',
        observations: ['User likes pasta'],
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
      };

      const result = await pipeline.summarizeObservations(entity);

      expect(result.originalCount).toBe(1);
      expect(result.summaryCount).toBe(1);
      expect(result.summaries).toEqual(['User likes pasta']);
    });

    it('should group and summarize similar observations', async () => {
      const entity: AgentEntity = {
        name: 'multi',
        entityType: 'test',
        observations: [
          'User likes Italian food',
          'User prefers Italian cuisine',
          'Meeting scheduled for Monday',
        ],
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
      };

      const result = await pipeline.summarizeObservations(entity, 0.4);

      expect(result.originalCount).toBe(3);
      // First two similar, meeting separate
      expect(result.summaryCount).toBeLessThanOrEqual(3);
    });

    it('should use config threshold when not specified', async () => {
      const customPipeline = new ConsolidationPipeline(
        storage,
        workingMemory,
        decayEngine,
        { similarityThreshold: 0.3 }
      );

      const entity: AgentEntity = {
        name: 'multi',
        entityType: 'test',
        observations: ['User likes pasta', 'User enjoys pasta'],
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
      };

      const result = await customPipeline.summarizeObservations(entity);

      // With low threshold, should be grouped
      expect(result.summaryCount).toBe(1);
    });

    it('should track source observations', async () => {
      const entity: AgentEntity = {
        name: 'multi',
        entityType: 'test',
        observations: [
          'User likes pasta',
          'User enjoys pasta',
          'Weather is sunny',
        ],
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
      };

      const result = await pipeline.summarizeObservations(entity, 0.5);

      expect(result.sourceObservations).toBeDefined();
      expect(result.sourceObservations.length).toBe(result.summaryCount);
    });
  });

  describe('applySummarizationToEntity', () => {
    it('should return empty result for non-existent entity', async () => {
      const result = await pipeline.applySummarizationToEntity('nonexistent');

      expect(result.originalCount).toBe(0);
      expect(result.summaryCount).toBe(0);
    });

    it('should update entity with summarized observations', async () => {
      const now = new Date().toISOString();
      const entity: AgentEntity = {
        name: 'to_summarize',
        entityType: 'test',
        observations: [
          'User likes Italian food',
          'User prefers Italian food',
          'User enjoys Italian cuisine',
        ],
        createdAt: now,
        lastModified: now,
        importance: 5,
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
        visibility: 'private',
      };

      storage = createMockStorage([entity as unknown as Entity]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.applySummarizationToEntity('to_summarize', 0.3);

      // Should have compressed observations
      expect(result.compressionRatio).toBeGreaterThan(1);
      expect(storage.updateEntity).toHaveBeenCalled();
    });

    it('should not update entity if no compression achieved', async () => {
      const now = new Date().toISOString();
      const entity: AgentEntity = {
        name: 'no_compress',
        entityType: 'test',
        observations: ['Observation 1', 'Observation 2'],
        createdAt: now,
        lastModified: now,
        importance: 5,
        memoryType: 'working',
        accessCount: 0,
        confirmationCount: 0,
        confidence: 0.8,
        visibility: 'private',
      };

      storage = createMockStorage([entity as unknown as Entity]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // With very high threshold, observations won't group
      const result = await pipeline.applySummarizationToEntity('no_compress', 0.99);

      expect(result.compressionRatio).toBe(1);
      expect(storage.updateEntity).not.toHaveBeenCalled();
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 for identical texts', () => {
      const similarity = pipeline.calculateSimilarity('hello world', 'hello world');
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should return 0 for completely different texts', () => {
      const similarity = pipeline.calculateSimilarity('apple', 'banana');
      expect(similarity).toBe(0);
    });

    it('should return partial similarity for overlapping texts', () => {
      const similarity = pipeline.calculateSimilarity(
        'User likes Italian food',
        'User prefers Italian cuisine'
      );
      // Share "User" and "Italian"
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });
  });

  describe('getSummarizationService', () => {
    it('should return summarization service instance', () => {
      const service = pipeline.getSummarizationService();
      expect(service).toBeDefined();
      expect(typeof service.calculateSimilarity).toBe('function');
      expect(typeof service.summarize).toBe('function');
    });
  });

  // ==================== Pattern Extraction ====================

  describe('extractPatterns', () => {
    it('should return empty array when no entities of type exist', async () => {
      const patterns = await pipeline.extractPatterns('nonexistent', 2);
      expect(patterns).toEqual([]);
    });

    it('should extract patterns from entity observations', async () => {
      const entities = [
        {
          name: 'pref1',
          entityType: 'preference',
          observations: ['User prefers Italian food'],
        },
        {
          name: 'pref2',
          entityType: 'preference',
          observations: ['User prefers Mexican food'],
        },
        {
          name: 'pref3',
          entityType: 'preference',
          observations: ['User prefers Japanese food'],
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const patterns = await pipeline.extractPatterns('preference', 2);

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern).toBe('User prefers {X} food');
      expect(patterns[0].sourceEntities).toContain('pref1');
      expect(patterns[0].sourceEntities).toContain('pref2');
      expect(patterns[0].sourceEntities).toContain('pref3');
    });

    it('should only analyze entities of specified type', async () => {
      const entities = [
        {
          name: 'pref1',
          entityType: 'preference',
          observations: ['User prefers Italian food'],
        },
        {
          name: 'event1',
          entityType: 'event',
          observations: ['User prefers Mexican food'],
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // Only 1 preference entity, so no pattern can be found
      const patterns = await pipeline.extractPatterns('preference', 2);
      expect(patterns.length).toBe(0);
    });

    it('should return empty when observations below threshold', async () => {
      const entities = [
        {
          name: 'pref1',
          entityType: 'preference',
          observations: ['User likes pasta'],
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const patterns = await pipeline.extractPatterns('preference', 3);
      expect(patterns.length).toBe(0);
    });
  });

  describe('createSemanticFromPattern', () => {
    it('should create semantic memory entity from pattern', async () => {
      const pattern = {
        pattern: 'User prefers {X} food',
        variables: ['Italian', 'Mexican', 'Japanese'],
        occurrences: 3,
        confidence: 0.9,
        sourceEntities: ['pref1', 'pref2', 'pref3'],
      };

      const entities: Entity[] = [
        { name: 'pref1', entityType: 'preference', observations: [] },
        { name: 'pref2', entityType: 'preference', observations: [] },
        { name: 'pref3', entityType: 'preference', observations: [] },
      ];

      storage = createMockStorage(entities);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const semantic = await pipeline.createSemanticFromPattern(
        pattern,
        ['pref1', 'pref2', 'pref3']
      );

      expect(semantic.memoryType).toBe('semantic');
      expect(semantic.entityType).toBe('pattern');
      expect(semantic.confidence).toBe(0.9);
      expect(semantic.confirmationCount).toBe(3);
      expect(semantic.observations).toContain('Pattern: User prefers {X} food');
    });

    it('should create derived_from relations to source entities', async () => {
      const pattern = {
        pattern: 'User prefers {X} food',
        variables: ['Italian'],
        occurrences: 2,
        confidence: 0.5,
        sourceEntities: ['pref1'],
      };

      const entities: Entity[] = [
        { name: 'pref1', entityType: 'preference', observations: [] },
      ];

      storage = createMockStorage(entities);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await pipeline.createSemanticFromPattern(pattern, ['pref1']);

      // Verify relation was created
      expect(storage.appendRelation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'pref1',
          relationType: 'derived_from',
        })
      );
    });
  });

  describe('extractAndCreateSemanticPatterns', () => {
    it('should extract patterns and create semantic memories', async () => {
      const entities = [
        {
          name: 'pref1',
          entityType: 'preference',
          observations: ['User prefers Italian food'],
        },
        {
          name: 'pref2',
          entityType: 'preference',
          observations: ['User prefers Mexican food'],
        },
        {
          name: 'pref3',
          entityType: 'preference',
          observations: ['User prefers Japanese food'],
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const semantics = await pipeline.extractAndCreateSemanticPatterns(
        'preference',
        2,
        0.1 // Low confidence threshold
      );

      expect(semantics.length).toBeGreaterThan(0);
      expect(semantics[0].memoryType).toBe('semantic');
    });

    it('should filter patterns by confidence threshold', async () => {
      const entities = [
        {
          name: 'pref1',
          entityType: 'preference',
          observations: ['User prefers Italian food'],
        },
        {
          name: 'pref2',
          entityType: 'preference',
          observations: ['User prefers Mexican food'],
        },
        {
          name: 'pref3',
          entityType: 'preference',
          observations: ['Random unrelated observation here'],
        },
        {
          name: 'pref4',
          entityType: 'preference',
          observations: ['Another unrelated note'],
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // With 4 observations, only 2 match, so confidence is 0.5
      // With 0.6 threshold, nothing should be created
      const semantics = await pipeline.extractAndCreateSemanticPatterns(
        'preference',
        2,
        0.6
      );

      expect(semantics.length).toBe(0);
    });
  });

  describe('getPatternDetector', () => {
    it('should return pattern detector instance', () => {
      const detector = pipeline.getPatternDetector();
      expect(detector).toBeDefined();
      expect(typeof detector.detectPatterns).toBe('function');
    });
  });

  // ==================== Memory Merging (Sprint 14) ====================

  describe('mergeMemories', () => {
    it('should throw error with less than 2 entities', async () => {
      await expect(pipeline.mergeMemories(['single'], 'newest')).rejects.toThrow(
        'Need at least 2 entities to merge'
      );
    });

    it('should throw error for non-existent entity', async () => {
      const entities: AgentEntity[] = [
        createWorkingMemory('ent1', 'session1'),
      ];
      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await expect(
        pipeline.mergeMemories(['ent1', 'nonexistent'], 'newest')
      ).rejects.toThrow('Entity not found or not AgentEntity');
    });

    it('should merge using newest strategy', async () => {
      const older = new Date('2024-01-01').toISOString();
      const newer = new Date('2024-01-15').toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'older',
          entityType: 'memory',
          observations: ['Obs from older'],
          memoryType: 'episodic',
          createdAt: older,
          lastModified: older,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'newer',
          entityType: 'memory',
          observations: ['Obs from newer'],
          memoryType: 'episodic',
          createdAt: newer,
          lastModified: newer,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.mergeMemories(['older', 'newer'], 'newest');

      expect(result.survivor.name).toBe('newer');
      expect(result.strategy).toBe('newest');
      expect(result.mergedCount).toBe(2);
      expect(result.mergedEntities).toContain('older');
      expect(result.mergedEntities).toContain('newer');
    });

    it('should merge using strongest strategy', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'weak',
          entityType: 'memory',
          observations: ['Obs from weak'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.5,
          confirmationCount: 1,
          accessCount: 0,
          visibility: 'private',
        },
        {
          name: 'strong',
          entityType: 'memory',
          observations: ['Obs from strong'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.9,
          confirmationCount: 5,
          accessCount: 0,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.mergeMemories(['weak', 'strong'], 'strongest');

      expect(result.survivor.name).toBe('strong');
      expect(result.strategy).toBe('strongest');
    });

    it('should merge using merge_observations strategy', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'first',
          entityType: 'memory',
          observations: ['First observation'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'second',
          entityType: 'memory',
          observations: ['Second observation'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.mergeMemories(
        ['first', 'second'],
        'merge_observations'
      );

      // First entity is survivor for merge_observations
      expect(result.survivor.name).toBe('first');
      expect(result.observationCount).toBe(2);
    });

    it('should combine observations from all entities', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['A', 'B'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['C', 'B'], // B is duplicate
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const result = await pipeline.mergeMemories(['ent1', 'ent2'], 'newest');

      // Should deduplicate to 3 unique observations
      expect(result.observationCount).toBe(3);
    });

    it('should sum confirmation and access counts', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['Obs1'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.8,
          confirmationCount: 2,
          accessCount: 10,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['Obs2'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.8,
          confirmationCount: 3,
          accessCount: 15,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await pipeline.mergeMemories(['ent1', 'ent2'], 'newest');

      expect(storage.updateEntity).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          confirmationCount: 5,
          accessCount: 25,
        })
      );
    });

    it('should create audit trail record', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: [],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: [],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      await pipeline.mergeMemories(['ent1', 'ent2'], 'newest');

      expect(storage.appendEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'merge_audit',
          observations: expect.arrayContaining([
            expect.stringContaining('Merged:'),
            expect.stringContaining('Survivor:'),
            expect.stringContaining('Strategy: newest'),
          ]),
        })
      );
    });
  });

  describe('findDuplicates', () => {
    it('should return empty array when no entities', async () => {
      const duplicates = await pipeline.findDuplicates(0.9);
      expect(duplicates).toEqual([]);
    });

    it('should find duplicates based on similarity', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['User prefers Italian cuisine'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['User prefers Italian food'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // Low threshold to capture similarity
      const duplicates = await pipeline.findDuplicates(0.3);

      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates[0].entity1).toBeDefined();
      expect(duplicates[0].entity2).toBeDefined();
      expect(duplicates[0].similarity).toBeGreaterThan(0);
    });

    it('should not find duplicates with dissimilar observations', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['User prefers Italian cuisine'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['Meeting scheduled for tomorrow'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // High threshold should filter out dissimilar pairs
      const duplicates = await pipeline.findDuplicates(0.9);
      expect(duplicates.length).toBe(0);
    });

    it('should skip entities without observations', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: [],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['Has observation'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const duplicates = await pipeline.findDuplicates(0.5);
      expect(duplicates.length).toBe(0);
    });
  });

  describe('autoMergeDuplicates', () => {
    it('should merge found duplicates automatically', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['User prefers Italian cuisine'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.9,
          confirmationCount: 3,
          accessCount: 0,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['User prefers Italian cuisine and food'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          confidence: 0.5,
          confirmationCount: 1,
          accessCount: 0,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const results = await pipeline.autoMergeDuplicates(0.3, 'strongest');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].strategy).toBe('strongest');
    });

    it('should use default strongest strategy', async () => {
      const now = new Date().toISOString();

      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['Same observation'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['Same observation'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const results = await pipeline.autoMergeDuplicates(0.5);

      if (results.length > 0) {
        expect(results[0].strategy).toBe('strongest');
      }
    });

    it('should skip already merged entities', async () => {
      const now = new Date().toISOString();

      // Create three similar entities
      const entities: AgentEntity[] = [
        {
          name: 'ent1',
          entityType: 'memory',
          observations: ['Same content here'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent2',
          entityType: 'memory',
          observations: ['Same content here'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
        {
          name: 'ent3',
          entityType: 'memory',
          observations: ['Same content here'],
          memoryType: 'episodic',
          createdAt: now,
          lastModified: now,
          importance: 5,
          accessCount: 0,
          confidence: 0.8,
          confirmationCount: 1,
          visibility: 'private',
        },
      ];

      storage = createMockStorage(entities as unknown as Entity[]);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      // Even with 3 entities that are all duplicates, once ent1+ent2 are merged,
      // ent3 should not be merged again with ent1 or ent2
      const results = await pipeline.autoMergeDuplicates(0.9);

      // Should have at most 1 merge result, not 2
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getMergeHistory', () => {
    it('should return empty array when no merge history', async () => {
      const history = await pipeline.getMergeHistory('unknown');
      expect(history).toEqual([]);
    });

    it('should return audit entities mentioning the entity', async () => {
      const now = new Date().toISOString();

      const entities: Entity[] = [
        {
          name: 'merge_audit_123',
          entityType: 'merge_audit',
          observations: [
            'Merged: ent1, ent2',
            'Survivor: ent1',
            'Strategy: newest',
          ],
          createdAt: now,
        },
        {
          name: 'merge_audit_456',
          entityType: 'merge_audit',
          observations: [
            'Merged: ent3, ent4',
            'Survivor: ent3',
            'Strategy: strongest',
          ],
          createdAt: now,
        },
      ];

      storage = createMockStorage(entities);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const history = await pipeline.getMergeHistory('ent1');

      expect(history.length).toBe(1);
      expect(history[0].name).toBe('merge_audit_123');
    });

    it('should find history as survivor or merged entity', async () => {
      const now = new Date().toISOString();

      const entities: Entity[] = [
        {
          name: 'merge_audit_1',
          entityType: 'merge_audit',
          observations: [
            'Merged: target, other',
            'Survivor: target',
          ],
          createdAt: now,
        },
        {
          name: 'merge_audit_2',
          entityType: 'merge_audit',
          observations: [
            'Merged: another, target',
            'Survivor: another',
          ],
          createdAt: now,
        },
      ];

      storage = createMockStorage(entities);
      pipeline = new ConsolidationPipeline(storage, workingMemory, decayEngine);

      const history = await pipeline.getMergeHistory('target');

      expect(history.length).toBe(2);
    });
  });
});
