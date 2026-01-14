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
      relations: [],
    })),
    appendEntity: vi.fn(async (entity: Entity) => {
      entityMap.set(entity.name, entity);
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
});
