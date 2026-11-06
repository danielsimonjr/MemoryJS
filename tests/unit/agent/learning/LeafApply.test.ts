/**
 * Leaf-learner apply phase and run bookkeeping (Recursa RS-18, RS-23): OCC conflicts and rejected
 * ops never wedge the run (B1), bookkeeping survives a publish failure or a crash (B2), the state
 * is compare-and-swap (S5), answers are freed per round (N3), and the accountant persists (S6).
 */
import { describe, it, expect } from 'vitest';
import { LeafLearner, type LeafStartOptions } from '../../../../src/agent/learning/LeafLearner.js';
import type { LearnResult, TaskRecord } from '../../../../src/types/learning.js';
import type { RevisionOp } from '../../../../src/types/skills.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { KnowledgeRepository } from '../../../../src/agent/knowledge/KnowledgeRepository.js';
import { isKnowledgeSnapshotEntity, isSkillEntity } from '../../../../src/types/agent-memory.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import {
  fixOp,
  judge,
  judgeAnswer,
  makeRepo,
  makeTraces,
  scriptedEditor,
  scriptedSolver,
  stubDiagnoser,
  taskFor,
} from './leafFixtures.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');
const OPTS: LeafStartOptions = { taskIds: [A.id, B.id], tasks: [A, B], budget: { maxRounds: 4 }, validationSampleSize: 5 };

type Publisher = { publish(dir: string, options?: { snapshotId?: string }): Promise<unknown> };

/** Learner over `storage` with a scripted editor and optional publisher. */
function build(storage: IGraphStorage, ops: RevisionOp[][], publisher?: Publisher) {
  const repository = makeRepo(storage);
  const traces = makeTraces(storage);
  const make = (): LeafLearner =>
    new LeafLearner({
      repository,
      traces,
      diagnoser: stubDiagnoser,
      editor: scriptedEditor(ops),
      ...(publisher ? { publisher, publishDir: '/unwritable/dir' } : {}),
    });
  return { repository, traces, learner: make(), make };
}

/** Drive the step API to completion with full submissions. */
async function drive(learner: LeafLearner, traceId: string, solver = scriptedSolver({ passWithoutKnowledge: [B.id] })): Promise<LearnResult> {
  for (let guard = 0; guard < 60; guard++) {
    const step = await learner.next(traceId);
    if (step.kind === 'done') return step.result;
    if (step.kind === 'solve') {
      const payload = Object.fromEntries(await Promise.all(step.tasks.map(async (e) => [e.task.id, await solver.solve(e.task, e.knowledge)])));
      await learner.submit(traceId, 'solve', payload);
    } else {
      const payload = Object.fromEntries(await Promise.all(step.answers.map(async (e) => [e.task.id, await judgeAnswer(e.task, e.answer)])));
      await learner.submit(traceId, 'judge', payload);
    }
  }
  throw new Error('drive: run did not finish');
}

/** Outcomes of every trace action. */
async function outcomes(env: ReturnType<typeof build>, traceId: string): Promise<string[]> {
  return (await env.traces.get(traceId))!.actions.map((a) => a.outcome);
}

/** Replace `applyRevision` for one call, keeping the original for later calls. */
function hookApplyOnce(repo: KnowledgeRepository, hook: (orig: KnowledgeRepository['applyRevision'], ...args: Parameters<KnowledgeRepository['applyRevision']>) => ReturnType<KnowledgeRepository['applyRevision']>): void {
  const orig = repo.applyRevision.bind(repo);
  let used = false;
  repo.applyRevision = (revision, options) => {
    if (used) return orig(revision, options);
    used = true;
    return hook(orig, revision, options);
  };
}

