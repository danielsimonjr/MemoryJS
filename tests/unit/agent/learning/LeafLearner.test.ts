/** LeafLearner (RS-18): every stop reason, abort, validation outcomes, trace actions. */
import { describe, it, expect } from 'vitest';
import { LeafLearner, type LeafStartOptions } from '../../../../src/agent/learning/LeafLearner.js';
import type { LearningDeps } from '../../../../src/agent/learning/types.js';
import type { TaskRecord } from '../../../../src/types/learning.js';
import type { RevisionOp } from '../../../../src/types/skills.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import {
  breakOp,
  fixOp,
  judge,
  makeTraces,
  makeRepo,
  scriptedEditor,
  scriptedSolver,
  stubDiagnoser,
  taskFor,
  type SolverScript,
} from './leafFixtures.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');

/** Build a learner over `storage` with a scripted editor. */
function build(storage: IGraphStorage, ops: RevisionOp[][], includeTraceAddrs = false) {
  const repository = makeRepo(storage);
  const traces = makeTraces(storage);
  const editor = scriptedEditor(ops);
  const learner = new LeafLearner({ repository, traces, diagnoser: stubDiagnoser, editor, includeTraceAddrs });
  return { storage, repository, traces, editor, learner };
}

/** Learning options over A and B. */
function optionsOf(overrides: Partial<LeafStartOptions> = {}): LeafStartOptions {
  return {
    taskIds: [A.id, B.id],
    tasks: [A, B],
    budget: { maxRounds: 4 },
    validationSampleSize: 5,
    ...overrides,
  };
}

/**
 * Run to completion in process with the scripted solver and the real judge.
 *
 * @param env - Learner environment.
 * @param opts - Learning options.
 * @param script - Solver behaviour.
 * @param signal - Optional abort signal.
 * @returns The learn result.
 */
async function runLearn(
  env: ReturnType<typeof build>,
  opts: LeafStartOptions,
  script: SolverScript,
  signal?: AbortSignal,
) {
  const deps: LearningDeps = { solver: scriptedSolver(script), judge, ...(signal ? { signal } : {}) };
  return env.learner.learn(opts, deps);
}

/** Two rounds: A is fixed in round 0, B in round 1. */
const TWO_ROUNDS: RevisionOp[][] = [[fixOp(A.id, 'alpha-value')], [fixOp(B.id, 'beta-value')]];

