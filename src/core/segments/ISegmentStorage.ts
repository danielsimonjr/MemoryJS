/**
 * Segment Storage — Interface + Reference Impl
 *
 * Phase 7 task 59 (§5.3) — first task in the multi-month JSONL
 * segment-files breakdown. Defines the interface every segment
 * backend implements, the routing rule that maps an entity name to a
 * segment id, and a memory-only reference implementation used by
 * tests + by callers that want segmentation semantics without the
 * disk cost.
 *
 * **Sharding rule:** an entity is owned by `fnv1a(entity.name) %
 * segmentCount`. Routing is deterministic, name-stable, and
 * segmentCount-stable in the sense that doubling segmentCount
 * remaps roughly half the entities (consistent-hashing improvements
 * are a follow-up — out of scope for the first pass). Relations
 * live in the segment that owns their `from` endpoint; readers that
 * need both endpoints join across segments.
 *
 * **No external deps.** Pure TS.
 *
 * @module core/segments/ISegmentStorage
 * @experimental The `Segment` shape may grow new fields (e.g.
 *   `version` for migration) in non-breaking ways. The routing rule
 *   is stable — changing it would invalidate every on-disk segment.
 */

import type { Entity, Relation, KnowledgeGraph } from '../../types/types.js';
import { fnv1aHash } from '../../utils/entityUtils.js';

/** A segment id is a non-negative integer in `[0, segmentCount)`. */
export type SegmentId = number;

/**
 * Routes an entity name to a segment id. Implementations must be
 * pure functions of `(name, segmentCount)` so two processes
 * pointed at the same segmentCount always agree on routing.
 */
export interface SegmentRouter {
  readonly segmentCount: number;
  route(name: string): SegmentId;
}

/** A single segment of a knowledge graph — a slice keyed by entity name. */
export interface Segment {
  id: SegmentId;
  entities: Entity[];
  /**
   * Relations whose `from` lives in this segment. A relation
   * pointing into another segment is owned by the segment of its
   * `from`, not its `to` — readers join across segments to resolve
   * the other endpoint.
   */
  relations: Relation[];
}

/**
 * Lifecycle contract for a segment-aware storage backend. Two
 * reference impls live in this module:
 *
 * - `InMemorySegmentStorage` — segments held in a `Map`. Useful for
 *   tests and ephemeral processes.
 * - (`FileSegmentStorage` ships in task 60 — see `FileSegmentStorage.ts`.)
 */
export interface ISegmentStorage {
  readonly router: SegmentRouter;
  /** Convenience alias for `router.segmentCount`. */
  readonly segmentCount: number;

  /** Load a single segment by id. Missing ids return an empty segment. */
  loadSegment(id: SegmentId): Promise<Segment>;

  /** Save a single segment, replacing any prior state for that id. */
  saveSegment(segment: Segment): Promise<void>;

  /**
   * Snapshot every segment into one `KnowledgeGraph`. The order of
   * `entities` / `relations` in the result is segment-id order, then
   * insertion order within each segment.
   */
  loadAll(): Promise<KnowledgeGraph>;

  /**
   * Replace every segment with slices of `graph`. Routes each entity
   * to its segment via `router.route(entity.name)` and groups
   * relations by their `from`-endpoint segment.
   */
  saveAll(graph: KnowledgeGraph): Promise<void>;

  /** Total entity count across all segments. Convenience for diagnostics. */
  entityCount(): Promise<number>;
}

// ==================== FNV-1a router ====================

/**
 * FNV-1a 32-bit; the same function as `fnv1aHash`. `BloomFilter.doubleHash` uses a two-seed variant.
 */
export { fnv1aHash as fnv1a32 } from '../../utils/entityUtils.js';

/** Default router — FNV-1a modulo `segmentCount`. */
export class FnvSegmentRouter implements SegmentRouter {
  constructor(public readonly segmentCount: number) {
    if (!Number.isInteger(segmentCount) || segmentCount < 1) {
      throw new Error(
        `FnvSegmentRouter: segmentCount must be a positive integer, got ${segmentCount}`,
      );
    }
  }

  route(name: string): SegmentId {
    return fnv1aHash(name) % this.segmentCount;
  }
}

// ==================== Helpers for split / merge ====================

/**
 * Slice a `KnowledgeGraph` into `segmentCount` segments using
 * `router`. Pure function — no I/O, no side effects. Used by both
 * `saveAll()` implementations and the migration tool (task 63).
 */
