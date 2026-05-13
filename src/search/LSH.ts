/**
 * Locality-Sensitive Hashing (LSH)
 *
 * Phase 5 step 51 (§13.3) — random-hyperplane LSH for approximate
 * cosine-nearest-neighbor lookup. Trades exact accuracy for
 * sub-linear query time: instead of scoring every vector in the
 * corpus (`O(N · d)`), the index hashes each vector into a small set
 * of buckets, and a query only inspects vectors that share at least
 * one bucket.
 *
 * **No external deps.** ~150 LOC of TS. Designed to plug in front of
 * either the in-memory `VectorStore` or the `Node2Vec` embedding
 * output.
 *
 * **When to use:** corpora large enough that linear scan dominates
 * search latency (> ~10k vectors) and where ≤ 1–2% recall loss is
 * acceptable. Below that, just iterate.
 *
 * @module search/LSH
 * @experimental Hash-table format (`numTables`, `hyperplanesPerTable`)
 *   may evolve; existing instances stay queryable across point
 *   releases.
 */

/** Options for building an `LSHIndex`. */
export interface LSHOptions {
  /** Vector dimensionality. Must match every `add`/`query` vector. */
  dimensions: number;
  /**
   * Number of hash tables. More tables → higher recall, more memory.
   * Default: 8.
   */
  numTables?: number;
  /**
   * Bits per hash key (one random hyperplane per bit). Larger →
   * narrower buckets → fewer candidates per query, lower recall.
   * Default: 12.
   */
  hyperplanesPerTable?: number;
  /** Optional PRNG seed for reproducible hyperplane sampling. */
  seed?: number;
}

/** A single result row from `query`. */
export interface LSHResult {
  id: string;
  /** Cosine similarity, only computed for candidates that fell in a shared bucket. */
  score: number;
}

/**
 * Random-hyperplane LSH. Each hash table samples
 * `hyperplanesPerTable` random unit vectors; an input vector's bucket
 * in a table is the concatenated sign bits of its dot products with
 * those hyperplanes. Two vectors with high cosine similarity collide
 * in roughly the same buckets — that's the locality property.
 *
 * @example
 * ```typescript
 * const lsh = new LSHIndex({ dimensions: 64, numTables: 10, seed: 42 });
 * for (const [id, vec] of embeddings) lsh.add(id, vec);
 * const top = lsh.query(targetVec, 5);
 * ```
 */
export class LSHIndex {
  private readonly numTables: number;
  private readonly bits: number;
  private readonly dimensions: number;
  /** Hyperplanes[table][bit] is a Float32Array of length `dimensions`. */
  private readonly hyperplanes: Float32Array[][];
  /** Tables[table] is a bucket-name -> Set<id> map. */
  private readonly tables: Map<string, Set<string>>[];
  /** id -> stored vector (used for exact rescoring of candidates). */
  private readonly vectors: Map<string, Float32Array> = new Map();

  constructor(options: LSHOptions) {
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error(
        `LSHIndex: dimensions must be a positive integer, got ${options.dimensions}`,
      );
    }
    this.dimensions = options.dimensions;
    this.numTables = options.numTables ?? 8;
    // Cap bits at 63 — the bucket-key packing uses two signed 32-bit
    // halves and dropping bit 64+ would silently lose entropy and
    // produce key collisions for unrelated vectors.
    const requestedBits = options.hyperplanesPerTable ?? 12;
    if (!Number.isInteger(requestedBits) || requestedBits <= 0 || requestedBits > 63) {
      throw new Error(
        `LSHIndex: hyperplanesPerTable must be an integer in [1, 63], got ${requestedBits}`,
      );
    }
    this.bits = requestedBits;

