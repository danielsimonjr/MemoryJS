/** Opt-in approximate cosine search using multi-probe random-hyperplane LSH. */
import type { IVectorStore, VectorSearchResult } from '../types/index.js';
import { cosineSimilarity } from '../utils/textSimilarity.js';
import { BoundedTopK } from '../utils/boundedTopK.js';

/** Tuning controls for opt-in approximate angular nearest-neighbor retrieval. */
export interface LSHVectorStoreOptions {
  /** Independent hash tables (default 12). More tables improve recall at a memory cost. */
  tables?: number;
  /** Hyperplanes per table, 1..20 (default 8). More bits reduce candidate counts. */
  bits?: number;
  /** Also probe each one-bit neighbour bucket (default true). */
  multiProbe?: boolean;
  /** Use exact search at or below this corpus size (default 256). */
  exactThreshold?: number;
  /** Deterministic projection seed (default 42). */
  seed?: number;
}
interface Entry { vector: number[]; order: number; hash?: string; keys: number[] }
interface DimensionIndex { planes: number[][][]; buckets: Array<Map<number, Set<string>>> }

/**
 * Approximate retrieval with exact cosine reranking of candidates. Small corpora
 * and queries with fewer than k candidates use an exact fallback. Recall is not
 * guaranteed: choose tables/bits using a representative recall@k benchmark.
 * Vectors are copied on add/get so caller mutation cannot corrupt bucket keys.
 */
export class LSHVectorStore implements IVectorStore {
  private entries = new Map<string, Entry>();
  private dimensions = new Map<number, DimensionIndex>();
  private nextOrder = 0;
  private readonly tables: number;
  private readonly bits: number;
  private readonly multiProbe: boolean;
  private readonly exactThreshold: number;
  private readonly seed: number;
  private lastCandidates = 0;

  /** Create a store; throws RangeError for invalid integer tuning options. */
  constructor(options: LSHVectorStoreOptions = {}) {
    this.tables = boundedInteger(options.tables ?? 12, 1, 128, 'tables');
    this.bits = boundedInteger(options.bits ?? 8, 1, 20, 'bits');
    this.exactThreshold = boundedInteger(options.exactThreshold ?? 256, 0, Number.MAX_SAFE_INTEGER, 'exactThreshold');
    this.multiProbe = options.multiProbe ?? true;
    this.seed = boundedInteger(options.seed ?? 42, 0, 0xffffffff, 'seed');
  }

  /** Insert or replace a copied vector and its optional source-content hash. */
  add(name: string, vector: number[], contentHash?: string): void {
    validateVector(vector);
    const copy = [...vector];
    const order = this.entries.get(name)?.order ?? this.nextOrder++;
    this.remove(name);
    const index = this.indexFor(vector.length);
    const keys = index.planes.map(planes => signature(copy, planes));
    this.entries.set(name, { vector: copy, order, hash: contentHash, keys });
    keys.forEach((key, table) => {
      let bucket = index.buckets[table].get(key);
      if (!bucket) index.buckets[table].set(key, bucket = new Set());
      bucket.add(name);
    });
  }

  /** Retrieve up to k candidates, reranked by exact cosine; ties use insertion order. */
  search(query: number[], k: number): VectorSearchResult[] {
    this.lastCandidates = 0;
    if (k <= 0 || Number.isNaN(k) || this.entries.size === 0) return [];
    validateVector(query);
    const limit = Number.isFinite(k) ? Math.min(this.entries.size, Math.floor(k)) : this.entries.size;
    if (limit === 0) return [];
    const index = this.dimensions.get(query.length);
    if (!index) return [];
    const names = new Set<string>();
    const exact = this.entries.size <= this.exactThreshold;
    if (!exact) {
      index.planes.forEach((planes, table) => {
        const key = signature(query, planes);
        const collect = (bucketKey: number): void => {
          for (const name of index.buckets[table].get(bucketKey) ?? []) names.add(name);
        };
        collect(key);
        if (this.multiProbe) for (let bit = 0; bit < this.bits; bit++) collect(key ^ (1 << bit));
      });
    }
    const candidates = exact || names.size < limit ? this.entries.keys() : names.values();
    const scored = new BoundedTopK<VectorSearchResult & { order: number }>(limit,
      (a, b) => b.score - a.score || a.order - b.order);
    for (const name of candidates) {
      const entry = this.entries.get(name)!;
      if (entry.vector.length !== query.length) continue;
      this.lastCandidates++;
      scored.add({ name, score: cosineSimilarity(query, entry.vector), order: entry.order });
    }
    return scored.sorted().map(({ name, score }) => ({ name, score }));
  }

  /** Remove a vector and every hash-table membership, returning whether it existed. */
  remove(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    const index = this.dimensions.get(entry.vector.length)!;
    entry.keys.forEach((key, table) => {
      const bucket = index.buckets[table].get(key)!;
      bucket.delete(name);
      if (bucket.size === 0) index.buckets[table].delete(key);
    });
    if (index.buckets.every(table => table.size === 0)) this.dimensions.delete(entry.vector.length);
    return this.entries.delete(name);
  }
  /** Number of stored vectors. */
  size(): number { return this.entries.size; }
  /** Whether the named vector exists. */
  has(name: string): boolean { return this.entries.has(name); }
  /** Return a defensive copy of the named vector. */
  get(name: string): number[] | undefined { return this.entries.get(name)?.vector.slice(); }
  /** Return the optional source-content hash last supplied on add. */
  getContentHash(name: string): string | undefined { return this.entries.get(name)?.hash; }
  /** Remove every vector and projection index. */
  clear(): void { this.entries.clear(); this.dimensions.clear(); this.nextOrder = 0; this.lastCandidates = 0; }
  /** Number of exact cosine evaluations in the most recent search. */
  getLastCandidateCount(): number { return this.lastCandidates; }

  private indexFor(dimension: number): DimensionIndex {
    let index = this.dimensions.get(dimension);
    if (index) return index;
    let state = (this.seed ^ Math.imul(dimension, 2654435761)) >>> 0;
    const random = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let x = Math.imul(state ^ (state >>> 15), 1 | state);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    // Gaussian normals give rotationally invariant angular hash collisions.
    const gaussian = (): number => Math.sqrt(-2 * Math.log(Math.max(random(), Number.MIN_VALUE))) * Math.cos(2 * Math.PI * random());
    index = {
      planes: Array.from({ length: this.tables }, () => Array.from({ length: this.bits }, () => Array.from({ length: dimension }, gaussian))),
      buckets: Array.from({ length: this.tables }, () => new Map()),
    };
    this.dimensions.set(dimension, index);
    return index;
  }
}
function signature(vector: number[], planes: number[][]): number {
  let key = 0;
  planes.forEach((plane, bit) => {
    let dot = 0;
    for (let i = 0; i < vector.length; i++) dot += vector[i] * plane[i];
    if (dot >= 0) key |= 1 << bit;
  });
  return key;
}
function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  return value;
}
function validateVector(vector: number[]): void {
  if (vector.length === 0 || !vector.every(Number.isFinite)) throw new RangeError('Vectors must be nonempty and finite');
}
