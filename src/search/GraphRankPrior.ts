/**
 * Graph Rank Prior
 *
 * Cached graph-connectivity signal provider for search ranking. Exposes
 * PageRank and degree centrality as ranking priors so that well-connected
 * entities can be boosted over isolated ones. The full-graph computation is
 * cached and lazily invalidated on graph mutation via GraphEventEmitter
 * subscription (entity created/updated/deleted, relation created/deleted,
 * and graph saved — the latter covers manager-level batch mutations like
 * `EntityManager.createEntities` / `RelationManager.createRelations`,
 * which persist via `storage.saveGraph` and emit only `graph:saved`) —
 * recomputation happens on next access, not eagerly per event.
 *
 * Cost guard: when the graph exceeds `maxPageRankEntities` (default 50 000),
 * PageRank is skipped and the normalized signal falls back to degree
 * centrality, which is a single O(V + E) pass.
 *
 * @module search/GraphRankPrior
 * @experimental
 */

import { GraphTraversal } from '../core/GraphTraversal.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import type { GraphEventEmitter } from '../core/GraphEventEmitter.js';

/**
 * Options for {@link GraphRankPrior}.
 */
export interface GraphRankPriorOptions {
  /**
   * Entity-count threshold above which the PageRank computation is skipped
   * and the normalized connectivity signal falls back to degree centrality.
   * Default: 50 000.
   */
  maxPageRankEntities?: number;
  /** PageRank damping factor (default: 0.85). */
  dampingFactor?: number;
  /**
   * Event emitter to subscribe to for cache invalidation. When provided,
   * entity:created/updated/deleted, relation:created/deleted, and
   * graph:saved events mark the cached scores stale (lazy recompute on
   * next access). graph:saved matters because manager-level batch
   * mutations (create/delete entities and relations) persist via a full
   * `saveGraph` and emit no per-item events.
   */
  events?: GraphEventEmitter;
}

/** Default entity-count threshold for skipping PageRank. */
export const DEFAULT_MAX_PAGERANK_ENTITIES = 50_000;

/**
 * Cached full-graph connectivity scores.
 * @internal
 */
interface ConnectivityCache {
  /** Raw PageRank per entity, or null when skipped (degree-only fallback). */
  pageRank: Map<string, number> | null;
  /** Raw degree (incident relation count, both directions) per entity. */
  degree: Map<string, number>;
  /**
   * Min-max-normalized connectivity signal in [0, 1] over the whole graph.
   * Derived from PageRank when available, degree otherwise.
   */
  normalized: Map<string, number>;
}

/**
 * Provides cached graph-connectivity ranking signals (PageRank + degree).
 *
 * @example
 * ```typescript
 * const prior = new GraphRankPrior(ctx.graphTraversal, { events: storage.events });
 * const scores = await prior.getScores(['Alice', 'Bob']); // normalized [0, 1]
 * prior.dispose(); // unsubscribe from events when done
 * ```
 */
export class GraphRankPrior {
  private readonly traversal: GraphTraversal;
  private readonly maxPageRankEntities: number;
  private readonly dampingFactor: number;

  /** Cached scores, or null when stale/uncomputed. */
  private cache: ConnectivityCache | null = null;
  /** In-flight computation, deduplicating concurrent accesses. */
  private pending: Promise<ConnectivityCache> | null = null;
  private unsubscribers: Array<() => void> = [];

  /**
   * Create a new GraphRankPrior.
   *
   * @param source - A GraphTraversal instance (preferred — reuses its
   *   PageRank/degree implementations) or a GraphStorage, which is wrapped
   *   in a private GraphTraversal.
   * @param options - Threshold, damping, and event-subscription options
   */
  constructor(source: GraphTraversal | GraphStorage, options: GraphRankPriorOptions = {}) {
    this.traversal =
      source instanceof GraphTraversal ? source : new GraphTraversal(source);
    this.maxPageRankEntities =
      options.maxPageRankEntities !== undefined && options.maxPageRankEntities >= 0
        ? options.maxPageRankEntities
        : DEFAULT_MAX_PAGERANK_ENTITIES;
    this.dampingFactor = options.dampingFactor ?? 0.85;

    if (options.events) {
      const invalidate = (): void => this.invalidate();
      this.unsubscribers.push(
        options.events.on('entity:created', invalidate),
        options.events.on('entity:updated', invalidate),
        options.events.on('entity:deleted', invalidate),
        options.events.on('relation:created', invalidate),
        options.events.on('relation:deleted', invalidate),
        // Manager-level batch mutations (EntityManager.createEntities /
        // deleteEntities, RelationManager.createRelations / deleteRelations)
        // persist via storage.saveGraph and emit ONLY graph:saved — without
        // this subscription the prior would serve stale PageRank after any
        // manager-level mutation, on both backends.
        options.events.on('graph:saved', invalidate)
      );
    }
  }

