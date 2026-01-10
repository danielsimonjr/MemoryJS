/**
 * Symbolic Search Layer
 *
 * Phase 11: Provides metadata-based filtering using structured predicates.
 * Part of the three-layer hybrid search architecture.
 *
 * @module search/SymbolicSearch
 */

import type { Entity, SymbolicFilters } from '../types/index.js';

/**
 * Result from symbolic search with match score.
 */
export interface SymbolicResult {
  entity: Entity;
  score: number;
  matchedFilters: string[];
}

/**
 * Symbolic Search provides metadata-based filtering.
 *
 * Filters entities using structured predicates on tags, types,
 * dates, importance, and hierarchy.
 *
 * @example
 * ```typescript
 * const symbolic = new SymbolicSearch();
 * const results = symbolic.search(entities, {
 *   tags: ['important'],
 *   entityTypes: ['person'],
 *   importance: { min: 5 }
 * });
 * ```
 */
export class SymbolicSearch {
  /**
   * Filter entities using structured metadata predicates.
   * All filters are AND-combined.
   *
   * @param entities - Entities to filter
   * @param filters - Symbolic filter criteria
   * @returns Filtered entities with match scores
   */
  search(entities: readonly Entity[], filters: SymbolicFilters): SymbolicResult[] {
    const results: SymbolicResult[] = [];

    for (const entity of entities) {
      const { matches, score, matchedFilters } = this.evaluateFilters(entity, filters);
      if (matches) {
        results.push({ entity, score, matchedFilters });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Evaluate all filters against an entity.
   */
  private evaluateFilters(
    entity: Entity,
    filters: SymbolicFilters
  ): { matches: boolean; score: number; matchedFilters: string[] } {
    const matchedFilters: string[] = [];
    let totalFilters = 0;
    let matchedCount = 0;

    // Tag filter
    if (filters.tags && filters.tags.length > 0) {
      totalFilters++;
      const entityTags = entity.tags ?? [];
      const matchingTags = filters.tags.filter((t: string) =>
        entityTags.some((et: string) => et.toLowerCase() === t.toLowerCase())
      );
      if (matchingTags.length > 0) {
        matchedCount++;
        matchedFilters.push(`tags:${matchingTags.join(',')}`);
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // Entity type filter
    if (filters.entityTypes && filters.entityTypes.length > 0) {
      totalFilters++;
      if (filters.entityTypes.some((t: string) =>
        t.toLowerCase() === entity.entityType.toLowerCase()
      )) {
        matchedCount++;
        matchedFilters.push(`type:${entity.entityType}`);
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // Date range filter
    if (filters.dateRange) {
      totalFilters++;
      const entityDate = entity.createdAt || entity.lastModified;
      if (!entityDate) {
        // Entities without dates are excluded when date filter is applied
        return { matches: false, score: 0, matchedFilters: [] };
      }
      const date = new Date(entityDate);
      const start = filters.dateRange.start ? new Date(filters.dateRange.start) : null;
      const end = filters.dateRange.end ? new Date(filters.dateRange.end) : null;

      const inRange = (!start || date >= start) && (!end || date <= end);
      if (inRange) {
        matchedCount++;
        matchedFilters.push('dateRange');
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // Importance filter
    if (filters.importance) {
      totalFilters++;
      const importance = entity.importance ?? 5;
      const { min, max } = filters.importance;
      const inRange = (min === undefined || importance >= min) &&
                     (max === undefined || importance <= max);
      if (inRange) {
        matchedCount++;
        matchedFilters.push(`importance:${importance}`);
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // Parent filter
    if (filters.parentId !== undefined) {
      totalFilters++;
      if (entity.parentId === filters.parentId) {
        matchedCount++;
        matchedFilters.push(`parent:${filters.parentId}`);
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // Has observations filter
    if (filters.hasObservations !== undefined) {
      totalFilters++;
      const hasObs = entity.observations.length > 0;
      if (hasObs === filters.hasObservations) {
        matchedCount++;
        matchedFilters.push('hasObservations');
      } else {
        return { matches: false, score: 0, matchedFilters: [] };
      }
    }

    // If no filters specified, match all with base score
    if (totalFilters === 0) {
      return { matches: true, score: 0.5, matchedFilters: [] };
    }

    // Score based on proportion of filters matched
    const score = matchedCount / totalFilters;
    return { matches: true, score, matchedFilters };
  }

  /**
   * Get entities matching a specific tag.
   */
  byTag(entities: readonly Entity[], tag: string): Entity[] {
    return entities.filter(e =>
      e.tags?.some(t => t.toLowerCase() === tag.toLowerCase())
    );
  }

  /**
   * Get entities of a specific type.
   */
  byType(entities: readonly Entity[], entityType: string): Entity[] {
    return entities.filter(e =>
      e.entityType.toLowerCase() === entityType.toLowerCase()
    );
  }

  /**
   * Get entities within importance range.
   */
  byImportance(entities: readonly Entity[], min: number, max: number): Entity[] {
    return entities.filter(e => {
      const imp = e.importance ?? 5;
      return imp >= min && imp <= max;
    });
  }
}
