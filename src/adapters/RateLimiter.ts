/**
 * RateLimiter — in-memory token-bucket rate limiter for REST handlers.
 *
 * Classic token bucket: each `key` (client id / IP / API key) gets a
 * bucket holding up to `capacity` tokens; tokens refill at
 * `refillPerSecond`. Each `check(key)` consumes one token if available,
 * otherwise denies and reports when the next token will be available.
 *
 * Memory is bounded: a bucket idle for `bucketTtlMs` expires, and at most
 * `maxBuckets` buckets exist. When the cap is reached, the least recently
 * used bucket is evicted. An evicted bucket restarts full, so a very large
 * key population weakens the limit for the least active keys only.
 *
 * **Single-process scope.** State lives in this process. Each process (and
 * each host) keeps its own buckets, so N processes allow N times the rate.
 * Multi-process deployments need a shared backend (Redis, etc.).
 *
 * @module adapters/RateLimiter
 */

export interface RateLimiterConfig {
  /** Maximum tokens a bucket can hold. */
  capacity: number;
  /** Token refill rate. */
  refillPerSecond: number;
  /** Maximum number of buckets kept. Default 10 000. */
  maxBuckets?: number;
  /**
   * Idle time after which a bucket expires. Default: the time a bucket
   * needs to refill completely, and at least 60 seconds.
   */
  bucketTtlMs?: number;
}

/** Outcome of {@link RateLimiter.check} or {@link RateLimiter.peek}. */
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

/** Default maximum bucket count. */
export const DEFAULT_MAX_BUCKETS = 10_000;

/**
 * Token-bucket limiter with idle expiry and a hard bucket cap (LRU eviction).
 * State is per process.
 */
export class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxBuckets: number;
  private readonly bucketTtlMs: number;
  /** Insertion order is recency order: a touched bucket moves to the end. */
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
    const maxBuckets = config.maxBuckets ?? DEFAULT_MAX_BUCKETS;
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) {
      throw new RangeError(`RateLimiter: maxBuckets must be an integer ≥ 1; received ${maxBuckets}`);
    }
    const refillMs = config.refillPerSecond > 0
      ? (config.capacity / config.refillPerSecond) * 1000
      : Infinity;
    const bucketTtlMs = config.bucketTtlMs ?? Math.max(60_000, refillMs);
    if (Number.isNaN(bucketTtlMs) || bucketTtlMs < 0) {
      throw new RangeError(`RateLimiter: bucketTtlMs must be ≥ 0; received ${bucketTtlMs}`);
    }
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.maxBuckets = maxBuckets;
    this.bucketTtlMs = bucketTtlMs;
  }

  /**
   * Consume one token for `key`. Allowed when the (refilled) bucket has
   * at least one token; otherwise denied. Bucket creation is lazy on
   * first `check(key)`.
   */
  check(key: string): RateLimitVerdict {
    const now = Date.now();
    let bucket = this.refill(key, now);
    if (!bucket) {
      this.sweep(now);
      bucket = { tokens: this.capacity, lastRefillMs: now };
    }
    // Re-insert so the Map order tracks recency for LRU eviction.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);

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
   * Report whether `check(key)` would be allowed, without consuming a token
   * and without creating a bucket.
   */
  peek(key: string): RateLimitVerdict {
    const now = Date.now();
    const bucket = this.refill(key, now);
    if (!bucket) return { allowed: true, remaining: this.capacity };
    return bucket.tokens >= 1
      ? { allowed: true, remaining: Math.floor(bucket.tokens) }
      : { allowed: false, remaining: 0, resetAt: this.nextTokenIso(bucket, now) };
  }

  /**
   * Drop buckets that haven't been touched in the last `maxAgeMs`. Expiry
   * and the bucket cap already bound memory; this method stays for callers
   * that want a tighter age.
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

  /** Return the refilled live bucket for `key`, or `undefined` when absent or expired. */
  private refill(key: string, now: number): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (!bucket) return undefined;
    if (now - bucket.lastRefillMs >= this.bucketTtlMs) {
      this.buckets.delete(key);
      return undefined;
    }
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSecond);
    bucket.lastRefillMs = now;
    return bucket;
  }

  /** Before adding a bucket: drop expired buckets from the old end, then evict LRU to fit. */
  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefillMs < this.bucketTtlMs) break;
      this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string;
      this.buckets.delete(oldest);
    }
  }

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
