/** RecursiveLearner (Recursa RS-21): budgets, recursion limits, isolation, end-to-end, step parity, reopen. */
import { describe, it, expect } from 'vitest';
import type { LeafLearner } from '../../../../src/agent/learning/LeafLearner.js';
import type { RecursiveState } from '../../../../src/agent/learning/RecursiveLearnerState.js';
import type { LearnResult, TaskRecord } from '../../../../src/types/learning.js';
import { withBothBackends } from '../../../helpers/tempStorage.js';
import { closeStorage, reopen } from '../knowledge/knowledgeFixtures.js';
import { judge, scriptedSolver, taskFor } from './leafFixtures.js';
import { TASKS, buildRecursive, fixEditor, noopEditor, selectiveEditor, splitBySize, throwingDiagnoser, type Built } from './recursiveFixtures.js';
import type { TraceTree } from '../../../../src/agent/learning/LearningTrace.js';

const ALL_IDS = TASKS.map((t) => t.id);

/** Options over the four fixture tasks. */
function opts(overrides: Record<string, unknown> = {}) {
  return { taskIds: ALL_IDS, tasks: TASKS, budget: { maxRounds: 4 }, validationSampleSize: 5, ...overrides };
}

/**
 * Drive one leaf child by hand: answer each solve and judge request in turn.
 *
 * @param leaf - Leaf learner of the child.
 * @param childId - Child trace id.
 * @param solver - Solver answering each request.
 */
async function stepLeaf(leaf: LeafLearner, childId: string, solver: ReturnType<typeof scriptedSolver>): Promise<void> {
  for (;;) {
    const step = await leaf.next(childId);
    if (step.kind === 'done') return;
    if (step.kind === 'solve') {
      for (const entry of step.tasks) {
        await leaf.submit(childId, 'solve', { [entry.task.id]: await solver.solve(entry.task, entry.knowledge) });
      }
    } else {
      for (const entry of step.answers) {
        await leaf.submit(childId, 'judge', { [entry.task.id]: await judge.judge(entry.task, entry.answer) });
      }
    }
  }
}

/**
 * Drive a run to completion by hand: plan, child by child, merge, reflect.
 *
 * @param built - Learner and stores.
 * @param traceId - Run trace id.
 * @param solver - Solver for children and validation.
 * @returns The result.
 */
async function handDrive(built: Built, traceId: string, solver: ReturnType<typeof scriptedSolver>): Promise<LearnResult> {
  const { learner } = built;
  for (;;) {
    const state: RecursiveState = await learner.state(traceId);
    if (state.phase === 'done') return learner.result(traceId);
    if (state.phase === 'plan') {
      await learner.plan(traceId);
    } else if (state.phase === 'children') {
      const pending = state.childTraceIds.filter((id) => !state.completedChildIds.includes(id));
      if (pending.length === 0) {
        await learner.merge(traceId, { solver, judge });
        continue;
      }
      for (const childId of pending) {
        await stepLeaf((await learner.childDriver(childId)) as LeafLearner, childId, solver);
        await learner.submitChild(traceId, childId);
      }
    } else {
      await learner.reflect(traceId);
    }
  }
}

/**
 * Depth of every node in a trace tree (root is 0), with its learner kind.
 *
 * @param tree - Tree from `LearningTrace.load`.
 * @param depth - Depth of `tree`.
 * @returns Pairs of depth and learner kind.
 */
function nodesOf(tree: TraceTree, depth = 0): Array<{ depth: number; kind: string }> {
  return [{ depth, kind: tree.record.learnerKind }, ...tree.children.flatMap((c) => nodesOf(c, depth + 1))];
}

describe('RecursiveLearner budgets and recursion limits', () => {
  withBothBackends('RecursiveLearner budgets', (backend) => {
    it('maxDepth 1 makes every child a leaf learner', async () => {
      const built = buildRecursive(backend.create(), { split: splitBySize(2) });
      const solver = scriptedSolver({ passWithoutKnowledge: ALL_IDS });
      const result = await built.learner.learn(opts({ maxDepth: 1, leafThreshold: 0 }), { solver, judge });
      expect(result.stoppedBecause).toBe('all-pass');
      const started = await built.learner.state(result.traceId);
      expect(started.childTraceIds).toHaveLength(2);
      const tree = await built.traces.load(result.traceId);
      expect(tree.children.map((c) => c.record.learnerKind)).toEqual(['leaf', 'leaf']);
    });

    it('maxChildren caps the subsets of a round and keeps every task', async () => {
      const five = [...TASKS, taskFor('task-e', 'e-value')];
      const built = buildRecursive(backend.create(), { split: splitBySize(1) });
      const started = await built.learner.start(
        opts({ taskIds: five.map((t) => t.id), tasks: five, budget: { maxRounds: 2, maxChildren: 2 } }),
      );
      const planned = await built.learner.plan(started.traceId);
      expect(planned.childTraceIds).toHaveLength(2);
      expect(planned.subsets.flatMap((s) => s.taskIds).sort()).toEqual(five.map((t) => t.id).sort());
      expect(planned.subsets[1]!.taskIds).toHaveLength(4);
    });

    it('maxDepth is a hard stop even with leafThreshold 0', async () => {
      const built = buildRecursive(backend.create(), { split: splitBySize(2) });
      const solver = scriptedSolver({ passWithoutKnowledge: ALL_IDS });
      const result = await built.learner.learn(opts({ maxDepth: 2, leafThreshold: 0 }), { solver, judge });
      expect(result.stoppedBecause).toBe('all-pass');
      const nodes = nodesOf(await built.traces.load(result.traceId));
      expect(Math.max(...nodes.map((n) => n.depth))).toBe(2);
      for (const node of nodes.filter((n) => n.depth === 2)) expect(node.kind).toBe('leaf');
    });
  });
});

