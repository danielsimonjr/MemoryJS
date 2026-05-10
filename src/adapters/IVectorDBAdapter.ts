/**
 * Vector Database Adapter Interface
 *
 * Phase 4 step 48 (§13.1) — adapter interface for offloading semantic
 * search to a real vector database (Weaviate, Pinecone, Qdrant,
 * pgvector). The bundled `InMemoryVectorStore` and `SQLiteVectorStore`
 * stay the defaults; this adapter is the bridge for callers who need
 * to scale beyond a single process or share embeddings across
 * services.
 *
 * **No external deps.** This module ships only the interface and a
 * test-only `InMemoryVectorAdapter`. Concrete adapters live in
 * companion packages.
 *
 * @module adapters/IVectorDBAdapter
 */

/** A single embedding upsert operation. */
export interface VectorUpsert {
  /** Stable id (typically an entity name). */
  id: string;
  /** Embedding vector. */
  vector: number[];
  /** Optional payload to filter on at query time. */
  metadata?: Record<string, unknown>;
}

/** Filter expression for `query` calls. Backend-specific in general; the
 * common case is exact-equality on `metadata.field`. */
export type VectorQueryFilter = Record<string, unknown>;

/** A single match returned by `query`. */
export interface VectorMatch {
  id: string;
  /** Similarity score in `[0, 1]` (cosine) or distance (depends on the
   * adapter — implementations document their semantics). */
  score: number;
  /** Echo of `metadata` from the upsert. */
  metadata?: Record<string, unknown>;
}

/** Snapshot of adapter state for diagnostics. */
export interface VectorAdapterStats {
  vectorCount: number;
  dimensions: number | null;
  approxBytes?: number;
}

/**
 * Lifecycle + CRUD contract for an external vector database. Modeled
 * after Pinecone/Weaviate/Qdrant common shapes — when a real adapter
 * lands, it maps these methods 1:1 onto the underlying client.
 */
export interface IVectorDBAdapter {
  readonly name: string;

  /** Open the connection / verify credentials. Idempotent. */
  connect(): Promise<void>;
  /** Close the connection. Idempotent. */
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /**
   * Upsert one or more vectors. Implementations typically batch a
   * single API call; callers can pass arbitrary array sizes (the
   * adapter chunks internally if the backend has a limit).
   */
  upsert(vectors: VectorUpsert[]): Promise<void>;

  /**
   * Look up the top-K nearest vectors to `vector`. Optional
   * `filter` narrows the candidate set by exact-match on the upsert
   * metadata.
   */
  query(
    vector: number[],
    options: { topK: number; filter?: VectorQueryFilter; minScore?: number },
  ): Promise<VectorMatch[]>;

  /** Delete one or more vectors by id. Returns the count actually removed. */
  remove(ids: string[]): Promise<number>;

  /** Snapshot of vector count + dimensions for diagnostics. */
  stats(): Promise<VectorAdapterStats>;
}

/**
 * Test-only in-memory adapter. NOT intended for production: linear
 * scan on `query`, no persistence. Useful as a contract reference
 * and for tests that need a vector backend without spinning up a
 * real one.
 */
export class InMemoryVectorAdapter implements IVectorDBAdapter {
  readonly name = 'in-memory';
  private connected = false;
  private vectors: Map<string, VectorUpsert> = new Map();

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.vectors.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async upsert(vectors: VectorUpsert[]): Promise<void> {
    this.checkConnected();
    for (const v of vectors) {
      // Defensive copy so mutations on the input array don't leak.
      this.vectors.set(v.id, {
        id: v.id,
        vector: [...v.vector],
        metadata: v.metadata ? { ...v.metadata } : undefined,
      });
    }
  }

  async query(
    vector: number[],
    options: { topK: number; filter?: VectorQueryFilter; minScore?: number },
  ): Promise<VectorMatch[]> {
    this.checkConnected();
    const minScore = options.minScore ?? -Infinity;
    const filter = options.filter;

    const matches: VectorMatch[] = [];
    for (const stored of this.vectors.values()) {
      if (filter && !matchesFilter(stored.metadata, filter)) continue;
      const score = cosineSimilarity(vector, stored.vector);
      // NaN indicates a zero-magnitude vector on either side — likely
      // a broken upstream embedding rather than legitimate data. Drop
      // it rather than silently treating it as "perfectly dissimilar".
      if (Number.isNaN(score) || score < minScore) continue;
      matches.push({ id: stored.id, score, metadata: stored.metadata });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, options.topK);
  }

  async remove(ids: string[]): Promise<number> {
    this.checkConnected();
    let removed = 0;
    for (const id of ids) {
      if (this.vectors.delete(id)) removed++;
    }
    return removed;
  }

  async stats(): Promise<VectorAdapterStats> {
    this.checkConnected();
    let dimensions: number | null = null;
    for (const v of this.vectors.values()) {
      dimensions = v.vector.length;
      break;
    }
    return {
      vectorCount: this.vectors.size,
      dimensions,
    };
  }

  private checkConnected(): void {
    if (!this.connected) {
      throw new Error('InMemoryVectorAdapter: not connected');
    }
  }
}

function matchesFilter(
  metadata: Record<string, unknown> | undefined,
  filter: VectorQueryFilter,
): boolean {
  if (!metadata) return false;
  for (const [k, v] of Object.entries(filter)) {
    if (metadata[k] !== v) return false;
  }
  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return NaN;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  // Returning NaN for zero-magnitude vectors lets `query()` skip them
  // — see the comment in the query loop. A zero vector typically
  // indicates a broken embedding pipeline upstream.
  return denom === 0 ? NaN : dot / denom;
}
