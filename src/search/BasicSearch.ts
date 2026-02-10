/**
 * Basic Search
 *
 * Simple text-based search with tag, importance, and date filters with result caching.
 *
 * @module search/BasicSearch
 */

import type { KnowledgeGraph } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { isWithinDateRange, SEARCH_LIMITS, searchCaches } from '../utils/index.js';
import { SearchFilterChain, type SearchFilters } from './SearchFilterChain.js';

/** Performs basic text search with optional filters and caching. */
export class BasicSearch {
  constructor(
    private storage: GraphStorage,
    private enableCache: boolean = true
  ) {}

  /** Search nodes by text query with optional filters and pagination. */
  async searchNodes(
    query: string,
    tags?: string[],
    minImportance?: number,
    maxImportance?: number,
    offset: number = 0,
    limit: number = SEARCH_LIMITS.DEFAULT
  ): Promise<KnowledgeGraph> {
    // Check cache first
    if (this.enableCache) {
      const cacheKey = { query, tags, minImportance, maxImportance, offset, limit };
      const cached = searchCaches.basic.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const graph = await this.storage.loadGraph();
    const queryLower = query.toLowerCase();

    // First filter by text match (search-specific)
    // OPTIMIZED: Uses pre-computed lowercase cache to avoid repeated toLowerCase() calls
    const textMatched = graph.entities.filter(e => {
      const lowercased = this.storage.getLowercased(e.name);
      if (lowercased) {
        return (
          lowercased.name.includes(queryLower) ||
          lowercased.entityType.includes(queryLower) ||
          lowercased.observations.some(o => o.includes(queryLower))
        );
      }
      // Fallback for entities not in cache (shouldn't happen in normal use)
      return (
        e.name.toLowerCase().includes(queryLower) ||
        e.entityType.toLowerCase().includes(queryLower) ||
        e.observations.some(o => o.toLowerCase().includes(queryLower))
      );
    });

    // Apply tag and importance filters using SearchFilterChain
    const filters: SearchFilters = { tags, minImportance, maxImportance };
    const filteredEntities = SearchFilterChain.applyFilters(textMatched, filters);

    // Apply pagination using SearchFilterChain
    const pagination = SearchFilterChain.validatePagination(offset, limit);
    const paginatedEntities = SearchFilterChain.paginate(filteredEntities, pagination);

    const filteredEntityNames = new Set(paginatedEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(
      r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const result = { entities: paginatedEntities, relations: filteredRelations };

    // Cache the result
    if (this.enableCache) {
      const cacheKey = { query, tags, minImportance, maxImportance, offset, limit };
      searchCaches.basic.set(cacheKey, result);
    }

    return result;
  }

  /** Open specific nodes by name. */
  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    const graph = await this.storage.loadGraph();

    const filteredEntities = graph.entities.filter(e => names.includes(e.name));
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(
      r => filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    return { entities: filteredEntities, relations: filteredRelations };
  }

  /** Search by date range with optional filters and pagination. */
  async searchByDateRange(
    startDate?: string,
    endDate?: string,
    entityType?: string,
    tags?: string[],
    offset: number = 0,
    limit: number = SEARCH_LIMITS.DEFAULT
  ): Promise<KnowledgeGraph> {
    // Check cache first
    if (this.enableCache) {
      const cacheKey = { method: 'dateRange', startDate, endDate, entityType, tags, offset, limit };
      const cached = searchCaches.basic.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const graph = await this.storage.loadGraph();

    // First filter by date range (search-specific - uses createdAt OR lastModified)
    const dateFiltered = graph.entities.filter(e => {
      const dateToCheck = e.createdAt || e.lastModified;
      if (dateToCheck && !isWithinDateRange(dateToCheck, startDate, endDate)) {
        return false;
      }
      return true;
    });

    // Apply entity type and tag filters using SearchFilterChain
    const filters: SearchFilters = { tags, entityType };
    const filteredEntities = SearchFilterChain.applyFilters(dateFiltered, filters);

    // Apply pagination using SearchFilterChain
    const pagination = SearchFilterChain.validatePagination(offset, limit);
    const paginatedEntities = SearchFilterChain.paginate(filteredEntities, pagination);

    const filteredEntityNames = new Set(paginatedEntities.map(e => e.name));
    const filteredRelations = graph.relations.filter(r => {
      const dateToCheck = r.createdAt || r.lastModified;
      const inDateRange = !dateToCheck || isWithinDateRange(dateToCheck, startDate, endDate);
      const involvesFilteredEntities =
        filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to);

      return inDateRange && involvesFilteredEntities;
    });

    const result = { entities: paginatedEntities, relations: filteredRelations };

    // Cache the result
    if (this.enableCache) {
      const cacheKey = { method: 'dateRange', startDate, endDate, entityType, tags, offset, limit };
      searchCaches.basic.set(cacheKey, result);
    }

    return result;
  }
}