withBothBackends('LeafLearner stop reasons', (backend) => {
  it('all-pass: stops before any edit when every task passes', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const result = await runLearn(env, optionsOf(), { passWithoutKnowledge: [A.id, B.id] });
    expect(result.stoppedBecause).toBe('all-pass');
    expect(env.editor.calls).toBe(0);
    expect(result.before.allPass).toBe(1);
    expect(result.after).toEqual(result.before);
  });

  it('two accepted rounds end in all-pass with one revision per round', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const result = await runLearn(env, optionsOf(), {});
    expect(result.stoppedBecause).toBe('all-pass');
    expect((await env.traces.get(result.traceId))?.revisionIds).toHaveLength(2);
    expect(result.before.allPass).toBe(0);
    expect(result.after.allPass).toBe(1);
  });

  it('no-progress: a round whose edit has no ops', async () => {
    const env = build(backend.create(), []);
    const result = await runLearn(env, optionsOf(), { passWithoutKnowledge: [B.id] });
    expect(result.stoppedBecause).toBe('no-progress');
    expect(env.editor.calls).toBe(1);
    expect((await env.traces.get(result.traceId))?.revisionIds).toEqual([]);
  });

  it('no-progress: a fix that regresses a sampled task is rejected and K is unchanged', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value'), breakOp(B.id)]]);
    const before = await env.repository.snapshot('start');
    const result = await runLearn(env, optionsOf(), { passWithoutKnowledge: [B.id] });
    expect(result.stoppedBecause).toBe('no-progress');
    expect((await env.repository.getSnapshot(result.snapshotId))?.digest).toBe(before.digest);
    expect((await env.traces.get(result.traceId))?.revisionIds).toEqual([]);
  });

  it('budget-rounds: stops before round 2 once one round has been used', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const result = await runLearn(env, optionsOf({ budget: { maxRounds: 1 } }), {});
    expect(result.stoppedBecause).toBe('budget-rounds');
    expect((await env.traces.get(result.traceId))?.revisionIds).toHaveLength(1);
  });

  it('budget-tokens: solver token spend ends the run after an accepted round', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')]]);
    const result = await runLearn(env, optionsOf({ budget: { maxRounds: 4, maxTokens: 10 } }), {
      passWithoutKnowledge: [B.id],
      tokens: { input: 5, output: 5 },
    });
    expect(result.stoppedBecause).toBe('budget-tokens');
  });

  it('budget-time: a spent wall-clock budget stops the run mid-round, after the solve stage', async () => {
    const env = build(backend.create(), [[fixOp(A.id, 'alpha-value')]]);
    const busyWait = (): void => {
      const until = Date.now() + 5;
      while (Date.now() < until) { /* spend the 1 ms budget */ }
    };
    const result = await runLearn(env, optionsOf({ budget: { maxRounds: 4, maxWallClockMs: 1 } }), {
      passWithoutKnowledge: [B.id],
      onFirstCall: busyWait,
    });
    expect(result.stoppedBecause).toBe('budget-time');
    expect(env.editor.calls).toBe(0);
  });

  it('start rejects zero, negative, NaN and infinite token or time budgets', async () => {
    const env = build(backend.create(), []);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(env.learner.start(optionsOf({ budget: { maxRounds: 1, maxWallClockMs: bad } }))).rejects.toThrow(/maxWallClockMs/);
      await expect(env.learner.start(optionsOf({ budget: { maxRounds: 1, maxTokens: bad } }))).rejects.toThrow(/maxTokens/);
    }
  });

  it('aborted: an abort signal already raised stops before any edit', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const controller = new AbortController();
    controller.abort();
    const result = await runLearn(env, optionsOf(), {}, controller.signal);
    expect(result.stoppedBecause).toBe('aborted');
    expect(env.editor.calls).toBe(0);
  });

  it('aborted: an abort during a solve stops the run', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const controller = new AbortController();
    const deps: LearningDeps = {
      solver: scriptedSolver({ onFirstCall: () => controller.abort() }),
      judge,
      signal: controller.signal,
    };
    const result = await env.learner.learn(optionsOf(), deps);
    expect(result.stoppedBecause).toBe('aborted');
  });

  it('abort() on a started run stops it with reason aborted', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const state = await env.learner.start(optionsOf());
    const stopped = await env.learner.abort(state.traceId);
    expect(stopped).toMatchObject({ phase: 'done', stop: 'aborted' });
    const step = await env.learner.next(state.traceId);
    expect(step).toMatchObject({ kind: 'done', result: { stoppedBecause: 'aborted' } });
  });
});

withBothBackends('LeafLearner trace and validation', (backend) => {
  it('records phases as trace actions with no addresses when no InteractionLog is configured', async () => {
    const env = build(backend.create(), TWO_ROUNDS, false);
    const result = await runLearn(env, optionsOf(), {});
    const trace = await env.traces.get(result.traceId);
    const kinds = new Set(trace?.actions.map((a) => a.kind));
    expect(kinds).toEqual(new Set(['solve', 'diagnose', 'edit', 'validate']));
    expect(trace?.actions.every((a) => a.addrs.length === 0)).toBe(true);
    expect(trace?.metrics.allPass).toBe(1);
  });

  it('keeps solver addresses on actions when an InteractionLog is configured', async () => {
    const env = build(backend.create(), TWO_ROUNDS, true);
    const result = await runLearn(env, optionsOf(), {});
    const addrs = (await env.traces.get(result.traceId))?.actions.flatMap((a) => a.addrs) ?? [];
    expect(addrs.some((addr) => addr.startsWith('interaction://log/'))).toBe(true);
  });

  it('learn requires a judge', async () => {
    const env = build(backend.create(), []);
    await expect(env.learner.learn(optionsOf(), { solver: scriptedSolver({}) } as unknown as LearningDeps)).rejects.toThrow(
      /judge/,
    );
  });

  it('rejects invalid options and unknown task ids', async () => {
    const env = build(backend.create(), []);
    await expect(env.learner.start(optionsOf({ budget: { maxRounds: 0 } }))).rejects.toThrow(RangeError);
    await expect(env.learner.start(optionsOf({ taskIds: [A.id, A.id] }))).rejects.toThrow(RangeError);
    await expect(env.learner.start(optionsOf({ taskIds: ['task-missing'] }))).rejects.toThrow(RangeError);
  });

  it('a submit with an id that is not pending is refused', async () => {
    const env = build(backend.create(), TWO_ROUNDS);
    const state = await env.learner.start(optionsOf());
    await expect(env.learner.submit(state.traceId, 'solve', { 'task-zzz': null })).rejects.toThrow(/not pending/);
  });
});
