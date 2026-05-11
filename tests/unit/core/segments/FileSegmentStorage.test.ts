/**
 * FileSegmentStorage tests
 *
 * Covers Phase 7 task 60 (JSONL-per-segment backend) + task 61
 * (`findOutgoingRelations` / `findIncomingRelations` lookup
 * helpers).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSegmentStorage } from '../../../../src/core/segments/FileSegmentStorage.js';
import {
  FnvSegmentRouter,
} from '../../../../src/core/segments/ISegmentStorage.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../../src/types/types.js';

function ent(name: string, entityType = 'thing', observations: string[] = []): Entity {
  return { name, entityType, observations };
}

function makeStore(rootDir: string, segmentCount = 4): FileSegmentStorage {
  return new FileSegmentStorage(rootDir, new FnvSegmentRouter(segmentCount));
}

describe('FileSegmentStorage', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `file-segment-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  describe('basic round-trip', () => {
    it('saveAll → loadAll preserves a small graph across 4 segments', async () => {
      const store = makeStore(testDir, 4);
      const graph: KnowledgeGraph = {
        entities: [ent('alice'), ent('bob'), ent('carol'), ent('dave')],
        relations: [
          { from: 'alice', to: 'bob', relationType: 'knows' },
          { from: 'carol', to: 'dave', relationType: 'knows' },
        ],
      };
      await store.saveAll(graph);
      const back = await store.loadAll();
      expect(back.entities.map((e) => e.name).sort()).toEqual(
        graph.entities.map((e) => e.name).sort(),
      );
      expect(back.relations).toHaveLength(2);
    });

    it('preserves optional entity fields (tags, importance, observations)', async () => {
      const store = makeStore(testDir, 4);
      const alice: Entity = {
        name: 'alice',
        entityType: 'person',
        observations: ['likes coffee', 'lives in NYC'],
        tags: ['friend', 'colleague'],
        importance: 8,
      };
      await store.saveAll({ entities: [alice], relations: [] });
      const back = await store.loadAll();
      expect(back.entities).toHaveLength(1);
      expect(back.entities[0]).toMatchObject({
        name: 'alice',
        entityType: 'person',
        observations: ['likes coffee', 'lives in NYC'],
        tags: ['friend', 'colleague'],
        importance: 8,
      });
    });

    it('preserves relation metadata across round-trip', async () => {
      const store = makeStore(testDir, 4);
      const rel: Relation = {
        from: 'alice',
        to: 'bob',
        relationType: 'knows',
        weight: 0.9,
      };
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [rel],
      });
      const back = await store.loadAll();
      expect(back.relations).toHaveLength(1);
      expect(back.relations[0]).toMatchObject({
        from: 'alice',
        to: 'bob',
        relationType: 'knows',
        weight: 0.9,
      });
    });
  });

  describe('on-disk layout', () => {
    it('writes each entity to its router-assigned segment file', async () => {
      const store = makeStore(testDir, 4);
      const router = store.router;
      const entities = ['alice', 'bob', 'carol', 'dave'].map((n) => ent(n));
      await store.saveAll({ entities, relations: [] });

      for (const e of entities) {
        const id = router.route(e.name);
        const path = store.segmentPath(id);
        const raw = await fs.readFile(path, 'utf-8');
        const found = raw
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => JSON.parse(l) as { type: string; name?: string });
        expect(found.some((x) => x.type === 'entity' && x.name === e.name)).toBe(true);
      }
    });

    it('writes JSONL lines tagged with type=entity/relation (cat-able format)', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      const aliceId = store.router.route('alice');
      const raw = await fs.readFile(store.segmentPath(aliceId), 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim() !== '');
      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      for (const p of parsed) {
        expect(['entity', 'relation']).toContain(p.type);
      }
    });

    it('places relations in the segment of their `from` endpoint, not `to`', async () => {
      const store = makeStore(testDir, 4);
      const router = store.router;
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      const aliceId = router.route('alice');
      const bobId = router.route('bob');
      if (aliceId === bobId) return; // skip if collision

      const aliceFile = await fs.readFile(store.segmentPath(aliceId), 'utf-8');
      const bobFile = await fs.readFile(store.segmentPath(bobId), 'utf-8');
      expect(aliceFile).toContain('"type":"relation"');
      const bobRelations = bobFile
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { type: string })
        .filter((p) => p.type === 'relation');
      expect(bobRelations).toHaveLength(0);
    });
  });

  describe('missing files', () => {
    it('loadSegment returns an empty segment when the file does not exist', async () => {
      const store = makeStore(testDir, 4);
      const seg = await store.loadSegment(0);
      expect(seg.entities).toEqual([]);
      expect(seg.relations).toEqual([]);
      expect(seg.id).toBe(0);
    });

    it('loadAll on a fresh rootDir returns an empty graph', async () => {
      const store = makeStore(testDir, 4);
      const graph = await store.loadAll();
      expect(graph.entities).toEqual([]);
      expect(graph.relations).toEqual([]);
    });

    it('entityCount on a fresh rootDir returns 0', async () => {
      const store = makeStore(testDir, 4);
      expect(await store.entityCount()).toBe(0);
    });

    it('saveSegment auto-creates the segments directory on first write', async () => {
      const nested = join(testDir, 'never-created-yet');
      const store = makeStore(nested, 4);
      const id = store.router.route('alice');
      await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
      const seg = await store.loadSegment(id);
      expect(seg.entities.map((e) => e.name)).toEqual(['alice']);
    });
  });

  describe('saveSegment validation', () => {
    it('rejects entities that route to a different segment', async () => {
      const store = makeStore(testDir, 4);
      const aliceId = store.router.route('alice');
      const wrongId = (aliceId + 1) % store.segmentCount;
      await expect(
        store.saveSegment({ id: wrongId, entities: [ent('alice')], relations: [] }),
      ).rejects.toThrow(/routes to segment/);
    });

    it('rejects relations whose `from` routes to a different segment', async () => {
      const store = makeStore(testDir, 4);
      const aliceId = store.router.route('alice');
      const wrongId = (aliceId + 1) % store.segmentCount;
      await expect(
        store.saveSegment({
          id: wrongId,
          entities: [],
          relations: [{ from: 'alice', to: 'bob', relationType: 'x' }],
        }),
      ).rejects.toThrow(/routes to segment/);
    });

    it('rejects invalid segment ids on load/save', async () => {
      const store = makeStore(testDir, 4);
      await expect(store.loadSegment(-1)).rejects.toThrow();
      await expect(store.loadSegment(4)).rejects.toThrow();
      await expect(store.loadSegment(0.5)).rejects.toThrow();
    });
  });

  describe('atomicity', () => {
    it('saveAll failure mid-stage leaves prior state intact', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [],
      });
      const beforeNames = (await store.loadAll()).entities.map((e) => e.name).sort();

      // Force `writeFile`/`fd.write` to throw partway through the
      // staging phase by stubbing fs.open after the first call.
      const realOpen = fs.open.bind(fs);
      let callCount = 0;
      const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        callCount++;
        if (callCount > 1) {
          throw new Error('simulated disk failure mid-stage');
        }
        return realOpen(...(args as Parameters<typeof realOpen>));
      });

      await expect(
        store.saveAll({
          entities: [ent('eve'), ent('frank'), ent('george'), ent('henry')],
          relations: [],
        }),
      ).rejects.toThrow(/simulated disk failure/);

      spy.mockRestore();

      const afterNames = (await store.loadAll()).entities.map((e) => e.name).sort();
      expect(afterNames).toEqual(beforeNames);
    });

    it('per-segment saveSegment is atomic — temp files do not survive a successful write', async () => {
      const store = makeStore(testDir, 4);
      const id = store.router.route('alice');
      await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
      const files = await fs.readdir(join(testDir, 'segments'));
      const tmps = files.filter((f) => f.includes('.tmp.'));
      expect(tmps).toHaveLength(0);
    });
  });

  describe('stress / property-based round-trip', () => {
    const counts = [4, 8, 16];
    for (const segmentCount of counts) {
      it(`100-entity / 50-relation graph survives saveAll/loadAll on ${segmentCount} segments`, async () => {
        const store = makeStore(testDir, segmentCount);
        const entities: Entity[] = Array.from({ length: 100 }, (_, i) =>
          ent(`entity-${i}`, 'thing', [`observation-${i}`]),
        );
        const relations: Relation[] = Array.from({ length: 50 }, (_, i) => ({
          from: `entity-${i}`,
          to: `entity-${i + 1}`,
          relationType: 'next',
        }));
        await store.saveAll({ entities, relations });
        const back = await store.loadAll();

        expect(back.entities).toHaveLength(100);
        expect(back.relations).toHaveLength(50);

        const names = new Set(back.entities.map((e) => e.name));
        for (let i = 0; i < 100; i++) {
          expect(names.has(`entity-${i}`)).toBe(true);
        }

        const relKeys = new Set(
          back.relations.map((r) => `${r.from}::${r.to}::${r.relationType}`),
        );
        for (let i = 0; i < 50; i++) {
          expect(relKeys.has(`entity-${i}::entity-${i + 1}::next`)).toBe(true);
        }
      });
    }

    it('entityCount matches the number of entities saved', async () => {
      const store = makeStore(testDir, 8);
      const entities: Entity[] = Array.from({ length: 75 }, (_, i) => ent(`e${i}`));
      await store.saveAll({ entities, relations: [] });
      expect(await store.entityCount()).toBe(75);
    });
  });

  describe('findOutgoingRelations (task 61)', () => {
    it('returns all relations whose `from` matches', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob'), ent('carol')],
        relations: [
          { from: 'alice', to: 'bob', relationType: 'knows' },
          { from: 'alice', to: 'carol', relationType: 'manages' },
          { from: 'bob', to: 'carol', relationType: 'reports_to' },
        ],
      });
      const out = await store.findOutgoingRelations('alice');
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.to).sort()).toEqual(['bob', 'carol']);
    });

    it('returns [] for an unknown entity', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice')],
        relations: [],
      });
      expect(await store.findOutgoingRelations('nonexistent')).toEqual([]);
    });

    it('only reads ONE segment — verified via loadSegment call count', async () => {
      const store = makeStore(testDir, 8);
      await store.saveAll({
        entities: Array.from({ length: 20 }, (_, i) => ent(`e${i}`)),
        relations: [{ from: 'e0', to: 'e1', relationType: 'next' }],
      });
      const loadSpy = vi.spyOn(store, 'loadSegment');
      await store.findOutgoingRelations('e0');
      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(loadSpy).toHaveBeenCalledWith(store.router.route('e0'));
      loadSpy.mockRestore();
    });
  });

  describe('findIncomingRelations (task 61)', () => {
    it('returns all relations whose `to` matches, regardless of source segment', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [
          ent('alice'),
          ent('bob'),
          ent('carol'),
          ent('dave'),
          ent('target'),
        ],
        relations: [
          { from: 'alice', to: 'target', relationType: 'knows' },
          { from: 'bob', to: 'target', relationType: 'reports_to' },
          { from: 'carol', to: 'target', relationType: 'manages' },
          { from: 'dave', to: 'alice', relationType: 'knows' }, // distractor
        ],
      });
      const incoming = await store.findIncomingRelations('target');
      expect(incoming).toHaveLength(3);
      expect(incoming.map((r) => r.from).sort()).toEqual(['alice', 'bob', 'carol']);
    });

    it('returns [] for an unknown entity', async () => {
      const store = makeStore(testDir, 4);
      await store.saveAll({
        entities: [ent('alice'), ent('bob')],
        relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
      });
      expect(await store.findIncomingRelations('nonexistent')).toEqual([]);
    });

    it('scans every segment — verified via loadSegment call count', async () => {
      const store = makeStore(testDir, 8);
      await store.saveAll({
        entities: Array.from({ length: 20 }, (_, i) => ent(`e${i}`)),
        relations: [{ from: 'e0', to: 'e1', relationType: 'next' }],
      });
      const loadSpy = vi.spyOn(store, 'loadSegment');
      await store.findIncomingRelations('e1');
      expect(loadSpy).toHaveBeenCalledTimes(store.segmentCount);
      loadSpy.mockRestore();
    });
  });
});
