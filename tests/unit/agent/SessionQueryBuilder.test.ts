/**
 * Unit tests for SessionQueryBuilder
 *
 * Tests session-scoped query building including:
 * - Session filtering
 * - Temporal queries
 * - Cross-session search
 * - Entity with context retrieval
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionQueryBuilder,
} from '../../../src/agent/SessionQueryBuilder.js';
import { SessionManager } from '../../../src/agent/SessionManager.js';
import { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { IGraphStorage, Entity, KnowledgeGraph } from '../../../src/types/types.js';
import type { AgentEntity, SessionEntity, MemoryType } from '../../../src/types/agent-memory.js';

// ==================== Mock Storage ====================

function createMockStorage(entities: Entity[] = []): IGraphStorage {
  const entityMap = new Map<string, Entity>(entities.map((e) => [e.name, e]));
  let graphEntities = [...entities];
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
  return {
    name,
    entityType: 'memory',
    observations: ['Test content'],
    memoryType: 'working' as MemoryType,
    sessionId,
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
    createdAt: now,
    lastModified: now,
    lastAccessedAt: now,
    importance: 5,
    ...overrides,
  } as AgentEntity;
}

function createSessionEntity(
  sessionId: string,
  overrides: Partial<SessionEntity> = {}
): SessionEntity {
  const now = new Date().toISOString();
  return {
    name: sessionId,
    entityType: 'session',
    observations: [],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'episodic' as MemoryType,
    sessionId,
    accessCount: 0,
    lastAccessedAt: now,
    confidence: 1.0,
    confirmationCount: 0,
    visibility: 'private',
    agentId: 'default',
    startedAt: now,
    status: 'active',
    memoryCount: 0,
    consolidatedCount: 0,
    ...overrides,
  } as SessionEntity;
}

// ==================== Constructor Tests ====================

describe('SessionQueryBuilder Constructor', () => {
  it('should create instance', () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    expect(builder).toBeInstanceOf(SessionQueryBuilder);
  });
});

// ==================== Session Scoping Tests ====================

describe('SessionQueryBuilder Session Scoping', () => {
  let storage: IGraphStorage;
  let sm: SessionManager;
  let builder: SessionQueryBuilder;

  beforeEach(() => {
    const entities = [
      createAgentEntity('mem_1', 'session_1', { observations: ['hotels in Tokyo'] }),
      createAgentEntity('mem_2', 'session_1', { observations: ['budget options'] }),
      createAgentEntity('mem_3', 'session_2', { observations: ['hotels in Paris'] }),
    ];
    const sessions = [
      createSessionEntity('session_1', { relatedSessionIds: ['session_2'] }),
      createSessionEntity('session_2', { relatedSessionIds: ['session_1'] }),
    ];
    storage = createMockStorage([...entities, ...sessions as Entity[]]);
    const wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
    builder = new SessionQueryBuilder(storage, sm);
  });

  it('should filter by single session', async () => {
    const results = await builder.forSession('session_1').search('hotels');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_1');
  });

  it('should include related sessions when requested', async () => {
    const results = await builder
      .forSession('session_1')
      .withRelatedSessions()
      .search('hotels');

    expect(results.length).toBe(2);
    expect(results.map((r) => r.name)).toContain('mem_1');
    expect(results.map((r) => r.name)).toContain('mem_3');
  });

  it('should filter by multiple sessions', async () => {
    const results = await builder
      .forSessions(['session_1', 'session_2'])
      .search('hotels');

    expect(results.length).toBe(2);
  });
});

// ==================== Temporal Query Tests ====================

describe('SessionQueryBuilder Temporal Queries', () => {
  let storage: IGraphStorage;
  let sm: SessionManager;
  let builder: SessionQueryBuilder;

  beforeEach(() => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const entities = [
      createAgentEntity('mem_today', 'session_1', {
        observations: ['hotel search'],
        createdAt: now.toISOString(),
      }),
      createAgentEntity('mem_yesterday', 'session_1', {
        observations: ['hotel booking'],
        createdAt: yesterday.toISOString(),
      }),
      createAgentEntity('mem_old', 'session_1', {
        observations: ['hotel info'],
        createdAt: lastWeek.toISOString(),
      }),
    ];
    storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
    builder = new SessionQueryBuilder(storage, sm);
  });

  it('should filter to today only', async () => {
    const results = await builder.createdToday().search('hotel');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_today');
  });

  it('should filter to last N hours', async () => {
    const results = await builder.createdInLastHours(12).search('hotel');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_today');
  });

  it('should filter to last N days', async () => {
    const results = await builder.createdInLastDays(3).search('hotel');

    expect(results.length).toBe(2);
    expect(results.map((r) => r.name)).toContain('mem_today');
    expect(results.map((r) => r.name)).toContain('mem_yesterday');
  });

  it('should filter by time range', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const results = await builder
      .inTimeRange(twoDaysAgo.toISOString(), now.toISOString())
      .search('hotel');

    expect(results.length).toBe(2);
  });
});

// ==================== Task Filtering Tests ====================

describe('SessionQueryBuilder Task Filtering', () => {
  it('should filter by task ID', async () => {
    const entities = [
      createAgentEntity('mem_1', 'session_1', {
        observations: ['hotel in Tokyo'],
        taskId: 'trip_planning',
      }),
      createAgentEntity('mem_2', 'session_1', {
        observations: ['hotel reviews'],
        taskId: 'research',
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.withTaskId('trip_planning').search('hotel');

    expect(results.length).toBe(1);
    expect(results[0].taskId).toBe('trip_planning');
  });
});

// ==================== Importance Filtering Tests ====================

describe('SessionQueryBuilder Importance Filtering', () => {
  it('should filter by importance range', async () => {
    const entities = [
      createAgentEntity('mem_low', 'session_1', {
        observations: ['low importance'],
        importance: 2,
      }),
      createAgentEntity('mem_mid', 'session_1', {
        observations: ['medium importance'],
        importance: 5,
      }),
      createAgentEntity('mem_high', 'session_1', {
        observations: ['high importance'],
        importance: 9,
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.withImportance(4, 7).search('importance');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_mid');
  });

  it('should filter by minimum importance', async () => {
    const entities = [
      createAgentEntity('mem_low', 'session_1', { importance: 2 }),
      createAgentEntity('mem_high', 'session_1', { importance: 8 }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.withImportance(5).execute();

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_high');
  });
});

// ==================== Type Filtering Tests ====================

describe('SessionQueryBuilder Type Filtering', () => {
  it('should filter by memory types', async () => {
    const entities = [
      createAgentEntity('mem_working', 'session_1', { memoryType: 'working' }),
      createAgentEntity('mem_episodic', 'session_1', { memoryType: 'episodic' }),
      createAgentEntity('mem_semantic', 'session_1', { memoryType: 'semantic' }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.ofTypes('episodic', 'semantic').execute();

    expect(results.length).toBe(2);
    expect(results.map((r) => r.memoryType)).toContain('episodic');
    expect(results.map((r) => r.memoryType)).toContain('semantic');
  });
});

// ==================== Pagination Tests ====================

describe('SessionQueryBuilder Pagination', () => {
  it('should apply limit', async () => {
    const entities = [
      createAgentEntity('mem_1', 'session_1'),
      createAgentEntity('mem_2', 'session_1'),
      createAgentEntity('mem_3', 'session_1'),
      createAgentEntity('mem_4', 'session_1'),
      createAgentEntity('mem_5', 'session_1'),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.withLimit(3).execute();

    expect(results.length).toBe(3);
  });

  it('should apply offset', async () => {
    const entities = [
      createAgentEntity('mem_1', 'session_1'),
      createAgentEntity('mem_2', 'session_1'),
      createAgentEntity('mem_3', 'session_1'),
      createAgentEntity('mem_4', 'session_1'),
      createAgentEntity('mem_5', 'session_1'),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder.withOffset(2).withLimit(2).execute();

    expect(results.length).toBe(2);
  });
});

// ==================== Combined Filters Tests ====================

describe('SessionQueryBuilder Combined Filters', () => {
  it('should apply multiple filters', async () => {
    const now = new Date();
    const entities = [
      createAgentEntity('mem_match', 'session_1', {
        observations: ['hotel booking'],
        taskId: 'planning',
        importance: 7,
        memoryType: 'working',
        createdAt: now.toISOString(),
      }),
      createAgentEntity('mem_wrong_task', 'session_1', {
        observations: ['hotel info'],
        taskId: 'research',
        importance: 7,
        memoryType: 'working',
        createdAt: now.toISOString(),
      }),
      createAgentEntity('mem_wrong_session', 'session_2', {
        observations: ['hotel search'],
        taskId: 'planning',
        importance: 7,
        memoryType: 'working',
        createdAt: now.toISOString(),
      }),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder
      .forSession('session_1')
      .withTaskId('planning')
      .withImportance(5, 10)
      .ofTypes('working')
      .createdToday()
      .search('hotel');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('mem_match');
  });
});

// ==================== Entity With Context Tests ====================

describe('SessionQueryBuilder.getEntityWithContext', () => {
  it('should return entity with session', async () => {
    const session = createSessionEntity('session_1');
    const entity = createAgentEntity('mem_1', 'session_1');
    const storage = createMockStorage([entity, session as Entity]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const result = await builder.getEntityWithContext('mem_1');

    expect(result).toBeDefined();
    expect(result?.entity.name).toBe('mem_1');
    expect(result?.session?.name).toBe('session_1');
  });

  it('should include related sessions when requested', async () => {
    const session1 = createSessionEntity('session_1', {
      relatedSessionIds: ['session_2', 'session_3'],
    });
    const session2 = createSessionEntity('session_2');
    const session3 = createSessionEntity('session_3');
    const entity = createAgentEntity('mem_1', 'session_1');
    const storage = createMockStorage([
      entity,
      session1 as Entity,
      session2 as Entity,
      session3 as Entity,
    ]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const result = await builder.getEntityWithContext('mem_1', true);

    expect(result?.relatedSessions?.length).toBe(2);
  });

  it('should return undefined for non-existent entity', async () => {
    const storage = createMockStorage([]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const result = await builder.getEntityWithContext('non_existent');

    expect(result).toBeUndefined();
  });
});

// ==================== Recency Ranking Tests ====================

describe('SessionQueryBuilder.searchWithRecencyRanking', () => {
  it('should search across sessions', async () => {
    const sessions = [
      createSessionEntity('session_1', { startedAt: '2026-01-13T10:00:00Z' }),
      createSessionEntity('session_2', { startedAt: '2026-01-12T10:00:00Z' }),
    ];
    const entities = [
      createAgentEntity('mem_1', 'session_1', { observations: ['hotel search'] }),
      createAgentEntity('mem_2', 'session_2', { observations: ['hotel booking'] }),
    ];
    const storage = createMockStorage([...entities, ...sessions as Entity[]]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    const results = await builder
      .forSessions(['session_1', 'session_2'])
      .searchWithRecencyRanking('hotel');

    expect(results.length).toBe(2);
    // More recent session should be ranked higher
    expect(results[0].sessionId).toBe('session_1');
  });
});

// ==================== Reset Tests ====================

describe('SessionQueryBuilder.reset', () => {
  it('should reset all filters', async () => {
    const entities = [
      createAgentEntity('mem_1', 'session_1'),
      createAgentEntity('mem_2', 'session_2'),
    ];
    const storage = createMockStorage(entities);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);
    const builder = new SessionQueryBuilder(storage, sm);

    // First query with filters
    await builder.forSession('session_1').execute();

    // Reset and query again without filters
    const results = await builder.reset().execute();

    expect(results.length).toBe(2);
  });
});
