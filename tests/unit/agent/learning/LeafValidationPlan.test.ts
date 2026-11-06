/**
 * Validation knowledge and plan (S3): the scratch copy ranks skills with the same matcher as live
 * `K`, the plan is computed once and persisted, and a live `K` that moves mid-validation rejects
 * the revision as `validation-stale`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ManagerContext } from '../../../../src/core/ManagerContext.js';
import { ScratchKnowledge } from '../../../../src/agent/knowledge/ScratchKnowledge.js';
import { LeafLearner, type LeafStartOptions } from '../../../../src/agent/learning/LeafLearner.js';
import type { TaskRecord } from '../../../../src/types/learning.js';
import { cleanupTempDirs, makeTempJsonlPath, withBothBackends } from '../../../helpers/tempStorage.js';
import { fakeFailures, makeRevision, skillInput } from '../knowledge/knowledgeFixtures.js';
import { fixOp, judgeAnswer, makeRepo, makeTraces, scriptedEditor, scriptedSolver, stubDiagnoser, taskFor } from './leafFixtures.js';

const A: TaskRecord = taskFor('task-a', 'alpha-value');
const B: TaskRecord = taskFor('task-b', 'beta-value');
const OPTS: LeafStartOptions = { taskIds: [A.id, B.id], tasks: [A, B], budget: { maxRounds: 4 }, validationSampleSize: 5 };

describe('ScratchKnowledge matcher (S3)', () => {
  const saved = process.env.MEMORY_EMBEDDING_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = saved;
    cleanupTempDirs();
  });

  it('cloneForValidation ranks skills exactly like the live SkillManager', async () => {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const ctx = new ManagerContext(makeTempJsonlPath());
    try {
      const specs: Array<[string, string]> = [
        ['tax', 'quarterly tax filing deadlines'],
        ['rev', 'quarterly revenue table lookup'],
        ['cats', 'feeding schedule for cats'],
        ['mixed', 'revenue and tax summary for the quarter'],
      ];
      for (const [name, description] of specs) {
        await ctx.skillManager.add(skillInput(name, { description, scope: { domains: ['finance'] } }));
      }
      const scratch = await ctx.knowledgeRepository.cloneForValidation();
      for (const hint of ['quarterly revenue', 'tax deadlines this quarter', 'cats', 'finance summary', 'unrelated words']) {
        const live = await ctx.knowledgeRepository.loadForContext({ role: 'solver', taskHint: hint });
        const copy = await scratch.loadForContext({ role: 'solver', taskHint: hint });
        expect(copy.skillIds).toEqual(live.skillIds);
        expect(copy.markdown).toBe(live.markdown);
      }
    } finally {
      ctx.close();
    }
  });

  it('uses an injected matcher and skips retired skills', async () => {
    const calls: string[] = [];
    const skills = [
      { ...skillInput('one'), id: 'one', createdAt: '', lastUpdatedAt: '', stats: { applied: 0, helped: 0, hurt: 0 } },
      { ...skillInput('two'), id: 'two', createdAt: '', lastUpdatedAt: '', stats: { applied: 0, helped: 0, hurt: 0 }, retired: { at: '', reason: 'x' } },
    ] as never;
    const scratch = new ScratchKnowledge({ instructionSets: [], skills }, fakeFailures([]), {
      matcher: (query, candidates) => {
        calls.push(`${query}:${candidates.map((s) => s.id).join(',')}`);
        return candidates;
      },
    });
    const loaded = await scratch.loadForContext({ role: 'solver', taskHint: 'anything' });
    expect(calls).toEqual(['anything:one']);
    expect(loaded.skillIds).toEqual(['one']);
  });
});

withBothBackends('LeafLearner validation plan (S3)', (backend) => {
  it('computes the plan once and persists it across repeats and steps', async () => {
    const storage = backend.create();
    const repository = makeRepo(storage);
    let clones = 0;
    const clone = repository.cloneForValidation.bind(repository);
    repository.cloneForValidation = () => {
      clones += 1;
      return clone();
    };
    const learner = new LeafLearner({ repository, traces: makeTraces(storage), diagnoser: stubDiagnoser, editor: scriptedEditor([[fixOp(A.id, 'alpha-value')]]) });
    const result = await learner.learn({ ...OPTS, validationRepeats: 3 }, { solver: scriptedSolver({ passWithoutKnowledge: [B.id] }), judge: { judge: (t, a) => judgeAnswer(t, a) } });
    expect(result.stoppedBecause).toBe('all-pass');
    expect(clones).toBe(1);
  });

  it('rejects the revision as validation-stale when live K changes mid-validation', async () => {
    const storage = backend.create();
    const repository = makeRepo(storage);
    const traces = makeTraces(storage);
    const learner = new LeafLearner({ repository, traces, diagnoser: stubDiagnoser, editor: scriptedEditor([[fixOp(A.id, 'alpha-value')]]) });
    const solver = scriptedSolver({ passWithoutKnowledge: [B.id] });
    const { traceId } = await learner.start(OPTS);
    for (;;) {
      const step = await learner.next(traceId);
      if (step.kind === 'done') throw new Error('finished before validation');
      if ((await learner.state(traceId)).phase === 'validate') break;
      if (step.kind === 'solve') {
        for (const e of step.tasks) await learner.submit(traceId, 'solve', { [e.task.id]: await solver.solve(e.task, e.knowledge) });
      } else {
        for (const e of step.answers) await learner.submit(traceId, 'judge', { [e.task.id]: await judgeAnswer(e.task, e.answer) });
      }
    }
    const base = await repository.snapshot('interloper-base');
    expect((await repository.applyRevision(makeRevision('interloper', base.id, [fixOp('zzz', 'q')]), { expectedSnapshotId: base.id })).status).toBe('applied');
    const step = await learner.next(traceId);
    expect(step.kind).toBe('done');
    if (step.kind === 'done') expect(step.result.stoppedBecause).toBe('no-progress');
    const outcomes = (await traces.get(traceId))!.actions.map((a) => a.outcome);
    expect(outcomes.some((o) => o.startsWith('validation-stale'))).toBe(true);
  });
});
