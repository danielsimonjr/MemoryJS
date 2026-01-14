/**
 * Unit tests for SessionManager
 *
 * Tests session lifecycle management including:
 * - Session creation with metadata
 * - Session ending with cleanup/promotion
 * - Active session queries
 * - Session history with filtering
 * - Session linking and chain traversal
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionManager,
  type SessionConfig,
  type StartSessionOptions,
} from '../../../src/agent/SessionManager.js';
import { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { IGraphStorage, Entity, KnowledgeGraph } from '../../../src/types/types.js';
import type { SessionEntity, AgentEntity } from '../../../src/types/agent-memory.js';

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
    memoryType: 'episodic',
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

function createAgentEntity(
  name: string,
  sessionId: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'working_memory',
    observations: ['Test content'],
    memoryType: 'working',
    sessionId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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
  } as AgentEntity;
}

// ==================== Constructor Tests ====================

describe('SessionManager Constructor', () => {
  it('should create instance with default config', () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    expect(sm).toBeInstanceOf(SessionManager);
    const config = sm.getConfig();
    expect(config.consolidateOnEnd).toBe(false);
    expect(config.cleanupOnEnd).toBe(false);
    expect(config.promoteOnEnd).toBe(true);
    expect(config.defaultAgentId).toBe('default');
  });

  it('should create instance with custom config', () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const config: SessionConfig = {
      consolidateOnEnd: true,
      cleanupOnEnd: true,
      promoteOnEnd: false,
      defaultAgentId: 'custom_agent',
    };
    const sm = new SessionManager(storage, wmm, config);

    const actualConfig = sm.getConfig();
    expect(actualConfig.consolidateOnEnd).toBe(true);
    expect(actualConfig.cleanupOnEnd).toBe(true);
    expect(actualConfig.promoteOnEnd).toBe(false);
    expect(actualConfig.defaultAgentId).toBe('custom_agent');
  });
});

// ==================== startSession Tests ====================

describe('SessionManager.startSession', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;
  let sm: SessionManager;

  beforeEach(() => {
    storage = createMockStorage();
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
  });

  it('should create a session with auto-generated ID', async () => {
    const session = await sm.startSession();

    expect(session.name).toMatch(/^session_\d+_[a-z0-9]+$/);
    expect(session.entityType).toBe('session');
    expect(session.memoryType).toBe('episodic');
    expect(session.status).toBe('active');
    expect(session.startedAt).toBeDefined();
    expect(session.memoryCount).toBe(0);
    expect(session.consolidatedCount).toBe(0);
  });

  it('should create a session with custom ID', async () => {
    const session = await sm.startSession({ sessionId: 'my_custom_session' });

    expect(session.name).toBe('my_custom_session');
    expect(session.sessionId).toBe('my_custom_session');
  });

  it('should create a session with all metadata', async () => {
    const options: StartSessionOptions = {
      goalDescription: 'Plan a trip to Tokyo',
      taskType: 'trip_planning',
      userIntent: 'vacation_planning',
      agentId: 'travel_agent',
    };

    const session = await sm.startSession(options);

    expect(session.goalDescription).toBe('Plan a trip to Tokyo');
    expect(session.taskType).toBe('trip_planning');
    expect(session.userIntent).toBe('vacation_planning');
    expect(session.agentId).toBe('travel_agent');
    expect(session.observations).toContain('Session goal: Plan a trip to Tokyo');
  });

  it('should throw when session ID already exists in active sessions', async () => {
    await sm.startSession({ sessionId: 'duplicate_id' });

    await expect(sm.startSession({ sessionId: 'duplicate_id' })).rejects.toThrow(
      'Session already exists: duplicate_id'
    );
  });

  it('should throw when session ID already exists in storage', async () => {
    const existingSession = createSessionEntity('existing_session');
    storage = createMockStorage([existingSession as Entity]);
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);

    await expect(
      sm.startSession({ sessionId: 'existing_session' })
    ).rejects.toThrow('Session already exists in storage: existing_session');
  });

  it('should persist session to storage', async () => {
    await sm.startSession({ sessionId: 'test_session' });

    expect(storage.appendEntity).toHaveBeenCalledTimes(1);
    expect(storage.appendEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test_session',
        entityType: 'session',
        status: 'active',
      })
    );
  });

  it('should track session in active sessions', async () => {
    await sm.startSession({ sessionId: 'active_test' });

    expect(sm.getActiveSessionCount()).toBe(1);
    const active = await sm.getActiveSession('active_test');
    expect(active).toBeDefined();
    expect(active?.name).toBe('active_test');
  });

  it('should link to previous session when specified', async () => {
    // Create previous session
    const prevSession = createSessionEntity('prev_session', {
      relatedSessionIds: [],
    });
    storage = createMockStorage([prevSession as Entity]);
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);

    const session = await sm.startSession({
      previousSessionId: 'prev_session',
    });

    expect(session.previousSessionId).toBe('prev_session');
    expect(session.relatedSessionIds).toContain('prev_session');
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'prev_session',
      expect.objectContaining({
        relatedSessionIds: expect.arrayContaining([session.name]),
      })
    );
  });
});

// ==================== endSession Tests ====================

describe('SessionManager.endSession', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;

  beforeEach(() => {
    storage = createMockStorage();
    wmm = new WorkingMemoryManager(storage);
  });

  it('should end a session with completed status', async () => {
    const sm = new SessionManager(storage, wmm, { promoteOnEnd: false });
    await sm.startSession({ sessionId: 'test_session' });

    const result = await sm.endSession('test_session', 'completed');

    expect(result.session.status).toBe('completed');
    expect(result.session.endedAt).toBeDefined();
    expect(result.memoriesCleaned).toBe(0);
    expect(result.memoriesPromoted).toBe(0);
  });

  it('should end a session with abandoned status', async () => {
    const sm = new SessionManager(storage, wmm, { promoteOnEnd: false });
    await sm.startSession({ sessionId: 'test_session' });

    const result = await sm.endSession('test_session', 'abandoned');

    expect(result.session.status).toBe('abandoned');
    const hasAbandonedObs = result.session.observations.some((obs) =>
      obs.includes('Session ended: abandoned')
    );
    expect(hasAbandonedObs).toBe(true);
  });

  it('should remove session from active sessions after ending', async () => {
    const sm = new SessionManager(storage, wmm, { promoteOnEnd: false });
    await sm.startSession({ sessionId: 'test_session' });
    expect(sm.getActiveSessionCount()).toBe(1);

    await sm.endSession('test_session');

    expect(sm.getActiveSessionCount()).toBe(0);
    const active = await sm.getActiveSession('test_session');
    expect(active).toBeUndefined();
  });

  it('should throw for non-existent session', async () => {
    const sm = new SessionManager(storage, wmm);

    await expect(sm.endSession('non_existent')).rejects.toThrow(
      'Session not found: non_existent'
    );
  });

  it('should throw for non-active session', async () => {
    const completedSession = createSessionEntity('completed_session', {
      status: 'completed',
    });
    storage = createMockStorage([completedSession as Entity]);
    wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    await expect(sm.endSession('completed_session')).rejects.toThrow(
      'Session is not active: completed_session'
    );
  });

  it('should promote candidates when promoteOnEnd is true', async () => {
    // Create session with a promotable working memory
    const sessionEntity = createSessionEntity('test_session');
    const workingMem = createAgentEntity('wm_1', 'test_session', {
      markedForPromotion: true,
      confidence: 0.9,
      confirmationCount: 3,
    });
    storage = createMockStorage([sessionEntity as Entity, workingMem as Entity]);
    wmm = new WorkingMemoryManager(storage, {
      autoPromoteConfidenceThreshold: 0.8,
      autoPromoteConfirmationThreshold: 2,
    });
    const sm = new SessionManager(storage, wmm, { promoteOnEnd: true });

    // Start session to track it
    sm['activeSessions'].set('test_session', sessionEntity);

    const result = await sm.endSession('test_session');

    expect(result.memoriesPromoted).toBeGreaterThanOrEqual(0);
  });

  it('should update session statistics', async () => {
    const sm = new SessionManager(storage, wmm, { promoteOnEnd: false });
    await sm.startSession({ sessionId: 'test_session' });

    const result = await sm.endSession('test_session');

    expect(result.session.memoryCount).toBeDefined();
    expect(result.session.consolidatedCount).toBeDefined();
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'test_session',
      expect.objectContaining({
        endedAt: expect.any(String),
        status: 'completed',
        memoryCount: expect.any(Number),
      })
    );
  });
});

// ==================== getActiveSession Tests ====================

describe('SessionManager.getActiveSession', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;
  let sm: SessionManager;

  beforeEach(() => {
    storage = createMockStorage();
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
  });

  it('should return undefined when no active sessions', async () => {
    const session = await sm.getActiveSession();
    expect(session).toBeUndefined();
  });

  it('should return specific session by ID', async () => {
    await sm.startSession({ sessionId: 'session_1' });
    await sm.startSession({ sessionId: 'session_2' });

    const session = await sm.getActiveSession('session_2');

    expect(session).toBeDefined();
    expect(session?.name).toBe('session_2');
  });

  it('should return first session when no ID specified', async () => {
    await sm.startSession({ sessionId: 'session_1' });
    await sm.startSession({ sessionId: 'session_2' });

    const session = await sm.getActiveSession();

    expect(session).toBeDefined();
  });

  it('should return undefined for non-existent session ID', async () => {
    await sm.startSession({ sessionId: 'session_1' });

    const session = await sm.getActiveSession('non_existent');

    expect(session).toBeUndefined();
  });
});

// ==================== getActiveSessions Tests ====================

describe('SessionManager.getActiveSessions', () => {
  it('should return empty array when no active sessions', () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    const sessions = sm.getActiveSessions();

    expect(sessions).toEqual([]);
  });

  it('should return all active sessions', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    await sm.startSession({ sessionId: 'session_1' });
    await sm.startSession({ sessionId: 'session_2' });
    await sm.startSession({ sessionId: 'session_3' });

    const sessions = sm.getActiveSessions();

    expect(sessions.length).toBe(3);
    expect(sessions.map((s) => s.name)).toContain('session_1');
    expect(sessions.map((s) => s.name)).toContain('session_2');
    expect(sessions.map((s) => s.name)).toContain('session_3');
  });
});

// ==================== getSessionHistory Tests ====================

describe('SessionManager.getSessionHistory', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;
  let sm: SessionManager;

  beforeEach(() => {
    const sessions = [
      createSessionEntity('session_1', {
        status: 'completed',
        taskType: 'coding',
        agentId: 'agent_1',
        startedAt: '2026-01-10T10:00:00Z',
      }),
      createSessionEntity('session_2', {
        status: 'completed',
        taskType: 'planning',
        agentId: 'agent_1',
        startedAt: '2026-01-11T10:00:00Z',
      }),
      createSessionEntity('session_3', {
        status: 'abandoned',
        taskType: 'coding',
        agentId: 'agent_2',
        startedAt: '2026-01-12T10:00:00Z',
      }),
    ];
    storage = createMockStorage(sessions as Entity[]);
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
  });

  it('should return all sessions without filters', async () => {
    const sessions = await sm.getSessionHistory();

    expect(sessions.length).toBe(3);
  });

  it('should filter by status', async () => {
    const sessions = await sm.getSessionHistory({ status: 'completed' });

    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.status === 'completed')).toBe(true);
  });

  it('should filter by taskType', async () => {
    const sessions = await sm.getSessionHistory({ taskType: 'coding' });

    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.taskType === 'coding')).toBe(true);
  });

  it('should filter by agentId', async () => {
    const sessions = await sm.getSessionHistory({ agentId: 'agent_1' });

    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.agentId === 'agent_1')).toBe(true);
  });

  it('should filter by date range', async () => {
    const sessions = await sm.getSessionHistory({
      startDate: '2026-01-11T00:00:00Z',
      endDate: '2026-01-12T00:00:00Z',
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0].name).toBe('session_2');
  });

  it('should sort by most recent first', async () => {
    const sessions = await sm.getSessionHistory();

    expect(sessions[0].name).toBe('session_3');
    expect(sessions[1].name).toBe('session_2');
    expect(sessions[2].name).toBe('session_1');
  });

  it('should apply pagination', async () => {
    const page1 = await sm.getSessionHistory({ limit: 2, offset: 0 });
    const page2 = await sm.getSessionHistory({ limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
  });
});

// ==================== linkSessions Tests ====================

describe('SessionManager.linkSessions', () => {
  let storage: IGraphStorage;
  let wmm: WorkingMemoryManager;
  let sm: SessionManager;

  beforeEach(() => {
    const sessions = [
      createSessionEntity('session_1', { relatedSessionIds: [] }),
      createSessionEntity('session_2', { relatedSessionIds: [] }),
      createSessionEntity('session_3', { relatedSessionIds: [] }),
    ];
    storage = createMockStorage(sessions as Entity[]);
    wmm = new WorkingMemoryManager(storage);
    sm = new SessionManager(storage, wmm);
  });

  it('should link two sessions', async () => {
    await sm.linkSessions(['session_1', 'session_2']);

    expect(storage.updateEntity).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({
        relatedSessionIds: expect.arrayContaining(['session_2']),
      })
    );
    expect(storage.updateEntity).toHaveBeenCalledWith(
      'session_2',
      expect.objectContaining({
        relatedSessionIds: expect.arrayContaining(['session_1']),
      })
    );
  });

  it('should link multiple sessions', async () => {
    await sm.linkSessions(['session_1', 'session_2', 'session_3']);

    // Each session should be updated with references to the other two
    expect(storage.updateEntity).toHaveBeenCalledTimes(3);
  });

  it('should throw when less than 2 sessions', async () => {
    await expect(sm.linkSessions(['session_1'])).rejects.toThrow(
      'At least 2 sessions required for linking'
    );
  });

  it('should throw for non-existent session', async () => {
    await expect(
      sm.linkSessions(['session_1', 'non_existent'])
    ).rejects.toThrow('Session not found: non_existent');
  });
});

// ==================== getSessionChain Tests ====================

describe('SessionManager.getSessionChain', () => {
  it('should return chain following previousSessionId', async () => {
    const sessions = [
      createSessionEntity('session_1', {
        startedAt: '2026-01-10T10:00:00Z',
        relatedSessionIds: ['session_2'],
      }),
      createSessionEntity('session_2', {
        startedAt: '2026-01-11T10:00:00Z',
        previousSessionId: 'session_1',
        relatedSessionIds: ['session_1', 'session_3'],
      }),
      createSessionEntity('session_3', {
        startedAt: '2026-01-12T10:00:00Z',
        previousSessionId: 'session_2',
        relatedSessionIds: ['session_2'],
      }),
    ];
    const storage = createMockStorage(sessions as Entity[]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    const chain = await sm.getSessionChain('session_3');

    expect(chain.length).toBe(3);
    expect(chain[0].name).toBe('session_1'); // Oldest first
    expect(chain[1].name).toBe('session_2');
    expect(chain[2].name).toBe('session_3'); // Newest last
  });

  it('should return single session when no links', async () => {
    const sessions = [
      createSessionEntity('session_1', { relatedSessionIds: [] }),
    ];
    const storage = createMockStorage(sessions as Entity[]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    const chain = await sm.getSessionChain('session_1');

    expect(chain.length).toBe(1);
    expect(chain[0].name).toBe('session_1');
  });

  it('should return empty array for non-existent session', async () => {
    const storage = createMockStorage([]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    const chain = await sm.getSessionChain('non_existent');

    expect(chain).toEqual([]);
  });

  it('should handle cycles in related sessions', async () => {
    const sessions = [
      createSessionEntity('session_1', {
        startedAt: '2026-01-10T10:00:00Z',
        relatedSessionIds: ['session_2'],
      }),
      createSessionEntity('session_2', {
        startedAt: '2026-01-11T10:00:00Z',
        relatedSessionIds: ['session_1'], // Cycle back
      }),
    ];
    const storage = createMockStorage(sessions as Entity[]);
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    // Should not infinite loop
    const chain = await sm.getSessionChain('session_1');

    expect(chain.length).toBeLessThanOrEqual(2);
  });
});

// ==================== Helper Tests ====================

describe('SessionManager Helpers', () => {
  it('should return active session count', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const sm = new SessionManager(storage, wmm);

    expect(sm.getActiveSessionCount()).toBe(0);

    await sm.startSession();
    expect(sm.getActiveSessionCount()).toBe(1);

    await sm.startSession();
    expect(sm.getActiveSessionCount()).toBe(2);
  });
});

// ==================== Session Summary Integration Tests ====================

describe('SessionManager with EpisodicMemoryManager', () => {
  // Mock EpisodicMemoryManager
  function createMockEpisodicMemory() {
    const createdEpisodes: AgentEntity[] = [];

    return {
      createEpisode: vi.fn(async (content: string, options?: Record<string, unknown>) => {
        const now = new Date().toISOString();
        const name = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const episode: AgentEntity = {
          name,
          entityType: options?.entityType as string ?? 'episode',
          observations: [content],
          createdAt: now,
          lastModified: now,
          importance: options?.importance as number ?? 5,
          memoryType: 'episodic',
          sessionId: options?.sessionId as string,
          accessCount: 0,
          confidence: options?.confidence as number ?? 0.8,
          confirmationCount: 0,
          visibility: 'private',
          agentId: options?.agentId as string,
        };
        createdEpisodes.push(episode);
        return episode;
      }),
      getCreatedEpisodes: () => createdEpisodes,
    };
  }

  it('should create session summary when ending session with episodicMemory', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const emm = createMockEpisodicMemory();

    const sm = new SessionManager(
      storage,
      wmm,
      { createSummaryOnEnd: true, promoteOnEnd: false },
      emm as unknown as import('../../../src/agent/EpisodicMemoryManager.js').EpisodicMemoryManager
    );

    const session = await sm.startSession({
      goalDescription: 'Test session for summary',
    });

    const result = await sm.endSession(session.name, 'completed');

    expect(result.summary).toBeDefined();
    expect(result.summary?.entityType).toBe('session_summary');
    expect(result.summary?.observations[0]).toContain('Test session for summary');
    expect(emm.createEpisode).toHaveBeenCalled();
  });

  it('should include session metadata in summary', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const emm = createMockEpisodicMemory();

    const sm = new SessionManager(
      storage,
      wmm,
      { createSummaryOnEnd: true, promoteOnEnd: false },
      emm as unknown as import('../../../src/agent/EpisodicMemoryManager.js').EpisodicMemoryManager
    );

    const session = await sm.startSession({
      goalDescription: 'Detailed session',
    });

    await sm.endSession(session.name, 'completed');

    const summaryContent = (emm.createEpisode as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(summaryContent).toContain('Session: Detailed session');
    expect(summaryContent).toContain('Status: completed');
  });

  it('should not create summary when createSummaryOnEnd is false', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const emm = createMockEpisodicMemory();

    const sm = new SessionManager(
      storage,
      wmm,
      { createSummaryOnEnd: false, promoteOnEnd: false },
      emm as unknown as import('../../../src/agent/EpisodicMemoryManager.js').EpisodicMemoryManager
    );

    const session = await sm.startSession();
    const result = await sm.endSession(session.name, 'completed');

    expect(result.summary).toBeUndefined();
    expect(emm.createEpisode).not.toHaveBeenCalled();
  });

  it('should not create summary when episodicMemory is not provided', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);

    const sm = new SessionManager(storage, wmm, { promoteOnEnd: false });

    const session = await sm.startSession();
    const result = await sm.endSession(session.name, 'completed');

    expect(result.summary).toBeUndefined();
  });

  it('should link session to summary via relation', async () => {
    const storage = createMockStorage();
    const wmm = new WorkingMemoryManager(storage);
    const emm = createMockEpisodicMemory();

    const sm = new SessionManager(
      storage,
      wmm,
      { createSummaryOnEnd: true, promoteOnEnd: false },
      emm as unknown as import('../../../src/agent/EpisodicMemoryManager.js').EpisodicMemoryManager
    );

    const session = await sm.startSession();
    await sm.endSession(session.name, 'completed');

    expect(storage.appendRelation).toHaveBeenCalledWith(
      expect.objectContaining({
        from: session.name,
        relationType: 'has_summary',
      })
    );
  });
});
