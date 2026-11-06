/**
 * Unit tests for SplitStrategies (spec RS-19).
 */

import { describe, it, expect } from 'vitest';
import { split, isPartition, preferredSplitOf } from '../../../../src/agent/learning/SplitStrategies.js';
import type { SplitContext } from '../../../../src/agent/learning/SplitStrategies.js';
import type { SplitStrategyName, TaskRecord, Diagnosis } from '../../../../src/types/learning.js';

const NAMES: SplitStrategyName[] = ['byCategory', 'byFailureMode', 'bySkill', 'byTool', 'auto'];

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * @param seed - Integer seed
 * @returns Function returning floats in [0, 1)
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one element with the generator.
 *
 * @param r - Generator
 * @param items - Choices
 * @returns Chosen element
 */
function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)] as T;
}

/**
 * Build a task with a single rubric criterion.
 *
 * @param id - Task id
 * @param extra - Optional attributes
 * @returns Task record
 */
function task(id: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    input: `input ${id}`,
    rubric: [{ id: 'k', text: 'check', kind: 'fact' }],
    ...extra,
  };
}

/**
 * Random task set plus a matching random split context.
 *
 * @param seed - Seed
 * @returns Tasks and context
 */
function randomCase(seed: number): { tasks: TaskRecord[]; ctx: SplitContext } {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 25);
  const tasks: TaskRecord[] = [];
  const diagnoses: Record<string, Diagnosis> = {};
  const feedback: NonNullable<SplitContext['feedback']> = {};
  const skillOf: Record<string, string | undefined> = {};
  for (let i = 0; i < n; i++) {
    const id = `task-${i}`;
    tasks.push(
      task(id, {
        category: pick(r, [undefined, 'c0', 'c1', 'c2']),
        tags: r() < 0.5 ? [pick(r, ['t0', 't1'])] : undefined,
        tools: r() < 0.5 ? [pick(r, ['p', 'q', 'r'])] : undefined,
        rubric: [
          { id: 'k', text: 'a', kind: pick(r, ['fact', 'number']) },
          { id: 'j', text: 'b', kind: 'free' },
        ],
      }),
    );
    const pass = r() < 0.4;
    feedback[id] = {
      allPass: pass,
      criteria: [
        { criterionId: 'k', pass: pass || r() < 0.5 },
        { criterionId: 'j', pass: pass || r() < 0.5 },
      ],
    };
    if (!pass && r() < 0.8) {
      diagnoses[id] = {
        taskId: id,
        kind: pick(r, ['missing-knowledge', 'wrong-behaviour']),
        summary: 's',
        evidenceAddrs: [],
        relatedSkillIds: [],
        confidence: 0.5,
      };
    }
    skillOf[id] = pick(r, ['s1', 's2', undefined]);
  }
  const ctx: SplitContext = {
    diagnoses,
    feedback,
    skillMatch: (t) => skillOf[t.id],
  };
  return { tasks, ctx };
}

