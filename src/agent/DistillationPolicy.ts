/**
 * Memory Distillation Policy
 *
 * Provides a pluggable post-retrieval, pre-reasoning filter that scores
 * and culls irrelevant memories. Sits between HybridSearchManager output
 * and ContextWindowManager input to keep the context window clean.
 *
 * @module agent/DistillationPolicy
 */

import type { Entity } from '../types/types.js';
import type { HybridSearchResult } from '../types/types.js';
import { FreshnessManager } from '../features/FreshnessManager.js';

// ==================== Distillation Types ====================

/**
 * A single scored memory after distillation.
 */
export interface DistilledMemory {
  entity: Entity;
  /** Original hybrid search score (combined), or 0 if not from hybrid search */
  rawScore: number;
  /** Post-distillation relevance score (0-1) */
  distilledScore: number;
  /** Human-readable reason this memory was kept or filtered */
  reason: string;
  /** Whether it survived distillation (filtered items are excluded, not returned with kept: false) */
  kept: boolean;
}

/**
 * Configuration for a distillation policy run.
 */
export interface DistillationConfig {
  /** Minimum distilled score to keep (default: 0.3) */
  minScore?: number;
  /** Maximum memories to return (default: 50) */
  maxMemories?: number;
  /** Current task description for relevance scoring */
  taskDescription?: string;
  /** Current session ID for recency weighting */
  sessionId?: string;
  /** Keywords from the query for term overlap scoring */
  queryKeywords?: string[];
  /** Weight for recency in distillation score (default: 0.3) */
  recencyWeight?: number;
  /** Weight for term overlap in distillation score (default: 0.4) */
  relevanceWeight?: number;
  /** Weight for base importance in distillation score (default: 0.3) */
  importanceWeight?: number;
}

/**
 * Interface for custom distillation policies.
 * Implement this to plug in domain-specific filtering logic.
 */
export interface IDistillationPolicy {
  /**
   * Distill a list of search results, returning scored+filtered memories.
   * Must be pure (no side-effects on storage).
   * Returns only kept memories (kept: true).
   */
  distill(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]>;
}

// ==================== NoOp Policy ====================

/**
 * Pass-through policy that keeps all memories unchanged.
 * Used as the default when no distillation is configured.
 */
export class NoOpDistillationPolicy implements IDistillationPolicy {
  async distill(
    results: HybridSearchResult[],
    _config: DistillationConfig
  ): Promise<DistilledMemory[]> {
    return results.map((r) => ({
      entity: r.entity,
      rawScore: r.scores.combined,
      distilledScore: r.scores.combined,
      reason: 'pass-through',
      kept: true,
    }));
  }
}

// ==================== Default Policy ====================

/**
 * Default distillation policy using recency + term overlap + importance.
 *
 * Scoring formula:
 *   distilledScore = (recencyScore * recencyWeight)
 *                  + (termOverlapScore * relevanceWeight)
 *                  + (normalizedImportance * importanceWeight)
 *
 * Additionally:
 * - Expired entities (via FreshnessManager) are always removed.
 * - Near-duplicate detection: entities whose names are very similar to a
 *   previously kept entity are removed.
 *
 * @example
 * ```typescript
 * const policy = new DefaultDistillationPolicy();
 * const kept = await policy.distill(searchResults, {
 *   minScore: 0.3,
 *   queryKeywords: ['hotel', 'budget'],
 *   maxMemories: 20,
 * });
 * ```
 */
export class DefaultDistillationPolicy implements IDistillationPolicy {
  private readonly freshnessManager: FreshnessManager;

  constructor(freshnessManager?: FreshnessManager) {
    // Create a minimal FreshnessManager when none is provided.
    // Storage is optional in FreshnessManager (unused by isExpired()).
    this.freshnessManager = freshnessManager ?? new FreshnessManager();
  }

  async distill(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]> {
    if (results.length === 0) return [];

    const minScore = config.minScore ?? 0.3;
    const maxMemories = config.maxMemories ?? 50;
    const recencyWeight = config.recencyWeight ?? 0.3;
    const relevanceWeight = config.relevanceWeight ?? 0.4;
    const importanceWeight = config.importanceWeight ?? 0.3;
    const keywords = config.queryKeywords ?? [];

    const kept: DistilledMemory[] = [];
    const seenNames = new Set<string>();

    for (const result of results) {
      const entity = result.entity;

      // 1. Remove expired entities.
      if (this.freshnessManager.isExpired(entity)) {
        continue;
      }

      // 2. Near-duplicate check by name (simple Jaccard on word sets).
      if (this.isNearDuplicate(entity, seenNames)) {
        continue;
      }

      // 3. Score the entity.
      const recencyScore = this.scoreRecency(entity);
      const termOverlapScore = this.scoreTermOverlap(entity, keywords);
      const importanceScore = this.scoreImportance(entity);

      const distilledScore =
        recencyScore * recencyWeight +
        termOverlapScore * relevanceWeight +
        importanceScore * importanceWeight;

      // 4. Apply minimum score filter.
      if (distilledScore < minScore) {
        continue;
      }

      seenNames.add(entity.name);
      kept.push({
        entity,
        rawScore: result.scores.combined,
        distilledScore,
        reason: this.buildReason(recencyScore, termOverlapScore, importanceScore, keywords),
        kept: true,
      });

      // 5. Enforce maxMemories cap.
      if (kept.length >= maxMemories) break;
    }

    return kept;
  }

