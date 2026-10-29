/**
 * Failure Memory Manager (Phase 2 Sprint 4)
 *
 * Structured failure memory per the Agentic Memory Library Type 9
 * catalog. Pre-task `lookupForTask()` is the headline retrieval mode —
 * before any non-trivial plan execution, semantic-search failures for
 * `applicability_hint` matches to surface "we tried this before, here's
 * what failed."
 *
 * Composes with `FailureDistillation`: when distillation produces a
 * structured causal-chain `DistilledLesson`, the caller wraps it with
 * `failureManager.record()` to make it queryable. `sourceSessionId`
 * preserves provenance.
 *
 * Design decisions (pre-implementation type-design review):
 * - **Discriminated `FailureLifecycle`** — illegal states unrepresentable
 * - **No `embedding` field** — embeddings live in downstream vector store
 * - **`sourceSessionId` optional** — present for distillation-produced
 *   records, absent for manual `record()` calls
 * - **Tags via inherited `AgentEntity.tags`** — no duplication
 * - **Non-empty validation** on required fields at `record()` time
 *
 * @module agent/FailureManager
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  FailureEntity,
  FailureLifecycle,
  FailureRecord,
  MarkResolvedResult,
} from '../types/agent-memory.js';
import {
  BLAMED_COMPONENT_KINDS,
  isFailureMemory,
  isHeuristicMemory,
  toIsoDateTime,
} from '../types/agent-memory.js';
import type { BlamedComponent, BlamedComponentKind } from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import { versionedWriteFailure } from './versionedWriteFailure.js';
import { loadProjectedRecords, matchesDefined } from './recordQuery.js';
import { validateNonEmpty } from '../utils/index.js';
import {
  PROCEDURE_ENTITY_TYPE,
  PROCEDURE_STEP_ENTITY_TYPE,
} from './procedural/ProcedureStore.js';
import type { PGSnapshot } from '../types/proceduralGraph.js';

/** Configuration for `FailureManager`. */
export interface FailureManagerConfig {
  /** Default limit for `lookupForTask` results. Default: 5. */
  defaultLookupLimit?: number;
  /**
   * Required only when a record blames a `plan-node`.
   * Return every plan id whose tree contains the node id.
   */
  findPlanNodeOwners?: (nodeId: string) => Promise<readonly string[]>;
}

/** Input shape for `record()` — id / timestamp / lifecycle are manager-managed. */
export type FailureInput = Omit<FailureRecord, 'id' | 'timestamp' | 'lifecycle'>;

/** Optional per-record metadata (entity-level fields not on FailureRecord itself). */
export interface FailureEntityOptions {
  /** Tags applied to the persisted entity (inherited `AgentEntity.tags`). */
  tags?: string[];
  /** Importance 0-10. Default 7 (failures are high-importance by default). */
  importance?: number;
  /** Agent that recorded this failure. */
  agentId?: string;
  /**
   * Required when `blamedComponent.kind` is `pg-node`.
   * `record` checks `snapshot.nodes` and does not store the snapshot.
   */
  pgSnapshot?: PGSnapshot;
}

/** Options for `lookupForTask`. */
export interface LookupOptions {
  /** Maximum records to return. Default: see `defaultLookupLimit` (5). */
  limit?: number;
  /** Filter by lifecycle status. Default: `'open'`. `'all'` returns both. */
  status?: 'open' | 'resolved' | 'all';
}

/** Options for `getAll`. */
export interface GetAllOptions {
  status?: 'open' | 'resolved';
  sourceSessionId?: string;
}

/**
 * Manages structured failure-memory records.
 *
 * @example
 * ```typescript
 * const fm = ctx.failureManager;
 *
 * // Record a failure
 * await fm.record({
 *   context: 'Building auth module',
 *   attempted: 'bcrypt.hash with default salt rounds',
 *   failure_mode: 'Login attempts timed out under load',
 *   root_cause: 'Default 10 salt rounds exceeded request budget',
 *   alternative_taken: 'Reduced to 8 rounds + queued hashing',
 *   applicability_hint: 'Setting up password hashing for auth flows',
 * });
 *
 * // Pre-task lookup before similar work
 * const lessons = await fm.lookupForTask('password hashing in auth');
 * for (const lesson of lessons) {
 *   console.log(`Previously: ${lesson.failure_mode} → ${lesson.alternative_taken}`);
 * }
 *
 * // Mark resolved when the root cause is fixed
 * await fm.markResolved(failure.id, 'upgraded to argon2id');
 * ```
 */
