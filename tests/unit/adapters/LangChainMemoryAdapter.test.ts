/**
 * LangChainMemoryAdapter Smoke Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LangChainMemoryAdapter } from '../../../src/adapters/LangChainMemoryAdapter.js';
import { ManagerContext } from '../../../src/core/ManagerContext.js';

describe('LangChainMemoryAdapter', () => {
  let ctx: ManagerContext;
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `langchain-${Date.now()}-${Math.random()}`);
    await fs.mkdir(dir, { recursive: true });
    ctx = new ManagerContext(join(dir, 'mem.jsonl'));
  });

  afterEach(async () => {
    ctx.storage.clearCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('saveContext + loadMemoryVariables round-trip a single turn pair', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, { sessionId: 'lc-test-1' });
    await adapter.saveContext({ input: 'hello' }, { output: 'hi there' });
    const vars = await adapter.loadMemoryVariables();
    const messages = vars.history;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'hi there' });
  });

  it('returnString joins messages into a transcript', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, {
      sessionId: 'lc-test-2',
      returnString: true,
    });
    await adapter.saveContext({ input: 'q' }, { output: 'a' });
    const vars = await adapter.loadMemoryVariables();
    expect(typeof vars.history).toBe('string');
    expect(vars.history).toContain('user: q');
    expect(vars.history).toContain('assistant: a');
  });

  it('memoryKeys reflects the configured key', () => {
    const adapter = new LangChainMemoryAdapter(ctx, { memoryKey: 'chat_history' });
    expect(adapter.memoryKeys).toEqual(['chat_history']);
  });

  it('clear() drops all turns for the session', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, { sessionId: 'lc-test-3' });
    await adapter.saveContext({ input: 'x' }, { output: 'y' });
    await adapter.clear();
    const vars = await adapter.loadMemoryVariables();
    expect((vars.history as unknown[])).toEqual([]);
  });

  it('uses configurable input/output keys', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, {
      sessionId: 'lc-test-4',
      inputKey: 'question',
      outputKey: 'answer',
    });
    await adapter.saveContext({ question: 'how?' }, { answer: 'thus.' });
    const vars = await adapter.loadMemoryVariables();
    const messages = vars.history as Array<{ role: string; content: string }>;
    expect(messages[0]!.content).toBe('how?');
    expect(messages[1]!.content).toBe('thus.');
  });

  it('handles non-string values via JSON stringification', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, { sessionId: 'lc-test-5' });
    await adapter.saveContext({ input: { nested: 'x' } }, { output: 42 });
    const vars = await adapter.loadMemoryVariables();
    const messages = vars.history as Array<{ role: string; content: string }>;
    expect(messages[0]!.content).toBe('{"nested":"x"}');
    expect(messages[1]!.content).toBe('42');
  });

  it('maxTurns caps the surfaced history', async () => {
    const adapter = new LangChainMemoryAdapter(ctx, {
      sessionId: 'lc-test-6',
      maxTurns: 2,
    });
    for (let i = 0; i < 5; i++) {
      await adapter.saveContext({ input: `q${i}` }, { output: `a${i}` });
    }
    const vars = await adapter.loadMemoryVariables();
    const messages = vars.history as Array<{ role: string; content: string }>;
    expect(messages.length).toBeLessThanOrEqual(2);
  });
});
