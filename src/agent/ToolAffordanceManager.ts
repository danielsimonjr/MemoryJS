/**
 * ToolAffordanceManager — Phase Tool A (catalog Type 8).
 *
 * Tracks per-tool rolling outcome statistics (success rate, common
 * failure modes, average duration) and surfaces them for adaptive tool
 * selection via `suggestTool(taskHint)`. One record per `toolName`;
 * entity name is `tool-affordance-${toolName}`.
 *
 * Producer side: `ToolCallObserver` (Phase Tool B) is the canonical
 * caller; direct `recordOutcome()` use is supported for custom
 * pipelines.
 *
 * @module agent/ToolAffordanceManager
 */

import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  ToolAffordanceEntity,
  ToolAffordanceId,
  ToolAffordanceRecord,
  ToolCallOutcome,
} from '../types/agent-memory.js';
import { isToolAffordanceMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { VersionConflictError } from '../utils/errors.js';

const ENTITY_NAME_PREFIX = 'tool-affordance-';

function entityNameFor(toolName: string): string {
  return `${ENTITY_NAME_PREFIX}${toolName}`;
}

/** Configuration for `ToolAffordanceManager`. */
export interface ToolAffordanceManagerConfig {
  /** Cap on stored outcomes per tool. Older outcomes are dropped. Default 100. */
  rollingWindowSize?: number;
  /** Top-N failure modes surfaced on `commonFailureModes`. Default 5. */
  topFailureModes?: number;
}

/** Input shape for `recordOutcome`. Subset of `ToolCallOutcome` — timestamp is manager-managed. */
export interface RecordOutcomeInput {
  outcome: 'success' | 'failure' | 'partial';
  errorMessage?: string;
  durationMs?: number;
}

/** Flat stats shape returned by `rollingStats`. Snake-case mirrors the catalog. */
export interface ToolAffordanceStats {
  success_rate: number;
  total_calls: number;
  common_failure_modes: string[];
  avg_duration_ms?: number;
}

/** Options for `suggestTool`. */
export interface SuggestToolOptions {
  /** Maximum candidates returned. Default 5. */
  limit?: number;
  /** Minimum success-rate-based score to include. Default 0. */
  minScore?: number;
}

/** A single ranked suggestion from `suggestTool`. */
export interface ToolSuggestion {
  toolName: string;
  /** Combined score: success rate × recency factor in [0, 1]. */
  score: number;
}

export class ToolAffordanceManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly rollingWindowSize: number;
  private readonly topFailureModes: number;

  constructor(
    storage: IGraphStorage,
    entityManager: EntityManager,
    config: ToolAffordanceManagerConfig = {},
  ) {
    this.storage = storage;
    this.entityManager = entityManager;
    this.rollingWindowSize = Math.max(1, config.rollingWindowSize ?? 100);
    this.topFailureModes = Math.max(1, config.topFailureModes ?? 5);
  }

  /**
   * Record a single tool-call outcome. Creates the record on first call;
   * subsequent calls append to the rolling window (dropping oldest beyond
   * `rollingWindowSize`), recompute `successRate`, refresh
   * `commonFailureModes`, and update `avgDurationMs`. OCC-protected
   * on existing records — `VersionConflictError` re-throws to the caller.
   */
  async recordOutcome(
    toolName: string,
    input: RecordOutcomeInput,
  ): Promise<ToolAffordanceRecord> {
    if (typeof toolName !== 'string' || toolName.trim().length === 0) {
      throw new Error(
        `ToolAffordanceManager.recordOutcome: toolName must be a non-empty string`,
      );
    }
    const now = toIsoDateTime(new Date());
    const newOutcome: ToolCallOutcome = {
      outcome: input.outcome,
      errorMessage: input.errorMessage,
      durationMs: input.durationMs,
      timestamp: now,
    };
    const name = entityNameFor(toolName);
    const existing = this.storage.getEntityByName(name);

    if (!existing || !isToolAffordanceMemory(existing)) {
      const id = name as ToolAffordanceId;
      const record: ToolAffordanceRecord = {
        id,
        toolName,
        timestamp: now,
        lastUpdated: now,
        outcomes: [newOutcome],
        commonFailureModes: computeFailureModes([newOutcome], this.topFailureModes),
        avgDurationMs: averageDuration([newOutcome]),
        successRate: newOutcome.outcome === 'success' ? 1 : 0,
        totalCalls: 1,
      };
      const entity: ToolAffordanceEntity = {
        name,
        entityType: 'tool_affordance',
        observations: [`[tool_affordance] ${toolName}`],
        createdAt: now,
        lastModified: now,
        importance: 6,
        memoryType: 'tool_affordance',
        visibility: 'private',
        accessCount: 0,
        confidence: 0.7,
        confirmationCount: 0,
        toolAffordanceRecord: record,
      };
      await this.storage.appendEntity(entity as unknown as Entity);
      return record;
    }

    const cur = existing.toolAffordanceRecord;
    const nextOutcomes = [...cur.outcomes, newOutcome];
    // Cap to rolling window — drop oldest.
    if (nextOutcomes.length > this.rollingWindowSize) {
      nextOutcomes.splice(0, nextOutcomes.length - this.rollingWindowSize);
    }
    const successCount = nextOutcomes.reduce(
      (acc, o) => acc + (o.outcome === 'success' ? 1 : 0),
      0,
    );
    const merged: ToolAffordanceRecord = {
      ...cur,
      outcomes: nextOutcomes,
      commonFailureModes: computeFailureModes(nextOutcomes, this.topFailureModes),
      avgDurationMs: averageDuration(nextOutcomes),
      successRate: successCount / nextOutcomes.length,
      totalCalls: cur.totalCalls + 1,
      lastUpdated: now,
    };
    try {
      await this.entityManager.updateEntity(
        name,
        {
          toolAffordanceRecord: merged,
          lastModified: now,
        } as unknown as Partial<Entity>,
        { expectedVersion: existing.version ?? 1 },
      );
    } catch (err) {
      if (err instanceof VersionConflictError) {
        // Re-throw with a clearer message; caller retries with the
        // latest version. Auto-retry is out of scope for v1 — the
        // honest path is to let producers (ToolCallObserver) decide.
        throw new Error(
          `ToolAffordanceManager.recordOutcome: conflict on '${toolName}' — concurrent write detected (${err.message})`,
        );
      }
      throw err;
    }
    return merged;
  }

  /** Sync lookup. */
  get(toolName: string): ToolAffordanceRecord | undefined {
    const entity = this.storage.getEntityByName(entityNameFor(toolName));
    return isToolAffordanceMemory(entity) ? entity.toolAffordanceRecord : undefined;
  }

  /** Flat stats shape suitable for display / CLI / external metrics. */
  rollingStats(toolName: string): ToolAffordanceStats | undefined {
    const rec = this.get(toolName);
    if (!rec) return undefined;
    return {
      success_rate: rec.successRate,
      total_calls: rec.totalCalls,
      common_failure_modes: rec.commonFailureModes,
      avg_duration_ms: rec.avgDurationMs,
    };
  }

  /**
   * Suggest tools matching `taskHint`. v1 ranks by
   * `successRate × recencyFactor` after a substring filter on
   * `toolName`. Semantic re-rank deferred. Returns empty when no
   * tools match.
   */
  async suggestTool(
    taskHint: string,
    options: SuggestToolOptions = {},
  ): Promise<ToolSuggestion[]> {
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;
    const needle = taskHint.toLowerCase();
    const all = await this.list();
    const now = Date.now();
    const scored: ToolSuggestion[] = [];
    for (const rec of all) {
      if (!rec.toolName.toLowerCase().includes(needle)) continue;
      // Recency factor: 1.0 when last update is ≤ 1 day ago, linearly
      // decays to 0.1 over 30 days. Captures "I just used this and it
      // worked" without crashing to zero on older but still-useful tools.
      const ageMs = now - new Date(rec.lastUpdated).getTime();
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const recencyFactor = Math.max(0.1, 1.0 - (ageDays - 1) / 29);
      const score = rec.successRate * Math.min(1, recencyFactor);
      if (score < minScore) continue;
      scored.push({ toolName: rec.toolName, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Every record. */
  async list(): Promise<ToolAffordanceRecord[]> {
    const graph = await this.storage.loadGraph();
    return graph.entities.filter(isToolAffordanceMemory).map((e) => e.toolAffordanceRecord);
  }

  /** Drop the record for a tool. Returns `true` if it existed. */
  async remove(toolName: string): Promise<boolean> {
    const name = entityNameFor(toolName);
    if (!isToolAffordanceMemory(this.storage.getEntityByName(name))) return false;
    await this.entityManager.deleteEntities([name]);
    return true;
  }
}

// ==================== Helpers ====================

function computeFailureModes(outcomes: ToolCallOutcome[], topN: number): string[] {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    if ((o.outcome === 'failure' || o.outcome === 'partial') && o.errorMessage) {
      counts.set(o.errorMessage, (counts.get(o.errorMessage) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([msg]) => msg);
}

function averageDuration(outcomes: ToolCallOutcome[]): number | undefined {
  const durations = outcomes
    .map((o) => o.durationMs)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  if (durations.length === 0) return undefined;
  return durations.reduce((acc, d) => acc + d, 0) / durations.length;
}
