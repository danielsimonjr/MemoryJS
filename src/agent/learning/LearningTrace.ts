/**
 * Learning-trace manager (Recursa RS-22).
 *
 * Persists one `learning_trace` entity per learner run (name `trace-<shortId>`) and a
 * `child_of` relation from each child trace to its parent. Writes go through
 * `EntityManager` so governance and audit run. Mutations re-read the entity and use
 * `updateEntity` with `expectedVersion` OCC, retrying on conflict until the write commits.
 *
 * Actions hold `InteractionLog` addresses only, never solver output. To keep each entity
 * small, actions are capped at `maxActions` and by a serialized byte budget
 * ({@link TRACE_RECORD_BYTE_BUDGET}). A count cap alone cannot bound the size: 1,000 small
 * actions already exceed 16 KiB. When either cap is exceeded, the oldest actions are folded
 * into one `{ kind: 'merge', outcome: 'folded N actions', addrs: [] }` summary at the head.
 * `N` counts every action folded so far, including earlier folds.
 *
 * @module agent/learning/LearningTrace
 * @experimental Spec RS-22. Fold policy and byte budget may change.
 */

import type { Entity, IGraphStorage, Relation } from '../../types/types.js';
import type { EvalMetrics, LearningTraceAction, LearningTraceEntity, LearningTraceRecord } from '../../types/learning.js';
import { isLearningTraceEntity, toIsoDateTime } from '../../types/agent-memory.js';
import { EntityManager } from '../../core/EntityManager.js';
import { RelationManager } from '../../core/RelationManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { VersionConflictError } from '../../utils/errors.js';
import { shortId } from '../knowledge/knowledgeDigest.js';
import { CHILD_OF_RELATION } from '../WorkThreadManager.js';
import { decodeChunks, encodeChunks, isTagged } from './observationChunks.js';

/** Serialized-size budget for the trace record payload (the entity envelope adds about 1 KiB). */
export const TRACE_RECORD_BYTE_BUDGET = 14 * 1024;

/** Default cap on the number of stored actions per trace. */
export const DEFAULT_TRACE_MAX_ACTIONS = 1000;

/** Write and relation paths used by {@link LearningTrace}. */
export interface LearningTraceDeps {
  /** Write path (pass `ctx.entityManager` so governance hooks apply). Defaults to a plain `EntityManager`. */
  entityManager?: EntityManager;
  /** Relation path. Defaults to a plain `RelationManager` over the storage. */
  relationManager?: RelationManager;
}

/** Options for {@link LearningTrace}. */
export interface LearningTraceOptions {
  /** Maximum stored actions before folding (default {@link DEFAULT_TRACE_MAX_ACTIONS}, at least 2). */
  maxActions?: number;
}

/** A trace with its child traces, as rebuilt by {@link LearningTrace.load}. */
export interface TraceTree {
  /** Record of this trace. */
  record: LearningTraceRecord;
  /** Child traces, ordered by round then id. */
  children: TraceTree[];
}

const FOLD_OUTCOME = /^folded (\d+) actions$/;

/** Tag of the leaf-state observations (`[leaf-state i/n] <chunk>`). */
const STATE_TAG = '[leaf-state';

/** Tag of the task-record observations (`[leaf-tasks i/n] <chunk>`), written once. */
const TASKS_TAG = '[leaf-tasks';

/**
 * Serialized size in bytes of a trace record.
 *
 * @param record - Trace record.
 * @returns Byte length of its JSON form.
 */
function recordBytes(record: LearningTraceRecord): number {
  return Buffer.byteLength(JSON.stringify(record), 'utf8');
}

/**
 * Keep a record within `maxActions` and the byte budget by folding its oldest actions into
 * a single `merge` summary at the head. Returns a new record; the input is not modified.
 *
 * @param record - Record whose `actions` may be folded.
 * @param maxActions - Maximum number of stored actions (including the summary).
 * @returns An equal copy when it already fits, otherwise a copy with folded actions.
 */
export function foldTraceActions(record: LearningTraceRecord, maxActions: number): LearningTraceRecord {
  const head = record.actions[0]?.kind === 'merge' ? record.actions[0] : undefined;
  let summary: LearningTraceAction | undefined = head;
  let body = head ? record.actions.slice(1) : record.actions.slice();
  let folded = head ? parseFolded(head.outcome) : 0;
  const candidate = (): LearningTraceRecord => ({ ...record, actions: summary ? [summary, ...body] : body });
  while (body.length > 0 && (candidate().actions.length > maxActions || recordBytes(candidate()) > TRACE_RECORD_BYTE_BUDGET)) {
    const oldest = body[0] as LearningTraceAction;
    folded += 1;
    body = body.slice(1);
    summary = {
      kind: 'merge',
      startedAt: summary?.startedAt ?? oldest.startedAt,
      endedAt: oldest.endedAt,
      addrs: [],
      outcome: `folded ${folded} actions`,
    };
  }
  return candidate();
}

