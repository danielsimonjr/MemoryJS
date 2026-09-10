/**
 * Procedure → Procedural Graph adapter tests (Wave 3 / Agent D).
 */

import { describe, it, expect } from 'vitest';
import type { Procedure, ProcedureStep } from '../../../../../src/types/procedure.js';
import { procedureToGraphInput } from '../../../../../src/agent/procedural/graph/ProcedureGraphAdapter.js';
import { StepSequencer } from '../../../../../src/agent/procedural/StepSequencer.js';

function procedure(steps: ProcedureStep[]): Procedure {
  return {
    id: 'proc-1',
    name: 'demo',
    description: 'adapter fixture',
    steps,
  };
}

function step(order: number, action: string, extras: Partial<ProcedureStep> = {}): ProcedureStep {
  return {
    order,
    action,
    parameters: extras.parameters ?? { n: String(order) },
    ...extras,
  };
}

describe('ProcedureGraphAdapter', () => {
  it('three-step procedure yields Start, 3 ACTION nodes, End and a LEADS_TO chain', () => {
    const input = procedureToGraphInput(procedure([
      step(1, 'alpha'),
      step(2, 'beta'),
      step(3, 'gamma'),
    ]));
    const ids = input.nodes.map((n) => n.id);
    expect(ids).toEqual([
      'Start',
      'End',
      'proc-1:step:1',
      'proc-1:step:2',
      'proc-1:step:3',
    ]);
    expect(input.nodes.filter((n) => n.type === 'ACTION')).toHaveLength(3);
    expect(input.nodes.filter((n) => n.type === 'STATE').map((n) => n.id)).toEqual(['Start', 'End']);
    expect(input.edges).toEqual([
      { source: 'Start', relation: 'LEADS_TO', target: 'proc-1:step:1', condition: null, guidance: '', pitfalls: '' },
      { source: 'proc-1:step:1', relation: 'LEADS_TO', target: 'proc-1:step:2', condition: null, guidance: '', pitfalls: '' },
      { source: 'proc-1:step:2', relation: 'LEADS_TO', target: 'proc-1:step:3', condition: null, guidance: '', pitfalls: '' },
      { source: 'proc-1:step:3', relation: 'LEADS_TO', target: 'End', condition: null, guidance: '', pitfalls: '' },
    ]);
  });

  it('step with fallback yields TRIGGERS edge and fallback resumes at the next main step matching StepSequencer.next()', () => {
    const proc = procedure([
      step(1, 'one'),
      step(2, 'two', { fallback: step(21, 'rescue') }),
      step(3, 'three'),
    ]);
    const input = procedureToGraphInput(proc);
    const fallbackId = 'proc-1:step:2:fallback';
    expect(input.nodes.some((n) => n.id === fallbackId && n.actionName === 'rescue')).toBe(true);
    expect(input.edges).toContainEqual({
      source: 'proc-1:step:2',
      relation: 'TRIGGERS',
      target: fallbackId,
      condition: 'step failed',
      guidance: '',
      pitfalls: '',
    });
    expect(input.edges).toContainEqual({
      source: fallbackId,
      relation: 'LEADS_TO',
      target: 'proc-1:step:3',
      condition: null,
      guidance: '',
      pitfalls: '',
    });

    const sequencer = new StepSequencer(proc);
    expect(sequencer.current()?.action).toBe('one');
    sequencer.next();
    expect(sequencer.current()?.action).toBe('two');
    sequencer.branchToFallback();
    expect(sequencer.current()?.action).toBe('rescue');
    const resumed = sequencer.next();
    expect(resumed?.action).toBe('three');
    expect(resumed?.order).toBe(3);
  });

  it('repeated action names yield distinct nodes', () => {
    const input = procedureToGraphInput(procedure([
      step(1, 'same', { parameters: { a: '1' } }),
      step(2, 'same', { parameters: { a: '2' } }),
    ]));
    const actions = input.nodes.filter((n) => n.type === 'ACTION');
    expect(actions.map((n) => n.id)).toEqual(['proc-1:step:1', 'proc-1:step:2']);
    expect(actions.every((n) => n.actionName === 'same')).toBe(true);
    expect(new Set(actions.map((n) => n.id)).size).toBe(2);
  });

  it('nested fallback yields deterministic synthetic ids and notes', () => {
    const input = procedureToGraphInput(procedure([
      step(1, 'main', {
        fallback: step(11, 'outer', {
          fallback: step(111, 'inner', { timeout: 50 }),
        }),
      }),
    ]));
    const outer = 'proc-1:step:1:fallback';
    const inner = 'proc-1:step:1:fallback:fallback';
    expect(input.nodes.map((n) => n.id)).toEqual(['Start', 'End', 'proc-1:step:1', outer, inner]);
    expect(input.notes).toEqual(['Start', 'End', outer, inner]);
    expect(input.edges).toContainEqual({
      source: 'proc-1:step:1',
      relation: 'TRIGGERS',
      target: outer,
      condition: 'step failed',
      guidance: '',
      pitfalls: '',
    });
    expect(input.edges).toContainEqual({
      source: outer,
      relation: 'TRIGGERS',
      target: inner,
      condition: 'step failed',
      guidance: '',
      pitfalls: '',
    });
    expect(input.edges.filter((e) => e.source === outer && e.relation === 'LEADS_TO')[0]?.target).toBe('End');
    expect(input.edges.filter((e) => e.source === inner && e.relation === 'LEADS_TO')[0]?.target).toBe('End');
    const innerNode = input.nodes.find((n) => n.id === inner);
    expect(innerNode?.description).toContain('timeout=50');
  });
});
