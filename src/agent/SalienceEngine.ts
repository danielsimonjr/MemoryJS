/**
 * Salience Engine
 *
 * Calculates context-aware memory relevance scores based on
 * recency, frequency, context, and novelty factors.
 *
 * @module agent/SalienceEngine
 */

import type { IGraphStorage } from '../types/types.js';
import type {
  AgentEntity,
  SalienceContext,
  ScoredEntity,
  SalienceComponents,
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import { AccessTracker } from './AccessTracker.js';
import { DecayEngine } from './DecayEngine.js';

/**
 * Configuration for SalienceEngine.
 */
export interface SalienceEngineConfig {
  /** Weight for base importance (default: 0.25) */
  importanceWeight?: number;
  /** Weight for recency boost (default: 0.25) */
  recencyWeight?: number;
  /** Weight for frequency boost (default: 0.2) */
  frequencyWeight?: number;
  /** Weight for context relevance (default: 0.2) */
  contextWeight?: number;
  /** Weight for novelty bonus (default: 0.1) */
  noveltyWeight?: number;
  /** Recency decay hours (default: 24) */
  recencyDecayHours?: number;
}

/**
 * Calculates multi-factor salience scores for memories.
 *
 * The SalienceEngine combines multiple signals to produce a single
 * relevance score that accounts for both intrinsic memory importance
 * and contextual relevance:
 *
 * - Base importance (from DecayEngine effective importance)
 * - Recency boost (time since last access)
 * - Frequency boost (access count normalized)
 * - Context relevance (task/session/query matching)
 * - Novelty bonus (inversely related to recent access)
 *
 * @example
 * ```typescript
 * const engine = new SalienceEngine(storage, accessTracker, decayEngine);
 * const context: SalienceContext = { currentTask: 'booking', queryText: 'hotel' };
 * const scored = await engine.calculateSalience(entity, context);
 * console.log(`Salience: ${scored.salienceScore}`);
 * ```
 */
export class SalienceEngine {
  private readonly storage: IGraphStorage;
  private readonly accessTracker: AccessTracker;
  private readonly decayEngine: DecayEngine;
  private readonly config: Required<SalienceEngineConfig>;

  constructor(
    storage: IGraphStorage,
    accessTracker: AccessTracker,
    decayEngine: DecayEngine,
    config: SalienceEngineConfig = {}
  ) {
    this.storage = storage;
    this.accessTracker = accessTracker;
    this.decayEngine = decayEngine;
    this.config = {
      importanceWeight: config.importanceWeight ?? 0.25,
      recencyWeight: config.recencyWeight ?? 0.25,
      frequencyWeight: config.frequencyWeight ?? 0.2,
      contextWeight: config.contextWeight ?? 0.2,
      noveltyWeight: config.noveltyWeight ?? 0.1,
      recencyDecayHours: config.recencyDecayHours ?? 24,
    };
  }

  // ==================== Main Salience Calculation ====================

  /**
   * Calculate salience score for an entity in the given context.
   *
   * Combines multiple factors with configurable weights:
   * - Base importance: DecayEngine effective importance normalized to 0-1
   * - Recency: Exponential decay from last access time
   * - Frequency: Log-normalized access count relative to max
   * - Context: Text similarity to current task/session/query
   * - Novelty: Inverse of recency (rewards less recently accessed)
   *
   * @param entity - AgentEntity to calculate salience for
   * @param context - Context information for relevance scoring
   * @returns Scored entity with salience score and component breakdown
   */
  async calculateSalience(
    entity: AgentEntity,
    context: SalienceContext
  ): Promise<ScoredEntity> {
    // Calculate component scores (all normalized to 0-1)
    const baseImportance = this.calculateBaseImportance(entity);
    const recencyBoost = this.calculateRecencyBoost(entity, context);
    const frequencyBoost = await this.calculateFrequencyBoost(entity);
    const contextRelevance = this.calculateContextRelevance(entity, context);
    const noveltyBoost = this.calculateNoveltyBoost(entity, context);

    // Apply weights and sum
    const salienceScore =
      baseImportance * this.config.importanceWeight +
      recencyBoost * this.config.recencyWeight +
      frequencyBoost * this.config.frequencyWeight +
      contextRelevance * this.config.contextWeight +
      noveltyBoost * this.config.noveltyWeight;

    const components: SalienceComponents = {
      baseImportance,
      recencyBoost,
      frequencyBoost,
      contextRelevance,
      noveltyBoost,
    };

    return {
      entity,
      salienceScore,
      components,
    };
  }

  /**
   * Rank multiple entities by salience score.
   *
   * @param entities - Entities to rank
   * @param context - Context for relevance scoring
   * @returns Sorted array of scored entities (highest salience first)
   */
  async rankEntitiesBySalience(
    entities: AgentEntity[],
    context: SalienceContext
  ): Promise<ScoredEntity[]> {
    const scored = await Promise.all(
      entities.map((e) => this.calculateSalience(e, context))
    );
    return scored.sort((a, b) => b.salienceScore - a.salienceScore);
  }

  /**
   * Get top N entities by salience from storage.
   *
   * @param context - Context for relevance scoring
   * @param limit - Maximum number of entities to return (default: 10)
   * @returns Top entities sorted by salience
   */
  async getTopSalient(
    context: SalienceContext,
    limit: number = 10
  ): Promise<ScoredEntity[]> {
    const graph = await this.storage.loadGraph();
    const agentEntities = graph.entities.filter(isAgentEntity) as AgentEntity[];

    const ranked = await this.rankEntitiesBySalience(agentEntities, context);
    return ranked.slice(0, limit);
  }

  // ==================== Component Calculations ====================

  /**
   * Calculate base importance component.
   * Uses DecayEngine effective importance normalized to 0-1.
   *
   * @param entity - Entity to calculate for
   * @returns Score between 0 and 1
   */
  private calculateBaseImportance(entity: AgentEntity): number {
    // Use effective importance from decay engine
    const effective = this.decayEngine.calculateEffectiveImportance(entity);
    // Normalize to 0-1 (importance is on 0-10 scale)
    return Math.min(1, effective / 10);
  }

  /**
   * Calculate recency boost component.
   * Uses exponential decay from last access time.
   *
   * @param entity - Entity to calculate for
   * @param context - Context with temporal focus
   * @returns Score between 0 and 1
   */
  private calculateRecencyBoost(
    entity: AgentEntity,
    context: SalienceContext
  ): number {
    // Determine timestamp for recency calculation
    const lastAccess = entity.lastAccessedAt ?? entity.createdAt;
    if (!lastAccess) {
      return 0; // No timestamp = minimum recency
    }

    // Use static recency calculation
    const baseRecency = AccessTracker.calculateRecencyScoreFromTimestamp(
      lastAccess,
      this.config.recencyDecayHours
    );

    // Apply temporal focus adjustment
    if (context.temporalFocus === 'recent') {
      // Boost recent items more
      return Math.pow(baseRecency, 0.5); // Square root to boost high values
    } else if (context.temporalFocus === 'historical') {
      // Reduce recency impact for historical focus
      return Math.pow(baseRecency, 2); // Square to reduce high values
    }

    // Balanced (default)
    return baseRecency;
  }

  /**
   * Calculate frequency boost component.
   * Log-normalized access count relative to maximum.
   * Uses AccessTracker stats when available for more accurate counts.
   *
   * @param entity - Entity to calculate for
   * @returns Score between 0 and 1
   */
  private async calculateFrequencyBoost(entity: AgentEntity): Promise<number> {
    // Try to get access stats from tracker for more accurate count
    const stats = await this.accessTracker.getAccessStats(entity.name);
    const accessCount = stats.totalAccesses > 0 ? stats.totalAccesses : (entity.accessCount ?? 0);

    if (accessCount === 0) return 0;

    // Get max access count for normalization
    const maxAccess = await this.getMaxAccessCount();
    if (maxAccess === 0) return 0;

    // Use logarithmic scaling to prevent dominance by high-access entities
    // log(count + 1) / log(max + 1) gives a 0-1 range
    return Math.log(accessCount + 1) / Math.log(maxAccess + 1);
  }

  /**
   * Calculate context relevance component.
   * Matches entity against current task, session, and query.
   *
   * @param entity - Entity to calculate for
   * @param context - Context to match against
   * @returns Score between 0 and 1
   */
  private calculateContextRelevance(
    entity: AgentEntity,
    context: SalienceContext
  ): number {
    let relevanceScore = 0;
    let factors = 0;

    // Task matching
    if (context.currentTask) {
      factors++;
      if (entity.taskId === context.currentTask) {
        relevanceScore += 1.0;
      } else if (entity.observations?.some((o) =>
        o.toLowerCase().includes(context.currentTask!.toLowerCase())
      )) {
        relevanceScore += 0.5;
      }
    }

    // Session matching
    if (context.currentSession) {
      factors++;
      if (entity.sessionId === context.currentSession) {
        relevanceScore += 1.0;
      }
    }

    // Query text matching
    if (context.queryText) {
      factors++;
      const queryLower = context.queryText.toLowerCase();
      const nameMatch = entity.name.toLowerCase().includes(queryLower);
      const typeMatch = entity.entityType.toLowerCase().includes(queryLower);
      const obsMatch = entity.observations?.some((o) =>
        o.toLowerCase().includes(queryLower)
      );

      if (nameMatch) relevanceScore += 1.0;
      else if (typeMatch) relevanceScore += 0.7;
      else if (obsMatch) relevanceScore += 0.5;
    }

    // User intent matching
    if (context.userIntent) {
      factors++;
      const intentLower = context.userIntent.toLowerCase();
      if (
        entity.observations?.some((o) =>
          o.toLowerCase().includes(intentLower)
        )
      ) {
        relevanceScore += 0.8;
      }
    }

    // Recent entities matching (boost if in recent context)
    if (context.recentEntities && context.recentEntities.length > 0) {
      factors++;
      if (context.recentEntities.includes(entity.name)) {
        relevanceScore += 0.7;
      }
    }

    // Normalize by number of factors considered
    return factors > 0 ? relevanceScore / factors : 0;
  }

  /**
   * Calculate novelty boost component.
   * Rewards entities that haven't been accessed recently.
   *
   * @param entity - Entity to calculate for
   * @param context - Context with temporal focus
   * @returns Score between 0 and 1
   */
  private calculateNoveltyBoost(
    entity: AgentEntity,
    context: SalienceContext
  ): number {
    // Novelty is inverse of recency - less recently accessed = more novel
    const lastAccess = entity.lastAccessedAt ?? entity.createdAt;
    if (!lastAccess) {
      return 1.0; // Never accessed = maximum novelty
    }

    const recency = AccessTracker.calculateRecencyScoreFromTimestamp(
      lastAccess,
      this.config.recencyDecayHours
    );

    // Base novelty is inverse of recency
    let novelty = 1 - recency;

    // Adjust based on temporal focus
    if (context.temporalFocus === 'historical') {
      // Historical focus increases novelty importance
      novelty = Math.pow(novelty, 0.5); // Square root boosts mid values
    } else if (context.temporalFocus === 'recent') {
      // Recent focus decreases novelty importance
      novelty = Math.pow(novelty, 2); // Square reduces mid values
    }

    // Also consider if entity is in recent context (reduce novelty)
    if (context.recentEntities?.includes(entity.name)) {
      novelty *= 0.5;
    }

    return novelty;
  }

  // ==================== Helper Methods ====================

  /**
   * Get the maximum access count across all entities.
   * Used for normalizing frequency scores.
   */
  private async getMaxAccessCount(): Promise<number> {
    const graph = await this.storage.loadGraph();
    let max = 0;

    for (const entity of graph.entities) {
      if (isAgentEntity(entity)) {
        const count = (entity as AgentEntity).accessCount ?? 0;
        if (count > max) max = count;
      }
    }

    return max;
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<SalienceEngineConfig>> {
    return { ...this.config };
  }
}
