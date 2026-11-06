/**
 * Guard and shape tests for the Recursa task and learning-trace types
 * (src/types/learning.ts, spec RS-14 / RS-18 / RS-22 / RS-24).
 */
import { describe, it, expect } from 'vitest';
import {
  isTaskEntity,
  isLearningTraceEntity,
} from '../../../src/types/index.js';
import type {
  Diagnosis,
  EvalMetrics,
  LeafPhase,
  LeafState,
  LearnOptions,
  LearnResult,
  LearnStopReason,
  LearningBudget,
  SplitStrategyName,
  TaskEntity,
  TaskRecord,
} from '../../../src/types/index.js';

const NOW = '2026-11-06T00:00:00.000Z';

function base(memoryType: string, name: string): Record<string, unknown> {
  return {
    name,
    entityType: memoryType,
    observations: [],
    memoryType,
    accessCount: 0,
    confidence: 0.9,
    confirmationCount: 0,
    visibility: 'private',
  };
}

const METRICS: EvalMetrics = {
  tasks: 2,
  allPass: 0.5,
  meanCriteria: 0.75,
  byCategory: { billing: { tasks: 2, allPass: 0.5, meanCriteria: 0.75 } },
};

const TASK_RECORD: TaskRecord = {
  id: 'task-e5',
  input: 'What is the refund window?',
  category: 'billing',
  tags: ['policy'],
  rubric: [
    { id: 'c1', text: 'States 30 days', kind: 'number', expected: 30, tolerance: 0 },
    { id: 'c2', text: 'Mentions the policy document', kind: 'document', expected: 'policy.md' },
  ],
};

const TRACE_RECORD = {
  id: 'trace-f6',
  learnerKind: 'leaf',
  round: 1,
  subsetLabel: 'billing',
  actions: [
    {
      kind: 'solve',
      startedAt: NOW,
      endedAt: NOW,
      addrs: ['log:1'],
      outcome: 'answered',
    },
  ],
  revisionIds: [],
  metrics: METRICS,
};

interface Case {
  label: string;
  guard: (e: unknown) => boolean;
  memoryType: string;
  recordKey: string;
  name: string;
  record: Record<string, unknown>;
  required: string[];
}

const CASES: Case[] = [
  {
    label: 'isTaskEntity',
    guard: isTaskEntity,
    memoryType: 'task',
    recordKey: 'taskRecord',
    name: 'task-e5',
    record: TASK_RECORD as unknown as Record<string, unknown>,
    required: ['id', 'input', 'rubric'],
  },
  {
    label: 'isLearningTraceEntity',
    guard: isLearningTraceEntity,
    memoryType: 'learning_trace',
    recordKey: 'learningTraceRecord',
    name: 'trace-f6',
    record: TRACE_RECORD,
    required: ['id', 'learnerKind', 'round', 'subsetLabel', 'actions', 'revisionIds', 'metrics'],
  },
];

function entityFor(c: Case, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base(c.memoryType, c.name), [c.recordKey]: structuredClone(c.record), ...overrides };
}

describe('Recursa task and trace guards (table-driven)', () => {
  for (const c of CASES) {
    describe(c.label, () => {
      it('accepts a valid fixture', () => {
        expect(c.guard(entityFor(c))).toBe(true);
      });

      it('rejects a wrong memoryType', () => {
        expect(c.guard(entityFor(c, { memoryType: 'semantic' }))).toBe(false);
      });

      it('rejects a missing record field', () => {
        const entity = entityFor(c);
        delete entity[c.recordKey];
        expect(c.guard(entity)).toBe(false);
      });

      it('rejects a null record', () => {
        expect(c.guard(entityFor(c, { [c.recordKey]: null }))).toBe(false);
      });

      for (const field of c.required) {
        it(`rejects a record missing "${field}"`, () => {
          const record = structuredClone(c.record);
          delete record[field];
          expect(c.guard(entityFor(c, { [c.recordKey]: record }))).toBe(false);
        });

        it(`rejects a record whose "${field}" is the wrong shape`, () => {
          const record = structuredClone(c.record);
          record[field] = Symbol.for('wrong-shape');
          expect(c.guard(entityFor(c, { [c.recordKey]: record }))).toBe(false);
        });
      }

      it('rejects non-objects', () => {
        expect(c.guard(undefined)).toBe(false);
        expect(c.guard(42)).toBe(false);
      });
    });
  }
});

describe('Recursa learning value types', () => {
  it('accepts every split strategy, stop reason and leaf phase literal', () => {
    const splits: SplitStrategyName[] = ['byCategory', 'byFailureMode', 'bySkill', 'byTool', 'auto'];
    const stops: LearnStopReason[] = [
      'no-progress', 'budget-rounds', 'budget-tokens', 'budget-time', 'aborted', 'all-pass',
    ];
    const phases: LeafPhase[] = ['solve', 'judge', 'diagnose', 'edit', 'validate', 'apply', 'done'];
    expect(splits).toHaveLength(5);
    expect(stops).toHaveLength(6);
    expect(phases).toHaveLength(7);
  });

  it('builds a LearnOptions, LeafState and LearnResult that satisfy their declared shapes', () => {
    const budget: LearningBudget = { maxRounds: 3 };
    const options: LearnOptions = { taskIds: ['task-e5'], budget, split: 'auto' };
    const state: LeafState = {
      traceId: 'trace-f6',
      round: 0,
      phase: 'solve',
      pending: ['task-e5'],
      results: {},
      feedback: {},
    };
    const diagnosis: Diagnosis = {
      taskId: 'task-e5',
      kind: 'missing-knowledge',
      summary: 'no refund policy skill',
      evidenceAddrs: [],
      relatedSkillIds: [],
      confidence: 0.6,
    };
    const result: LearnResult = {
      snapshotId: 'K-1',
      traceId: 'trace-f6',
      before: METRICS,
      after: METRICS,
      stoppedBecause: 'all-pass',
    };
    expect(options.budget.maxRounds).toBe(3);
    expect(state.phase).toBe('solve');
    expect(diagnosis.kind).toBe('missing-knowledge');
    expect(result.stoppedBecause).toBe('all-pass');
  });

  it('types a TaskEntity around a TaskRecord', () => {
    const entity: TaskEntity = {
      ...base('task', 'task-e5'),
      memoryType: 'task',
      accessCount: 0,
      confidence: 0.9,
      confirmationCount: 0,
      visibility: 'private',
      taskRecord: TASK_RECORD,
    } as TaskEntity;
    expect(isTaskEntity(entity)).toBe(true);
  });
});
