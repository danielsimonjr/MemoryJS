/**
 * Knowledge repository (Recursa RS-5): the paper's `K`.
 *
 * `K` is the instruction sets plus skills, with heuristics, failures and
 * reflections referenced by id. Snapshots persist the full payload and carry
 * a SHA-256 digest of its canonical JSON. Revisions are applied all-or-nothing.
 *
 * **Write path (why `BatchTransaction`).** `applyRevision` and `rollbackTo`
 * first apply their ops to an in-memory clone. Only when every op succeeds do
 * they issue one `BatchTransaction` (`storage.graphMutex`, one load, one save,
 * `stopOnError: true`). A single save is atomic across many entities, and a
 * failed batch persists nothing. The storage delta primitives
 * (`appendEntities` / `updateEntities`) were rejected because they are
 * separate storage calls, so a failure between them would leave a partial
 * revision. Writes are whole-entity replacements: the batch does not check
 * `expectedVersion`. Each write bumps `version` by one. Conflict detection
 * is the digest comparison against `expectedSnapshotId`. (`EntityManager` has no
 * all-or-nothing multi-entity write; `snapshot` uses `createEntities`.)
 *
 * Mutations (`applyRevision`, `rollbackTo`, `snapshot`) are serialised per
 * repository instance through an internal queue, so two revisions with the
 * same base cannot interleave their check and write steps.
 *
 * @module agent/knowledge/KnowledgeRepository
 * @experimental Part of the Recursa knowledge-repository work (spec RS-5).
 */

import type { Entity, IGraphStorage } from '../../types/types.js';
import type {
  InstructionSetRecord,
  InstructionSetRole,
  KnowledgeRevisionRecord,
  KnowledgeSnapshotEntity,
  KnowledgeSnapshotRecord,
  SkillId,
  SkillRecord,
} from '../../types/skills.js';
import {
  isFailureMemory,
  isHeuristicMemory,
  isInstructionSetEntity,
  isKnowledgeSnapshotEntity,
  isReflectionMemory,
  isSkillEntity,
  toIsoDateTime,
} from '../../types/agent-memory.js';
import type { FailureRecord } from '../../types/agent-memory.js';
import { BatchTransaction } from '../../core/TransactionManager.js';
import { EntityManager } from '../../core/EntityManager.js';
import type { GraphStorage } from '../../core/GraphStorage.js';
import { readEnvNumber } from '../../utils/envConfig.js';
import { estimateTokensFromText } from '../../utils/tokenEstimate.js';
import {
  instructionItemsFor,
  renderInstructionItems,
  type InstructionItem,
  type InstructionSetManager,
} from './InstructionSetManager.js';
import {
  clone,
  compareIds,
  diffSnapshots,
  digestOf,
  assertBudgetTokens,
  fitInOrder,
  type KnowledgeDiff,
} from './knowledgeDigest.js';
import { safeApplyOp, planWrites, workFrom, type PlannedWrite } from './knowledgeRevision.js';

export type { KnowledgeDiff, IdDelta } from './knowledgeDigest.js';

/** A skill retrieved for a task, as returned by `SkillManager.match`. */
export interface SkillMatchLike {
  /** Matched skill record. */
  skill: SkillRecord;
  /** Retrieval score. */
  score: number;
  /** Matched tokens. */
  matched: string[];
}

/**
 * Structural view of the RS-2 `SkillManager` API. The real class satisfies it;
 * this module calls only `match`, and the other members are declared so the
 * contract is explicit.
 */
export interface SkillManagerLike {
  /** Add a skill; returns its id (content-hash dedup). */
  add(input: Omit<SkillRecord, 'id' | 'createdAt' | 'lastUpdatedAt' | 'stats' | 'retired'>): Promise<SkillId>;
  /** Look up one skill by id. */
  get(id: SkillId | string): SkillRecord | undefined;
  /** List skills, optionally filtered. */
  list(options?: { kind?: SkillRecord['kind']; domain?: string; includeRetired?: boolean }): Promise<SkillRecord[]>;
  /** Patch a skill (OCC through `expectedVersion`). */
  update(
    id: SkillId | string,
    patch: Partial<Pick<SkillRecord, 'body' | 'description' | 'scope' | 'uncertainty' | 'sources'>>,
    options?: { expectedVersion?: number },
  ): Promise<unknown>;
  /** Retire a skill (never deleted). */
  retire(id: SkillId | string, reason: string): Promise<unknown>;
  /** Rank skills for a task hint. Retired skills are excluded. */
  match(taskHint: string, options?: { limit?: number; minScore?: number }): Promise<SkillMatchLike[]>;
  /** Record an application outcome. */
  recordOutcome(id: SkillId | string, outcome: 'applied' | 'helped' | 'hurt'): Promise<unknown>;
  /** Render skills to Markdown within a budget. */
  loadForContext(ids: readonly (SkillId | string)[], options?: { budgetTokens?: number; multiplier?: number }): Promise<string>;
}

