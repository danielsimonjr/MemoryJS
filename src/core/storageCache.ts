/**
 * Cache and index steps shared by the storage backends.
 *
 * `GraphStorage` and `SQLiteStorage` keep an in-memory graph snapshot and
 * the name, type and relation indexes of the same kind. The functions here
 * change those structures in place. The caller keeps the persistence step
 * and the event emission.
 */

import type { KnowledgeGraph, Entity, Relation } from '../types/index.js';
import type { NameIndex, TypeIndex, RelationIndex, ObservationIndex } from '../utils/indexes.js';

/**
 * The cache and index members that the shared cache steps read and write.
 *
 * Each data member is a getter in the storage class. A read takes the current
 * value of the owner's field, so a replaced snapshot is always seen.
 */
export interface StorageCacheState {
  /** The graph snapshot. Null before the first load. */
  readonly cache: KnowledgeGraph | null;
  /** Entity lookup by name. */
  readonly nameIndex: NameIndex;
  /** Entity lookup by type. */
  readonly typeIndex: TypeIndex;
  /** Relation lookup by entity name. */
  readonly relationIndex: RelationIndex;
  /** Relation lookup by composite key. */
  readonly relationKeyMap: Map<string, Relation>;
  /** Observation word index. Only the JSONL backend keeps one. */
  readonly observationIndex?: ObservationIndex;
  /** Recomputes the lowercase view of an entity. */
  setLowercase(entity: Entity): void;
  /**
   * Removes the lowercase view of an entity. The storage reads the name of
   * the entity itself, after it reads its own lowercase field.
   */
  removeLowercase(entity: Entity): void;
}

type CacheStateOwner = {
  cache: KnowledgeGraph | null;
  nameIndex: NameIndex;
  typeIndex: TypeIndex;
  relationIndex: RelationIndex;
  relationKeyMap: Map<string, Relation>;
  observationIndex?: ObservationIndex;
};

/**
 * Cache and index fields owned by a storage backend for {@link bindStorageCacheState}.
 * @internal Storage classes cast `this` to this shape.
 */
export type StorageCacheOwner = CacheStateOwner;

/**
 * Wires a storage owner's cache fields into a {@link StorageCacheState} facade with live getters.
 */
export function bindStorageCacheState(
  owner: CacheStateOwner,
  lowercase: {
    set(entity: Entity): void;
    remove(entity: Entity): void;
  },
  options?: { includeObservationIndex?: boolean },
): StorageCacheState {
  const state: StorageCacheState = {
    get cache() {
      return owner.cache;
    },
    get nameIndex() {
      return owner.nameIndex;
    },
    get typeIndex() {
      return owner.typeIndex;
    },
    get relationIndex() {
      return owner.relationIndex;
    },
    get relationKeyMap() {
      return owner.relationKeyMap;
    },
    setLowercase(entity: Entity): void {
      lowercase.set(entity);
    },
    removeLowercase(entity: Entity): void {
      lowercase.remove(entity);
    },
  };
  if (options?.includeObservationIndex) {
    Object.defineProperty(state, 'observationIndex', {
      enumerable: true,
      configurable: true,
      get(): ObservationIndex {
        return owner.observationIndex!;
      },
    });
  }
  return state;
}

/**
 * Composite key uniquely identifying a relation (`from`/`to`/`relationType`
 * triple). The `\u0000` separator matches the keys that `RelationManager`
 * and `EntityManager` build. It cannot collide with entity-name content in
 * practice.
 */
export function relationKeyOf(r: Pick<Relation, 'from' | 'to' | 'relationType'>): string {
  return `${r.from}\u0000${r.to}\u0000${r.relationType}`;
}

/**
 * Upsert an entity into the in-memory cache and indexes.
 *
 * When an entity with the same name exists, its live object changes in place.
 * Stale fields are removed and new fields are assigned. Every holder of the
 * object, such as `cache.entities` and `NameIndex`, stays consistent without
 * array scans. This mirrors the on-disk JSONL rule: a later line for a name
 * replaces the earlier line on reload.
 *
 * @param state - The cache and index members of the storage
 * @param entity - The entity to upsert
 * @returns The live cache object for the entity (the existing object on
 *   replace, the given object on insert)
 */
