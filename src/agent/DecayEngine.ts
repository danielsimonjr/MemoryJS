/**
 * Decay Engine
 *
 * Implements time-based memory importance decay with
 * importance and access modulation. Memories weaken over
 * time unless reinforced by access or confirmation.
 *
 * @module agent/DecayEngine
 */

import type { IGraphStorage } from '../types/types.js';
import type { AgentEntity, DecayResult, ForgetOptions, ForgetResult } from '../types/agent-memory.js';
import { isAgentEntity } from '../types/agent-memory.js';
import { AccessTracker } from './AccessTracker.js';

// Re-export for convenience
export type { DecayResult, ForgetOptions, ForgetResult } from '../types/agent-memory.js';

/**
 * Configuration options for DecayEngine constructor.
 */
export interface DecayEngineConfig {
  /** Base half-life in hours (default: 168 = 1 week) */
  halfLifeHours?: number;
  /** Enable importance-based half-life modulation (default: true) */
  importanceModulation?: boolean;
  /** Enable access frequency-based modulation (default: true) */
  accessModulation?: boolean;
  /** Minimum importance floor (default: 0.1) */
  minImportance?: number;
}

/**
 * Options for batch decay operations.
 * Extends DecayEngineConfig with operation-specific options.
 * Note: applyDecay is always read-only (never persists changes).
 */
export interface DecayOperationOptions extends DecayEngineConfig {}

/**
 * Options for reinforcing a memory.
 */
export interface ReinforcementOptions {
  /** Number of confirmations to add (default: 1) */
  confirmationBoost?: number;
  /** Amount to boost confidence by (0-1 scale) */
  confidenceBoost?: number;
}

/**
 * Implements time-based memory importance decay.
 *
 * The DecayEngine uses exponential decay to model how memories weaken
 * over time unless reinforced. This mimics natural cognitive processes
 * where unused information gradually becomes less accessible.
 *
 * Key features:
 * - Exponential decay formula with configurable half-life
 * - Importance modulation: important memories decay slower
 * - Access modulation: frequently accessed memories decay slower
 * - Strength multiplier from confirmations and access count
 * - Minimum importance floor prevents complete forgetting
 *
 * @example
 * ```typescript
 * const decay = new DecayEngine(storage, accessTracker);
 * const effective = decay.calculateEffectiveImportance(entity);
 * const decayed = await decay.getDecayedMemories(0.1);
 * await decay.reinforceMemory('entity_name');
 * ```
 */
export class DecayEngine {
  private readonly storage: IGraphStorage;
  private readonly accessTracker: AccessTracker;
  private readonly config: Required<DecayEngineConfig>;

  constructor(
    storage: IGraphStorage,
    accessTracker: AccessTracker,
    config: DecayEngineConfig = {}
  ) {
    this.storage = storage;
    this.accessTracker = accessTracker;
    this.config = {
      halfLifeHours: config.halfLifeHours ?? 168, // 1 week
      importanceModulation: config.importanceModulation ?? true,
      accessModulation: config.accessModulation ?? true,
      minImportance: config.minImportance ?? 0.1,
    };
  }

  // ==================== Decay Factor Calculation ====================

