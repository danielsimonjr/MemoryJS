/**
 * AccessTracker.recordAccessBatch (DES-10 / OPT-14)
 *
 * With delta-capable storage the access fields of all existing entities are
 * written in one updateEntities call. Without it, the batch is recordAccess
 * in parallel, as before.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import { createInMemoryStorageFake } from '../../helpers/mockStorage.js';

function agent(name: string): AgentEntity {
  return {
    name,
    entityType: 'memory',
    observations: [],
    memoryType: 'episodic',
    accessCount: 0,
    confidence: 0.5,
    confirmationCount: 0,
    visibility: 'private',
  } as AgentEntity;
}

function build(names: string[], withDeltaPrimitives: boolean) {
  const storage = createInMemoryStorageFake(names.map(agent), { withDeltaPrimitives });
  return { storage, tracker: new AccessTracker(storage) };
}

describe('AccessTracker.recordAccessBatch with delta primitives', () => {
  it('writes all access fields in one updateEntities call', async () => {
    const { storage, tracker } = build(['a', 'b', 'c'], true);

    await tracker.recordAccessBatch(['a', 'b', 'c'], { sessionId: 's1' });

    const update = storage.updateEntities as unknown as Mock;
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toHaveLength(3);
    expect(storage.updateEntity).not.toHaveBeenCalled();
    expect((storage.getEntityByName('b') as AgentEntity).accessCount).toBe(1);
    expect((storage.getEntityByName('c') as AgentEntity).lastAccessedAt).toBeTruthy();
  });

  it('keeps in-memory stats identical to per-entity recordAccess', async () => {
    const { tracker } = build(['a', 'b'], true);
    const ctx = { sessionId: 's1' };

    await tracker.recordAccessBatch(['a', 'b', 'a'], ctx);

    expect(tracker.getAccessStats('a').totalAccesses).toBe(2);
    expect(tracker.getAccessStats('a').accessesBySession).toEqual({ s1: 2 });
    expect(tracker.getAccessStats('b').totalAccesses).toBe(1);
    expect(tracker.isDirty()).toBe(true);
  });

  it('skips a missing entity in the write but still tracks it in memory', async () => {
    const { storage, tracker } = build(['a'], true);

    await tracker.recordAccessBatch(['a', 'ghost'], {});

    const batch = (storage.updateEntities as unknown as Mock).mock.calls[0][0] as Array<{ name: string }>;
    expect(batch.map((x) => x.name)).toEqual(['a']);
    expect(tracker.getAccessStats('ghost').totalAccesses).toBe(1);
  });

  it('makes no write when no name exists', async () => {
    const { storage, tracker } = build([], true);

    await tracker.recordAccessBatch(['ghost'], {});

    expect(storage.updateEntities).not.toHaveBeenCalled();
    expect(tracker.getAccessStats('ghost').totalAccesses).toBe(1);
  });

  it('retries per entity when the batch write throws, without double counting', async () => {
    const { storage, tracker } = build(['a', 'b'], true);
    (storage.updateEntities as unknown as Mock).mockRejectedValueOnce(new Error('disk busy'));

    await tracker.recordAccessBatch(['a', 'b'], {});

    expect(storage.updateEntity).toHaveBeenCalledTimes(2);
    expect((storage.getEntityByName('a') as AgentEntity).accessCount).toBe(1);
    expect(tracker.getAccessStats('a').totalAccesses).toBe(1);
  });
});

describe('AccessTracker.recordAccessBatch without delta primitives', () => {
  it('records each name through recordAccess (per-entity writes)', async () => {
    const { storage, tracker } = build(['a', 'b'], false);

    await tracker.recordAccessBatch(['a', 'b'], { sessionId: 's2' });

    expect(storage.updateEntities).toBeUndefined();
    expect(storage.updateEntity).toHaveBeenCalledTimes(2);
    expect(tracker.getAccessStats('a').accessesBySession).toEqual({ s2: 1 });
    expect((storage.getEntityByName('b') as AgentEntity).accessCount).toBe(1);
  });
});
