/**
 * Unit tests for the cache and index steps that the storage backends share.
 *
 * The expected values come from the private methods that these functions
 * replaced (`upsertEntityInCache`, `upsertRelationInCache`, and the index
 * loops of `deleteEntities`).
 */

import { describe, it, expect } from 'vitest';
import {
  deleteNamesFromSnapshot,
  deleteRelationsFromSnapshot,
  bindStorageCacheState,
  relationKeyOf,
  removeEntitiesFromIndexes,
  upsertEntityInCache,
  upsertRelationInCache,
  type StorageCacheState,
} from '../../../src/core/storageCache.js';
import { NameIndex, ObservationIndex, RelationIndex, TypeIndex } from '../../../src/utils/indexes.js';
import type { Entity, KnowledgeGraph, Relation } from '../../../src/types/index.js';

/** A cache state over real indexes. The lowercase steps record their calls. */
function makeState(withObservationIndex: boolean) {
  const calls: string[] = [];
  const cache: KnowledgeGraph = { entities: [], relations: [] };
  const state: StorageCacheState = {
    cache,
    nameIndex: new NameIndex(),
    typeIndex: new TypeIndex(),
    relationIndex: new RelationIndex(),
    relationKeyMap: new Map<string, Relation>(),
    observationIndex: withObservationIndex ? new ObservationIndex() : undefined,
    setLowercase(entity: Entity) {
      calls.push(`set:${entity.name}`);
    },
    removeLowercase(entity: Entity) {
      calls.push(`remove:${entity.name}`);
    },
  };
  return { state, cache, calls };
}

/** Wraps the cache and index steps of a state. The returned list gets one label for each step, in call order. */
function recordSteps(state: StorageCacheState): string[] {
  const steps: string[] = [];
  const wrap = (target: object, method: string, label: string): void => {
    const record = target as Record<string, (...args: unknown[]) => unknown>;
    const original = record[method].bind(target);
    record[method] = (...args: unknown[]) => {
      steps.push(label);
      return original(...args);
    };
  };
  wrap(state.cache!.entities, 'push', 'entities.push');
  wrap(state.cache!.relations, 'push', 'relations.push');
  wrap(state.nameIndex, 'add', 'nameIndex.add');
  wrap(state.typeIndex, 'add', 'typeIndex.add');
  wrap(state.typeIndex, 'updateType', 'typeIndex.updateType');
  wrap(state.relationIndex, 'add', 'relationIndex.add');
  wrap(state.relationKeyMap, 'set', 'relationKeyMap.set');
  wrap(state.observationIndex!, 'remove', 'observationIndex.remove');
  wrap(state.observationIndex!, 'add', 'observationIndex.add');
  wrap(state, 'setLowercase', 'setLowercase');
  return steps;
}

describe('relationKeyOf', () => {
  it('joins from, to and type with NUL separators', () => {
    expect(relationKeyOf({ from: 'a', to: 'b', relationType: 't' })).toBe('a\u0000b\u0000t');
  });
});

