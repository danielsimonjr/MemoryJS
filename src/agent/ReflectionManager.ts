/**
 * Reflection Memory Manager (Phase 2 Sprint 8)
 *
 * Owns the write path for `ReflectionEntity` records and the read API
 * for retrieving them. Reflections are derived memories produced by
 * `ReflectionStage` (pattern detection + trajectory compression +
 * experience extraction over a candidate set) but written through
 * this manager so the entity lifecycle and dedup pass through a
 * single surface.
 *
 * Design decisions (Sprint 8 user-locked):
 * - **Additive**: reflections do NOT supersede their evidence entities.
 *   Episodic memories remain queryable; reflections are a derived
 *   overlay.
 * - **Content-hash dedup**: `create()` computes `sha256(scope + sorted(evidence))`
 *   and returns the existing record if a match exists. Mirrors
 *   `MemoryEngine` Tier-1 dedup from v1.11.0.
 * - **Discriminated archive return** (`ArchiveReflectionResult`): branches
 *   on `storage.updateEntity`'s `Promise<boolean>` per the recurring
 *   Sprint 2/4/5/6 silent-failure pattern.
 *
 * @module agent/ReflectionManager
 */

import { createHash, randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  ReflectionEntity,
  ReflectionId,
  ReflectionRecord,
  ReflectionScope,
} from '../types/agent-memory.js';
import { isReflectionMemory, toIsoDateTime } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { VersionConflictError, EntityNotFoundError } from '../utils/errors.js';

/** Discriminated return from `archive`. Mirrors `MarkResolvedResult`. */
export type ArchiveReflectionResult =
  | 'archived'
  | 'not-found'
  | 'already-archived'
  | 'vanished-mid-update'
  | 'conflict';

export interface ReflectionManagerConfig {
  /** Maximum reflections returned by `getRelevantForSession` (default 10). */
  defaultRelevanceLimit?: number;
}

export interface ReflectionInput {
  scope: ReflectionScope;
  /** Non-empty array of entity names backing this reflection. */
  evidence: string[];
  /** Non-empty summary string. */
  summary: string;
  /** Confidence in `[0.0, 1.0]`. */
  generalization_confidence: number;
  /** Optional top-N pattern strings (≤ 5 enforced). */
  keyInsights?: string[];
  experienceType?: string;
  sourceSessionId?: string;
  sourceProjectId?: string;
}

export interface ReflectionEntityOptions {
  importance?: number;
  agentId?: string;
}

export interface ListReflectionsOptions {
  scope?: ReflectionScope;
  sourceSessionId?: string;
  sourceProjectId?: string;
  /** Minimum `generalization_confidence` (inclusive). */
  minConfidence?: number;
  /** Include archived reflections (default false). */
  includeArchived?: boolean;
  limit?: number;
}

export interface RelevanceOptions {
  /**
   * Entity names from the session whose evidence overlap should be
   * considered. When omitted, only `sourceSessionId` matches return.
   */
  sessionEntityNames?: string[];
  minConfidence?: number;
  limit?: number;
}

