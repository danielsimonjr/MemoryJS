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
  private basicSearch: BasicSearch;
  private rankedSearch: RankedSearch;
  private booleanSearcher: BooleanSearch;
  private fuzzySearcher: FuzzySearch;
  private searchSuggestions: SearchSuggestions;
  private savedSearchManager: SavedSearchManager;
  private storage: GraphStorage;
  private queryEstimator: QueryCostEstimator;
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

  /**
   * Perform a simple text-based search across entity names and observations.
   *
   * This is the primary search method that searches through entity names,
   * observations, and types using case-insensitive substring matching.
   * Optionally filter by tags and importance range.
   *
   * @param query - Text to search for (case-insensitive, searches names/observations/types)
   * @param tags - Optional array of tags to filter results (lowercase)
   * @param minImportance - Optional minimum importance value (0-10)
   * @param maxImportance - Optional maximum importance value (0-10)
   * @returns KnowledgeGraph containing matching entities and their relations
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Simple text search
   * const results = await manager.searchNodes('Alice');
   *
   * // Search with tag filter
   * const engineeringResults = await manager.searchNodes('project', ['engineering']);
   *
   * // Search with importance range
   * const importantResults = await manager.searchNodes('critical', undefined, 8, 10);
   *
   * // Combined filters
   * const filtered = await manager.searchNodes('bug', ['backend'], 5, 10);
   *
   * // Search with access tracking enabled
   * const tracked = await manager.searchNodes('Alice', undefined, undefined, undefined, {
   *   trackAccess: true,
   *   sessionId: 'session_123'
   * });
   * ```
   */
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

  /**
   * Open specific nodes by name.
   *
   * @param names - Array of entity names
   * @returns Knowledge graph with specified entities
   */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    return this.basicSearch.openNodes(names);
  }

  /**
   * Search by date range.
   *
   * @param startDate - Optional start date (ISO 8601)
   * @param endDate - Optional end date (ISO 8601)
   * @param entityType - Optional entity type filter
   * @param tags - Optional tags filter
   * @returns Filtered knowledge graph
   */
  async searchByDateRange(
    startDate?: string,
    endDate?: string,
    entityType?: string,
    tags?: string[]
  ): Promise<KnowledgeGraph> {
    return this.basicSearch.searchByDateRange(startDate, endDate, entityType, tags);
  }

  // ==================== Ranked Search ====================

  /**
   * Perform TF-IDF ranked search with relevance scoring.
   *
   * Uses Term Frequency-Inverse Document Frequency algorithm to rank results
   * by relevance to the query. Results are sorted by score (highest first).
   * This is ideal for finding the most relevant entities for a search query.
   *
   * @param query - Search query (analyzed for term frequency)
   * @param tags - Optional array of tags to filter results (lowercase)
   * @param minImportance - Optional minimum importance value (0-10)
   * @param maxImportance - Optional maximum importance value (0-10)
   * @param limit - Maximum number of results to return (default: 50, max: 200)
   * @returns Array of SearchResult objects sorted by relevance score (descending)
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Basic ranked search
   * const results = await manager.searchNodesRanked('machine learning algorithms');
   * results.forEach(r => {
   *   console.log(`${r.entity.name} (score: ${r.score})`);
   * });
   *
   * // Limit to top 10 most relevant results
   * const top10 = await manager.searchNodesRanked('database optimization', undefined, undefined, undefined, 10);
   *
   * // Ranked search with filters
   * const relevantImportant = await manager.searchNodesRanked(
   *   'security vulnerability',
   *   ['security', 'critical'],
   *   8,
   *   10,
   *   20
   * );
   * ```
   */
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

  /**
   * Perform boolean search with AND, OR, NOT operators.
   *
   * Supports complex boolean logic for precise search queries.
   * Use AND/OR/NOT operators (case-insensitive) to combine search terms.
   * Parentheses are supported for grouping.
   *
   * @param query - Boolean query string (e.g., "alice AND bob", "frontend OR backend NOT legacy")
   * @param tags - Optional array of tags to filter results (lowercase)
   * @param minImportance - Optional minimum importance value (0-10)
   * @param maxImportance - Optional maximum importance value (0-10)
   * @returns KnowledgeGraph containing entities matching the boolean expression
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // AND operator - entities matching all terms
   * const both = await manager.booleanSearch('database AND performance');
   *
   * // OR operator - entities matching any term
   * const either = await manager.booleanSearch('frontend OR backend');
   *
   * // NOT operator - exclude terms
   * const excluding = await manager.booleanSearch('API NOT deprecated');
   *
   * // Complex queries with grouping
   * const complex = await manager.booleanSearch('(react OR vue) AND (component OR hook) NOT legacy');
   * ```
   */
  async booleanSearch(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number
  ): Promise<KnowledgeGraph> {
    return this.booleanSearcher.booleanSearch(query, tags, minImportance, maxImportance);
  }

  // ==================== Fuzzy Search ====================

  /**
   * Perform fuzzy search with typo tolerance.
   *
   * Uses Levenshtein distance to find entities that approximately match the query,
   * making it ideal for handling typos and variations in spelling.
   * Higher threshold values require closer matches.
   *
   * @param query - Search query (will match approximate spellings)
   * @param threshold - Similarity threshold from 0.0 (very lenient) to 1.0 (exact match). Default: 0.7
   * @param tags - Optional array of tags to filter results (lowercase)
   * @param minImportance - Optional minimum importance value (0-10)
   * @param maxImportance - Optional maximum importance value (0-10)
   * @returns KnowledgeGraph containing entities with similar names/observations
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Find entities even with typos
   * const results = await manager.fuzzySearch('databse'); // Will match "database"
   *
   * // Adjust threshold for strictness
   * const strict = await manager.fuzzySearch('optmization', 0.9); // Requires very close match
   * const lenient = await manager.fuzzySearch('optmization', 0.6); // More tolerant of differences
   *
   * // Fuzzy search with filters
   * const filtered = await manager.fuzzySearch('secrity', 0.7, ['important'], 7, 10);
   * ```
   */
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

  /**
   * Get search suggestions for a query.
   *
   * @param query - Search query
   * @param maxSuggestions - Maximum suggestions to return
   * @returns Array of suggested terms
   */
  async getSearchSuggestions(query: string, maxSuggestions?: number): Promise<string[]> {
    return this.searchSuggestions.getSearchSuggestions(query, maxSuggestions);
  }

  // ==================== Saved Searches ====================

  /**
   * Save a search query for later reuse.
   *
   * Saved searches store query parameters and can be re-executed later.
   * The system tracks usage count and last used timestamp automatically.
   *
   * @param search - Search parameters (name, query, and optional filters)
   * @returns Newly created SavedSearch object with metadata
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Save a simple search
   * const saved = await manager.saveSearch({
   *   name: 'High Priority Bugs',
   *   query: 'bug',
   *   tags: ['critical'],
   *   minImportance: 8
   * });
   *
   * // Save a complex search
   * await manager.saveSearch({
   *   name: 'Recent Frontend Work',
   *   query: 'component OR hook',
   *   tags: ['frontend', 'react'],
   *   searchType: 'boolean'
   * });
   * ```
   */
  async saveSearch(
    search: Omit<SavedSearch, 'createdAt' | 'useCount' | 'lastUsed'>
  ): Promise<SavedSearch> {
    return this.savedSearchManager.saveSearch(search);
  }

  /**
   * List all saved searches.
   *
   * @returns Array of saved searches
   */
  async listSavedSearches(): Promise<SavedSearch[]> {
    return this.savedSearchManager.listSavedSearches();
  }

  /**
   * Get a saved search by name.
   *
   * @param name - Search name
   * @returns Saved search or null
   */
  async getSavedSearch(name: string): Promise<SavedSearch | null> {
    return this.savedSearchManager.getSavedSearch(name);
  }

  /**
   * Execute a saved search by name.
   *
   * Runs a previously saved search with its stored parameters.
   * Automatically updates the search's useCount and lastUsed timestamp.
   *
   * @param name - The unique name of the saved search to execute
   * @returns KnowledgeGraph containing the search results
   * @throws Error if saved search not found
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Execute a saved search
   * const results = await manager.executeSavedSearch('High Priority Bugs');
   * console.log(`Found ${results.entities.length} high priority bugs`);
   *
   * // Handle missing saved search
   * try {
   *   await manager.executeSavedSearch('NonExistent');
   * } catch (error) {
   *   console.error('Search not found');
   * }
   * ```
   */
  async executeSavedSearch(name: string): Promise<KnowledgeGraph> {
    return this.savedSearchManager.executeSavedSearch(name);
  }

  /**
   * Delete a saved search.
   *
   * @param name - Search name
   * @returns True if deleted
   */
  async deleteSavedSearch(name: string): Promise<boolean> {
    return this.savedSearchManager.deleteSavedSearch(name);
  }

  /**
   * Update a saved search.
   *
   * @param name - Search name
   * @param updates - Fields to update
   * @returns Updated saved search
   */
  async updateSavedSearch(
    name: string,
    updates: Partial<Omit<SavedSearch, 'name' | 'createdAt' | 'useCount' | 'lastUsed'>>
  ): Promise<SavedSearch> {
    return this.savedSearchManager.updateSavedSearch(name, updates);
  }

  // ==================== Phase 10 Sprint 4: Automatic Search ====================

  /**
   * Phase 10 Sprint 4: Automatically select and execute the best search method.
   *
   * Analyzes the query and graph size to determine the optimal search method,
   * then executes it and returns both the results and the selection reasoning.
   *
   * @param query - The search query
   * @param limit - Maximum number of results (default: 10)
   * @returns AutoSearchResult with selected method, results, and estimates
   *
   * @example
   * ```typescript
   * const manager = new SearchManager(storage, savedSearchesPath);
   *
   * // Let the system choose the best search method
   * const result = await manager.autoSearch('software engineer skills');
   *
   * console.log(`Used ${result.selectedMethod} because: ${result.selectionReason}`);
   * console.log(`Found ${result.results.length} results in ${result.executionTimeMs}ms`);
   * ```
   */
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

  /**
   * Phase 10 Sprint 4: Get cost estimates for all search methods.
   *
   * Useful for clients that want to display cost information or
   * make their own method selection decisions.
   *
   * @param query - The search query
   * @returns Array of cost estimates for all methods
   */
  async getSearchCostEstimates(query: string): Promise<import('../types/index.js').QueryCostEstimate[]> {
    const graph = await this.storage.loadGraph();
    const entityCount = graph.entities.length;
    return this.queryEstimator.estimateAllMethods(query, entityCount);
  }

  /**
   * Phase 10 Sprint 4: Get the query cost estimator instance.
   *
   * @returns The QueryCostEstimator instance
   */
  getQueryEstimator(): QueryCostEstimator {
    return this.queryEstimator;
  }
}
