/**
 * Applies one bounded, failure-linked edit to the component named on a failure record.
 *
 * @module agent/GuardedComponentEdit
 */

import { randomUUID } from 'crypto';
import type { Entity, IGraphStorage } from '../types/types.js';
import type {
  FailureEntity,
  GoalNode,
  MemorySource,
  PlanEntity,
  PlanRecord,
} from '../types/agent-memory.js';
import {
  isFailureMemory,
  isHeuristicMemory,
  isPlanMemory,
  type AgentEntity,
} from '../types/agent-memory.js';
import type { EntityManager } from '../core/EntityManager.js';
import type { RelationManager } from '../core/RelationManager.js';
import type { ContradictionDetector } from '../features/ContradictionDetector.js';
import type { AuditLog } from '../features/AuditLog.js';
import type { HeuristicManager } from './HeuristicManager.js';
import type { IProceduralGraphBacking } from './procedural/graph/backing/IProceduralGraphBacking.js';
import type {
  PGEdge,
  PGEvaluationReport,
  PGSnapshot,
  PGRoundRecord,
} from '../types/proceduralGraph.js';
import { graphDigest } from './procedural/graph/canonical.js';
import { validateNonEmpty } from '../utils/schemas.js';
import {
  PROCEDURE_ENTITY_TYPE,
  PROCEDURE_STEP_ENTITY_TYPE,
} from './procedural/ProcedureStore.js';

/** Error codes returned by {@link applyGuardedEdit}. */
export type GuardedEditErrorCode =
  | 'failure-not-found'
  | 'no-blamed-component'
  | 'component-not-found'
  | 'unbounded'
  | 'delete-shaped'
  | 'wrong-target'
  | 'empty-change'
  | 'name-collision'
  | 'task-not-found'
  | 'version-not-found'
  | 'illegal-transition'
  | 'conflict';

/** Thrown when a guarded edit is rejected before or during commit. */
export class GuardedEditError extends Error {
  readonly code: GuardedEditErrorCode;

  constructor(code: GuardedEditErrorCode, message: string) {
    super(message);
    this.name = 'GuardedEditError';
    this.code = code;
  }
}

/** Scalar entity fields that a guarded edit may patch. */
export type GuardedScalarField = 'importance' | 'confidence' | 'ttl';

/** One bounded change; `targetId` must equal the failure's blamed component id. */
export interface GuardedChange {
  targetId: string;
  /** Append one observation. Mutually exclusive with the other change keys. */
  observation?: string;
  /** Entity scalar. Requires `value`. Not a version-chain field and not `lifecycleStatus`. */
  field?: GuardedScalarField;
  value?: number;
  /** `plan-node` only. One field on that goal node. */
  planNodeField?: 'description' | 'acceptanceCriteria';
  planNodeValue?: string;
  /** `pg-node` only. Replaces `PGNode.description` for `targetId`. */
  pgNodeDescription?: string;
  /** `pg-node` only. One text field on one edge that touches `targetId`. */
  pgEdgeText?: {
    source: string;
    target: string;
    field: 'condition' | 'guidance' | 'pitfalls';
    value: string | null;
  };
  /**
   * Presence of any of these keys, even as `undefined`, is delete-shaped
   * or an unbounded `PGEditSet`. Detect them on the raw object before
   * narrowing. `applyGuardedEdit` has no delete kind.
   */
  delete_nodes?: unknown;
  delete_edges?: unknown;
  add_nodes?: unknown;
  add_edges?: unknown;
  deleteEntity?: unknown;
}

/** Dependencies for {@link applyGuardedEdit}. */
export interface GuardedEditContext {
  storage: IGraphStorage;
  entityManager: EntityManager;
  relationManager: RelationManager;
  contradictionDetector: ContradictionDetector;
  auditLog: AuditLog;
  heuristicManager: HeuristicManager;
  findPlanNodeOwners: (nodeId: string) => Promise<readonly string[]>;
  /** Required when the blamed kind is `pg-node`. */
  pg?: {
    backing: IProceduralGraphBacking;
    graphId: string;
  };
}

