/**
 * Unit tests for snapshotTierStats (CL-13) and its use by the tier composers.
 */

import { describe, it, expect } from 'vitest';
import {
  HotOnlyIndex,
  InMemoryTier,
  makeFreshStats,
  snapshotTierStats,
  type TierAccessStats,
} from '../../../../src/search/tiered/ITieredIndex.js';
import { TieredIndex } from '../../../../src/search/tiered/TieredIndex.js';

describe('snapshotTierStats', () => {
  it('copies every counter', () => {
    const source: TierAccessStats = {
      hits: 4,
      misses: 2,
      promotions: 1,
      demotions: 3,
      perTierHits: { hot: 3, warm: 1 },
    };

    expect(snapshotTierStats(source)).toEqual(source);
  });

  it('returns a copy whose perTierHits does not alias the source', () => {
    const source = makeFreshStats('hot', 'warm');
    source.perTierHits.hot = 5;

    const snap = snapshotTierStats(source);
    snap.perTierHits.hot = 99;
    snap.hits = 42;

    expect(source.perTierHits.hot).toBe(5);
    expect(source.hits).toBe(0);
  });

  it('keeps the key order of perTierHits', () => {
    const source = makeFreshStats('hot', 'warm', 'cold');
    expect(Object.keys(snapshotTierStats(source).perTierHits)).toEqual(['hot', 'warm', 'cold']);
  });

  it('HotOnlyIndex.stats returns a snapshot that callers cannot use to mutate counters', async () => {
    const index = new HotOnlyIndex<string, number>();
    await index.put('a', 1);
    await index.get('a');
    await index.get('missing');

    const first = index.stats();
    expect(first).toEqual({
      hits: 1,
      misses: 1,
      promotions: 0,
      demotions: 0,
      perTierHits: { hot: 1 },
    });

    first.hits = 100;
    first.perTierHits.hot = 100;
    expect(index.stats().hits).toBe(1);
    expect(index.stats().perTierHits.hot).toBe(1);
  });

  it('TieredIndex.stats reports promotions and tier hits through the snapshot', async () => {
    const index = new TieredIndex<number>({
      hot: new InMemoryTier<string, number>('hot'),
      warm: new InMemoryTier<string, number>('warm'),
    });
    await index.put('k', 7);
    await (index as unknown as { warm: InMemoryTier<string, number> }).warm.put('w', 8);

    await index.get('w');

    const stats = index.stats();
    expect(stats.hits).toBe(1);
    expect(stats.promotions).toBe(1);
    expect(stats.perTierHits).toEqual({ hot: 0, warm: 1 });
  });
});