describe('SplitStrategies: partition property', () => {
  it('every strategy partitions random task sets with ordered labels and no empty subsets', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { tasks, ctx } = randomCase(seed);
      const position = new Map(tasks.map((t, i) => [t.id, i]));
      for (const name of NAMES) {
        const subsets = await split(name, tasks, ctx);
        expect(isPartition(tasks, subsets), `seed ${seed} ${name}`).toBe(true);
        const labels = subsets.map((s) => s.label);
        expect(labels).toEqual([...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        for (const s of subsets) {
          expect(s.taskIds.length).toBeGreaterThan(0);
          const idx = s.taskIds.map((id) => position.get(id) ?? -1);
          expect(idx).toEqual([...idx].sort((a, b) => a - b));
        }
      }
    }
  });

  it('returns an empty partition for empty input', async () => {
    for (const name of NAMES) {
      expect(await split(name, [])).toEqual([]);
    }
  });

  it('keeps subsets of size one as valid partitions', async () => {
    const one = [task('only', { category: 'x', tools: ['p'] })];
    for (const name of NAMES) {
      const subsets = await split(name, one);
      expect(subsets).toHaveLength(1);
      expect(subsets[0]?.taskIds).toEqual(['only']);
      expect(isPartition(one, subsets)).toBe(true);
    }
  });

  it('rejects duplicate task ids', async () => {
    await expect(split('byCategory', [task('a'), task('a')])).rejects.toThrow(/duplicate task id/);
  });

  it('isPartition rejects lost, duplicated, unknown and empty members', () => {
    const tasks = [task('a'), task('b')];
    expect(isPartition(tasks, [{ label: 'x', taskIds: ['a'], rationale: '' }])).toBe(false);
    expect(
      isPartition(tasks, [
        { label: 'x', taskIds: ['a', 'a'], rationale: '' },
        { label: 'y', taskIds: ['b'], rationale: '' },
      ]),
    ).toBe(false);
    expect(
      isPartition(tasks, [
        { label: 'x', taskIds: ['a', 'b', 'z'], rationale: '' },
      ]),
    ).toBe(false);
    expect(
      isPartition(tasks, [
        { label: 'x', taskIds: ['a', 'b'], rationale: '' },
        { label: 'y', taskIds: [], rationale: '' },
      ]),
    ).toBe(false);
  });
});

describe('SplitStrategies: concrete strategies', () => {
  it('byCategory falls back to the first tag, then to uncategorized', async () => {
    const tasks = [
      task('a', { category: 'alpha' }),
      task('b', { tags: ['beta', 'gamma'] }),
      task('c'),
    ];
    const subsets = await split('byCategory', tasks);
    expect(subsets.map((s) => [s.label, s.taskIds])).toEqual([
      ['alpha', ['a']],
      ['beta', ['b']],
      ['uncategorized', ['c']],
    ]);
  });

  it('byTool uses the first tool and no-tool otherwise', async () => {
    const tasks = [task('a', { tools: ['p', 'q'] }), task('b', { tools: ['p'] }), task('c')];
    const subsets = await split('byTool', tasks);
    expect(subsets.map((s) => [s.label, s.taskIds])).toEqual([
      ['no-tool', ['c']],
      ['p', ['a', 'b']],
    ]);
  });

  it('bySkill groups by top skill id and no-skill otherwise', async () => {
    const tasks = [task('a'), task('b'), task('c')];
    const ids: Record<string, string | undefined> = { a: 's2', b: undefined, c: 's2' };
    const subsets = await split('bySkill', tasks, { skillMatch: (t) => ids[t.id] });
    expect(subsets.map((s) => [s.label, s.taskIds])).toEqual([
      ['no-skill', ['b']],
      ['s2', ['a', 'c']],
    ]);
  });

  it('byFailureMode separates passing, undiagnosed and diagnosed failures by kind and criteria', async () => {
    const tasks = [
      task('pass'),
      task('nodiag'),
      task('fail1'),
      task('fail2'),
    ];
    const ctx: SplitContext = {
      feedback: {
        pass: { allPass: true, criteria: [{ criterionId: 'k', pass: true }] },
        fail1: { allPass: false, criteria: [{ criterionId: 'k', pass: false }] },
        fail2: { allPass: false, criteria: [{ criterionId: 'k', pass: false }] },
      },
      diagnoses: {
        fail1: { taskId: 'fail1', kind: 'missing-knowledge', summary: '', evidenceAddrs: [], relatedSkillIds: [], confidence: 1 },
        fail2: { taskId: 'fail2', kind: 'missing-knowledge', summary: '', evidenceAddrs: [], relatedSkillIds: [], confidence: 1 },
      },
    };
    const subsets = await split('byFailureMode', tasks, ctx);
    expect(subsets.map((s) => [s.label, s.taskIds])).toEqual([
      ['missing-knowledge:fact', ['fail1', 'fail2']],
      ['passing', ['pass']],
      ['undiagnosed', ['nodiag']],
    ]);
  });

  it('a single task yields a single subset for every strategy', async () => {
    const one = [task('solo', { category: 'c', tools: ['t'] })];
    for (const name of NAMES) {
      const subsets = await split(name, one, { skillMatch: () => 's' });
      expect(subsets).toHaveLength(1);
    }
  });
});

