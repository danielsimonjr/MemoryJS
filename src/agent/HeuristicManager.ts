/**
 * Heuristic Guidelines Manager — Phase 3B.8 (storage-backed, v2.0.x).
 *
 * Crystallises implicit patterns into explicit natural-language strategies
 * (heuristics). Each heuristic is a `condition → action` rule with a
 * confidence score, support count, and conflict status.
 *
 * **Phase 3B.8a (v2.0.x)**: promoted from an in-memory `Map` scaffold to a
 * storage-backed facade. Writes go through `EntityManager.updateEntity` with
 * `expectedVersion` OCC (mirroring the v2.0.x #55 race fix on
 * `FailureManager` / `ReflectionManager`). The `Heuristic` record type
 * itself moved to `src/types/agent-memory.ts` to live with sibling
 * memory-type records.
 *
 * @module agent/HeuristicManager
 * @experimental Match algorithm (Jaccard token-overlap × confidence) and
 *   conflict-detection heuristics are conservative v1; may evolve toward
 *   semantic-similarity matching.
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  Heuristic,
  HeuristicEntity,
  HeuristicId,
} from '../types/agent-memory.js';
import { isHeuristicMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { VersionConflictError, EntityNotFoundError } from '../utils/errors.js';

/** Input shape for `add`. */
export interface AddHeuristicOptions {
  condition: string;
  action: string;
  priority?: number;
  /** Initial confidence (default 0.5 — neutral). */
  initialConfidence?: number;
  /** Optional importance applied to the persisted entity. Default 5. */
  importance?: number;
  /** Optional owning agent. */
  agentId?: string;
}

/** Result of a `match` query. */
export interface HeuristicMatch {
  heuristic: Heuristic;
  /** Confidence-weighted match score. Higher = better. */
  score: number;
}

/** Pair-wise conflict detection result. */
export interface HeuristicConflict {
  a: Heuristic;
  b: Heuristic;
  /**
   * `'overlap'` = same condition, different actions; `'contradiction'` =
   * directly opposing actions on overlapping conditions.
   */
  kind: 'overlap' | 'contradiction';
  /** Free-text explanation suitable for surfacing to the user. */
  reason: string;
}

/**
 * Discriminated result from `reinforce` / `recordContradiction`. Mirrors
 * the `MarkResolvedResult` / `ArchiveReflectionResult` shape (Sprint
 * cross-cut #55) so consumers branch the same way across agent-memory
 * managers.
 */
export type HeuristicUpdateResult =
  | 'updated'
  | 'not-found'
  | 'conflict'
  | 'vanished-mid-update';

/**
 * Storage-backed heuristic registry.
 *
 * @example
 * ```typescript
 * const mgr = ctx.heuristicManager;
 * const id = await mgr.add({ condition: 'user asks for code review', action: 'request the PR URL first' });
 * const matches = await mgr.match('please review my code');
 * await mgr.reinforce(id);
 * ```
 */