/**
 * Read the fold count from a merge summary's outcome text.
 *
 * @param outcome - Outcome text of a `merge` action.
 * @returns Number of actions folded so far, or 0 when the text is not a fold summary.
 */
function parseFolded(outcome: string): number {
  const match = FOLD_OUTCOME.exec(outcome);
  return match ? Number(match[1]) : 0;
}

/**
 * Persistence and tree access for learning traces (spec RS-22).
 *
 * @example
 * ```ts
 * const traces = new LearningTrace(storage, { entityManager, relationManager });
 * const rootId = await traces.create({ learnerKind: 'leaf', round: 0, subsetLabel: 'all',
 *   actions: [], revisionIds: [], metrics });
 * ```
 */
export class LearningTrace {
  private readonly storage: IGraphStorage;
  private readonly entityManager: EntityManager;
  private readonly relationManager: RelationManager;
  private readonly maxActions: number;

  /**
   * Create the instance.
   *
   * @param storage - Graph storage the traces live in.
   * @param deps - Optional write and relation paths.
   * @param options - Optional `maxActions`.
   * @throws RangeError when `maxActions` is not an integer of at least 2.
   */
  constructor(storage: IGraphStorage, deps: LearningTraceDeps = {}, options: LearningTraceOptions = {}) {
    const maxActions = options.maxActions ?? DEFAULT_TRACE_MAX_ACTIONS;
    if (!Number.isInteger(maxActions) || maxActions < 2) {
      throw new RangeError('LearningTrace: maxActions must be an integer >= 2');
    }
    this.storage = storage;
    this.entityManager = deps.entityManager ?? new EntityManager(storage as GraphStorage);
    this.relationManager = deps.relationManager ?? new RelationManager(storage as GraphStorage);
    this.maxActions = maxActions;
  }

  /**
   * Create a trace. When `parentTraceId` is given, a `child_of` relation from the new trace to
   * the parent is written after the entity. The two writes are not atomic.
   *
   * @param record - Trace fields without `id`.
   * @returns The new trace id (`trace-<shortId>`), which is also the entity name.
   * @throws Error when `parentTraceId` does not name an existing trace.
   */
  async create(record: Omit<LearningTraceRecord, 'id'>): Promise<string> {
    await this.storage.ensureLoaded();
    if (record.parentTraceId !== undefined) this.requireTrace(record.parentTraceId);
    const id = `trace-${shortId()}`;
    const full = foldTraceActions({ ...record, id }, this.maxActions);
    await this.entityManager.createEntities([buildTraceEntity(full, toIsoDateTime(new Date())) as unknown as Entity]);
    if (record.parentTraceId !== undefined) {
      await this.relationManager.createRelations([{ from: id, to: record.parentTraceId, relationType: CHILD_OF_RELATION }]);
    }
    return id;
  }

  /**
   * Append one action, folding the oldest actions when a cap is exceeded.
   *
   * @param id - Trace id.
   * @param action - Action to append (addresses only, never solver output).
   * @returns The committed record.
   * @throws Error when the trace does not exist.
   */
  async appendAction(id: string, action: LearningTraceAction): Promise<LearningTraceRecord> {
    return this.appendActions(id, [action]);
  }

  /**
   * Append several actions in one committed write (one OCC round trip instead
   * of one per action). Folding applies to the combined list exactly as if
   * the actions had been appended one at a time.
   *
   * @param id - Trace id.
   * @param actions - Actions to append, in order (addresses only, never solver output).
   * @returns The committed record.
   * @throws Error when the trace does not exist.
   */
  async appendActions(id: string, actions: readonly LearningTraceAction[]): Promise<LearningTraceRecord> {
    return this.mutate(id, (record) =>
      foldTraceActions({ ...record, actions: [...record.actions, ...actions] }, this.maxActions),
    );
  }

  /**
   * Replace the metrics of a trace.
   *
   * @param id - Trace id.
   * @param metrics - Metrics to store.
   * @returns The committed record.
   * @throws Error when the trace does not exist.
   */
  async setMetrics(id: string, metrics: EvalMetrics): Promise<LearningTraceRecord> {
    return this.mutate(id, (record) => ({ ...record, metrics }));
  }

  /**
   * Add a revision id to a trace. An id already present is not added twice.
   *
   * @param id - Trace id.
   * @param revisionId - Revision id to add.
   * @returns The committed record.
   * @throws Error when the trace does not exist.
   */
  async addRevisionId(id: string, revisionId: string): Promise<LearningTraceRecord> {
    return this.mutate(id, (record) =>
      record.revisionIds.includes(revisionId) ? record : { ...record, revisionIds: [...record.revisionIds, revisionId] },
    );
  }

