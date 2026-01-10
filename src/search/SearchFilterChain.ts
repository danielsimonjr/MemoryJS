/**
 * Search Filter Chain
 *
 * Centralizes filter logic for all search implementations to eliminate
 * duplicate filtering code across BasicSearch, BooleanSearch, FuzzySearch,
 * and RankedSearch.
 *
 * @module search/SearchFilterChain
 */

import type { Entity } from '../types/index.js';
import {
  normalizeTags,
  hasMatchingTag,
  isWithinImportanceRange,
  validatePagination,
  applyPagination,
  type ValidatedPagination,
} from '../utils/index.js';

/**
 * Search filter configuration options.
 * All filters are optional - entities pass if filter is not specified.
 */
export interface SearchFilters {
  /** Tags to filter by (any match) */
  tags?: string[];
  /** Minimum importance (0-10, inclusive) */
  minImportance?: number;
  /** Maximum importance (0-10, inclusive) */
  maxImportance?: number;
  /** Entity type to filter by (exact match) */
  entityType?: string;
  /** Created after date (ISO 8601, inclusive) */
  createdAfter?: string;
  /** Created before date (ISO 8601, inclusive) */
  createdBefore?: string;
  /** Modified after date (ISO 8601, inclusive) */
  modifiedAfter?: string;
  /** Modified before date (ISO 8601, inclusive) */
  modifiedBefore?: string;
}

/**
 * Centralized filter chain for all search implementations.
 * Ensures consistent filtering behavior across search types.
 *
 * @example
 * ```typescript
 * const filters: SearchFilters = { tags: ['important'], minImportance: 5 };
 * const filtered = SearchFilterChain.applyFilters(entities, filters);
 * const pagination = SearchFilterChain.validatePagination(0, 50);
 * const result = SearchFilterChain.paginate(filtered, pagination);
 * ```
 */
export class SearchFilterChain {
  /**
   * Applies all filters to an array of entities.
   * Entities must pass ALL specified filters to be included.
   *
   * @param entities - Entities to filter
   * @param filters - Filter criteria to apply
   * @returns Filtered entities array
   */
  static applyFilters(entities: readonly Entity[], filters: SearchFilters): Entity[] {
    // Early return if no filters are active
    if (!this.hasActiveFilters(filters)) {
      return [...entities];
    }

    // Pre-normalize tags once for efficiency
    const normalizedSearchTags = filters.tags?.length
      ? normalizeTags(filters.tags)
      : undefined;

    return entities.filter(entity =>
      this.entityPassesFilters(entity, filters, normalizedSearchTags)
    );
  }

  /**
   * Checks if an entity passes all active filters.
   * Short-circuits on first failing filter for performance.
   *
   * @param entity - Entity to check
   * @param filters - Filter criteria
   * @param normalizedSearchTags - Pre-normalized search tags (for efficiency)
   * @returns true if entity passes all filters
   */
  static entityPassesFilters(
    entity: Entity,
    filters: SearchFilters,
    normalizedSearchTags?: string[]
  ): boolean {
    // Tag filter - check if entity has any matching tag
    if (normalizedSearchTags && normalizedSearchTags.length > 0) {
      if (!entity.tags || entity.tags.length === 0) {
        return false;
      }
      const entityTags = normalizeTags(entity.tags);
      const hasMatch = normalizedSearchTags.some(tag => entityTags.includes(tag));
      if (!hasMatch) {
        return false;
      }
    }

    // Importance filter
    if (!isWithinImportanceRange(entity.importance, filters.minImportance, filters.maxImportance)) {
      return false;
    }

    // Entity type filter
    if (filters.entityType && entity.entityType !== filters.entityType) {
      return false;
    }

    // Created date filter
    if (filters.createdAfter || filters.createdBefore) {
      if (!entity.createdAt) {
        return false;
      }
      const createdAt = new Date(entity.createdAt);
      if (filters.createdAfter && createdAt < new Date(filters.createdAfter)) {
        return false;
      }
      if (filters.createdBefore && createdAt > new Date(filters.createdBefore)) {
        return false;
      }
    }

    // Modified date filter
    if (filters.modifiedAfter || filters.modifiedBefore) {
      if (!entity.lastModified) {
        return false;
      }
      const modifiedAt = new Date(entity.lastModified);
      if (filters.modifiedAfter && modifiedAt < new Date(filters.modifiedAfter)) {
        return false;
      }
      if (filters.modifiedBefore && modifiedAt > new Date(filters.modifiedBefore)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Checks if any filters are actually specified.
   * Used for early return optimization.
   *
   * @param filters - Filter criteria to check
   * @returns true if at least one filter is active
   */
  static hasActiveFilters(filters: SearchFilters): boolean {
    return !!(
      (filters.tags && filters.tags.length > 0) ||
      filters.minImportance !== undefined ||
      filters.maxImportance !== undefined ||
      filters.entityType ||
      filters.createdAfter ||
      filters.createdBefore ||
      filters.modifiedAfter ||
      filters.modifiedBefore
    );
  }

  /**
   * Validates and returns pagination parameters.
   * Delegates to paginationUtils.validatePagination.
   *
   * @param offset - Starting position
   * @param limit - Maximum results
   * @returns Validated pagination object
   */
  static validatePagination(offset: number = 0, limit?: number): ValidatedPagination {
    return validatePagination(offset, limit);
  }

  /**
   * Applies pagination to a filtered result set.
   *
   * @param entities - Entities to paginate
   * @param pagination - Validated pagination parameters
   * @returns Paginated slice of entities
   */
  static paginate(entities: Entity[], pagination: ValidatedPagination): Entity[] {
    return applyPagination(entities, pagination);
  }

  /**
   * Convenience method to apply both filters and pagination in one call.
   *
   * @param entities - Entities to process
   * @param filters - Filter criteria
   * @param offset - Pagination offset
   * @param limit - Pagination limit
   * @returns Filtered and paginated entities
   */
  static filterAndPaginate(
    entities: Entity[],
    filters: SearchFilters,
    offset: number = 0,
    limit?: number
  ): Entity[] {
    const filtered = this.applyFilters(entities, filters);
    const pagination = this.validatePagination(offset, limit);
    return this.paginate(filtered, pagination);
  }

  /**
   * Applies tag filter only. Useful when other filters are handled separately.
   *
   * @param entities - Entities to filter
   * @param tags - Tags to filter by
   * @returns Filtered entities
   */
  static filterByTags(entities: Entity[], tags?: string[]): Entity[] {
    if (!tags || tags.length === 0) {
      return entities;
    }

    const normalizedTags = normalizeTags(tags);
    return entities.filter(entity => {
      if (!entity.tags || entity.tags.length === 0) {
        return false;
      }
      return hasMatchingTag(entity.tags, normalizedTags);
    });
  }

  /**
   * Applies importance filter only. Useful when other filters are handled separately.
   *
   * @param entities - Entities to filter
   * @param minImportance - Minimum importance
   * @param maxImportance - Maximum importance
   * @returns Filtered entities
   */
  static filterByImportance(
    entities: Entity[],
    minImportance?: number,
    maxImportance?: number
  ): Entity[] {
    if (minImportance === undefined && maxImportance === undefined) {
      return entities;
    }

    return entities.filter(entity =>
      isWithinImportanceRange(entity.importance, minImportance, maxImportance)
    );
  }
}

// Re-export types for convenience
export type { ValidatedPagination };
