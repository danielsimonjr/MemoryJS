/**
 * LRUHotTier tests
 *
 * Phase 9 task 70 — LRU semantics, maxEntries + maxBytes bounds,
 * onEvict callback, eviction counter, custom byte estimator, default
 * estimator robustness against circular structures.
 */

import { describe, it, expect, vi } from 'vitest';
import { LRUHotTier } from '../../../../src/search/tiered/LRUHotTier.js';

describe('LRUHotTier — basic round-trip', () => {
  it('round-trips put + get', async () => {
    const tier = new LRUHotTier<string, number>();
    await tier.put('alice', 42);
    expect(await tier.get('alice')).toBe(42);
  });

  it('get returns undefined for absent keys', async () => {
    const tier = new LRUHotTier<string, number>();
    expect(await tier.get('ghost')).toBeUndefined();
  });

  it('put replaces prior value', async () => {
    const tier = new LRUHotTier<string, number>();
    await tier.put('alice', 1);
    await tier.put('alice', 2);
    expect(await tier.get('alice')).toBe(2);
    expect(await tier.size()).toBe(1);
  });

  it('delete returns true when something was removed', async () => {
    const tier = new LRUHotTier<string, number>();
    await tier.put('alice', 1);
    expect(await tier.delete('alice')).toBe(true);
    expect(await tier.delete('alice')).toBe(false);
  });

  it('has reflects presence', async () => {
    const tier = new LRUHotTier<string, number>();
    expect(await tier.has('alice')).toBe(false);
    await tier.put('alice', 0);
    expect(await tier.has('alice')).toBe(true);
  });

  it('size counts entries', async () => {
    const tier = new LRUHotTier<string, number>();
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(await tier.size()).toBe(2);
    await tier.delete('a');
    expect(await tier.size()).toBe(1);
  });

  it('clear drops every entry', async () => {
    const tier = new LRUHotTier<string, number>();
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.clear();
    expect(await tier.size()).toBe(0);
    expect(tier.approximateBytes()).toBe(0);
  });
});

describe('LRUHotTier — name', () => {
  it('exposes a stable name for diagnostics', () => {
    expect(new LRUHotTier<string, number>().name).toBe('hot');
    expect(new LRUHotTier<string, number>({ name: 'custom' }).name).toBe('custom');
  });
});

describe('LRUHotTier — LRU ordering', () => {
  it('evicts least-recently-used entry when maxEntries is exceeded', async () => {
    const tier = new LRUHotTier<string, number>({ maxEntries: 2 });
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.put('c', 3);
    expect(await tier.has('a')).toBe(false);
    expect(await tier.has('b')).toBe(true);
    expect(await tier.has('c')).toBe(true);
    expect(await tier.size()).toBe(2);
  });

  it('get-hit promotes entry to most-recently-used, sparing it from next eviction', async () => {
    const tier = new LRUHotTier<string, number>({ maxEntries: 2 });
    await tier.put('a', 1);
    await tier.put('b', 2);
    // Promote 'a' so 'b' becomes LRU.
    await tier.get('a');
    await tier.put('c', 3);
    expect(await tier.has('a')).toBe(true);
    expect(await tier.has('b')).toBe(false);
    expect(await tier.has('c')).toBe(true);
  });

  it('put on existing key promotes it to most-recently-used', async () => {
    const tier = new LRUHotTier<string, number>({ maxEntries: 2 });
    await tier.put('a', 1);
    await tier.put('b', 2);
    // Re-put 'a' so 'b' becomes LRU.
    await tier.put('a', 11);
    await tier.put('c', 3);
    expect(await tier.has('a')).toBe(true);
    expect(await tier.get('a')).toBe(11);
    expect(await tier.has('b')).toBe(false);
    expect(await tier.has('c')).toBe(true);
  });
});

