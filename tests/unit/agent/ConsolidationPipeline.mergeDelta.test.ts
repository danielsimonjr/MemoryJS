/**
 * ConsolidationPipeline.mergeMemories delta path (OPT-15 / DES-11).
 *
 * - delta-capable storage: deleteEntities + appendRelations under the write lock
 * - storage without delta primitives: saveGraph fallback (unchanged behaviour)
 * - both paths produce the same end state on the same fixture
 * - a failure after the delete is compensated; no partial state is left behind
 */

import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { ConsolidationPipeline } from '../../../src/agent/ConsolidationPipeline.js';
import { DecayEngine } from '../../../src/agent/DecayEngine.js';
import { AccessTracker } from '../../../src/agent/AccessTracker.js';
import type { WorkingMemoryManager } from '../../../src/agent/WorkingMemoryManager.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import type { Entity, IGraphStorage, Relation } from '../../../src/types/types.js';
import type { AgentEntity } from '../../../src/types/agent-memory.js';
import { createInMemoryStorageFake } from '../../helpers/mockStorage.js';
import { makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../helpers/tempStorage.js';

const T0 = '2026-01-01T00:00:00.000Z';
const workingMemoryStub = {} as WorkingMemoryManager;
const DELTA_NAMES = ['appendEntities', 'appendRelations', 'updateEntities', 'deleteEntities', 'deleteRelations'];

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

function rel(from: string, to: string, relationType: string, createdAt: string): Relation {
  return { from, to, relationType, createdAt } as Relation;
}

/**
 * Fixture covering: survivor-existing relation kept over a retargeted duplicate,
 * self-loops after retargeting, two merged entities pointing at one target
 * (collapse), an incoming relation to a merged entity, and an unrelated edge.
 */
function fixture(): { entities: Entity[]; relations: Relation[] } {
  return {
    entities: [
      agent('alpha', ['a1', 'shared']),
      agent('beta', ['b1', 'shared']),
      agent('gamma', ['g1']),
      agent('delta', ['d1']),
      agent('eps', ['e1']),
    ],
    relations: [
      rel('alpha', 'delta', 'uses', '2025-01-01T00:00:00.000Z'),
      rel('beta', 'delta', 'uses', '2025-02-02T00:00:00.000Z'),
      rel('gamma', 'alpha', 'links', T0),
      rel('alpha', 'beta', 'links', T0),
      rel('beta', 'gamma', 'links', T0),
      rel('gamma', 'delta', 'depends', T0),
      rel('delta', 'beta', 'refers', T0),
      rel('beta', 'eps', 'x', T0),
      rel('gamma', 'eps', 'x', T0),
      rel('eps', 'delta', 'unrelated', T0),
    ],
  };
}

const MERGE = ['alpha', 'beta', 'gamma'];

/** Stable view of the graph: audit entities removed, storage-assigned ids dropped. */
async function snapshot(storage: IGraphStorage): Promise<{ entities: Entity[]; relations: Relation[] }> {
  const graph = await storage.loadGraph();
  const entities = graph.entities
    .filter((e) => e.entityType !== 'merge_audit')
    .map((e) => stripId(e) as Entity)
    .sort((a, b) => a.name.localeCompare(b.name));
  const relations = graph.relations
    .map((r) => ({ ...r }))
    .sort((a, b) => relKey(a).localeCompare(relKey(b)));
  return { entities, relations };
}

function stripId<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  delete copy.id;
  return copy as T;
}

function relKey(r: Pick<Relation, 'from' | 'to' | 'relationType'>): string {
  return `${r.from}|${r.to}|${r.relationType}`;
}

function pipelineFor(storage: IGraphStorage): ConsolidationPipeline {
  const tracker = new AccessTracker(storage);
  const decay = new DecayEngine(storage, tracker);
  return new ConsolidationPipeline(storage, workingMemoryStub, decay);
}