/** Result of a successful guarded edit. */
export type GuardedEditResult =
  | { kind: 'entity'; entity: Entity; previousName: string }
  | { kind: 'pg-revision'; revision: PGSnapshot; parentRevisionId: string };

const DELETE_SHAPED_KEYS = [
  'delete_nodes',
  'delete_edges',
  'add_nodes',
  'add_edges',
  'deleteEntity',
] as const;

const PROCEDURE_OBSERVATION_PREFIXES = [
  '[success-rate]: ',
  '[execution-count]: ',
  '[order]: ',
  '[action]: ',
  '[timeout]: ',
  '[param]: ',
  '[procedure-steps]:',
  '[procedure-meta]:',
] as const;

const CHANGE_KEYS = [
  'observation',
  'field',
  'planNodeField',
  'pgNodeDescription',
  'pgEdgeText',
] as const;

/**
 * Apply one guarded edit linked to an open failure's blamed component.
 *
 * Does not call `FailureManager.markResolved` or any delete/archive API.
 */
export async function applyGuardedEdit(
  failureId: string,
  change: GuardedChange,
  deps: GuardedEditContext,
): Promise<GuardedEditResult> {
  const failureEntity = deps.storage.getEntityByName(failureId);
  if (failureEntity === undefined || !isFailureMemory(failureEntity)) {
    throw new GuardedEditError('failure-not-found', `Failure '${failureId}' was not found`);
  }

  const blamed = failureEntity.failureRecord.blamedComponent;
  if (blamed === undefined) {
    throw new GuardedEditError(
      'no-blamed-component',
      `Failure '${failureId}' has no blamedComponent`,
    );
  }

  assertNotDeleteShaped(change);
  if (change.targetId !== blamed.id) {
    throw new GuardedEditError(
      'wrong-target',
      `Change target '${change.targetId}' does not match blamed id '${blamed.id}'`,
    );
  }

  switch (blamed.kind) {
    case 'entity':
    case 'heuristic':
    case 'procedure':
      return applyEntityPath(failureEntity, blamed.id, blamed.kind, change, deps);
    case 'plan-node':
      return applyPlanNodePath(failureEntity, blamed.id, change, deps);
    case 'pg-node':
      return applyPgNodePath(failureEntity, blamed.id, change, deps);
    default:
      throw new GuardedEditError(
        'component-not-found',
        'Unsupported blamed kind for guarded edit',
      );
  }
}

function assertNotDeleteShaped(change: GuardedChange): void {
  const raw = change as unknown as Record<string, unknown>;
  for (const key of DELETE_SHAPED_KEYS) {
    if (key in raw) {
      throw new GuardedEditError(
        'delete-shaped',
        `Guarded edit rejects delete-shaped key '${key}'`,
      );
    }
  }
}

function countEntityStyleChangeKeys(change: GuardedChange): number {
  let count = 0;
  if (change.observation !== undefined) count++;
  if (change.field !== undefined) count++;
  return count;
}

function countAllChangeKeys(change: GuardedChange): number {
  let count = 0;
  for (const key of CHANGE_KEYS) {
    if (change[key] !== undefined) count++;
  }
  return count;
}

function validateScalarPatch(field: GuardedScalarField | undefined, value: number | undefined): void {
  if (field === undefined && value === undefined) return;
  if (field === undefined || value === undefined) {
    throw new GuardedEditError('empty-change', 'field and value must be supplied together');
  }
  if (field === 'importance') {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new GuardedEditError('empty-change', 'importance must be an integer from 0 through 10');
    }
    return;
  }
  if (field === 'confidence') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new GuardedEditError('empty-change', 'confidence must be a number from 0 to 1');
    }
    return;
  }
  if (field === 'ttl') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new GuardedEditError('empty-change', 'ttl must be a finite number');
    }
  }
}

