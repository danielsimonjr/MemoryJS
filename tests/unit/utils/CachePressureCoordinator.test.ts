/**
 * CachePressureCoordinator Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CachePressureCoordinator, type PressureAwareCache } from '../../../src/utils/CachePressureCoordinator.js';

class FakeCache implements PressureAwareCache {
  constructor(public name: string, public entries: number) {}
  currentEntries(): number {
    return this.entries;
  }
  evictTo(target: number): void {
    if (this.entries > target) this.entries = target;
  }
}

describe('CachePressureCoordinator', () => {
  const ORIGINAL = process.env.MEMORY_CACHE_BUDGET_ENTRIES;

  beforeEach(() => {
    delete process.env.MEMORY_CACHE_BUDGET_ENTRIES;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MEMORY_CACHE_BUDGET_ENTRIES;
    else process.env.MEMORY_CACHE_BUDGET_ENTRIES = ORIGINAL;
  });

  it('is disabled when MEMORY_CACHE_BUDGET_ENTRIES is unset', () => {
    const c = new CachePressureCoordinator();
    expect(c.enabled).toBe(false);
    c.register(new FakeCache('a', 100));
    expect(c.evictIfOverBudget()).toBe(0);
  });

  it('register/unregister honoured when enabled', () => {
    process.env.MEMORY_CACHE_BUDGET_ENTRIES = '1000';
    const c = new CachePressureCoordinator();
    expect(c.enabled).toBe(true);
    c.register(new FakeCache('a', 100));
    c.register(new FakeCache('b', 50));
    expect(c.totalEntries()).toBe(150);
    c.unregister('a');
    expect(c.totalEntries()).toBe(50);
  });

  it('does not evict when total <= budget', () => {
    process.env.MEMORY_CACHE_BUDGET_ENTRIES = '1000';
    const c = new CachePressureCoordinator();
    const ca = new FakeCache('a', 400);
    const cb = new FakeCache('b', 400);
    c.register(ca);
    c.register(cb);
    expect(c.evictIfOverBudget()).toBe(0);
    expect(ca.entries).toBe(400);
    expect(cb.entries).toBe(400);
  });

  it('evicts proportionally when total exceeds budget', () => {
    process.env.MEMORY_CACHE_BUDGET_ENTRIES = '600';
    const c = new CachePressureCoordinator();
    const ca = new FakeCache('a', 600); // share 0.6
    const cb = new FakeCache('b', 400); // share 0.4
    c.register(ca);
    c.register(cb);
    const evicted = c.evictIfOverBudget();
    expect(evicted).toBe(2);
    // Total dropped to ~budget. Allow proportional + floor accuracy.
    expect(ca.entries + cb.entries).toBeLessThanOrEqual(600);
    // Larger share keeps a larger absolute target.
    expect(ca.entries).toBeGreaterThanOrEqual(cb.entries);
  });

  it('respects the minRetentionEntries floor for tiny shares', () => {
    process.env.MEMORY_CACHE_BUDGET_ENTRIES = '100';
    const c = new CachePressureCoordinator({ minRetentionEntries: 10 });
    const big = new FakeCache('big', 9990); // share ~99.9%
    const tiny = new FakeCache('tiny', 10); // share ~0.1%
    c.register(big);
    c.register(tiny);
    c.evictIfOverBudget();
    // Tiny would round to 0 without the floor; should keep at least 10.
    expect(tiny.entries).toBeGreaterThanOrEqual(10);
  });

  it('snapshot returns enabled flag, budget, and per-cache shares', () => {
    process.env.MEMORY_CACHE_BUDGET_ENTRIES = '500';
    const c = new CachePressureCoordinator();
    c.register(new FakeCache('a', 100));
    c.register(new FakeCache('b', 100));
    const snap = c.snapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.budgetEntries).toBe(500);
    expect(snap.totalEntries).toBe(200);
    expect(snap.caches).toHaveLength(2);
    expect(snap.caches[0]!.share).toBeCloseTo(0.5, 5);
  });
});