    const rng = makeRng(options.seed);
    this.hyperplanes = [];
    this.tables = [];
    for (let t = 0; t < this.numTables; t++) {
      const planes: Float32Array[] = [];
      for (let b = 0; b < this.bits; b++) {
        planes.push(gaussianVector(this.dimensions, rng));
      }
      this.hyperplanes.push(planes);
      this.tables.push(new Map());
    }
  }

  /** Insert a vector into the index. Idempotent on `id`. */
  add(id: string, vector: Float32Array): void {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `LSHIndex.add: vector for '${id}' has length ${vector.length}, expected ${this.dimensions}`,
      );
    }
    // Replace prior entry for the same id — covers re-embedding flows.
    if (this.vectors.has(id)) this.remove(id);
    this.vectors.set(id, vector);
    for (let t = 0; t < this.numTables; t++) {
      const key = this.bucketKey(t, vector);
      let bucket = this.tables[t]!.get(key);
      if (!bucket) {
        bucket = new Set();
        this.tables[t]!.set(key, bucket);
      }
      bucket.add(id);
    }
  }

  /** Remove a vector by id. No-op if absent. */
  remove(id: string): void {
    const vec = this.vectors.get(id);
    if (!vec) return;
    for (let t = 0; t < this.numTables; t++) {
      const key = this.bucketKey(t, vec);
      const bucket = this.tables[t]!.get(key);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) this.tables[t]!.delete(key);
      }
    }
    this.vectors.delete(id);
  }

  /**
   * Return the top-K most similar stored vectors to `vector` by
   * cosine similarity. Only candidates that landed in at least one
   * shared bucket are rescored — that's where the speed-up comes
   * from. Recall < 1.0 is expected; tune `numTables` /
   * `hyperplanesPerTable` to trade recall against speed.
   */
  query(vector: Float32Array, k = 10): LSHResult[] {
    if (vector.length !== this.dimensions) {
      throw new Error(
        `LSHIndex.query: vector has length ${vector.length}, expected ${this.dimensions}`,
      );
    }
    const candidates = new Set<string>();
    for (let t = 0; t < this.numTables; t++) {
      const key = this.bucketKey(t, vector);
      const bucket = this.tables[t]!.get(key);
      if (!bucket) continue;
      for (const id of bucket) candidates.add(id);
    }

    const normTarget = l2Norm(vector);
    const results: LSHResult[] = [];
    for (const id of candidates) {
      const v = this.vectors.get(id);
      if (!v) continue;
      const dot = dotProduct(vector, v);
      const denom = normTarget * l2Norm(v);
      const score = denom === 0 ? 0 : dot / denom;
      results.push({ id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  /** Number of vectors in the index. */
  size(): number {
    return this.vectors.size;
  }

  /** Diagnostic snapshot — bucket counts per table. */
  bucketStats(): Array<{ table: number; buckets: number; avgBucketSize: number }> {
    return this.tables.map((table, t) => {
      const buckets = table.size;
      let total = 0;
      for (const bucket of table.values()) total += bucket.size;
      return {
        table: t,
        buckets,
        avgBucketSize: buckets === 0 ? 0 : total / buckets,
      };
    });
  }

  private bucketKey(tableIdx: number, vector: Float32Array): string {
    const planes = this.hyperplanes[tableIdx]!;
    // Encode bits as packed hex — cheaper than building a binary
    // string for every bucket lookup. `>>> 0` coerces to unsigned so
    // toString(16) never produces the leading-minus form (which would
    // be internally consistent but harder to reason about during
    // diagnostics).
    let high = 0;
    let low = 0;
    for (let b = 0; b < this.bits; b++) {
      const sign = dotProduct(planes[b]!, vector) >= 0 ? 1 : 0;
      if (b < 32) low |= sign << b;
      else high |= sign << (b - 32);
    }
    return `${(high >>> 0).toString(16)}_${(low >>> 0).toString(16)}`;
  }
}

// ==================== Math helpers ====================

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function l2Norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

/**
 * Sample a vector with each component drawn from a standard normal
 * via the Box-Muller transform. Using a Gaussian (vs uniform) is
 * standard for random-hyperplane LSH because it preserves rotational
 * invariance — bucket collision probability depends only on the
 * angle between vectors.
 */
function gaussianVector(dim: number, rng: () => number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    // Box-Muller for an N(0,1) sample.
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    v[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return v;
}

function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let s = seed >>> 0;
  return function mulberry32(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