export class ReflectionManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly defaultRelevanceLimit: number;

  constructor(
    storage: IGraphStorage,
    entityManager: EntityManager,
    config: ReflectionManagerConfig = {},
  ) {
    this.storage = storage;
    this.entityManager = entityManager;
    this.defaultRelevanceLimit = config.defaultRelevanceLimit ?? 10;
  }

  // ==================== Create ====================

  async create(
    input: ReflectionInput,
    options: ReflectionEntityOptions = {}
  ): Promise<ReflectionRecord> {
    validateNonEmptyArray(input.evidence, 'evidence');
    validateNonEmpty(input.summary, 'summary');
    validateConfidence(input.generalization_confidence, 'generalization_confidence');

    const evidenceHash = computeEvidenceHash(input.scope, input.evidence);

    // Tier-1 dedup: scan existing reflections for a matching evidenceHash.
    const existing = await this.findByEvidenceHash(evidenceHash);
    if (existing) return existing;

    const now = new Date();
    const nowIso = toIsoDateTime(now);
    const id = mintReflectionId(now) as ReflectionId;

    const record: ReflectionRecord = {
      id,
      timestamp: nowIso,
      scope: input.scope,
      summary: input.summary,
      keyInsights: (input.keyInsights ?? []).slice(0, 5),
      evidence: [...input.evidence],
      generalization_confidence: input.generalization_confidence,
      experienceType: input.experienceType,
      sourceSessionId: input.sourceSessionId,
      sourceProjectId: input.sourceProjectId,
      evidenceHash,
    };

    const entity: ReflectionEntity = {
      name: id,
      entityType: 'reflection',
      observations: [`[reflection:${input.scope}] ${input.summary}`],
      createdAt: nowIso,
      lastModified: nowIso,
      importance: options.importance ?? 5,
      memoryType: 'reflection',
      agentId: options.agentId,
      sessionId: input.sourceSessionId,
      visibility: 'private',
      accessCount: 0,
      confidence: input.generalization_confidence,
      confirmationCount: 0,
      reflectionRecord: record,
    };

    try {
      await this.storage.appendEntity(entity as unknown as Entity);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`ReflectionManager.create: failed to persist '${id}': ${cause}`);
    }
    return record;
  }

  // ==================== Read ====================

  async list(options: ListReflectionsOptions = {}): Promise<ReflectionRecord[]> {
    const all = await this.loadAllRecords(options.includeArchived ?? false);
    const filtered = all.filter((r) => {
      if (options.scope !== undefined && r.scope !== options.scope) return false;
      if (options.sourceSessionId !== undefined && r.sourceSessionId !== options.sourceSessionId)
        return false;
      if (options.sourceProjectId !== undefined && r.sourceProjectId !== options.sourceProjectId)
        return false;
      if (
        options.minConfidence !== undefined &&
        r.generalization_confidence < options.minConfidence
      )
        return false;
      return true;
    });
    return options.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
  }

  async getAll(): Promise<ReflectionRecord[]> {
    return this.list({ includeArchived: true });
  }

  async getRelevantForSession(
    sessionId: string,
    options: RelevanceOptions = {}
  ): Promise<ReflectionRecord[]> {
    const minConfidence = options.minConfidence ?? 0;
    const limit = options.limit ?? this.defaultRelevanceLimit;
    const overlapTargets = new Set(options.sessionEntityNames ?? []);

    const all = await this.loadAllRecords(false);
    const matched = all.filter((r) => {
      if (r.generalization_confidence < minConfidence) return false;
      if (r.sourceSessionId === sessionId) return true;
      if (overlapTargets.size > 0 && r.evidence.some((e) => overlapTargets.has(e))) return true;
      return false;
    });

    matched.sort((a, b) => b.generalization_confidence - a.generalization_confidence);
    return matched.slice(0, limit);
  }

  // ==================== Lifecycle ====================

  async archive(id: ReflectionId | string): Promise<ArchiveReflectionResult> {
    const entity = this.storage.getEntityByName(id);
    if (!entity || !isReflectionMemory(entity)) return 'not-found';
    if (entity.reflectionRecord.archived === true) return 'already-archived';

    const now = toIsoDateTime(new Date());
    const updated: ReflectionRecord = {
      ...entity.reflectionRecord,
      archived: true,
      archivedAt: now,
    };
    try {
      await this.entityManager.updateEntity(
        id,
        {
          reflectionRecord: updated,
          lastModified: now,
        } as unknown as Partial<Entity>,
        { expectedVersion: entity.version ?? 1 },
      );
      return 'archived';
    } catch (err) {
      if (err instanceof VersionConflictError) return 'conflict';
      if (err instanceof EntityNotFoundError) return 'vanished-mid-update';
      throw err;
    }
  }

  // ==================== Internal ====================

  private async loadAllRecords(includeArchived: boolean): Promise<ReflectionRecord[]> {
    let graph;
    try {
      graph = await this.storage.loadGraph();
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`ReflectionManager.loadAllRecords: storage.loadGraph failed: ${cause}`);
    }
    return graph.entities
      .filter(isReflectionMemory)
      .map((e) => e.reflectionRecord)
      .filter((r) => includeArchived || r.archived !== true);
  }

  private async findByEvidenceHash(hash: string): Promise<ReflectionRecord | null> {
    const all = await this.loadAllRecords(true);
    return all.find((r) => r.evidenceHash === hash) ?? null;
  }
}

// ==================== Helpers ====================

function mintReflectionId(now: Date): string {
  return `reflection-${now.getTime()}-${randomUUID().slice(0, 8)}`;
}

function computeEvidenceHash(scope: ReflectionScope, evidence: string[]): string {
  const sorted = [...evidence].sort();
  const input = `${scope}|${sorted.join('|')}`;
  return createHash('sha256').update(input).digest('hex');
}

function validateNonEmpty(value: unknown, fieldName: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const received =
      typeof value === 'string'
        ? `string of length ${value.length} (${JSON.stringify(value.slice(0, 40))})`
        : `${typeof value} (${value === null ? 'null' : String(value).slice(0, 40)})`;
    throw new Error(`ReflectionManager: '${fieldName}' must be a non-empty string; received ${received}`);
  }
}

function validateNonEmptyArray(value: unknown, fieldName: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`ReflectionManager: '${fieldName}' must be a non-empty array`);
  }
}

function validateConfidence(value: unknown, fieldName: string): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(
      `ReflectionManager: '${fieldName}' must be a finite number in [0, 1]; received ${String(value)}`
    );
  }
}
