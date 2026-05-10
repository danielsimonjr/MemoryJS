/**
 * Partial Index Advisor
 *
 * Tracks the frequency of filter shapes coming through `simpleSearch` and
 * `fullTextSearch` and recommends SQLite partial indexes for the
 * patterns that exceed a support threshold. Activates only when the
 * `MEMORY_SQLITE_AUTO_INDEX` env var is set.
 *
 * v1 limits the recommendations to two index families that yield real
 * speedups against the existing `entities` schema:
 *   - `WHERE entityType = '<type>'`     (per-type partial)
 *   - `WHERE projectId = '<project>'`   (per-project partial)
 *
 * The advisor never drops user-created indexes — only ones it has
 * created itself via the `idx_advisor_*` prefix.
 *
 * @module search/PartialIndexAdvisor
 */

import type { Database as DatabaseType } from 'better-sqlite3';

/** A single filter observation. */
export interface FilterObservation {
  /** `entityType` filter, if any. */
  entityType?: string;
  /** `projectId` filter, if any. */
  projectId?: string;
}

/** A recommendation worth materialising as a partial index. */
export interface IndexRecommendation {
  /** Stable name — the advisor uses this for `CREATE INDEX IF NOT EXISTS`. */
  indexName: string;
  /** Column being indexed on the `entities` table. */
  column: 'entityType' | 'projectId';
  /** Literal value the partial index is restricted to. */
  value: string;
  /** Observed query count for this pattern. */
  support: number;
}

/** Options for the advisor. */
export interface PartialIndexAdvisorOptions {
  /** Minimum observed count before a pattern is recommended (default: 25). */
  minSupport?: number;
  /** Maximum number of advisor-managed indexes to keep live (default: 16). */
  maxIndexes?: number;
}

/**
 * Per-pattern frequency tracker plus partial-index materialiser.
 *
 * The advisor is in-memory only — the counts reset when the process
 * restarts. That's intentional: persisting them would require touching
 * the schema, and the advisor recovers within a few hundred queries
 * on a warm-up.
 */
export class PartialIndexAdvisor {
  /**
   * Whether `MEMORY_SQLITE_AUTO_INDEX` was set at construction time.
   * Both `record()` and `apply()` no-op when this is false, so callers
   * can attach an advisor unconditionally.
   */
  readonly enabled: boolean;

  private readonly typeCounts: Map<string, number> = new Map();
  private readonly projectCounts: Map<string, number> = new Map();
  private readonly liveIndexes: Set<string> = new Set();
  private readonly minSupport: number;
  private readonly maxIndexes: number;

  constructor(options: PartialIndexAdvisorOptions = {}) {
    const raw = process.env.MEMORY_SQLITE_AUTO_INDEX;
    this.enabled = raw === 'true' || raw === '1';
    this.minSupport = options.minSupport ?? 25;
    this.maxIndexes = options.maxIndexes ?? 16;
  }

  /**
   * Record a single query's filter shape. No-op when disabled.
   */
  record(observation: FilterObservation): void {
    if (!this.enabled) return;
    if (observation.entityType) {
      const v = observation.entityType;
      this.typeCounts.set(v, (this.typeCounts.get(v) ?? 0) + 1);
    }
    if (observation.projectId) {
      const v = observation.projectId;
      this.projectCounts.set(v, (this.projectCounts.get(v) ?? 0) + 1);
    }
  }

  /**
   * Compute recommendations sorted by descending support. No-op when
   * disabled. Capped at `maxIndexes` total.
   */
  recommend(): IndexRecommendation[] {
    if (!this.enabled) return [];
    const recs: IndexRecommendation[] = [];
    for (const [value, support] of this.typeCounts) {
      if (support < this.minSupport) continue;
      recs.push({
        indexName: `idx_advisor_type_${sanitize(value)}`,
        column: 'entityType',
        value,
        support,
      });
    }
    for (const [value, support] of this.projectCounts) {
      if (support < this.minSupport) continue;
      recs.push({
        indexName: `idx_advisor_project_${sanitize(value)}`,
        column: 'projectId',
        value,
        support,
      });
    }
    recs.sort((a, b) => b.support - a.support);
    return recs.slice(0, this.maxIndexes);
  }

  /**
   * Apply recommendations: create any missing partial indexes, drop any
   * advisor-managed indexes that no longer make the cut. Idempotent.
   * No-op when disabled.
   *
   * @param db - The writer-side `better-sqlite3` connection. Read-only
   *   pool connections cannot run DDL.
   * @returns Counts of indexes created and dropped.
   */
  apply(db: DatabaseType): { created: number; dropped: number } {
    if (!this.enabled) return { created: 0, dropped: 0 };

    const recs = this.recommend();
    const wanted = new Set(recs.map((r) => r.indexName));

    let created = 0;
    let dropped = 0;

    for (const rec of recs) {
      if (this.liveIndexes.has(rec.indexName)) continue;
      // Bound parameters can't appear in DDL; we sanitise the value
      // through `escapeLiteral` to prevent injection.
      const literal = escapeLiteral(rec.value);
      db.exec(
        `CREATE INDEX IF NOT EXISTS ${rec.indexName} ON entities(name) WHERE ${rec.column} = ${literal}`,
      );
      this.liveIndexes.add(rec.indexName);
      created++;
    }

    for (const name of [...this.liveIndexes]) {
      if (wanted.has(name)) continue;
      db.exec(`DROP INDEX IF EXISTS ${name}`);
      this.liveIndexes.delete(name);
      dropped++;
    }

    return { created, dropped };
  }

  /**
   * Drop every advisor-managed index. Used during teardown so we don't
   * leave orphaned `idx_advisor_*` indexes on the file across runs.
   */
  dropAll(db: DatabaseType): void {
    for (const name of this.liveIndexes) {
      db.exec(`DROP INDEX IF EXISTS ${name}`);
    }
    this.liveIndexes.clear();
  }

  /**
   * Read snapshot of advisor state — useful for `ctx.diagnostics()` and
   * for tests asserting on observed counts.
   */
  snapshot(): {
    typeCounts: Record<string, number>;
    projectCounts: Record<string, number>;
    liveIndexes: string[];
  } {
    return {
      typeCounts: Object.fromEntries(this.typeCounts),
      projectCounts: Object.fromEntries(this.projectCounts),
      liveIndexes: [...this.liveIndexes],
    };
  }
}

/** SQLite identifier-safe sanitiser for index name suffixes. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
}

/** Quote a string literal for inline use in DDL. */
function escapeLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