  /**
   * Calculate decay factor based on time since last access.
   *
   * Uses exponential decay: e^(-ln(2) * age_hours / half_life_hours)
   * - Returns 1.0 for just-accessed memories
   * - Returns 0.5 after one half-life
   * - Approaches 0 for very old memories
   *
   * @param lastAccessedAt - ISO 8601 timestamp of last access
   * @param halfLifeHours - Base half-life in hours
   * @param importanceBoost - Optional boost factor (0-10 scale) that extends half-life
   * @returns Decay factor between 0.0 and 1.0
   */
  calculateDecayFactor(
    lastAccessedAt: string,
    halfLifeHours: number,
    importanceBoost?: number
  ): number {
    if (!lastAccessedAt) {
      return 0; // No access history = fully decayed
    }

    const now = Date.now();
    const lastAccess = new Date(lastAccessedAt).getTime();
    const ageHours = (now - lastAccess) / (1000 * 60 * 60);

    // Apply importance boost to half-life if provided and modulation enabled
    let effectiveHalfLife = halfLifeHours;
    if (importanceBoost !== undefined && this.config.importanceModulation) {
      // Importance of 10 doubles the half-life
      effectiveHalfLife = halfLifeHours * (1 + importanceBoost / 10);
    }

    // Exponential decay formula
    const decayConstant = Math.LN2 / effectiveHalfLife;
    const decayFactor = Math.exp(-decayConstant * ageHours);

    return Math.max(0, Math.min(1, decayFactor));
  }

  /**
   * Static utility to calculate decay factor without instance.
   *
   * @param lastAccessedAt - ISO 8601 timestamp of last access
   * @param halfLifeHours - Half-life in hours (default: 168 = 1 week)
   * @returns Decay factor between 0.0 and 1.0
   */
  static calculateDecayFactorStatic(
    lastAccessedAt: string,
    halfLifeHours: number = 168
  ): number {
    if (!lastAccessedAt) return 0;

    const now = Date.now();
    const lastAccess = new Date(lastAccessedAt).getTime();
    const ageHours = (now - lastAccess) / (1000 * 60 * 60);

    const decayConstant = Math.LN2 / halfLifeHours;
    return Math.max(0, Math.min(1, Math.exp(-decayConstant * ageHours)));
  }

  // ==================== Effective Importance Calculation ====================

  /**
   * Calculate strength multiplier from confirmations and access count.
   *
   * Formula: 1 + (confirmationCount * 0.1) + (accessCount * 0.01)
   * - Each confirmation adds 10% strength
   * - Each 100 accesses add 1% strength
   *
   * @param entity - AgentEntity to calculate strength for
   * @returns Strength multiplier >= 1.0
   */
  private calculateStrengthMultiplier(entity: AgentEntity): number {
    const confirmationBoost = (entity.confirmationCount ?? 0) * 0.1;
    const accessBoost = (entity.accessCount ?? 0) * 0.01;
    return 1 + confirmationBoost + accessBoost;
  }

  /**
   * Calculate effective importance considering decay and strength.
   *
   * Formula: base_importance * decay_factor * strength_multiplier
   *
   * - base_importance: Entity's stated importance (0-10)
   * - decay_factor: Time-based decay (0-1)
   * - strength_multiplier: Boost from confirmations and accesses
   *
   * Result is clamped to minimum importance floor.
   *
   * @param entity - AgentEntity to calculate importance for
   * @returns Effective importance value
   */
  calculateEffectiveImportance(entity: AgentEntity): number {
    // Get base importance (default to 5 if not set)
    const baseImportance = entity.importance ?? 5;

    // Determine timestamp for decay calculation
    const decayTimestamp = entity.lastAccessedAt ?? entity.createdAt;
    if (!decayTimestamp) {
      // No timestamp = use base importance with min floor
      return Math.max(baseImportance, this.config.minImportance);
    }

    // Calculate decay factor with importance modulation
    const importanceBoost = this.config.importanceModulation ? baseImportance : undefined;
    const decayFactor = this.calculateDecayFactor(
      decayTimestamp,
      this.config.halfLifeHours,
      importanceBoost
    );

    // Calculate strength multiplier if access modulation enabled
    let strengthMultiplier = 1;
    if (this.config.accessModulation) {
      strengthMultiplier = this.calculateStrengthMultiplier(entity);
    }

    // Combine factors and clamp to [minImportance, 10]
    const effectiveImportance = baseImportance * decayFactor * strengthMultiplier;
    return Math.min(10, Math.max(effectiveImportance, this.config.minImportance));
  }

  // ==================== Decayed Memory Queries ====================