  /**
   * Read one trace record.
   *
   * @param id - Trace id.
   * @returns The record, or `undefined` when no learning trace has that id.
   */
  async get(id: string): Promise<LearningTraceRecord | undefined> {
    await this.storage.ensureLoaded();
    const entity = this.storage.getEntityByName(id);
    return isLearningTraceEntity(entity) ? entity.learningTraceRecord : undefined;
  }

  /**
   * Rebuild the trace tree rooted at `traceId` from `child_of` relations. Cycle-safe: a trace
   * already on the current path is not expanded again.
   *
   * @param traceId - Root trace id.
   * @returns The tree.
   * @throws Error when the root trace does not exist.
   */
  async load(traceId: string): Promise<TraceTree> {
    await this.storage.ensureLoaded();
    this.requireTrace(traceId);
    return this.buildTree(traceId, new Set<string>());
  }

  /**
   * Render a trace tree as a Mermaid `graph TD` diagram. Node labels are
   * `<learnerKind> r<round> <subsetLabel> (allPass=…)`; quotes and newlines are escaped.
   *
   * @param tree - Tree from {@link LearningTrace.load}.
   * @returns Mermaid source text.
   */
  toMermaid(tree: TraceTree): string {
    const lines = ['graph TD'];
    let counter = 0;
    const visit = (node: TraceTree): string => {
      const id = `n${counter++}`;
      const { learnerKind, round, subsetLabel, metrics } = node.record;
      const label = `${learnerKind} r${round} ${subsetLabel} (allPass=${formatRatio(metrics.allPass)})`;
      lines.push(`  ${id}["${escapeMermaidLabel(label)}"]`);
      for (const child of node.children) {
        lines.push(`  ${id} --> ${visit(child)}`);
      }
      return id;
    };
    visit(tree);
    return lines.join('\n');
  }

  /**
   * Store the serialized leaf-learner state as numbered `[leaf-state i/n] <chunk>` observations of a
   * trace (each chunk within the 5000-character observation cap).
   * Replaces any earlier state observation. Read-modify-write with OCC, retried on conflict.
   * `check` runs against the stored state on every attempt (also after an entity-version retry),
   * so a caller can reject the write when the stored state moved (compare-and-swap).
   *
   * @param id - Trace id.
   * @param json - Serialized state (one line).
   * @param check - Optional guard; throw from it to refuse the write.
   * @throws Error when the trace does not exist, or whatever `check` throws.
   */
  async writeState(id: string, json: string, check?: (current: string | undefined) => void): Promise<void> {
    for (;;) {
      await this.storage.ensureLoaded();
      const entity = this.storage.getEntityByName(id);
      if (!isLearningTraceEntity(entity)) throw new Error(`LearningTrace: unknown trace "${id}"`);
      check?.(decodeChunks(entity.observations, STATE_TAG));
      const version = entity.version ?? 1;
      const observations = [...entity.observations.filter((o) => !isTagged(o, STATE_TAG)), ...encodeChunks(STATE_TAG, json)];
      try {
        await this.entityManager.updateEntity(id, { observations } as Partial<Entity>, { expectedVersion: version });
        return;
      } catch (err) {
        if (!(err instanceof VersionConflictError)) throw err;
      }
    }
  }

  /**
   * Read the serialized leaf-learner state stored by {@link LearningTrace.writeState}.
   *
   * @param id - Trace id.
   * @returns The JSON text, or `undefined` when the trace is unknown or has no state.
   */
  async readState(id: string): Promise<string | undefined> {
    await this.storage.ensureLoaded();
    const entity = this.storage.getEntityByName(id);
    if (!isLearningTraceEntity(entity)) return undefined;
    return decodeChunks(entity.observations, STATE_TAG);
  }

  /**
   * Store the task records of a leaf-learner run as numbered `[leaf-tasks i/n] <chunk>` observations. Written
   * once: a second call for the same trace throws, so the tasks of a run cannot change under it.
   *
   * @param id - Trace id.
   * @param json - Serialized task array (one line).
   * @throws Error when the trace does not exist or already has task records.
   */
  async writeTasks(id: string, json: string): Promise<void> {
    await this.storage.ensureLoaded();
    const entity = this.storage.getEntityByName(id);
    if (!isLearningTraceEntity(entity)) throw new Error(`LearningTrace: unknown trace "${id}"`);
    if (entity.observations.some((o) => isTagged(o, TASKS_TAG))) {
      throw new Error(`LearningTrace: trace "${id}" already has task records`);
    }
    const version = entity.version ?? 1;
    const observations = [...entity.observations, ...encodeChunks(TASKS_TAG, json)];
    await this.entityManager.updateEntity(id, { observations } as Partial<Entity>, { expectedVersion: version });
  }

