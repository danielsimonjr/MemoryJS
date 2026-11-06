/** LeafLearner step API (RS-18): parity with learn(), and state surviving a reopen between steps. */
import { describe, it, expect } from 'vitest';
import { LeafLearner, type LeafStartOptions } from '../../../../src/agent/learning/LeafLearner.js';
import type { LearnResult, TaskRecord } from '../../../../src/types/learning.js';
import type { RevisionOp } from '../../../../src/types/skills.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { closeStorage, reopen } from '../knowledge/knowledgeFixtures.js';
import {
  breakOp,
  fixOp,
  judge,
  judgeAnswer,
  makeRepo,
  makeTraces,
  scriptedEditor,
  scriptedSolver,
  stubDiagnoser,
  taskFor,
  type SolverScript,
} from './leafFixtures.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');

/** Learner over `storage` with a fresh scripted editor. */
function build(storage: IGraphStorage, ops: RevisionOp[][]) {
  const repository = makeRepo(storage);
  const traces = makeTraces(storage);
  const learner = new LeafLearner({ repository, traces, diagnoser: stubDiagnoser, editor: scriptedEditor(ops) });
  return { storage, traces, learner };
}

/** Learning options over A and B. */
function optionsOf(overrides: Partial<LeafStartOptions> = {}): LeafStartOptions {
  return { taskIds: [A.id, B.id], tasks: [A, B], budget: { maxRounds: 4 }, validationSampleSize: 5, ...overrides };
}

/**
 * Drive the step API by hand, answering one task per submit, until the run is done.
 *
 * @param learner - Learner.
 * @param traceId - Root trace id.
 * @param solver - Solver answering each request.
 * @returns The result from the done step.
 */
async function driveStepwise(learner: LeafLearner, traceId: string, solver: ReturnType<typeof scriptedSolver>): Promise<LearnResult> {
  for (;;) {
    const step = await learner.next(traceId);
    if (step.kind === 'done') return step.result;
    if (step.kind === 'solve') {
      for (const entry of step.tasks) {
        await learner.submit(traceId, 'solve', { [entry.task.id]: await solver.solve(entry.task, entry.knowledge) });
      }
    } else {
      for (const entry of step.answers) {
        await learner.submit(traceId, 'judge', { [entry.task.id]: await judgeAnswer(entry.task, entry.answer) });
      }
    }
  }
}

/** Revisions recorded on the run's trace. */
async function revisionCount(traces: ReturnType<typeof makeTraces>, traceId: string): Promise<number> {
  return (await traces.get(traceId))?.revisionIds.length ?? 0;
}

const SCENARIOS: Array<{ name: string; ops: RevisionOp[][]; script: SolverScript; budget?: LeafStartOptions['budget'] }> = [
  { name: 'all-pass', ops: [], script: { passWithoutKnowledge: [A.id, B.id] } },
  { name: 'two accepted rounds', ops: [[fixOp(A.id, 'alpha-value')], [fixOp(B.id, 'beta-value')]], script: {} },
  { name: 'no-progress (no ops)', ops: [], script: { passWithoutKnowledge: [B.id] } },
  { name: 'no-progress (regression)', ops: [[fixOp(A.id, 'alpha-value'), breakOp(B.id)]], script: { passWithoutKnowledge: [B.id] } },
  { name: 'budget-rounds', ops: [[fixOp(A.id, 'alpha-value')]], script: { passWithoutKnowledge: [B.id] }, budget: { maxRounds: 1 } },
];

withBothBackends('LeafLearner step API parity with learn()', (backend) => {
  it.each(SCENARIOS)('$name: hand-driven start/next/submit equals learn()', async ({ ops, script, budget }) => {
    const opts = optionsOf(budget ? { budget } : {});
    const viaLearn = build(backend.create(), ops);
    const learned = await viaLearn.learner.learn(opts, { solver: scriptedSolver(script), judge });

    const viaSteps = build(backend.create(), ops);
    const state = await viaSteps.learner.start(opts);
    const stepped = await driveStepwise(viaSteps.learner, state.traceId, scriptedSolver(script));

    expect(stepped.stoppedBecause).toBe(learned.stoppedBecause);
    expect(stepped.before).toEqual(learned.before);
    expect(stepped.after).toEqual(learned.after);
    expect(await revisionCount(viaSteps.traces, stepped.traceId)).toBe(await revisionCount(viaLearn.traces, learned.traceId));
  });
});

withBothBackends('LeafLearner state survives reopen between steps', (backend) => {
  it('continues after a close and reopen mid-solve and at the judge boundary', async () => {
    const ops: RevisionOp[][] = [[fixOp(A.id, 'alpha-value')]];
    const solver = scriptedSolver({ passWithoutKnowledge: [B.id] });
    let storage = backend.create();
    let env = build(storage, ops);
    const reopenEnv = (): void => {
      const next = reopen(backend, storage);
      closeStorage(storage);
      storage = next;
      env = build(storage, ops);
    };
    try {
      const state = await env.learner.start(optionsOf());
      const traceId = state.traceId;
      const first = await env.learner.next(traceId);
      expect(first.kind).toBe('solve');
      if (first.kind !== 'solve') throw new Error('expected a solve request');
      const a = first.tasks.find((t) => t.task.id === A.id)!;
      await env.learner.submit(traceId, 'solve', { [A.id]: await solver.solve(a.task, a.knowledge) });

      reopenEnv();
      expect(await env.learner.state(traceId)).toMatchObject({ phase: 'solve', pending: [B.id] });

      const b = first.tasks.find((t) => t.task.id === B.id)!;
      await env.learner.submit(traceId, 'solve', { [B.id]: await solver.solve(b.task, b.knowledge) });
      expect(await env.learner.state(traceId)).toMatchObject({ phase: 'judge' });

      reopenEnv();
      const judging = await env.learner.next(traceId);
      expect(judging.kind).toBe('judge');
      if (judging.kind !== 'judge') throw new Error('expected a judge request');
      await env.learner.submit(traceId, 'judge', { [A.id]: await judgeAnswer(A, judging.answers[0]!.answer) });

      reopenEnv();
      const result = await driveStepwise(env.learner, traceId, solver);
      expect(result.stoppedBecause).toBe('all-pass');
      expect(result.before.allPass).toBe(0.5);
      expect(result.after.allPass).toBe(1);
      expect(await revisionCount(env.traces, traceId)).toBe(1);
    } finally {
      closeStorage(storage);
    }
  });
});
