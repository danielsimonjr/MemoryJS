/** Bootstrapper (RS-13): end-to-end over real storage with an injected learner, snapshot labelled `bootstrap`. */
import { describe, it, expect } from 'vitest';
import { Bootstrapper, type BootstrapLearner } from '../../../../src/agent/bootstrap/Bootstrapper.js';
import { isKnowledgeSnapshotEntity } from '../../../../src/types/agent-memory.js';
import type { LearnResult } from '../../../../src/types/learning.js';
import type { LearningSolver } from '../../../../src/agent/learning/types.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { realKnowledge, syntheticCorpus } from './bootstrapFixtures.js';

const EMPTY_METRICS = { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} };

/** Learner stub that records what it was asked to learn. */
function stubLearner(): BootstrapLearner & { seen: string[][] } {
  const learner = {
    seen: [] as string[][],
    async learn(opts: { taskIds: string[] }): Promise<LearnResult> {
      learner.seen.push(opts.taskIds);
      return {
        snapshotId: 'K-0',
        traceId: 'trace-stub',
        before: EMPTY_METRICS,
        after: EMPTY_METRICS,
        stoppedBecause: 'all-pass',
      };
    },
  };
  return learner;
}

/** Solver that always answers with an empty string. */
const silentSolver: LearningSolver = {
  async solve() {
    return { answer: '', traceAddrs: [] };
  },
};

/** Labels of the knowledge snapshots in storage. */
async function snapshotLabels(storage: Parameters<typeof realKnowledge>[0]): Promise<Array<string | undefined>> {
  return (await storage.loadGraph()).entities
    .filter(isKnowledgeSnapshotEntity)
    .map((e) => e.knowledgeSnapshotRecord.label);
}

withBothBackends('Bootstrapper', (backend) => {
  it('runs map, boundaries, notes, tasks and learning, then snapshots as bootstrap', async () => {
    const storage = backend.create();
    const { skills, repository } = realKnowledge(storage);
    const learner = stubLearner();
    const boot = new Bootstrapper({ storage, skills, repository, learner });
    const out = await boot.run({
      sources: syntheticCorpus(50, 5),
      solver: silentSolver,
      budget: { maxRounds: 2 },
      corpusLabel: 'invoices',
      taskCount: 8,
    });

    expect(out.navigationMap.levels).toBeGreaterThanOrEqual(2);
    expect(out.navigationMap.rootId).toBeDefined();
    expect(out.taskIds.length).toBe(8);
    expect(learner.seen).toEqual([out.taskIds]);
    expect(out.learn?.stoppedBecause).toBe('all-pass');
    expect(skills.get(out.notesSkillId)?.kind).toBe('convention');

    const labels = await snapshotLabels(storage);
    expect(labels).toContain('bootstrap');
    const snapshot = (await storage.loadGraph()).entities
      .filter(isKnowledgeSnapshotEntity)
      .find((e) => e.knowledgeSnapshotRecord.label === 'bootstrap');
    expect(snapshot?.knowledgeSnapshotRecord.id).toBe(out.snapshotId);
  });

  it('skips learning when no solver is given but still snapshots', async () => {
    const storage = backend.create();
    const { skills, repository } = realKnowledge(storage);
    const learner = stubLearner();
    const out = await new Bootstrapper({ storage, skills, repository, learner }).run({
      sources: syntheticCorpus(10, 2),
      budget: { maxRounds: 1 },
    });
    expect(out.learn).toBeUndefined();
    expect(learner.seen).toEqual([]);
    expect(await snapshotLabels(storage)).toContain('bootstrap');
  });

  it('handles an empty corpus without throwing', async () => {
    const storage = backend.create();
    const { skills, repository } = realKnowledge(storage);
    const out = await new Bootstrapper({ storage, skills, repository }).run({
      sources: [],
      solver: silentSolver,
      budget: { maxRounds: 1 },
    });
    expect(out.navigationMap).toEqual({ rootId: undefined, levels: 0, nodeCount: 0, conflicts: [] });
    expect(out.taskIds).toEqual([]);
    expect(out.learn).toBeUndefined();
    expect(await snapshotLabels(storage)).toContain('bootstrap');
  });

  it('runs the default LeafLearner wiring end to end with a silent solver', async () => {
    const storage = backend.create();
    const { skills, repository } = realKnowledge(storage);
    const out = await new Bootstrapper({ storage, skills, repository }).run({
      sources: syntheticCorpus(6, 2),
      solver: silentSolver,
      budget: { maxRounds: 1 },
      taskCount: 3,
    });
    expect(out.learn).toBeDefined();
    expect(out.learn!.before.tasks).toBe(3);
    expect(await snapshotLabels(storage)).toContain('bootstrap');
  });
});
