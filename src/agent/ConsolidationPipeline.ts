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
  MemoryMergeStrategy,
  MergeResult,
  DuplicatePair,
  ConsolidationTrigger,
  ConsolidationRule,
} from '../types/agent-memory.js';
import { isAgentEntity, isProspectiveMemory } from '../types/agent-memory.js';
import { tokenize } from '../utils/textSimilarity.js';
import type { WorkingMemoryManager } from './WorkingMemoryManager.js';
import type { DecayEngine } from './DecayEngine.js';
import { SummarizationService } from './SummarizationService.js';
import { PatternDetector } from './PatternDetector.js';
import { RuleEvaluator } from './RuleEvaluator.js';
import type { ReflectionManager } from './ReflectionManager.js';
import type { TrajectoryCompressor } from './TrajectoryCompressor.js';
import type { ReflectionScope } from '../types/agent-memory.js';

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
  private readonly ruleEvaluator: RuleEvaluator;
  private readonly rules: ConsolidationRule[] = [];

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
    this.ruleEvaluator = new RuleEvaluator();
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

    // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- entity existence-checked at entry; closing this microtask-gap TOCTOU race needs storage-level atomic check-and-set (task #55)
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
  isPromotionEligible(
    entityName: string,
    options?: Pick<ConsolidateOptions, 'minConfidence' | 'minConfirmations'>
  ): boolean {
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
      // eslint-disable-next-line memoryjs/no-unused-updateentity-return -- summarized observations are best-effort; the SummarizationResult is still returned and the op is re-runnable
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

  // ==================== Memory Merging ====================

  /**
   * Merge multiple entities into one using the specified strategy.
   *
   * Strategies:
   * - newest: Keep the most recently modified entity
   * - strongest: Keep entity with highest confidence * confirmations
   * - merge_observations: Combine all observations into first entity
   *
   * @param entityNames - Names of entities to merge
   * @param strategy - Merge strategy to apply
   * @returns The merge result with survivor entity
   * @throws Error if less than 2 entities or entity not found
   *
   * @example
   * ```typescript
   * const result = await pipeline.mergeMemories(
   *   ['memory_1', 'memory_2', 'memory_3'],
   *   'strongest'
   * );
   * console.log(`Survivor: ${result.survivor.name}`);
   * ```
   */
  async mergeMemories(
    entityNames: string[],
    strategy: MemoryMergeStrategy
  ): Promise<MergeResult> {
    if (entityNames.length < 2) {
      throw new Error('Need at least 2 entities to merge');
    }

    // Load all entities
    const entities: AgentEntity[] = [];
    for (const name of entityNames) {
      const entity = this.storage.getEntityByName(name);
      if (!entity || !isAgentEntity(entity)) {
        throw new Error(`Entity not found or not AgentEntity: ${name}`);
      }
      entities.push(entity as AgentEntity);
    }

    // Determine survivor based on strategy
    let survivor: AgentEntity;
    switch (strategy) {
      case 'newest':
        survivor = this.selectNewest(entities);
        break;
      case 'strongest':
        survivor = this.selectStrongest(entities);
        break;
      case 'merge_observations':
      default:
        survivor = entities[0];
        break;
    }

    // Merge observations from all entities into survivor
    const allObservations = new Set<string>();
    for (const entity of entities) {
      entity.observations?.forEach((o) => allObservations.add(o));
    }

    const mergedObservations = Array.from(allObservations);

    // Calculate merged metadata
    const updates: Partial<AgentEntity> = {
      observations: mergedObservations,
      confirmationCount: entities.reduce(
        (sum, e) => sum + (e.confirmationCount ?? 0),
        0
      ),
      accessCount: entities.reduce((sum, e) => sum + (e.accessCount ?? 0), 0),
      lastModified: new Date().toISOString(),
    };

    // Update survivor. If the survivor vanished between merge-planning and
    // this write, abort BEFORE the destructive delete-others step below —
    // proceeding would delete the merged entities with no survivor to hold
    // their data.
    const survivorPersisted = await this.storage.updateEntity(
      survivor.name,
      updates as Partial<Entity>
    );
    if (!survivorPersisted) {
      throw new Error(
        `ConsolidationPipeline.mergeMemories: survivor '${survivor.name}' vanished mid-merge; aborting before delete to prevent data loss`
      );
    }

    // Record merge in audit trail
    await this.recordMerge(entityNames, survivor.name, strategy);

    // Remove other entities (delete them from storage)
    const graph = await this.storage.loadGraph();
    const mergedNames = entityNames.filter((n) => n !== survivor.name);

    // Filter out merged entities and their relations
    const filteredEntities = graph.entities.filter(
      (e) => !mergedNames.includes(e.name)
    );

    // Retarget relations
    const seenRelations = new Set<string>();
    const filteredRelations = graph.relations
      .map((r) => {
        let from = r.from;
        let to = r.to;

        // Retarget from merged entities
        if (mergedNames.includes(from)) from = survivor.name;
        if (mergedNames.includes(to)) to = survivor.name;

        return { ...r, from, to };
      })
      .filter((r) => {
        // Skip self-relations
        if (r.from === r.to) return false;

        // Skip duplicates
        const key = `${r.from}|${r.to}|${r.relationType}`;
        if (seenRelations.has(key)) return false;
        seenRelations.add(key);

        return true;
      });

    await this.storage.saveGraph({
      entities: filteredEntities,
      relations: filteredRelations,
    });

    return {
      survivor: { ...survivor, ...updates } as AgentEntity,
      mergedEntities: entityNames,
      mergedCount: entityNames.length,
      strategy,
      observationCount: mergedObservations.length,
    };
  }

  /**
   * Find potential duplicate entities based on similarity.
   *
   * @param threshold - Similarity threshold (0-1, default 0.9)
   * @returns Array of duplicate pairs sorted by similarity
   *
   * @example
   * ```typescript
   * const duplicates = await pipeline.findDuplicates(0.85);
   * for (const dup of duplicates) {
   *   console.log(`${dup.entity1} ~ ${dup.entity2}: ${dup.similarity}`);
   * }
   * ```
   */
  async findDuplicates(threshold: number = 0.9): Promise<DuplicatePair[]> {
    const graph = await this.storage.loadGraph();
    const duplicates: DuplicatePair[] = [];

    const agentEntities = graph.entities.filter((e) =>
      isAgentEntity(e)
    ) as AgentEntity[];

    // Cheap per-entity token fingerprint. `calculateEntitySimilarity` can
    // only score > 0 when two entities share an observation token AND have
    // the same entityType — so pairs failing that pre-check always score 0
    // and are safe to skip for any threshold > 0. Same `tokenize()` as
    // `calculateTextSimilarity`, so the check never rejects a > 0 pair.
    const fingerprints: Set<string>[] = agentEntities.map(
      (e) => new Set(tokenize((e.observations ?? []).join(' ')))
    );
    const sharesToken = (a: Set<string>, b: Set<string>): boolean => {
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      for (const tok of small) {
        if (large.has(tok)) return true;
      }
      return false;
    };

    for (let i = 0; i < agentEntities.length; i++) {
      for (let j = i + 1; j < agentEntities.length; j++) {
        const e1 = agentEntities[i];
        const e2 = agentEntities[j];

        // Skip if different sessions for working memories
        if (
          e1.memoryType === 'working' &&
          e2.memoryType === 'working' &&
          e1.sessionId !== e2.sessionId
        ) {
          continue;
        }

        // Cheap pre-filter: skip pairs that provably score 0 (different type
        // or no shared observation token). Only safe when threshold > 0.
        if (threshold > 0) {
          if (e1.entityType !== e2.entityType) continue;
          if (!sharesToken(fingerprints[i], fingerprints[j])) continue;
        }

        const similarity = this.calculateEntitySimilarity(e1, e2);
        if (similarity >= threshold) {
          duplicates.push({
            entity1: e1.name,
            entity2: e2.name,
            similarity,
          });
        }
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Auto-merge duplicates above threshold.
   *
   * @param threshold - Similarity threshold for duplicates
   * @param strategy - Merge strategy to use
   * @returns Array of merge results
   */
  async autoMergeDuplicates(
    threshold: number = 0.9,
    strategy: MemoryMergeStrategy = 'strongest'
  ): Promise<MergeResult[]> {
    const duplicates = await this.findDuplicates(threshold);
    const results: MergeResult[] = [];
    const mergedEntities = new Set<string>();

    for (const dup of duplicates) {
      // Skip if either entity was already merged
      if (mergedEntities.has(dup.entity1) || mergedEntities.has(dup.entity2)) {
        continue;
      }

      try {
        const result = await this.mergeMemories(
          [dup.entity1, dup.entity2],
          strategy
        );
        results.push(result);

        // Track merged entities
        mergedEntities.add(dup.entity1);
        mergedEntities.add(dup.entity2);
      } catch {
        // Entity may have been deleted in previous merge
        continue;
      }
    }

    return results;
  }

  /**
   * Get merge history for an entity.
   *
   * @param entityName - Name of entity to check history for
   * @returns Array of merge audit entities
   */
  async getMergeHistory(entityName: string): Promise<Entity[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(
      (e) =>
        e.entityType === 'merge_audit' &&
        e.observations?.some((o) => o.includes(entityName))
    );
  }

  /**
   * Select the newest entity from a list.
   * @internal
   */
  private selectNewest(entities: AgentEntity[]): AgentEntity {
    return entities.reduce((newest, e) => {
      const newestTime = new Date(
        newest.lastModified ?? newest.createdAt ?? 0
      ).getTime();
      const eTime = new Date(e.lastModified ?? e.createdAt ?? 0).getTime();
      return eTime > newestTime ? e : newest;
    });
  }

  /**
   * Select the strongest entity from a list.
   * @internal
   */
  private selectStrongest(entities: AgentEntity[]): AgentEntity {
    return entities.reduce((strongest, e) => {
      const strongestScore =
        (strongest.confidence ?? 0) * (strongest.confirmationCount ?? 1);
      const eScore = (e.confidence ?? 0) * (e.confirmationCount ?? 1);
      return eScore > strongestScore ? e : strongest;
    });
  }

  /**
   * Calculate similarity between two entities.
   * @internal
   */
  private calculateEntitySimilarity(
    e1: AgentEntity,
    e2: AgentEntity
  ): number {
    // Must have same entity type
    if (e1.entityType !== e2.entityType) return 0;

    // Compare observations
    const obs1 = e1.observations?.join(' ') ?? '';
    const obs2 = e2.observations?.join(' ') ?? '';

    return this.calculateSimilarity(obs1, obs2);
  }

  /**
   * Record a merge operation in the audit trail.
   * @internal
   */
  private async recordMerge(
    mergedNames: string[],
    survivorName: string,
    strategy: MemoryMergeStrategy
  ): Promise<void> {
    const now = new Date().toISOString();
    const auditEntity = {
      name: `merge_audit_${Date.now()}`,
      entityType: 'merge_audit',
      observations: [
        `Merged: ${mergedNames.join(', ')}`,
        `Survivor: ${survivorName}`,
        `Strategy: ${strategy}`,
        `Timestamp: ${now}`,
      ],
      createdAt: now,
      lastModified: now,
      importance: 3,
    };

    await this.storage.appendEntity(auditEntity);
  }

  // ==================== Configuration Access ====================

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<ConsolidationPipelineConfig>> {
    return { ...this.config };
  }

  // ==================== Rule Management ====================

  /**
   * Add a consolidation rule.
   *
   * @param rule - Rule to add
   *
   * @example
   * ```typescript
   * pipeline.addRule({
   *   name: 'Promote high-confidence memories',
   *   trigger: 'session_end',
   *   conditions: { minConfidence: 0.9, memoryType: 'working' },
   *   action: 'promote_to_episodic',
   *   enabled: true,
   * });
   * ```
   */
  addRule(rule: ConsolidationRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove a rule by name.
   *
   * @param name - Name of rule to remove
   * @returns true if rule was found and removed
   */
  removeRule(name: string): boolean {
    const index = this.rules.findIndex((r) => r.name === name);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all registered rules.
   */
  getRules(): readonly ConsolidationRule[] {
    return this.rules;
  }

  /**
   * Clear all rules.
   */
  clearRules(): void {
    this.rules.length = 0;
  }

  /**
   * Get the RuleEvaluator instance.
   */
  getRuleEvaluator(): RuleEvaluator {
    return this.ruleEvaluator;
  }

  // ==================== Auto-Consolidation ====================

  /**
   * Run automatic consolidation based on configured rules.
   *
   * Processes all rules matching the given trigger and executes
   * actions for entities that meet the rule conditions.
   *
   * @param trigger - The trigger that invoked consolidation
   * @returns Aggregate result of all rule executions
   *
   * @example
   * ```typescript
   * // Run consolidation triggered by session end
   * const result = await pipeline.runAutoConsolidation('session_end');
   * console.log(`Promoted ${result.memoriesPromoted} memories`);
   *
   * // Manual trigger for testing
   * const manualResult = await pipeline.runAutoConsolidation('manual');
   * ```
   */
  async runAutoConsolidation(
    trigger: ConsolidationTrigger
  ): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      memoriesProcessed: 0,
      memoriesPromoted: 0,
      memoriesMerged: 0,
      patternsExtracted: 0,
      summariesCreated: 0,
      errors: [],
    };

    // Get rules matching this trigger, sorted by priority
    const matchingRules = this.rules
      .filter((r) => r.enabled && r.trigger === trigger)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (matchingRules.length === 0) {
      return result;
    }

    // Get all agent entities
    const graph = await this.storage.loadGraph();
    const entities = graph.entities.filter((e) =>
      isAgentEntity(e)
    ) as AgentEntity[];
    result.memoriesProcessed = entities.length;

    // Process each rule
    for (const rule of matchingRules) {
      const ruleResult = await this.executeRule(rule, entities);
      result.memoriesPromoted += ruleResult.promoted;
      result.memoriesMerged += ruleResult.merged;
      result.summariesCreated += ruleResult.summarized;
      result.errors.push(...ruleResult.errors);
    }

    // Clear evaluation cache after processing
    this.ruleEvaluator.clearCache();

    return result;
  }

  /**
   * Execute a single rule against a set of entities.
   *
   * @param rule - Rule to execute
   * @param entities - Entities to evaluate
   * @returns Execution results
   * @internal
   */
  private async executeRule(
    rule: ConsolidationRule,
    entities: AgentEntity[]
  ): Promise<{
    promoted: number;
    merged: number;
    summarized: number;
    errors: string[];
  }> {
    const result = {
      promoted: 0,
      merged: 0,
      summarized: 0,
      errors: [] as string[],
    };

    // Find matching entities
    const matches = entities.filter((e) =>
      this.ruleEvaluator.evaluate(e, rule.conditions).passed
    );

    // Execute action for matches
    for (const entity of matches) {
      try {
        switch (rule.action) {
          case 'promote_to_episodic':
            if (entity.memoryType === 'working') {
              await this.promoteMemory(entity.name, 'episodic');
              result.promoted++;
            }
            break;

          case 'promote_to_semantic':
            if (entity.memoryType === 'working') {
              await this.promoteMemory(entity.name, 'semantic');
              result.promoted++;
            }
            break;

          case 'summarize':
            const summarized = await this.applySummarizationToEntity(
              entity.name
            );
            if (summarized.compressionRatio > 0) {
              result.summarized++;
            }
            break;

          case 'merge_duplicates':
            // Skip merge_duplicates action for individual entities
            // This action is handled separately in autoMergeDuplicates
            break;

          case 'archive':
            // Archive action - mark for archival (future implementation)
            break;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        result.errors.push(`Rule ${rule.name} failed for ${entity.name}: ${message}`);
      }
    }

    // Handle merge_duplicates action at rule level (not per entity)
    if (rule.action === 'merge_duplicates') {
      try {
        const mergeResults = await this.autoMergeDuplicates(0.9, 'strongest');
        result.merged = mergeResults.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`Rule ${rule.name} merge failed: ${message}`);
      }
    }

    return result;
  }

  /**
   * Manually trigger consolidation.
   *
   * Convenience method for triggering consolidation without a specific event.
   */
  async triggerManualConsolidation(): Promise<ConsolidationResult> {
    return this.runAutoConsolidation('manual');
  }
}

// ==================== ProspectivePromotionStage ====================

/**
 * Pipeline stage that promotes fired prospective intentions to
 * episodic memory. Closes the prospective-memory lifecycle: a fired
 * intention whose action delivered content (`'inject-context'`) becomes
 * a permanent episodic record tagged `'prospective-fulfilled'`.
 *
 * - `invoke` and `tag-related` actions are NOT promoted — they have
 *   side-effects but no payload worth archiving as episodic content.
 * - Idempotent: re-running on an already-promoted entity is a no-op
 *   (the entity's `memoryType` is now `'episodic'`, so the prospective
 *   filter excludes it).
 * - Self-sufficient: scans storage independently of the `entities`
 *   argument from the pipeline (prospective intentions aren't in the
 *   working-memory candidate set).
 *
 * Register via `ConsolidationPipeline.registerStage(new ProspectivePromotionStage(storage))`.
 */
export class ProspectivePromotionStage implements PipelineStage {
  readonly name = 'prospective-promotion';

  constructor(private readonly storage: IGraphStorage) {}

  async process(_entities: AgentEntity[], _options: ConsolidateOptions): Promise<StageResult> {
    const graph = await this.storage.loadGraph();
    const candidates = graph.entities
      .filter(isProspectiveMemory)
      .filter((e) => e.lifecycle.status === 'fired' && e.action.kind === 'inject-context');

    let transformed = 0;
    const errors: string[] = [];
    const nowIso = new Date().toISOString();

    for (const entity of candidates) {
      const ctx = `fireCount=${entity.lifecycle.fireCount}, action=${entity.action.kind}`;
      try {
        const newTags = Array.from(new Set([...(entity.tags ?? []), 'prospective-fulfilled']));
        const ok = await this.storage.updateEntity(entity.name, {
          memoryType: 'episodic',
          tags: newTags,
          lastModified: nowIso,
        } as unknown as Partial<Entity>);
        if (ok) {
          transformed++;
        } else {
          // updateEntity returns false when the entity is missing —
          // signals a vanished-mid-batch race (concurrent delete /
          // governance rollback / segment-mode flush). Surface it
          // rather than silently counting it as transformed.
          errors.push(
            `ProspectivePromotionStage: entity '${entity.name}' disappeared mid-batch (${ctx})`
          );
        }
      } catch (err) {
        errors.push(
          `ProspectivePromotionStage: failed to promote '${entity.name}' (${ctx}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return { processed: candidates.length, transformed, errors };
  }
}

/**
 * Configuration for `ReflectionStage`.
 */
export interface ReflectionStageConfig {
  /** Minimum `PatternResult.confidence` to qualify (default 0.4). */
  minConfidence?: number;
  /** `minOccurrences` argument to `PatternDetector.detectPatterns` (default 2). */
  minPatternOccurrences?: number;
  /** Reflection scope written to the new `ReflectionRecord` (default 'session'). */
  scope?: ReflectionScope;
  /** Circuit-breaker on observations per run (default 500). */
  maxObservationsPerRun?: number;
}

/**
 * Pipeline stage that produces `ReflectionEntity` records from
 * candidate episodic memories. Mirrors `ProspectivePromotionStage`'s
 * self-sufficient pattern (scans storage directly; ignores the
 * `entities` argument).
 *
 * Pipeline:
 * 1. Load episodic candidates from storage (filter by optional session
 *    when called via `runOnSessionEnd`)
 * 2. Collect observations up to `maxObservationsPerRun`
 * 3. Run `PatternDetector.detectPatterns` → early return if all
 *    patterns are below `minConfidence`
 * 4. Run `TrajectoryCompressor.distill` → derive
 *    `generalization_confidence = min(1 - compressionRatio, maxPatternConfidence)`
 * 5. Call `ReflectionManager.create` once (content-hash dedup at that
 *    layer handles repeat runs)
 *
 * **Additive semantics** (Sprint 8 user decision): evidence entities
 * are NOT mutated. The reflection sits alongside them as a derived
 * overlay. Re-running is idempotent because `ReflectionManager.create`
 * dedups on the evidence-set hash.
 *
 * Register on the default pipeline via
 * `ConsolidationPipeline.registerStage(reflectionStage)`, or invoke
 * `stage.runOnSessionEnd(sessionId)` directly from session-end
 * handlers.
 */
export class ReflectionStage implements PipelineStage {
  readonly name = 'reflection';
  private readonly minConfidence: number;
  private readonly minPatternOccurrences: number;
  private readonly scope: ReflectionScope;
  private readonly maxObservationsPerRun: number;

  constructor(
    private readonly storage: IGraphStorage,
    private readonly reflectionManager: ReflectionManager,
    private readonly patternDetector: PatternDetector,
    private readonly trajectoryCompressor: TrajectoryCompressor,
    config: ReflectionStageConfig = {}
  ) {
    this.minConfidence = config.minConfidence ?? 0.4;
    this.minPatternOccurrences = config.minPatternOccurrences ?? 2;
    this.scope = config.scope ?? 'session';
    this.maxObservationsPerRun = config.maxObservationsPerRun ?? 500;
  }

  async process(_entities: AgentEntity[], _options: ConsolidateOptions): Promise<StageResult> {
    return this.runInternal(undefined);
  }

  /**
   * Convenience helper for session-end triggers. Scopes the candidate
   * set to entities whose `sessionId === sessionId`. Sets
   * `sourceSessionId` on the resulting reflection.
   */
  async runOnSessionEnd(sessionId: string): Promise<StageResult> {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new Error(
        `ReflectionStage.runOnSessionEnd: sessionId must be a non-empty string; received ${
          typeof sessionId === 'string' ? `'${sessionId}'` : typeof sessionId
        }`
      );
    }
    return this.runInternal(sessionId);
  }

  private async runInternal(sessionId: string | undefined): Promise<StageResult> {
    const graph = await this.storage.loadGraph();
    const candidates = graph.entities.filter((e) => {
      if (!isAgentEntity(e)) return false;
      if (e.memoryType !== 'episodic' && e.memoryType !== 'semantic') return false;
      if (sessionId !== undefined && e.sessionId !== sessionId) return false;
      return true;
    });

    if (candidates.length === 0) {
      return { processed: 0, transformed: 0, errors: [] };
    }

    const observations: string[] = [];
    for (const entity of candidates) {
      for (const obs of entity.observations ?? []) {
        if (observations.length >= this.maxObservationsPerRun) break;
        observations.push(obs);
      }
      if (observations.length >= this.maxObservationsPerRun) break;
    }

    const patterns = this.patternDetector.detectPatterns(
      observations,
      this.minPatternOccurrences
    );
    const maxPatternConfidence = patterns.reduce((m, p) => Math.max(m, p.confidence), 0);
    if (patterns.length === 0 || maxPatternConfidence < this.minConfidence) {
      // Surface a diagnostic so callers can distinguish "no candidates"
      // (transformed=0, errors=[]) from "candidates existed but didn't
      // qualify" (transformed=0, errors=['[info] ...']). The [info]
      // prefix marks this as non-fatal — pipeline aggregators that
      // gate on errors.length should filter it out.
      const reason =
        patterns.length === 0
          ? 'no patterns detected'
          : `max pattern confidence ${maxPatternConfidence.toFixed(2)} < minConfidence ${this.minConfidence}`;
      return {
        processed: candidates.length,
        transformed: 0,
        errors: [`[info] ReflectionStage: skipped reflection (${reason})`],
      };
    }

    let compression: Awaited<ReturnType<TrajectoryCompressor['distill']>>;
    const errors: string[] = [];
    try {
      compression = await this.trajectoryCompressor.distill(observations);
    } catch (err) {
      errors.push(
        `ReflectionStage: TrajectoryCompressor.distill failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { processed: candidates.length, transformed: 0, errors };
    }

    // `PatternResult.sourceEntities` is currently unpopulated by
    // `PatternDetector.detectPatterns` (the detector tracks source
    // *texts* internally but doesn't surface them on the result type).
    // For now, attribute evidence to all scanned candidates — a future
    // PatternDetector enhancement could narrow this to exact matches.
    // Entity names are already unique by storage contract, so a Set
    // would be redundant.
    const evidence = candidates.map((e) => e.name);

    // Clamp to `[0, 1]` defensively: `TrajectoryCompressor.compressionRatio`
    // can exceed 1.0 in edge cases (ellipsis suffix on very short totals,
    // multibyte expansion). Without the clamp, a negative input crashes
    // `validateConfidence` in `ReflectionManager.create`.
    const confidence = Math.max(
      0,
      Math.min(1, 1 - compression.compressionRatio, maxPatternConfidence)
    );
    const keyInsights = patterns.slice(0, 5).map((p) => p.pattern);

    try {
      await this.reflectionManager.create({
        scope: this.scope,
        evidence,
        summary: compression.summary || keyInsights[0] || 'pattern reflection',
        generalization_confidence: confidence,
        keyInsights,
        sourceSessionId: sessionId,
      });
      return { processed: candidates.length, transformed: 1, errors };
    } catch (err) {
      errors.push(
        `ReflectionStage: ReflectionManager.create failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { processed: candidates.length, transformed: 0, errors };
    }
  }
}
