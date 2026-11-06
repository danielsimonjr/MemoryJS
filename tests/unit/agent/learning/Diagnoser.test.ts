/**
 * Unit tests for the Recursa Diagnoser (spec RS-15).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Diagnoser,
  classifyFallback,
  type DiagnoseItem,
} from '../../../../src/agent/learning/Diagnoser.js';
import type { LoadedKnowledge } from '../../../../src/agent/learning/types.js';
import type { Criterion, Feedback, SolveResult, TaskRecord } from '../../../../src/types/learning.js';
import type { FailureManager } from '../../../../src/agent/FailureManager.js';
import type { InteractionLog } from '../../../../src/agent/harness/InteractionLog.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { SkillId } from '../../../../src/types/skills.js';

const KNOWLEDGE: LoadedKnowledge = {
  markdown: '# Knowledge\nRevenue notes.',
  skillIds: ['skill-revenue-abc' as SkillId],
  instructionSetIds: ['instructions-solver-1'],
  failureIds: [],
  tokens: 10,
};

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const rubric: Criterion[] = [
    { id: 'c1', text: 'states revenue for Q3', kind: 'number', expected: 42 },
    { id: 'c2', text: 'explains the drop', kind: 'free' },
  ];
  return {
    id: 'task-1',
    input: 'What was revenue in Q3?',
    category: 'finance',
    rubric,
    ...overrides,
  };
}

function makeItem(
  taskOverrides: Partial<TaskRecord>,
  failedIds: string[],
  feedbackOverrides: Partial<Feedback> = {},
  resultOverrides: Partial<SolveResult> = {},
): DiagnoseItem {
  const task = makeTask(taskOverrides);
  const criteria = task.rubric.map((c) => ({ criterionId: c.id, pass: !failedIds.includes(c.id) }));
  return {
    task,
    result: { answer: 'Revenue was 40', traceAddrs: ['e1'], ...resultOverrides },
    feedback: {
      taskId: task.id,
      criteria,
      allPass: failedIds.length === 0,
      source: 'judge',
      ...feedbackOverrides,
    },
  };
}

function fakeFailures(): { record: ReturnType<typeof vi.fn>; mgr: Pick<FailureManager, 'record'> } {
  let n = 0;
  const record = vi.fn(async () => ({ id: `failure-${++n}` }));
  return { record, mgr: { record } as unknown as Pick<FailureManager, 'record'> };
}

function fakeProvider(outputs: string[]): { complete: ReturnType<typeof vi.fn>; provider: PGCompletionProvider } {
  const complete = vi.fn(async () => outputs.shift() ?? '');
  return { complete, provider: { complete } as unknown as PGCompletionProvider };
}

describe('classifyFallback', () => {
  it('classifies all-free failures as ambiguous', () => {
    const task = makeTask({ rubric: [{ id: 'c2', text: 'explains', kind: 'free' }] });
    const fb: Feedback = { taskId: task.id, criteria: [{ criterionId: 'c2', pass: false }], allPass: false, source: 'judge' };
    expect(classifyFallback(task, fb, KNOWLEDGE)).toBe('ambiguous');
  });

  it('classifies a failed criterion whose document source is absent as missing-knowledge', () => {
    const task = makeTask({
      rubric: [{ id: 'c1', text: 'cites the filing', kind: 'document', expected: 'doc:10-K-2026' }],
    });
    const fb: Feedback = { taskId: task.id, criteria: [{ criterionId: 'c1', pass: false }], allPass: false, source: 'test' };
    expect(classifyFallback(task, fb, KNOWLEDGE)).toBe('missing-knowledge');
  });

  it('treats a referenced source present in the knowledge markdown as known', () => {
    const task = makeTask({
      rubric: [{ id: 'c1', text: 'cites', kind: 'document', expected: 'Revenue notes' }],
    });
    const fb: Feedback = { taskId: task.id, criteria: [{ criterionId: 'c1', pass: false }], allPass: false, source: 'test' };
    expect(classifyFallback(task, fb, KNOWLEDGE)).toBe('wrong-behaviour');
  });

  it('classifies a judge note containing uncertain as noisy-feedback', () => {
    const task = makeTask();
    const fb: Feedback = {
      taskId: task.id,
      criteria: [{ criterionId: 'c1', pass: false, note: 'uncertain whether 40 matches' }],
      allPass: false,
      source: 'judge',
    };
    expect(classifyFallback(task, fb, KNOWLEDGE)).toBe('noisy-feedback');
  });

  it('classifies everything else as wrong-behaviour', () => {
    const task = makeTask();
    const fb: Feedback = { taskId: task.id, criteria: [{ criterionId: 'c1', pass: false }], allPass: false, source: 'judge' };
    expect(classifyFallback(task, fb, KNOWLEDGE)).toBe('wrong-behaviour');
  });
});

describe('Diagnoser.diagnose', () => {
  it('skips passing tasks and never records for them', async () => {
    const { record, mgr } = fakeFailures();
    const d = new Diagnoser({ failureManager: mgr });
    const out = await d.diagnose(0, [makeItem({}, [])], KNOWLEDGE);
    expect(out).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it('uses the fallback with confidence 0.6 and records wrong-behaviour with all five fields', async () => {
    const { record, mgr } = fakeFailures();
    const d = new Diagnoser({ failureManager: mgr });
    const [diag] = await d.diagnose(2, [makeItem({}, ['c1'])], KNOWLEDGE, { sessionId: 'sess-1' });
    expect(diag?.kind).toBe('wrong-behaviour');
    expect(diag?.confidence).toBe(0.6);
    expect(diag?.relatedFailureId).toBe('failure-1');
    expect(record).toHaveBeenCalledTimes(1);
    const input = record.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const key of ['context', 'attempted', 'failure_mode', 'root_cause', 'applicability_hint']) {
      expect(typeof input[key]).toBe('string');
      expect((input[key] as string).trim().length).toBeGreaterThan(0);
    }
    expect(input.context).toBe('What was revenue in Q3?');
    expect(input.attempted).toBe('Revenue was 40');
    expect(input.failure_mode).toBe('states revenue for Q3');
    expect(input.applicability_hint).toBe('finance: c1');
    expect(input.sourceSessionId).toBe('sess-1');
  });

  it('records exactly once per task per round, even across repeated calls', async () => {
    const { record, mgr } = fakeFailures();
    const d = new Diagnoser({ failureManager: mgr });
    const items = [makeItem({}, ['c1'])];
    const first = await d.diagnose(0, items, KNOWLEDGE);
    const second = await d.diagnose(0, items, KNOWLEDGE);
    expect(record).toHaveBeenCalledTimes(1);
    expect(second[0]?.relatedFailureId).toBe(first[0]?.relatedFailureId);
    await d.diagnose(1, items, KNOWLEDGE);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('does not record for noisy-feedback or ambiguous diagnoses', async () => {
    const { record, mgr } = fakeFailures();
    const d = new Diagnoser({ failureManager: mgr });
    const noisy = makeItem({}, ['c1'], {
      criteria: [{ criterionId: 'c1', pass: false, note: 'uncertain' }],
    });
    const [diag] = await d.diagnose(0, [noisy], KNOWLEDGE);
    expect(diag?.kind).toBe('noisy-feedback');
    expect(record).not.toHaveBeenCalled();
    expect(diag?.relatedFailureId).toBeUndefined();
  });

  it('never throws when the failure record write fails', async () => {
    const record = vi.fn(async () => {
      throw new Error('disk full');
    });
    const d = new Diagnoser({ failureManager: { record } as unknown as Pick<FailureManager, 'record'> });
    const out = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(out).toHaveLength(1);
    expect(out[0]?.relatedFailureId).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('lists skill ids whose id appears in failed criteria or trace excerpts', async () => {
    const d = new Diagnoser({
      interactionLog: {
        select: vi.fn(async () => ({ addr: 'e1', kind: 'tool_output', lines: [{ line: 1, text: 'used skill-revenue-abc' }], totalLines: 1, bounded: false })),
      } as unknown as Pick<InteractionLog, 'select'>,
    });
    const [diag] = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(diag?.relatedSkillIds).toEqual(['skill-revenue-abc']);
  });

  it('reads at most 20 lines per trace address and ignores unreadable addresses', async () => {
    const select = vi.fn(async (addr: string) => {
      if (addr === 'bad') throw new Error('no such addr');
      return { addr, kind: 'tool_output', lines: [{ line: 1, text: 'x' }], totalLines: 1, bounded: false };
    });
    const d = new Diagnoser({ interactionLog: { select } as unknown as Pick<InteractionLog, 'select'> });
    const item = makeItem({}, ['c1'], {}, { traceAddrs: ['e1', 'bad'] });
    const [diag] = await d.diagnose(0, [item], KNOWLEDGE);
    expect(select).toHaveBeenCalledWith('e1', { lines: [1, 20] });
    expect(select).toHaveBeenCalledWith('bad', { lines: [1, 20] });
    expect(diag?.kind).toBe('wrong-behaviour');
  });
});

describe('Diagnoser LLM path', () => {
  it('accepts a valid LLM diagnosis with confidence 0.9', async () => {
    const llm = fakeProvider([JSON.stringify({ kind: 'missing-knowledge', summary: 'no Q3 figures in K' })]);
    const { record, mgr } = fakeFailures();
    const d = new Diagnoser({ llmProvider: llm.provider, failureManager: mgr });
    const [diag] = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(diag?.kind).toBe('missing-knowledge');
    expect(diag?.summary).toBe('no Q3 figures in K');
    expect(diag?.confidence).toBe(0.9);
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('retries once after malformed JSON and succeeds on the retry', async () => {
    const llm = fakeProvider(['not json at all', JSON.stringify({ kind: 'wrong-behaviour', summary: 'misread the table' })]);
    const d = new Diagnoser({ llmProvider: llm.provider });
    const [diag] = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(diag?.kind).toBe('wrong-behaviour');
    expect(diag?.confidence).toBe(0.9);
  });

  it('falls back after malformed JSON twice', async () => {
    const llm = fakeProvider(['{"kind": "bogus"}', '[[[']);
    const d = new Diagnoser({ llmProvider: llm.provider });
    const [diag] = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(diag?.kind).toBe('wrong-behaviour');
    expect(diag?.confidence).toBe(0.6);
  });

  it('falls back when the provider throws', async () => {
    const provider = { complete: vi.fn(async () => { throw new Error('rate limited'); }) } as unknown as PGCompletionProvider;
    const d = new Diagnoser({ llmProvider: provider });
    const [diag] = await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE);
    expect(diag?.confidence).toBe(0.6);
  });

  it('feeds prior reflections into the prompt', async () => {
    const llm = fakeProvider([JSON.stringify({ kind: 'ambiguous', summary: 'criteria unclear' })]);
    const getRelevantForSession = vi.fn(async () => [{ summary: 'earlier lesson about Q3' }]);
    const d = new Diagnoser({
      llmProvider: llm.provider,
      reflections: { getRelevantForSession } as unknown as Pick<
        import('../../../../src/agent/AgentReflectionManager.js').AgentReflectionManager,
        'getRelevantForSession'
      >,
    });
    await d.diagnose(0, [makeItem({}, ['c1'])], KNOWLEDGE, { sessionId: 's1' });
    expect(getRelevantForSession).toHaveBeenCalledWith('s1', expect.objectContaining({ sessionEntityNames: ['task-1'] }));
    const prompt = String(llm.complete.mock.calls[0]?.[0]);
    expect(prompt).toContain('earlier lesson about Q3');
  });
});
