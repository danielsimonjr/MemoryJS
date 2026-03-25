/**
 * LLM Search Executor
 *
 * Takes a StructuredQuery (produced by LLMQueryPlanner) and executes it
 * against the search infrastructure, combining and deduplicating results.
 *
 * @module search/LLMSearchExecutor
 */

import type { Entity } from '../types/index.js';
import type { SearchManager } from './SearchManager.js';
import type { StructuredQuery } from './LLMQueryPlanner.js';

/**
 * Options for LLMSearchExecutor.
 */
export interface LLMSearchExecutorOptions {
  /** Fallback result limit when StructuredQuery does not specify one */
  defaultLimit?: number;
}

/**
 * Executes a StructuredQuery against the search infrastructure.
 *
 * Maps StructuredQuery fields to the appropriate SearchManager methods and
 * combines results with deduplication.
 *
 * @example
 * ```typescript
 * const executor = new LLMSearchExecutor(searchManager);
 * const entities = await executor.execute({
 *   keywords: ['engineer'],
 *   tags: ['backend'],
 *   importance: { min: 7, max: 10 },
 * });
 * ```
 */
export class LLMSearchExecutor {
  private readonly searchManager: SearchManager;
  private readonly defaultLimit: number;

  constructor(searchManager: SearchManager, options: LLMSearchExecutorOptions = {}) {
    this.searchManager = searchManager;
    this.defaultLimit = options.defaultLimit ?? 20;
  }

  /**
   * Execute a StructuredQuery and return deduplicated Entity results.
   *
   * Strategy:
   * 1. If a timeRange is present, run a date-range search and intersect/union.
   * 2. Run keyword searches for each keyword term.
   * 3. Apply importance and tag filters where supported.
   * 4. Deduplicate results by entity name.
   * 5. Apply limit.
   *
   * @param query - Structured query to execute
   * @returns Deduplicated array of matching entities
   */
  async execute(query: StructuredQuery): Promise<Entity[]> {
    const limit = query.limit ?? this.defaultLimit;
    const collectedEntities = new Map<string, Entity>();

    // ── 1. Date-range search ──────────────────────────────────────────────────
    if (query.timeRange) {
      const { start, end } = query.timeRange;
      const dateResult = await this.searchManager.searchByDateRange(
        start.toISOString(),
        end.toISOString(),
        undefined, // entityType post-filtered below to support multiple types
        query.tags
      );
      for (const entity of dateResult.entities) {
        collectedEntities.set(entity.name, entity);
      }
    }

    // ── 2. Keyword searches ───────────────────────────────────────────────────
    if (query.keywords.length > 0) {
      // Combine all keywords into a single query string for ranked search
      const combinedQuery = query.keywords.join(' ');
      const minImp = query.importance?.min;
      const maxImp = query.importance?.max;

      try {
        const rankedResults = await this.searchManager.searchNodesRanked(
          combinedQuery,
          query.tags,
          minImp,
          maxImp,
          limit * 2
        );
        for (const result of rankedResults) {
          collectedEntities.set(result.entity.name, result.entity);
        }
      } catch {
        // Fall back to basic search if ranked fails
        const basicResult = await this.searchManager.searchNodes(
          combinedQuery,
          query.tags,
          minImp,
          maxImp
        );
        for (const entity of basicResult.entities) {
          collectedEntities.set(entity.name, entity);
        }
      }
    }

    // ── 3. Apply entityType post-filter ───────────────────────────────────────
    let results = Array.from(collectedEntities.values());

    if (query.entityTypes && query.entityTypes.length > 0) {
      const allowedTypes = new Set(query.entityTypes.map(t => t.toLowerCase()));
      results = results.filter(e => allowedTypes.has(e.entityType.toLowerCase()));
    }

    // ── 4. Apply importance post-filter ──────────────────────────────────────
    if (query.importance) {
      const { min, max } = query.importance;
      results = results.filter(e => {
        const imp = e.importance ?? 0;
        return imp >= min && imp <= max;
      });
    }

    // ── 5. Apply limit ────────────────────────────────────────────────────────
    return results.slice(0, limit);
  }
}
