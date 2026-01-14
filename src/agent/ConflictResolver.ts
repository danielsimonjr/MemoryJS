/**
 * Conflict Resolver
 *
 * Detects and resolves conflicting memories from different agents.
 *
 * @module agent/ConflictResolver
 */

import type { AgentEntity, ConflictInfo, ConflictStrategy } from '../types/agent-memory.js';
import type { AgentMetadata } from '../types/agent-memory.js';
import { EventEmitter } from 'events';

/**
 * Configuration for ConflictResolver.
 */
export interface ConflictResolverConfig {
  /** Similarity threshold for conflict detection (0-1, default: 0.7) */
  similarityThreshold?: number;
  /** Default resolution strategy */
  defaultStrategy?: ConflictStrategy;
  /** Enable negation detection */
  detectNegations?: boolean;
}

/**
 * Result of conflict resolution.
 */
export interface ResolutionResult {
  /** Resolved memory */
  resolvedMemory: AgentEntity;
  /** Strategy used */
  strategy: ConflictStrategy;
  /** Memories that were merged/resolved */
  sourceMemories: string[];
  /** Audit trail entry */
  auditEntry: string;
}

/**
 * Resolves conflicts between memories from different agents.
 *
 * @example
 * ```typescript
 * const resolver = new ConflictResolver();
 * const conflicts = resolver.detectConflicts(memories);
 * const resolved = resolver.resolveConflict(conflictInfo, memories, agentMetadata, 'trusted_agent');
 * ```
 */
export class ConflictResolver extends EventEmitter {
  private readonly config: Required<ConflictResolverConfig>;

  constructor(config: ConflictResolverConfig = {}) {
    super();
    this.config = {
      similarityThreshold: config.similarityThreshold ?? 0.7,
      defaultStrategy: config.defaultStrategy ?? 'most_recent',
      detectNegations: config.detectNegations ?? true,
    };
  }

  /**
   * Detect conflicts between memories.
   *
   * Compares memories from different agents and identifies contradictions
   * based on observation similarity and negation patterns.
   *
   * @param memories - Memories to check for conflicts
   * @returns Array of detected conflicts
   */
  detectConflicts(memories: AgentEntity[]): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    const checked = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const m1 = memories[i];
        const m2 = memories[j];

        // Skip same-agent memories
        if (m1.agentId === m2.agentId) continue;

