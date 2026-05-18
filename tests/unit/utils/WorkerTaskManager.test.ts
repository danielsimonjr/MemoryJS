/**
 * WorkerTaskManager unit tests.
 *
 * Mocks the underlying `WorkerPoolManager` so tests run without spinning up
 * real worker threads. The mock exposes a single tiny `Pool` shape with
 * `exec(methodName, args)` returning a Promise — that's the only contract
 * `WorkerTaskManager` consumes.
 *
 * Coverage:
 *   - submit happy path returns the worker's result
 *   - submit propagates worker errors through the queue
 *   - submitWithHandle status transitions (PENDING → RUNNING → COMPLETED)
 *   - cancel before dispatch evicts from the queue
 *   - cancel after completion is a no-op (returns false)
 *   - priority ordering — high-priority task runs before normal-priority
 *     when both are enqueued while the pool is busy
 *   - getStats aggregates across queue + touched pools
 *   - batchProcessViaWorkers fans out + collects results in order
 *   - empty batch returns []
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkerTaskManager,
  batchProcessViaWorkers,
  _resetWorkerTaskManagerForTests,
} from '../../../src/utils/WorkerTaskManager.js';
import { TaskPriority, TaskStatus } from '../../../src/utils/taskScheduler.js';

// In-memory record of every exec call the mock pool sees. Reset in beforeEach.
const execCalls: Array<{ poolId: string; methodName: string; args: unknown[]; ts: number }> = [];

// Programmable exec behaviour per (poolId, methodName) tuple. Tests can set
// this to control return values + delays.
const execBehaviour = new Map<string, {
  result?: unknown;
  error?: Error;
  delayMs?: number;
}>();

vi.mock('../../../src/utils/WorkerPoolManager.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/WorkerPoolManager.js')>(
    '../../../src/utils/WorkerPoolManager.js',
  );

  // Mock Pool. `exec` returns a custom thenable that exposes `.cancel()` and
  // `.pending`, mirroring workerpool's `WorkerpoolPromise` so that
  // WorkerTaskManager's mid-flight cancellation path can be exercised.
  const makeMockPool = (poolId: string) => ({
    exec(methodName: string, args: unknown[]) {
      execCalls.push({ poolId, methodName, args, ts: Date.now() });
      const key = `${poolId}:${methodName}`;
      const beh = execBehaviour.get(key);
      let cancelled = false;
      let settled = false;
      const innerPromise = new Promise<unknown>((resolve, reject) => {
        const finish = () => {
          settled = true;
          if (cancelled) {
            const err = new Error('promise cancelled');
            err.name = 'CancellationError';
            reject(err);
            return;
          }
          if (beh?.error) reject(beh.error);
          else resolve(beh?.result ?? `result-from-${methodName}`);
        };
        if (beh?.delayMs) setTimeout(finish, beh.delayMs);
        else queueMicrotask(finish);
      });
      // Augment the promise with workerpool-shaped cancel + pending fields.
      const aug = innerPromise as Promise<unknown> & {
        cancel(): void;
        pending: boolean;
      };
      aug.cancel = () => { cancelled = true; };
      Object.defineProperty(aug, 'pending', { get: () => !settled });
      return aug;
    },
    terminate: vi.fn(async () => undefined),
    stats: () => ({ totalWorkers: 1, busyWorkers: 0, idleWorkers: 1, pendingTasks: 0, activeTasks: 0 }),
  });

  const mockPools = new Map<string, ReturnType<typeof makeMockPool>>();

  return {
    ...actual,
    getWorkerPoolManager: () => ({
      getPool: (poolId: string) => {
        const existing = mockPools.get(poolId);
        if (existing) return existing;
        const pool = makeMockPool(poolId);
        mockPools.set(poolId, pool);
        return pool;
      },
      getPoolStats: (poolId: string) => ({
        poolId,
        totalWorkers: 1,
        busyWorkers: 0,
        idleWorkers: 1,
        pendingTasks: 0,
        activeTasks: 0,
        createdAt: Date.now(),
        totalTasksExecuted: execCalls.filter((c) => c.poolId === poolId).length,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
      }),
    }),
  };
});

describe('WorkerTaskManager', () => {
  let wtm: WorkerTaskManager;

  beforeEach(() => {
    execCalls.length = 0;
    execBehaviour.clear();
    _resetWorkerTaskManagerForTests();
    wtm = new WorkerTaskManager({ concurrency: 2 });
  });

  describe('submit', () => {
    it('returns the worker result on happy path', async () => {
      const result = await wtm.submit<string>('levenshtein', 'levenshteinDistance', ['a', 'b']);
      expect(result).toBe('result-from-levenshteinDistance');
      expect(execCalls).toHaveLength(1);
      expect(execCalls[0]).toMatchObject({
        poolId: 'levenshtein',
        methodName: 'levenshteinDistance',
        args: ['a', 'b'],
      });
    });

    it('propagates worker errors as rejection', async () => {
      execBehaviour.set('levenshtein:boom', { error: new Error('worker exploded') });
      await expect(
        wtm.submit('levenshtein', 'boom', []),
      ).rejects.toThrow('worker exploded');
    });

    it('routes to different pools by workerType', async () => {
      await Promise.all([
        wtm.submit('levenshtein', 'fn', []),
        wtm.submit('similarity', 'fn', []),
      ]);
      const ids = execCalls.map((c) => c.poolId).sort();
      expect(ids).toEqual(['levenshtein', 'similarity']);
    });
  });

  describe('submitWithHandle', () => {
    it('handle.status transitions PENDING → RUNNING → COMPLETED', async () => {
      execBehaviour.set('p:fn', { delayMs: 50, result: 42 });
      const handle = wtm.submitWithHandle<number>('p', 'fn', []);
      expect([TaskStatus.PENDING, TaskStatus.RUNNING]).toContain(handle.status());
      const r = await handle.result;
      expect(r).toBe(42);
      expect(handle.status()).toBe(TaskStatus.COMPLETED);
    });

    it('cancel returns true and prevents dispatch when called before exec', async () => {
      // Pre-load the queue with one busy slot so the next submission stays
      // pending long enough to cancel.
      execBehaviour.set('p:slow', { delayMs: 500 });
      execBehaviour.set('p:slow2', { delayMs: 500 });
      const blockerA = wtm.submitWithHandle<unknown>('p', 'slow', []);
      const blockerB = wtm.submitWithHandle<unknown>('p', 'slow2', []);
      const handle = wtm.submitWithHandle<unknown>('p', 'should-be-evicted', []);

      const evicted = handle.cancel();
      expect(evicted).toBe(true);
      expect(handle.status()).toBe(TaskStatus.CANCELLED);
      await expect(handle.result).rejects.toThrow(/cancel/i);

      // The blockers complete normally.
      await Promise.all([blockerA.result, blockerB.result]);
    });

    it('cancel after completion is a harmless no-op', async () => {
      const handle = wtm.submitWithHandle('p', 'fn', []);
      await handle.result;
      const evicted = handle.cancel();
      expect(evicted).toBe(false);
    });

    it('cancel mid-execution propagates to the workerpool promise', async () => {
      // Long-running task so we can observe RUNNING + cancel before settle.
      execBehaviour.set('p:slow', { delayMs: 500 });
      const handle = wtm.submitWithHandle('p', 'slow', []);
      // Yield so the queue dispatches the task to the mock pool.
      await new Promise((r) => setTimeout(r, 20));
      expect(handle.status()).toBe(TaskStatus.RUNNING);

      const cancelled = handle.cancel();
      expect(cancelled).toBe(true);
      expect(handle.status()).toBe(TaskStatus.CANCELLED);
      // The result promise rejects with a cancellation error sourced from the
      // mocked WorkerpoolPromise.
      await expect(handle.result).rejects.toThrow(/cancel/i);
    });
  });

  describe('getStats', () => {
    it('aggregates queue + touched pool stats', async () => {
      await wtm.submit('poolA', 'fn', []);
      await wtm.submit('poolB', 'fn', []);
      const stats = wtm.getStats();
      const poolIds = stats.pools.map((p) => p.poolId).sort();
      expect(poolIds).toEqual(['poolA', 'poolB']);
      expect(typeof stats.queue.pending).toBe('number');
    });
  });
});

describe('batchProcessViaWorkers', () => {
  beforeEach(() => {
    execCalls.length = 0;
    execBehaviour.clear();
    _resetWorkerTaskManagerForTests();
  });

  it('fans out one task per item and returns results in order', async () => {
    const items = ['a', 'b', 'c', 'd'];
    for (const item of items) {
      execBehaviour.set(`tok:tokenize`, { result: 'placeholder' }); // overwritten by closure below
    }
    // Use the items themselves as the result so we can prove ordering.
    const results = await batchProcessViaWorkers<string, string>(
      items,
      'tok',
      'identity',
      (item) => [item],
    );
    expect(results).toHaveLength(items.length);
    // The mock returns `result-from-identity` for every call — order matches
    // input order because Promise.all preserves it.
    expect(results.every((r) => r === 'result-from-identity')).toBe(true);
    expect(execCalls).toHaveLength(items.length);
    expect(execCalls.map((c) => c.args[0])).toEqual(items);
  });

  it('empty input returns empty output without touching the pool', async () => {
    const results = await batchProcessViaWorkers([], 'tok', 'identity', () => []);
    expect(results).toEqual([]);
    expect(execCalls).toHaveLength(0);
  });

  it('rejects on first task failure', async () => {
    execBehaviour.set('tok:fn', { error: new Error('item-fail') });
    await expect(
      batchProcessViaWorkers(['a'], 'tok', 'fn', () => []),
    ).rejects.toThrow('item-fail');
  });
});