/** Number of snapshots and skills for crash checks. */
async function counts(storage: IGraphStorage, revisionId: string): Promise<{ labelled: number; fixSkills: number }> {
  const entities = (await storage.loadGraph()).entities;
  return {
    labelled: entities.filter((e) => isKnowledgeSnapshotEntity(e) && e.knowledgeSnapshotRecord.label === `revision:${revisionId}`).length,
    fixSkills: entities.filter((e) => isSkillEntity(e) && e.skillRecord.body.includes(`FIX:${A.id}`)).length,
  };
}

withBothBackends('LeafLearner apply (B1/B2)', (backend) => {
  it('B1: an OCC conflict at apply records apply-conflict, re-solves against live K and continues', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')], [fixOp(A.id, 'alpha-value')]]);
    hookApplyOnce(env.repository, async (orig, revision, options) => {
      await orig({ ...revision, id: 'interloper', ops: [fixOp('zzz', 'q')] }, options);
      return orig(revision, options);
    });
    const { traceId } = await env.learner.start(OPTS);
    const result = await drive(env.learner, traceId);
    expect(result.stoppedBecause).toBe('all-pass');
    expect((await outcomes(env, traceId)).some((o) => o.startsWith('apply-conflict: '))).toBe(true);
    const record = await env.traces.get(traceId);
    expect(record!.revisionIds).toEqual(['revision-2']);
  });

  it('B1: a rejected op at apply records apply-rejected and stops as no-progress', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')]]);
    hookApplyOnce(env.repository, async () => ({ status: 'rejected', failedOpIndex: 0, reason: 'boom' }));
    const { traceId } = await env.learner.start(OPTS);
    const result = await drive(env.learner, traceId);
    expect(result.stoppedBecause).toBe('no-progress');
    expect(await outcomes(env, traceId)).toContain('apply-rejected: failedOpIndex=0 boom');
  });

  it('B2: a publish failure keeps the revision applied and the run continues', async () => {
    const publisher: Publisher = { publish: async () => { throw new Error('EACCES: permission denied'); } };
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')]], publisher);
    const { traceId } = await env.learner.start(OPTS);
    const result = await drive(env.learner, traceId);
    expect(result.stoppedBecause).toBe('all-pass');
    expect((await env.traces.get(traceId))!.revisionIds).toEqual(['revision-1']);
    expect(await outcomes(env, traceId)).toContain('publish-failed: EACCES: permission denied');
  });

  it('B2: a crash right after applyRevision does not double-apply or wedge on resume', async () => {
    const storage = backend.create();
    const env = build(storage, [[fixOp(A.id, 'alpha-value')]]);
    hookApplyOnce(env.repository, async (orig, revision, options) => {
      await orig(revision, options);
      throw new Error('crash after apply');
    });
    const { traceId } = await env.learner.start(OPTS);
    await expect(drive(env.learner, traceId)).rejects.toThrow('crash after apply');
    expect((await env.learner.state(traceId)).phase).toBe('apply');
    const result = await drive(env.make(), traceId);
    expect(result.stoppedBecause).toBe('all-pass');
    expect(await counts(storage, 'revision-1')).toEqual({ labelled: 1, fixSkills: 1 });
  });

  it('B2: a crash after the bookkeeping save skips the second apply (applyStep twice)', async () => {
    const storage = backend.create();
    const env = build(storage, [[fixOp(A.id, 'alpha-value')]]);
    const orig = env.traces.addRevisionId.bind(env.traces);
    let failed = false;
    env.traces.addRevisionId = async (id, revisionId) => {
      if (!failed) {
        failed = true;
        throw new Error('crash after save');
      }
      return orig(id, revisionId);
    };
    const { traceId } = await env.learner.start(OPTS);
    await expect(drive(env.learner, traceId)).rejects.toThrow('crash after save');
    let applies = 0;
    const apply = env.repository.applyRevision.bind(env.repository);
    env.repository.applyRevision = (r, o) => { applies += 1; return apply(r, o); };
    const result = await drive(env.make(), traceId);
    expect(result.stoppedBecause).toBe('all-pass');
    expect(applies).toBe(0);
    expect(await counts(storage, 'revision-1')).toEqual({ labelled: 1, fixSkills: 1 });
  });
});

