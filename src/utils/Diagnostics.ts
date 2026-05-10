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
export interface DiagnosticsReport {
  generatedAt: string;
  indexHealth: IndexHealthReport;
  entityCounts: EntityCounts;
}

/**
 * Build a diagnostics snapshot. Each callback fires once per call.
 */
export function buildDiagnosticsReport(
  indexHealth: () => IndexHealthReport,
  entityCounts: () => EntityCounts,
): DiagnosticsReport {
  return {
    generatedAt: new Date().toISOString(),
    indexHealth: indexHealth(),
    entityCounts: entityCounts(),
  };
}
