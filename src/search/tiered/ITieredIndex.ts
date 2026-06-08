/**
 * Tiered Index — Interface + Single-Tier Reference Impl
 *
 * Phase 9 task 69 (§1.5) — first task in the tiered index breakdown.
 * Defines the per-tier contract (`IIndexTier`), the composer
 * interface (`ITieredIndex`), and a memory-only single-tier
 * reference implementation used by tests and by callers who don't
 * need warm/cold storage.
 *
 * **Why tiered?** The in-memory inverted index for a 100k-entity
 * graph can chew through hundreds of MB. Most index lookups hit a
 * "hot" minority of terms; the long tail is queried rarely. A
 * tiered design keeps the hot working set in RAM, spills the warm
 * set to disk-LRU, and compresses the cold tail — letting callers
 * hold a huge index at a fraction of the RAM cost.
 *
 * **Three pieces ship across this phase:**
 *
 * - Task 69 (this module): the interfaces + `HotOnlyIndex` reference.
 * - Task 70: `LRUHotTier` (RAM, LRU eviction, configurable bounds).
 * - Task 71: `DiskWarmTier` (per-key JSONL or SQLite, LRU on disk).
 * - Task 72: `BrotliColdTier` (compressed-on-disk shard for the long tail).
 *
 * Then task 73 wires `OptimizedInvertedIndex` to use a 3-tier
 * composer gated on `MEMORY_TIERED_INDEX=true`.
 *
 * **No external deps.** Pure TS.
 *
 * @module search/tiered/ITieredIndex
 * @experimental All shapes here are first-cut. The `TierAccessStats`
 *   counter set may grow new fields in non-breaking ways as more
 *   diagnostics are wired in.
 */

/**
 * Per-tier access counters. Reset by `ITieredIndex.clear()` and
 * monotonically increase otherwise. Used by `ctx.diagnostics()` to
 * report tier hit rates.
 */
export interface TierAccessStats {
  /** Successful `get` calls — value found at some tier. */
  hits: number;
  /** `get` calls that found nothing across every tier. */
  misses: number;
  /** Values moved from a colder tier into hot on a get hit. */
  promotions: number;
  /** Values evicted from hot to a colder tier (typically LRU). */
  demotions: number;
  /** Per-tier hit count. Names match `IIndexTier.name`. */
  perTierHits: Record<string, number>;
}

/**
 * Single tier of storage. Hot, warm, and cold tiers all implement
 * this — the composer wires them together. Implementations don't
 * know they're part of a tiered chain; they just answer
 * get/put/delete/has/size/clear.
 */
export interface IIndexTier<K, V> {
  /** Stable name for diagnostics (e.g. `'hot'`, `'warm'`, `'cold'`). */
  readonly name: string;

  /** Look up a value. Returns `undefined` when absent. */
  get(key: K): Promise<V | undefined>;

  /** Store a value. Replaces any prior value for the same key. */
  put(key: K, value: V): Promise<void>;

  /** Remove a value. Returns `true` when something was removed. */
  delete(key: K): Promise<boolean>;

  /** Whether the tier has any value for `key` (without producing it). */
  has(key: K): Promise<boolean>;

  /** Total entry count in this tier. */
  size(): Promise<number>;

  /** Drop every entry. */
  clear(): Promise<void>;
}

/**
 * Composer interface — what callers see. Implementations decide how
 * many tiers they wrap and the promotion/demotion policy.
 *
 * @example
 * ```typescript
 * const index = new HotOnlyIndex<string, PostingList>();
 * await index.put('alice', postingList);
 * const list = await index.get('alice');
 * const stats = index.stats();
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses)}`);
 * ```
 */
export interface ITieredIndex<K, V> {
  get(key: K): Promise<V | undefined>;
  put(key: K, value: V): Promise<void>;
  delete(key: K): Promise<boolean>;
  has(key: K): Promise<boolean>;
  size(): Promise<number>;
  /** Snapshot of access counters. */
  stats(): TierAccessStats;
  /** Drop every entry across every tier + reset stats. */
  clear(): Promise<void>;
}

// ==================== In-memory tier ====================

/**
 * Map-backed tier. Used by `HotOnlyIndex` as the only tier; used by
 * the future `LRUHotTier` (task 70) as its inner store with eviction
 * wrapped around it. No bounds — implementations that need limits
 * compose this with an eviction policy.
 */
export class InMemoryTier<K, V> implements IIndexTier<K, V> {
  readonly name: string;
  private readonly data: Map<K, V> = new Map();

  constructor(name = 'in-memory') {
    this.name = name;
  }

  async get(key: K): Promise<V | undefined> {
    return this.data.get(key);
  }

  async put(key: K, value: V): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: K): Promise<boolean> {
    return this.data.delete(key);
  }

  async has(key: K): Promise<boolean> {
    return this.data.has(key);
  }

  async size(): Promise<number> {
    return this.data.size;
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

// ==================== Single-tier composer ====================

/**
 * Single-tier `ITieredIndex` — no promotion/demotion, just stats
 * around a single tier. Used by tests and by callers who want the
 * `ITieredIndex` shape without the complexity of layered storage.
 * Production callers want the 3-tier composer (task 73).
 */
export class HotOnlyIndex<K, V> implements ITieredIndex<K, V> {
  private readonly hot: IIndexTier<K, V>;
  private accessStats: TierAccessStats;

  constructor(hot?: IIndexTier<K, V>) {
    this.hot = hot ?? new InMemoryTier<K, V>('hot');
    this.accessStats = makeFreshStats(this.hot.name);
  }

  async get(key: K): Promise<V | undefined> {
    const value = await this.hot.get(key);
    if (value !== undefined) {
      this.accessStats.hits++;
      this.accessStats.perTierHits[this.hot.name]! += 1;
    } else {
      this.accessStats.misses++;
    }
    return value;
  }

  async put(key: K, value: V): Promise<void> {
    await this.hot.put(key, value);
  }

  async delete(key: K): Promise<boolean> {
    return this.hot.delete(key);
  }

  async has(key: K): Promise<boolean> {
    return this.hot.has(key);
  }

  async size(): Promise<number> {
    return this.hot.size();
  }

  stats(): TierAccessStats {
    // Return a snapshot — callers shouldn't mutate our counters.
    return {
      hits: this.accessStats.hits,
      misses: this.accessStats.misses,
      promotions: this.accessStats.promotions,
      demotions: this.accessStats.demotions,
      perTierHits: { ...this.accessStats.perTierHits },
    };
  }

  async clear(): Promise<void> {
    await this.hot.clear();
    this.accessStats = makeFreshStats(this.hot.name);
  }
}

/**
 * Build a zeroed stats snapshot keyed by every tier name the caller
 * cares about. Used by composer constructors + by `clear()` to reset
 * counters atomically.
 */
export function makeFreshStats(...tierNames: string[]): TierAccessStats {
  const perTierHits: Record<string, number> = {};
  for (const name of tierNames) perTierHits[name] = 0;
  return {
    hits: 0,
    misses: 0,
    promotions: 0,
    demotions: 0,
    perTierHits,
  };
}