withBothBackends('LeafLearner bookkeeping (S5/N3/S6)', (backend) => {
  it('S5: two learners stepping the same trace: one wins, the other gets a stale-state error, no lost submit', async () => {
    const env = build(backend.create(), []);
    const { traceId } = await env.learner.start(OPTS);
    const other = env.make();
    const read = env.traces.readState.bind(env.traces);
    let waiting = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => { release = r; });
    env.traces.readState = async (id) => {
      const json = await read(id);
      waiting += 1;
      if (waiting === 2) release();
      await barrier;
      return json;
    };
    const settled = await Promise.allSettled([
      env.learner.submit(traceId, 'solve', { [A.id]: { answer: 'x', traceAddrs: [] } }),
      other.submit(traceId, 'solve', { [B.id]: { answer: 'y', traceAddrs: [] } }),
    ]);
    env.traces.readState = read;
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toMatch(/LeafLearner: stale state \(expected rev \d+\)/);
    const loserId = settled[0]!.status === 'rejected' ? A.id : B.id;
    expect((await env.learner.state(traceId)).pending).toEqual([loserId]);
    await env.learner.submit(traceId, 'solve', { [loserId]: { answer: 'z', traceAddrs: [] } });
    expect((await env.learner.state(traceId)).phase).toBe('judge');
  });

  it('N3: full answers are freed when a round ends', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')]]);
    const { traceId } = await env.learner.start({ ...OPTS, budget: { maxRounds: 4 } });
    const solver = scriptedSolver();
    const held = (): number => ((env.learner as unknown as { fullAnswers: Map<string, Map<string, string>> }).fullAnswers.get(traceId)?.size ?? 0);
    for (;;) {
      const step = await env.learner.next(traceId);
      if (step.kind === 'done' || (await env.learner.state(traceId)).round === 1) break;
      if (step.kind === 'solve') {
        for (const e of step.tasks) await env.learner.submit(traceId, 'solve', { [e.task.id]: await solver.solve(e.task, e.knowledge) });
      } else {
        for (const e of step.answers) await env.learner.submit(traceId, 'judge', { [e.task.id]: await judgeAnswer(e.task, e.answer) });
      }
    }
    expect((await env.learner.state(traceId)).round).toBe(1);
    expect(held()).toBe(0);
  });

  it('S6: rework fires when a task is solved again with an unchanged digest across steps', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')], [fixOp(A.id, 'alpha-value')]]);
    hookApplyOnce(env.repository, async (_orig, revision) => ({ status: 'conflict', currentSnapshotId: `not-${revision.baseSnapshotId}` }));
    const { traceId } = await env.learner.start(OPTS);
    const result = await drive(env.learner, traceId);
    expect(result.stoppedBecause).toBe('all-pass');
    const report = result.report!;
    expect(report.rework).toBeGreaterThanOrEqual(2);
    expect(report.rounds).toBe(3);
    expect(report.solverSignals).toBeGreaterThan(0);
    expect(report.learnerSignals).toBeGreaterThan(0);
    expect(Object.values(report.wallClockByPhase).every((ms) => ms >= 0)).toBe(true);
    expect(await env.learner.report(traceId)).toMatchObject({ rework: report.rework, rounds: 3 });
  });

  it('S6: learn records limiter stalls in the persisted report', async () => {
    const env = build(backend.create(), []);
    const slow = scriptedSolver({ passWithoutKnowledge: [A.id, B.id] });
    const solver = { solve: async (...args: Parameters<typeof slow.solve>) => { await new Promise((r) => setTimeout(r, 15)); return slow.solve(...args); } };
    const result = await env.learner.learn({ ...OPTS, concurrency: 1 }, { solver, judge });
    expect(result.stoppedBecause).toBe('all-pass');
    expect(result.report!.stalls).toBeGreaterThan(0);
  });
});
