/**
 * DreamEngine — Background Memory Maintenance System
 *
 * Runs periodic "dream cycles" that perform 8 configurable maintenance phases
 * to keep the memory graph healthy, compressed, and semantically rich.
 *
 * Inspired by memory consolidation during sleep, where the brain replays,
 * prunes, and organises experiences into long-term storage.
 *
 * @module agent/DreamEngine
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage, Relation } from '../types/types.js';
import type { GraphStorage } from '../core/GraphStorage.js';
import { FreshnessManager } from '../features/FreshnessManager.js';
import { CompressionManager } from '../features/CompressionManager.js';
import { ObservationNormalizer } from '../features/ObservationNormalizer.js';
import { PatternDetector } from './PatternDetector.js';
import { ConsolidationPipeline } from './ConsolidationPipeline.js';
import { passesEntropyFilter } from './EntropyFilter.js';

// ==================== Configuration ====================

/**
 * Per-phase enable flags.  All phases default to enabled.
 */
export interface DreamPhaseConfig {
  /** Phase 1: Resolve relative date references to absolute ISO timestamps. */
  temporalAnchoring?: boolean;
  /** Phase 2: Flag stale entities, decay confidence, expire TTL'd records. */
  freshnessSweep?: boolean;
  /** Phase 3: Remove observations whose Shannon entropy is below the threshold. */
  entropyPruning?: boolean;
  /** Phase 4: Merge working-memory items into long-term storage. */
  consolidation?: boolean;
  /** Phase 5: Deduplicate near-identical entities above the similarity threshold. */
  compression?: boolean;
  /** Phase 6: Auto-generate summary observations for entity enrichment. */
  entityEnrichment?: boolean;
  /** Phase 7: Detect recurring observation themes and promote to semantic memory. */
  patternPromotion?: boolean;
  /** Phase 8: Orphan detection and dangling-relation cleanup. */
  graphHygiene?: boolean;
}

/**
 * Callbacks fired at key lifecycle moments.
 */
export interface DreamEngineCallbacks {
  /** Called when a full dream cycle completes successfully. */
  onCycleComplete?: (result: DreamCycleResult) => void;
  /** Called when a phase or cycle throws an unhandled error. */
  onError?: (error: Error, context: string) => void;
}

/**
 * Full configuration for the DreamEngine.
 */
export interface DreamEngineConfig {
  /** Per-phase enable/disable flags.  Defaults: all enabled. */
  phases?: DreamPhaseConfig;
  /**
   * How often the engine wakes to run a dream cycle.
   * @default 14_400_000 (4 hours)
   */
  intervalMs?: number;
  /**
   * Run a dream cycle automatically when endSession() is called.
   * @default true
   */
  runOnSessionEnd?: boolean;
  /**
   * Hard limit on total cycle wall-clock time (ms).
   * Individual phases are skipped once this threshold is reached.
   * @default 60_000 (60 seconds)
   */
  maxDurationMs?: number;
  /** Optional lifecycle callbacks. */
  callbacks?: DreamEngineCallbacks;
  /**
   * Minimum Shannon entropy required for an observation to survive Phase 3.
   * @default 1.5
   */
  minEntropy?: number;
  /**
   * Similarity threshold for Phase 5 compression (0-1).
   * @default 0.85
   */
  compressionThreshold?: number;
  /**
   * Minimum pattern occurrences before promotion in Phase 7.
   * @default 3
   */
  minPatternOccurrences?: number;
}

// ==================== Result Types ====================

/**
 * Result from a single maintenance phase.
 */
export interface DreamPhaseResult {
  /** Phase name. */
  name: string;
  /** Whether the phase was enabled and ran. */
  ran: boolean;
  /** Milliseconds the phase consumed. */
  durationMs: number;
  /** Phase-specific counts/metrics. */
  metrics: Record<string, number>;
  /** Non-fatal errors caught inside the phase. */
  errors: string[];
}

/**
 * Aggregate result from one complete dream cycle.
 */
export interface DreamCycleResult {
  /** Unique identifier for this cycle. */
  cycleId: string;
  /** ISO 8601 start timestamp. */
  startedAt: string;
  /** ISO 8601 end timestamp. */
  completedAt: string;
  /** Total wall-clock time in milliseconds. */
  durationMs: number;
  /** Whether the cycle hit the maxDurationMs safety limit. */
  timedOut: boolean;
  /** Per-phase results in execution order. */
  phases: DreamPhaseResult[];
  /** Total observations anchored (Phase 1). */
  observationsAnchored: number;
  /** Total entities flagged stale or expired (Phase 2). */
  entitiesExpired: number;
  /** Total observations pruned for low entropy (Phase 3). */
  observationsPruned: number;
  /** Total memories consolidated (Phase 4). */
  memoriesConsolidated: number;
  /** Total entities deduplicated (Phase 5). */
  entitiesDeduplicated: number;
  /** Total summary observations added (Phase 6). */
  summariesAdded: number;
  /** Total patterns promoted to semantic memory (Phase 7). */
  patternsPromoted: number;
  /** Total dangling relations removed (Phase 8). */
  relationsRemoved: number;
}

