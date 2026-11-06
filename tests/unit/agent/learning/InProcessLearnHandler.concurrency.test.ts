/**
 * MEMORY_LEARNING_CONCURRENCY sets the child concurrency passed to runLeafTrace.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

const { runLeafTrace } = vi.hoisted(() => ({ runLeafTrace: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('../../../../src/agent/learning/RecursiveDrive.js', () => ({ runLeafTrace }));

import { createInProcessLearnHandler, DEFAULT_CHILD_CONCURRENCY } from '../../../../src/agent/learning/InProcessLearnHandler.js';
import { RecursiveLearner } from '../../../../src/agent/learning/RecursiveLearner.js';

const leafDriver = {} as never;
const source = { childDriver: async () => leafDriver } as never;
const task = { input: { childTraceId: 'child-1' } } as never;

async function concurrencyUsed(): Promise<number> {
  runLeafTrace.mockClear();
  await createInProcessLearnHandler(source, {} as never)(task, undefined as never);
  return runLeafTrace.mock.calls[0]![3] as number;
}

beforeEach(() => {
  runLeafTrace.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MEMORY_LEARNING_CONCURRENCY', () => {
  it('defaults to DEFAULT_CHILD_CONCURRENCY when unset', async () => {
    expect(await concurrencyUsed()).toBe(DEFAULT_CHILD_CONCURRENCY);
  });

  it('uses a valid strict integer >= 1', async () => {
    vi.stubEnv('MEMORY_LEARNING_CONCURRENCY', '7');
    expect(await concurrencyUsed()).toBe(7);
  });

  it('falls back to the default for 0, decimals, and non-numeric values', async () => {
    for (const bad of ['0', '2.5', 'many']) {
      vi.stubEnv('MEMORY_LEARNING_CONCURRENCY', bad);
      expect(await concurrencyUsed(), bad).toBe(DEFAULT_CHILD_CONCURRENCY);
    }
  });

  it('is not consulted for recursive drivers', async () => {
    vi.stubEnv('MEMORY_LEARNING_CONCURRENCY', '3');
    const recursive = Object.create(RecursiveLearner.prototype) as { drive: () => Promise<void> };
    recursive.drive = vi.fn(async () => undefined);
    const handler = createInProcessLearnHandler(
      { childDriver: async () => recursive } as never,
      {} as never,
    );
    await handler(task, undefined as never);
    expect(recursive.drive).toHaveBeenCalled();
    expect(runLeafTrace).not.toHaveBeenCalled();
  });
});
