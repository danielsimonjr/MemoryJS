/**
 * LearningAccountant (RS-23): rework only when the knowledge digest is unchanged, stall sums,
 * `exceeded` for each budget dimension, phase timing with a fake clock, and report shape.
 */
import { describe, it, expect } from 'vitest';
import { LearningAccountant } from '../../../../src/agent/learning/LearningAccountant.js';
import type { LearningBudget } from '../../../../src/types/learning.js';

/** Manually advanced clock for deterministic timing. */
function fakeClock(start = 1_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const BIG: LearningBudget = { maxRounds: 100, maxTokens: 1e9, maxWallClockMs: 1e12 };

describe('LearningAccountant rework', () => {
  it('counts a repeat solve when the digest is unchanged', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordSolve('task-1', 'digest-A');
    expect(acct.report().rework).toBe(0);
    acct.recordSolve('task-1', 'digest-A');
    expect(acct.report().rework).toBe(1);
  });

  it('does not count a solve after the digest changed', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordSolve('task-1', 'digest-A');
    acct.recordSolve('task-1', 'digest-B');
    acct.recordSolve('task-1', 'digest-C');
    expect(acct.report().rework).toBe(0);
    acct.recordSolve('task-1', 'digest-C');
    expect(acct.report().rework).toBe(1);
  });

  it('does not count different tasks with the same digest as rework', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordSolve('task-1', 'digest-A');
    acct.recordSolve('task-2', 'digest-A');
    expect(acct.report().rework).toBe(0);
  });

  it('counts a diagnosis repeated for the same failure id only', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordDiagnosis('failure-1');
    acct.recordDiagnosis('failure-2');
    expect(acct.report().rework).toBe(0);
    acct.recordDiagnosis('failure-1');
    expect(acct.report().rework).toBe(1);
  });

  it('records solve tokens against the solve phase', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordSolve('task-1', 'digest-A', { input: 10, output: 4 });
    expect(acct.report().tokensByPhase.solve).toEqual({ input: 10, output: 4 });
  });
});

describe('LearningAccountant signals and stalls', () => {
  it('sums stalls and signals and ignores invalid input', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordStall(120);
    acct.recordStall(30.5);
    acct.recordStall(-5);
    acct.recordStall(Number.NaN);
    acct.recordSolverSignal(3);
    acct.recordSolverSignal(2);
    acct.recordLearnerSignal(7);
    const report = acct.report();
    expect(report.stalls).toBe(150.5);
    expect(report.solverSignals).toBe(5);
    expect(report.learnerSignals).toBe(7);
  });
});

describe('LearningAccountant exceeded', () => {
  it('returns null while every limit has headroom', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    expect(acct.exceeded(BIG)).toBeNull();
  });

  it('reports budget-rounds once maxRounds rounds are recorded', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.recordRound();
    expect(acct.exceeded({ maxRounds: 2 })).toBeNull();
    acct.recordRound();
    expect(acct.exceeded({ maxRounds: 2 })).toBe('budget-rounds');
  });

  it('reports budget-tokens when input plus output reaches maxTokens', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.addTokens('solve', 60, 30);
    expect(acct.exceeded({ maxRounds: 10, maxTokens: 91 })).toBeNull();
    acct.addTokens('judge', 1, 0);
    expect(acct.exceeded({ maxRounds: 10, maxTokens: 91 })).toBe('budget-tokens');
  });

  it('reports budget-time when elapsed wall-clock reaches maxWallClockMs', () => {
    const clock = fakeClock();
    const acct = new LearningAccountant({ now: clock.now });
    clock.advance(999);
    expect(acct.exceeded({ maxRounds: 10, maxWallClockMs: 1000 })).toBeNull();
    clock.advance(1);
    expect(acct.exceeded({ maxRounds: 10, maxWallClockMs: 1000 })).toBe('budget-time');
  });

  it('checks rounds before tokens and tokens before time', () => {
    const clock = fakeClock();
    const acct = new LearningAccountant({ now: clock.now });
    acct.recordRound();
    acct.addTokens('solve', 5, 5);
    clock.advance(500);
    expect(acct.exceeded({ maxRounds: 1, maxTokens: 10, maxWallClockMs: 100 })).toBe('budget-rounds');
    expect(acct.exceeded({ maxRounds: 2, maxTokens: 10, maxWallClockMs: 100 })).toBe('budget-tokens');
    expect(acct.exceeded({ maxRounds: 2, maxTokens: 11, maxWallClockMs: 100 })).toBe('budget-time');
  });
});

describe('LearningAccountant phase timing', () => {
  it('accumulates wall-clock per phase with a fake clock', () => {
    const clock = fakeClock(0);
    const acct = new LearningAccountant({ now: clock.now });
    acct.startPhase('solve');
    clock.advance(250);
    acct.endPhase('solve');
    acct.startPhase('judge');
    clock.advance(40);
    acct.endPhase('judge');
    acct.startPhase('solve');
    clock.advance(10);
    acct.endPhase('solve');
    const report = acct.report();
    expect(report.wallClockByPhase.solve).toBe(260);
    expect(report.wallClockByPhase.judge).toBe(40);
    expect(report.wallClockByPhase.edit).toBe(0);
    expect(report.elapsedMs).toBe(300);
  });

  it('leaves an open phase out of its timing until it ends', () => {
    const clock = fakeClock(0);
    const acct = new LearningAccountant({ now: clock.now });
    acct.startPhase('validate');
    clock.advance(100);
    expect(acct.report().wallClockByPhase.validate).toBe(0);
    acct.endPhase('validate');
    expect(acct.report().wallClockByPhase.validate).toBe(100);
  });

  it('throws when a phase ends without starting', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    expect(() => acct.endPhase('apply')).toThrow(/not started/);
  });
});

describe('LearningAccountant report', () => {
  it('returns every field with per-phase tokens and totals', () => {
    const clock = fakeClock(0);
    const acct = new LearningAccountant({ now: clock.now });
    acct.recordRound();
    acct.recordRound();
    acct.addTokens('edit', 100, 50);
    acct.addTokens('diagnose', 20, 5);
    clock.advance(75);
    const report = acct.report();
    expect(report.rounds).toBe(2);
    expect(report.totalTokens).toBe(175);
    expect(report.tokensByPhase.edit).toEqual({ input: 100, output: 50 });
    expect(report.tokensByPhase.judge).toEqual({ input: 0, output: 0 });
    expect(Object.keys(report.wallClockByPhase).sort()).toEqual(
      ['apply', 'diagnose', 'done', 'edit', 'judge', 'solve', 'validate'],
    );
    expect(report.elapsedMs).toBe(75);
  });

  it('ignores negative token counts', () => {
    const acct = new LearningAccountant({ now: fakeClock().now });
    acct.addTokens('solve', -5, Number.POSITIVE_INFINITY);
    expect(acct.report().totalTokens).toBe(0);
  });
});

describe('LearningAccountant default clock', () => {
  it('uses Date.now when no clock is injected', () => {
    const acct = new LearningAccountant();
    expect(acct.report().elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
