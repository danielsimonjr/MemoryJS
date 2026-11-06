/**
 * 11 - Recursa bootstrapping: map a corpus, write notes and practice tasks, then learn.
 *
 * Run: bun run examples/11-recursa-bootstrap.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeterministicJudge,
  ManagerContext,
  type BootstrapLearner,
  type CorpusSource,
  type LearningSolver,
  type LoadedKnowledge,
  type SolveResult,
  type TaskRecord,
} from '../src/index.js';

const solver: LearningSolver = {
  async solve(task: TaskRecord, _knowledge: LoadedKnowledge): Promise<SolveResult> {
    return { answer: task.input, traceAddrs: [] };
  },
};

/** Six synthetic documents in two groups: enough for a navigation tree and a few tasks. */
function corpus(): CorpusSource[] {
  return Array.from({ length: 6 }, (_, i) => ({
    ref: `policy-${i}.md`,
    title: `Policy ${i}`,
    text: `Policy ${i} explains the ${i % 2 === 0 ? 'refund' : 'shipping'} rules for order batch ${i}.`,
    metadata: { group: i % 2 === 0 ? 'refunds' : 'shipping' },
  }));
}

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    // An injected learner records what it was asked to learn, then delegates to the real loop.
    const learnedTaskCounts: number[] = [];
    const learner: BootstrapLearner = {
      async learn(opts, deps) {
        learnedTaskCounts.push(opts.taskIds.length);
        return ctx.learningLoop(deps).learn(opts);
      },
    };

    const boot = ctx.bootstrapper({ learner });
    const out = await boot.run({
      sources: corpus(),
      solver,
      judge: new DeterministicJudge(),
      budget: { maxRounds: 1 },
      corpusLabel: 'policies',
      taskCount: 4,
    });

    const snapshot = await ctx.knowledgeRepository.getSnapshot(out.snapshotId);
    const notes = out.notesSkillId ? ctx.skillManager.get(out.notesSkillId) : undefined;

    return {
      navigationLevels: out.navigationMap.levels,
      practiceTaskCount: out.taskIds.length,
      learnerCalls: learnedTaskCounts.length,
      learnedSameTasks: learnedTaskCounts[0] === out.taskIds.length,
      snapshotLabel: snapshot?.label ?? null,
      notesSkillKind: notes?.kind ?? null,
      learnStopped: out.learn?.stoppedBecause ?? null,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-11-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
