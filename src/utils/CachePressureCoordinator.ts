/**
 * Cache Pressure Coordinator
 *
 * Centralised pressure manager for caches across the codebase.
 * Each cache implementation registers itself by exposing two callbacks:
 *
 *   - `currentEntries()` — entry count right now.
 *   - `evictTo(targetEntries)` — drop entries until the cache is at or
 *     under the target. Implementations are free to use LRU, MRU,
 *     random, or any other policy — the coordinator only cares that
 *     after `evictTo(t)`, `currentEntries() <= t` holds.
 *
 * Entry-counts (not bytes) are the contract because the existing caches
 * (`EmbeddingCache`, `QueryPlanCache`, `SearchCache`) track entry counts
 * via their `maxSize` config; per-entry byte estimates would require
 * sizeof bookkeeping none of them currently have.
 *
 * No-op when `MEMORY_CACHE_BUDGET_ENTRIES` is unset — falls back to the
 * existing per-cache `maxSize` behaviour.
 *
 * @module utils/CachePressureCoordinator
 */

/** A registered cache participating in coordinated eviction. */
export interface PressureAwareCache {
  /** Stable name for diagnostics. */
  name: string;
  /** Live entry count. */
  currentEntries(): number;
  /**
   * Drop entries until the cache is at or below `targetEntries`. May
   * over-shoot. Should NOT throw.
   */
  evictTo(targetEntries: number): void;
}

/** Read-only snapshot of coordinator state. */
export interface CachePressureSnapshot {
  enabled: boolean;
  budgetEntries: number;
  totalEntries: number;
  caches: Array<{ name: string; entries: number; share: number }>;
}

/**
 * Coordinates eviction across registered caches when the global entry
 * budget is exceeded.
 *
 * Sizing comes from `MEMORY_CACHE_BUDGET_ENTRIES` (default: not set →
 * disabled). When enabled and the total entries across registered
 * caches exceeds the budget, `evictIfOverBudget()` shrinks each cache
 * proportionally to its current share so a single hot cache doesn't
 * crowd others out. Caches with proportional targets that round to
 * zero get a configurable floor (`minRetentionEntries`, default 16) so
 * a small minority cache is not starved entirely.
 */
export class CachePressureCoordinator {
  private caches: Map<string, PressureAwareCache> = new Map();
  private readonly budgetEntries: number;
  private readonly minRetentionEntries: number;
  readonly enabled: boolean;

  constructor(options: { minRetentionEntries?: number } = {}) {
    this.minRetentionEntries = options.minRetentionEntries ?? 16;

    const raw = process.env.MEMORY_CACHE_BUDGET_ENTRIES;
    if (raw === undefined) {
      this.enabled = false;
      this.budgetEntries = 0;
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.enabled = false;
      this.budgetEntries = 0;
      return;
    }
    this.enabled = true;
    this.budgetEntries = parsed;
  }

  /**
   * Register a cache. Re-registering the same `name` replaces the
   * previous entry — useful in tests where caches are recreated.
   * No-op when the coordinator is disabled.
   */
  register(cache: PressureAwareCache): void {
    if (!this.enabled) return;
    this.caches.set(cache.name, cache);
  }

  /** Drop a registered cache. */
  unregister(name: string): void {
    this.caches.delete(name);
  }

  /**
   * Sum of `currentEntries()` across registered caches. Cheap — used as
   * the trigger for proportional eviction.
   */
  totalEntries(): number {
    if (!this.enabled) return 0;
    let total = 0;
    for (const cache of this.caches.values()) total += cache.currentEntries();
    return total;
  }

  /**
   * If the total exceeds the budget, ask each cache to shrink to its
   * proportional share of the budget (with a floor). Returns the number
   * of caches actually asked to evict (i.e. that had any entries).
   */
  evictIfOverBudget(): number {
    if (!this.enabled || this.caches.size === 0) return 0;

    const total = this.totalEntries();
    if (total <= this.budgetEntries) return 0;

    let evicted = 0;
    for (const cache of this.caches.values()) {
      const cur = cache.currentEntries();
      if (cur === 0) continue;
      const share = cur / total;
      // Floor applied to prevent a small-share cache being starved to
      // zero when many caches contend for the budget.
      const target = Math.max(
        this.minRetentionEntries,
        Math.floor(this.budgetEntries * share),
      );
      // No work if this cache is already under its target.
      if (cur <= target) continue;
      cache.evictTo(target);
      evicted++;
    }
    return evicted;
  }

  /** Diagnostic snapshot. */
  snapshot(): CachePressureSnapshot {
    const caches: CachePressureSnapshot['caches'] = [];
    let total = 0;
    for (const cache of this.caches.values()) {
      const entries = cache.currentEntries();
      total += entries;
      caches.push({ name: cache.name, entries, share: 0 });
    }
    if (total > 0) for (const c of caches) c.share = c.entries / total;
    return {
      enabled: this.enabled,
      budgetEntries: this.budgetEntries,
      totalEntries: total,
      caches,
    };
  }
}