function assertObservationText(observation: string | undefined): void {
  if (observation === undefined) return;
  if (typeof observation !== 'string' || observation.trim().length === 0) {
    throw new GuardedEditError('empty-change', 'observation must be a non-empty string');
  }
}

function assertProcedureObservation(observation: string | undefined): void {
  if (observation === undefined) return;
  for (const prefix of PROCEDURE_OBSERVATION_PREFIXES) {
    if (observation.startsWith(prefix)) {
      throw new GuardedEditError(
        'unbounded',
        `Procedure observations must not use reserved prefix '${prefix.trim()}'`,
      );
    }
  }
}

async function assertNameAvailable(
  storage: IGraphStorage,
  oldEntity: Entity,
): Promise<void> {
  const rootName = oldEntity.rootEntityName ?? oldEntity.name;
  const nextVersion = (oldEntity.version ?? 1) + 1;
  const newName = `${rootName}-v${nextVersion}`;
  if (storage.getEntityByName(newName) !== undefined) {
    throw new GuardedEditError('name-collision', `Version name '${newName}' already exists`);
  }
}

async function appendEditAudit(
  auditLog: AuditLog,
  failureId: string,
  entityName: string,
  after: object,
): Promise<void> {
  await auditLog.append({
    operation: 'create',
    entityName,
    status: 'committed',
    after,
    metadata: { failureId },
  });
}

function loadBlamedEntity(
  storage: IGraphStorage,
  id: string,
  kind: 'entity' | 'heuristic' | 'procedure',
): Entity {
  const entity = storage.getEntityByName(id);
  if (entity === undefined) {
    throw new GuardedEditError('component-not-found', `Component '${id}' was not found`);
  }
  if (kind === 'heuristic' && !isHeuristicMemory(entity)) {
    throw new GuardedEditError('component-not-found', `Component '${id}' is not a heuristic`);
  }
  if (
    kind === 'procedure' &&
    entity.entityType !== PROCEDURE_ENTITY_TYPE &&
    entity.entityType !== PROCEDURE_STEP_ENTITY_TYPE
  ) {
    throw new GuardedEditError('component-not-found', `Component '${id}' is not a procedure`);
  }
  return entity;
}

async function applyEntityPath(
  failureEntity: FailureEntity,
  componentId: string,
  kind: 'entity' | 'heuristic' | 'procedure',
  change: GuardedChange,
  deps: GuardedEditContext,
): Promise<GuardedEditResult> {
  if (
    change.planNodeField !== undefined ||
    change.planNodeValue !== undefined ||
    change.pgNodeDescription !== undefined ||
    change.pgEdgeText !== undefined
  ) {
    throw new GuardedEditError('unbounded', 'Entity edit allows only observation or field');
  }

  const keyCount = countEntityStyleChangeKeys(change);
  if (keyCount === 0) {
    throw new GuardedEditError('empty-change', 'Guarded edit requires exactly one change');
  }
  if (keyCount >= 2) {
    throw new GuardedEditError('unbounded', 'Guarded edit allows only one change at a time');
  }

  validateScalarPatch(change.field, change.value);
  assertObservationText(change.observation);
  if (kind === 'procedure') {
    assertProcedureObservation(change.observation);
  }

  const oldEntity = loadBlamedEntity(deps.storage, componentId, kind);
  await assertNameAvailable(deps.storage, oldEntity);

  const patch =
    change.field !== undefined
      ? ({ [change.field]: change.value } as Partial<Pick<Entity, 'importance' | 'confidence' | 'ttl'>>)
      : undefined;

  const newEntity = await deps.contradictionDetector.supersede(
    oldEntity,
    change.observation !== undefined ? [change.observation] : [],
    deps.entityManager,
    {
      causedByFailureId: failureEntity.failureRecord.id,
      lifecycleStatus: 'draft',
      preserveBody: true,
      patch,
    },
  );

  await appendEditAudit(deps.auditLog, failureEntity.failureRecord.id, newEntity.name, newEntity);

  return { kind: 'entity', entity: newEntity, previousName: oldEntity.name };
}

