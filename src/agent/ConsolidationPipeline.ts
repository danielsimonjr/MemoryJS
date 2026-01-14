/**
 * Consolidation Pipeline
 *
 * Orchestrates memory transformation from working to long-term storage.
 * Includes summarization, pattern extraction, and promotion stages.
 *
 * @module agent/ConsolidationPipeline
 */

import type { IGraphStorage, Entity } from '../types/types.js';
import type {
  AgentEntity,
  ConsolidateOptions,
  ConsolidationResult,
  SummarizationResult,
  PatternResult,
  MemoryType,
} from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import type { WorkingMemoryManager } from './WorkingMemoryManager.js';
import type { DecayEngine } from './DecayEngine.js';
import { SummarizationService } from './SummarizationService.js';
import { PatternDetector } from './PatternDetector.js';

/**
 * Configuration for ConsolidationPipeline.
 */
export interface ConsolidationPipelineConfig {
  /** Enable observation summarization (default: true) */
  summarizationEnabled?: boolean;
  /** Enable pattern extraction (default: true) */
  patternExtractionEnabled?: boolean;
  /** Minimum confidence for promotion (default: 0.7) */
  minPromotionConfidence?: number;
  /** Minimum confirmations for promotion (default: 2) */
  minPromotionConfirmations?: number;
  /** Preserve originals after promotion (default: false) */
  preserveOriginals?: boolean;
  /** Similarity threshold for observation grouping (default: 0.8) */
  similarityThreshold?: number;
}

/**
 * Interface for pluggable pipeline stages.
 */
export interface PipelineStage {
  /** Stage name for logging/debugging */
  name: string;
  /** Process entities through this stage */
  process(
    entities: AgentEntity[],
    options: ConsolidateOptions
  ): Promise<StageResult>;
}

/**
 * Result from a single pipeline stage.
 */
export interface StageResult {
  /** Number of entities processed */
  processed: number;
  /** Number of entities transformed */
  transformed: number;
  /** Error messages from this stage */
  errors: string[];
}

/**
 * Orchestrates memory consolidation from working to long-term storage.
 *
 * ConsolidationPipeline is the central coordinator for transforming
 * working memories into long-term storage. It evaluates promotion
 * criteria, runs through pluggable pipeline stages, and tracks
 * results across all operations.
 *
 * @example
 * ```typescript
 * const pipeline = new ConsolidationPipeline(storage, wmm, decay);
 *
 * // Consolidate all memories from a session
 * const result = await pipeline.consolidateSession('session_123');
 * console.log(`Promoted ${result.memoriesPromoted} memories`);
 *
 * // Promote a specific memory
 * const promoted = await pipeline.promoteMemory('memory_abc', 'semantic');
 *
 * // Register custom pipeline stage
 * pipeline.registerStage({
 *   name: 'custom_stage',
 *   async process(entities, options) {
 *     // Custom processing logic
 *     return { processed: entities.length, transformed: 0, errors: [] };
 *   }
 * });
 * ```
 */
export class ConsolidationPipeline {
  private readonly storage: IGraphStorage;
  private readonly workingMemory: WorkingMemoryManager;
  private readonly decayEngine: DecayEngine;
  private readonly summarizationService: SummarizationService;
  private readonly config: Required<ConsolidationPipelineConfig>;
  private readonly stages: PipelineStage[] = [];
  private readonly patternDetector: PatternDetector;

  constructor(
    storage: IGraphStorage,
    workingMemory: WorkingMemoryManager,
    decayEngine: DecayEngine,
    config: ConsolidationPipelineConfig = {}
  ) {
    this.storage = storage;
    this.workingMemory = workingMemory;
    this.decayEngine = decayEngine;
    this.summarizationService = new SummarizationService({
      defaultSimilarityThreshold: config.similarityThreshold ?? 0.8,
    });
    this.config = {
      summarizationEnabled: config.summarizationEnabled ?? true,
      patternExtractionEnabled: config.patternExtractionEnabled ?? true,
      minPromotionConfidence: config.minPromotionConfidence ?? 0.7,
      minPromotionConfirmations: config.minPromotionConfirmations ?? 2,
      preserveOriginals: config.preserveOriginals ?? false,
      similarityThreshold: config.similarityThreshold ?? 0.8,
    };
    this.patternDetector = new PatternDetector();
  }

