/**
 * ITieredIndex + reference impl tests
 *
 * Covers Phase 9 task 69: interface contract, InMemoryTier round-trip,
 * HotOnlyIndex stats accounting.
 */

import { describe, it, expect } from 'vitest';
import {
  HotOnlyIndex,
  InMemoryTier,
  makeFreshStats,
  type IIndexTier,
} from '../../../../src/search/tiered/ITieredIndex.js';

describe('InMemoryTier', () => {
  it('round-trips put + get', async () => {
    const tier = new InMemoryTier<string, number>();
    await tier.put('alice', 42);
    expect(await tier.get('alice')).toBe(42);
  });

  it('get returns undefined for absent keys', async () => {
    const tier = new InMemoryTier<string, number>();
    expect(await tier.get('ghost')).toBeUndefined();
  });

  it('put replaces prior value', async () => {
    const tier = new InMemoryTier<string, number>();
    await tier.put('alice', 1);
    await tier.put('alice', 2);
    expect(await tier.get('alice')).toBe(2);
  });

  it('delete returns true when something was removed', async () => {
    const tier = new InMemoryTier<string, number>();
    await tier.put('alice', 1);
    expect(await tier.delete('alice')).toBe(true);
    expect(await tier.delete('alice')).toBe(false);
  });

  it('has reflects presence', async () => {
    const tier = new InMemoryTier<string, number>();
    expect(await tier.has('alice')).toBe(false);
    await tier.put('alice', 0); // explicit zero — distinct from absent
    expect(await tier.has('alice')).toBe(true);
  });

  it('size counts entries', async () => {
    const tier = new InMemoryTier<string, number>();
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(await tier.size()).toBe(2);
    await tier.delete('a');
    expect(await tier.size()).toBe(1);
  });

  it('clear drops every entry', async () => {
    const tier = new InMemoryTier<string, number>();
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.clear();
    expect(await tier.size()).toBe(0);
  });

  it('exposes a stable name for diagnostics', () => {
    expect(new InMemoryTier<string, number>('warm').name).toBe('warm');
    expect(new InMemoryTier<string, number>().name).toBe('in-memory');
  });

  it('works with non-string keys', async () => {
    const tier = new InMemoryTier<number, string>();
    await tier.put(1, 'one');
    expect(await tier.get(1)).toBe('one');
  });

  it('works with complex value types', async () => {
    interface Posting { docId: string; freq: number }
    const tier = new InMemoryTier<string, Posting[]>();
    await tier.put('term', [{ docId: 'a', freq: 3 }]);
    const got = await tier.get('term');
    expect(got).toEqual([{ docId: 'a', freq: 3 }]);
  });
});

describe('makeFreshStats', () => {
  it('returns zeroed counters', () => {
    const stats = makeFreshStats('hot', 'warm', 'cold');
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.promotions).toBe(0);
    expect(stats.demotions).toBe(0);
    expect(stats.perTierHits).toEqual({ hot: 0, warm: 0, cold: 0 });
  });

  it('accepts zero tier names', () => {
    const stats = makeFreshStats();
    expect(stats.perTierHits).toEqual({});
  });
});

describe('HotOnlyIndex', () => {
  it('forwards get/put/delete/has/size/clear to the inner tier', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.put('alice', 1);
    expect(await index.get('alice')).toBe(1);
    expect(await index.has('alice')).toBe(true);
    expect(await index.size()).toBe(1);
    expect(await index.delete('alice')).toBe(true);
    expect(await index.has('alice')).toBe(false);
  });

  it('stats.hits increments on a successful get', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.put('a', 1);
    await index.get('a');
    await index.get('a');
    const s = index.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(0);
  });

  it('stats.misses increments on a get for an absent key', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.get('ghost');
    expect(index.stats().misses).toBe(1);
  });

  it('stats.perTierHits keyed by tier name', async () => {
    const index = new HotOnlyIndex<string, number>(new InMemoryTier('custom'));
    await index.put('a', 1);
    await index.get('a');
    expect(index.stats().perTierHits.custom).toBe(1);
  });

  it('stats() returns a snapshot — mutations do not affect future reads', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.put('a', 1);
    await index.get('a');
    const snap = index.stats();
    snap.hits = 999;
    expect(index.stats().hits).toBe(1);
  });

  it('clear() resets stats to zero', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.put('a', 1);
    await index.get('a');
    await index.get('ghost');
    await index.clear();
    const s = index.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });

  it('accepts a custom inner tier', async () => {
    class CountingTier implements IIndexTier<string, number> {
      readonly name = 'counting';
      private store = new Map<string, number>();
      public reads = 0;
      async get(k: string): Promise<number | undefined> { this.reads++; return this.store.get(k); }
      async put(k: string, v: number): Promise<void> { this.store.set(k, v); }
      async delete(k: string): Promise<boolean> { return this.store.delete(k); }
      async has(k: string): Promise<boolean> { return this.store.has(k); }
      async size(): Promise<number> { return this.store.size; }
      async clear(): Promise<void> { this.store.clear(); }
    }
    const tier = new CountingTier();
    const index = new HotOnlyIndex<string, number>(tier);
    await index.put('a', 1);
    await index.get('a');
    expect(tier.reads).toBe(1);
  });
});
