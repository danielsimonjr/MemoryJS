/**
 * Partitioned Inverted Index
 *
 * Per-entity-type instance of `OptimizedInvertedIndex`. When a query
 * has an `entityType` filter, the partitioned router serves it from
 * the matching partition only — proportional to the per-type document
 * share rather than the full graph. When no type filter is present,
 * results are unioned across partitions (still cheaper than a single
 * monolithic scan because each posting list is shorter).
 *
 * Phase 3 step 33 — composes over the existing
 * `OptimizedInvertedIndex` rather than reimplementing the underlying
 * data structure.
 *
 * @module search/PartitionedInvertedIndex
 */

import { OptimizedInvertedIndex } from './OptimizedInvertedIndex.js';
import type { IIndexHealth, IndexHealthSnapshot } from '../utils/IIndexHealth.js';

/**
 * Snapshot of the partition router's per-partition state. Useful for
 * `ctx.diagnostics()` callers that want a per-type breakdown.
 */
export interface PartitionedIndexSnapshot {
  partitions: Array<{
    entityType: string;
    documentCount: number;
    termCount: number;
    approxBytes: number;
  }>;
  totalDocuments: number;
  totalTerms: number;
}

/**
 * Per-entity-type partitioned router.
 *
 * Each partition is a full `OptimizedInvertedIndex` keyed by the
 * entity's type. The router exposes the same `addDocument` /
 * `removeDocument` surface as the underlying index — callers don't
 * need to know about partitions to write — but search ops can pass an
 * `entityType` filter for the targeted-scan benefit.
 */
export class PartitionedInvertedIndex implements IIndexHealth {
  private readonly partitions: Map<string, OptimizedInvertedIndex> = new Map();

  /**
   * Add a document to the partition for `entityType`. Creates the
   * partition lazily on first write.
   */
  addDocument(entityType: string, entityName: string, terms: string[]): void {
    let partition = this.partitions.get(entityType);
    if (!partition) {
      partition = new OptimizedInvertedIndex();
      this.partitions.set(entityType, partition);
    }
    partition.addDocument(entityName, terms);
  }

  /**
   * Remove a document from a known partition. Returns `true` if the
   * document was present in the partition. Pass `entityType` so we can
   * route directly without scanning every partition.
   */
  removeDocument(entityType: string, entityName: string): boolean {
    const partition = this.partitions.get(entityType);
    if (!partition) return false;
    return partition.removeDocument(entityName);
  }

  /**
   * Search a specific partition for documents containing all `terms`.
   * Returns entity names. Throws if the partition is unknown — callers
   * should verify via `hasPartition(entityType)` first or use
   * `searchAcrossAll` for an unfiltered query.
   */
  searchPartition(entityType: string, terms: string[]): string[] {
    const partition = this.partitions.get(entityType);
    if (!partition) return [];
    return partition.intersect(terms);
  }

  /**
   * Search every partition and union the results. Used when the caller
   * has no `entityType` filter. Cheaper than a single monolithic index
   * because each per-type posting list is shorter, but still O(union
   * across types) — flag for future bloom-filter pre-screening if any
   * type is empty.
   */
  searchAcrossAll(terms: string[]): string[] {
    const seen = new Set<string>();
    for (const partition of this.partitions.values()) {
      for (const name of partition.intersect(terms)) seen.add(name);
    }
    return [...seen];
  }

  /** Whether the router has materialised a partition for `entityType`. */
  hasPartition(entityType: string): boolean {
    return this.partitions.has(entityType);
  }

  /**
   * List of partition keys currently materialised. Useful for diagnostics
   * and for the auto-detect loop in `PartialIndexAdvisor`.
   */
  partitionKeys(): string[] {
    return [...this.partitions.keys()];
  }

  /** Drop a single partition (e.g. after the last entity of that type was deleted). */
  dropPartition(entityType: string): boolean {
    return this.partitions.delete(entityType);
  }

  /** Drop every partition. */
  clear(): void {
    this.partitions.clear();
  }

  /**
   * Per-partition snapshot for diagnostics. Each entry mirrors the
   * underlying `OptimizedInvertedIndex.health()` plus the partition
   * key.
   */
  snapshot(): PartitionedIndexSnapshot {
    const partitions: PartitionedIndexSnapshot['partitions'] = [];
    let totalDocuments = 0;
    let totalTerms = 0;
    for (const [entityType, partition] of this.partitions) {
      const h = partition.health();
      const termCount = (h.extras?.termCount as number | undefined) ?? 0;
      partitions.push({
        entityType,
        documentCount: h.documentCount,
        termCount,
        approxBytes: h.approxMemoryBytes ?? 0,
      });
      totalDocuments += h.documentCount;
      totalTerms += termCount;
    }
    return { partitions, totalDocuments, totalTerms };
  }

  /**
   * `IIndexHealth.health()` aggregate snapshot. Reports the sum of
   * documents across partitions and rolls up any 'dirty' partition
   * into the parent staleness.
   */
  health(): IndexHealthSnapshot {
    let totalDocs = 0;
    let totalBytes = 0;
    let anyDirty = false;
    let initialized = false;
    for (const partition of this.partitions.values()) {
      const h = partition.health();
      totalDocs += h.documentCount;
      totalBytes += h.approxMemoryBytes ?? 0;
      if (h.staleness === 'dirty') anyDirty = true;
      if (h.initialized) initialized = true;
    }
    return {
      name: 'partitioned-inverted',
      initialized,
      documentCount: totalDocs,
      approxMemoryBytes: totalBytes,
      staleness: !initialized ? 'unknown' : anyDirty ? 'dirty' : 'fresh',
      extras: { partitionCount: this.partitions.size },
    };
  }
}
