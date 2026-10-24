/**
 * Semantic Search Manager
 *
 * Phase 4 Sprint 12: Orchestrates embedding service and vector store
 * to provide semantic similarity search capabilities.
 *
 * @module search/SemanticSearch
 */

import type {
  Entity,
  EmbeddingService,
  IVectorStore,
  SemanticSearchResult,
  SemanticIndexOptions,
  VectorSearchResult,
  ReadonlyKnowledgeGraph,
  EmbeddingMode,
} from '../types/index.js';
import { createHash } from 'node:crypto';
import { InMemoryVectorStore, cosineSimilarity } from './VectorStore.js';
import { EmbeddingCache } from './EmbeddingCache.js';
import { EMBEDDING_DEFAULTS, SEMANTIC_SEARCH_LIMITS } from '../utils/constants.js';
import { checkCancellation } from '../utils/index.js';

/**
 * Convert an entity to a text representation for embedding.
 *
 * Creates a structured text that captures the entity's key information
 * for generating meaningful embeddings.
 *
 * @param entity - Entity to convert
 * @returns Text representation suitable for embedding
 */
export function entityToText(entity: Entity): string {
  const parts: string[] = [];

  // Name and type are most important
  parts.push(`${entity.name} (${entity.entityType})`);

  // Add observations (limited to prevent overly long text)
  if (entity.observations.length > 0) {
    const observationText = entity.observations.slice(0, 10).join('. ');
    parts.push(observationText);
  }

  // Add tags if present
  if (entity.tags && entity.tags.length > 0) {
    parts.push(`Tags: ${entity.tags.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Convert vector store hits into semantic results with entity lookup.
 *
 * Hits below the threshold are skipped. The excluded name is skipped when it is set.
 * The list stops at the limit. The function does not use `this`, so a caller reads
 * the entity map itself.
 *
 * @param entityMap - Entities by name
 * @param vectorResults - Hits from the vector store, best first
 * @param effectiveLimit - Maximum number of results
 * @param minSimilarity - Minimum similarity threshold
 * @param excludeName - Entity name to skip, such as the entity itself
 * @returns Semantic results in the order of the hits
 */
function toSemanticResults(
  entityMap: Map<string, Entity>,
  vectorResults: VectorSearchResult[],
  effectiveLimit: number,
  minSimilarity: number,
  excludeName?: string,
): SemanticSearchResult[] {
  const results: SemanticSearchResult[] = [];
  for (const result of vectorResults) {
    // Skip self
    if (excludeName !== undefined && result.name === excludeName) {
      continue;
    }

    if (result.score < minSimilarity) {
      continue;
    }

    const entity = entityMap.get(result.name);
    if (entity) {
      results.push({
        entity,
        similarity: result.score,
      });
    }

    if (results.length >= effectiveLimit) {
      break;
    }
  }

  return results;
}

/**
 * Optional collaborators for `SemanticSearch`, such as the embedding cache.
 */
export interface SemanticSearchOptions {
  /** Optional text-to-vector cache, normally wired by ManagerContext. */
  embeddingCache?: EmbeddingCache;
  /** Called after one or more embeddings are inserted into the cache. */
  onCacheInsert?: () => void;
}

/**
 * Semantic Search Manager
 *
 * Provides semantic similarity search by converting entities to embeddings
 * and storing them in a vector store. Supports search by query text and
 * finding similar entities.
 *
 * @example
 * ```typescript
 * const semanticSearch = new SemanticSearch(embeddingService, vectorStore);
 * await semanticSearch.indexAll(graph);
 * const results = await semanticSearch.search(graph, "machine learning");
 * ```
 */
export class SemanticSearch {
  /** Embedding service for generating vectors */
  private embeddingService: EmbeddingService;

  /** Vector store for storing and searching embeddings */
  private vectorStore: IVectorStore;

  /** Whether embeddings have been indexed */
  private indexed = false;

  /** Number of entities currently indexed */
  private indexedCount = 0;
  private embeddingCache?: EmbeddingCache;
  private onCacheInsert?: () => void;

  /** Pending or completed load of the vector store */
  private storeReady?: Promise<void>;

  /**
   * Create a semantic search manager.
   *
   * @param embeddingService - Service for generating embeddings
   * @param vectorStore - Store for vector storage and search
   */
  constructor(
    embeddingService: EmbeddingService,
    vectorStore?: IVectorStore,
    options: SemanticSearchOptions = {},
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore || new InMemoryVectorStore();
    this.embeddingCache = options.embeddingCache;
    this.onCacheInsert = options.onCacheInsert;
  }

  private async embedCached(
    key: string,
    text: string,
    mode: EmbeddingMode = 'document',
  ): Promise<number[]> {
    const cached = this.embeddingCache?.get(key, text);
    if (cached) return cached;
    const embedding = await this.embeddingService.embed(text, mode);
    if (this.embeddingCache) {
      this.embeddingCache.set(key, text, embedding);
      this.onCacheInsert?.();
    }
    return embedding;
  }

  private async embedEntityBatch(entities: Entity[]): Promise<number[][]> {
    const texts = entities.map(entityToText);
    if (!this.embeddingCache) {
      return this.embeddingService.embedBatch(texts);
    }

    const vectors: Array<number[] | undefined> = new Array(entities.length);
    const missingIndexes: number[] = [];
    const missingTexts: string[] = [];
    for (let i = 0; i < entities.length; i++) {
      const cached = this.embeddingCache.get(`document:${entities[i].name}`, texts[i]);
      if (cached) {
        vectors[i] = cached;
      } else {
        missingIndexes.push(i);
        missingTexts.push(texts[i]);
      }
    }

    if (missingIndexes.length > 0) {
      const embedded = await this.embeddingService.embedBatch(missingTexts);
      if (embedded.length !== missingIndexes.length) {
        throw new Error(
          `Embedding service returned ${embedded.length} vectors for ${missingIndexes.length} texts`,
        );
      }
      for (let i = 0; i < missingIndexes.length; i++) {
        const batchIndex = missingIndexes[i];
        const vector = embedded[i];
        vectors[batchIndex] = vector;
        this.embeddingCache.set(
          `document:${entities[batchIndex].name}`,
          texts[batchIndex],
          vector,
        );
      }
      this.onCacheInsert?.();
    }

    return vectors as number[][];
  }

  /**
   * Load the vector store once before the first read or write.
   *
   * A rejected load is cleared, so a later call tries again.
   *
   * @returns Promise that resolves when the store is ready
   */
  private ensureStoreReady(): Promise<void> {
    if (!this.storeReady) {
      this.storeReady = this.vectorStore.initialize?.() ?? Promise.resolve();
      this.storeReady.catch(() => {
        this.storeReady = undefined;
      });
    }
    return this.storeReady;
  }

  /**
   * Get the hash that marks the content a vector was made from.
   *
   * Uses `entity.contentHash` when it is a string. Otherwise hashes the
   * embedding text (`entityToText`: name, type, the first 10 observations and
   * the tags) with SHA-256 in hex.
   *
   * @param entity - Entity to hash
   * @returns The content hash for the entity
   */
  private hashFor(entity: Entity): string {
    if (typeof entity.contentHash === 'string') return entity.contentHash;
    return createHash('sha256').update(entityToText(entity)).digest('hex');
  }

  /**
   * Check whether an entity's stored vector was built from different content.
   *
   * Compares the stored hash with `hashFor(entity)`: `entity.contentHash`, or a
   * SHA-256 of `entityToText(entity)` when the entity has none. Always false
   * for stores that do not track hashes.
   *
   * @param entity - Entity to check
   * @returns True when the stored hash differs from the hash of the entity
   */
  private isStale(entity: Entity): boolean {
    if (typeof this.vectorStore.getContentHash !== 'function') return false;
    return this.vectorStore.getContentHash(entity.name) !== this.hashFor(entity);
  }

  /**
   * Index all entities in the knowledge graph.
   *
   * Generates embeddings for all entities and stores them in the vector store.
   * Can be called incrementally - only indexes entities that aren't already indexed,
   * or whose content hash differs from the stored hash (see `hashFor`).
   *
   * Phase 9B: Supports cancellation via AbortSignal in options.
   *
   * @param graph - Knowledge graph to index
   * @param options - Indexing options (includes signal for cancellation)
   * @returns Index statistics
   * @throws OperationCancelledError If operation is cancelled via signal (Phase 9B)
   */
  async indexAll(
    graph: ReadonlyKnowledgeGraph,
    options: SemanticIndexOptions = {}
  ): Promise<{ indexed: number; skipped: number; errors: number }> {
    const {
      forceReindex = false,
      onProgress,
      batchSize = EMBEDDING_DEFAULTS.DEFAULT_BATCH_SIZE,
      signal,
    } = options;

    // Check for early cancellation
    checkCancellation(signal, 'indexAll');
    await this.ensureStoreReady();

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    const entities = graph.entities;
    const total = entities.length;

    // Collect entities to index
    const toIndex: Entity[] = [];
    for (const entity of entities) {
      if (forceReindex || !this.vectorStore.has(entity.name) || this.isStale(entity)) {
        toIndex.push(entity);
      } else {
        skipped++;
      }
    }

    // Process in batches
    for (let i = 0; i < toIndex.length; i += batchSize) {
      // Check for cancellation between batches
      checkCancellation(signal, 'indexAll');

      const batch = toIndex.slice(i, i + batchSize);
      const added = new Set<string>();
      try {
        const embeddings = await this.embedEntityBatch(batch);

        for (let j = 0; j < batch.length; j++) {
          this.vectorStore.add(batch[j].name, embeddings[j], this.hashFor(batch[j]));
          added.add(batch[j].name);
          indexed++;
        }
      } catch {
        // Try individual embeddings on batch failure
        for (const entity of batch) {
          // Skip entities the batch path already stored and counted
          if (added.has(entity.name)) continue;
          // Check for cancellation during fallback
          checkCancellation(signal, 'indexAll');

          try {
            const text = entityToText(entity);
            const embedding = await this.embedCached(
              `document:${entity.name}`,
              text,
            );
            this.vectorStore.add(entity.name, embedding, this.hashFor(entity));
            indexed++;
          } catch {
            errors++;
          }
        }
      }

      // Report progress
      if (onProgress) {
        onProgress(indexed + skipped + errors, total);
      }
    }

    this.indexed = true;
    this.indexedCount = this.vectorStore.size();

    return { indexed, skipped, errors };
  }

  /**
   * Index a single entity.
   *
   * @param entity - Entity to index
   * @returns True if indexed successfully
   */
  async indexEntity(entity: Entity): Promise<boolean> {
    try {
      await this.ensureStoreReady();
      const text = entityToText(entity);
      const embedding = await this.embedCached(`document:${entity.name}`, text);
      this.vectorStore.add(entity.name, embedding, this.hashFor(entity));
      this.indexedCount = this.vectorStore.size();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove an entity from the index.
   *
   * @param entityName - Name of entity to remove
   * @returns True if found and removed
   */
  removeEntity(entityName: string): boolean {
    const removed = this.vectorStore.remove(entityName);
    if (removed) {
      this.indexedCount = this.vectorStore.size();
    }
    return removed;
  }

  /**
   * Build a name → entity lookup map from a knowledge graph.
   *
   * Shared by {@link search} and {@link findSimilar}. Not cached: the graph
   * object may be mutated between calls, so the map is rebuilt each time to
   * avoid stale-lookup bugs.
   *
   * @param graph - Knowledge graph to index
   * @returns Map keyed by entity name
   */
  private buildEntityMap(graph: ReadonlyKnowledgeGraph): Map<string, Entity> {
    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }
    return entityMap;
  }

  /**
   * Search for entities semantically similar to a query.
   *
   * @param graph - Knowledge graph to search in
   * @param query - Search query text
   * @param limit - Maximum number of results (default: 10)
   * @param minSimilarity - Minimum similarity threshold (default: 0)
   * @returns Array of search results with similarity scores
   */
  async search(
    graph: ReadonlyKnowledgeGraph,
    query: string,
    limit: number = SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT,
    minSimilarity: number = SEMANTIC_SEARCH_LIMITS.MIN_SIMILARITY
  ): Promise<SemanticSearchResult[]> {
    await this.ensureStoreReady();
    // Ensure limit is within bounds
    const effectiveLimit = Math.min(limit, SEMANTIC_SEARCH_LIMITS.MAX_LIMIT);

    // Generate embedding for query
    const queryEmbedding = await this.embedCached(`query:${query}`, query, 'query');

    // Search vector store
    const vectorResults = this.vectorStore.search(queryEmbedding, effectiveLimit * 2); // Get extra for filtering

    return toSemanticResults(this.buildEntityMap(graph), vectorResults, effectiveLimit, minSimilarity);
  }

  /**
   * Find entities similar to a given entity.
   *
   * @param graph - Knowledge graph to search in
   * @param entityName - Name of entity to find similar entities for
   * @param limit - Maximum number of results (default: 10)
   * @param minSimilarity - Minimum similarity threshold (default: 0)
   * @returns Array of search results with similarity scores
   */
  async findSimilar(
    graph: ReadonlyKnowledgeGraph,
    entityName: string,
    limit: number = SEMANTIC_SEARCH_LIMITS.DEFAULT_LIMIT,
    minSimilarity: number = SEMANTIC_SEARCH_LIMITS.MIN_SIMILARITY
  ): Promise<SemanticSearchResult[]> {
    await this.ensureStoreReady();
    // Get the entity's embedding
    const embedding = this.vectorStore.get(entityName);
    if (!embedding) {
      // Try to find and index the entity
      const entity = graph.entities.find(e => e.name === entityName);
      if (entity) {
        await this.indexEntity(entity);
        return this.findSimilar(graph, entityName, limit, minSimilarity);
      }
      return [];
    }

    // Ensure limit is within bounds
    const effectiveLimit = Math.min(limit, SEMANTIC_SEARCH_LIMITS.MAX_LIMIT);

    // Search vector store (request extra to filter out self)
    const vectorResults = this.vectorStore.search(embedding, effectiveLimit + 1);

    return toSemanticResults(
      this.buildEntityMap(graph),
      vectorResults,
      effectiveLimit,
      minSimilarity,
      entityName,
    );
  }

  /**
   * Get the embedding service.
   *
   * @returns Embedding service instance
   */
  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  /**
   * Get the vector store.
   *
   * @returns Vector store instance
   */
  getVectorStore(): IVectorStore {
    return this.vectorStore;
  }

  /**
   * Check if the index has been built.
   *
   * @returns True if indexAll has been called
   */
  isIndexed(): boolean {
    return this.indexed;
  }

  /**
   * Get the number of indexed entities.
   *
   * @returns Number of entities in the vector store
   */
  getIndexedCount(): number {
    return this.indexedCount;
  }

  /**
   * Calculate semantic similarity between two strings.
   *
   * Embeds both strings and returns their cosine similarity score (0-1).
   * Returns 1.0 immediately for identical strings without calling the embedding
   * service. Throws if the embedding service is not ready.
   *
   * @param a - First string
   * @param b - Second string
   * @returns Cosine similarity in the range [0, 1]
   */
  async calculateSimilarity(a: string, b: string): Promise<number> {
    if (a === b) return 1.0;
    const [embA, embB] = await Promise.all([
      this.embedCached(`similarity:${a}`, a),
      this.embedCached(`similarity:${b}`, b),
    ]);
    return cosineSimilarity(embA, embB);
  }

  /**
   * Clear all indexed embeddings.
   */
  clearIndex(): void {
    this.vectorStore.clear();
    this.indexed = false;
    this.indexedCount = 0;
  }

  /**
   * Check if semantic search is available.
   *
   * @returns True if embedding service is ready
   */
  async isAvailable(): Promise<boolean> {
    return this.embeddingService.isReady();
  }

  /**
   * Get semantic search statistics.
   *
   * @returns Statistics about the semantic search index
   */
  getStats(): {
    indexed: boolean;
    indexedCount: number;
    provider: string;
    model: string;
    dimensions: number;
  } {
    return {
      indexed: this.indexed,
      indexedCount: this.indexedCount,
      provider: this.embeddingService.provider,
      model: this.embeddingService.model,
      dimensions: this.embeddingService.dimensions,
    };
  }
}