/**
 * Structural view of `FailureManager.lookupForTask`. Failures are returned
 * newest-relevant first; the default status filter is `'open'`.
 */
export interface FailureLookupLike {
  /** Failure lessons whose applicability matches the task context. */
  lookupForTask(
    taskContext: string,
    options?: { limit?: number; status?: 'open' | 'resolved' | 'all' },
  ): Promise<FailureRecord[]>;
}

/** Dependencies of a {@link KnowledgeRepository}. */
export interface KnowledgeRepositoryOptions {
  /** Storage backend holding `K`. */
  storage: IGraphStorage;
  /** Instruction-set manager (used for `render` in `loadForContext`). */
  instructionSets: InstructionSetManager;
  /** Skill manager (RS-2). */
  skills: SkillManagerLike;
  /** Failure lookup (`FailureManager`). */
  failures: FailureLookupLike;
  /** Snapshot write path (pass `ctx.entityManager` for governance). Defaults to a plain `EntityManager`. */
  entityManager?: EntityManager;
}

/**
 * Result of {@link KnowledgeRepository.applyRevision}. Never thrown.
 * `conflict` also covers an unknown `expectedSnapshotId`.
 */
export type ApplyResult =
  | { status: 'applied'; snapshotId: string }
  | { status: 'conflict'; currentSnapshotId: string }
  | { status: 'rejected'; failedOpIndex: number; reason: string };

/** Result of {@link KnowledgeRepository.rollbackTo}. */
export type RollbackResult =
  | { status: 'restored'; snapshotId: string }
  | { status: 'not-found' }
  | { status: 'rejected'; reason: string };

/** Options for {@link KnowledgeRepository.loadForContext}. */
export interface LoadForContextOptions {
  /** Role whose instructions are rendered (`shared` sets are always included). */
  role: InstructionSetRole;
  /** Task description used for skill and failure retrieval. */
  taskHint: string;
  /** Token budget (default 4000). */
  budgetTokens?: number;
  /** Tokens per word (default 1.3). */
  multiplier?: number;
}

/** Result of {@link KnowledgeRepository.loadForContext}. */
export interface LoadedKnowledge {
  /** Markdown: instructions, then skills, then failure lessons, trimmed to the budget. */
  markdown: string;
  /** Skills included. */
  skillIds: SkillId[];
  /** Instruction sets with at least one included section. */
  instructionSetIds: string[];
  /** Failure records included. */
  failureIds: string[];
  /** Estimated tokens of `markdown`. */
  tokens: number;
}

/** Items rendered by `loadForContext`, in priority order. */
type LoadItem =
  | { kind: 'instruction'; item: InstructionItem }
  | { kind: 'skill'; match: SkillMatchLike }
  | { kind: 'failure'; failure: FailureRecord };

const DEFAULT_BUDGET_TOKENS = 4000;
const LOOKUP_LIMIT = 5;

/**
 * The Recursa knowledge repository `K`: snapshots, diffs, validated revisions,
 * rollback and budgeted context loading.
 *
 * @example
 * ```typescript
 * const repo = new KnowledgeRepository({ storage, instructionSets, skills, failures });
 * const k0 = await repo.snapshot('baseline');
 * const result = await repo.applyRevision(revision, { expectedSnapshotId: k0.id });
 * ```
 */
