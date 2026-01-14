/**
 * Decay Scheduler
 *
 * Schedules periodic decay and forget operations for autonomous
 * memory management. Memories are periodically processed and
 * weak ones forgotten without manual intervention.
 *
 * @module agent/DecayScheduler
 */

import type { DecayResult, ForgetResult, ForgetOptions } from '../types/agent-memory.js';
import type { DecayEngine } from './DecayEngine.js';

// Re-export for convenience
export type { DecayResult, ForgetResult } from '../types/agent-memory.js';

/**
 * Configuration for scheduled decay.
 */
export interface DecaySchedulerConfig {
  /** Interval between decay runs in milliseconds (default: 1 hour) */
  decayIntervalMs?: number;
  /** Enable automatic forgetting after decay analysis */
  autoForget?: boolean;
  /** Options for forget operations when autoForget is enabled */
  forgetOptions?: ForgetOptions;
  /** Callback when decay analysis completes */
  onDecayComplete?: (result: DecayResult) => void;
  /** Callback when forget operation completes */
  onForgetComplete?: (result: ForgetResult) => void;
  /** Callback when an error occurs during a cycle */
  onError?: (error: Error) => void;
}

/**
 * Result of a manual decay cycle run.
 */
export interface DecayCycleResult {
  /** Decay analysis results */
  decay: DecayResult;
  /** Forget operation results (if autoForget enabled) */
  forget?: ForgetResult;
}

/**
 * Schedules periodic decay and forget operations.
 *
 * The DecayScheduler runs decay analysis at configurable intervals
 * and optionally forgets weak memories automatically. This enables
 * autonomous memory management mimicking natural forgetting processes.
 *
 * Key features:
 * - Configurable decay interval
 * - Optional auto-forget after decay
 * - Callbacks for monitoring decay/forget operations
 * - Manual cycle execution via runNow()
 *
 * @example
 * ```typescript
 * const scheduler = new DecayScheduler(decayEngine, {
 *   decayIntervalMs: 60 * 60 * 1000, // Hourly
 *   autoForget: true,
 *   forgetOptions: {
 *     effectiveImportanceThreshold: 0.1,
 *     excludeTags: ['important', 'permanent'],
 *   },
 *   onDecayComplete: (result) => {
 *     console.log(`Processed ${result.entitiesProcessed} entities`);
 *   },
 *   onForgetComplete: (result) => {
 *     console.log(`Forgot ${result.memoriesForgotten} memories`);
 *   },
 * });
 *
 * // Start scheduled decay
 * scheduler.start();
 *
 * // Later: stop scheduled decay
 * scheduler.stop();
 *
 * // Run a single cycle manually
 * const result = await scheduler.runNow();
 * ```
 */
export class DecayScheduler {
  private readonly decayEngine: DecayEngine;
  private readonly config: Required<
    Pick<DecaySchedulerConfig, 'decayIntervalMs' | 'autoForget'>
  > &
    Pick<
      DecaySchedulerConfig,
      'forgetOptions' | 'onDecayComplete' | 'onForgetComplete' | 'onError'
    >;
  private intervalId?: ReturnType<typeof setInterval>;
  private running: boolean = false;

  constructor(decayEngine: DecayEngine, config: DecaySchedulerConfig = {}) {
    this.decayEngine = decayEngine;
    this.config = {
      decayIntervalMs: config.decayIntervalMs ?? 60 * 60 * 1000, // Default 1 hour
      autoForget: config.autoForget ?? false,
      forgetOptions: config.forgetOptions,
      onDecayComplete: config.onDecayComplete,
      onForgetComplete: config.onForgetComplete,
      onError: config.onError,
    };
  }

  /**
   * Start the scheduled decay process.
   *
   * Begins periodic execution of decay cycles at the configured interval.
   * Also runs one cycle immediately on start.
   *
   * Multiple calls to start() are idempotent - only the first starts the scheduler.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = setInterval(
      () => this.runDecayCycle(),
      this.config.decayIntervalMs
    );

    // Run immediately on start
    this.runDecayCycle();
  }

  /**
   * Stop the scheduled decay process.
   *
   * Halts periodic execution. Any in-progress cycle will complete,
   * but no new cycles will be started.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.running = false;
  }

  /**
   * Check if scheduler is currently running.
   *
   * @returns True if the scheduler is active
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the configured decay interval.
   *
   * @returns Interval in milliseconds
   */
  getInterval(): number {
    return this.config.decayIntervalMs;
  }

  /**
   * Run a single decay cycle.
   *
   * Called automatically by the scheduler, but can also be
   * invoked manually. Runs decay analysis and optionally
   * forgets weak memories.
   *
   * @internal
   */
  private async runDecayCycle(): Promise<void> {
    try {
      // Run decay analysis
      const decayResult = await this.decayEngine.applyDecay();
      this.config.onDecayComplete?.(decayResult);

      // Run forget if enabled and configured
      if (this.config.autoForget && this.config.forgetOptions) {
        const forgetResult = await this.decayEngine.forgetWeakMemories(
          this.config.forgetOptions
        );
        this.config.onForgetComplete?.(forgetResult);
      }
    } catch (error) {
      if (this.config.onError) {
        this.config.onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        // Default: log to console if no error handler provided
        console.error('Decay cycle error:', error);
      }
    }
  }

  /**
   * Run a decay cycle manually (on-demand).
   *
   * This method allows triggering a decay cycle outside of the
   * scheduled interval. Useful for:
   * - Testing
   * - User-initiated cleanup
   * - One-time decay operations
   *
   * @returns Results of the decay cycle
   *
   * @example
   * ```typescript
   * const result = await scheduler.runNow();
   * console.log(`Processed: ${result.decay.entitiesProcessed}`);
   * if (result.forget) {
   *   console.log(`Forgot: ${result.forget.memoriesForgotten}`);
   * }
   * ```
   */
  async runNow(): Promise<DecayCycleResult> {
    const decay = await this.decayEngine.applyDecay();

    let forget: ForgetResult | undefined;
    if (this.config.autoForget && this.config.forgetOptions) {
      forget = await this.decayEngine.forgetWeakMemories(this.config.forgetOptions);
    }

    return { decay, forget };
  }
}