describe('RecursiveLearner rounds and isolation', () => {
  withBothBackends('RecursiveLearner rounds', (backend) => {
    it('end-to-end: a task passes only once its skill is in LoadedKnowledge; one reflection per round', async () => {
      const built = buildRecursive(backend.create());
      const solver = scriptedSolver({});
      const result = await built.learner.learn(opts(), { solver, judge });
      expect(result.before.allPass).toBe(0);
      expect(result.after.allPass).toBe(1);
      expect(result.stoppedBecause).toBe('all-pass');
      const reflections = await built.reflections.list({ scope: 'learning' });
      expect(reflections).toHaveLength(1);
    });

    it('two rounds write two reflections, each citing the child traces that exist', async () => {
      const built = buildRecursive(backend.create(), { editor: selectiveEditor(['task-c', 'task-d']) });
      const result = await built.learner.learn(opts(), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('no-progress');
      expect(result.after.allPass).toBe(0.5);
      const reflections = await built.reflections.list({ scope: 'learning' });
      expect(reflections).toHaveLength(2);
      for (const reflection of reflections) {
        expect(reflection.evidence.length).toBeGreaterThan(0);
        for (const name of reflection.evidence) expect(await built.traces.get(name)).toBeDefined();
      }
    });

    it('no-progress: a round that accepts no edit stops the run', async () => {
      const built = buildRecursive(backend.create(), { editor: noopEditor });
      const result = await built.learner.learn(opts(), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('no-progress');
      expect(result.after.allPass).toBe(0);
      expect(await built.reflections.list({ scope: 'learning' })).toHaveLength(1);
    });

    it('child failure is isolated: a throwing child is recorded and its sibling still improves', async () => {
      const built = buildRecursive(backend.create(), {
        split: splitBySize(1),
        diagnoser: throwingDiagnoser([TASKS[0]!.id]),
      });
      const result = await built.learner.learn(opts(), { solver: scriptedSolver({}), judge });
      expect(result.stoppedBecause).toBe('no-progress');
      expect(result.after.allPass).toBe(0.75);
      const state = await built.learner.state(result.traceId);
      const failed = Object.values(state.children).filter((c) => c.failure !== undefined);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.failure).toContain('diagnoser boom');
      expect(failed[0]!.improved).toBe(false);
    });
  });
});

describe('RecursiveLearner step parity and resume', () => {
  withBothBackends('RecursiveLearner step API', (backend) => {
    it('hand-driven plan/submitChild/merge/reflect equals learn()', async () => {
      const viaLearn = await buildRecursive(backend.create(), { editor: fixEditor(1) }).learner.learn(opts(), {
        solver: scriptedSolver({}),
        judge,
      });
      const byHand = buildRecursive(backend.create(), { editor: fixEditor(1) });
      const started = await byHand.learner.start(opts());
      const result = await handDrive(byHand, started.traceId, scriptedSolver({}));
      expect(result.stoppedBecause).toBe(viaLearn.stoppedBecause);
      expect(result.before).toEqual(viaLearn.before);
      expect(result.after).toEqual(viaLearn.after);
    });

    it('state survives a reopen between phases', async () => {
      const storage1 = backend.create();
      const first = buildRecursive(storage1, { editor: fixEditor(1) });
      const started = await first.learner.start(opts());
      await first.learner.plan(started.traceId);
      const firstChild = (await first.learner.state(started.traceId)).childTraceIds[0]!;
      await stepLeaf((await first.learner.childDriver(firstChild)) as LeafLearner, firstChild, scriptedSolver({}));
      await first.learner.submitChild(started.traceId, firstChild);
      closeStorage(storage1);

      const storage2 = reopen(backend, storage1);
      const second = buildRecursive(storage2, { editor: fixEditor(1) });
      const resumed = await second.learner.state(started.traceId);
      expect(resumed.completedChildIds).toEqual([firstChild]);
      const result = await handDrive(second, started.traceId, scriptedSolver({}));
      expect(result.stoppedBecause).toBe('all-pass');
      expect(result.after.allPass).toBe(1);
      closeStorage(storage2);
    });
  });
});
