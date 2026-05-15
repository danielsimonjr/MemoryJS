/**
 * RateLimiter — in-memory token-bucket rate limiter for REST handlers.
 *
 * Classic token bucket: each `key` (client id / IP / API key) gets a
 * bucket holding up to `capacity` tokens; tokens refill at
 * `refillPerSecond`. Each `check(key)` consumes one token if available,
 * otherwise denies and reports when the next token will be available.
 *
 * Designed for single-process deployments. Multi-process / multi-host
 * deployments need a shared backend (Redis, etc.); this class is the
 * v1 in-memory fallback that fits MemoryJS's "minimal deps" stance.
 *
 * @module adapters/RateLimiter
 */

export interface RateLimiterConfig {
  /** Maximum tokens a bucket can hold. */
  capacity: number;
  /** Token refill rate. */
  refillPerSecond: number;
}

export interface RateLimitVerdict {
  /** Whether the request is allowed (a token was consumed). */
  allowed: boolean;
  /** Tokens remaining in the bucket after this check. */
  remaining: number;
  /**
   * ISO timestamp when the next token becomes available. Only set when
   * the bucket is empty (i.e. `allowed === false` or `remaining === 0`).
   */
  resetAt?: string;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly buckets: Map<string, Bucket> = new Map();

  constructor(config: RateLimiterConfig) {
    if (!Number.isFinite(config.capacity) || config.capacity < 1) {
      throw new RangeError(`RateLimiter: capacity must be ≥ 1; received ${config.capacity}`);
    }
    if (!Number.isFinite(config.refillPerSecond) || config.refillPerSecond < 0) {
      throw new RangeError(
        `RateLimiter: refillPerSecond must be ≥ 0; received ${config.refillPerSecond}`,
      );
    }
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
  }

  /**
   * Consume one token for `key`. Allowed when the (refilled) bucket has
   * at least one token; otherwise denied. Bucket creation is lazy on
   * first `check(key)`.
   */
  check(key: string): RateLimitVerdict {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    } else {
      // Refill since last touch — capped at capacity.
      const elapsedSec = (now - bucket.lastRefillMs) / 1000;
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + elapsedSec * this.refillPerSecond,
      );
      bucket.lastRefillMs = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      const remaining = Math.floor(bucket.tokens);
      return remaining === 0
        ? { allowed: true, remaining, resetAt: this.nextTokenIso(bucket, now) }
        : { allowed: true, remaining };
    }
    return {
      allowed: false,
      remaining: 0,
      resetAt: this.nextTokenIso(bucket, now),
    };
  }

  /**
   * Drop buckets that haven't been touched in the last `maxAgeMs`. Call
   * periodically (e.g. once per minute) when running long-lived to avoid
   * unbounded growth in `buckets`.
   */
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefillMs < cutoff) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Current bucket count — mostly for diagnostics / tests. */
  size(): number {
    return this.buckets.size;
  }

  // ==================== Internal ====================

  private nextTokenIso(bucket: Bucket, nowMs: number): string {
    if (this.refillPerSecond === 0) {
      // Pathological: no refill configured. Surface as far-future.
      return new Date(nowMs + 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    const tokensNeeded = Math.max(0, 1 - bucket.tokens);
    const msUntilToken = (tokensNeeded / this.refillPerSecond) * 1000;
    return new Date(nowMs + Math.ceil(msUntilToken)).toISOString();
  }
}