describe('upsertEntityInCache', () => {
  it('returns the given object on insert and fills the cache and the indexes', () => {
    const { state, cache, calls } = makeState(true);
    const entity: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'] };

    expect(upsertEntityInCache(state, entity)).toBe(entity);

    expect(cache.entities).toEqual([entity]);
    expect(state.nameIndex.get('e1')).toBe(entity);
    expect([...state.typeIndex.getNames('A')]).toEqual(['e1']);
    expect([...state.observationIndex!.getEntitiesWithWord('alpha')]).toEqual(['e1']);
    expect(calls).toEqual(['set:e1']);
  });

  it('returns the live object on replace, keeps one cache row and moves the type bucket', () => {
    const { state, cache, calls } = makeState(true);
    const live: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'], tags: ['t'] };
    upsertEntityInCache(state, live);
    calls.length = 0;

    const result = upsertEntityInCache(state, { name: 'e1', entityType: 'B', observations: ['beta'] });

    expect(result).toBe(live);
    expect(cache.entities).toEqual([live]);
    expect(Object.keys(live)).toEqual(['name', 'entityType', 'observations']);
    expect(live.entityType).toBe('B');
    expect([...state.typeIndex.getNames('A')]).toEqual([]);
    expect([...state.typeIndex.getNames('B')]).toEqual(['e1']);
    expect([...state.observationIndex!.getEntitiesWithWord('alpha')]).toEqual([]);
    expect([...state.observationIndex!.getEntitiesWithWord('beta')]).toEqual(['e1']);
    expect(calls).toEqual(['set:e1']);
  });

  it('returns the object itself when the live object is appended again, without a second row', () => {
    const { state, cache } = makeState(true);
    const live: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'] };
    upsertEntityInCache(state, live);
    live.observations = ['gamma'];

    expect(upsertEntityInCache(state, live)).toBe(live);

    expect(cache.entities).toEqual([live]);
    expect([...state.observationIndex!.getEntitiesWithWord('alpha')]).toEqual([]);
    expect([...state.observationIndex!.getEntitiesWithWord('gamma')]).toEqual(['e1']);
  });

  it('runs the steps in a fixed order: cache row first, then the indexes, then the lowercase view', () => {
    const { state } = makeState(true);
    const steps = recordSteps(state);
    const live: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'] };

    upsertEntityInCache(state, live);
    expect(steps.splice(0)).toEqual([
      'entities.push',
      'nameIndex.add',
      'typeIndex.add',
      'setLowercase',
      'observationIndex.remove',
      'observationIndex.add',
    ]);

    // A replace always gives the live object to the type index. The index
    // holds the indexed type, so it moves the name only when the type changed.
    upsertEntityInCache(state, { name: 'e1', entityType: 'B', observations: ['beta'] });
    expect(steps.splice(0)).toEqual([
      'typeIndex.add',
      'setLowercase',
      'observationIndex.remove',
      'observationIndex.add',
    ]);
    expect([...state.typeIndex.getNames('A')]).toEqual([]);
    expect([...state.typeIndex.getNames('B')]).toEqual(['e1']);

    upsertEntityInCache(state, { name: 'e1', entityType: 'B', observations: ['gamma'] });
    expect(steps.splice(0)).toEqual([
      'typeIndex.add',
      'setLowercase',
      'observationIndex.remove',
      'observationIndex.add',
    ]);

    upsertEntityInCache(state, live);
    expect(steps.splice(0)).toEqual([
      'nameIndex.add',
      'typeIndex.add',
      'setLowercase',
      'observationIndex.remove',
      'observationIndex.add',
    ]);
  });

  it('works without an observation index', () => {
    const { state, cache } = makeState(false);
    const entity: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'] };

    expect(upsertEntityInCache(state, entity)).toBe(entity);
    expect(cache.entities).toEqual([entity]);
  });
});

