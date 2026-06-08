/**
 * Unit tests for WorkingMemoryManager
 *
 * Tests the working memory manager functionality including:
 * - Session-scoped memory creation
 * - TTL-based expiration
 * - Session memory retrieval with filtering
 * - Expiration cleanup
 * - TTL extension
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkingMemoryManager,
  type WorkingMemoryConfig,
  type SessionMemoryFilter,
} from '../../../src/agent/WorkingMemoryManager.js';
import type { IGraphStorage, Entity, KnowledgeGraph } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';

// ==================== Mock Storage ====================

function createMockStorage(entities: AgentEntity[] = []): IGraphStorage {
  const entityMap = new Map<string, Entity>(entities.map((e) => [e.name, e as Entity]));
  let graphEntities = [...entities] as Entity[];
  let graphRelations: { from: string; to: string; relationType: string }[] = [];

  return {
    getEntityByName: vi.fn((name: string) => entityMap.get(name) ?? null),
    updateEntity: vi.fn(async (name: string, updates: Record<string, unknown>) => {
      const entity = entityMap.get(name);
      if (entity) {
        Object.assign(entity, updates);
      }
    }),
    loadGraph: vi.fn(async () => ({
      entities: graphEntities,
      relations: graphRelations,
    })),
    appendEntity: vi.fn(async (entity: Entity) => {
      entityMap.set(entity.name, entity);
      graphEntities.push(entity);
    }),
    saveGraph: vi.fn(async (graph: KnowledgeGraph) => {
      graphEntities = graph.entities;
      graphRelations = graph.relations;
      entityMap.clear();
      for (const e of graph.entities) {
        entityMap.set(e.name, e);
      }
    }),
    getGraphForMutation: vi.fn(async () => ({
      entities: [...graphEntities],
      relations: [...graphRelations],
    })),
    ensureLoaded: vi.fn(async () => {}),
    appendRelation: vi.fn(async () => {}),
  } as unknown as IGraphStorage;
}

// ==================== Test Fixtures ====================

function createAgentEntity(
  name: string,
  sessionId: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return {
    name,
    entityType: 'working_memory',
    observations: ['Test content'],
    memoryType: 'working',
    sessionId,
    expiresAt,
    isWorkingMemory: true,
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    ...overrides,
  };
}

// ==================== Constructor Tests ====================

describe('WorkingMemoryManager Constructor', () => {
  it('should create instance with default config', () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);

    expect(wmm).toBeInstanceOf(WorkingMemoryManager);
    const config = wmm.getConfig();
    expect(config.defaultTTLHours).toBe(24);
    expect(config.maxPerSession).toBe(100);
    expect(config.autoPromote).toBe(false);
  });

  it('should create instance with custom config', () => {
    const storage = createMockStorage();
    const config: WorkingMemoryConfig = {
      defaultTTLHours: 48,
      maxPerSession: 50,
      autoPromote: true,
      autoPromoteConfidenceThreshold: 0.9,
      autoPromoteConfirmationThreshold: 3,
    };
    const wmm = new WorkingMemoryManager(storage, config);

    const actualConfig = wmm.getConfig();
    expect(actualConfig.defaultTTLHours).toBe(48);
    expect(actualConfig.maxPerSession).toBe(50);
    expect(actualConfig.autoPromote).toBe(true);
  });
});

// ==================== createWorkingMemory Tests ====================

describe('WorkingMemoryManager.createWorkingMemory', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    wmm = new WorkingMemoryManager(storage);
  });

  it('should create a working memory with default options', async () => {
    const memory = await wmm.createWorkingMemory('session_1', 'Test content');

    expect(memory.name).toMatch(/^wm_session_1_\d+_[a-f0-9]+$/);
    expect(memory.entityType).toBe('working_memory');
    expect(memory.observations).toEqual(['Test content']);
    expect(memory.memoryType).toBe('working');
    expect(memory.sessionId).toBe('session_1');
    expect(memory.isWorkingMemory).toBe(true);
    expect(memory.confidence).toBe(0.5);
    expect(memory.visibility).toBe('private');
    expect(memory.expiresAt).toBeDefined();
  });

  it('should create a working memory with custom options', async () => {
    const memory = await wmm.createWorkingMemory('session_1', 'Important info', {
      ttlHours: 48,
      importance: 8,
      confidence: 0.9,
      taskId: 'task_123',
      entityType: 'preference',
      visibility: 'shared',
      agentId: 'agent_1',
    });

    expect(memory.importance).toBe(8);
    expect(memory.confidence).toBe(0.9);
    expect(memory.taskId).toBe('task_123');
    expect(memory.entityType).toBe('preference');
    expect(memory.visibility).toBe('shared');
    expect(memory.agentId).toBe('agent_1');
  });

  it('should calculate correct expiration time', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const memory = await wmm.createWorkingMemory('session_1', 'Content', {
      ttlHours: 24,
    });

    const expiresAt = new Date(memory.expiresAt!).getTime();
    const expectedExpiry = now + 24 * 60 * 60 * 1000;

    expect(expiresAt).toBe(expectedExpiry);

    vi.useRealTimers();
  });

  it('should persist to storage', async () => {
    await wmm.createWorkingMemory('session_1', 'Content');

    expect(storage.appendEntity).toHaveBeenCalledTimes(1);
    expect(storage.appendEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: 'working',
        sessionId: 'session_1',
      })
    );
  });

  it('should update session index', async () => {
    const memory = await wmm.createWorkingMemory('session_1', 'Content');

    expect(wmm.getSessionMemoryCount('session_1')).toBe(1);
  });

  it('should throw when session reaches max limit', async () => {
    const wmm = new WorkingMemoryManager(storage, { maxPerSession: 2 });

    await wmm.createWorkingMemory('session_1', 'Content 1');
    await wmm.createWorkingMemory('session_1', 'Content 2');

    await expect(wmm.createWorkingMemory('session_1', 'Content 3')).rejects.toThrow(
      'Session session_1 has reached maximum memory limit (2)'
    );
  });

  it('should allow different sessions to have separate limits', async () => {
    const wmm = new WorkingMemoryManager(storage, { maxPerSession: 2 });

    await wmm.createWorkingMemory('session_1', 'Content 1');
    await wmm.createWorkingMemory('session_1', 'Content 2');
    await wmm.createWorkingMemory('session_2', 'Content 1');
    await wmm.createWorkingMemory('session_2', 'Content 2');

    expect(wmm.getSessionMemoryCount('session_1')).toBe(2);
    expect(wmm.getSessionMemoryCount('session_2')).toBe(2);
  });
});

// ==================== getSessionMemories Tests ====================

describe('WorkingMemoryManager.getSessionMemories', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;

  beforeEach(() => {
    const entities = [
      createAgentEntity('wm_session_1_1', 'session_1', { importance: 5, taskId: 'task_1' }),
      createAgentEntity('wm_session_1_2', 'session_1', { importance: 8, taskId: 'task_2' }),
      createAgentEntity('wm_session_2_1', 'session_2', { importance: 3 }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);
  });

  it('should return empty array for unknown session', async () => {
    const memories = await wmm.getSessionMemories('unknown_session');
    expect(memories).toEqual([]);
  });

  it('should return all memories for a session after index rebuild', async () => {
    const memories = await wmm.getSessionMemories('session_1');
    expect(memories.length).toBe(2);
    expect(memories.every((m) => m.sessionId === 'session_1')).toBe(true);
  });

  it('should filter by entityType', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { entityType: 'preference' }),
      createAgentEntity('wm_2', 'session_1', { entityType: 'fact' }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);

    const memories = await wmm.getSessionMemories('session_1', {
      entityType: 'preference',
    });

    expect(memories.length).toBe(1);
    expect(memories[0].entityType).toBe('preference');
  });

  it('should filter by taskId', async () => {
    const memories = await wmm.getSessionMemories('session_1', {
      taskId: 'task_1',
    });

    expect(memories.length).toBe(1);
    expect(memories[0].taskId).toBe('task_1');
  });

  it('should filter by minImportance', async () => {
    const memories = await wmm.getSessionMemories('session_1', {
      minImportance: 7,
    });

    expect(memories.length).toBe(1);
    expect(memories[0].importance).toBe(8);
  });

  it('should filter by maxImportance', async () => {
    const memories = await wmm.getSessionMemories('session_1', {
      maxImportance: 6,
    });

    expect(memories.length).toBe(1);
    expect(memories[0].importance).toBe(5);
  });

  it('should filter expired memories when excludeExpired is true', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const expiredDate = new Date(now - 1000).toISOString(); // Expired
    const validDate = new Date(now + 1000 * 60 * 60).toISOString(); // Valid

    const entities = [
      createAgentEntity('wm_expired', 'session_1', { expiresAt: expiredDate }),
      createAgentEntity('wm_valid', 'session_1', { expiresAt: validDate }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);

    const memories = await wmm.getSessionMemories('session_1', {
      excludeExpired: true,
    });

    expect(memories.length).toBe(1);
    expect(memories[0].name).toBe('wm_valid');

    vi.useRealTimers();
  });
});

// ==================== clearExpired Tests ====================

describe('WorkingMemoryManager.clearExpired', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return 0 when no memories are expired', async () => {
    const validDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const entities = [
      createAgentEntity('wm_1', 'session_1', { expiresAt: validDate }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const cleared = await wmm.clearExpired();
    expect(cleared).toBe(0);
  });

  it('should clear expired memories', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const expiredDate = new Date(now - 1000).toISOString();
    const validDate = new Date(now + 1000 * 60 * 60).toISOString();

    const entities = [
      createAgentEntity('wm_expired', 'session_1', { expiresAt: expiredDate }),
      createAgentEntity('wm_valid', 'session_1', { expiresAt: validDate }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const cleared = await wmm.clearExpired();
    expect(cleared).toBe(1);
    expect(storage.saveGraph).toHaveBeenCalled();
  });

  it('should skip non-working memory entities', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const expiredDate = new Date(now - 1000).toISOString();
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        memoryType: 'episodic',
        expiresAt: expiredDate,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const cleared = await wmm.clearExpired();
    expect(cleared).toBe(0);
  });
});

// ==================== extendTTL Tests ====================

describe('WorkingMemoryManager.extendTTL', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;

  beforeEach(() => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1 hour
      }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw for negative additionalHours', async () => {
    await expect(wmm.extendTTL(['wm_1'], -5)).rejects.toThrow(
      'additionalHours must be positive'
    );
  });

  it('should throw for zero additionalHours', async () => {
    await expect(wmm.extendTTL(['wm_1'], 0)).rejects.toThrow(
      'additionalHours must be positive'
    );
  });

  it('should throw for non-existent entity', async () => {
    await expect(wmm.extendTTL(['non_existent'], 24)).rejects.toThrow(
      'Entity not found: non_existent'
    );
  });

  it('should throw for non-working memory entity', async () => {
    const entities = [
      createAgentEntity('episodic_1', 'session_1', { memoryType: 'episodic' }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);

    await expect(wmm.extendTTL(['episodic_1'], 24)).rejects.toThrow(
      'Entity is not working memory: episodic_1'
    );
  });

  it('should extend TTL by specified hours', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const initialExpiry = now + 1000 * 60 * 60; // 1 hour from now
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        expiresAt: new Date(initialExpiry).toISOString(),
      }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);

    await wmm.extendTTL(['wm_1'], 24);

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        expiresAt: expect.any(String),
        lastModified: expect.any(String),
      })
    );
  });

  it('should extend from now if already expired', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const expiredDate = new Date(now - 1000).toISOString();
    const entities = [
      createAgentEntity('wm_expired', 'session_1', { expiresAt: expiredDate }),
    ];
    storage = createMockStorage(entities);
    wmm = new WorkingMemoryManager(storage);

    await wmm.extendTTL(['wm_expired'], 24);

    // Should have been called with a future date
    expect(storage.updateEntity).toHaveBeenCalled();
  });
});

// ==================== markForPromotion Tests ====================

describe('WorkingMemoryManager.markForPromotion', () => {
  it('should mark entity for promotion', async () => {
    const entities = [createAgentEntity('wm_1', 'session_1')];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.markForPromotion('wm_1');

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        markedForPromotion: true,
      })
    );
  });

  it('should throw for non-existent entity', async () => {
    const storage = createMockStorage([]);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.markForPromotion('non_existent')).rejects.toThrow(
      'Entity not found: non_existent'
    );
  });

  it('should add target type tag when specified', async () => {
    const entities = [createAgentEntity('wm_1', 'session_1', { tags: ['existing'] })];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.markForPromotion('wm_1', { targetType: 'semantic' });

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        markedForPromotion: true,
        tags: expect.arrayContaining(['existing', 'promote_to_semantic']),
      })
    );
  });

  it('should add promote_to_episodic tag when targetType is episodic', async () => {
    const entities = [createAgentEntity('wm_1', 'session_1')];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.markForPromotion('wm_1', { targetType: 'episodic' });

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        tags: expect.arrayContaining(['promote_to_episodic']),
      })
    );
  });

  it('should throw for non-AgentEntity', async () => {
    const storage = createMockStorage();
    const normalEntity = { name: 'normal_1', entityType: 'test', observations: [] };
    (storage.getEntityByName as ReturnType<typeof vi.fn>).mockReturnValue(normalEntity);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.markForPromotion('normal_1')).rejects.toThrow(
      'Entity is not an AgentEntity: normal_1'
    );
  });

  it('should throw for non-working memory entity', async () => {
    const entities = [
      createAgentEntity('episodic_1', 'session_1', { memoryType: 'episodic' }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.markForPromotion('episodic_1')).rejects.toThrow(
      'Entity is not working memory: episodic_1'
    );
  });
});

// ==================== getPromotionCandidates Tests ====================

describe('WorkingMemoryManager.getPromotionCandidates', () => {
  it('should return explicitly marked candidates', async () => {
    const entities = [
      createAgentEntity('wm_marked', 'session_1', { markedForPromotion: true }),
      createAgentEntity('wm_unmarked', 'session_1', { markedForPromotion: false }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const candidates = await wmm.getPromotionCandidates('session_1');

    expect(candidates.length).toBe(1);
    expect(candidates[0].name).toBe('wm_marked');
  });

  it('should return auto-promotion candidates when thresholds are met', async () => {
    const entities = [
      createAgentEntity('wm_qualify', 'session_1', {
        confidence: 0.9,
        confirmationCount: 3,
      }),
      createAgentEntity('wm_low_confidence', 'session_1', {
        confidence: 0.5,
        confirmationCount: 3,
      }),
      createAgentEntity('wm_low_confirm', 'session_1', {
        confidence: 0.9,
        confirmationCount: 1,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromote: true,
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const candidates = await wmm.getPromotionCandidates('session_1');

    expect(candidates.length).toBe(1);
    expect(candidates[0].name).toBe('wm_qualify');
  });

  it('should use custom criteria when provided', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.7,
        confirmationCount: 1,
        accessCount: 5,
      }),
      createAgentEntity('wm_2', 'session_1', {
        confidence: 0.6,
        confirmationCount: 1,
        accessCount: 2,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const candidates = await wmm.getPromotionCandidates('session_1', {
      minConfidence: 0.65,
      minConfirmations: 1,
      minAccessCount: 3,
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0].name).toBe('wm_1');
  });

  it('should sort candidates by priority (marked first, then by scores)', async () => {
    // Marked entity also meets thresholds, so it gets +100 (marked) plus score-based priority
    const entities = [
      createAgentEntity('wm_marked', 'session_1', {
        markedForPromotion: true,
        confidence: 0.85,
        confirmationCount: 2,
        accessCount: 0,
      }),
      createAgentEntity('wm_high_score', 'session_1', {
        confidence: 0.95,
        confirmationCount: 5,
        accessCount: 20,
      }),
      createAgentEntity('wm_medium_score', 'session_1', {
        confidence: 0.85,
        confirmationCount: 3,
        accessCount: 10,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const candidates = await wmm.getPromotionCandidates('session_1');

    // Marked gets +100 priority bonus, so it should be first
    // wm_marked: 100 + (0.85*50=42.5) + (2*10=20) + 0 = 162.5
    // wm_high_score: (0.95*50=47.5) + (5*10=50) + 20 = 117.5
    // wm_medium_score: (0.85*50=42.5) + (3*10=30) + 10 = 82.5
    expect(candidates.length).toBe(3);
    expect(candidates[0].name).toBe('wm_marked');
    expect(candidates[1].name).toBe('wm_high_score');
    expect(candidates[2].name).toBe('wm_medium_score');
  });

  it('should exclude marked candidates when includeMarked is false', async () => {
    // wm_marked_only only qualifies due to being marked, not thresholds
    // wm_threshold qualifies via thresholds but is not marked
    const entities = [
      createAgentEntity('wm_marked_only', 'session_1', {
        markedForPromotion: true,
        confidence: 0.5, // Below threshold
        confirmationCount: 1, // Below threshold
      }),
      createAgentEntity('wm_threshold', 'session_1', {
        confidence: 0.9,
        confirmationCount: 3,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const candidates = await wmm.getPromotionCandidates('session_1', {
      includeMarked: false,
    });

    // Only wm_threshold should be included since includeMarked:false excludes wm_marked_only
    expect(candidates.length).toBe(1);
    expect(candidates[0].name).toBe('wm_threshold');
  });

  it('should return empty when no candidates meet criteria', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.5,
        confirmationCount: 0,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const candidates = await wmm.getPromotionCandidates('session_1');
    expect(candidates.length).toBe(0);
  });
});

// ==================== promoteMemory Tests ====================

describe('WorkingMemoryManager.promoteMemory', () => {
  it('should promote working memory to episodic by default', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { tags: ['tag1'] }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const result = await wmm.promoteMemory('wm_1');

    expect(result.entityName).toBe('wm_1');
    expect(result.fromType).toBe('working');
    expect(result.toType).toBe('episodic');
    expect(result.promotedAt).toBeDefined();
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        memoryType: 'episodic',
        promotedAt: expect.any(String),
        promotedFrom: 'session_1',
      })
    );
  });

  it('should promote working memory to semantic when specified', async () => {
    const entities = [createAgentEntity('wm_1', 'session_1')];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const result = await wmm.promoteMemory('wm_1', 'semantic');

    expect(result.toType).toBe('semantic');
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        memoryType: 'semantic',
      })
    );
  });

  it('should clear working memory fields on promotion', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        expiresAt: new Date().toISOString(),
        isWorkingMemory: true,
        markedForPromotion: true,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.promoteMemory('wm_1');

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        expiresAt: undefined,
        isWorkingMemory: undefined,
        markedForPromotion: undefined,
      })
    );
  });

  it('should remove promotion target tags on promotion', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        tags: ['keep_tag', 'promote_to_semantic', 'promote_to_episodic'],
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.promoteMemory('wm_1');

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        tags: ['keep_tag'],
      })
    );
  });

  it('should remove entity from session index after promotion', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);

    const memory = await wmm.createWorkingMemory('session_1', 'Test content');
    expect(wmm.getSessionMemoryCount('session_1')).toBe(1);

    await wmm.promoteMemory(memory.name);
    expect(wmm.getSessionMemoryCount('session_1')).toBe(0);
  });

  it('should throw for non-existent entity', async () => {
    const storage = createMockStorage([]);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.promoteMemory('non_existent')).rejects.toThrow(
      'Entity not found: non_existent'
    );
  });

  it('should throw for non-AgentEntity', async () => {
    const storage = createMockStorage();
    const normalEntity = { name: 'normal_1', entityType: 'test', observations: [] };
    (storage.getEntityByName as ReturnType<typeof vi.fn>).mockReturnValue(normalEntity);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.promoteMemory('normal_1')).rejects.toThrow(
      'Entity is not an AgentEntity: normal_1'
    );
  });

  it('should throw for non-working memory entity', async () => {
    const entities = [
      createAgentEntity('episodic_1', 'session_1', { memoryType: 'episodic' }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.promoteMemory('episodic_1')).rejects.toThrow(
      'Entity is not working memory: episodic_1'
    );
  });
});

// ==================== confirmMemory Tests ====================

describe('WorkingMemoryManager.confirmMemory', () => {
  it('should increment confirmation count', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { confirmationCount: 0 }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    const result = await wmm.confirmMemory('wm_1');

    expect(result.confirmed).toBe(true);
    expect(result.promoted).toBe(false);
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        confirmationCount: 1,
      })
    );
  });

  it('should apply confidence boost when provided', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { confidence: 0.5 }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.confirmMemory('wm_1', 0.2);

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        confidence: 0.7,
      })
    );
  });

  it('should cap confidence at 1.0', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { confidence: 0.9 }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.confirmMemory('wm_1', 0.5);

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        confidence: 1.0,
      })
    );
  });

  it('should not apply negative confidence boost', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', { confidence: 0.5 }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await wmm.confirmMemory('wm_1', -0.2);

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'wm_1',
      expect.objectContaining({
        confidence: 0.5, // Unchanged
      })
    );
  });

  it('should trigger auto-promotion when thresholds met and enabled', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.8,
        confirmationCount: 1,
        sessionId: 'session_1',
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromote: true,
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const result = await wmm.confirmMemory('wm_1');

    expect(result.confirmed).toBe(true);
    expect(result.promoted).toBe(true);
    // Should have called updateEntity twice: once for confirm, once for promote
    expect(storage.updateEntity).toHaveBeenCalledTimes(2);
  });

  it('should not auto-promote when autoPromote is disabled', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.9,
        confirmationCount: 10,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromote: false,
    });

    const result = await wmm.confirmMemory('wm_1');

    expect(result.confirmed).toBe(true);
    expect(result.promoted).toBe(false);
    expect(storage.updateEntity).toHaveBeenCalledTimes(1);
  });

  it('should not auto-promote when confidence threshold not met', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.5,
        confirmationCount: 10,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromote: true,
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });

    const result = await wmm.confirmMemory('wm_1');

    expect(result.promoted).toBe(false);
  });

  it('should not auto-promote when confirmation threshold not met', async () => {
    const entities = [
      createAgentEntity('wm_1', 'session_1', {
        confidence: 0.9,
        confirmationCount: 0,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage, {
      autoPromote: true,
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 3,
    });

    const result = await wmm.confirmMemory('wm_1');

    expect(result.promoted).toBe(false); // Only 1 confirmation after increment
  });

  it('should throw for non-existent entity', async () => {
    const storage = createMockStorage([]);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.confirmMemory('non_existent')).rejects.toThrow(
      'Entity not found: non_existent'
    );
  });

  it('should throw for non-AgentEntity', async () => {
    const storage = createMockStorage();
    const normalEntity = { name: 'normal_1', entityType: 'test', observations: [] };
    (storage.getEntityByName as ReturnType<typeof vi.fn>).mockReturnValue(normalEntity);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.confirmMemory('normal_1')).rejects.toThrow(
      'Entity is not an AgentEntity: normal_1'
    );
  });

  it('should throw for non-working memory entity', async () => {
    const entities = [
      createAgentEntity('episodic_1', 'session_1', { memoryType: 'episodic' }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);

    await expect(wmm.confirmMemory('episodic_1')).rejects.toThrow(
      'Entity is not working memory: episodic_1'
    );
  });
});

// ==================== Helper Tests ====================

describe('WorkingMemoryManager Helpers', () => {
  it('should return session count', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);

    await wmm.createWorkingMemory('session_1', 'Content');
    await wmm.createWorkingMemory('session_2', 'Content');

    expect(wmm.getSessionCount()).toBe(2);
  });

  it('should return memory count for session', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);

    await wmm.createWorkingMemory('session_1', 'Content 1');
    await wmm.createWorkingMemory('session_1', 'Content 2');
    await wmm.createWorkingMemory('session_2', 'Content 1');

    expect(wmm.getSessionMemoryCount('session_1')).toBe(2);
    expect(wmm.getSessionMemoryCount('session_2')).toBe(1);
    expect(wmm.getSessionMemoryCount('unknown')).toBe(0);
  });
});
