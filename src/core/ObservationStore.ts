/**
 * Observation Store
 *
 * Content-addressable observation deduplication. Entities can opt in to
 * storing observation *hashes* (SHA-256 or a faster fingerprint) and
 * reconstruct the full text via this store, which keeps a single copy
 * of each unique string plus a reference count for safe removal.
 *
 * Phase 3 step 32 — infrastructure-only first cut. Callers that want
 * the memory savings can wrap their writes and reads via this store;
 * the canonical `Entity` shape is unchanged so existing code keeps
 * working. Wiring into `EntityManager` is a follow-up.
 *
 * @module core/ObservationStore
 * @public Stable content-addressable store. `intern`/`get`/`release`
 *   tri-state contract follows SemVer.
 */

import { createHash } from 'crypto';

/** A single store entry — content plus reference count. */
interface StoreEntry {
  content: string;
  refCount: number;
}

/** Statistics snapshot. */
export interface ObservationStoreStats {
  /** Number of unique observation strings currently held. */
  uniqueObservations: number;
  /** Sum of all reference counts (i.e. logical observation count). */
  totalReferences: number;
  /** Approximate dedup ratio: totalReferences / uniqueObservations. */
  dedupRatio: number;
  /** Total bytes saved vs storing every reference verbatim. */
  bytesSaved: number;
}

/**
 * Content-addressable string store with reference counting.
 *
 * @example
 * ```typescript
 * const store = new ObservationStore();
 * const h1 = store.intern('Created on 2025-01-15');
 * const h2 = store.intern('Created on 2025-01-15'); // same hash, refCount=2
 * store.get(h1) === 'Created on 2025-01-15';        // true
 * store.release(h1); // refCount -> 1
 * store.release(h2); // refCount -> 0, entry deleted
 * ```
 */
export class ObservationStore {
  private readonly entries: Map<string, StoreEntry> = new Map();

  /**
   * Intern a content string. Returns the content's SHA-256 hash. If the
   * content is already in the store, only the reference count is
   * incremented.
   */
  intern(content: string): string {
    const hash = ObservationStore.hash(content);
    const existing = this.entries.get(hash);
    if (existing) {
      existing.refCount++;
    } else {
      this.entries.set(hash, { content, refCount: 1 });
    }
    return hash;
  }

  /**
   * Look up the content for a hash. Returns `undefined` if the hash is
   * not in the store (either never interned or fully released).
   */
  get(hash: string): string | undefined {
    return this.entries.get(hash)?.content;
  }

  /**
   * Decrement the reference count for a hash. Returns:
   *   - `'removed'` — the refCount hit zero and the entry was deleted
   *   - `'decremented'` — the entry still has references after the call
   *   - `'unknown'` — no such hash in the store
   *
   * The tri-state lets callers distinguish "successful decrement" from
   * "no-op unknown hash" — a use case the previous boolean return
   * conflated.
   */
  release(hash: string): 'removed' | 'decremented' | 'unknown' {
    const entry = this.entries.get(hash);
    if (!entry) return 'unknown';
    entry.refCount--;
    if (entry.refCount <= 0) {
      this.entries.delete(hash);
      return 'removed';
    }
    return 'decremented';
  }

  /**
   * Reference count for a hash, or 0 if unknown.
   */
  refCount(hash: string): number {
    return this.entries.get(hash)?.refCount ?? 0;
  }

  /**
   * Total number of unique strings currently held.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Statistics suitable for diagnostics. Cheap — single pass over the
   * map.
   */
  stats(): ObservationStoreStats {
    let totalReferences = 0;
    let uniqueBytes = 0;
    let totalBytes = 0;
    for (const entry of this.entries.values()) {
      totalReferences += entry.refCount;
      uniqueBytes += entry.content.length;
      totalBytes += entry.content.length * entry.refCount;
    }
    const unique = this.entries.size;
    return {
      uniqueObservations: unique,
      totalReferences,
      dedupRatio: unique === 0 ? 1 : totalReferences / unique,
      bytesSaved: totalBytes - uniqueBytes,
    };
  }

  /**
   * Drop every entry. Use during teardown / test setup.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Bulk-intern an array of strings, returning a parallel array of
   * hashes. Convenience wrapper for entity-create paths.
   */
  internAll(contents: readonly string[]): string[] {
    return contents.map((c) => this.intern(c));
  }

  /**
   * Bulk-resolve an array of hashes back to content. Returns the
   * original array index alignment; missing hashes appear as
   * `undefined` (caller decides how to handle).
   */
  getAll(hashes: readonly string[]): Array<string | undefined> {
    return hashes.map((h) => this.get(h));
  }

  /**
   * Hash a string. Public so callers can pre-compute hashes (e.g. for
   * existence checks before deciding to insert).
   */
  static hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Helper that interns every observation on an entity-shape input
   * and returns a parallel hash array. Convenience wrapper used by
   * the opt-in dedup path — `EntityManager` callers who want the
   * memory savings can run an entity's observations through this
   * before persisting (the Entity shape is unchanged on disk; the
   * store's job is purely to detect cross-entity duplicates and
   * report savings).
   */
  internEntityObservations(entity: { observations: readonly string[] }): string[] {
    return this.internAll(entity.observations);
  }

  /**
   * Symmetric helper: release every hash in a parallel array. Useful
   * when an entity is deleted and the caller wants to free its
   * observation references in the store. Returns the count actually
   * removed (entries whose refCount hit zero).
   */
  releaseEntityObservations(hashes: readonly string[]): number {
    let removed = 0;
    for (const h of hashes) {
      if (this.release(h) === 'removed') removed++;
    }
    return removed;
  }
}
