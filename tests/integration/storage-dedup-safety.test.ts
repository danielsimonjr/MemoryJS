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
import { NameIndex, RelationIndex } from '../../src/utils/indexes.js';
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

    it.skipIf(variant.sqlite || segmented)('compacts on the append that reaches the threshold, for single and batch forms', async () => {
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

    it.skipIf(!segmented || variant.sqlite)('routes an appended relation to the segment of its from endpoint', async () => {
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
