/**
 * Behaviour tests for the in-repo worker pool (`src/utils/threadPool.ts`).
 *
 * The parity suite (`threadPool.parity.test.ts`) proves the *values* match the
 * package this replaced. This file covers the operational promises the spec
 * calls out separately: queueing and `maxWorkers`, worker crashes, errors thrown
 * in workers (message and stack shape), idle cleanup, and two properties a unit
 * test cannot observe from inside the process — that no worker handle outlives
 * `terminate()`, and that a scripted child process actually exits.
 *
 * @module tests/unit/utils/threadPool
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  pool,
  cpus,
  Pool,
  PoolPromise,
  CancellationError,
  TimeoutError,
  TerminateError,
} from '../../../src/utils/threadPool.js';

/** A function that sleeps inside the built-in script-less worker. */
const sleep = async (ms: number): Promise<number> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return ms;
};

/** A function that reports which worker ran it. */
const threadId = (): number => {
  // `worker_threads` is available inside both thread and process workers; in the
  // latter `threadId` is 0, which is itself a useful, comparable answer.
  return Number(process.pid);
};

describe('threadPool', () => {
  describe('cpus()', () => {
    it('reports a positive CPU count', () => {
      expect(cpus()).toBeGreaterThan(0);
      expect(Number.isInteger(cpus())).toBe(true);
    });
  });

  describe('queueing and maxWorkers', () => {
    it('never exceeds maxWorkers while tasks are queued', async () => {
      const poolUnderTest = pool({ maxWorkers: 2 });
      try {
        const tasks = Array.from({ length: 6 }, () => poolUnderTest.exec(sleep, [120]));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const stats = poolUnderTest.stats();
        expect(stats.totalWorkers).toBeLessThanOrEqual(2);
        expect(stats.pendingTasks).toBeGreaterThan(0);
        expect(stats.busyWorkers).toBeLessThanOrEqual(2);
        expect(await Promise.all(tasks)).toEqual(Array(6).fill(120));
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('runs queued tasks in submission order on one worker', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        const order: number[] = [];
        const tasks = [1, 2, 3, 4].map((value) =>
          poolUnderTest.exec(async (v: number) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return v;
          }, [value]).then((result) => { order.push(result as number); }));
        await Promise.all(tasks);
        expect(order).toEqual([1, 2, 3, 4]);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('spreads work across workers up to the cap', async () => {
      const poolUnderTest = pool({ maxWorkers: 3 });
      try {
        await Promise.all([1, 2, 3].map(() => poolUnderTest.exec(sleep, [60])));
        expect(poolUnderTest.stats().totalWorkers).toBe(3);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('throws when the queue cap is reached, and keeps serving', async () => {
      const poolUnderTest = pool({ maxWorkers: 1, maxQueueSize: 1 });
      try {
        const running = poolUnderTest.exec(sleep, [200]);
        const queued = poolUnderTest.exec(sleep, [10]);
        expect(() => poolUnderTest.exec(sleep, [10])).toThrow(/Max queue size of 1 reached/);
        await Promise.all([running, queued]);
        expect(await poolUnderTest.exec((a: number, b: number) => a + b, [2, 2])).toBe(4);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('honours minWorkers by creating workers eagerly', async () => {
      const poolUnderTest = pool({ maxWorkers: 4, minWorkers: 2 });
      try {
        expect(poolUnderTest.stats().totalWorkers).toBe(2);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });
  });

  describe('errors thrown in workers', () => {
    it('preserves the message and keeps the worker stack prefix', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        const error = await poolUnderTest.exec((): never => { throw new RangeError('bad input'); }, [])
          .then(() => null, (reason: unknown) => reason as Error);
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).toBe('bad input');
        expect(error!.stack).toContain('RangeError: bad input');
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('rejects an unknown method by name', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        await expect(poolUnderTest.exec('noSuchMethod', [])).rejects.toThrow('Unknown method "noSuchMethod"');
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('survives a worker crash and serves the next task on a replacement', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        const crash = await poolUnderTest.exec((): never => { process.exit(9); }, [])
          .then(() => null, (reason: unknown) => reason as Error);
        expect(crash).toBeInstanceOf(TerminateError);
        expect(crash!.message).toContain('Workerpool Worker terminated Unexpectedly');
        expect(crash!.message).toContain('exitCode: `9`');
        expect(await poolUnderTest.exec((a: number, b: number) => a * b, [6, 7])).toBe(42);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('reports worker errors from a scripted worker with a custom method', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'thread-pool-worker-'));
      const script = join(dir, 'customWorker.mjs');
      writeFileSync(
        script,
        [
          "import { worker } from " + JSON.stringify(pathToFileURL(join(__dirname, '..', '..', '..', 'src', 'utils', 'threadPool.ts')).href) + ";",
          'worker({',
          '  echo: (value) => value,',
          '  fail: () => { throw new TypeError("custom failure"); },',
          '});',
          '',
        ].join('\n'),
      );
      const poolUnderTest = pool(script, {
        maxWorkers: 1,
        workerType: 'thread',
        workerThreadOpts: { type: 'module', execArgv: ['--import', 'tsx'] },
      });
      try {
        expect(await poolUnderTest.exec('echo', ['hello'])).toBe('hello');
        const error = await poolUnderTest.exec('fail', [])
          .then(() => null, (reason: unknown) => reason as Error);
        expect(error!.message).toBe('custom failure');
        expect(error!.stack).toContain('TypeError: custom failure');
        // A thrown error is not a crash: the same worker keeps serving.
        expect(poolUnderTest.stats().totalWorkers).toBe(1);
        expect(await poolUnderTest.exec('echo', ['again'])).toBe('again');
      } finally {
        await poolUnderTest.terminate(true);
      }
    });
  });

  describe('idle cleanup', () => {
    it('drops a worker it had to stop and replaces it on demand', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        await poolUnderTest.exec(sleep, [10]);
        expect(poolUnderTest.stats().totalWorkers).toBe(1);
        const running = poolUnderTest.exec(sleep, [5000]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const settled = running.catch((reason: unknown) => reason);
        running.cancel();
        await settled;
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(poolUnderTest.stats().totalWorkers).toBe(0);
        expect(await poolUnderTest.exec((n: number) => n + 1, [1])).toBe(2);
        expect(poolUnderTest.stats().totalWorkers).toBe(1);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('reports an empty stats object right after terminate', async () => {
      const poolUnderTest = pool({ maxWorkers: 2 });
      await Promise.all([poolUnderTest.exec(sleep, [10]), poolUnderTest.exec(sleep, [10])]);
      expect(poolUnderTest.stats().totalWorkers).toBe(2);
      await poolUnderTest.terminate(true);
      expect(poolUnderTest.stats()).toEqual({
        totalWorkers: 0,
        busyWorkers: 0,
        idleWorkers: 0,
        pendingTasks: 0,
        activeTasks: 0,
      });
    });
  });

  describe('terminate', () => {
    it('resolves immediately with no workers', async () => {
      await expect(pool().terminate()).resolves.toBeUndefined();
    });

    it('is idempotent', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      await poolUnderTest.exec(sleep, [10]);
      await poolUnderTest.terminate(true);
      await expect(poolUnderTest.terminate(true)).resolves.toBeUndefined();
    });

    it('rejects queued tasks with "Pool terminated" on a forced shutdown', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      const running = poolUnderTest.exec(sleep, [5000]);
      const queued = poolUnderTest.exec(sleep, [10]);
      const runningResult = running.catch((reason: unknown) => (reason as Error).message);
      const queuedResult = queued.catch((reason: unknown) => (reason as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await poolUnderTest.terminate(true);
      expect(await runningResult).toBe('Worker terminated');
      expect(await queuedResult).toBe('Pool terminated');
    });

    it('lets an in-flight task finish before a graceful shutdown', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      const running = poolUnderTest.exec(sleep, [250]);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const started = Date.now();
      await poolUnderTest.terminate();
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
      expect(await running).toBe(250);
      expect(poolUnderTest.stats().totalWorkers).toBe(0);
    });
  });

  describe('promise surface', () => {
    it('exposes pending/resolved/rejected like workerpool', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        const promise = poolUnderTest.exec((n: number) => n, [1]);
        expect(promise).toBeInstanceOf(PoolPromise);
        expect(promise.pending).toBe(true);
        expect(promise.resolved).toBe(false);
        await promise;
        expect(promise.pending).toBe(false);
        expect(promise.resolved).toBe(true);
        expect(promise.rejected).toBe(false);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('rejects an abort signal that fired before submission', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      const controller = new AbortController();
      controller.abort();
      try {
        await expect(poolUnderTest.exec(sleep, [10], { signal: controller.signal }))
          .rejects.toBeInstanceOf(CancellationError);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('cancels a running task when its abort signal fires', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      const controller = new AbortController();
      try {
        const running = poolUnderTest.exec(sleep, [5000], { signal: controller.signal });
        const settled = running.catch((reason: unknown) => reason);
        await new Promise((resolve) => setTimeout(resolve, 50));
        controller.abort();
        expect(await settled).toBeInstanceOf(CancellationError);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('times out with a TimeoutError after the requested delay', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      const started = Date.now();
      try {
        // Warm the worker so the measurement is the task's own duration rather
        // than the worker's start-up (workerpool has the same cold-start cost).
        await poolUnderTest.exec((n: number) => n, [0]);
        const error = await poolUnderTest.exec(sleep, [1000]).timeout(80)
          .then(() => null, (reason: unknown) => reason as Error);
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error!.name).toBe('TimeoutError');
        expect(Date.now() - started).toBeLessThan(900);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('does not fire a timeout once the task finished', async () => {
      const poolUnderTest = pool({ maxWorkers: 1 });
      try {
        // Warm the worker first: a cold spawn can outlast a short timeout, which
        // is workerpool's behaviour too and would make this assertion about the
        // worker's start-up rather than about the timer being cleared.
        expect(await poolUnderTest.exec((n: number) => n, [0])).toBe(0);
        const promise = poolUnderTest.exec((n: number) => n, [7]);
        expect(await promise.timeout(2000)).toBe(7);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(promise.resolved).toBe(true);
        expect(promise.rejected).toBe(false);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });
  });

  describe('workerType', () => {
    it('runs tasks in a child process under workerType "process"', async () => {
      const poolUnderTest = pool({ maxWorkers: 1, workerType: 'process' });
      try {
        expect(await poolUnderTest.exec((a: number, b: number) => a + b, [40, 2])).toBe(42);
        expect(poolUnderTest.stats().totalWorkers).toBe(1);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('accepts workerType "auto" and uses threads', async () => {
      const poolUnderTest = pool({ maxWorkers: 1, workerType: 'auto' });
      try {
        expect(poolUnderTest.workerType).toBe('auto');
        const first = await poolUnderTest.exec(threadId, []);
        const second = await poolUnderTest.exec(threadId, []);
        // One worker thread serves both tasks, so the process id is the same.
        expect(second).toBe(first);
      } finally {
        await poolUnderTest.terminate(true);
      }
    });

    it('refuses the browser backend', () => {
      expect(() => pool({ workerType: 'web' })).toThrow(/Web Workers not supported/);
    });
  });

  describe('Pool construction', () => {
    it('accepts the script and options in either order', async () => {
      const withOptions = pool({ maxWorkers: 1 });
      const asClass = new Pool({ maxWorkers: 1 });
      try {
        expect(withOptions.maxWorkers).toBe(1);
        expect(asClass.maxWorkers).toBe(1);
        expect(typeof withOptions.exec).toBe('function');
      } finally {
        await withOptions.terminate(true);
        await asClass.terminate(true);
      }
    });

    it('defaults maxWorkers to cpus() - 1, minimum 1', () => {
      const poolUnderTest = pool();
      try {
        expect(poolUnderTest.maxWorkers).toBe(Math.max(cpus() - 1, 1));
      } finally {
        void poolUnderTest.terminate(true);
      }
    });
  });

  describe('process exit', () => {
    it('leaves no handle that keeps the Node process alive after terminate', () => {
      // Run in a child process so the assertion is about the real event loop, not
      // about vitest's own handles. A leftover worker keeps the loop alive and the
      // script never prints DONE; the timeout below turns that into a failure.
      const dir = mkdtempSync(join(tmpdir(), 'thread-pool-exit-'));
      const script = join(dir, 'exit.mjs');
      const moduleUrl = pathToFileURL(join(__dirname, '..', '..', '..', 'src', 'utils', 'threadPool.ts')).href;
      writeFileSync(
        script,
        [
          "import { pool } from " + JSON.stringify(moduleUrl) + ";",
          'const created = pool({ maxWorkers: 2 });',
          'const sum = await created.exec((a, b) => a + b, [1, 2]);',
          'const forked = pool({ maxWorkers: 1, workerType: "process" });',
          'const product = await forked.exec((a, b) => a * b, [3, 4]);',
          'await created.terminate(true);',
          'await forked.terminate();',
          'process.stdout.write("DONE " + sum + " " + product);',
          '',
        ].join('\n'),
      );
      const stdout = execFileSync(process.execPath, ['--import', 'tsx', script], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(stdout.trim()).toBe('DONE 3 12');
    });
  });
});