export function upsertEntityInCache(state: StorageCacheState, entity: Entity): Entity {
  const existing = state.nameIndex.get(entity.name);
  if (existing !== undefined && existing !== entity) {
    const target = existing as unknown as Record<string, unknown>;
    const source = entity as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (!(key in source)) delete target[key];
    }
    Object.assign(target, source);
    // The type index holds the indexed type of the name, so this also moves
    // a name whose live object a caller changed in place before the append.
    state.typeIndex.add(existing);
    state.setLowercase(existing);
    state.observationIndex?.remove(existing.name);
    state.observationIndex?.add(existing.name, existing.observations);
    return existing;
  }
  if (existing === undefined) {
    state.cache!.entities.push(entity);
  }
  state.nameIndex.add(entity);
  state.typeIndex.add(entity);
  state.setLowercase(entity);
  state.observationIndex?.remove(entity.name);
  state.observationIndex?.add(entity.name, entity.observations);
  return entity;
}

/**
 * Upsert a relation into the in-memory cache and indexes.
 *
 * Uses the same in-place replace strategy as `upsertEntityInCache`. A
 * duplicate `from`/`to`/`relationType` key mutates the live object. Fields
 * missing from the new relation are removed. This matches the JSONL
 * dedup-on-reload and the SQLite upsert, which updates the row in place.
 * The cache array gets no duplicate row.
 *
 * @param state - The cache and index members of the storage
 * @param relation - The relation to upsert
 * @returns The live cache object for the relation
 */
export function upsertRelationInCache(state: StorageCacheState, relation: Relation): Relation {
  const key = relationKeyOf(relation);
  const existing = state.relationKeyMap.get(key);
  if (existing !== undefined && existing !== relation) {
    const target = existing as unknown as Record<string, unknown>;
    const source = relation as unknown as Record<string, unknown>;
    for (const k of Object.keys(target)) {
      if (!(k in source)) delete target[k];
    }
    Object.assign(target, source);
    return existing;
  }
  if (existing === undefined) {
    state.cache!.relations.push(relation);
    state.relationIndex.add(relation);
    state.relationKeyMap.set(key, relation);
  }
  return relation;
}

/**
 * Remove deleted entities and relations from the indexes.
 *
 * The caller removes the entities and relations from `cache` first. This
 * function does not touch the arrays of the snapshot.
 *
 * @param state - The cache and index members of the storage
 * @param deletedEntities - Entities that were removed from the snapshot
 * @param deletedRelations - Relations that were removed from the snapshot
 */
export function removeEntitiesFromIndexes(
  state: StorageCacheState,
  deletedEntities: readonly Entity[],
  deletedRelations: readonly Relation[],
): void {
  for (const e of deletedEntities) {
    state.nameIndex.remove(e.name);
    state.typeIndex.remove(e.name, e.entityType);
    state.removeLowercase(e);
    state.observationIndex?.remove(e.name);
  }
  for (const r of deletedRelations) {
    state.relationIndex.remove(r);
    state.relationKeyMap.delete(relationKeyOf(r));
  }
}

/**
 * Remove entities and incident relations from an in-memory graph snapshot.
 *
 * The caller runs this after the durable delete. Index maintenance is separate
 * (`removeEntitiesFromIndexes`).
 */
export function deleteNamesFromSnapshot(
  cache: KnowledgeGraph,
  nameSet: ReadonlySet<string>,
): void {
  cache.entities = cache.entities.filter(e => !nameSet.has(e.name));
  cache.relations = cache.relations.filter(
    r => !nameSet.has(r.from) && !nameSet.has(r.to),
  );
}

/**
 * Apply relation deletes and entity timestamp bumps to the in-memory snapshot.
 *
 * Runs after the durable write. Touches `lastModified` even when no relation
 * matched.
 */
export function deleteRelationsFromSnapshot(
  cache: KnowledgeGraph,
  indexes: Pick<StorageCacheState, 'relationIndex' | 'relationKeyMap'>,
  keySet: ReadonlySet<string>,
  deletedRelations: readonly Relation[],
  touchedEntities: readonly Entity[],
  timestamp: string,
): void {
  if (deletedRelations.length > 0) {
    cache.relations = cache.relations.filter(r => !keySet.has(relationKeyOf(r)));
    for (const r of deletedRelations) {
      indexes.relationIndex.remove(r);
      indexes.relationKeyMap.delete(relationKeyOf(r));
    }
  }
  for (const entity of touchedEntities) {
    entity.lastModified = timestamp;
  }
}
