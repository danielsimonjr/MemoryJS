/**
 * Entropy-Aware Content Filter
 *
 * Computes Shannon entropy on text to detect low-information content.
 * Used as a pre-storage gate on WorkingMemoryManager and as a pluggable
 * ConsolidationPipeline stage.
 *
 * @module agent/EntropyFilter
 */

import type { AgentEntity, ConsolidateOptions } from '../types/agent-memory.js';
import type { PipelineStage, StageResult } from './ConsolidationPipeline.js';

// Re-export for convenience
export { LowEntropyContentError } from '../utils/errors.js';

// ==================== Configuration ====================

/**
 * Configuration for entropy filtering.
 */
export interface EntropyFilterConfig {
  /**
   * Minimum Shannon entropy in bits for content to pass the filter.
   * - 0.0 = no filtering
   * - 1.5 = default (removes nearly constant strings)
   * - 3.0 = strict (requires reasonable variety)
   */
  minEntropy?: number;
  /**
   * Minimum content length in characters before entropy check is applied.
   * Very short strings are allowed through regardless of entropy.
   * Default: 10
   */
  minLength?: number;
}

// ==================== Core Functions ====================

/**
 * Compute Shannon entropy of a string in bits.
 *
 * Entropy measures information density:
 * - 0 bits = single repeated character (e.g. "aaaaaaa")
 * - ~3.32 bits = uniformly distributed over 10 symbols
 * - ~4.7 bits = English prose (typical)
 *
 * @param text - Input string to measure
 * @returns Entropy in bits (0 = constant, higher = more information)
 *
 * @example
 * ```typescript
 * computeEntropy('hello world'); // ~3.18
 * computeEntropy('aaaaaaaaaa'); // 0
 * computeEntropy('');           // 0
 * ```
 */
export function computeEntropy(text: string): number {
  if (!text || text.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  const len = text.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Returns true if the content has sufficient information entropy to be
 * worth storing.
 *
 * @param text - Text to evaluate
 * @param minEntropy - Minimum entropy threshold in bits (default: 1.5)
 * @param minLength - Minimum length before entropy is checked (default: 10)
 * @returns True if the text passes the entropy threshold
 *
 * @example
 * ```typescript
 * passesEntropyFilter('hello world', 1.5); // true
 * passesEntropyFilter('aaaaaaaaaa', 1.5);  // false
 * passesEntropyFilter('hi', 1.5);          // true  (too short to check)
 * ```
 */
export function passesEntropyFilter(
  text: string,
  minEntropy: number = 1.5,
  minLength: number = 10
): boolean {
  if (!text || text.length < minLength) return true; // Too short to penalise
  return computeEntropy(text) >= minEntropy;
}

// ==================== Pipeline Stage ====================

/**
 * ConsolidationPipeline stage that filters out low-entropy observations.
 *
 * Attaches to the ConsolidationPipeline via `registerStage()`. The stage
 * records skipped entities in its own tracking array and returns a
 * `StageResult` that reports them as "processed but not transformed".
 *
 * Note: ConsolidationPipeline passes the full entity list through each stage
 * sequentially. The entropy stage marks filtered entities by not transforming
 * them; actual exclusion behaviour depends on how the pipeline uses the result.
 *
 * @example
 * ```typescript
 * const stage = new EntropyFilterStage({ minEntropy: 2.0 });
 * pipeline.registerStage(stage);
 * ```
 */
export class EntropyFilterStage implements PipelineStage {
  readonly name = 'entropy-filter';
  private readonly config: Required<EntropyFilterConfig>;

  /** Names of entities rejected in the most recent `process()` call */
  private readonly _rejectedNames: string[] = [];

  /**
   * Returns a snapshot copy of the names rejected in the most recent `process()` call.
   * A copy is returned to prevent external mutation of the internal array.
   */
  get rejectedNames(): string[] {
    return [...this._rejectedNames];
  }

  constructor(config: EntropyFilterConfig = {}) {
    this.config = {
      minEntropy: config.minEntropy ?? 1.5,
      minLength: config.minLength ?? 10,
    };
  }

  /**
   * Evaluate entities and record those that fail the entropy threshold.
   *
   * @param entities - Entities to process
   * @param _options - Consolidation options (unused)
   * @returns StageResult where `transformed` = count of passing entities
   */
  async process(
    entities: AgentEntity[],
    _options: ConsolidateOptions
  ): Promise<StageResult> {
    this._rejectedNames.length = 0; // Reset for this run

    let passedCount = 0;

    for (const entity of entities) {
      const combinedText = (entity.observations ?? []).join(' ');
      if (passesEntropyFilter(combinedText, this.config.minEntropy, this.config.minLength)) {
        passedCount++;
      } else {
        this._rejectedNames.push(entity.name);
      }
    }

    return {
      processed: entities.length,
      transformed: passedCount,
      errors: [],
    };
  }

  /**
   * Get current filter configuration.
   */
  getConfig(): Readonly<Required<EntropyFilterConfig>> {
    return { ...this.config };
  }
}
