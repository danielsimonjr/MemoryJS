/**
 * `ManagerContext.learningLoop(deps)` (Recursa Phase 4, leaf-only factory).
 *
 * - Nothing is constructed until the factory is called.
 * - `learn` with the real Diagnoser and KnowledgeEditor (fallback, no LLM): one task fails for
 *   missing knowledge, the editor's `skill.add` teaches it, and the run stops `all-pass` in the
 *   second learning round.
 * - The stepwise `start` / `next` / `submit` / `status` path reaches `done` the same way.
 * - The Phase 5 operations throw.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import type { LearnResult, SolveResult, TaskRecord } from '../../../src/types/learning.js';
import type { LoadedKnowledge, LearningSolver as Solver } from '../../../src/agent/learning/types.js';
import type { LearningLoop } from '../../../src/core/context/LearningFacade.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import { InteractionLog } from '../../../src/agent/harness/InteractionLog.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { makeTempDir, makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../helpers/tempStorage.js';

const JUDGE = new DeterministicJudge();

/** Storage backends under test. */
const BACKENDS = [
  { name: 'jsonl', storageType: 'jsonl' as const, newPath: makeTempJsonlPath },
  { name: 'sqlite', storageType: 'sqlite' as const, newPath: makeTempSqlitePath },
] as const;

/**
 * Task whose rubric expects `expected` and whose source document is absent from knowledge, so the
 * fallback diagnoser classifies a failure as `missing-knowledge`.
 *
 * @param id - Task id.
 * @param expected - Expected answer text.
 * @returns The task.
 */
function taskWithSource(id: string, expected: string): TaskRecord {
  return {
    id,
    input: `${id} general question`,
    category: 'general',
    sources: [{ ref: `doc-${id}`, kind: 'document' }],
    rubric: [{ id: 'c1', text: 'states the value', kind: 'fact', expected }],
  };
}

/**
 * Solver that answers the expected value when the knowledge carries `Learned: <taskId>` (the name of
 * the skill the fallback editor adds for that task), or when the task passes without knowledge.
 *
 * @param passWithout - Task ids that pass without any knowledge.
 * @returns The solver.
 */
function skillSolver(passWithout: readonly string[]): Solver {
  const passes = new Set(passWithout);
  return {
    async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
      const learned = knowledge.markdown.includes(`Learned: ${task.id}`);
      const expected = String(task.rubric[0]!.expected);
      const answer = passes.has(task.id) || learned ? expected : 'no idea';
      return { answer, traceAddrs: [] };
    },
  };
}

/** Three tasks: `task-b` fails until its skill is learned. */
const TASKS = [taskWithSource('task-a', 'alpha'), taskWithSource('task-b', 'beta'), taskWithSource('task-c', 'gamma')];
const TASK_IDS = TASKS.map((t) => t.id);
const PASSING = ['task-a', 'task-c'];

