/**
 * Shared in-memory `IGraphStorage` fake for unit tests.
 *
 * Replaces the per-file `createMockStorage` copies. Every method is a
 * `vi.fn` so tests can assert on calls. Missing entities resolve to
 * `undefined` from `getEntityByName` (matching the historical
 * ConsolidationPipeline fixture).
 *
 * Delta primitives (`updateEntities`, `deleteEntities`, `appendRelations`,
 * `deleteRelations`) are present ONLY when `withDeltaPrimitives: true`.
 * Code that feature-detects them must see the legacy path otherwise.
 *
 * Semantics mirror the real backends (see `tests/helpers/__tests__/mockStorage.test.ts`):
 * - `updateEntities` is all-or-nothing: unknown names throw
 *   `EntityNotFoundError` before any mutation.
 * - `deleteEntities` ignores unknown names and cascades to relations.
 * - `appendRelations` / `appendRelation` upsert by `from`/`to`/`relationType`.
 * - `deleteRelations` ignores unknown keys; `touchEntities` bumps `lastModified`.
 *
 * Note: the fake's `events` emitter is real but the fake does not emit on writes.
 */
import { vi } from 'vitest';
import type { Entity, IGraphStorage, KnowledgeGraph, Relation } from '../../src/types/types.js';
import { GraphEventEmitter } from '../../src/core/GraphEventEmitter.js';
import { relationKeyOf } from '../../src/core/storageCache.js';
import { EntityNotFoundError } from '../../src/utils/errors.js';

export interface InMemoryStorageFakeOptions {
  /** Expose `updateEntities`/`deleteEntities`/`appendRelations`/`deleteRelations`. */
  withDeltaPrimitives?: boolean;
}

type RelationKey = Pick<Relation, 'from' | 'to' | 'relationType'>;

/**
 * Build an in-memory `IGraphStorage` fake seeded with `entities`.
 */
export function createInMemoryStorageFake(
  entities: Entity[] = [],
  opts: InMemoryStorageFakeOptions = {},
): IGraphStorage {
  const entityMap = new Map<string, Entity>(entities.map((e) => [e.name, e]));
  let relations: Relation[] = [];

  const upsertRelation = (relation: Relation): void => {
    const key = relationKeyOf(relation);
    const index = relations.findIndex((r) => relationKeyOf(r) === key);
    if (index >= 0) relations[index] = relation;
    else relations.push(relation);
  };

  const fake: Record<string, unknown> = {
    events: new GraphEventEmitter(),
    getEntityByName: vi.fn((name: string) => entityMap.get(name)),
    hasEntity: vi.fn((name: string) => entityMap.has(name)),
    updateEntity: vi.fn(async (name: string, updates: Partial<Entity>) => {
      const entity = entityMap.get(name);
      if (!entity) return false;
      Object.assign(entity, updates);
      return true;
    }),
    loadGraph: vi.fn(async () => ({
      entities: Array.from(entityMap.values()),
      relations: [...relations],
    })),
    appendEntity: vi.fn(async (entity: Entity) => {
      entityMap.set(entity.name, entity);
    }),
    appendRelation: vi.fn(async (relation: Relation) => {
      upsertRelation(relation);
    }),
    getRelationsFor: vi.fn((name: string) =>
      relations.filter((r) => r.from === name || r.to === name),
    ),
    saveGraph: vi.fn(async (graph: KnowledgeGraph) => {
      entityMap.clear();
      for (const e of graph.entities) entityMap.set(e.name, e);
      relations = [...graph.relations];
    }),
  };

  if (opts.withDeltaPrimitives) {
    fake.updateEntities = vi.fn(
      async (batch: Array<{ name: string; updates: Partial<Entity> }>, options?: { timestamp?: string }) => {
        for (const { name } of batch) {
          if (!entityMap.has(name)) throw new EntityNotFoundError(name);
        }
        const timestamp = options?.timestamp ?? new Date().toISOString();
        return batch.map(({ name, updates }) => {
          const entity = entityMap.get(name)!;
          Object.assign(entity, { lastModified: timestamp }, updates);
          return entity;
        });
      },
    );
    fake.appendEntities = vi.fn(async (batch: Entity[]) => {
      for (const entity of batch) entityMap.set(entity.name, entity);
    });
    fake.deleteEntities = vi.fn(async (names: string[]) => {
      const nameSet = new Set(names);
      const deletedEntities = Array.from(entityMap.values()).filter((e) => nameSet.has(e.name));
      const deletedRelations = relations.filter((r) => nameSet.has(r.from) || nameSet.has(r.to));
      for (const e of deletedEntities) entityMap.delete(e.name);
      relations = relations.filter((r) => !deletedRelations.includes(r));
      return { deletedEntities, deletedRelations };
    });
    fake.appendRelations = vi.fn(async (batch: Relation[]) => {
      for (const relation of batch) upsertRelation(relation);
    });
    fake.deleteRelations = vi.fn(
      async (keys: RelationKey[], options?: { touchEntities?: string[]; timestamp?: string }) => {
        const keySet = new Set(keys.map(relationKeyOf));
        const deleted = relations.filter((r) => keySet.has(relationKeyOf(r)));
        relations = relations.filter((r) => !deleted.includes(r));
        const timestamp = options?.timestamp ?? new Date().toISOString();
        for (const name of options?.touchEntities ?? []) {
          const entity = entityMap.get(name);
          if (entity) entity.lastModified = timestamp;
        }
        return deleted;
      },
    );
  }

  return fake as unknown as IGraphStorage;
}