async function applyPlanNodePath(
  failureEntity: FailureEntity,
  nodeId: string,
  change: GuardedChange,
  deps: GuardedEditContext,
): Promise<GuardedEditResult> {
  if (
    change.observation !== undefined ||
    change.field !== undefined ||
    change.value !== undefined ||
    change.pgNodeDescription !== undefined ||
    change.pgEdgeText !== undefined
  ) {
    throw new GuardedEditError('unbounded', 'Plan-node edit allows only planNodeField');
  }
  if (change.planNodeField === undefined) {
    throw new GuardedEditError('empty-change', 'planNodeField is required for plan-node edits');
  }
  if (typeof change.planNodeValue !== 'string' || change.planNodeValue.trim().length === 0) {
    throw new GuardedEditError('empty-change', 'planNodeValue must be a non-empty string');
  }

  const owners = await deps.findPlanNodeOwners(nodeId);
  if (owners.length === 0) {
    throw new GuardedEditError('component-not-found', `Plan node '${nodeId}' was not found`);
  }
  if (owners.length >= 2) {
    throw new GuardedEditError('wrong-target', `Plan node '${nodeId}' is owned by multiple plans`);
  }

  const planEntityRaw = deps.storage.getEntityByName(owners[0]!);
  if (planEntityRaw === undefined || !isPlanMemory(planEntityRaw)) {
    throw new GuardedEditError('component-not-found', `Plan '${owners[0]}' was not found`);
  }
  const planEntity = planEntityRaw as PlanEntity;
  const oldEntity = planEntity as unknown as Entity;

  await assertNameAvailable(deps.storage, oldEntity);

  const planRecord = structuredClone(planEntity.planRecord) as PlanRecord;
  if (!updateGoalNodeField(planRecord.rootGoal, nodeId, change.planNodeField, change.planNodeValue)) {
    throw new GuardedEditError('component-not-found', `Plan node '${nodeId}' was not found in tree`);
  }

  const newEntity = await deps.contradictionDetector.supersede(
    oldEntity,
    [],
    deps.entityManager,
    {
      causedByFailureId: failureEntity.failureRecord.id,
      lifecycleStatus: 'draft',
      preserveBody: true,
      planRecord,
    },
  );

  await appendEditAudit(deps.auditLog, failureEntity.failureRecord.id, newEntity.name, newEntity);

  return { kind: 'entity', entity: newEntity, previousName: oldEntity.name };
}

function updateGoalNodeField(
  node: GoalNode,
  nodeId: string,
  field: 'description' | 'acceptanceCriteria',
  value: string,
): boolean {
  if (node.id === nodeId) {
    if (field === 'description') {
      node.description = value;
    } else {
      node.acceptanceCriteria = value;
    }
    return true;
  }
  for (const child of node.children) {
    if (updateGoalNodeField(child, nodeId, field, value)) return true;
  }
  return false;
}

