/**
 * ConsolidationPipeline.mergeMemories concurrency and failure semantics (DES-11).
 *
 * - a write to a merged entity racing the merge is never silently lost
 * - a failed merge restores the survivor and writes no merge audit entry
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import type { Entity, IGraphStorage } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import { makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../helpers/tempStorage.js';

const T0 = '2026-01-01T00:00:00.000Z';
const LATE = 'LATE-WRITE';

function agent(name: string, observations: string[]): AgentEntity {
  return {
    name,
    entityType: 'fact',
    observations,
    createdAt: T0,
    lastModified: T0,
    importance: 5,
    memoryType: 'semantic',
    accessCount: 1,
    confidence: 0.8,
    confirmationCount: 2,
    visibility: 'private',
  } as AgentEntity;
}


/** Storages opened in the current test; closed in afterEach so Windows can remove the temp dirs. */
const openedStorages: Array<{ close?: () => void }> = [];
function track<T>(storage: T): T {
  openedStorages.push(storage as unknown as { close?: () => void });
  return storage;
}

const BACKENDS = [
  { name: 'jsonl', open: (p: string) => track(new GraphStorage(p)), path: makeTempJsonlPath },
  { name: 'sqlite', open: (p: string) => track(new SQLiteStorage(p)), path: makeTempSqlitePath },
] as const;

function pipelineFor(storage: IGraphStorage): ConsolidationPipeline {
  const decay = new DecayEngine(storage, new AccessTracker(storage));
  return new ConsolidationPipeline(storage, {} as WorkingMemoryManager, decay);
}

async function seed(storage: IGraphStorage): Promise<void> {
  await storage.appendEntities([agent('S', ['s1']), agent('A', ['a1']), agent('B', ['b1'])]);
}

const auditCount = async (storage: IGraphStorage): Promise<number> =>
  (await storage.loadGraph()).entities.filter((e: Entity) => e.entityType === 'merge_audit').length;

afterEach(() => {
  vi.restoreAllMocks();
  for (const storage of openedStorages.splice(0)) storage.close?.();
  cleanupTempDirs();
});

describe.each(BACKENDS)('mergeMemories racing a concurrent write [$name]', (backend) => {
  for (const order of ['write-first', 'merge-first'] as const) {
    it(`never loses an observation added to a merged entity (${order})`, async () => {
      const store = backend.open(backend.path());
      await seed(store as unknown as IGraphStorage);
      const observations = new ObservationManager(store as unknown as GraphStorage);
      const pipe = pipelineFor(store as unknown as IGraphStorage);

      const startWrite = () => observations.addObservations([{ entityName: 'B', contents: [LATE] }]);
      const startMerge = () => pipe.mergeMemories(['S', 'A', 'B'], 'merge_observations');

      let write: ReturnType<typeof startWrite>;
      let merge: ReturnType<typeof startMerge>;
      if (order === 'write-first') {
        write = startWrite();
        merge = startMerge();
      } else {
        merge = startMerge();
        write = startWrite();
      }
      const [mergeOutcome, writeOutcome] = await Promise.allSettled([merge, write]);

      expect(mergeOutcome.status).toBe('fulfilled');
      const survivor = (store as unknown as IGraphStorage).getEntityByName('S') as AgentEntity;
      // Either the write landed before the merge (and was carried into the
      // survivor), or it was rejected because B was already gone. Never lost.
      if (writeOutcome.status === 'fulfilled') {
        expect(survivor.observations).toContain(LATE);
      } else {
        expect((store as unknown as IGraphStorage).getEntityByName('B')).toBeUndefined();
      }
    });
  }
});

describe.each(BACKENDS)('mergeMemories failure leaves no trace [$name]', (backend) => {
  it('restores the survivor and writes no audit entry when the delta fails', async () => {
    const store = backend.open(backend.path()) as unknown as IGraphStorage;
    await seed(store);
    // A relation on a merged entity forces retargeting, hence an append.
    await store.appendEntities([agent('X', ['x1'])]);
    await store.appendRelations([{ from: 'A', to: 'X', relationType: 'rel' } as never]);
    vi.spyOn(store, 'appendRelations').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      pipelineFor(store).mergeMemories(['S', 'A', 'B'], 'merge_observations')
    ).rejects.toThrow('disk full');

    const survivor = store.getEntityByName('S') as AgentEntity;
    expect(survivor.observations).toEqual(['s1']);
    expect(survivor.confirmationCount).toBe(2);
    expect(survivor.accessCount).toBe(1);
    expect(store.getEntityByName('A')).toBeDefined();
    expect(store.getEntityByName('B')).toBeDefined();
    expect(await auditCount(store)).toBe(0);
  });

  it('writes the audit entry once the merge commits', async () => {
    const store = backend.open(backend.path()) as unknown as IGraphStorage;
    await seed(store);
    await pipelineFor(store).mergeMemories(['S', 'A', 'B'], 'merge_observations');
    expect(await auditCount(store)).toBe(1);
  });
});
