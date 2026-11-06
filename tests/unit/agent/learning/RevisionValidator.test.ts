/** RevisionValidator (RS-17): accept rule, sample boundary, repeats, scratch isolation, sampling. */
import { describe, it, expect } from 'vitest';
import {
  RevisionValidator,
  DEFAULT_VALIDATION_SEED,
  stratifiedSample,
  type ValidateOptions,
} from '../../../../src/agent/learning/RevisionValidator.js';
import type { Feedback, TaskRecord } from '../../../../src/types/learning.js';
import type { RevisionOp } from '../../../../src/types/skills.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { makeRevision } from '../knowledge/knowledgeFixtures.js';
import {
  breakOp,
  fixOp,
  judge,
  makeRepo,
  scriptedSolver,
  taskFor,
  snapshotCount,
  type SolverScript,
} from './leafFixtures.js';
import type { IGraphStorage } from '../../../../src/types/types.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');

/** Judge-free feedback with one criterion. */
function feedback(task: TaskRecord, pass: boolean): Feedback {
  return { taskId: task.id, criteria: [{ criterionId: 'c1', pass }], allPass: pass, source: 'judge' };
}

/** Options for a run where A fails and B passes. */
function optionsFor(storage: IGraphStorage, overrides: Partial<ValidateOptions> & { script?: SolverScript } = {}): ValidateOptions {
  const { script, ...rest } = overrides;
  return {
    repository: makeRepo(storage),
    affectedTaskIds: [A.id],
    allTasks: [A, B],
    priorFeedback: { [A.id]: feedback(A, false), [B.id]: feedback(B, true) },
    validationSampleSize: 1,
    solver: scriptedSolver(script ?? { passWithoutKnowledge: [B.id] }),
    judge,
    ...rest,
  };
}

/** Revision with the given ops. */
function revisionOf(ops: RevisionOp[]) {
  return makeRevision('revision-test', 'K-0', ops);
}

