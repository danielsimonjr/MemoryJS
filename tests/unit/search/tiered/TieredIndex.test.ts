/**
 * TieredIndex (3-tier composer) tests
 *
 * Covers Phase 9 task 73: hot → warm → cold layering with
 * promotion-on-get and chained demotion via onEvict.
 */

import { describe, it, expect } from 'vitest';
import {
  TieredIndex,
  buildTieredIndex,
} from '../../../../src/search/tiered/TieredIndex.js';
import {
  InMemoryTier,
  type IIndexTier,
} from '../../../../src/search/tiered/ITieredIndex.js';
import { LRUHotTier } from '../../../../src/search/tiered/LRUHotTier.js';

function makeTiered<V>(): {
  composer: TieredIndex<V>;
  hot: InMemoryTier<string, V>;
  warm: InMemoryTier<string, V>;
  cold: InMemoryTier<string, V>;
} {
  const hot = new InMemoryTier<string, V>('hot');
  const warm = new InMemoryTier<string, V>('warm');
  const cold = new InMemoryTier<string, V>('cold');
  const composer = new TieredIndex<V>({ hot, warm, cold });
  return { composer, hot, warm, cold };
}

describe('TieredIndex composer — hot only behaviors', () => {
  it('put lands in hot', async () => {
    const { composer, hot } = makeTiered<number>();
    await composer.put('a', 1);
    expect(await hot.get('a')).toBe(1);
  });

  it('get from hot does not promote (no-op)', async () => {
    const { composer, hot } = makeTiered<number>();
    await hot.put('a', 1);
    expect(await composer.get('a')).toBe(1);
    expect(composer.stats().promotions).toBe(0);
    expect(composer.stats().perTierHits.hot).toBe(1);
  });

  it('stats.hits increments on a successful get', async () => {
    const { composer } = makeTiered<number>();
    await composer.put('a', 1);
    await composer.get('a');
    await composer.get('a');
    expect(composer.stats().hits).toBe(2);
    expect(composer.stats().misses).toBe(0);
  });

  it('stats.misses increments when nothing has the key', async () => {
    const { composer } = makeTiered<number>();
    await composer.get('ghost');
    expect(composer.stats().misses).toBe(1);
    expect(composer.stats().hits).toBe(0);
  });
});

describe('TieredIndex composer — promotion on cross-tier hit', () => {
  it('warm-tier hit promotes to hot and removes from warm', async () => {
    const { composer, hot, warm } = makeTiered<number>();
    await warm.put('a', 1);

    const got = await composer.get('a');

    expect(got).toBe(1);
    expect(await hot.get('a')).toBe(1);
    expect(await warm.has('a')).toBe(false);
    expect(composer.stats().promotions).toBe(1);
    expect(composer.stats().perTierHits.warm).toBe(1);
  });

  it('cold-tier hit promotes to hot and removes from cold', async () => {
    const { composer, hot, cold } = makeTiered<number>();
    await cold.put('a', 1);

    const got = await composer.get('a');

    expect(got).toBe(1);
    expect(await hot.get('a')).toBe(1);
    expect(await cold.has('a')).toBe(false);
    expect(composer.stats().promotions).toBe(1);
    expect(composer.stats().perTierHits.cold).toBe(1);
  });

  it('hot tier checked before warm before cold', async () => {
    const { composer, hot, warm, cold } = makeTiered<number>();
    // Put the same key in all three tiers (synthetic — won't happen
    // in normal flow because put() cleans the colder tiers).
    await hot.put('a', 1);
    await warm.put('a', 2);
    await cold.put('a', 3);
    expect(await composer.get('a')).toBe(1);
    expect(composer.stats().perTierHits.hot).toBe(1);
    expect(composer.stats().perTierHits.warm).toBe(0);
    expect(composer.stats().perTierHits.cold).toBe(0);
  });

  it('miss returns undefined and bumps misses', async () => {
    const { composer } = makeTiered<number>();
    expect(await composer.get('ghost')).toBeUndefined();
    expect(composer.stats().misses).toBe(1);
  });
});

describe('TieredIndex composer — put cleans colder tiers', () => {
  it('put removes the key from warm and cold so it exists at exactly one tier', async () => {
    const { composer, hot, warm, cold } = makeTiered<number>();
    await warm.put('a', 1);
    await cold.put('a', 2);
    await composer.put('a', 99);
    expect(await hot.get('a')).toBe(99);
    expect(await warm.has('a')).toBe(false);
    expect(await cold.has('a')).toBe(false);
  });
});

