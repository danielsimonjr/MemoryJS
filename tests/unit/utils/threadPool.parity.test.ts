/**
 * Parity replay for `src/utils/threadPool.ts`.
 *
 * The expectations come from `fixtures/threadPoolParity.json`, recorded by
 * `helpers/captureThreadPoolParity.ts` against `@danielsimonjr/workerpool`
 * 10.2.0 while it was still a dependency. Replaying it keeps the claim honest
 * after the package is gone: every observation below is the removed package's
 * observed answer, not a description of the new implementation.
 *
 * Re-record with `captureThreadPoolParity.ts` and a scratch install of
 * `@danielsimonjr/workerpool@10.2.0` (`WORKERPOOL_PATH`); this test replays the
 * frozen JSON after the package is removed from the repo.
 *
 * The Levenshtein worker is loaded as a real ESM worker thread through `tsx`
 * (`workerThreadOpts: { type: 'module' }`), which is exactly the configuration
 * `FuzzySearch` and `WorkerPoolManager` use. Timing-sensitive cases run on the
 * built-in script-less worker because the Levenshtein worker has no slow method.
 *
 * @module tests/unit/utils/threadPool.parity
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool as createPool, cpus, Pool, PoolPromise, CancellationError, TimeoutError } from '../../../src/utils/threadPool.js';
import {
  observeAll,
  observeScriptlessPool,
  pickStats,
  runFuzzyChunks,
  runLevenshteinBatch,
  synchronousMatches,
  BATCH,
  CORPUS,
  levenshteinWorkerConfig,
  type ErrorShape,
} from './helpers/threadPoolParityCases.js';

interface Fixture {
  workerpoolVersion: string;
  observations: {
    levenshtein: Array<{ label: string; results?: unknown; error?: ErrorShape }>;
    fuzzyChunks: Array<{ label: string; names: string[] }>;
    scriptless: {
      sum: number;
      product: number;
      parallel: number[];
      statsKeys: string[];
      stats: Record<string, number>;
      afterStats: Record<string, number>;
    };
    failures: {
      thrown: ErrorShape;
      unknownMethod: ErrorShape;
      badParams: ErrorShape;
      crash: { name: string; messageHead: string };
      afterCrash: number;
      maxWorkersValidation: ErrorShape;
    };
    timeoutAndCancel: {
      timeout: ErrorShape;
      afterTimeout: number;
      statsAfterTimeout: Record<string, number>;
      queuedTimeout: { rejected: number; gapAtLeast150ms: boolean };
      pendingBeforeCancel: boolean;
      cancel: ErrorShape;
      pendingAfterCancel: boolean;
      rejectedAfterCancel: boolean;
      statsAfterCancel: Record<string, number>;
      afterCancel: number;
      queuedCancel: ErrorShape;
      busySurvived: number;
    };
    terminate: {
      forcedInflight: { error: ErrorShape };
      statsAfterForced: Record<string, number>;
      gracefulInflight: number;
      statsAfterGraceful: Record<string, number>;
      queuedAtTerminate: { error: ErrorShape };
      headAtTerminate: number;
    };
  };
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'threadPoolParity.json'), 'utf8'),
) as Fixture;

describe('threadPool parity with @danielsimonjr/workerpool 10.2.0', () => {
  it('recorded the workerpool version this replay is pinned to', () => {
    expect(fixture.workerpoolVersion).toBe('10.2.0');
  });

  describe('module surface', () => {
    it('exports the names the call sites import', () => {
      expect(typeof cpus).toBe('function');
      expect(cpus()).toBeGreaterThan(0);
      expect(typeof createPool).toBe('function');
      const pool = createPool();
      try {
        expect(typeof pool.exec).toBe('function');
        expect(typeof pool.stats).toBe('function');
        expect(typeof pool.terminate).toBe('function');
      } finally {
        void pool.terminate(true);
      }
    });

    it('rejects a maxWorkers value workerpool rejects, with the same message', () => {
      // Recorded from workerpool: TypeError "Option maxWorkers must be an integer number >= 1".
      expect(() => createPool({ maxWorkers: 0 })).toThrow(TypeError);
      expect(() => createPool({ maxWorkers: 0 })).toThrow(
        fixture.observations.failures.maxWorkersValidation.message,
      );
    });
  });

  describe('Levenshtein worker results', () => {
    it('produces identical matches, scores, and match fields for every batch case', async () => {
      const observed = await runLevenshteinBatch(createPool, levenshteinWorkerConfig());
      expect(observed).toEqual(fixture.observations.levenshtein);
    });

    it('agrees with the synchronous matcher for every batch case', () => {
      for (const batchCase of BATCH) {
        const recorded = fixture.observations.levenshtein.find((entry) => entry.label === batchCase.label);
        expect(recorded, `fixture is missing ${batchCase.label}`).toBeDefined();
        const names = synchronousMatches(batchCase.query, batchCase.threshold);
        const recordedNames = ((recorded!.results ?? []) as Array<{ name: string }>).map((match) => match.name);
        expect(recordedNames).toEqual(names);
      }
    });

    it('covers name, type, observation, and no-match outcomes', () => {
      const fields = new Set(
        fixture.observations.levenshtein.flatMap((entry) =>
          ((entry.results ?? []) as Array<{ matchedIn: string }>).map((match) => match.matchedIn)),
      );
      expect([...fields].sort()).toEqual(['name', 'observation', 'type']);
      expect(fixture.observations.levenshtein.find((entry) => entry.label === 'no-match')?.results).toEqual([]);
    });

    it('keeps the recorded scores rather than merely the same names', () => {
      const typo = fixture.observations.levenshtein.find((entry) => entry.label === 'typo-name');
      expect(typo?.results).toEqual([
        { name: 'Alice', score: 0.8, matchedIn: 'name' },
        { name: 'Alise', score: 1, matchedIn: 'name' },
      ]);
      expect(CORPUS.length).toBeGreaterThan(0);
    });
  });

  describe('fuzzy-search chunk results', () => {
    it('matches the recorded entity sets when chunks run in parallel', async () => {
      const observed = await runFuzzyChunks(createPool, levenshteinWorkerConfig());
      expect(observed).toEqual(fixture.observations.fuzzyChunks);
    });
  });

  describe('pool() with no script', () => {
    it('runs stringified functions and reports the recorded stats', async () => {
      const observed = await observeScriptlessPool(createPool);
      expect(observed).toEqual(fixture.observations.scriptless);
    });
  });

  describe('failure shapes', () => {
    it('matches worker error, unknown method, crash, and validation behaviour', async () => {
      const observed = await observeAll(createPool);
      expect(observed.failures).toEqual(fixture.observations.failures);
    });

    it('keeps the worker stack on the error it surfaces', async () => {
      // Recorded from workerpool: the rejection is a plain Error whose message is
      // the worker's, and whose stack still identifies a RangeError.
      const pool = createPool({ maxWorkers: 1 });
      try {
        await expect(pool.exec((): never => { throw new RangeError('kaboom'); }, []))
          .rejects.toMatchObject({
            message: fixture.observations.failures.thrown.message,
            stack: expect.stringContaining(fixture.observations.failures.thrown.stackHead!),
          });
      } finally {
        await pool.terminate(true);
      }
    });
  });

  describe('timeout, cancel, terminate', () => {
    it('matches the recorded timeout, cancel, and terminate behaviour', async () => {
      const observed = await observeAll(createPool);
      expect(observed.timeoutAndCancel).toEqual(fixture.observations.timeoutAndCancel);
      expect(observed.terminate).toEqual(fixture.observations.terminate);
    });

    it('rejects with the recorded error names', async () => {
      const pool = createPool({ maxWorkers: 1 });
      try {
        await expect(pool.exec(async (ms: number) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          return ms;
        }, [400]).timeout(100)).rejects.toBeInstanceOf(TimeoutError);
      } finally {
        await pool.terminate(true);
      }
    });

    it('cancels with a CancellationError instance and flips `pending`', async () => {
      const pool = createPool({ maxWorkers: 1 });
      try {
        const running = pool.exec(async (ms: number) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          return ms;
        }, [5000]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(running.pending).toBe(true);
        const settled = running.catch((error: unknown) => error);
        running.cancel();
        expect(await settled).toBeInstanceOf(CancellationError);
        expect(running.pending).toBe(false);
        expect(running.rejected).toBe(true);
      } finally {
        await pool.terminate(true);
      }
    });

    it('leaves `stats()` empty after terminate, like workerpool', async () => {
      const pool = createPool();
      await pool.exec((a: number, b: number) => a + b, [1, 2]);
      expect(pool.stats().totalWorkers).toBe(1);
      await pool.terminate(true);
      expect(pickStats(pool.stats())).toEqual(fixture.observations.terminate.statsAfterForced);
    });
  });

  describe('pool internals MemoryJS reads', () => {
    it('exposes the stats fields WorkerPoolRuntimeStats mirrors', async () => {
      const pool: Pool = createPool({ maxWorkers: 2 });
      try {
        expect(Object.keys(pool.stats()).sort()).toEqual(
          ['activeTasks', 'busyWorkers', 'idleWorkers', 'pendingTasks', 'totalWorkers'],
        );
      } finally {
        await pool.terminate(true);
      }
    });

    it('returns a promise with the chainable workerpool API', async () => {
      const pool = createPool();
      try {
        const promise = pool.exec((value: number) => value + 1, [1]);
        expect(promise).toBeInstanceOf(PoolPromise);
        const chained = promise.timeout(5000).then((value) => value * 10);
        expect(await chained).toBe(20);
      } finally {
        await pool.terminate(true);
      }
    });
  });

  describe('workerType: process', () => {
    it('runs a task through a child process worker and terminates without hanging', async () => {
      const pool = createPool({ maxWorkers: 1, workerType: 'process' });
      try {
        expect(await pool.exec((a: number, b: number) => a + b, [20, 22])).toBe(42);
      } finally {
        await pool.terminate(true);
      }
    });
  });
});
