/**
 * LLM Search Executor
 *
 * Takes a StructuredQuery (produced by LLMQueryPlanner) and executes it
 * against the search infrastructure, combining and deduplicating results.
 *
 * @module search/LLMSearchExecutor
 */

import type { Entity, ReadonlyKnowledgeGraph } from '../types/index.js';
import type { EvidencePath, EvidencePathOptions } from '../types/search.js';
import type { SearchManager } from './SearchManager.js';
import type { StructuredQuery } from './LLMQueryPlanner.js';
import { EvidencePathBuilder, type EvidenceAnchor } from './EvidencePathBuilder.js';

/**
 * Structural graph provider for evidence-path construction (R2).
 * `GraphStorage` satisfies this interface.
 */
export interface ExecutorGraphSource {
  loadGraph(): Promise<ReadonlyKnowledgeGraph>;
}

/**
 * Options for LLMSearchExecutor.
 */
export interface LLMSearchExecutorOptions {
  /** Fallback result limit when StructuredQuery does not specify one */
  defaultLimit?: number;
  /**
   * R2: graph source used to build evidence paths when `explain: true` is
   * requested per call and no per-call graph snapshot is provided.
   */
  graphSource?: ExecutorGraphSource;
}

/**
 * Per-execution options (R2 explain threading).
 */
export interface LLMExecuteOptions {
  /** R2: annotate each result with the evidence paths that derived it. */
  explain?: boolean;
  /** Caps for evidence-path construction (maxDepth, maxPathsPerResult). */
  explainOptions?: EvidencePathOptions;
  /**
   * Graph snapshot to trace paths over; takes precedence over the
   * constructor's `graphSource`. Without either, explain mode returns
   * results with empty evidence (graceful degradation).
   */
  graph?: ReadonlyKnowledgeGraph;
}

/**
 * An entity result annotated with its R2 evidence paths.
 */
export interface ExplainedEntityResult {
  /** The matched entity */
  entity: Entity;
  /** Graph paths from the query's filter-matched anchors to this entity */
  evidencePaths: EvidencePath[];
  /** True when evidence-path caps (maxDepth/maxPathsPerResult) bit */
  evidenceTruncated: boolean;
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
  private readonly graphSource?: ExecutorGraphSource;

  constructor(searchManager: SearchManager, options: LLMSearchExecutorOptions = {}) {
    this.searchManager = searchManager;
    this.defaultLimit = options.defaultLimit ?? 20;
    this.graphSource = options.graphSource;
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
   * R2: with `options.explain: true`, each result is wrapped as an
   * {@link ExplainedEntityResult} carrying the evidence paths from the
   * query's filter-matched anchor entities (date-range matches → symbolic,
   * keyword matches → lexical) to the result. The keyword-search fallback
   * path (ranked → basic) contributes anchors the same way.
   *
   * @param query - Structured query to execute
   * @param options - Optional per-call options (explain threading)
   * @returns Deduplicated array of matching entities (annotated results in
   *   explain mode)
   */
  async execute(query: StructuredQuery): Promise<Entity[]>;
  async execute(
    query: StructuredQuery,
    options: LLMExecuteOptions & { explain: true }
  ): Promise<ExplainedEntityResult[]>;
  async execute(query: StructuredQuery, options?: LLMExecuteOptions): Promise<Entity[]>;
  async execute(
    query: StructuredQuery,
    options: LLMExecuteOptions = {}
  ): Promise<Entity[] | ExplainedEntityResult[]> {
    const limit = query.limit ?? this.defaultLimit;
    const collectedEntities = new Map<string, Entity>();
    // R2: anchor bookkeeping — which filter matched each collected entity.
    const anchorMap = new Map<string, EvidenceAnchor>();

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
        anchorMap.set(entity.name, { name: entity.name, viaLayer: 'symbolic' });
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
          // Term matches take anchor precedence over metadata matches.
          anchorMap.set(result.entity.name, {
            name: result.entity.name,
            viaLayer: 'lexical',
            score: result.score,
          });
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
          anchorMap.set(entity.name, { name: entity.name, viaLayer: 'lexical' });
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
    const limited = results.slice(0, limit);

    if (options.explain !== true) {
      return limited;
    }

    // ── 6. R2: evidence-path annotation ──────────────────────────────────────
    const graph =
      options.graph ?? (this.graphSource ? await this.graphSource.loadGraph() : undefined);
    if (!graph) {
      // No graph available: degrade gracefully with empty evidence.
      return limited.map(entity => ({
        entity,
        evidencePaths: [],
        evidenceTruncated: false,
      }));
    }

    const builder = new EvidencePathBuilder(graph, options.explainOptions);
    const anchors = Array.from(anchorMap.values());
    return limited.map(entity => {
      const { paths, truncated } = builder.buildForResult(entity.name, anchors);
      return { entity, evidencePaths: paths, evidenceTruncated: truncated };
    });
  }
}