/** Hide the delta primitives so `hasDeltaPrimitives` sees a legacy storage. */
function withoutDelta(storage: IGraphStorage): IGraphStorage {
  return new Proxy(storage, {
    get(target, prop) {
      if (typeof prop === 'string' && DELTA_NAMES.includes(prop)) return undefined;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as IGraphStorage;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanupTempDirs();
});

// ==================== Fake storage: call shape and locking ====================

describe('mergeMemories delta path (in-memory fake)', () => {
  async function delta(entities: Entity[], relations: Relation[] = []) {
    const storage = createInMemoryStorageFake(entities, { withDeltaPrimitives: true });
    for (const r of relations) await storage.appendRelation(r);
    return storage;
  }

  it('uses deleteEntities + appendRelations and never saveGraph', async () => {
    const { entities, relations } = fixture();
    const storage = await delta(entities, relations);
    await pipelineFor(storage).mergeMemories(MERGE, 'merge_observations');

    expect(storage.deleteEntities).toHaveBeenCalledTimes(1);
    expect(storage.deleteEntities).toHaveBeenCalledWith(['beta', 'gamma']);
    expect(storage.appendRelations).toHaveBeenCalledTimes(1);
    expect(storage.saveGraph).not.toHaveBeenCalled();
    expect(storage.loadGraph).not.toHaveBeenCalled();
  });

  it('appends only the retargeted, de-duplicated relations', async () => {
    const { entities, relations } = fixture();
    const storage = await delta(entities, relations);
    await pipelineFor(storage).mergeMemories(MERGE, 'merge_observations');

    const appended = (storage.appendRelations as unknown as Mock).mock.calls[0][0] as Relation[];
    expect(appended.map(relKey).sort()).toEqual(
      ['alpha|delta|depends', 'alpha|eps|x', 'delta|alpha|refers'].sort()
    );
  });

  it('runs the delete and append inside the storage write lock', async () => {
    const { entities, relations } = fixture();
    const storage = await delta(entities, relations);
    let held = false;
    const events: string[] = [];
    Object.assign(storage, {
      graphMutex: {
        acquire: async () => {
          held = true;
          events.push('acquire');
          return () => {
            held = false;
            events.push('release');
          };
        },
      },
    });
    const del = storage.deleteEntities as unknown as Mock;
    const delImpl = del.getMockImplementation()!;
    del.mockImplementation(async (names: string[]) => {
      events.push(held ? 'delete:locked' : 'delete:unlocked');
      return delImpl(names);
    });

    await pipelineFor(storage).mergeMemories(MERGE, 'merge_observations');
    expect(events).toEqual(['acquire', 'delete:locked', 'release']);
  });

  it('falls back to saveGraph when delta primitives are absent', async () => {
    const { entities, relations } = fixture();
    const storage = createInMemoryStorageFake(entities, { withDeltaPrimitives: false });
    for (const r of relations) await storage.appendRelation(r);
    await pipelineFor(storage).mergeMemories(MERGE, 'merge_observations');

    expect(storage.saveGraph).toHaveBeenCalledTimes(1);
    expect(storage.deleteEntities).toBeUndefined();
  });
});

// ==================== Parity: delta vs saveGraph on real backends ====================

const REAL_BACKENDS = [
  {
    name: 'jsonl',
    open: (path: string) => new GraphStorage(path) as unknown as IGraphStorage,
    path: makeTempJsonlPath,
  },
  {
    name: 'sqlite',
    open: (path: string) => new SQLiteStorage(path) as unknown as IGraphStorage,
    path: makeTempSqlitePath,
  },
] as const;

async function seed(storage: IGraphStorage): Promise<void> {
  const { entities, relations } = fixture();
  await storage.appendEntities(entities);
  await storage.appendRelations(relations);
}

async function runMerge(storage: IGraphStorage): Promise<void> {
  await pipelineFor(storage).mergeMemories(MERGE, 'merge_observations');
}

describe.each(REAL_BACKENDS)('mergeMemories delta vs saveGraph parity [$name]', (backend) => {
  it('produces field-for-field identical end state on the same fixture', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(T0) });

    const deltaStore = backend.open(backend.path());
    const legacyStore = backend.open(backend.path());
    await seed(deltaStore);
    await seed(legacyStore);

    const deltaSpy = vi.spyOn(deltaStore, 'deleteEntities');
    const legacySave = vi.spyOn(legacyStore, 'saveGraph');

    await runMerge(deltaStore);
    await runMerge(withoutDelta(legacyStore));

    expect(deltaSpy).toHaveBeenCalledTimes(1);
    expect(legacySave).toHaveBeenCalledTimes(1);
    expect(await snapshot(deltaStore)).toEqual(await snapshot(legacyStore));
  });

  it('rewires relations, drops self-loops and collapses duplicates', async () => {
    const store = backend.open(backend.path());
    await seed(store);
    await runMerge(store);

    const { entities, relations } = await snapshot(store);
    expect(entities.map((e) => e.name)).toEqual(['alpha', 'delta', 'eps']);

    const alpha = entities.find((e) => e.name === 'alpha') as AgentEntity;
    expect([...alpha.observations].sort()).toEqual(['a1', 'b1', 'g1', 'shared'].sort());

    const keys = relations.map(relKey).sort();
    expect(keys).toEqual(
      [
        'alpha|delta|uses',
        'alpha|delta|depends',
        'alpha|eps|x',
        'delta|alpha|refers',
        'eps|delta|unrelated',
      ].sort()
    );
    // Survivor's existing relation wins over the retargeted beta->delta duplicate.
    const kept = relations.find((r) => relKey(r) === 'alpha|delta|uses');
    expect(kept?.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('survives clearCache and a full reopen from disk', async () => {
    const path = backend.path();
    const first = backend.open(path);
    await seed(first);
    await runMerge(first);
    // Backends normalise on read (e.g. isLatest/version), so the reference is the
    // post-reload view; the reopened store must match it exactly.
    first.clearCache();
    const reloaded = await snapshot(first);
    expect(reloaded.entities.map((e) => e.name)).toEqual(['alpha', 'delta', 'eps']);
    expect(reloaded.relations.map(relKey)).toContain('alpha|delta|uses');

    (first as unknown as { close?: () => void }).close?.();
    const reopened = backend.open(path);
    expect(await snapshot(reopened)).toEqual(reloaded);
    (reopened as unknown as { close?: () => void }).close?.();
  });

  it('emits entity:deleted and relation:created, and never graph:saved', async () => {
    const store = backend.open(backend.path());
    await seed(store);

    const seen: string[] = [];
    for (const ev of ['entity:deleted', 'relation:created', 'graph:saved'] as const) {
      store.events.on(ev, () => seen.push(ev));
    }
    await runMerge(store);

    expect(seen.filter((e) => e === 'entity:deleted')).toHaveLength(2);
    expect(seen.filter((e) => e === 'relation:created').length).toBeGreaterThanOrEqual(3);
    expect(seen).not.toContain('graph:saved');
  });
});

// ==================== Failure mid-merge ====================

describe.each(REAL_BACKENDS)('mergeMemories delta failure handling [$name]', (backend) => {
  it('restores merged entities and relations when appendRelations fails after the delete', async () => {
    const store = backend.open(backend.path());
    await seed(store);
    const pre = await snapshot(store);

    vi.spyOn(store, 'appendRelations').mockRejectedValueOnce(new Error('disk full'));

    await expect(runMerge(store)).rejects.toThrow('disk full');

    const post = await snapshot(store);
    // The survivor's observations were updated before the delta section; every
    // other entity and every relation must match the pre-merge state exactly.
    const preWithout = { ...pre, entities: pre.entities.filter((e) => e.name !== 'alpha') };
    const postWithout = { ...post, entities: post.entities.filter((e) => e.name !== 'alpha') };
    expect(postWithout).toEqual(preWithout);
    expect(post.entities.map((e) => e.name)).toEqual(pre.entities.map((e) => e.name));
  });

  it('reports a possibly partial merge when the rollback also fails', async () => {
    const store = backend.open(backend.path());
    await seed(store);

    vi.spyOn(store, 'appendRelations').mockRejectedValueOnce(new Error('first write failed'));
    vi.spyOn(store, 'appendEntities').mockRejectedValueOnce(new Error('rollback write failed'));

    await expect(runMerge(store)).rejects.toThrow(/graph may be partially merged/);
  });
});
