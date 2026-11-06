/**
 * Leaf learner: abort threading into the diagnoser (S1), durable failure-record dedup (S2) and
 * submit payload validation (N2).
 */
import { describe, it, expect } from 'vitest';
import { LeafLearner, type DiagnoserLike, type LeafStartOptions } from '../../../../src/agent/learning/LeafLearner.js';
import { Diagnoser } from '../../../../src/agent/learning/Diagnoser.js';
import { createLeafLearnerDeps } from '../../../../src/agent/learning/LeafLearnerDeps.js';
import { AbortError } from '../../../../src/agent/harness/ConcurrencyLimiter.js';
import type { LoadedKnowledge } from '../../../../src/agent/learning/types.js';
import type { TaskRecord } from '../../../../src/types/learning.js';
import type { IGraphStorage } from '../../../../src/types/types.js';
import type { FailureManager } from '../../../../src/agent/FailureManager.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { judge, makeRepo, makeTraces, scriptedEditor, scriptedSolver, stubDiagnoser, taskFor } from './leafFixtures.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');
const OPTS: LeafStartOptions = { taskIds: [A.id, B.id], tasks: [A, B], budget: { maxRounds: 2 }, validationSampleSize: 5 };
const K: LoadedKnowledge = { markdown: '', skillIds: [], instructionSetIds: [], failureIds: [], tokens: 0 };

/** Failure sink that counts records. */
function recorder(): { records: string[]; mgr: Pick<FailureManager, 'record'> } {
  const records: string[] = [];
  const mgr = {
    record: async () => {
      records.push(`f${records.length + 1}`);
      return { id: `f${records.length}` };
    },
  } as unknown as Pick<FailureManager, 'record'>;
  return { records, mgr };
}

/** Adapter over a real Diagnoser, as the facade builds it. */
function realDiagnoser(diagnoser: Diagnoser): DiagnoserLike {
  const none = (): never => {
    throw new Error('no context');
  };
  return createLeafLearnerDeps({ diagnoser, editor: {} as never, round: none, tasks: none, results: none, feedback: none, baseSnapshotId: none }).diagnoser;
}

/** Learner with the given diagnoser and an editor that proposes nothing. */
function build(storage: IGraphStorage, diagnoser: DiagnoserLike): LeafLearner {
  return new LeafLearner({ repository: makeRepo(storage), traces: makeTraces(storage), diagnoser, editor: scriptedEditor([]) });
}

describe('Diagnoser abort (S1)', () => {
  it('rejects with AbortError during the LLM call, with no fallback and no failure record', async () => {
    const { records, mgr } = recorder();
    const controller = new AbortController();
    const llm = { complete: () => new Promise<string>(() => undefined) } as unknown as PGCompletionProvider;
    const item = { task: A, result: { answer: 'no idea', traceAddrs: [] }, feedback: { taskId: A.id, allPass: false, source: 'judge' as const, criteria: [{ criterionId: 'c1', pass: false }] } };
    setTimeout(() => controller.abort(), 10);
    await expect(new Diagnoser({ failureManager: mgr, llmProvider: llm }).diagnose(0, [item], K, { signal: controller.signal })).rejects.toBeInstanceOf(AbortError);
    expect(records).toHaveLength(0);
  });
});

withBothBackends('LeafLearner abort and dedup', (backend) => {
  it('S1: an abort while diagnosing stops the run as aborted and persists it', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const diagnoser: DiagnoserLike = {
      async diagnose(failed, knowledge, signal, call) {
        seen = signal;
        controller.abort();
        if (signal?.aborted) throw new AbortError();
        return stubDiagnoser.diagnose(failed, knowledge, signal, call);
      },
    };
    const learner = build(backend.create(), diagnoser);
    const result = await learner.learn(OPTS, { solver: scriptedSolver({ passWithoutKnowledge: [B.id] }), judge, signal: controller.signal });
    expect(seen).toBe(controller.signal);
    expect(result.stoppedBecause).toBe('aborted');
    expect((await learner.state(result.traceId)).stop).toBe('aborted');
  });

  it('S2: a resume after the failure was recorded does not record it again', async () => {
    const storage = backend.create();
    const { records, mgr } = recorder();
    const first = realDiagnoser(new Diagnoser({ failureManager: mgr }));
    const crashing: DiagnoserLike = {
      async diagnose(...args) {
        await first.diagnose(...args);
        throw new Error('crash after diagnose');
      },
    };
    const solver = scriptedSolver({ passWithoutKnowledge: [B.id] });
    const learner = build(storage, crashing);
    await expect(learner.learn(OPTS, { solver, judge })).rejects.toThrow('crash after diagnose');
    expect(records).toHaveLength(1);
    const traces = makeTraces(storage);
    const all = (await storage.loadGraph()).entities.filter((e) => e.entityType === 'learning_trace');
    const traceId = all[0]!.name;
    const resumed = new LeafLearner({ repository: makeRepo(storage), traces, diagnoser: realDiagnoser(new Diagnoser({ failureManager: mgr })), editor: scriptedEditor([]) });
    const step = await resumed.next(traceId);
    expect(step.kind).toBe('done');
    expect(records).toHaveLength(1);
  });

  it('S2: two runs record separate failures', async () => {
    const { records, mgr } = recorder();
    const learner = build(backend.create(), realDiagnoser(new Diagnoser({ failureManager: mgr })));
    const solver = scriptedSolver({ passWithoutKnowledge: [B.id] });
    await learner.learn(OPTS, { solver, judge });
    await learner.learn(OPTS, { solver, judge });
    expect(records).toEqual(['f1', 'f2']);
  });

  it('N2: submit rejects an empty or malformed payload', async () => {
    const learner = build(backend.create(), stubDiagnoser);
    const { traceId } = await learner.start(OPTS);
    await expect(learner.submit(traceId, 'solve', {})).rejects.toThrow(/at least one pending task/);
    const bad = [{ answer: 1, traceAddrs: [] }, { answer: 'x' }, { answer: 'x', traceAddrs: [3] }, { answer: 'x', traceAddrs: [], tokens: { input: 'a', output: 1 } }];
    for (const value of bad) {
      await expect(learner.submit(traceId, 'solve', { [A.id]: value } as never)).rejects.toThrow(TypeError);
    }
    await expect(learner.submit(traceId, 'judge', { [A.id]: 'pass' } as never)).rejects.toThrow(/array or null/);
    expect((await learner.state(traceId)).pending).toEqual([A.id, B.id]);
    await learner.submit(traceId, 'solve', { [A.id]: { answer: 'x', traceAddrs: ['a'], tokens: { input: 1, output: 2 } } });
    expect((await learner.state(traceId)).pending).toEqual([B.id]);
  });
});
