/**
 * Context Window Manager
 *
 * Manages memory retrieval within LLM token budget constraints.
 * Uses salience scoring to prioritize the most relevant memories.
 *
 * @module agent/ContextWindowManager
 */

import type { IGraphStorage } from '../types/types.js';
import type {
  AgentEntity,
  SalienceContext,
  ContextRetrievalOptions,
  ContextPackage,
  TokenBreakdown,
  ExcludedEntity,
  ScoredEntity,
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import { SalienceEngine } from './SalienceEngine.js';

/**
 * Configuration for ContextWindowManager.
 */
export interface ContextWindowManagerConfig {
  /** Default maximum tokens (default: 4000) */
  defaultMaxTokens?: number;
  /** Token estimation multiplier (default: 1.3, roughly words to tokens) */
  tokenMultiplier?: number;
  /** Reserve buffer for system/formatting (default: 100) */
  reserveBuffer?: number;
  /** Maximum entities to consider (default: 1000) */
  maxEntitiesToConsider?: number;
}

/**
 * Manages memory retrieval within LLM token budget constraints.
 *
 * The ContextWindowManager combines salience scoring with token estimation
 * to select the most relevant memories that fit within a given token budget.
 * It uses a greedy algorithm that maximizes total salience while respecting
 * the budget constraint.
 *
 * @example
 * ```typescript
 * const manager = new ContextWindowManager(storage, salienceEngine);
 * const result = await manager.retrieveForContext({
 *   maxTokens: 4000,
 *   context: { currentTask: 'booking' },
 *   includeWorkingMemory: true,
 *   mustInclude: ['user_preferences'],
 * });
 * console.log(`Retrieved ${result.memories.length} memories using ${result.totalTokens} tokens`);
 * ```
 */
export class ContextWindowManager {
  private readonly storage: IGraphStorage;
  private readonly salienceEngine: SalienceEngine;
  private readonly config: Required<ContextWindowManagerConfig>;

  constructor(
    storage: IGraphStorage,
    salienceEngine: SalienceEngine,
    config: ContextWindowManagerConfig = {}
  ) {
    this.storage = storage;
    this.salienceEngine = salienceEngine;
    this.config = {
      defaultMaxTokens: config.defaultMaxTokens ?? 4000,
      tokenMultiplier: config.tokenMultiplier ?? 1.3,
      reserveBuffer: config.reserveBuffer ?? 100,
      maxEntitiesToConsider: config.maxEntitiesToConsider ?? 1000,
    };
  }

  // ==================== Token Estimation ====================

  /**
   * Estimate token count for an entity.
   *
   * Uses a simple heuristic: word count * multiplier (default 1.3).
   * Includes name, entityType, and all observations.
   *
   * @param entity - Entity to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokens(entity: AgentEntity): number {
    const parts: string[] = [
      entity.name,
      entity.entityType,
      ...(entity.observations ?? []),
    ];

    // Add metadata fields if present
    if (entity.memoryType) parts.push(entity.memoryType);
    if (entity.sessionId) parts.push(entity.sessionId);
    if (entity.taskId) parts.push(entity.taskId);

    const text = parts.join(' ');
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

    return Math.ceil(wordCount * this.config.tokenMultiplier);
  }

  /**
   * Estimate total tokens for multiple entities.
   *
   * @param entities - Entities to estimate
   * @returns Total estimated tokens
   */
  estimateTotalTokens(entities: AgentEntity[]): number {
    return entities.reduce((sum, e) => sum + this.estimateTokens(e), 0);
  }

  // ==================== Prioritization ====================

  /**
   * Prioritize entities to fit within token budget.
   *
   * Uses a greedy algorithm that selects entities by salience/token ratio
   * to maximize total salience within the budget constraint.
   *
   * @param entities - Candidate entities
   * @param budget - Maximum tokens allowed
   * @param context - Salience context for scoring
   * @param mustInclude - Entity names that must be included
   * @returns Prioritized entities and excluded entities
   */
  async prioritize(
    entities: AgentEntity[],
    budget: number,
    context: SalienceContext = {},
    mustInclude: string[] = []
  ): Promise<{ selected: ScoredEntity[]; excluded: ExcludedEntity[] }> {
    const mustIncludeSet = new Set(mustInclude);

    // Score all entities
    const scored = await this.salienceEngine.rankEntitiesBySalience(entities, context);

    // Calculate tokens for each
    const withTokens = scored.map((s) => ({
      ...s,
      tokens: this.estimateTokens(s.entity),
    }));

    // Separate must-include from optional
    const required = withTokens.filter((s) => mustIncludeSet.has(s.entity.name));
    const optional = withTokens.filter((s) => !mustIncludeSet.has(s.entity.name));

    // Calculate salience/token efficiency for optional entities
    const withEfficiency = optional.map((s) => ({
      ...s,
      efficiency: s.tokens > 0 ? s.salienceScore / s.tokens : 0,
    }));

    // Sort by efficiency (descending) for greedy selection
    withEfficiency.sort((a, b) => b.efficiency - a.efficiency);

    // Start with must-include entities
    const selected: ScoredEntity[] = required.map((r) => ({
      entity: r.entity,
      salienceScore: r.salienceScore,
      components: r.components,
    }));
    let usedTokens = required.reduce((sum, r) => sum + r.tokens, 0);

    const excluded: ExcludedEntity[] = [];

    // Check if must-include already exceeds budget
    if (usedTokens > budget) {
      // Mark some must-include as excluded (but still include them)
      // This is a warning case - must-include takes priority
    }

    // Greedily add optional entities by efficiency
    for (const candidate of withEfficiency) {
      if (usedTokens + candidate.tokens <= budget) {
        selected.push({
          entity: candidate.entity,
          salienceScore: candidate.salienceScore,
          components: candidate.components,
        });
        usedTokens += candidate.tokens;
      } else {
        excluded.push({
          entity: candidate.entity,
          reason: 'budget_exceeded',
          tokens: candidate.tokens,
          salience: candidate.salienceScore,
        });
      }
    }

    return { selected, excluded };
  }

  // ==================== Main Retrieval Method ====================

  /**
   * Retrieve memories for context within token budget.
   *
   * @param options - Retrieval options
   * @returns Context package with memories, token info, and suggestions
   */
  async retrieveForContext(options: ContextRetrievalOptions): Promise<ContextPackage> {
    const {
      maxTokens = this.config.defaultMaxTokens,
      context = {},
      includeWorkingMemory = true,
      includeEpisodicRecent = true,
      includeSemanticRelevant = true,
      mustInclude = [],
      minSalience = 0,
    } = options;

    // Effective budget after reserve
    const effectiveBudget = maxTokens - this.config.reserveBuffer;

    // Load all agent entities
    const graph = await this.storage.loadGraph();
    const allEntities = graph.entities.filter(isAgentEntity) as AgentEntity[];

    // Filter by memory type based on options
    let candidates = allEntities.filter((e) => {
      if (!includeWorkingMemory && e.memoryType === 'working') return false;
      if (!includeEpisodicRecent && e.memoryType === 'episodic') return false;
      if (!includeSemanticRelevant && e.memoryType === 'semantic') return false;
      return true;
    });

    // Limit candidates for performance
    if (candidates.length > this.config.maxEntitiesToConsider) {
      // Pre-filter by salience to reduce candidates
      const preScored = await this.salienceEngine.rankEntitiesBySalience(candidates, context);
      candidates = preScored
        .slice(0, this.config.maxEntitiesToConsider)
        .map((s) => s.entity);
    }

    // Prioritize within budget
    const { selected, excluded } = await this.prioritize(
      candidates,
      effectiveBudget,
      context,
      mustInclude
    );

    // Filter by minimum salience
    const filtered = selected.filter((s) => s.salienceScore >= minSalience);
    const lowSalienceExcluded = selected
      .filter((s) => s.salienceScore < minSalience)
      .map((s) => ({
        entity: s.entity,
        reason: 'low_salience' as const,
        tokens: this.estimateTokens(s.entity),
        salience: s.salienceScore,
      }));

    // Calculate breakdown by memory type
    const breakdown = this.calculateBreakdown(filtered, mustInclude);

    // Generate suggestions for excluded high-salience entities
    const suggestions = this.generateSuggestions(excluded);

    return {
      memories: filtered.map((s) => s.entity),
      totalTokens: this.estimateTotalTokens(filtered.map((s) => s.entity)),
      breakdown,
      excluded: [...excluded, ...lowSalienceExcluded],
      suggestions,
    };
  }

  // ==================== Helper Methods ====================

  /**
   * Calculate token breakdown by memory type.
   */
  private calculateBreakdown(
    entities: ScoredEntity[],
    mustInclude: string[]
  ): TokenBreakdown {
    const mustIncludeSet = new Set(mustInclude);
    const breakdown: TokenBreakdown = {
      working: 0,
      episodic: 0,
      semantic: 0,
      procedural: 0,
      mustInclude: 0,
    };

    for (const scored of entities) {
      const tokens = this.estimateTokens(scored.entity);

      if (mustIncludeSet.has(scored.entity.name)) {
        breakdown.mustInclude += tokens;
      } else {
        const memType = scored.entity.memoryType ?? 'working';
        if (memType in breakdown) {
          breakdown[memType as keyof Omit<TokenBreakdown, 'mustInclude'>] += tokens;
        }
      }
    }

    return breakdown;
  }

  /**
   * Generate suggestions for high-salience excluded entities.
   */
  private generateSuggestions(excluded: ExcludedEntity[]): string[] {
    const suggestions: string[] = [];

    // Find high-salience excluded entities
    const highSalience = excluded
      .filter((e) => (e.salience ?? 0) > 0.5)
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
      .slice(0, 3);

    for (const e of highSalience) {
      suggestions.push(
        `Consider including '${e.entity.name}' (salience: ${(e.salience ?? 0).toFixed(2)}, tokens: ${e.tokens}) if budget increases`
      );
    }

    if (excluded.length > 5) {
      suggestions.push(
        `${excluded.length} entities excluded due to budget constraints`
      );
    }

    return suggestions;
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<ContextWindowManagerConfig>> {
    return { ...this.config };
  }
}
