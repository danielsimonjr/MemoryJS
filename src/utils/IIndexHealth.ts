/**
 * Index Health interface.
 *
 * Phase 0 step 6: a uniform shape for surfacing per-index health snapshots.
 * Intentionally minimal — `IndexHealthMonitor` (and later
 * `ctx.diagnostics()` in Phase 1 step 17) compose over snapshots from
 * implementers.
 *
 * @module utils/IIndexHealth
 */

/**
 * A single index's health snapshot. Implementers may add provider-specific
 * fields via the `extras` bag without breaking the aggregator.
 */
export interface IndexHealthSnapshot {
  /** Stable, human-readable name e.g. 'tfidf', 'inverted', 'embedding'. */
  name: string;
  /** Whether the index has been built / loaded and is ready to query. */
  initialized: boolean;
  /** Number of documents currently indexed; -1 if unknown. */
  documentCount: number;
  /** Approximate in-memory footprint in bytes; omitted if unknown. */
  approxMemoryBytes?: number;
  /**
   * Whether the index is in sync with the underlying graph.
   * `'fresh'` = up-to-date; `'dirty'` = pending writes / needs rebuild;
   * `'unknown'` = implementer cannot determine.
   */
  staleness?: 'fresh' | 'dirty' | 'unknown';
  /** Non-fatal warnings (e.g., 'no embedding provider configured'). */
  warnings?: string[];
  /** Provider-specific extras (model name, tokenizer, etc.). */
  extras?: Record<string, unknown>;
}

/**
 * Implemented by anything that can report its current health.
 *
 * Adoption is incremental: the aggregator in `IndexHealthMonitor` probes for
 * a `health()` method via duck-typing, so non-implementers degrade gracefully.
 */
export interface IIndexHealth {
  health(): IndexHealthSnapshot;
}