describe('upsertRelationInCache', () => {
  it('returns the given object on insert and fills the cache and the indexes', () => {
    const { state, cache } = makeState(false);
    const relation: Relation = { from: 'a', to: 'b', relationType: 't' };

    expect(upsertRelationInCache(state, relation)).toBe(relation);

    expect(cache.relations).toEqual([relation]);
    expect(state.relationKeyMap.get(relationKeyOf(relation))).toBe(relation);
    expect(state.relationIndex.getRelationsFrom('a')).toEqual([relation]);
  });

  it('returns the live object on replace and keeps one cache row', () => {
    const { state, cache } = makeState(false);
    const live = { from: 'a', to: 'b', relationType: 't', weight: 1, note: 'n' } as Relation;
    upsertRelationInCache(state, live);

    const result = upsertRelationInCache(state, { from: 'a', to: 'b', relationType: 't', weight: 2 });

    expect(result).toBe(live);
    expect(cache.relations).toEqual([live]);
    expect(Object.keys(live)).toEqual(['from', 'to', 'relationType', 'weight']);
    expect(live.weight).toBe(2);
    expect(state.relationIndex.getRelationsFrom('a')).toEqual([live]);
  });

  it('returns the object itself when the live object is appended again', () => {
    const { state, cache } = makeState(false);
    const live: Relation = { from: 'a', to: 'b', relationType: 't' };
    upsertRelationInCache(state, live);

    expect(upsertRelationInCache(state, live)).toBe(live);
    expect(cache.relations).toEqual([live]);
  });

  it('runs the steps in a fixed order: cache row, relation index, key map', () => {
    const { state } = makeState(true);
    const steps = recordSteps(state);
    const live: Relation = { from: 'a', to: 'b', relationType: 't' };

    upsertRelationInCache(state, live);
    expect(steps.splice(0)).toEqual(['relations.push', 'relationIndex.add', 'relationKeyMap.set']);

    upsertRelationInCache(state, { from: 'a', to: 'b', relationType: 't', weight: 1 });
    upsertRelationInCache(state, live);
    expect(steps).toEqual([]);
  });

  it('finds the live relation by its exact key and keeps keys apart that differ only in letter case', () => {
    const { state, cache } = makeState(false);
    const upper: Relation = { from: 'A', to: 'B', relationType: 'T', weight: 1 };
    const lower: Relation = { from: 'a', to: 'b', relationType: 't', weight: 2 };
    upsertRelationInCache(state, upper);
    upsertRelationInCache(state, lower);

    expect(upsertRelationInCache(state, { from: 'A', to: 'B', relationType: 'T', weight: 3 })).toBe(upper);

    expect(cache.relations).toEqual([
      { from: 'A', to: 'B', relationType: 'T', weight: 3 },
      { from: 'a', to: 'b', relationType: 't', weight: 2 },
    ]);
    expect(state.relationKeyMap.size).toBe(2);
  });
});

describe('removeEntitiesFromIndexes', () => {
  it('clears the indexes of the given items and leaves the cache arrays to the caller', () => {
    const { state, cache, calls } = makeState(true);
    const e1: Entity = { name: 'e1', entityType: 'A', observations: ['alpha'] };
    const e2: Entity = { name: 'e2', entityType: 'A', observations: ['alpha'] };
    const r: Relation = { from: 'e1', to: 'e2', relationType: 't' };
    upsertEntityInCache(state, e1);
    upsertEntityInCache(state, e2);
    upsertRelationInCache(state, r);
    calls.length = 0;

    removeEntitiesFromIndexes(state, [e1], [r]);

    expect(state.nameIndex.get('e1')).toBeUndefined();
    expect(state.nameIndex.get('e2')).toBe(e2);
    expect([...state.typeIndex.getNames('A')]).toEqual(['e2']);
    expect([...state.observationIndex!.getEntitiesWithWord('alpha')]).toEqual(['e2']);
    expect(state.relationIndex.getRelationsFrom('e1')).toEqual([]);
    expect(state.relationKeyMap.size).toBe(0);
    expect(calls).toEqual(['remove:e1']);
    expect(cache.entities).toEqual([e1, e2]);
    expect(cache.relations).toEqual([r]);
  });

  it('works through the given items in list order, entities first and then relations', () => {
    const { state, calls } = makeState(true);
    const entities: Entity[] = ['e1', 'e2', 'e3'].map(name => ({ name, entityType: 'A', observations: [] }));
    const relations: Relation[] = [
      { from: 'e1', to: 'e2', relationType: 't' },
      { from: 'e2', to: 'e3', relationType: 't' },
    ];
    for (const entity of entities) upsertEntityInCache(state, entity);
    for (const relation of relations) upsertRelationInCache(state, relation);
    calls.length = 0;
    const order: string[] = [];
    const removeName = state.nameIndex.remove.bind(state.nameIndex);
    state.nameIndex.remove = (name: string) => {
      order.push(`name:${name}`);
      removeName(name);
    };
    const removeRelation = state.relationIndex.remove.bind(state.relationIndex);
    state.relationIndex.remove = (relation: Relation) => {
      order.push(`relation:${relation.from}`);
      removeRelation(relation);
    };

    removeEntitiesFromIndexes(state, entities, relations);

    expect(order).toEqual(['name:e1', 'name:e2', 'name:e3', 'relation:e1', 'relation:e2']);
    expect(calls).toEqual(['remove:e1', 'remove:e2', 'remove:e3']);
  });
});