export class KnowledgeRepository {
  private readonly storage: IGraphStorage;
  private readonly instructionSets: InstructionSetManager;
  private readonly skills: SkillManagerLike;
  private readonly failures: FailureLookupLike;
  private readonly entityManager: EntityManager;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Create a repository over the given storage and managers.
   *
   * @param options - Storage and manager dependencies.
   */
  constructor(options: KnowledgeRepositoryOptions) {
    this.storage = options.storage;
    this.instructionSets = options.instructionSets;
    this.skills = options.skills;
    this.failures = options.failures;
    this.entityManager = options.entityManager ?? new EntityManager(options.storage as GraphStorage);
  }

  /**
   * Persist the current payload as `K-<n>` (n = number of existing snapshots).
   * The label is metadata only.
   *
   * @param label - Optional human-readable label.
   * @returns The stored snapshot record.
   */
  async snapshot(label?: string): Promise<KnowledgeSnapshotRecord> {
    return this.serial(() => this.takeSnapshot(label));
  }

  /**
   * Read one stored snapshot.
   *
   * @param id - Snapshot id (`K-<n>`).
   * @returns The record, or `undefined` when absent.
   */
  async getSnapshot(id: string): Promise<KnowledgeSnapshotRecord | undefined> {
    const graph = await this.storage.loadGraph();
    return findSnapshot(graph.entities, id)?.knowledgeSnapshotRecord;
  }

  /**
   * Difference between two stored snapshots, read as "a to b". `diff(b, a)`
   * is the mirror of `diff(a, b)`; see {@link KnowledgeDiff}.
   *
   * @param aId - Source snapshot id.
   * @param bId - Target snapshot id.
   * @returns The diff, or `undefined` when either snapshot is unknown.
   */
  async diff(aId: string, bId: string): Promise<KnowledgeDiff | undefined> {
    const graph = await this.storage.loadGraph();
    const a = findSnapshot(graph.entities, aId)?.knowledgeSnapshotRecord;
    const b = findSnapshot(graph.entities, bId)?.knowledgeSnapshotRecord;
    if (!a || !b) return undefined;
    return diffSnapshots(a, b);
  }

  /**
   * Validate and apply a revision, all-or-nothing.
   *
   * 1. Conflict check: the live digest must equal the digest stored on
   *    `expectedSnapshotId`. An unknown id is a conflict.
   * 2. Every op is applied to an in-memory clone. The first failing op yields
   *    `rejected` with its index and nothing is written.
   * 3. The diff between clone and live state is written in one batch, then a
   *    new snapshot is taken.
   *
   * @param revision - Revision to apply (`ops` in order).
   * @param options - `expectedSnapshotId` is the base the caller reviewed.
   * @returns `applied`, `conflict` or `rejected`.
   */
  async applyRevision(
    revision: KnowledgeRevisionRecord,
    options: { expectedSnapshotId: string },
  ): Promise<ApplyResult> {
    return this.serial<ApplyResult>(async () => {
      const graph = await this.storage.loadGraph();
      const expected = findSnapshot(graph.entities, options.expectedSnapshotId);
      const live = payloadOf(graph.entities);
      if (!expected || digestOf(live) !== expected.knowledgeSnapshotRecord.digest) {
        return { status: 'conflict', currentSnapshotId: latestSnapshotId(graph.entities) };
      }
      const now = toIsoDateTime(new Date());
      const work = workFrom(live);
      for (let i = 0; i < revision.ops.length; i++) {
        const reason = safeApplyOp(revision.ops[i]!, work, now, i);
        if (reason !== undefined) return { status: 'rejected', failedOpIndex: i, reason };
      }
      const failure = await this.writePlan(planWrites(graph.entities, work, now));
      if (failure) return { status: 'rejected', ...failure };
      const snapshot = await this.takeSnapshot();
      return { status: 'applied', snapshotId: snapshot.id };
    });
  }

