/**
 * Distillation Pipeline
 *
 * Orchestrates one or more IDistillationPolicy instances, tracks per-policy
 * statistics, and produces a DistillationResult with rich metadata.
 *
 * Sits between HybridSearchManager output and ContextWindowManager input.
 *
 * @module agent/DistillationPipeline
 */

import type { HybridSearchResult } from '../types/types.js';
import type { IDistillationPolicy, DistilledMemory, DistillationConfig } from './DistillationPolicy.js';

export type { IDistillationPolicy, DistilledMemory, DistillationConfig };

// ==================== Pipeline Types ====================

/**
 * Statistics from a distillation run.
 */
export interface DistillationStats {
  /** Number of memories supplied to distill() */
  inputCount: number;
  /** Number of memories in the output */
  outputCount: number;
  /** Per-policy removal counts (keyed by policy index or name) */
  removedByPolicy: Record<string, number>;
  /** Total memories removed across all policies */
  totalRemoved: number;
}

/**
 * Result of a distillation pipeline run.
 */
export interface DistillationResult {
  /** Memories that survived all policies (only kept: true items) */
  kept: DistilledMemory[];
  /** Statistics about what was removed */
  stats: DistillationStats;
}

// ==================== DistillationPipeline ====================

/**
 * Orchestrates a sequence of IDistillationPolicy instances.
 *
 * Each policy is applied in order. After the final policy, per-policy removal
 * stats are synthesised by comparing intermediate counts.
 *
 * @example
 * ```typescript
 * const pipeline = new DistillationPipeline();
 * pipeline.addPolicy(new DefaultDistillationPolicy());
 *
 * const result = await pipeline.distill(searchResults, {
 *   minScore: 0.3,
 *   queryKeywords: ['hotel', 'budget'],
 * });
 *
 * console.log(`Kept ${result.stats.outputCount} of ${result.stats.inputCount}`);
 * ```
 */
export class DistillationPipeline {
  private readonly policies: Array<{ name: string; policy: IDistillationPolicy }> = [];

  /**
   * Add a policy to the end of the pipeline.
   *
   * @param policy - The policy to add
   * @param name - Optional human-readable name for stats tracking (defaults to index)
   */
  addPolicy(policy: IDistillationPolicy, name?: string): void {
    const policyName = name ?? `policy_${this.policies.length}`;
    this.policies.push({ name: policyName, policy });
  }

  /**
   * Remove all policies from the pipeline.
   */
  clearPolicies(): void {
    this.policies.length = 0;
  }

  /**
   * Number of policies currently registered.
   */
  get policyCount(): number {
    return this.policies.length;
  }

  /**
   * Run the distillation pipeline over a set of search results.
   *
   * If no policies are configured, all inputs are passed through unchanged
   * (with synthetic distilledScore = combined score).
   *
   * @param results - HybridSearchResult array from HybridSearchManager
   * @param config - Distillation configuration
   * @returns DistillationResult with kept memories and stats
   */
  async distill(
    results: HybridSearchResult[],
    config: DistillationConfig = {}
  ): Promise<DistillationResult> {
    const inputCount = results.length;
    const removedByPolicy: Record<string, number> = {};

    // No policies → pass-through
    if (this.policies.length === 0) {
      const kept: DistilledMemory[] = results.map((r) => ({
        entity: r.entity,
        rawScore: r.scores.combined,
        distilledScore: r.scores.combined,
        reason: 'no-policies',
        kept: true,
      }));
      return {
        kept,
        stats: {
          inputCount,
          outputCount: kept.length,
          removedByPolicy: {},
          totalRemoved: 0,
        },
      };
    }

    // Run first policy on original input.
    let currentHybridInput: HybridSearchResult[] = results;
    let currentDistilledOutput: DistilledMemory[] = await this.policies[0].policy.distill(
      currentHybridInput,
      config
    );
    removedByPolicy[this.policies[0].name] =
      currentHybridInput.length - currentDistilledOutput.length;

    // Run subsequent policies, re-wrapping output as HybridSearchResult.
    for (let i = 1; i < this.policies.length; i++) {
      const adapted: HybridSearchResult[] = currentDistilledOutput.map((dm) => ({
        entity: dm.entity,
        scores: {
          semantic: 0,
          lexical: 0,
          symbolic: 0,
          combined: dm.distilledScore,
        },
        matchedLayers: [] as ('semantic' | 'lexical' | 'symbolic')[],
      }));

      const prevCount = currentDistilledOutput.length;
      currentDistilledOutput = await this.policies[i].policy.distill(adapted, config);
      removedByPolicy[this.policies[i].name] = prevCount - currentDistilledOutput.length;
    }

    const totalRemoved = Object.values(removedByPolicy).reduce((s, v) => s + v, 0);

    return {
      kept: currentDistilledOutput,
      stats: {
        inputCount,
        outputCount: currentDistilledOutput.length,
        removedByPolicy,
        totalRemoved,
      },
    };
  }

  /**
   * Names of registered policies (in order).
   */
  getPolicyNames(): string[] {
    return this.policies.map((p) => p.name);
  }

  /**
   * Return this pipeline as an IDistillationPolicy adapter.
   *
   * The adapter's `distill()` calls the pipeline and returns only the kept
   * DistilledMemory array (discarding the stats wrapper), making it compatible
   * with any component that accepts IDistillationPolicy.
   */
  asPolicyAdapter(): IDistillationPolicy {
    const pipeline = this;
    return {
      async distill(
        results: HybridSearchResult[],
        config: DistillationConfig
      ): Promise<DistilledMemory[]> {
        const result = await pipeline.distill(results, config);
        return result.kept;
      },
    };
  }
}
