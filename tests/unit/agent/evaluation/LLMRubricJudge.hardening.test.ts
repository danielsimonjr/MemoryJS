/**
 * LLMRubricJudge hardening: settles on abort when the provider ignores the signal (S1),
 * and extracts the first parseable JSON array from prose (N2).
 */
import { describe, it, expect } from 'vitest';
import { LLMRubricJudge } from '../../../../src/agent/evaluation/LLMRubricJudge.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { TaskRecord } from '../../../../src/types/learning.js';

const task: TaskRecord = {
  id: 't1',
  input: 'Capital of France?',
  rubric: [{ id: 'cap', text: 'names the capital', kind: 'fact', expected: 'Paris' }],
};
const of = (text: string): PGCompletionProvider => ({ complete: async () => text });

describe('LLMRubricJudge abort (S1)', () => {
  it('settles within 100 ms of abort with a never-resolving provider', async () => {
    let resolveLate: (v: string) => void = () => undefined;
    const provider: PGCompletionProvider = {
      complete: () => new Promise<string>((resolve) => { resolveLate = resolve; }),
    };
    const controller = new AbortController();
    const pending = new LLMRubricJudge({ provider }).judge(task, 'Paris', controller.signal);
    setTimeout(() => controller.abort(), 10);
    const started = Date.now();
    const results = await pending;
    expect(Date.now() - started).toBeLessThan(110);
    expect(results).toEqual([{ criterionId: 'cap', pass: true, note: 'LLM judge fallback (aborted)' }]);
    resolveLate(JSON.stringify([{ criterionId: 'cap', pass: false }]));
    await new Promise((r) => setTimeout(r, 0));
    expect(results[0]!.pass).toBe(true);
  });

  it('ignores a late rejection after abort', async () => {
    let rejectLate: (e: Error) => void = () => undefined;
    const provider: PGCompletionProvider = {
      complete: () => new Promise<string>((_r, reject) => { rejectLate = reject; }),
    };
    const controller = new AbortController();
    const pending = new LLMRubricJudge({ provider }).judge(task, 'Paris', controller.signal);
    controller.abort();
    expect((await pending)[0]!.note).toBe('LLM judge fallback (aborted)');
    rejectLate(new Error('late'));
  });
});

describe('LLMRubricJudge JSON extraction (N2)', () => {
  it('takes the first balanced array when prose contains another bracket', async () => {
    const text = 'Sure! [ {"criterionId": "cap", "pass": false, "note": "x [y]"} ] hope [ok]';
    expect(await new LLMRubricJudge({ provider: of(text) }).judge(task, 'Paris')).toEqual([
      { criterionId: 'cap', pass: false, note: 'x [y]' },
    ]);
  });

  it('parses the whole trimmed text first', async () => {
    const text = `  ${JSON.stringify([{ criterionId: 'cap', pass: false }])}\n`;
    expect(await new LLMRubricJudge({ provider: of(text) }).judge(task, 'Paris')).toEqual([{ criterionId: 'cap', pass: false }]);
  });

  it('tries outward candidates when the shortest balanced slice does not parse', async () => {
    const text = 'Result: [{"criterionId": "cap", "pass": false}]] trailing';
    expect(await new LLMRubricJudge({ provider: of(text) }).judge(task, 'Paris')).toEqual([{ criterionId: 'cap', pass: false }]);
  });

  it('falls back when nothing parses', async () => {
    const results = await new LLMRubricJudge({ provider: of('[not json] and [neither]') }).judge(task, 'Paris');
    expect(results[0]!.note).toBe('LLM judge fallback (malformed JSON)');
  });
});
