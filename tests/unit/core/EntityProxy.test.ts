/**
 * EntityProxy Unit Tests
 *
 * Covers Phase 6 step 36: lazy entity hydration.
 */

import { describe, it, expect, vi } from 'vitest';
import { EntityProxy, EntityProxyFactory } from '../../../src/core/EntityProxy.js';
import type { Entity } from '../../../src/types/types.js';

function makeStorage(entities: Entity[]): { storage: { getEntityByName(name: string): Entity | undefined }; spy: ReturnType<typeof vi.fn> } {
  const map = new Map(entities.map((e) => [e.name, e]));
  const spy = vi.fn((name: string) => map.get(name));
  return {
    storage: { getEntityByName: spy },
    spy,
  };
}

describe('EntityProxy', () => {
  const alice: Entity = {
    name: 'alice',
    entityType: 'person',
    observations: ['likes coffee', 'works at TechCo'],
    tags: ['expert'],
    importance: 8,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('exposes name + entityType without hitting storage', () => {
    const { storage, spy } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    expect(proxy.name).toBe('alice');
    expect(proxy.entityType).toBe('person');
    expect(spy).not.toHaveBeenCalled();
  });

  it('hydrates on first field access', () => {
    const { storage, spy } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    expect(proxy.observations).toEqual(['likes coffee', 'works at TechCo']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches hydration — second access does not re-read', () => {
    const { storage, spy } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    void proxy.observations;
    void proxy.tags;
    void proxy.importance;
    void proxy.createdAt;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('isHydrated() flips after first hydrate', () => {
    const { storage } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    expect(proxy.isHydrated()).toBe(false);
    void proxy.observations;
    expect(proxy.isHydrated()).toBe(true);
  });

  it('invalidate() forces a re-read', () => {
    const { storage, spy } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    void proxy.observations;
    proxy.invalidate();
    void proxy.observations;
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('handles missing entity by returning empty/undefined fields', () => {
    const { storage } = makeStorage([]);
    const proxy = new EntityProxy('ghost', 'person', storage);
    expect(proxy.observations).toEqual([]);
    expect(proxy.tags).toBeUndefined();
    expect(proxy.importance).toBeUndefined();
  });

  it('toEntity() returns the loaded record', () => {
    const { storage } = makeStorage([alice]);
    const proxy = new EntityProxy(alice.name, alice.entityType, storage);
    expect(proxy.toEntity()).toEqual(alice);
  });

  it('toEntity() synthesizes a minimal entity when backing record vanished', () => {
    const { storage } = makeStorage([]);
    const proxy = new EntityProxy('ghost', 'person', storage);
    expect(proxy.toEntity()).toEqual({
      name: 'ghost',
      entityType: 'person',
      observations: [],
    });
  });

  it('hydrate() with absent record still flips isHydrated', () => {
    // Important: caching the "miss" prevents repeated reads for a
    // known-missing name in a tight loop.
    const { storage, spy } = makeStorage([]);
    const proxy = new EntityProxy('ghost', 'x', storage);
    proxy.hydrate();
    proxy.hydrate();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(proxy.isHydrated()).toBe(true);
  });
});

describe('EntityProxyFactory', () => {
  const alice: Entity = {
    name: 'alice',
    entityType: 'person',
    observations: ['o1'],
  };
  const bob: Entity = {
    name: 'bob',
    entityType: 'person',
    observations: ['o2'],
  };

  it('fromPair builds a proxy without touching storage', () => {
    const { storage, spy } = makeStorage([alice, bob]);
    const factory = new EntityProxyFactory(storage);
    const proxy = factory.fromPair('alice', 'person');
    expect(spy).not.toHaveBeenCalled();
    expect(proxy.name).toBe('alice');
  });

  it('fromIndex maps a name+type list to proxies, no storage reads', () => {
    const { storage, spy } = makeStorage([alice, bob]);
    const factory = new EntityProxyFactory(storage);
    const proxies = factory.fromIndex([
      { name: 'alice', entityType: 'person' },
      { name: 'bob', entityType: 'person' },
    ]);
    expect(proxies).toHaveLength(2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fromName seeds the cache so subsequent accesses are free', () => {
    const { storage, spy } = makeStorage([alice]);
    const factory = new EntityProxyFactory(storage);
    const proxy = factory.fromName('alice');
    expect(proxy).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
    void proxy!.observations;
    void proxy!.importance;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fromName returns undefined for missing entity', () => {
    const { storage } = makeStorage([alice]);
    const factory = new EntityProxyFactory(storage);
    expect(factory.fromName('ghost')).toBeUndefined();
  });

  it('lazy-filter pattern only hydrates kept entries', () => {
    const { storage, spy } = makeStorage([alice, bob]);
    const factory = new EntityProxyFactory(storage);
    const proxies = factory.fromIndex([
      { name: 'alice', entityType: 'person' },
      { name: 'bob', entityType: 'animal' },
    ]);
    const persons = proxies.filter((p) => p.entityType === 'person');
    for (const p of persons) void p.observations;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('alice');
  });
});
