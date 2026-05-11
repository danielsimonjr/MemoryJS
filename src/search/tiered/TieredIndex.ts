/**
 * Tiered Index Composer (hot → warm → cold)
 *
 * Phase 9 task 73 (§1.5) — wires the three tier implementations
 * (`LRUHotTier`, `DiskWarmTier`, `BrotliColdTier`) into an
 * `ITieredIndex` with promotion-on-get and chained demotion via
 * `onEvict` callbacks. The result: callers see a single
 * `ITieredIndex<string, V>` API while the implementation pages the
 * hot working set in RAM, spills the warm set to disk, and stores
 * the long tail compressed.
 *
 * **Promotion policy:** a `get` hit in warm or cold tier:
 * 1. Returns the value to the caller.
 * 2. Puts the value into hot (which may trigger a hot-tier eviction
 *    onto warm, which may trigger a warm-tier eviction onto cold —
 *    naturally re-arranging the LRU chain).
 * 3. Removes the value from the colder tier where it was found.
 *
 * **Demotion chain (wired in constructor):**
 *   `LRUHotTier.onEvict` → `DiskWarmTier.put`
 *   `DiskWarmTier.onEvict` → `BrotliColdTier.put`
 *
 * **Cold-tier evictions are NOT chained anywhere** — the cold tier
 * is the floor, and callers configure its bounds via shard size /
 * a separate compaction tool. (If `BrotliColdTier` grows an eviction
 * concept in the future, the natural target is "drop" since there's
 * no colder tier.)
 *
 * **No external deps.** Pure TS composer over the three tier
 * implementations.
 *
 * @module search/tiered/TieredIndex
 * @experimental Promotion / demotion policy is the obvious first
 *   cut. Future tweaks (e.g. promote-on-Nth-access rather than
 *   first-access, configurable cold-tier handling) will land as
 *   non-breaking constructor options.
 */

import {
  type IIndexTier,
  type ITieredIndex,
  type TierAccessStats,
  makeFreshStats,
} from './ITieredIndex.js';
import { logger } from '../../utils/logger.js';

export interface TieredIndexOptions<V> {
  hot: IIndexTier<string, V>;
  warm: IIndexTier<string, V>;
  cold?: IIndexTier<string, V>;
}

/**
 * Three-tier (hot, warm, optional cold) composer. Implementations of
 * the tier interfaces are caller-provided so this module stays
 * decoupled from the concrete tier classes — tests use
 * `InMemoryTier` everywhere; production wires `LRUHotTier` +
 * `DiskWarmTier` + `BrotliColdTier`.
 *
 * @example
 * ```typescript
 * const tiered = new TieredIndex<PostingList>({
 *   hot: new LRUHotTier({ maxEntries: 10_000 }),
 *   warm: new DiskWarmTier({ filePath: '/data/warm.jsonl', maxEntries: 100_000 }),
 *   cold: new BrotliColdTier({ filePath: '/data/cold.jsonl.br' }),
 * });
 * await tiered.put('term', postings);
 * const got = await tiered.get('term');  // hot hit, no disk read
 * ```
 */
export class TieredIndex<V> implements ITieredIndex<string, V> {
  private readonly hot: IIndexTier<string, V>;
  private readonly warm: IIndexTier<string, V>;
  private readonly cold: IIndexTier<string, V> | null;
  private accessStats: TierAccessStats;
  /**
   * Per-key operation chain. Serializes `get`/`put`/`delete` on the
   * same key while allowing different keys to proceed in parallel.
   * Without this, an interleaved `put(k, A)` + `get(k)` (where `get`
   * found `k` in warm) could leave hot holding the stale warm value
   * after the racing-back `hot.put` (review #1). Cleanup on
   * `finally` so the map doesn't leak entries past the last op on a
   * key.
   */
  private opChains: Map<string, Promise<unknown>> = new Map();

