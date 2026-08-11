/**
 * Vector Store
 *
 * Phase 4 Sprint 11: Vector storage and retrieval for semantic search.
 * Provides in-memory and SQLite-backed implementations.
 *
 * @module search/VectorStore
 */

import type { IVectorStore, VectorSearchResult } from '../types/index.js';
import { cosineSimilarity } from '../utils/textSimilarity.js';

// Re-export the canonical implementation (same binding as utils/textSimilarity —
// reaching the package root via both barrels is NOT ambiguous under ESM because
// it is one shared binding, which keeps `cosineSimilarity` importable from the root).
export { cosineSimilarity } from '../utils/textSimilarity.js';

/**
 * In-Memory Vector Store
 *
 * Stores vectors in memory using a Map for O(1) add/remove operations.
 * Search uses brute-force cosine similarity which is O(n) but fast for
 * small to medium graphs (<10K entities).
 *
 * @example
 * ```typescript
 * const store = new InMemoryVectorStore();
 * store.add("entity1", [0.1, 0.2, 0.3]);
 * store.add("entity2", [0.4, 0.5, 0.6]);
 * const results = store.search([0.1, 0.2, 0.3], 5);
 * console.log(results); // [{ name: "entity1", score: 1.0 }, ...]
 * ```
 */
export class InMemoryVectorStore implements IVectorStore {
  /** Map of entity name to embedding vector */
  private vectors: Map<string, number[]> = new Map();

  /**
   * Add a vector for an entity.
   *
   * @param entityName - Name of the entity
   * @param vector - Embedding vector
   */
  add(entityName: string, vector: number[]): void {
    this.vectors.set(entityName, vector);
  }

  /**
   * Search for similar vectors using cosine similarity.
   *
   * @param queryVector - Query embedding vector
   * @param k - Number of results to return
   * @returns Array of results with entity name and similarity score
   */
  search(queryVector: number[], k: number): VectorSearchResult[] {
    if (this.vectors.size === 0 || k <= 0 || Number.isNaN(k)) {
      return [];
    }

    const limit = Number.isFinite(k)
      ? Math.min(this.vectors.size, Math.max(0, Math.floor(k)))
      : this.vectors.size;
    if (limit === 0) return [];

    type HeapEntry = VectorSearchResult & { order: number };
    const heap: HeapEntry[] = [];
    let order = 0;
    for (const [name, vector] of this.vectors) {
      try {
        const score = cosineSimilarity(queryVector, vector);
        const candidate: HeapEntry = { name, score, order: order++ };
        if (heap.length < limit) {
          heap.push(candidate);
          siftUpWorst(heap, heap.length - 1);
        } else if (isBetter(candidate, heap[0])) {
          heap[0] = candidate;
          siftDownWorst(heap, 0);
        }
      } catch {
        // Skip vectors with dimension mismatch
        continue;
      }
    }

    // Sorting only the bounded heap keeps the common small-k path at
    // O(N log k), while preserving score order and insertion-order ties.
    return heap
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(({ name, score }) => ({ name, score }));
  }

  /**
   * Remove a vector by entity name.
   *
   * @param entityName - Name of the entity to remove
   * @returns True if found and removed
   */
  remove(entityName: string): boolean {
    return this.vectors.delete(entityName);
  }

  /**
   * Get the number of vectors stored.
   *
   * @returns Number of vectors
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Clear all vectors from the store.
   */
  clear(): void {
    this.vectors.clear();
  }

  /**
   * Check if a vector exists for an entity.
   *
   * @param entityName - Name of the entity
   * @returns True if vector exists
   */
  has(entityName: string): boolean {
    return this.vectors.has(entityName);
  }

  /**
   * Get the vector for an entity.
   *
   * @param entityName - Name of the entity
   * @returns Vector if found, undefined otherwise
   */
  get(entityName: string): number[] | undefined {
    return this.vectors.get(entityName);
  }

  /**
   * Get all entity names with stored vectors.
   *
   * @returns Array of entity names
   */
  getEntityNames(): string[] {
    return Array.from(this.vectors.keys());
  }

  /**
   * Load vectors from an iterable source.
   *
   * @param entries - Iterable of [entityName, vector] pairs
   */
  loadFrom(entries: Iterable<[string, number[]]>): void {
    for (const [name, vector] of entries) {
      this.vectors.set(name, vector);
    }
  }
}

/** Heap root is the worst retained result: lowest score, latest tie. */
function isWorse(a: { score: number; order: number }, b: { score: number; order: number }): boolean {
  return a.score < b.score || (a.score === b.score && a.order > b.order);
}

function isBetter(a: { score: number; order: number }, b: { score: number; order: number }): boolean {
  return a.score > b.score || (a.score === b.score && a.order < b.order);
}

