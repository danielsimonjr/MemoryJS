/**
 * RecursaToolAdapter: the §3.8 tool surface over a temp ManagerContext, on JSONL and SQLite.
 * The leaf run is driven only through `call`, with the harness answering solve and judge steps.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readdirSync } from 'node:fs';
import { ManagerContext } from '../../../src/core/ManagerContext.js';
import { createRecursaTools, type RecursaToolSet, type RecursaToolResult } from '../../../src/adapters/RecursaToolAdapter.js';
import { InteractionLog } from '../../../src/agent/harness/InteractionLog.js';
import { DeterministicJudge } from '../../../src/agent/evaluation/DeterministicJudge.js';
import type { TaskRecord } from '../../../src/types/learning.js';
import { makeTempDir, makeTempJsonlPath, makeTempSqlitePath, cleanupTempDirs } from '../../helpers/tempStorage.js';
import { skillInput } from '../agent/knowledge/knowledgeFixtures.js';

/** Section 3.8 tool names, in table order. */
const EXPECTED_NAMES = [
  'recursa.knowledge.load',
  'recursa.skills.publish',
  'recursa.skills.import',
  'recursa.learn.start',
  'recursa.learn.next',
  'recursa.learn.submit',
  'recursa.learn.plan',
  'recursa.learn.submitChild',
  'recursa.learn.merge',
  'recursa.learn.reflect',
  'recursa.learn.status',
  'recursa.log.append',
  'recursa.log.select',
  'recursa.eval.run',
];

/** Backends the persistence-sensitive tests run on. */
const BACKENDS = [
  { name: 'jsonl', path: makeTempJsonlPath, type: 'jsonl' as const },
  { name: 'sqlite', path: makeTempSqlitePath, type: 'sqlite' as const },
];

/**
 * Task with a fact rubric; its answer is `expected`.
 *
 * @param id - Task id.
 * @param expected - Expected answer.
 * @returns The task.
 */
function task(id: string, expected: string): TaskRecord {
  return {
    id,
    input: `${id} general question`,
    category: 'general',
    sources: [{ ref: `doc-${id}`, kind: 'document' }],
    rubric: [{ id: 'c1', text: 'states the value', kind: 'fact', expected }],
  };
}

const TASKS: TaskRecord[] = [task('task-a', 'alpha'), task('task-b', 'beta'), task('task-c', 'gamma')];

/**
 * Assert a result is a success and return its payload.
 *
 * @param out - Tool result.
 * @returns The result payload.
 */
function okOf(out: RecursaToolResult): unknown {
  if (!out.ok) throw new Error(`expected ok, got ${out.error.code}: ${out.error.message}`);
  return out.result;
}

/**
 * Assert a result is a failure with the given code.
 *
 * @param out - Tool result.
 * @param code - Expected error code.
 */
function expectCode(out: RecursaToolResult, code: string): void {
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe(code);
}

