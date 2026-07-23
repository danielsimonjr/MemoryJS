/**
 * Unit tests for SessionCheckpointManager (decomposed graph shape)
 *
 * Tests session checkpointing and crash recovery including:
 * - Decomposed checkpoint persistence (entities + relations)
 * - Roundtrip fidelity (including hostile strings via legacy migration)
 * - Checkpoint listing and latest-checkpoint semantics
 * - Checkpoint restoration
 * - Abnormal ending detection
 * - Sleep/wake lifecycle
 * - Legacy `[CHECKPOINT] {json}` blob auto-migration + bulk migrator
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import {
  SessionCheckpointManager,
  migrateLegacySessionCheckpoints,
  SESSION_CHECKPOINT_ENTITY_TYPE,
  HAS_CHECKPOINT_RELATION,
  SNAPSHOTS_RELATION,
  type SessionCheckpointData,
} from '../../../src/agent/SessionCheckpoint.js';
import { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { Entity } from '../../../src/types/types.js';
import type { SessionEntity, AgentEntity } from '../../../src/types/agent-memory.js';

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
  let testDir: string;
  let storage: GraphStorage;
  let entityManager: EntityManager;
  let relationManager: RelationManager;
  let workingMemory: WorkingMemoryManager;
  let decayEngine: DecayEngine;
  let accessTracker: AccessTracker;
  let manager: SessionCheckpointManager;

  let session: SessionEntity;
  let wm1: AgentEntity;
  let wm2: AgentEntity;

  function buildManager(): SessionCheckpointManager {
    entityManager = new EntityManager(storage);
    relationManager = new RelationManager(storage);
    workingMemory = new WorkingMemoryManager(storage);
    accessTracker = new AccessTracker(storage);
    decayEngine = new DecayEngine(storage, accessTracker);
    return new SessionCheckpointManager(
      storage,
      workingMemory,
      decayEngine,
      entityManager,
      relationManager
    );
  }

  async function seedGraph(entities: Entity[]): Promise<void> {
    await storage.saveGraph({ entities, relations: [] });
  }

  function getEntity(name: string): Entity | null {
    return storage.getEntityByName(name);
  }

  beforeEach(async () => {
    testDir = join(tmpdir(), `session-checkpoint-${Date.now()}-${Math.random()}`);
    await fs.mkdir(testDir, { recursive: true });
    storage = new GraphStorage(join(testDir, 'memory.jsonl'));

    session = createSessionEntity('session_123');
    wm1 = createWorkingMemoryEntity('wm_session_123_1', 'session_123', { importance: 7 });
    wm2 = createWorkingMemoryEntity('wm_session_123_2', 'session_123', { importance: 3 });
    await seedGraph([session as Entity, wm1 as Entity, wm2 as Entity]);

    manager = buildManager();
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch { /* */ }
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

    it('should persist the checkpoint as a dedicated entity, not a session observation blob', async () => {
      const cp = await manager.checkpoint('session_123', 'shape-check');

      // Checkpoint entity: dedicated type, parented to the session.
      const entity = getEntity(cp.id);
      expect(entity).not.toBeNull();
      expect(entity?.entityType).toBe(SESSION_CHECKPOINT_ENTITY_TYPE);
      expect(entity?.parentId).toBe('session_123');

      // Scalar fields as human-readable lines.
      expect(entity?.observations).toContain('[session-id]: session_123');
      expect(entity?.observations).toContain('[label]: shape-check');
      expect(entity?.observations).toContain(`[created-at]: ${cp.timestamp}`);

      // Snapshot lists: one line per working memory / decay entry.
      expect(entity?.observations).toContain('[working-memory]: "wm_session_123_1"');
      expect(entity?.observations).toContain('[working-memory]: "wm_session_123_2"');
      expect(entity?.observations).toContain(
        `[decay]: "wm_session_123_1"=${JSON.stringify(cp.state.decaySnapshot['wm_session_123_1'])}`
      );

      // No JSON blob anywhere: not on the session, not on the checkpoint.
      const sessionEntity = getEntity('session_123');
      expect(sessionEntity?.observations.some(o => o.startsWith('[CHECKPOINT]'))).toBe(false);
      expect(entity?.observations.some(o => o.startsWith('[CHECKPOINT]'))).toBe(false);
    });

    it('should link the checkpoint via has_checkpoint and snapshots relations', async () => {
      const cp = await manager.checkpoint('session_123');

      const sessionRels = await relationManager.getRelations('session_123');
      expect(sessionRels).toContainEqual(
        expect.objectContaining({
          from: 'session_123',
          to: cp.id,
          relationType: HAS_CHECKPOINT_RELATION,
        })
      );

      const cpRels = await relationManager.getRelations(cp.id);
      const snapshotTargets = cpRels
        .filter(r => r.from === cp.id && r.relationType === SNAPSHOTS_RELATION)
        .map(r => r.to)
        .sort();
      expect(snapshotTargets).toEqual(['wm_session_123_1', 'wm_session_123_2']);
    });

    it('should assign distinct ids to rapid successive checkpoints', async () => {
      const cp1 = await manager.checkpoint('session_123', 'first');
      const cp2 = await manager.checkpoint('session_123', 'second');
      const cp3 = await manager.checkpoint('session_123', 'third');

      const ids = new Set([cp1.id, cp2.id, cp3.id]);
      expect(ids.size).toBe(3);
      expect(await manager.listCheckpoints('session_123')).toHaveLength(3);
    });

    it('should throw if session not found', async () => {
      await expect(manager.checkpoint('nonexistent')).rejects.toThrow(
        'Session not found: nonexistent'
      );
    });

    it('should throw if session is completed', async () => {
      await seedGraph([
        createSessionEntity('session_123', { status: 'completed' }) as Entity,
      ]);
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
      const names = checkpoints.map(cp => cp.name);
      expect(names).toContain('cp1');
      expect(names).toContain('cp2');
    });

    it('should return the latest checkpoint first', async () => {
      await manager.checkpoint('session_123', 'older');
      await manager.checkpoint('session_123', 'newer');

      const checkpoints = await manager.listCheckpoints('session_123');

      expect(checkpoints.map(cp => cp.name)).toEqual(['newer', 'older']);
    });

    it('should roundtrip checkpoint data exactly', async () => {
      const saved = await manager.checkpoint('session_123', 'roundtrip');

      const [loaded] = await manager.listCheckpoints('session_123');
      expect(loaded).toEqual(saved);

      // Survives a fresh storage reload too.
      const freshStorage = new GraphStorage(storage.getFilePath());
      const freshManager = new SessionCheckpointManager(
        freshStorage,
        new WorkingMemoryManager(freshStorage),
        new DecayEngine(freshStorage, new AccessTracker(freshStorage)),
        new EntityManager(freshStorage),
        new RelationManager(freshStorage)
      );
      await freshStorage.ensureLoaded();
      const [reloaded] = await freshManager.listCheckpoints('session_123');
      expect(reloaded).toEqual(saved);
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
    it('should restore from a checkpoint by reinforcing working memories', async () => {
      const before1 = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;
      const before2 = (getEntity('wm_session_123_2') as AgentEntity).confirmationCount ?? 0;

      const cp = await manager.checkpoint('session_123');
      await manager.restore(cp.id);

      const after1 = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;
      const after2 = (getEntity('wm_session_123_2') as AgentEntity).confirmationCount ?? 0;
      expect(after1).toBeGreaterThan(before1);
      expect(after2).toBeGreaterThan(before2);
    });

    it('should throw for non-existent checkpoint', async () => {
      await expect(manager.restore('checkpoint_nonexistent_12345')).rejects.toThrow(
        'Checkpoint not found: checkpoint_nonexistent_12345'
      );
    });

    it('should skip deleted working memories during restore', async () => {
      const cp = await manager.checkpoint('session_123');

      // Delete wm2 entirely; its snapshots relation cascades away.
      await entityManager.deleteEntities(['wm_session_123_2']);

      // Should not throw even though wm2 is gone.
      await expect(manager.restore(cp.id)).resolves.not.toThrow();

      // The checkpoint's observation lines still record the full snapshot.
      const loaded = await manager.listCheckpoints('session_123');
      expect(loaded[0].state.workingMemories).toContain('wm_session_123_2');

      // No relation anywhere references a deleted entity.
      const graph = await storage.loadGraph();
      const liveNames = new Set(graph.entities.map(e => e.name));
      for (const rel of graph.relations) {
        expect(liveNames.has(rel.from)).toBe(true);
        expect(liveNames.has(rel.to)).toBe(true);
      }
    });
  });

  // ==================== Abnormal Ending Detection ====================

  describe('detectAbnormalEndings()', () => {
    it('should find stale active sessions', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await seedGraph([
        createSessionEntity('session_123', { lastModified: twoHoursAgo }) as Entity,
      ]);

      const stale = await manager.detectAbnormalEndings(3600000); // 1 hour threshold

      expect(stale).toHaveLength(1);
      expect(stale[0].name).toBe('session_123');
    });

    it('should not flag recently active sessions', async () => {
      const stale = await manager.detectAbnormalEndings(3600000);

      expect(stale).toHaveLength(0);
    });

    it('should not flag completed sessions', async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await seedGraph([
        createSessionEntity('session_123', {
          status: 'completed',
          lastModified: twoHoursAgo,
        }) as Entity,
      ]);

      const stale = await manager.detectAbnormalEndings(3600000);

      expect(stale).toHaveLength(0);
    });

    it('should use default threshold of 1 hour', async () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await seedGraph([
        createSessionEntity('session_123', { lastModified: thirtyMinAgo }) as Entity,
      ]);

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
      expect((getEntity('session_123') as SessionEntity).status).toBe('suspended');
    });

    it('should throw if session is not active', async () => {
      await seedGraph([
        createSessionEntity('session_123', { status: 'completed' }) as Entity,
      ]);

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
      await manager.sleep('session_123');

      await manager.wake('session_123');

      expect((getEntity('session_123') as SessionEntity).status).toBe('active');
    });

    it('should restore from the latest checkpoint when none is specified', async () => {
      await manager.checkpoint('session_123', 'older');
      const checkpointId = await manager.sleep('session_123'); // creates 'auto_sleep'

      await manager.wake('session_123');

      const checkpoints = await manager.listCheckpoints('session_123');
      expect(checkpoints[0].id).toBe(checkpointId);
      expect(checkpoints[0].name).toBe('auto_sleep');
    });

    it('should wake with a specific checkpoint', async () => {
      const cp1 = await manager.checkpoint('session_123', 'first');
      await manager.sleep('session_123');

      await manager.wake('session_123', cp1.id);

      expect((getEntity('session_123') as SessionEntity).status).toBe('active');
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
      await seedGraph([
        createSessionEntity('session_123', { status: 'suspended' }) as Entity,
      ]);

      await expect(manager.wake('session_123')).rejects.toThrow(
        'No checkpoints available for session: session_123'
      );
    });
  });

  // ==================== Sleep/Wake Cycle ====================

  describe('sleep/wake cycle', () => {
    it('should complete a full sleep/wake cycle', async () => {
      expect((getEntity('session_123') as SessionEntity).status).toBe('active');

      const checkpointId = await manager.sleep('session_123');
      expect((getEntity('session_123') as SessionEntity).status).toBe('suspended');
      expect(checkpointId).toBeTruthy();

      await manager.wake('session_123');
      expect((getEntity('session_123') as SessionEntity).status).toBe('active');
    });

    it('should preserve working memory across sleep/wake', async () => {
      const before1 = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;
      const before2 = (getEntity('wm_session_123_2') as AgentEntity).confirmationCount ?? 0;

      await manager.sleep('session_123');
      await manager.wake('session_123');

      // Both working memories were reinforced during restore.
      const after1 = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;
      const after2 = (getEntity('wm_session_123_2') as AgentEntity).confirmationCount ?? 0;
      expect(after1).toBeGreaterThan(before1);
      expect(after2).toBeGreaterThan(before2);
    });
  });

  // ==================== Legacy Migration ====================

  describe('legacy [CHECKPOINT] blob migration', () => {
    const hostileCheckpoint: SessionCheckpointData = {
      id: 'checkpoint_session_123_1000000000001',
      sessionId: 'session_123',
      name: 'label with "quotes"\nand a newline',
      timestamp: '2026-01-01T00:00:00.000Z',
      state: {
        workingMemories: [
          'wm=with=equals',
          'multi\nline\nname',
          'unicode-✓-ключ-鍵',
          '[decay]: sneaky prefix',
          'wm_session_123_1',
        ],
        decaySnapshot: {
          'wm=with=equals': 3.5,
          'multi\nline\nname': 0.25,
          '': 1,
          'wm_session_123_1': 7,
        },
        metadata: {
          'meta "key" \\backslash\\': 'value=with=equals\nand newline',
          nested: { list: [1, 2, '✓'], flag: true },
          count: 42,
          nothing: null,
        },
      },
    };

    const plainCheckpoint: SessionCheckpointData = {
      id: 'checkpoint_session_123_1000000000002',
      sessionId: 'session_123',
      timestamp: '2026-01-02T00:00:00.000Z',
      state: {
        workingMemories: ['wm_session_123_2'],
        decaySnapshot: { 'wm_session_123_2': 2 },
        metadata: {},
      },
    };

    function legacyBlob(cp: SessionCheckpointData): string {
      return `[CHECKPOINT] ${JSON.stringify(cp)}`;
    }

    async function seedLegacySession(
      extraObservations: string[] = [],
      checkpoints: SessionCheckpointData[] = [hostileCheckpoint, plainCheckpoint]
    ): Promise<void> {
      await seedGraph([
        createSessionEntity('session_123', {
          observations: [
            'Ordinary session note',
            ...checkpoints.map(legacyBlob),
            ...extraObservations,
          ],
        }) as Entity,
        wm1 as Entity,
        wm2 as Entity,
      ]);
    }

    it('listCheckpoints() decodes legacy blobs and roundtrips them exactly', async () => {
      await seedLegacySession();

      const checkpoints = await manager.listCheckpoints('session_123');

      expect(checkpoints).toHaveLength(2);
      // Newest first: plainCheckpoint (2026-01-02) before hostileCheckpoint.
      expect(checkpoints[0]).toEqual(plainCheckpoint);
      expect(checkpoints[1]).toEqual(hostileCheckpoint);
    });

    it('auto-migration rewrites blobs into checkpoint entities + relations', async () => {
      await seedLegacySession();

      await manager.listCheckpoints('session_123');

      // Blob observations are stripped; ordinary observations survive.
      const sessionEntity = getEntity('session_123');
      expect(sessionEntity?.observations.some(o => o.startsWith('[CHECKPOINT]'))).toBe(false);
      expect(sessionEntity?.observations).toContain('Ordinary session note');

      // Decomposed entities exist with the decomposed shape.
      const cpEntity = getEntity(hostileCheckpoint.id);
      expect(cpEntity?.entityType).toBe(SESSION_CHECKPOINT_ENTITY_TYPE);
      expect(cpEntity?.parentId).toBe('session_123');
      expect(cpEntity?.observations).toContain('[session-id]: session_123');
      expect(cpEntity?.observations).toContain('[created-at]: 2026-01-01T00:00:00.000Z');

      // has_checkpoint relations for both migrated checkpoints.
      const sessionRels = await relationManager.getRelations('session_123');
      const cpTargets = sessionRels
        .filter(r => r.from === 'session_123' && r.relationType === HAS_CHECKPOINT_RELATION)
        .map(r => r.to)
        .sort();
      expect(cpTargets).toEqual([hostileCheckpoint.id, plainCheckpoint.id]);

      // snapshots relations only for working memories that actually exist;
      // hostile names live on as observation lines only.
      const cpRels = await relationManager.getRelations(hostileCheckpoint.id);
      const snapshotTargets = cpRels
        .filter(r => r.from === hostileCheckpoint.id && r.relationType === SNAPSHOTS_RELATION)
        .map(r => r.to);
      expect(snapshotTargets).toEqual(['wm_session_123_1']);

      // No dangling relations were created.
      const graph = await storage.loadGraph();
      const liveNames = new Set(graph.entities.map(e => e.name));
      for (const rel of graph.relations) {
        expect(liveNames.has(rel.from)).toBe(true);
        expect(liveNames.has(rel.to)).toBe(true);
      }

      // Second listing reads the decomposed shape and agrees with the first.
      const reloaded = await manager.listCheckpoints('session_123');
      expect(reloaded).toEqual([plainCheckpoint, hostileCheckpoint]);
    });

    it('restore() finds a legacy checkpoint by id via auto-migration', async () => {
      await seedLegacySession();
      const before = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;

      await manager.restore(hostileCheckpoint.id);

      const after = (getEntity('wm_session_123_1') as AgentEntity).confirmationCount ?? 0;
      expect(after).toBeGreaterThan(before);
      expect(getEntity(hostileCheckpoint.id)?.entityType).toBe(SESSION_CHECKPOINT_ENTITY_TYPE);
    });

    it('wake() restores a suspended session that only has legacy checkpoints', async () => {
      await seedGraph([
        createSessionEntity('session_123', {
          status: 'suspended',
          observations: [legacyBlob(plainCheckpoint)],
        }) as Entity,
        wm1 as Entity,
        wm2 as Entity,
      ]);

      await manager.wake('session_123');

      expect((getEntity('session_123') as SessionEntity).status).toBe('active');
      expect(getEntity(plainCheckpoint.id)?.entityType).toBe(SESSION_CHECKPOINT_ENTITY_TYPE);
    });

    it('leaves malformed [CHECKPOINT] observations in place and ignores them', async () => {
      await seedLegacySession(['[CHECKPOINT] not-json at all']);

      const checkpoints = await manager.listCheckpoints('session_123');
      expect(checkpoints).toHaveLength(2);

      const sessionEntity = getEntity('session_123');
      expect(sessionEntity?.observations).toContain('[CHECKPOINT] not-json at all');
    });

    it('migrateLegacySessionCheckpoints counts and converts blobs across sessions', async () => {
      const otherCheckpoint: SessionCheckpointData = {
        id: 'checkpoint_session_456_1000000000003',
        sessionId: 'session_456',
        timestamp: '2026-01-03T00:00:00.000Z',
        state: { workingMemories: [], decaySnapshot: {}, metadata: {} },
      };
      await seedGraph([
        createSessionEntity('session_123', {
          observations: [legacyBlob(hostileCheckpoint), legacyBlob(plainCheckpoint)],
        }) as Entity,
        createSessionEntity('session_456', {
          observations: [legacyBlob(otherCheckpoint)],
        }) as Entity,
        wm1 as Entity,
        wm2 as Entity,
      ]);
      // A modern decomposed checkpoint must not be counted.
      await manager.checkpoint('session_123', 'modern');

      const migrated = await migrateLegacySessionCheckpoints(entityManager, relationManager);
      expect(migrated).toBe(3);

      for (const cp of [hostileCheckpoint, plainCheckpoint, otherCheckpoint]) {
        expect(getEntity(cp.id)?.entityType).toBe(SESSION_CHECKPOINT_ENTITY_TYPE);
      }
      expect(await manager.listCheckpoints('session_456')).toEqual([otherCheckpoint]);

      // Second run is a no-op.
      expect(await migrateLegacySessionCheckpoints(entityManager, relationManager)).toBe(0);
    });
  });
});
