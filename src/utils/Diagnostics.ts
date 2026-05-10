/**
 * Diagnostics Aggregator
 *
 * Single-call snapshot of every observability surface `ManagerContext`
 * knows about. Composes over `IndexHealthMonitor` (does NOT replace it),
 * `MemoryMonitor`, and a few cheap counters from storage / search.
 *
 * Designed to be cheap enough to call from a request handler without
 * forcing eager construction of lazy subsystems — uninitialised
 * components report `null` / "not initialised" markers instead of being
 * spun up.
 *
 * @module utils/Diagnostics
 */

import type { IndexHealthReport } from './IndexHealthMonitor.js';
import type { MemoryUsageStats } from './MemoryMonitor.js';

/**
 * Counts that can be derived without loading the graph (when storage
 * already has them cached) or are easy to compute incrementally.
 */
export interface EntityCounts {
  /** Total entity count (-1 if unknown / storage not loaded). */
  total: number;
  /** Per-entity-type counts. Empty when total === -1. */
  byType: Record<string, number>;
}

/**
 * Aggregate diagnostics report.
 */
export interface DiagnosticsReport {
  /** ISO timestamp of the snapshot. */
  generatedAt: string;
  /** Index health (TF-IDF, embedding, etc.) — same shape as `ctx.indexHealth()`. */
  indexHealth: IndexHealthReport;
  /** Memory usage breakdown. `null` if MemoryMonitor was not provided. */
  memory: MemoryUsageStats | null;
  /** Entity counts (cheap; returns {-1, {}} when storage is not loaded). */
  entityCounts: EntityCounts;
  /** Query-logger summary. `null` when query logging is disabled. */
  queryStats: { totalLogged: number; level: string; logFile: string | null } | null;
  /** Cache hit rates per cache name (e.g. tfidf, fuzzy). Empty when none. */
  cacheHitRates: Record<string, { hits: number; misses: number; hitRate: number }>;
}

/**
 * Sources the aggregator reads. All optional so callers can wire only
 * what they have available.
 */
export interface DiagnosticsSources {
  /** Provider for the index-health sub-report. */
  indexHealth: () => IndexHealthReport;
  /** Provider for memory stats. Optional. */
  memory?: () => MemoryUsageStats | null;
  /** Provider for entity counts. Optional. */
  entityCounts?: () => EntityCounts;
  /** Provider for query-logger summary. Optional. */
  queryStats?: () => DiagnosticsReport['queryStats'];
  /** Provider for cache hit rates. Optional. */
  cacheHitRates?: () => DiagnosticsReport['cacheHitRates'];
}

/**
 * Compose diagnostics from a set of source callbacks. Side-effect-free —
 * each callback fires once per `report()` call.
 */
export class DiagnosticsAggregator {
  constructor(private sources: DiagnosticsSources) {}

  report(): DiagnosticsReport {
    return {
      generatedAt: new Date().toISOString(),
      indexHealth: this.sources.indexHealth(),
      memory: this.sources.memory ? this.sources.memory() : null,
      entityCounts: this.sources.entityCounts
        ? this.sources.entityCounts()
        : { total: -1, byType: {} },
      queryStats: this.sources.queryStats ? this.sources.queryStats() : null,
      cacheHitRates: this.sources.cacheHitRates ? this.sources.cacheHitRates() : {},
    };
  }
}