async function applyPgNodePath(
  failureEntity: FailureEntity,
  targetId: string,
  change: GuardedChange,
  deps: GuardedEditContext,
): Promise<GuardedEditResult> {
  if (deps.pg === undefined) {
    throw new GuardedEditError('component-not-found', 'pg-node edits require deps.pg');
  }

  if (
    change.observation !== undefined ||
    change.field !== undefined ||
    change.value !== undefined ||
    change.planNodeField !== undefined ||
    change.planNodeValue !== undefined
  ) {
    throw new GuardedEditError('unbounded', 'pg-node edit allows only pgNodeDescription or pgEdgeText');
  }

  const keyCount = countAllChangeKeys(change);
  if (keyCount === 0) {
    throw new GuardedEditError('empty-change', 'Guarded edit requires exactly one change');
  }
  if (keyCount >= 2) {
    throw new GuardedEditError('unbounded', 'Guarded edit allows only one change at a time');
  }

  const { backing, graphId } = deps.pg;
  const head = await backing.loadHead(graphId);
  if (head === undefined) {
    throw new GuardedEditError('component-not-found', `Graph '${graphId}' has no head`);
  }

  const parent = await backing.loadRevision(graphId, head.revisionId);
  if (parent === undefined) {
    throw new GuardedEditError('component-not-found', `Revision '${head.revisionId}' was not found`);
  }
  if (!parent.nodes.some((n) => n.id === targetId)) {
    throw new GuardedEditError('component-not-found', `Node '${targetId}' was not found in head revision`);
  }

  let child: PGSnapshot;
  if (change.pgNodeDescription !== undefined) {
    if (typeof change.pgNodeDescription !== 'string' || change.pgNodeDescription.trim().length === 0) {
      throw new GuardedEditError('empty-change', 'pgNodeDescription must be a non-empty string');
    }
    child = cloneSnapshot(parent, head.revisionId);
    const node = child.nodes.find((n) => n.id === targetId);
    if (node === undefined) {
      throw new GuardedEditError('component-not-found', `Node '${targetId}' was not found`);
    }
    (node as { description: string }).description = change.pgNodeDescription;
  } else if (change.pgEdgeText !== undefined) {
    child = applyPgEdgeTextChange(parent, head.revisionId, targetId, change.pgEdgeText);
  } else {
    throw new GuardedEditError('empty-change', 'pg-node edit requires pgNodeDescription or pgEdgeText');
  }

  const now = new Date().toISOString();
  const validation: PGEvaluationReport = {
    fingerprint: 'guarded-edit',
    graphDigest: graphDigest(child),
    taskCount: 0,
    completed: 0,
    meanScore: 0,
    scores: [],
    incomplete: false,
    evaluatedAt: now,
  };

  const round: PGRoundRecord = {
    runId: 'guarded-edit',
    round: 1,
    retainedRevisionId: head.revisionId,
    candidateRevisionId: child.revisionId,
    outcome: 'accepted',
    baselineMean: null,
    candidateMean: null,
    diagnostics: [],
    repairs: [],
    startedAt: now,
    finishedAt: now,
    causedByFailureId: failureEntity.failureRecord.id,
  };

  const commit = await backing.commitRetainedRevision({
    expectedHeadVersion: head.headVersion,
    revision: child,
    validation,
    round,
  });

  if (commit.status === 'conflict') {
    throw new GuardedEditError('conflict', 'Procedural graph head version conflict');
  }

  await appendEditAudit(deps.auditLog, failureEntity.failureRecord.id, child.revisionId, {
    revisionId: child.revisionId,
    parentRevisionId: head.revisionId,
    graphId,
  });

  return {
    kind: 'pg-revision',
    revision: child,
    parentRevisionId: head.revisionId,
  };
}

function cloneSnapshot(parent: PGSnapshot, parentRevisionId: string): PGSnapshot {
  return {
    schemaVersion: parent.schemaVersion,
    graphId: parent.graphId,
    revisionId: `rev-${randomUUID()}`,
    parentRevisionId,
    entryNodeId: parent.entryNodeId,
    relationVocabulary: [...parent.relationVocabulary],
    cyclePolicy: parent.cyclePolicy,
    toolCatalogHash: parent.toolCatalogHash,
    nodes: parent.nodes.map((n) => ({ ...n })),
    edges: parent.edges.map((e) => ({ ...e })),
  };
}