  /**
   * Restore skills and instruction sections from a stored snapshot. Skills
   * added after it are retired (never deleted) and instruction sets that exist
   * now but not in the target are left as they are; both mean the new snapshot
   * (labelled `rollback:<snapshotId>`) still differs in digest from the target.
   *
   * @param snapshotId - Snapshot to restore.
   * @returns `restored`, `not-found` or `rejected`.
   */
  async rollbackTo(snapshotId: string): Promise<RollbackResult> {
    return this.serial<RollbackResult>(async () => {
      const graph = await this.storage.loadGraph();
      const target = findSnapshot(graph.entities, snapshotId)?.knowledgeSnapshotRecord;
      if (!target) return { status: 'not-found' };
      const now = toIsoDateTime(new Date());
      const live = payloadOf(graph.entities);
      const work = workFrom(live);
      const targetSkillIds = new Set(target.skills.map((skill) => skill.id));
      for (const record of target.skills) work.skills.set(record.id, clone(record));
      for (const record of live.skills) {
        if (targetSkillIds.has(record.id) || record.retired) continue;
        work.skills.set(record.id, {
          ...record,
          retired: { at: now, reason: `rollback:${target.id}` },
          lastUpdatedAt: now,
        });
      }
      for (const record of target.instructionSets) work.sets.set(record.id, clone(record));
      const failure = await this.writePlan(planWrites(graph.entities, work, now));
      if (failure) return { status: 'rejected', reason: failure.reason };
      const snapshot = await this.takeSnapshot(`rollback:${target.id}`);
      return { status: 'restored', snapshotId: snapshot.id };
    });
  }

  /**
   * Assemble the context for a task: instructions for `role`, then matched
   * skills, then failure lessons. Sections are included in that order and
   * the first item that would exceed the budget stops the list.
   *
   * @param options - Role, task hint and budget.
   * @returns Markdown plus the ids that made it in.
   * @throws RangeError when `budgetTokens` is negative or not finite.
   */
  async loadForContext(options: LoadForContextOptions): Promise<LoadedKnowledge> {
    const budget = assertBudgetTokens(options.budgetTokens ?? DEFAULT_BUDGET_TOKENS, 'loadForContext');
    const multiplier = options.multiplier ?? readEnvNumber('MEMORY_CONTEXT_TOKEN_MULTIPLIER', 1.3);
    const instructions = instructionItemsFor(await this.instructionSets.list(), options.role);
    const matches = await this.skills.match(options.taskHint, { limit: LOOKUP_LIMIT });
    const failures = await this.failures.lookupForTask(options.taskHint, { limit: LOOKUP_LIMIT });
    const candidates: LoadItem[] = [
      ...instructions.map((item): LoadItem => ({ kind: 'instruction', item })),
      ...matches.map((match): LoadItem => ({ kind: 'skill', match })),
      ...failures.map((failure): LoadItem => ({ kind: 'failure', failure })),
    ];
    const render = (items: readonly LoadItem[]): string => renderLoaded(options.role, items);
    const kept = fitInOrder(candidates, render, budget, multiplier);
    const markdown = render(kept);
    return {
      markdown,
      skillIds: kept.flatMap((x) => (x.kind === 'skill' ? [x.match.skill.id] : [])),
      instructionSetIds: [...new Set(kept.flatMap((x) => (x.kind === 'instruction' ? [x.item.setId] : [])))],
      failureIds: kept.flatMap((x) => (x.kind === 'failure' ? [x.failure.id] : [])),
      tokens: estimateTokensFromText(markdown, multiplier),
    };
  }

  // ==================== Internal ====================

  /** Run `fn` after every previously queued mutation of this instance. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async takeSnapshot(label?: string): Promise<KnowledgeSnapshotRecord> {
    const graph = await this.storage.loadGraph();
    const payload = payloadOf(graph.entities);
    const digest = digestOf(payload);
    let n = graph.entities.filter(isKnowledgeSnapshotEntity).length;
    let name = `K-${n}`;
    while (graph.entities.some((entity) => entity.name === name)) {
      n += 1;
      name = `K-${n}`;
    }
    const now = toIsoDateTime(new Date());
    const record: KnowledgeSnapshotRecord = {
      id: name,
      ...(label !== undefined ? { label } : {}),
      createdAt: now,
      instructionSets: clone(payload.instructionSets),
      skills: clone(payload.skills),
      memoryRefs: memoryRefsOf(graph.entities),
      digest,
    };
    const entity = {
      name,
      entityType: 'knowledge_snapshot',
      observations: [`[knowledge_snapshot] ${name} digest: ${digest}`],
      createdAt: now,
      lastModified: now,
      importance: 5,
      memoryType: 'knowledge_snapshot',
      visibility: 'private',
      accessCount: 0,
      confidence: 1,
      confirmationCount: 0,
      version: 1,
      knowledgeSnapshotRecord: record,
    } as unknown as Entity;
    await this.entityManager.createEntities([entity]);
    return record;
  }

  /**
   * Issue the planned writes as one batch. Returns the rejection details when
   * the batch fails, or `undefined` on success (or when there is nothing to write).
   */
  private async writePlan(
    writes: readonly PlannedWrite[],
  ): Promise<{ failedOpIndex: number; reason: string } | undefined> {
    if (writes.length === 0) return undefined;
    const batch = new BatchTransaction(this.storage);
    for (const write of writes) {
      if (write.kind === 'create') {
        batch.createEntity(write.entity as unknown as Omit<Entity, 'createdAt' | 'lastModified'>);
      } else {
        batch.updateEntity(write.name, write.updates);
      }
    }
    const result = await batch.execute({ stopOnError: true });
    if (result.success) return undefined;
    const index = result.failedOperationIndex;
    if (index === undefined) {
      throw new Error(`KnowledgeRepository: batch write failed: ${result.error ?? 'unknown error'}`);
    }
    return { failedOpIndex: writes[index]?.origin ?? 0, reason: result.error ?? 'batch write failed' };
  }
}

