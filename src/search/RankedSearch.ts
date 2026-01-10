/**
 * Ranked Search
 *
 * TF-IDF relevance-based search with scoring and pre-calculated indexes.
 *
 * @module search/RankedSearch
 */

import type { Entity, SearchResult, TFIDFIndex, TokenizedEntity } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { calculateTF, calculateIDFFromTokenSets, tokenize } from '../utils/index.js';
import { SEARCH_LIMITS } from '../utils/constants.js';
import { TFIDFIndexManager } from './TFIDFIndexManager.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';

/**
 * Performs TF-IDF ranked search with optional pre-calculated indexes.
 */
export class RankedSearch {
  private indexManager: TFIDFIndexManager | null = null;

  /**
   * Phase 4 Sprint 2: Fallback token cache for entities.
   * Maps entity name -> pre-tokenized entity data.
   * Invalidated when graph changes (detected by entity count mismatch).
   */
  private fallbackTokenCache: Map<string, TokenizedEntity> = new Map();
  private cachedEntityCount: number = 0;

  constructor(
    private storage: GraphStorage,
    storageDir?: string
  ) {
    // Initialize index manager if storage directory is provided
    if (storageDir) {
      this.indexManager = new TFIDFIndexManager(storageDir);
    }
  }

  /**
   * Phase 4 Sprint 2: Clear the fallback token cache.
   * Called when graph changes are detected or explicitly by external code.
   */
  clearTokenCache(): void {
    this.fallbackTokenCache.clear();
    this.cachedEntityCount = 0;
  }

  /**
   * Initialize and build the TF-IDF index for fast searches.
   *
   * Should be called after graph changes to keep index up-to-date.
   */
  async buildIndex(): Promise<void> {
    if (!this.indexManager) {
      throw new Error('Index manager not initialized. Provide storageDir to constructor.');
    }

    const graph = await this.storage.loadGraph();
    await this.indexManager.buildIndex(graph);
    await this.indexManager.saveIndex();
  }

  /**
   * Update the index incrementally after entity changes.
   *
   * @param changedEntityNames - Names of entities that were created, updated, or deleted
   */
  async updateIndex(changedEntityNames: Set<string>): Promise<void> {
    if (!this.indexManager) {
      return; // No index manager, skip
    }

    const graph = await this.storage.loadGraph();
    await this.indexManager.updateIndex(graph, changedEntityNames);
    await this.indexManager.saveIndex();
  }

  /**
   * Load the TF-IDF index from disk if available.
   */
  private async ensureIndexLoaded(): Promise<TFIDFIndex | null> {
    if (!this.indexManager) {
      return null;
    }

    // Return cached index if already loaded
    const cached = this.indexManager.getIndex();
    if (cached) {
      return cached;
    }

    // Try to load from disk
    return await this.indexManager.loadIndex();
  }

  /**
   * Search with TF-IDF relevance ranking.
   *
   * Uses pre-calculated index if available, falls back to on-the-fly calculation.
   *
   * @param query - Search query
   * @param tags - Optional tags filter
   * @param minImportance - Optional minimum importance
   * @param maxImportance - Optional maximum importance
   * @param limit - Maximum results to return (default 50, max 200)
   * @returns Array of search results sorted by relevance
   */
  async searchNodesRanked(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    limit: number = SEARCH_LIMITS.DEFAULT
  ): Promise<SearchResult[]> {
    // Enforce maximum search limit
    const effectiveLimit = Math.min(limit, SEARCH_LIMITS.MAX);
    const graph = await this.storage.loadGraph();

    // Apply tag and importance filters using SearchFilterChain
    const filters: SearchFilters = { tags, minImportance, maxImportance };
    const filteredEntities = SearchFilterChain.applyFilters(graph.entities, filters);

    // Try to use pre-calculated index
    const index = await this.ensureIndexLoaded();
    const queryTerms = tokenize(query);

    if (index) {
      // Use pre-calculated index for fast search
      return this.searchWithIndex(filteredEntities, queryTerms, index, effectiveLimit);
    } else {
      // Fall back to on-the-fly calculation
      return this.searchWithoutIndex(filteredEntities, queryTerms, effectiveLimit);
    }
  }