describe('SplitStrategies: auto', () => {
  it('is deterministic for the same inputs', async () => {
    const { tasks, ctx } = randomCase(7);
    const first = await split('auto', tasks, ctx);
    const second = await split('auto', tasks, ctx);
    expect(second).toEqual(first);
  });

  it('breaks a full tie in favour of byCategory', async () => {
    const tasks = [task('a'), task('b')];
    const auto = await split('auto', tasks);
    expect(auto).toEqual(await split('byCategory', tasks));
  });

  it('prefers the strategy with fewer shared skills among tied candidates', async () => {
    // Failure mode scores worse (3 of 4 tasks in one subset), so the tie is between
    // byCategory (shares skills s1/s2 across subsets), bySkill and byTool.
    const tasks = [
      task('t1', { category: 'c1', tools: ['p'] }),
      task('t2', { category: 'c1', tools: ['q'] }),
      task('t3', { category: 'c2', tools: ['p'] }),
      task('t4', { category: 'c2', tools: ['q'] }),
    ];
    const skills: Record<string, string> = { t1: 's1', t2: 's2', t3: 's1', t4: 's2' };
    const ctx: SplitContext = {
      skillMatch: (t) => skills[t.id],
      feedback: {
        t1: { allPass: false, criteria: [{ criterionId: 'k', pass: false }] },
        t2: { allPass: false, criteria: [{ criterionId: 'k', pass: false }] },
        t3: { allPass: false, criteria: [{ criterionId: 'k', pass: false }] },
        t4: { allPass: true, criteria: [{ criterionId: 'k', pass: true }] },
      },
      diagnoses: {
        t1: { taskId: 't1', kind: 'missing-knowledge', summary: '', evidenceAddrs: [], relatedSkillIds: [], confidence: 1 },
        t2: { taskId: 't2', kind: 'missing-knowledge', summary: '', evidenceAddrs: [], relatedSkillIds: [], confidence: 1 },
        t3: { taskId: 't3', kind: 'missing-knowledge', summary: '', evidenceAddrs: [], relatedSkillIds: [], confidence: 1 },
      },
    };
    const auto = await split('auto', tasks, ctx);
    expect(auto).toEqual(await split('bySkill', tasks, ctx));
    expect(auto).not.toEqual(await split('byCategory', tasks, ctx));
  });

  it('prefers the exact prefer-split:<name> token among tied candidates, never free text (N3)', async () => {
    const tasks = [
      task('t1', { category: 'c1', tools: ['p'] }),
      task('t2', { category: 'c1', tools: ['q'] }),
      task('t3', { category: 'c2', tools: ['p'] }),
      task('t4', { category: 'c2', tools: ['q'] }),
    ];
    const skills: Record<string, string> = { t1: 's1', t2: 's2', t3: 's1', t4: 's2' };
    const base: SplitContext = { skillMatch: (t) => skills[t.id] };
    const freeText: SplitContext = { ...base, keyInsights: ['Split by tool would isolate the failures'] };
    const withToken: SplitContext = { ...base, keyInsights: ['split by bySkill: 0 of 2', 'prefer-split:byTool'] };
    const byToolResult = await split('byTool', tasks);
    expect(await split('auto', tasks, freeText)).not.toEqual(byToolResult);
    expect(await split('auto', tasks, withToken)).toEqual(byToolResult);
    expect(preferredSplitOf(['prefer-split:byTool', 'prefer-split:nope'])).toBe('byTool');
    expect(preferredSplitOf(['please prefer-split:byTool'])).toBeUndefined();
  });

  it('auto ranks a single-subset partition last (S2)', async () => {
    const tasks = [task('t1', { category: 'c1' }), task('t2', { category: 'c1' }), task('t3', { category: 'c1', tools: ['x'] }), task('t4', { category: 'c1', tools: ['y'] })];
    const out = await split('auto', tasks);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]!.strategy).toBe('byTool');
  });
});