export function splitGraphIntoSegments(
  graph: KnowledgeGraph,
  router: SegmentRouter,
): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < router.segmentCount; i++) {
    segments.push({ id: i, entities: [], relations: [] });
  }
  for (const entity of graph.entities) {
    const id = router.route(entity.name);
    segments[id]!.entities.push(entity);
  }
  // Relations live in the segment owning their `from` endpoint —
  // matches the contract in `Segment.relations`. A reader that
  // needs the `to` endpoint joins across segments.
  for (const rel of graph.relations) {
    const id = router.route(rel.from);
    segments[id]!.relations.push(rel);
  }
  return segments;
}

/**
 * Merge segments back into a single `KnowledgeGraph`. Reads entities
 * and relations in segment-id order; within a segment, original
 * insertion order is preserved.
 */
export function mergeSegmentsIntoGraph(segments: Segment[]): KnowledgeGraph {
  const sorted = [...segments].sort((a, b) => a.id - b.id);
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const seg of sorted) {
    entities.push(...seg.entities);
    relations.push(...seg.relations);
  }
  return { entities, relations };
}

// ==================== In-memory reference impl ====================

/**
 * Reference segment storage backed by an in-memory `Map`. Tests and
 * ephemeral processes use this; production callers want
 * `FileSegmentStorage` (task 60).
 *
 * @example
 * ```typescript
 * const router = new FnvSegmentRouter(4);
 * const store = new InMemorySegmentStorage(router);
 * await store.saveAll({
 *   entities: [{ name: 'alice', entityType: 'person', observations: [] }],
 *   relations: [],
 * });
 * const back = await store.loadAll();
 * ```
 */
export class InMemorySegmentStorage implements ISegmentStorage {
  readonly segmentCount: number;
  private readonly segments: Map<SegmentId, Segment> = new Map();

  constructor(public readonly router: SegmentRouter) {
    this.segmentCount = router.segmentCount;
  }

  async loadSegment(id: SegmentId): Promise<Segment> {
    this.assertValidId(id);
    const existing = this.segments.get(id);
    if (existing) {
      // Defensive copy so caller mutations don't bleed into our state.
      return {
        id,
        entities: [...existing.entities],
        relations: [...existing.relations],
      };
    }
    return { id, entities: [], relations: [] };
  }

  async saveSegment(segment: Segment): Promise<void> {
    this.assertValidId(segment.id);
    // Validate ownership — every entity must route back to this segment id.
    // Catches caller bugs early; without it a misrouted write silently
    // breaks every later `loadAll()` consistency invariant.
    assertSegmentOwnership.call(this, segment, 'InMemorySegmentStorage.saveSegment');
    this.segments.set(segment.id, {
      id: segment.id,
      entities: [...segment.entities],
      relations: [...segment.relations],
    });
  }

  async loadAll(): Promise<KnowledgeGraph> {
    const segs: Segment[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      segs.push(await this.loadSegment(i));
    }
    return mergeSegmentsIntoGraph(segs);
  }

  async saveAll(graph: KnowledgeGraph): Promise<void> {
    const segs = splitGraphIntoSegments(graph, this.router);
    for (const seg of segs) {
      await this.saveSegment(seg);
    }
  }

  async entityCount(): Promise<number> {
    let total = 0;
    for (const seg of this.segments.values()) total += seg.entities.length;
    return total;
  }

  private assertValidId(id: SegmentId): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.segmentCount) {
      throw new Error(
        `Segment id must be an integer in [0, ${this.segmentCount}), got ${id}`,
      );
    }
  }
}

/**
 * Verifies that all entities and relations in a segment route to the correct segment.
 * Checks entities first, then relations.
 * Throws an error on the first routing mismatch.
 * Use this function before writing a segment.
 * Call it as `assertSegmentOwnership.call(this, segment, className)` from a storage class.
 * The `this` value is the storage whose router decides the owner of each name.
 * The function reads `this.router` for each entity and each relation, as the
 * storage methods did before they shared this code.
 * The className argument appears only in the error message.
 *
 * @param segment - The segment object to check.
 * @param className - The name for the error message.
 */
export function assertSegmentOwnership(
  this: { readonly router: SegmentRouter },
  segment: Segment,
  className: string,
): void {
  for (const e of segment.entities) {
    const expected = this.router.route(e.name);
    if (expected !== segment.id) {
      throw new Error(
        `${className}: entity '${e.name}' routes to segment ${expected}, not ${segment.id}`,
      );
    }
  }
  for (const r of segment.relations) {
    const expected = this.router.route(r.from);
    if (expected !== segment.id) {
      throw new Error(
        `${className}: relation from='${r.from}' routes to segment ${expected}, not ${segment.id}`,
      );
    }
  }
}
