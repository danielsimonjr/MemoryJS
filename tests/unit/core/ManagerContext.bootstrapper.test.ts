/**
 * ManagerContext.bootstrapper (Recursa Phase 5, spec section 3.7): laziness, a run over 12 synthetic
 * sources with an injected learner stub, and a run with the real learner wired through learningLoop.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { Bootstrapper } from '../../../src/agent/bootstrap/Bootstrapper.js';
import { skillNameFor } from '../../../src/agent/bootstrap/ExplorationNotes.js';
import { syntheticCorpus } from '../agent/bootstrap/bootstrapFixtures.js';
import type { LearningSolver } from '../../../src/agent/learning/types.js';
import type { LearnResult } from '../../../src/types/learning.js';

let dirs: string[] = [];
let contexts: ManagerContext[] = [];
let previousType: string | undefined;

/**
 * Open a context on a fresh JSONL file.
 *
 * @returns The context.
 */
function openContext(): ManagerContext {
  const dir = mkdtempSync(join(tmpdir(), 'recursa-bootstrap-'));
  dirs.push(dir);
  const context = new ManagerContext(join(dir, 'memory.jsonl'));
  contexts.push(context);
  return context;
}

/** Solver that answers correctly once the exploration-notes skill is in the loaded knowledge. */
function notesSolver(): LearningSolver {
  return {
    async solve(task, knowledge) {
      const notes = skillNameFor('corpus');
      const answer = knowledge.markdown.includes(notes) ? 'answer' : 'unknown';
      return { answer: answer === 'answer' ? task.rubric[0]?.expected?.toString() ?? 'answer' : answer, traceAddrs: [] };
    },
  };
}

describe('ManagerContext.bootstrapper', () => {
  beforeEach(() => {
    previousType = process.env.MEMORY_STORAGE_TYPE;
    process.env.MEMORY_STORAGE_TYPE = 'jsonl';
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    if (previousType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = previousType;
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it('is lazy: building a bootstrapper writes nothing and runs no learner', async () => {
    const ctx = openContext();
    const before = (await ctx.storage.loadGraph()).entities.length;
    const bootstrapper = ctx.bootstrapper();
    expect(bootstrapper).toBeInstanceOf(Bootstrapper);
    expect((await ctx.storage.loadGraph()).entities.length).toBe(before);
  });

  it('runs map, notes, tasks and an injected learner over 12 sources, snapshotting as bootstrap', async () => {
    const ctx = openContext();
    const sources = syntheticCorpus(12, 5);
    const calls: Array<{ taskIds: string[]; solver: unknown }> = [];
    const stub = {
      async learn(opts: { taskIds: string[] }, deps: { solver: unknown }): Promise<LearnResult> {
        calls.push({ taskIds: opts.taskIds, solver: deps.solver });
        return { snapshotId: 'K-stub', traceId: 'trace-stub', before: { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} }, after: { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} }, stoppedBecause: 'all-pass' } as unknown as LearnResult;
      },
    };
    const bootstrapper = ctx.bootstrapper({ learner: stub });
    const out = await bootstrapper.run({
      sources,
      solver: notesSolver(),
      budget: { maxRounds: 2 },
      corpusLabel: 'corpus',
    });

    expect(out.navigationMap.rootId).toBeDefined();
    expect(out.navigationMap.nodeCount).toBeGreaterThan(0);
    const notes = ctx.skillManager.get(out.notesSkillId);
    expect(notes?.name).toBe(skillNameFor('corpus'));
    expect(out.taskIds.length).toBe(12);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.taskIds).toEqual(out.taskIds);
    expect(out.learn?.stoppedBecause).toBe('all-pass');
    const graph = await ctx.storage.loadGraph();
    const taskEntities = graph.entities.filter((e) => out.taskIds.includes(e.name));
    expect(taskEntities.length).toBe(12);
    const snapshot = graph.entities.find((e) => e.entityType === 'knowledge_snapshot' && e.name === out.snapshotId);
    expect(snapshot ?? graph.entities.find((e) => e.name === out.snapshotId)).toBeDefined();
    expect(graph.entities.some((e) => (e as { knowledgeSnapshotRecord?: { label?: string } }).knowledgeSnapshotRecord?.label === 'bootstrap')).toBe(true);
  });

  it('learns through learningLoop with the real learner when a solver is given', async () => {
    const ctx = openContext();
    const out = await ctx.bootstrapper().run({
      sources: syntheticCorpus(12, 5),
      solver: notesSolver(),
      budget: { maxRounds: 2 },
      corpusLabel: 'corpus',
      taskCount: 6,
    });
    expect(out.learn).toBeDefined();
    expect(out.learn!.traceId).toBeTruthy();
    expect(out.taskIds.length).toBe(6);
  });
});
