/**
 * ObservationDedupManager — entity-level cross-observation dedup.
 *
 * Distinct from:
 * - `MemoryEngine.checkDuplicate` (turn-level, single-session, pre-write)
 * - `CompressionManager.findDuplicates` (entity-level, groups whole
 *    similar entities for merge)
 *
 * Finds **observations** that appear verbatim or near-verbatim across
 * distinct entities (e.g. `Alice.observations[1]` and `Bob.observations[0]`
 * both contain `"Prefers Italian food"`). Report-only — no writes — so
 * the constructor takes only `IGraphStorage`. Consumers decide what to do
 * with the resulting groups (merge into a shared semantic entity, strip
 * from individuals, surface in a diagnostic, etc.).
 *
 * Tiers:
 * - `findDuplicateObservations()` — SHA-256 of normalized observation
 *   text (lowercase, whitespace-collapsed). O(n × m) where n = entities,
 *   m = avg observations/entity. Cheap.
 * - `findJaccardDuplicates()` — token-set Jaccard similarity over
 *   distinct (non-exact-duplicate) observations. O(o²) where o = total
 *   distinct observations. Separate method so callers pay the quadratic
 *   only when they want it.
 *
 * @module agent/ObservationDedupManager
 */

import { createHash } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';

/** A single occurrence of a duplicated observation. */
export interface DuplicateObservationOccurrence {
  entityName: string;
  /** Index into the entity's `observations` array. */
  observationIndex: number;
}

/** A group of duplicate occurrences for one observation. */
export interface DuplicateObservationGroup {
  /**
   * Canonical (normalized) observation text — lowercased, whitespace
   * collapsed. The original casing/whitespace lives on each occurrence's
   * source entity.
   */
  observation: string;
  occurrences: DuplicateObservationOccurrence[];
  /** Detection tier: `'exact'` or `'jaccard'`. */
  tier: 'exact' | 'jaccard';
}

/** Optional filter for `findDuplicateObservations`. */
export interface ObservationDedupFilter {
  /** Single type or list of types to include. Default: all. */
  entityType?: string | string[];
  /** Restrict to entities with this `projectId`. */
  projectId?: string;
  /** Restrict to entities with this `sessionId`. */
  sessionId?: string;
  /** Minimum occurrences to count as a group. Default 2. */
  minOccurrences?: number;
  /** Cap on groups returned (sorted by occurrences desc). Default 100. */
  maxGroups?: number;
}

/** Optional manager-level configuration (e.g. Jaccard threshold). */
export interface ObservationDedupManagerConfig {
  /** Threshold for `findJaccardDuplicates` (0..1). Default 0.85. */
  jaccardThreshold?: number;
}

export class ObservationDedupManager {
  private readonly storage: IGraphStorage;
  private readonly jaccardThreshold: number;

  constructor(storage: IGraphStorage, config: ObservationDedupManagerConfig = {}) {
    this.storage = storage;
    this.jaccardThreshold = config.jaccardThreshold ?? 0.85;
  }

  /**
   * Find verbatim (after normalization) duplicate observations across
   * entities. Cheap — single graph load, hash-bucketed.
   */
  async findDuplicateObservations(
    options: ObservationDedupFilter = {},
  ): Promise<DuplicateObservationGroup[]> {
    const minOccurrences = options.minOccurrences ?? 2;
    const maxGroups = options.maxGroups ?? 100;

    const candidates = await this.loadCandidateEntities(options);
    const byHash = new Map<string, { observation: string; occurrences: DuplicateObservationOccurrence[] }>();

    for (const entity of candidates) {
      const obs = entity.observations ?? [];
      for (let i = 0; i < obs.length; i++) {
        const normalized = normalizeObservation(obs[i]);
        if (normalized.length === 0) continue;
        const hash = sha256(normalized);
        let bucket = byHash.get(hash);
        if (!bucket) {
          bucket = { observation: normalized, occurrences: [] };
          byHash.set(hash, bucket);
        }
        bucket.occurrences.push({ entityName: entity.name, observationIndex: i });
      }
    }

    const groups: DuplicateObservationGroup[] = [];
    for (const b of byHash.values()) {
      if (b.occurrences.length < minOccurrences) continue;
      groups.push({ observation: b.observation, occurrences: b.occurrences, tier: 'exact' });
    }
    groups.sort((a, b) => b.occurrences.length - a.occurrences.length);
    return groups.slice(0, maxGroups);
  }

