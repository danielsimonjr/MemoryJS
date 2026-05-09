/**
 * Index Health Monitor
 *
 * Phase 0 step 6: aggregator that collects per-index `IndexHealthSnapshot`s
 * and returns a uniform report. Designed to be a sub-component of
 * `ctx.diagnostics()` (Phase 1 step 17) — `diagnostics` will compose over
 * `indexHealth` rather than redefining its shape.
 *
 * @module utils/IndexHealthMonitor
 */

import type { IndexHealthSnapshot } from './IIndexHealth.js';

/**
 * Aggregate health report covering every index `ManagerContext` knows about.
 *
 * Currently surfaces TF-IDF (via `RankedSearch`), the optional optimised
 * inverted index (when callers attach one), and an embedding placeholder.
 * The shape is intentionally permissive — additional fields may be added
 * without breaking callers as new indexes come online.
 */
export interface IndexHealthReport {
  /** TF-IDF index health (always present; warnings if disabled). */
  tfidf: IndexHealthSnapshot;
  /** Optimised inverted index health (omitted when none is attached). */
  inverted?: IndexHealthSnapshot;
  /** Embedding subsystem health (omitted when no provider configured). */
  embedding?: IndexHealthSnapshot;
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
}

/**
 * Sources the monitor reads. Each is optional so callers can wire only the
 * subsystems they have available.
 */
export interface IndexHealthSources {
  /** Object exposing `getIndexHealth()` — typically a `RankedSearch`. */
  rankedSearch?: { getIndexHealth(): IndexHealthSnapshot };
  /** An optional `OptimizedInvertedIndex` instance. */
  invertedIndex?: { health(): IndexHealthSnapshot };
  /** An optional embedding-provider snapshot supplier. */
  embeddingHealth?: () => IndexHealthSnapshot;
}

/**
 * Collects health snapshots from configured index sources.
 *
 * @example
 * ```typescript
 * const monitor = new IndexHealthMonitor({
 *   rankedSearch: ctx.rankedSearch,
 * });
 * const report = monitor.report();
 * console.log(report.tfidf.documentCount);
 * ```
 */
export class IndexHealthMonitor {
  constructor(private sources: IndexHealthSources) {}

  /**
   * Produce a fresh aggregate report. Cheap — just reads existing in-memory
   * state from each source. Safe to call from a hot path.
   */
  report(): IndexHealthReport {
    const generatedAt = new Date().toISOString();
    const tfidf: IndexHealthSnapshot = this.sources.rankedSearch
      ? this.sources.rankedSearch.getIndexHealth()
      : {
          name: 'tfidf',
          initialized: false,
          documentCount: 0,
          warnings: ['no rankedSearch attached'],
        };

    const report: IndexHealthReport = { tfidf, generatedAt };
    if (this.sources.invertedIndex) {
      report.inverted = this.sources.invertedIndex.health();
    }
    if (this.sources.embeddingHealth) {
      report.embedding = this.sources.embeddingHealth();
    }
    return report;
  }
}