  /**
   * Read the task records stored by {@link LearningTrace.writeTasks}.
   *
   * @param id - Trace id.
   * @returns The JSON text, or `undefined` when the trace is unknown or has no task records.
   */
  async readTasks(id: string): Promise<string | undefined> {
    await this.storage.ensureLoaded();
    const entity = this.storage.getEntityByName(id);
    if (!isLearningTraceEntity(entity)) return undefined;
    return decodeChunks(entity.observations, TASKS_TAG);
  }

  /**
   * Throw when `id` is not a learning trace.
   *
   * @param id - Trace id.
   * @throws Error when the trace does not exist.
   */
  private requireTrace(id: string): void {
    if (!isLearningTraceEntity(this.storage.getEntityByName(id))) {
      throw new Error(`LearningTrace: unknown trace "${id}"`);
    }
  }

  /**
   * Read-modify-write with OCC: re-read, apply `change`, `updateEntity` with the version read,
   * and retry on `VersionConflictError` until the write commits.
   *
   * @param id - Trace id.
   * @param change - Pure function from the current record to the next one.
   * @returns The committed record.
   * @throws Error when the trace does not exist.
   */
  private async mutate(
    id: string,
    change: (record: LearningTraceRecord) => LearningTraceRecord,
  ): Promise<LearningTraceRecord> {
    for (;;) {
      await this.storage.ensureLoaded();
      const entity = this.storage.getEntityByName(id);
      if (!isLearningTraceEntity(entity)) throw new Error(`LearningTrace: unknown trace "${id}"`);
      const version = entity.version ?? 1;
      const next = change(entity.learningTraceRecord);
      try {
        await this.entityManager.updateEntity(
          id,
          { learningTraceRecord: next, lastModified: toIsoDateTime(new Date()) } as unknown as Partial<Entity>,
          { expectedVersion: version },
        );
        return next;
      } catch (err) {
        if (!(err instanceof VersionConflictError)) throw err;
      }
    }
  }

  /**
   * Build the subtree under `id`.
   *
   * @param id - Trace id.
   * @param path - Ids on the path from the root to `id` (cycle guard).
   * @returns The subtree.
   */
  private buildTree(id: string, path: ReadonlySet<string>): TraceTree {
    const entity = this.storage.getEntityByName(id);
    if (!isLearningTraceEntity(entity)) throw new Error(`LearningTrace: unknown trace "${id}"`);
    const onPath = new Set(path).add(id);
    const children: TraceTree[] = [];
    for (const childId of this.childIdsOf(id)) {
      if (onPath.has(childId)) continue;
      if (!isLearningTraceEntity(this.storage.getEntityByName(childId))) continue;
      children.push(this.buildTree(childId, onPath));
    }
    children.sort(compareTrees);
    return { record: entity.learningTraceRecord, children };
  }

  /**
   * Ids of traces whose `child_of` relation points at `id`, in relation order, de-duplicated.
   *
   * @param id - Parent trace id.
   * @returns Child ids.
   */
  private childIdsOf(id: string): string[] {
    const relations: Relation[] = this.storage.getRelationsFor(id);
    const children = new Set<string>();
    for (const relation of relations) {
      if (relation.relationType === CHILD_OF_RELATION && relation.to === id) children.add(relation.from);
    }
    return [...children];
  }
}

/**
 * Build the persisted entity for a trace record.
 *
 * @param record - Trace record; its `id` is the entity name.
 * @param now - ISO timestamp for creation and last modification.
 * @returns The entity.
 */
export function buildTraceEntity(record: LearningTraceRecord, now: string): LearningTraceEntity {
  return {
    name: record.id,
    entityType: 'learning_trace',
    observations: [`[learning_trace] learner: ${record.learnerKind}; round: ${record.round}; subset: ${record.subsetLabel}`],
    createdAt: now,
    lastModified: now,
    importance: 5,
    memoryType: 'learning_trace',
    visibility: 'private',
    accessCount: 0,
    confidence: 1,
    confirmationCount: 0,
    version: 1,
    learningTraceRecord: record,
  } as LearningTraceEntity;
}

/**
 * Order trees by round, then id, for stable output.
 *
 * @param a - First tree.
 * @param b - Second tree.
 * @returns Negative, zero or positive.
 */
function compareTrees(a: TraceTree, b: TraceTree): number {
  if (a.record.round !== b.record.round) return a.record.round - b.record.round;
  return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

/**
 * Format a ratio for a label with at most three decimals.
 *
 * @param value - Ratio in [0, 1].
 * @returns Short decimal text, or `n/a` for non-finite input.
 */
function formatRatio(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : 'n/a';
}

/**
 * Escape text for a quoted Mermaid node label.
 *
 * @param text - Raw label text.
 * @returns Text safe inside `["..."]`.
 */
function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\r\n|\r|\n/g, ' ');
}
