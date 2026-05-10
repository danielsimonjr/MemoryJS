/**
 * Cache Pressure Coordinator
 *
 * Centralised LRU pressure manager for caches across the codebase.
 * Each cache implementation registers itself by exposing two callbacks:
 *
 *   - `currentBytes()` — approximate memory cost right now.
 *   - `evict(targetBytes)` — drop entries until the cache is under the
 *     target. The implementation is free to use LRU, MRU, random, or
 *     any other policy — the coordinator only cares that the contract
 *     "after evict(t), currentBytes() <= t" holds.
 *
 * The coordinator polls registered caches via `MemoryMonitor` and
 * triggers proportional eviction when the global budget is exceeded.
 *
 * No-op when `MEMORY_CACHE_BUDGET_MB` is unset — falls back to the
 * existing per-cache `maxSize` behaviour.
 *
 * @module utils/CachePressureCoordinator
 */

/** A registered cache participating in coordinated eviction. */
export interface PressureAwareCache {
  /** Stable name for diagnostics. */
  name: string;
  /** Approximate live memory cost in bytes. */
  currentBytes(): number;
  /**
   * Drop entries until the cache is at or below `targetBytes`. May
   * over-shoot (drop more than necessary). Should NOT throw.
   */
  evict(targetBytes: number): void;
}

/** Read-only snapshot of coordinator state. */
export interface CachePressureSnapshot {
  enabled: boolean;
  budgetBytes: number;
  totalBytes: number;
  caches: Array<{ name: string; bytes: number; share: number }>;
}

/**
 * Budgets coordinated eviction across registered caches.
 *
 * Sizing comes from `MEMORY_CACHE_BUDGET_MB` (default: not set →
 * disabled). When enabled and the sum of registered caches exceeds the
 * budget, `evictIfOverBudget()` shrinks each cache proportionally to
 * its current share so a single hot cache doesn't crowd others out.
 */
export class CachePressureCoordinator {
  private caches: Map<string, PressureAwareCache> = new Map();
  private readonly budgetBytes: number;
  readonly enabled: boolean;

  constructor() {
    const raw = process.env.MEMORY_CACHE_BUDGET_MB;
    if (raw === undefined) {
      this.enabled = false;
      this.budgetBytes = 0;
      return;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.enabled = false;
      this.budgetBytes = 0;
      return;
    }
    this.enabled = true;
    this.budgetBytes = Math.floor(parsed * 1024 * 1024);
  }

  /**
   * Register a cache. The same `name` re-registers (replaces the
   * previous entry) — useful in tests where caches are recreated.
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
   * Sum of `currentBytes()` across registered caches. Cheap — used as
   * the trigger for proportional eviction.
   */
  totalBytes(): number {
    if (!this.enabled) return 0;
    let total = 0;
    for (const cache of this.caches.values()) total += cache.currentBytes();
    return total;
  }

  /**
   * If the total exceeds the budget, ask each cache to shrink to its
   * proportional share of the budget. Returns the number of caches
   * actually asked to evict (i.e. that had any bytes).
   */
  evictIfOverBudget(): number {
    if (!this.enabled || this.caches.size === 0) return 0;

    const total = this.totalBytes();
    if (total <= this.budgetBytes) return 0;

    let evicted = 0;
    for (const cache of this.caches.values()) {
      const cur = cache.currentBytes();
      if (cur === 0) continue;
      const share = cur / total;
      const target = Math.floor(this.budgetBytes * share);
      cache.evict(target);
      evicted++;
    }
    return evicted;
  }

  /** Diagnostic snapshot. */
  snapshot(): CachePressureSnapshot {
    const caches: CachePressureSnapshot['caches'] = [];
    let total = 0;
    for (const cache of this.caches.values()) {
      const bytes = cache.currentBytes();
      total += bytes;
      caches.push({ name: cache.name, bytes, share: 0 });
    }
    if (total > 0) for (const c of caches) c.share = c.bytes / total;
    return {
      enabled: this.enabled,
      budgetBytes: this.budgetBytes,
      totalBytes: total,
      caches,
    };
  }
}
