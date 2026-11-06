/**
 * ManagerContext.learningLoop recursive operations (Recursa RS-21, spec section 3.7).
 *
 * Covers the facade loop (`plan` / `submitChild` / `merge` / `reflect` / `status` / `childDriver`) over
 * a real context on both backends, hand-driven parity with `learn()`, and the in-process subagent
 * path (`createInProcessLearnHandler` + `InProcessSubagentRunner`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { LearningLoop } from '../../../src/core/context/LearningFacade.js';
import type { RecursiveState } from '../../../src/agent/learning/RecursiveLearnerState.js';
import { createInProcessLearnHandler } from '../../../src/agent/learning/InProcessLearnHandler.js';
import { InProcessSubagentRunner } from '../../../src/agent/harness/ConcurrencyLimiter.js';
import type { LearningSolver } from '../../../src/agent/learning/types.js';
import type { LearnResult, TaskRecord } from '../../../src/types/learning.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import { expectedOf, taskFor } from '../agent/learning/leafFixtures.js';

const judge = new DeterministicJudge();
/**
 * Six fact tasks. Each cites a document (so a missing-knowledge diagnosis and a `Learned: <id>` skill
 * follow) and its input shares tokens with that skill, so the skill is matched when it is loaded.
 */
/** Distinct criterion words per task: near-identical skills would be merged as duplicates (RevisionMerger). */
const WORDS = ['granite meadow compass', 'harbor lantern pebble', 'zephyr orchard quartz', 'velvet thimble walrus', 'cobalt saddle yarrow', 'marble prism tundra'];
const TASKS: TaskRecord[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ({
  ...taskFor(`task-${k}`, `${k}-value`),
  input: `Learned task-${k}`,
  sources: [{ ref: `doc-${k}`, kind: 'document' as const }],
  rubric: [{ id: 'c1', text: `states ${WORDS[i]}`, kind: 'fact' as const, expected: `${k}-value` }],
}));
const TASK_IDS = TASKS.map((t) => t.id);

/** Control task: answered without knowledge; the revision must not regress it. */
const CONTROL_ID = 'task-f';

/**
 * Solver that answers correctly only when the task's learned skill (`Learned: <taskId>`, as the
 * deterministic editor names it) is in the loaded knowledge, except for the control task.
 */
const knowledgeSolver: LearningSolver = {
  async solve(task, knowledge) {
    const known = task.id === CONTROL_ID || knowledge.markdown.includes(`Learned: ${task.id}`);
    return { answer: known ? expectedOf(task) : 'unknown', traceAddrs: [] };
  },
};

/** Options of every run in this file. */
const RUN = { taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 6 }, validationSampleSize: 6, leafThreshold: 4 };

let tempDirs: string[] = [];
let contexts: ManagerContext[] = [];
let previousType: string | undefined;

/**
 * Open a fresh context over the given backend.
 *
 * @param backend - Storage backend to use.
 * @returns The context.
 */
function openContext(backend: 'jsonl' | 'sqlite'): ManagerContext {
  const dir = mkdtempSync(join(tmpdir(), 'recursa-learnloop-'));
  tempDirs.push(dir);
  process.env.MEMORY_STORAGE_TYPE = backend;
  const context = new ManagerContext(join(dir, backend === 'sqlite' ? 'memory.db' : 'memory.jsonl'));
  contexts.push(context);
  return context;
}

/**
 * Drive a recursive run by hand through the facade operations until it is done.
 *
 * @param loop - Learning loop of the context.
 * @param traceId - Run trace id.
 * @param deps - Solver and judge the children and merge calls use.
 * @param deps.solver - Solver for children and validation.
 * @returns The final status.
 */
async function driveByHand(loop: LearningLoop, traceId: string, deps: { solver: LearningSolver }) {
  const handle = createInProcessLearnHandler(loop, { solver: deps.solver, judge });
  for (let guard = 0; guard < 200; guard++) {
    const status = (await loop.status(traceId)) as RecursiveState & { report: unknown };
    if (status.phase === 'done') return status;
    if (status.phase === 'plan') {
      await loop.plan(traceId);
    } else if (status.phase === 'children') {
      const pending = status.childTraceIds.filter((id) => !status.completedChildIds.includes(id));
      for (const child of pending) {
        await handle({ kind: 'learn', input: { childTraceId: child } });
        await loop.submitChild(traceId, child);
      }
      if (pending.length === 0) await loop.merge(traceId);
    } else if (status.phase === 'merge') {
      await loop.merge(traceId);
    } else if (status.phase === 'reflect') {
      await loop.reflect(traceId);
    }
  }
  throw new Error('driveByHand: run did not finish');
}

