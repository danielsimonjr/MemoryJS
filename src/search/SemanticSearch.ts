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
  ReadonlyKnowledgeGraph,
} from '../types/index.js';
import { InMemoryVectorStore } from './VectorStore.js';
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

  /**
   * Create a semantic search manager.
   *
   * @param embeddingService - Service for generating embeddings
   * @param vectorStore - Store for vector storage and search
   */
  constructor(embeddingService: EmbeddingService, vectorStore?: IVectorStore) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore || new InMemoryVectorStore();
  }

  /**
   * Index all entities in the knowledge graph.
   *
   * Generates embeddings for all entities and stores them in the vector store.
   * Can be called incrementally - only indexes entities that aren't already indexed.
   *
   * Phase 9B: Supports cancellation via AbortSignal in options.
   *
   * @param graph - Knowledge graph to index
   * @param options - Indexing options (includes signal for cancellation)
   * @returns Index statistics
   * @throws {OperationCancelledError} If operation is cancelled via signal (Phase 9B)
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

    let indexed = 0;
    let skipped = 0;
    let errors = 0;

    const entities = graph.entities;
    const total = entities.length;

    // Collect entities to index
    const toIndex: Entity[] = [];
    for (const entity of entities) {
      if (forceReindex || !this.vectorStore.has(entity.name)) {
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
      const texts = batch.map(entityToText);

      try {
        const embeddings = await this.embeddingService.embedBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          this.vectorStore.add(batch[j].name, embeddings[j]);
          indexed++;
        }
      } catch (error) {
        // Try individual embeddings on batch failure
        for (const entity of batch) {
          // Check for cancellation during fallback
          checkCancellation(signal, 'indexAll');

          try {
            const text = entityToText(entity);
            const embedding = await this.embeddingService.embed(text);
            this.vectorStore.add(entity.name, embedding);
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
      const text = entityToText(entity);
      const embedding = await this.embeddingService.embed(text);
      this.vectorStore.add(entity.name, embedding);
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
    // Ensure limit is within bounds
    const effectiveLimit = Math.min(limit, SEMANTIC_SEARCH_LIMITS.MAX_LIMIT);

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.embed(query);

    // Search vector store
    const vectorResults = this.vectorStore.search(queryEmbedding, effectiveLimit * 2); // Get extra for filtering

    // Convert to SemanticSearchResult with entity lookup
    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }

    const results: SemanticSearchResult[] = [];
    for (const result of vectorResults) {
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

    // Convert to SemanticSearchResult with entity lookup
    const entityMap = new Map<string, Entity>();
    for (const entity of graph.entities) {
      entityMap.set(entity.name, entity);
    }

    const results: SemanticSearchResult[] = [];
    for (const result of vectorResults) {
      // Skip self
      if (result.name === entityName) {
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