describe.each(BACKENDS)('ManagerContext.learningLoop on $name storage', (backend) => {
  const contexts: ManagerContext[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['MEMORY_STORAGE_TYPE', 'MEMORY_EMBEDDING_PROVIDER']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
  });

  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanupTempDirs();
  });

  /**
   * Fresh context on this backend.
   *
   * @returns The context.
   */
  function newCtx(): ManagerContext {
    const ctx = new ManagerContext({ storagePath: backend.newPath(), storageType: backend.storageType });
    contexts.push(ctx);
    return ctx;
  }

  it('constructs nothing until learningLoop is called', () => {
    const ctx = newCtx();
    const cache = ctx as unknown as { _knowledgeRepository?: unknown; _skillManager?: unknown };
    expect(cache._knowledgeRepository).toBeUndefined();
    expect(cache._skillManager).toBeUndefined();
    const loop = ctx.learningLoop({ solver: skillSolver(PASSING), judge: JUDGE });
    expect(loop.learn).toBeTypeOf('function');
    expect(cache._knowledgeRepository).toBeDefined();
    expect(cache._skillManager).toBeDefined();
  });

  it('learn: the fallback skill fixes the failing task, so the run stops all-pass in the second round', async () => {
    const ctx = newCtx();
    const loop = ctx.learningLoop({ solver: skillSolver(PASSING), judge: JUDGE });
    const result: LearnResult = await loop.learn({ taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } });

    expect(result.stoppedBecause).toBe('all-pass');
    expect(result.before.allPass).toBeCloseTo(2 / 3);
    expect(result.after.allPass).toBe(1);
    // The run's state records the round it stopped in: round 0 failed, round 1 (second) passed.
    expect((await loop.status(result.traceId)).round).toBe(1);
    const skills = await ctx.skillManager.list();
    expect(skills.some((s) => s.name === 'Learned: task-b')).toBe(true);
  });

  it('stepwise start / next / submit reaches done with the same outcome', async () => {
    const ctx = newCtx();
    const solver = skillSolver(PASSING);
    const loop: LearningLoop = ctx.learningLoop({ solver, judge: JUDGE });
    const started = await loop.start({ taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } });
    const traceId = started.traceId;

    let step = await loop.next(traceId);
    let guard = 0;
    while (step.kind !== 'done') {
      if (++guard > 50) throw new Error('stepwise run did not finish');
      if (step.kind === 'solve') {
        const payload: Record<string, SolveResult | null> = {};
        for (const entry of step.tasks) payload[entry.task.id] = await solver.solve(entry.task, entry.knowledge);
        await loop.submit(traceId, 'solve', payload);
      } else {
        const payload: Record<string, Awaited<ReturnType<typeof JUDGE.judge>> | null> = {};
        for (const entry of step.answers) payload[entry.task.id] = await JUDGE.judge(entry.task, entry.answer);
        await loop.submit(traceId, 'judge', payload);
      }
      step = await loop.next(traceId);
    }
    expect(step.result.stoppedBecause).toBe('all-pass');
    expect((await loop.status(traceId)).phase).toBe('done');
  });

  it('S7: an interaction log reaches the diagnoser and solve addresses land on the trace; status carries the report', async () => {
    const ctx = newCtx();
    const log = new InteractionLog(join(makeTempDir('recursa-log-'), 'interactions.jsonl'));
    let selects = 0;
    const select = log.select.bind(log);
    log.select = ((...args: Parameters<typeof select>) => {
      selects += 1;
      return select(...args);
    }) as typeof log.select;
    const inner = skillSolver(PASSING);
    const solver: Solver = {
      async solve(task, knowledge) {
        const result = await inner.solve(task, knowledge);
        const addr = await log.append({ sessionId: 's1', kind: 'tool_output', content: `${task.id}: ${result.answer}` });
        return { ...result, traceAddrs: [addr] };
      },
    };
    const loop = ctx.learningLoop({ solver, judge: JUDGE, interactionLog: log });
    const result = await loop.learn({ taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } });
    expect(result.stoppedBecause).toBe('all-pass');
    expect(selects).toBeGreaterThan(0);
    const entity = (await ctx.storage.loadGraph()).entities.find((e) => e.name === result.traceId) as unknown as {
      learningTraceRecord: { actions: Array<{ kind: string; addrs: string[] }> };
    };
    const solveActions = entity.learningTraceRecord.actions.filter((a) => a.kind === 'solve');
    expect(solveActions.length).toBeGreaterThan(0);
    expect(solveActions.every((a) => a.addrs.length === TASKS.length)).toBe(true);
    const status = await loop.status(result.traceId);
    expect(status.report.rounds).toBe(2);
    expect(status.phase).toBe('done');
  });

  it('B2: an unwritable publishDir keeps the revision applied and the run continues', async () => {
    const ctx = newCtx();
    const blocker = join(makeTempDir('recursa-publish-'), 'not-a-dir');
    writeFileSync(blocker, 'file in the way');
    const loop = ctx.learningLoop({ solver: skillSolver(PASSING), judge: JUDGE, publishDir: join(blocker, 'skills') });
    const result = await loop.learn({ taskIds: TASK_IDS, tasks: TASKS, budget: { maxRounds: 3 } });
    expect(result.stoppedBecause).toBe('all-pass');
    const entity = (await ctx.storage.loadGraph()).entities.find((e) => e.name === result.traceId) as unknown as {
      learningTraceRecord: { revisionIds: string[]; actions: Array<{ outcome: string }> };
    };
    expect(entity.learningTraceRecord.revisionIds).toHaveLength(1);
    expect(entity.learningTraceRecord.actions.some((a) => a.outcome.startsWith('publish-failed: '))).toBe(true);
  });

  it('the Phase 5 operations throw a clear error', () => {
    const ctx = newCtx();
    const loop = ctx.learningLoop({ solver: skillSolver(PASSING), judge: JUDGE });
    expect(() => loop.plan()).toThrow(/Phase 5/);
    expect(() => loop.submitChild()).toThrow(/Phase 5/);
    expect(() => loop.merge()).toThrow(/Phase 5/);
    expect(() => loop.reflect()).toThrow(/Phase 5/);
  });
});
