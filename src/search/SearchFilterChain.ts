/**
 * Search Filter Chain
 *
 * Centralizes filter logic for all search implementations to eliminate
 * duplicate filtering code across BasicSearch, BooleanSearch, FuzzySearch,
 * and RankedSearch.
 *
 * @module search/SearchFilterChain
 */

import type { Entity, EntityStatus } from '../types/index.js';
import { DEFAULT_ENTITY_STATUS } from '../core/EntityStateMachine.js';
import {
  normalizeTags,
  hasMatchingTag,
  isWithinImportanceRange,
  entityPassesFilters as passesCommonFilters,
  validatePagination,
  applyPagination,
  type ValidatedPagination,
} from '../utils/index.js';

/**
 * Returns the bound when it parses as a date. Returns undefined for an
 * empty or unparseable bound, so that the bound does not filter.
 */
function parseableBound(bound: string | undefined): string | undefined {
  return bound && !isNaN(new Date(bound).getTime()) ? bound : undefined;
}

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
  /** Project scope (exact match). Undefined = match all projects. */
  projectId?: string;
  /** Include superseded entity versions (isLatest=false). Default false. */
  includeSuperseded?: boolean;
  /**
   * Allowed entity lifecycle statuses. When omitted, defaults to
   * `['published']` — drafts and archived entities are excluded from
   * search results unless the caller opts in. Pass
   * `['draft', 'published', 'archived']` to include everything.
   */
  lifecycleStatus?: ReadonlyArray<EntityStatus>;
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

    // A date bound that is set but unparseable is ignored. An entity with no
    // date, or with an unparseable date, fails when any bound is set.
    if (filters.createdAfter || filters.createdBefore) {
      if (!entity.createdAt || isNaN(new Date(entity.createdAt).getTime())) {
        return false;
      }
    }
    if (filters.modifiedAfter || filters.modifiedBefore) {
      if (!entity.lastModified || isNaN(new Date(entity.lastModified).getTime())) {
        return false;
      }
    }

    // Importance, entity type and date ranges
    if (!passesCommonFilters(entity, {
      minImportance: filters.minImportance,
      maxImportance: filters.maxImportance,
      entityType: filters.entityType,
      createdAfter: parseableBound(filters.createdAfter),
      createdBefore: parseableBound(filters.createdBefore),
      modifiedAfter: parseableBound(filters.modifiedAfter),
      modifiedBefore: parseableBound(filters.modifiedBefore),
    })) {
      return false;
    }

    // Project scope filter
    if (filters.projectId !== undefined && entity.projectId !== filters.projectId) {
      return false;
    }

    // Versioning filter: exclude superseded entities by default
    if (!filters.includeSuperseded && entity.isLatest === false) {
      return false;
    }

    // Lifecycle-status filter: defaults to the entity-state-machine
    // default status only. Entities created before lifecycleStatus
    // existed (undefined) take the same default for back-compat.
    const allowedStatuses = filters.lifecycleStatus ?? [DEFAULT_ENTITY_STATUS];
    const effective = entity.lifecycleStatus ?? DEFAULT_ENTITY_STATUS;
    if (!allowedStatuses.includes(effective)) {
      return false;
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
      filters.modifiedBefore ||
      filters.projectId !== undefined ||
      // The lifecycle-status filter is always implicitly active (defaults
      // to ['published']); only count an explicit caller-supplied value.
      filters.lifecycleStatus !== undefined
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
