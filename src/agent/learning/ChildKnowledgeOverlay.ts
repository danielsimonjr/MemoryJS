/**
 * Isolated knowledge overlay for one child learner (Recursa RS-21).
 *
 * A child learner must never write to live `K`: its revisions are merged by the parent and
 * validated before anything is applied. The overlay gives the child a `KnowledgeRepository`-shaped
 * view over the round base: a {@link ScratchKnowledge} built from the base plus the child's own
 * applied revisions. Every applied revision is persisted on the child trace as numbered
 * `[child-revisions i/n]` observations, so a reopened run rebuilds the same overlay.
 *
 * The overlay implements only the methods the leaf and recursive learners call. Cast it with
 * {@link ChildKnowledgeOverlay.asRepository} to pass it where a repository is expected.
 *
 * @module agent/learning/ChildKnowledgeOverlay
 * @experimental Spec RS-21. Internal to the recursive learner.
 */

import type { Entity, IGraphStorage } from '../../types/types.js';
import type { KnowledgeRevisionRecord } from '../../types/skills.js';
import { isLearningTraceEntity } from '../../types/agent-memory.js';
import type { EntityManager } from '../../core/EntityManager.js';
import { VersionConflictError } from '../../utils/errors.js';
import type { KnowledgeRepository, ApplyResult, LoadForContextOptions, LoadedKnowledge } from '../knowledge/KnowledgeRepository.js';
import type { ScratchKnowledge } from '../knowledge/ScratchKnowledge.js';
import { decodeChunks, encodeChunks, isTagged } from './observationChunks.js';

/** Tag of the child-revision observations (`[child-revisions i/n] <chunk>`). */
export const CHILD_REVISIONS_TAG = '[child-revisions';

/** The part of a repository an overlay sits on. Both `KnowledgeRepository` and an overlay satisfy it. */
export interface OverlayBase {
  /** Scratch copy of the base knowledge. */
  cloneForValidation(): Promise<ScratchKnowledge>;
  /** Digest of the base knowledge. */
  liveDigest(): Promise<string>;
}

/**
 * Knowledge view of one child learner: base knowledge plus the child's own revisions.
 *
 * @example
 * ```ts
 * const overlay = await ChildKnowledgeOverlay.open(repository, storage, entityManager);
 * const leaf = new LeafLearner({ repository: overlay.asRepository(), traces, diagnoser, editor });
 * ```
 */
export class ChildKnowledgeOverlay {
  private scratch: ScratchKnowledge | undefined;
  private traceId: string | undefined;

  /**
   * Create the instance.
   *
   * @param base - Repository the overlay sits on.
   * @param storage - Storage holding the child trace (for persisted revisions).
   * @param entityManager - Write path for the child trace entity.
   * @param applied - Revisions this child applied, in order.
   * @param traceId - Child trace id, when already known.
   */
  private constructor(
    private readonly base: OverlayBase,
    private readonly storage: IGraphStorage,
    private readonly entityManager: EntityManager,
    private applied: KnowledgeRevisionRecord[],
    traceId: string | undefined,
  ) {
    this.traceId = traceId;
  }

  /**
   * Open an overlay. With a `traceId`, the child's persisted revisions are re-applied on top of the base.
   *
   * @param base - Repository or overlay the child sits on.
   * @param storage - Storage holding the child trace.
   * @param entityManager - Write path for the child trace.
   * @param traceId - Child trace id; omit before the child exists and call {@link bind} after it is created.
   * @returns The overlay.
   * @throws Error when a persisted revision no longer applies to the base.
   */
  static async open(
    base: OverlayBase,
    storage: IGraphStorage,
    entityManager: EntityManager,
    traceId?: string,
  ): Promise<ChildKnowledgeOverlay> {
    const applied = traceId === undefined ? [] : await readChildRevisions(storage, traceId);
    const overlay = new ChildKnowledgeOverlay(base, storage, entityManager, applied, traceId);
    overlay.scratch = await overlay.build();
    return overlay;
  }

  /**
   * Attach the overlay to its child trace id, so applied revisions are persisted there.
   *
   * @param traceId - Child trace id.
   * @throws Error when the overlay is already bound to another trace.
   */
  bind(traceId: string): void {
    if (this.traceId !== undefined && this.traceId !== traceId) {
      throw new Error(`ChildKnowledgeOverlay: already bound to ${this.traceId}`);
    }
    this.traceId = traceId;
  }

  /**
   * Revisions this child applied, in order.
   *
   * @returns Copy of the list.
   */
  revisions(): KnowledgeRevisionRecord[] {
    return [...this.applied];
  }

  /**
   * The overlay typed as the repository the learners expect.
   *
   * @returns This overlay, cast to `KnowledgeRepository`.
   */
  asRepository(): KnowledgeRepository {
    return this as unknown as KnowledgeRepository;
  }

  /**
   * Snapshot id of the overlay state (no storage write).
   *
   * @returns `{ id }` where the id counts applied revisions.
   */
  async snapshot(_label?: string): Promise<{ id: string }> {
    return { id: `overlay-${this.applied.length}` };
  }

