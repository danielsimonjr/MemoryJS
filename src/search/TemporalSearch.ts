/**
 * Temporal Search
 *
 * Feature 3 (Must-Have): Searches entities by creation or modification time
 * within a resolved temporal range. Works with both JSONL and SQLite backends.
 *
 * @module search/TemporalSearch
 */

import type { Entity } from '../types/index.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import type { ParsedTemporalRange } from './TemporalQueryParser.js';
import { TemporalQueryParser } from './TemporalQueryParser.js';

/**
 * Which timestamp field(s) to filter against.
 *
 * - `createdAt`: Match entities created within the range.
 * - `lastModified`: Match entities last modified within the range.
 * - `any`: Match if *either* timestamp falls within the range.
 */
export type TemporalFilterField = 'createdAt' | 'lastModified' | 'any';

/**
 * Options for temporal search.
 */
export interface TemporalSearchOptions {
  /**
   * Which timestamp field to filter on (default: `any`).
   */
  field?: TemporalFilterField;
  /**
   * If true, treat entities with no timestamps as matching (default: false).
   */
  includeUndated?: boolean;
}

/**
 * Searches entities by time range.
 *
 * Supports both JSONL and SQLite backends via the shared IGraphStorage
 * interface — all filtering is performed in-memory after loading the
 * graph, so behaviour is identical for both backends.
 *
 * @example
 * ```typescript
 * const storage = new GraphStorage('./memory.jsonl');
 * const ts = new TemporalSearch(storage);
 *
 * const range = new TemporalQueryParser()
 *   .parseTemporalExpression('last hour')!;
 *
 * const entities = await ts.searchByTimeRange(range);
 * ```
 */
export class TemporalSearch {
  private parser: TemporalQueryParser;

  constructor(private readonly storage: GraphStorage) {
    this.parser = new TemporalQueryParser();
  }

  /**
   * Return all entities whose relevant timestamp falls within `range`.
   *
   * @param range - Resolved temporal range (start inclusive, end inclusive)
   * @param options - Optional filter configuration
   * @returns Entities matching the range, sorted oldest-first by the matched timestamp
   */
  async searchByTimeRange(
    range: ParsedTemporalRange,
    options: TemporalSearchOptions = {}
  ): Promise<Entity[]> {
    const { field = 'any', includeUndated = false } = options;
    const graph = await this.storage.loadGraph();

    const matched = graph.entities.filter(entity =>
      this.entityMatchesRange(entity, range, field, includeUndated)
    );

    // Sort oldest-first by the relevant timestamp (use createdAt as primary sort key)
    matched.sort((a, b) => {
      const ta = this.pickTimestamp(a, field) ?? 0;
      const tb = this.pickTimestamp(b, field) ?? 0;
      return ta - tb;
    });

    return matched;
  }

  /**
   * Convenience method: parse a natural language string and search.
   *
   * Returns an empty array (not null) if the expression cannot be parsed.
   *
   * @param query - Natural language temporal expression
   * @param options - Optional filter configuration
   * @param referenceDate - Reference date for relative parsing (default: now)
   */
  async searchByTimeQuery(
    query: string,
    options: TemporalSearchOptions = {},
    referenceDate?: Date
  ): Promise<Entity[]> {
    const range = this.parser.parseTemporalExpression(query, referenceDate);
    if (!range) return [];
    return this.searchByTimeRange(range, options);
  }

  // ==================== Private Helpers ====================

  /**
   * Test whether an entity falls within a range.
   * @internal
   */
  private entityMatchesRange(
    entity: Entity,
    range: ParsedTemporalRange,
    field: TemporalFilterField,
    includeUndated: boolean
  ): boolean {
    const { start, end } = range;

    const createdAt = entity.createdAt ? new Date(entity.createdAt) : null;
    const lastModified = entity.lastModified ? new Date(entity.lastModified) : null;

    const checkDate = (d: Date | null): boolean | null => {
      if (!d) return null; // unknown
      return d >= start && d <= end;
    };

    const createdInRange = checkDate(createdAt);
    const modifiedInRange = checkDate(lastModified);

    switch (field) {
      case 'createdAt':
        if (createdInRange === null) return includeUndated;
        return createdInRange;

      case 'lastModified':
        if (modifiedInRange === null) return includeUndated;
        return modifiedInRange;

      case 'any':
      default: {
        // At least one field must be present and in range
        const hasAny = createdInRange !== null || modifiedInRange !== null;
        if (!hasAny) return includeUndated;
        return createdInRange === true || modifiedInRange === true;
      }
    }
  }

  /**
   * Get the effective numeric timestamp for sorting.
   * @internal
   */
  private pickTimestamp(entity: Entity, field: TemporalFilterField): number | null {
    if (field === 'lastModified') {
      const d = entity.lastModified ? new Date(entity.lastModified).getTime() : null;
      return d;
    }
    // createdAt or any → prefer createdAt
    const d = entity.createdAt
      ? new Date(entity.createdAt).getTime()
      : entity.lastModified
        ? new Date(entity.lastModified).getTime()
        : null;
    return d;
  }
}