  constructor(options: TieredIndexOptions<V>) {
    this.hot = options.hot;
    this.warm = options.warm;
    this.cold = options.cold ?? null;

    const tierNames = this.cold !== null
      ? [this.hot.name, this.warm.name, this.cold.name]
      : [this.hot.name, this.warm.name];
    this.accessStats = makeFreshStats(...tierNames);
  }

  /**
   * Serialize `op` against any concurrent operations on the same
   * `key`. Operations on DIFFERENT keys proceed in parallel — this
   * is a fine-grained lock, not a global one. Errors propagate to
   * the caller and are also propagated down the chain so subsequent
   * ops on the same key don't end up `await`ing forever.
   */
  private async withKeyLock<R>(key: string, op: () => Promise<R>): Promise<R> {
    const prior = this.opChains.get(key) ?? Promise.resolve();
    let next!: Promise<R>;
    next = prior.then(op, op).finally(() => {
      if (this.opChains.get(key) === (next as unknown as Promise<unknown>)) {
        this.opChains.delete(key);
      }
    });
    this.opChains.set(key, next as unknown as Promise<unknown>);
    return next;
  }

  async get(key: string): Promise<V | undefined> {
    return this.withKeyLock(key, () => this.getInner(key));
  }

  private async getInner(key: string): Promise<V | undefined> {
    // Hot first.
    const hotHit = await this.hot.get(key);
    if (hotHit !== undefined) {
      this.accessStats.hits++;
      this.accessStats.perTierHits[this.hot.name]! += 1;
      return hotHit;
    }

    // Warm next — promote on hit.
    const warmHit = await this.warm.get(key);
    if (warmHit !== undefined) {
      this.accessStats.hits++;
      this.accessStats.perTierHits[this.warm.name]! += 1;
      this.accessStats.promotions++;
      // Promote: write to hot (may trigger eviction back down via
      // hot.onEvict → warm.put). Remove from warm afterwards so the
      // entry exists at exactly one tier post-promotion.
      await this.hot.put(key, warmHit);
      await this.warm.delete(key);
      return warmHit;
    }

    // Cold last (when present) — promote on hit.
    if (this.cold !== null) {
      const coldHit = await this.cold.get(key);
      if (coldHit !== undefined) {
        this.accessStats.hits++;
        this.accessStats.perTierHits[this.cold.name]! += 1;
        this.accessStats.promotions++;
        await this.hot.put(key, coldHit);
        await this.cold.delete(key);
        return coldHit;
      }
    }

    this.accessStats.misses++;
    return undefined;
  }