describe('deleteNamesFromSnapshot', () => {
  it('drops entities and relations touching deleted names', () => {
    const cache: KnowledgeGraph = {
      entities: [
        { name: 'e1', entityType: 'A', observations: [] },
        { name: 'e2', entityType: 'A', observations: [] },
      ],
      relations: [
        { from: 'e1', to: 'e2', relationType: 't' },
        { from: 'e2', to: 'e3', relationType: 't' },
      ],
    };
    deleteNamesFromSnapshot(cache, new Set(['e1']));
    expect(cache.entities.map(e => e.name)).toEqual(['e2']);
    expect(cache.relations).toEqual([{ from: 'e2', to: 'e3', relationType: 't' }]);
  });
});

describe('deleteRelationsFromSnapshot', () => {
  it('removes relations from cache and indexes and bumps touched entities', () => {
    const { state, cache } = makeState(false);
    const e1: Entity = { name: 'e1', entityType: 'A', observations: [], lastModified: 'old' };
    const e2: Entity = { name: 'e2', entityType: 'A', observations: [] };
    const r: Relation = { from: 'e1', to: 'e2', relationType: 't' };
    upsertEntityInCache(state, e1);
    upsertEntityInCache(state, e2);
    upsertRelationInCache(state, r);
    const keySet = new Set([relationKeyOf(r)]);

    deleteRelationsFromSnapshot(cache, state, keySet, [r], [e1], '2020-01-01T00:00:00.000Z');

    expect(cache.relations).toEqual([]);
    expect(state.relationKeyMap.size).toBe(0);
    expect(e1.lastModified).toBe('2020-01-01T00:00:00.000Z');
  });

  it('still bumps lastModified when no relation was deleted', () => {
    const cache: KnowledgeGraph = { entities: [], relations: [] };
    const { state } = makeState(false);
    const e1: Entity = { name: 'e1', entityType: 'A', observations: [], lastModified: 'old' };

    deleteRelationsFromSnapshot(cache, state, new Set(), [], [e1], '2020-06-01T00:00:00.000Z');

    expect(e1.lastModified).toBe('2020-06-01T00:00:00.000Z');
  });
});

describe('bindStorageCacheState', () => {
  it('exposes live getters and optional observationIndex', () => {
    const owner = {
      cache: null as KnowledgeGraph | null,
      nameIndex: new NameIndex(),
      typeIndex: new TypeIndex(),
      relationIndex: new RelationIndex(),
      relationKeyMap: new Map<string, Relation>(),
      observationIndex: new ObservationIndex(),
    };
    const lowercaseCalls: string[] = [];
    const state = bindStorageCacheState(
      owner,
      {
        set(entity: Entity) {
          lowercaseCalls.push(`set:${entity.name}`);
        },
        remove(entity: Entity) {
          lowercaseCalls.push(`remove:${entity.name}`);
        },
      },
      { includeObservationIndex: true },
    );

    const graph: KnowledgeGraph = { entities: [], relations: [] };
    owner.cache = graph;
    expect(state.cache).toBe(graph);

    const entity: Entity = { name: 'e1', entityType: 'T', observations: ['alpha'] };
    upsertEntityInCache(state, entity);
    expect(owner.nameIndex.get('e1')).toBe(entity);
    expect([...owner.observationIndex.getEntitiesWithWord('alpha')]).toEqual(['e1']);
    expect(lowercaseCalls).toEqual(['set:e1']);
    expect('observationIndex' in state).toBe(true);
  });

  it('does not define observationIndex without the option', () => {
    const owner = {
      cache: { entities: [], relations: [] } as KnowledgeGraph,
      nameIndex: new NameIndex(),
      typeIndex: new TypeIndex(),
      relationIndex: new RelationIndex(),
      relationKeyMap: new Map<string, Relation>(),
    };
    const state = bindStorageCacheState(owner, {
      set() {},
      remove() {},
    });
    expect('observationIndex' in state).toBe(false);
  });
});