function applyPgEdgeTextChange(
  parent: PGSnapshot,
  parentRevisionId: string,
  targetId: string,
  edit: NonNullable<GuardedChange['pgEdgeText']>,
): PGSnapshot {
  const edge = parent.edges.find(
    (e) => e.source === edit.source && e.target === edit.target,
  );
  if (edge === undefined) {
    throw new GuardedEditError('wrong-target', 'Edge was not found');
  }
  if (edge.source !== targetId && edge.target !== targetId) {
    throw new GuardedEditError('wrong-target', 'Edge does not touch the blamed node');
  }

  const child = cloneSnapshot(parent, parentRevisionId);
  const childEdge = child.edges.find(
    (e) => e.source === edit.source && e.target === edit.target,
  ) as PGEdge | undefined;
  if (childEdge === undefined) {
    throw new GuardedEditError('wrong-target', 'Edge was not found in child snapshot');
  }
  childEdge[edit.field] = edit.value;
  return child;
}

function isMemorySource(value: unknown): value is MemorySource {
  if (value === null || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.agentId === 'string' &&
    typeof source.timestamp === 'string' &&
    typeof source.method === 'string' &&
    typeof source.reliability === 'number'
  );
}

function effectiveLifecycleStatus(entity: Entity): Entity['lifecycleStatus'] | 'published' {
  return entity.lifecycleStatus ?? 'published';
}

function loadVersionEntity(storage: IGraphStorage, versionName: string): Entity {
  const entity = storage.getEntityByName(versionName);
  if (entity === undefined) {
    throw new GuardedEditError('version-not-found', `Version '${versionName}' was not found`);
  }
  return entity;
}

function assertTaskEntity(storage: IGraphStorage, taskId: string): void {
  if (storage.getEntityByName(taskId) === undefined) {
    throw new GuardedEditError('task-not-found', `Task '${taskId}' was not found`);
  }
}

/**
 * Publish a guarded-edit version (or un-archive it) and record that it helped a task.
 */
export async function noteHelped(
  versionName: string,
  taskId: string,
  deps: GuardedEditContext,
): Promise<Entity> {
  const entity = loadVersionEntity(deps.storage, versionName);
  assertTaskEntity(deps.storage, taskId);

  const effective = effectiveLifecycleStatus(entity);
  const updates: Partial<Entity> = {};

  if (effective === 'draft' || effective === 'archived') {
    updates.lifecycleStatus = 'published';
  }

  const agentEntity = entity as AgentEntity;
  if (isMemorySource(agentEntity.source)) {
    (updates as Partial<AgentEntity>).source = {
      ...agentEntity.source,
      trustLevel: 'verified',
    };
  }

  if (Object.keys(updates).length > 0) {
    await deps.entityManager.updateEntity(versionName, updates);
  }

  const reloaded = loadVersionEntity(deps.storage, versionName);
  if (isHeuristicMemory(reloaded)) {
    const result = await deps.heuristicManager.reinforce(versionName);
    if (result === 'not-found') {
      throw new GuardedEditError('component-not-found', `Heuristic '${versionName}' was not found`);
    }
    if (result !== 'updated') {
      throw new GuardedEditError('conflict', `Heuristic reinforce failed with '${result}'`);
    }
  }

  await deps.relationManager.createRelations([
    { from: versionName, to: taskId, relationType: 'helped_task' },
  ]);

  return loadVersionEntity(deps.storage, versionName);
}

/**
 * Archive a guarded-edit version and record that it was retired after a task.
 */
export async function retire(
  versionName: string,
  taskId: string,
  reason: string,
  deps: GuardedEditContext,
): Promise<Entity> {
  validateNonEmpty(reason, 'reason', 'retire');
  const entity = loadVersionEntity(deps.storage, versionName);
  assertTaskEntity(deps.storage, taskId);

  const effective = effectiveLifecycleStatus(entity);
  if (effective === 'draft' || effective === 'published') {
    await deps.entityManager.updateEntity(versionName, { lifecycleStatus: 'archived' });
  }

  await deps.relationManager.createRelations([
    {
      from: versionName,
      to: taskId,
      relationType: 'retired_after',
      metadata: { reason },
    },
  ]);

  return loadVersionEntity(deps.storage, versionName);
}
