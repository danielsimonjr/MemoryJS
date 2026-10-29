import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { ContradictionDetector } from '../../../src/features/ContradictionDetector.js';
import { AuditLog } from '../../../src/features/AuditLog.js';
import type { SemanticSearch } from '../../../src/search/SemanticSearch.js';
import {
  applyGuardedEdit,
  GuardedEditError,
  type GuardedEditContext,
} from '../../../src/agent/GuardedComponentEdit.js';
import { InMemoryProceduralGraphBacking } from '../../../src/agent/procedural/graph/backing/InMemoryProceduralGraphBacking.js';
import { ProceduralGraphManager } from '../../../src/agent/procedural/graph/ProceduralGraphManager.js';
import { PG_BUILT_IN_RELATIONS } from '../../../src/types/proceduralGraph.js';

const mockSearch = (): SemanticSearch =>
  ({
    calculateSimilarity: async () => 0,
  }) as unknown as SemanticSearch;

const GRAPH_ID = 'guarded-edit-pg';

function buildDeps(ctx: ManagerContext, auditLog: AuditLog): GuardedEditContext {
  return {
    storage: ctx.storage,
    entityManager: ctx.entityManager,
    relationManager: ctx.relationManager,
    contradictionDetector: new ContradictionDetector(mockSearch(), 0.85),
    auditLog,
    heuristicManager: ctx.heuristicManager,
    findPlanNodeOwners: (nodeId) => ctx.plan.findNodeOwners(nodeId),
  };
}

