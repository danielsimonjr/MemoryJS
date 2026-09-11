/**
 * Frozen-revision guidance session: ordered action/observation trace
 * plus locate → serialize → generate orchestration (feature plan 8).
 *
 * The pinned graph is a deep-frozen {@link ProceduralGraph} copy.
 * `recordStep` never mutates the graph (PG-05).
 *
 * @module agent/procedural/graph/ProceduralGraphSession
 * @experimental
 */

import { randomUUID } from 'node:crypto';
import type { PGCompletionProvider } from './CompletionProvider.js';
import type { ProceduralGraph } from './ProceduralGraph.js';
import { generateGuidance } from './ProceduralGuidance.js';
import type { PGSerializerStyle } from './ProceduralGraphSerializer.js';
import type {
  PGGuidanceMode,
  PGGuidanceResult,
  PGLocalization,
  PGTraceStep,
  PGTrajectory,
} from '../../../types/proceduralGraph.js';

/**
 * Session options (feature plan 4.8).
 *
 * `maxObservationChars` (default 8000) is the one permitted addition to
 * Section 4.8: per-step observation budget (feature plan 8.6). Oversized
 * observations are truncated at `recordStep` with a visible marker, never
 * silently dropped.
 */
export interface PGSessionOptions {
  taskDescription: string;
  toolCatalog: readonly string[];
  hopLimit?: number /*2*/;
  trajectoryWindow?: number /*3*/;
  guidanceMode?: PGGuidanceMode /*'generative'*/;
  serializerStyle?: PGSerializerStyle /*'paper-compatible' when paperCompatible else 'memoryjs'*/;
  paperCompatible?: boolean;
  provider?: PGCompletionProvider;
  degradeToAttributesOnError?: boolean /*false*/;
  maxContextBytes?: number /*60000*/;
  maxGuidanceCalls?: number /*500*/;
  timeoutMs?: number /*60000*/;
  maxOutputChars?: number /*20000*/;
  maxObservationChars?: number /*8000*/;
}

interface ResolvedSessionOptions {
  taskDescription: string;
  toolCatalog: readonly string[];
  hopLimit: number;
  trajectoryWindow: number;
  guidanceMode: PGGuidanceMode;
  serializerStyle: PGSerializerStyle;
  paperCompatible: boolean;
  provider: PGCompletionProvider | undefined;
  degradeToAttributesOnError: boolean;
  maxContextBytes: number;
  maxGuidanceCalls: number;
  timeoutMs: number;
  maxOutputChars: number;
  maxObservationChars: number;
}

export class ProceduralGraphSession {
  readonly sessionId: string;
  readonly graph: ProceduralGraph;
  readonly revisionId: string;
  readonly graphDigest: string;

  private readonly opts: ResolvedSessionOptions;
  private readonly steps: PGTraceStep[] = [];
  private guidanceCalls = 0;

  constructor(graph: ProceduralGraph, options: PGSessionOptions, ids?: { sessionId?: string }) {
    // `ProceduralGraph` instances are immutable (deep-frozen at construction),
    // so pinning is a reference, not another clone + digest. A caller who
    // mutates the original PGSnapshot after `fromSnapshot` cannot reach this
    // graph either (PG-05).
    this.graph = graph;
    this.sessionId = ids?.sessionId ?? randomUUID();
    this.revisionId = this.graph.snapshot.revisionId;
    this.graphDigest = this.graph.digest;
    this.opts = resolveSessionOptions(options);
  }

  /** Appends a host-recorded step. Never mutates the pinned graph. */
  recordStep(step: PGTraceStep): void {
    this.steps.push({
      action: step.action,
      ...(step.nodeId !== undefined ? { nodeId: step.nodeId } : {}),
      ...(step.observation !== undefined
        ? { observation: truncateObservation(step.observation, this.opts.maxObservationChars) }
        : {}),
      ...(step.at !== undefined ? { at: step.at } : {}),
    });
  }

  get trace(): readonly PGTraceStep[] {
    return this.steps.slice();
  }

  async guidance(query: string): Promise<PGGuidanceResult> {
    this.guidanceCalls += 1;
    if (this.guidanceCalls > this.opts.maxGuidanceCalls) {
      return {
        status: 'provider-error',
        error: `maxGuidanceCalls budget exhausted (${this.opts.maxGuidanceCalls})`,
        localization: this.localizationFor(this.lastAction()),
      };
    }

    return generateGuidance({
      graph: this.graph,
      lastAction: this.lastAction(),
      query,
      recentSteps: this.steps,
      options: {
        taskDescription: this.opts.taskDescription,
        hopLimit: this.opts.hopLimit,
        trajectoryWindow: this.opts.trajectoryWindow,
        guidanceMode: this.opts.guidanceMode,
        serializerStyle: this.opts.serializerStyle,
        maxContextBytes: this.opts.maxContextBytes,
        timeoutMs: this.opts.timeoutMs,
        maxOutputChars: this.opts.maxOutputChars,
        paperCompatible: this.opts.paperCompatible,
        provider: this.opts.provider,
        degradeToAttributesOnError: this.opts.degradeToAttributesOnError,
      },
    });
  }

  toTrajectory(taskId: string, score: number): PGTrajectory {
    return {
      taskId,
      revisionId: this.revisionId,
      steps: this.steps.slice(),
      score,
    };
  }

  private lastAction(): string | undefined {
    const last = this.steps[this.steps.length - 1];
    return last?.action;
  }

  private localizationFor(lastAction: string | undefined): PGLocalization {
    const loc = this.graph.locate(lastAction, {
      allowActionBinding: !this.opts.paperCompatible,
    });
    if (loc.matched && loc.nodeId !== undefined) {
      return {
        ...loc,
        hops: this.graph.neighborhood(loc.nodeId, this.opts.hopLimit),
        usedFullGraph: false,
      };
    }
    return { ...loc, usedFullGraph: true };
  }
}

function resolveSessionOptions(options: PGSessionOptions): ResolvedSessionOptions {
  const paperCompatible = options.paperCompatible ?? false;
  return {
    taskDescription: options.taskDescription,
    toolCatalog: options.toolCatalog,
    hopLimit: options.hopLimit ?? 2,
    trajectoryWindow: options.trajectoryWindow ?? 3,
    guidanceMode: options.guidanceMode ?? 'generative',
    serializerStyle: options.serializerStyle ?? (paperCompatible ? 'paper-compatible' : 'memoryjs'),
    paperCompatible,
    provider: options.provider,
    degradeToAttributesOnError: options.degradeToAttributesOnError ?? false,
    maxContextBytes: options.maxContextBytes ?? 60_000,
    maxGuidanceCalls: options.maxGuidanceCalls ?? 500,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputChars: options.maxOutputChars ?? 20_000,
    maxObservationChars: options.maxObservationChars ?? 8_000,
  };
}

/** Visible marker so per-step observation truncation is never silent. */
const OBSERVATION_TRUNCATION_MARKER = '…[truncated]';

function truncateObservation(observation: string, maxChars: number): string {
  if (observation.length <= maxChars) {
    return observation;
  }
  const marker = OBSERVATION_TRUNCATION_MARKER;
  if (maxChars <= marker.length) {
    return marker;
  }
  return observation.slice(0, maxChars - marker.length) + marker;
}
