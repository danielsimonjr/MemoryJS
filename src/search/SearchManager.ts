/**
 * Search Manager
 *
 * Orchestrates all search types (basic, ranked, boolean, fuzzy).
 * Focused on search operations only (Phase 4: Consolidate God Objects).
 *
 * @module search/SearchManager
 */

import type { KnowledgeGraph, SearchResult, SavedSearch, AutoSearchResult, Entity, AccessContext } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { BasicSearch } from './BasicSearch.js';
import { RankedSearch } from './RankedSearch.js';
import { BooleanSearch } from './BooleanSearch.js';
import { FuzzySearch } from './FuzzySearch.js';
import { SearchSuggestions } from './SearchSuggestions.js';
import { SavedSearchManager } from './SavedSearchManager.js';
import { QueryCostEstimator } from './QueryCostEstimator.js';
import type { AccessTracker } from '../agent/AccessTracker.js';

/**
 * Options for search methods with access tracking support.
 */
export interface SearchOptionsWithTracking {
  /** Enable access tracking for returned results */
  trackAccess?: boolean;
  /** Session ID for access context */
  sessionId?: string;
  /** Task ID for access context */
  taskId?: string;
}

/**
 * Unified search manager providing access to all search types.
 *
 * Phase 4 Sprint 5: Manages search caches across all search types.
 */
export class SearchManager {
  readonly basicSearch: BasicSearch;
  readonly rankedSearch: RankedSearch;
  readonly booleanSearcher: BooleanSearch;
  readonly fuzzySearcher: FuzzySearch;
  readonly searchSuggestions: SearchSuggestions;
  readonly savedSearchManager: SavedSearchManager;
  readonly queryEstimator: QueryCostEstimator;
  private storage: GraphStorage;
  private accessTracker?: AccessTracker;

  constructor(storage: GraphStorage, savedSearchesFilePath: string) {
    this.storage = storage;
    this.basicSearch = new BasicSearch(storage);
    this.rankedSearch = new RankedSearch(storage);
    this.booleanSearcher = new BooleanSearch(storage);
    this.fuzzySearcher = new FuzzySearch(storage);
    this.searchSuggestions = new SearchSuggestions(storage);
    this.savedSearchManager = new SavedSearchManager(savedSearchesFilePath, this.basicSearch);
    this.queryEstimator = new QueryCostEstimator();
  }

  /**
   * Set the AccessTracker for optional access tracking.
   * When set, search methods can track access to returned entities.
   *
   * @param tracker - AccessTracker instance
   */
  setAccessTracker(tracker: AccessTracker): void {
    this.accessTracker = tracker;
  }

  // ==================== Cache Management (Phase 4 Sprint 5) ====================

  /**
   * Phase 4 Sprint 5: Clear all search caches.
   *
   * Clears caches in all search types: fuzzy, boolean, and ranked token cache.
   * Call this when the graph has been modified to ensure fresh results.
   */
  clearAllCaches(): void {
    this.fuzzySearcher.clearCache();
    this.booleanSearcher.clearCache();
    this.rankedSearch.clearTokenCache();
  }

  /**
   * Phase 4 Sprint 5: Clear fuzzy search cache.
   */
  clearFuzzyCache(): void {
    this.fuzzySearcher.clearCache();
  }

  /**
   * Phase 4 Sprint 5: Clear boolean search cache.
   */
  clearBooleanCache(): void {
    this.booleanSearcher.clearCache();
  }

  /**
   * Phase 4 Sprint 5: Clear ranked search token cache.
   */
  clearRankedCache(): void {
    this.rankedSearch.clearTokenCache();
  }

  // ==================== Basic Search ====================

  /** Perform a simple text-based search across entity names, observations, and types. */
  async searchNodes(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    options?: SearchOptionsWithTracking
  ): Promise<KnowledgeGraph> {
    const result = await this.basicSearch.searchNodes(query, tags, minImportance, maxImportance);

    // Track access if enabled
    if (options?.trackAccess && this.accessTracker) {
      await this.trackSearchResults(result.entities, query, options);
    }

    return result;
  }

  /**
   * Track access for search results.
   * @internal
   */
  private async trackSearchResults(
    entities: Entity[],
    query: string,
    options: SearchOptionsWithTracking
  ): Promise<void> {
    if (!this.accessTracker || entities.length === 0) return;

    const context: AccessContext = {
      queryContext: query,
      sessionId: options.sessionId,
      taskId: options.taskId,
      retrievalMethod: 'search',
    };

    // Batch record all results
    await Promise.all(
      entities.map((entity) => this.accessTracker!.recordAccess(entity.name, context))
    );
  }

