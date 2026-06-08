/**
 * RateLimiter — token-bucket rate limiter for REST handlers.
 *
 * Covers:
 * - first request under capacity → allowed
 * - exhausted bucket → denied, remaining=0
 * - tokens refill over time at the configured rate
 * - distinct keys have independent buckets
 * - resetAt advances correctly
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/adapters/RateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to `capacity` requests in the first window', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(false);
  });

  it('reports remaining tokens', () => {
    const rl = new RateLimiter({ capacity: 5, refillPerSecond: 1 });
    expect(rl.check('client-A').remaining).toBe(4);
    expect(rl.check('client-A').remaining).toBe(3);
  });

  it('refills tokens at the configured rate', () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 1 });
    rl.check('client-A');
    rl.check('client-A');
    expect(rl.check('client-A').allowed).toBe(false); // exhausted

    vi.advanceTimersByTime(1000); // 1 second → +1 token
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(false); // exhausted again

    vi.advanceTimersByTime(2000); // 2 seconds → +2 tokens (capped at capacity)
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(false);
  });

  it('caps refill at capacity', () => {
    const rl = new RateLimiter({ capacity: 2, refillPerSecond: 10 });
    rl.check('client-A');
    rl.check('client-A');
    vi.advanceTimersByTime(60_000); // way more refill than capacity allows
    // Bucket should not exceed 2.
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(false);
  });

  it('keeps independent buckets per key', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(rl.check('client-A').allowed).toBe(true);
    expect(rl.check('client-A').allowed).toBe(false);
    expect(rl.check('client-B').allowed).toBe(true);
  });

  it('reports resetAt as ISO timestamp when bucket is empty', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    rl.check('client-A'); // first consumes
    const denied = rl.check('client-A');
    expect(denied.allowed).toBe(false);
    expect(denied.resetAt).toBeDefined();
    expect(new Date(denied.resetAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('purges stale buckets via prune()', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    rl.check('client-A');
    rl.check('client-B');
    expect(rl.size()).toBe(2);
    vi.advanceTimersByTime(60_000);
    rl.prune(30_000); // anything not touched in last 30s
    expect(rl.size()).toBe(0);
  });
});
