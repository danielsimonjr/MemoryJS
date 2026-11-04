/**
 * DecayEngine.reinforceMemories (DES-10 / OPT-14)
 *
 * Batch reinforcement must match N calls to reinforceMemory field-for-field,
 * write once on delta-capable storage, and fall back per entity otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import { createInMemoryStorageFake } from '../../helpers/mockStorage.js';

const FIXED_NOW = new Date('2026-11-04T12:00:00.000Z');

function agent(name: string, overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    lastModified: '2026-11-01T00:00:00.000Z',
    importance: 5,
    memoryType: 'episodic',
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 1,
    visibility: 'private',
    ...overrides,
  } as AgentEntity;
}

function build(entities: AgentEntity[], withDeltaPrimitives: boolean) {
  const storage = createInMemoryStorageFake(entities, { withDeltaPrimitives });
  const tracker = new AccessTracker(storage);
  const decay = new DecayEngine(storage, tracker);
  return { storage, tracker, decay };
}

function snapshot(storage: ReturnType<typeof createInMemoryStorageFake>, names: string[]) {
  return names.map((n) => storage.getEntityByName(n));
}

describe('DecayEngine.reinforceMemories', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('matches N reinforceMemory calls field-for-field', async () => {
    const seed = () => [agent('a'), agent('b', { confirmationCount: 4, accessCount: 3 })];
    const names = ['a', 'b'];

    const batched = build(seed(), true);
    await batched.decay.reinforceMemories(names, { confidenceBoost: 0.2 });

    const looped = build(seed(), false);
    for (const n of names) await looped.decay.reinforceMemory(n, { confidenceBoost: 0.2 });

    expect(snapshot(batched.storage, names)).toEqual(snapshot(looped.storage, names));
    const a = batched.storage.getEntityByName('a') as AgentEntity;
    expect(a.confirmationCount).toBe(2);
    expect(a.lastAccessedAt).toBe(FIXED_NOW.toISOString());
    expect(a.confidence).toBeCloseTo(0.7);
  });

  it('writes once for N entities on delta-capable storage (plus one access-tracking write)', async () => {
    const entities = ['a', 'b', 'c', 'd', 'e'].map((n) => agent(n));
    const { storage, decay } = build(entities, true);

    await decay.reinforceMemories(['a', 'b', 'c', 'd', 'e']);

    const update = storage.updateEntities as unknown as Mock;
    const reinforcementCall = update.mock.calls.find(([batch]) =>
      (batch as Array<{ updates: Record<string, unknown> }>).every(
        (x) => 'confirmationCount' in x.updates,
      ),
    );
    expect(reinforcementCall?.[0]).toHaveLength(5);
    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('applies confirmationBoost on the batch path', async () => {
    const { storage, decay } = build([agent('a', { confirmationCount: 1 })], true);

    await decay.reinforceMemories(['a'], { confirmationBoost: 3 });

    expect((storage.getEntityByName('a') as AgentEntity).confirmationCount).toBe(4);
  });

  it('with alreadyApplied writes no reinforcement fields but still records access', async () => {
    const { storage, tracker, decay } = build([agent('a', { confirmationCount: 2 })], true);
    const batchSpy = vi.spyOn(tracker, 'recordAccessBatch');

    await decay.reinforceMemories(['a'], { alreadyApplied: true });

    expect(batchSpy).toHaveBeenCalledWith(['a'], { retrievalMethod: 'direct' });
    expect(tracker.getAccessStats('a').totalAccesses).toBe(1);
    expect((storage.getEntityByName('a') as AgentEntity).confirmationCount).toBe(2);
    expect(storage.updateEntities).toHaveBeenCalledTimes(1); // access-tracking write only
    expect((storage.updateEntities as unknown as Mock).mock.calls[0][0][0].updates).not.toHaveProperty(
      'confirmationCount',
    );
  });

  it('makes no storage call for an empty list', async () => {
    const { storage, decay } = build([agent('a')], true);

    await decay.reinforceMemories([]);

    expect(storage.updateEntities).not.toHaveBeenCalled();
    expect(storage.updateEntity).not.toHaveBeenCalled();
  });

  it('throws before any write when a name is missing', async () => {
    const { storage, decay } = build([agent('a')], true);

    await expect(decay.reinforceMemories(['a', 'ghost'])).rejects.toThrow('Entity not found: ghost');
    expect(storage.updateEntities).not.toHaveBeenCalled();
    expect((storage.getEntityByName('a') as AgentEntity).confirmationCount).toBe(1);
  });

  it('falls back per entity when the batch write throws', async () => {
    const entities = [agent('a'), agent('b')];
    const { storage, decay } = build(entities, true);
    (storage.updateEntities as unknown as Mock).mockRejectedValueOnce(new Error('disk busy'));

    await decay.reinforceMemories(['a', 'b']);

    expect(storage.updateEntity).toHaveBeenCalledTimes(2);
    expect((storage.getEntityByName('a') as AgentEntity).confirmationCount).toBe(2);
    expect((storage.getEntityByName('b') as AgentEntity).confirmationCount).toBe(2);
  });

  it('uses the per-entity path without delta primitives', async () => {
    const { storage, decay } = build([agent('a'), agent('b')], false);

    await decay.reinforceMemories(['a', 'b']);

    expect(storage.updateEntities).toBeUndefined();
    // Per entity: reinforce write + access-tracker write.
    expect(storage.updateEntity).toHaveBeenCalledTimes(4);
  });
});
