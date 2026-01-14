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
  /** Budget percentage for working memory (default: 0.3 = 30%) */
  workingBudgetPct?: number;
  /** Budget percentage for episodic memory (default: 0.3 = 30%) */
  episodicBudgetPct?: number;
  /** Budget percentage for semantic memory (default: 0.4 = 40%) */
  semanticBudgetPct?: number;
  /** Number of recent sessions to include for episodic (default: 3) */
  recentSessionCount?: number;
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
      workingBudgetPct: config.workingBudgetPct ?? 0.3,
      episodicBudgetPct: config.episodicBudgetPct ?? 0.3,
      semanticBudgetPct: config.semanticBudgetPct ?? 0.4,
      recentSessionCount: config.recentSessionCount ?? 3,
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

  // ==================== Type-Specific Retrieval ====================

  /**
   * Retrieve working memory entities for a session.
   *
   * @param sessionId - Session to retrieve working memory for
   * @param budget - Token budget for working memory
   * @param context - Salience context
   * @returns Working memory entities within budget
   */
  async retrieveWorkingMemory(
    sessionId: string | undefined,
    budget: number,
    context: SalienceContext = {}
  ): Promise<{ entities: AgentEntity[]; tokens: number }> {
    const graph = await this.storage.loadGraph();
    let candidates = graph.entities
      .filter(isAgentEntity)
      .filter((e) => (e as AgentEntity).memoryType === 'working') as AgentEntity[];

    // Filter by session if provided
    if (sessionId) {
      candidates = candidates.filter((e) => e.sessionId === sessionId);
    }

    // Score and select within budget
    const scored = await this.salienceEngine.rankEntitiesBySalience(candidates, context);
    const selected: AgentEntity[] = [];
    let usedTokens = 0;

    for (const s of scored) {
      const tokens = this.estimateTokens(s.entity);
      if (usedTokens + tokens <= budget) {
        selected.push(s.entity);
        usedTokens += tokens;
      }
    }

    return { entities: selected, tokens: usedTokens };
  }

  /**
   * Retrieve recent episodic memories.
   *
   * @param budget - Token budget for episodic memory
   * @param context - Salience context
   * @returns Recent episodic entities within budget
   */
  async retrieveEpisodicRecent(
    budget: number,
    context: SalienceContext = {}
  ): Promise<{ entities: AgentEntity[]; tokens: number }> {
    const graph = await this.storage.loadGraph();
    const episodic = graph.entities
      .filter(isAgentEntity)
      .filter((e) => (e as AgentEntity).memoryType === 'episodic') as AgentEntity[];

    // Sort by creation time (most recent first)
    const sorted = episodic.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    // Get unique sessions from recent memories
    const recentSessions = new Set<string>();
    for (const e of sorted) {
      if (e.sessionId) {
        recentSessions.add(e.sessionId);
        if (recentSessions.size >= this.config.recentSessionCount) break;
      }
    }

    // Filter to recent sessions
    const candidates = recentSessions.size > 0
      ? sorted.filter((e) => !e.sessionId || recentSessions.has(e.sessionId))
      : sorted;

    // Score and select within budget
    const scored = await this.salienceEngine.rankEntitiesBySalience(candidates, context);
    const selected: AgentEntity[] = [];
    let usedTokens = 0;

    for (const s of scored) {
      const tokens = this.estimateTokens(s.entity);
      if (usedTokens + tokens <= budget) {
        selected.push(s.entity);
        usedTokens += tokens;
      }
    }

    return { entities: selected, tokens: usedTokens };
  }

  /**
   * Retrieve semantically relevant memories.
   *
   * @param budget - Token budget for semantic memory
   * @param context - Salience context
   * @returns Relevant semantic entities within budget
   */
  async retrieveSemanticRelevant(
    budget: number,
    context: SalienceContext = {}
  ): Promise<{ entities: AgentEntity[]; tokens: number }> {
    const graph = await this.storage.loadGraph();
    const semantic = graph.entities
      .filter(isAgentEntity)
      .filter((e) => (e as AgentEntity).memoryType === 'semantic') as AgentEntity[];

    // Score by salience (which includes context relevance)
    const scored = await this.salienceEngine.rankEntitiesBySalience(semantic, context);
    const selected: AgentEntity[] = [];
    let usedTokens = 0;

    for (const s of scored) {
      const tokens = this.estimateTokens(s.entity);
      if (usedTokens + tokens <= budget) {
        selected.push(s.entity);
        usedTokens += tokens;
      }
    }

    return { entities: selected, tokens: usedTokens };
  }

  /**
   * Retrieve must-include entities with budget warning.
   *
   * @param names - Entity names to include
   * @param budget - Available budget
   * @returns Entities, tokens used, and any warnings
   */
  async retrieveMustInclude(
    names: string[],
    budget: number
  ): Promise<{ entities: AgentEntity[]; tokens: number; warnings: string[] }> {
    const warnings: string[] = [];
    const entities: AgentEntity[] = [];
    let totalTokens = 0;

    for (const name of names) {
      const entity = this.storage.getEntityByName(name);
      if (entity && isAgentEntity(entity)) {
        const agentEntity = entity as AgentEntity;
        const tokens = this.estimateTokens(agentEntity);
        entities.push(agentEntity);
        totalTokens += tokens;
      } else {
        warnings.push(`Must-include entity '${name}' not found`);
      }
    }

    if (totalTokens > budget) {
      warnings.push(
        `Must-include entities (${totalTokens} tokens) exceed available budget (${budget} tokens)`
      );
    }

    return { entities, tokens: totalTokens, warnings };
  }

  /**
   * Retrieve memories with budget allocation across memory types.
   *
   * Allocates budget percentages to each memory type:
   * - Working: 30% (configurable)
   * - Episodic: 30% (configurable)
   * - Semantic: 40% (configurable)
   *
   * Must-include entities are subtracted from total first.
   *
   * @param options - Retrieval options
   * @returns Context package with allocated retrieval
   */
  async retrieveWithBudgetAllocation(
    options: ContextRetrievalOptions
  ): Promise<ContextPackage> {
    const {
      maxTokens = this.config.defaultMaxTokens,
      context = {},
      includeWorkingMemory = true,
      includeEpisodicRecent = true,
      includeSemanticRelevant = true,
      mustInclude = [],
      minSalience = 0,
    } = options;

    const effectiveBudget = maxTokens - this.config.reserveBuffer;
    const allSuggestions: string[] = [];
    const allExcluded: ExcludedEntity[] = [];

    // Handle must-include first
    const mustIncludeResult = await this.retrieveMustInclude(mustInclude, effectiveBudget);
    allSuggestions.push(...mustIncludeResult.warnings);

    // Remaining budget after must-include
    const remainingBudget = Math.max(0, effectiveBudget - mustIncludeResult.tokens);

    // Calculate allocated budgets
    const workingBudget = includeWorkingMemory
      ? Math.floor(remainingBudget * this.config.workingBudgetPct)
      : 0;
    const episodicBudget = includeEpisodicRecent
      ? Math.floor(remainingBudget * this.config.episodicBudgetPct)
      : 0;
    const semanticBudget = includeSemanticRelevant
      ? Math.floor(remainingBudget * this.config.semanticBudgetPct)
      : 0;

    // Retrieve from each source
    const workingResult = includeWorkingMemory
      ? await this.retrieveWorkingMemory(context.currentSession, workingBudget, context)
      : { entities: [], tokens: 0 };

    const episodicResult = includeEpisodicRecent
      ? await this.retrieveEpisodicRecent(episodicBudget, context)
      : { entities: [], tokens: 0 };

    const semanticResult = includeSemanticRelevant
      ? await this.retrieveSemanticRelevant(semanticBudget, context)
      : { entities: [], tokens: 0 };

    // Combine all memories
    const allMemories = [
      ...mustIncludeResult.entities,
      ...workingResult.entities,
      ...episodicResult.entities,
      ...semanticResult.entities,
    ];

    // Deduplicate by name (must-include takes priority)
    const seen = new Set<string>();
    const deduped: AgentEntity[] = [];
    for (const e of allMemories) {
      if (!seen.has(e.name)) {
        seen.add(e.name);
        deduped.push(e);
      }
    }

    // Filter by minimum salience
    const scored = await this.salienceEngine.rankEntitiesBySalience(deduped, context);
    const mustIncludeSet = new Set(mustInclude);
    const filtered = scored.filter(
      (s) => s.salienceScore >= minSalience || mustIncludeSet.has(s.entity.name)
    );

    // Track low salience exclusions
    const lowSalienceExcluded = scored
      .filter((s) => s.salienceScore < minSalience && !mustIncludeSet.has(s.entity.name))
      .map((s) => ({
        entity: s.entity,
        reason: 'low_salience' as const,
        tokens: this.estimateTokens(s.entity),
        salience: s.salienceScore,
      }));
    allExcluded.push(...lowSalienceExcluded);

    // Calculate breakdown
    const breakdown: TokenBreakdown = {
      working: workingResult.tokens,
      episodic: episodicResult.tokens,
      semantic: semanticResult.tokens,
      procedural: 0,
      mustInclude: mustIncludeResult.tokens,
    };

    return {
      memories: filtered.map((s) => s.entity),
      totalTokens: this.estimateTotalTokens(filtered.map((s) => s.entity)),
      breakdown,
      excluded: allExcluded,
      suggestions: allSuggestions,
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