describe.each(BACKENDS)('RecursaToolAdapter on $name', (backend) => {
  const contexts: ManagerContext[] = [];
  const logs: InteractionLog[] = [];
  const savedEmbed = process.env.MEMORY_EMBEDDING_PROVIDER;

  afterEach(async () => {
    for (const ctx of contexts.splice(0)) await ctx.close();
    for (const log of logs.splice(0)) await log.close();
    if (savedEmbed === undefined) delete process.env.MEMORY_EMBEDDING_PROVIDER;
    else process.env.MEMORY_EMBEDDING_PROVIDER = savedEmbed;
    cleanupTempDirs();
  });

  /**
   * Fresh context on this backend.
   *
   * @returns The context.
   */
  function open(): ManagerContext {
    process.env.MEMORY_EMBEDDING_PROVIDER = 'none';
    const ctx = new ManagerContext({ storagePath: backend.path(), storageType: backend.type, skillPublishRoot: tmpdir() });
    contexts.push(ctx);
    return ctx;
  }

  /**
   * Interaction log next to a fresh storage path.
   *
   * @param dir - Directory of the storage path.
   * @returns The log.
   */
  function logIn(dir: string): InteractionLog {
    const log = new InteractionLog(join(dir, 'memory.jsonl'), { maxInlineBytes: 64 });
    logs.push(log);
    return log;
  }

  it('list() matches the section 3.8 table exactly', () => {
    const tools = createRecursaTools(open());
    const list = tools.list();
    expect(list.map((t) => t.name)).toEqual(EXPECTED_NAMES);
    for (const t of list) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.inputSchema).toBe('object');
    }
  });

  it('knowledge.load returns Markdown and ids for a solver prompt', async () => {
    const ctx = open();
    const tools = createRecursaTools(ctx);
    const out = okOf(await tools.call('recursa.knowledge.load', { role: 'solver', taskHint: 'ledger totals' })) as {
      markdown: string;
      skillIds: string[];
    };
    expect(typeof out.markdown).toBe('string');
    expect(Array.isArray(out.skillIds)).toBe(true);
  });

  it('drives a leaf run to done through call alone, applying a learned skill', async () => {
    const ctx = open();
    const publishDir = makeTempDir('recursa-tool-run-');
    const tools = createRecursaTools(ctx, { publishDir });
    const started = okOf(
      await tools.call('recursa.learn.start', { tasks: TASKS, budget: { maxRounds: 3 } }),
    ) as { traceId: string };
    const traceId = started.traceId;
    const judge = new DeterministicJudge();

    let done: { kind: 'done'; result: { stoppedBecause: string; after: { allPass: number } } } | undefined;
    for (let guard = 0; guard < 200 && !done; guard++) {
      const step = okOf(await tools.call('recursa.learn.next', { traceId })) as
        | { kind: 'solve'; tasks: Array<{ task: TaskRecord; knowledge: { markdown: string } }> }
        | { kind: 'judge'; answers: Array<{ task: TaskRecord; answer: string }> }
        | { kind: 'done'; result: { stoppedBecause: string; after: { allPass: number } } };
      if (step.kind === 'done') {
        done = step;
      } else if (step.kind === 'solve') {
        // Harness-side solver: task-a and task-c pass without knowledge; task-b needs `Learned: task-b`.
        const payload: Record<string, { answer: string; traceAddrs: string[] }> = {};
        for (const { task: t, knowledge } of step.tasks) {
          const known = t.id !== 'task-b' || knowledge.markdown.includes('Learned: task-b');
          payload[t.id] = { answer: known ? String(t.rubric[0]!.expected) : 'no idea', traceAddrs: [] };
        }
        expectSubmitOk(await tools.call('recursa.learn.submit', { traceId, kind: 'solve', payload }));
      } else {
        const payload: Record<string, Array<{ criterionId: string; pass: boolean }>> = {};
        for (const a of step.answers) {
          const results = await judge.judge(a.task, a.answer);
          payload[a.task.id] = results.map((r) => ({ criterionId: r.criterionId, pass: r.pass }));
        }
        expectSubmitOk(await tools.call('recursa.learn.submit', { traceId, kind: 'judge', payload }));
      }
    }

    expect(done).toBeDefined();
    expect(done!.result.stoppedBecause).toBe('all-pass');
    expect(done!.result.after.allPass).toBe(1);
    expect((await ctx.skillManager.list()).map((s) => s.name)).toContain('Learned: task-b');
    const published = readdirSync(publishDir, { recursive: true }).map(String);
    expect(published.some((f) => f.endsWith('SKILL.md'))).toBe(true);
  });

  it('publish then import round-trips the live skills', async () => {
    const ctx = open();
    const publishDir = makeTempDir('recursa-tool-publish-');
    await ctx.skillManager.add(skillInput('Round trip skill'));
    const tools = createRecursaTools(ctx, { publishDir });
    const published = okOf(await tools.call('recursa.skills.publish', {})) as { skillCount: number };
    expect(published.skillCount).toBeGreaterThanOrEqual(1);
    const imported = okOf(await tools.call('recursa.skills.import', {})) as { conflicts: unknown[]; parseErrors: unknown[] };
    expect(imported.conflicts).toEqual([]);
    expect(imported.parseErrors).toEqual([]);
  });

  it('log.append and log.select return only the excerpt', async () => {
    const dir = makeTempDir('recursa-tool-log-');
    const tools = createRecursaTools(open(), { interactionLog: logIn(dir) });
    const appended = okOf(
      await tools.call('recursa.log.append', {
        sessionId: 's1',
        kind: 'tool_output',
        content: 'line one\nerror: boom\nline three',
        tokens: { input: 10, output: 4 },
      }),
    ) as { addr: string; tokens: { input: number; output: number } };
    expect(appended.addr).toBe('e1');
    expect(appended.tokens).toEqual({ input: 10, output: 4 });
    const selected = okOf(await tools.call('recursa.log.select', { addr: 'e1', regex: 'error' })) as {
      lines: Array<{ text: string }>;
    };
    expect(selected.lines.map((l) => l.text)).toEqual(['error: boom']);
  });

  it('eval.run judges harness answers and returns metrics', async () => {
    const tools = createRecursaTools(open());
    const out = okOf(
      await tools.call('recursa.eval.run', { tasks: TASKS, answers: { 'task-a': 'alpha', 'task-b': 'wrong' } }),
    ) as { metrics: { tasks: number; allPass: number }; feedback: unknown[] };
    expect(out.metrics.tasks).toBe(3);
    expect(out.metrics.allPass).toBeCloseTo(1 / 3);
    expect(out.feedback).toHaveLength(3);
  });

  it('invalid args return invalid_args and never throw', async () => {
    const tools = createRecursaTools(open());
    expectCode(await tools.call('recursa.learn.start', { tasks: [] }), 'invalid_args');
    expectCode(await tools.call('recursa.log.select', { addr: 'x' }), 'invalid_args');
    expectCode(await tools.call('recursa.eval.run', 'nope'), 'invalid_args');
    expectCode(await tools.call('recursa.eval.run', { tasks: [...TASKS, TASKS[0]], answers: {} }), 'invalid_args');
  });

  it('unknown tool name returns unknown_tool', async () => {
    expectCode(await createRecursaTools(open()).call('recursa.nope', {}), 'unknown_tool');
  });

  it('an aborted signal returns aborted', async () => {
    const tools: RecursaToolSet = createRecursaTools(open());
    const controller = new AbortController();
    controller.abort();
    expectCode(await tools.call('recursa.eval.run', { tasks: TASKS, answers: {} }, controller.signal), 'aborted');
  });

  it('log tools without an interactionLog return not_configured; merge without a solver returns solver_required', async () => {
    const tools = createRecursaTools(open());
    expectCode(
      await tools.call('recursa.log.append', { sessionId: 's', kind: 'note', content: 'x' }),
      'not_configured',
    );
    expectCode(await tools.call('recursa.learn.merge', { traceId: 'learning-trace-missing' }), 'solver_required');
  });

  it('skills tools without publishDir return not_configured', async () => {
    const tools = createRecursaTools(open());
    expectCode(await tools.call('recursa.skills.publish', {}), 'not_configured');
    expectCode(await tools.call('recursa.skills.import', { dir: 'sub' }), 'not_configured');
  });

  it('bounds an oversize result and marks it truncated', async () => {
    const tools = createRecursaTools(open(), { maxBytes: 1024 });
    const many = Array.from({ length: 30 }, (_, i) => task(`task-${i}`, `value-${i}`));
    const answers = Object.fromEntries(many.map((t) => [t.id, 'x'.repeat(40)]));
    const out = okOf(await tools.call('recursa.eval.run', { tasks: many, answers })) as Record<string, unknown>;
    expect(out.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(out), 'utf8')).toBeLessThanOrEqual(1024);
  });
});

/**
 * Assert a submit call succeeded.
 *
 * @param out - Tool result.
 */
function expectSubmitOk(out: RecursaToolResult): void {
  okOf(out);
}