  /**
   * Get the raw PageRank score for an entity.
   *
   * Returns 0 for unknown entities, and 0 for all entities when the graph
   * exceeded `maxPageRankEntities` (degree-only fallback — use
   * {@link getScores} for the fallback-aware normalized signal).
   */
  async getPageRank(entityName: string): Promise<number> {
    const cache = await this.ensureComputed();
    return cache.pageRank?.get(entityName) ?? 0;
  }

  /**
   * Get the raw degree (incident relation count, both directions) for an
   * entity. Returns 0 for unknown entities.
   */
  async getDegree(entityName: string): Promise<number> {
    const cache = await this.ensureComputed();
    return cache.degree.get(entityName) ?? 0;
  }

  /**
   * Get min-max-normalized connectivity scores (in [0, 1], normalized over
   * the whole graph) for the given entity names. Uses PageRank when the
   * graph is within `maxPageRankEntities`, degree centrality otherwise.
   * Unknown entities map to 0.
   */
  async getScores(names: string[]): Promise<Map<string, number>> {
    const cache = await this.ensureComputed();
    const result = new Map<string, number>();
    for (const name of names) {
      result.set(name, cache.normalized.get(name) ?? 0);
    }
    return result;
  }

  /**
   * Get the unique one-hop neighbor names of an entity (both directions).
   * Reads the live relation index — not part of the cached computation.
   */
  neighbors(entityName: string): string[] {
    const seen = new Set<string>();
    for (const { neighbor } of this.traversal.getNeighborsWithRelations(entityName, {
      direction: 'both',
    })) {
      seen.add(neighbor);
    }
    return [...seen];
  }

  /**
   * Whether the last computed signal used the degree-only fallback
   * (graph exceeded `maxPageRankEntities`). Undefined before first compute.
   */
  isDegreeFallback(): boolean | undefined {
    if (!this.cache) return undefined;
    return this.cache.pageRank === null;
  }

  /**
   * Mark the cached scores stale. The next access recomputes lazily.
   */
  invalidate(): void {
    this.cache = null;
    // Detach any in-flight computation: its result would reflect the
    // pre-mutation graph, so it must not be published as the fresh cache.
    // In-flight callers still receive that (possibly stale) result.
    this.pending = null;
  }

  /**
   * Unsubscribe from all graph events and drop cached scores. The instance
   * remains usable (scores recompute on demand) but no longer auto-invalidates.
   */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.invalidate();
  }

  /**
   * Return the cached scores, computing them if stale. Concurrent callers
   * share a single in-flight computation.
   * @internal
   */
  private ensureComputed(): Promise<ConnectivityCache> {
    if (this.cache) {
      return Promise.resolve(this.cache);
    }
    if (this.pending) {
      return this.pending;
    }
    const promise = this.compute()
      .then((result) => {
        // Publish only if this computation is still current (an invalidate()
        // during the compute clears this.pending to reject stale results).
        if (this.pending === promise) {
          this.cache = result;
          this.pending = null;
        }
        return result;
      })
      .catch((error) => {
        if (this.pending === promise) {
          this.pending = null;
        }
        throw error;
      });
    this.pending = promise;
    return promise;
  }

  /**
   * Run the full-graph connectivity computation.
   * @internal
   */
  private async compute(): Promise<ConnectivityCache> {
    // Degree centrality is a single O(V + E) pass and also yields the full
    // entity-name universe (used for the PageRank size guard).
    const degreeResult = await this.traversal.calculateDegreeCentrality('both', 0);
    const n = degreeResult.scores.size;

    // Denormalize back to raw degree counts (calculateDegreeCentrality
    // normalizes by n - 1). Math.round undoes floating-point division noise.
    const degree = new Map<string, number>();
    for (const [name, normalizedDegree] of degreeResult.scores) {
      degree.set(name, n > 1 ? Math.round(normalizedDegree * (n - 1)) : 0);
    }
    if (n === 1) {
      // Single-entity graph: normalized degree is always 0; count directly.
      for (const name of degree.keys()) {
        degree.set(
          name,
          this.traversal.getNeighborsWithRelations(name, { direction: 'both' }).length
        );
      }
    }

    let pageRank: Map<string, number> | null = null;
    if (n <= this.maxPageRankEntities) {
      const pageRankResult = await this.traversal.calculatePageRank(this.dampingFactor);
      pageRank = pageRankResult.scores;
    }

    return {
      pageRank,
      degree,
      normalized: this.minMaxNormalize(pageRank ?? degree),
    };
  }

  /**
   * Min-max normalize scores to [0, 1]. All-equal non-zero scores map to 1;
   * all-zero scores stay 0 (mirrors HybridScorer.minMaxNormalize semantics).
   * @internal
   */
  private minMaxNormalize(scores: Map<string, number>): Map<string, number> {
    const normalized = new Map<string, number>();
    if (scores.size === 0) {
      return normalized;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const score of scores.values()) {
      if (score < min) min = score;
      if (score > max) max = score;
    }

    if (max === min) {
      for (const name of scores.keys()) {
        normalized.set(name, max === 0 ? 0 : 1);
      }
      return normalized;
    }

    const range = max - min;
    for (const [name, score] of scores) {
      normalized.set(name, (score - min) / range);
    }
    return normalized;
  }
}
