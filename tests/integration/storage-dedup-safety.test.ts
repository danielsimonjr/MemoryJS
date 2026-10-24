/**
 * Safety net for the storage deduplication work.
 *
 * Pins the observable behaviour of the storage layer before shared helpers
 * replace copied code. Each variant runs the same checks:
 * - JSONL, one file;
 * - JSONL, four segments (`MEMORY_STORAGE_SEGMENT_COUNT=4`);
 * - SQLite.
 *
 * The expected values are literals recorded from the code before the change.
 * A check that fails after a refactor means behaviour changed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GraphStorage } from '../../src/core/GraphStorage.js';
import { SQLiteStorage } from '../../src/core/SQLiteStorage.js';
import { ManagerContext, type ManagerContextOptions } from '../../src/core/ManagerContext.js';
import { getGraphGenerations } from '../../src/utils/searchCache.js';
import { NameIndex, ObservationIndex, RelationIndex, TypeIndex } from '../../src/utils/indexes.js';
import type { Entity, Relation } from '../../src/types/types.js';
import { injectFlushFailure } from '../test-utils/inject-flush-failure.js';
import { microtaskTicks } from '../test-utils/microtask-ticks.js';

type Store = GraphStorage | SQLiteStorage;

/** One row of the R01 append trace. `ticks` is set only when it is measured. */
interface R01Step {
  op: string;
  ticks?: number;
  events: string[];
  entityDelta: number;
  relationDelta: number;
  nameIndexAdds: number;
  relationIndexAdds: number;
  writes: number;
  pendingAppends: number;
}

interface Variant {
  /** Name shown in the test titles. */
  label: string;
  /** True for the SQLite backend. */
  sqlite: boolean;
  /** Environment variables that the variant sets. */
  env: Record<string, string>;
  /** File name of the storage inside the temporary directory. */
  file: string;
}

const VARIANTS: readonly Variant[] = [
  { label: 'JSONL', sqlite: false, env: {}, file: 'memory.jsonl' },
  { label: 'JSONL with 4 segments', sqlite: false, env: { MEMORY_STORAGE_SEGMENT_COUNT: '4' }, file: 'memory.jsonl' },
  { label: 'SQLite', sqlite: true, env: {}, file: 'memory.db' },
];

/** Environment keys that select the backend. Saved and restored around each test. */
const ENV_KEYS = ['MEMORY_STORAGE_SEGMENT_COUNT', 'MEMORY_STORAGE_TYPE'] as const;

/** Entities and relations in a fixed order, for comparisons that ignore insert order. */
function sortedGraph(graph: { entities: readonly Entity[]; relations: readonly Relation[] }) {
  return {
    entities: [...graph.entities].sort((a, b) => a.name.localeCompare(b.name)),
    relations: [...graph.relations].sort((a, b) =>
      relationKey(a).localeCompare(relationKey(b)),
    ),
  };
}

/**
 * The fields that the caller supplies, in a fixed order. The managers add
 * timestamps and version fields on write, so a round trip is compared on
 * these fields only.
 */
