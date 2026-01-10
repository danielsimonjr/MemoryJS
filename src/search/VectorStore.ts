/**
 * Vector Store
 *
 * Phase 4 Sprint 11: Vector storage and retrieval for semantic search.
 * Provides in-memory and SQLite-backed implementations.
 *
 * @module search/VectorStore
 */

import type { IVectorStore, VectorSearchResult } from '../types/index.js';

/**
 * Calculate cosine similarity between two vectors.
 *
 * Uses an optimized inner loop without array methods for maximum performance.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity score (0.0 to 1.0)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  // Optimized single-pass loop
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dotProduct += ai * bi;
    magnitudeA += ai * ai;
    magnitudeB += bi * bi;
  }

  const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);

  if (magnitude === 0) {
    return 0;
  }

  // Clamp to [-1, 1] to handle floating point errors
  const similarity = dotProduct / magnitude;
  return Math.max(-1, Math.min(1, similarity));
}

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
    if (this.vectors.size === 0) {
      return [];
    }

    // Calculate similarity for all vectors
    const results: VectorSearchResult[] = [];

    for (const [name, vector] of this.vectors) {
      try {
        const score = cosineSimilarity(queryVector, vector);
        results.push({ name, score });
      } catch {
        // Skip vectors with dimension mismatch
        continue;
      }
    }

    // Sort by score descending and take top k
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
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