  /**
   * Find near-duplicate observations via token Jaccard similarity. More
   * expensive (O(o²)). Skips pairs already caught by the exact tier so
   * the output is genuinely additive.
   */
  async findJaccardDuplicates(
    options: ObservationDedupFilter = {},
  ): Promise<DuplicateObservationGroup[]> {
    const minOccurrences = options.minOccurrences ?? 2;
    const maxGroups = options.maxGroups ?? 100;

    const candidates = await this.loadCandidateEntities(options);

    type Indexed = {
      normalized: string;
      tokens: Set<string>;
      hash: string;
      occurrences: DuplicateObservationOccurrence[];
    };
    // First pass: bucket exact duplicates so each unique normalized text
    // appears once, with all its occurrences attached.
    const byHash = new Map<string, Indexed>();
    for (const entity of candidates) {
      const obs = entity.observations ?? [];
      for (let i = 0; i < obs.length; i++) {
        const normalized = normalizeObservation(obs[i]);
        if (normalized.length === 0) continue;
        const hash = sha256(normalized);
        let bucket = byHash.get(hash);
        if (!bucket) {
          bucket = {
            normalized,
            tokens: tokenSet(normalized),
            hash,
            occurrences: [],
          };
          byHash.set(hash, bucket);
        }
        bucket.occurrences.push({ entityName: entity.name, observationIndex: i });
      }
    }

    const all = [...byHash.values()];
    // Pair-wise Jaccard; group transitively by union-find.
    const parent = new Map<string, string>();
    const find = (h: string): string => {
      let cur = h;
      while (parent.get(cur) !== cur) cur = parent.get(cur)!;
      return cur;
    };
    for (const e of all) parent.set(e.hash, e.hash);

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        if (a.tokens.size === 0 || b.tokens.size === 0) continue;
        let intersect = 0;
        for (const t of a.tokens) if (b.tokens.has(t)) intersect++;
        const union = a.tokens.size + b.tokens.size - intersect;
        if (union === 0) continue;
        if (intersect / union >= this.jaccardThreshold) {
          const ra = find(a.hash);
          const rb = find(b.hash);
          if (ra !== rb) parent.set(ra, rb);
        }
      }
    }

    // Coalesce union-find roots into groups.
    const byRoot = new Map<string, DuplicateObservationGroup>();
    for (const e of all) {
      const root = find(e.hash);
      let grp = byRoot.get(root);
      if (!grp) {
        grp = { observation: e.normalized, occurrences: [], tier: 'jaccard' };
        byRoot.set(root, grp);
      }
      grp.occurrences.push(...e.occurrences);
    }

    const groups: DuplicateObservationGroup[] = [];
    for (const g of byRoot.values()) {
      if (g.occurrences.length < minOccurrences) continue;
      // Skip groups that collapse to a single distinct text (those are
      // the exact-tier's job).
      const distinct = new Set(g.occurrences.map((o) => `${o.entityName}|${o.observationIndex}`));
      if (distinct.size < minOccurrences) continue;
      groups.push(g);
    }
    groups.sort((a, b) => b.occurrences.length - a.occurrences.length);
    return groups.slice(0, maxGroups);
  }

  // ==================== Internal ====================

  private async loadCandidateEntities(filter: ObservationDedupFilter): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    const typeFilter = normalizeTypeFilter(filter.entityType);
    return graph.entities.filter((e) => {
      if (typeFilter && !typeFilter.has(e.entityType)) return false;
      if (filter.projectId !== undefined) {
        const pid = (e as unknown as { projectId?: string }).projectId;
        if (pid !== filter.projectId) return false;
      }
      if (filter.sessionId !== undefined) {
        const sid = (e as unknown as { sessionId?: string }).sessionId;
        if (sid !== filter.sessionId) return false;
      }
      return true;
    });
  }
}

// ==================== Helpers ====================

function normalizeObservation(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function normalizeTypeFilter(t: string | string[] | undefined): Set<string> | undefined {
  if (t === undefined) return undefined;
  return new Set(Array.isArray(t) ? t : [t]);
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'be', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'at', 'by', 'for', 'with', 'and', 'or', 'but', 'if', 'as', 'it', 'its',
  'this', 'that', 'these', 'those',
]);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );
}