export class HeuristicManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;

  constructor(storage: IGraphStorage, entityManager: EntityManager) {
    this.storage = storage;
    this.entityManager = entityManager;
  }

  /** Register a new heuristic. Returns the generated `HeuristicId`. */
  async add(options: AddHeuristicOptions): Promise<HeuristicId> {
    const id = `h_${randomUUID()}` as HeuristicId;
    const now = toIsoDateTime(new Date());
    const record: Heuristic = {
      id,
      condition: options.condition,
      action: options.action,
      priority: options.priority,
      support: 0,
      contradictions: 0,
      confidence: clamp01(options.initialConfidence ?? 0.5),
      createdAt: now,
      lastUpdatedAt: now,
    };
    const entity: HeuristicEntity = {
      name: id,
      entityType: 'heuristic',
      observations: [`[heuristic] ${options.condition} → ${options.action}`],
      createdAt: now,
      lastModified: now,
      importance: options.importance ?? 5,
      memoryType: 'heuristic',
      agentId: options.agentId,
      visibility: 'private',
      accessCount: 0,
      confidence: record.confidence,
      confirmationCount: 0,
      heuristicRecord: record,
    };
    try {
      await this.storage.appendEntity(entity as unknown as Entity);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`HeuristicManager.add: failed to persist '${id}': ${cause}`);
    }
    return id;
  }

  /** Look up by id. Synchronous via the storage name-index. */
  get(id: HeuristicId | string): Heuristic | undefined {
    const entity = this.storage.getEntityByName(id);
    return isHeuristicMemory(entity) ? entity.heuristicRecord : undefined;
  }

  /** Number of registered heuristics. */
  async size(): Promise<number> {
    const all = await this.loadAllHeuristics();
    return all.length;
  }

  /** Remove a heuristic. Returns true if it existed. */
  async remove(id: HeuristicId | string): Promise<boolean> {
    if (!isHeuristicMemory(this.storage.getEntityByName(id))) return false;
    await this.entityManager.deleteEntities([id]);
    return true;
  }

  /** Drop every heuristic. */
  async clear(): Promise<void> {
    const all = await this.loadAllHeuristicEntities();
    if (all.length === 0) return;
    await this.entityManager.deleteEntities(all.map((e) => e.name));
  }

  /**
   * Find heuristics whose condition matches the supplied input. Jaccard
   * token-overlap × confidence, descending; ties broken by priority.
   */
  async match(
    input: string,
    options: { limit?: number; minScore?: number } = {},
  ): Promise<HeuristicMatch[]> {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.1;
    const inputTokens = tokenSet(input);
    if (inputTokens.size === 0) return [];

    const all = await this.loadAllHeuristics();
    const matches: HeuristicMatch[] = [];
    for (const h of all) {
      const condTokens = tokenSet(h.condition);
      if (condTokens.size === 0) continue;
      let intersect = 0;
      for (const t of inputTokens) if (condTokens.has(t)) intersect++;
      const unionSize = inputTokens.size + condTokens.size - intersect;
      const overlap = unionSize === 0 ? 0 : intersect / unionSize;
      const score = overlap * h.confidence;
      if (score >= minScore) matches.push({ heuristic: h, score });
    }
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.heuristic.priority ?? 0) - (a.heuristic.priority ?? 0);
    });
    return matches.slice(0, limit);
  }

  /**
   * Reinforce a heuristic: record a successful application. Bumps
   * `support`; raises confidence asymptotically toward 1 via
   * `new = old + (1 - old) * 0.1`. OCC-protected.
   */
  async reinforce(id: HeuristicId | string): Promise<HeuristicUpdateResult> {
    return this.applyUpdate(id, (h) => ({
      ...h,
      support: h.support + 1,
      confidence: clamp01(h.confidence + (1 - h.confidence) * 0.1),
    }));
  }

  /**
   * Record a contradiction: a counter-example. Bumps `contradictions`;
   * lowers confidence symmetrically (`new = old - old * 0.2`).
   * OCC-protected.
   */
  async recordContradiction(id: HeuristicId | string): Promise<HeuristicUpdateResult> {
    return this.applyUpdate(id, (h) => ({
      ...h,
      contradictions: h.contradictions + 1,
      confidence: clamp01(h.confidence - h.confidence * 0.2),
    }));
  }

  /**
   * Detect conflicts across registered heuristics. Pair-wise comparison
   * is O(n²); n is expected to stay small (typically < 100).
   */
  async detectConflicts(): Promise<HeuristicConflict[]> {
    const all = await this.loadAllHeuristics();
    const conflicts: HeuristicConflict[] = [];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const aTokens = tokenSet(a.condition);
        const bTokens = tokenSet(b.condition);
        let intersect = 0;
        for (const t of aTokens) if (bTokens.has(t)) intersect++;
        const overlap = intersect / Math.max(aTokens.size, bTokens.size, 1);
        if (overlap < 0.5) continue;
        if (a.action === b.action) continue;
        const kind: HeuristicConflict['kind'] = isContradiction(a.action, b.action)
          ? 'contradiction'
          : 'overlap';
        conflicts.push({
          a,
          b,
          kind,
          reason:
            kind === 'contradiction'
              ? `Heuristics "${a.id}" and "${b.id}" prescribe opposing actions on overlapping conditions`
              : `Heuristics "${a.id}" and "${b.id}" overlap on conditions but recommend different actions`,
        });
      }
    }
    return conflicts;
  }

  /** Every registered heuristic. */
  async list(): Promise<Heuristic[]> {
    return this.loadAllHeuristics();
  }

  // ==================== Internal ====================

  private async applyUpdate(
    id: HeuristicId | string,
    mutate: (h: Heuristic) => Heuristic,
  ): Promise<HeuristicUpdateResult> {
    const entity = this.storage.getEntityByName(id);
    if (!isHeuristicMemory(entity)) return 'not-found';
    const updated: Heuristic = {
      ...mutate(entity.heuristicRecord),
      lastUpdatedAt: toIsoDateTime(new Date()),
    };
    try {
      await this.entityManager.updateEntity(
        id,
        {
          heuristicRecord: updated,
          lastModified: updated.lastUpdatedAt,
          confidence: updated.confidence,
        } as unknown as Partial<Entity>,
        { expectedVersion: entity.version ?? 1 },
      );
      return 'updated';
    } catch (err) {
      if (err instanceof VersionConflictError) return 'conflict';
      if (err instanceof EntityNotFoundError) return 'vanished-mid-update';
      throw err;
    }
  }

  private async loadAllHeuristicEntities(): Promise<HeuristicEntity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isHeuristicMemory);
  }

  private async loadAllHeuristics(): Promise<Heuristic[]> {
    const ents = await this.loadAllHeuristicEntities();
    return ents.map((e) => e.heuristicRecord);
  }
}

// ==================== Helpers ====================

/**
 * Common English stopwords filtered from condition / input tokens.
 * Conservative — favours retaining short but meaningful tokens like
 * "PR" / "AI" / "go" while dropping pure noise like "is" / "the".
 */
const HEURISTIC_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'be', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'at', 'by', 'for', 'with', 'and', 'or', 'but', 'if', 'as', 'it', 'its',
  'this', 'that', 'these', 'those',
]);

function tokenSet(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !HEURISTIC_STOPWORDS.has(t)),
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Coarse contradiction heuristic: an action contradicts another when one
 * is the literal negation of the other (e.g. "do X" vs "don't do X").
 * Conservative — false negatives are preferred so the user isn't bombarded
 * with phantom conflicts.
 */
function isContradiction(a: string, b: string): boolean {
  const an = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const bn = b.toLowerCase().replace(/\s+/g, ' ').trim();
  const negationPrefixes = ["don't ", 'do not ', 'never ', 'avoid '];
  for (const p of negationPrefixes) {
    if (an.startsWith(p) && bn === an.slice(p.length)) return true;
    if (bn.startsWith(p) && an === bn.slice(p.length)) return true;
  }
  return false;
}