  async put(key: string, value: V): Promise<void> {
    return this.withKeyLock(key, async () => {
      // Writes always land in hot. Hot's `onEvict` (wired in the
      // wiring helper below) handles demotion to warm; warm's
      // `onEvict` handles demotion to cold.
      //
      // Also delete from warm + cold so the entry exists at exactly
      // one tier — important for `has()` / `size()` accounting. The
      // per-key serialization (`withKeyLock`) keeps this safe vs
      // concurrent `get` from another caller (review #1).
      await this.hot.put(key, value);
      await this.warm.delete(key);
      if (this.cold !== null) await this.cold.delete(key);
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.withKeyLock(key, async () => {
      // Delete from every tier so we don't leak. Track whether any
      // tier had something so the return matches `IIndexTier.delete`.
      let removed = false;
      if (await this.hot.delete(key)) removed = true;
      if (await this.warm.delete(key)) removed = true;
      if (this.cold !== null && (await this.cold.delete(key))) removed = true;
      return removed;
    });
  }

  async has(key: string): Promise<boolean> {
    if (await this.hot.has(key)) return true;
    if (await this.warm.has(key)) return true;
    if (this.cold !== null && (await this.cold.has(key))) return true;
    return false;
  }

  async size(): Promise<number> {
    const hot = await this.hot.size();
    const warm = await this.warm.size();
    const cold = this.cold !== null ? await this.cold.size() : 0;
    return hot + warm + cold;
  }

  stats(): TierAccessStats {
    return {
      hits: this.accessStats.hits,
      misses: this.accessStats.misses,
      promotions: this.accessStats.promotions,
      demotions: this.accessStats.demotions,
      perTierHits: { ...this.accessStats.perTierHits },
    };
  }

  /**
   * Notify the composer that a demotion occurred. The hot and warm
   * tiers fire this through their `onEvict` callbacks (wired by
   * `chainEvictions` below) so the composer can count.
   */
  recordDemotion(): void {
    this.accessStats.demotions++;
  }

  async clear(): Promise<void> {
    await this.hot.clear();
    await this.warm.clear();
    if (this.cold !== null) await this.cold.clear();
    const tierNames = this.cold !== null
      ? [this.hot.name, this.warm.name, this.cold.name]
      : [this.hot.name, this.warm.name];
    this.accessStats = makeFreshStats(...tierNames);
  }
}

/**
 * Build a 3-tier composer with eviction callbacks wired correctly.
 * Pass the tier *factories* rather than constructed instances, since
 * the `onEvict` callback needs to reference the next tier — a
 * chicken-and-egg problem that's cleanest to resolve with deferred
 * construction.
 *
 * The composer's `recordDemotion()` is invoked from each eviction
 * callback so `stats().demotions` reflects the actual chain.
 *
 * Tier implementations that don't take an `onEvict` option (e.g.
 * `InMemoryTier`, `BrotliColdTier`) can be passed via plain instance
 * factories — the eviction wiring is only meaningful for the layers
 * that eject things.
 *
 * @example
 * ```typescript
 * const tiered = buildTieredIndex<PostingList>({
 *   makeHot: (onEvict) => new LRUHotTier({ maxEntries: 10_000, onEvict }),
 *   makeWarm: (onEvict) => new DiskWarmTier({ filePath: '/data/warm.jsonl', onEvict, maxEntries: 100_000 }),
 *   makeCold: () => new BrotliColdTier({ filePath: '/data/cold.jsonl.br' }),
 * });
 * ```
 */
export interface TieredIndexBuildOptions<V> {
  /**
   * Factory for the hot tier. Receives the `onEvict` callback that
   * demotes to warm; pass it through to the tier constructor.
   */
  makeHot: (onEvict: (key: string, value: V) => void) => IIndexTier<string, V>;
  /**
   * Factory for the warm tier. Receives the `onEvict` callback that
   * demotes to cold (or is a no-op when no cold tier is present).
   */
  makeWarm: (onEvict: (key: string, value: V) => void) => IIndexTier<string, V>;
  /** Optional cold-tier factory. When omitted, warm-tier evictions are dropped. */
  makeCold?: () => IIndexTier<string, V>;
}

export function buildTieredIndex<V>(options: TieredIndexBuildOptions<V>): TieredIndex<V> {
  // Deferred construction: build cold first (it has no callback to
  // wire), then warm with a callback referencing cold, then hot with
  // a callback referencing warm. The composer is constructed last
  // and exposed as a `late` reference inside the callbacks so they
  // can bump demotion stats.
  const cold = options.makeCold ? options.makeCold() : null;

  let composer: TieredIndex<V>;
  const warm = options.makeWarm((key, value) => {
    composer.recordDemotion();
    // Surface demotion failures via logger (review #3) — fire-and-
    // forget previously meant a disk-full or EPERM on the cold tier
    // would silently drop the evictee. The eviction is final from
    // warm's POV either way (it already deleted the entry), so the
    // best we can do is shout.
    if (cold !== null) {
      void cold.put(key, value).catch((err) => {
        logger.error(
          `[TieredIndex] warm→cold demotion failed for key "${key}"; value lost: ${(err as Error).message}`,
        );
      });
    }
  });
  const hot = options.makeHot((key, value) => {
    composer.recordDemotion();
    void warm.put(key, value).catch((err) => {
      logger.error(
        `[TieredIndex] hot→warm demotion failed for key "${key}"; value lost: ${(err as Error).message}`,
      );
    });
  });
  composer = new TieredIndex<V>({ hot, warm, ...(cold !== null ? { cold } : {}) });
  return composer;
}
