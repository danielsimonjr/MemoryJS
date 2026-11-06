/**
 * 10 - Recursa learning loop: run-to-completion `learn`, then the step-wise protocol.
 *
 * Run: bun run examples/10-recursa-learning.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeterministicJudge,
  ManagerContext,
  type LearningSolver,
  type LoadedKnowledge,
  type SolveResult,
  type TaskRecord,
} from '../src/index.js';

const tasks: TaskRecord[] = [
  { id: 'task-refund', input: 'Refund a duplicate charge', category: 'billing', rubric: [
    { id: 'c1', text: 'Names the refund action', kind: 'fact', expected: 'refund' },
  ] },
  { id: 'task-reset', input: 'Reset a locked account', category: 'auth', rubric: [
    { id: 'c1', text: 'Mentions the reset link', kind: 'fact', expected: 'reset link' },
  ] },
  { id: 'task-invoice', input: 'Resend an invoice', category: 'billing', rubric: [
    { id: 'c1', text: 'Mentions the invoice', kind: 'fact', expected: 'invoice' },
  ] },
];

/** Answers correctly only when its loaded knowledge mentions the task id (a learned skill). */
const solver: LearningSolver = {
  async solve(task: TaskRecord, knowledge: LoadedKnowledge): Promise<SolveResult> {
    const answer = knowledge.markdown.includes(task.id)
      ? task.rubric.map((c) => String(c.expected)).join(' ')
      : 'I am not sure';
    return { answer, traceAddrs: [] };
  },
};

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  try {
    const judge = new DeterministicJudge();

    // Run to completion in-process: solve, judge, diagnose and edit over the tasks. With
    // the deterministic diagnoser a three-task run may stop with no progress; this example
    // demonstrates the protocol and the result shape, not a particular score.
    const loop = ctx.learningLoop({ solver, judge });
    const result = await loop.learn({ taskIds: tasks.map((t) => t.id), tasks, budget: { maxRounds: 3 } });

    // Step-wise protocol: the caller drives solve and judge steps itself.
    const stepLoop = ctx.learningLoop({ solver, judge });
    const started = await stepLoop.start({ taskIds: tasks.slice(0, 2).map((t) => t.id), tasks: tasks.slice(0, 2), budget: { maxRounds: 1 } });
    const traceId = started.traceId;
    let request = await stepLoop.next(traceId);
    let steps = 0;
    while (request.kind !== 'done' && steps++ < 20) {
      if (request.kind === 'solve') {
        const payload: Record<string, SolveResult> = {};
        for (const { task, knowledge } of request.tasks) payload[task.id] = await solver.solve(task, knowledge);
        await stepLoop.submit(traceId, 'solve', payload);
      } else if (request.kind === 'judge') {
        const payload: Record<string, Awaited<ReturnType<DeterministicJudge['judge']>>> = {};
        for (const answer of request.answers) payload[answer.task.id] = await judge.judge(answer.task, answer.answer);
        await stepLoop.submit(traceId, 'judge', payload);
      }
      request = await stepLoop.next(traceId);
    }
    const status = await stepLoop.status(traceId);

    return {
      stoppedBecause: result.stoppedBecause,
      tasksBefore: result.before.tasks,
      tasksAfter: result.after.tasks,
      allPassBefore: result.before.allPass,
      allPassAfter: result.after.allPass,
      traceIdIsString: typeof result.traceId === 'string' && result.traceId.length > 0,
      stepProtocolFinished: request.kind === 'done',
      stepPhase: status.phase,
      stepRequestsHandled: steps,
    };
  } finally {
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-10-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
