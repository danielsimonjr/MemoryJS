import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../../../src/adapters/RateLimiter.js';

describe('RateLimiter bounds', () => {
  afterEach(() => vi.useRealTimers());

  it('caps the bucket count by evicting the least recently used bucket', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0, maxBuckets: 2 });
    rl.check('a');
    rl.check('b');
    rl.check('a'); // touch a, so b is least recent
    rl.check('c');
    expect(rl.size()).toBe(2);
    // b was evicted: it gets a fresh bucket; a is still exhausted.
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(true);
  });

  it('expires idle buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0, bucketTtlMs: 1000 });
    rl.check('a');
    rl.check('b');
    expect(rl.check('a').allowed).toBe(false);
    vi.setSystemTime(1500);
    expect(rl.check('a').allowed).toBe(true);
    // Expired buckets are swept when others are touched.
    expect(rl.size()).toBe(1);
  });

  it('peek does not refresh a bucket, so expiry order stays consistent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0, bucketTtlMs: 1000 });
    rl.check('a');
    vi.setSystemTime(500);
    rl.check('b');
    vi.setSystemTime(900);
    rl.peek('a');
    vi.setSystemTime(1600);
    rl.check('c');
    // a (idle since 0) and b (idle since 500) are both expired and swept.
    expect(rl.size()).toBe(1);
  });

  it('peek and consume do not create buckets for unseen keys', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0 });
    expect(rl.peek('x').allowed).toBe(true);
    expect(rl.size()).toBe(0);
  });

  it('has a finite default bucket cap and validates options', () => {
    expect(() => new RateLimiter({ capacity: 1, refillPerSecond: 0, maxBuckets: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ capacity: 1, refillPerSecond: 0, bucketTtlMs: -1 })).toThrow(RangeError);
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 0 });
    for (let i = 0; i < 10_050; i++) rl.check(String(i));
    expect(rl.size()).toBe(10_000);
  });
});