  // ==================== Stage Registration ====================

  /**
   * Register a pipeline stage.
   *
   * Stages are executed in registration order during consolidation.
   * Each stage can transform entities and report results.
   *
   * @param stage - Pipeline stage to register
   */
  registerStage(stage: PipelineStage): void {
    this.stages.push(stage);
  }

  /**
   * Get registered pipeline stages.
   */
  getStages(): readonly PipelineStage[] {
    return this.stages;
  }

  /**
   * Clear all registered stages.
   */
  clearStages(): void {
    this.stages.length = 0;
  }

  // ==================== Session Consolidation ====================

  /**
   * Consolidate all memories from a session.
   *
   * Processes all working memories for the session, evaluates them
   * against promotion criteria, runs through pipeline stages, and
   * promotes eligible memories to long-term storage.
   *
   * @param sessionId - Session to consolidate
   * @param options - Consolidation options
   * @returns Consolidation result with statistics
   *
   * @example
   * ```typescript
   * // Default consolidation
   * const result = await pipeline.consolidateSession('session_123');
   *
   * // Custom options
   * const result = await pipeline.consolidateSession('session_123', {
   *   minConfidence: 0.9,
   *   targetType: 'semantic',
   *   preserveOriginals: true,
   * });
   * ```
   */
  async consolidateSession(
    sessionId: string,
    options?: ConsolidateOptions
  ): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      memoriesProcessed: 0,
      memoriesPromoted: 0,
      memoriesMerged: 0,
      patternsExtracted: 0,
      summariesCreated: 0,
      errors: [],
    };

    try {
      // Get all working memories for session
      const memories = await this.workingMemory.getSessionMemories(sessionId);
      result.memoriesProcessed = memories.length;

      if (memories.length === 0) {
        return result;
      }

      // Merge options with config defaults
      const effectiveOptions: Required<ConsolidateOptions> = {
        summarize: options?.summarize ?? this.config.summarizationEnabled,
        extractPatterns:
          options?.extractPatterns ?? this.config.patternExtractionEnabled,
        minConfidence:
          options?.minConfidence ?? this.config.minPromotionConfidence,
        minConfirmations:
          options?.minConfirmations ?? this.config.minPromotionConfirmations,
        preserveOriginals:
          options?.preserveOriginals ?? this.config.preserveOriginals,
        targetType: options?.targetType ?? 'episodic',
      };

      // Filter promotion candidates
      const candidates = memories.filter(
        (m) =>
          (m.confidence ?? 0) >= effectiveOptions.minConfidence &&
          (m.confirmationCount ?? 0) >= effectiveOptions.minConfirmations
      );

      // Run through registered pipeline stages
      for (const stage of this.stages) {
        try {
          const stageResult = await stage.process(candidates, effectiveOptions);
          // Aggregate stage results
          result.patternsExtracted += stageResult.transformed;
          result.errors.push(...stageResult.errors);
        } catch (error) {
          result.errors.push(`Stage ${stage.name} failed: ${error}`);
        }
      }

      // Promote eligible memories
      for (const candidate of candidates) {
        try {
          await this.promoteMemory(candidate.name, effectiveOptions.targetType);
          result.memoriesPromoted++;
        } catch (error) {
          result.errors.push(`Promotion failed for ${candidate.name}: ${error}`);
        }
      }

      // Clean up originals if not preserving
      // Working memories will expire naturally via TTL,
      // but we could actively delete them here if needed
    } catch (error) {
      result.errors.push(`Session consolidation failed: ${error}`);
    }

    return result;
  }

  // ==================== Individual Memory Promotion ====================

  /**
   * Promote a working memory to long-term storage.
   *
   * Updates the memory type, clears working memory fields,
   * sets promotion metadata, and reinforces against decay.
   *
   * @param entityName - Name of entity to promote
   * @param targetType - Target memory type (episodic or semantic)
   * @returns Updated entity
   * @throws Error if entity not found or not working memory
   *
   * @example
   * ```typescript
   * // Promote to episodic (default - preserves temporal context)
   * const episodic = await pipeline.promoteMemory('memory_123', 'episodic');
   *
   * // Promote to semantic (abstracts away temporal context)
   * const semantic = await pipeline.promoteMemory('memory_456', 'semantic');
   * ```
   */
  async promoteMemory(
    entityName: string,
    targetType: MemoryType
  ): Promise<AgentEntity> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    if (!isAgentEntity(entity)) {
      throw new Error(`Entity is not an AgentEntity: ${entityName}`);
    }

    const agentEntity = entity as AgentEntity;
    if (agentEntity.memoryType !== 'working') {
      throw new Error(`Entity is not working memory: ${entityName}`);
    }

    const now = new Date().toISOString();
    const updates: Partial<AgentEntity> = {
      // Change memory type
      memoryType: targetType,

      // Clear working memory fields
      isWorkingMemory: false,
      expiresAt: undefined,

      // Set promotion metadata
      promotedAt: now,
      promotedFrom: agentEntity.sessionId,
      markedForPromotion: false,

      // Update timestamp
      lastModified: now,
    };

    // Type-specific processing
    if (targetType === 'semantic') {
      // For semantic memory, we might want to:
      // - Abstract away session-specific context
      // - Generalize observations
      // This is typically handled by summarization stages
    } else if (targetType === 'episodic') {
      // For episodic memory:
      // - Preserve temporal context
      // - Keep sessionId and timestamps intact
      // This is the default behavior
    }

    await this.storage.updateEntity(entityName, updates as Partial<Entity>);

    // Reinforce the memory to reset decay
    await this.decayEngine.reinforceMemory(entityName);

    return { ...agentEntity, ...updates } as AgentEntity;
  }

  // ==================== Batch Operations ====================

  /**
   * Consolidate multiple sessions.
   *
   * @param sessionIds - Sessions to consolidate
   * @param options - Shared options for all sessions
   * @returns Aggregated consolidation result
   */
  async consolidateSessions(
    sessionIds: string[],
    options?: ConsolidateOptions
  ): Promise<ConsolidationResult> {
    const aggregatedResult: ConsolidationResult = {
      memoriesProcessed: 0,
      memoriesPromoted: 0,
      memoriesMerged: 0,
      patternsExtracted: 0,
      summariesCreated: 0,
      errors: [],
    };

    for (const sessionId of sessionIds) {
      const result = await this.consolidateSession(sessionId, options);
      aggregatedResult.memoriesProcessed += result.memoriesProcessed;
      aggregatedResult.memoriesPromoted += result.memoriesPromoted;
      aggregatedResult.memoriesMerged += result.memoriesMerged;
      aggregatedResult.patternsExtracted += result.patternsExtracted;
      aggregatedResult.summariesCreated += result.summariesCreated;
      aggregatedResult.errors.push(...result.errors);
    }

    return aggregatedResult;
  }

  // ==================== Candidate Evaluation ====================

  /**
   * Get promotion candidates from a session without promoting them.
   *
   * @param sessionId - Session to evaluate
   * @param options - Criteria for candidate selection
   * @returns Entities eligible for promotion
   */
  async getPromotionCandidates(
    sessionId: string,
    options?: Pick<ConsolidateOptions, 'minConfidence' | 'minConfirmations'>
  ): Promise<AgentEntity[]> {
    const memories = await this.workingMemory.getSessionMemories(sessionId);

    const minConfidence =
      options?.minConfidence ?? this.config.minPromotionConfidence;
    const minConfirmations =
      options?.minConfirmations ?? this.config.minPromotionConfirmations;

    return memories.filter(
      (m) =>
        (m.confidence ?? 0) >= minConfidence &&
        (m.confirmationCount ?? 0) >= minConfirmations
    );
  }

  /**
   * Check if an entity is eligible for promotion.
   *
   * @param entityName - Entity to check
   * @param options - Criteria for eligibility
   * @returns True if eligible
   */
  async isPromotionEligible(
    entityName: string,
    options?: Pick<ConsolidateOptions, 'minConfidence' | 'minConfirmations'>
  ): Promise<boolean> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity || !isAgentEntity(entity)) {
      return false;
    }

    const agentEntity = entity as AgentEntity;
    if (agentEntity.memoryType !== 'working') {
      return false;
    }

    const minConfidence =
      options?.minConfidence ?? this.config.minPromotionConfidence;
    const minConfirmations =
      options?.minConfirmations ?? this.config.minPromotionConfirmations;

    return (
      (agentEntity.confidence ?? 0) >= minConfidence &&
      (agentEntity.confirmationCount ?? 0) >= minConfirmations
    );
  }

  // ==================== Observation Summarization ====================

  /**
   * Summarize similar observations in an entity.
   *
   * Groups observations by similarity and creates summaries
   * for each group. Single-observation groups are preserved unchanged.
   *
   * @param entity - Entity whose observations to summarize
   * @param threshold - Similarity threshold (0-1, default from config)
   * @returns Summarization result with compression statistics
   *
   * @example
   * ```typescript
   * const result = await pipeline.summarizeObservations(entity);
   * console.log(`Compressed ${result.originalCount} to ${result.summaryCount}`);
   * console.log(`Compression ratio: ${result.compressionRatio.toFixed(2)}x`);
   * ```
   */
  async summarizeObservations(
    entity: AgentEntity,
    threshold?: number
  ): Promise<SummarizationResult> {
    const observations = entity.observations;
    if (!observations || observations.length < 2) {
      return {
        originalCount: observations?.length ?? 0,
        summaryCount: observations?.length ?? 0,
        compressionRatio: 1,
        summaries: observations ? [...observations] : [],
        sourceObservations: observations ? observations.map((o) => [o]) : [],
      };
    }

    const effectiveThreshold = threshold ?? this.config.similarityThreshold;

    // Group similar observations
    const groupingResult = await this.summarizationService.groupSimilarObservations(
      observations,
      effectiveThreshold
    );

    // Summarize each group
    const summaries = await this.summarizationService.summarizeGroups(
      groupingResult.groups
    );

    return {
      originalCount: observations.length,
      summaryCount: summaries.length,
      compressionRatio: observations.length / summaries.length,
      summaries,
      sourceObservations: groupingResult.groups,
    };
  }

  /**
   * Apply summarization to entity and update storage.
   *
   * @param entityName - Name of entity to summarize
   * @param threshold - Similarity threshold (optional)
   * @returns Summarization result
   */
  async applySummarizationToEntity(
    entityName: string,
    threshold?: number
  ): Promise<SummarizationResult> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity || !isAgentEntity(entity)) {
      return {
        originalCount: 0,
        summaryCount: 0,
        compressionRatio: 1,
        summaries: [],
        sourceObservations: [],
      };
    }

    const agentEntity = entity as AgentEntity;
    const result = await this.summarizeObservations(agentEntity, threshold);

    // Update entity with summarized observations
    if (result.compressionRatio > 1) {
      await this.storage.updateEntity(entityName, {
        observations: result.summaries,
        lastModified: new Date().toISOString(),
      } as Partial<Entity>);
    }

    return result;
  }

  /**
   * Calculate similarity between two texts.
   *
   * @param text1 - First text
   * @param text2 - Second text
   * @returns Similarity score (0-1)
   */
  calculateSimilarity(text1: string, text2: string): number {
    return this.summarizationService.calculateSimilarity(text1, text2);
  }

  /**
   * Get the summarization service for advanced operations.
   */
  getSummarizationService(): SummarizationService {
    return this.summarizationService;
  }

  // ==================== Pattern Extraction ====================

  /**
   * Extract recurring patterns from observations across entities.
   *
   * Analyzes observations in entities of the specified type to identify
   * common templates with variable slots. Useful for discovering
   * generalizations that can be converted to semantic memory.
   *
   * @param entityType - Type of entities to analyze
   * @param minOccurrences - Minimum times pattern must appear (default: 3)
   * @returns Array of detected patterns
   *
   * @example
   * ```typescript
   * // Find patterns in preference entities
   * const patterns = await pipeline.extractPatterns('preference', 3);
   * for (const p of patterns) {
   *   console.log(`Pattern: ${p.pattern}`);
   *   console.log(`Values: ${p.variables.join(', ')}`);
   * }
   * ```
   */
  async extractPatterns(
    entityType: string,
    minOccurrences: number = 3
  ): Promise<PatternResult[]> {
    const graph = await this.storage.loadGraph();
    const observations: string[] = [];
    const entityNames: string[] = [];

    // Collect all observations from matching entities
    for (const entity of graph.entities) {
      if (entity.entityType === entityType && entity.observations) {
        observations.push(...entity.observations);
        for (let i = 0; i < entity.observations.length; i++) {
          entityNames.push(entity.name);
        }
      }
    }

    if (observations.length < minOccurrences) {
      return [];
    }

    // Detect patterns using PatternDetector
    const patterns = this.patternDetector.detectPatterns(observations, minOccurrences);

    // Associate patterns with source entities
    return patterns.map((pattern) => {
      const sourceEntities = new Set<string>();
      const regex = this.patternToRegex(pattern.pattern);

      for (let i = 0; i < observations.length; i++) {
        if (regex.test(observations[i])) {
          sourceEntities.add(entityNames[i]);
        }
      }

      return {
        ...pattern,
        sourceEntities: Array.from(sourceEntities),
      };
    });
  }

  /**
   * Create a semantic memory entity from a detected pattern.
   *
   * Converts a pattern template into a semantic memory that represents
   * the generalization, with relations to source entities.
   *
   * @param pattern - The detected pattern
   * @param sourceEntityNames - Names of entities that contributed to pattern
   * @returns Created semantic memory entity
   *
   * @example
   * ```typescript
   * const patterns = await pipeline.extractPatterns('preference', 3);
   * for (const p of patterns) {
   *   const semantic = await pipeline.createSemanticFromPattern(p, p.sourceEntities);
   *   console.log(`Created semantic memory: ${semantic.name}`);
   * }
   * ```
   */
  async createSemanticFromPattern(
    pattern: PatternResult,
    sourceEntityNames: string[]
  ): Promise<AgentEntity> {
    const now = new Date().toISOString();
    const name = `semantic_pattern_${Date.now()}_${this.hashPattern(pattern.pattern)}`;

    const entity: AgentEntity = {
      name,
      entityType: 'pattern',
      observations: [
        `Pattern: ${pattern.pattern}`,
        `Known values: ${pattern.variables.join(', ')}`,
        `Observed ${pattern.occurrences} times`,
      ],
      createdAt: now,
      lastModified: now,
      importance: 7, // Patterns are generally important
      memoryType: 'semantic',
      accessCount: 0,
      confidence: pattern.confidence,
      confirmationCount: pattern.occurrences,
      visibility: 'private',
    };

    await this.storage.appendEntity(entity as Entity);

    // Create relations to source entities
    const graph = await this.storage.loadGraph();
    const existingRelations = new Set(
      graph.relations.map((r) => `${r.from}:${r.to}:${r.relationType}`)
    );

    for (const sourceName of sourceEntityNames) {
      const relationKey = `${name}:${sourceName}:derived_from`;
      if (!existingRelations.has(relationKey)) {
        await this.storage.appendRelation({
          from: name,
          to: sourceName,
          relationType: 'derived_from',
        });
      }
    }

    return entity;
  }

  /**
   * Extract patterns and create semantic memories for significant ones.
   *
   * Combines pattern extraction and semantic memory creation in one operation.
   *
   * @param entityType - Type of entities to analyze
   * @param minOccurrences - Minimum pattern frequency
   * @param minConfidence - Minimum confidence for semantic creation (default: 0.5)
   * @returns Array of created semantic memory entities
   */
  async extractAndCreateSemanticPatterns(
    entityType: string,
    minOccurrences: number = 3,
    minConfidence: number = 0.5
  ): Promise<AgentEntity[]> {
    const patterns = await this.extractPatterns(entityType, minOccurrences);
    const semanticEntities: AgentEntity[] = [];

    for (const pattern of patterns) {
      if (pattern.confidence >= minConfidence) {
        const semantic = await this.createSemanticFromPattern(
          pattern,
          pattern.sourceEntities
        );
        semanticEntities.push(semantic);
      }
    }

    return semanticEntities;
  }

  /**
   * Get the pattern detector for advanced operations.
   */
  getPatternDetector(): PatternDetector {
    return this.patternDetector;
  }

  /**
   * Convert a pattern template to a regex for matching.
   * @internal
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\{X\\}/g, '.+?');
    return new RegExp(`^${escaped}$`, 'i');
  }

  /**
   * Create a simple hash of a pattern for unique naming.
   * @internal
   */
  private hashPattern(pattern: string): string {
    let hash = 0;
    for (let i = 0; i < pattern.length; i++) {
      hash = ((hash << 5) - hash) + pattern.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  // ==================== Configuration Access ====================

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<ConsolidationPipelineConfig>> {
    return { ...this.config };
  }
}
