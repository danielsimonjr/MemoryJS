/**
 * Unit tests for Evaluator metrics and stratifiedSplit.
 *
 * @module tests/unit/agent/evaluation/Evaluator
 */

import { describe, it, expect } from 'vitest';
import { Evaluator, stratifiedSplit, type Solver } from '../../../../src/agent/evaluation/Evaluator.js';
import { DeterministicJudge } from '../../../../src/agent/evaluation/DeterministicJudge.js';
import type { EvalMetrics, TaskRecord } from '../../../../src/types/learning.js';

const tasks: TaskRecord[] = [
  {
    id: 't1',
    input: 'q1',
    category: 'a',
    rubric: [
      { id: 'c1', text: 'capital', kind: 'fact', expected: 'Paris' },
      { id: 'c2', text: 'count', kind: 'number', expected: 42, weight: 3 },
    ],
  },
  {
    id: 't2',
    input: 'q2',
    category: 'a',
    rubric: [{ id: 'c1', text: 'capital', kind: 'fact', expected: 'Rome' }],
  },
  {
    id: 't3',
    input: 'q3',
    rubric: [{ id: 'c1', text: 'vibe', kind: 'free' }],
  },
];

const answers: Record<string, string> = {
  t1: 'Paris, 41 items',
  t2: 'Rome it is',
  t3: 'nice',
};
const solver: Solver = async (task) => answers[task.id]!;

describe('Evaluator.evaluate metrics', () => {
  it('matches hand-computed weighted metrics and per-category breakdown', async () => {
    const { metrics, feedback } = await new Evaluator().evaluate(tasks, solver, new DeterministicJudge());
    // t1: c1 pass (w1), c2 fail (w3) -> 0.25 ; t2: pass -> 1 ; t3: free fails -> 0
    expect(metrics.tasks).toBe(3);
    expect(metrics.allPass).toBeCloseTo(1 / 3, 10);
    expect(metrics.meanCriteria).toBeCloseTo((0.25 + 1 + 0) / 3, 10);
    expect(metrics.byCategory).toEqual({
      a: { tasks: 2, allPass: 0.5, meanCriteria: 0.625 },
      uncategorized: { tasks: 1, allPass: 0, meanCriteria: 0 },
    });
    expect(feedback.map((f) => f.taskId)).toEqual(['t1', 't2', 't3']);
    expect(feedback[2]!.criteria[0]!.note).toBe('needs judge');
  });

  it('returns zeroed metrics for no tasks', async () => {
    const { metrics, feedback } = await new Evaluator().evaluate([], solver, new DeterministicJudge());
    expect(metrics).toEqual({ tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} });
    expect(feedback).toEqual([]);
  });

  it('a task with an empty rubric is not all-passing', async () => {
    const empty: TaskRecord[] = [{ id: 'e', input: 'x', rubric: [] }];
    const { metrics } = await new Evaluator().evaluate(empty, solver, new DeterministicJudge());
    expect(metrics.allPass).toBe(0);
    expect(metrics.meanCriteria).toBe(0);
  });

  it('passes knowledge through to the solver', async () => {
    const seen: Array<string | undefined> = [];
    const spy: Solver = async (_task, ctx) => {
      seen.push(ctx.knowledge);
      return 'Paris 42';
    };
    await new Evaluator().evaluate(tasks, spy, new DeterministicJudge(), { knowledge: 'K' });
    expect(seen).toEqual(['K', 'K', 'K']);
  });

  it('a solver failure fails every criterion with a note and does not throw', async () => {
    const failing: Solver = async (task) => {
      if (task.id === 't2') throw new Error('boom');
      return answers[task.id]!;
    };
    const { metrics, feedback } = await new Evaluator().evaluate(tasks, failing, new DeterministicJudge());
    expect(feedback[1]).toEqual({
      taskId: 't2',
      allPass: false,
      source: 'judge',
      criteria: [{ criterionId: 'c1', pass: false, note: 'solver failed: boom' }],
    });
    expect(metrics.allPass).toBeCloseTo(0, 10);
    expect(metrics.byCategory.a!.meanCriteria).toBeCloseTo(0.25 / 2, 10);
  });

  it('a judge failure fails every criterion with a note and does not throw', async () => {
    const broken = { judge: async () => Promise.reject(new Error('judge down')) };
    const { feedback } = await new Evaluator().evaluate(tasks, solver, broken);
    expect(feedback[0]!.criteria.every((c) => c.note === 'judge failed: judge down')).toBe(true);
    expect(feedback[0]!.allPass).toBe(false);
  });

  it('an aborted run completes without throwing and marks tasks as not completed', async () => {
    const controller = new AbortController();
    controller.abort();
    const { metrics, feedback } = await new Evaluator().evaluate(tasks, solver, new DeterministicJudge(), {
      signal: controller.signal,
    });
    expect(metrics.tasks).toBe(3);
    expect(metrics.allPass).toBe(0);
    expect(feedback.every((f) => f.criteria.every((c) => c.note?.startsWith('not completed')))).toBe(true);
  });
});

