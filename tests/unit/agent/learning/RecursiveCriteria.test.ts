/**
 * Recursive learner criteria (Phase 6 S2): metrics and prior feedback carry the judged criteria
 * behind a pass map instead of empty placeholders, and `meanCriteria` never contradicts `allPass`.
 */
import { describe, it, expect } from 'vitest';
import { feedbackOf, metricsOf, absorbChildCriteria, type ChildSummary, type RecursiveState } from '../../../../src/agent/learning/RecursiveLearnerState.js';
import { settleRound } from '../../../../src/agent/learning/RecursiveMerge.js';
import type { TaskRecord } from '../../../../src/types/learning.js';

const TASKS: TaskRecord[] = ['a', 'b'].map((id) => ({
  id,
  input: id,
  category: id === 'a' ? 'x' : 'y',
  rubric: [
    { id: 'c1', text: 'one', kind: 'fact', expected: '1' },
    { id: 'c2', text: 'two', kind: 'fact', expected: '2' },
  ],
}));

describe('recursive criteria', () => {
  it('metricsOf uses recorded criteria for partial credit and full credit for a pass without criteria', () => {
    const m = metricsOf(TASKS, { a: true, b: false }, { b: [{ criterionId: 'c1', pass: true }, { criterionId: 'c2', pass: false }] });
    expect(m.allPass).toBe(0.5);
    expect(m.meanCriteria).toBeCloseTo(0.75);
    expect(m.byCategory.x).toEqual({ tasks: 1, allPass: 1, meanCriteria: 1 });
    expect(m.byCategory.y!.meanCriteria).toBeCloseTo(0.5);
    expect(feedbackOf(TASKS, { a: false }, {}).a!.criteria).toEqual([]);
  });

  it('absorbChildCriteria and settleRound keep state.criteria in step with the pass maps', () => {
    const state = { taskIds: ['a', 'b'], current: {}, baseline: {} } as unknown as RecursiveState;
    const pass = [{ criterionId: 'c1', pass: true }, { criterionId: 'c2', pass: true }];
    const fail = [{ criterionId: 'c1', pass: false }, { criterionId: 'c2', pass: false }];
    const child = { beforeCriteria: { a: fail, b: fail }, afterCriteria: { a: pass, b: fail } } as unknown as ChildSummary;
    absorbChildCriteria(state, ['a', 'b'], child);
    expect(state.criteria).toEqual({ baseline: { a: fail, b: fail }, current: { a: pass, b: fail } });
    settleRound(
      state,
      { applied: true, verdict: 'accept', fixed: ['a'], regressed: [], notes: [], roundBefore: { a: false, b: false }, evaluation: { a: true, b: true }, evaluationCriteria: { a: pass, b: pass } },
      null,
    );
    expect(state.criteria!.current).toEqual({ a: pass, b: pass });
    expect(metricsOf(TASKS, state.current, state.criteria!.current).meanCriteria).toBe(1);
  });
});