  /**
   * Search using pre-calculated TF-IDF index (fast path).
   */
  private searchWithIndex(
    entities: Entity[],
    queryTerms: string[],
    index: TFIDFIndex,
    limit: number
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entity of entities) {
      const docVector = index.documents.get(entity.name);
      if (!docVector) {
        continue; // Entity not in index
      }

      // Calculate total terms in document (sum of all term frequencies)
      const totalTerms = Object.values(docVector.terms).reduce((sum, count) => sum + count, 0);
      if (totalTerms === 0) continue;

      // Calculate score using pre-calculated term frequencies and IDF
      let totalScore = 0;
      const matchedFields: SearchResult['matchedFields'] = {};

      for (const term of queryTerms) {
        const termCount = docVector.terms[term] || 0;
        const idf = index.idf.get(term) || 0;

        // Calculate TF-IDF: (termCount / totalTerms) * IDF
        const tf = termCount / totalTerms;
        const tfidf = tf * idf;
        totalScore += tfidf;

        // Track which fields matched
        if (termCount > 0) {
          if (entity.name.toLowerCase().includes(term)) {
            matchedFields.name = true;
          }
          if (entity.entityType.toLowerCase().includes(term)) {
            matchedFields.entityType = true;
          }
          const matchedObs = entity.observations.filter(o =>
            o.toLowerCase().includes(term)
          );
          if (matchedObs.length > 0) {
            matchedFields.observations = matchedObs;
          }
        }
      }

      // Only include entities with non-zero scores
      if (totalScore > 0) {
        results.push({
          entity,
          score: totalScore,
          matchedFields,
        });
      }
    }

    // Sort by score descending and apply limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search without index (on-the-fly calculation, slow path).
   *
   * OPTIMIZED: Phase 4 Sprint 2 - Uses fallback token cache to avoid
   * repeated tokenization of entities. Pre-tokenizes all documents once
   * and caches for subsequent searches.
   */
  private searchWithoutIndex(
    entities: Entity[],
    queryTerms: string[],
    limit: number
  ): SearchResult[] {
    const results: SearchResult[] = [];

    // Phase 4 Sprint 2: Check if cache needs invalidation
    if (entities.length !== this.cachedEntityCount) {
      this.clearTokenCache();
      this.cachedEntityCount = entities.length;
    }

    // Phase 4 Sprint 2: Get or compute tokenized data for each entity
    const documentData: TokenizedEntity[] = entities.map(e => {
      // Check cache first
      const cached = this.fallbackTokenCache.get(e.name);
      if (cached) {
        return cached;
      }

      // Compute and cache tokenized data
      const text = [e.name, e.entityType, ...e.observations].join(' ');
      const tokens = tokenize(text);
      const tokenized: TokenizedEntity = {
        entity: e,
        text,
        tokens,
        tokenSet: new Set(tokens),
      };
      this.fallbackTokenCache.set(e.name, tokenized);
      return tokenized;
    });

    // Pre-compute token sets for IDF calculation (O(1) lookup per document)
    const tokenSets = documentData.map(d => d.tokenSet);

    for (const docData of documentData) {
      const { entity, text } = docData;

      // Calculate score for each query term
      let totalScore = 0;
      const matchedFields: SearchResult['matchedFields'] = {};

      for (const term of queryTerms) {
        // Calculate TF using pre-tokenized tokens
        const tf = calculateTF(term, text);

        // Calculate IDF using pre-computed token sets (O(1) per document)
        const idf = calculateIDFFromTokenSets(term, tokenSets);

        // TF-IDF score
        const score = tf * idf;
        totalScore += score;

        // Track which fields matched
        if (entity.name.toLowerCase().includes(term)) {
          matchedFields.name = true;
        }
        if (entity.entityType.toLowerCase().includes(term)) {
          matchedFields.entityType = true;
        }
        const matchedObs = entity.observations.filter(o =>
          o.toLowerCase().includes(term)
        );
        if (matchedObs.length > 0) {
          matchedFields.observations = matchedObs;
        }
      }

      // Only include entities with non-zero scores
      if (totalScore > 0) {
        results.push({
          entity,
          score: totalScore,
          matchedFields,
        });
      }
    }

    // Sort by score descending and apply limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