describe('LRUHotTier — onEvict callback', () => {
  it('fires onEvict with the correct (key, value) for each eviction', async () => {
    const evicted: Array<[string, number]> = [];
    const tier = new LRUHotTier<string, number>({
      maxEntries: 2,
      onEvict: (k, v) => evicted.push([k, v]),
    });
    await tier.put('a', 1);
    await tier.put('b', 2);
    await tier.put('c', 3); // evicts 'a'
    await tier.put('d', 4); // evicts 'b'
    expect(evicted).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('does not fire onEvict when below bounds', async () => {
    const onEvict = vi.fn();
    const tier = new LRUHotTier<string, number>({ maxEntries: 5, onEvict });
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(onEvict).not.toHaveBeenCalled();
  });
});

describe('LRUHotTier — eviction count', () => {
  it('getEvictionCount increments with each eviction', async () => {
    const tier = new LRUHotTier<string, number>({ maxEntries: 2 });
    expect(tier.getEvictionCount()).toBe(0);
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(tier.getEvictionCount()).toBe(0);
    await tier.put('c', 3);
    expect(tier.getEvictionCount()).toBe(1);
    await tier.put('d', 4);
    expect(tier.getEvictionCount()).toBe(2);
  });
});

describe('LRUHotTier — maxBytes bound', () => {
  it('evicts to stay under maxBytes even when entry count is below maxEntries', async () => {
    // Each char ≈ 2 bytes; "x".repeat(50) + key overhead → ~110+ bytes per entry.
    const big = 'x'.repeat(50);
    const onEvict = vi.fn();
    const tier = new LRUHotTier<string, string>({
      maxEntries: 1000,
      maxBytes: 300,
      onEvict,
    });
    await tier.put('a', big);
    await tier.put('b', big);
    await tier.put('c', big);
    expect(tier.approximateBytes()).toBeLessThanOrEqual(300);
    expect(onEvict).toHaveBeenCalled();
    expect(await tier.has('a')).toBe(false);
  });

  it('respects maxBytes with a custom estimator', async () => {
    const onEvict = vi.fn();
    const tier = new LRUHotTier<string, number>({
      maxEntries: 1000,
      maxBytes: 200,
      estimateBytes: () => 100,
      onEvict,
    });
    await tier.put('a', 1);
    await tier.put('b', 2);
    expect(tier.approximateBytes()).toBe(200);
    expect(onEvict).not.toHaveBeenCalled();
    await tier.put('c', 3);
    // Bound is 200 and each entry is 100, so after putting 'c' (bytes=300) we
    // evict 'a' → bytes=200, exactly at the bound.
    expect(tier.approximateBytes()).toBe(200);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(await tier.has('a')).toBe(false);
  });
});

describe('LRUHotTier — approximateBytes', () => {
  it('decreases after delete', async () => {
    const tier = new LRUHotTier<string, string>();
    await tier.put('a', 'hello');
    const before = tier.approximateBytes();
    expect(before).toBeGreaterThan(0);
    await tier.delete('a');
    expect(tier.approximateBytes()).toBe(0);
    expect(tier.approximateBytes()).toBeLessThan(before);
  });

  it('subtracts the prior estimate when put replaces an existing key', async () => {
    const tier = new LRUHotTier<string, string>();
    await tier.put('a', 'short');
    const smallBytes = tier.approximateBytes();
    await tier.put('a', 'this is a much longer string than the prior value');
    const largeBytes = tier.approximateBytes();
    expect(largeBytes).toBeGreaterThan(smallBytes);
    expect(await tier.size()).toBe(1);
  });
});

describe('LRUHotTier — estimateBytes callback', () => {
  it('calls the custom estimator with (key, value)', async () => {
    const estimator = vi.fn((_k: string, v: number) => v * 10);
    const tier = new LRUHotTier<string, number>({ estimateBytes: estimator });
    await tier.put('a', 5);
    await tier.put('b', 7);
    expect(estimator).toHaveBeenCalledTimes(2);
    expect(estimator).toHaveBeenCalledWith('a', 5);
    expect(estimator).toHaveBeenCalledWith('b', 7);
    expect(tier.approximateBytes()).toBe(50 + 70);
  });
});

describe('LRUHotTier — default estimator robustness', () => {
  it('handles circular structures without throwing', async () => {
    interface Node { name: string; self?: Node }
    const node: Node = { name: 'cycle' };
    node.self = node;
    const tier = new LRUHotTier<string, Node>();
    await expect(tier.put('cycle', node)).resolves.not.toThrow();
    expect(await tier.size()).toBe(1);
    expect(tier.approximateBytes()).toBeGreaterThan(0);
  });
});
