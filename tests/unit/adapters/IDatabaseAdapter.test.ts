/**
 * IDatabaseAdapter Smoke Tests (against InMemoryDatabaseAdapter)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDatabaseAdapter,
  NullDatabaseAdapter,
  type DatabaseBatchOp,
} from '../../../src/adapters/IDatabaseAdapter.js';
import type { Entity, Relation } from '../../../src/types/types.js';

describe('InMemoryDatabaseAdapter', () => {
  let adapter: InMemoryDatabaseAdapter;

  beforeEach(async () => {
    adapter = new InMemoryDatabaseAdapter();
    await adapter.connect();
  });

  it('connect / isConnected / disconnect lifecycle', async () => {
    const fresh = new InMemoryDatabaseAdapter();
    expect(fresh.isConnected()).toBe(false);
    await fresh.connect();
    expect(fresh.isConnected()).toBe(true);
    await fresh.disconnect();
    expect(fresh.isConnected()).toBe(false);
  });

  it('putEntity / getEntity round-trip', async () => {
    const e: Entity = { name: 'Alice', entityType: 'person', observations: ['dev'] };
    await adapter.putEntity(e);
    const fetched = await adapter.getEntity('Alice');
    expect(fetched).toEqual(e);
  });

  it('deleteEntity returns true when removed, false when missing', async () => {
    await adapter.putEntity({ name: 'X', entityType: 'note', observations: [] });
    expect(await adapter.deleteEntity('X')).toBe(true);
    expect(await adapter.deleteEntity('X')).toBe(false);
    expect(await adapter.getEntity('X')).toBeUndefined();
  });

  it('listEntities returns every stored entity', async () => {
    await adapter.putEntity({ name: 'A', entityType: 'note', observations: [] });
    await adapter.putEntity({ name: 'B', entityType: 'note', observations: [] });
    const all = await adapter.listEntities();
    expect(all.map((e) => e.name).sort()).toEqual(['A', 'B']);
  });

  it('relation CRUD round-trip', async () => {
    const r: Relation = { from: 'A', to: 'B', relationType: 'links' };
    await adapter.putRelation(r);
    const all = await adapter.listRelations();
    expect(all).toEqual([r]);
    expect(await adapter.deleteRelation('A', 'B', 'links')).toBe(true);
    expect(await adapter.listRelations()).toEqual([]);
  });

  it('snapshot returns a full graph copy', async () => {
    await adapter.putEntity({ name: 'A', entityType: 'note', observations: [] });
    await adapter.putRelation({ from: 'A', to: 'B', relationType: 'links' });
    const snap = await adapter.snapshot();
    expect(snap.entities).toHaveLength(1);
    expect(snap.relations).toHaveLength(1);
  });

  it('applyBatch performs every op type', async () => {
    const ops: DatabaseBatchOp[] = [
      { kind: 'put-entity', entity: { name: 'A', entityType: 'note', observations: [] } },
      { kind: 'put-entity', entity: { name: 'B', entityType: 'note', observations: [] } },
      { kind: 'put-relation', relation: { from: 'A', to: 'B', relationType: 'r' } },
      { kind: 'delete-entity', name: 'B' },
      { kind: 'delete-relation', from: 'A', to: 'B', relationType: 'r' },
    ];
    await adapter.applyBatch(ops);
    expect((await adapter.listEntities()).map((e) => e.name)).toEqual(['A']);
    expect(await adapter.listRelations()).toEqual([]);
  });

  it('throws when used before connect()', async () => {
    const fresh = new InMemoryDatabaseAdapter();
    await expect(
      fresh.putEntity({ name: 'X', entityType: 'note', observations: [] }),
    ).rejects.toThrow(/not connected/);
  });

  it('disconnect clears state', async () => {
    await adapter.putEntity({ name: 'X', entityType: 'note', observations: [] });
    await adapter.disconnect();
    await adapter.connect();
    expect(await adapter.listEntities()).toEqual([]);
  });
});

describe('NullDatabaseAdapter', () => {
  it('rejects connect() so misconfigured callers fail loud', async () => {
    const adapter = new NullDatabaseAdapter();
    await expect(adapter.connect()).rejects.toThrow(/unimplemented/);
    expect(adapter.isConnected()).toBe(false);
  });

  it('rejects every CRUD op', async () => {
    const adapter = new NullDatabaseAdapter();
    await expect(
      adapter.putEntity({ name: 'X', entityType: 'note', observations: [] }),
    ).rejects.toThrow(/unimplemented/);
    await expect(adapter.snapshot()).rejects.toThrow(/unimplemented/);
  });

  it('disconnect is a forgiving no-op', async () => {
    const adapter = new NullDatabaseAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});
