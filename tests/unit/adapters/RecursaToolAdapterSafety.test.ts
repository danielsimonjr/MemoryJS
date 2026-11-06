/**
 * RecursaToolAdapter hardening (Phase 6 checker items): publishDir confinement of the skills tools,
 * protocol error codes, strict schemas and reserved keys, eval.run answer checks, the learn.next
 * signal, judge criterion ids, and the renamed result types.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import {
  createRecursaTools,
  type RecursaToolResult,
  type RecursaToolDescriptor,
  type ToolResult,
  type ToolDescriptor,
} from '../../../src/adapters/RecursaToolAdapter.js';
import * as adapters from '../../../src/adapters/index.js';
import type { TaskRecord } from '../../../src/types/learning.js';
import { makeTempDir, makeTempJsonlPath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import { skillInput } from '../agent/knowledge/knowledgeFixtures.js';

const TASKS: TaskRecord[] = ['a', 'b'].map((id) => ({
  id,
  input: `${id} question`,
  category: 'general',
  rubric: [{ id: 'c1', text: 'states the value', kind: 'fact', expected: `${id}-value` }],
}));

/**
 * Expect a failure with the given code.
 *
 * @param out - Tool result.
 * @param code - Expected code.
 */
function expectCode(out: RecursaToolResult, code: string): void {
  expect(out.ok ? 'ok' : out.error.code).toBe(code);
}

/**
 * Payload of a successful result.
 *
 * @param out - Tool result.
 * @returns The result.
 */
function okOf(out: RecursaToolResult): any {
  if (!out.ok) throw new Error(`expected ok, got ${out.error.code}: ${out.error.message}`);
  return out.result;
}