describe.each(['jsonl', 'sqlite'] as const)('ManagerContext.learningLoop recursive [%s]', (backend) => {
  beforeEach(() => {
    previousType = process.env.MEMORY_STORAGE_TYPE;
  });

  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
    if (previousType === undefined) delete process.env.MEMORY_STORAGE_TYPE;
    else process.env.MEMORY_STORAGE_TYPE = previousType;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs = [];
  });

  it('plan/submitChild/merge/reflect reach done with at least one revision applied', async () => {
    const context = openContext(backend);
    const loop = context.learningLoop({ solver: knowledgeSolver, judge });
    const start = await loop.start(RUN);
    expect(start.phase).toBe('plan');

    const final = await driveByHand(loop, start.traceId, { solver: knowledgeSolver });
    expect(final.phase).toBe('done');
    expect(final.stop).toBe('all-pass');
    const learned = (await context.skillManager.list()).filter((s) => s.name.startsWith('Learned: '));
    expect(learned.length).toBeGreaterThanOrEqual(1);
  });

  it('hand-driven steps reach the same outcome as learn()', async () => {
    const byHand = openContext(backend);
    const handLoop = byHand.learningLoop({ solver: knowledgeSolver, judge });
    const handStart = await handLoop.start(RUN);
    const handFinal = await driveByHand(handLoop, handStart.traceId, { solver: knowledgeSolver });

    const inProcess = openContext(backend);
    const result: LearnResult = await inProcess.learningLoop({ solver: knowledgeSolver, judge }).learn(RUN);

    expect(result.stoppedBecause).toBe('all-pass');
    expect(handFinal.stop).toBe(result.stoppedBecause);
    expect(result.before.allPass).toBeLessThan(result.after.allPass as number);
  });

  it('createInProcessLearnHandler behind InProcessSubagentRunner matches the in-process run', async () => {
    const inProcess = openContext(backend);
    const reference = await inProcess.learningLoop({ solver: knowledgeSolver, judge }).learn(RUN);

    const hosted = openContext(backend);
    const loop = hosted.learningLoop({ solver: knowledgeSolver, judge });
    const runner = new InProcessSubagentRunner({
      learn: createInProcessLearnHandler(loop, { solver: knowledgeSolver, judge }),
    });
    const start = await loop.start(RUN);
    for (let guard = 0; guard < 200; guard++) {
      const status = (await loop.status(start.traceId)) as RecursiveState;
      if (status.phase === 'done') break;
      if (status.phase === 'plan') await loop.plan(start.traceId);
      else if (status.phase === 'children') {
        for (const child of status.childTraceIds.filter((id) => !status.completedChildIds.includes(id))) {
          await runner.run({ kind: 'learn', input: { childTraceId: child } });
          await loop.submitChild(start.traceId, child);
        }
        if (status.childTraceIds.every((id) => status.completedChildIds.includes(id))) await loop.merge(start.traceId);
      } else if (status.phase === 'merge') await loop.merge(start.traceId);
      else if (status.phase === 'reflect') await loop.reflect(start.traceId);
    }
    const hostedStatus = (await loop.status(start.traceId)) as RecursiveState;
    expect(hostedStatus.stop).toBe(reference.stoppedBecause);
    expect(hostedStatus.phase).toBe('done');
  });

  it('status exposes the learning report for a recursive run', async () => {
    const context = openContext(backend);
    const loop = context.learningLoop({ solver: knowledgeSolver, judge });
    const result = await loop.learn(RUN);
    const status = (await loop.status(result.traceId)) as RecursiveState & { report: unknown };
    expect(status.report).toBeDefined();
    expect(status.phase).toBe('done');
    expect(status.stop).toBe('all-pass');
  });

  it('routes small runs without split to the leaf learner', async () => {
    const context = openContext(backend);
    const loop = context.learningLoop({ solver: knowledgeSolver, judge });
    const small = await loop.start({ ...RUN, taskIds: TASK_IDS.slice(0, 2), tasks: TASKS.slice(0, 2) });
    expect(small).not.toHaveProperty('childTraceIds');
    const leaf = await loop.learn({ ...RUN, taskIds: TASK_IDS.slice(0, 2), tasks: TASKS.slice(0, 2) });
    expect(leaf.stoppedBecause).toBe('all-pass');
  });
});
