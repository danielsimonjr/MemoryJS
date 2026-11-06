/**
 * ConcurrencyLimiter unit tests (spec RS-9).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  AbortError,
  InProcessSubagentRunner,
  runAll,
  runAllWithStats,
} from '../../../../src/agent/harness/ConcurrencyLimiter.js';
import { KnowledgeGraphError } from '../../../../src/utils/errors.js';

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runAll', () => {
  it('returns results in input order', async () => {
    const results = await runAll([1, 2, 3], async (n) => n * 10, { concurrency: 2 });
    expect(results).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it('isolates item errors and never rejects for them', async () => {
    const boom = new Error('boom');
    const results = await runAll(
      ['a', 'b', 'c'],
      async (item) => {
        if (item === 'b') throw boom;
        return item.toUpperCase();
      },
      { concurrency: 3 },
    );
    expect(results[0]).toEqual({ ok: true, value: 'A' });
    expect(results[1]).toEqual({ ok: false, error: boom });
    expect(results[2]).toEqual({ ok: true, value: 'C' });
  });

  it('captures synchronous throws as item errors', async () => {
    const results = await runAll([1], () => {
      throw new Error('sync');
    }, { concurrency: 1 });
    expect(results[0].ok).toBe(false);
  });

  it('passes index and signal to the function', async () => {
    const controller = new AbortController();
    const seen: Array<[number, AbortSignal]> = [];
    await runAll(['x', 'y'], async (_item, index, signal) => {
      seen.push([index, signal]);
      return index;
    }, { concurrency: 1, signal: controller.signal });
    expect(seen.map(([i]) => i)).toEqual([0, 1]);
    expect(seen[0][1]).toBe(controller.signal);
  });

  it('returns an empty array for empty input', async () => {
    await expect(runAll([], async () => 1, { concurrency: 4 })).resolves.toEqual([]);
  });

  it('never has more than `concurrency` items in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = Array.from({ length: 6 }, () => deferred());
    const run = runAll(
      [0, 1, 2, 3, 4, 5],
      async (i) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gates[i].promise;
        inFlight--;
        return i;
      },
      { concurrency: 2 },
    );
    for (const gate of gates) {
      await new Promise((r) => setTimeout(r, 0));
      gate.resolve();
    }
    const results = await run;
    expect(maxInFlight).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it.each([0, NaN, 1.5, -1, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects concurrency %s',
    async (concurrency) => {
      const fn = vi.fn(async () => 1);
      await expect(runAll([1], fn, { concurrency })).rejects.toBeInstanceOf(KnowledgeGraphError);
      expect(fn).not.toHaveBeenCalled();
    },
  );
});

describe('runAllWithStats', () => {
  it('counts started, settled, failed and queued time with a single slot', async () => {
    vi.useFakeTimers();
    const pending = runAllWithStats(
      [0, 1, 2],
      async (i) => {
        await new Promise((r) => setTimeout(r, 100));
        if (i === 1) throw new Error('fail');
        return i;
      },
      { concurrency: 1 },
    );
    await vi.advanceTimersByTimeAsync(300);
    const { results, stats } = await pending;

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(stats).toEqual({ started: 3, settled: 3, failed: 1, aborted: 0, queuedMs: 300 });
  });

  it('reports no queued time when every item gets a slot at once', async () => {
    vi.useFakeTimers();
    const pending = runAllWithStats([1, 2], async (n) => n, { concurrency: 2 });
    await vi.advanceTimersByTimeAsync(0);
    const { stats } = await pending;
    expect(stats.queuedMs).toBe(0);
    expect(stats.started).toBe(2);
  });
});

describe('abort', () => {
  it('cancels every item without calling fn when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => 1);
    const { results, stats } = await runAllWithStats([1, 2, 3], fn, {
      concurrency: 2,
      signal: controller.signal,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(stats).toEqual({ started: 0, settled: 3, failed: 0, aborted: 3, queuedMs: 0 });
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeInstanceOf(AbortError);
    }
  });

  it('resolves queued and in-flight items as AbortError on abort and ignores late results', async () => {
    const controller = new AbortController();
    const gate = deferred<number>();
    const fn = vi.fn((i: number) => (i === 0 ? gate.promise : Promise.resolve(i)));

    const run = runAllWithStats([0, 1, 2, 3, 4], fn, {
      concurrency: 1,
      signal: controller.signal,
    });
    controller.abort();
    gate.resolve(42);

    const { results, stats } = await run;
    expect(fn).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBeInstanceOf(AbortError);
        expect((r.error as Error).name).toBe('AbortError');
      }
    }
    expect(stats).toEqual({ started: 1, settled: 5, failed: 0, aborted: 5, queuedMs: expect.any(Number) });
  });

  it('settles with every result when an in-flight item fails after abort', async () => {
    const controller = new AbortController();
    const gate = deferred<number>();
    const run = runAll([0, 1, 2], (i) => (i === 0 ? gate.promise : Promise.resolve(i)), {
      concurrency: 1,
      signal: controller.signal,
    });
    controller.abort();
    gate.reject(new Error('in-flight failure'));

    const results = await run;
    expect(results[0].ok).toBe(false);
    expect(results.slice(1).every((r) => !r.ok)).toBe(true);
  });
});

describe('InProcessSubagentRunner', () => {
  it('dispatches each task to the handler for its kind', async () => {
    const runner = new InProcessSubagentRunner({
      map: async (task) => ({ mapped: task.input }),
      learn: async () => 'learned',
    });
    await expect(runner.run({ kind: 'map', input: 'corpus' })).resolves.toEqual({ mapped: 'corpus' });
    await expect(runner.run({ kind: 'learn', input: null })).resolves.toBe('learned');
  });

  it('rejects a kind with no handler', async () => {
    const runner = new InProcessSubagentRunner({});
    await expect(runner.run({ kind: 'practice', input: 1 })).rejects.toBeInstanceOf(KnowledgeGraphError);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn(async () => 'never');
    const runner = new InProcessSubagentRunner({ learn: handler });
    await expect(runner.run({ kind: 'learn', input: 1 }, controller.signal)).rejects.toBeInstanceOf(AbortError);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ConcurrencyLimiter hardening', () => {
  it('B3: settles within 100 ms of abort when an in-flight fn never settles', async () => {
    const controller = new AbortController();
    const run = runAllWithStats([0, 1], () => new Promise<number>(() => {}), { concurrency: 2, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 110));
    const outcome = await Promise.race([run, timeout]);
    expect(outcome).not.toBe('timeout');
    const { results, stats } = outcome as Awaited<typeof run>;
    expect(results.every((r) => !r.ok && r.error instanceof AbortError)).toBe(true);
    expect(stats.aborted).toBe(2);
  });

  it('S4: inherited Object.prototype keys are unknown kinds', async () => {
    const runner = new InProcessSubagentRunner({});
    for (const kind of ['constructor', 'toString', '__proto__']) {
      await expect(runner.run({ kind: kind as 'learn', input: 1 })).rejects.toBeInstanceOf(KnowledgeGraphError);
    }
  });

  it('N7: an aborted signal rejects with AbortError before the handler lookup', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = new InProcessSubagentRunner({});
    await expect(runner.run({ kind: 'practice', input: 1 }, controller.signal)).rejects.toBeInstanceOf(AbortError);
  });
});