export class FailureManager {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly defaultLookupLimit: number;
  private readonly findPlanNodeOwners?: (nodeId: string) => Promise<readonly string[]>;

  constructor(
    storage: IGraphStorage,
    entityManager: EntityManager,
    config: FailureManagerConfig = {},
  ) {
    this.storage = storage;
    this.entityManager = entityManager;
    this.defaultLookupLimit = config.defaultLookupLimit ?? 5;
    this.findPlanNodeOwners = config.findPlanNodeOwners;
  }

  // ==================== Create ====================

  /**
   * Record a new failure. Validates non-empty strings on required
   * fields and wraps persistence errors with the failure id so a
   * lost record is attributable on Windows/Dropbox EPERM races
   * (see CLAUDE.md > Gotchas > Windows atomic writes).
   *
   * @throws {Error} if any of `context`, `attempted`, `failure_mode`,
   *   `root_cause`, or `applicability_hint` is empty / whitespace /
   *   non-string.
   * @throws {Error} wrapping the underlying storage error if
   *   `appendEntity` fails (disk full, EPERM, etc.)
   */
  async record(input: FailureInput, options: FailureEntityOptions = {}): Promise<FailureRecord> {
    validateNonEmpty(input.context, 'context', 'FailureManager');
    validateNonEmpty(input.attempted, 'attempted', 'FailureManager');
    validateNonEmpty(input.failure_mode, 'failure_mode', 'FailureManager');
    validateNonEmpty(input.root_cause, 'root_cause', 'FailureManager');
    validateNonEmpty(input.applicability_hint, 'applicability_hint', 'FailureManager');

    const blamedComponent = await this.resolveBlamedComponent(
      input.blamedComponent,
      options,
    );

    const now = new Date();
    const nowIso = toIsoDateTime(now);
    const id = `failure-${randomUUID()}`;
    const failureRecord: FailureRecord = {
      id,
      timestamp: nowIso,
      context: input.context,
      attempted: input.attempted,
      failure_mode: input.failure_mode,
      root_cause: input.root_cause,
      alternative_taken: input.alternative_taken,
      applicability_hint: input.applicability_hint,
      lifecycle: { status: 'open' },
      sourceSessionId: input.sourceSessionId,
      ...(blamedComponent !== undefined ? { blamedComponent } : {}),
    };

    const entity: FailureEntity = {
      name: id,
      entityType: 'failure',
      // observations[] duplicates failureRecord fields intentionally so
      // raw-substring searches over Entity.observations (e.g. BM25,
      // SearchManager.basicSearch) surface failures alongside other
      // entities. Don't dedupe — the duplication is the feature.
      observations: [
        `[failure] ${input.context}: ${input.failure_mode}`,
        `[root_cause] ${input.root_cause}`,
        `[applicability] ${input.applicability_hint}`,
      ],
      createdAt: nowIso,
      lastModified: nowIso,
      importance: options.importance ?? 7,
      memoryType: 'failure',
      tags: options.tags,
      agentId: options.agentId,
      visibility: 'private',
      accessCount: 0,
      confidence: 0.9,
      confirmationCount: 0,
      failureRecord,
    };

    try {
      await this.storage.appendEntity(entity as unknown as Entity);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`FailureManager.record: failed to persist failure '${id}': ${cause}`);
    }
    return failureRecord;
  }

  // ==================== Read ====================

  /**
   * Look up failures relevant to a task description. Substring-match
   * MVP — scans `applicability_hint` (3× weight), `context` (2×), and
   * `attempted` (1×) for any whitespace-separated query token.
   *
   * **Known MVP cliffs** (acceptable for v1, integrate
   * `SearchManager.semanticSearch` when `MEMORY_EMBEDDING_PROVIDER !==
   * 'none'`):
   * - Single-character tokens are dropped — querying for a 1-letter
   *   identifier (e.g., `"C"` for the language) silently returns `[]`.
   * - No stemming or synonym expansion — `"hashing"` does not match
   *   a record about `"hash"`.
   *
   * Returns at most `options.limit` records (or `defaultLookupLimit`),
   * sorted by descending score.
   */
  async lookupForTask(taskContext: string, options: LookupOptions = {}): Promise<FailureRecord[]> {
    const limit = options.limit ?? this.defaultLookupLimit;
    const statusFilter = options.status ?? 'open';

    const all = await this.loadAllFailureRecords();
    const filtered =
      statusFilter === 'all' ? all : all.filter((rec) => rec.lifecycle.status === statusFilter);

    const tokens = taskContext
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (tokens.length === 0) return [];

    const scored = filtered
      .map((rec) => ({ rec, score: scoreMatch(rec, tokens) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map((s) => s.rec);
  }

  /**
   * Failures whose `blamedComponent.id` equals `id`.
   * Records that omit the field are absent.
   * `options.status` matches `lookupForTask` (default `'open'`, or `'resolved'`, or `'all'`).
   * `options.limit` caps the result. Omit it and the method returns every match.
   * It does not use `defaultLookupLimit`.
   * Match is on the id string only. Kind is ignored.
   * Order is the order `loadAllFailureRecords` already returns.
   */
  async lookupByComponent(id: string, options: LookupOptions = {}): Promise<FailureRecord[]> {
    if (typeof id !== 'string' || id.length === 0) return [];

    const statusFilter = options.status ?? 'open';
    const all = await this.loadAllFailureRecords();
    let matched = all.filter(
      (rec) => rec.blamedComponent !== undefined && rec.blamedComponent.id === id,
    );
    if (statusFilter !== 'all') {
      matched = matched.filter((rec) => rec.lifecycle.status === statusFilter);
    }
    if (options.limit !== undefined) {
      matched = matched.slice(0, options.limit);
    }
    return matched;
  }

  // ==================== Lifecycle ====================

  /**
   * Mark a failure as resolved. Returns a discriminated
   * `MarkResolvedResult` so callers can distinguish:
   * - `'resolved'`           — transitioned from open to resolved
   * - `'already-resolved'`   — was already resolved (idempotent)
   * - `'not-found'`          — unknown id / non-failure entity
   * - `'vanished-mid-update'`— entity disappeared between read and
   *                            write (concurrent delete / governance
   *                            rollback / segment-mode flush)
   * - `'conflict'`           — another writer mutated the entity
   *                            between our read and our write (OCC
   *                            via `EntityManager.updateEntity`'s
   *                            `expectedVersion`). Caller should
   *                            re-read and retry if their reason is
   *                            still relevant.
   */
  async markResolved(id: string, reason?: string): Promise<MarkResolvedResult> {
    const entity = this.storage.getEntityByName(id);
    if (!entity || !isFailureMemory(entity)) return 'not-found';
    if (entity.failureRecord.lifecycle.status === 'resolved') return 'already-resolved';

    const now = toIsoDateTime(new Date());
    const newLifecycle: FailureLifecycle = reason
      ? { status: 'resolved', resolvedAt: now, resolvedReason: reason }
      : { status: 'resolved', resolvedAt: now };
    const updatedRecord: FailureRecord = {
      ...entity.failureRecord,
      lifecycle: newLifecycle,
    };
    try {
      await this.entityManager.updateEntity(
        id,
        {
          failureRecord: updatedRecord,
          lastModified: now,
        } as unknown as Partial<Entity>,
        { expectedVersion: entity.version ?? 1 },
      );
      return 'resolved';
    } catch (err) {
      return versionedWriteFailure(err);
    }
  }

  // ==================== Get-all ====================

  /** Get all failures, optionally filtered. */
  async getAll(options: GetAllOptions = {}): Promise<FailureRecord[]> {
    const all = await this.loadAllFailureRecords();
    return all.filter((rec) =>
      matchesDefined([
        [options.status, rec.lifecycle.status],
        [options.sourceSessionId, rec.sourceSessionId],
      ]),
    );
  }

  // ==================== Internal ====================

  private async loadAllFailureRecords(): Promise<FailureRecord[]> {
    return loadProjectedRecords(this.storage, isFailureMemory, (e) => e.failureRecord);
  }

  private async resolveBlamedComponent(
    raw: FailureInput['blamedComponent'],
    options: FailureEntityOptions,
  ): Promise<BlamedComponent | undefined> {
    if (raw === undefined) return undefined;

    if (Array.isArray(raw) || raw === null || typeof raw !== 'object') {
      throw new Error('FailureManager.record: blamedComponent must be a plain object');
    }

    const kind = (raw as { kind?: unknown }).kind;
    const id = (raw as { id?: unknown }).id;

    if (typeof kind !== 'string' || !(BLAMED_COMPONENT_KINDS as readonly string[]).includes(kind)) {
      throw new Error('FailureManager.record: blamedComponent kind is invalid');
    }
    const blamedKind = kind as BlamedComponentKind;

    if (typeof id !== 'string') {
      throw new Error('FailureManager.record: blamedComponent.id must be a non-empty string');
    }
    validateNonEmpty(id, 'blamedComponent.id', 'FailureManager');
    const componentId = id;

    await this.assertBlamedComponentExists(blamedKind, componentId, options);

    return { kind: blamedKind, id: componentId };
  }

  private async assertBlamedComponentExists(
    kind: BlamedComponentKind,
    id: string,
    options: FailureEntityOptions,
  ): Promise<void> {
    switch (kind) {
      case 'entity': {
        if (this.storage.getEntityByName(id) === undefined) {
          throw new Error(`FailureManager.record: unknown blamedComponent id '${id}' for kind '${kind}'`);
        }
        return;
      }
      case 'heuristic': {
        const entity = this.storage.getEntityByName(id);
        if (entity === undefined || !isHeuristicMemory(entity)) {
          throw new Error(`FailureManager.record: unknown blamedComponent id '${id}' for kind '${kind}'`);
        }
        return;
      }
      case 'procedure': {
        const entity = this.storage.getEntityByName(id);
        if (
          entity === undefined ||
          (entity.entityType !== PROCEDURE_ENTITY_TYPE &&
            entity.entityType !== PROCEDURE_STEP_ENTITY_TYPE)
        ) {
          throw new Error(`FailureManager.record: unknown blamedComponent id '${id}' for kind '${kind}'`);
        }
        return;
      }
      case 'plan-node': {
        if (this.findPlanNodeOwners === undefined) {
          throw new Error(
            'FailureManager.record: plan-node blame requires findPlanNodeOwners on FailureManager config',
          );
        }
        const owners = await this.findPlanNodeOwners(id);
        if (owners.length === 0) {
          throw new Error(`FailureManager.record: unknown blamedComponent id '${id}' for kind '${kind}'`);
        }
        if (owners.length >= 2) {
          throw new Error(`FailureManager.record: plan-node id '${id}' is owned by multiple plans`);
        }
        return;
      }
      case 'pg-node': {
        const snapshot = options.pgSnapshot;
        if (snapshot === undefined) {
          throw new Error('FailureManager.record: pg-node blame requires pgSnapshot in options');
        }
        const hits = snapshot.nodes.filter((n) => n.id === id);
        if (hits.length !== 1) {
          throw new Error(`FailureManager.record: unknown blamedComponent id '${id}' for kind '${kind}'`);
        }
        return;
      }
      default: {
        throw new Error('FailureManager.record: blamedComponent kind is invalid');
      }
    }
  }
}

// ==================== Helpers ====================

/**
 * Score a failure record against a list of lowercased query tokens.
 * Substring-match across applicability_hint (3x weight), context (2x),
 * and attempted (1x). Future-replaceable with embedding similarity.
 */
function scoreMatch(rec: FailureRecord, tokens: string[]): number {
  const hint = rec.applicability_hint.toLowerCase();
  const ctx = rec.context.toLowerCase();
  const att = rec.attempted.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hint.includes(t)) score += 3;
    if (ctx.includes(t)) score += 2;
    if (att.includes(t)) score += 1;
  }
  return score;
}