/** Build n tasks with alternating difficulty and optional category. */
function bulk(n: number): TaskRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    input: `q${i}`,
    difficulty: i % 2 === 0 ? 'easy' : 'hard',
    category: i < n / 2 ? 'strong' : 'weak',
    rubric: [],
  }));
}

describe('stratifiedSplit', () => {
  it('is reproducible for a seed and differs for another seed', () => {
    const data = bulk(20);
    const opts = { testFraction: 0.3, by: 'difficulty' as const, seed: 7 };
    const first = stratifiedSplit(data, opts);
    const again = stratifiedSplit(data, opts);
    expect(again.test.map((t) => t.id)).toEqual(first.test.map((t) => t.id));
    const other = stratifiedSplit(data, { ...opts, seed: 8 });
    expect(other.test.map((t) => t.id)).not.toEqual(first.test.map((t) => t.id));
  });

  it('partitions every task exactly once, keeping input order on each side', () => {
    const data = bulk(20);
    const { train, test } = stratifiedSplit(data, { testFraction: 0.25, by: 'difficulty', seed: 1 });
    expect(train.length + test.length).toBe(20);
    const ids = [...train, ...test].map((t) => t.id).sort();
    expect(ids).toEqual(data.map((t) => t.id).sort());
    const order = data.map((t) => t.id);
    expect(train.map((t) => t.id)).toEqual(order.filter((id) => train.some((t) => t.id === id)));
  });

  it('splits each difficulty stratum to the requested fraction', () => {
    const data = bulk(20); // 10 easy, 10 hard
    const { test } = stratifiedSplit(data, { testFraction: 0.3, by: 'difficulty', seed: 3 });
    const easy = test.filter((t) => t.difficulty === 'easy').length;
    const hard = test.filter((t) => t.difficulty === 'hard').length;
    expect(easy).toBe(3);
    expect(hard).toBe(3);
  });

  it('keeps at least one task on each side of a stratum of two or more', () => {
    const data = bulk(4); // 2 easy, 2 hard
    const { train, test } = stratifiedSplit(data, { testFraction: 0.01, by: 'difficulty', seed: 2 });
    for (const label of ['easy', 'hard']) {
      expect(test.some((t) => t.difficulty === label)).toBe(true);
      expect(train.some((t) => t.difficulty === label)).toBe(true);
    }
  });

  it('stratifies by prior pass rate taken from an EvalMetrics prior', () => {
    const data = bulk(12); // 6 strong, 6 weak categories
    const prior: EvalMetrics = {
      tasks: 12,
      allPass: 0.5,
      meanCriteria: 0.5,
      byCategory: {
        strong: { tasks: 6, allPass: 0.9, meanCriteria: 0.9 },
        weak: { tasks: 6, allPass: 0.1, meanCriteria: 0.1 },
      },
    };
    const { test } = stratifiedSplit(data, { testFraction: 0.5, by: 'priorPassRate', seed: 5, prior });
    expect(test.filter((t) => t.category === 'strong')).toHaveLength(3);
    expect(test.filter((t) => t.category === 'weak')).toHaveLength(3);
  });

  it('stratifies by prior pass/fail from a per-task record', () => {
    const data = bulk(8);
    const prior: Record<string, boolean> = Object.fromEntries(data.map((t, i) => [t.id, i < 4]));
    const { test } = stratifiedSplit(data, { testFraction: 0.5, by: 'priorPassRate', seed: 9, prior });
    expect(test.filter((t) => prior[t.id])).toHaveLength(2);
    expect(test.filter((t) => !prior[t.id])).toHaveLength(2);
  });

  it('requires a prior for priorPassRate', () => {
    expect(() => stratifiedSplit(bulk(4), { testFraction: 0.5, by: 'priorPassRate', seed: 1 })).toThrow(/requires a prior/);
  });

  it('rejects a testFraction outside [0, 1]', () => {
    expect(() => stratifiedSplit(bulk(4), { testFraction: 1.5, by: 'difficulty', seed: 1 })).toThrow(RangeError);
  });
});
