/**
 * Unit tests for SessionCheckpointManager
 *
 * Tests session checkpointing and crash recovery including:
 * - Checkpoint creation and listing
 * - Checkpoint restoration
 * - Abnormal ending detection
 * - Sleep/wake lifecycle
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionCheckpointManager,
  type SessionCheckpointData,
} from '../../../src/agent/SessionCheckpoint.js';
import { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
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
  };
}

function createWorkingMemoryEntity(
  name: string,
  sessionId: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'working_memory',
    observations: ['some content'],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'working',
    sessionId,
    accessCount: 0,
    lastAccessedAt: now,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
    isWorkingMemory: true,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

// ==================== Tests ====================

describe('SessionCheckpointManager', () => {
  let storage: IGraphStorage;
  let workingMemory: WorkingMemoryManager;
  let decayEngine: DecayEngine;
  let accessTracker: AccessTracker;
  let manager: SessionCheckpointManager;

  let session: SessionEntity;
  let wm1: AgentEntity;
  let wm2: AgentEntity;

  beforeEach(() => {
    session = createSessionEntity('session_123');
    wm1 = createWorkingMemoryEntity('wm_session_123_1', 'session_123', { importance: 7 });
    wm2 = createWorkingMemoryEntity('wm_session_123_2', 'session_123', { importance: 3 });

    storage = createMockStorage([session as Entity, wm1 as Entity, wm2 as Entity]);
    workingMemory = new WorkingMemoryManager(storage);
    accessTracker = new AccessTracker(storage);
    decayEngine = new DecayEngine(storage, accessTracker);
    manager = new SessionCheckpointManager(storage, workingMemory, decayEngine);
  });

  // ==================== Checkpoint Creation ====================

  describe('checkpoint()', () => {
    it('should create a checkpoint for an active session', async () => {
      const cp = await manager.checkpoint('session_123');

      expect(cp.id).toMatch(/^checkpoint_session_123_\d+$/);
      expect(cp.sessionId).toBe('session_123');
      expect(cp.timestamp).toBeTruthy();
      expect(cp.state).toBeDefined();
      expect(cp.state.workingMemories).toBeDefined();
      expect(cp.state.decaySnapshot).toBeDefined();
      expect(cp.state.metadata).toBeDefined();
    });

    it('should store working memory state in checkpoint', async () => {
      const cp = await manager.checkpoint('session_123');

      expect(cp.state.workingMemories).toContain('wm_session_123_1');
      expect(cp.state.workingMemories).toContain('wm_session_123_2');
      expect(cp.state.decaySnapshot['wm_session_123_1']).toBeGreaterThan(0);
      expect(cp.state.decaySnapshot['wm_session_123_2']).toBeGreaterThan(0);
    });

    it('should support custom checkpoint name', async () => {
      const cp = await manager.checkpoint('session_123', 'before-experiment');

      expect(cp.name).toBe('before-experiment');
    });

    it('should store checkpoint as observation on session entity', async () => {
      await manager.checkpoint('session_123');

      expect(storage.updateEntity).toHaveBeenCalledWith(
        'session_123',
        expect.objectContaining({
          observations: expect.arrayContaining([
            expect.stringContaining('[CHECKPOINT]'),
          ]),
        })
      );
    });

    it('should throw if session not found', async () => {
      await expect(manager.checkpoint('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent'
      );
    });

    it('should throw if session is completed', async () => {
      session.status = 'completed';
      await expect(manager.checkpoint('session_123')).rejects.toThrow(
        "Cannot checkpoint session with status 'completed'"
      );
    });
  });

  // ==================== Checkpoint Listing ====================

  describe('listCheckpoints()', () => {
    it('should list checkpoints for a session', async () => {
      await manager.checkpoint('session_123', 'cp1');
      await manager.checkpoint('session_123', 'cp2');

      const checkpoints = await manager.listCheckpoints('session_123');

      expect(checkpoints).toHaveLength(2);
      // Newest first
      expect(checkpoints[0].name).toBe('cp2');
      expect(checkpoints[1].name).toBe('cp1');
    });

    it('should return empty array for session with no checkpoints', async () => {
      const checkpoints = await manager.listCheckpoints('session_123');
      expect(checkpoints).toHaveLength(0);
    });

    it('should throw if session not found', async () => {
      await expect(manager.listCheckpoints('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent'
      );
    });
  });

  // ==================== Checkpoint Restoration ====================

  describe('restore()', () => {
    it('should restore from a checkpoint', async () => {
      const cp = await manager.checkpoint('session_123');

      // Restore should reinforce working memories
      await manager.restore(cp.id);

      // Verify reinforceMemory was called for each working memory
      // DecayEngine.reinforceMemory calls storage.updateEntity
      // We verify via storage mock that it was called
      const updateCalls = (storage.updateEntity as ReturnType<typeof vi.fn>).mock.calls;
      const reinforcedNames = updateCalls
        .filter((call: unknown[]) =>
          (call[0] === 'wm_session_123_1' || call[0] === 'wm_session_123_2') &&
          (call[1] as Record<string, unknown>).lastAccessedAt !== undefined
        )
        .map((call: unknown[]) => call[0]);

      expect(reinforcedNames).toContain('wm_session_123_1');
      expect(reinforcedNames).toContain('wm_session_123_2');
    });

    it('should throw for non-existent checkpoint', async () => {
      await expect(manager.restore('checkpoint_nonexistent_12345')).rejects.toThrow(
        'Checkpoint not found: checkpoint_nonexistent_12345'
      );
    });

    it('should skip deleted working memories during restore', async () => {
      const cp = await manager.checkpoint('session_123');

      // Remove wm2 from storage
      (storage.getEntityByName as ReturnType<typeof vi.fn>).mockImplementation(
        (name: string) => {
          if (name === 'wm_session_123_2') return null;
          if (name === 'session_123') return session;
          if (name === 'wm_session_123_1') return wm1;
          return null;
        }
      );

      // Should not throw even though wm2 is gone
      await expect(manager.restore(cp.id)).resolves.not.toThrow();
    });
  });

  // ==================== Abnormal Ending Detection ====================

  describe('detectAbnormalEndings()', () => {
    it('should find stale active sessions', async () => {
      // Make session appear stale by setting lastModified to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      session.lastModified = twoHoursAgo;

      const stale = await manager.detectAbnormalEndings(3600000); // 1 hour threshold

      expect(stale).toHaveLength(1);
      expect(stale[0].name).toBe('session_123');
    });

    it('should not flag recently active sessions', async () => {
      // Session was just modified (created in beforeEach with current time)
      const stale = await manager.detectAbnormalEndings(3600000);

      expect(stale).toHaveLength(0);
    });

    it('should not flag completed sessions', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      session.status = 'completed';
      session.lastModified = twoHoursAgo;

      const stale = await manager.detectAbnormalEndings(3600000);

      expect(stale).toHaveLength(0);
    });

    it('should use default threshold of 1 hour', async () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      session.lastModified = thirtyMinAgo;

      const stale = await manager.detectAbnormalEndings();

      // 30 min is within 1 hour threshold
      expect(stale).toHaveLength(0);
    });
  });

  // ==================== Sleep / Wake ====================

  describe('sleep()', () => {
    it('should create checkpoint and suspend session', async () => {
      const checkpointId = await manager.sleep('session_123');

      expect(checkpointId).toMatch(/^checkpoint_session_123_\d+$/);
      expect(session.status).toBe('suspended');
    });

    it('should throw if session is not active', async () => {
      session.status = 'completed';

      await expect(manager.sleep('session_123')).rejects.toThrow(
        "Cannot sleep session with status 'completed'"
      );
    });

    it('should throw if session not found', async () => {
      await expect(manager.sleep('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent'
      );
    });
  });

  describe('wake()', () => {
    it('should restore and reactivate a suspended session', async () => {
      // First sleep
      const checkpointId = await manager.sleep('session_123');

      // Then wake
      await manager.wake('session_123');

      expect(session.status).toBe('active');
    });

    it('should wake with a specific checkpoint', async () => {
      // Create two checkpoints then sleep
      const cp1 = await manager.checkpoint('session_123', 'first');
      await manager.sleep('session_123');

      // Wake with the first checkpoint specifically
      await manager.wake('session_123', cp1.id);

      expect(session.status).toBe('active');
    });

    it('should throw if session is not suspended', async () => {
      await expect(manager.wake('session_123')).rejects.toThrow(
        "Cannot wake session with status 'active'"
      );
    });

    it('should throw if session not found', async () => {
      await expect(manager.wake('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent'
      );
    });

    it('should throw if no checkpoints available for suspended session', async () => {
      // Manually set to suspended without creating checkpoint
      session.status = 'suspended';

      await expect(manager.wake('session_123')).rejects.toThrow(
        'No checkpoints available for session: session_123'
      );
    });
  });

  // ==================== Sleep/Wake Cycle ====================

  describe('sleep/wake cycle', () => {
    it('should complete a full sleep/wake cycle', async () => {
      // Session starts active
      expect(session.status).toBe('active');

      // Sleep
      const checkpointId = await manager.sleep('session_123');
      expect(session.status).toBe('suspended');
      expect(checkpointId).toBeTruthy();

      // Wake
      await manager.wake('session_123');
      expect(session.status).toBe('active');
    });

    it('should preserve working memory across sleep/wake', async () => {
      // Sleep
      await manager.sleep('session_123');

      // Wake
      await manager.wake('session_123');

      // Both working memories should have been reinforced during restore
      const updateCalls = (storage.updateEntity as ReturnType<typeof vi.fn>).mock.calls;
      const reinforcedNames = new Set(
        updateCalls
          .filter((call: unknown[]) =>
            (call[0] === 'wm_session_123_1' || call[0] === 'wm_session_123_2') &&
            (call[1] as Record<string, unknown>).lastAccessedAt !== undefined
          )
          .map((call: unknown[]) => call[0])
      );

      expect(reinforcedNames.has('wm_session_123_1')).toBe(true);
      expect(reinforcedNames.has('wm_session_123_2')).toBe(true);
    });
  });
});