// ==================== Resolved Config ====================

interface ResolvedDreamConfig {
  phases: Required<DreamPhaseConfig>;
  intervalMs: number;
  runOnSessionEnd: boolean;
  maxDurationMs: number;
  callbacks: DreamEngineCallbacks;
  minEntropy: number;
  compressionThreshold: number;
  minPatternOccurrences: number;
}

function resolveConfig(config: DreamEngineConfig): ResolvedDreamConfig {
  const phases: Required<DreamPhaseConfig> = {
    temporalAnchoring: config.phases?.temporalAnchoring ?? true,
    freshnessSweep: config.phases?.freshnessSweep ?? true,
    entropyPruning: config.phases?.entropyPruning ?? true,
    consolidation: config.phases?.consolidation ?? true,
    compression: config.phases?.compression ?? true,
    entityEnrichment: config.phases?.entityEnrichment ?? true,
    patternPromotion: config.phases?.patternPromotion ?? true,
    graphHygiene: config.phases?.graphHygiene ?? true,
  };
  return {
    phases,
    intervalMs: config.intervalMs ?? 4 * 60 * 60 * 1000, // 4 h
    runOnSessionEnd: config.runOnSessionEnd ?? true,
    maxDurationMs: config.maxDurationMs ?? 60_000,
    callbacks: config.callbacks ?? {},
    minEntropy: config.minEntropy ?? 1.5,
    compressionThreshold: config.compressionThreshold ?? 0.85,
    minPatternOccurrences: config.minPatternOccurrences ?? 3,
  };
}

// ==================== DreamEngine ====================

/**
 * Background memory maintenance engine.
 *
 * @example
 * ```typescript
 * const engine = new DreamEngine(storage, pipeline, config);
 * engine.start();   // begin periodic dream cycles
 *
 * // Force an immediate cycle
 * const result = await engine.runDreamCycle();
 *
 * engine.stop();    // cancel periodic timer
 * ```
 */
export class DreamEngine extends EventEmitter {
  private readonly storage: IGraphStorage;
  private readonly pipeline: ConsolidationPipeline;
  private readonly config: ResolvedDreamConfig;

  // Lazy-initialised helpers
  private _freshnessManager?: FreshnessManager;
  private _compressionManager?: CompressionManager;
  private _normalizer?: ObservationNormalizer;
  private _patternDetector?: PatternDetector;

  private running = false;
  private intervalId?: ReturnType<typeof setInterval>;

  // ==================== Construction ====================

  constructor(
    storage: IGraphStorage,
    pipeline: ConsolidationPipeline,
    config: DreamEngineConfig = {}
  ) {
    super();
    this.storage = storage;
    this.pipeline = pipeline;
    this.config = resolveConfig(config);
  }

  // ==================== Lazy helpers ====================

  private get freshnessManager(): FreshnessManager {
    return (this._freshnessManager ??= new FreshnessManager(this.storage));
  }

  private get compressionManager(): CompressionManager {
    // CompressionManager requires the concrete GraphStorage but accepts the same
    // interface.  The cast mirrors the approach used in ManagerContext.
    return (this._compressionManager ??= new CompressionManager(
      this.storage as unknown as GraphStorage
    ));
  }

  private get normalizer(): ObservationNormalizer {
    return (this._normalizer ??= new ObservationNormalizer());
  }

  private get patternDetector(): PatternDetector {
    return (this._patternDetector ??= new PatternDetector());
  }

  // ==================== Timer Lifecycle ====================