function projectGraph(entities: readonly Entity[], relations: readonly Relation[]) {
  return {
    entities: entities
      .map(e => ({ name: e.name, entityType: e.entityType, observations: e.observations }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relations: relations
      .map(r => ({ from: r.from, to: r.to, relationType: r.relationType }))
      .sort((a, b) => relationKey(a).localeCompare(relationKey(b))),
  };
}

/**
 * A loaded graph without the clock fields. The loader fills `createdAt` and
 * `lastModified` from the current time when the file has no value, so two
 * loads of the same file differ in these fields only.
 */
function withoutClock(graph: { entities: readonly Entity[]; relations: readonly Relation[] }) {
  return {
    entities: graph.entities.map(e => ({ ...e, createdAt: undefined, lastModified: undefined })),
    relations: graph.relations.map(r => ({ ...r, createdAt: undefined, lastModified: undefined })),
  };
}

function relationKey(relation: Relation): string {
  return [relation.from, relation.to, relation.relationType].join('|');
}

/** Twenty entities. Entity 00 holds the marker word `quasarlens`. */
function seedEntities(): Entity[] {
  return Array.from({ length: 20 }, (_, i) => {
    const id = String(i).padStart(2, '0');
    const observations = [`alpha note ${i}`, `beta fact ${i}`];
    if (i === 0) observations.push('quasarlens marker');
    return {
      name: `ent-${id}`,
      entityType: i % 2 === 0 ? 'person' : 'project',
      observations,
    };
  });
}

/**
 * Thirty relations with unique keys and no self-loops.
 * Relation `i` runs from entity `i % 20` to entity `(7 * i + 3) % 20`.
 */
function seedRelations(): Relation[] {
  return Array.from({ length: 30 }, (_, i) => ({
    from: `ent-${String(i % 20).padStart(2, '0')}`,
    to: `ent-${String((7 * i + 3) % 20).padStart(2, '0')}`,
    relationType: i < 20 ? 'knows' : 'works_with',
  }));
}

function entity(name: string, observation: string): Entity {
  return { name, entityType: 'concept', observations: [observation] };
}

function relation(from: string, to: string, relationType: string): Relation {
  return { from, to, relationType };
}

/** Append trace recorded from the code before the R01 refactor, one list per variant. */
const R01_TRACE: Record<string, Array<Omit<R01Step, 'ticks'>>> = {
  'JSONL': [
      { op: 'appendEntity', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 1, relationIndexAdds: 0, writes: 1, pendingAppends: 1 },
      { op: 'appendEntities', events: ['entity:created', 'entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 2, relationIndexAdds: 0, writes: 1, pendingAppends: 3 },
      { op: 'appendRelation', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 1, writes: 1, pendingAppends: 4 },
      { op: 'appendRelations', events: ['relation:created', 'relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 2, writes: 1, pendingAppends: 6 },
      { op: 'appendEntity replace', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 7 },
      { op: 'appendRelation replace', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 8 },
  ],
  'JSONL with 4 segments': [
      { op: 'appendEntity', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 1, relationIndexAdds: 0, writes: 1, pendingAppends: 0 },
      { op: 'appendEntities', events: ['entity:created', 'entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 2, relationIndexAdds: 0, writes: 1, pendingAppends: 0 },
      { op: 'appendRelation', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 1, writes: 1, pendingAppends: 0 },
      { op: 'appendRelations', events: ['relation:created', 'relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 2, writes: 1, pendingAppends: 0 },
      { op: 'appendEntity replace', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 0 },
      { op: 'appendRelation replace', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 0 },
  ],
  'SQLite': [
      { op: 'appendEntity', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 1, relationIndexAdds: 0, writes: 1, pendingAppends: 1 },
      { op: 'appendEntities', events: ['entity:created', 'entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 2, relationIndexAdds: 0, writes: 2, pendingAppends: 3 },
      { op: 'appendRelation', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 1, writes: 1, pendingAppends: 4 },
      { op: 'appendRelations', events: ['relation:created', 'relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 2, writes: 2, pendingAppends: 6 },
      { op: 'appendEntity replace', events: ['entity:created'], entityDelta: 1, relationDelta: 0, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 7 },
      { op: 'appendRelation replace', events: ['relation:created'], entityDelta: 0, relationDelta: 1, nameIndexAdds: 0, relationIndexAdds: 0, writes: 1, pendingAppends: 8 },
  ],
};

/** Microtask turns per append call, in call order, recorded before the R01 refactor. */
const R01_TICKS: Record<string, number[]> = {
  'JSONL': [6, 6, 6, 6, 6, 6],
  'JSONL with 4 segments': [6, 6, 6, 6, 6, 6],
  'SQLite': [5, 5, 5, 5, 5, 5],
};

/**
 * Order of the reads of an entity `name` and of the storage field `lowercaseCache` during
 * `deleteEntities(['ent-01'])`, one list per variant, recorded before the R02 refactor.
 */
const DELETE_READ_ORDER: Record<string, string[]> = {
  'JSONL': ['name', 'name', 'name', 'name', 'name', 'lowercaseCache', 'name', 'name', 'name'],
  'JSONL with 4 segments': ['name', 'name', 'name', 'name', 'name', 'lowercaseCache', 'name', 'name', 'name'],
  'SQLite': ['name', 'name', 'name', 'name', 'lowercaseCache', 'name', 'name'],
};

/**
 * Reads of a getter field of a live relation while that same object is appended again, one number
 * per variant. The append reads the field once, to copy the object. The write and the cache update
 * read the copy. Segment mode reads the field once more: it rewrites the segment from the cache, and
 * the cache keeps the live object.
 */
const LIVE_RELATION_FIELD_READS: Record<string, number> = {
  'JSONL': 1,
  'JSONL with 4 segments': 2,
  'SQLite': 1,
};

/** Entity names in file or row order after a reload of the batch order pins. A repeated name keeps the position of its first write on both backends. */
const RELOAD_ORDER: Record<string, string[]> = {
  'JSONL': ['ord-1', 'ord-dup', 'ord-2', 'ord-3'],
  'SQLite': ['ord-1', 'ord-dup', 'ord-2', 'ord-3'],
};

/** Relations of the batch order pins in file or row order after a reload. A repeated key keeps the position of its first write on both backends. */
const RELOAD_RELATION_ORDER: Record<string, string[]> = {
  'JSONL': ['ord-1>ord-2:2', 'ord-2>ord-3:undefined', 'ord-3>ord-1:undefined'],
  'SQLite': ['ord-1>ord-2:2', 'ord-2>ord-3:undefined', 'ord-3>ord-1:undefined'],
};

const DELETE_RELATIONS_UNSEGMENTED = [
  'ent-02>ent-17:knows', 'ent-05>ent-18:knows', 'ent-06>ent-05:knows', 'ent-09>ent-06:knows', 'ent-17>ent-02:knows',
  'ent-18>ent-09:knows', 'ent-02>ent-17:works_with', 'ent-05>ent-18:works_with', 'ent-06>ent-05:works_with',
  'ent-09>ent-06:works_with',
];

/**
 * Entities and relations that `deleteEntities(['ent-09', 'ent-02', 'ent-05'])` removes from the indexes,
 * in call order, one entry per variant, recorded before the R02 refactor.
 */
const DELETE_INDEX_ORDER: Record<string, { names: string[]; relations: string[] }> = {
  'JSONL': { names: ['ent-02', 'ent-05', 'ent-09'], relations: DELETE_RELATIONS_UNSEGMENTED },
  'JSONL with 4 segments': {
    names: ['ent-05', 'ent-09', 'ent-02'],
    relations: [
      'ent-18>ent-09:knows', 'ent-17>ent-02:knows', 'ent-05>ent-18:knows', 'ent-09>ent-06:knows', 'ent-05>ent-18:works_with',
      'ent-09>ent-06:works_with', 'ent-02>ent-17:knows', 'ent-06>ent-05:knows', 'ent-02>ent-17:works_with',
      'ent-06>ent-05:works_with',
    ],
  },
  'SQLite': { names: ['ent-02', 'ent-05', 'ent-09'], relations: DELETE_RELATIONS_UNSEGMENTED },
};

describe.each(VARIANTS)('storage safety net - $label', (variant) => {
  /** True when the variant stores the graph in segment files. */
  const segmented = variant.env.MEMORY_STORAGE_SEGMENT_COUNT !== undefined;
  let dir: string;
  let file: string;
  const savedEnv: Record<string, string | undefined> = {};
  // Every store opened by a test. SQLite holds the database open, and Windows
  // refuses to remove an open file, so afterEach closes them first.
  const opened: Store[] = [];

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    Object.assign(process.env, variant.env);
    dir = join(tmpdir(), `storage-safety-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    file = join(dir, variant.file);
  });

  afterEach(async () => {
    for (const store of opened.splice(0)) {
      if (store instanceof SQLiteStorage) store.close();
    }
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  /** Open a fresh storage instance on the test file. */
  function openStore(): Store {
    const store: Store = variant.sqlite ? new SQLiteStorage(file) : new GraphStorage(file);
    opened.push(store);
    return store;
  }

  /** Seed the file with the standard graph through a fresh instance. */
  async function seed(): Promise<void> {
    await openStore().saveGraph({ entities: seedEntities(), relations: seedRelations() });
  }

  /** Open a context on the test file, read the graph, and close the context. */
  async function loadThroughContext(options: ManagerContextOptions) {
    const ctx = new ManagerContext(options);
    try {
      return structuredClone(await ctx.storage.loadGraph());
    } finally {
      ctx.close();
    }
  }

  /** Observation-word lookup. The two backends expose different read APIs. */
  function observationHits(store: Store, word: string): string[] {
    if (store instanceof SQLiteStorage) return store.simpleSearch(word);
    return [...store.getEntitiesByObservationWord(word)];
  }

  describe('S1 round trip through ManagerContext', () => {
    it('keeps 20 entities and 30 relations across close and reopen', async () => {
      const options: ManagerContextOptions = {
        storagePath: file,
        storageType: variant.sqlite ? 'sqlite' : 'jsonl',
      };
      const first = new ManagerContext(options);
      try {
        await first.entityManager.createEntities(seedEntities());
        await first.relationManager.createRelations(seedRelations());
      } finally {
        first.close();
      }

      const reloaded = await loadThroughContext(options);
      expect(reloaded.entities).toHaveLength(20);
      expect(reloaded.relations).toHaveLength(30);
      expect(projectGraph(reloaded.entities, reloaded.relations)).toEqual(
        projectGraph(seedEntities(), seedRelations()),
      );

      // A second reopen reads the same stored graph in full, not only the caller's fields.
      expect(sortedGraph(await loadThroughContext(options))).toEqual(sortedGraph(reloaded));
    });
  });

  describe('S2 append then reload', () => {
    it('appendEntity persists the entity exactly once', async () => {
      await seed();
      await openStore().appendEntity(entity('extra-entity', 'appended note'));

      const graph = await openStore().loadGraph();
      expect(graph.entities.filter(e => e.name === 'extra-entity')).toHaveLength(1);
      expect(graph.entities).toHaveLength(21);
    });

    it('appendEntities persists each entity exactly once', async () => {
      await seed();
      await openStore().appendEntities([
        entity('batch-a', 'batch note'),
        entity('batch-b', 'batch note'),
        entity('batch-c', 'batch note'),
      ]);

      const graph = await openStore().loadGraph();
      for (const name of ['batch-a', 'batch-b', 'batch-c']) {
        expect(graph.entities.filter(e => e.name === name)).toHaveLength(1);
      }
      expect(graph.entities).toHaveLength(23);
    });

    it('appendRelation persists the relation exactly once', async () => {
      await seed();
      await openStore().appendRelation(relation('ent-01', 'ent-02', 'appended'));

      const graph = await openStore().loadGraph();
      const matches = graph.relations.filter(r => relationKey(r) === 'ent-01|ent-02|appended');
      expect(matches).toHaveLength(1);
      expect(graph.relations).toHaveLength(31);
    });

    it('appendRelations persists each relation exactly once', async () => {
      await seed();
      await openStore().appendRelations([
        relation('ent-03', 'ent-04', 'appended'),
        relation('ent-05', 'ent-06', 'appended'),
      ]);

      const graph = await openStore().loadGraph();
      expect(graph.relations.filter(r => relationKey(r) === 'ent-03|ent-04|appended')).toHaveLength(1);
      expect(graph.relations.filter(r => relationKey(r) === 'ent-05|ent-06|appended')).toHaveLength(1);
      expect(graph.relations).toHaveLength(32);
    });
  });

  describe('S3 events and generation counters', () => {
    it('emits the same event names in the same order and moves the counters by the same amounts', async () => {
      await seed();
      const store = openStore();
      // Load first, so that the lazy load does not emit graph:loaded inside the first step.
      await store.loadGraph();
      const events: string[] = [];
      store.events.onAny(event => events.push(event.type));

      const trace: Array<{
        op: string;
        events: string[];
        entityDelta: number;
        relationDelta: number;
      }> = [];
      async function step(op: string, action: () => Promise<unknown>): Promise<void> {
        events.length = 0;
        const before = getGraphGenerations(store);
        await action();
        const after = getGraphGenerations(store);
        trace.push({
          op,
          events: [...events],
          entityDelta: after.entity - before.entity,
          relationDelta: after.relation - before.relation,
        });
      }

      await step('appendEntity', () => store.appendEntity(entity('trace-a', 'trace note')));
      await step('appendEntities', () =>
        store.appendEntities([entity('trace-b', 'trace note'), entity('trace-c', 'trace note')]),
      );
      await step('appendRelation', () => store.appendRelation(relation('ent-01', 'trace-a', 'traced')));
      await step('appendRelations', () =>
        store.appendRelations([relation('trace-b', 'trace-c', 'traced')]),
      );
      await step('updateEntity', () => store.updateEntity('ent-01', { observations: ['trace update'] }));
      await step('deleteEntities', () => store.deleteEntities(['ent-02']));

      expect(trace).toEqual([
        { op: 'appendEntity', events: ['entity:created'], entityDelta: 1, relationDelta: 0 },
        {
          op: 'appendEntities',
          events: ['entity:created', 'entity:created'],
          entityDelta: 1,
          relationDelta: 0,
        },
        { op: 'appendRelation', events: ['relation:created'], entityDelta: 0, relationDelta: 1 },
        { op: 'appendRelations', events: ['relation:created'], entityDelta: 0, relationDelta: 1 },
        { op: 'updateEntity', events: ['entity:updated'], entityDelta: 1, relationDelta: 0 },
        {
          op: 'deleteEntities',
          events: ['entity:deleted', 'relation:deleted', 'relation:deleted', 'relation:deleted'],
          entityDelta: 1,
          relationDelta: 1,
        },
      ]);
    });
  });

  describe('S5 delete cascade', () => {
    it('removes the relations that touch the deleted entity and its observation entries', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      expect(observationHits(store, 'quasarlens')).toEqual(['ent-00']);

      const touching = seedRelations().filter(r => r.from === 'ent-00' || r.to === 'ent-00');
      expect(touching).toHaveLength(3);

      await store.deleteEntities(['ent-00']);

      const graph = await openStore().loadGraph();
      expect(graph.entities.some(e => e.name === 'ent-00')).toBe(false);
      expect(graph.relations.filter(r => r.from === 'ent-00' || r.to === 'ent-00')).toHaveLength(0);
      expect(graph.relations).toHaveLength(30 - touching.length);
      expect(observationHits(store, 'quasarlens')).toEqual([]);
      expect(store.getLowercased('ent-00')).toBeUndefined();
    });
  });

  describe('R02 cache step', () => {
    it('upsert of an existing entity keeps the live object and replaces its observation words', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const live = store.getEntityByName('ent-01');

      await store.appendEntity({ name: 'ent-01', entityType: 'person', observations: ['swapword'] });

      expect(store.getEntityByName('ent-01')).toBe(live);
      expect(live?.observations).toEqual(['swapword']);
      expect(observationHits(store, 'swapword')).toEqual(['ent-01']);
      expect(observationHits(store, 'fact')).not.toContain('ent-01');
    });

    it('upsert of an existing relation keeps the live object and takes the new fields', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const live = store.getRelationsFrom('ent-00').find(r => r.to === 'ent-03' && r.relationType === 'knows');
      expect(live).toBeDefined();

      await store.appendRelation({ from: 'ent-00', to: 'ent-03', relationType: 'knows', weight: 2 });

      const after = store.getRelationsFrom('ent-00').filter(r => r.to === 'ent-03' && r.relationType === 'knows');
      expect(after).toHaveLength(1);
      expect(after[0]).toBe(live);
      expect(after[0].weight).toBe(2);
    });

    it('updateEntities rejects an unknown name with the same error', async () => {
      await seed();
      const store = openStore();
      await expect(
        store.updateEntities([{ name: 'ghost', updates: { observations: ['x'] } }]),
      ).rejects.toThrow('Entity "ghost" not found');
    });
  });

  describe('R01 append twins', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Runs the four append forms and two replace forms, one row per call.
     *
     * With `measureTicks`, each call is measured with `microtaskTicks`, which
     * must start in the same turn. With `stubWrites`, the JSONL file write is
     * replaced by a resolved promise, so that only microtasks remain.
     */
    async function traceAppends(
      store: Store,
      options: { measureTicks: boolean; stubWrites: boolean },
    ): Promise<R01Step[]> {
      await store.loadGraph();
      const events: string[] = [];
      store.events.onAny(event => events.push(event.type));

      // Methods that the append paths call on the storage class. A refactor keeps these calls.
      const proto = (variant.sqlite ? SQLiteStorage.prototype : GraphStorage.prototype) as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      const writeMethods = variant.sqlite ? ['runEntityUpsert', 'runRelationUpsert'] : ['appendLines', 'appendViaSegmentSave'];
      const spies = [
        vi.spyOn(NameIndex.prototype, 'add'),
        vi.spyOn(RelationIndex.prototype, 'add'),
        ...writeMethods.map(name => {
          const spy = vi.spyOn(proto, name);
          if (options.stubWrites && !variant.sqlite) {
            spy.mockImplementation(async (...args: unknown[]) => {
              if (name === 'appendViaSegmentSave') (args[0] as () => void)();
            });
          }
          return spy;
        }),
      ];

      const trace: R01Step[] = [];
      async function step(op: string, start: () => Promise<unknown>): Promise<void> {
        events.length = 0;
        const before = getGraphGenerations(store);
        const calls = spies.map(spy => spy.mock.calls.length);
        let ticks: number | undefined;
        if (options.measureTicks) {
          ticks = await microtaskTicks(start());
        } else {
          await start();
        }
        const after = getGraphGenerations(store);
        trace.push({
          op,
          ticks,
          events: [...events],
          entityDelta: after.entity - before.entity,
          relationDelta: after.relation - before.relation,
          nameIndexAdds: spies[0].mock.calls.length - calls[0],
          relationIndexAdds: spies[1].mock.calls.length - calls[1],
          writes: spies.slice(2).reduce((sum, spy, i) => sum + spy.mock.calls.length - calls[i + 2], 0),
          pendingAppends: store.getPendingAppends(),
        });
      }

      await step('appendEntity', () => store.appendEntity(entity('r01-a', 'trace note')));
      await step('appendEntities', () =>
        store.appendEntities([entity('r01-b', 'trace note'), entity('r01-c', 'trace note')]),
      );
      await step('appendRelation', () => store.appendRelation(relation('ent-01', 'r01-a', 'traced')));
      await step('appendRelations', () =>
        store.appendRelations([relation('r01-b', 'r01-c', 'traced'), relation('ent-02', 'r01-c', 'traced')]),
      );
      await step('appendEntity replace', () => store.appendEntity(entity('ent-03', 'replaced')));
      await step('appendRelation replace', () =>
        store.appendRelation({ from: 'ent-00', to: 'ent-03', relationType: 'knows', weight: 2 }),
      );
      return trace;
    }

    it('keeps the events, cache writes, generation moves and file writes of each append form', async () => {
      await seed();
      const trace = await traceAppends(openStore(), { measureTicks: false, stubWrites: false });
      expect(trace).toEqual(R01_TRACE[variant.label]);
    });

    it('keeps the microtask turns of each append form', async () => {
      await seed();
      const trace = await traceAppends(openStore(), { measureTicks: true, stubWrites: true });
      expect(trace.map(row => row.ticks)).toEqual(R01_TICKS[variant.label]);
    });

    if (!variant.sqlite && !segmented) {
      it('compacts on the append that reaches the threshold, for single and batch forms', async () => {
        await seed();
        const store = openStore();
        await store.loadGraph();
        // A threshold of 3 makes compaction visible in a few calls. The getter is read once per append.
        const threshold = vi
          .spyOn(GraphStorage.prototype as unknown as { compactionThreshold: number }, 'compactionThreshold', 'get')
          .mockReturnValue(3);
        const rows: Array<[string, number, number, number]> = [];
        const lineCount = async (): Promise<number> =>
          (await fs.readFile(file, 'utf8')).split('\n').filter(line => line.length > 0).length;
        async function row(op: string, start: () => Promise<unknown>): Promise<void> {
          const reads = threshold.mock.calls.length;
          await start();
          rows.push([op, await lineCount(), store.getPendingAppends(), threshold.mock.calls.length - reads]);
        }
        await row('appendEntity', () => store.appendEntity(entity('cmp-a', 'compact note')));
        await row('appendEntity', () => store.appendEntity(entity('cmp-b', 'compact note')));
        await row('appendEntity', () => store.appendEntity(entity('cmp-c', 'compact note')));
        await row('appendEntities', () =>
          store.appendEntities([entity('cmp-d', 'compact note'), entity('cmp-e', 'compact note'), entity('cmp-f', 'compact note')]),
        );
        await row('appendRelation', () => store.appendRelation(relation('ent-01', 'cmp-a', 'compacted')));
        await row('appendRelation', () => store.appendRelation(relation('ent-02', 'cmp-b', 'compacted')));
        await row('appendRelations', () =>
          store.appendRelations([relation('ent-03', 'cmp-c', 'compacted'), relation('ent-04', 'cmp-d', 'compacted'), relation('ent-05', 'cmp-e', 'compacted')]),
        );
        // Rows: op, file lines after the call, pending appends after the call, threshold reads in the call.
        expect(rows).toEqual([
          ['appendEntity', 51, 1, 1],
          ['appendEntity', 52, 2, 1],
          ['appendEntity', 53, 0, 1],
          ['appendEntities', 56, 0, 1],
          ['appendRelation', 57, 1, 1],
          ['appendRelation', 58, 2, 1],
          ['appendRelations', 61, 0, 1],
        ]);
      });
    }

    if (segmented && !variant.sqlite) {
      it('routes an appended relation to the segment of its from endpoint', async () => {
        await seed();
        const store = openStore();
        await store.loadGraph();
        await store.appendRelation(relation('ent-07', 'ent-12', 'routed'));
        await store.appendRelations([relation('ent-08', 'ent-13', 'routed-batch')]);
        const segmentsDir = join(dir, 'segments');
        const holders = async (marker: string): Promise<number[]> => {
          const ids: number[] = [];
          for (let id = 0; id < 4; id++) {
            const text = await fs.readFile(join(segmentsDir, `${id}.jsonl`), 'utf8');
            if (text.includes(marker)) ids.push(id);
          }
          return ids;
        };
        expect(await holders('"relationType":"routed"')).toEqual([0]);
        expect(await holders('"relationType":"routed-batch"')).toEqual([1]);
      });
    }
  });

  describe('R02 and R01 evaluation order and error texts', () => {
    it('reads the lowercase cache field before the entity name when it removes a deleted entity', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const reads: string[] = [];
      const live = store.getEntityByName('ent-01') as Entity;
      Object.defineProperty(live, 'name', {
        get() {
          reads.push('name');
          return 'ent-01';
        },
        configurable: true,
        enumerable: true,
      });
      let lowercase = (store as unknown as { lowercaseCache: unknown }).lowercaseCache;
      Object.defineProperty(store, 'lowercaseCache', {
        get() {
          reads.push('lowercaseCache');
          return lowercase;
        },
        set(value: unknown) {
          lowercase = value;
        },
        configurable: true,
      });

      await store.deleteEntities(['ent-01']);

      // The sequence is recorded from the code before the R02 refactor.
      expect(reads).toEqual(DELETE_READ_ORDER[variant.label]);
    });

    // A list that is not an array fails inside the append path. The error text names
    // the parameter of the public method, as V8 prints the source text of the failing expression.
    const entityListText = variant.sqlite ? 'entities is not iterable' : 'entities.map is not a function';
    const relationListText = variant.sqlite ? 'relations is not iterable' : 'relations.map is not a function';

    it.each([5, { length: 1 }])('appendEntities(%j) rejects with the text of the public parameter', async (bad) => {
      await seed();
      await expect(openStore().appendEntities(bad as unknown as Entity[])).rejects.toMatchObject({
        name: 'TypeError',
        message: entityListText,
      });
    });

    it.each([5, { length: 1 }])('appendRelations(%j) rejects with the text of the public parameter', async (bad) => {
      await seed();
      await expect(openStore().appendRelations(bad as unknown as Relation[])).rejects.toMatchObject({
        name: 'TypeError',
        message: relationListText,
      });
    });
  });

  describe('R02 and R01 cache, index and transaction pins', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Entity names of one type, read through the type index. */
    const namesOfType = (store: Store, entityType: string): string[] =>
      store.getEntitiesByType(entityType).map(e => e.name);

    it('moves a replaced entity to its new type bucket and refreshes its lowercase view', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      expect(namesOfType(store, 'project')).toContain('ent-01');

      await store.appendEntity({ name: 'ent-01', entityType: 'person', observations: ['Moved Word'] });

      expect(namesOfType(store, 'project')).not.toContain('ent-01');
      expect(namesOfType(store, 'person')).toContain('ent-01');
      expect(store.getLowercased('ent-01')).toMatchObject({
        entityType: 'person',
        observations: ['moved word'],
      });
    });

    it('indexes a new entity: type bucket, lowercase view and observation words', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();

      await store.appendEntity({ name: 'ix-new', entityType: 'gadget', observations: ['ZyxWord Mixed'] });

      expect(namesOfType(store, 'gadget')).toEqual(['ix-new']);
      expect(store.getLowercased('ix-new')).toMatchObject({ name: 'ix-new', observations: ['zyxword mixed'] });
      expect(observationHits(store, 'zyxword')).toEqual(['ix-new']);
    });

    it('re-appends the live entity object without a second cache row and with fresh indexes', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const live = store.getEntityByName('ent-01') as Entity;
      const rows = (await store.loadGraph()).entities.length;

      live.entityType = 'person';
      live.observations = ['inplaceword'];
      await store.appendEntity(live);

      expect((await store.loadGraph()).entities).toHaveLength(rows);
      expect(store.getEntityByName('ent-01')).toBe(live);
      expect(namesOfType(store, 'person')).toContain('ent-01');
      expect(namesOfType(store, 'project')).not.toContain('ent-01');
      expect(observationHits(store, 'inplaceword')).toEqual(['ent-01']);
      expect(observationHits(store, 'fact')).not.toContain('ent-01');
      expect(store.getLowercased('ent-01')).toMatchObject({ observations: ['inplaceword'] });
    });

    it('drops the fields that a replacing entity or relation does not carry', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      await store.appendEntity({ name: 'key-1', entityType: 'person', observations: ['o'], tags: ['x'], importance: 4 });
      const liveEntity = store.getEntityByName('key-1') as Entity;
      await store.appendEntity({ name: 'key-1', entityType: 'person', observations: ['p'] });
      expect(store.getEntityByName('key-1')).toBe(liveEntity);
      expect(Object.keys(liveEntity)).toEqual(['name', 'entityType', 'observations']);

      await store.appendRelation({ from: 'ent-00', to: 'ent-02', relationType: 'keyed', weight: 3, note: 'n' } as Relation);
      const liveRelation = store.getRelationsFrom('ent-00').find(r => r.relationType === 'keyed') as Relation;
      await store.appendRelation({ from: 'ent-00', to: 'ent-02', relationType: 'keyed' });
      expect(store.getRelationsFrom('ent-00').filter(r => r.relationType === 'keyed')).toEqual([liveRelation]);
      expect(Object.keys(liveRelation)).toEqual(['from', 'to', 'relationType']);
    });

    it('reads a field of a live relation once, to copy it, when the same object is appended again', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      await store.appendRelation({ from: 'ent-00', to: 'ent-02', relationType: 'getter', weight: 1 });
      const live = store.getRelationsFrom('ent-00').find(r => r.relationType === 'getter') as Relation;
      let reads = 0;
      let weight = 1;
      Object.defineProperty(live, 'weight', {
        get() {
          reads++;
          return weight;
        },
        set(value: number) {
          weight = value;
        },
        enumerable: true,
        configurable: true,
      });

      await store.appendRelation(live);

      expect(reads).toBe(LIVE_RELATION_FIELD_READS[variant.label]);
      expect(store.getRelationsFrom('ent-00').filter(r => r.relationType === 'getter')).toHaveLength(1);
    });

    it('forgets the key of a deleted relation, so the same relation can be appended again', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();

      await store.deleteEntities(['ent-00']);
      await store.appendEntity(entity('ent-00', 'back again'));
      await store.appendRelation({ from: 'ent-00', to: 'ent-03', relationType: 'knows' });

      expect(store.getRelationsFrom('ent-00')).toHaveLength(1);
      expect((await store.loadGraph()).relations.filter(r => r.from === 'ent-00')).toHaveLength(1);
    });

    it('keeps relations apart whose names differ only by separator position or by direction', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      await store.appendEntities(['a|b', 'c', 'a', 'b|c', 'x', 'y'].map(name => entity(name, 'endpoint')));
      const before = (await store.loadGraph()).relations.length;

      await store.appendRelations([
        { from: 'a|b', to: 'c', relationType: 't' },
        { from: 'a', to: 'b|c', relationType: 't' },
        { from: 'x', to: 'y', relationType: 't' },
        { from: 'y', to: 'x', relationType: 't' },
      ]);

      expect((await store.loadGraph()).relations).toHaveLength(before + 4);
    });

    it('sends the stored copy of the appended object in the created events', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const entities: unknown[] = [];
      const relations: unknown[] = [];
      store.events.on('entity:created', event => entities.push(event.entity));
      store.events.on('relation:created', event => relations.push(event.relation));
      const single = entity('ev-1', 'event note');
      const batch = [entity('ev-2', 'event note'), entity('ev-3', 'event note')];
      const replacement = { name: 'ent-01', entityType: 'person', observations: ['again'] };
      const link = relation('ev-1', 'ev-2', 'evented');
      const links = [relation('ev-2', 'ev-3', 'evented'), relation('ev-3', 'ev-1', 'evented')];

      await store.appendEntity(single);
      await store.appendEntities(batch);
      await store.appendEntity(replacement);
      await store.appendRelation(link);
      await store.appendRelations(links);

      const sentEntities = [single, ...batch, replacement];
      const sentRelations = [link, ...links];
      expect(entities).toEqual(sentEntities);
      expect(relations).toEqual(sentRelations);
      sentEntities.forEach((sent, i) => expect(entities[i]).not.toBe(sent));
      sentRelations.forEach((sent, i) => expect(relations[i]).not.toBe(sent));
      // A new name sends the object that the cache holds. A replacement sends
      // the copy, and the cache keeps its existing object with the new fields.
      entities.slice(0, 3).forEach(sent => expect(sent).toBe(store.getEntityByName((sent as Entity).name)));
      const storedLink = store.getRelationsFrom('ev-1').find(r => r.relationType === 'evented');
      expect(relations[0]).toBe(storedLink);
    });

    it('moves neither the generation counters nor the pending counter when the cache update fails', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const generations = getGraphGenerations(store);
      const pending = store.getPendingAppends();

      vi.spyOn(NameIndex.prototype, 'add').mockImplementationOnce(() => {
        throw new Error('index failure');
      });
      await expect(store.appendEntity(entity('boom-1', 'x'))).rejects.toThrow('index failure');
      vi.spyOn(RelationIndex.prototype, 'add').mockImplementationOnce(() => {
        throw new Error('relation index failure');
      });
      await expect(store.appendRelation(relation('ent-01', 'ent-02', 'boom'))).rejects.toThrow(
        'relation index failure',
      );

      expect(getGraphGenerations(store)).toEqual(generations);
      expect(store.getPendingAppends()).toBe(pending);
    });

    /** The entities and relations of the batch order pins. One entity name and one relation key occur twice. */
    const orderedEntities = (): Entity[] => [
      entity('ord-1', 'first'),
      { name: 'ord-dup', entityType: 'note', observations: ['dup first'] },
      entity('ord-2', 'third'),
      { name: 'ord-dup', entityType: 'note', observations: ['dup last'] },
      entity('ord-3', 'fifth'),
    ];
    const orderedRelations = (): Relation[] => [
      { from: 'ord-1', to: 'ord-2', relationType: 'ord', weight: 1 },
      relation('ord-2', 'ord-3', 'ord'),
      { from: 'ord-1', to: 'ord-2', relationType: 'ord', weight: 2 },
      relation('ord-3', 'ord-1', 'ord'),
    ];
    const describeRelations = (relations: readonly Relation[]): string[] =>
      relations.filter(r => r.relationType === 'ord').map(r => `${r.from}>${r.to}:${r.weight}`);

    it('puts the items of a batch into the cache in list order, and the last of two equal keys wins', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();

      await store.appendEntities(orderedEntities());
      await store.appendRelations(orderedRelations());

      const graph = await store.loadGraph();
      const mine = graph.entities.filter(e => e.name.startsWith('ord-'));
      expect(mine.map(e => e.name)).toEqual(['ord-1', 'ord-dup', 'ord-2', 'ord-3']);
      expect(mine.find(e => e.name === 'ord-dup')?.observations).toEqual(['dup last']);
      expect(describeRelations(graph.relations)).toEqual(['ord-1>ord-2:2', 'ord-2>ord-3:undefined', 'ord-3>ord-1:undefined']);
    });

    it('writes the items of a batch in list order, so that a reload keeps the last of two equal keys', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      await store.appendEntities(orderedEntities());
      await store.appendRelations(orderedRelations());

      const graph = await openStore().loadGraph();

      const mine = graph.entities.filter(e => e.name.startsWith('ord-'));
      expect(mine.find(e => e.name === 'ord-dup')?.observations).toEqual(['dup last']);
      expect(describeRelations(graph.relations).sort()).toEqual(['ord-1>ord-2:2', 'ord-2>ord-3:undefined', 'ord-3>ord-1:undefined']);
      // A segment file holds the entities of its own segment only, so the reload order is the order of the segments.
      if (!segmented) {
        expect(mine.map(e => e.name)).toEqual(RELOAD_ORDER[variant.label]);
        expect(describeRelations(graph.relations)).toEqual(RELOAD_RELATION_ORDER[variant.label]);
      }
    });

    it('treats relation keys that differ only in letter case as different relations', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      await store.appendEntities(['Case-A', 'Case-B', 'case-a', 'case-b'].map(name => entity(name, 'case')));
      const before = (await store.loadGraph()).relations.length;

      await store.appendRelation({ from: 'Case-A', to: 'Case-B', relationType: 'T', weight: 1 });
      await store.appendRelation({ from: 'Case-A', to: 'Case-B', relationType: 'T', weight: 2 });
      await store.appendRelation({ from: 'case-a', to: 'case-b', relationType: 't', weight: 3 });

      const describeAdded = (relations: readonly Relation[]): string[] =>
        relations.filter(r => r.relationType === 'T' || r.relationType === 't').map(r => `${r.from}>${r.to}:${r.relationType}=${r.weight}`);
      const added = (await store.loadGraph()).relations.slice(before);
      expect(describeAdded(added)).toEqual(['Case-A>Case-B:T=2', 'case-a>case-b:t=3']);
      expect(describeAdded((await openStore().loadGraph()).relations).sort()).toEqual(['Case-A>Case-B:T=2', 'case-a>case-b:t=3']);
    });

    it('removes a deleted entity from each index in a fixed order, entities first and then relations', async () => {
      await seed();
      const store = openStore();
      await store.ensureLoaded();
      const steps: string[] = [];
      const spyStep = (target: object, method: string, label: string, describeArg: (arg: never) => string): void => {
        const original = (target as Record<string, (...args: never[]) => void>)[method];
        vi.spyOn(target as Record<string, (...args: never[]) => void>, method).mockImplementation(function (
          this: unknown,
          ...args: never[]
        ) {
          steps.push(`${label}:${describeArg(args[0])}`);
          return original.apply(this, args);
        });
      };
      const byName = (name: never): string => String(name);
      spyStep(NameIndex.prototype, 'remove', 'name', byName);
      spyStep(TypeIndex.prototype, 'remove', 'type', byName);
      // The JSONL storage keeps its lowercase view in a LowercaseCache, the SQLite storage in a Map.
      const lowercaseCache = (store as unknown as { lowercaseCache: object }).lowercaseCache;
      spyStep(lowercaseCache, variant.sqlite ? 'delete' : 'remove', 'lowercase', byName);
      spyStep(ObservationIndex.prototype, 'remove', 'observations', byName);
      spyStep(RelationIndex.prototype, 'remove', 'relation', (removed: never) => {
        const { from, to, relationType } = removed as Relation;
        return `${from}>${to}:${relationType}`;
      });
      const relationKeyMap = (store as unknown as { relationKeyMap: Map<string, Relation> }).relationKeyMap;
      spyStep(relationKeyMap, 'delete', 'relationKey', (key: never) => {
        const [from, to, relationType] = String(key).split('\u0000');
        return `${from}>${to}:${relationType}`;
      });

      await store.deleteEntities(['ent-09', 'ent-02', 'ent-05']);

      // The entity order is the order of the cache, so it follows the segments in segment mode.
      const order = DELETE_INDEX_ORDER[variant.label];
      expect(steps).toEqual([
        ...order.names.flatMap(name => [
          `name:${name}`,
          `type:${name}`,
          `lowercase:${name}`,
          ...(variant.sqlite ? [] : [`observations:${name}`]),
        ]),
        ...order.relations.flatMap(relationKey => [`relation:${relationKey}`, `relationKey:${relationKey}`]),
      ]);
    });

    /** The four append forms, each with the items it appends. */
    const appendForms = (): Array<{ label: string; batch: boolean; isRelation: boolean; run: (store: Store) => Promise<void> }> => [
      { label: 'appendEntity', batch: false, isRelation: false, run: store => store.appendEntity(entity('form-1', 'x')) },
      {
        label: 'appendEntities',
        batch: true,
        isRelation: false,
        run: store => store.appendEntities([entity('form-2', 'x'), entity('form-3', 'x')]),
      },
      {
        label: 'appendRelation',
        batch: false,
        isRelation: true,
        run: store => store.appendRelation(relation('ent-01', 'ent-02', 'form')),
      },
      {
        label: 'appendRelations',
        batch: true,
        isRelation: true,
        run: store => store.appendRelations([relation('ent-03', 'ent-04', 'form'), relation('ent-03', 'ent-05', 'form')]),
      },
    ];

    /** What a reader sees of a store: generation counters, pending counter, entity count, relation count. */
    const viewOf = (store: Store) => {
      const cache = (store as unknown as { cache: { entities: unknown[]; relations: unknown[] } }).cache;
      return {
        generations: getGraphGenerations(store),
        pending: store.getPendingAppends(),
        entities: cache.entities.length,
        relations: cache.relations.length,
      };
    };

    it.each(['appendEntity', 'appendEntities', 'appendRelation', 'appendRelations'])(
      '%s: a listener of the created event sees the finished append',
      async label => {
        await seed();
        const store = openStore();
        await store.ensureLoaded();
        const form = appendForms().find(candidate => candidate.label === label)!;
        const views: Array<ReturnType<typeof viewOf>> = [];
        store.events.on('entity:created', () => views.push(viewOf(store)));
        store.events.on('relation:created', () => views.push(viewOf(store)));
        const before = viewOf(store);

        await form.run(store);

        const after = viewOf(store);
        expect(views.length).toBeGreaterThan(0);
        for (const view of views) expect(view).toEqual(after);
        // The append changed the counters and the cache, so the equality is not empty.
        expect(after.generations).not.toEqual(before.generations);
        expect(after.entities + after.relations).toBeGreaterThan(before.entities + before.relations);
      },
    );

    // The JSONL storage in segment mode saves the segments after the cache update and reloads on a failure.
    if (!segmented) {
      it.each(['appendEntity', 'appendEntities', 'appendRelation', 'appendRelations'])(
        '%s: a failed write leaves the cache, the counters and the events as they were',
        async label => {
          await seed();
          const store = openStore();
          await store.ensureLoaded();
          const form = appendForms().find(candidate => candidate.label === label)!;
          const proto = (variant.sqlite ? SQLiteStorage.prototype : GraphStorage.prototype) as unknown as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          const writeMethod = variant.sqlite ? (form.isRelation ? 'runRelationUpsert' : 'runEntityUpsert') : 'appendLines';
          const original = proto[writeMethod];
          let calls = 0;
          // The SQLite batch form writes its second row after its first, so the failure happens in the middle.
          vi.spyOn(proto, writeMethod).mockImplementation(function (this: unknown, ...args: unknown[]) {
            calls++;
            if (variant.sqlite && form.batch && calls === 1) return original.apply(this, args);
            if (variant.sqlite) throw new Error('write failed');
            return Promise.reject(new Error('write failed'));
          });
          const events: string[] = [];
          store.events.onAny(event => events.push(event.type));
          const before = viewOf(store);

          await expect(form.run(store)).rejects.toThrow('write failed');

          expect(calls).toBe(variant.sqlite && form.batch ? 2 : 1);
          expect(viewOf(store)).toEqual(before);
          expect(events).toEqual([]);
          vi.restoreAllMocks();
          const reloaded = await openStore().loadGraph();
          expect(reloaded.entities).toHaveLength(before.entities);
          expect(reloaded.relations).toHaveLength(before.relations);
        },
      );
    }

    it.each(['appendEntities', 'appendRelations'])(
      '%s: moves neither the counters nor the events when the cache update of the batch fails',
      async label => {
        await seed();
        const store = openStore();
        await store.ensureLoaded();
        const form = appendForms().find(candidate => candidate.label === label)!;
        const events: string[] = [];
        store.events.onAny(event => events.push(event.type));
        const before = viewOf(store);
        const index = form.isRelation ? RelationIndex.prototype : NameIndex.prototype;
        vi.spyOn(index, 'add').mockImplementationOnce(() => {
          throw new Error('index failure');
        });

        await expect(form.run(store)).rejects.toThrow('index failure');

        expect(viewOf(store).generations).toEqual(before.generations);
        expect(viewOf(store).pending).toBe(before.pending);
        expect(events).toEqual([]);
      },
    );

    if (segmented) {
      it('resets the pending counter in segment mode even when it was not zero', async () => {
        await seed();
        const store = openStore();
        await store.ensureLoaded();
        (store as unknown as { pendingAppends: number }).pendingAppends = 5;

        await store.appendEntity(entity('seg-reset', 'x'));
        expect(store.getPendingAppends()).toBe(0);

        (store as unknown as { pendingAppends: number }).pendingAppends = 5;
        await store.appendRelations([relation('ent-01', 'ent-02', 'seg-reset')]);
        expect(store.getPendingAppends()).toBe(0);
      });
    }

    if (variant.sqlite) {
      it('opens no transaction for a single append and one transaction for each batch append', async () => {
        await seed();
        const store = openStore() as SQLiteStorage;
        await store.ensureLoaded();
        const db = (store as unknown as { db: { transaction: (...args: unknown[]) => unknown } }).db;
        const transaction = vi.spyOn(db, 'transaction');
        const counts: number[] = [];

        await store.appendEntity(entity('tx-1', 'x'));
        counts.push(transaction.mock.calls.length);
        await store.appendRelation(relation('ent-01', 'tx-1', 'tx'));
        counts.push(transaction.mock.calls.length);
        await store.appendEntities([entity('tx-2', 'x'), entity('tx-3', 'x')]);
        counts.push(transaction.mock.calls.length);
        await store.appendRelations([relation('tx-2', 'tx-3', 'tx')]);
        counts.push(transaction.mock.calls.length);

        expect(counts).toEqual([0, 0, 1, 2]);
      });

      it('rejects every append form with "Database not initialized" when the connection is gone', async () => {
        await seed();
        const store = openStore() as SQLiteStorage;
        await store.ensureLoaded();
        const holder = store as unknown as { db: unknown };
        const connection = holder.db;
        holder.db = null;
        try {
          const text = 'Database not initialized';
          await expect(store.appendEntity(entity('gone-1', 'x'))).rejects.toThrow(text);
          await expect(store.appendEntities([entity('gone-2', 'x')])).rejects.toThrow(text);
          await expect(store.appendRelation(relation('ent-01', 'ent-02', 'gone'))).rejects.toThrow(text);
          await expect(store.appendRelations([relation('ent-01', 'ent-02', 'gone')])).rejects.toThrow(text);
        } finally {
          holder.db = connection;
        }
      });
    }
  });
});

describe('storage safety net - JSONL crash simulation', () => {
  let dir: string;
  let file: string;
  const savedSegmentCount = process.env.MEMORY_STORAGE_SEGMENT_COUNT;

  beforeEach(async () => {
    delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    dir = join(tmpdir(), `storage-crash-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    file = join(dir, 'memory.jsonl');
  });

  afterEach(async () => {
    if (savedSegmentCount === undefined) delete process.env.MEMORY_STORAGE_SEGMENT_COUNT;
    else process.env.MEMORY_STORAGE_SEGMENT_COUNT = savedSegmentCount;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  });

  it('appendEntity leaves the cache and the file at the pre-call state when the write fails', async () => {
    const writer = new GraphStorage(file);
    await writer.saveGraph({ entities: seedEntities(), relations: seedRelations() });
    const beforeCache = structuredClone(await writer.loadGraph());
    const beforeFile = await fs.readFile(file, 'utf8');
    const beforeFresh = withoutClock(structuredClone(await new GraphStorage(file).loadGraph()));

    const injected = injectFlushFailure(file);
    try {
      await expect(writer.appendEntity(entity('crash-entity', 'crash note'))).rejects.toThrow(/synthetic/);
    } finally {
      injected.restore();
    }

    expect(structuredClone(await writer.loadGraph())).toEqual(beforeCache);
    expect(await fs.readFile(file, 'utf8')).toBe(beforeFile);
    expect(withoutClock(structuredClone(await new GraphStorage(file).loadGraph()))).toEqual(beforeFresh);
  });

  it('deleteEntities leaves the cache and the file at the pre-call state when the write fails', async () => {
    const writer = new GraphStorage(file);
    await writer.saveGraph({ entities: seedEntities(), relations: seedRelations() });
    const beforeCache = structuredClone(await writer.loadGraph());
    const beforeFile = await fs.readFile(file, 'utf8');
    const beforeFresh = withoutClock(structuredClone(await new GraphStorage(file).loadGraph()));

    const injected = injectFlushFailure(file);
    try {
      await expect(writer.deleteEntities(['ent-00'])).rejects.toThrow(/synthetic/);
    } finally {
      injected.restore();
    }

    expect(structuredClone(await writer.loadGraph())).toEqual(beforeCache);
    expect(await fs.readFile(file, 'utf8')).toBe(beforeFile);
    expect(withoutClock(structuredClone(await new GraphStorage(file).loadGraph()))).toEqual(beforeFresh);
  });

  it('appendEntities leaves the cache and the file at the pre-call state when the write fails', async () => {
    const writer = new GraphStorage(file);
    await writer.saveGraph({ entities: seedEntities(), relations: seedRelations() });
    const beforeCache = structuredClone(await writer.loadGraph());
    const beforeFile = await fs.readFile(file, 'utf8');
    const beforeFresh = withoutClock(structuredClone(await new GraphStorage(file).loadGraph()));

    const injected = injectFlushFailure(file);
    try {
      await expect(
        writer.appendEntities([entity('crash-a', 'crash note'), entity('crash-b', 'crash note')]),
      ).rejects.toThrow(/synthetic/);
    } finally {
      injected.restore();
    }

    expect(structuredClone(await writer.loadGraph())).toEqual(beforeCache);
    expect(await fs.readFile(file, 'utf8')).toBe(beforeFile);
    expect(withoutClock(structuredClone(await new GraphStorage(file).loadGraph()))).toEqual(beforeFresh);
  });
});
