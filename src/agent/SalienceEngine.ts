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
import { SummarizationService } from './SummarizationService.js';

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
  /** Boost factor for session match (default: 1.0) */
  sessionBoostFactor?: number;
  /** Boost factor for recent entities (default: 0.7) */
  recentEntityBoostFactor?: number;
  /** Enable TF-IDF similarity for task/query matching (default: true) */
  useSemanticSimilarity?: boolean;
  /** Threshold for observation uniqueness (default: 0.5) */
  uniquenessThreshold?: number;
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
  private readonly summarizationService: SummarizationService;
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
    this.summarizationService = new SummarizationService();
    this.config = {
      importanceWeight: config.importanceWeight ?? 0.25,
      recencyWeight: config.recencyWeight ?? 0.25,
      frequencyWeight: config.frequencyWeight ?? 0.2,
      contextWeight: config.contextWeight ?? 0.2,
      noveltyWeight: config.noveltyWeight ?? 0.1,
      recencyDecayHours: config.recencyDecayHours ?? 24,
      sessionBoostFactor: config.sessionBoostFactor ?? 1.0,
      recentEntityBoostFactor: config.recentEntityBoostFactor ?? 0.7,
      useSemanticSimilarity: config.useSemanticSimilarity ?? true,
      uniquenessThreshold: config.uniquenessThreshold ?? 0.5,
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
   * Matches entity against current task, session, and query using
   * TF-IDF similarity when enabled.
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

    // Task relevance using semantic similarity or keyword matching
    if (context.currentTask) {
      factors++;
      relevanceScore += this.calculateTaskRelevance(entity, context.currentTask);
    }

    // Session context scoring with configurable boost
    if (context.currentSession) {
      factors++;
      relevanceScore += this.calculateSessionRelevance(entity, context.currentSession);
    }

    // Query text matching using semantic similarity
    if (context.queryText) {
      factors++;
      relevanceScore += this.calculateQueryRelevance(entity, context.queryText);
    }

    // User intent matching with semantic similarity
    if (context.userIntent) {
      factors++;
      relevanceScore += this.calculateIntentRelevance(entity, context.userIntent);
    }

    // Recent entities matching with configurable boost
    if (context.recentEntities && context.recentEntities.length > 0) {
      factors++;
      if (context.recentEntities.includes(entity.name)) {
        relevanceScore += this.config.recentEntityBoostFactor;
      }
    }

    // Normalize by number of factors considered
    return factors > 0 ? relevanceScore / factors : 0;
  }

  /**
   * Calculate task relevance score.
   * Uses TF-IDF similarity when enabled, falls back to keyword matching.
   *
   * @param entity - Entity to score
   * @param taskDescription - Task to match against
   * @returns Score between 0 and 1
   */
  calculateTaskRelevance(entity: AgentEntity, taskDescription: string): number {
    // Exact task ID match
    if (entity.taskId === taskDescription) {
      return 1.0;
    }

    // Build entity text for comparison
    const entityText = this.buildEntityText(entity);

    if (this.config.useSemanticSimilarity) {
      // Use TF-IDF cosine similarity
      return this.summarizationService.calculateSimilarity(entityText, taskDescription);
    }

    // Fallback to keyword matching
    const taskLower = taskDescription.toLowerCase();
    if (entity.name.toLowerCase().includes(taskLower)) {
      return 0.8;
    }
    if (entity.observations?.some((o) => o.toLowerCase().includes(taskLower))) {
      return 0.5;
    }

    return 0;
  }

  /**
   * Calculate session relevance score.
   * Applies configurable boost factor for session matches.
   *
   * @param entity - Entity to score
   * @param sessionId - Session to match
   * @returns Score between 0 and 1
   */
  calculateSessionRelevance(entity: AgentEntity, sessionId: string): number {
    if (entity.sessionId === sessionId) {
      return this.config.sessionBoostFactor;
    }
    return 0;
  }

  /**
   * Calculate query text relevance score.
   * Uses TF-IDF similarity when enabled for semantic matching.
   *
   * @param entity - Entity to score
   * @param queryText - Query to match
   * @returns Score between 0 and 1
   */
  calculateQueryRelevance(entity: AgentEntity, queryText: string): number {
    // Build entity text for comparison
    const entityText = this.buildEntityText(entity);

    if (this.config.useSemanticSimilarity) {
      // Use TF-IDF cosine similarity for semantic matching
      return this.summarizationService.calculateSimilarity(entityText, queryText);
    }

    // Fallback to keyword matching
    const queryLower = queryText.toLowerCase();
    if (entity.name.toLowerCase().includes(queryLower)) {
      return 1.0;
    }
    if (entity.entityType.toLowerCase().includes(queryLower)) {
      return 0.7;
    }
    if (entity.observations?.some((o) => o.toLowerCase().includes(queryLower))) {
      return 0.5;
    }

    return 0;
  }

  /**
   * Calculate user intent relevance score.
   * Uses semantic similarity to match entity content against intent.
   *
   * @param entity - Entity to score
   * @param userIntent - Intent to match
   * @returns Score between 0 and 1
   */
  calculateIntentRelevance(entity: AgentEntity, userIntent: string): number {
    const entityText = this.buildEntityText(entity);

    if (this.config.useSemanticSimilarity) {
      return this.summarizationService.calculateSimilarity(entityText, userIntent);
    }

    // Fallback to keyword matching
    const intentLower = userIntent.toLowerCase();
    if (entity.observations?.some((o) => o.toLowerCase().includes(intentLower))) {
      return 0.8;
    }

    return 0;
  }

  /**
   * Build searchable text from entity for similarity comparison.
   *
   * @param entity - Entity to extract text from
   * @returns Combined text from entity fields
   */
  private buildEntityText(entity: AgentEntity): string {
    const parts: string[] = [
      entity.name,
      entity.entityType,
      ...(entity.observations ?? []),
    ];
    return parts.join(' ');
  }

  /**
   * Calculate novelty boost component.
   * Rewards entities that haven't been accessed recently and have unique observations.
   *
   * Novelty factors:
   * - Inverse access frequency (rare = more novel)
   * - Time since last access (long unaccessed = novel)
   * - Unique observations ratio (unique content = novel)
   *
   * @param entity - Entity to calculate for
   * @param context - Context with temporal focus
   * @returns Score between 0 and 1
   */
  private calculateNoveltyBoost(
    entity: AgentEntity,
    context: SalienceContext
  ): number {
    // Factor 1: Time-based novelty (inverse of recency)
    const lastAccess = entity.lastAccessedAt ?? entity.createdAt;
    let timeNovelty: number;
    if (!lastAccess) {
      timeNovelty = 1.0; // Never accessed = maximum novelty
    } else {
      const recency = AccessTracker.calculateRecencyScoreFromTimestamp(
        lastAccess,
        this.config.recencyDecayHours
      );
      timeNovelty = 1 - recency;
    }

    // Factor 2: Access frequency novelty (rare = more novel)
    const accessCount = entity.accessCount ?? 0;
    const frequencyNovelty = accessCount === 0 ? 1.0 : 1 / (1 + Math.log(accessCount + 1));

    // Factor 3: Observation uniqueness
    const uniquenessScore = this.calculateObservationUniqueness(entity);

    // Combine factors (weighted average)
    let novelty = (timeNovelty * 0.5) + (frequencyNovelty * 0.3) + (uniquenessScore * 0.2);

    // Adjust based on temporal focus
    if (context.temporalFocus === 'historical') {
      // Historical focus increases novelty importance
      novelty = Math.pow(novelty, 0.5); // Square root boosts mid values
    } else if (context.temporalFocus === 'recent') {
      // Recent focus decreases novelty importance
      novelty = Math.pow(novelty, 2); // Square reduces mid values
    }

    // Reduce novelty if entity is in recent context
    if (context.recentEntities?.includes(entity.name)) {
      novelty *= 0.5;
    }

    return Math.min(1, novelty);
  }

  /**
   * Calculate observation uniqueness score.
   * Measures how unique the entity's observations are compared to each other.
   * Higher uniqueness = more novel content.
   *
   * @param entity - Entity to evaluate
   * @returns Score between 0 and 1
   */
  private calculateObservationUniqueness(entity: AgentEntity): number {
    const observations = entity.observations ?? [];
    if (observations.length <= 1) {
      return 1.0; // Single or no observations = maximally unique
    }

    // Calculate average similarity between observations
    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < observations.length; i++) {
      for (let j = i + 1; j < observations.length; j++) {
        const similarity = this.summarizationService.calculateSimilarity(
          observations[i],
          observations[j]
        );
        totalSimilarity += similarity;
        comparisons++;
      }
    }

    if (comparisons === 0) {
      return 1.0;
    }

    // Average similarity - higher similarity = lower uniqueness
    const avgSimilarity = totalSimilarity / comparisons;

    // Invert: low similarity = high uniqueness
    return 1 - avgSimilarity;
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
