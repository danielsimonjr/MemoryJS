/**
 * ToolCallObserver → InteractionLog wiring (spec RS-7): tool_call on start, tool_output with
 * the result on completion, errorMessage on error, fire-and-forget appends and the sessionId option.
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolCallObserver } from '../../../src/agent/ToolCallObserver.js';
import type { ToolAffordanceManager } from '../../../src/agent/ToolAffordanceManager.js';
import type { InteractionAppendInput } from '../../../src/agent/harness/InteractionLog.js';

function setup(append: (input: InteractionAppendInput) => Promise<string>, sessionId?: string) {
  const manager = { recordOutcome: vi.fn(async () => undefined) } as unknown as ToolAffordanceManager;
  const observer = new ToolCallObserver(manager);
  const log = { append: vi.fn(append) };
  if (sessionId === undefined) observer.setInteractionLog(log);
  else observer.setInteractionLog(log, sessionId);
  return { observer, log };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ToolCallObserver interaction log', () => {
  it('appends tool_call with the args on observeStart', async () => {
    const { observer, log } = setup(async () => 'e1');
    observer.observeStart('shell.run', { cmd: 'ls' });
    await flush();
    expect(log.append).toHaveBeenCalledWith({
      sessionId: 'tool-call-observer',
      kind: 'tool_call',
      tag: 'shell.run',
      content: JSON.stringify({ args: { cmd: 'ls' } }),
    });
  });

  it('S2: appends tool_output including the result on observeComplete', async () => {
    const { observer, log } = setup(async () => 'e1');
    const id = observer.observeStart('shell.run');
    await observer.observeComplete(id, { result: 'file-a\nfile-b' });
    await flush();
    const out = log.append.mock.calls.map((c) => c[0]).find((i) => i.kind === 'tool_output')!;
    expect(JSON.parse(out.content)).toMatchObject({ outcome: 'success', result: 'file-a\nfile-b' });
  });

  it('records errorMessage on observeError', async () => {
    const { observer, log } = setup(async () => 'e1');
    const id = observer.observeStart('http.get');
    await observer.observeError(id, new Error('ECONNRESET'));
    await flush();
    const out = log.append.mock.calls.map((c) => c[0]).find((i) => i.kind === 'tool_output')!;
    expect(JSON.parse(out.content)).toMatchObject({ outcome: 'failure', errorMessage: 'ECONNRESET' });
  });

  it('S3: a hanging append does not block the toolCall event', async () => {
    const { observer } = setup(() => new Promise<string>(() => {}));
    const seen = vi.fn();
    observer.events.on('toolCall:complete', seen);
    const id = observer.observeStart('slow.tool');
    const done = observer.observeComplete(id, { result: 'ok' });
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 100));
    expect(await Promise.race([done.then(() => 'done'), timeout])).toBe('done');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a rejecting append is swallowed', async () => {
    const { observer } = setup(async () => { throw new Error('disk full'); });
    const id = observer.observeStart('x');
    await expect(observer.observeComplete(id)).resolves.toBeUndefined();
  });

  it('N4: writes the configured sessionId on each record', async () => {
    const { observer, log } = setup(async () => 'e1', 'agent-7');
    const id = observer.observeStart('x');
    await observer.observeComplete(id);
    await flush();
    expect(log.append.mock.calls.map((c) => c[0].sessionId)).toEqual(['agent-7', 'agent-7']);
  });
});