withBothBackends('RevisionValidator decision rule', (backend) => {
  it('accepts when the affected task is fixed and no sampled task regresses', async () => {
    const storage = backend.create();
    const verdict = await new RevisionValidator().validate(revisionOf([fixOp(A.id, 'alpha-value')]), optionsFor(storage));
    expect(verdict).toEqual({ verdict: 'accept', fixed: [A.id], regressed: [], unchanged: [B.id] });
  });

  it('rejects when nothing is fixed, even with no regressions', async () => {
    const storage = backend.create();
    const verdict = await new RevisionValidator().validate(revisionOf([]), optionsFor(storage));
    expect(verdict.verdict).toBe('reject');
    expect(verdict.fixed).toEqual([]);
    expect(verdict.regressed).toEqual([]);
  });

  it('boundary: a fix plus a regression on the last sampled task rejects', async () => {
    const storage = backend.create();
    const ops = [fixOp(A.id, 'alpha-value'), breakOp(B.id)];
    const verdict = await new RevisionValidator().validate(revisionOf(ops), optionsFor(storage, { validationSampleSize: 1 }));
    expect(verdict).toMatchObject({ verdict: 'reject', fixed: [A.id], regressed: [B.id] });
  });

  it('the same regression outside the sample does not block acceptance', async () => {
    const storage = backend.create();
    const ops = [fixOp(A.id, 'alpha-value'), breakOp(B.id)];
    const verdict = await new RevisionValidator().validate(revisionOf(ops), optionsFor(storage, { validationSampleSize: 0 }));
    expect(verdict).toMatchObject({ verdict: 'accept', fixed: [A.id], regressed: [] });
  });

  it('a nondeterministic solver fails with validationRepeats = 2 but passes with 1', async () => {
    const storage = backend.create();
    const revision = revisionOf([fixOp(A.id, 'alpha-value')]);
    const script: SolverScript = { passWithoutKnowledge: [B.id], firstCallOnly: [A.id] };
    const once = await new RevisionValidator().validate(revision, optionsFor(storage, { script, validationRepeats: 1 }));
    expect(once.verdict).toBe('accept');
    const twice = await new RevisionValidator().validate(revision, optionsFor(storage, { script, validationRepeats: 2 }));
    expect(twice).toMatchObject({ verdict: 'reject', fixed: [] });
  });

  it('a solver failure counts as failing the task', async () => {
    const storage = backend.create();
    const script: SolverScript = { passWithoutKnowledge: [B.id], throwFor: [A.id] };
    const verdict = await new RevisionValidator().validate(revisionOf([fixOp(A.id, 'alpha-value')]), optionsFor(storage, { script }));
    expect(verdict).toMatchObject({ verdict: 'reject', fixed: [] });
  });

  it('a revision whose op does not apply is rejected with the reason', async () => {
    const storage = backend.create();
    const bad = { op: 'skill.update', id: 'skill-missing', patch: { body: 'x' } } as unknown as RevisionOp;
    const verdict = await new RevisionValidator().validate(revisionOf([bad]), optionsFor(storage));
    expect(verdict.verdict).toBe('reject');
    expect(verdict.reason).toContain('unknown skill id');
  });

  it('scratch never leaks into live K: digest, snapshots and entities are unchanged', async () => {
    const storage = backend.create();
    const repo = makeRepo(storage);
    const k0 = await repo.snapshot('before');
    const before = JSON.stringify((await storage.loadGraph()).entities.map((e) => [e.name, e.version ?? 1]));
    const snapshots = await snapshotCount(storage);
    const rejected = await new RevisionValidator().validate(revisionOf([fixOp(A.id, 'alpha-value'), breakOp(B.id)]), {
      ...optionsFor(storage),
      repository: repo,
      validationSampleSize: 1,
    });
    const accepted = await new RevisionValidator().validate(revisionOf([fixOp(A.id, 'alpha-value')]), {
      ...optionsFor(storage),
      repository: repo,
    });
    expect(rejected.verdict).toBe('reject');
    expect(accepted.verdict).toBe('accept');
    expect(await snapshotCount(storage)).toBe(snapshots);
    expect(JSON.stringify((await storage.loadGraph()).entities.map((e) => [e.name, e.version ?? 1]))).toBe(before);
    const live = await repo.loadForContext({ role: 'solver', taskHint: A.input });
    expect(live.markdown).not.toContain(`FIX:${A.id}`);
    expect((await repo.getSnapshot(k0.id))?.digest).toBe(k0.digest);
  });

  it('rejects invalid options with RangeError', async () => {
    const storage = backend.create();
    const revision = revisionOf([]);
    await expect(new RevisionValidator().validate(revision, { ...optionsFor(storage), validationRepeats: 0 })).rejects.toThrow(RangeError);
    await expect(
      new RevisionValidator().validate(revision, { ...optionsFor(storage), affectedTaskIds: ['task-nope'] }),
    ).rejects.toThrow(RangeError);
    await expect(new RevisionValidator().validate(revision, { ...optionsFor(storage), validationSampleSize: -1 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('stratifiedSample', () => {
  const tasks: TaskRecord[] = [
    taskFor('t1', 'v', 'alpha'),
    taskFor('t2', 'v', 'alpha'),
    taskFor('t3', 'v', 'alpha'),
    taskFor('t4', 'v', 'beta'),
    taskFor('t5', 'v', 'beta'),
    taskFor('t6', 'v', 'beta'),
  ];

  it('is deterministic for a seed and covers every category when the size allows', () => {
    const first = [...stratifiedSample(tasks, 2, DEFAULT_VALIDATION_SEED)];
    const second = [...stratifiedSample(tasks, 2, DEFAULT_VALIDATION_SEED)];
    expect(first).toEqual(second);
    const categories = new Set(tasks.filter((t) => first.includes(t.id)).map((t) => t.category));
    expect(categories).toEqual(new Set(['alpha', 'beta']));
  });

  it('returns at most the number of candidates', () => {
    expect(stratifiedSample(tasks, 99, 'seed').size).toBe(6);
    expect(stratifiedSample([], 3, 'seed').size).toBe(0);
  });
});
