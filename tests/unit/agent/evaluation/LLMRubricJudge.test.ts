/**
 * Unit tests for the LLM rubric judge: validation and per-criterion fallback.
 *
 * @module tests/unit/agent/evaluation/LLMRubricJudge
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMRubricJudge } from '../../../../src/agent/evaluation/LLMRubricJudge.js';
import { DeterministicJudge } from '../../../../src/agent/evaluation/DeterministicJudge.js';
import type { PGCompletionProvider } from '../../../../src/agent/procedural/graph/CompletionProvider.js';
import type { TaskRecord } from '../../../../src/types/learning.js';

const task: TaskRecord = {
  id: 't1',
  input: 'Capital of France and its population?',
  rubric: [
    { id: 'cap', text: 'names the capital', kind: 'fact', expected: 'Paris' },
    { id: 'pop', text: 'population in millions', kind: 'number', expected: 2, tolerance: 0.5 },
  ],
};
const answer = 'Paris, population 2.1 million';

function provider(output: string | (() => Promise<string>)): PGCompletionProvider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(typeof output === 'string' ? async () => output : output);
  return { complete } as PGCompletionProvider & { complete: ReturnType<typeof vi.fn> };
}

const fallbackOnly = async (): Promise<unknown> => new DeterministicJudge().judge(task, answer);

describe('LLMRubricJudge', () => {
  it('uses valid model verdicts when every criterion is covered', async () => {
    const p = provider(
      JSON.stringify([
        { criterionId: 'cap', pass: false, note: 'model says no' },
        { criterionId: 'pop', pass: true },
      ]),
    );
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results).toEqual([
      { criterionId: 'cap', pass: false, note: 'model says no' },
      { criterionId: 'pop', pass: true },
    ]);
    expect(p.complete).toHaveBeenCalledOnce();
    const prompt = p.complete.mock.calls[0]![0] as string;
    expect(prompt).toContain('"cap"');
    expect(prompt).toContain('<answer>');
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const p = provider('```json\n[{"criterionId":"cap","pass":true},{"criterionId":"pop","pass":true}]\n```');
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results.every((r) => r.pass)).toBe(true);
    expect(results.every((r) => r.note === undefined)).toBe(true);
  });

  it('malformed JSON falls back to the deterministic judge for every criterion', async () => {
    const p = provider('Sure! I think both pass.');
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    const expected = await fallbackOnly();
    expect(results.map((r) => r.pass)).toEqual(expected.map((r) => r.pass));
    for (const r of results) {
      expect(r.note).toContain('LLM judge fallback');
    }
  });

  it('schema-invalid JSON falls back', async () => {
    const p = provider('[{"criterionId":"cap","pass":"yes"}]');
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results.every((r) => r.note?.includes('LLM judge fallback'))).toBe(true);
  });

  it('unknown criterionId falls back for every criterion', async () => {
    const p = provider(
      JSON.stringify([
        { criterionId: 'cap', pass: false },
        { criterionId: 'pop', pass: false },
        { criterionId: 'ghost', pass: true },
      ]),
    );
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results.map((r) => r.pass)).toEqual([true, true]);
    expect(results.every((r) => r.note?.includes('unknown criterionId ghost'))).toBe(true);
  });

  it('a missing criterion falls back only for that criterion', async () => {
    const p = provider(JSON.stringify([{ criterionId: 'cap', pass: false }]));
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results[0]).toEqual({ criterionId: 'cap', pass: false });
    expect(results[1]!.pass).toBe(true);
    expect(results[1]!.note).toContain('no valid model verdict');
  });

  it('provider throw falls back with the error in the note', async () => {
    const p = provider(async () => {
      throw new Error('rate limited');
    });
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer);
    expect(results.every((r) => r.note?.includes('rate limited'))).toBe(true);
    expect(results.map((r) => r.pass)).toEqual([true, true]);
  });

  it('abort before the call skips the provider and falls back without throwing', async () => {
    const p = provider('[]');
    const controller = new AbortController();
    controller.abort();
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer, controller.signal);
    expect(p.complete).not.toHaveBeenCalled();
    expect(results.every((r) => r.note?.includes('aborted'))).toBe(true);
  });

  it('abort during the call resolves to the fallback without throwing', async () => {
    const controller = new AbortController();
    const p = provider(() => {
      controller.abort();
      return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
    });
    const results = await new LLMRubricJudge({ provider: p }).judge(task, answer, controller.signal);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.note?.includes('aborted'))).toBe(true);
  });

  it('forwards the abort signal to the provider', async () => {
    const p = provider('[]');
    const controller = new AbortController();
    await new LLMRubricJudge({ provider: p }).judge(task, answer, controller.signal);
    expect(p.complete.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });
});