        // Create unique pair key
        const pairKey = [m1.name, m2.name].sort().join('::');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        // Check for conflict
        const conflictResult = this.checkConflict(m1, m2);
        if (conflictResult) {
          conflicts.push(conflictResult);

          // Emit conflict event
          this.emit('memory:conflict', conflictResult);
        }
      }
    }

    return conflicts;
  }

  /**
   * Check if two memories conflict.
   * @internal
   */
  private checkConflict(m1: AgentEntity, m2: AgentEntity): ConflictInfo | null {
    // Check similarity
    const similarity = this.calculateSimilarity(m1, m2);

    if (similarity >= this.config.similarityThreshold) {
      // High similarity indicates same topic - check for contradictions
      const hasNegation =
        this.config.detectNegations && this.detectNegation(m1, m2);

      if (hasNegation) {
        return {
          primaryMemory: m1.name,
          conflictingMemories: [m2.name],
          detectionMethod: 'negation',
          similarityScore: similarity,
          suggestedStrategy: this.suggestStrategy(m1, m2),
          detectedAt: new Date().toISOString(),
        };
      }

      // High similarity with different observations = potential conflict
      if (!this.observationsEqual(m1, m2)) {
        return {
          primaryMemory: m1.name,
          conflictingMemories: [m2.name],
          detectionMethod: 'similarity',
          similarityScore: similarity,
          suggestedStrategy: this.suggestStrategy(m1, m2),
          detectedAt: new Date().toISOString(),
        };
      }
    }

    return null;
  }

  /**
   * Calculate similarity between two memories using TF-style scoring.
   * @internal
   */
  private calculateSimilarity(m1: AgentEntity, m2: AgentEntity): number {
    // Combine name and observations into text
    const text1 = this.memoryToText(m1).toLowerCase();
    const text2 = this.memoryToText(m2).toLowerCase();

    // Simple Jaccard-like similarity
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Convert memory to text for comparison.
   * @internal
   */
  private memoryToText(memory: AgentEntity): string {
    const parts = [memory.name, memory.entityType ?? ''];
    if (memory.observations) {
      parts.push(...memory.observations);
    }
    return parts.join(' ');
  }

  /**
   * Detect negation patterns in observations.
   * @internal
   */
  private detectNegation(m1: AgentEntity, m2: AgentEntity): boolean {
    const obs1 = (m1.observations ?? []).map((o) => o.toLowerCase());
    const obs2 = (m2.observations ?? []).map((o) => o.toLowerCase());

    const negationPatterns = [
      /\bnot\b/,
      /\bno\b/,
      /\bnever\b/,
      /\bdon't\b/,
      /\bdoesn't\b/,
      /\bisn't\b/,
      /\bwasn't\b/,
      /\bweren't\b/,
      /\bwon't\b/,
      /\bcan't\b/,
      /\bcannot\b/,
      /\bfalse\b/,
      /\bincorrect\b/,
    ];

    // Check if one memory has negation while the other doesn't
    // for similar content
    for (const o1 of obs1) {
      for (const o2 of obs2) {
        const sim = this.textSimilarity(o1, o2);
        if (sim > 0.5) {
          const hasNeg1 = negationPatterns.some((p) => p.test(o1));
          const hasNeg2 = negationPatterns.some((p) => p.test(o2));
          if (hasNeg1 !== hasNeg2) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Simple text similarity.
   * @internal
   */
  private textSimilarity(t1: string, t2: string): number {
    const words1 = new Set(t1.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(t2.split(/\s+/).filter((w) => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Check if two memories have equal observations.
   * @internal
   */
  private observationsEqual(m1: AgentEntity, m2: AgentEntity): boolean {
    const obs1 = m1.observations ?? [];
    const obs2 = m2.observations ?? [];

    if (obs1.length !== obs2.length) return false;

    const sorted1 = [...obs1].sort();
    const sorted2 = [...obs2].sort();

    return sorted1.every((o, i) => o === sorted2[i]);
  }

  /**
   * Suggest the best resolution strategy based on memory properties.
   * @internal
   */
  private suggestStrategy(m1: AgentEntity, m2: AgentEntity): ConflictStrategy {
    // If one has much higher confidence, use highest_confidence
    const conf1 = m1.confidence ?? 0.5;
    const conf2 = m2.confidence ?? 0.5;
    if (Math.abs(conf1 - conf2) > 0.3) {
      return 'highest_confidence';
    }

    // If one has more confirmations, use most_confirmations
    const confirm1 = m1.confirmationCount ?? 0;
    const confirm2 = m2.confirmationCount ?? 0;
    if (Math.abs(confirm1 - confirm2) >= 3) {
      return 'most_confirmations';
    }

    // Default to most_recent
    return this.config.defaultStrategy;
  }

  /**
   * Resolve a conflict using the specified strategy.
   *
   * @param conflict - Conflict information
   * @param memories - All memories involved
   * @param agents - Agent metadata for trust-based resolution
   * @param strategy - Resolution strategy (uses suggested if not specified)
   * @returns Resolution result
   */
  resolveConflict(
    conflict: ConflictInfo,
    memories: AgentEntity[],
    agents: Map<string, AgentMetadata>,
    strategy?: ConflictStrategy
  ): ResolutionResult {
    const resolveStrategy = strategy ?? conflict.suggestedStrategy;

    // Gather conflicting memories
    const allNames = [conflict.primaryMemory, ...conflict.conflictingMemories];
    const conflictingMemories = memories.filter((m) =>
      allNames.includes(m.name)
    );

    if (conflictingMemories.length === 0) {
      throw new Error('No conflicting memories found');
    }

    let resolvedMemory: AgentEntity;
    let auditEntry: string;

    switch (resolveStrategy) {
      case 'most_recent':
        resolvedMemory = this.resolveMostRecent(conflictingMemories);
        auditEntry = `Resolved conflict using most_recent strategy. Selected: ${resolvedMemory.name}`;
        break;

      case 'highest_confidence':
        resolvedMemory = this.resolveHighestConfidence(conflictingMemories);
        auditEntry = `Resolved conflict using highest_confidence strategy. Selected: ${resolvedMemory.name}`;
        break;

      case 'most_confirmations':
        resolvedMemory = this.resolveMostConfirmations(conflictingMemories);
        auditEntry = `Resolved conflict using most_confirmations strategy. Selected: ${resolvedMemory.name}`;
        break;

      case 'trusted_agent':
        resolvedMemory = this.resolveTrustedAgent(conflictingMemories, agents);
        auditEntry = `Resolved conflict using trusted_agent strategy. Selected: ${resolvedMemory.name}`;
        break;

      case 'merge_all':
        resolvedMemory = this.resolveMergeAll(conflictingMemories);
        auditEntry = `Resolved conflict using merge_all strategy. Merged ${conflictingMemories.length} memories`;
        break;

      default:
        throw new Error(`Unknown resolution strategy: ${resolveStrategy}`);
    }

    // Emit resolution event
    this.emit('memory:conflict_resolved', {
      conflict,
      strategy: resolveStrategy,
      resolvedMemory: resolvedMemory.name,
    });

    return {
      resolvedMemory,
      strategy: resolveStrategy,
      sourceMemories: allNames,
      auditEntry,
    };
  }

  /**
   * Resolve by selecting most recently modified memory.
   * @internal
   */
  private resolveMostRecent(memories: AgentEntity[]): AgentEntity {
    return memories.reduce((best, m) => {
      const bestTime = best.lastModified ?? best.createdAt ?? '1970-01-01';
      const mTime = m.lastModified ?? m.createdAt ?? '1970-01-01';
      return mTime > bestTime ? m : best;
    });
  }

  /**
   * Resolve by selecting highest confidence memory.
   * @internal
   */
  private resolveHighestConfidence(memories: AgentEntity[]): AgentEntity {
    return memories.reduce((best, m) => {
      const bestConf = best.confidence ?? 0.5;
      const mConf = m.confidence ?? 0.5;
      return mConf > bestConf ? m : best;
    });
  }

  /**
   * Resolve by selecting most confirmed memory.
   * @internal
   */
  private resolveMostConfirmations(memories: AgentEntity[]): AgentEntity {
    return memories.reduce((best, m) => {
      const bestConf = best.confirmationCount ?? 0;
      const mConf = m.confirmationCount ?? 0;
      return mConf > bestConf ? m : best;
    });
  }

  /**
   * Resolve by selecting memory from most trusted agent.
   * @internal
   */
  private resolveTrustedAgent(
    memories: AgentEntity[],
    agents: Map<string, AgentMetadata>
  ): AgentEntity {
    return memories.reduce((best, m) => {
      const bestAgent = best.agentId ? agents.get(best.agentId) : undefined;
      const mAgent = m.agentId ? agents.get(m.agentId) : undefined;
      const bestTrust = bestAgent?.trustLevel ?? 0.5;
      const mTrust = mAgent?.trustLevel ?? 0.5;
      return mTrust > bestTrust ? m : best;
    });
  }

  /**
   * Resolve by merging all observations into one memory.
   * @internal
   */
  private resolveMergeAll(memories: AgentEntity[]): AgentEntity {
    // Use most recent as base
    const base = this.resolveMostRecent(memories);

    // Collect unique observations from all memories
    const allObservations = new Set<string>();
    for (const m of memories) {
      if (m.observations) {
        for (const o of m.observations) {
          allObservations.add(o);
        }
      }
    }

    // Calculate merged confidence (average)
    const avgConfidence =
      memories.reduce((sum, m) => sum + (m.confidence ?? 0.5), 0) /
      memories.length;

    // Sum confirmations
    const totalConfirmations = memories.reduce(
      (sum, m) => sum + (m.confirmationCount ?? 0),
      0
    );

    // Create merged memory
    return {
      ...base,
      observations: Array.from(allObservations),
      confidence: avgConfidence,
      confirmationCount: totalConfirmations,
      lastModified: new Date().toISOString(),
    };
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<Required<ConflictResolverConfig>> {
    return { ...this.config };
  }
}