function siftUpWorst<T extends { score: number; order: number }>(heap: T[], index: number): void {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isWorse(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function siftDownWorst<T extends { score: number; order: number }>(heap: T[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

/**
 * SQLite Vector Store
 *
 * Persists vectors to SQLite storage while maintaining an in-memory cache
 * for fast search operations. Combines persistence with performance.
 *
 * Uses SQLiteStorage's embedding storage methods for persistence.
 *
 * @example
 * ```typescript
 * const store = new SQLiteVectorStore(sqliteStorage);
 * await store.initialize();
 * store.add("entity1", [0.1, 0.2, 0.3]);
 * const results = store.search([0.1, 0.2, 0.3], 5);
 * ```
 */
export class SQLiteVectorStore implements IVectorStore {
  /** In-memory cache for fast search */
  private memoryStore: InMemoryVectorStore = new InMemoryVectorStore();

  /** SQLite storage reference for persistence */
  private storage: SQLiteStorageWithEmbeddings | null = null;

  /** Whether the store has been initialized */
  private initialized = false;

  /** Model name used for embeddings */
  private embeddingModel: string = '';

  /**
   * Create a SQLite vector store.
   *
   * @param storage - SQLite storage instance with embedding support
   * @param embeddingModel - Model name used for embeddings
   */
  constructor(storage?: SQLiteStorageWithEmbeddings, embeddingModel: string = 'unknown') {
    this.storage = storage || null;
    this.embeddingModel = embeddingModel;
  }

  /**
   * Initialize the store by loading vectors from SQLite.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.storage) {
      // Load all embeddings from SQLite
      const embeddings = await this.storage.loadAllEmbeddings();
      this.memoryStore.loadFrom(embeddings);
    }

    this.initialized = true;
  }

  /**
   * Add a vector for an entity.
   * Stores in both memory and SQLite for persistence.
   *
   * @param entityName - Name of the entity
   * @param vector - Embedding vector
   */
  add(entityName: string, vector: number[]): void {
    // Add to in-memory cache
    this.memoryStore.add(entityName, vector);

    // Persist to SQLite if available
    if (this.storage) {
      this.storage.storeEmbedding(entityName, vector, this.embeddingModel);
    }
  }

  /**
   * Search for similar vectors using cosine similarity.
   *
   * @param queryVector - Query embedding vector
   * @param k - Number of results to return
   * @returns Array of results with entity name and similarity score
   */
  search(queryVector: number[], k: number): VectorSearchResult[] {
    return this.memoryStore.search(queryVector, k);
  }

  /**
   * Remove a vector by entity name.
   *
   * @param entityName - Name of the entity to remove
   * @returns True if found and removed
   */
  remove(entityName: string): boolean {
    const removed = this.memoryStore.remove(entityName);

    // Remove from SQLite if available
    if (this.storage && removed) {
      this.storage.removeEmbedding(entityName);
    }

    return removed;
  }

  /**
   * Get the number of vectors stored.
   *
   * @returns Number of vectors
   */
  size(): number {
    return this.memoryStore.size();
  }

  /**
   * Clear all vectors from the store.
   */
  clear(): void {
    this.memoryStore.clear();

    if (this.storage) {
      this.storage.clearAllEmbeddings();
    }
  }

  /**
   * Check if a vector exists for an entity.
   *
   * @param entityName - Name of the entity
   * @returns True if vector exists
   */
  has(entityName: string): boolean {
    return this.memoryStore.has(entityName);
  }

  /**
   * Get the vector for an entity.
   *
   * @param entityName - Name of the entity
   * @returns Vector if found, undefined otherwise
   */
  get(entityName: string): number[] | undefined {
    return this.memoryStore.get(entityName);
  }

  /**
   * Set the SQLite storage reference.
   *
   * @param storage - SQLite storage instance
   */
  setStorage(storage: SQLiteStorageWithEmbeddings): void {
    this.storage = storage;
  }

  /**
   * Set the embedding model name.
   *
   * @param model - Model name
   */
  setEmbeddingModel(model: string): void {
    this.embeddingModel = model;
  }
}

/**
 * Interface for SQLite storage with embedding support.
 *
 * This is a subset of SQLiteStorage that only includes embedding-related methods.
 * Allows for loose coupling between VectorStore and SQLiteStorage.
 */
export interface SQLiteStorageWithEmbeddings {
  /**
   * Store an embedding for an entity.
   *
   * @param entityName - Name of the entity
   * @param vector - Embedding vector
   * @param model - Model name used for the embedding
   */
  storeEmbedding(entityName: string, vector: number[], model: string): void;

  /**
   * Load all embeddings from storage.
   *
   * @returns Array of [entityName, vector] pairs
   */
  loadAllEmbeddings(): Promise<[string, number[]][]>;

  /**
   * Remove an embedding for an entity.
   *
   * @param entityName - Name of the entity
   */
  removeEmbedding(entityName: string): void;

  /**
   * Clear all embeddings from storage.
   */
  clearAllEmbeddings(): void;
}

/**
 * Create a vector store based on storage type.
 *
 * @param storageType - Storage type: 'jsonl' or 'sqlite'
 * @param storage - Optional SQLite storage reference for 'sqlite' type
 * @param embeddingModel - Optional model name for embedding tracking
 * @returns Vector store instance
 */
export function createVectorStore(
  storageType: 'jsonl' | 'sqlite' = 'jsonl',
  storage?: SQLiteStorageWithEmbeddings,
  embeddingModel?: string
): IVectorStore {
  switch (storageType) {
    case 'sqlite':
      return new SQLiteVectorStore(storage, embeddingModel);
    case 'jsonl':
    default:
      return new InMemoryVectorStore();
  }
}
