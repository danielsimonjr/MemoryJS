/**
 * ConsolidationPipeline.promoteMemories (DES-10 / OPT-14)
 *
 * Batch promotion with per-candidate error isolation:
 * - delta-capable storage: one updateEntities write for N promotions
 * - storage without delta primitives: per-entity fallback
 * - a candidate that vanishes mid-batch is reported alone
 * - entity:updated is emitted once per entity per write phase (real backends)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import type { IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import { EntityNotFoundError } from '../../../src/utils/errors.js';
import { createInMemoryStorageFake } from '../../helpers/mockStorage.js';
import { withBothBackends } from '../../helpers/tempStorage.js';
import type { EntityUpdatedEvent } from '../../../src/types/types.js';

const SESSION = 'session_1';
const PRE_CONFIRMATIONS = 2;

function workingMemory(name: string, overrides: Partial<AgentEntity> = {}): AgentEntity {
  const now = new Date().toISOString();
  return {
    name,
    entityType: 'working_memory',
    observations: [`obs for ${name}`],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'working',
    sessionId: SESSION,
    accessCount: 0,
    confidence: 0.9,
    confirmationCount: PRE_CONFIRMATIONS,
    visibility: 'private',
    isWorkingMemory: true,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  } as AgentEntity;
}

function names(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
}

const workingMemoryStub = {} as WorkingMemoryManager;

function setup(entities: AgentEntity[], withDeltaPrimitives: boolean) {
  const storage = createInMemoryStorageFake(entities, { withDeltaPrimitives });
  const tracker = new AccessTracker(storage);
  const decay = new DecayEngine(storage, tracker);
  const pipeline = new ConsolidationPipeline(storage, workingMemoryStub, decay);
  return { storage, tracker, decay, pipeline };
}

// ==================== Delta-capable storage ====================

describe('promoteMemories with delta primitives', () => {
  let storage: IGraphStorage;
  let pipeline: ConsolidationPipeline;
  let decay: DecayEngine;
  let entities: AgentEntity[];

  beforeEach(() => {
    entities = names('mem', 5).map((n) => workingMemory(n));
    ({ storage, pipeline, decay } = setup(entities, true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes N promotions in one updateEntities call plus one access-tracking call', async () => {
    const result = await pipeline.promoteMemories(names('mem', 5), 'episodic');

    expect(result.errors).toEqual([]);
    expect(result.promoted).toHaveLength(5);
    const update = storage.updateEntities as unknown as Mock;
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toHaveLength(5);
    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('applies promotion fields and reinforces confirmationCount by exactly +1', async () => {
    await pipeline.promoteMemories(names('mem', 5), 'semantic');

    for (const name of names('mem', 5)) {
      const e = storage.getEntityByName(name) as AgentEntity;
      expect(e.memoryType).toBe('semantic');
      expect(e.isWorkingMemory).toBe(false);
      expect(e.expiresAt).toBeUndefined();
      expect(e.promotedFrom).toBe(SESSION);
      expect(e.promotedAt).toBeTruthy();
      expect(e.markedForPromotion).toBe(false);
      expect(e.lastAccessedAt).toBeTruthy();
      expect(e.confirmationCount).toBe(PRE_CONFIRMATIONS + 1);
      expect(e.accessCount).toBe(1);
    }
  });

  it('isolates an invalid candidate: others promote and the error text matches promoteMemory', async () => {
    await storage.appendEntity(
      workingMemory('already_episodic', { memoryType: 'episodic', isWorkingMemory: false }),
    );
    const batch = ['mem_0', 'already_episodic', 'mem_1', 'mem_2', 'ghost'];

    const result = await pipeline.promoteMemories(batch, 'episodic');

    expect(result.promoted.map((e) => e.name)).toEqual(['mem_0', 'mem_1', 'mem_2']);
    expect(result.errors).toEqual([
      { entityName: 'already_episodic', error: 'Entity is not working memory: already_episodic' },
      { entityName: 'ghost', error: 'Entity not found: ghost' },
    ]);
    expect((storage.updateEntities as unknown as Mock).mock.calls[0][0]).toHaveLength(3);
  });

  it('reports a repeated name once as not working memory, promoting it a single time', async () => {
    const result = await pipeline.promoteMemories(['mem_0', 'mem_0'], 'episodic');

    expect(result.promoted).toHaveLength(1);
    expect(result.errors).toEqual([
      { entityName: 'mem_0', error: 'Entity is not working memory: mem_0' },
    ]);
    expect((storage.updateEntities as unknown as Mock).mock.calls[0][0]).toHaveLength(1);
  });

  it('makes no storage call for an empty candidate list', async () => {
    const result = await pipeline.promoteMemories([], 'episodic');

    expect(result).toEqual({ promoted: [], errors: [] });
    expect(storage.updateEntities).not.toHaveBeenCalled();
    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('makes no write when every candidate is invalid', async () => {
    const result = await pipeline.promoteMemories(['ghost_a', 'ghost_b'], 'episodic');

    expect(result.promoted).toEqual([]);
    expect(result.errors.map((e) => e.error)).toEqual([
      'Entity not found: ghost_a',
      'Entity not found: ghost_b',
    ]);
    expect(storage.updateEntities).not.toHaveBeenCalled();
  });

  it('isolates a candidate that vanishes mid-batch and promotes the rest on the per-entity path', async () => {
    await storage.appendEntity(workingMemory('vanish'));
    const update = storage.updateEntities as unknown as Mock;
    update.mockImplementationOnce(async () => {
      // Simulate a concurrent delete between validation and the batch write.
      await storage.deleteEntities(['vanish']);
      throw new EntityNotFoundError('vanish');
    });

    const result = await pipeline.promoteMemories([...names('mem', 5), 'vanish'], 'episodic');

    expect(result.errors).toEqual([{ entityName: 'vanish', error: 'Entity not found: vanish' }]);
    expect(result.promoted.map((e) => e.name)).toEqual(names('mem', 5));
    for (const name of names('mem', 5)) {
      const e = storage.getEntityByName(name) as AgentEntity;
      expect(e.memoryType).toBe('episodic');
      expect(e.confirmationCount).toBe(PRE_CONFIRMATIONS + 1);
    }
  });

  it('keeps candidates promoted but surfaces the error when access tracking fails after the write', async () => {
    vi.spyOn(decay, 'reinforceMemories').mockRejectedValueOnce(new Error('tracker down'));

    const result = await pipeline.promoteMemories(names('mem', 2), 'episodic');

    expect(result.promoted.map((e) => e.name)).toEqual(['mem_0', 'mem_1']);
    expect(result.errors).toEqual([
      { entityName: 'mem_0', error: 'Promoted, but access tracking failed: tracker down' },
      { entityName: 'mem_1', error: 'Promoted, but access tracking failed: tracker down' },
    ]);
    for (const name of ['mem_0', 'mem_1']) {
      expect((storage.getEntityByName(name) as AgentEntity).memoryType).toBe('episodic');
    }
  });

  it('counts candidates as promoted when the batch write persists and then throws', async () => {
    const update = storage.updateEntities as unknown as Mock;
    const real = update.getMockImplementation()!;
    update.mockImplementationOnce(async (...args: unknown[]) => {
      await real(...args);
      throw new Error('post-write failure');
    });

    const result = await pipeline.promoteMemories(names('mem', 3), 'semantic');

    expect(result.errors).toEqual([]);
    expect(result.promoted.map((e) => e.name)).toEqual(names('mem', 3));
    // No per-entity fallback re-run: reinforcement applied exactly once.
    expect(update).toHaveBeenCalledTimes(1);
    for (const name of names('mem', 3)) {
      const e = storage.getEntityByName(name) as AgentEntity;
      expect(e.memoryType).toBe('semantic');
      expect(e.confirmationCount).toBe(PRE_CONFIRMATIONS + 1);
    }
  });
});

// ==================== Fallback (no delta primitives) ====================

describe('promoteMemories without delta primitives (fallback)', () => {
  it('promotes each candidate through promoteMemory with the same end state', async () => {
    const entities = names('mem', 3).map((n) => workingMemory(n));
    const { storage, pipeline } = setup(entities, false);

    const result = await pipeline.promoteMemories(names('mem', 3), 'semantic');

    expect(result.errors).toEqual([]);
    expect(result.promoted).toHaveLength(3);
    expect(storage.updateEntities).toBeUndefined();
    // Per entity: promotion write + reinforce write + access-tracker write.
    expect(storage.updateEntity).toHaveBeenCalledTimes(9);
    for (const name of names('mem', 3)) {
      const e = storage.getEntityByName(name) as AgentEntity;
      expect(e.memoryType).toBe('semantic');
      expect(e.expiresAt).toBeUndefined();
      expect(e.confirmationCount).toBe(PRE_CONFIRMATIONS + 1);
    }
  });

  it('keeps per-candidate isolation on the fallback path', async () => {
    const entities = [workingMemory('ok_a'), workingMemory('done', { memoryType: 'episodic', isWorkingMemory: false }), workingMemory('ok_b')];
    const { pipeline } = setup(entities, false);

    const result = await pipeline.promoteMemories(['ok_a', 'done', 'ok_b'], 'episodic');

    expect(result.promoted.map((e) => e.name)).toEqual(['ok_a', 'ok_b']);
    expect(result.errors).toEqual([
      { entityName: 'done', error: 'Entity is not working memory: done' },
    ]);
  });
});

// ==================== Real backends: events and persisted fields ====================

withBothBackends('promoteMemories events', (backend) => {
  it('emits entity:updated once per entity for the promotion write and once for access tracking', async () => {
    const storage = backend.create();
    const seeded = names('ev', 3).map((n) => workingMemory(n));
    await storage.appendEntities(seeded as never);

    const events: EntityUpdatedEvent[] = [];
    storage.events.on('entity:updated', (event) => {
      events.push(event as EntityUpdatedEvent);
    });

    const tracker = new AccessTracker(storage);
    const decay = new DecayEngine(storage, tracker);
    const pipeline = new ConsolidationPipeline(storage, workingMemoryStub, decay);

    const result = await pipeline.promoteMemories(names('ev', 3), 'episodic');

    expect(result.errors).toEqual([]);
    expect(result.promoted).toHaveLength(3);
    expect(events).toHaveLength(6);
    for (const name of names('ev', 3)) {
      const forEntity = events.filter((e) => e.entityName === name);
      expect(forEntity).toHaveLength(2);
      expect(forEntity[0].changes).toMatchObject({ memoryType: 'episodic', isWorkingMemory: false });
    }

    const after = storage.getEntityByName('ev_0') as AgentEntity;
    expect(after.memoryType).toBe('episodic');
    expect(after.expiresAt).toBeUndefined();
    expect(after.confirmationCount).toBe(PRE_CONFIRMATIONS + 1);
    expect(after.accessCount).toBe(1);
  });
});