describe('RecursaToolAdapter hardening', () => {
  const contexts: ManagerContext[] = [];
  const saved = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.close();
    if (saved === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = saved;
    cleanupTempDirs();
  });

  /** @returns A fresh JSONL context. */
  function open(): ManagerContext {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const ctx = new ManagerContext({ storagePath: makeTempJsonlPath(), storageType: 'jsonl', skillPublishRoot: tmpdir() });
    contexts.push(ctx);
    return ctx;
  }

  it('B1: skills tools refuse every escaping dir with invalid_args and create nothing', async () => {
    const ctx = open();
    await ctx.skillManager.add(skillInput('Confined'));
    const publishDir = makeTempDir('atk-pub-');
    const outside = makeTempDir('atk-outside-');
    writeFileSync(join(outside, 'secret.txt'), 's');
    symlinkSync(outside, join(publishDir, 'link'), 'dir');
    const tools = createRecursaTools(ctx, { publishDir });
    const stamp = `${process.pid}-${Date.now()}`;
    const cases = [
      `${publishDir}/../esc-${stamp}`,
      join(outside, `abs-outside-${stamp}`),
      `../rel-escape-${stamp}`,
      '/etc/atk',
      '/proc/x',
      'link',
      'link/x',
      'sub/../../up',
    ];
    const started = Date.now();
    for (const dir of cases) {
      expectCode(await tools.call('recursa.skills.publish', { dir }), 'invalid_args');
      expectCode(await tools.call('recursa.skills.import', { dir }), 'invalid_args');
    }
    expect(Date.now() - started).toBeLessThan(5000);
    expect(existsSync(resolve(`${publishDir}/../esc-${stamp}`))).toBe(false);
    expect(existsSync(join(outside, `abs-outside-${stamp}`))).toBe(false);
    expect(existsSync(resolve(publishDir, `../rel-escape-${stamp}`))).toBe(false);
    expect(existsSync(resolve(process.cwd(), `../rel-escape-${stamp}`))).toBe(false);
    expect(existsSync('/etc/atk')).toBe(false);
    expect(readdirSync(outside)).toEqual(['secret.txt']);
    expect(readdirSync(publishDir)).toEqual(['link']);
  });

  it('B1: an in-root subdir and the publishDir itself both work', async () => {
    const ctx = open();
    await ctx.skillManager.add(skillInput('In root'));
    const publishDir = makeTempDir('atk-pub-ok-');
    mkdirSync(join(publishDir, 'sub'));
    const tools = createRecursaTools(ctx, { publishDir });
    expect(okOf(await tools.call('recursa.skills.publish', { dir: 'sub/tree' })).dir).toBe(join(publishDir, 'sub', 'tree'));
    expect(okOf(await tools.call('recursa.skills.import', { dir: 'sub/tree' })).conflicts).toEqual([]);
    expect(okOf(await tools.call('recursa.skills.publish', {})).dir).toBe(resolve(publishDir));
  });

  it('S3: unknown traces are not_found; protocol misuse is invalid_state', async () => {
    const ctx = open();
    const tools = createRecursaTools(ctx);
    expectCode(await tools.call('recursa.learn.status', { traceId: 'missing-trace' }), 'not_found');
    expectCode(await tools.call('recursa.learn.next', { traceId: 'missing-trace' }), 'not_found');
    expectCode(await tools.call('recursa.learn.plan', { traceId: 'missing-trace' }), 'not_found');

    const leaf = okOf(await tools.call('recursa.learn.start', { tasks: TASKS, budget: { maxRounds: 2 } })).traceId as string;
    const step = okOf(await tools.call('recursa.learn.next', { traceId: leaf }));
    expect(step.kind).toBe('solve');
    expectCode(await tools.call('recursa.learn.plan', { traceId: leaf }), 'invalid_state');
    expectCode(await tools.call('recursa.learn.reflect', { traceId: leaf }), 'invalid_state');
    expectCode(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'judge', payload: { a: [] } }), 'invalid_state');
    const answer = { answer: 'x', traceAddrs: [] };
    expectCode(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'solve', payload: { zzz: answer } }), 'invalid_state');
    const full = { a: answer, b: answer };
    okOf(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'solve', payload: full }));
    expectCode(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'solve', payload: full }), 'invalid_state');

    const rec = okOf(await tools.call('recursa.learn.start', { tasks: TASKS, budget: { maxRounds: 1 }, split: 'byCategory' })).traceId as string;
    expectCode(await tools.call('recursa.learn.next', { traceId: rec }), 'invalid_state');
    expectCode(await tools.call('recursa.learn.reflect', { traceId: rec }), 'invalid_state');
    expectCode(await tools.call('recursa.learn.submitChild', { traceId: rec, childTraceId: 'nope' }), 'invalid_state');
  });

  it('N3: a judge payload with an unknown criterionId is invalid_args', async () => {
    const tools = createRecursaTools(open());
    const leaf = okOf(await tools.call('recursa.learn.start', { tasks: TASKS, budget: { maxRounds: 2 } })).traceId as string;
    okOf(await tools.call('recursa.learn.next', { traceId: leaf }));
    const answer = { answer: 'x', traceAddrs: [] };
    okOf(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'solve', payload: { a: answer, b: answer } }));
    expect(okOf(await tools.call('recursa.learn.next', { traceId: leaf })).kind).toBe('judge');
    const bad = { a: [{ criterionId: 'c9', pass: true }] };
    expectCode(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'judge', payload: bad }), 'invalid_args');
    const good = { a: [{ criterionId: 'c1', pass: true }] };
    okOf(await tools.call('recursa.learn.submit', { traceId: leaf, kind: 'judge', payload: good }));
  });

  it('S4: extra keys and reserved record keys are invalid_args', async () => {
    const tools = createRecursaTools(open());
    expectCode(await tools.call('recursa.learn.status', { traceId: 't', extra: 1 }), 'invalid_args');
    expectCode(await tools.call('recursa.knowledge.load', { role: 'solver', taskHint: 'x', zzz: 1 }), 'invalid_args');
    const strictTask = { ...TASKS[0], extra: true };
    expectCode(await tools.call('recursa.eval.run', { tasks: [strictTask], answers: {} }), 'invalid_args');
    const nested = { tasks: TASKS, budget: { maxRounds: 1, bogus: 2 } };
    expectCode(await tools.call('recursa.learn.start', nested), 'invalid_args');
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const answers = JSON.parse(`{"${key}":"a-value"}`) as Record<string, string>;
      expectCode(await tools.call('recursa.eval.run', { tasks: TASKS, answers }), 'invalid_args');
      const payload = JSON.parse(`{"${key}":{"answer":"x","traceAddrs":[]}}`) as Record<string, unknown>;
      expectCode(await tools.call('recursa.learn.submit', { traceId: 't', kind: 'solve', payload }), 'invalid_args');
      expectCode(await tools.call('recursa.eval.run', { tasks: [{ ...TASKS[0], id: key }], answers: {} }), 'invalid_args');
    }
    const tokens = JSON.parse('{"input":1,"output":1,"__proto__":{"x":1}}') as unknown;
    expectCode(await tools.call('recursa.log.append', { sessionId: 's', kind: 'note', content: 'x', tokens }), 'invalid_args');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('S5: eval.run refuses unknown answer ids and reports missing answers as failing with "no answer"', async () => {
    const tools = createRecursaTools(open());
    expectCode(await tools.call('recursa.eval.run', { tasks: TASKS, answers: { zzz: 'x' } }), 'invalid_args');
    const out = okOf(await tools.call('recursa.eval.run', { tasks: TASKS, answers: { a: 'a-value' } }));
    expect(out.missing).toEqual(['b']);
    expect(out.metrics.allPass).toBeCloseTo(0.5);
    const b = out.feedback.find((f: { taskId: string }) => f.taskId === 'b');
    expect(b.allPass).toBe(false);
    expect(b.criteria.every((c: { note?: string }) => c.note === 'no answer')).toBe(true);
    expect(okOf(await tools.call('recursa.eval.run', { tasks: TASKS, answers: { a: 'a-value', b: 'b-value' } })).missing).toEqual([]);
  });

  it('N2: learn.next passes the call signal through to the learning loop', async () => {
    const ctx = open();
    const seen: Array<AbortSignal | undefined> = [];
    const original = ctx.learningLoop.bind(ctx);
    ctx.learningLoop = ((deps) => {
      const loop = original(deps);
      return { ...loop, next: (traceId: string, opts?: { signal?: AbortSignal }) => (seen.push(opts?.signal), loop.next(traceId, opts)) };
    }) as typeof ctx.learningLoop;
    const tools = createRecursaTools(ctx);
    const leaf = okOf(await tools.call('recursa.learn.start', { tasks: TASKS, budget: { maxRounds: 1 } })).traceId as string;
    const controller = new AbortController();
    okOf(await tools.call('recursa.learn.next', { traceId: leaf }, controller.signal));
    expect(seen).toEqual([controller.signal]);
  });

  it('N4: Recursa* type names are primary; the deprecated aliases stay assignable and off the barrel', () => {
    const descriptor: RecursaToolDescriptor = { name: 'n', description: 'd', inputSchema: {} };
    const legacyDescriptor: ToolDescriptor = descriptor;
    const result: RecursaToolResult = { ok: true, result: 1 };
    const legacy: ToolResult = result;
    expect(legacyDescriptor.name).toBe('n');
    expect(legacy.ok).toBe(true);
    expect(typeof adapters.createRecursaTools).toBe('function');
  });
});
