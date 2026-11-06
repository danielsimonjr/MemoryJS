/**
 * 12 - Harness support: the 14-tool Recursa adapter, the interaction log, and tool-call capture.
 *
 * Run: bun run examples/12-harness-tools.ts
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InteractionLog,
  ManagerContext,
  ToolCallObserver,
  createRecursaTools,
} from '../src/index.js';

/**
 * Run this example against `storagePath` and return the values the `tests/examples` gate asserts.
 */
export async function main(storagePath: string): Promise<Record<string, unknown>> {
  const ctx = new ManagerContext(storagePath);
  const log = new InteractionLog(storagePath);
  try {
    await ctx.skillManager.add({
      name: 'Refund duplicate charges',
      description: 'Use when a customer reports the same charge twice',
      kind: 'procedure',
      scope: { domains: ['billing'] },
      uncertainty: 0.2,
      body: 'Refund the later charge after confirming both in the ledger.',
    });

    // The adapter is stateless JSON-in / JSON-out: a server wraps list() and call().
    const tools = createRecursaTools(ctx, { interactionLog: log, publishDir: join(storagePath, '..', 'skills') });
    const names = tools.list().map((t) => t.name);

    const loaded = await tools.call('recursa.knowledge.load', {
      role: 'solver',
      taskHint: 'customer charged twice',
      budgetTokens: 400,
    });

    // Interaction log: append-only records addressed e1, e2, ...
    const appended = await tools.call('recursa.log.append', {
      sessionId: 'session-1',
      kind: 'note',
      tag: 'triage',
      content: 'Customer reports two identical charges on order 42.',
    });
    const addr = appended.ok ? String((appended.result as { addr?: string }).addr ?? '') : '';
    const selected = await tools.call('recursa.log.select', { addr: addr || 'e1', regex: 'charges' });

    // Judge harness-supplied answers against a rubric.
    const evaluated = await tools.call('recursa.eval.run', {
      tasks: [
        { id: 'refund-task', input: 'Refund a duplicate charge', rubric: [
          { id: 'c1', text: 'Says refund', kind: 'fact', expected: 'refund' },
        ] },
      ],
      answers: { 'refund-task': 'Issue a refund for the duplicate' },
    });

    const unknown = await tools.call('recursa.does.not.exist', {});

    // Tool-call capture: record observed tool calls into the same interaction log.
    const observer = new ToolCallObserver(ctx.toolAffordanceManager);
    observer.setInteractionLog(log, 'session-1');
    const callId = observer.observeStart('search_nodes', { query: 'refund' });
    await observer.observeComplete(callId, { result: '1 match' });
    const captured = await log.stats();

    return {
      toolCount: names.length,
      includesLoad: names.includes('recursa.knowledge.load'),
      loadOk: loaded.ok,
      loadMentionsSkill: loaded.ok && JSON.stringify(loaded.result).includes('Refund duplicate charges'),
      appendOk: appended.ok,
      selectOk: selected.ok,
      evalOk: evaluated.ok,
      unknownToolCode: unknown.ok ? null : unknown.error.code,
      recordsLogged: captured.records >= 2,
    };
  } finally {
    await log.close();
    ctx.close();
  }
}

if (import.meta.main) {
  const dir = await mkdtemp(join(tmpdir(), 'memoryjs-12-'));
  try {
    // oxlint-disable-next-line no-console -- the example prints its result
    console.log(JSON.stringify(await main(join(dir, 'memory.jsonl')), null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