  // ==================== Scoring Methods ====================

  /**
   * Score entity based on recency.
   * Uses exponential decay with a 24-hour half-life.
   * Returns 1.0 for just-created entities, approaching 0 for old ones.
   */
  scoreRecency(entity: Entity): number {
    const timestamp = entity.lastModified ?? entity.createdAt;
    if (!timestamp) return 0;

    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const halfLifeHours = 24;
    const decayConstant = Math.LN2 / halfLifeHours;
    return Math.exp(-decayConstant * ageHours);
  }

  /**
   * Score entity based on keyword/term overlap with query keywords.
   * Uses Jaccard-style overlap on tokenised entity text.
   */
  scoreTermOverlap(entity: Entity, keywords: string[]): number {
    if (keywords.length === 0) return 0.5; // neutral score when no keywords

    const entityTokens = this.tokenise([
      entity.name,
      entity.entityType,
      ...(entity.observations ?? []),
    ].join(' '));

    const entitySet = new Set(entityTokens);
    let matches = 0;
    for (const kw of keywords) {
      if (entitySet.has(kw.toLowerCase())) matches++;
    }

    return matches / keywords.length;
  }

  /**
   * Score entity based on its importance field (normalized to 0-1).
   * Entities without an importance field get a neutral score of 0.5.
   */
  scoreImportance(entity: Entity): number {
    if (entity.importance === undefined) return 0.5;
    return Math.min(1, Math.max(0, entity.importance / 10));
  }

  // ==================== Helper Methods ====================

  /**
   * Check if entity is a near-duplicate of any already-kept entity.
   * Uses Jaccard similarity on name tokens.
   */
  private isNearDuplicate(entity: Entity, seenNames: Set<string>): boolean {
    const nameTokens = new Set(this.tokenise(entity.name));
    for (const seen of seenNames) {
      const seenTokens = new Set(this.tokenise(seen));
      const intersection = [...nameTokens].filter((t) => seenTokens.has(t));
      const union = new Set([...nameTokens, ...seenTokens]);
      if (union.size > 0 && intersection.length / union.size > 0.8) {
        return true;
      }
    }
    return false;
  }

  /**
   * Tokenise a string into lowercase words.
   */
  private tokenise(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s_\-./]+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Build a human-readable reason string for why an entity was kept.
   */
  private buildReason(
    recency: number,
    termOverlap: number,
    importance: number,
    keywords: string[]
  ): string {
    const parts: string[] = [];
    if (recency > 0.7) parts.push('recent');
    if (keywords.length > 0 && termOverlap > 0.3) parts.push('query-relevant');
    if (importance > 0.6) parts.push('high-importance');
    return parts.length > 0 ? parts.join(', ') : 'above-threshold';
  }
}

// ==================== Composite Policy ====================

/**
 * Chains multiple distillation policies in sequence.
 * Each policy receives the output of the previous one.
 * The final result is the set of memories that survived all policies.
 *
 * @example
 * ```typescript
 * const pipeline = new CompositeDistillationPolicy([
 *   new DefaultDistillationPolicy(),
 *   new CustomDomainPolicy(),
 * ]);
 * const kept = await pipeline.distill(results, config);
 * ```
 */
export class CompositeDistillationPolicy implements IDistillationPolicy {
  private readonly policies: IDistillationPolicy[];

  constructor(policies: IDistillationPolicy[]) {
    this.policies = policies;
  }

  async distill(
    results: HybridSearchResult[],
    config: DistillationConfig
  ): Promise<DistilledMemory[]> {
    if (results.length === 0) return [];
    if (this.policies.length === 0) return [];

    // First policy processes original HybridSearchResult array.
    let currentResults = await this.policies[0].distill(results, config);

    // Subsequent policies receive adapted input: re-wrap DistilledMemory back
    // into HybridSearchResult using the distilledScore as combined score.
    for (let i = 1; i < this.policies.length; i++) {
      const adapted: HybridSearchResult[] = currentResults.map((dm) => ({
        entity: dm.entity,
        scores: {
          semantic: 0,
          lexical: 0,
          symbolic: 0,
          combined: dm.distilledScore,
        },
        matchedLayers: [],
      }));
      currentResults = await this.policies[i].distill(adapted, config);
    }

    return currentResults;
  }

  /**
   * Get number of policies in the chain.
   */
  get policyCount(): number {
    return this.policies.length;
  }
}