describe('applyGuardedEdit', () => {
  let tmpDir: string;
  let ctx: ManagerContext;
  let auditLog: AuditLog;
  let deps: GuardedEditContext;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjs-guarded-edit-'));
    ctx = new ManagerContext(path.join(tmpDir, 'memory.jsonl'));
    auditLog = new AuditLog(path.join(tmpDir, 'audit.jsonl'));
    deps = buildDeps(ctx, auditLog);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('chain length grows by one and the old entity reloads', async () => {
    await ctx.entityManager.createEntities([
      {
        name: 'widget',
        entityType: 'concept',
        observations: ['original note'],
      },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });

    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'widget', observation: 'added note' },
      deps,
    );

    expect(result.kind).toBe('entity');
    const chain = await ctx.entityManager.getVersionChain('widget');
    expect(chain).toHaveLength(2);
    const old = (await ctx.entityManager.getEntity('widget'))!;
    expect(old.isLatest).toBe(false);
    if (result.kind === 'entity') {
      expect(old.supersededBy).toBe(result.entity.name);
      expect(result.entity.observations).toEqual(['original note', 'added note']);
    }
  });

  it('causedByFailureId matches the failure id', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'widget', observation: 'b' },
      deps,
    );
    expect(result.kind).toBe('entity');
    if (result.kind === 'entity') {
      expect(result.entity.causedByFailureId).toBe(rec.id);
    }
  });

  it('the new version is a draft', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'widget', observation: 'b' },
      deps,
    );
    expect(result.kind).toBe('entity');
    if (result.kind === 'entity') {
      expect(result.entity.lifecycleStatus).toBe('draft');
    }
  });

  it('rejects a second target before any write', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    await expect(
      applyGuardedEdit(
        rec.id,
        { targetId: 'other', observation: 'b' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'wrong-target' });
    const unchanged = (await ctx.entityManager.getEntity('widget'))!;
    expect(unchanged.isLatest).not.toBe(false);
  });

  it('rejects a delete-shaped payload with no storage change', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    const deleteSpy = vi.spyOn(ctx.entityManager, 'deleteEntities');
    await expect(
      applyGuardedEdit(
        rec.id,
        { targetId: 'widget', deleteEntity: true } as never,
        deps,
      ),
    ).rejects.toMatchObject({ code: 'delete-shaped' });
    expect(deleteSpy).not.toHaveBeenCalled();
    const unchanged = (await ctx.entityManager.getEntity('widget'))!;
    expect(unchanged.observations).toEqual(['a']);
    expect(unchanged.isLatest).not.toBe(false);
  });

  it('rejects two field changes before any write', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    await expect(
      applyGuardedEdit(
        rec.id,
        { targetId: 'widget', observation: 'b', field: 'importance', value: 5 },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'unbounded' });
  });

  it('rejects a failure that has no blamedComponent', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record(validFailureInput());
    await expect(
      applyGuardedEdit(rec.id, { targetId: 'widget', observation: 'b' }, deps),
    ).rejects.toMatchObject({ code: 'no-blamed-component' });
  });

  it('appends one audit entry whose metadata names the failure id', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'widget', observation: 'b' },
      deps,
    );
    expect(result.kind).toBe('entity');
    const newName = result.kind === 'entity' ? result.entity.name : '';
    const entries = await auditLog.query({ entityName: newName });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata?.failureId).toBe(rec.id);
  });

  it('does not call deleteEntities', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    const deleteSpy = vi.spyOn(ctx.entityManager, 'deleteEntities');
    await applyGuardedEdit(rec.id, { targetId: 'widget', observation: 'b' }, deps);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('procedural graph child snapshot parentRevisionId is the previous revision and listRevisions returns both', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: [{ id: 'Do', type: 'ACTION', description: 'old text', actionName: 'do' }],
      edges: [],
      entryNodeId: 'Do',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const head = await backing.loadHead(GRAPH_ID);
    const parentRevision = head!.revisionId;
    const snapshot = (await backing.loadRevision(GRAPH_ID, parentRevision))!;

    const rec = await ctx.failureManager.record(
      {
        ...validFailureInput(),
        blamedComponent: { kind: 'pg-node', id: 'Do' },
      },
      { pgSnapshot: snapshot },
    );

    const pgDeps: GuardedEditContext = {
      ...deps,
      pg: { backing, graphId: GRAPH_ID },
    };

    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'Do', pgNodeDescription: 'new text' },
      pgDeps,
    );

    expect(result.kind).toBe('pg-revision');
    if (result.kind === 'pg-revision') {
      expect(result.parentRevisionId).toBe(parentRevision);
      expect(result.revision.parentRevisionId).toBe(parentRevision);
      const parentReload = await backing.loadRevision(GRAPH_ID, parentRevision);
      expect(parentReload?.nodes[0]?.description).toBe('old text');
    }

    const listed = await backing.listRevisions(GRAPH_ID, { offset: 0, limit: 10 });
    expect(listed.total).toBe(2);
    expect(listed.items.map((i) => i.revisionId).sort()).toEqual(
      [parentRevision, result.kind === 'pg-revision' ? result.revision.revisionId : ''].sort(),
    );
  });

  it('rejects NaN confidence before any write', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    await expect(
      applyGuardedEdit(
        rec.id,
        { targetId: 'widget', field: 'confidence', value: Number.NaN },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'empty-change' });
    const unchanged = (await ctx.entityManager.getEntity('widget'))!;
    expect(unchanged.isLatest).not.toBe(false);
  });

  it('rejects a colliding version name before any write', async () => {
    await ctx.entityManager.createEntities([
      { name: 'widget', entityType: 'concept', observations: ['a'] },
      { name: 'widget-v2', entityType: 'concept', observations: ['taken'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'entity', id: 'widget' },
    });
    await expect(
      applyGuardedEdit(rec.id, { targetId: 'widget', observation: 'b' }, deps),
    ).rejects.toMatchObject({ code: 'name-collision' });
    const original = (await ctx.entityManager.getEntity('widget'))!;
    expect(original.isLatest).not.toBe(false);
    expect(original.observations).toEqual(['a']);
  });

  it('rejects a procedure observation that uses a reserved prefix', async () => {
    await ctx.entityManager.createEntities([
      { name: 'proc', entityType: 'procedure', observations: ['[success-rate]: 0.5'] },
    ]);
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'procedure', id: 'proc' },
    });
    await expect(
      applyGuardedEdit(
        rec.id,
        { targetId: 'proc', observation: '[success-rate]: 0.9' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'unbounded' });
    const unchanged = (await ctx.entityManager.getEntity('proc'))!;
    expect(unchanged.isLatest).not.toBe(false);
  });

  it('plan-node edit versions the plan and patches only that node field', async () => {
    const plan = await ctx.plan.createPlan('Ship widget');
    const rec = await ctx.failureManager.record({
      ...validFailureInput(),
      blamedComponent: { kind: 'plan-node', id: plan.rootGoal.id },
    });
    const result = await applyGuardedEdit(
      rec.id,
      {
        targetId: plan.rootGoal.id,
        planNodeField: 'description',
        planNodeValue: 'Ship widget after review',
      },
      deps,
    );
    expect(result.kind).toBe('entity');
    if (result.kind !== 'entity') return;
    expect(result.previousName).toBe(plan.id);
    expect(result.entity.lifecycleStatus).toBe('draft');
    expect(result.entity.causedByFailureId).toBe(rec.id);
    const newPlan = result.entity as unknown as { planRecord: { rootGoal: { description: string } } };
    expect(newPlan.planRecord.rootGoal.description).toBe('Ship widget after review');
    const oldPlan = (await ctx.entityManager.getEntity(plan.id))!;
    expect(oldPlan.isLatest).toBe(false);
    const oldRecord = oldPlan as unknown as { planRecord: { rootGoal: { description: string } } };
    expect(oldRecord.planRecord.rootGoal.description).toBe('Ship widget');
  });

  it('stores causedByFailureId on the pg round and writes no audit on conflict', async () => {
    const backing = new InMemoryProceduralGraphBacking();
    const manager = new ProceduralGraphManager({ backing, ownsBacking: false });
    const created = await manager.createGraph({
      graphId: GRAPH_ID,
      nodes: [{ id: 'Do', type: 'ACTION', description: 'old text', actionName: 'do' }],
      edges: [],
      entryNodeId: 'Do',
      relationVocabulary: [...PG_BUILT_IN_RELATIONS],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const head = await backing.loadHead(GRAPH_ID);
    const snapshot = (await backing.loadRevision(GRAPH_ID, head!.revisionId))!;
    const rec = await ctx.failureManager.record(
      {
        ...validFailureInput(),
        blamedComponent: { kind: 'pg-node', id: 'Do' },
      },
      { pgSnapshot: snapshot },
    );
    const pgDeps: GuardedEditContext = {
      ...deps,
      pg: { backing, graphId: GRAPH_ID },
    };

    const commitSpy = vi.spyOn(backing, 'commitRetainedRevision');
    const result = await applyGuardedEdit(
      rec.id,
      { targetId: 'Do', pgNodeDescription: 'new text' },
      pgDeps,
    );
    expect(result.kind).toBe('pg-revision');
    const committedRound = commitSpy.mock.calls[0]?.[0]?.round;
    expect(committedRound?.causedByFailureId).toBe(rec.id);

    commitSpy.mockResolvedValueOnce({
      status: 'conflict',
      currentHead: (await backing.loadHead(GRAPH_ID))!,
    });
    const beforeAudit = await auditLog.query({});
    await expect(
      applyGuardedEdit(rec.id, { targetId: 'Do', pgNodeDescription: 'other text' }, pgDeps),
    ).rejects.toMatchObject({ code: 'conflict' });
    const afterAudit = await auditLog.query({});
    expect(afterAudit).toHaveLength(beforeAudit.length);
  });
});

function validFailureInput() {
  return {
    context: 'Building widget',
    attempted: 'tried approach A',
    failure_mode: 'broke',
    root_cause: 'assumption wrong',
    applicability_hint: 'widget build flows',
  };
}

describe('GuardedEditError', () => {
  it('exposes the code on the error instance', () => {
    const err = new GuardedEditError('empty-change', 'msg');
    expect(err.name).toBe('GuardedEditError');
    expect(err.code).toBe('empty-change');
  });
});
