/**
 * S2/S3/S6 Write-Path Delta Persistence Tests
 *
 * Covers the keystone write-path optimization:
 * - New storage delta primitives on both backends:
 *   appendEntities / appendRelations / updateEntities / deleteEntities /
 *   deleteRelations
 * - Manager-level event contract: per-item events fire exactly once per
 *   logical change for batch mutations; `graph:saved` is reserved for true
 *   full-graph writes (saveGraph / compaction / rename rewrite)
 * - S3 SQLite tuning: synchronous pragma default + env override, FTS
 *   cleanliness after targeted deletes, dangling-parentId parity with JSONL
 * - S6 generation-counter search-cache invalidation: relation-only writes
 *   leave the entity-text-only (`ranked`) cache valid
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../../src/core/SQLiteStorage.js';
import { EntityManager } from '../../../src/core/EntityManager.js';
import { RelationManager } from '../../../src/core/RelationManager.js';
import { ObservationManager } from '../../../src/core/ObservationManager.js';
import {
  searchCaches,
  clearAllSearchCaches,
  bumpEntityGeneration,
  bumpRelationGeneration,
  getGraphGenerations,
  SearchCache,
} from '../../../src/utils/searchCache.js';
import type { Entity, Relation, GraphEvent, KnowledgeGraph } from '../../../src/types/types.js';
import { EntityNotFoundError } from '../../../src/utils/errors.js';

function makeEntity(name: string, extra: Partial<Entity> = {}): Entity {
  return {
    name,
    entityType: 'test',
    observations: ['obs'],
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
    ...extra,
  };
}

function makeRelation(from: string, to: string, relationType = 'links_to'): Relation {
  return {
    from,
    to,
    relationType,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastModified: '2024-01-01T00:00:00.000Z',
  };
}

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `write-path-delta-${Date.now()}-${Math.random()}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors (Windows WAL locks)
  }
});

type Backend = 'jsonl' | 'sqlite';

function createStorage(backend: Backend): GraphStorage {
  if (backend === 'jsonl') {
    return new GraphStorage(join(testDir, `delta-${Math.random()}.jsonl`));
  }
  return new SQLiteStorage(join(testDir, `delta-${Math.random()}.db`)) as unknown as GraphStorage;
}

function closeStorage(storage: GraphStorage): void {
  const maybeSqlite = storage as unknown as SQLiteStorage;
  if (typeof maybeSqlite.close === 'function') {
    maybeSqlite.close();
  }
}

// ============================================================
// Storage delta primitives — both backends
// ============================================================

for (const backend of ['jsonl', 'sqlite'] as Backend[]) {
  describe(`storage delta primitives (${backend})`, () => {
    let storage: GraphStorage;

    beforeEach(async () => {
      storage = createStorage(backend);
      await storage.loadGraph();
    });

    afterEach(() => {
      closeStorage(storage);
    });

    it('appendEntities persists all entities in one call and emits entity:created per entity', async () => {
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const entities = [makeEntity('A'), makeEntity('B'), makeEntity('C')];
      await storage.appendEntities(entities);

      const graph = await storage.loadGraph();
      expect(graph.entities.map((e) => e.name).sort()).toEqual(['A', 'B', 'C']);
      expect(seen.map((e) => e.type)).toEqual([
        'entity:created',
        'entity:created',
        'entity:created',
      ]);
      // No graph:saved for a delta write
      expect(seen.some((e) => e.type === 'graph:saved')).toBe(false);

      // Survives a cold reload
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities).toHaveLength(3);
    });

    it('appendEntities upserts duplicate names instead of duplicating cache entries', async () => {
      await storage.appendEntities([makeEntity('Dup', { observations: ['v1'] })]);
      await storage.appendEntities([makeEntity('Dup', { observations: ['v2'] })]);

      const graph = await storage.loadGraph();
      expect(graph.entities).toHaveLength(1);
      expect(graph.entities[0].observations).toEqual(['v2']);
      expect(storage.getEntityByName('Dup')?.observations).toEqual(['v2']);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities).toHaveLength(1);
      expect(reloaded.entities[0].observations).toEqual(['v2']);
    });

    it('appendEntities with an empty array is a no-op and emits nothing', async () => {
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));
      await storage.appendEntities([]);
      expect(seen).toHaveLength(0);
    });

    it('appendRelations persists relations and emits relation:created per relation', async () => {
      await storage.appendEntities([makeEntity('A'), makeEntity('B'), makeEntity('C')]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      await storage.appendRelations([makeRelation('A', 'B'), makeRelation('B', 'C')]);

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(2);
      expect(seen.map((e) => e.type)).toEqual(['relation:created', 'relation:created']);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.relations).toHaveLength(2);
    });

    it('appendRelation upserts an existing composite key in place (no cache duplicate)', async () => {
      await storage.appendEntities([makeEntity('A'), makeEntity('B')]);
      await storage.appendRelation(makeRelation('A', 'B'));
      await storage.appendRelation({ ...makeRelation('A', 'B'), weight: 0.9 });

      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0].weight).toBe(0.9);
      // Relation index agrees (no ghost duplicate)
      expect(storage.getRelationsFrom('A')).toHaveLength(1);
      expect(storage.getRelationsFrom('A')[0].weight).toBe(0.9);
    });

    it('updateEntities applies a batch atomically with one shared timestamp', async () => {
      await storage.appendEntities([makeEntity('A'), makeEntity('B')]);
      const timestamp = '2030-05-05T05:05:05.000Z';

      const updated = await storage.updateEntities(
        [
          { name: 'A', updates: { importance: 5 } },
          { name: 'B', updates: { observations: ['changed'] } },
        ],
        { timestamp },
      );

      expect(updated).toHaveLength(2);
      expect(updated[0].importance).toBe(5);
      expect(updated[0].lastModified).toBe(timestamp);
      expect(updated[1].observations).toEqual(['changed']);
      expect(updated[1].lastModified).toBe(timestamp);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      const a = reloaded.entities.find((e) => e.name === 'A')!;
      const b = reloaded.entities.find((e) => e.name === 'B')!;
      expect(a.importance).toBe(5);
      expect(b.observations).toEqual(['changed']);
    });

    it('updateEntities validates every name before mutating anything (all-or-nothing)', async () => {
      await storage.appendEntities([makeEntity('A', { importance: 1 })]);

      await expect(
        storage.updateEntities([
          { name: 'A', updates: { importance: 9 } },
          { name: 'Ghost', updates: { importance: 2 } },
        ]),
      ).rejects.toThrow(EntityNotFoundError);

      // First update must NOT have been applied
      expect(storage.getEntityByName('A')?.importance).toBe(1);
    });

    it('updateEntities emits entity:updated with changes and previousValues per entity', async () => {
      await storage.appendEntities([makeEntity('A', { importance: 1 })]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      await storage.updateEntities([{ name: 'A', updates: { importance: 7 } }]);

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe('entity:updated');
      if (seen[0].type === 'entity:updated') {
        expect(seen[0].entityName).toBe('A');
        expect(seen[0].changes.importance).toBe(7);
        expect(seen[0].previousValues?.importance).toBe(1);
      }
    });

    it('deleteEntities removes entities, cascades relations, and emits per-item delete events', async () => {
      await storage.appendEntities([makeEntity('A'), makeEntity('B'), makeEntity('C')]);
      await storage.appendRelations([
        makeRelation('A', 'B'),
        makeRelation('B', 'C'),
        makeRelation('C', 'A'),
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const result = await storage.deleteEntities(['A']);

      expect(result.deletedEntities.map((e) => e.name)).toEqual(['A']);
      expect(result.deletedRelations).toHaveLength(2); // A->B and C->A

      const graph = await storage.loadGraph();
      expect(graph.entities.map((e) => e.name).sort()).toEqual(['B', 'C']);
      expect(graph.relations).toHaveLength(1);
      expect(graph.relations[0]).toMatchObject({ from: 'B', to: 'C' });

      const types = seen.map((e) => e.type).sort();
      expect(types).toEqual(['entity:deleted', 'relation:deleted', 'relation:deleted']);
      expect(seen.some((e) => e.type === 'graph:saved')).toBe(false);

      // Index maintenance
      expect(storage.hasEntity('A')).toBe(false);
      expect(storage.getRelationsFor('A')).toHaveLength(0);
      expect(storage.getEntitiesByType('test')).toHaveLength(2);

      // Survives a cold reload
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities).toHaveLength(2);
      expect(reloaded.relations).toHaveLength(1);
    });

    it('deleteEntities with only unknown names performs no write and emits nothing', async () => {
      await storage.appendEntities([makeEntity('A')]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const result = await storage.deleteEntities(['Ghost']);

      expect(result.deletedEntities).toHaveLength(0);
      expect(result.deletedRelations).toHaveLength(0);
      expect(seen).toHaveLength(0);
      expect((await storage.loadGraph()).entities).toHaveLength(1);
    });

    it('deleteRelations removes matching keys and bumps touched entity timestamps atomically', async () => {
      await storage.appendEntities([makeEntity('A'), makeEntity('B')]);
      await storage.appendRelations([makeRelation('A', 'B')]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));
      const timestamp = '2031-01-01T00:00:00.000Z';

      const deleted = await storage.deleteRelations(
        [{ from: 'A', to: 'B', relationType: 'links_to' }],
        { touchEntities: ['A', 'B'], timestamp },
      );

      expect(deleted).toHaveLength(1);
      const graph = await storage.loadGraph();
      expect(graph.relations).toHaveLength(0);
      expect(storage.getEntityByName('A')?.lastModified).toBe(timestamp);
      expect(storage.getEntityByName('B')?.lastModified).toBe(timestamp);

      const types = seen.map((e) => e.type);
      expect(types.filter((t) => t === 'relation:deleted')).toHaveLength(1);
      expect(types.filter((t) => t === 'entity:updated')).toHaveLength(2);
      expect(types.includes('graph:saved')).toBe(false);

      // Persisted state agrees after cold reload
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.relations).toHaveLength(0);
      expect(reloaded.entities.find((e) => e.name === 'A')?.lastModified).toBe(timestamp);
    });

    it('deleteRelations with unmatched keys still bumps requested entity timestamps (historical semantics)', async () => {
      await storage.appendEntities([makeEntity('A')]);
      const timestamp = '2032-02-02T00:00:00.000Z';

      const deleted = await storage.deleteRelations(
        [{ from: 'A', to: 'Ghost', relationType: 'nope' }],
        { touchEntities: ['A', 'Ghost'], timestamp },
      );

      expect(deleted).toHaveLength(0);
      expect(storage.getEntityByName('A')?.lastModified).toBe(timestamp);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities[0].lastModified).toBe(timestamp);
    });
  });
}

// ============================================================
// Manager-level event contract — both backends
// ============================================================

for (const backend of ['jsonl', 'sqlite'] as Backend[]) {
  describe(`manager event contract (${backend})`, () => {
    let storage: GraphStorage;
    let entityManager: EntityManager;
    let relationManager: RelationManager;
    let observationManager: ObservationManager;

    beforeEach(async () => {
      storage = createStorage(backend);
      await storage.loadGraph();
      entityManager = new EntityManager(storage);
      relationManager = new RelationManager(storage);
      observationManager = new ObservationManager(storage);
    });

    afterEach(() => {
      closeStorage(storage);
    });

    it('createEntities emits entity:created per entity and no graph:saved', async () => {
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const created = await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['a'] },
        { name: 'E2', entityType: 'test', observations: ['b'] },
      ]);

      expect(created).toHaveLength(2);
      expect(seen.map((e) => e.type)).toEqual(['entity:created', 'entity:created']);
    });

    it('createEntities dedup-skip still returns only new entities and emits only for them', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['a'] },
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const created = await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['dup'] },
        { name: 'E2', entityType: 'test', observations: ['new'] },
      ]);

      expect(created.map((e) => e.name)).toEqual(['E2']);
      expect(seen.map((e) => e.type)).toEqual(['entity:created']);
      // Duplicate name must not have been overwritten
      expect(storage.getEntityByName('E1')?.observations).toEqual(['a']);
    });

    it('updateEntity emits a single entity:updated (no graph:saved)', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['a'] },
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const updated = await entityManager.updateEntity('E1', { importance: 4 });

      expect(updated.importance).toBe(4);
      expect(seen.map((e) => e.type)).toEqual(['entity:updated']);
    });

    it('deleteEntities emits entity:deleted plus cascaded relation:deleted (no graph:saved)', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: [] },
        { name: 'E2', entityType: 'test', observations: [] },
      ]);
      await relationManager.createRelations([
        { from: 'E1', to: 'E2', relationType: 'links_to' } as Relation,
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      await entityManager.deleteEntities(['E1']);

      const types = seen.map((e) => e.type).sort();
      expect(types).toEqual(['entity:deleted', 'relation:deleted']);
    });

    it('createRelations / deleteRelations emit per-item events (no graph:saved)', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: [] },
        { name: 'E2', entityType: 'test', observations: [] },
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      await relationManager.createRelations([
        { from: 'E1', to: 'E2', relationType: 'links_to' } as Relation,
      ]);
      await relationManager.deleteRelations([
        { from: 'E1', to: 'E2', relationType: 'links_to' } as Relation,
      ]);

      const types = seen.map((e) => e.type);
      expect(types.filter((t) => t === 'relation:created')).toHaveLength(1);
      expect(types.filter((t) => t === 'relation:deleted')).toHaveLength(1);
      // affected entities get lastModified bumps as entity:updated
      expect(types.filter((t) => t === 'entity:updated')).toHaveLength(2);
      expect(types.includes('graph:saved')).toBe(false);
    });

    it('addObservations emits entity:updated per touched entity (no graph:saved)', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['a'] },
        { name: 'E2', entityType: 'test', observations: ['b'] },
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const results = await observationManager.addObservations([
        { entityName: 'E1', contents: ['new fact'] },
        { entityName: 'E2', contents: ['b'] }, // exact duplicate — no change
      ]);

      expect(results.find((r) => r.entityName === 'E1')?.addedObservations).toEqual(['new fact']);
      expect(results.find((r) => r.entityName === 'E2')?.addedObservations).toEqual([]);
      expect(seen.map((e) => e.type)).toEqual(['entity:updated']);
      expect(storage.getEntityByName('E1')?.observations).toEqual(['a', 'new fact']);
    });

    it('deleteObservations persists via a delta write and updates the entity', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['keep', 'drop'] },
      ]);
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      await observationManager.deleteObservations([
        { entityName: 'E1', observations: ['drop'] },
      ]);

      expect(seen.map((e) => e.type)).toEqual(['entity:updated']);
      expect(storage.getEntityByName('E1')?.observations).toEqual(['keep']);

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities[0].observations).toEqual(['keep']);
    });

    it('invalidateRelation persists the validUntil via upsert and survives reload', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: [] },
        { name: 'E2', entityType: 'test', observations: [] },
      ]);
      await relationManager.createRelations([
        { from: 'E1', to: 'E2', relationType: 'works_on' } as Relation,
      ]);

      await relationManager.invalidateRelation('E1', 'works_on', 'E2', '2030-01-01');

      const rels = await relationManager.getRelations('E1');
      expect(rels).toHaveLength(1);
      expect(rels[0].properties?.validUntil).toBe('2030-01-01');

      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.relations).toHaveLength(1);
      expect(reloaded.relations[0].properties?.validUntil).toBe('2030-01-01');
    });

    it('saveGraph still emits graph:saved exactly once (reserved for full-graph writes)', async () => {
      const seen: GraphEvent[] = [];
      storage.events.onAny((e) => seen.push(e));

      const graph: KnowledgeGraph = {
        entities: [makeEntity('Bulk1'), makeEntity('Bulk2')],
        relations: [],
      };
      await storage.saveGraph(graph);

      expect(seen.map((e) => e.type)).toEqual(['graph:saved']);
    });

    it('getEntity result reflects live state after in-place delta updates', async () => {
      await entityManager.createEntities([
        { name: 'E1', entityType: 'test', observations: ['a'] },
      ]);
      await entityManager.updateEntity('E1', { importance: 8 });
      const fetched = await entityManager.getEntity('E1');
      expect(fetched?.importance).toBe(8);
    });
  });
}

// ============================================================
// S6 — generation-counter search-cache invalidation
// ============================================================

describe('S6 generation-counter cache invalidation', () => {
  beforeEach(() => {
    clearAllSearchCaches();
  });

  it('bump functions advance the reported generations monotonically', () => {
    const before = getGraphGenerations();
    bumpEntityGeneration();
    bumpRelationGeneration();
    bumpRelationGeneration();
    const after = getGraphGenerations();
    expect(after.entity).toBe(before.entity + 1);
    expect(after.relation).toBe(before.relation + 2);
  });

  it('a cache without generationDeps keeps entries across generation bumps (legacy TTL behavior)', () => {
    const cache = new SearchCache<string>(10, 60_000);
    cache.set({ q: 'x' }, 'value');
    bumpEntityGeneration();
    bumpRelationGeneration();
    expect(cache.get({ q: 'x' })).toBe('value');
  });

  it('an entity-dependent cache invalidates lazily when the entity generation moves', () => {
    const cache = new SearchCache<string>(10, 60_000, { generationDeps: ['entity'] });
    cache.set({ q: 'x' }, 'value');
    expect(cache.get({ q: 'x' })).toBe('value');
    bumpRelationGeneration(); // unrelated
    expect(cache.get({ q: 'x' })).toBe('value');
    bumpEntityGeneration();
    expect(cache.get({ q: 'x' })).toBeUndefined();
    expect(cache.has({ q: 'x' })).toBe(false);
  });

  it('a dual-dependent cache invalidates on either generation moving', () => {
    const cache = new SearchCache<string>(10, 60_000, {
      generationDeps: ['entity', 'relation'],
    });
    cache.set({ q: 'a' }, 'v1');
    bumpRelationGeneration();
    expect(cache.get({ q: 'a' })).toBeUndefined();

    cache.set({ q: 'b' }, 'v2');
    bumpEntityGeneration();
    expect(cache.get({ q: 'b' })).toBeUndefined();
  });

  it('relation-only writes leave the global ranked cache valid but invalidate the basic cache', async () => {
    const storage = createStorage('jsonl');
    await storage.loadGraph();
    await storage.appendEntities([makeEntity('A'), makeEntity('B')]);

    searchCaches.ranked.set({ q: 'entity-text' }, []);
    searchCaches.basic.set({ q: 'graph-slice' }, { entities: [], relations: [] });

    // Relation-only write
    await storage.appendRelation(makeRelation('A', 'B'));

    expect(searchCaches.ranked.get({ q: 'entity-text' })).toEqual([]);
    expect(searchCaches.basic.get({ q: 'graph-slice' })).toBeUndefined();

    // Entity write invalidates ranked too
    await storage.appendEntity(makeEntity('C'));
    expect(searchCaches.ranked.get({ q: 'entity-text' })).toBeUndefined();
  });

  it('clearAllSearchCaches still fully clears the global caches', () => {
    searchCaches.ranked.set({ q: 'x' }, []);
    clearAllSearchCaches();
    expect(searchCaches.ranked.size).toBe(0);
  });
});

// ============================================================
// Segment-mode fallback (MEMORY_STORAGE_SEGMENT_COUNT >= 2)
// ============================================================

describe('segment-mode delta fallback (full saveAll per call, documented)', () => {
  const prev = process.env.MEMORY_STORAGE_SEGMENT_COUNT;

  beforeEach(() => {
    process.env.MEMORY_STORAGE_SEGMENT_COUNT = '4';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = prev;
  });

  it('append/update/delete primitives stay correct and emit per-item events in segment mode', async () => {
    const storage = new GraphStorage(join(testDir, 'segmented.jsonl'));
    await storage.loadGraph();
    const seen: GraphEvent[] = [];
    storage.events.onAny((e) => seen.push(e));

    await storage.appendEntities([makeEntity('S1'), makeEntity('S2'), makeEntity('S3')]);
    await storage.appendRelations([makeRelation('S1', 'S2')]);
    await storage.updateEntities([{ name: 'S2', updates: { importance: 6 } }]);
    await storage.deleteEntities(['S1']);

    const types = seen.map((e) => e.type);
    expect(types.filter((t) => t === 'entity:created')).toHaveLength(3);
    expect(types.filter((t) => t === 'relation:created')).toHaveLength(1);
    expect(types.filter((t) => t === 'entity:updated')).toHaveLength(1);
    expect(types.filter((t) => t === 'entity:deleted')).toHaveLength(1);
    expect(types.filter((t) => t === 'relation:deleted')).toHaveLength(1);
    // Segment saveAll is an internal implementation detail — the delta
    // primitives still do not emit graph:saved.
    expect(types.includes('graph:saved')).toBe(false);

    const graph = await storage.loadGraph();
    expect(graph.entities.map((e) => e.name).sort()).toEqual(['S2', 'S3']);
    expect(graph.entities.find((e) => e.name === 'S2')?.importance).toBe(6);
    expect(graph.relations).toHaveLength(0);

    // Cold reload from the segment files agrees
    storage.clearCache();
    const reloaded = await storage.loadGraph();
    expect(reloaded.entities.map((e) => e.name).sort()).toEqual(['S2', 'S3']);
    expect(reloaded.relations).toHaveLength(0);
  });
});

// ============================================================
// S3 — SQLite write-side tuning
// ============================================================

describe('S3 SQLite tuning', () => {
  afterEach(() => {
    delete process.env.MEMORY_SQLITE_SYNCHRONOUS;
  });

  function pragmaValue(storage: SQLiteStorage, name: string): unknown {
    const db = (storage as unknown as { db: { pragma(q: string, o?: { simple: boolean }): unknown } }).db;
    return db.pragma(name, { simple: true });
  }

  it('defaults synchronous to NORMAL (1) and sets busy_timeout/cache_size/temp_store', async () => {
    const storage = new SQLiteStorage(join(testDir, 'pragma-default.db'));
    try {
      await storage.ensureLoaded();
      expect(pragmaValue(storage, 'synchronous')).toBe(1); // NORMAL
      expect(pragmaValue(storage, 'busy_timeout')).toBe(5000);
      expect(pragmaValue(storage, 'cache_size')).toBe(-64000);
      expect(pragmaValue(storage, 'temp_store')).toBe(2); // MEMORY
    } finally {
      storage.close();
    }
  });

  it('honors MEMORY_SQLITE_SYNCHRONOUS=FULL and falls back to NORMAL on invalid values', async () => {
    process.env.MEMORY_SQLITE_SYNCHRONOUS = 'full';
    const full = new SQLiteStorage(join(testDir, 'pragma-full.db'));
    try {
      await full.ensureLoaded();
      expect(pragmaValue(full, 'synchronous')).toBe(2); // FULL
    } finally {
      full.close();
    }

    process.env.MEMORY_SQLITE_SYNCHRONOUS = 'bogus';
    const bogus = new SQLiteStorage(join(testDir, 'pragma-bogus.db'));
    try {
      await bogus.ensureLoaded();
      expect(pragmaValue(bogus, 'synchronous')).toBe(1); // NORMAL fallback
    } finally {
      bogus.close();
    }
  });

  it('deleteEntities keeps the FTS index clean (deleted entities stop matching)', async () => {
    const storage = new SQLiteStorage(join(testDir, 'fts-clean.db'));
    try {
      await storage.loadGraph();
      await storage.appendEntities([
        makeEntity('FtsTarget', { observations: ['zeppelin research'] }),
        makeEntity('FtsKeeper', { observations: ['zeppelin archive'] }),
      ]);

      expect(storage.fullTextSearch('zeppelin').map((r) => r.name).sort()).toEqual([
        'FtsKeeper',
        'FtsTarget',
      ]);

      await storage.deleteEntities(['FtsTarget']);

      expect(storage.fullTextSearch('zeppelin').map((r) => r.name)).toEqual(['FtsKeeper']);
    } finally {
      storage.close();
    }
  });

  it('deleteEntities preserves dangling parentId on children (JSONL parity)', async () => {
    const storage = new SQLiteStorage(join(testDir, 'dangling-parent.db'));
    try {
      await storage.loadGraph();
      await storage.appendEntities([
        makeEntity('Parent'),
        makeEntity('Child', { parentId: 'Parent' }),
      ]);

      await storage.deleteEntities(['Parent']);

      // In-memory state keeps the dangling reference (historical semantics)
      expect(storage.getEntityByName('Child')?.parentId).toBe('Parent');

      // Cold reload from SQLite agrees
      storage.clearCache();
      const reloaded = await storage.loadGraph();
      expect(reloaded.entities.find((e) => e.name === 'Child')?.parentId).toBe('Parent');
    } finally {
      storage.close();
    }
  });
});
