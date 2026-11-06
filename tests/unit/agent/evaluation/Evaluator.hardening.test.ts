/**
 * Evaluator hardening: prototype-named categories and ids (B1), invalid weights (B2),
 * duplicate task ids (N3).
 */
import { describe, it, expect } from 'vitest';
import { Evaluator, stratifiedSplit, type Solver } from '../../../../src/agent/evaluation/Evaluator.js';
import { DeterministicJudge } from '../../../../src/agent/evaluation/DeterministicJudge.js';
import type { TaskRecord } from '../../../../src/types/learning.js';

const echo: Solver = async (task) => task.input;
const fact = (id: string, input: string, category?: string, weight?: number): TaskRecord => ({
  id,
  input,
  ...(category !== undefined ? { category } : {}),
  rubric: [{ id: 'c', text: 'x', kind: 'fact', expected: 'yes', ...(weight !== undefined ? { weight } : {}) }],
});

describe('Evaluator byCategory with prototype names (B1)', () => {
  it('keeps __proto__ and constructor categories as own entries', async () => {
    const tasks = [fact('t1', 'yes', '__proto__'), fact('t2', 'no', 'constructor'), fact('t3', 'yes', 'toString')];
    const { metrics } = await new Evaluator().evaluate(tasks, echo, new DeterministicJudge());
    expect(Object.keys(metrics.byCategory).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(metrics.byCategory, '__proto__')?.value).toEqual({
      tasks: 1, allPass: 1, meanCriteria: 1,
    });
    expect(metrics.byCategory['constructor']).toEqual({ tasks: 1, allPass: 0, meanCriteria: 0 });
  });

  it('stratifiedSplit does not read prototype members of a Record prior', () => {
    const tasks = [fact('constructor', 'a'), fact('toString', 'b'), fact('real', 'c')];
    const { train, test } = stratifiedSplit(tasks, { testFraction: 0.5, by: 'priorPassRate', seed: 1, prior: { real: true } });
    expect([...train, ...test]).toHaveLength(3);
    // constructor and toString share the 'unknown' stratum (two tasks -> one per side).
    const unknown = [...train, ...test].filter((t) => t.id !== 'real');
    expect(train.filter((t) => unknown.includes(t))).toHaveLength(1);
  });

  it('stratifiedSplit ignores prototype keys of an EvalMetrics prior', () => {
    const tasks = [fact('a', 'x', 'constructor'), fact('b', 'y', 'constructor')];
    const prior = { tasks: 0, allPass: 0, meanCriteria: 0, byCategory: {} };
    expect(() => stratifiedSplit(tasks, { testFraction: 0.5, by: 'priorPassRate', seed: 2, prior })).not.toThrow();
  });
});

describe('Evaluator invalid weights (B2)', () => {
  for (const weight of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
    it(`uses weight 1 and notes it for ${weight}`, async () => {
      const task: TaskRecord = {
        id: 't',
        input: 'yes',
        rubric: [
          { id: 'bad', text: 'x', kind: 'fact', expected: 'yes', weight },
          { id: 'ok', text: 'y', kind: 'fact', expected: 'nope' },
        ],
      };
      const { metrics, feedback } = await new Evaluator().evaluate([task], echo, new DeterministicJudge());
      expect(metrics.meanCriteria).toBe(0.5);
      expect(metrics.meanCriteria).toBeGreaterThanOrEqual(0);
      expect(metrics.meanCriteria).toBeLessThanOrEqual(1);
      expect(feedback[0]!.criteria[0]!.note).toBe('invalid weight; using 1');
      expect(feedback[0]!.criteria[1]!.note).toBeUndefined();
    });
  }

  it('keeps a zero weight: counts toward allPass, not meanCriteria', async () => {
    const task: TaskRecord = {
      id: 't',
      input: 'yes',
      rubric: [
        { id: 'zero', text: 'x', kind: 'fact', expected: 'absent', weight: 0 },
        { id: 'one', text: 'y', kind: 'fact', expected: 'yes' },
      ],
    };
    const { metrics, feedback } = await new Evaluator().evaluate([task], echo, new DeterministicJudge());
    expect(metrics.meanCriteria).toBe(1);
    expect(metrics.allPass).toBe(0);
    expect(feedback[0]!.criteria[0]!.note).toBeUndefined();
  });
});

describe('duplicate task ids (N3)', () => {
  const dup = [fact('a', 'yes'), fact('b', 'yes'), fact('a', 'no'), fact('b', 'no'), fact('c', 'x')];
  it('Evaluator.evaluate rejects with the duplicated ids', async () => {
    await expect(new Evaluator().evaluate(dup, echo, new DeterministicJudge())).rejects.toThrow(
      'Evaluator.evaluate: duplicate task ids: a, b',
    );
  });
  it('stratifiedSplit throws with the duplicated ids', () => {
    expect(() => stratifiedSplit(dup, { testFraction: 0.5, by: 'difficulty', seed: 1 })).toThrow(
      'stratifiedSplit: duplicate task ids: a, b',
    );
  });
});
