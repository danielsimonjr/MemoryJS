/**
 * Unit tests for the shared index-rebuild helpers (CL-10):
 * entitiesByTypeFromIndexes and rebuildRelationIndexes.
 */

import { describe, it, expect } from 'vitest';
import {
  entitiesByTypeFromIndexes,
  rebuildRelationIndexes,
  relationKeyOf,
} from '../../../src/core/storageCache.js';
import { NameIndex, RelationIndex, TypeIndex } from '../../../src/utils/indexes.js';
import type { Entity, Relation } from '../../../src/types/index.js';

function entity(name: string, entityType: string): Entity {
  return { name, entityType, observations: [] };
}

describe('entitiesByTypeFromIndexes', () => {
  it('returns the entities of one type, matching the type case-insensitively', () => {
    const entities = [entity('a', 'Person'), entity('b', 'place'), entity('c', 'PERSON')];
    const nameIndex = new NameIndex();
    const typeIndex = new TypeIndex();
    nameIndex.build(entities);
    typeIndex.build(entities);

    const people = entitiesByTypeFromIndexes(typeIndex, nameIndex, 'person');

    expect(people.map(e => e.name).sort()).toEqual(['a', 'c']);
    expect(people.every(e => nameIndex.get(e.name) === e)).toBe(true);
  });

  it('returns an empty array for an unknown type', () => {
    const nameIndex = new NameIndex();
    const typeIndex = new TypeIndex();
    expect(entitiesByTypeFromIndexes(typeIndex, nameIndex, 'nothing')).toEqual([]);
  });

  it('skips a name that the type index holds but the name index does not', () => {
    const nameIndex = new NameIndex();
    const typeIndex = new TypeIndex();
    typeIndex.add(entity('ghost', 'thing'));
    nameIndex.add(entity('real', 'thing'));
    typeIndex.add(entity('real', 'thing'));

    const things = entitiesByTypeFromIndexes(typeIndex, nameIndex, 'thing');

    expect(things.map(e => e.name)).toEqual(['real']);
  });
});

describe('rebuildRelationIndexes', () => {
  const r1: Relation = { from: 'a', to: 'b', relationType: 'knows' };
  const r2: Relation = { from: 'b', to: 'c', relationType: 'likes' };
  const r2dup: Relation = { from: 'b', to: 'c', relationType: 'likes', confidence: 0.5 } as Relation;

  it('replaces previous adjacency and key-map contents', () => {
    const relationIndex = new RelationIndex();
    const keyMap = new Map<string, Relation>();
    relationIndex.add({ from: 'stale', to: 'old', relationType: 'x' });
    keyMap.set('stale-key', { from: 'stale', to: 'old', relationType: 'x' });

    rebuildRelationIndexes(relationIndex, keyMap, [r1, r2]);

    expect(relationIndex.getRelationsFrom('stale')).toEqual([]);
    expect(keyMap.has('stale-key')).toBe(false);
    expect(relationIndex.getRelationsFrom('a')).toEqual([r1]);
    expect(relationIndex.getRelationsTo('c')).toEqual([r2]);
    expect(keyMap.get(relationKeyOf(r1))).toBe(r1);
    expect(keyMap.get(relationKeyOf(r2))).toBe(r2);
    expect(keyMap.size).toBe(2);
  });

  it('lets a later duplicate key replace an earlier one in the key map', () => {
    const relationIndex = new RelationIndex();
    const keyMap = new Map<string, Relation>();

    rebuildRelationIndexes(relationIndex, keyMap, [r2, r2dup]);

    expect(keyMap.get(relationKeyOf(r2))).toBe(r2dup);
    expect(keyMap.size).toBe(1);
  });

  it('leaves both structures empty for an empty relation list', () => {
    const relationIndex = new RelationIndex();
    const keyMap = new Map<string, Relation>([['k', r1]]);
    relationIndex.add(r2);

    rebuildRelationIndexes(relationIndex, keyMap, []);

    expect(keyMap.size).toBe(0);
    expect(relationIndex.size).toBe(0);
  });
});
