/**
 * Challenger tests for the Diagnoser batching change (PR #305, build step 4).
 *
 * Two durability regressions against the module's own documented contract:
 *
 * 1. The Diagnoser JSDoc promises per-record durability ("one failure record is written per
 *    trace, task and round"). Before the batching change every decided diagnosis persisted its
 *    failure record immediately, so an abort or crash mid-round kept the lessons of the tasks
 *    already diagnosed. The batching change defers all records to after the loop, so an
 *    `AbortError` between items discards every decided record of the round — and an aborted
 *    run never re-diagnoses them, so the lessons are gone for good.
 *
 * 2. `FailureManager.record` errors are per-record: one refused record never affected its
 *    siblings. `recordMany` is all-or-nothing, and `Diagnoser.recordPending` treats one
 *    `recordMany` rejection as the whole round's failure — every sibling lesson is dropped and
 *    left without a `relatedFailureId`, where the per-item path persisted them.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Diagnoser,
  type DiagnoseItem,
} from '../../../../src/agent/learning/Diagnoser.js';
import type { LoadedKnowledge } from '../../../../src/agent/learning/types.js';
import type { Criterion, Feedback, SolveResult, TaskRecord } from '../../../../src/types/learning.js';
import type { FailureManager } from '../../../../src/agent/FailureManager.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';

const KNOWLEDGE: LoadedKnowledge = {
  markdown: '# Knowledge\nRevenue notes.',
  skillIds: [],
  instructionSetIds: [],
  failureIds: [],
  tokens: 10,
};

function makeTask(id: string): TaskRecord {
  const rubric: Criterion[] = [{ id: 'c1', text: 'states revenue for Q3', kind: 'number', expected: 42 }];
  return { id, input: `What was revenue for ${id}?`, category: 'finance', rubric };
}

function makeItem(id: string): DiagnoseItem {
  const task = makeTask(id);
  return {
    task,
    result: { answer: 'Revenue was 40', traceAddrs: ['e1'] } satisfies SolveResult,
    feedback: {
      taskId: id,
      criteria: [{ criterionId: 'c1', pass: false }],
      allPass: false,
      source: 'judge',
    } satisfies Feedback,
  };
}

describe('Diagnoser failure-record durability under batching [challenger]', () => {
  it('persists the failure record of a task diagnosed before a mid-round abort', async () => {
    const record = vi.fn(async () => ({ id: `failure-${record.mock.calls.length}` }));
    const controller = new AbortController();
    // The provider aborts the signal while diagnosing the SECOND item, after the first item was
    // fully diagnosed. Unbatched, the first item's failure record was already durable at that
    // point; the batched version defers every record to after the loop, which never gets there.
    let calls = 0;
    const complete = vi.fn(async () => {
      calls += 1;
      if (calls >= 2) controller.abort();
      return JSON.stringify({ kind: 'missing-knowledge', summary: 'no figures in K' });
    });
    const d = new Diagnoser({
      llmProvider: { complete } as unknown as PGCompletionProvider,
      failureManager: { record } as unknown as Pick<FailureManager, 'record'>,
    });
    await expect(
      d.diagnose(0, [makeItem('task-1'), makeItem('task-2')], KNOWLEDGE, { signal: controller.signal }),
    ).rejects.toThrow();
    // The lesson for the task that was diagnosed (and would have been recorded) before the
    // abort must be durable — the unbatched Diagnoser wrote it inside the loop.
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('a failed failure record does not drop the round\'s sibling records', async () => {
    // Sink that refuses one item (as a real FailureManager validates each record) but accepts
    // the others. `record` models the per-item primitive; `recordMany` the batch primitive.
    const record = vi.fn(async (input: { context: string }) => {
      if (input.context.includes('task-2')) throw new Error('record rejected: task-2');
      return { id: `failure-${record.mock.calls.length}` };
    });
    const recordMany = vi.fn(async (items: ReadonlyArray<{ input: { context: string } }>) => {
      for (const { input } of items) await record(input);
      return [];
    });
    const d = new Diagnoser({
      failureManager: { record, recordMany } as unknown as Pick<FailureManager, 'record'> &
        Partial<Pick<FailureManager, 'recordMany'>>,
    });
    const out = await d.diagnose(0, [makeItem('task-1'), makeItem('task-2'), makeItem('task-3')], KNOWLEDGE);

    expect(out).toHaveLength(3);
    // The round's other lessons survive the one refused record, as the per-record contract says.
    expect(out[0]?.relatedFailureId).toMatch(/^failure-/);
    expect(out[2]?.relatedFailureId).toMatch(/^failure-/);
    expect(out[1]?.relatedFailureId).toBeUndefined();
  });
});
