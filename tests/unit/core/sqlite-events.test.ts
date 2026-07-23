/**
 * SQLiteStorage GraphEventEmitter Tests
 *
 * SQLiteStorage now owns a `GraphEventEmitter` (`storage.events`) with
 * one-for-one emission parity with GraphStorage (JSONL):
 * - graph:loaded   — cache population (loadCache)
 * - graph:saved    — saveGraph full-graph commit
 * - entity:created — appendEntity
 * - relation:created — appendRelation
 * - entity:updated — updateEntity (with previousValues)
 * - rename events (renamed → deleted → created) are emitted by
 *   EntityManager.renameEntity on BOTH backends; storage-level
 *   renameEntity emits nothing (exactly-once contract).
 *
 * Also covers the motivating bug: GraphRankPrior serving stale PageRank
 * on a SQLite-backed ManagerContext because no events ever fired, and
 * TF-IDF event sync never activating on SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { GraphEventEmitter } from '../../../src/core/GraphEventEmitter.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { GraphRankPrior } from '../../../src/search/GraphRankPrior.js';
import { TFIDFIndexManager } from '../../../src/search/TFIDFIndexManager.js';
import { TFIDFEventSync } from '../../../src/search/TFIDFEventSync.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import {
  InMemoryColumnStore,
  type ObservationColumn,
} from '../../../src/core/columns/IColumnStore.js';
import type { Entity, Relation, GraphEvent } from '../../../src/types/types.js';

function makeEntity(name: string, observations: string[] = ['obs']): Entity {
  return {
    name,
    entityType: 'test',
    observations,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
  };
}

function makeRelation(from: string, to: string): Relation {
  return {
    from,
    to,
    relationType: 'links_to',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
  };
}

/** Subscribe a recorder that captures every event via onAny. */
function recordEvents(emitter: GraphEventEmitter): GraphEvent[] {
  const seen: GraphEvent[] = [];
  emitter.onAny((e) => seen.push(e));
  return seen;
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `sqlite-events-test-${Date.now()}-${Math.random()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors (Windows WAL locks)
  }
});

describe('SQLiteStorage graph events', () => {
  let storage: SQLiteStorage;

  beforeEach(() => {
    storage = new SQLiteStorage(join(testDir, 'graph.db'));
  });

  afterEach(() => {
    try {
      storage.close();
    } catch {
      // already closed
    }
  });

  it('exposes a GraphEventEmitter before initialization', () => {
    expect(storage.events).toBeInstanceOf(GraphEventEmitter);
    // Stable identity across accesses
    expect(storage.events).toBe(storage.events);
  });

  it('emits graph:loaded exactly once on first load', async () => {
    const seen = recordEvents(storage.events);

    await storage.loadGraph();

    const loaded = seen.filter((e) => e.type === 'graph:loaded');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ entityCount: 0, relationCount: 0 });
    // No other events on a pure load
    expect(seen).toHaveLength(1);
  });

  it('emits entity:created exactly once per appendEntity with the entity payload', async () => {
    await storage.loadGraph();
    const seen = recordEvents(storage.events);

    const entity = makeEntity('Alice', ['Engineer']);
    await storage.appendEntity(entity);

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('entity:created');
    if (seen[0].type === 'entity:created') {
      expect(seen[0].entity.name).toBe('Alice');
      expect(seen[0].entity.observations).toEqual(['Engineer']);
      expect(seen[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('emits relation:created exactly once per appendRelation with the relation payload', async () => {
    await storage.loadGraph();
    await storage.appendEntity(makeEntity('Alice'));
    await storage.appendEntity(makeEntity('Bob'));
    const seen = recordEvents(storage.events);

    await storage.appendRelation(makeRelation('Alice', 'Bob'));

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('relation:created');
    if (seen[0].type === 'relation:created') {
      expect(seen[0].relation).toMatchObject({
        from: 'Alice',
        to: 'Bob',
        relationType: 'links_to',
      });
    }
  });

  it('emits entity:updated exactly once with changes and previousValues', async () => {
    await storage.loadGraph();
    await storage.appendEntity(makeEntity('Alice', ['old observation']));
    const seen = recordEvents(storage.events);

    const updated = await storage.updateEntity('Alice', {
      observations: ['new observation'],
    });

    expect(updated).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('entity:updated');
    if (seen[0].type === 'entity:updated') {
      expect(seen[0].entityName).toBe('Alice');
      expect(seen[0].changes.observations).toEqual(['new observation']);
      expect(seen[0].previousValues?.observations).toEqual(['old observation']);
    }
  });

  it('emits nothing when updateEntity misses', async () => {
    await storage.loadGraph();
    const seen = recordEvents(storage.events);

    const updated = await storage.updateEntity('Ghost', { observations: ['x'] });

    expect(updated).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('emits graph:saved exactly once per saveGraph with entity/relation counts', async () => {
    await storage.loadGraph();
    const seen = recordEvents(storage.events);

    await storage.saveGraph({
      entities: [makeEntity('Alice'), makeEntity('Bob')],
      relations: [makeRelation('Alice', 'Bob')],
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('graph:saved');
    if (seen[0].type === 'graph:saved') {
      expect(seen[0].entityCount).toBe(2);
      expect(seen[0].relationCount).toBe(1);
    }
  });

  it('storage-level renameEntity emits NO events (EntityManager owns rename emission)', async () => {
    await storage.loadGraph();
    await storage.appendEntity(makeEntity('Old'));
    const seen = recordEvents(storage.events);

    await storage.renameEntity('Old', 'New');

    expect(seen).toHaveLength(0);
  });

  it('listeners survive clearCache and see graph:loaded again on reload', async () => {
    await storage.loadGraph();
    const seen = recordEvents(storage.events);

    storage.clearCache();
    await storage.loadGraph();

    expect(seen.filter((e) => e.type === 'graph:loaded')).toHaveLength(1);
  });
});

describe('JSONL/SQLite emission parity', () => {
  /**
   * Run an identical mutation script against a backend and return the
   * observed event-type sequence.
   */
  async function runScript(storage: GraphStorage | SQLiteStorage): Promise<{
    types: string[];
    events: GraphEvent[];
  }> {
    const events = recordEvents(storage.events);

    await storage.loadGraph();
    await storage.appendEntity(makeEntity('Alice', ['first']));
    await storage.appendEntity(makeEntity('Bob'));
    await storage.appendRelation(makeRelation('Alice', 'Bob'));
    await storage.updateEntity('Alice', { observations: ['second'] });
    await storage.saveGraph({
      entities: [makeEntity('Alice', ['second']), makeEntity('Bob')],
      relations: [makeRelation('Alice', 'Bob')],
    });

    return { types: events.map((e) => e.type), events };
  }

  it('both backends emit the same event sequence for the same mutation script', async () => {
    const jsonl = new GraphStorage(join(testDir, 'parity.jsonl'));
    const sqlite = new SQLiteStorage(join(testDir, 'parity.db'));

    try {
      const jsonlRun = await runScript(jsonl);
      const sqliteRun = await runScript(sqlite);

      expect(jsonlRun.types).toEqual([
        'graph:loaded',
        'entity:created',
        'entity:created',
        'relation:created',
        'entity:updated',
        'graph:saved',
      ]);
      expect(sqliteRun.types).toEqual(jsonlRun.types);

      // Payload parity for the entity:updated event (previousValues too)
      const jsonlUpdated = jsonlRun.events.find((e) => e.type === 'entity:updated');
      const sqliteUpdated = sqliteRun.events.find((e) => e.type === 'entity:updated');
      if (jsonlUpdated?.type === 'entity:updated' && sqliteUpdated?.type === 'entity:updated') {
        expect(sqliteUpdated.entityName).toBe(jsonlUpdated.entityName);
        expect(sqliteUpdated.changes).toEqual(jsonlUpdated.changes);
        expect(sqliteUpdated.previousValues?.observations).toEqual(
          jsonlUpdated.previousValues?.observations
        );
      }
    } finally {
      sqlite.close();
    }
  });

  it('manager-level rename emits renamed -> deleted -> created exactly once each on both backends', async () => {
    const backends: Array<{ label: string; storage: GraphStorage | SQLiteStorage }> = [
      { label: 'jsonl', storage: new GraphStorage(join(testDir, 'rename.jsonl')) },
      { label: 'sqlite', storage: new SQLiteStorage(join(testDir, 'rename.db')) },
    ];

    try {
      for (const { label, storage } of backends) {
        const entityManager = new EntityManager(storage as GraphStorage);
        await entityManager.createEntities([
          { name: 'Target', entityType: 'test', observations: ['obs'] },
        ]);

        const seen = recordEvents(storage.events);
        await entityManager.renameEntity('Target', 'Renamed');

        // Exactly once each (JSONL additionally emits graph:saved from its
        // full-file rewrite — an implementation artifact, excluded here).
        const renameSequence = seen
          .filter((e) =>
            ['entity:renamed', 'entity:deleted', 'entity:created'].includes(e.type)
          )
          .map((e) => e.type);
        expect(renameSequence, `backend: ${label}`).toEqual([
          'entity:renamed',
          'entity:deleted',
          'entity:created',
        ]);

        const deleted = seen.find((e) => e.type === 'entity:deleted');
        const created = seen.find((e) => e.type === 'entity:created');
        if (deleted?.type === 'entity:deleted') expect(deleted.entityName).toBe('Target');
        if (created?.type === 'entity:created') expect(created.entity.name).toBe('Renamed');
      }
    } finally {
      const sqlite = backends[1].storage as SQLiteStorage;
      sqlite.close();
    }
  });
});

describe('GraphRankPrior invalidation via ManagerContext (stale-PageRank regression)', () => {
  const prevStorageType = process.env.MEMORY_STORAGE_TYPE;

  afterEach(() => {
    if (prevStorageType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = prevStorageType;
  });

  async function assertPriorInvalidates(ctx: ManagerContext): Promise<void> {
    await ctx.entityManager.createEntities([
      { name: 'Alpha', entityType: 'test', observations: ['a'] },
      { name: 'Beta', entityType: 'test', observations: ['b'] },
      { name: 'Gamma', entityType: 'test', observations: ['c'] },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'Alpha', to: 'Beta', relationType: 'links_to' },
    ]);

    const prior: GraphRankPrior = ctx.graphRankPrior;

    // Warm the cache: Gamma is isolated.
    expect(await prior.getDegree('Gamma')).toBe(0);
    const before = await prior.getScores(['Alpha', 'Beta', 'Gamma']);
    expect(before.get('Gamma')).toBe(0);

    // Relation mutation through the manager (persists via saveGraph).
    await ctx.relationManager.createRelations([
      { from: 'Alpha', to: 'Gamma', relationType: 'links_to' },
      { from: 'Beta', to: 'Gamma', relationType: 'links_to' },
    ]);

    // Without event-driven invalidation the prior would still serve the
    // stale degree-0 / score-0 snapshot for Gamma.
    expect(await prior.getDegree('Gamma')).toBe(2);
    const after = await prior.getScores(['Alpha', 'Beta', 'Gamma']);
    expect(after.get('Gamma')!).toBeGreaterThan(0);

    // Entity mutation through the manager invalidates too.
    await ctx.entityManager.createEntities([
      { name: 'Delta', entityType: 'test', observations: ['d'] },
    ]);
    await ctx.relationManager.createRelations([
      { from: 'Delta', to: 'Alpha', relationType: 'links_to' },
    ]);
    expect(await prior.getDegree('Delta')).toBe(1);

    // Entity deletion (cascades relations) invalidates as well.
    const alphaDegreeBefore = await prior.getDegree('Alpha');
    await ctx.entityManager.deleteEntities(['Gamma']);
    expect(await prior.getDegree('Gamma')).toBe(0);
    expect(await prior.getDegree('Alpha')).toBe(alphaDegreeBefore - 1);
  }

  it('invalidates on entity/relation mutation on the SQLite backend', async () => {
    process.env.MEMORY_STORAGE_TYPE = 'sqlite';
    const ctx = new ManagerContext(join(testDir, 'prior.db'));
    try {
      await assertPriorInvalidates(ctx);
    } finally {
      (ctx.storage as unknown as SQLiteStorage).close();
    }
  });

  it('invalidates on entity/relation mutation on the JSONL backend', async () => {
    process.env.MEMORY_STORAGE_TYPE = 'jsonl';
    const ctx = new ManagerContext(join(testDir, 'prior.jsonl'));
    await assertPriorInvalidates(ctx);
  });
});

describe('Columnar observation shadow store on the SQLite backend', () => {
  it('mirrors entity events into an attached column store (previously inert: no emitter)', async () => {
    const storage = new SQLiteStorage(join(testDir, 'columnar.db'));
    try {
      await storage.loadGraph();
      const manager = new ObservationManager(storage as unknown as GraphStorage);
      const store = new InMemoryColumnStore<ObservationColumn>();
      // Before SQLiteStorage had an emitter this call crashed
      // (`storage.events` was undefined).
      manager.setColumnStore(store);

      // entity:created fan-out
      await storage.appendEntity(makeEntity('ColEntity', ['columnar observation']));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await store.get('ColEntity')).toEqual(['columnar observation']);

      // entity:updated fan-out (observations change)
      await storage.updateEntity('ColEntity', { observations: ['updated observation'] });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await store.get('ColEntity')).toEqual(['updated observation']);

      expect(await manager.getObservationsFor('ColEntity')).toEqual(['updated observation']);
    } finally {
      storage.close();
    }
  });
});

describe('TF-IDF event sync on the SQLite backend via ManagerContext', () => {
  const prevStorageType = process.env.MEMORY_STORAGE_TYPE;

  beforeEach(() => {
    process.env.MEMORY_STORAGE_TYPE = 'sqlite';
  });

  afterEach(() => {
    if (prevStorageType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = prevStorageType;
  });

  it('keeps the TF-IDF index in sync after mutations', async () => {
    const ctx = new ManagerContext(join(testDir, 'tfidf.db'));
    const indexManager = new TFIDFIndexManager(testDir);
    let sync: TFIDFEventSync | null = null;

    try {
      await ctx.entityManager.createEntities([
        { name: 'Doc1', entityType: 'test', observations: ['quantum entanglement'] },
      ]);

      await indexManager.buildIndex(await ctx.storage.loadGraph());
      sync = new TFIDFEventSync(indexManager, ctx.storage.events, ctx.storage, {
        coalesceMs: 0,
      });
      sync.enable();

      expect(indexManager.getIndex()?.documents.has('Doc1')).toBe(true);

      // entity:created via appendEntity
      await ctx.storage.appendEntity(makeEntity('Doc2', ['superconductor research']));
      expect(indexManager.getIndex()?.documents.has('Doc2')).toBe(true);
      expect(
        indexManager.getIndex()?.documents.get('Doc2')?.terms
      ).toHaveProperty('superconductor');

      // entity:updated via updateEntity (handler awaits loadGraph — give
      // the microtask queue a beat before asserting)
      await ctx.storage.updateEntity('Doc1', {
        observations: ['tokamak plasma confinement'],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        indexManager.getIndex()?.documents.get('Doc1')?.terms
      ).toHaveProperty('tokamak');

      // rename: entity:deleted + entity:created (emitted by EntityManager)
      await ctx.entityManager.renameEntity('Doc2', 'Doc2Renamed');
      expect(indexManager.getIndex()?.documents.has('Doc2')).toBe(false);
      expect(indexManager.getIndex()?.documents.has('Doc2Renamed')).toBe(true);
    } finally {
      sync?.disable();
      (ctx.storage as unknown as SQLiteStorage).close();
    }
  });
});
