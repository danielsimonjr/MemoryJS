/**
 * Row-Level Filter
 *
 * Phase 5 step 54 (§14.1) — entity-level filtering driven by subject
 * attributes. Plug between any entity-list source and the caller to
 * enforce tenant isolation, owner-scoped reads, or classification
 * caps without changing the underlying storage layer.
 *
 * **No external deps.** Pure TS predicate composition.
 *
 * @module security/RowLevelFilter
 * @experimental Predicate shape and the `RowLevelFilter.combine`
 *   composition rules may grow new built-ins (e.g. `byTag`) in
 *   non-breaking ways.
 */

import type { Entity, Relation } from '../types/types.js';

/** A predicate that decides whether `subject` may see `row`. */
export type RowPredicate<TRow> = (subject: Record<string, unknown>, row: TRow) => boolean;

/**
 * Composable row-level filter. Predicates are AND-ed together so
 * stacking `byTenant` + `byClassificationCap` produces the strictest
 * union.
 *
 * @example
 * ```typescript
 * const filter = RowLevelFilter.entities()
 *   .add(RowLevelFilter.byTenant('tenantId'))
 *   .add(RowLevelFilter.byClassificationCap('clearance', 'classification', RANKING));
 *
 * const visible = filter.apply({ tenantId: 't1', clearance: 'secret' }, allEntities);
 * ```
 */
export class RowLevelFilter<TRow> {
  private readonly predicates: RowPredicate<TRow>[] = [];

  static entities(): RowLevelFilter<Entity> {
    return new RowLevelFilter<Entity>();
  }

  static relations(): RowLevelFilter<Relation> {
    return new RowLevelFilter<Relation>();
  }

  add(predicate: RowPredicate<TRow>): this {
    this.predicates.push(predicate);
    return this;
  }

  /** Apply all registered predicates (AND) to `rows`. */
  apply(subject: Record<string, unknown>, rows: TRow[]): TRow[] {
    if (this.predicates.length === 0) return rows.slice();
    return rows.filter((row) => this.predicates.every((p) => p(subject, row)));
  }

  /** True when a single row passes every predicate. */
  permits(subject: Record<string, unknown>, row: TRow): boolean {
    return this.predicates.every((p) => p(subject, row));
  }

  // ==================== Built-in predicates ====================

  /**
   * Allow rows whose `attribute` equals the subject's `attribute`.
   * If the row carries no value for the attribute, deny by default
   * (callers can opt into permissive behavior via `denyOnMissing: false`).
   *
   * Use for: tenant isolation, owner-scoped reads.
   */
  static byAttribute<TRow extends Record<string, unknown>>(
    attribute: string,
    options: { denyOnMissing?: boolean } = {},
  ): RowPredicate<TRow> {
    const denyOnMissing = options.denyOnMissing ?? true;
    return (subject, row) => {
      const subjVal = subject[attribute];
      const rowVal = row[attribute];
      if (rowVal === undefined) return !denyOnMissing;
      return subjVal === rowVal;
    };
  }

  /** Sugar for the common `tenantId` case. */
  static byTenant<TRow extends Record<string, unknown>>(
    attribute = 'tenantId',
  ): RowPredicate<TRow> {
    return RowLevelFilter.byAttribute<TRow>(attribute);
  }

  /**
   * Cap row visibility by classification level. `ranking` describes
   * the ordering — e.g. `['public', 'internal', 'classified', 'secret']`.
   * The subject's clearance must be >= the row's classification.
   */
  static byClassificationCap<TRow extends Record<string, unknown>>(
    subjectAttr: string,
    rowAttr: string,
    ranking: readonly string[],
  ): RowPredicate<TRow> {
    const rankOf = new Map<string, number>();
    ranking.forEach((level, i) => rankOf.set(level, i));
    return (subject, row) => {
      const subjLevel = subject[subjectAttr] as string | undefined;
      const rowLevel = row[rowAttr] as string | undefined;
      if (!rowLevel) return true; // unclassified rows pass through
      if (!subjLevel) return false;
      const sub = rankOf.get(subjLevel);
      const r = rankOf.get(rowLevel);
      if (sub === undefined || r === undefined) return false;
      return sub >= r;
    };
  }

  /**
   * Allow rows whose `tags` array intersects the subject's tag
   * allow-list. Useful for label-based row-level security.
   */
  static byTagOverlap(
    subjectAllowedTagsAttr: string,
    rowTagsAttr = 'tags',
  ): RowPredicate<Entity> {
    return (subject, row) => {
      const allowed = subject[subjectAllowedTagsAttr];
      const rowTags = (row as unknown as Record<string, unknown>)[rowTagsAttr];
      if (!Array.isArray(allowed) || !Array.isArray(rowTags)) return false;
      const set = new Set(allowed);
      return rowTags.some((t) => set.has(t));
    };
  }
}