  /**
   * Overlays never carry revisions from storage, so there is never a prior application to report.
   *
   * @returns Always `undefined`.
   */
  async snapshotForRevision(_revisionId: string): Promise<undefined> {
    return undefined;
  }

  /**
   * Apply a revision to the overlay and persist it on the child trace. The `expectedSnapshotId`
   * is ignored: the overlay is private to one child, so there is no concurrent writer to conflict with.
   *
   * @param revision - Revision to apply.
   * @returns `applied`, or `rejected` when an op does not apply (the overlay is left unchanged).
   * @throws Error when the overlay is not bound to a trace yet.
   */
  async applyRevision(revision: KnowledgeRevisionRecord, _options?: { expectedSnapshotId: string }): Promise<ApplyResult> {
    if (this.traceId === undefined) throw new Error('ChildKnowledgeOverlay: bind() before applying a revision');
    const scratch = this.scratch ?? (this.scratch = await this.build());
    const result = scratch.apply(revision.ops);
    if (!result.ok) {
      this.scratch = undefined;
      return { status: 'rejected', failedOpIndex: result.failedOpIndex, reason: result.reason };
    }
    this.applied = [...this.applied, revision];
    try {
      await writeChildRevisions(this.storage, this.entityManager, this.traceId, this.applied);
    } catch (err) {
      this.applied = this.applied.slice(0, -1);
      this.scratch = undefined;
      throw err;
    }
    return { status: 'applied', snapshotId: `overlay-${this.applied.length}` };
  }

  /**
   * Scratch copy of the overlay state, for validation.
   *
   * @returns A new scratch with the base and every applied revision.
   */
  async cloneForValidation(): Promise<ScratchKnowledge> {
    return this.build();
  }

  /**
   * Knowledge rendered from the overlay state.
   *
   * @param options - Role, task hint and budget.
   * @returns The loaded knowledge.
   */
  async loadForContext(options: LoadForContextOptions): Promise<LoadedKnowledge> {
    const scratch = this.scratch ?? (this.scratch = await this.build());
    return scratch.loadForContext(options);
  }

  /**
   * Skills of the overlay state learned for the given tasks.
   *
   * @param taskIds - Task ids.
   * @returns Skill ids, at most 50.
   */
  async skillIdsForTasks(taskIds: readonly string[]): Promise<string[]> {
    const scratch = this.scratch ?? (this.scratch = await this.build());
    return scratch.skillIdsForTasks(taskIds);
  }

  /**
   * Digest of the overlay state: the base digest plus the number of applied revisions.
   *
   * @returns A string that changes whenever the overlay changes.
   */
  async liveDigest(): Promise<string> {
    return `${await this.base.liveDigest()}#${this.applied.length}`;
  }

  /**
   * Scratch built from the base plus the applied revisions.
   *
   * @returns The scratch.
   * @throws Error when a persisted revision no longer applies.
   */
  private async build(): Promise<ScratchKnowledge> {
    const scratch = await this.base.cloneForValidation();
    for (const revision of this.applied) {
      const result = scratch.apply(revision.ops);
      if (!result.ok) throw new Error(`ChildKnowledgeOverlay: revision ${revision.id} no longer applies: ${result.reason}`);
    }
    return scratch;
  }
}

/**
 * Revisions a child trace has persisted through its overlay.
 *
 * @param storage - Storage holding the trace.
 * @param traceId - Child trace id.
 * @returns The revisions in application order (empty when none were persisted).
 */
export async function readChildRevisions(storage: IGraphStorage, traceId: string): Promise<KnowledgeRevisionRecord[]> {
  await storage.ensureLoaded();
  const entity = storage.getEntityByName(traceId);
  if (!isLearningTraceEntity(entity)) throw new Error(`ChildKnowledgeOverlay: unknown trace "${traceId}"`);
  const json = decodeChunks(entity.observations, CHILD_REVISIONS_TAG);
  return json === undefined ? [] : (JSON.parse(json) as KnowledgeRevisionRecord[]);
}

/**
 * Replace the persisted revision list of a child trace (compare-and-swap on the entity version,
 * retried on conflict like `LearningTrace.writeState`).
 *
 * @param storage - Storage holding the trace.
 * @param entityManager - Write path for the trace entity.
 * @param traceId - Child trace id.
 * @param revisions - Full list to persist.
 * @throws Error when the trace does not exist.
 */
async function writeChildRevisions(
  storage: IGraphStorage,
  entityManager: EntityManager,
  traceId: string,
  revisions: readonly KnowledgeRevisionRecord[],
): Promise<void> {
  const json = JSON.stringify(revisions);
  for (;;) {
    await storage.ensureLoaded();
    const entity = storage.getEntityByName(traceId);
    if (!isLearningTraceEntity(entity)) throw new Error(`ChildKnowledgeOverlay: unknown trace "${traceId}"`);
    const version = entity.version ?? 1;
    const observations = [
      ...entity.observations.filter((o) => !isTagged(o, CHILD_REVISIONS_TAG)),
      ...encodeChunks(CHILD_REVISIONS_TAG, json),
    ];
    try {
      await entityManager.updateEntity(traceId, { observations } as Partial<Entity>, { expectedVersion: version });
      return;
    } catch (err) {
      if (!(err instanceof VersionConflictError)) throw err;
    }
  }
}