  /**
   * Get memories that have decayed below threshold.
   *
   * Queries all AgentEntity records and returns those with
   * effective importance below the specified threshold.
   *
   * @param threshold - Importance threshold (0-10 scale)
   * @returns Array of decayed AgentEntity records
   */
  async getDecayedMemories(threshold: number): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    const decayed: AgentEntity[] = [];

    for (const entity of graph.entities) {
      // Check if this is an AgentEntity
      if (!isAgentEntity(entity)) continue;

      // Calculate effective importance
      const effectiveImportance = this.calculateEffectiveImportance(entity);

      // Add to results if below threshold
      if (effectiveImportance < threshold) {
        decayed.push(entity);
      }
    }

    return decayed;
  }

  /**
   * Get memories at risk of being forgotten.
   *
   * Returns memories with effective importance between minImportance and threshold.
   * These are memories that have decayed significantly but haven't yet reached
   * the forgetting threshold.
   *
   * @param threshold - Upper threshold (default: 1.0)
   * @returns Array of at-risk AgentEntity records
   */
  async getMemoriesAtRisk(threshold: number = 1.0): Promise<AgentEntity[]> {
    const graph = await this.storage.loadGraph();
    const atRisk: AgentEntity[] = [];
    const minImportance = this.config.minImportance;

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;

      const effectiveImportance = this.calculateEffectiveImportance(entity);

      // At risk if between min floor and threshold
      if (effectiveImportance >= minImportance && effectiveImportance < threshold) {
        atRisk.push(entity);
      }
    }

    return atRisk;
  }

  // ==================== Memory Reinforcement ====================

  /**
   * Reinforce a memory to strengthen it against decay.
   *
   * Strengthening includes:
   * - Resetting decay timer (updating lastAccessedAt)
   * - Incrementing confirmationCount
   * - Optionally boosting confidence
   * - Recording access via AccessTracker
   *
   * @param entityName - Name of entity to reinforce
   * @param options - Reinforcement options
   * @throws Error if entity not found
   */
  async reinforceMemory(
    entityName: string,
    options?: ReinforcementOptions
  ): Promise<void> {
    const entity = this.storage.getEntityByName(entityName);
    if (!entity) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    const now = new Date().toISOString();
    const agentEntity = entity as AgentEntity;

    const updates: Partial<AgentEntity> = {
      lastModified: now,
      lastAccessedAt: now, // Reset decay timer
    };

    // Increment confirmation count
    const currentConfirmations = agentEntity.confirmationCount ?? 0;
    const confirmationBoost = options?.confirmationBoost ?? 1;
    updates.confirmationCount = currentConfirmations + confirmationBoost;

    // Optionally boost confidence (capped at 1.0)
    if (options?.confidenceBoost) {
      const currentConfidence = agentEntity.confidence ?? 0.5;
      const newConfidence = Math.min(1, currentConfidence + options.confidenceBoost);
      updates.confidence = newConfidence;
    }

    // Record access via tracker
    await this.accessTracker.recordAccess(entityName, {
      retrievalMethod: 'direct',
    });

    // Persist updates
    await this.storage.updateEntity(entityName, updates as Record<string, unknown>);
  }

  // ==================== Forgetting Operations ====================

  /**
   * Forget (delete or archive) memories below threshold.
   *
   * Selects memories based on:
   * - Effective importance below threshold
   * - Age filter (olderThanHours)
   * - Tag exclusions (excludeTags)
   *
   * In non-dry-run mode, removes both entities and their relations.
   *
   * @param options - Forget operation options
   * @returns Results of the forget operation
   *
   * @example
   * ```typescript
   * // Preview what would be forgotten
   * const preview = await decay.forgetWeakMemories({
   *   effectiveImportanceThreshold: 0.5,
   *   excludeTags: ['important', 'permanent'],
   *   dryRun: true
   * });
   *
   * // Actually forget
   * const result = await decay.forgetWeakMemories({
   *   effectiveImportanceThreshold: 0.5,
   *   olderThanHours: 168 // Only forget if > 1 week old
   * });
   * ```
   */
  async forgetWeakMemories(options: ForgetOptions): Promise<ForgetResult> {
    const graph = await this.storage.loadGraph();
    const now = Date.now();

    const forgottenNames: string[] = [];
    let memoriesProtected = 0;
    let memoriesTooYoung = 0;

    const excludeTagSet = new Set(
      (options.excludeTags ?? []).map(t => t.toLowerCase())
    );

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;

      const agentEntity = entity;

      // Check effective importance
      const effectiveImportance = this.calculateEffectiveImportance(agentEntity);
      if (effectiveImportance >= options.effectiveImportanceThreshold) {
        continue;
      }

      // Check age filter
      if (options.olderThanHours !== undefined) {
        const createdAt = agentEntity.createdAt
          ? new Date(agentEntity.createdAt).getTime()
          : now;
        const ageHours = (now - createdAt) / (1000 * 60 * 60);

        if (ageHours < options.olderThanHours) {
          memoriesTooYoung++;
          continue;
        }
      }

      // Check protected tags
      const entityTags = new Set(
        (agentEntity.tags ?? []).map(t => t.toLowerCase())
      );
      const hasProtectedTag = [...excludeTagSet].some(tag => entityTags.has(tag));

      if (hasProtectedTag) {
        memoriesProtected++;
        continue;
      }

      // Mark for forgetting
      forgottenNames.push(agentEntity.name);
    }

    // Execute forgetting if not dry run
    if (!options.dryRun && forgottenNames.length > 0) {
      const forgottenSet = new Set(forgottenNames);

      // Remove forgotten entities
      const updatedEntities = graph.entities.filter(
        e => !forgottenSet.has(e.name)
      );

      // Remove relations involving forgotten entities
      const updatedRelations = graph.relations.filter(
        r => !forgottenSet.has(r.from) && !forgottenSet.has(r.to)
      );

      // Save updated graph
      await this.storage.saveGraph({
        entities: updatedEntities,
        relations: updatedRelations,
      });
    }

    return {
      memoriesForgotten: forgottenNames.length,
      forgottenNames,
      memoriesProtected,
      memoriesTooYoung,
      dryRun: options.dryRun ?? false,
    };
  }

  // ==================== Batch Decay Operations ====================

  /**
   * Apply decay calculations to all memories (batch operation).
   *
   * Can optionally persist updated effective importance values
   * or run in dry-run mode for analysis only.
   *
   * @param options - Decay operation options
   * @returns DecayResult with statistics
   */
  async applyDecay(options: DecayOperationOptions = {}): Promise<DecayResult> {
    const startTime = Date.now();
    const graph = await this.storage.loadGraph();

    let entitiesProcessed = 0;
    let totalDecay = 0;
    let memoriesAtRisk = 0;

    const minImportance = options.minImportance ?? this.config.minImportance;

    for (const entity of graph.entities) {
      if (!isAgentEntity(entity)) continue;

      entitiesProcessed++;

      // Calculate effective importance
      const effectiveImportance = this.calculateEffectiveImportance(entity);
      const baseImportance = entity.importance ?? 5;

      // Track total decay (difference from base)
      const decayAmount = baseImportance > 0 ? 1 - effectiveImportance / baseImportance : 0;
      totalDecay += decayAmount;

      // Count at-risk memories (above min but significantly decayed)
      if (effectiveImportance < 1.0 && effectiveImportance >= minImportance) {
        memoriesAtRisk++;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    return {
      entitiesProcessed,
      averageDecay: entitiesProcessed > 0 ? totalDecay / entitiesProcessed : 0,
      memoriesAtRisk,
      processingTimeMs,
    };
  }

  // ==================== Configuration Access ====================

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<DecayEngineConfig>> {
    return { ...this.config };
  }
}
