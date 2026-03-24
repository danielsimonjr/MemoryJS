/**
 * Consolidation Scheduler
 *
 * Background scheduler that periodically runs memory consolidation using
 * the ConsolidationPipeline and optional duplicate-merge via CompressionManager.
 *
 * Mirrors the DecayScheduler pattern:
 * - Configurable interval
 * - Gated by MEMORY_AUTO_CONSOLIDATION env bool in ManagerContext
 * - runNow() for on-demand execution
 * - Callbacks for monitoring
 * - Idempotent start()
 *
 * @module agent/ConsolidationScheduler
 */

import { EventEmitter } from 'events';
import type { ConsolidationPipeline } from './ConsolidationPipeline.js';
import type { CompressionManager } from '../features/CompressionManager.js';
import type { ConsolidationResult } from '../types/agent-memory.js';

// ==================== Types ====================

/**
 * Configuration for ConsolidationScheduler.
 */
export interface ConsolidationSchedulerConfig {
  /** Interval between consolidation runs in milliseconds (default: 3 600 000 = 1 hour) */
  consolidationIntervalMs?: number;
  /** Enable duplicate detection and merge after each consolidation (default: false) */
  autoMergeDuplicates?: boolean;
  /**
   * Similarity threshold for duplicate detection (default: 0.9).
   * Only used when autoMergeDuplicates is true.
   */
  duplicateThreshold?: number;
  /** Callback when a consolidation cycle completes successfully */
  onConsolidationComplete?: (result: ConsolidationCycleResult) => void;
  /** Callback when an error occurs during a cycle */
  onError?: (error: Error) => void;
}

/**
 * Result of a single consolidation cycle.
 */
export interface ConsolidationCycleResult {
  /** Result from ConsolidationPipeline.triggerManualConsolidation() */
  consolidation: ConsolidationResult;
  /** Number of duplicate pairs merged (only when autoMergeDuplicates enabled) */
  duplicatesMerged?: number;
  /** ISO 8601 timestamp when the cycle ran */
  ranAt: string;
}

// ==================== Scheduler Class ====================

/**
 * Schedules periodic memory consolidation operations.
 *
 * @example
 * ```typescript
 * const scheduler = new ConsolidationScheduler(pipeline, compressionManager, {
 *   consolidationIntervalMs: 2 * 60 * 60 * 1000, // every 2 hours
 *   autoMergeDuplicates: true,
 *   onConsolidationComplete: (result) => {
 *     console.log(`Promoted: ${result.consolidation.memoriesPromoted}`);
 *   },
 * });
 *
 * scheduler.start();
 * // ...later
 * scheduler.stop();
 *
 * // Run a cycle on-demand
 * const result = await scheduler.runNow();
 * ```
 */
export class ConsolidationScheduler extends EventEmitter {
  private readonly pipeline: ConsolidationPipeline;
  private readonly compressionManager?: CompressionManager;
  private readonly config: Required<
    Pick<
      ConsolidationSchedulerConfig,
      'consolidationIntervalMs' | 'autoMergeDuplicates' | 'duplicateThreshold'
    >
  > &
    Pick<ConsolidationSchedulerConfig, 'onConsolidationComplete' | 'onError'>;

  private intervalId?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    pipeline: ConsolidationPipeline,
    compressionManager?: CompressionManager,
    config: ConsolidationSchedulerConfig = {}
  ) {
    super();
    this.pipeline = pipeline;
    this.compressionManager = compressionManager;
    this.config = {
      consolidationIntervalMs: config.consolidationIntervalMs ?? 60 * 60 * 1000,
      autoMergeDuplicates: config.autoMergeDuplicates ?? false,
      duplicateThreshold: config.duplicateThreshold ?? 0.9,
      onConsolidationComplete: config.onConsolidationComplete,
      onError: config.onError,
    };
  }

  // ==================== Lifecycle ====================

  /**
   * Start the scheduled consolidation process.
   *
   * Multiple calls are idempotent — only the first call starts the scheduler.
   * One cycle runs immediately on start.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = setInterval(
      () => this.runConsolidationCycle(),
      this.config.consolidationIntervalMs
    );

    // Run immediately on start
    this.runConsolidationCycle();
  }

  /**
   * Stop the scheduled consolidation process.
   *
   * Any in-progress cycle completes; no new cycles are started.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.running = false;
  }

  /**
   * Whether the scheduler is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * The configured consolidation interval in milliseconds.
   */
  getInterval(): number {
    return this.config.consolidationIntervalMs;
  }

  // ==================== Cycle Execution ====================

  /**
   * Run a consolidation cycle on demand, independently of the scheduled interval.
   *
   * @returns Results of the cycle
   *
   * @example
   * ```typescript
   * const result = await scheduler.runNow();
   * console.log(`Promoted: ${result.consolidation.memoriesPromoted}`);
   * ```
   */
  async runNow(): Promise<ConsolidationCycleResult> {
    const consolidation = await this.pipeline.triggerManualConsolidation();

    let duplicatesMerged: number | undefined;
    if (this.config.autoMergeDuplicates && this.compressionManager) {
      const compressionResult = await this.compressionManager.compressGraph(
        this.config.duplicateThreshold
      );
      duplicatesMerged = compressionResult.entitiesMerged;
    }

    const cycleResult: ConsolidationCycleResult = {
      consolidation,
      duplicatesMerged,
      ranAt: new Date().toISOString(),
    };

    return cycleResult;
  }

  // ==================== Internal ====================

  /**
   * Execute one consolidation cycle and invoke callbacks.
   * @internal
   */
  private async runConsolidationCycle(): Promise<void> {
    try {
      const result = await this.runNow();
      this.config.onConsolidationComplete?.(result);
      this.emit('consolidation:complete', result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.config.onError) {
        this.config.onError(err);
      } else {
        console.error('ConsolidationScheduler cycle error:', err);
      }
      this.emit('consolidation:error', err);
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<Required<
    Pick<
      ConsolidationSchedulerConfig,
      'consolidationIntervalMs' | 'autoMergeDuplicates' | 'duplicateThreshold'
    >
  >> {
    return {
      consolidationIntervalMs: this.config.consolidationIntervalMs,
      autoMergeDuplicates: this.config.autoMergeDuplicates,
      duplicateThreshold: this.config.duplicateThreshold,
    };
  }
}
