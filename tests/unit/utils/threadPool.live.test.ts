/**
 * Live differential parity: `src/utils/threadPool.ts` versus the installed
 * `@danielsimonjr/workerpool` 10.2.0, run on the same Levenshtein worker.
 *
 * This is the Step 1 check of the Sprint 8 plan: while the package is still
 * installed, drive BOTH implementations over the same corpus and compare. The
 * frozen counterpart is `threadPool.parity.test.ts`, which replays
 * `fixtures/threadPoolParity.json` after the package is gone.
 *
 * The file skips itself when the package is not installed, so it keeps working
 * as a re-recording aid without turning the removal into a failing suite. It
 * never statically imports the package: the import is dynamic and resolved
 * through the package name at runtime.
 *
 * @module tests/unit/utils/threadPool.live
 */

import { describe, expect, it } from 'vitest';
import { pool as createThreadPool } from '../../../src/utils/threadPool.js';
import {
  observeAll,
  observeScriptlessPool,
  observeFailures,
  observeTerminate,
  observeTimeoutAndCancel,
  runFuzzyChunks,
  runLevenshteinBatch,
  levenshteinWorkerConfig,
  type PoolFactory,
} from './helpers/threadPoolParityCases.js';

/** The package's `src/js/index.js` entry, or `null` when it is not installed. */
async function loadWorkerpool(): Promise<PoolFactory | null> {
  try {
    const imported = (await import('@danielsimonjr/workerpool')) as {
      default?: { pool?: PoolFactory };
      pool?: PoolFactory;
    };
    const factory = imported.default?.pool ?? imported.pool;
    return typeof factory === 'function' ? factory : null;
  } catch {
    return null;
  }
}

const workerpool = await loadWorkerpool();

describe.skipIf(workerpool === null)('live parity: threadPool vs installed workerpool', () => {
  const reference = workerpool as PoolFactory;

  it('finds the installed package', () => {
    expect(typeof reference).toBe('function');
  });

  it('runs the Levenshtein batch identically', async () => {
    const config = levenshteinWorkerConfig();
    const [oldPool, newPool] = await Promise.all([
      runLevenshteinBatch(reference, config),
      runLevenshteinBatch(createThreadPool, config),
    ]);
    expect(newPool).toEqual(oldPool);
  });

  it('runs the fuzzy-search chunk fan-out identically', async () => {
    const config = levenshteinWorkerConfig();
    const [oldPool, newPool] = await Promise.all([
      runFuzzyChunks(reference, config),
      runFuzzyChunks(createThreadPool, config),
    ]);
    expect(newPool).toEqual(oldPool);
  });

  it('runs pool() with no script identically', async () => {
    expect(await observeScriptlessPool(createThreadPool)).toEqual(await observeScriptlessPool(reference));
  });

  it('reports failure shapes identically', async () => {
    expect(await observeFailures(createThreadPool)).toEqual(await observeFailures(reference));
  });

  it('reports timeout and cancel behaviour identically', async () => {
    expect(await observeTimeoutAndCancel(createThreadPool)).toEqual(await observeTimeoutAndCancel(reference));
  });

  it('reports terminate behaviour identically', async () => {
    expect(await observeTerminate(createThreadPool)).toEqual(await observeTerminate(reference));
  });

  it('produces identical observations end to end', async () => {
    expect(await observeAll(createThreadPool)).toEqual(await observeAll(reference));
  });
});