  /** Open specific nodes by name. */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    return this.basicSearch.openNodes(names);
  }

  /** Search entities by date range. */
  async searchByDateRange(
    startDate?: string,
    endDate?: string,
    entityType?: string,
    tags?: string[]
  ): Promise<KnowledgeGraph> {
    return this.basicSearch.searchByDateRange(startDate, endDate, entityType, tags);
  }

  // ==================== Ranked Search ====================

  /** Perform TF-IDF ranked search with relevance scoring. */
  async searchNodesRanked(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    limit?: number
  ): Promise<SearchResult[]> {
    return this.rankedSearch.searchNodesRanked(query, tags, minImportance, maxImportance, limit);
  }

  // ==================== Boolean Search ====================

  /** Perform boolean search with AND, OR, NOT operators. */
  async booleanSearch(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number
  ): Promise<KnowledgeGraph> {
    return this.booleanSearcher.booleanSearch(query, tags, minImportance, maxImportance);
  }

  // ==================== Fuzzy Search ====================

  /** Perform fuzzy search with Levenshtein distance-based typo tolerance. */
  async fuzzySearch(
    query: string,
    threshold?: number,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number
  ): Promise<KnowledgeGraph> {
    return this.fuzzySearcher.fuzzySearch(query, threshold, tags, minImportance, maxImportance);
  }

  // ==================== Search Suggestions ====================

  /** Get search suggestions for a query. */
  async getSearchSuggestions(query: string, maxSuggestions?: number): Promise<string[]> {
    return this.searchSuggestions.getSearchSuggestions(query, maxSuggestions);
  }

  // ==================== Saved Searches ====================

  /** Save a search query for later reuse. */
  async saveSearch(
    search: Omit<SavedSearch, 'createdAt' | 'useCount' | 'lastUsed'>
  ): Promise<SavedSearch> {
    return this.savedSearchManager.saveSearch(search);
  }

  /** List all saved searches. */
  async listSavedSearches(): Promise<SavedSearch[]> {
    return this.savedSearchManager.listSavedSearches();
  }

  /** Get a saved search by name. */
  async getSavedSearch(name: string): Promise<SavedSearch | null> {
    return this.savedSearchManager.getSavedSearch(name);
  }

  /** Execute a saved search by name. */
  async executeSavedSearch(name: string): Promise<KnowledgeGraph> {
    return this.savedSearchManager.executeSavedSearch(name);
  }

  /** Delete a saved search. */
  async deleteSavedSearch(name: string): Promise<boolean> {
    return this.savedSearchManager.deleteSavedSearch(name);
  }

  /** Update a saved search. */
  async updateSavedSearch(
    name: string,
    updates: Partial<Omit<SavedSearch, 'name' | 'createdAt' | 'useCount' | 'lastUsed'>>
  ): Promise<SavedSearch> {
    return this.savedSearchManager.updateSavedSearch(name, updates);
  }

  // ==================== Automatic Search ====================

  /** Automatically select and execute the best search method based on query analysis. */
  async autoSearch(query: string, limit: number = 10): Promise<AutoSearchResult> {
    const startTime = Date.now();

    // Get entity count from graph
    const graph = await this.storage.loadGraph();
    const entityCount = graph.entities.length;

    // Get cost estimates for all methods
    const estimates = this.queryEstimator.estimateAllMethods(query, entityCount);

    // Get the recommended method
    const recommendation = this.queryEstimator.recommendMethod(query, entityCount);
    const selectedMethod = recommendation.method;
    const selectionReason = recommendation.reason;

    // Execute the selected search method
    let results: SearchResult[];

    switch (selectedMethod) {
      case 'basic': {
        const basicResult = await this.basicSearch.searchNodes(query);
        results = basicResult.entities.map((e: Entity, idx: number) => ({
          entity: e,
          score: 1.0 - idx * 0.01, // Rank by position
          matchedFields: { name: true, observations: e.observations },
        }));
        break;
      }

      case 'ranked': {
        results = await this.rankedSearch.searchNodesRanked(query, undefined, undefined, undefined, limit);
        break;
      }

      case 'boolean': {
        const booleanResult = await this.booleanSearcher.booleanSearch(query);
        results = booleanResult.entities.map((e: Entity, idx: number) => ({
          entity: e,
          score: 1.0 - idx * 0.01, // Rank by position
          matchedFields: { name: true, observations: e.observations },
        }));
        break;
      }

      case 'fuzzy': {
        const fuzzyResult = await this.fuzzySearcher.fuzzySearch(query);
        results = fuzzyResult.entities.map((e: Entity, idx: number) => ({
          entity: e,
          score: 1.0 - idx * 0.01, // Rank by position
          matchedFields: { name: true, observations: e.observations },
        }));
        break;
      }

      case 'semantic': {
        // Semantic search not available through SearchManager
        // Fall back to ranked search
        results = await this.rankedSearch.searchNodesRanked(query, undefined, undefined, undefined, limit);
        break;
      }

      default: {
        const _exhaustiveCheck: never = selectedMethod;
        throw new Error(`Unknown search method: ${_exhaustiveCheck}`);
      }
    }

    // Limit results
    const limitedResults = results.slice(0, limit);

    return {
      selectedMethod,
      selectionReason,
      estimates,
      results: limitedResults,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /** Get cost estimates for all search methods. */
  async getSearchCostEstimates(query: string): Promise<import('../types/index.js').QueryCostEstimate[]> {
    const graph = await this.storage.loadGraph();
    const entityCount = graph.entities.length;
    return this.queryEstimator.estimateAllMethods(query, entityCount);
  }

}
