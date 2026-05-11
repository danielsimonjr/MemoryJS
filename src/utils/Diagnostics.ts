/**
 * Diagnostics
 *
 * Single-call snapshot of the observability surfaces `ManagerContext`
 * exposes today: index health (composed over `IndexHealthMonitor`) plus
 * a per-type entity-count histogram derived from the in-memory cache.
 *
 * Side-effect-free — does NOT force lazy-subsystem construction.
 *
 * Intentionally narrow for v1. Memory / query-stats / cache-hit-rate
 * panels can be added when callers need them; collapsing the previous
 * 4-source aggregator until that happens.
 *
 * @module utils/Diagnostics
 * @experimental Report shape (`{ indexHealth, entityCounts }`) may
 *   gain optional fields (memory, queryStats, cacheHitRates) without
 *   a major version bump.
 */

import type { IndexHealthReport } from './IndexHealthMonitor.js';

/**
 * Per-type entity-count histogram. `total = -1` and `byType = {}` indicate
 * the storage cache was not loaded — `report()` deliberately does not
 * trigger a load to keep the call cheap.
 */
export interface EntityCounts {
  total: number;
  byType: Record<string, number>;
}

/**
 * Aggregate diagnostics report.
 */
/**
 * Phase 9 task 74: optional tier-stats snapshot from
 * `ITieredIndex.stats()`. Present when `MEMORY_TIERED_INDEX=true`
 * activated a posting-list cache; otherwise `undefined`.
 */
export interface TieredIndexStatsSnapshot {
  hits: number;
  misses: number;
  promotions: number;
  demotions: number;
  perTierHits: Record<string, number>;
  /** Convenience: hits / (hits + misses), or 0 when no traffic. */
  hitRate: number;
}

export interface DiagnosticsReport {
  generatedAt: string;
  indexHealth: IndexHealthReport;
  entityCounts: EntityCounts;
  /** Phase 9: tier stats when `ctx.tieredPostingsIndex` is active. */
  tieredIndexStats?: TieredIndexStatsSnapshot;
}

/**
 * Build a diagnostics snapshot. Each callback fires once per call.
 *
 * Phase 9 task 74: optional `tieredIndexStats` parameter lets the
 * caller (`ManagerContext.diagnostics()`) include tier hit-rate
 * stats when the tiered index is active. Omit when no tiered index
 * is configured — the field is left `undefined` in the report.
 */
export function buildDiagnosticsReport(
  indexHealth: () => IndexHealthReport,
  entityCounts: () => EntityCounts,
  tieredIndexStats?: () => TieredIndexStatsSnapshot | undefined,
): DiagnosticsReport {
  const report: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    indexHealth: indexHealth(),
    entityCounts: entityCounts(),
  };
  if (tieredIndexStats) {
    const snap = tieredIndexStats();
    if (snap !== undefined) report.tieredIndexStats = snap;
  }
  return report;
}
