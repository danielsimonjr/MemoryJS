/**
 * Contract test for the shared in-memory storage fake: its delta primitives
 * must match the real JSONL and SQLite backends on a tiny fixture.
 */
import { describe, it, expect } from 'vitest';
import type { Entity, IGraphStorage, Relation } from '../../../src/types/types.js';
import { EntityNotFoundError } from '../../../src/utils/errors.js';
import { createInMemoryStorageFake } from '../mockStorage.js';
import { withBothBackends } from '../tempStorage.js';

const ts = '2026-01-01T00:00:00.000Z';
const entity = (name: string): Entity => ({
  name,
  entityType: 't',
  observations: [`${name} obs`],
  lastModified: ts,
  createdAt: ts,
} as Entity);
const rel = (from: string, to: string, relationType = 'knows'): Relation => ({ from, to, relationType });

/** Delta primitives are not on `IGraphStorage` yet; the backends and fake expose them. */
type DeltaStorage = IGraphStorage & {
  updateEntities(batch: Array<{ name: string; updates: Partial<Entity> }>): Promise<Entity[]>;
  deleteEntities(names: string[]): Promise<{ deletedEntities: Entity[]; deletedRelations: Relation[] }>;
  appendRelations(relations: Relation[]): Promise<void>;
  deleteRelations(keys: Array<Pick<Relation, 'from' | 'to' | 'relationType'>>): Promise<Relation[]>;
};

async function seed(storage: IGraphStorage): Promise<void> {
  await storage.appendEntity(entity('a'));
  await storage.appendEntity(entity('b'));
  await storage.appendEntity(entity('c'));
  await storage.appendRelation(rel('a', 'b'));
  await storage.appendRelation(rel('b', 'c'));
  await storage.appendRelation(rel('c', 'a'));
}

async function snapshot(storage: IGraphStorage) {
  const graph = await storage.loadGraph();
  return {
    entities: graph.entities.map((e) => e.name).sort(),
    relations: graph.relations.map((r) => `${r.from}>${r.to}:${r.relationType}`).sort(),
  };
}

const expectedOutcomes = {
  afterFailedUpdate: ['a obs'],
  deletedEntities: ['b'],
  deletedRelations: 2,
  afterDelete: { entities: ['a', 'c'], relations: ['c>a:knows'] },
  afterAppend: { entities: ['a', 'c'], relations: ['a>c:knows', 'c>a:knows'] },
  removedByKey: 1,
  afterDeleteRelations: { entities: ['a', 'c'], relations: ['c>a:knows'] },
};

/** Run the same scenario against a storage and return observable outcomes. */
async function runScenario(base: IGraphStorage) {
  const storage = base as DeltaStorage;
  await seed(storage);
  const outcomes: Record<string, unknown> = {};

  await expect(
    storage.updateEntities([
      { name: 'a', updates: { observations: ['changed'] } },
      { name: 'missing', updates: { observations: ['x'] } },
    ]),
  ).rejects.toBeInstanceOf(EntityNotFoundError);
  outcomes.afterFailedUpdate = storage.getEntityByName('a')?.observations;

  const deleted = await storage.deleteEntities(['b', 'nope']);
  outcomes.deletedEntities = deleted.deletedEntities.map((e) => e.name);
  outcomes.deletedRelations = deleted.deletedRelations.length;
  outcomes.afterDelete = await snapshot(storage);

  await storage.appendRelations([rel('a', 'c'), rel('a', 'c')]);
  outcomes.afterAppend = await snapshot(storage);

  outcomes.removedByKey = (await storage.deleteRelations([rel('a', 'c')])).length;
  outcomes.afterDeleteRelations = await snapshot(storage);
  return outcomes;
}

describe('createInMemoryStorageFake (delta primitives)', () => {
  it('omits delta primitives unless withDeltaPrimitives is set', () => {
    const fake = createInMemoryStorageFake([entity('a')]);
    expect((fake as Partial<DeltaStorage>).updateEntities).toBeUndefined();
    expect((createInMemoryStorageFake([], { withDeltaPrimitives: true }) as DeltaStorage).updateEntities).toBeTypeOf('function');
  });

  it('produces the expected scenario outcomes', async () => {
    const fake = createInMemoryStorageFake([], { withDeltaPrimitives: true });
    expect(await runScenario(fake)).toEqual(expectedOutcomes);
  });
});

withBothBackends('storage contract', (backend) => {
  it('matches the in-memory fake on all-or-nothing, cascade and upsert semantics', async () => {
    expect(await runScenario(backend.create())).toEqual(expectedOutcomes);
  });
});