  /**
   * Start the periodic dream cycle timer.
   * Calling start() while already running is a no-op.
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = setInterval(() => {
      void this.runDreamCycle();
    }, this.config.intervalMs);

    // Prevent the timer from keeping the process alive (mirrors ConsolidationScheduler pattern).
    this.intervalId.unref();
  }

  /**
   * Stop the periodic timer.
   * Any in-flight cycle continues to completion.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.running = false;
  }

  /**
   * Whether the periodic timer is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ==================== Cycle Execution ====================

  /**
   * Run one full dream cycle immediately, regardless of the timer.
   *
   * Phases run sequentially.  Each phase is wrapped in a try/catch so a
   * single failure cannot abort the remaining phases.  If `maxDurationMs`
   * is reached the remaining phases are skipped and `timedOut` is set.
   */
  async runDreamCycle(): Promise<DreamCycleResult> {
    const cycleId = randomUUID();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    this.emit('dream:cycle:start', { cycleId, startedAt });

    const phases: DreamPhaseResult[] = [];
    let timedOut = false;

    // Running totals
    let observationsAnchored = 0;
    let entitiesExpired = 0;
    let observationsPruned = 0;
    let memoriesConsolidated = 0;
    let entitiesDeduplicated = 0;
    let summariesAdded = 0;
    let patternsPromoted = 0;
    let relationsRemoved = 0;

    const runPhase = async (
      name: string,
      enabled: boolean,
      fn: () => Promise<Record<string, number>>
    ): Promise<DreamPhaseResult> => {
      const phaseStart = Date.now();
      const errors: string[] = [];

      if (!enabled) {
        return { name, ran: false, durationMs: 0, metrics: {}, errors };
      }

      // Safety timeout check
      if (Date.now() - startMs >= this.config.maxDurationMs) {
        timedOut = true;
        return { name, ran: false, durationMs: 0, metrics: {}, errors: ['skipped: cycle timeout'] };
      }

      let metrics: Record<string, number> = {};
      try {
        metrics = await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        this.emit('dream:error', { cycleId, phase: name, error: err });
        this.config.callbacks.onError?.(
          err instanceof Error ? err : new Error(msg),
          `phase:${name}`
        );
      }

      const result: DreamPhaseResult = {
        name,
        ran: true,
        durationMs: Date.now() - phaseStart,
        metrics,
        errors,
      };
      this.emit('dream:phase:complete', { cycleId, phase: result });
      return result;
    };

    // ---- Phase 1: Temporal Anchoring ----
    const p1 = await runPhase(
      'temporalAnchoring',
      this.config.phases.temporalAnchoring,
      async () => {
        const graph = await this.storage.loadGraph();
        const now = new Date();
        let anchored = 0;

        for (const entity of graph.entities) {
          const updated: string[] = [];
          let changed = false;

          for (const obs of entity.observations) {
            const result = this.normalizer.anchorTimestamps(obs, now);
            if (result.changed) {
              updated.push(result.text);
              changed = true;
              anchored++;
            } else {
              updated.push(obs);
            }
          }

          if (changed) {
            await this.storage.updateEntity(entity.name, { observations: updated });
          }
        }

        return { anchored };
      }
    );
    observationsAnchored = p1.metrics['anchored'] ?? 0;
    phases.push(p1);

    // ---- Phase 2: Freshness Sweep ----
    const p2 = await runPhase(
      'freshnessSweep',
      this.config.phases.freshnessSweep,
      async () => {
        const stale = await this.freshnessManager.getStaleEntities(this.storage);
        const expired = await this.freshnessManager.getExpiredEntities(this.storage);
        let expiredCount = 0;

        // Mark stale entities with reduced confidence
        for (const entity of stale) {
          const currentConfidence = (entity as Entity & { confidence?: number }).confidence ?? 1;
          await this.storage.updateEntity(entity.name, {
            confidence: Math.max(0, currentConfidence - 0.1),
          } as Partial<Entity>);
        }

        // Mark truly expired entities
        for (const entity of expired) {
          await this.storage.updateEntity(entity.name, {
            tags: [...(entity.tags ?? []), 'dream:expired'],
          });
          expiredCount++;
        }

        return { stale: stale.length, expired: expiredCount };
      }
    );
    entitiesExpired = p2.metrics['expired'] ?? 0;
    phases.push(p2);

    // ---- Phase 3: Entropy Pruning ----
    const p3 = await runPhase(
      'entropyPruning',
      this.config.phases.entropyPruning,
      async () => {
        const graph = await this.storage.loadGraph();
        let pruned = 0;

        for (const entity of graph.entities) {
          const kept: string[] = [];
          let changed = false;

          for (const obs of entity.observations) {
            if (passesEntropyFilter(obs, this.config.minEntropy)) {
              kept.push(obs);
            } else {
              pruned++;
              changed = true;
            }
          }

          if (changed && kept.length > 0) {
            await this.storage.updateEntity(entity.name, { observations: kept });
          }
        }

        return { pruned };
      }
    );
    observationsPruned = p3.metrics['pruned'] ?? 0;
    phases.push(p3);

    // ---- Phase 4: Consolidation ----
    const p4 = await runPhase(
      'consolidation',
      this.config.phases.consolidation,
      async () => {
        const result = await this.pipeline.triggerManualConsolidation();
        return {
          memoriesProcessed: result.memoriesProcessed,
          memoriesPromoted: result.memoriesPromoted,
          memoriesMerged: result.memoriesMerged,
        };
      }
    );
    memoriesConsolidated =
      (p4.metrics['memoriesPromoted'] ?? 0) + (p4.metrics['memoriesMerged'] ?? 0);
    phases.push(p4);

    // ---- Phase 5: Compression ----
    const p5 = await runPhase(
      'compression',
      this.config.phases.compression,
      async () => {
        const result = await this.compressionManager.compressGraph(
          this.config.compressionThreshold,
          false
        );
        return {
          duplicatesFound: result.duplicatesFound,
          entitiesMerged: result.entitiesMerged,
          observationsCompressed: result.observationsCompressed,
        };
      }
    );
    entitiesDeduplicated = p5.metrics['entitiesMerged'] ?? 0;
    phases.push(p5);

    // ---- Phase 6: Entity Enrichment ----
    const p6 = await runPhase(
      'entityEnrichment',
      this.config.phases.entityEnrichment,
      async () => {
        const graph = await this.storage.loadGraph();
        let summaries = 0;

        for (const entity of graph.entities) {
          // Only enrich entities with >= 3 observations that lack a summary.
          const hasSummary = entity.observations.some((o) =>
            o.startsWith('[summary]')
          );
          if (!hasSummary && entity.observations.length >= 3) {
            const keywords = this.normalizer.extractKeywords(
              entity.observations.join(' ')
            );
            if (keywords.length > 0) {
              const summary = `[summary] Key topics: ${keywords.slice(0, 5).join(', ')}.`;
              await this.storage.updateEntity(entity.name, {
                observations: [...entity.observations, summary],
              });
              summaries++;
            }
          }
        }

        return { summaries };
      }
    );
    summariesAdded = p6.metrics['summaries'] ?? 0;
    phases.push(p6);

    // ---- Phase 7: Pattern Promotion ----
    const p7 = await runPhase(
      'patternPromotion',
      this.config.phases.patternPromotion,
      async () => {
        const graph = await this.storage.loadGraph();
        const allObservations: string[] = graph.entities.flatMap(
          (e) => e.observations
        );

        const patterns = this.patternDetector.detectPatterns(
          allObservations,
          this.config.minPatternOccurrences
        );

        let promoted = 0;
        for (const pattern of patterns) {
          // Promote high-confidence patterns as semantic observation entities.
          if (pattern.confidence >= 0.6) {
            const entityName = `pattern:${promoted}:${Date.now()}`;
            const patternEntity: Entity = {
              name: entityName,
              entityType: 'semantic_pattern',
              observations: [
                `Pattern: ${pattern.pattern}`,
                `Occurrences: ${pattern.occurrences}`,
                `Confidence: ${pattern.confidence.toFixed(2)}`,
                `Variables: ${pattern.variables.join(', ')}`,
              ],
              tags: ['dream:promoted', 'semantic_pattern'],
              createdAt: new Date().toISOString(),
            };
            await this.storage.appendEntity(patternEntity);
            promoted++;
          }
        }

        return { patternsDetected: patterns.length, promoted };
      }
    );
    patternsPromoted = p7.metrics['promoted'] ?? 0;
    phases.push(p7);

    // ---- Phase 8: Graph Hygiene ----
    const p8 = await runPhase(
      'graphHygiene',
      this.config.phases.graphHygiene,
      async () => {
        const graph = await this.storage.loadGraph();
        const entityNames = new Set(graph.entities.map((e) => e.name));
        const dangling: Relation[] = [];

        for (const relation of graph.relations) {
          if (!entityNames.has(relation.from) || !entityNames.has(relation.to)) {
            dangling.push(relation);
          }
        }

        if (dangling.length > 0) {
          // Re-save graph without dangling relations using a mutable copy.
          const mutable = await this.storage.getGraphForMutation();
          mutable.relations = mutable.relations.filter(
            (r) => entityNames.has(r.from) && entityNames.has(r.to)
          );
          await this.storage.saveGraph(mutable);
        }

        return { danglingRelations: dangling.length };
      }
    );
    relationsRemoved = p8.metrics['danglingRelations'] ?? 0;
    phases.push(p8);

    // ==================== Build Result ====================

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    const result: DreamCycleResult = {
      cycleId,
      startedAt,
      completedAt,
      durationMs,
      timedOut,
      phases,
      observationsAnchored,
      entitiesExpired,
      observationsPruned,
      memoriesConsolidated,
      entitiesDeduplicated,
      summariesAdded,
      patternsPromoted,
      relationsRemoved,
    };

    this.emit('dream:cycle:complete', result);
    this.config.callbacks.onCycleComplete?.(result);

    return result;
  }
}