describe('TieredIndex composer — delete + has + size + clear', () => {
  it('delete removes from all tiers', async () => {
    const { composer, hot, warm, cold } = makeTiered<number>();
    await hot.put('a', 1);
    await warm.put('b', 2);
    await cold.put('c', 3);
    expect(await composer.delete('a')).toBe(true);
    expect(await composer.delete('b')).toBe(true);
    expect(await composer.delete('c')).toBe(true);
    expect(await composer.delete('ghost')).toBe(false);
  });

  it('has() returns true when ANY tier holds the key', async () => {
    const { composer, warm } = makeTiered<number>();
    await warm.put('a', 1);
    expect(await composer.has('a')).toBe(true);
    expect(await composer.has('ghost')).toBe(false);
  });

  it('size() sums across tiers', async () => {
    const { composer, hot, warm, cold } = makeTiered<number>();
    await hot.put('a', 1);
    await hot.put('b', 2);
    await warm.put('c', 3);
    await cold.put('d', 4);
    expect(await composer.size()).toBe(4);
  });

  it('clear() drops every tier + resets stats', async () => {
    const { composer, hot, warm, cold } = makeTiered<number>();
    await hot.put('a', 1);
    await warm.put('b', 2);
    await cold.put('c', 3);
    await composer.get('a'); // bump hits
    await composer.get('b'); // bump hits + promotions
    await composer.clear();
    expect(await composer.size()).toBe(0);
    expect(composer.stats().hits).toBe(0);
    expect(composer.stats().promotions).toBe(0);
  });
});

describe('TieredIndex — two-tier (no cold) mode', () => {
  it('hot + warm only is supported', async () => {
    const hot = new InMemoryTier<string, number>('hot');
    const warm = new InMemoryTier<string, number>('warm');
    const composer = new TieredIndex<number>({ hot, warm });
    await composer.put('a', 1);
    expect(await composer.get('a')).toBe(1);
    expect(composer.stats().perTierHits.cold).toBeUndefined();
  });
});

describe('buildTieredIndex factory', () => {
  it('wires eviction callbacks: hot evict → warm.put', async () => {
    let warmRef: IIndexTier<string, number>;
    const tiered = buildTieredIndex<number>({
      makeHot: (onEvict) => new LRUHotTier({ maxEntries: 2, onEvict, name: 'hot' }),
      makeWarm: () => {
        warmRef = new InMemoryTier<string, number>('warm');
        return warmRef;
      },
    });

    // Pre-seed via tier-level access so the LRU bound triggers cleanly.
    await tiered.put('a', 1);
    await tiered.put('b', 2);
    await tiered.put('c', 3); // evicts 'a' from hot → onEvict → warm.put('a', 1)
    expect(await warmRef!.get('a')).toBe(1);
    // Demotion counter bumped.
    expect(tiered.stats().demotions).toBe(1);
  });

  it('wires eviction callbacks: warm evict → cold.put (chain)', async () => {
    let coldRef: IIndexTier<string, number>;
    const tiered = buildTieredIndex<number>({
      makeHot: (onEvict) =>
        new LRUHotTier({ maxEntries: 1, onEvict, name: 'hot' }),
      makeWarm: (onEvict) => {
        // Track warm onEvict via inline subclass — InMemoryTier doesn't
        // have an onEvict hook, so we forward manually for the test.
        const warm = new InMemoryTier<string, number>('warm');
        return new (class extends InMemoryTier<string, number> {
          private inner = warm;
          constructor() { super('warm'); }
          override async put(k: string, v: number): Promise<void> {
            // Custom maxEntries=1: if there's a different key, evict it.
            for (const existingKey of [...(this.inner as unknown as { data: Map<string, number> }).data.keys()]) {
              if (existingKey !== k) {
                const existingValue = (await this.inner.get(existingKey))!;
                await this.inner.delete(existingKey);
                onEvict(existingKey, existingValue);
              }
            }
            await this.inner.put(k, v);
            // Mirror into our own backing for has/get/size.
            await super.put(k, v);
          }
          override async get(k: string): Promise<number | undefined> { return this.inner.get(k); }
          override async has(k: string): Promise<boolean> { return this.inner.has(k); }
          override async delete(k: string): Promise<boolean> { await super.delete(k); return this.inner.delete(k); }
          override async size(): Promise<number> { return this.inner.size(); }
          override async clear(): Promise<void> { await super.clear(); await this.inner.clear(); }
        })();
      },
      makeCold: () => {
        coldRef = new InMemoryTier<string, number>('cold');
        return coldRef;
      },
    });

    // a → hot. b → hot, a evicted to warm.
    await tiered.put('a', 1);
    await tiered.put('b', 2);
    // c → hot, b evicted to warm. Warm now has [a, b] but maxEntries=1
    // (via our fake) → a evicted from warm to cold.
    await tiered.put('c', 3);

    expect(await coldRef!.get('a')).toBe(1);
    expect(tiered.stats().demotions).toBeGreaterThanOrEqual(2);
  });

  it('cold-less builds (no makeCold) drop warm-tier evictions silently', async () => {
    const tiered = buildTieredIndex<number>({
      makeHot: (onEvict) => new LRUHotTier({ maxEntries: 1, onEvict, name: 'hot' }),
      makeWarm: () => new InMemoryTier<string, number>('warm'),
    });
    await tiered.put('a', 1);
    await tiered.put('b', 2);
    expect(await tiered.get('a')).toBe(1);
    // No cold-tier reference to inspect; just verify it didn't throw.
  });
});

describe('TieredIndex.stats() returns a snapshot', () => {
  it('mutating the snapshot does not affect future reads', async () => {
    const { composer } = makeTiered<number>();
    await composer.put('a', 1);
    await composer.get('a');
    const snap = composer.stats();
    snap.hits = 999;
    snap.perTierHits.hot = 999;
    const fresh = composer.stats();
    expect(fresh.hits).toBe(1);
    expect(fresh.perTierHits.hot).toBe(1);
  });
});
