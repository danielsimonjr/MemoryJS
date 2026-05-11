/**
 * ISegmentStorage + reference-impl tests
 *
 * Covers Phase 7 task 59: interface contract, FNV-1a router stability,
 * in-memory backend round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  FnvSegmentRouter,
  InMemorySegmentStorage,
  fnv1a32,
  splitGraphIntoSegments,
  mergeSegmentsIntoGraph,
} from '../../../../src/core/segments/ISegmentStorage.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../../src/types/types.js';

function ent(name: string): Entity {
  return { name, entityType: 'thing', observations: [] };
}

describe('fnv1a32', () => {
  it('is deterministic — same input → same hash', () => {
    expect(fnv1a32('alice')).toBe(fnv1a32('alice'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('hello world');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('distinguishes near-identical inputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
    expect(fnv1a32('alice')).not.toBe(fnv1a32('Alice'));
  });

  it('handles empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });
});

describe('FnvSegmentRouter', () => {
  it('routes within [0, segmentCount)', () => {
    const router = new FnvSegmentRouter(4);
    for (const name of ['alice', 'bob', 'carol', 'dave', 'eve', 'fred']) {
      const id = router.route(name);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(4);
    }
  });

  it('routes deterministically', () => {
    const r1 = new FnvSegmentRouter(8);
    const r2 = new FnvSegmentRouter(8);
    expect(r1.route('alice')).toBe(r2.route('alice'));
  });

  it('rejects invalid segmentCount', () => {
    expect(() => new FnvSegmentRouter(0)).toThrow();
    expect(() => new FnvSegmentRouter(-1)).toThrow();
    expect(() => new FnvSegmentRouter(1.5)).toThrow();
  });

  it('distributes roughly evenly across 10k random names (no single bucket > 60 %)', () => {
    const router = new FnvSegmentRouter(8);
    const counts = new Array(8).fill(0);
    for (let i = 0; i < 10000; i++) {
      counts[router.route(`entity-${i}`)]++;
    }
    const max = Math.max(...counts);
    expect(max).toBeLessThan(10000 * 0.6);
  });
});

describe('splitGraphIntoSegments', () => {
  it('routes each entity to its own segment', () => {
    const router = new FnvSegmentRouter(4);
    const graph: KnowledgeGraph = {
      entities: [ent('a'), ent('b'), ent('c'), ent('d'), ent('e')],
      relations: [],
    };
    const segs = splitGraphIntoSegments(graph, router);
    expect(segs).toHaveLength(4);
    const totalEntities = segs.reduce((s, x) => s + x.entities.length, 0);
    expect(totalEntities).toBe(5);
    for (const seg of segs) {
      for (const e of seg.entities) {
        expect(router.route(e.name)).toBe(seg.id);
      }
    }
  });

  it('places relations in the segment of their `from` endpoint', () => {
    const router = new FnvSegmentRouter(4);
    const graph: KnowledgeGraph = {
      entities: [ent('alice'), ent('bob')],
      relations: [{ from: 'alice', to: 'bob', relationType: 'knows' }],
    };
    const segs = splitGraphIntoSegments(graph, router);
    const aliceSegId = router.route('alice');
    expect(segs[aliceSegId]!.relations).toHaveLength(1);
    // Other segments must not see the relation.
    for (let i = 0; i < segs.length; i++) {
      if (i !== aliceSegId) expect(segs[i]!.relations).toHaveLength(0);
    }
  });
});

describe('mergeSegmentsIntoGraph', () => {
  it('round-trips through split → merge', () => {
    const router = new FnvSegmentRouter(4);
    const graph: KnowledgeGraph = {
      entities: [ent('a'), ent('b'), ent('c'), ent('d'), ent('e')],
      relations: [
        { from: 'a', to: 'b', relationType: 'knows' },
        { from: 'c', to: 'd', relationType: 'knows' },
      ],
    };
    const segs = splitGraphIntoSegments(graph, router);
    const back = mergeSegmentsIntoGraph(segs);
    // Merge produces segment-id order, not original order — sort and compare.
    expect(back.entities.map((e) => e.name).sort()).toEqual(
      graph.entities.map((e) => e.name).sort(),
    );
    expect(back.relations.length).toBe(graph.relations.length);
  });
});

describe('InMemorySegmentStorage', () => {
  function makeStore(count = 4): InMemorySegmentStorage {
    return new InMemorySegmentStorage(new FnvSegmentRouter(count));
  }

  it('loadSegment returns an empty segment for an unsaved id', async () => {
    const store = makeStore();
    const seg = await store.loadSegment(0);
    expect(seg.entities).toEqual([]);
    expect(seg.relations).toEqual([]);
  });

  it('saveSegment + loadSegment round-trip', async () => {
    const store = makeStore();
    const id = store.router.route('alice');
    await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
    const seg = await store.loadSegment(id);
    expect(seg.entities.map((e) => e.name)).toEqual(['alice']);
  });

  it('saveSegment rejects entities that route to a different id', async () => {
    const store = makeStore();
    const aliceId = store.router.route('alice');
    const wrongId = (aliceId + 1) % store.segmentCount;
    await expect(
      store.saveSegment({ id: wrongId, entities: [ent('alice')], relations: [] }),
    ).rejects.toThrow();
  });

  it('saveSegment rejects relations whose `from` routes elsewhere', async () => {
    const store = makeStore();
    const aliceId = store.router.route('alice');
    const wrongId = (aliceId + 1) % store.segmentCount;
    await expect(
      store.saveSegment({
        id: wrongId,
        entities: [],
        relations: [{ from: 'alice', to: 'bob', relationType: 'x' }],
      }),
    ).rejects.toThrow();
  });

  it('saveAll → loadAll round-trip preserves entities and relations', async () => {
    const store = makeStore(4);
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

  it('entityCount sums across segments', async () => {
    const store = makeStore(4);
    await store.saveAll({
      entities: [ent('a'), ent('b'), ent('c')],
      relations: [],
    });
    expect(await store.entityCount()).toBe(3);
  });

  it('loadSegment returns a defensive copy — caller mutation does not bleed', async () => {
    const store = makeStore(4);
    const id = store.router.route('alice');
    await store.saveSegment({ id, entities: [ent('alice')], relations: [] });
    const seg1 = await store.loadSegment(id);
    seg1.entities.push(ent('mutation'));
    const seg2 = await store.loadSegment(id);
    expect(seg2.entities).toHaveLength(1);
  });

  it('rejects invalid segment ids on load/save', async () => {
    const store = makeStore(4);
    await expect(store.loadSegment(-1)).rejects.toThrow();
    await expect(store.loadSegment(4)).rejects.toThrow();
    await expect(store.loadSegment(0.5)).rejects.toThrow();
  });

  it('100-entity graph survives split-save-load round-trip on 8 segments', async () => {
    const store = makeStore(8);
    const entities: Entity[] = Array.from({ length: 100 }, (_, i) => ent(`e${i}`));
    const relations: Relation[] = entities.slice(0, 50).map((e, i) => ({
      from: e.name,
      to: entities[i + 1]!.name,
      relationType: 'next',
    }));
    await store.saveAll({ entities, relations });
    const back = await store.loadAll();
    expect(back.entities).toHaveLength(100);
    expect(back.relations).toHaveLength(50);
  });
});