// ==================== Helpers ====================

function findSnapshot(entities: readonly Entity[], id: string): KnowledgeSnapshotEntity | undefined {
  return entities.find((e) => e.name === id && isKnowledgeSnapshotEntity(e)) as KnowledgeSnapshotEntity | undefined;
}

function latestSnapshotId(entities: readonly Entity[]): string {
  let best = '';
  let bestN = -1;
  for (const entity of entities) {
    const match = /^K-(\d+)$/.exec(entity.name);
    if (!match || !isKnowledgeSnapshotEntity(entity)) continue;
    const n = Number(match[1]);
    if (n > bestN) {
      bestN = n;
      best = entity.name;
    }
  }
  return best;
}

function payloadOf(entities: readonly Entity[]): {
  instructionSets: InstructionSetRecord[];
  skills: SkillRecord[];
} {
  return {
    instructionSets: entities.filter(isInstructionSetEntity).map((e) => e.instructionSetRecord),
    skills: entities.filter(isSkillEntity).map((e) => e.skillRecord),
  };
}

function memoryRefsOf(entities: readonly Entity[]): KnowledgeSnapshotRecord['memoryRefs'] {
  const ids = (guard: (e: unknown) => boolean, pick: (e: Entity) => string): string[] =>
    entities.filter(guard).map(pick).sort(compareIds);
  return {
    heuristicIds: ids(isHeuristicMemory, (e) => (e as unknown as { heuristicRecord: { id: string } }).heuristicRecord.id),
    failureIds: ids(isFailureMemory, (e) => (e as unknown as { failureRecord: { id: string } }).failureRecord.id),
    reflectionIds: ids(isReflectionMemory, (e) => (e as unknown as { reflectionRecord: { id: string } }).reflectionRecord.id),
  };
}

/** Markdown for `loadForContext`: groups in fixed order, items in priority order. */
function renderLoaded(role: InstructionSetRole, items: readonly LoadItem[]): string {
  const groups: string[] = [];
  const instructions = items.flatMap((x) => (x.kind === 'instruction' ? [x.item] : []));
  if (instructions.length > 0) {
    groups.push(`## Instructions (${role})\n\n${renderInstructionItems(instructions)}`);
  }
  const skills = items.flatMap((x) => (x.kind === 'skill' ? [x.match.skill] : []));
  if (skills.length > 0) {
    const blocks = skills.map((skill) => {
      const refs = skill.sources.map((source) => source.ref).join(', ') || 'none';
      return `### ${skill.name} (uncertainty ${skill.uncertainty}, sources: ${refs})\n\n${skill.body}`;
    });
    groups.push(`## Skills\n\n${blocks.join('\n\n')}`);
  }
  const failures = items.flatMap((x) => (x.kind === 'failure' ? [x.failure] : []));
  if (failures.length > 0) {
    const lines = failures.map(
      (f) => `- ${f.failure_mode} → ${f.alternative_taken ?? f.root_cause} (applies when: ${f.applicability_hint})`,
    );
    groups.push(`## Failure lessons\n\n${lines.join('\n')}`);
  }
  return groups.join('\n\n');
}
